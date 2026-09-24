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
  cache?: { playlist?: TelemetryCacheTier; emergency?: TelemetryCacheTier };
  render?: TelemetryRenderBlock;
  refreshAckMs?: number;
  capsHash?: string;
  video?: TelemetryVideoReport;
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
  /** The last video's dropped-frame sample, when there is a new one to report. */
  video?: TelemetryVideoReport | null;
}

/**
 * Assemble the wire body. Every field is omitted rather than sent as null
 * when we have nothing to say — the server's schema is strict, and "absent"
 * vs "explicitly empty" carries meaning for `managerVersion`.
 */
export function buildTelemetryBody(input: TelemetryBodyInput): TelemetryBody {
  const body: TelemetryBody = {};

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
  }

  if (input.render) body.render = input.render;

  if (typeof input.refreshAckMs === 'number' && Number.isFinite(input.refreshAckMs)) {
    body.refreshAckMs = input.refreshAckMs;
  }

  const capsHash = (input.capsHash ?? '').trim();
  if (capsHash) body.capsHash = capsHash;

  if (input.video) body.video = videoReport(input.video);

  return body;
}

/** Only the documented keys, as bounded non-negative ints — the server's
 *  schema is strict and a stray key would 400 the whole report. */
function videoReport(v: TelemetryVideoReport): TelemetryVideoReport {
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
  return out;
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
