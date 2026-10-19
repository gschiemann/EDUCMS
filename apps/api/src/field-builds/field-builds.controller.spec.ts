import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { isCsrfExempt } from '../security/csrf.middleware';
import { isSupportAccessExemptPath } from '../support-access/support-access.policy';
import { FieldBuildsController } from './field-builds.controller';

/**
 * ROLE CHECKS for /super/field-builds, enforced on the SERVER: every route is
 * behind JwtAuthGuard + RbacGuard with SUPER_ADMIN only, and the real RbacGuard
 * answers 403 to every other role — a DISTRICT_ADMIN included.
 */
const ROUTES = ['candidates', 'windows', 'screens', 'arm', 'cancel', 'push'] as const;

function rbacFor(handler: (...a: any[]) => any, role: string, method = 'GET') {
  const guard = new RbacGuard(new Reflector());
  const ctx: any = {
    getHandler: () => handler,
    getClass: () => FieldBuildsController,
    switchToHttp: () => ({
      getRequest: () => ({ method, user: { id: 'u', role, tenantId: 't' }, params: {}, query: {}, body: {} }),
    }),
  };
  return () => guard.canActivate(ctx);
}

describe('FieldBuildsController — SUPER_ADMIN only', () => {
  it('lives under /api/v1/super/field-builds with JwtAuthGuard + RbacGuard and SUPER_ADMIN at the class', () => {
    expect(Reflect.getMetadata(PATH_METADATA, FieldBuildsController)).toBe('api/v1/super/field-builds');
    expect(Reflect.getMetadata(GUARDS_METADATA, FieldBuildsController)).toEqual([JwtAuthGuard, RbacGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, FieldBuildsController)).toEqual([AppRole.SUPER_ADMIN]);
  });

  it.each(ROUTES)('%s: no method-level role override widens access', (name) => {
    const handler = (FieldBuildsController.prototype as any)[name];
    expect(typeof handler).toBe('function');
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
  });

  it.each([AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR, AppRole.RESTRICTED_VIEWER])(
    'the real RbacGuard refuses %s on every route (403), reads and writes alike',
    (role) => {
      for (const name of ROUTES) {
        const handler = (FieldBuildsController.prototype as any)[name];
        for (const method of ['GET', 'POST']) {
          let thrown: unknown;
          try {
            rbacFor(handler, role, method)();
          } catch (e) {
            thrown = e;
          }
          expect(thrown).toBeInstanceOf(ForbiddenException);
          expect((thrown as ForbiddenException).getStatus()).toBe(403);
        }
      }
    },
  );

  it('the real RbacGuard admits SUPER_ADMIN', () => {
    for (const name of ROUTES) {
      expect(rbacFor((FieldBuildsController.prototype as any)[name], AppRole.SUPER_ADMIN, 'POST')()).toBe(true);
    }
  });

  it('passes the authenticated principal — never a body field — as the actor', async () => {
    const svc = {
      arm: jest.fn(async () => ({})),
      cancel: jest.fn(async () => ({})),
      push: jest.fn(async () => ({})),
      listScreens: jest.fn(async () => ({})),
    };
    const c = new FieldBuildsController(svc as any);
    const req = { user: { id: 'super-1', userId: 'super-1', role: 'SUPER_ADMIN', email: 'owner@example.test' } };
    const body = { candidate: '1.1.42-field.1', userId: 'someone-else', actor: 'evil' };
    await c.arm(body, req);
    await c.cancel('w-1', { reason: 'x' }, req);
    await c.push('w-1', { screenIds: [] }, req);
    await c.screens('a,b', req);
    expect(svc.arm).toHaveBeenCalledWith(req.user, body);
    expect(svc.cancel).toHaveBeenCalledWith(req.user, 'w-1', { reason: 'x' });
    expect(svc.push).toHaveBeenCalledWith(req.user, 'w-1', { screenIds: [] });
    expect(svc.listScreens).toHaveBeenCalledWith(req.user, 'a,b');
  });

  it('writes are CSRF-protected; the routes sit with the platform pages the workspace gate exempts', () => {
    for (const path of [
      '/api/v1/super/field-builds/windows',
      '/api/v1/super/field-builds/windows/00000000-0000-4000-8000-000000000000/cancel',
      '/api/v1/super/field-builds/windows/00000000-0000-4000-8000-000000000000/push',
    ]) {
      expect(isCsrfExempt('POST', path)).toBe(false);
      // Exempt from the ACTIVE-workspace check only; arm and push still assert
      // reach to every organisation they touch (field-builds.service.spec.ts).
      expect(isSupportAccessExemptPath(path)).toBe(true);
    }
  });
});
