/**
 * updateClock — when may the off-hours update trust the server clock (2026-11-14)?
 * Incident: docs/handoffs/2026-11-14-houston-video-wall-off-hours.md.
 */
import {
  CLOCK_RELEARN_MAX_GAP_MS,
  CLOCK_STEP_TOLERANCE_MS,
  clockEvidence,
  clockRelearnGapMs,
  createClockRelearnState,
  finishClockRelearn,
  planClockRelearn,
  readUpdateClock,
  serverClockSample,
  serverNowMs,
} from '../updateClock';
import { OFFSET_RELEARN_MIN_GAP_MS } from '../staleDropRecovery';

const H = 3_600_000;

describe('readUpdateClock', () => {
  it('never measured is unverified — the page ref’s initial 0 is not a measurement', () => {
    expect(readUpdateClock(null, 1_000, 1_000)).toEqual({ verified: false, reason: 'never-measured' });
    expect(serverNowMs(readUpdateClock(null, 1_000, 1_000), 1_000)).toBeNull();
  });

  it('a measured offset (even zero) is verified, with the AUTH_OK sign: ADD it to Date.now()', () => {
    const slow = serverClockSample(4 * H, 10_000, 500)!; // device 4 h behind the server
    const c = readUpdateClock(slow, 10_000 + 60_000, 500 + 60_000);
    expect(c).toEqual({ verified: true, offsetMs: 4 * H });
    expect(serverNowMs(c, 70_000)).toBe(70_000 + 4 * H);
    expect(readUpdateClock(serverClockSample(0, 0, 0), 5, 5)).toEqual({ verified: true, offsetMs: 0 });
  });

  it('a device clock that stepped after the sample (NTP, a manual fix) is unverified — the old offset would invert the error', () => {
    const s = serverClockSample(4 * H, 10_000, 500)!;
    // An hour of real time passed (monotonic), but the wall clock jumped +4 h on top.
    expect(readUpdateClock(s, 10_000 + 5 * H, 500 + H)).toEqual({ verified: false, reason: 'device-clock-stepped' });
    expect(readUpdateClock(s, 10_000 - H, 500 + 60_000)).toEqual({ verified: false, reason: 'device-clock-stepped' });
    // Within the tolerance it stands.
    expect(readUpdateClock(s, 10_000 + H + CLOCK_STEP_TOLERANCE_MS - 1, 500 + H).verified).toBe(true);
    // A monotonic clock that went backwards is not trusted either.
    expect(readUpdateClock(s, 10_000, 100).verified).toBe(false);
  });

  it('serverClockSample refuses non-finite readings and rounds the offset', () => {
    expect(serverClockSample(Number.NaN, 1, 1)).toBeNull();
    expect(serverClockSample(1, Number.POSITIVE_INFINITY, 1)).toBeNull();
    expect(serverClockSample(12.6, 1, 1)?.offsetMs).toBe(13);
  });

  it('clockEvidence says measured or not, never a fake zero', () => {
    expect(clockEvidence({ verified: true, offsetMs: -14_400_000 })).toEqual({ clockMeasured: true, clockOffsetMs: -14_400_000 });
    expect(clockEvidence({ verified: false, reason: 'never-measured' })).toEqual({ clockMeasured: false, clockOffsetMs: null });
  });
});

describe('planClockRelearn — bounded, single-flight, backing off', () => {
  it('first attempt runs; a second waits for the first to finish and for the gap on both clocks', () => {
    const st = createClockRelearnState();
    expect(planClockRelearn(st, 0, 0)).toBe(true);
    expect(planClockRelearn(st, 60_000, 60_000)).toBe(false); // still in flight
    finishClockRelearn(st, false);
    expect(clockRelearnGapMs(1)).toBe(2 * OFFSET_RELEARN_MIN_GAP_MS);
    expect(planClockRelearn(st, 2 * OFFSET_RELEARN_MIN_GAP_MS - 1, 2 * OFFSET_RELEARN_MIN_GAP_MS - 1)).toBe(false);
    expect(planClockRelearn(st, 2 * OFFSET_RELEARN_MIN_GAP_MS, 2 * OFFSET_RELEARN_MIN_GAP_MS)).toBe(true);
  });

  it('a 30 s tick for a whole day of failures stays bounded by the backoff ceiling', () => {
    const st = createClockRelearnState();
    let n = 0;
    for (let t = 0; t < 24 * H; t += 30_000) {
      if (planClockRelearn(st, t, t)) { n += 1; finishClockRelearn(st, false); }
    }
    expect(clockRelearnGapMs(99)).toBe(CLOCK_RELEARN_MAX_GAP_MS);
    expect(n).toBeLessThanOrEqual(24 * H / CLOCK_RELEARN_MAX_GAP_MS + 8);
  });

  it('a jumped wall clock cannot suppress the measurement that would expose the jump', () => {
    const st = createClockRelearnState();
    planClockRelearn(st, 0, 0);
    finishClockRelearn(st, true);
    expect(planClockRelearn(st, 1_000, 1_000 - 4 * H)).toBe(true);
  });
});
