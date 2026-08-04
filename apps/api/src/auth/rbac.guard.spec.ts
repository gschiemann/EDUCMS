import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacGuard, RequestUser } from './rbac.guard';
import { AppRole } from '@cms/database';
import { ROLES_KEY, NO_VIEWER_READ_KEY } from './roles.decorator';

describe('RbacGuard', () => {
  let guard: RbacGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RbacGuard(reflector);
  });

  const createMockContext = (user: Partial<RequestUser>, params = {}, query = {}, body = {}, method = 'GET') => {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          user,
          params,
          query,
          body,
          method,
        }),
      }),
    } as unknown as ExecutionContext;
  };


  /**
   * Key-AWARE reflector stub.
   *
   * 2026-08-04 — these tests used `mockReturnValue(roles)`, which answers EVERY
   * metadata lookup with the roles array. The real Reflector answers per key,
   * so the moment the guard read a second key (NO_VIEWER_READ_KEY, added for
   * AUTHZ-01) the stub handed it the truthy roles array and the viewer-read
   * tests broke — a harness artifact, not a behaviour change. Model the real
   * Reflector instead: answer by key, undefined for anything not set.
   */
  const mockMeta = (opts: { roles?: unknown; noViewerRead?: boolean; allowPanicBypass?: boolean }) =>
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: any) => {
      if (key === ROLES_KEY) return opts.roles as any;
      if (key === NO_VIEWER_READ_KEY) return opts.noViewerRead as any;
      return opts.allowPanicBypass as any;
    });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should return true when no roles are required', () => {
    mockMeta({ roles: undefined });
    expect(guard.canActivate(createMockContext({}))).toBe(true);
  });

  it('should throw ForbiddenException if user is not attached to request', () => {
    mockMeta({ roles: [AppRole.SCHOOL_ADMIN] });
    const ctx = createMockContext(undefined as any);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  describe('Role Boundaries', () => {
    it('SUPER_ADMIN bypasses role checks', () => {
      mockMeta({ roles: [AppRole.CONTRIBUTOR] });
      
      const ctx = createMockContext({ role: AppRole.SUPER_ADMIN });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('denies access if user lacks required role', () => {
      mockMeta({ roles: [AppRole.SCHOOL_ADMIN] });
      
      const ctx = createMockContext({ role: AppRole.CONTRIBUTOR });
      expect(() => guard.canActivate(ctx)).toThrow("don't have permission");
    });
  });

  describe('Tenancy/Spatial Isolation', () => {
    it('District Admin cannot access a district parameter outside their assigned district', () => {
      mockMeta({ roles: [AppRole.DISTRICT_ADMIN] });
      
      const ctx = createMockContext(
        { role: AppRole.DISTRICT_ADMIN, districtId: 'dist-1' },
        { districtId: 'dist-2' }
      );
      
      expect(() => guard.canActivate(ctx)).toThrow('District Admin isolated to own district');
    });

    it('School Admin cannot mutate district level entities', () => {
        mockMeta({ roles: [AppRole.SCHOOL_ADMIN] });
        
        const ctx = createMockContext(
          { role: AppRole.SCHOOL_ADMIN, schoolId: 'sch-1' },
          { districtId: 'dist-1' } // Trying to target district endpoint
        );
        
        expect(() => guard.canActivate(ctx)).toThrow('Access denied. Role cannot mutate district level entities.');
    });

    it('Teacher (Contributor) cannot access a separate schoolId', () => {
      mockMeta({ roles: [AppRole.CONTRIBUTOR] });
      
      const ctx = createMockContext(
        { role: AppRole.CONTRIBUTOR, schoolId: 'sch-1' },
        { schoolId: 'sch-99' }
      );
      
      expect(() => guard.canActivate(ctx)).toThrow('User isolated to own school');
    });

    it('Teacher (Contributor) succeeds when accessing their own school', () => {
      mockMeta({ roles: [AppRole.CONTRIBUTOR] });

      const ctx = createMockContext(
        { role: AppRole.CONTRIBUTOR, schoolId: 'sch-1' },
        { schoolId: 'sch-1' }
      );

      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  // 2026-06-09 RBAC/reviewer rework — RESTRICTED_VIEWER (the "Viewer" tier) is
  // read-only but must be able to SEE content (previously hard-403'd → empty
  // Assets/Templates/Playlists). The guard lets it READ (GET/HEAD) any endpoint
  // a CONTRIBUTOR may read, and nothing more.
  describe('Viewer read access (RESTRICTED_VIEWER)', () => {
    const contentRead = [
      AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR,
    ];

    it('can READ (GET) an endpoint a CONTRIBUTOR may read', () => {
      mockMeta({ roles: contentRead });
      const ctx = createMockContext({ role: AppRole.RESTRICTED_VIEWER, schoolId: 'sch-1' }, {}, {}, {}, 'GET');
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('is DENIED a mutation (POST) to the same endpoint', () => {
      mockMeta({ roles: contentRead });
      const ctx = createMockContext({ role: AppRole.RESTRICTED_VIEWER, schoolId: 'sch-1' }, {}, {}, {}, 'POST');
      expect(() => guard.canActivate(ctx)).toThrow("don't have permission");
    });

    it('is DENIED reading an ADMIN-only endpoint (CONTRIBUTOR not in required roles)', () => {
      mockMeta({ roles: [
        AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN,
      ] });
      const ctx = createMockContext({ role: AppRole.RESTRICTED_VIEWER, schoolId: 'sch-1' }, {}, {}, {}, 'GET');
      expect(() => guard.canActivate(ctx)).toThrow("don't have permission");
    });

    /**
     * AUTHZ-01 (2026-08-04) — the viewer read pass-through assumes a GET only
     * DISCLOSES data. Some GETs MINT A CREDENTIAL:
     * `GET /sports/games/:id/feed-credentials` returns a live HMAC token that
     * authorizes POSTs to the unauthenticated scoreboard ingest controller, so
     * reading it is a WRITE capability. @NoViewerRead() closes those.
     */
    it('is DENIED a credential-minting GET marked @NoViewerRead, even though CONTRIBUTOR can read it', () => {
      mockMeta({ roles: contentRead, noViewerRead: true });
      const ctx = createMockContext({ role: AppRole.RESTRICTED_VIEWER, schoolId: 'sch-1' }, {}, {}, {}, 'GET');
      expect(() => guard.canActivate(ctx)).toThrow("don't have permission");
    });

    it('CONTRIBUTOR keeps access to that same @NoViewerRead route', () => {
      // The marker closes the viewer pass-through only — it must not narrow
      // the roles actually listed in @RequireRoles.
      mockMeta({ roles: contentRead, noViewerRead: true });
      const ctx = createMockContext({ role: AppRole.CONTRIBUTOR, schoolId: 'sch-1' }, {}, {}, {}, 'GET');
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('read access is still tenancy-scoped to its own school', () => {
      mockMeta({ roles: contentRead });
      const ctx = createMockContext({ role: AppRole.RESTRICTED_VIEWER, schoolId: 'sch-1' }, { schoolId: 'sch-99' }, {}, {}, 'GET');
      expect(() => guard.canActivate(ctx)).toThrow('User isolated to own school');
    });
  });
});
