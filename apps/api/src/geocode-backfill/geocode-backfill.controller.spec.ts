/**
 * Task #60 adversarial-review fix #6 — defense-in-depth authz test.
 *
 * This is a UNIT test, not a full e2e HTTP harness (no supertest / no real
 * Nest bootstrap with the global ThrottlerGuard + real JwtAuthGuard talking
 * to Redis). It verifies two things, matching what the prompt calls "the
 * acceptable alternative":
 *
 *   1. The controller class metadata actually carries
 *      `@UseGuards(JwtAuthGuard, RbacGuard)` + `@RequireRoles(SUPER_ADMIN)`
 *      — read directly via Reflector/Reflect, the same mechanism Nest's
 *      real guard pipeline uses at request time. This catches the failure
 *      mode where someone edits the controller and drops/typos a decorator.
 *   2. RbacGuard, exercised directly against a mock ExecutionContext built
 *      from THIS controller's real metadata, actually REJECTS a
 *      CONTRIBUTOR-role caller (403 ForbiddenException) and REJECTS a
 *      request with no user attached at all (which is the shape a request
 *      would have if JwtAuthGuard had not run / had rejected it — JwtAuthGuard
 *      itself is unit-tested independently in jwt-auth.guard.spec.ts-equivalent
 *      coverage and throws UnauthorizedException(401) for a missing/invalid
 *      token BEFORE RbacGuard ever runs, per the guard order
 *      `@UseGuards(JwtAuthGuard, RbacGuard)`).
 *
 * This does not spin up Redis/JWT/HTTP — it proves the WIRING is correct
 * (decorators present, guard order correct, RbacGuard actually enforces
 * SUPER_ADMIN-only against this controller's real metadata) without the
 * cost/flakiness of a full e2e harness.
 */
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppRole } from '@cms/database';
import { GeocodeBackfillController } from './geocode-backfill.controller';
import { RbacGuard } from '../auth/rbac.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';

describe('GeocodeBackfillController — authz wiring', () => {
  it('carries @UseGuards(JwtAuthGuard, RbacGuard) on the controller class', () => {
    const guards = Reflect.getMetadata('__guards__', GeocodeBackfillController) || [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RbacGuard);
  });

  it('carries @RequireRoles(AppRole.SUPER_ADMIN) metadata on the controller class', () => {
    const reflector = new Reflector();
    const roles = reflector.get<AppRole[]>(ROLES_KEY, GeocodeBackfillController);
    expect(roles).toEqual([AppRole.SUPER_ADMIN]);
  });

  describe('RbacGuard enforcement against this controller\'s real metadata', () => {
    let guard: RbacGuard;
    let reflector: Reflector;

    beforeEach(() => {
      reflector = new Reflector();
      guard = new RbacGuard(reflector);
    });

    /** Builds a mock ExecutionContext whose getClass()/getHandler() point at
     *  the REAL GeocodeBackfillController + its `run` method, so
     *  `reflector.getAllAndOverride(ROLES_KEY, ...)` resolves the actual
     *  `@RequireRoles(SUPER_ADMIN)` decorator rather than a stubbed value —
     *  this is what makes the test "against this controller" rather than a
     *  generic RbacGuard unit test (that generic coverage already exists in
     *  rbac.guard.spec.ts). */
    function contextFor(user: any): ExecutionContext {
      return {
        getHandler: () => GeocodeBackfillController.prototype.run,
        getClass: () => GeocodeBackfillController,
        switchToHttp: () => ({
          getRequest: () => ({ user, params: {}, query: {}, body: {}, method: 'POST' }),
        }),
      } as unknown as ExecutionContext;
    }

    it('CONTRIBUTOR role is rejected with ForbiddenException (403)', () => {
      const ctx = contextFor({ id: 'u1', role: AppRole.CONTRIBUTOR, tenantId: 't1', schoolId: 't1' });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('SCHOOL_ADMIN role is also rejected — this endpoint is SUPER_ADMIN-only, not just "some admin"', () => {
      const ctx = contextFor({ id: 'u1', role: AppRole.SCHOOL_ADMIN, tenantId: 't1', schoolId: 't1' });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('DISTRICT_ADMIN role is also rejected', () => {
      const ctx = contextFor({ id: 'u1', role: AppRole.DISTRICT_ADMIN, tenantId: 't1', districtId: 'd1' });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('no user attached (the shape a request has if auth never ran / was rejected) throws ForbiddenException', () => {
      // RbacGuard itself throws ForbiddenException for "no user identity" —
      // in the real request pipeline this case is normally intercepted
      // earlier by JwtAuthGuard (which throws UnauthorizedException/401 for
      // a missing/invalid token, per @UseGuards(JwtAuthGuard, RbacGuard)
      // guard ORDER — JwtAuthGuard runs first and would never let a
      // no-user request reach RbacGuard in production). This test pins
      // RbacGuard's own defense-in-depth behavior for that shape.
      const ctx = contextFor(undefined);
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('SUPER_ADMIN role is allowed through', () => {
      const ctx = contextFor({ id: 'u1', role: AppRole.SUPER_ADMIN, tenantId: 't1' });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('JwtAuthGuard — no-auth request is rejected with UnauthorizedException (401)', () => {
    it('a request with no Authorization header throws UnauthorizedException before RbacGuard ever runs', async () => {
      // JwtAuthGuard is guard #1 in @UseGuards(JwtAuthGuard, RbacGuard) — it
      // must reject a tokenless request with 401 UnauthorizedException
      // before RbacGuard (which would otherwise 403 it) is ever reached.
      // Minimal deps: JwtAuthGuard's constructor takes JwtService +
      // RedisService (+ optional ApiKeysService) but extractTokenFromHeader
      // throws before any of them are touched when there's no header at all.
      const guard = new JwtAuthGuard({} as any, {} as any, undefined);
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: {} }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });
  });
});
