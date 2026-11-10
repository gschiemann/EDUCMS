/**
 * What the player does when the push gate refuses a life-safety frame as
 * "stale" (2026-11-09, player audit finding C).
 *
 * `checkSensitivePush` measures a frame's timestamp against
 * `Date.now() + serverClockOffset`, and the offset used to be learned once, at
 * socket sign-in. When the device's wall clock stepped afterwards (the first
 * NTP sync on a box with no clock battery, a time-zone or manual correction),
 * every signed OVERRIDE and broadcast was refused as stale until the socket
 * happened to reconnect, and the refusal triggered nothing: the alert waited
 * for the next poll.
 *
 * The gate itself is unchanged. A refused frame is still never applied. Two
 * things now happen instead of nothing:
 *
 *   1. the authenticated manifest is asked at once, so the server of record
 *      decides whether an alert is up (the same lane an accepted OVERRIDE
 *      uses);
 *   2. the server clock offset is measured again from the API's own clock
 *      (`/api/v1/realtime/time`, the same clock that stamps AUTH_OK), so the
 *      NEXT push is judged against the real time.
 *
 * Failure direction: if the reconcile or the time request fails, the player
 * is exactly where it was before this file existed (the frame is dropped and
 * the polls catch up). Nothing here can raise or release an alert by itself.
 *
 * Both actions are rate-limited, because a burst of late frames (a socket
 * flushing its buffer after a network stall) must not abort manifest request
 * after manifest request. The pre-empting reconcile (which aborts a normal
 * manifest request in flight) runs at most once per manifest deadline, so a
 * stream of refused frames can never starve the manifest; in between, a
 * refused frame only asks for the ordinary coalesced reconcile.
 */

/** At most one stale-triggered manifest reconcile of any kind in this window. */
export const STALE_RECONCILE_MIN_GAP_MS = 5_000;
/**
 * At most one PRE-EMPTING reconcile in this window. It must stay longer than
 * the manifest request's own 20 s deadline (`fetchContent` in `page.tsx`):
 * a request started by one pre-empt has then finished or timed out by itself
 * before the next pre-empt could abort it.
 */
export const STALE_PREEMPT_MIN_GAP_MS = 25_000;
/** At most one clock re-measurement in this window. */
export const OFFSET_RELEARN_MIN_GAP_MS = 30_000;
/** The time request is abandoned after this long. */
export const OFFSET_RELEARN_TIMEOUT_MS = 8_000;
/** A sample whose round trip took longer than this is too vague to adopt. */
export const OFFSET_RELEARN_MAX_ROUND_TRIP_MS = 5_000;

interface Mark { mono: number; wall: number }

export interface StaleDropState {
  lastReconcile: Mark | null;
  lastPreempt: Mark | null;
  lastRelearn: Mark | null;
}

/** What a stale drop asks of the manifest lane. */
export type StaleReconcile = 'preempt' | 'coalesce' | 'none';

export function createStaleDropState(): StaleDropState {
  return { lastReconcile: null, lastPreempt: null, lastRelearn: null };
}

/**
 * True while BOTH clocks agree that less than `minGapMs` has passed.
 *
 * Neither clock is trusted alone: the wall clock is the thing that just
 * jumped, and `performance.now()` can stand still while a device sleeps
 * (crbug.com/1206450). If either says the window is over (or the wall clock
 * went backwards), the action runs. An extra reconcile is harmless; a
 * suppressed one is the bug this file exists to remove.
 */
function withinGap(last: Mark | null, monoNow: number, wallNow: number, minGapMs: number): boolean {
  if (!last) return false;
  const monoGap = monoNow - last.mono;
  const wallGap = wallNow - last.wall;
  return monoGap >= 0 && monoGap < minGapMs && wallGap >= 0 && wallGap < minGapMs;
}

/**
 * Decide what a stale drop triggers right now, and record it.
 *
 * @param monoNow  `performance.now()`
 * @param wallNow  `Date.now()`
 */
export function planStaleDropRecovery(
  state: StaleDropState,
  monoNow: number,
  wallNow: number,
): { reconcile: StaleReconcile; relearn: boolean } {
  const mark: Mark = { mono: monoNow, wall: wallNow };
  let reconcile: StaleReconcile = 'none';
  if (!withinGap(state.lastReconcile, monoNow, wallNow, STALE_RECONCILE_MIN_GAP_MS)) {
    reconcile = withinGap(state.lastPreempt, monoNow, wallNow, STALE_PREEMPT_MIN_GAP_MS) ? 'coalesce' : 'preempt';
    state.lastReconcile = mark;
    if (reconcile === 'preempt') state.lastPreempt = mark;
  }
  const relearn = !withinGap(state.lastRelearn, monoNow, wallNow, OFFSET_RELEARN_MIN_GAP_MS);
  if (relearn) state.lastRelearn = mark;
  return { reconcile, relearn };
}

/**
 * Turn one time sample into "what to ADD to local Date.now()", the same
 * meaning as the AUTH_OK offset.
 *
 * @param serverNow     the server's clock, as the response reported it
 * @param roundTripMs   how long the request took (monotonic)
 * @param wallNowAfter  `Date.now()` when the response was read
 * @returns null when the sample cannot be trusted
 */
export function offsetFromTimeSample(
  serverNow: unknown,
  roundTripMs: number,
  wallNowAfter: number,
): number | null {
  if (typeof serverNow !== 'number' || !Number.isFinite(serverNow) || serverNow <= 0) return null;
  if (!Number.isFinite(roundTripMs) || roundTripMs < 0 || roundTripMs > OFFSET_RELEARN_MAX_ROUND_TRIP_MS) return null;
  if (!Number.isFinite(wallNowAfter)) return null;
  // The server read its clock about half a round trip before we read ours.
  return Math.round(serverNow + roundTripMs / 2 - wallNowAfter);
}

export interface RelearnDeps {
  apiRoot: string;
  fetchImpl?: typeof fetch;
  monoNow?: () => number;
  wallNow?: () => number;
  timeoutMs?: number;
}

/**
 * Measure the server clock offset once. Bounded, and it never throws.
 *
 * @returns the new offset, or null when it could not be measured (offline,
 *          timeout, a bad body, a slow round trip): the caller keeps the
 *          offset it has.
 */
export async function relearnServerClockOffset(deps: RelearnDeps): Promise<number | null> {
  const fetchImpl = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) return null;
  const monoNow = deps.monoNow ?? (() => performance.now());
  const wallNow = deps.wallNow ?? (() => Date.now());
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => {
    try { controller?.abort(); } catch { /* swallow */ }
  }, deps.timeoutMs ?? OFFSET_RELEARN_TIMEOUT_MS);
  try {
    const mono0 = monoNow();
    const res = await fetchImpl(`${deps.apiRoot}/api/v1/realtime/time`, {
      cache: 'no-store',
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const mono1 = monoNow();
    return offsetFromTimeSample(body?.serverNow, mono1 - mono0, wallNow());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
