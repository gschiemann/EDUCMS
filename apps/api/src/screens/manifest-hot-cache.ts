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
//
// BUNDLE-SHA EXCEPTION (2026-08-25). The render-proof POST now also carries
// the page-bundle SHA the player is running, and a CHANGE in that value is
// the one piece of news on this payload: a panel that just self-reloaded onto
// the fix must stop reading "out of date" on the dashboard immediately, not
// up to 40s later. Same shape as `shouldSkipCacheReportWrite` above — a
// changed signature writes through, an unchanged one debounces. Screens whose
// build never reports a SHA pass '' and debounce exactly as before.
const RENDER_PROOF_DEBOUNCE_MS = 40_000;
const renderProofWrites = new Map<string, { at: number; bundleSha: string }>();
export function shouldSkipRenderProofWrite(
    screenId: string,
    /** Reported page-bundle SHA, or '' when this build doesn't report one. */
    bundleSha = '',
): boolean {
    const last = renderProofWrites.get(screenId);
    if (!last) return false;
    if (last.bundleSha !== bundleSha) return false; // bundle changed → always write
    return Date.now() - last.at < RENDER_PROOF_DEBOUNCE_MS;
}
export function markRenderProofWritten(screenId: string, bundleSha = ''): void {
    renderProofWrites.set(screenId, { at: Date.now(), bundleSha });
    if (renderProofWrites.size > 50_000) {
        const oldest = renderProofWrites.keys().next().value;
        if (oldest) renderProofWrites.delete(oldest);
    }
}

// ── Manifest content cache (Supabase egress diet — 2026-07-30) ──────────────
// WHY: every manifest poll re-ran the schedule→playlist→items→asset→template→
// zones fan-out (~7 queries, ~100 KB of DB wire bytes) even when the player
// ended up with a 304 — the ETag only saved Railway→player egress, never
// Supabase→Railway. At 4-5 always-on screens that fan-out alone was ~25 GB/mo
// of Supabase egress: the entire July-2026 invoice overage. The fan-out result
// only changes when content changes, so we cache the BUILT hashable payload
// per screen and serve it until one of three things invalidates it:
//
//   1. CONTENT REV — a process-wide counter bumped by a Prisma $use hook
//      (prisma.service.ts) on every mutation of a manifest-fed model. An
//      operator edit is therefore visible on the very next poll — identical
//      freshness to the uncached path. Screen writes that touch ONLY
//      telemetry columns (heartbeat lastPingAt, cache/render-proof reports)
//      are excluded via SCREEN_TELEMETRY_ONLY_FIELDS, otherwise the fleet's
//      own 25-30s telemetry would thrash the cache into uselessness.
//   2. NEXT SCHEDULE BOUNDARY — a cached entry never outlives the earliest
//      future startTime/endTime of a schedule targeting the screen, so a
//      3:00pm go-live appears on the first poll after 3:00 exactly like
//      before. (Fine-grained daysOfWeek/timeStart windows are evaluated
//      PLAYER-side from fields inside the payload — no server rebuild
//      needed for those transitions.)
//   3. TTL BACKSTOP — 30 min when the mutation hook armed, 20s when it
//      didn't (defensive: hook arming must never be a correctness
//      dependency). Covers out-of-band writes: Supabase Studio edits, seed
//      scripts, a future second replica.
//
// WHAT IS NEVER CACHED: the emergency branch and the sports-scoreboard
// branch both return BEFORE the cache is consulted, and the per-screen
// override row + tenant emergency state are still read live on every poll.
// The Screen row is served from the identity preamble below on an unchanged
// poll (2026-09-03) — but BOTH of those branches re-read it from Postgres
// before they build anything (`readManifestScreenLive`), so life-safety and
// live-score freshness are byte-for-byte unchanged, and the auth 403 is taken
// against the credential snapshot every revocation writer invalidates.
// ETag semantics are also unchanged: the stored hashable payload
// is the exact object the hash was computed from, so hashes are stable
// across cached/uncached serves and the sync-block invariant (no volatile
// fields in the hashed payload) is preserved.
//
// MULTI-REPLICA: the rev is per-process, same single-replica assumption as
// every debounce above (numReplicas=1 today). If the API ever scales out,
// move the bump to a Redis pub/sub bust — or the TTL bounds cross-replica
// staleness at 30 min worst case.

/** Prisma models whose rows feed the player manifest payload. */
export const MANIFEST_FED_MODELS = new Set([
    'Screen',
    'ScreenGroup',
    'Tenant',
    'Schedule',
    'Playlist',
    'PlaylistItem',
    'Asset',
    'Template',
    'TemplateZone',
    'TemplateScene',
    'ScreenEmergencyOverride',
    // Display control (2026-08-13). Both feed the manifest's `display` block:
    // DisplaySchedule is the on/off window list the player arms as local
    // AlarmManager alarms, DisplayVendorRecipe is the recipe catalog it
    // matches against its own Build.* identity. Without them here an
    // operator's schedule edit would be invisible to players for up to the
    // 30-minute armed TTL — a screen that keeps blanking at the OLD time is
    // indistinguishable from a broken feature.
    'DisplaySchedule',
    'DisplayVendorRecipe',
]);

/** Every Prisma action that can change rows. */
export const MANIFEST_MUTATING_ACTIONS = new Set([
    'create',
    'createMany',
    'createManyAndReturn',
    'update',
    'updateMany',
    'upsert',
    'delete',
    'deleteMany',
]);

/**
 * Screen columns written by high-frequency device telemetry (manifest
 * lastPingAt touch, /heartbeat, /cache-status, /render-proof). An UPDATE
 * whose data keys are ALL in this set does not change what the manifest
 * renders, so it must not bust the cache. Polarity is deliberate: any
 * unknown/new column BUSTS (correctness-safe default); only proven
 * telemetry is skipped. `status` is here because heartbeats write
 * ONLINE/PENDING constantly — the REVOKED check reads the live screen row
 * every poll, never the cache, so skipping it is safe.
 */
export const SCREEN_TELEMETRY_ONLY_FIELDS = new Set([
    'lastPingAt',
    'status',
    'playerVersion',
    'playerVersionAt',
    'playerVersionCode',
    'forceApkUpdatePendingAt',
    'lastOtaState',
    'lastOtaProgress',
    'lastOtaMessage',
    'lastOtaAt',
    'managerVersion',
    'managerVersionAt',
    'lastCacheReport',
    'lastCacheReportAt',
    'lastRenderedAt',
    'lastRenderedFrames',
    'lastRenderedHash',
    // ── Page-bundle provenance (2026-08-25) ──────────────────────────────
    // Written in the SAME statement as lastRenderedAt/Frames/Hash above by
    // POST /screens/:id/render-proof — i.e. ~every 40s per screen, fleet
    // wide. Leaving them off this list would un-protect the exact write the
    // three lines above were listed to protect and re-create the 25 GB/mo
    // Supabase egress (docs/research/2026-07-30-supabase-bill-diet/).
    //
    // Genuinely non-content: the SHA is a fact about the player's own JS
    // bundle, is read ONLY by the fleet list (`GET /screens`) for the
    // "Page bundle out of date" chip, and appears in no manifest branch —
    // and it MUST NOT, since a manifest that varied per reporting device
    // would kill 304s fleet-wide (CLAUDE.md manifest-cache rule).
    'lastBundleSha',
    'lastBundleShaAt',
    'lastSyncReport',
    'lastSyncReportAt',
    // Push-health stamp (2026-07-31) — written by the WS gateway on
    // AUTH_OK/heartbeat and the SSE service on connect/keepalive. High
    // frequency across the fleet; MUST stay telemetry-only or every WS
    // heartbeat would thrash the manifest cache (the exact 25 GB/mo
    // egress failure the cache exists to prevent).
    'lastPushConnectedAt',
    // Device-credential revocation state (2026-08-03, DT-01/DT-02). None of
    // these appear in the manifest payload, so a write must not invalidate a
    // screen's cached content. Safe because revocation is NOT enforced via
    // the cache: `getManifest` reads the live Screen row and 403s on
    // REVOKED / stale-epoch BEFORE the cache is consulted, and every other
    // device route goes through device-auth.ts's own live-row read.
    'credentialEpoch',
    'credentialEpochRotatedAt',
    'credentialRevokedAt',
    // ── Credential trust state (2026-08-30 reliability program) ──────────
    // Written by the register path (same boot-wave shape as the re-register
    // block below) whenever the server's verdict flips PROVEN ↔
    // REPAIR_REQUIRED. Read ONLY by the fleet dashboard from the live row;
    // never serialized into any manifest branch — the PLAYER learns its own
    // state from the register RESPONSE, not the manifest.
    // (`pendingRefreshAt` is deliberately NOT listed: it IS manifest
    // content — setting it must bust this cache so the reload command
    // reaches a polling-only screen.)
    'authState',
    'authStateChangedAt',
    // Sticky OTA failure signal (2026-08-03, OTA-02). Written in the same
    // statement as `lastOtaState` above; leaving them off this list would
    // let an ERROR report thrash the cache that `lastOtaState` was
    // deliberately listed to protect.
    'lastOtaErrorAt',
    'lastOtaErrorMessage',
    'lastOtaErrorAuthenticated',
    // ── Display capability verdict (2026-08-13) ──────────────────────────
    // Written by POST /screens/:id/display-capabilities when the player
    // reports its read-only probe. Boot-frequency across the fleet, which is
    // exactly the morning power-on wave shape documented below — off this
    // list it would clear every cached manifest process-wide once per screen
    // and re-create the 25 GB/mo egress.
    //
    // ⚠️ THE MANIFEST *DOES* NOW DERIVE FROM THIS COLUMN — ONE FIELD, AND IT
    // IS HANDLED (2026-08-25). The `display` block routes a screen's on/off
    // windows onto `schedules` (hard panel power) or `softSchedules` (the
    // player's own overlay) from the reported `screenBlank` verdict, because
    // a scheduled off that ignored the verdict drove a device-admin lock on
    // hardware the manual path refuses and latched a G43 dark.
    //
    // These two stay HERE anyway, and that is the deliberate choice: off this
    // list, every boot-time report would bump the PROCESS-WIDE content rev
    // and clear every screen's cached manifest — the morning power-on wave
    // documented below, i.e. the 25 GB/mo egress this list exists to prevent.
    // What replaces that is narrower and stronger:
    //   • `DisplayService.recordCapabilities` invalidates THIS ONE screen's
    //     manifest + display-block memo when the verdict actually CHANGES
    //     (`changed` is false for an identical re-report, so the power-on
    //     wave still invalidates nothing); and
    //   • the routing is re-derived on every request from the live Screen row
    //     `getManifest` already reads outside this cache — so a memo can
    //     never serve a stale routing even if an invalidation is missed.
    // Everything else in the block remains verdict-independent: vendor-recipe
    // MATCHING still happens on the device against its own Build.* identity.
    // Add a SECOND derivation only with the same two properties.
    'displayCapabilities',
    'displayCapabilitiesAt',
    // ── Boot + registration diagnostic (2026-09-02, P0-2) ────────────────
    // Written by POST /screens/status/:fp/boot-diagnostic when the APK's
    // boot watchdog raises its native diagnostic screen: the page loaded,
    // and the player never actually started (no client-JS boot / no
    // registration attempt / no registration answer / repeated
    // transport-class failures).
    //
    // Genuinely non-content: nothing in any manifest branch reads them, and
    // nothing may — a manifest that varied with a reporting device's boot
    // history would kill 304s fleet-wide. Listed here because the shape of
    // the write is a POWER-ON WAVE: a district whose uplink is down at 7am
    // reports from every screen at once, which is exactly the pattern that
    // produced the 25 GB/mo Supabase egress this set exists to prevent.
    // (The APK also rate-limits itself to one report per 30 min per
    // process; both bounds, not either.)
    'lastBootDiagAt',
    'lastBootDiagReason',
    'lastBootDiagDetail',
    // ── Device re-register (2026-08-03) ──────────────────────────────────
    // `POST /screens/register` (both the paired and unpaired branches in
    // screens.controller) rewrites this exact column set on EVERY boot,
    // alongside the already-listed lastPingAt + status. Off this list, a
    // morning power-on wave — the whole fleet re-registering inside a few
    // minutes — cleared every cached manifest process-wide, once per screen,
    // re-creating the 25 GB/mo Supabase egress the cache was built to kill
    // (docs/research/2026-07-30-supabase-bill-diet/).
    //
    // Each is genuinely non-content — verified against the CACHED payload
    // built in `getManifest` (which serializes only: tenantId/tenantName,
    // orientation, canvasW/H, repeats, config→gpio/wiring/consoleProfile,
    // hardwareModel, sync{} from screenGroup.syncMode + syncOffsetMs, and
    // the schedule fan-out):
    //   resolution  — the device-reported "WxH". Read in getManifest ONLY by
    //                 the EMERGENCY branch (portrait-vs-landscape emergency
    //                 playlist pick) and by buildScoreboardManifest — BOTH of
    //                 which return BEFORE the cache is consulted and are
    //                 rebuilt from the freshly-read Screen row on every poll,
    //                 so neither can ever be served stale from the cache.
    //                 It appears nowhere in the cached hashable payload.
    //   osInfo      — dashboard diagnostics column; never serialized.
    //   browserInfo — dashboard diagnostics column; never serialized.
    //   userAgent   — dashboard diagnostics + the Chromium-major compat chip
    //                 (parseChromiumMajor); never serialized.
    //   ipAddress   — forensics only (audit/dashboard); never serialized.
    //
    // DELIBERATELY NOT LISTED: `hardwareModel`, which the register path also
    // writes — it IS in the manifest payload, so it must keep busting. That
    // write is a back-fill only (`inferIfUnknown` returns null once the
    // column has a value), so the common re-register never includes the key
    // and stays fully telemetry-only, while the rare genuine back-fill
    // correctly invalidates.
    'resolution',
    'osInfo',
    'browserInfo',
    'userAgent',
    'ipAddress',
    // ── Player/Manager APK crash report (2026-08-03) ─────────────────────
    // `POST /screens/status/:fingerprint/crash-report` writes these five and
    // nothing else. A single crash-LOOPING kiosk can hit that endpoint up to
    // its 10/min throttle indefinitely, and each write was clearing the
    // cached manifest of every screen in the fleet — one bad device taxing
    // everyone else's Supabase egress. All five are pure post-mortem
    // diagnostics: their only readers are the dashboard columns selected in
    // screen-groups.controller; none is serialized into any manifest branch.
    'lastCrashAt',
    'lastCrashSource',
    'lastCrashVersion',
    'lastCrashMessage',
    'lastCrashStack',
]);

export type ManifestCacheEntry =
    | {
          kind: 'full';
          /** The exact object the sha256 ETag was computed from (no generatedAt/hash). */
          hashablePayload: Record<string, any>;
          etag: string;
          boundaryAt: number | null;
          at: number;
          rev: number;
      }
    | {
          kind: 'empty';
          /** The full static "no schedule" 200 body — replayed verbatim. */
          body: Record<string, any>;
          boundaryAt: number | null;
          at: number;
          rev: number;
      };

const MANIFEST_CACHE_TTL_ARMED_MS = 30 * 60_000;
const MANIFEST_CACHE_TTL_UNARMED_MS = 20_000;
const MANIFEST_CACHE_MAX_ENTRIES = 1_000;

let manifestContentRev = 0;
let manifestRevHookArmed = false;
const manifestCache = new Map<string, ManifestCacheEntry>();

/** Any content mutation → every cached manifest is invalid. */
export function bumpManifestContentRev(): void {
    manifestContentRev += 1;
    manifestCache.clear();
    // The identity preamble (Screen row + ScreenGroup + Tenant projection) is
    // gated on the same rev, so this clear is strictly a memory reclaim — a
    // surviving entry would already read stale via its `rev` check. Kept
    // explicit so the two caches can never drift on invalidation policy.
    preambleCache.clear();
}

export function currentManifestContentRev(): number {
    return manifestContentRev;
}

/** Called once by PrismaService when the $use mutation hook is installed. */
export function markManifestRevHookArmed(): void {
    manifestRevHookArmed = true;
}

/**
 * Pure decision fn for the Prisma middleware: should this operation bust
 * the manifest cache? Exported for unit tests.
 * @param updateDataKeys Object.keys(args.data) for update/updateMany, else null.
 */
export function shouldBumpManifestRev(
    model: string | undefined,
    action: string | undefined,
    updateDataKeys: string[] | null,
): boolean {
    if (!model || !action) return false;
    if (!MANIFEST_FED_MODELS.has(model)) return false;
    if (!MANIFEST_MUTATING_ACTIONS.has(action)) return false;
    if (
        model === 'Screen' &&
        (action === 'update' || action === 'updateMany') &&
        updateDataKeys !== null &&
        updateDataKeys.length > 0 &&
        updateDataKeys.every((k) => SCREEN_TELEMETRY_ONLY_FIELDS.has(k))
    ) {
        return false;
    }
    return true;
}

export function getManifestCache(screenId: string): ManifestCacheEntry | undefined {
    const hit = manifestCache.get(screenId);
    if (!hit) return undefined;
    const ttl = manifestRevHookArmed ? MANIFEST_CACHE_TTL_ARMED_MS : MANIFEST_CACHE_TTL_UNARMED_MS;
    const stale =
        hit.rev !== manifestContentRev ||
        Date.now() - hit.at > ttl ||
        (hit.boundaryAt !== null && Date.now() >= hit.boundaryAt);
    if (stale) {
        manifestCache.delete(screenId);
        return undefined;
    }
    return hit;
}

/**
 * Store a freshly-built manifest. `revAtBuildStart` MUST be the rev
 * captured BEFORE the first row of the build was read: if a mutation
 * landed mid-build the stored rev is already stale and the next poll
 * rebuilds — a torn read can never be served twice.
 */
export function setManifestCache(
    screenId: string,
    entry:
        | { kind: 'full'; hashablePayload: Record<string, any>; etag: string; boundaryAt: number | null }
        | { kind: 'empty'; body: Record<string, any>; boundaryAt: number | null },
    revAtBuildStart: number,
): void {
    manifestCache.set(screenId, { ...entry, at: Date.now(), rev: revAtBuildStart } as ManifestCacheEntry);
    if (manifestCache.size > MANIFEST_CACHE_MAX_ENTRIES) {
        const oldest = manifestCache.keys().next().value;
        if (oldest) manifestCache.delete(oldest);
    }
}

export function invalidateManifestCache(screenId?: string): void {
    if (screenId) manifestCache.delete(screenId);
    else manifestCache.clear();
    // Anything that invalidates a screen's cached manifest also invalidates
    // the row snapshot the manifest was built FROM. `DisplayService
    // .recordCapabilities` is the caller that makes this load-bearing: the
    // `displayCapabilities` verdict is a telemetry-only column (so it does NOT
    // move the content rev — deliberately, to keep the morning power-on wave
    // from clearing every cached manifest), and it invalidates this ONE
    // screen when the verdict actually CHANGES. Without this line the
    // preamble would keep serving the pre-change verdict and the display
    // block would route a screen's off-windows onto the wrong array.
    invalidateManifestPreamble(screenId);
}

/** Test hook — full reset of module state between spec cases. */
export function resetManifestCacheForTests(): void {
    manifestCache.clear();
    preambleCache.clear();
    manifestContentRev = 0;
    manifestRevHookArmed = false;
}

// ── Manifest identity preamble (efficiency L1 — 2026-09-03) ─────────────────
//
// WHAT IT REMOVES. `getManifest` performed THREE Postgres reads before the
// content cache above was even consulted — `screen.findUnique` (the whole
// row), then `screenGroup.findUnique` and `tenant.findUnique` in parallel.
// The content cache only ever saved the schedule fan-out, so an unchanged
// poll still cost those three, ~8,640 polls/screen/day before the emergency
// backstop moved to `/emergency-rev` and 1,440/day after it. At 1,000 screens
// that is millions of reads/day to learn that nothing changed.
//
// WHAT IT IS. The exact rows that preamble read, memoised per screen under
// the SAME invalidation graph as the manifest content cache:
//
//   1. CONTENT REV — every write to a manifest-fed model (Screen included,
//      minus SCREEN_TELEMETRY_ONLY_FIELDS) bumps the process-wide rev and
//      this entry stops matching. So a re-pair (`tenantId`), a group move
//      (`screenGroupId`), a rename, a canvas/orientation/config change, a
//      `pendingRefreshAt` (REFRESH_WEB) stamp, a group rename and a tenant
//      rename ALL land on the very next poll — identical freshness to the
//      uncached path.
//   2. EXPLICIT INVALIDATION — `invalidateManifestCache(screenId)` (the
//      display-verdict path above) and `invalidateDeviceCredentialCache`
//      (every revoke / epoch rotation / re-pair / unpair / delete writer).
//   3. TTL — deliberately SHORTER than the manifest cache's 30 min, because
//      this entry carries telemetry-only columns that do NOT move the rev
//      (`resolution`, `displayCapabilities`, `status`, `authState`). Those
//      are written by the device's own re-register, which invalidates this
//      screen's entry through (2), so the TTL is a backstop for out-of-band
//      writes only.
//
// WHAT IT MAY NEVER DO. It is NOT an emergency cache and it does not decide
// anything. The alert inputs — the per-screen `ScreenEmergencyOverride` row
// and the tenant emergency state — are still read LIVE on every poll, and
// `getManifest` re-reads the Screen row from Postgres before it builds the
// EMERGENCY or the SPORTS-SCOREBOARD branch, so neither of those branches can
// ever be assembled from a snapshot. Nor does it decide auth: the REVOKED /
// credential-epoch 403 is taken against the credential snapshot
// (device-auth.ts), which every revocation writer explicitly invalidates.

/** The rows `getManifest` reads before the content cache is consulted. */
export interface ManifestPreamble {
    /** The Screen row, exactly as `screen.findUnique({ where: { id } })` returns it. */
    screen: Record<string, any>;
    /** The screen's ScreenGroup row, or null when it belongs to no group. */
    screenGroup: Record<string, any> | null;
    /** The manifest's Tenant projection, or null when the screen is unpaired. */
    tenant: Record<string, any> | null;
}

/**
 * See (3) above. 10 min, not the content cache's 30, and the device's own
 * ~10-min re-register invalidates this screen's entry anyway — so in practice
 * this bound is only reached by a screen that has stopped re-registering.
 */
const PREAMBLE_TTL_ARMED_MS = 10 * 60_000;
/** Hook not armed → the rev cannot be trusted, so fall back to a short TTL. */
const PREAMBLE_TTL_UNARMED_MS = 20_000;
const PREAMBLE_MAX_ENTRIES = 1_000;

const preambleCache = new Map<
    string,
    { value: ManifestPreamble; at: number; rev: number }
>();

export function getManifestPreamble(screenId: string): ManifestPreamble | undefined {
    const hit = preambleCache.get(screenId);
    if (!hit) return undefined;
    const ttl = manifestRevHookArmed ? PREAMBLE_TTL_ARMED_MS : PREAMBLE_TTL_UNARMED_MS;
    if (hit.rev !== manifestContentRev || Date.now() - hit.at > ttl) {
        preambleCache.delete(screenId);
        return undefined;
    }
    return hit.value;
}

/**
 * Store a freshly-read preamble. `revAtReadStart` MUST be the rev captured
 * BEFORE the first row was read — same torn-read guard as `setManifestCache`:
 * a mutation that lands mid-read stores an already-stale rev, so the next poll
 * re-reads rather than serving rows that never coexisted.
 */
export function setManifestPreamble(
    screenId: string,
    value: ManifestPreamble,
    revAtReadStart: number,
): void {
    preambleCache.set(screenId, { value, at: Date.now(), rev: revAtReadStart });
    if (preambleCache.size > PREAMBLE_MAX_ENTRIES) {
        const oldest = preambleCache.keys().next().value;
        if (oldest) preambleCache.delete(oldest);
    }
}

export function invalidateManifestPreamble(screenId?: string): void {
    if (screenId) preambleCache.delete(screenId);
    else preambleCache.clear();
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
