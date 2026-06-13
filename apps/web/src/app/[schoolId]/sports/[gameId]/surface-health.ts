/**
 * surface-health — render-proof status derivation for SurfaceHealthPills.
 *
 * ── The bug this closes (audit P1) ──────────────────────────────────
 * The Run-mode health pills used to read ONLY the raw device
 * `Screen.status` (ONLINE / OFFLINE). That field is derived from
 * `lastPingAt`, which proves "TCP-reachable + JS event loop alive" — it
 * does NOT prove "pixels are painting." A kiosk whose renderer is wedged
 * (crashed React tree / black frame / frozen on the last good frame)
 * keeps answering the heartbeat, so its `Screen.status` stays ONLINE and
 * the pill stayed GREEN for 5-7 minutes after the board actually died —
 * the operator was told all was well while the crowd watched a dead screen.
 *
 * ── The render-proof signal (already shipped, no new API) ───────────
 * `GET /screens` (the fleet list the dashboard already polls every 10s via
 * `useScreens()`) carries a SEPARATE, additive render-proof verdict per
 * screen, computed server-side by `deriveRenderHealth`
 * (apps/api/src/screens/render-proof.ts):
 *
 *   - `renderHealth`: 'OK' | 'STALE' | 'UNKNOWN'
 *   - `renderStale`:  boolean — TRUE only for the load-bearing
 *                     "frozen-but-reachable" case (fresh ping, stale paint).
 *   - `renderStaleSeconds`: seconds since the player last proved a paint.
 *
 * The player advances a requestAnimationFrame paint counter that increments
 * ONLY when the WebView actually composites a frame, and POSTs it to
 * `/screens/:id/render-proof` every ~30s WHILE rendering. The server flags
 * STALE after ~90s of no proof (RENDER_PROOF_STALE_MS) — 3 missed posts.
 *
 * ── What this module does ───────────────────────────────────────────
 * Join the fleet render-proof verdict into each pill BY SCREEN id and
 * compute a render-proof-aware `PillStatus`. A screen that is showing the
 * game but whose paint has gone stale flips out of GREEN to a distinct
 * `'frozen'` state within ~90s + one 10s poll — instead of 5-7 minutes.
 * Green is earned ONLY by positive, recent proof the surface is painting
 * (renderHealth OK), or by the explainable no-proof case (UNKNOWN: an older
 * player build / a just-paired screen that hasn't reported yet) — we do NOT
 * false-alarm UNKNOWN to RED, but we DO surface it as a distinct "no proof"
 * pill so the operator is never told "live" without evidence.
 *
 * Pure functions — unit-testable without React, same discipline as
 * render-proof.ts and cts-merge.ts.
 */

/**
 * Health states for a screen pill. `frozen` is the render-proof addition —
 * reachable (ONLINE) and assigned this game, but pixels have NOT advanced.
 * `live-unverified` is ONLINE + assigned but the player has never reported a
 * paint (older build / fresh pair) — we can't prove it's painting, so we do
 * NOT claim green, but we also don't cry wolf with RED.
 */
export type PillStatus =
  | 'online-showing' // 🟢 ONLINE + showing this game + PAINTING (render-proof OK)
  | 'live-unverified' // 🟢? ONLINE + showing this game but no paint proof yet
  | 'frozen' // 🔴 ONLINE (reachable) + showing this game but NOT painting → dead board
  | 'online-off' // ⚪ ONLINE but not showing this game
  | 'showing-other' // 🟡 ONLINE + showing a DIFFERENT game
  | 'offline' // 🔴 OFFLINE (unreachable)
  | 'unknown'; // ⚫ status unknown / pending

/** Render-proof verdict as the fleet list (`GET /screens`) reports it. */
export type RenderHealth = 'OK' | 'STALE' | 'UNKNOWN';

/** The subset of a fleet-list screen row this module reads. */
export interface RenderProofSignal {
  /** 'OK' painting recently · 'STALE' reachable-but-frozen · 'UNKNOWN' no proof yet. */
  renderHealth?: RenderHealth | null;
  /** Load-bearing "frozen but reachable" boolean (fresh ping + stale paint). */
  renderStale?: boolean | null;
  /** Seconds since the last proven paint, or null when never reported. */
  renderStaleSeconds?: number | null;
}

/** Raw per-screen fields off the `/sports/games/:id/screens` payload. */
export interface ScreenAssignment {
  status: string; // raw Screen.status (ONLINE/OFFLINE/PENDING/REVOKED)
  showing: boolean; // is THIS game assigned to the surface?
  showingOther: boolean; // is a DIFFERENT game assigned?
}

/**
 * Derive the render-proof-aware pill status.
 *
 * Precedence (deliberate):
 *   1. status !== ONLINE          → 'offline' (unreachable; render-proof has no say).
 *   2. showing a different game   → 'showing-other'.
 *   3. not showing this game      → 'online-off'.
 *   4. showing this game:
 *        - render STALE/frozen    → 'frozen'           (RED — was the silent failure).
 *        - render OK               → 'online-showing'   (GREEN — earned by proof).
 *        - render UNKNOWN / absent → 'live-unverified'  (no proof — don't claim green,
 *                                                        don't cry wolf).
 *
 * `proof` is the matching fleet-list render-proof signal for this screen, or
 * null when the screen isn't in the fleet list yet (treated as UNKNOWN).
 */
export function toPillStatus(
  assignment: ScreenAssignment,
  proof: RenderProofSignal | null | undefined,
): PillStatus {
  if (assignment.status !== 'ONLINE') return 'offline';
  if (assignment.showingOther) return 'showing-other';
  if (!assignment.showing) return 'online-off';

  // Showing this game AND reachable — now demand render proof.
  const health = proof?.renderHealth ?? null;
  // `renderStale` is the authoritative frozen-but-reachable flag; fall back
  // to renderHealth === 'STALE' if only that came through.
  if (proof?.renderStale === true || health === 'STALE') return 'frozen';
  if (health === 'OK') return 'online-showing';
  // 'UNKNOWN', null, or anything else: reachable + assigned, but we have NO
  // positive proof it's painting. Don't claim live; don't false-alarm.
  return 'live-unverified';
}
