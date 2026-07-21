/**
 * Regression guard for the 2026-06-01 "account switch reverts the industry
 * to School" incident — and the operator's hard requirement that follows:
 *
 *   "the only way to switch an industry is by going to settings and
 *    purposely doing it."
 *
 * Two invariants the catastrophic scenario (a support user switching INTO a
 * customer and silently changing their industry / losing their templates)
 * depends on:
 *
 *   1. POST /tenants/switch RETURNS the target tenant's vertical on the
 *      user object (so the dashboard shows the right industry — the missing
 *      field was the bug), AND
 *   2. POST /tenants/switch NEVER WRITES tenant.vertical (it's read-only on
 *      the stored industry — switching can't mutate a customer's data).
 *
 * Unit-level: the controller is constructed directly with mocked Prisma +
 * Jwt (no Nest DI / guards needed since we call the method).
 */

import { TenantsController } from './tenants.controller';

function makeController() {
  const tenant = {
    findUnique: jest.fn(), update: jest.fn(),
    count: jest.fn().mockResolvedValue(0), delete: jest.fn().mockResolvedValue({}),
  };
  const user = { findUnique: jest.fn() };
  const screen = { count: jest.fn().mockResolvedValue(0) };
  const auditLog = { create: jest.fn().mockResolvedValue({}) };
  const prisma: any = {
    client: {
      tenant, user, screen, auditLog,
      $transaction: jest.fn(async (cb: any) => cb({ auditLog, tenant })),
    },
  };
  const jwt: any = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
  const controller = new TenantsController(prisma, jwt);
  return { controller, tenant, user, screen, auditLog, jwt };
}

describe('TenantsController.switchTenant — industry safety', () => {
  it('returns the TARGET tenant vertical on the user (so the switch shows the right industry)', async () => {
    const { controller, tenant, user } = makeController();
    // Target = a QSR (restaurant) tenant — NOT a school.
    tenant.findUnique.mockResolvedValue({
      id: 't2', name: 'Pizza Co', slug: 'pizza', parentId: null, vertical: 'QSR',
    });
    user.findUnique.mockResolvedValue({
      id: 'u1', email: 'admin@venueos.app', role: 'SUPER_ADMIN', canTriggerPanic: false,
    });

    const req = { user: { id: 'u1', userId: 'u1', role: 'SUPER_ADMIN', tenantId: 't1' } };
    const res: any = await controller.switchTenant(req as any, { tenantId: 't2' });

    expect(res.user.tenantVertical).toBe('QSR');
    expect(res.user.tenantName).toBe('Pizza Co');
    expect(res.user.tenantId).toBe('t2');
    // NOT the K12/"school" default that the pre-fix bug produced.
    expect(res.user.tenantVertical).not.toBe('K12');
  });

  it('NEVER writes tenant.vertical — switching is read-only on the stored industry', async () => {
    const { controller, tenant, user } = makeController();
    tenant.findUnique.mockResolvedValue({
      id: 't2', name: 'Iron Gym', slug: 'iron', parentId: null, vertical: 'GYM',
    });
    user.findUnique.mockResolvedValue({
      id: 'u1', email: 'admin@venueos.app', role: 'SUPER_ADMIN', canTriggerPanic: false,
    });

    const req = { user: { id: 'u1', userId: 'u1', role: 'SUPER_ADMIN', tenantId: 't1' } };
    await controller.switchTenant(req as any, { tenantId: 't2' });

    // The whole point: a switch must not mutate the customer's tenant row.
    expect(tenant.update).not.toHaveBeenCalled();
  });
});

/**
 * 2026-07-21 functional-depth-audit regression — the delete guard treated
 * anything except 'NORMAL'/'' as an active emergency, but the fleet's at-rest
 * value is 'INACTIVE' (all-clear writes it), so EVERY tenant 409'd as
 * "active emergency" and location deletion NEVER worked. Caught live on prod
 * trying to remove the audit's disposable vertical-test tenants.
 */
describe('TenantsController.deleteChild — emergency-status calm set', () => {
  const req = { user: { userId: 'u1', role: 'SUPER_ADMIN', tenantId: 'parent-1' } };

  it("deletes a calm tenant whose status is 'INACTIVE' (the fleet's at-rest value — the exact false-409 bug)", async () => {
    const { controller, tenant } = makeController();
    tenant.findUnique.mockResolvedValue({
      id: 'kid-1', name: 'Audit QSR', slug: 'audit-qsr', parentId: 'parent-1', emergencyStatus: 'INACTIVE',
    });
    const res: any = await controller.deleteChild(req as any, 'kid-1');
    expect(res.success).toBe(true);
    expect(tenant.delete).toHaveBeenCalledWith({ where: { id: 'kid-1' } });
  });

  it("still BLOCKS deletion during a real active emergency (severity string, e.g. 'CRITICAL')", async () => {
    const { controller, tenant } = makeController();
    tenant.findUnique.mockResolvedValue({
      id: 'kid-2', name: 'Hot Tenant', slug: 'hot', parentId: 'parent-1', emergencyStatus: 'CRITICAL',
    });
    await expect(controller.deleteChild(req as any, 'kid-2')).rejects.toMatchObject({
      response: { code: 'TENANT_DELETE_ACTIVE_EMERGENCY' },
    });
    expect(tenant.delete).not.toHaveBeenCalled();
  });

  it('maps the FK-restrict failure (immutable audit rows) to an honest 409, not a 500', async () => {
    const { controller, tenant } = makeController();
    tenant.findUnique.mockResolvedValue({
      id: 'kid-4', name: 'Has History', slug: 'hist', parentId: 'parent-1', emergencyStatus: 'INACTIVE',
    });
    tenant.delete.mockRejectedValue(Object.assign(new Error('FK violation'), { code: 'P2003' }));
    await expect(controller.deleteChild(req as any, 'kid-4')).rejects.toMatchObject({
      response: { code: 'TENANT_DELETE_HAS_HISTORY' },
    });
  });

  it("treats 'NORMAL', '' and null as calm too (legacy vocabulary keeps working)", async () => {
    for (const calm of ['NORMAL', '', null]) {
      const { controller, tenant } = makeController();
      tenant.findUnique.mockResolvedValue({
        id: 'kid-3', name: 'Calm', slug: 'calm', parentId: 'parent-1', emergencyStatus: calm,
      });
      const res: any = await controller.deleteChild(req as any, 'kid-3');
      expect(res.success).toBe(true);
    }
  });
});
