import { sampleTimeline, restoreSampleTiming } from '../continuousLoopPackage';
import { cycleOffset } from '../continuousLoop';
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
