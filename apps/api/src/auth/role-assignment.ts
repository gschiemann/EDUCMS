/**
 * Role-assignment policy — the single source of truth for "which roles
 * a caller of role X may grant to another user."
 *
 * A caller may only assign roles strictly BELOW their own rank. This is
 * the guard against privilege escalation through every user-management
 * path: the /users role-change endpoints AND the onboarding invite /
 * direct-create flows. Keeping the table in one module means those
 * paths cannot drift apart — drift is exactly what a security audit
 * found in the onboarding service, which validated the requested role
 * only against a flat allowlist (so a SCHOOL_ADMIN could mint a
 * DISTRICT_ADMIN).
 *
 * auth-002 / BUG-005.
 */
import { ForbiddenException } from '@nestjs/common';
import { AppRole } from '@cms/database';

export const ASSIGNABLE_ROLES_BY_CALLER: Record<string, string[]> = {
  [AppRole.SUPER_ADMIN]: [
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  ],
  [AppRole.DISTRICT_ADMIN]: [
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  ],
  [AppRole.SCHOOL_ADMIN]: [
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  ],
};

/** Throws ForbiddenException if `callerRole` may not assign `targetRole`. */
export function assertCallerCanAssignRole(callerRole: string, targetRole: string): void {
  const allowed = ASSIGNABLE_ROLES_BY_CALLER[callerRole] || [];
  if (!allowed.includes(targetRole)) {
    throw new ForbiddenException(
      `Your role (${callerRole}) cannot assign role '${targetRole}'. Allowed: ${allowed.join(', ') || 'none'}`,
    );
  }
}
