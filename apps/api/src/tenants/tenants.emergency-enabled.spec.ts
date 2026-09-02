/**
 * PUT /api/v1/tenants/me/emergency-enabled — the server-side replacement for
 * the browser-localStorage emergency gate (handoff §19.5).
 *
 * What this guards:
 *   1. K-12 CANNOT be turned off (403, with a message that explains why) —
 *      the always-on contract. A silent success or a silent no-op would let
 *      a school believe it had disarmed something it had not, or the reverse.
 *   2. Every accepted change writes an immutable AuditLog row naming the
 *      previous and next value (§19.6) — and never a secret.
 *   3. The response is the RE-READ authoritative state, so the editor can
 *      show success only after the server confirms (§13.2).
 *
 * Unit-level: the controller is constructed directly with mocked Prisma /
 * Jwt / Redis, matching tenants.controller.spec.ts.
 */
import { TenantsController } from './tenants.controller';

function makeController() {
  const tenant = { findUnique: jest.fn(), update: jest.fn() };
  const auditLog = { create: jest.fn().mockResolvedValue({}) };
  const prisma: any = {
    client: {
      tenant,
      auditLog,
      $transaction: jest.fn(async (cb: any) => cb({ tenant, auditLog })),
    },
  };
  const jwt: any = { sign: jest.fn() };
  const redis: any = { markUserTokensInvalid: jest.fn() };
  return { controller: new TenantsController(prisma, jwt, redis), tenant, auditLog };
}

const req = { user: { id: 'u1', userId: 'u1', role: 'DISTRICT_ADMIN', tenantId: 't1' } } as any;

describe('TenantsController.setEmergencyEnabled', () => {
  it('turns a GYM on, re-reads the row, and writes an audit event', async () => {
    const { controller, tenant, auditLog } = makeController();
    tenant.findUnique.mockResolvedValue({ vertical: 'GYM', emergencyEnabled: null });
    tenant.update.mockResolvedValue({ vertical: 'GYM', emergencyEnabled: true });

    const res: any = await controller.setEmergencyEnabled(req, { enabled: true });

    expect(tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' }, data: { emergencyEnabled: true } }),
    );
    // The RE-READ row is what's reported, not the request body.
    expect(res).toMatchObject({
      ok: true,
      emergencyEnabled: true,
      emergencyEnabledEffective: true,
      emergencyEnabledLocked: false,
    });

    expect(auditLog.create).toHaveBeenCalledTimes(1);
    const row = auditLog.create.mock.calls[0][0].data;
    expect(row).toMatchObject({
      tenantId: 't1',
      userId: 'u1',
      action: 'EMERGENCY_ENABLED_CHANGED',
      targetType: 'Tenant',
      targetId: 't1',
    });
    const details = JSON.parse(row.details);
    expect(details).toMatchObject({
      scopeType: 'organization',
      scopeId: 't1',
      changedFields: ['emergencyEnabled'],
      // NULL before (riding the GYM default = off), explicit true after.
      previous: { emergencyEnabled: null, effective: false },
      next: { emergencyEnabled: true, effective: true },
    });
  });

  it('turns a GYM back off', async () => {
    const { controller, tenant } = makeController();
    tenant.findUnique.mockResolvedValue({ vertical: 'GYM', emergencyEnabled: true });
    tenant.update.mockResolvedValue({ vertical: 'GYM', emergencyEnabled: false });

    const res: any = await controller.setEmergencyEnabled(req, { enabled: false });

    expect(res.emergencyEnabledEffective).toBe(false);
    expect(tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { emergencyEnabled: false } }),
    );
  });

  it('REFUSES to turn a K-12 tenant off — 403, no write, no audit row', async () => {
    const { controller, tenant, auditLog } = makeController();
    tenant.findUnique.mockResolvedValue({ vertical: 'K12', emergencyEnabled: null });

    await expect(controller.setEmergencyEnabled(req, { enabled: false })).rejects.toMatchObject({
      status: 403,
      response: { code: 'EMERGENCY_ENABLEMENT_LOCKED' },
    });

    // The refusal must be total: nothing written, nothing logged as changed.
    expect(tenant.update).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it('allows a K-12 tenant to be re-affirmed ON (idempotent, still audited)', async () => {
    const { controller, tenant, auditLog } = makeController();
    tenant.findUnique.mockResolvedValue({ vertical: 'K12', emergencyEnabled: null });
    tenant.update.mockResolvedValue({ vertical: 'K12', emergencyEnabled: true });

    const res: any = await controller.setEmergencyEnabled(req, { enabled: true });

    expect(res.emergencyEnabledEffective).toBe(true);
    expect(res.emergencyEnabledLocked).toBe(true);
    expect(auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('404s when the caller tenant row is gone', async () => {
    const { controller, tenant } = makeController();
    tenant.findUnique.mockResolvedValue(null);
    await expect(controller.setEmergencyEnabled(req, { enabled: true })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('TenantsController.getTenantInfo — emergency enablement fields', () => {
  it('reports the raw column AND the resolved effective value', async () => {
    const { controller, tenant } = makeController();
    tenant.findUnique.mockResolvedValue({
      id: 't1', name: 'Iron Gym', vertical: 'GYM', emergencyEnabled: null,
    });

    const res: any = await controller.getTenantInfo(req);

    // NULL is "never stated", NOT "off" — the editor must be able to tell
    // the difference (§9.3), so both values ship.
    expect(res.emergencyEnabled).toBeNull();
    expect(res.emergencyEnabledEffective).toBe(false);
    expect(res.emergencyEnabledLocked).toBe(false);
  });

  it('a K-12 tenant reads effective-ON and locked even with a NULL column', async () => {
    const { controller, tenant } = makeController();
    tenant.findUnique.mockResolvedValue({
      id: 't1', name: 'Springfield High', vertical: 'K12', emergencyEnabled: null,
    });

    const res: any = await controller.getTenantInfo(req);

    expect(res.emergencyEnabledEffective).toBe(true);
    expect(res.emergencyEnabledLocked).toBe(true);
  });
});
