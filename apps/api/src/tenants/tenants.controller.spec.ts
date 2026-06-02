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
  const tenant = { findUnique: jest.fn(), update: jest.fn() };
  const user = { findUnique: jest.fn() };
  const auditLog = { create: jest.fn().mockResolvedValue({}) };
  const prisma: any = { client: { tenant, user, auditLog } };
  const jwt: any = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
  const controller = new TenantsController(prisma, jwt);
  return { controller, tenant, user, auditLog, jwt };
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
