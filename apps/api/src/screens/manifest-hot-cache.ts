/**
 * Short-lived in-memory caches for the manifest hot path.
 *
 * WHY THESE EXIST (audit 2026-04-23):
 *   1. Every paired screen polls /manifest on a 5-10s cadence. In an
 *      active emergency the player can poll as often as every 2s until
 *      it sees the override. A 500-screen district = 250 queries/sec
 *      hitting two hot tables (tenant + playlist) for the same
 *      (tenantId → emergencyPlaylist) resolution. Combined with the
 *      un-indexed Screen.tenantId scans that the audit also flagged,
 *      Supabase's pooler saturates.
 *   2. The same manifest handler ALSO fires `screen.update(lastPingAt)`
 *      per poll. 500 screens × 5s = 100 writes/sec, each grabbing a
 *      pool connection, each contending against the pgBouncer limit.
 *
 * Both caches are intentionally short-TTL and in-process. Emergency
 * triggers are atomic via the signed WS broadcast; screens see the new
 * state via the WS message regardless of the cache. A stale manifest
 * read is bounded by TTL (2s for emergency state; 25s for ping
 * debounce) and is preferable to pool exhaustion.
 *
 * Not a Redis cache on purpose: adding network round-trips to the
 * manifest path is strictly worse than a 5MB in-process Map. If we
 * horizontally scale the API beyond 2-3 pods the per-pod cache
 * divergence is still bounded by TTL.
 */

type EmergencyState = {
    emergencyStatus: string | null;
    emergencyPlaylistId: string | null;
    emergencyPortraitPlaylistId: string | null;
};

const TENANT_STATE_TTL_MS = 2_000;
const LAST_PING_DEBOUNCE_MS = 25_000;

const tenantStateCache = new Map<string, { value: EmergencyState; at: number }>();
const lastPingWrites = new Map<string, number>();

/**
 * Read tenant emergency state with a 2-second in-process cache.
 * Returns `undefined` to signal "not cached or expired — caller should
 * query DB and pass the result back via `setTenantState`".
 */
export function getTenantState(tenantId: string): EmergencyState | undefined {
    const hit = tenantStateCache.get(tenantId);
    if (!hit) return undefined;
    if (Date.now() - hit.at > TENANT_STATE_TTL_MS) {
        tenantStateCache.delete(tenantId);
        return undefined;
    }
    return hit.value;
}

export function setTenantState(tenantId: string, value: EmergencyState): void {
    tenantStateCache.set(tenantId, { value, at: Date.now() });
    // Naive cap: evict oldest when the map gets big. 10k entries in a
    // single-pod memory is fine (~1 MB) but if something pathological
    // happens we don't grow forever.
    if (tenantStateCache.size > 10_000) {
        const oldest = tenantStateCache.keys().next().value;
        if (oldest) tenantStateCache.delete(oldest);
    }
}

/**
 * Immediate invalidate — call from the emergency controller on
 * trigger / all-clear so the next manifest fetch for this tenant
 * definitely sees the new state (no waiting out the 2s TTL).
 */
export function invalidateTenantState(tenantId: string): void {
    tenantStateCache.delete(tenantId);
}

/**
 * Returns true if the caller should skip writing lastPingAt because a
 * recent write for this screen already covered the "alive" signal.
 * Combined with the indexed Screen.lastPingAt the effective write
 * rate goes from ~N-per-screen-per-minute down to ~2.5/minute while
 * still keeping the ONLINE threshold (2 min) accurate.
 */
export function shouldSkipLastPingWrite(screenId: string): boolean {
    const last = lastPingWrites.get(screenId);
    if (!last) return false;
    return Date.now() - last < LAST_PING_DEBOUNCE_MS;
}

export function markLastPingWritten(screenId: string): void {
    lastPingWrites.set(screenId, Date.now());
    if (lastPingWrites.size > 50_000) {
        const oldest = lastPingWrites.keys().next().value;
        if (oldest) lastPingWrites.delete(oldest);
    }
}
