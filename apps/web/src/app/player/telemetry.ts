import { NATIVE_TIMING_EXTRA_KEYS, type NativeSharedVideoState } from './nativeSharedVideo';
import type { EmergencyPaintProof } from './emergencyPaintProof';
/**
 * telemetry.ts — the player's ONE routine report (2026-09-02, efficiency
 * program P0-1).
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────
 * A fully-active screen used to run five separate routine timers, each with
 * its own request:
 *
 *   30 s  GET  /screens/status/:fp      (always-on liveness + OTA poll)
 *   45 s  GET  /screens/status/:fp      (a SECOND copy, inside the WS effect)
 *   30 s  POST /screens/:id/cache-status
 *   30 s  POST /screens/:id/render-proof
 *   60 s  GET  /player/latest-version-public
 *
 * That is ~9,000 requests per screen per day before the manifest is even
 * considered, and the 2026-09-02 efficiency audit measured ~93 % of live
 * production API traffic as exactly this class of player maintenance. All
 * of it now rides ONE `POST /screens/:id/telemetry` per minute.
 *
 * ── WHAT MUST NOT BE LOST, AND HOW IT IS KEPT ───────────────────────────
 * Player rule 5 (never equate signals) is the whole design constraint here.
 * Collapsing five reports into one is safe ONLY because each fact keeps its
 * own evidence and its own way of going silent:
 *
 *   • LIVENESS is the POST landing at all. It proves the JS event loop ran
 *     and the credential is good — nothing more.
 *   • RENDER PROOF is a SEPARATE fact and is OMITTED unless the rAF paint
 *     counter has actually advanced since the last report
 *     (`buildRenderBlock`). A wedged compositor therefore keeps sending
 *     liveness and STOPS sending proof, so `lastRenderedAt` goes stale and
 *     the fleet flags the screen — which is the entire point of the signal.
 *     A telemetry POST can never stand in for a painted frame.
 *   • AN IDLE SCREEN proves liveness under an `idle:` hash prefix at a
 *     tenth of the rate, exactly as before, so nothing downstream can read
 *     it as "operator content is on the glass".
 *
 * ── WHY THE FILE IS PURE ────────────────────────────────────────────────
 * Same discipline as `sync/syncClock.ts`: no React, no DOM, no network, no
 * wall clock read internally — every function takes what it needs and
 * returns a decision. The 9k-line player page owns the effect; this owns
 * the arithmetic, and it is unit-testable without mounting anything.
 */

// ── Cadence ───────────────────────────────────────────────────────────────

/** The contract: one routine report per screen per minute. */
export const TELEMETRY_INTERVAL_MS = 60_000;

/**
 * Floor for ANY post, including an event-driven early one. The server
 * refuses a second report inside 30 s per screen (429, no DB work); 35 s
 * keeps a legitimate early post clear of that boundary even with a little
 * clock drift between the two sides.
 */
export const TELEMETRY_MIN_POST_GAP_MS = 35_000;

/**
 * Retry delay after a transient failure.
 *
 * ⚠️ THIS NUMBER IS LOAD-BEARING, not a nicety. `RENDER_PROOF_STALE_MS` on
 * the server is 90 s, so at a 60 s cadence a SINGLE dropped post would put
 * `lastRenderedAt` at 120 s and paint a healthy screen red. Retrying at
 * 15 s bounds one transient failure to ~75 s — inside the window, and
 * better than the old 30 s-post/40 s-server-debounce arrangement managed
 * (which reached 90 s on one miss). A REAL freeze still goes stale, because
 * a retry that succeeds carries no render block when the paint counter has
 * not moved.
 */
export const TELEMETRY_RETRY_MS = 15_000;

/** Bounds on a server-suggested cadence — never slower than the render
 *  staleness window can tolerate, never fast enough to trip the 429 floor. */
export const TELEMETRY_MIN_INTERVAL_MS = 30_000;
export const TELEMETRY_MAX_INTERVAL_MS = 5 * 60_000;

/** Idle screens prove liveness at a tenth of a playing screen's rate. */
export const IDLE_PROOF_INTERVAL_MS = 5 * 60_000;

// ── Types ─────────────────────────────────────────────────────────────────

export interface TelemetrySyncReport {
  locked: boolean;
  errMs: number | null;
  clockUncertaintyMs: number | null;
  rttMs: number | null;
  contentSig: string | null;
  renderLeadMs: number | null;
  skewPpm: number | null;
}

export interface TelemetryCacheTier {
  count: number;
  bytes: number;
}

export interface TelemetryRenderBlock {
  frames: number;
  hash: string;
  contentKind: string;
  sync?: TelemetrySyncReport;
  emergencyProof?: EmergencyPaintProof;
}

/**
 * Video playback quality (2026-09-24) — ONE dropped-frame sample from the
 * `<video>` the player last played (`getVideoPlaybackQuality()`), sent only
 * when there is a NEW one since the last report. The server keeps the latest
 * per screen and the dashboard reads it as "Stuttered on this screen" next to
 * the file's own encode grade — the pair tells a bad file from a struggling
 * player. ⚠️ `strictObject` on the server: the API that accepts this key
 * ships BEFORE the player bundle that sends it (same rule as `bundleId`).
 */
export interface TelemetryVideoReport {
  url: string;
  totalFrames: number;
  droppedFrames: number;
  elapsedMs?: number;
  width?: number;
  height?: number;
  /**
   * Rebuffer pauses in the same stretch: how many times playback stopped
   * mid-clip for lack of data, and the wall-clock ms it spent stopped — the
   * delivery stutter dropped frames cannot see (a file with its MP4 index at
   * the end drops nothing and still freezes while bytes arrive). ABSENT means
   * "not counted", never "no pauses". ⚠️ Same rollout rule as the block: the
   * API that accepts these keys ships before the player that sends them.
   */
  stalls?: number;
  stalledMs?: number;
  /**
   * Per-file evidence (2026-10-11, video guarantee step 1) — the server folds
   * samples that carry `sha256` into one record per screen × file. Each key is
   * OMITTED when the player does not know it. ⚠️ Same rollout rule: the API
   * that accepts these ships first, and the page drops them for a while after
   * a 400 that carried them (`videoExtrasRefused`).
   */
  sha256?: string;
  engine?: 'native' | 'continuous' | 'twodeck' | 'deck';
  cached?: boolean;
  first?: boolean;
  concurrent?: number;
}

/**
 * What the WebView DECLARES it decodes smoothly (2026-10-11): one
 * `navigator.mediaCapabilities.decodingInfo` answer per canonical H.264
 * config, sent once per page boot (`mediaCapsProbe.ts`). ⚠️ Rollout as above
 * (`mediaCapsRefused`).
 */
export interface TelemetryMediaCaps {
  webviewMajor?: number;
  configs: Array<{
    id: '1080p30-landscape' | '1080p30-portrait' | '2160p30-landscape' | '2160p30-portrait';
    supported: boolean;
    smooth: boolean;
    powerEfficient: boolean;
  }>;
}

/**
 * Loop-boundary quality (2026-09-29, video-loop audit F1/F2): what THIS screen
 * measured at the seam where a solo video starts over — see `loopBoundary.ts`.
 * `evidence` is always `rvfc`: a frame reached the compositor; not a camera on
 * the panel. ⚠️ `strictObject` on the server: the API that accepts `loop` ships
 * BEFORE the bundle that sends it, and if a report carrying it is still refused
 * the page stops sending it for the rest of its session (`loopReportRefused`).
 */
export interface TelemetryLoopReport {
  backend: 'native' | 'twodeck' | 'continuous';
  evidence: 'rvfc';
  boundaries: number;
  maxHoldMs: number;
  p95HoldMs: number;
  lastHoldMs: number;
  maxSkipMs: number;
  swaps?: number;
  fallbacks?: number;
  fallbackReason?: string;
}

/**
 * The large file this screen is downloading RIGHT NOW (2026-09-27, download
 * visibility). A file ≥ 8 MiB plays only once it is completely on disk
 * (readiness-gated playback, CLAUDE.md player rule 17). Until it is, the glass
 * shows either the "Downloading content" splash (nothing else to show) or the
 * PREVIOUS content, with the new playlist held back — and the dashboard could
 * tell neither from "nothing scheduled". It rides inside the cache report on
 * the routine tick: no new request, no new endpoint, no new column.
 *
 * A LIVENESS-GRADE fact, never a render proof (player rule 5): it says the
 * page runs and bytes arrive, nothing about a painted frame.
 *
 * ⚠️ `cache` is a `strictObject` on the server: the API that accepts this key
 * ships before the bundle that sends it, and if a report carrying it is still
 * refused the page stops sending it for the rest of its session
 * (`downloadReportRefused`) so liveness and render proof keep landing.
 */
export interface TelemetryDownloadReport {
  /** The file's name — the last path segment of its URL, capped. */
  file: string;
  bytesLoaded: number;
  /** Omitted until the player knows the file's size — never sent as 0. */
  bytesTotal?: number;
  /** A NEW playlist is held back while the previous content stays on glass. */
  deferredCommit: boolean;
}

/** The server's cap is 256; the name is shown to an operator, 120 is plenty. */
export const DOWNLOAD_FILE_MAX_CHARS = 120;

/**
 * Off-hours bundle update, applied (2026-10-10). Sent ONCE by the document
 * that came up after the reload, once operator content was on its glass:
 * which window applied it, the zone that window was read in (and where the
 * zone came from), how the reload was covered, and the two gaps measured on
 * the device. The server records it on the screen's timeline
 * (`screen_events`, kind `update-applied`) — one row per deploy per screen,
 * never a column.
 *
 * ⚠️ ROLLOUT ORDER — same rule as `loop` / `cache.downloading`: the body is a
 * `strictObject`, so an API that does not know `update` answers 400 to the
 * WHOLE report. This API ships before the player bundle that sends it, and
 * the page drops the block for a while after a refusal (`updateReportRefused`).
 */
export interface TelemetryUpdateReport {
  fromBundleId: string | null;
  toBundleId: string | null;
  window: 'display-off' | 'idle' | 'nightly';
  boundary: 'now' | 'item';
  zone: string;
  zoneSource: 'schedule' | 'device' | 'utc';
  capture: 'live' | 'refetch' | 'color' | 'none';
  /** Last frame of the old document → the cover painted (the true blank), ms. */
  blankMs: number | null;
  /** Cover painted → operator content on the glass, ms. */
  coverMs: number | null;
  converged: boolean;
}

export interface TelemetryBody {
  versions?: {
    player?: string;
    playerCode?: number;
    manager?: string | null;
    bundleSha?: string;
    /**
     * The identity this document actually decides to RELOAD on (2026-09-21).
     *
     * ⚠️ The server's `versions` object is a zod `strictObject`, so an API
     * that predates this key answers 400 to the WHOLE report. The API half
     * ships first — see `telemetry.schema.ts`.
     */
    bundleId?: string;
  };
  cache?: {
    playlist?: TelemetryCacheTier;
    emergency?: TelemetryCacheTier;
    downloading?: TelemetryDownloadReport;
    /**
     * Native-first (design §6): where this face's readiness came from — the
     * app's verified store, or the service worker. ⚠️ Same rollout rule as
     * `downloading`: the API half ships first; a 400 that carried it stops it
     * for the session (`cacheSourceRefused`).
     */
    source?: 'store' | 'worker';
  };
  render?: TelemetryRenderBlock;
  refreshAckMs?: number;
  capsHash?: string;
  nativeVideo?: NativeSharedVideoState;
  video?: TelemetryVideoReport;
  mediaCaps?: TelemetryMediaCaps;
  loop?: TelemetryLoopReport;
  update?: TelemetryUpdateReport;
}

/**
 * What the server hands back — everything the retired status GET used to
 * carry that the player ACTS on, plus the two new server-driven hints.
 */
export interface TelemetryResponse {
  ok?: boolean;
  screenId?: string;
  paired?: boolean;
  name?: string | null;
  ota?: {
    state?: string | null;
    progress?: number | null;
    message?: string | null;
    at?: string | null;
  } | null;
  versions?: { player?: string | null; manager?: string | null };
  forceUpdatePending?: boolean;
  forceUpdatePendingAt?: string | null;
  refreshAcked?: boolean;
  capabilitiesReportRequested?: boolean;
  nextTelemetryInMs?: number;
}

/** How a post ended — drives the next delay AND nothing else. */
export type TelemetryOutcome =
  /** 2xx. */
  | 'ok'
  /** 401 — a REAL failure; the caller feeds credential recovery. */
  | 'unauthorized'
  /** 429 — we asked too soon. NOT a failure, and never a credential signal. */
  | 'throttled'
  /** Network error, 5xx, anything else transient. */
  | 'failed';

// ── Pure decisions ────────────────────────────────────────────────────────

/**
 * Clamp a server-suggested cadence into a range the render-staleness window
 * can survive. A server that says "every hour" must not be able to blind
 * the fleet's freeze detector, and one that says "every second" must not be
 * able to make every screen self-429.
 */
export function clampTelemetryInterval(suggested: unknown): number {
  if (typeof suggested !== 'number' || !Number.isFinite(suggested)) {
    return TELEMETRY_INTERVAL_MS;
  }
  return Math.max(
    TELEMETRY_MIN_INTERVAL_MS,
    Math.min(TELEMETRY_MAX_INTERVAL_MS, Math.floor(suggested)),
  );
}

/** Delay before the next post, given how this one ended. */
export function nextTelemetryDelayMs(
  outcome: TelemetryOutcome,
  serverSuggestedMs?: unknown,
): number {
  switch (outcome) {
    case 'ok':
      return clampTelemetryInterval(serverSuggestedMs);
    case 'failed':
      // See TELEMETRY_RETRY_MS — one dropped post must not reach the 90 s
      // server-side render-staleness window.
      return TELEMETRY_RETRY_MS;
    case 'unauthorized':
      // The credential-recovery machine owns the fix; posting again in 15 s
      // would just burn another 401 against it. Resume the normal cadence.
      return TELEMETRY_INTERVAL_MS;
    case 'throttled':
      // We are ahead of the server's floor. Wait out a full window rather
      // than tapping on the door.
      return TELEMETRY_INTERVAL_MS;
  }
}

/**
 * Delay before the FIRST post of a (re)started scheduler.
 *
 * The scheduler effect re-runs on every identity change of its inputs — in
 * practice every phase transition across the registering / pairing boundary
 * — and used to kick a post IMMEDIATELY each time, regardless of how recently
 * one had landed. Three re-runs inside a few seconds were three posts, two of
 * them refused by the server's 30 s per-screen floor (the fleet's steady
 * trickle of telemetry 429s, 2026-09-22). A fresh page load still posts at
 * once — nothing has been sent, and the dashboard flipping ONLINE within
 * seconds of boot is the property that matters — but a restart inside the
 * floor waits out exactly the remainder.
 */
export function initialTelemetryDelayMs(input: {
  nowMs: number;
  lastPostAtMs: number | null;
}): number {
  if (input.lastPostAtMs === null) return 0;
  const elapsed = input.nowMs - input.lastPostAtMs;
  if (elapsed >= TELEMETRY_MIN_POST_GAP_MS) return 0;
  // A clock that jumped backwards reads as "elapsed < 0": waiting the full
  // gap is the safe answer, never a negative timer.
  return Math.max(0, TELEMETRY_MIN_POST_GAP_MS - Math.max(0, elapsed));
}

/**
 * Should a CONTENT CHANGE post immediately rather than waiting for the next
 * scheduled tick?
 *
 * Render proof is evidence (player rule 10), so a content change wants
 * fresh evidence — but it must not become a per-change request storm, and
 * it must not run into the server's 30 s per-screen floor. So: only when
 * the last post is already old enough that the next one is nearly due
 * anyway.
 */
export function shouldPostEarly(input: {
  nowMs: number;
  lastPostAtMs: number | null;
}): boolean {
  if (input.lastPostAtMs === null) return true; // nothing sent yet
  return input.nowMs - input.lastPostAtMs >= TELEMETRY_MIN_POST_GAP_MS;
}

export interface RenderBlockInput {
  /** Is operator content (or an emergency) actually on the glass? */
  rendering: boolean;
  /** Past the pairing splash — an unpaired screen has no tenant to report to. */
  paired: boolean;
  /** Current rAF paint counter. */
  frames: number;
  /** The counter value carried by the previous report, or -1 if none. */
  lastReportedFrames: number;
  /** When the last IDLE-lane proof was sent, or 0. */
  lastIdlePostAtMs: number;
  nowMs: number;
  /** Content signature (`pl:` / `em:` / `idle:` / `paused:` …). */
  hash: string;
  /** Diagnostics label — 'playlist' | 'template' | 'emergency' | 'idle' | 'paused'. */
  contentKind: string;
  sync?: TelemetrySyncReport;
}

/**
 * Build the render block, or return null to OMIT it.
 *
 * The three refusals, each of which existed on the standalone render-proof
 * POST and every one of which is load-bearing:
 *
 *   1. AN IDLE UNPAIRED SCREEN reports nothing — there is no tenant for the
 *      proof to be visible to, and no reason to write its row.
 *   2. AN IDLE SCREEN reports at a tenth of the rate, under an `idle:`
 *      hash, so the dashboard says "alive, nothing on screen yet" and never
 *      the green "showing content" a real proof earns.
 *   3. A FROZEN PAINT COUNTER reports NOTHING. This is the one that makes
 *      the whole signal worth having: if the compositor is wedged, omitting
 *      the block lets `lastRenderedAt` go stale and the fleet flags the
 *      screen. Reporting a frozen counter would keep the timestamp fresh
 *      and HIDE the freeze — the exact bug render-proof exists to catch.
 */
export function buildRenderBlock(
  input: RenderBlockInput,
): { block: TelemetryRenderBlock; isIdleLane: boolean } | null {
  const idle = !input.rendering;
  if (idle && !input.paired) return null;
  if (idle && input.nowMs - input.lastIdlePostAtMs < IDLE_PROOF_INTERVAL_MS) return null;
  if (input.frames === input.lastReportedFrames) return null;

  return {
    block: {
      frames: input.frames,
      hash: input.hash.slice(0, 128),
      contentKind: input.contentKind,
      ...(input.sync ? { sync: input.sync } : {}),
    },
    isIdleLane: idle,
  };
}

export interface TelemetryBodyInput {
  /** APK version name, when this device is running inside the APK. */
  playerVersion?: string | null;
  playerVersionCode?: number | null;
  /**
   * Manager APK version. `undefined` = this build has no opinion (the
   * column is left alone). `''` = the EXPLICIT "Manager is not installed"
   * signal that clears the dashboard chip. The two are NOT the same and the
   * distinction has to survive all the way to the column — conflating them
   * is the 2026-04-28 stuck-chip bug.
   */
  managerVersion?: string | null;
  /** This document's page-bundle identity, when the build stamped one. */
  bundleSha?: string | null;
  /**
   * This document's BUNDLE ID — the identity it actually reloads on
   * (2026-09-21). Reported so the dashboard can grade skew on the same value
   * the reload decision is made on; without it, every commit that leaves the
   * client bundle untouched moved the deployed SHA and made an entire healthy
   * fleet read "behind" until the next bundle-changing deploy.
   */
  bundleId?: string | null;
  cache?: { playlist?: TelemetryCacheTier; emergency?: TelemetryCacheTier } | null;
  render?: TelemetryRenderBlock | null;
  /** Durable-REFRESH ack — the exact command VALUE this page acted on. */
  refreshAckMs?: number | null;
  capsHash?: string | null;
  /** The last video's playback sample (dropped frames, and rebuffer pauses
   *  when counted), when there is a new one to report. */
  nativeVideo?: NativeSharedVideoState | null;
  video?: TelemetryVideoReport | null;
  /**
   * Send the per-file evidence keys on `video` (default true). False for a
   * while after an older API refused them — the frame sample still goes.
   */
  videoExtras?: boolean;
  /** The WebView's declared decode capability, once per boot (2026-10-11). */
  mediaCaps?: TelemetryMediaCaps | null;
  /** The loop-boundary summary, when a boundary was observed since the last one (2026-09-29). */
  loop?: Omit<TelemetryLoopReport, 'evidence'> | null;
  /**
   * The large file downloading right now, if any (2026-09-27). Rides inside
   * `cache`, so it is sent only together with the cache tiers — a report
   * never carries a download without the counters it belongs beside.
   */
  download?: DownloadSnapshotInput | null;
  /** Native-first: the readiness source of a v4 face (`cache.source`); null = not sent. */
  cacheSource?: 'store' | 'worker' | null;
  /** The off-hours update this document came up from, once (2026-10-10). */
  update?: TelemetryUpdateReport | null;
}

/** What the page knows about its download (its `largeDownload` state) + the hold. */
export interface DownloadSnapshotInput {
  name: string | null | undefined;
  bytesLoaded: number;
  bytesTotal: number | null | undefined;
  /** `pendingPlaylistCommitRef.current !== null` — the previous content is held on glass. */
  deferredCommit: boolean;
}

/**
 * Assemble the wire body. Every field is omitted rather than sent as null
 * when we have nothing to say — the server's schema is strict, and "absent"
 * vs "explicitly empty" carries meaning for `managerVersion`.
 */
export function buildTelemetryBody(input: TelemetryBodyInput): TelemetryBody {
  const body: TelemetryBody = {};
  if (input.nativeVideo && input.nativeVideo.state !== 'idle') {
    body.nativeVideo = input.videoExtras === false ? withoutNativeExtras(input.nativeVideo) : input.nativeVideo;
  }

  const versions: NonNullable<TelemetryBody['versions']> = {};
  const player = (input.playerVersion ?? '').trim();
  if (player) versions.player = player;
  if (
    typeof input.playerVersionCode === 'number' &&
    Number.isFinite(input.playerVersionCode) &&
    input.playerVersionCode > 0
  ) {
    versions.playerCode = Math.floor(input.playerVersionCode);
  }
  // `undefined` stays absent; `''` is sent as the explicit uninstall signal.
  if (input.managerVersion !== undefined && input.managerVersion !== null) {
    versions.manager = input.managerVersion;
  }
  const bundleSha = (input.bundleSha ?? '').trim();
  if (bundleSha) versions.bundleSha = bundleSha;
  // OMITTED, never sent empty — same rule as every other field here. A build
  // with no stamped bundle id must send no key at all, so the server stores
  // nothing and the dashboard falls back to the SHA comparison.
  const bundleId = (input.bundleId ?? '').trim();
  if (bundleId) versions.bundleId = bundleId;
  if (Object.keys(versions).length > 0) body.versions = versions;

  if (input.cache && (input.cache.playlist || input.cache.emergency)) {
    body.cache = {};
    if (input.cache.playlist) body.cache.playlist = tier(input.cache.playlist);
    if (input.cache.emergency) body.cache.emergency = tier(input.cache.emergency);
    const downloading = buildDownloadReport(input.download);
    if (downloading) body.cache.downloading = downloading;
    if (input.cacheSource === 'store' || input.cacheSource === 'worker') body.cache.source = input.cacheSource;
  }

  if (input.render) body.render = input.render;

  if (typeof input.refreshAckMs === 'number' && Number.isFinite(input.refreshAckMs)) {
    body.refreshAckMs = input.refreshAckMs;
  }

  const capsHash = (input.capsHash ?? '').trim();
  if (capsHash) body.capsHash = capsHash;

  if (input.video) body.video = videoReport(input.video, input.videoExtras !== false);

  if (input.mediaCaps) {
    const m = mediaCapsReport(input.mediaCaps);
    if (m) body.mediaCaps = m;
  }

  if (input.loop) {
    const l = loopReport(input.loop);
    if (l) body.loop = l;
  }

  if (input.update) {
    const u = updateReport(input.update);
    if (u) body.update = u;
  }

  return body;
}

const UPDATE_WINDOWS = new Set(['display-off', 'idle', 'nightly']);
const UPDATE_ZONE_SOURCES = new Set(['schedule', 'device', 'utc']);
const UPDATE_CAPTURES = new Set(['live', 'refetch', 'color', 'none']);
const UPDATE_MAX_MS = 86_400_000;

/** The update block exactly as the server's strict schema accepts it, or null. */
function updateReport(u: TelemetryUpdateReport): TelemetryUpdateReport | null {
  if (!UPDATE_WINDOWS.has(u.window) || !UPDATE_ZONE_SOURCES.has(u.zoneSource) || !UPDATE_CAPTURES.has(u.capture)) return null;
  const id = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : null);
  const ms = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), UPDATE_MAX_MS) : null;
  return {
    fromBundleId: id(u.fromBundleId),
    toBundleId: id(u.toBundleId),
    window: u.window,
    boundary: u.boundary === 'item' ? 'item' : 'now',
    zone: String(u.zone || 'UTC').trim().slice(0, 64) || 'UTC',
    zoneSource: u.zoneSource,
    capture: u.capture,
    blankMs: ms(u.blankMs),
    coverMs: ms(u.coverMs),
    converged: u.converged === true,
  };
}

/**
 * Did the server refuse a report BECAUSE it carried the update block (an API
 * from before the block existed)? The page then keeps the evidence and
 * retries it on a later report, after `LOOP_REPORT_RETRY_MS` — the same
 * ride-out-a-slow-deploy rule as the loop block.
 */
export function updateReportRefused(status: number | null, sent: TelemetryBody): boolean {
  return status === 400 && !!sent.update;
}

/** The server's bounds on the loop-boundary numbers (`telemetry.schema.ts`). */
const LOOP_MAX_MS = 600_000;
const LOOP_MAX_COUNT = 1_000_000_000;

/**
 * The loop block as the server's strict schema accepts it — every number
 * floored and CLAMPED (one value past a bound 400s the WHOLE report, liveness
 * and render proof with it), only the documented keys, the reason capped.
 * Null when there is nothing usable to say.
 */
function loopReport(l: Omit<TelemetryLoopReport, 'evidence'>): TelemetryLoopReport | null {
  if (l.backend !== 'native' && l.backend !== 'twodeck' && l.backend !== 'continuous') return null;
  const n = (v: unknown, hi: number): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), hi) : null;
  const boundaries = n(l.boundaries, LOOP_MAX_COUNT);
  if (boundaries === null) return null;
  const out: TelemetryLoopReport = {
    backend: l.backend,
    evidence: 'rvfc',
    boundaries,
    maxHoldMs: n(l.maxHoldMs, LOOP_MAX_MS) ?? 0,
    p95HoldMs: n(l.p95HoldMs, LOOP_MAX_MS) ?? 0,
    lastHoldMs: n(l.lastHoldMs, LOOP_MAX_MS) ?? 0,
    maxSkipMs: n(l.maxSkipMs, LOOP_MAX_MS) ?? 0,
  };
  const swaps = n(l.swaps, LOOP_MAX_COUNT);
  if (swaps !== null) out.swaps = swaps;
  const fallbacks = n(l.fallbacks, LOOP_MAX_COUNT);
  if (fallbacks !== null) out.fallbacks = fallbacks;
  if (typeof l.fallbackReason === 'string' && l.fallbackReason.trim()) {
    out.fallbackReason = l.fallbackReason.trim().slice(0, 64);
  }
  return out;
}

/**
 * How long the page stops sending the loop block after the API refused one
 * (2026-09-29). NOT the rest of the session: a refusal usually means the API
 * half of a rollout has not landed yet (a queued deploy — Railway had an
 * incident the day this shipped), and a session that gives up for good would
 * report nothing until its next reload, possibly hours. Ten minutes rides out
 * a slow deploy and costs at most one refused report per window.
 */
export const LOOP_REPORT_RETRY_MS = 10 * 60_000;

/** May the loop block go out now? (`blockedUntilMs` is 0 until a refusal.) */
export function loopReportDue(nowMs: number, blockedUntilMs: number): boolean {
  return !(nowMs < blockedUntilMs);
}

/**
 * True when the API 400'd a report that carried the loop block — an API from
 * before it existed refusing the whole strict body. The page then stops sending
 * it for `LOOP_REPORT_RETRY_MS`, and the fast retry lands liveness and proof.
 */
export function loopReportRefused(status: number | null, sent: TelemetryBody): boolean {
  return status === 400 && !!sent.loop;
}

/** The server's bounds on the rebuffer counters (`telemetry.schema.ts`). */
const VIDEO_MAX_STALLS = 1_000_000;
const VIDEO_MAX_STALLED_MS = 86_400_000;

/** Only the documented keys, as bounded non-negative ints — the server's
 *  schema is strict and a stray key would 400 the whole report. */
function videoReport(v: TelemetryVideoReport, extras = true): TelemetryVideoReport {
  const int = (n: unknown): number =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  const out: TelemetryVideoReport = {
    url: String(v.url ?? '').slice(0, 512),
    totalFrames: int(v.totalFrames),
    droppedFrames: Math.min(int(v.droppedFrames), int(v.totalFrames)),
  };
  if (typeof v.elapsedMs === 'number' && Number.isFinite(v.elapsedMs) && v.elapsedMs >= 0) out.elapsedMs = Math.floor(v.elapsedMs);
  if (typeof v.width === 'number' && v.width > 0 && typeof v.height === 'number' && v.height > 0) {
    out.width = Math.floor(v.width);
    out.height = Math.floor(v.height);
  }
  // Rebuffer pauses: CLAMPED to the server's bounds, because one value past
  // them 400s the WHOLE report — liveness and render proof with it. Omitted,
  // never zeroed, when absent or garbage: absent means "not counted".
  const bounded = (n: unknown, hi: number): number | null =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), hi) : null;
  const stalls = bounded(v.stalls, VIDEO_MAX_STALLS);
  if (stalls !== null) out.stalls = stalls;
  const stalledMs = bounded(v.stalledMs, VIDEO_MAX_STALLED_MS);
  if (stalledMs !== null) out.stalledMs = stalledMs;
  if (extras) {
    // Per-file evidence — only well-formed values, each omitted when unknown:
    // one value outside the server's schema would 400 the WHOLE report.
    if (typeof v.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(v.sha256)) out.sha256 = v.sha256.toLowerCase();
    if (v.engine && VIDEO_ENGINES.has(v.engine)) out.engine = v.engine;
    if (typeof v.cached === 'boolean') out.cached = v.cached;
    if (typeof v.first === 'boolean') out.first = v.first;
    const concurrent = bounded(v.concurrent, 64);
    if (concurrent !== null) out.concurrent = concurrent;
  }
  return out;
}

const VIDEO_ENGINES: ReadonlySet<string> = new Set(['native', 'continuous', 'twodeck', 'deck']);
const MEDIA_CAPS_IDS: ReadonlySet<string> = new Set(['1080p30-landscape', '1080p30-portrait', '2160p30-landscape', '2160p30-portrait']);

/** The declared-capability block as the server's strict schema accepts it, or null. */
export function mediaCapsReport(m: TelemetryMediaCaps): TelemetryMediaCaps | null {
  if (!m || !Array.isArray(m.configs)) return null;
  const seen = new Set<string>();
  const configs: TelemetryMediaCaps['configs'] = [];
  for (const c of m.configs) {
    if (!c || !MEDIA_CAPS_IDS.has(c.id) || seen.has(c.id) || configs.length >= 8) continue;
    seen.add(c.id);
    configs.push({ id: c.id, supported: c.supported === true, smooth: c.smooth === true, powerEfficient: c.powerEfficient === true });
  }
  if (configs.length === 0) return null;
  const out: TelemetryMediaCaps = { configs };
  if (typeof m.webviewMajor === 'number' && Number.isFinite(m.webviewMajor) && m.webviewMajor > 0 && m.webviewMajor <= 10_000) {
    out.webviewMajor = Math.floor(m.webviewMajor);
  }
  return out;
}

/** The per-file evidence keys the server learned on 2026-10-11. */
const VIDEO_EXTRA_KEYS = ['sha256', 'engine', 'cached', 'first', 'concurrent'] as const;
/** The native-block keys the server learned on 2026-10-17 (1.1.41): the resolved device class and the experiments. */
const NATIVE_EXTRA_KEYS = ['device', 'experiments'] as const;

const defined = (o: object, k: string): boolean => (o as Record<string, unknown>)[k] !== undefined;

function nativeTimingHasExtras(timing: NativeSharedVideoState['timing']): boolean {
  return !!timing && NATIVE_TIMING_EXTRA_KEYS.some((k) => defined(timing, k));
}

/**
 * The native block as an API from before 1.1.41 accepts it: no device class,
 * no experiments, and only the nine original timing counters. Used while the
 * server refuses the extras (`videoExtrasRefused`), so liveness and render
 * proof keep landing; the measurement resumes when the window ends.
 */
export function withoutNativeExtras(n: NativeSharedVideoState): NativeSharedVideoState {
  const out: NativeSharedVideoState = { ...n };
  delete out.device;
  delete out.experiments;
  if (n.timing) {
    const { decodedFrames, submittedFrames, lateFrames, lastLateUs, maxLateUs, maxSubmitGapMs, leadUs, sourceWidth, sourceHeight } = n.timing;
    out.timing = { decodedFrames, submittedFrames, lateFrames, lastLateUs, maxLateUs, maxSubmitGapMs, leadUs, sourceWidth, sourceHeight };
  }
  return out;
}

/**
 * Should the page hold the per-file evidence keys back for a while? Yes when
 * the server answered 400 to a report whose `video` carried any of them: an
 * API from before them rejects the whole strict body. The frame sample keeps
 * going without them, so liveness and render proof land on the retry.
 */
export function videoExtrasRefused(status: number | null, sent: TelemetryBody): boolean {
  if (status !== 400) return false;
  if (!!sent.video && VIDEO_EXTRA_KEYS.some((k) => k in (sent.video as object))) return true;
  // Protocol 3 (2026-10-12): the native block's `protocol` / `zones` are
  // extras too — an older API's strict schema refuses them the same way.
  // 1.1.41: so are the device class, the experiments and the timing measurement.
  if (!sent.nativeVideo) return false;
  if ('protocol' in sent.nativeVideo || 'zones' in sent.nativeVideo || 'drops' in sent.nativeVideo) return true;
  if (NATIVE_EXTRA_KEYS.some((k) => defined(sent.nativeVideo!, k))) return true;
  return nativeTimingHasExtras(sent.nativeVideo.timing);
}

/** Same self-heal for the declared-capability block. */
export function mediaCapsRefused(status: number | null, sent: TelemetryBody): boolean {
  return status === 400 && !!sent.mediaCaps;
}

/**
 * The download snapshot as the server's strict schema accepts it, or null to
 * send none. Only the four documented keys; the name capped; counts as
 * non-negative ints; the size omitted until it is known (never 0); and never
 * more bytes than the file has — the dashboard divides the two.
 */
export function buildDownloadReport(
  input: DownloadSnapshotInput | null | undefined,
): TelemetryDownloadReport | null {
  if (!input) return null;
  const loaded = input.bytesLoaded;
  if (typeof loaded !== 'number' || !Number.isFinite(loaded) || loaded < 0) return null;
  const totalRaw = input.bytesTotal;
  const total =
    typeof totalRaw === 'number' && Number.isFinite(totalRaw) && totalRaw > 0
      ? Math.min(Math.floor(totalRaw), Number.MAX_SAFE_INTEGER)
      : null;
  const bytesLoaded = Math.min(Math.floor(loaded), total ?? Number.MAX_SAFE_INTEGER);
  const out: TelemetryDownloadReport = {
    file: String(input.name ?? '').trim().slice(0, DOWNLOAD_FILE_MAX_CHARS),
    bytesLoaded,
    deferredCommit: input.deferredCommit === true,
  };
  if (total !== null) out.bytesTotal = total;
  return out;
}

/**
 * Should the page stop sending the download snapshot for the rest of its
 * session? Yes when the server answered 400 to a report that CARRIED one: an
 * API from before the snapshot existed rejects the whole strict body, and
 * every report after it would fail the same way — losing liveness and render
 * proof along with the progress. Dropping the optional block is the self-heal;
 * a 400 that persists without it was never about the snapshot.
 */
export function downloadReportRefused(status: number | null, sent: TelemetryBody): boolean {
  return status === 400 && !!sent.cache?.downloading;
}

/** Same self-heal for native-first's `cache.source`: a 400 that carried it stops it for the session. */
export function cacheSourceRefused(status: number | null, sent: TelemetryBody): boolean {
  return status === 400 && !!sent.cache?.source;
}

/** Only the two counters, only as non-negative ints — the server's schema
 *  is strict and a stray key would 400 the whole report. */
function tier(t: TelemetryCacheTier): TelemetryCacheTier {
  const int = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  return { count: int(t.count), bytes: int(t.bytes) };
}

/** Map an HTTP result (or a thrown fetch) onto the outcome the scheduler
 *  reasons about. Kept here so the page and the tests agree on it. */
export function outcomeFromStatus(status: number | null): TelemetryOutcome {
  if (status === null) return 'failed'; // network error / abort
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401) return 'unauthorized';
  if (status === 429) return 'throttled';
  return 'failed';
}
