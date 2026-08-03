/**
 * Regression tests for DT-07 — cross-tenant USB-ingest audit-record forgery.
 *
 * `POST /tenants/me/usb-ingest/screens/:screenId/event` has no
 * `@RequireRoles`, so `RbacGuard` short-circuits and a ROLELESS device
 * principal from ANY tenant reached it. `screenId` came from the URL and was
 * never tied to the caller, so a device token for screen S in tenant T could
 * write a `UsbIngestEvent` attributed to screen X in tenant U — with
 * attacker-chosen deviceSerial, bundleVersion, assetCount, outcome and
 * reason. That table is the record an incident reviewer consults to answer
 * "what content was sideloaded onto this screen, and by whom".
 *
 * The old comment claimed "the screenId derivation alone closes the IDOR".
 * It closed the TENANT IDOR (the tenant is derived from the screen row, not
 * supplied) — but not the SCREEN-TARGETING one.
 */

import { TenantsController } from './tenants.controller';

const VICTIM_SCREEN = 'screen-victim-in-tenant-U';

function harness() {
  const prisma: any = {
    client: {
      screen: {
        findUnique: jest.fn().mockResolvedValue({
          id: VICTIM_SCREEN,
          tenantId: 'tenant-U',
          tenant: { id: 'tenant-U', usbIngestEnabled: true, usbIngestKey: null },
        }),
      },
      usbIngestEvent: { create: jest.fn().mockResolvedValue({}) },
    },
  };
  return { controller: new TenantsController(prisma, {} as any), prisma };
}

const BODY = { outcome: 'APPLIED', deviceSerial: 'forged', assetCount: 99 };

const reqAs = (user: any) => ({ user, params: { screenId: VICTIM_SCREEN } });

describe('DT-07 — usb-ingest event must be bound to the caller', () => {
  it('REFUSES a device token from another tenant targeting a victim screen', async () => {
    const { controller, prisma } = harness();
    const attacker = reqAs({ kind: 'device', sub: 'screen-attacker-in-tenant-T', tenantId: 'tenant-T' });
    await expect(controller.recordUsbIngestEvent(attacker as any, BODY as any)).rejects.toMatchObject({
      status: 403,
    });
    expect(prisma.client.usbIngestEvent.create).not.toHaveBeenCalled();
  });

  it('allows a device reporting for ITS OWN screen (the real client path)', async () => {
    const { controller, prisma } = harness();
    const own = reqAs({ kind: 'device', sub: VICTIM_SCREEN, tenantId: 'tenant-U' });
    await expect(controller.recordUsbIngestEvent(own as any, BODY as any)).resolves.toEqual({ ok: true });
    const row = prisma.client.usbIngestEvent.create.mock.calls[0][0].data;
    expect(row.screenId).toBe(VICTIM_SCREEN);
    expect(row.tenantId).toBe('tenant-U'); // still derived from the screen row
  });

  it('REFUSES a principal that is neither a bound device nor a roled user', async () => {
    const { controller } = harness();
    const roleless = reqAs({ sub: 'nobody' });
    await expect(controller.recordUsbIngestEvent(roleless as any, BODY as any)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('allows an operator of the SAME tenant (dashboard-driven ingest review)', async () => {
    const { controller } = harness();
    const admin = reqAs({ role: 'SCHOOL_ADMIN', id: 'u1', tenantId: 'tenant-U' });
    await expect(controller.recordUsbIngestEvent(admin as any, BODY as any)).resolves.toEqual({ ok: true });
  });

  it('REFUSES an operator of a DIFFERENT tenant (404, no cross-tenant existence leak)', async () => {
    const { controller, prisma } = harness();
    const foreignAdmin = reqAs({ role: 'SCHOOL_ADMIN', id: 'u2', tenantId: 'tenant-T' });
    await expect(controller.recordUsbIngestEvent(foreignAdmin as any, BODY as any)).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.client.usbIngestEvent.create).not.toHaveBeenCalled();
  });

  it('still lets SUPER_ADMIN act cross-tenant by design', async () => {
    const { controller } = harness();
    const superAdmin = reqAs({ role: 'SUPER_ADMIN', id: 'u3', tenantId: 'tenant-ANY' });
    await expect(controller.recordUsbIngestEvent(superAdmin as any, BODY as any)).resolves.toEqual({ ok: true });
  });
});
