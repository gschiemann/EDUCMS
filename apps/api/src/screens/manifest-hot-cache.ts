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

// ── cache-status write debounce (DB efficiency — 2026-06-15) ────────────────
// The player POSTs /cache-status every 30s and the payload is unchanged on
// ~99% of posts. Live pg_stat_statements showed this UPDATE was ~42% of ALL
// DB time (180k calls, 19.84ms mean — write contention on the screens row).
// The wedge detector only needs lastCacheReportAt fresher than CACHE_REPORT_
// STALE_MS (5 min), so we coalesce identical reports to at most one write per
// 120s (2.5 writes inside the 5-min window — never trips the wedge detector)
// AND write immediately whenever the report content changes (bytes/counts stay
// accurate). Net: the single largest DB write drops ~4x. In-memory per replica,
// same pattern as lastPingWrites above (numReplicas=1 today).
const CACHE_REPORT_DEBOUNCE_MS = 120_000;
const cacheReportWrites = new Map<string, { at: number; sig: string }>();
export function shouldSkipCacheReportWrite(screenId: string, sig: string): boolean {
    const last = cacheReportWrites.get(screenId);
    if (!last) return false;
    if (last.sig !== sig) return false; // content changed → always write
    return Date.now() - last.at < CACHE_REPORT_DEBOUNCE_MS;
}
export function markCacheReportWritten(screenId: string, sig: string): void {
    cacheReportWrites.set(screenId, { at: Date.now(), sig });
    if (cacheReportWrites.size > 50_000) {
        const oldest = cacheReportWrites.keys().next().value;
        if (oldest) cacheReportWrites.delete(oldest);
    }
}

// ── render-proof write debounce ────────────────────────────────────────────
// Player POSTs render-proof every ~30s; renderHealth flags STALE at 90s
// (RENDER_PROOF_STALE_MS). Coalescing to one write per 40s keeps a healthy
// screen's lastRenderedAt < ~60s old (never false-RED) while halving the
// write (was ~17% of DB time). A real freeze STOPS the POSTs entirely, so
// debouncing the healthy path can never mask a freeze.
const RENDER_PROOF_DEBOUNCE_MS = 40_000;
const renderProofWrites = new Map<string, number>();
export function shouldSkipRenderProofWrite(screenId: string): boolean {
    const last = renderProofWrites.get(screenId);
    if (!last) return false;
    return Date.now() - last < RENDER_PROOF_DEBOUNCE_MS;
}
export function markRenderProofWritten(screenId: string): void {
    renderProofWrites.set(screenId, Date.now());
    if (renderProofWrites.size > 50_000) {
        const oldest = renderProofWrites.keys().next().value;
        if (oldest) renderProofWrites.delete(oldest);
    }
}

// Same idea as lastPingWrites but for the emergency-asset audit log.
// Player pre-caches emergency assets on its own 5-minute cadence; we
// were writing a fresh AuditLog row on every fetch, which (at 50
// screens) spams the Activity card with 600 identical entries an
// hour. Key is `${screenId}:${setHash}` so a genuine content change
// (different setHash) still produces a fresh audit entry.
//
// 2026-04-27: bumped from 15min → 6h. The forensic value of these
// entries is "did this device fetch emergency content recently"; six
// hours is more than fine. At 50 screens the per-day audit row count
// drops from ~4,800 to ~200 — within the spam-free target.
const EMERGENCY_AUDIT_DEBOUNCE_MS = 6 * 60 * 60_000; // 6 hours
const recentEmergencyAudit = new Map<string, number>();
export function shouldSkipEmergencyAudit(screenId: string, setHash: string): boolean {
    const key = `${screenId}:${setHash}`;
    const last = recentEmergencyAudit.get(key);
    if (!last) return false;
    return Date.now() - last < EMERGENCY_AUDIT_DEBOUNCE_MS;
}
export function markEmergencyAuditWritten(screenId: string, setHash: string): void {
    const key = `${screenId}:${setHash}`;
    recentEmergencyAudit.set(key, Date.now());
    if (recentEmergencyAudit.size > 50_000) {
        const oldest = recentEmergencyAudit.keys().next().value;
        if (oldest) recentEmergencyAudit.delete(oldest);
    }
}
