import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppRole } from '@cms/database';
import { ROLES_KEY } from './roles.decorator';

export interface RequestUser {
  id: string;
  email: string;
  role: AppRole;
  districtId?: string;
  schoolId?: string;
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

    const { user, params, query, body } = context.switchToHttp().getRequest();

    if (!user) {
      throw new ForbiddenException('No user identity found in request');
    }

    const typedUser = user as RequestUser;

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
