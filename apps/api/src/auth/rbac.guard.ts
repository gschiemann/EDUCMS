import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppRole } from '@cms/database';
import { ROLES_KEY } from './roles.decorator';
import { ALLOW_PANIC_BYPASS_KEY } from './panic-bypass.decorator';

export interface RequestUser {
  id: string;
  email: string;
  role: AppRole;
  districtId?: string;
  schoolId?: string;
  canTriggerPanic?: boolean;
}

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles are defined, unrestricted. (Use authentication guard separately)
    if (!requiredRoles) {
      return true;
    }

    // Default the optional fields — Express doesn't populate req.body on
    // methods without a body (GET/HEAD), and a controller route without
    // URL params would leave req.params as an empty object. Without these
    // defaults, `body.districtId` throws
    // `Cannot read properties of undefined (reading 'districtId')` on
    // every GET with an RBAC decorator — every /assets/folders list 500'd.
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    const params = req.params || {};
    const query = req.query || {};
    const body = req.body || {};

    if (!user) {
      throw new ForbiddenException('No user identity found in request');
    }

    const typedUser = user as RequestUser;

    const allowPanicBypass = this.reflector.getAllAndOverride<boolean>(ALLOW_PANIC_BYPASS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // INTENT — DELEGATED PANIC CAPABILITY (audit fix #5):
    // @AllowPanicBypass on an emergency endpoint lets a user with
    // User.canTriggerPanic=true fire it WITHOUT meeting the @RequireRoles
    // requirement. This is intentional: schools deploy physical panic
    // buttons / wall stations to non-admin staff (receptionist, security
    // guard, nurse) who need the ability without admin privileges.
    //
    // The capability flag is set by an admin in the dashboard
    // (Settings → Team Members → toggle "Can trigger panic"). Audit log
    // captures every flip of canTriggerPanic AND every emergency trigger,
    // so privilege creep is detectable post-hoc.
    //
    // Hard guardrail: RESTRICTED_VIEWER is read-only by definition and
    // can NEVER trigger an emergency, even if their canTriggerPanic flag
    // is somehow set. Defense-in-depth against UI bugs or rogue admins.
    if (
      allowPanicBypass &&
      typedUser.canTriggerPanic &&
      typedUser.role !== AppRole.RESTRICTED_VIEWER
    ) {
      return true;
    }

    // 1. Check if user holds the explicitly required role (or SUPER_ADMIN overrides)
    const hasRole = requiredRoles.includes(typedUser.role) || typedUser.role === AppRole.SUPER_ADMIN;
    if (!hasRole) {
      throw new ForbiddenException(`Access denied. Requires one of: ${requiredRoles.join(', ')}`);
    }

    // Default Super Admin pass
    if (typedUser.role === AppRole.SUPER_ADMIN) {
      return true;
    }

    // 2. Validate Spatial/Tenancy Scope.
    // If the request targets a specific district or school, verify the user belongs to it.
    const targetDistrictId = params.districtId || query.districtId || body.districtId;
    const targetSchoolId = params.schoolId || query.schoolId || body.schoolId;

    if (typedUser.role === AppRole.DISTRICT_ADMIN) {
      if (targetDistrictId && targetDistrictId !== typedUser.districtId) {
        throw new ForbiddenException('Access denied. District Admin isolated to own district.');
      }
      // If target school is specified, ideally the school would be validated as belonging to this district,
      // but without DB access in the guard we assume it will be checked by the downstream service
      // as long as the user's districtId matches the school's districtId in the query.
    }

    if (
      typedUser.role === AppRole.SCHOOL_ADMIN ||
      typedUser.role === AppRole.CONTRIBUTOR ||
      typedUser.role === AppRole.RESTRICTED_VIEWER
    ) {
      if (targetSchoolId && targetSchoolId !== typedUser.schoolId) {
        throw new ForbiddenException('Access denied. User isolated to own school.');
      }
      // If they try to access district level things
      if (targetDistrictId) {
         throw new ForbiddenException('Access denied. Role cannot mutate district level entities.');
      }
    }

    return true;
  }
}
