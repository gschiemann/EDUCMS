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
  /**
   * `Screen.lastRenderedHash` — the content signature of the most recent
   * render-proof (2026-08-25, v1.1.6).
   *
   * The player now proves liveness while it is showing its OWN idle /
   * waiting screen, because a freshly-paired panel with no schedule used to
   * report NOTHING and the chip went silent on a brand-new install — which,
   * after the 2026-08-25 field night, the operator reads as breakage.
   *
   * ⚠️ AN IDLE PROOF IS NOT A CONTENT PROOF, and this field is what keeps
   * the two apart. Idle posts carry an `idle:` prefix; without reading it,
   * `renderHealth: OK` would render the green "Rendering ✓" over a panel
   * with nothing scheduled on it, and the word would stop meaning anything.
   */
  lastRenderedHash?: string | null;
  /**
   * `Screen.authState` — the SERVER's credential-trust verdict, stamped at
   * register time (2026-08-30 reliability program): 'PROVEN' |
   * 'REPAIR_REQUIRED' | null (pre-column rows). A REPAIR_REQUIRED screen
   * may be painting happily on renewed 1-hour temporary tokens — which is
   * exactly why a green chip alone would be a lie: its trusted credential
   * is gone and only an operator re-pair restores it. G43 spent 37 hours
   * "ONLINE" in this state with nobody told.
   */
  authState?: string | null;
}

/** Prefix the player stamps on a liveness-only (no operator content) proof. */
export const IDLE_PROOF_PREFIX = 'idle:';

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

// ── ALARM GRADING (2026-08-25, same field night the chip shipped) ────────
// Operator, hours after launch: "why do i get these bright ass red alerts
// all the time now." The 90s server window is the right FRESHNESS bound but
// the wrong ALARM bound — three distinct realities were all wearing the one
// red chip:
//   • a page reload (refresh push, OTA, nav) pauses proof for ~1-3 min —
//     transient, self-healing, not an incident;
//   • the true frozen-kiosk signature — WAS painting recently, stopped, and
//     stayed stopped — the only state that deserves red;
//   • chronic absence (a build that stopped posting weeks ago, an idle
//     screen) — a documented condition, not a siren.
// A trust feature that cries wolf trains the operator to ignore the one red
// that matters, so staleness now grades by AGE of the last proof.

/** Stale-but-younger than this → 'checking' (soft, self-healing window). */
export const RENDER_ALARM_AFTER_MS = 5 * 60_000;
/** Stale-and-older than this → 'stale-chronic' (calm history, not alarm). */
export const RENDER_CHRONIC_AFTER_MS = 48 * 3600_000;

export type RenderTrustGrade =
  | RenderTrustVariant
  | 'checking' // stale < 5min — reload/OTA gap; soft amber, no siren
  | 'stale-chronic' // stale > 48h — "no proof since <date>", quiet neutral
  /**
   * Painting, but painting its OWN waiting screen (2026-08-25, v1.1.6).
   *
   * The panel is demonstrably alive — a real rAF paint counter, freshly
   * reported — and there is simply no operator content scheduled on it yet.
   * That is the correct reading of a brand-new install, and it is a
   * different fact from both "showing your content" and "we have no idea".
   */
  | 'idle'
  /**
   * Reachable — possibly even painting — but the server downgraded this
   * device's credential and an operator re-pair is required
   * (2026-08-30 reliability program; `Screen.authState`). Overrides the
   * green states ONLY: an alarm state (not-painting / checking) is a worse,
   * more actionable fact and keeps precedence; 'offline' keeps precedence
   * because the ping path owns that message.
   */
  | 'repair-required';

/**
 * Grade the variant by how long the proof has been missing. Falls back to
 * plain 'not-painting' when no timestamp is available to grade with — an
 * ungradable stale keeps the loud treatment rather than hiding a possible
 * real freeze.
 */
export function deriveRenderTrustGrade(
  input: RenderTrustInput,
): RenderTrustGrade {
  const base = deriveRenderTrust(input);
  // Credential trust outranks the GREEN/quiet states (2026-08-30): a screen
  // painting on downgraded 1-hour tokens must not wear an unqualified green.
  // Alarm states below keep precedence — "not painting" is the more urgent
  // fact — and 'offline' keeps its existing treatment.
  if (
    input.authState === 'REPAIR_REQUIRED' &&
    (base === 'painting' || base === 'unknown')
  ) {
    return 'repair-required';
  }
  // A FRESH proof that is tagged idle is 'idle', never 'painting'. Only the
  // green state is reinterpreted: a STALE idle proof still grades through
  // the staleness ladder below, because a panel that stopped painting its
  // own waiting screen is exactly as wedged as one that stopped painting a
  // playlist.
  if (
    base === 'painting' &&
    typeof input.lastRenderedHash === 'string' &&
    input.lastRenderedHash.startsWith(IDLE_PROOF_PREFIX)
  ) {
    return 'idle';
  }
  if (base !== 'not-painting') return base;
  if (input.lastRenderedAtMs == null) return 'not-painting';
  const age = (input.nowMs ?? Date.now()) - input.lastRenderedAtMs;
  if (age < RENDER_ALARM_AFTER_MS) return 'checking';
  if (age > RENDER_CHRONIC_AFTER_MS) return 'stale-chronic';
  return 'not-painting';
}
