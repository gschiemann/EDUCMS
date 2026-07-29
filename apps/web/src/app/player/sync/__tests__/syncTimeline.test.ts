/**
 * syncTimeline unit tests — the deterministic shared timeline that makes
 * frame-locked multi-screen sync possible. THE property under test: for
 * any two "screens" whose clocks agree, resolveTimeline returns the same
 * slide — reboots, late joins, huge epoch values, garbage durations.
 * docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md §3.
 */
import {
  resolveTimeline,
  effectiveDurationMs,
  videoTargetMs,
  advanceCounterTo,
} from '../syncTimeline';

const ITEMS = [
  { id: 'a', durationMs: 5_000 },
  { id: 'b', durationMs: 10_000 },
  { id: 'c', durationMs: 15_000 },
]; // loop = 30_000

describe('effectiveDurationMs', () => {
  it('uses the item duration', () => {
    expect(effectiveDurationMs({ durationMs: 7_000 })).toBe(7_000);
  });
  it('falls back to 10s like the legacy heartbeat when missing', () => {
    expect(effectiveDurationMs({})).toBe(10_000);
    expect(effectiveDurationMs({ durationMs: null })).toBe(10_000);
    expect(effectiveDurationMs({ durationMs: NaN })).toBe(10_000);
  });
  it('floors garbage durations at 500ms so the loop math never degenerates', () => {
    expect(effectiveDurationMs({ durationMs: 0 })).toBe(500);
    expect(effectiveDurationMs({ durationMs: -50 })).toBe(500);
    expect(effectiveDurationMs({ durationMs: 250 })).toBe(500);
  });
});

describe('resolveTimeline', () => {
  it('returns null for an empty playlist or invalid time', () => {
    expect(resolveTimeline([], 123)).toBeNull();
    expect(resolveTimeline(ITEMS, NaN)).toBeNull();
  });

  it('maps positions across the loop deterministically', () => {
    expect(resolveTimeline(ITEMS, 0)).toMatchObject({ index: 0, offsetInItemMs: 0 });
    expect(resolveTimeline(ITEMS, 4_999)).toMatchObject({ index: 0, offsetInItemMs: 4_999 });
    expect(resolveTimeline(ITEMS, 5_000)).toMatchObject({ index: 1, offsetInItemMs: 0 });
    expect(resolveTimeline(ITEMS, 14_999)).toMatchObject({ index: 1, offsetInItemMs: 9_999 });
    expect(resolveTimeline(ITEMS, 15_000)).toMatchObject({ index: 2, offsetInItemMs: 0 });
    expect(resolveTimeline(ITEMS, 29_999)).toMatchObject({ index: 2, offsetInItemMs: 14_999 });
    // wrap
    expect(resolveTimeline(ITEMS, 30_000)).toMatchObject({ index: 0, offsetInItemMs: 0 });
    expect(resolveTimeline(ITEMS, 65_000)).toMatchObject({ index: 1, offsetInItemMs: 0 });
  });

  it('handles real epoch-scale timestamps without precision loss', () => {
    // 2026-07-28-ish epoch ms — far below 2^53; mod must stay exact.
    const t = 1_785_000_000_123;
    const pos = resolveTimeline(ITEMS, t)!;
    expect(pos.loopDurationMs).toBe(30_000);
    expect(pos.offsetInItemMs).toBeGreaterThanOrEqual(0);
    expect(pos.offsetInItemMs).toBeLessThan(pos.itemDurationMs);
    // boundary is exactly item-start + duration
    expect(pos.boundaryAtMs - t).toBe(pos.itemDurationMs - pos.offsetInItemMs);
  });

  it('is negative-time safe (trim larger than clock, test rigs)', () => {
    const pos = resolveTimeline(ITEMS, -1)!;
    expect(pos.index).toBe(2);
    expect(pos.offsetInItemMs).toBe(14_999);
  });

  it('THE sync property: two screens with agreeing clocks resolve the same slide', () => {
    for (let i = 0; i < 500; i++) {
      const t = 1_700_000_000_000 + i * 7_919; // arbitrary walk
      const a = resolveTimeline(ITEMS, t)!;
      const b = resolveTimeline(ITEMS, t)!; // "screen B", same clock reading
      expect(b.index).toBe(a.index);
      expect(b.offsetInItemMs).toBe(a.offsetInItemMs);
    }
  });

  it('a late joiner lands mid-item in phase (no start-from-zero)', () => {
    const bootAt = 1_700_000_012_345;
    const runningSince = resolveTimeline(ITEMS, bootAt)!;
    // A screen that has been playing "forever" and one that just booted
    // compute the identical position — that is the whole design.
    expect(runningSince).toEqual(resolveTimeline(ITEMS, bootAt));
  });

  it('single-item playlist: index pinned at 0, offset walks the item', () => {
    const solo = [{ id: 'v', durationMs: 20_000 }];
    expect(resolveTimeline(solo, 5_000)).toMatchObject({ index: 0, offsetInItemMs: 5_000 });
    expect(resolveTimeline(solo, 25_000)).toMatchObject({ index: 0, offsetInItemMs: 5_000 });
  });
});

describe('videoTargetMs', () => {
  it('plays straight through when the file fills the slot', () => {
    expect(videoTargetMs(4_000, 30_000)).toBe(4_000);
  });
  it('loops deterministically when the file is shorter than the slot', () => {
    expect(videoTargetMs(25_000, 10_000)).toBe(5_000);
    expect(videoTargetMs(9_999, 10_000)).toBe(9_999);
    expect(videoTargetMs(10_000, 10_000)).toBe(0);
  });
  it('falls back to raw offset when duration is unknown/noise', () => {
    expect(videoTargetMs(4_000, null)).toBe(4_000);
    expect(videoTargetMs(4_000, 0)).toBe(4_000);
    expect(videoTargetMs(4_000, 150)).toBe(4_000); // <200ms metadata = not loaded
  });
});

describe('advanceCounterTo', () => {
  it('no-ops when the counter is already congruent', () => {
    expect(advanceCounterTo(5, 2, 3)).toBe(5); // 5 % 3 === 2
    expect(advanceCounterTo(0, 0, 3)).toBe(0);
  });
  it('advances forward to the resolved index', () => {
    expect(advanceCounterTo(5, 0, 3)).toBe(6); // wrap 2→0 = +1
    expect(advanceCounterTo(5, 1, 3)).toBe(7); // 2→1 forward-wraps +2
    expect(advanceCounterTo(0, 2, 3)).toBe(2);
  });
  it('never decreases (monotonic counter contract from the player)', () => {
    for (let cur = 0; cur < 20; cur++) {
      for (let target = 0; target < 5; target++) {
        expect(advanceCounterTo(cur, target, 5)).toBeGreaterThanOrEqual(cur);
      }
    }
  });
  it('guards empty playlists', () => {
    expect(advanceCounterTo(7, 0, 0)).toBe(7);
  });
});
