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

/**
 * 2026-10-26 (M43 on site: "inserted a USB … nothing happens"): the APK now
 * reports every state a stick reaches, not only REJECTED / ACCEPTED. The
 * column stays free text (no migration); the route takes the new vocabulary,
 * keeps the old one, and caps what a device can write into a forensic table.
 */
describe('USB ingest event — the 1.1.55 vocabulary, and caps on device text', () => {
  const own = () => reqAs({ kind: 'device', sub: VICTIM_SCREEN, tenantId: 'tenant-U' });

  it('records every state the screen can report, and the older APKs’ codes', async () => {
    for (const outcome of ['DETECTED', 'NEEDS_ACCESS', 'NO_PACKAGE', 'WAITING_KEY', 'REJECTED', 'IMPORTED', 'ACCEPTED', 'REJECTED_SIGNATURE', 'REJECTED_HASH']) {
      const { controller, prisma } = harness();
      await expect(controller.recordUsbIngestEvent(own() as any, { outcome, reason: 'drive: a USB drive was found' } as any)).resolves.toEqual({ ok: true });
      expect(prisma.client.usbIngestEvent.create.mock.calls[0][0].data.outcome).toBe(outcome);
    }
  });

  it('refuses an outcome that is not an UPPER_SNAKE code (400), writing nothing', async () => {
    for (const outcome of ['imported', 'IMPORTED; DROP TABLE', 'A'.repeat(41), '_LEADING', 42]) {
      const { controller, prisma } = harness();
      await expect(controller.recordUsbIngestEvent(own() as any, { outcome } as any)).rejects.toMatchObject({ status: 400 });
      expect(prisma.client.usbIngestEvent.create).not.toHaveBeenCalled();
    }
  });

  it('caps device text, and a non-numeric size no longer throws inside BigInt', async () => {
    const { controller, prisma } = harness();
    await controller.recordUsbIngestEvent(own() as any, {
      outcome: 'REJECTED',
      reason: 'x'.repeat(1000),
      bundleVersion: '9'.repeat(200),
      deviceSerial: 's'.repeat(500),
      totalBytes: 'lots',
      assetCount: -4,
    } as any);
    const row = prisma.client.usbIngestEvent.create.mock.calls[0][0].data;
    expect(row.reason).toHaveLength(300);
    expect(row.bundleVersion).toHaveLength(64);
    expect(row.deviceSerial).toHaveLength(128);
    expect(row.totalBytes).toBe(BigInt(0));
    expect(row.assetCount).toBe(0);
  });

  it('keeps a well-formed report exactly as sent', async () => {
    const { controller, prisma } = harness();
    await controller.recordUsbIngestEvent(own() as any, {
      outcome: 'IMPORTED',
      reason: 'imported: 6 files',
      bundleVersion: '1761495599000',
      assetCount: 6,
      totalBytes: '4121154',
      emergencyAssets: false,
    } as any);
    const row = prisma.client.usbIngestEvent.create.mock.calls[0][0].data;
    expect(row).toMatchObject({ outcome: 'IMPORTED', reason: 'imported: 6 files', bundleVersion: '1761495599000', assetCount: 6, emergencyAssets: false });
    expect(row.totalBytes).toBe(BigInt(4121154));
  });
});
