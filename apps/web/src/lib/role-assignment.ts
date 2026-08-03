/**
 * Which roles a caller of role X may hand out — the CLIENT mirror of
 * `apps/api/src/auth/role-assignment.ts`.
 *
 * ── WHY A MIRROR AND NOT A FETCH ──────────────────────────────────────────
 * The server table is the enforcement; this one exists only so a picker never
 * OFFERS an option the server will refuse. ACC-01 (2026-08-01) added the rank
 * gate to the SSO `defaultRole` writer, which instantly made the SSO settings
 * page ship a guaranteed error: its dropdown listed `DISTRICT_ADMIN`, and a
 * DISTRICT_ADMIN — the role that page is gated to — can never assign it. The
 * operator's only feedback was a 403 after saving.
 *
 * ── THIS IS NOT A SECURITY BOUNDARY ───────────────────────────────────────
 * Filtering a `<select>` stops a mistake, not an attacker; anyone can POST
 * whatever they like. Every writer MUST still call the server-side gate
 * (`assertCallerCanAssignRole` / `assertTenantScopedRoleAssignable`). If the
 * two ever disagree the server wins, and the symptom is a missing option —
 * annoying, never unsafe.
 *
 * KEEP IN SYNC with the server file. It is short and changes roughly never;
 * a fetched catalog would add a request to every settings page load to
 * describe five constants.
 */

export const SUPER_ADMIN = 'SUPER_ADMIN';

/** HIGH → LOW. Mirrors ASSIGNABLE_ROLES_BY_CALLER on the API. */
const ASSIGNABLE_BY_CALLER: Record<string, readonly string[]> = {
  SUPER_ADMIN: ['DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'CONTRIBUTOR', 'RESTRICTED_VIEWER'],
  DISTRICT_ADMIN: ['SCHOOL_ADMIN', 'CONTRIBUTOR', 'RESTRICTED_VIEWER'],
  SCHOOL_ADMIN: ['CONTRIBUTOR', 'RESTRICTED_VIEWER'],
};

/**
 * Roles a TENANT-SCOPED surface may ever offer (SSO defaultRole, API-key
 * mint, invites). `SUPER_ADMIN` is deliberately absent: it is a
 * platform-owner role and must never be reachable from anything a tenant
 * admin drives. Mirrors `TENANT_ASSIGNABLE_ROLES`.
 */
export const TENANT_ASSIGNABLE_ROLES: readonly string[] = [
  'DISTRICT_ADMIN',
  'SCHOOL_ADMIN',
  'CONTRIBUTOR',
  'RESTRICTED_VIEWER',
];

/** Roles `callerRole` may assign. Unknown/absent caller → none (fail closed). */
export function assignableRoles(callerRole: string | null | undefined): readonly string[] {
  if (!callerRole) return [];
  return ASSIGNABLE_BY_CALLER[callerRole] ?? [];
}

/** Can `callerRole` assign `targetRole`? */
export function canAssignRole(
  callerRole: string | null | undefined,
  targetRole: string,
): boolean {
  return assignableRoles(callerRole).includes(targetRole);
}

/**
 * Options for a tenant-scoped role picker: what the caller may assign,
 * intersected with what a tenant surface may ever offer.
 *
 * @param currentValue keep an already-stored value in the list even when the
 *   caller could not set it themselves, so an existing config still renders
 *   its own value instead of silently showing someone else's choice.
 */
export function tenantRoleOptions(
  callerRole: string | null | undefined,
  currentValue?: string | null,
): string[] {
  const allowed = assignableRoles(callerRole).filter((r) =>
    TENANT_ASSIGNABLE_ROLES.includes(r),
  );
  if (currentValue && !allowed.includes(currentValue)) return [currentValue, ...allowed];
  return [...allowed];
}
