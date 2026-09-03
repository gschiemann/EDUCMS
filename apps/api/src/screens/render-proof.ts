/**
 * Render-proof fleet-status helpers (2026-05-29).
 *
 * The #1 player-reliability gap: a frozen kiosk still answers TCP reads, so
 * `lastPingAt` stays fresh and the screen shows ONLINE/green on the fleet map
 * while it is actually displaying a stuck or black frame. `lastPingAt` proves
 * "TCP-reachable + JS event loop alive"; it does NOT prove "pixels painting."
 *
 * The player advances a requestAnimationFrame-driven paint counter that only
 * increments when the browser/WebView actually composites a frame, and POSTs
 * it (+ a content signature) to /screens/:id/render-proof every ~30s WHILE it
 * is rendering content. `lastRenderedAt` is the server clock at the last such
 * POST. When that timestamp is stale EVEN THOUGH `lastPingAt` is fresh, the
 * renderer is wedged → degraded/RED.
 *
 * This module is a pure function so it can be unit-tested without a Prisma
 * client (same discipline as ScreenWedgeDetectorCron.decide).
 *
 * IMPORTANT — additive, never reinterprets `status`:
 *   `renderHealth` is a SEPARATE field. The existing ONLINE/OFFLINE/PENDING/
 *   REVOKED `status` semantics are untouched, so the dashboard map's
 *   `status !== 'ONLINE' ⇒ OFFLINE` logic keeps working unchanged. A frozen
 *   screen is NOT offline (it's reachable) — it's `status: ONLINE` +
 *   `renderHealth: STALE`. UIs that want the true frozen signal read
 *   `renderHealth`; UIs that don't are unaffected.
 */

/** Render-proof health for a screen, derived from lastRenderedAt recency. */
export type RenderHealth = 'OK' | 'STALE' | 'UNKNOWN';

/**
 * Default render-proof staleness window. The player POSTs render-proof every
 * ~30s while rendering; this allows ~3 missed posts before flagging STALE,
 * matching the 35s `lastPingAt` ONLINE grace used by the fleet list so the
 * two signals are read on a comparable cadence. Generous enough to ride out
 * a single network jitter / a content-swap pause without false RED.
 */
export const RENDER_PROOF_STALE_MS = 90 * 1000;

/**
 * Staleness window for an IDLE screen's proof — one with nothing scheduled.
 *
 * ⚠️ 2026-09-03 REGRESSION THIS EXISTS TO CLOSE. The unified-telemetry wave
 * gave idle screens their own, much slower proof cadence
 * (`IDLE_PROOF_INTERVAL_MS` = 5 min in `apps/web/src/app/player/telemetry.ts`:
 * "idle screens prove liveness at a tenth of a playing screen's rate") while
 * this server kept judging every proof against the 90 s playing window. So a
 * perfectly healthy screen with no playlist assigned went STALE roughly three
 * and a half minutes out of every five and the district inbox filled with
 * "No picture confirmed" for screens whose only sin was having nothing to
 * play. The operator called it: "just because I haven't pushed content?"
 *
 * 11 minutes = two full idle cadences plus jitter, so ONE dropped idle post
 * is inside the window and a genuinely frozen idle screen still goes red.
 * Keep this at ≥ 2× `IDLE_PROOF_INTERVAL_MS`; if that cadence ever changes,
 * this must move with it (`renderProof.idleWindow.spec.ts` pins the ratio).
 */
export const IDLE_RENDER_PROOF_STALE_MS = 11 * 60 * 1000;

/**
 * Prefix the player stamps on a proof it posts while idle — nothing
 * scheduled, so the "picture" it is proving is its own waiting screen.
 * Mirrors `IDLE_PROOF_PREFIX` in apps/web/src/components/screens/renderTrust.ts.
 */
export const IDLE_PROOF_HASH_PREFIX = 'idle:';

/** Which window applies to this proof — playing screens are judged faster. */
export function staleWindowFor(lastRenderedHash: string | null | undefined): number {
  return typeof lastRenderedHash === 'string' &&
    lastRenderedHash.startsWith(IDLE_PROOF_HASH_PREFIX)
    ? IDLE_RENDER_PROOF_STALE_MS
    : RENDER_PROOF_STALE_MS;
}

export interface RenderProofInput {
  /** The proof's hash, when known. Only its `idle:` prefix is read, to pick
   *  the staleness window — see `staleWindowFor`. Absent → playing window. */
  lastRenderedHash?: string | null;

  /** Is the player even expected to be rendering right now? Only screens that
   *  are paired AND TCP-alive (status ONLINE / fresh ping) are candidates for
   *  a render-stale verdict — an OFFLINE box obviously isn't painting and is
   *  already flagged by the existing ping-age path; we must not double-count
   *  it as a render freeze. */
  isLiveOnline: boolean;
  /** Server clock (ms) when the most recent render-proof POST landed, or null
   *  if the screen has never reported one (older player build, or just paired). */
  lastRenderedAtMs: number | null;
  /** Current time (ms). */
  nowMs: number;
  /** Optional override of the staleness window (tests). */
  staleMs?: number;
}

export interface RenderProofResult {
  /** OK = painting recently; STALE = reachable but not painting (RED signal);
   *  UNKNOWN = no render-proof reported yet (don't alarm — older build / fresh pair). */
  renderHealth: RenderHealth;
  /** Seconds since the last render-proof, or null if never reported. */
  renderStaleSeconds: number | null;
  /** Convenience boolean: the load-bearing "frozen but reachable" verdict.
   *  TRUE only when the screen IS live-online yet hasn't painted within the
   *  window — i.e. fresh ping alone never makes this true. */
  renderStale: boolean;
}

/**
 * Derive render-proof health for a single screen.
 *
 * Rules (pure, deterministic):
 *   - Not live-online → renderHealth UNKNOWN (the ping path owns the verdict;
 *     a non-reachable screen can't be "frozen but reachable").
 *   - Live-online + never reported render-proof → UNKNOWN (don't alarm;
 *     older player builds and freshly-paired screens haven't reported yet).
 *   - Live-online + render-proof fresh (< window) → OK.
 *   - Live-online + render-proof stale (>= window) → STALE  ← RED / degraded.
 *
 * The key property the test pins: a FRESH PING ALONE (lastRenderedAtMs = null,
 * or stale) does NOT by itself flip a screen to OK — only an actual recent
 * render-proof does. And a stale render-proof on a live-online screen DOES
 * flip it to STALE/RED even though its ping is fresh.
 */
export function deriveRenderHealth(input: RenderProofInput): RenderProofResult {
  const staleMs = input.staleMs ?? staleWindowFor(input.lastRenderedHash);

  const renderStaleSeconds =
    input.lastRenderedAtMs != null
      ? Math.max(0, Math.round((input.nowMs - input.lastRenderedAtMs) / 1000))
      : null;

  // A screen that isn't reachable (offline / unpaired / pending) is already
  // covered by the ping-age path; render-proof has no opinion → UNKNOWN.
  if (!input.isLiveOnline) {
    return { renderHealth: 'UNKNOWN', renderStaleSeconds, renderStale: false };
  }

  // Reachable but never reported a render-proof → can't claim frozen.
  if (input.lastRenderedAtMs == null) {
    return { renderHealth: 'UNKNOWN', renderStaleSeconds: null, renderStale: false };
  }

  const ageMs = input.nowMs - input.lastRenderedAtMs;
  if (ageMs >= staleMs) {
    // Reachable (fresh ping) but pixels have NOT advanced → the worst
    // live-game failure: looks online, shows nothing. Surface RED.
    return { renderHealth: 'STALE', renderStaleSeconds, renderStale: true };
  }

  return { renderHealth: 'OK', renderStaleSeconds, renderStale: false };
}
