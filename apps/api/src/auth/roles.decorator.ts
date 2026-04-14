import { SetMetadata } from '@nestjs/common';
import { AppRole } from '@cms/database';

export const ROLES_KEY = 'roles';

/**
 * Decorator to enforce that a route can only be accessed by users with one of the given roles.
 * Maps strictly to the RBAC_MATRIX.md permissions.
 * @param roles Target allowed roles.
 */
export const RequireRoles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
