/**
 * The companion Manager's refused Player lane (manager-lane-noise.ts): its
 * CHECKING / UP_TO_DATE around a refused check must not reach the Player's
 * OTA status — the UP_TO_DATE would read "Already on v1.1.23 ✓" on a screen
 * with a pending push that is behind.
 */
import { isManagerLaneNoise, noteManagerCheckRefused, resetManagerLaneNoise } from './manager-lane-noise';

const FP = 'android-m24';
const T0 = Date.UTC(2026, 9, 16, 10, 0, 0);

beforeEach(() => resetManagerLaneNoise());

describe('isManagerLaneNoise', () => {
  it("the Manager's CHECKING is recognised by its own wording; the Player's CHECKING is not", () => {
    expect(isManagerLaneNoise(FP, 'CHECKING', 'v1.1.23 → checking', T0)).toBe(true);
    expect(isManagerLaneNoise(FP, 'CHECKING', null, T0)).toBe(false);
    expect(isManagerLaneNoise(FP, 'CHECKING', 'v1.1.23', T0)).toBe(false);
  });

  it('an UP_TO_DATE right after a refused Manager check for the same screen is its echo', () => {
    noteManagerCheckRefused(FP, T0);
    expect(isManagerLaneNoise(FP, 'UP_TO_DATE', 'v1.1.23 — no newer release offered', T0 + 2_000)).toBe(true);
  });

  it('…but not for another screen, and not minutes later', () => {
    noteManagerCheckRefused(FP, T0);
    expect(isManagerLaneNoise('android-other', 'UP_TO_DATE', 'x', T0 + 2_000)).toBe(false);
    expect(isManagerLaneNoise(FP, 'UP_TO_DATE', 'x', T0 + 3 * 60_000)).toBe(false);
  });

  it('no refusal on record → an UP_TO_DATE is the Player\'s own', () => {
    expect(isManagerLaneNoise(FP, 'UP_TO_DATE', 'v1.1.23 — no newer release offered', T0)).toBe(false);
  });

  it('never touches real progress or failures', () => {
    noteManagerCheckRefused(FP, T0);
    for (const state of ['DOWNLOADING', 'VERIFYING', 'INSTALLING', 'NEEDS_TAP', 'ERROR', 'FAILED_ABORTED']) {
      expect(isManagerLaneNoise(FP, state, 'v1.1.23 → checking', T0 + 1_000)).toBe(false);
    }
  });
});
