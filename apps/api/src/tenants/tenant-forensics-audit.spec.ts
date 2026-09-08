import { TenantsController } from './tenants.controller';

/**
 * Standard Audit Surface §16 — forensic coverage (2026-09-08).
 *
 * These three tenant mutations changed security-relevant state and wrote NO
 * AuditLog row. Found by a route census over every guarded mutating handler,
 * then confirmed by reading each one:
 *
 *   PUT  /tenants/me/usb-ingest              admits externally-signed content
 *   POST /tenants/me/usb-ingest/rotate-key   invalidates every signed bundle
 *   PUT  /tenants/me/location-based-emergency  changes WHICH screens an alert reaches
 *
 * Each is now written inside the SAME transaction as the state change, so the
 * flip and its record cannot diverge. These tests fail if the write is removed
 * OR if it is moved outside the transaction.
 */
function harness() {
  const auditRows: any[] = [];
  const tenantWrites: any[] = [];
  const tx = {
    tenant: { update: jest.fn(async (a: any) => { tenantWrites.push(a); return {}; }) },
    auditLog: { create: jest.fn(async (a: any) => { auditRows.push(a.data); return {}; }) },
  };
  const prisma: any = {
    client: {
      // A transaction that RESOLVES — so a handler that wrote outside it would
      // still pass the happy path and only fail the assertions below.
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      tenant: { update: jest.fn(async () => { throw new Error('wrote OUTSIDE the transaction'); }) },
      auditLog: { create: jest.fn(async () => { throw new Error('audit OUTSIDE the transaction'); }) },
    },
  };
  return { controller: new TenantsController(prisma, {} as any), auditRows, tenantWrites, tx };
}

const req = { user: { userId: 'user-1', tenantId: 'tenant-A', role: 'DISTRICT_ADMIN' } };

describe('§16 — security-relevant tenant mutations leave a forensic record', () => {
  it('records enabling USB ingest, with the actor and the new value', async () => {
    const { controller, auditRows, tenantWrites } = harness();
    await controller.setUsbIngestEnabled(req as any, { enabled: true });
    expect(tenantWrites).toHaveLength(1);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      tenantId: 'tenant-A', userId: 'user-1',
      action: 'USB_INGEST_TOGGLED', targetType: 'Tenant', targetId: 'tenant-A',
    });
    expect(JSON.parse(auditRows[0].details)).toEqual({ enabled: true });
  });

  it('records DISABLING it too — turning a control off is the interesting direction', async () => {
    const { controller, auditRows } = harness();
    await controller.setUsbIngestEnabled(req as any, { enabled: false });
    expect(JSON.parse(auditRows[0].details)).toEqual({ enabled: false });
  });

  it('records a USB signing-key rotation WITHOUT ever recording the key', async () => {
    const { controller, auditRows, tenantWrites } = harness();
    const res: any = await controller.rotateUsbIngestKey(req as any);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe('USB_INGEST_KEY_ROTATED');
    // The new key is returned to the operator exactly once — it must never be
    // durable in the audit trail, which is broadly readable and immutable.
    const serialized = JSON.stringify(auditRows[0]) + JSON.stringify(tenantWrites);
    expect(res.key).toEqual(expect.any(String));
    expect(JSON.stringify(auditRows[0])).not.toContain(res.key);
    expect(serialized).toContain(res.key); // sanity: it IS in the tenant write, just not the row
  });

  it('records a change to emergency location scoping', async () => {
    const { controller, auditRows } = harness();
    await controller.setLocationBasedEmergencyEnabled(req as any, { enabled: true });
    expect(auditRows[0]).toMatchObject({
      action: 'LOCATION_BASED_EMERGENCY_TOGGLED', targetType: 'Tenant', targetId: 'tenant-A',
    });
  });

  it('writes the flag and its audit row in ONE transaction, never separately', async () => {
    const { controller, tx } = harness();
    // prisma.client.tenant.update / auditLog.create throw in this harness, so
    // reaching them at all fails the test.
    await controller.setUsbIngestEnabled(req as any, { enabled: true });
    await controller.rotateUsbIngestKey(req as any);
    await controller.setLocationBasedEmergencyEnabled(req as any, { enabled: false });
    expect(tx.tenant.update).toHaveBeenCalledTimes(3);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(3);
  });
});
