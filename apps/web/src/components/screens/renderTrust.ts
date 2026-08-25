/**
 * renderTrust.ts — render-proof trust derivation for the Screens list
 * (2026-08-24).
 *
 * ── Why this exists ──────────────────────────────────────────────────
 * The industry's #1 signage complaint is "is my screen actually showing
 * the right thing?" — and the ONLINE/OFFLINE badge on the Screens list
 * cannot answer it. That badge is derived from `Screen.lastPingAt`, which
 * only proves "TCP-reachable + JS event loop alive." A kiosk whose
 * renderer has wedged (crashed React tree, stuck/black frame, frozen
 * compositor) keeps answering the heartbeat, so it stays ONLINE/green
 * forever while the board is actually dead.
 *
 * `GET /screens` (apps/api/src/screens/screens.controller.ts `list()`)
 * already carries a SEPARATE, additive render-proof verdict per screen —
 * computed server-side by `deriveRenderHealth`
 * (apps/api/src/screens/render-proof.ts) from a requestAnimationFrame
 * paint counter the player POSTs every ~30s WHILE it is actually
 * compositing frames:
 *
 *   - `renderHealth`: 'OK' | 'STALE' | 'UNKNOWN'
 *   - `renderStale`:  boolean — TRUE only for the load-bearing
 *                      "frozen but reachable" case.
 *   - `renderStaleSeconds` / `lastRenderedAt`: age of the last proven paint.
 *
 * This module joins that verdict with the screen's live `status` into ONE
 * display variant for the Screens list, mirroring the precedent already
 * shipped for the sports Run-mode health pills
 * (apps/web/src/app/[schoolId]/sports/[gameId]/surface-health.ts) — same
 * precedence, same "never false-alarm UNKNOWN" discipline, adapted for a
 * fleet list instead of a per-game assignment.
 *
 * Pure function — no React, no network, no wall-clock dependency in the
 * primary path (the server already did that math). Unit-testable without
 * mounting the 3000-line Screens page.
 */

/** Render-proof verdict as the fleet list (`GET /screens`) reports it. */
export type RenderHealth = 'OK' | 'STALE' | 'UNKNOWN';

/**
 * Mirrors the API's `RENDER_PROOF_STALE_MS`
 * (apps/api/src/screens/render-proof.ts) — the ~90s window (3 missed
 * ~30s render-proof posts) after which a live-online screen with no fresh
 * paint proof is flagged STALE/RED.
 *
 * The server is the source of truth: every row from `GET /screens` already
 * carries a PRECOMPUTED `renderHealth` verdict, so `deriveRenderTrust`
 * below prefers that field and never re-derives it when present. This
 * constant only backs the FALLBACK path — a defensive recompute from a raw
 * `lastRenderedAt` timestamp for the rare case a row is missing the
 * precomputed field (e.g. a caller that hasn't threaded it through yet).
 * Not an operator-facing setting; if the server's window ever changes,
 * update this to match it.
 */
export const RENDER_STALE_AFTER_MS = 90_000;

/** Display variant for the Screens-list render-trust line. */
export type RenderTrustVariant =
  | 'painting' // green, quiet — proof of a recent paint
  | 'not-painting' // THE money state — reachable but no proof of painting
  | 'unknown' // quiet neutral — no render-proof reported yet (never an alarm)
  | 'offline'; // screen isn't live-online — render-proof has no opinion;
  //              the existing OFFLINE/PENDING/REVOKED treatment owns this,
  //              so callers should render NOTHING for this variant rather
  //              than stacking a second message next to it.

export interface RenderTrustInput {
  /** Live-computed `Screen.status` as the fleet list reports it
   *  (ONLINE / OFFLINE / PENDING / REVOKED) — NOT the raw DB column when a
   *  caller has access to the recomputed one, though in practice both
   *  `GET /screens` and `GET /screen-groups` already recompute it the same
   *  way before this ever runs. */
  status?: string | null;
  /** Precomputed verdict from the fleet list, when available. */
  renderHealth?: RenderHealth | null;
  /** Precomputed "frozen but reachable" boolean from the fleet list. */
  renderStale?: boolean | null;
  /** Fallback-path only: server clock (ms) of the last render-proof POST,
   *  consulted ONLY when `renderHealth` is absent. */
  lastRenderedAtMs?: number | null;
  /** Fallback-path only: current time (ms). Defaults to `Date.now()`. */
  nowMs?: number;
}

/**
 * Derive the render-trust display variant for one screen row.
 *
 * Precedence (deliberate, mirrors `surface-health.ts::toPillStatus`):
 *   1. status !== ONLINE        → 'offline' (unreachable; render-proof has
 *                                  no say — the ping path already owns
 *                                  this screen's message).
 *   2. renderStale === true, OR
 *      renderHealth === 'STALE' → 'not-painting' (RED — the money state:
 *                                  reachable but pixels have NOT advanced).
 *   3. renderHealth === 'OK'    → 'painting' (GREEN — earned by proof).
 *   4. renderHealth === 'UNKNOWN' (explicitly reported as such) → 'unknown'.
 *   5. renderHealth absent entirely → fallback: recompute from
 *      `lastRenderedAtMs`/`nowMs` using `RENDER_STALE_AFTER_MS`, so a row
 *      that hasn't been threaded through the precomputed field yet still
 *      gets a real verdict instead of silently going quiet forever.
 *
 * A fresh ping ALONE never produces 'painting' — only positive, recent
 * render-proof does. Never mis-derives 'not-painting' (an alarm) for an
 * unreported/absent signal — that's what keeps UNKNOWN from crying wolf on
 * an older player build or a screen that just paired.
 */
export function deriveRenderTrust(input: RenderTrustInput): RenderTrustVariant {
  if (input.status !== 'ONLINE') return 'offline';

  if (input.renderStale === true) return 'not-painting';
  if (input.renderHealth === 'STALE') return 'not-painting';
  if (input.renderHealth === 'OK') return 'painting';
  if (input.renderHealth === 'UNKNOWN') return 'unknown';

  // renderHealth wasn't provided at all — fallback recompute so the UI
  // still gives a real verdict rather than silently going quiet.
  if (input.lastRenderedAtMs == null) return 'unknown';
  const now = input.nowMs ?? Date.now();
  return now - input.lastRenderedAtMs >= RENDER_STALE_AFTER_MS ? 'not-painting' : 'painting';
}
