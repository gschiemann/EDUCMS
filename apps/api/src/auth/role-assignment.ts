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

/**
 * Roles a TENANT-SCOPED surface may EVER grant, regardless of who is asking.
 *
 * SUPER_ADMIN is deliberately absent: it is a PLATFORM-OWNER role and must
 * never be reachable from anything a tenant admin can drive — SSO
 * `defaultRole`, API-key mint, invites, direct-create. `ApiKeysService.
 * ALLOWED_ROLES` already encoded exactly this rule for API keys; ACC-01
 * (2026-08-01) found the SSO module had no equivalent floor at all, so an
 * unauthenticated self-signup → DISTRICT_ADMIN could store
 * `defaultRole:'SUPER_ADMIN'` on their own tenant's SSO config and then mint
 * a platform-owner JWT by logging in through their own IdP. This list is now
 * the single source of truth for that floor.
 *
 * NOTE this is a CEILING, not a grant: callers must ALSO pass
 * `assertCallerCanAssignRole` (strictly-below-my-own-rank). The two checks are
 * independent on purpose — the rank table alone already excludes SUPER_ADMIN,
 * but a future edit to that table must not be able to silently re-open a
 * tenant-scoped path to the platform-owner role.
 */
export const TENANT_ASSIGNABLE_ROLES: readonly string[] = [
  AppRole.DISTRICT_ADMIN,
  AppRole.SCHOOL_ADMIN,
  AppRole.CONTRIBUTOR,
  AppRole.RESTRICTED_VIEWER,
];

/**
 * Privilege rank, HIGH → LOW. Lower index = more privileged.
 *
 * Used to detect a role DOWNGRADE, which is the trigger for revoking the
 * target's live tokens: `role` and `canTriggerPanic` are baked into the JWT
 * claim and read straight off the token by `RbacGuard`, so without a
 * revocation a demoted user keeps the elevated capability until the token
 * expires — up to 30 days with rememberMe.
 *
 * An unknown role sorts to the bottom (least privileged), so a move INTO a
 * known role from "unknown" is a widening (no revoke) and a move TO "unknown"
 * is a downgrade (revoke) — fail-safe in both directions.
 *
 * NOTE (2026-09-02, CLV-02): `users.controller.ts` still carries a private,
 * byte-identical copy of this table + predicate from the 2026-05-28 P1-1 fix.
 * It should be switched to import from here so the two cannot drift; that file
 * was outside this change's ownership. Any THIRD copy is a bug.
 */
export const ROLE_RANK: Readonly<Record<string, number>> = {
  [AppRole.SUPER_ADMIN]: 0,
  [AppRole.DISTRICT_ADMIN]: 1,
  [AppRole.SCHOOL_ADMIN]: 2,
  [AppRole.CONTRIBUTOR]: 3,
  [AppRole.RESTRICTED_VIEWER]: 4,
};

/** True when moving from `fromRole` to `toRole` strictly REDUCES privilege. */
export function isRoleDowngrade(fromRole: string, toRole: string): boolean {
  const from = ROLE_RANK[fromRole] ?? Number.MAX_SAFE_INTEGER;
  const to = ROLE_RANK[toRole] ?? Number.MAX_SAFE_INTEGER;
  return to > from;
}

/** Throws ForbiddenException if `callerRole` may not assign `targetRole`. */
export function assertCallerCanAssignRole(callerRole: string, targetRole: string): void {
  const allowed = ASSIGNABLE_ROLES_BY_CALLER[callerRole] || [];
  if (!allowed.includes(targetRole)) {
    throw new ForbiddenException(
      `Your role (${callerRole}) cannot assign role '${targetRole}'. Allowed: ${allowed.join(', ') || 'none'}`,
    );
  }
}

/**
 * The full role-assignment gate for a TENANT-SCOPED surface (ACC-01).
 *
 * Two independent checks, both must pass:
 *   1. the target role is in `TENANT_ASSIGNABLE_ROLES` (never SUPER_ADMIN);
 *   2. the caller outranks it (`assertCallerCanAssignRole`).
 *
 * An absent/unknown `callerRole` FAILS CLOSED — a surface that cannot name
 * its actor has no business handing out a standing role grant.
 *
 * @param surface human-readable name of the field being set, used in the
 *   error the operator sees (e.g. "SSO defaultRole").
 */
export function assertTenantScopedRoleAssignable(
  callerRole: string | null | undefined,
  targetRole: string,
  surface: string,
): void {
  if (!callerRole) {
    throw new ForbiddenException(
      `Cannot set ${surface} without an identified caller role.`,
    );
  }
  if (!TENANT_ASSIGNABLE_ROLES.includes(targetRole)) {
    throw new ForbiddenException(
      `${surface} cannot be '${targetRole}'. Allowed: ${TENANT_ASSIGNABLE_ROLES.join(', ')}.`,
    );
  }
  assertCallerCanAssignRole(callerRole, targetRole);
}
