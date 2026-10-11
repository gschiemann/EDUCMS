import { ForbiddenException, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { EmergencyController } from '../emergency/emergency.controller';
import { ScreenEmergencyController } from '../emergency/screen-emergency.controller';
import { TenantsController } from '../tenants/tenants.controller';
import { UsersController } from '../users/users.controller';
import { loadManageableTarget } from '../users/manageable-target';
import { runWithSupportAccess } from './support-access.context';
import { SupportAccessService } from './support-access.service';
import { SupportAccessInterceptor } from './support-access.interceptor';
import { SupportAccessModule } from './support-access.module';
import { SupportAccessController } from './support-access.controller';
import { SuperSupportAccessController } from './super-support-access.controller';

/**
 * EVERY BYPASS THAT WAS CLOSED, driven through the REAL controllers inside a
 * support-access frame (what the global interceptor opens for each
 * SUPER_ADMIN request). A stub service answers "no reach" for CUSTOMER and
 * "grant" for GRANTED, so each test proves the resolver asks before it acts.
 */
const CUSTOMER = 'tenant-customer';
const GRANTED = 'tenant-granted';
const SUPER = { id: 'super-1', userId: 'super-1', email: 'g@venueos', role: AppRole.SUPER_ADMIN, tenantId: 'tenant-home', tokenExp: Math.floor(Date.now() / 1000) + 3600 };

function stubService() {
  const reach = async (_u: any, tenantId: string) =>
    tenantId === GRANTED
      ? { allowed: true, basis: 'grant', grantId: 'grant-1', rootTenantId: GRANTED }
      : tenantId === 'tenant-home'
        ? { allowed: true, basis: 'home', grantId: null, rootTenantId: 'tenant-home' }
        : { allowed: false, basis: null, grantId: null, rootTenantId: tenantId };
  const service: any = {
    reach: jest.fn(reach),
    assertReach: jest.fn(async (u: any, t: string) => {
      if (!u || u.role !== AppRole.SUPER_ADMIN || u.kind) return null;
      const d = await reach(u, t);
      if (!d.allowed) throw SupportAccessService.refusal();
      return d;
    }),
    recordAction: jest.fn(),
    reachableBasisBulk: jest.fn(async () => new Map()),
  };
  return service;
}

const framed = <T,>(fn: () => Promise<T>): Promise<T> =>
  runWithSupportAccess({ service: stubService(), workspace: null }, fn);

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    const r = (e as HttpException).getResponse?.() as any;
    return { status: (e as HttpException).getStatus?.(), code: r?.code };
  }
  throw new Error('expected a 403');
};

describe('BYPASS 1 — emergency trigger / all-clear scope (EmergencyController.resolveScopeTenant)', () => {
  function controller() {
    const prisma: any = {
      client: {
        screenGroup: { findUnique: jest.fn(async ({ where }: any) => ({ tenantId: where.id === 'grp-c' ? CUSTOMER : GRANTED })) },
        screen: { findUnique: jest.fn(async ({ where }: any) => ({ tenantId: where.id === 'scr-c' ? CUSTOMER : GRANTED })) },
        tenant: { findUnique: jest.fn(async () => ({ parentId: null })) },
      },
    };
    return new EmergencyController({ publish: jest.fn() } as any, prisma, { signMessage: jest.fn() } as any, { dispatch: jest.fn() } as any, {} as any, {} as any);
  }
  const resolve = (c: any, scopeType: string, scopeId: string, user: any = SUPER) => c.resolveScopeTenant(scopeType, scopeId, user);

  it('a SUPER_ADMIN can no longer aim an alert at a customer tenant, group or screen without a grant', async () => {
    const c = controller();
    for (const [type, id] of [['tenant', CUSTOMER], ['group', 'grp-c'], ['device', 'scr-c']] as const) {
      expect(await refusal(framed(() => resolve(c, type, id)))).toEqual({ status: 403, code: 'SUPPORT_ACCESS_REQUIRED' });
    }
  });

  it('under a grant the same scopes resolve; a customer admin is untouched by the gate', async () => {
    const c = controller();
    expect(await framed(() => resolve(c, 'tenant', GRANTED))).toBe(GRANTED);
    expect(await framed(() => resolve(c, 'group', 'grp-g'))).toBe(GRANTED);
    expect(await framed(() => resolve(c, 'device', 'scr-g'))).toBe(GRANTED);
    const admin = { id: 'a', role: AppRole.DISTRICT_ADMIN, tenantId: CUSTOMER };
    expect(await framed(() => resolve(c, 'tenant', CUSTOMER, admin))).toBe(CUSTOMER);
  });

  it('clearing a customer emergency message is refused without a grant', async () => {
    const c: any = controller();
    c.prisma.client.emergencyMessage = {
      findUnique: jest.fn(async () => ({ id: 'm1', tenantId: CUSTOMER, clearedAt: null })),
      updateMany: jest.fn(),
    };
    c.prisma.client.$transaction = jest.fn();
    const r = await refusal(framed(() => c.clearMessage('m1', { user: SUPER } as any)));
    expect(r.code).toBe('SUPPORT_ACCESS_REQUIRED');
    expect(c.prisma.client.$transaction).not.toHaveBeenCalled();
  });
});

describe('BYPASS 2 — per-screen emergency override (ScreenEmergencyController.resolveScreen)', () => {
  it('the SUPER_ADMIN "look up by id only" branch asks for reach before returning the screen', async () => {
    const prisma: any = { client: { screen: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, tenantId: where.id === 'scr-c' ? CUSTOMER : GRANTED })) } } };
    const c: any = new ScreenEmergencyController(prisma, {} as any, {} as any);
    expect(await refusal(framed(() => c.resolveScreen('scr-c', null, SUPER)))).toEqual({ status: 403, code: 'SUPPORT_ACCESS_REQUIRED' });
    expect((await framed(() => c.resolveScreen('scr-g', null, SUPER))).tenantId).toBe(GRANTED);
  });

  it('every handler passes req.user into resolveScreen (the three call sites)', () => {
    const src = require('fs').readFileSync(require.resolve('../emergency/screen-emergency.controller.ts'), 'utf8');
    expect(src.match(/this\.resolveScreen\(screenId, tenantId, req\.user\)/g)).toHaveLength(3);
    expect(src).not.toMatch(/this\.resolveScreen\(screenId, tenantId\)/);
  });
});

describe('BYPASS 3 — the tenant switch (POST /tenants/switch)', () => {
  function controller(service: any) {
    const tenant = { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, name: 'X', slug: 'x', parentId: null, vertical: 'K12', mfaEnforced: false })) };
    const user = { findUnique: jest.fn(async () => ({ id: 'super-1', email: 'g@venueos', role: AppRole.SUPER_ADMIN, canTriggerPanic: true, mfaRequired: false, mfaTotpVerifiedAt: new Date(), _count: { passkeys: 1 } })) };
    const auditLog = { create: jest.fn().mockResolvedValue({}) };
    const prisma: any = { client: { tenant, user, auditLog } };
    const jwt: any = { sign: jest.fn().mockReturnValue('tok'), decode: jest.fn().mockReturnValue({ iat: 1 }) };
    const c = new TenantsController(prisma, jwt, { markUserTokensInvalid: jest.fn() } as any, service);
    return { c, auditLog };
  }
  const req = (user: any = SUPER) => ({ user, headers: { authorization: 'Bearer t' } });

  it('a SUPER_ADMIN cannot switch into a customer org without a grant (403, no token, no audit row)', async () => {
    const { c, auditLog } = controller(stubService());
    expect(await refusal(c.switchTenant(req() as any, { tenantId: CUSTOMER }))).toEqual({ status: 403, code: 'SUPPORT_ACCESS_REQUIRED' });
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it('under a grant the switch succeeds and the TENANT_SWITCH audit row names the grant', async () => {
    const { c, auditLog } = controller(stubService());
    const res: any = await c.switchTenant(req() as any, { tenantId: GRANTED });
    expect(res.success).toBe(true);
    const row = auditLog.create.mock.calls[0][0].data;
    expect(row.action).toBe('TENANT_SWITCH');
    expect(row.supportGrantId).toBe('grant-1');
    expect(JSON.parse(row.details)).toMatchObject({ supportAccess: 'grant', supportGrantId: 'grant-1' });
  });

  it("the super admin's own home org always works, and a DISTRICT_ADMIN's own-tree switch is not gated", async () => {
    const { c } = controller(stubService());
    expect((await c.switchTenant(req() as any, { tenantId: 'tenant-home' }) as any).success).toBe(true);
    const admin = { id: 'a', userId: 'a', role: AppRole.DISTRICT_ADMIN, tenantId: CUSTOMER, tokenExp: SUPER.tokenExp };
    const { c: c2 } = controller(stubService());
    (c2 as any).prisma.client.user.findUnique = jest.fn(async () => ({ id: 'a', email: 'a@x', role: AppRole.DISTRICT_ADMIN, canTriggerPanic: false, mfaRequired: false, mfaTotpVerifiedAt: new Date(), _count: { passkeys: 1 } }));
    expect((await c2.switchTenant(req(admin) as any, { tenantId: CUSTOMER }) as any).success).toBe(true);
  });

  it('with no service injected, the request FRAME is the fallback (the global interceptor always opens one)', async () => {
    const { c } = controller(undefined);
    expect(await refusal(framed(() => c.switchTenant(req() as any, { tenantId: CUSTOMER })))).toEqual({ status: 403, code: 'SUPPORT_ACCESS_REQUIRED' });
  });

  it('GET /tenants/accessible tells the switcher which organisations are reachable right now', async () => {
    const service = stubService();
    service.reachableBasisBulk = jest.fn(async () => new Map([[GRANTED, 'grant'], [CUSTOMER, null], ['tenant-home', 'home']]));
    const prisma: any = { client: { tenant: { findMany: jest.fn(async () => [{ id: GRANTED, name: 'G', slug: 'g', parentId: null, isInternal: false }, { id: CUSTOMER, name: 'C', slug: 'c', parentId: null, isInternal: false }, { id: 'tenant-home', name: 'H', slug: 'h', parentId: null, isInternal: true }]) } } };
    const c = new TenantsController(prisma, {} as any, {} as any, service);
    const out: any = await c.listAccessible({ user: SUPER } as any);
    expect(out.tenants.map((t: any) => [t.id, t.supportAccess])).toEqual([[GRANTED, 'grant'], [CUSTOMER, null], ['tenant-home', 'home']]);
  });
});

describe('BYPASS 4 — managing a customer\'s people (users.controller + manageable-target)', () => {
  it('flipping canTriggerPanic on a customer user is refused without a grant', async () => {
    const prisma: any = { client: { user: { findUnique: jest.fn(async () => ({ id: 'u1', email: 'u@c', role: 'SCHOOL_ADMIN', tenantId: CUSTOMER, canTriggerPanic: false })), update: jest.fn() } } };
    const c = new UsersController(prisma, {} as any, {} as any, {} as any);
    const r = await refusal(framed(() => c.setCanTriggerPanic({ user: SUPER } as any, 'u1', { canTriggerPanic: true })));
    expect(r.code).toBe('SUPPORT_ACCESS_REQUIRED');
    expect(prisma.client.user.update).not.toHaveBeenCalled();
  });

  it('loadManageableTarget (role change, email change, setup links, lifecycle) is refused without a grant and passes under one', async () => {
    const client: any = { user: { findFirst: jest.fn(async () => ({ id: 'u1', email: 'u@c', role: 'SCHOOL_ADMIN', tenantId: CUSTOMER, status: 'ACTIVE' })) } };
    expect((await refusal(framed(() => loadManageableTarget(client, { user: SUPER }, 'u1')))).code).toBe('SUPPORT_ACCESS_REQUIRED');
    client.user.findFirst = jest.fn(async () => ({ id: 'u1', email: 'u@g', role: 'SCHOOL_ADMIN', tenantId: GRANTED, status: 'ACTIVE' }));
    expect((await framed(() => loadManageableTarget(client, { user: SUPER }, 'u1'))).tenantId).toBe(GRANTED);
  });
});

describe('BYPASS 5 — the audit of what was closed, by source (so a revert cannot be silent)', () => {
  const read = (p: string) => require('fs').readFileSync(require.resolve(p), 'utf8');
  it.each([
    ['../emergency/emergency.controller.ts', 3],
    ['../emergency/screen-emergency.controller.ts', 1],
    ['../screens/screens.controller.ts', 2],
    ['../screens/gpio.controller.ts', 1],
    ['../display/display.controller.ts', 1],
    ['../users/users.controller.ts', 2],
    ['../users/manageable-target.ts', 1],
    ['../sso/sso.controller.ts', 1],
    ['../onboarding/onboarding.service.ts', 2],
    ['../tenants/tenants.controller.ts', 3],
  ])('%s calls the support-reach helper %i time(s)', (file, n) => {
    const src = read(file);
    expect((src.match(/(assertSupportReach|hasSupportReach)\(/g) ?? []).length).toBe(n);
  });

  it('template and asset reads by id no longer leave the tenant scope OPEN for a SUPER_ADMIN', () => {
    expect(read('../templates/templates.controller.ts')).not.toMatch(/SUPER_ADMIN\) \{\s*\/\/[^\n]*\n\s*scopeTenantId = null/);
    expect(read('../assets/assets.controller.ts')).not.toMatch(/SUPER_ADMIN\) \{\s*scopeTenantId = null/);
  });
});

describe('WIRING — the gate is global, always on, and the console routes are SUPER_ADMIN only', () => {
  it('SupportAccessModule is @Global and registers SupportAccessInterceptor as APP_INTERCEPTOR', () => {
    expect(Reflect.getMetadata('__module:global__', SupportAccessModule)).toBe(true);
    const providers: any[] = Reflect.getMetadata('providers', SupportAccessModule);
    expect(providers.some((p) => p?.provide === APP_INTERCEPTOR && p.useClass === SupportAccessInterceptor)).toBe(true);
    expect(providers).toContain(SupportAccessService);
    expect(Reflect.getMetadata('controllers', SupportAccessModule)).toEqual([SupportAccessController, SuperSupportAccessController]);
  });

  it('AppModule imports SupportAccessModule', () => {
    const src = require('fs').readFileSync(require.resolve('../app.module.ts'), 'utf8');
    expect(src).toMatch(/^\s*SupportAccessModule,\s*$/m);
  });

  it('the VenueOS-side routes are JwtAuthGuard + RbacGuard + SUPER_ADMIN at the class, no per-route widening', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SuperSupportAccessController)).toEqual([JwtAuthGuard, RbacGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, SuperSupportAccessController)).toEqual([AppRole.SUPER_ADMIN]);
    for (const name of ['state', 'request', 'revoke', 'breakGlass']) {
      expect(Reflect.getMetadata(ROLES_KEY, (SuperSupportAccessController.prototype as any)[name])).toBeUndefined();
    }
    const guard = new RbacGuard(new Reflector());
    const ctx = (role: string): any => ({
      getHandler: () => SuperSupportAccessController.prototype.request,
      getClass: () => SuperSupportAccessController,
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u', role, tenantId: 't' }, params: {}, query: {}, body: {} }) }),
    });
    expect(() => guard.canActivate(ctx(AppRole.DISTRICT_ADMIN))).toThrow(ForbiddenException);
    expect(guard.canActivate(ctx(AppRole.SUPER_ADMIN))).toBe(true);
  });

  it('the customer-side deciding routes refuse a SUPER_ADMIN and anyone outside the organisation\'s admins', async () => {
    const access: any = {
      rootOf: jest.fn(async (t: string) => t),
      isOrgAdmin: jest.fn(async (u: any) => u.role === AppRole.DISTRICT_ADMIN),
      invite: jest.fn(async () => 'invited'),
      decide: jest.fn(async () => 'decided'),
      revoke: jest.fn(async () => 'revoked'),
      listForOrg: jest.fn(async () => ({ active: null, pending: [], history: [], locations: [] })),
    };
    const c = new SupportAccessController(access);
    const GRANT = '00000000-0000-4000-8000-000000000001';
    expect((await refusal(c.invite({}, { user: { ...SUPER, tenantId: CUSTOMER } } as any))).code).toBe('SUPPORT_ACCESS_NOT_ORG_ADMIN');
    expect((await refusal(c.approve(GRANT, {}, { user: { id: 'v', role: AppRole.RESTRICTED_VIEWER, tenantId: CUSTOMER } } as any))).code).toBe('SUPPORT_ACCESS_NOT_ORG_ADMIN');
    expect(await c.approve(GRANT, { durationMinutes: 60 }, { user: { id: 'o', role: AppRole.DISTRICT_ADMIN, tenantId: CUSTOMER } } as any)).toBe('decided');
    expect(access.decide).toHaveBeenCalledWith(GRANT, CUSTOMER, expect.objectContaining({ id: 'o' }), true, { durationMinutes: 60 });
    expect(await c.revoke(GRANT, {}, { user: { id: 'o', role: AppRole.DISTRICT_ADMIN, tenantId: CUSTOMER } } as any)).toBe('revoked');
    // reads: everyone in the org, with canDecide telling the UI who may act
    const viewerState: any = await c.state({ user: { id: 'v', role: AppRole.RESTRICTED_VIEWER, tenantId: CUSTOMER } } as any);
    expect(viewerState.canDecide).toBe(false);
    expect(Reflect.getMetadata(GUARDS_METADATA, SupportAccessController)).toEqual([JwtAuthGuard, RbacGuard]);
  });
});
