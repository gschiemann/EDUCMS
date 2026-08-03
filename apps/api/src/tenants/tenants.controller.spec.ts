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
  const user = { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) };
  const screen = { count: jest.fn().mockResolvedValue(0) };
  const auditLog = { create: jest.fn().mockResolvedValue({}) };
  const prisma: any = {
    client: {
      tenant, user, screen, auditLog,
      $transaction: jest.fn(async (cb: any) => cb({ auditLog, tenant })),
    },
  };
  const jwt: any = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
  // ACC-05 (2026-08-01): archiving a tenant now revokes its users' live
  // sessions, so the controller takes RedisService.
  const redis: any = { markUserTokensInvalid: jest.fn().mockResolvedValue(undefined) };
  const controller = new TenantsController(prisma, jwt, redis);
  return { controller, tenant, user, screen, auditLog, jwt, redis };
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
 * ACC-07 (2026-08-01) — a tenant switch silently upgraded a 1-hour session to
 * a 30-day one.
 *
 * `switchTenant` signed `{ expiresIn: '30d' }` unconditionally. A user who
 * logged in WITHOUT "remember me" holds a 1-hour session (auth.module
 * signOptions); one click of the workspace switcher — a navigation action,
 * not an authentication one — handed them the rememberMe ceiling. On a shared
 * district workstation that turns "I closed the tab" into a month-long live
 * credential, and it made the rememberMe policy trivially bypassable.
 *
 * The rule now: switching changes SCOPE, never LIFETIME.
 */
describe('TenantsController.switchTenant — session lifetime (ACC-07)', () => {
  function switchReq(tokenExp: number | undefined) {
    return {
      user: { id: 'u1', userId: 'u1', role: 'SUPER_ADMIN', tenantId: 't1', tokenExp },
    } as any;
  }

  async function doSwitch(tokenExp: number | undefined) {
    const { controller, tenant, user, jwt } = makeController();
    tenant.findUnique.mockResolvedValue({
      id: 't2', name: 'Pizza Co', slug: 'pizza', parentId: null, vertical: 'QSR',
    });
    user.findUnique.mockResolvedValue({
      id: 'u1', email: 'a@b.c', role: 'SUPER_ADMIN', canTriggerPanic: false,
    });
    await controller.switchTenant(switchReq(tokenExp), { tenantId: 't2' });
    return jwt.sign.mock.calls[0][1];
  }

  it('does NOT extend a short (1-hour) session to 30 days', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const opts = await doSwitch(nowSec + 3600); // ~1h left

    expect(opts.expiresIn).toBeLessThanOrEqual(3600);
    expect(opts.expiresIn).toBeGreaterThan(3500);
    // The old behavior, pinned so it can't come back.
    expect(opts.expiresIn).not.toBe('30d');
    expect(opts.expiresIn).toBeLessThan(30 * 24 * 3600);
  });

  it('preserves a genuine rememberMe session (no downgrade either)', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const thirtyDays = 30 * 24 * 3600;
    const opts = await doSwitch(nowSec + thirtyDays);
    expect(opts.expiresIn).toBeGreaterThan(thirtyDays - 60);
    expect(opts.expiresIn).toBeLessThanOrEqual(thirtyDays);
  });

  it('never hands back an already-dead token (60s floor at the very end of a session)', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const opts = await doSwitch(nowSec + 1); // 1 second left
    expect(opts.expiresIn).toBe(60);
  });

  it('falls back to the module default (not 30 days) when the token carries no exp', async () => {
    const opts = await doSwitch(undefined);
    expect(opts).toBeUndefined(); // → JwtModule signOptions (1h)
  });
});

/**
 * ACC-05 (2026-08-01) — archiving a tenant used to be a DISPLAY-layer change
 * only: it dropped out of lists and maps while every one of its users kept
 * logging in normally, and an admin among them could still fire
 * /emergency/trigger at real screens belonging to a "retired" location.
 * Blocking login closes the front door; a token already issued stays valid for
 * up to 30 days, so archiving must also burn the live sessions.
 */
describe('TenantsController archive — revokes the tenant users\' sessions (ACC-05)', () => {
  const req = { user: { userId: 'admin-1', role: 'SUPER_ADMIN', tenantId: 'other' } } as any;

  function seedCalmTenant(tenant: any) {
    tenant.findUnique.mockResolvedValue({
      id: 'kid-1', name: 'Retired Site', slug: 'retired',
      parentId: 'parent-1', emergencyStatus: 'INACTIVE', archivedAt: null,
    });
  }

  it('revokes every member session on archive', async () => {
    const { controller, tenant, user, redis } = makeController();
    seedCalmTenant(tenant);
    user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]);

    const res: any = await controller.archiveTenant(req, 'kid-1');

    expect(redis.markUserTokensInvalid).toHaveBeenCalledTimes(3);
    expect(redis.markUserTokensInvalid.mock.calls.map((c: any[]) => c[0])).toEqual([
      'u1', 'u2', 'u3',
    ]);
    expect(res.sessionsRevoked).toBe(3);
    expect(res.sessionRevocationFailures).toBe(0);
  });

  it('reports a PARTIAL outcome instead of failing the archive', async () => {
    const { controller, tenant, user, redis } = makeController();
    seedCalmTenant(tenant);
    user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    redis.markUserTokensInvalid.mockRejectedValueOnce(new Error('redis down'));

    const res: any = await controller.archiveTenant(req, 'kid-1');
    expect(res.success).toBe(true);
    expect(res.sessionsRevoked).toBe(1);
    expect(res.sessionRevocationFailures).toBe(1);
  });

  it('does NOT revoke on UNarchive (restoring a tenant must not sign everyone out)', async () => {
    const { controller, tenant, user, redis } = makeController();
    tenant.findUnique.mockResolvedValue({
      id: 'kid-1', name: 'Restored', slug: 'restored',
      parentId: 'parent-1', emergencyStatus: 'INACTIVE', archivedAt: new Date(),
    });
    user.findMany.mockResolvedValue([{ id: 'u1' }]);

    await controller.unarchiveTenant(req, 'kid-1');
    expect(redis.markUserTokensInvalid).not.toHaveBeenCalled();
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
