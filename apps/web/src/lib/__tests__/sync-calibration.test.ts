/**
 * sync-calibration unit tests — synthetic camera captures of the
 * CALIBRATE_FLASH pattern, including camera quantization, noise, phase
 * wrap-around, and garbage-input rejection.
 */
import {
  detectFlashOnsets,
  circularPhaseMs,
  circularDeltaMs,
  phaseConfidenceMs,
  computeTrimUpdates,
  type LumaSample,
} from '../sync-calibration';

/**
 * Simulate a camera filming a screen that flashes 120ms every second at
 * phase φ: frames every `frameMs` (30fps default), luminance 200 during
 * the flash, 18 otherwise, ± deterministic pseudo-noise.
 */
function synthCapture(opts: {
  phaseMs: number;
  durationMs?: number;
  frameMs?: number;
  noise?: number;
  seed?: number;
}): LumaSample[] {
  const { phaseMs, durationMs = 8_000, frameMs = 33.3, noise = 4, seed = 7 } = opts;
  let s = seed;
  const rand = () => ((s = (s * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
  const out: LumaSample[] = [];
  for (let t = 0; t <= durationMs; t += frameMs) {
    const inFlash = (((t - phaseMs) % 1000) + 1000) % 1000 < 120;
    out.push({ tMs: t, v: (inFlash ? 200 : 18) + (rand() - 0.5) * 2 * noise });
  }
  return out;
}

describe('detectFlashOnsets', () => {
  it('finds one onset per flash with sub-frame precision', () => {
    const onsets = detectFlashOnsets(synthCapture({ phaseMs: 250 }));
    expect(onsets.length).toBeGreaterThanOrEqual(7);
    expect(onsets.length).toBeLessThanOrEqual(9);
    // Every onset sits near the true phase (well inside one camera frame).
    for (const t of onsets) {
      const mod = ((t - 250) % 1000 + 1000) % 1000;
      const err = Math.min(mod, 1000 - mod);
      expect(err).toBeLessThan(40);
    }
  });

  it('rejects a region with no flash signal (wrong tag / screen off)', () => {
    const flat: LumaSample[] = Array.from({ length: 240 }, (_, i) => ({ tMs: i * 33.3, v: 30 + (i % 3) }));
    expect(detectFlashOnsets(flat)).toEqual([]);
  });

  it('handles tiny sample counts without exploding', () => {
    expect(detectFlashOnsets([])).toEqual([]);
    expect(detectFlashOnsets([{ tMs: 0, v: 10 }])).toEqual([]);
  });
});

describe('circularPhaseMs', () => {
  it('recovers the true phase from a capture', () => {
    const onsets = detectFlashOnsets(synthCapture({ phaseMs: 700 }));
    const phase = circularPhaseMs(onsets)!;
    const err = Math.abs(circularDeltaMs(phase, 700));
    expect(err).toBeLessThan(15);
  });

  it('handles wrap-around phases (onsets straddling 0/1000)', () => {
    const onsets = detectFlashOnsets(synthCapture({ phaseMs: 990 }));
    const phase = circularPhaseMs(onsets)!;
    expect(Math.abs(circularDeltaMs(phase, 990))).toBeLessThan(15);
  });

  it('returns null for incoherent onsets (shaky capture)', () => {
    // Onsets scattered uniformly — no consistent phase exists.
    expect(circularPhaseMs([100, 350, 600, 850, 1_100 + 125])).toBeNull();
  });

  it('returns null below 3 onsets', () => {
    expect(circularPhaseMs([100, 1_100])).toBeNull();
  });

  it('reports a tight confidence for a clean capture', () => {
    const onsets = detectFlashOnsets(synthCapture({ phaseMs: 400, noise: 2 }));
    const conf = phaseConfidenceMs(onsets)!;
    expect(conf).toBeLessThan(15);
  });
});

describe('circularDeltaMs', () => {
  it('takes the shortest way around the circle', () => {
    expect(circularDeltaMs(990, 10)).toBe(-20);
    expect(circularDeltaMs(10, 990)).toBe(20);
    expect(circularDeltaMs(600, 100)).toBe(500); // exactly opposite → +P/2
    expect(circularDeltaMs(100, 100)).toBe(0);
  });
});

describe('computeTrimUpdates (end-to-end math)', () => {
  it('a screen flashing later than the reference gains trim', () => {
    const updates = computeTrimUpdates(
      [
        { screenId: 'A', phaseMs: 200, currentTrimMs: 0 },
        { screenId: 'B', phaseMs: 243, currentTrimMs: 0 }, // 43ms of glass lag
      ],
      'A',
    );
    expect(updates.find((u) => u.screenId === 'A')!.newTrimMs).toBe(0);
    const b = updates.find((u) => u.screenId === 'B')!;
    expect(b.deltaMs).toBeCloseTo(43, 0);
    expect(b.newTrimMs).toBe(43);
  });

  it('accounts for trims already applied during measurement', () => {
    // B already runs +30 trim and STILL appears 12ms late → needs +42.
    const updates = computeTrimUpdates(
      [
        { screenId: 'A', phaseMs: 500, currentTrimMs: 0 },
        { screenId: 'B', phaseMs: 512, currentTrimMs: 30 },
      ],
      'A',
    );
    expect(updates.find((u) => u.screenId === 'B')!.newTrimMs).toBe(42);
  });

  it('wrap-around deltas stay small (995 vs 5 = 10ms apart, not 990)', () => {
    const updates = computeTrimUpdates(
      [
        { screenId: 'A', phaseMs: 995, currentTrimMs: 0 },
        { screenId: 'B', phaseMs: 5, currentTrimMs: 0 },
      ],
      'A',
    );
    expect(updates.find((u) => u.screenId === 'B')!.newTrimMs).toBe(10);
  });

  it('full pipeline: capture → phases → trims aligns three screens', () => {
    // True glass latencies: A=0, B=+38, C=-22 (relative). Same synced clock.
    const capA = detectFlashOnsets(synthCapture({ phaseMs: 300, seed: 1 }));
    const capB = detectFlashOnsets(synthCapture({ phaseMs: 338, seed: 2 }));
    const capC = detectFlashOnsets(synthCapture({ phaseMs: 278, seed: 3 }));
    const updates = computeTrimUpdates(
      [
        { screenId: 'A', phaseMs: circularPhaseMs(capA)!, currentTrimMs: 0 },
        { screenId: 'B', phaseMs: circularPhaseMs(capB)!, currentTrimMs: 0 },
        { screenId: 'C', phaseMs: circularPhaseMs(capC)!, currentTrimMs: 0 },
      ],
      'A',
    );
    const b = updates.find((u) => u.screenId === 'B')!;
    const c = updates.find((u) => u.screenId === 'C')!;
    expect(Math.abs(b.newTrimMs - 38)).toBeLessThanOrEqual(12);
    expect(Math.abs(c.newTrimMs - -22)).toBeLessThanOrEqual(12);
  });

  it('clamps to the API-accepted trim range', () => {
    const updates = computeTrimUpdates(
      [
        { screenId: 'A', phaseMs: 0, currentTrimMs: 0 },
        { screenId: 'B', phaseMs: 400, currentTrimMs: 1_900 },
      ],
      'A',
    );
    expect(updates.find((u) => u.screenId === 'B')!.newTrimMs).toBe(2_000);
  });

  it('empty input → empty output', () => {
    expect(computeTrimUpdates([])).toEqual([]);
  });
});
