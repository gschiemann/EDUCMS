import {
  NATIVE_YIELD_EARLY_MS,
  NATIVE_YIELD_EARLY_WINDOW_MS,
  NATIVE_YIELD_STEADY_MS,
  nativeYieldDelayMs,
} from '../nativeYield';

describe('cache work yields to a presenting native decoder (1.1.45)', () => {
  const t0 = 1_000_000;
  it('nothing native on the glass → go now', () => {
    expect(nativeYieldDelayMs({ presenting: false, presentingSince: null, now: t0 })).toBe(0);
    expect(nativeYieldDelayMs({ presenting: false, presentingSince: t0 - 5_000, now: t0 })).toBe(0);
  });
  it('the first minute of a native session (where the field stalls cluster) → the long pause', () => {
    expect(nativeYieldDelayMs({ presenting: true, presentingSince: t0, now: t0 })).toBe(NATIVE_YIELD_EARLY_MS);
    expect(nativeYieldDelayMs({ presenting: true, presentingSince: null, now: t0 })).toBe(NATIVE_YIELD_EARLY_MS);
    expect(nativeYieldDelayMs({ presenting: true, presentingSince: t0, now: t0 + NATIVE_YIELD_EARLY_WINDOW_MS - 1 })).toBe(NATIVE_YIELD_EARLY_MS);
  });
  it('afterwards → the short pause; the work still finishes (stretched, never skipped)', () => {
    expect(nativeYieldDelayMs({ presenting: true, presentingSince: t0, now: t0 + NATIVE_YIELD_EARLY_WINDOW_MS })).toBe(NATIVE_YIELD_STEADY_MS);
    expect(NATIVE_YIELD_STEADY_MS).toBeGreaterThan(0);
    expect(NATIVE_YIELD_STEADY_MS).toBeLessThan(NATIVE_YIELD_EARLY_MS);
  });
  it('the emergency tier is NEVER paced (rule 11)', () => {
    expect(nativeYieldDelayMs({ presenting: true, presentingSince: t0, now: t0, tier: 'emergency' })).toBe(0);
  });
});
