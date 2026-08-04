import { AppRole } from '@cms/database';

/**
 * Roles allowed to see a screen's `deviceFingerprint` / `pairingCode`.
 *
 * These are the two values that let a caller ACT AS, or CLAIM, a screen:
 *   - the fingerprint is the key to `POST /screens/register` and to the
 *     anonymous OTA write plane (`/player/update-check`,
 *     `/screens/status/:fp/ota-state`), and
 *   - the pairing code claims the screen outright.
 *
 * Every fleet-listing route is reachable by CONTRIBUTOR, and RESTRICTED_VIEWER
 * reaches those same routes through the RBAC GET pass-through
 * (`viewerMayRead` in rbac.guard.ts). So without an explicit strip, the two
 * LOWEST-privilege roles in the product receive screen credentials.
 *
 * WHY THIS LIVES IN ITS OWN MODULE (2026-08-04, AUTHZ-01): it used to be a
 * private const inside screens.controller.ts. The DT-04 strip was applied
 * there and NOWHERE ELSE, so `GET /screen-groups` — which embeds the same
 * screen rows via `include: { screens: { select: { …deviceFingerprint… } } }`
 * — kept leaking the fingerprint to exactly the roles DT-04 set out to
 * protect against. One route was fixed; its sibling was missed because the
 * rule was not shared.
 *
 * Any NEW route that returns Screen rows must apply `stripScreenSecrets`
 * below. Do not re-declare this set locally.
 */
export const ADMIN_ROLES_FOR_SCREEN_SECRETS: ReadonlySet<unknown> = new Set([
  AppRole.SUPER_ADMIN,
  AppRole.DISTRICT_ADMIN,
  AppRole.SCHOOL_ADMIN,
]);

/**
 * Remove screen credentials from a row unless the caller's role is allowed to
 * see them. Mutates and returns the row it is given (the callers here are all
 * mapping over freshly-built objects, never Prisma entities that get reused).
 *
 * Deliberately keyed on the ROLE rather than the route, so a future listing
 * route gets the right behaviour by calling this rather than by remembering a
 * policy.
 */
export function stripScreenSecrets<T extends Record<string, any>>(row: T, role: unknown): T {
  if (ADMIN_ROLES_FOR_SCREEN_SECRETS.has(role)) return row;
  delete (row as any).deviceFingerprint;
  delete (row as any).pairingCode;
  return row;
}
