/**
 * server-clock — the SERVER's time, estimated in the browser (K-12 sports
 * launch program, lane A2, K12-F17).
 *
 * Every sports clock is an anchor on the server clock (packages/api-types/
 * src/sports-clock.ts). To show it, a surface needs "server now". The device's
 * own clock is not that: the audit's case was a scorer laptop two minutes
 * fast, whose console projected a different clock from the public board. So
 * every sports surface on a page samples the server (the board poll's
 * `serverTime` body field and `X-Server-Time` header, the console's game read)
 * into ONE estimator here, and projects with `serverClock.now()`.
 *
 * How the estimate is kept honest:
 *   - MONOTONIC BASE. The local timebase is performance.now(), never Date.now()
 *     (Frame-Locked Sync rule 3: an NTP step on an Android box must not move
 *     a game clock). Falls back to Date.now() where performance is missing.
 *   - CRISTIAN'S ALGORITHM. A sample taken with its request's send/receive
 *     times estimates the server reading at the round trip's midpoint; the
 *     lowest-round-trip sample of the last minute wins (least queueing noise).
 *     A sample without timing (a pushed value) is kept as a low-quality one.
 *   - SLEEP / STEP DETECTION. A phone asleep pauses performance.now() on some
 *     platforms (iOS) while the wall clock runs on; the gap between the two
 *     bases is recorded with every sample. When it moves by more than a
 *     second, older samples are dropped, and until a fresh sample arrives
 *     `now()` rides the wall clock with the offset it had — so a tab brought
 *     back from the background is never minutes out.
 *   - NO JITTER, NEVER BACKWARDS. A better sample can move the estimate by
 *     a few tens of ms; `now()` never runs backwards by less than a second
 *     (it holds until the estimate catches up), so a tenths display does not
 *     flicker 12.3 → 12.4 → 12.3 between polls. A real correction of a
 *     second or more is applied at once.
 *
 * Pure module (no React, no DOM beyond an optional `performance`), injectable
 * timebases for tests, Chromium-83 safe.
 */

export interface ServerClockSample {
  /** Server-domain epoch ms. */
  offset: number;
  /** Round trip in ms (Infinity-like for an untimed sample). */
  rtt: number;
  /** Local monotonic ms the sample was taken at. */
  localAt: number;
  /** wall − local at the sample (detects sleep / clock steps). */
  wallMinusLocal: number;
}

export interface ServerClockStatus {
  hasSample: boolean;
  /** server − local estimate in ms (server ≈ local + offset). */
  offsetMs: number;
  /** Round trip of the sample in use, or null when untimed / none. */
  rttMs: number | null;
  samples: number;
}

export interface ServerClock {
  /**
   * Feed one server reading. `sentAt` / `receivedAt` are this clock's LOCAL
   * monotonic times (see `localNow`) around the request that returned it;
   * omit them for a value with no known round trip.
   */
  sample(serverMs: number, sentAt?: number, receivedAt?: number): void;
  /** Server-domain epoch ms, now. Before any sample: the device clock. */
  now(): number;
  hasSample(): boolean;
  reset(): void;
  status(): ServerClockStatus;
  /** The local monotonic time base this clock samples against. */
  localNow(): number;
}

/** A timed sample never loses to one with no measured round trip. */
const UNTIMED_RTT = 60_000;
/** Samples older than this stop competing for "best". */
const SAMPLE_WINDOW_MS = 60_000;
const MAX_SAMPLES = 8;
/** wall − local moving by more than this = the device slept or its clock stepped. */
const DISCONTINUITY_MS = 1_000;
/** Backwards moves smaller than this are held (jitter); larger are applied. */
const MAX_HOLD_MS = 1_000;

function defaultLocalNow(): number {
  const perf = typeof performance !== 'undefined' ? performance : undefined;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

export function createServerClock(
  opts: { localNow?: () => number; wallNow?: () => number } = {},
): ServerClock {
  const localNow = opts.localNow ?? defaultLocalNow;
  const wallNow = opts.wallNow ?? (() => Date.now());
  let samples: ServerClockSample[] = [];
  let lastOut = -Infinity;

  const best = (): ServerClockSample | null => {
    const nowLocal = localNow();
    let pick: ServerClockSample | null = null;
    for (const s of samples) {
      if (nowLocal - s.localAt > SAMPLE_WINDOW_MS && s !== samples[samples.length - 1]) continue;
      if (!pick || s.rtt < pick.rtt || (s.rtt === pick.rtt && s.localAt > pick.localAt)) pick = s;
    }
    return pick;
  };

  const clock: ServerClock = {
    localNow,
    sample(serverMs, sentAt, receivedAt) {
      if (typeof serverMs !== 'number' || !isFinite(serverMs) || serverMs <= 0) return;
      const timed =
        typeof sentAt === 'number' && typeof receivedAt === 'number' && isFinite(sentAt) && isFinite(receivedAt) &&
        receivedAt >= sentAt;
      const at = timed ? (receivedAt as number) : localNow();
      const rtt = timed ? (receivedAt as number) - (sentAt as number) : UNTIMED_RTT;
      const mid = timed ? (sentAt as number) + rtt / 2 : at;
      const wallMinusLocal = wallNow() - localNow();
      const last = samples[samples.length - 1];
      if (last && Math.abs(wallMinusLocal - last.wallMinusLocal) > DISCONTINUITY_MS) {
        // Slept, or the wall clock stepped: nothing before this point is
        // comparable any more.
        samples = [];
        lastOut = -Infinity;
      }
      samples.push({ offset: serverMs - mid, rtt, localAt: at, wallMinusLocal });
      if (samples.length > MAX_SAMPLES) samples = samples.slice(samples.length - MAX_SAMPLES);
    },
    now() {
      const pick = best();
      if (!pick) return wallNow();
      const local = localNow();
      let estimate: number;
      if (Math.abs(wallNow() - local - pick.wallMinusLocal) > DISCONTINUITY_MS) {
        // The monotonic base paused (the device slept) since the sample:
        // ride the wall clock with the offset it had, until a fresh sample.
        estimate = wallNow() + pick.offset - pick.wallMinusLocal;
        lastOut = -Infinity;
        return estimate;
      }
      estimate = local + pick.offset;
      if (estimate < lastOut && lastOut - estimate < MAX_HOLD_MS) return lastOut;
      lastOut = estimate;
      return estimate;
    },
    hasSample() {
      return samples.length > 0;
    },
    reset() {
      samples = [];
      lastOut = -Infinity;
    },
    status() {
      const pick = best();
      return {
        hasSample: !!pick,
        offsetMs: pick ? pick.offset : 0,
        rttMs: pick && pick.rtt < UNTIMED_RTT ? pick.rtt : null,
        samples: samples.length,
      };
    },
  };
  return clock;
}

/**
 * The page's one server clock. Every sports surface on a page (board, ribbon,
 * scorebug, the operator console, the volunteer pad) samples into and reads
 * from this, so two surfaces on one screen can never disagree about "now".
 */
export const serverClock: ServerClock = createServerClock();
