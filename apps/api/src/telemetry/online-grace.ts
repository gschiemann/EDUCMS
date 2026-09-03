import { TELEMETRY_INTERVAL_MS } from './telemetry.types';

/**
 * online-grace.ts — how stale `Screen.lastPingAt` may be before the fleet
 * calls a screen OFFLINE.
 *
 * ⚠️ THIS CONSTANT IS PAIRED WITH THE TELEMETRY CADENCE. Read this before
 * changing either number; they are one decision, not two.
 *
 * ── WHY IT MOVED (2026-09-02, efficiency program P0-1) ──────────────────
 * It was 35 s, inline in three places in `screens.controller.ts` and a
 * fourth in `fleet-pulse.cron.ts`, and the comment beside it named the
 * reason: "Heartbeat cadence is 30s; grace is tightened to 35s so a dead
 * player flips OFFLINE ~5s after its first missed ping."
 *
 * The efficiency wave changed that premise. A screen no longer pings every
 * 30 s from two processes on four overlapping timers — it sends ONE
 * telemetry POST per minute (the audit's own acceptance criterion: "no more
 * than one normal telemetry POST per screen per minute"). A 60 s cadence
 * against a 35 s grace is not a tuning question, it is a contradiction:
 * every healthy screen in the fleet would read OFFLINE roughly half the
 * time. So the grace has to move with the cadence, and it has to move in
 * ONE place that names the relationship.
 *
 * ── HOW THE VALUE IS DERIVED ────────────────────────────────────────────
 *   60 s  the telemetry cadence (TELEMETRY_INTERVAL_MS)
 * + 15 s  the client's fast retry after a transient failure
 *         (TELEMETRY_RETRY_MS in apps/web/src/app/player/telemetry.ts —
 *         deliberately much shorter than the cadence for exactly this
 *         reason: one dropped post must not read as a dead screen)
 * + 25 s  slack for network jitter and clock skew
 * = 100 s
 *
 * A screen that misses one post recovers at ~75 s and never flips. A screen
 * that is genuinely gone flips at ~100 s, and with the dashboard's 10 s
 * refetch an operator sees OFFLINE within ~110 s.
 *
 * ── THE COST, STATED PLAINLY ────────────────────────────────────────────
 * Worst-case "device dies → operator sees OFFLINE" goes from ~45 s to
 * ~110 s. That is a real regression in detection speed and it is the price
 * of the traffic reduction; it is not hidden anywhere else in this wave.
 * What it does NOT affect: emergency delivery (signed WS push and the
 * manifest, neither of which consults this), the render-proof freeze
 * verdict (its own 90 s window on `lastRenderedAt`), or the wedge detector
 * (its own 90 s PING_FRESH_MS, which a 60 s cadence still clears).
 *
 * If the fleet ever needs sub-minute offline detection again, the answer is
 * a push-channel liveness signal (`lastPushConnectedAt` already exists),
 * NOT a faster poll — polling every screen every 30 s to learn that almost
 * none of them died is exactly what this wave removed.
 */
export const SCREEN_ONLINE_GRACE_MS = 100 * 1000;

/**
 * The cadence this grace was sized against, re-exported so the invariant
 * can be asserted executably rather than left to a comment. A cadence
 * change that outruns the grace turns the whole fleet OFFLINE — see the
 * assertion in `telemetry.spec.ts`.
 */
export const TELEMETRY_CADENCE_FOR_GRACE_MS = TELEMETRY_INTERVAL_MS;
