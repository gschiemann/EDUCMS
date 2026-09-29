/**
 * videoServo — the frame-locked sync servo's decision for a VIDEO, as a pure
 * function (2026-09-29, Brookfield "Tesoro Neighborhood").
 *
 * THE BUG IT FIXES. The servo (page.tsx) used to run every 250 ms:
 *   |err| > 400 ms → seek to target + a STATIC 80 ms lead
 * and nothing else — it never looked at `video.seeking`, never measured how
 * long a seek really takes, and never noticed that its seeks were not landing.
 * On a box whose hardware decoder needs ~1-3 s to flush and re-seek (the
 * Droidlogic Android-11 panels: G43 / GUQ55 / GUQ65 / M86), every seek landed
 * seconds behind the moving timeline, the next tick saw the error again and
 * seeked again — forever. The picture showed one frame per seek: "freezing
 * constantly", at ANY video resolution, only on screens in a locked group, while
 * the same file played at 30 fps on the same boxes' faster siblings in the same
 * group (G75, M43) and on the same model unsynced (RIOT Cleveland).
 *
 * THE RULES NOW:
 *   1. Never act while a seek is in flight (`seeking`) — not even a rate change.
 *   2. The seek lead is MEASURED: time from issuing a seek to `seeked`, averaged
 *      (first measurement replaces the guess), clamped 80 ms-3 s. A seek aims
 *      where the timeline will be when it lands.
 *   3. A seek that did not bring the error under the hard-seek bar when it
 *      landed is a FAILED seek. Three in a row — or more than eight hard seeks in
 *      a minute, converging or not — and hard seeks stop for ten minutes: the
 *      servo chases with playback rate only (±4 %). A screen that plays smoothly
 *      and converges slowly is always better than one that freezes in phase.
 *
 * No React, no DOM: page.tsx feeds it the measured error and applies the answer.
 */

export const SERVO_HARD_SEEK_MS = 400;
export const SERVO_DEADBAND_MS = 12;
export const SERVO_MAX_RATE_DELTA = 0.04;
export const SERVO_MIN_LEAD_MS = 80;
export const SERVO_MAX_LEAD_MS = 3_000;
/** After a seek lands, the error must be under the hard-seek bar within this long, or it failed. */
export const SERVO_CONVERGE_WINDOW_MS = 3_000;
export const SERVO_MAX_FAILED_SEEKS = 3;
export const SERVO_MAX_SEEKS_PER_WINDOW = 8;
export const SERVO_SEEK_WINDOW_MS = 60_000;
export const SERVO_SEEK_BLOCK_MS = 10 * 60_000;

export interface VideoServoState {
  leadMs: number;
  leadMeasured: boolean;
  /** When the servo's own seek was issued; null once it landed. */
  seekIssuedAtMs: number | null;
  /** When the last servo seek landed; cleared once judged (converged or failed). */
  landedAtMs: number | null;
  failedSeeks: number;
  seekTimesMs: number[];
  hardSeekBlockedUntilMs: number;
  /** Set once when hard seeks get blocked — the page logs it and clears it. */
  justBlocked: boolean;
}

export function createVideoServoState(): VideoServoState {
  return {
    leadMs: SERVO_MIN_LEAD_MS,
    leadMeasured: false,
    seekIssuedAtMs: null,
    landedAtMs: null,
    failedSeeks: 0,
    seekTimesMs: [],
    hardSeekBlockedUntilMs: 0,
    justBlocked: false,
  };
}

export type ServoAction =
  | { kind: 'hold' }
  | { kind: 'rate'; rate: number }
  | { kind: 'seek'; toMs: number };

const clampLead = (ms: number) => Math.max(SERVO_MIN_LEAD_MS, Math.min(SERVO_MAX_LEAD_MS, ms));
const rateFor = (errMs: number) => 1 + Math.max(-SERVO_MAX_RATE_DELTA, Math.min(SERVO_MAX_RATE_DELTA, errMs / 2000));

/** The servo's seek landed (`seeked`). Idempotent; ignores seeks it did not issue. */
export function servoSeekLanded(s: VideoServoState, nowMs: number): void {
  if (s.seekIssuedAtMs === null) return;
  const latency = Math.max(0, nowMs - s.seekIssuedAtMs);
  s.leadMs = clampLead(s.leadMeasured ? s.leadMs * 0.5 + latency * 0.5 : latency);
  s.leadMeasured = true;
  s.seekIssuedAtMs = null;
  s.landedAtMs = nowMs;
}

function block(s: VideoServoState, nowMs: number): void {
  s.hardSeekBlockedUntilMs = nowMs + SERVO_SEEK_BLOCK_MS;
  s.failedSeeks = 0;
  s.seekTimesMs = [];
  s.justBlocked = true;
}

export function servoDecide(
  s: VideoServoState,
  input: { nowMs: number; errMs: number; targetMs: number; fileDurMs: number | null; seeking: boolean },
): ServoAction {
  const { nowMs, errMs, targetMs, fileDurMs, seeking } = input;
  // Rule 1 — any seek in flight (ours, or the slide's own activation seek).
  if (seeking) return { kind: 'hold' };
  // A seek that finished without its `seeked` reaching us: judge it now (coarse latency).
  if (s.seekIssuedAtMs !== null) servoSeekLanded(s, nowMs);
  if (!Number.isFinite(errMs)) return { kind: 'hold' };

  const abs = Math.abs(errMs);
  if (abs <= SERVO_HARD_SEEK_MS) {
    if (s.landedAtMs !== null) { s.failedSeeks = 0; s.landedAtMs = null; } // the last seek converged
    return { kind: 'rate', rate: abs > SERVO_DEADBAND_MS ? rateFor(errMs) : 1 };
  }

  // Rule 3 — the last seek landed and the error is still over the bar: it failed.
  if (s.landedAtMs !== null) {
    if (nowMs - s.landedAtMs <= SERVO_CONVERGE_WINDOW_MS) {
      s.failedSeeks += 1;
      if (s.failedSeeks >= SERVO_MAX_FAILED_SEEKS) block(s, nowMs);
    }
    s.landedAtMs = null;
  }
  s.seekTimesMs = s.seekTimesMs.filter((t) => nowMs - t < SERVO_SEEK_WINDOW_MS);
  if (nowMs >= s.hardSeekBlockedUntilMs && s.seekTimesMs.length >= SERVO_MAX_SEEKS_PER_WINDOW) block(s, nowMs);

  if (nowMs < s.hardSeekBlockedUntilMs) return { kind: 'rate', rate: rateFor(errMs) };

  // Rule 2 — aim where the timeline will be when the seek lands.
  let toMs = targetMs + s.leadMs;
  if (fileDurMs && fileDurMs > 0) toMs %= fileDurMs;
  s.seekIssuedAtMs = nowMs;
  s.seekTimesMs.push(nowMs);
  return { kind: 'seek', toMs: Math.max(0, toMs) };
}
