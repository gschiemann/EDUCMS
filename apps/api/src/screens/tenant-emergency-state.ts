/**
 * tenant-emergency-state.ts — THE read of a tenant's TENANT-WIDE emergency
 * state (2026-11-01).
 *
 * Two callers, one answer:
 *   1. the manifest's emergency branch (`ScreensController.getManifest`) —
 *      the sole arbiter of what a screen shows, and the only thing that
 *      RELEASES an alert; and
 *   2. the emergency-rev raise confirmation (`emergency-rev.ts`) — the rev
 *      poll may sign a raise descriptor only when the database, read exactly
 *      this way, confirms the alert the descriptor describes.
 *
 * WHY ONE READ. If the two read differently (another select, another cache,
 * no district inheritance), the rev poll could sign a raise that the next
 * manifest fetch releases — a visible flip on the glass — or, worse, sign
 * something the manifest would never assert. So both go through the same row
 * (`MANIFEST_TENANT_EMERGENCY_SELECT`), the same 2 s in-process cache and its
 * invalidation-epoch guard (manifest-hot-cache.ts), the same district
 * inheritance walk, and the same "is an alert up" predicate.
 *
 * Everything below except `tenantWideAlertFacts` / `confirmTenantWideAlert`
 * was MOVED from screens.controller.ts unchanged in behaviour (the inline
 * `emergencyStatus && emergencyStatus !== 'INACTIVE'` checks became the
 * `tenantEmergencyActive` predicate, which is the same expression).
 *
 * Framework-free on purpose (no Nest, no Prisma import): the Prisma tenant
 * delegate arrives as a one-method port, so a spec can drive it with a Map.
 */

import { getTenantState, setTenantState, tenantStateEpoch } from './manifest-hot-cache';
import { MAX_TENANT_TREE_DEPTH } from '../emergency/tenant-hierarchy';
import { tenantAlertPlaysDrillContent } from '../emergency/emergency-drill';
import type { ConfirmedTenantAlert } from './emergency-rev';

/**
 * The exact Tenant columns the manifest's emergency branch reads. Every read
 * of the 2 s `getTenantState` cache goes through this one select — the
 * screen's own tenant, each ancestor of the inheritance walk, and the
 * emergency-rev confirmation — so a cache entry written by one path and read
 * by another can never be missing a field the reader depends on.
 *
 * `parentId` is what makes district inheritance possible; `id` is carried
 * so a resolved ancestor can be named in the manifest for diagnostics.
 */
export const MANIFEST_TENANT_EMERGENCY_SELECT = {
  id: true,
  parentId: true,
  // `archivedAt` keeps inheritance consistent with the fan-out, which
  // excludes archived (soft-deleted) locations. Without it a district
  // lockdown would light up every archived test tenant's leftover screens
  // — 120 of them exist in production — while the audit trail and the
  // pub/sub fan-out say those tenants were never involved.
  archivedAt: true,
  emergencyStatus: true,
  emergencyType: true,
  emergencyPlaylistId: true,
  emergencyPortraitPlaylistId: true,
  // 2026-10-10 — is the active tenant-wide alert a DRILL? Rides the
  // manifest as `isDrill` (inside the hashed payload) so the player paints
  // the drill banner; inherited from an ancestor like the rest.
  emergencyIsDrill: true,
  locationBasedEmergencyEnabled: true,
  // 2026-10-10 — the tenant's drill playlists, so the manifest can tell
  // whether a drill's `emergencyPlaylistId` came from the drill columns
  // (`tenantAlertPlaysDrillContent`): then it beats a screen's live
  // per-type content; otherwise the screen's live content comes first.
  drillLockdownPlaylistId: true,
  drillEvacuatePlaylistId: true,
  drillWeatherPlaylistId: true,
  drillHoldPlaylistId: true,
  drillSecurePlaylistId: true,
  drillMedicalPlaylistId: true,
  drillLockdownPortraitPlaylistId: true,
  drillEvacuatePortraitPlaylistId: true,
  drillWeatherPortraitPlaylistId: true,
  drillHoldPortraitPlaylistId: true,
  drillSecurePortraitPlaylistId: true,
  drillMedicalPortraitPlaylistId: true,
} as const;

/** The one Prisma method this module needs: `prisma.client.tenant.findUnique`. */
export interface TenantEmergencyRowReader {
  findUnique(args: { where: { id: string }; select: any }): Promise<any>;
}

/**
 * Is a tenant-wide alert up on this row? THE predicate — the manifest's
 * `emergencyActiveForThisScreen`, the inheritance walk and the rev
 * confirmation all ask it, so they cannot disagree about "active".
 */
export function tenantEmergencyActive(tenant: any): boolean {
  return !!(tenant?.emergencyStatus && tenant.emergencyStatus !== 'INACTIVE');
}

/**
 * One tenant's emergency row, through the 2 s manifest cache. On a miss the
 * row is read with `MANIFEST_TENANT_EMERGENCY_SELECT` and cached — unless a
 * trigger / all-clear invalidated the tenant while the read was in flight:
 * the epoch is captured BEFORE the read, and a read that began before the
 * latest invalidation may carry pre-commit state, so `setTenantState` refuses
 * it (2026-10-26). Throws when the database read throws.
 */
export async function readTenantEmergencyRow(
  tenants: TenantEmergencyRowReader,
  tenantId: string,
): Promise<any | null> {
  let row = getTenantState(tenantId) as any;
  if (!row) {
    const readEpoch = tenantStateEpoch(tenantId);
    row = (await tenants.findUnique({
      where: { id: tenantId },
      select: MANIFEST_TENANT_EMERGENCY_SELECT as any,
    })) as any;
    if (row) setTenantState(tenantId, row, readEpoch);
  }
  return row ?? null;
}

/**
 * DISTRICT-WIDE EMERGENCY INHERITANCE — the manifest-side safety net
 * (2026-08-03).
 *
 * The authoritative mechanism for a district lockdown is the FAN-OUT in
 * `emergency.controller.ts`: a district trigger writes every descendant
 * tenant's own row, so a screen booting mid-lockdown reads its own tenant
 * and sees the alert with zero extra work. This walk exists for the cases
 * the fan-out provably cannot cover:
 *
 *   - a school tenant CREATED after the district trigger fired;
 *   - a school row reset out-of-band (Studio edit, seed script, a partial
 *     restore) while the district is still in emergency;
 *   - a SCHOOL_ADMIN clearing their own school during a DISTRICT-wide
 *     lockdown. That must NOT drop the district alert — one building's
 *     admin does not get to cancel a district-wide incident — and this
 *     walk is what re-asserts it on the very next poll.
 *
 * COST: only runs when the screen's own tenant is INACTIVE **and** has a
 * parent, and every hop goes through the same 2s `getTenantState` cache
 * that the screen's own tenant read uses. A 38-screen / 7-school district
 * polling every 5s adds at most one cached district read per 2s — far
 * below the fan-out savings, and nowhere near the manifest content
 * fan-out that caused the July-2026 Supabase overage.
 *
 * Depth-bounded and cycle-guarded: `Tenant.parentId` is an unconstrained
 * self-FK, and the life-safety path must never be what discovers a cycle.
 *
 * Returns the nearest ancestor tenant row that is in an active emergency,
 * or null.
 */
export async function resolveAncestorEmergencyState(
  tenants: TenantEmergencyRowReader,
  parentId: string | null | undefined,
): Promise<any | null> {
  let cursor: string | null = parentId ?? null;
  const seen = new Set<string>();

  for (let hop = 0; hop < MAX_TENANT_TREE_DEPTH && cursor; hop++) {
    if (seen.has(cursor)) break; // cycle guard
    seen.add(cursor);

    const ancestor = await readTenantEmergencyRow(tenants, cursor);
    if (!ancestor) return null;
    // Stop at an archived ancestor for the same reason the fan-out skips
    // archived tenants: a retired location is not part of the live
    // hierarchy, and inheriting THROUGH one would contradict the audit
    // trail, which records no involvement for it.
    if (ancestor.archivedAt) return null;

    if (tenantEmergencyActive(ancestor)) {
      return ancestor;
    }
    cursor = ancestor.parentId ?? null;
  }

  return null;
}

/**
 * The tenant row the manifest's emergency branch decides from: the tenant's
 * own row, with an ancestor's active alert merged into a LOCAL copy when its
 * own is INACTIVE (district inheritance — see `resolveAncestorEmergencyState`
 * for the full list of cases).
 *
 * The merged object is never written back through `setTenantState`: that
 * would poison this school's cache entry with its district's status.
 * An ARCHIVED (soft-deleted) location never inherits — the fan-out skips it,
 * so inheriting would put a district lockdown on the leftover screens of a
 * retired/test tenant that no audit row, no webhook and no pub/sub message
 * ever named.
 */
export async function resolveTenantEmergencyState(
  tenants: TenantEmergencyRowReader,
  tenantId: string,
): Promise<{ tenant: any | null; inheritedFromTenantId: string | null }> {
  let tenant = await readTenantEmergencyRow(tenants, tenantId);
  let inheritedFromTenantId: string | null = null;
  if (tenant && !tenant.archivedAt && !tenantEmergencyActive(tenant) && tenant.parentId) {
    const ancestor = await resolveAncestorEmergencyState(tenants, tenant.parentId);
    if (ancestor) {
      inheritedFromTenantId = ancestor.id ?? tenant.parentId;
      tenant = {
        ...tenant,
        emergencyStatus: ancestor.emergencyStatus,
        emergencyType: ancestor.emergencyType,
        emergencyPlaylistId: ancestor.emergencyPlaylistId,
        emergencyPortraitPlaylistId: ancestor.emergencyPortraitPlaylistId,
        emergencyIsDrill: ancestor.emergencyIsDrill === true,
        // 2026-10-10 — whether the inherited drill's playlist is the
        // ancestor's DRILL content, decided against the ANCESTOR's drill
        // columns (the pointer is theirs, so the comparison must be too).
        emergencyAlertPlaysDrillContent: tenantAlertPlaysDrillContent(ancestor),
        // NOT inherited: locationBasedEmergencyEnabled stays this
        // school's own opt-in, because the per-screen emergency config
        // it gates lives on THIS school's screens.
      };
    }
  }
  return { tenant, inheritedFromTenantId };
}

/**
 * The tenant-wide alert exactly as the manifest's emergency branch emits it
 * for a screen with NO per-screen override — its `effectiveType`,
 * `effectiveSeverity` and `isDrill` with `activeScreenOverride` null — or
 * null when no tenant-wide alert is up. `screens.emergency-rev-confirmation
 * .spec.ts` drives the real manifest and pins the two to each other.
 */
export function tenantWideAlertFacts(tenant: any): ConfirmedTenantAlert | null {
  if (!tenantEmergencyActive(tenant)) return null;
  return {
    type: String(tenant.emergencyType || tenant.emergencyStatus || 'EMERGENCY'),
    severity: String(tenant.emergencyStatus || 'HIGH'),
    isDrill: tenant.emergencyIsDrill === true,
  };
}

/**
 * The database's answer for the emergency-rev raise confirmation: THE
 * manifest read above, reduced to the facts a raise descriptor must match.
 * Throws when the database cannot be read — `emergency-rev.ts` bounds the
 * call and reads a throw as "unavailable" (no descriptor).
 */
export async function confirmTenantWideAlert(
  tenants: TenantEmergencyRowReader,
  tenantId: string,
): Promise<ConfirmedTenantAlert | null> {
  const { tenant } = await resolveTenantEmergencyState(tenants, tenantId);
  return tenantWideAlertFacts(tenant);
}
