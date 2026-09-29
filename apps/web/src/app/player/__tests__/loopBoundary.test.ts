import {
  FramePeriodEstimator,
  holdBetween,
  LoopBoundaryTracker,
  NativeWrapDetector,
  type FrameMeta,
} from '../loopBoundary';

/** A steady 30 fps playback of a `durSec`-second clip, `n` frames from `startFrame`. */
function frames(startFrame: number, n: number, durSec: number, t0: number, presented0: number): FrameMeta[] {
  const out: FrameMeta[] = [];
  for (let i = 0; i < n; i++) {
    const f = startFrame + i;
    out.push({ mediaTime: (f / 30) % durSec, expectedDisplayTime: t0 + i * (1000 / 30), presentedFrames: presented0 + i });
  }
  return out;
}

describe('FramePeriodEstimator', () => {
  it('finds the real period from consecutive frames, ignoring one late frame', () => {
    const e = new FramePeriodEstimator();
    const fs = frames(0, 20, 10, 1000, 100);
    fs[10] = { ...fs[10], expectedDisplayTime: fs[10].expectedDisplayTime + 90 }; // one late frame
    fs.forEach((f) => e.push(f));
    expect(e.periodMs()).toBeCloseTo(33.33, 0);
  });
  it('uses the default until it has samples, and never learns from a callback gap', () => {
    const e = new FramePeriodEstimator();
    expect(e.periodMs()).toBeCloseTo(33.33, 1);
    e.push({ mediaTime: 0, expectedDisplayTime: 0, presentedFrames: 0 });
    e.push({ mediaTime: 0.5, expectedDisplayTime: 500, presentedFrames: 15 }); // 15 frames apart: not one period
    expect(e.periodMs()).toBeCloseTo(33.33, 1);
  });
});

describe('holdBetween', () => {
  it('is 0 for two consecutive frames one period apart', () => {
    expect(holdBetween({ mediaTime: 1, expectedDisplayTime: 0, presentedFrames: 5 }, { mediaTime: 1.03, expectedDisplayTime: 33.3, presentedFrames: 6 }, 33.33)).toBeCloseTo(0, 1);
  });
  it('is the excess when the picture waited', () => {
    expect(holdBetween({ mediaTime: 1, expectedDisplayTime: 0, presentedFrames: 5 }, { mediaTime: 0, expectedDisplayTime: 333.3, presentedFrames: 6 }, 33.33)).toBeCloseTo(300, 0);
  });
  it('subtracts the frames a missed callback hid, so it cannot invent a hold', () => {
    // 10 frames presented between the two callbacks: 333 ms is exactly on time.
    expect(holdBetween({ mediaTime: 1, expectedDisplayTime: 0, presentedFrames: 5 }, { mediaTime: 1.3, expectedDisplayTime: 333.3, presentedFrames: 15 }, 33.33)).toBeCloseTo(0, 0);
  });
  it('never goes negative', () => {
    expect(holdBetween({ mediaTime: 1, expectedDisplayTime: 100, presentedFrames: 5 }, { mediaTime: 0, expectedDisplayTime: 110, presentedFrames: 6 }, 33.33)).toBe(0);
    expect(holdBetween({ mediaTime: 1, expectedDisplayTime: 100 }, { mediaTime: 0, expectedDisplayTime: 90 }, 33.33)).toBe(0);
  });
});

describe('NativeWrapDetector', () => {
  const DUR = 2; // a 2-second clip, 60 frames

  it('reports nothing during ordinary playback', () => {
    const d = new NativeWrapDetector();
    expect(frames(0, 50, DUR, 0, 0).map((f) => d.onFrame(f, DUR)).filter(Boolean)).toEqual([]);
  });

  it('reports a seamless wrap as a ~0 hold', () => {
    const d = new NativeWrapDetector();
    const fs = frames(30, 90, DUR, 0, 0); // crosses the wrap at frame 60
    const events = fs.map((f) => d.onFrame(f, DUR)).filter(Boolean);
    expect(events).toHaveLength(1);
    expect(events![0]!.backend).toBe('native');
    expect(events![0]!.holdMs).toBeLessThan(2);
    expect(events![0]!.skipMs).toBe(0);
  });

  it('reports a 300 ms freeze at the wrap as a ~300 ms hold', () => {
    const d = new NativeWrapDetector();
    const fs = frames(30, 90, DUR, 0, 0).map((f, i) => (i >= 30 ? { ...f, expectedDisplayTime: f.expectedDisplayTime + 300 } : f));
    const events = fs.map((f) => d.onFrame(f, DUR)).filter(Boolean);
    expect(events).toHaveLength(1);
    expect(events![0]!.holdMs).toBeGreaterThan(290);
    expect(events![0]!.holdMs).toBeLessThan(310);
  });

  it('a user seek to the middle of the file is not a loop', () => {
    const d = new NativeWrapDetector();
    d.onFrame({ mediaTime: 1.5, expectedDisplayTime: 0, presentedFrames: 1 }, DUR);
    expect(d.onFrame({ mediaTime: 0.2, expectedDisplayTime: 40, presentedFrames: 2 }, DUR)).toBeNull(); // from mid-file, not near the end
  });

  it('reset() forgets the last frame, so a seek across the end after it cannot be reported', () => {
    const d = new NativeWrapDetector();
    d.onFrame({ mediaTime: 1.98, expectedDisplayTime: 0, presentedFrames: 1 }, DUR);
    d.reset();
    expect(d.onFrame({ mediaTime: 0.02, expectedDisplayTime: 400, presentedFrames: 2 }, DUR)).toBeNull();
  });

  it('a clip too short to define a boundary reports nothing', () => {
    const d = new NativeWrapDetector();
    d.onFrame({ mediaTime: 0.1, expectedDisplayTime: 0, presentedFrames: 1 }, 0.15);
    expect(d.onFrame({ mediaTime: 0.01, expectedDisplayTime: 33, presentedFrames: 2 }, 0.15)).toBeNull();
  });
});

describe('LoopBoundaryTracker', () => {
  it('says nothing until a boundary has been seen — absent is not a clean zero', () => {
    const t = new LoopBoundaryTracker();
    expect(t.take()).toBeNull();
    expect(t.peek()).toBeNull();
  });

  it('summarises recent boundaries: count, worst, p95, latest — and hands each summary out once', () => {
    const t = new LoopBoundaryTracker();
    [10, 20, 30, 400, 15].forEach((h) => t.record({ holdMs: h, skipMs: 0, backend: 'native' }));
    const s = t.take()!;
    expect(s).toMatchObject({ backend: 'native', boundaries: 5, maxHoldMs: 400, lastHoldMs: 15, maxSkipMs: 0 });
    expect(s.p95HoldMs).toBe(400);
    expect(t.take()).toBeNull(); // nothing new since
    t.record({ holdMs: 5, skipMs: 0, backend: 'native' });
    expect(t.take()!.boundaries).toBe(6);
  });

  it('is a bounded ring: old boundaries age out of the worst/p95 but still count', () => {
    const t = new LoopBoundaryTracker(3);
    t.record({ holdMs: 900, skipMs: 0, backend: 'native' });
    [1, 2, 3].forEach((h) => t.record({ holdMs: h, skipMs: 0, backend: 'native' }));
    const s = t.peek()!;
    expect(s.maxHoldMs).toBe(3); // the 900 aged out
    expect(s.boundaries).toBe(4);
  });

  it('counts hand-offs, records what a two-deck hand-off skipped, and reports a fallback once', () => {
    const t = new LoopBoundaryTracker();
    t.record({ holdMs: 3, skipMs: 28, backend: 'twodeck' });
    t.record({ holdMs: 1, skipMs: 5, backend: 'twodeck' });
    expect(t.peek()).toMatchObject({ backend: 'twodeck', swaps: 2, maxSkipMs: 28 });
    t.noteFallback('standby-not-ready');
    const s = t.take()!;
    expect(s).toMatchObject({ backend: 'native', fallbacks: 1, fallbackReason: 'standby-not-ready' });
  });
});
