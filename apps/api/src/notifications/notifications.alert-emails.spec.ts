/**
 * GET / PUT /api/v1/notifications/alert-emails (2026-10-23) — a person's own
 * alert-email switch + language. Only the signed-in user's own row, strict
 * input, admins flagged eligible.
 */
import { NotificationsController } from './notifications.controller';
import { OfflineScreenScanner } from './offline-screen-scanner';

function build(user: any) {
  const row = { ...user };
  const prisma = {
    client: {
      user: {
        findFirst: jest.fn(async ({ where }: any) => (where.id === row.id && !row.deletedAt ? row : null)),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (where.id !== row.id || row.deletedAt) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
      },
    },
  };
  const ctrl = new NotificationsController({} as any, prisma as any);
  const req = { user: { id: row.id, tenantId: 't1', role: row.role } };
  return { ctrl, req, row, prisma };
}

describe('alert-email preferences', () => {
  it('reads the default: ON, no language chosen, eligible for an admin', async () => {
    const { ctrl, req } = build({ id: 'u1', role: 'SCHOOL_ADMIN', alertEmailsEnabled: true, alertEmailLocale: null });
    await expect(ctrl.getAlertEmails(req)).resolves.toEqual({ enabled: true, locale: null, eligible: true });
  });

  it('a contributor is not eligible (they never receive alert emails)', async () => {
    const { ctrl, req } = build({ id: 'u1', role: 'CONTRIBUTOR', alertEmailsEnabled: true, alertEmailLocale: null });
    await expect(ctrl.getAlertEmails(req)).resolves.toMatchObject({ eligible: false });
  });

  it('turns them off and sets the language — on the caller’s own row only', async () => {
    const { ctrl, req, row, prisma } = build({ id: 'u1', role: 'DISTRICT_ADMIN', alertEmailsEnabled: true, alertEmailLocale: null });
    await expect(ctrl.setAlertEmails(req, { enabled: false, locale: 'es' })).resolves.toEqual({ enabled: false, locale: 'es', eligible: true });
    expect(row).toMatchObject({ alertEmailsEnabled: false, alertEmailLocale: 'es' });
    expect(prisma.client.user.updateMany.mock.calls[0][0].where).toEqual({ id: 'u1', deletedAt: null });
  });

  it('refuses junk', async () => {
    const { ctrl, req } = build({ id: 'u1', role: 'SCHOOL_ADMIN', alertEmailsEnabled: true, alertEmailLocale: null });
    await expect(ctrl.setAlertEmails(req, { enabled: 'yes' })).rejects.toMatchObject({ status: 400 });
    await expect(ctrl.setAlertEmails(req, { locale: 'fr' })).rejects.toMatchObject({ status: 400 });
    await expect(ctrl.setAlertEmails(req, {})).rejects.toMatchObject({ status: 400 });
  });

  it('a request with no tenant (a device token) is refused before any read', async () => {
    const { ctrl, prisma } = build({ id: 'u1', role: 'SCHOOL_ADMIN', alertEmailsEnabled: true });
    await expect(ctrl.getAlertEmails({ user: { id: 'u1' } })).rejects.toBeTruthy();
    expect(prisma.client.user.findFirst).not.toHaveBeenCalled();
  });
});

describe('the offline scanner hands its read to the alert emails — and survives them failing', () => {
  it('passes the scan result through; a throwing alert worker does not fail the tick', async () => {
    const result = { found: 1, notified: 0, infraEvents: 0, crossings: 0, recovered: 0, seeded: false, offline: [] };
    const notifications = { scanOfflineScreens: jest.fn(async () => result) };
    const alertEmails = { onOfflineScan: jest.fn(async () => { throw new Error('boom'); }) };
    const lease = { tryAcquire: jest.fn(async () => ({ leader: true })) };
    const scanner = new OfflineScreenScanner(notifications as any, lease as any, alertEmails as any);
    await expect((scanner as any).tick(5)).resolves.toBeUndefined();
    expect(alertEmails.onOfflineScan).toHaveBeenCalledWith(result);
    expect((scanner as any).running).toBe(false);
  });
});
