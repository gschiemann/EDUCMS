/**
 * Emergency enablement — is the emergency capability ON for a tenant?
 *
 * THE DEBT THIS CLOSES (handoff §19.5, 2026-09-01). The non-K–12 "is
 * emergency on?" gate lived in browser `localStorage` under
 * `emergencyEnabled:${tenantId}`, with a TODO for a real Tenant column. That
 * is not a source of truth for a life-safety capability: it is per-browser,
 * per-device and per-profile, so two admins in the same organization could
 * see opposite answers, a cleared cache silently turned the capability
 * "off", and the server never knew either way.
 *
 * The authority is now `Tenant.emergencyEnabled`, a NULLABLE boolean:
 *
 *   true   → explicitly on
 *   false  → explicitly off
 *   null   → never stated; use this vertical's default
 *
 * NULL is a real value, not "unset-and-broken". Every existing row is NULL,
 * so every existing tenant keeps exactly the behavior the localStorage gate
 * defaulted to (K12 on, everything else off) without a backfill.
 *
 * PURE — no React, no Prisma, no network. Shared by the API (authority) and
 * the web dashboard (presentation) so the two can never disagree.
 */
import { normalizeVertical, type Vertical } from './verticals';

/**
 * Verticals whose emergency capability is ALWAYS ON and cannot be turned
 * off from the dashboard (the K–12 always-on contract: lockdown drills are
 * life-safety-critical and a school must never be one mis-click from a
 * screen fleet that ignores a trigger).
 */
const ALWAYS_ON_VERTICALS: ReadonlySet<Vertical> = new Set<Vertical>(['K12']);

/** True when this vertical's emergency capability may never be turned off. */
export function emergencyEnablementLocked(rawVertical: unknown): boolean {
  return ALWAYS_ON_VERTICALS.has(normalizeVertical(rawVertical));
}

/**
 * The default for a tenant that has never stated a preference.
 * K–12: on. Every other vertical: off — most don't run lockdown drills, and
 * a capability nobody configured must not advertise itself as ready.
 */
export function defaultEmergencyEnabled(rawVertical: unknown): boolean {
  return emergencyEnablementLocked(rawVertical);
}

/**
 * Resolve the EFFECTIVE enablement from the vertical + the stored column.
 *
 * A locked vertical ignores a stored `false` outright: the API refuses to
 * write one, but a row that predates that guard (or a hand-edited one) must
 * still resolve to ON rather than silently disarming a school.
 */
export function effectiveEmergencyEnabled(
  rawVertical: unknown,
  stored: boolean | null | undefined,
): boolean {
  if (emergencyEnablementLocked(rawVertical)) return true;
  if (stored === true) return true;
  if (stored === false) return false;
  return defaultEmergencyEnabled(rawVertical);
}
