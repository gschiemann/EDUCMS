/**
 * updateClock — the clock the off-hours update window is decided on (2026-11-14).
 *
 * Incident: `docs/handoffs/2026-11-14-houston-video-wall-off-hours.md`. A
 * customer screen applied its "nightly" (03:00–04:00 local) web updates at
 * ~07:45 because the window was read from raw `Date.now()` and that box's
 * clock is most likely ~4 h slow. The player already measures the server
 * clock (WS / SSE AUTH_OK, `GET /api/v1/realtime/time`): "what to ADD to the
 * local `Date.now()` to match the server". This module turns those
 * measurements into a clock the nightly branch may trust, and says plainly
 * when it may not.
 *
 * Pure — the caller passes every clock reading — so each case is unit-tested.
 *
 * RULES
 *   1. Never measured ≠ measured zero. The page's offset ref starts at 0; that
 *      0 is "unknown". Only a real server time sample makes the clock verified.
 *   2. A device clock that STEPPED after the sample (first NTP sync, an
 *      installer fixing the date) makes the old offset wrong by the size of
 *      the step — applying it would move the window by exactly the skew it
 *      was meant to remove, in the other direction. A step shows as the wall
 *      clock and the monotonic clock disagreeing about how much time passed
 *      since the sample; beyond `CLOCK_STEP_TOLERANCE_MS` the clock is
 *      unverified until it is measured again. (NTP slewing moves both clocks
 *      alike; a suspended device stops the monotonic one — also unverified,
 *      which only costs one re-measurement.)
 *   3. Re-measuring is bounded: single-flight, at most one attempt per
 *      `OFFSET_RELEARN_MIN_GAP_MS` (the stale-drop limiter's constant), the
 *      gap doubling per consecutive failure up to 15 min, judged on BOTH the
 *      wall and the monotonic clock like `staleDropRecovery.ts`.
 *
 * Failure direction: an unverified clock refuses only the nightly branch;
 * the screen keeps playing and applies at its next proven window.
 * Kill switch: none needed — subtractive by construction (unset/unknown =
 * no nightly apply; display-off and idle are unchanged).
 */

import { OFFSET_RELEARN_MIN_GAP_MS } from './staleDropRecovery';

/** One real server-time measurement, anchored on both device clocks. */
export interface ServerClockSample {
  /** server − device, ms: ADD to `Date.now()` to get the server's clock. */
  offsetMs: number;
  /** `Date.now()` when it was measured. */
  atWallMs: number;
  /** `performance.now()` when it was measured. */
  atMonoMs: number;
}

/** Wall and monotonic clocks may disagree by this much before the sample is stale. */
export const CLOCK_STEP_TOLERANCE_MS = 60_000;
/** Ceiling of the re-measure backoff. */
export const CLOCK_RELEARN_MAX_GAP_MS = 15 * 60_000;

export type UpdateClock =
  | { verified: true; offsetMs: number }
  | { verified: false; reason: 'never-measured' | 'device-clock-stepped' };

/** Build a sample, or null when any reading is unusable. */
export function serverClockSample(offsetMs: number, atWallMs: number, atMonoMs: number): ServerClockSample | null {
  if (![offsetMs, atWallMs, atMonoMs].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return { offsetMs: Math.round(offsetMs), atWallMs, atMonoMs };
}

/** Is the latest sample still a true statement about this device's clock? */
export function readUpdateClock(sample: ServerClockSample | null, wallNowMs: number, monoNowMs: number): UpdateClock {
  if (!sample) return { verified: false, reason: 'never-measured' };
  const wallElapsed = wallNowMs - sample.atWallMs;
  const monoElapsed = monoNowMs - sample.atMonoMs;
  if (!Number.isFinite(wallElapsed) || !Number.isFinite(monoElapsed) || monoElapsed < 0) {
    return { verified: false, reason: 'device-clock-stepped' };
  }
  if (Math.abs(wallElapsed - monoElapsed) > CLOCK_STEP_TOLERANCE_MS) {
    return { verified: false, reason: 'device-clock-stepped' };
  }
  return { verified: true, offsetMs: sample.offsetMs };
}

/** The server's wall clock now, or null when it is not proven. */
export function serverNowMs(clock: UpdateClock, deviceNowMs: number): number | null {
  return clock.verified ? deviceNowMs + clock.offsetMs : null;
}

/** The evidence the update record carries about the clock it was decided on. */
export function clockEvidence(clock: UpdateClock): { clockMeasured: boolean; clockOffsetMs: number | null } {
  return clock.verified ? { clockMeasured: true, clockOffsetMs: clock.offsetMs } : { clockMeasured: false, clockOffsetMs: null };
}

export interface ClockRelearnState {
  inFlight: boolean;
  last: { mono: number; wall: number } | null;
  failures: number;
}

export function createClockRelearnState(): ClockRelearnState {
  return { inFlight: false, last: null, failures: 0 };
}

/** The gap before the next attempt after `failures` consecutive failures. */
export function clockRelearnGapMs(failures: number): number {
  const n = Math.max(0, Math.min(10, Math.floor(failures)));
  return Math.min(CLOCK_RELEARN_MAX_GAP_MS, OFFSET_RELEARN_MIN_GAP_MS * 2 ** n);
}

/**
 * May a re-measurement start now? Records the attempt when it may. Inside the
 * gap only while BOTH clocks agree it has not passed (a clock that jumped
 * must not suppress the measurement that would expose the jump).
 */
export function planClockRelearn(state: ClockRelearnState, monoNow: number, wallNow: number): boolean {
  if (state.inFlight) return false;
  if (state.last) {
    const gap = clockRelearnGapMs(state.failures);
    const mono = monoNow - state.last.mono;
    const wall = wallNow - state.last.wall;
    if (mono >= 0 && mono < gap && wall >= 0 && wall < gap) return false;
  }
  state.inFlight = true;
  state.last = { mono: monoNow, wall: wallNow };
  return true;
}

export function finishClockRelearn(state: ClockRelearnState, ok: boolean): void {
  state.inFlight = false;
  state.failures = ok ? 0 : state.failures + 1;
}
