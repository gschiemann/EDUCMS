/**
 * Who is allowed to reach the emergency surfaces — ONE answer, shared.
 *
 * Mobile design package §10 (scratch/design/mobile-app/
 * MOBILE-UI-APP-DESIGN-PACKAGE.md), "Presentation rules":
 *
 *   > Emergency discovery follows `canTriggerPanic`, not administrator role.
 *
 * and §4.4, naming the user this exists for:
 *
 *   > **Delegated emergency staff** — May have `canTriggerPanic` without an
 *   > administrator role. Emergency access must follow the capability — not
 *   > the role label.
 *
 * THE BUG THIS CLOSES (2026-09-01). Three surfaces each answered the question
 * their own way and only ONE of them was right:
 *   - `/panic` gated on role OR `canTriggerPanic` — correct, and it is the
 *     page the API actually authorizes (`@AllowPanicBypass` on
 *     `POST /emergency/trigger` exists precisely so a non-admin holding the
 *     flag can fire).
 *   - `TopToolbar` gated on `<RoleGate allowedRoles={['admin']}>`.
 *   - `MobileDashboard` gated on `!isContributor && !isViewer`.
 * So a CONTRIBUTOR whose administrator had deliberately granted
 * `canTriggerPanic` — a front-desk attendant, a coach, a shift lead: the
 * delegated staffer the flag was built for — opened the app on their phone
 * and found NO route to Emergency anywhere in the navigation. The capability
 * was real, the API would have accepted the trigger, and the UI hid it.
 *
 * This module is the single answer. It mirrors the API's own authorization
 * (`@RequireRoles` + `@AllowPanicBypass`, apps/api/src/emergency/
 * emergency.controller.ts) so the UI can never offer a control the server
 * would refuse, nor hide one the server would honor.
 *
 * PURE — no React, no store, no network. Callers pass the user they hold.
 */

/**
 * Roles that carry emergency authority inherently, mirrored from the API's
 * `@RequireRoles` on `/emergency/trigger`.
 */
const PANIC_AUTHORITY_ROLES = new Set(['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']);

export interface PanicCapableUser {
  role?: string | null;
  /** Delegated authority — the opt-in flag an admin grants per user. */
  canTriggerPanic?: boolean | null;
}

/**
 * Can this user trigger an emergency? Role OR the delegated capability flag.
 *
 * Fails CLOSED: a null/absent user is not authorized. `canTriggerPanic` must
 * be exactly `true` — an absent flag on a session that predates the column is
 * "no evidence", never a grant.
 */
export function hasPanicAuthority(user: PanicCapableUser | null | undefined): boolean {
  if (!user) return false;
  if (PANIC_AUTHORITY_ROLES.has(user.role || '')) return true;
  return user.canTriggerPanic === true;
}

/**
 * Can this user send the all-clear?
 *
 * The design package (§10, §M20) treats all-clear as its OWN capability
 * ("All-clear | Explicit capability") rather than something that rides along
 * with the ability to trigger. TODAY the API applies the same authorization
 * to both endpoints, so this returns the same answer — but the call sites
 * read `canSendAllClear`, so when the server grows a separate grant the UI
 * changes in exactly one place instead of five.
 *
 * Deliberately NOT an alias export: an alias would let a future edit to the
 * trigger rule silently redefine who may end an incident.
 */
export function canSendAllClear(user: PanicCapableUser | null | undefined): boolean {
  return hasPanicAuthority(user);
}
