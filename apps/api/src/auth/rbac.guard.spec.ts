import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacGuard, RequestUser } from './rbac.guard';
import { AppRole } from '@cms/database';
import { ROLES_KEY } from './roles.decorator';

describe('RbacGuard', () => {
  let guard: RbacGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RbacGuard(reflector);
  });

  const createMockContext = (user: Partial<RequestUser>, params = {}, query = {}, body = {}) => {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          user,
          params,
          query,
          body,
        }),
      }),
    } as unknown as ExecutionContext;
  };

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should return true when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(createMockContext({}))).toBe(true);
  });

  it('should throw ForbiddenException if user is not attached to request', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AppRole.SCHOOL_ADMIN]);
    const ctx = createMockContext(undefined as any);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  describe('Role Boundaries', () => {
    it('SUPER_ADMIN bypasses role checks', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AppRole.CONTRIBUTOR]);
      
      const ctx = createMockContext({ role: AppRole.SUPER_ADMIN });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('denies access if user lacks required role', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AppRole.SCHOOL_ADMIN]);
      
      const ctx = createMockContext({ role: AppRole.CONTRIBUTOR });
      expect(() => guard.canActivate(ctx)).toThrow('Access denied');
    });
  });

  describe('Tenancy/Spatial Isolation', () => {
    it('District Admin cannot access a district parameter outside their assigned district', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AppRole.DISTRICT_ADMIN]);
      
      const ctx = createMockContext(
        { role: AppRole.DISTRICT_ADMIN, districtId: 'dist-1' },
        { districtId: 'dist-2' }
      );
      
      expect(() => guard.canActivate(ctx)).toThrow('District Admin isolated to own district');
    });

    it('School Admin cannot mutate district level entities', () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AppRole.SCHOOL_ADMIN]);
        
        const ctx = createMockContext(
          { role: AppRole.SCHOOL_ADMIN, schoolId: 'sch-1' },
          { districtId: 'dist-1' } // Trying to target district endpoint
        );
        
        expect(() => guard.canActivate(ctx)).toThrow('Access denied. Role cannot mutate district level entities.');
    });

    it('Teacher (Contributor) cannot access a separate schoolId', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AppRole.CONTRIBUTOR]);
      
      const ctx = createMockContext(
        { role: AppRole.CONTRIBUTOR, schoolId: 'sch-1' },
        { schoolId: 'sch-99' }
      );
      
      expect(() => guard.canActivate(ctx)).toThrow('User isolated to own school');
    });

    it('Teacher (Contributor) succeeds when accessing their own school', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AppRole.CONTRIBUTOR]);
      
      const ctx = createMockContext(
        { role: AppRole.CONTRIBUTOR, schoolId: 'sch-1' },
        { schoolId: 'sch-1' }
      );
      
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });
});
