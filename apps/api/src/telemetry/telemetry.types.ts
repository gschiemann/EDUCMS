/**
 * telemetry.types.ts — the wire contract for the unified player telemetry
 * POST (2026-09-02, efficiency program P0-1).
 *
 * ── WHY ONE POST ────────────────────────────────────────────────────────
 * A fully-active screen used to send SEVEN separate routine reports:
 *
 *   GET  /screens/status/:fp          native APK, every 30 s
 *   GET  /screens/status/:fp          web bundle, every 30 s (always-on)
 *   GET  /screens/status/:fp          web bundle, every 45 s (WS effect)
 *   POST /screens/:id/cache-status    every 30 s
 *   POST /screens/:id/render-proof    every 30 s
 *   GET  /player/latest-version-public every 60 s
 *   GET  /api/build-info              every ~5 min (Vercel)
 *
 * Every one of them writes or reads the SAME `Screen` row. The efficiency
 * audit measured ~93 % of production API traffic as player maintenance,
 * and `screens` had accumulated ~3.6 M row updates. This endpoint carries
 * all of the routine facts in ONE device-authenticated POST per screen per
 * minute.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────
 * It is NOT an emergency path and NOT proof that content is advancing.
 * Player rule 5 (never equate signals) applies literally here: a telemetry
 * POST landing proves the JS event loop ran and the credential is good. The
 * ONLY field in this payload that can claim pixels moved is `render.frames`,
 * and the client is required to withhold the whole `render` block when that
 * counter has not advanced — exactly as the standalone render-proof POST
 * does today. Emergency reconciliation stays on the manifest / emergency-rev
 * path; nothing here may ever raise or release an alert.
 *
 * ── FIELDS ARE ACCEPTED ONLY IF THEY LAND SOMEWHERE ────────────────────
 * Every block below maps to a `Screen` column that an existing endpoint
 * already writes, or to a value in the RESPONSE that the player acts on.
 * Facts the efficiency audit listed that have NO column today (playlist
 * item index, watchdog counters, an error ring) are deliberately NOT in
 * this contract: an endpoint that accepts data it silently drops is how a
 * dashboard starts lying. See `docs/research/2026-09-02-efficiency-audit/
 * 1B-telemetry.md` for the list and what adding them would cost.
 */

/**
 * ⚠️ THE BODY SHAPE LIVES IN `telemetry.schema.ts`, not here. It is a zod
 * `strictObject` (lead security addendum, 2026-09-02): unknown keys are
 * REJECTED rather than ignored, every string is length-bounded and every
 * number range-bounded at the boundary, and `ScreenTelemetryBody` is
 * INFERRED from that schema so the compiler cannot let the documented type
 * and the enforced type drift apart. The prose below explains each block;
 * the schema is what runs.
 *
 * Blocks and where each lands (the full map is in the controller's
 * `TELEMETRY_COLUMNS`):
 *
 *   versions.player / .playerCode  → playerVersion / At / Code (+ the
 *                                     pending-push clear on a code bump)
 *   versions.manager               → managerVersion / At. `undefined` =
 *                                     this build has no opinion (leave the
 *                                     column alone); `''`/`null` = the
 *                                     EXPLICIT "Manager uninstalled" signal.
 *   versions.bundleSha             → lastBundleSha / At
 *   versions.bundleId              → lastBundleId (2026-09-21). The identity
 *                                     the player ACTUALLY decides to reload
 *                                     on — a hash of the client-bundle build
 *                                     inputs, not the commit SHA, which moves
 *                                     on every commit including ones that
 *                                     cannot change a downloaded byte. Dated
 *                                     by lastBundleShaAt: same statement,
 *                                     same instant, one timestamp.
 *   cache.playlist / .emergency    → lastCacheReport / At
 *   render.frames/.hash/.sync      → lastRenderedAt / Frames / Hash,
 *                                     lastSyncReport / At. OMITTED ENTIRELY
 *                                     by the client when its paint counter
 *                                     has not advanced — a frozen
 *                                     compositor MUST let lastRenderedAt go
 *                                     stale. Never synthesized server-side.
 *   render.contentKind             → accepted, NOT persisted (no column) —
 *                                     exactly as /render-proof treats it
 *                                     today. Kept for wire parity.
 *   video                          → lastVideoReport / At (2026-09-24). The
 *                                     dropped-frame sample for the clip the
 *                                     player last played, sent only when it
 *                                     has a NEW one; the server keeps the
 *                                     latest. Answers "did that file stutter
 *                                     on the wall?" from the device.
 *                                     `stalls` / `stalledMs` add the rebuffer
 *                                     pauses in the same stretch — the
 *                                     delivery stutter dropped frames miss.
 *   refreshAckMs                   → clears pendingRefreshAt on VALUE
 *                                     IDENTITY only (player rule 6)
 *   capsHash                       → drives the `capabilitiesReportRequested`
 *                                     response flag; persisted nowhere
 */
export type { ScreenTelemetryBody } from './telemetry.schema';

export interface ScreenTelemetryResponse {
  ok: true;
  screenId: string;
  paired: boolean;
  name: string | null;
  /** OTA progress, identical shape to the legacy status response. */
  ota: {
    state: string | null;
    progress: number | null;
    message: string | null;
    at: Date | string | null;
  } | null;
  versions: { player: string | null; manager: string | null };
  /** Heartbeat-driven polling fallback for a missed WS update push. */
  forceUpdatePending: boolean;
  forceUpdatePendingAt: string | null;
  /** True when this POST's `refreshAckMs` matched and cleared the flag. */
  refreshAcked: boolean;
  /** The server has no capability verdict (or the device's hash moved). */
  capabilitiesReportRequested: boolean;
  /**
   * Server-suggested cadence. Lets the fleet be slowed from the API without
   * a bundle deploy. The client clamps it into a sane range and never lets
   * it push telemetry slower than the render-staleness window can tolerate.
   */
  nextTelemetryInMs: number;
}

/** The one-per-minute contract, in one place so both sides cite it. */
export const TELEMETRY_INTERVAL_MS = 60_000;
