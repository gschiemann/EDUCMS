/**
 * Regression tests for:
 *  • DT-01 — the operator-facing "revoke this screen's credential" action
 *            that did not exist, and the unpair path that left a live
 *            credential behind.
 *  • DT-04 — `GET /screens` handed `deviceFingerprint` and `pairingCode` to
 *            CONTRIBUTOR and (via the RBAC GET pass-through)
 *            RESTRICTED_VIEWER. The fingerprint is the key to
 *            `POST /screens/register` and to the anonymous OTA write plane;
 *            the pairing code claims the screen outright.
 */

jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret',
}));

import { ScreensController } from './screens.controller';
import { invalidateDeviceCredentialCache } from './device-auth';

function harness(screens: any[]) {
  const prisma: any = {
    client: {
      screen: {
        findMany: jest.fn().mockResolvedValue(screens),
        findFirst: jest.fn().mockResolvedValue(screens[0]),
        update: jest.fn().mockResolvedValue({ id: screens[0]?.id, credentialEpoch: 3 }),
      },
      tenant: { findUnique: jest.fn().mockResolvedValue({ latitude: null, longitude: null, address: null }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    },
  };
  const redis: any = { publish: jest.fn(), sismember: jest.fn().mockResolvedValue(false) };
  const signer: any = { signMessage: jest.fn().mockReturnValue({}) };
  const controller = new ScreensController(
    prisma, redis, signer, {} as any, { syncSubscriptionQuantity: jest.fn() } as any, {} as any,
  );
  return { controller, prisma, redis };
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'screen-1',
  name: 'Hallway',
  tenantId: 'tenant-1',
  deviceFingerprint: 'android-SECRET-fingerprint',
  pairingCode: 'ABC123',
  status: 'ONLINE',
  lastPingAt: new Date(),
  latitude: null,
  longitude: null,
  screenGroup: null,
  userAgent: null,
  credentialEpoch: 2,
  ...overrides,
});

beforeEach(() => invalidateDeviceCredentialCache());

describe('DT-04 — GET /screens must not leak pairing secrets to low-privilege roles', () => {
  const listAs = async (role: string) => {
    const { controller } = harness([row()]);
    const res = await controller.list({ user: { tenantId: 'tenant-1', role } } as any);
    return res[0] as any;
  };

  it('strips deviceFingerprint and pairingCode for CONTRIBUTOR', async () => {
    const s = await listAs('CONTRIBUTOR');
    expect(s.deviceFingerprint).toBeUndefined();
    expect(s.pairingCode).toBeUndefined();
    // The rest of the row is untouched — this is a projection change, not a
    // capability removal.
    expect(s.name).toBe('Hallway');
    expect(s.id).toBe('screen-1');
  });

  it('strips them for RESTRICTED_VIEWER, which reaches this route via the RBAC GET pass-through', async () => {
    const s = await listAs('RESTRICTED_VIEWER');
    expect(s.deviceFingerprint).toBeUndefined();
    expect(s.pairingCode).toBeUndefined();
  });

  it('still returns them to SCHOOL_ADMIN / DISTRICT_ADMIN / SUPER_ADMIN (the pair modal needs them)', async () => {
    for (const role of ['SCHOOL_ADMIN', 'DISTRICT_ADMIN', 'SUPER_ADMIN']) {
      const s = await listAs(role);
      expect(s.deviceFingerprint).toBe('android-SECRET-fingerprint');
      expect(s.pairingCode).toBe('ABC123');
    }
  });
});

describe('DT-01 — POST /screens/:id/revoke-credential', () => {
  it('writes status=REVOKED — the state read in eight places and written in none', async () => {
    const { controller, prisma } = harness([row()]);
    const res = await controller.revokeCredential(
      { user: { tenantId: 'tenant-1', role: 'SCHOOL_ADMIN', id: 'u1' } } as any,
      'screen-1',
      { reason: 'kiosk went missing' },
    );
    const data = prisma.client.screen.update.mock.calls[0][0].data;
    expect(data.status).toBe('REVOKED');
    expect(data.credentialEpoch).toEqual({ increment: 1 });
    expect(res).toMatchObject({ revoked: true, screenId: 'screen-1', credentialEpoch: 3 });
  });

  it('preserves the screen row — the operator no longer has to DELETE to kill a credential', async () => {
    // The old-only kill switch destroyed the screen's schedules and its
    // telemetry history along with the credential.
    const { controller, prisma } = harness([row()]);
    await controller.revokeCredential(
      { user: { tenantId: 'tenant-1', role: 'SCHOOL_ADMIN', id: 'u1' } } as any,
      'screen-1',
      {},
    );
    expect(prisma.client.screen.update).toHaveBeenCalled();
    expect((prisma.client.screen as any).delete).toBeUndefined();
  });

  it('records an immutable AuditLog row with the operator and their reason', async () => {
    const { controller, prisma } = harness([row()]);
    await controller.revokeCredential(
      { user: { tenantId: 'tenant-1', role: 'SCHOOL_ADMIN', id: 'u1' } } as any,
      'screen-1',
      { reason: 'stolen from the gym' },
    );
    const audit = prisma.client.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe('SCREEN_CREDENTIAL_REVOKED');
    expect(audit.userId).toBe('u1');
    expect(JSON.parse(audit.details).operatorReason).toBe('stolen from the gym');
  });

  it('is tenant-scoped for non-SUPER_ADMIN', async () => {
    const { controller, prisma } = harness([row()]);
    await controller.revokeCredential(
      { user: { tenantId: 'tenant-1', role: 'SCHOOL_ADMIN', id: 'u1' } } as any,
      'screen-1',
      {},
    );
    expect(prisma.client.screen.findFirst.mock.calls[0][0].where).toEqual({
      id: 'screen-1',
      tenantId: 'tenant-1',
    });
  });

  it('404s a screen outside the caller’s tenant', async () => {
    const { controller, prisma } = harness([row()]);
    prisma.client.screen.findFirst.mockResolvedValue(null);
    await expect(
      controller.revokeCredential(
        { user: { tenantId: 'tenant-other', role: 'SCHOOL_ADMIN', id: 'u1' } } as any,
        'screen-1',
        {},
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
