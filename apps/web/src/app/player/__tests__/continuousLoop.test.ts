import { sampleTimeline, restoreSampleTiming, validLoopPackage, type LoopPackage } from '../continuousLoopPackage';
import { bufferedAhead, cycleOffset, pruneEnd } from '../continuousLoop';
import { CONTINUOUS_LOOP_REVISION, continuousGuardKey } from '../continuousLoopRevision';
import { ContinuousBoundaryDetector } from '../loopBoundary';
import { pickLoopBackend } from '../loopEligibility';

test('B-frame reordering and encoder delay preserve every source sample', () => {
  const s = [2, 5, 3, 4].map((cts, i) => ({ cts, duration: 1, is_sync: i === 0 }));
  const p = { ...sampleTimeline(s, 30), timescale: 30 };
  expect(p).toEqual({ firstPts: 2, durationTicks: 4, timescale: 30 });
  expect(cycleOffset(1, p) + 2 / 30).toBeCloseTo(4 / 30, 12);
});
test('timestamp holes, overlaps and a nonrandom-access opening are refused', () => {
  for (const pts of [[0, 1, 3], [0, 1, 1]]) {
    expect(() => sampleTimeline(pts.map(cts => ({ cts, duration: 1, is_sync: true })), 30)).toThrow('non-contiguous');
  }
  expect(() => sampleTimeline([{ cts: 0, duration: 1, is_sync: false }], 30)).toThrow('unsupported');
});

test('only contiguous playable bytes count as headroom, not a later appended fragment', () => {
  const ranges = { length: 2, start: (i: number) => [0, 20][i], end: (i: number) => [6, 40][i] };
  expect(bufferedAhead(5, ranges)).toBe(1);
  expect(bufferedAhead(10, ranges)).toBe(0);
  expect(bufferedAhead(25, ranges)).toBe(15);
  expect(bufferedAhead(40, ranges)).toBe(0);
  expect(bufferedAhead(0, { ...ranges, length: 0 })).toBe(0);
});
test('source stts overrides a duration inflated by encoder delay, including variable runs', () => {
  const samples = [{ dts: 0, cts: 2, duration: 1 }, { dts: 1, cts: 4, duration: 1 }, { dts: 2, cts: 3, duration: 2 }];
  restoreSampleTiming(samples, [3], [1]);
  expect(sampleTimeline(samples.map((s, i) => ({ ...s, is_sync: i === 0 })), 30)).toEqual({ firstPts: 2, durationTicks: 3 });
  restoreSampleTiming(samples, [1, 2], [2, 3]);
  expect(samples.map(s => [s.dts, s.duration])).toEqual([[0, 2], [2, 3], [5, 3]]);
  expect(() => restoreSampleTiming(samples, [2], [1])).toThrow('unsupported-stts');
});
test('29.97 fps cycles do not accumulate rounded-duration drift', () => {
  const p = { durationTicks: 300300, firstPts: 2002, timescale: 30000 };
  expect(cycleOffset(1_000_000, p)).toBe((1_000_000 * 300300 - 2002) / 30000);
  expect(() => cycleOffset(Number.MAX_SAFE_INTEGER, p)).toThrow('overflow');
});
test('a 300 ms hold is detected when currentTime advances through a cycle, rather than wrapping', () => {
  const d = new ContinuousBoundaryDetector(75, 30);
  d.onFrame({ mediaTime: 74 / 30, expectedDisplayTime: 1000, presentedFrames: 75 });
  const e = d.onFrame({ mediaTime: 75 / 30, expectedDisplayTime: 1333.3333, presentedFrames: 76 })!;
  expect(e.backend).toBe('continuous'); expect(e.skipMs).toBe(0);
  expect(e.holdMs).toBeCloseTo(300, 2);
});
test('missed callbacks with continuing frame presentation do not invent a stall', () => {
  const d = new ContinuousBoundaryDetector(75, 30);
  d.onFrame({ mediaTime: 73 / 30, expectedDisplayTime: 1000, presentedFrames: 74 });
  expect(d.onFrame({ mediaTime: 76 / 30, expectedDisplayTime: 1100, presentedFrames: 77 })!.holdMs).toBeCloseTo(0);
});
test('one-stream mode is separate from the failed two-decoder block; sync, sound and emergencies stay excluded', () => {
  const input = { loopMode: 'continuous', urlOverride: null, isSolo: true, muted: true,
    syncActive: false, isEmergency: false, isMov: false, hasRvfc: true, blocked: true,
    isPreview: false, continuousCapable: true };
  expect(pickLoopBackend(input).backend).toBe('continuous');
  for (const change of [{ syncActive: true }, { muted: false }, { isEmergency: true }, { continuousCapable: false }]) {
    expect(pickLoopBackend({ ...input, ...change }).backend).toBe('native');
  }
});

test('removal never reaches the playing GOP with the real Brookfield 250-frame keyframe interval', () => {
  const p = { durationTicks: 3000, timescale: 30, keyframeTicks: Array.from({ length: 12 }, (_, i) => i * 250) };
  // At 16.1 s the old cut at 8.1 s extends to the next keyframe at 16.667 s,
  // deleting the playing frame. The corrected engine has not pruned yet.
  expect(pruneEnd(16.1, p)).toBe(0);
  expect(pruneEnd(17, p)).toBe(249 / 30);
  for (let ticks = 0; ticks < 9000; ticks += 7) {
    const now = ticks / p.timescale;
    const cut = pruneEnd(now, p);
    if (!cut) continue;
    const cycle = Math.floor(cut / 100);
    const retained = [...p.keyframeTicks.map(t => cycle * 100 + t / 30), (cycle + 1) * 100].find(t => t >= cut)!;
    expect(retained).toBeLessThanOrEqual(now - 8 + 1 / 30);
    expect(retained).toBeLessThan(now);
  }
});

test('keyframe retention handles irregular GOPs, cycle boundaries and rational frame rates', () => {
  const p = { durationTicks: 300300, timescale: 30000, keyframeTicks: [0, 60060, 225225] };
  expect(pruneEnd(9, p)).toBe(0);
  expect(pruneEnd(11, p)).toBe(60059 / 30000);
  expect(pruneEnd(18.51, p)).toBe(300299 / 30000);
  const now = 1_000_000 * 10.01 + 9;
  expect(pruneEnd(now, p)).toBe((1_000_000 * 300300 - 1) / 30000);
});

test('cached packages require current keyframe metadata and a failed older engine does not block the repair', () => {
  const hash = 'a'.repeat(64);
  const fragment = { key: `/__venueos_loop__/v${CONTINUOUS_LOOP_REVISION}/${hash}/0`, bytes: 20, sha256: hash, endTicks: 60 };
  const p: LoopPackage = { version: CONTINUOUS_LOOP_REVISION, sourceHash: hash, mime: 'video/mp4; codecs="avc1.640028"', timescale: 30,
    durationTicks: 60, firstPts: 2, init: { ...fragment, endTicks: 0 }, fragments: [fragment], keyframeTicks: [0, 30] };
  expect(validLoopPackage(p, hash)).toBe(true);
  for (const keyframeTicks of [undefined, [], [1, 30], [0, 30, 20], [0, 60]]) {
    expect(validLoopPackage({ ...p, keyframeTicks } as LoopPackage, hash)).toBe(false);
  }
  expect(validLoopPackage({ ...p, version: 1 } as unknown as LoopPackage, hash)).toBe(false);
  expect(continuousGuardKey(hash, 'blocked')).not.toBe(`continuous:${hash}:blocked`);
  expect(continuousGuardKey(hash, 'blocked')).toBe(continuousGuardKey(hash, 'blocked'));
});
