/**
 * Tenant-hierarchy walks for DISTRICT-WIDE emergency propagation (2026-08-03).
 *
 * THE GAP THIS CLOSES
 * -------------------
 * `Tenant` is a self-referencing tree (`Tenant.parentId`, district → school).
 * Until this module existed, a DISTRICT_ADMIN firing a lockdown updated
 * exactly ONE `Tenant` row and published to exactly ONE pub/sub channel — so
 * a district-scoped lockdown reached the district office and NOTHING else.
 * Measured against live production on 2026-08-03: 41 paired screens sit under
 * CHILD tenants (Walnut Creek 7 schools / 38 screens, Springfield 1 / 3,
 * Chardon 2 / 0). Every one of them missed a district lockdown.
 *
 * WHY FAN-OUT (walk DOWN and write per tenant) RATHER THAN INHERITANCE
 * -------------------------------------------------------------------
 * Three things make the descendant walk the correct primary mechanism:
 *
 *   1. PER-SCHOOL CONTENT. Every tenant carries its OWN drilled panic
 *      playlists (`panicLockdownPlaylistId`, portrait variants, the Sprint-8b
 *      `locationBasedEmergencyEnabled` per-screen config). Writing each
 *      descendant's own row means each school plays the content IT rehearsed.
 *      Pure inheritance would either play the district's playlist on every
 *      screen in the district or need this same per-tenant resolution anyway.
 *
 *   2. THE REALTIME BUS ALREADY KEYS ON THE DEVICE'S OWN TENANT.
 *      `RealtimeGateway.broadcastToScope('tenant', id)` matches
 *      `ctx.tenantId === id`, where `ctx.tenantId` is the SCREEN's tenant.
 *      Publishing once per descendant reaches every screen with zero gateway
 *      changes; inheritance would require the gateway to know each connected
 *      device's ancestor chain.
 *
 *   3. FORENSICS. "Who locked down what" has to be answerable per school.
 *      One AuditLog row per affected tenant gives each school's own activity
 *      trail the event, which one district-only row never could.
 *
 * THE TRADEOFF, STATED
 * --------------------
 * Fan-out costs N writes + N publishes per trigger (39 rows for Walnut Creek,
 * all inside ONE transaction — never a partial subtree), and a tenant CREATED
 * after the trigger does not inherit the active alert. That residual gap is
 * covered by the manifest-side ancestor fallback in `screens.controller.ts`
 * (see `resolveAncestorEmergencyState`), which is a strictly-additive read on
 * a 2s-cached tenant row: fan-out is the authoritative, audited write path;
 * inheritance is the self-healing safety net underneath it.
 *
 * ARCHIVED TENANTS ARE EXCLUDED from the descendant walk — consistent with
 * every other cascade in the codebase (`playlist-distribution.service.ts`,
 * `GET /screens/fleet`, `tenants.controller`). An archived location is
 * soft-deleted; resurrecting 120 archived test tenants into a live lockdown
 * fan-out would be strictly worse than leaving them out.
 *
 * Both walks are DEPTH-BOUNDED and CYCLE-GUARDED. `parentId` is an
 * unconstrained self-FK, so a bad backfill could in principle create a cycle;
 * a life-safety path must never be the thing that discovers it by hanging.
 */

/** Hard ceiling on hierarchy depth. Real districts are 2 levels; 8 is headroom. */
export const MAX_TENANT_TREE_DEPTH = 8;

/** Hard ceiling on how many tenants one trigger may fan out to. */
export const MAX_TENANT_SUBTREE_TENANTS = 1_000;

/** The slice of `prisma.client.tenant` these walks need. */
export interface TenantHierarchyDelegate {
  findMany(args: any): Promise<Array<{ id: string }>>;
  findUnique(args: any): Promise<{ parentId?: string | null } | null>;
}

/**
 * Breadth-first walk DOWN from `rootTenantId`, returning every non-archived
 * descendant tenant id. Does NOT include the root — callers own deciding
 * whether the root is part of the affected set (it always is for emergency,
 * but keeping it out makes "did this fan out?" a simple `length > 0` test).
 *
 * One query per level, so a 2-level district is exactly 2 round-trips
 * regardless of how many schools it has.
 */
export async function collectDescendantTenantIds(
  tenant: TenantHierarchyDelegate,
  rootTenantId: string,
): Promise<string[]> {
  if (!rootTenantId) return [];

  const out: string[] = [];
  const seen = new Set<string>([rootTenantId]);
  let frontier: string[] = [rootTenantId];

  for (let depth = 0; depth < MAX_TENANT_TREE_DEPTH && frontier.length > 0; depth++) {
    const rows = await tenant.findMany({
      where: { parentId: { in: frontier }, archivedAt: null },
      select: { id: true },
    });

    const next: string[] = [];
    for (const row of rows ?? []) {
      const id = row?.id;
      // Cycle guard: a row we've already visited must never re-enter the
      // frontier, or a bad `parentId` backfill loops this forever.
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      next.push(id);
      if (out.length >= MAX_TENANT_SUBTREE_TENANTS) return out;
    }
    frontier = next;
  }

  return out;
}

/**
 * Walk UP from `candidateTenantId` and report whether `ancestorTenantId` is
 * one of its ancestors. Used by the emergency scope gate to let a district
 * admin act on a school INSIDE their own district without widening the
 * "everyone else is confined to their own tenant" rule one inch further.
 *
 * A tenant is NOT its own ancestor — callers handle the identity case
 * explicitly so the authorisation code reads as two distinct decisions.
 *
 * Cost is bounded by depth (2 lookups for a real district), not by the
 * number of schools, which is why this is the direction the auth gate walks.
 */
export async function isDescendantTenant(
  tenant: TenantHierarchyDelegate,
  candidateTenantId: string,
  ancestorTenantId: string,
): Promise<boolean> {
  if (!candidateTenantId || !ancestorTenantId) return false;
  if (candidateTenantId === ancestorTenantId) return false;

  const seen = new Set<string>([candidateTenantId]);
  let cursor: string | null = candidateTenantId;

  for (let hop = 0; hop < MAX_TENANT_TREE_DEPTH && cursor; hop++) {
    const row = await tenant.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    const parentId = row?.parentId ?? null;
    if (!parentId) return false;
    if (parentId === ancestorTenantId) return true;
    if (seen.has(parentId)) return false; // cycle guard
    seen.add(parentId);
    cursor = parentId;
  }

  return false;
}
