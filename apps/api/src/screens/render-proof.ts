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

export interface RenderProofInput {
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
  const staleMs = input.staleMs ?? RENDER_PROOF_STALE_MS;

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
