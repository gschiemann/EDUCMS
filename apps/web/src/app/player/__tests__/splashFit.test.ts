/**
 * fitSplashK — the height veto on the diagnostic card's scale.
 *
 * The layout is faked as "content needs N px per unit of k, the window has H":
 * the same shape the real card has, where every dimension is calc(N * k).
 */
import { fitSplashK, SPLASH_K_MIN } from '../splashFit';

/** overflows(k) for a card whose content is `perK * k` tall in a `room` window
 *  that itself SHRINKS as k grows (the header and footer scale too). */
const layout = (perK: number, room: number, chromePerK: number) => {
  const probes: number[] = [];
  const overflows = (k: number) => { probes.push(k); return perK * k > room - chromePerK * k; };
  return { overflows, probes };
};

describe('fitSplashK', () => {
  it('leaves a card that already fits EXACTLY alone — one probe, start returned', () => {
    const { overflows, probes } = layout(300, 1900, 340);
    expect(fitSplashK({ start: 1.5, overflows })).toBe(1.5);
    expect(probes).toEqual([1.5]);
  });

  it('never probes at all when there is nothing to give back (LED wall: start === min)', () => {
    const { overflows, probes } = layout(9999, 10, 0);
    expect(fitSplashK({ start: 1, overflows })).toBe(1);
    expect(probes).toEqual([]);
  });

  it('the TC32: 1.5 overflows on 1080 px, and the LARGEST fitting step wins', () => {
    // Measured on the real card: fits at 1.25, overflows by 22 px at 1.30.
    const { overflows } = layout(390, 1016, 412);
    const k = fitSplashK({ start: 1.5, overflows });
    expect(k).toBe(1.25);
    expect(overflows(k)).toBe(false);
    expect(overflows(1.3)).toBe(true);
  });

  it('returns a value it actually probed — never an interpolation', () => {
    const { overflows, probes } = layout(390, 1016, 412);
    const k = fitSplashK({ start: 1.5, overflows });
    expect(probes).toContain(k);
  });

  it('is cheap: at most 6 probes to search 1.5 → 1', () => {
    const { overflows, probes } = layout(390, 1016, 412);
    fitSplashK({ start: 1.5, overflows });
    expect(probes.length).toBeLessThanOrEqual(6);
  });

  it('when even the design size overflows, it stops at the floor — scroll is the last resort', () => {
    const { overflows } = layout(5000, 500, 100);
    expect(fitSplashK({ start: 1.5, overflows })).toBe(SPLASH_K_MIN);
  });

  it('handles a start that is off the 0.05 grid (2560-wide panel → 1.33)', () => {
    // fits up to k = 1.2
    const overflows = (k: number) => k > 1.2 + 1e-9;
    expect(fitSplashK({ start: 1.33, overflows })).toBe(1.2);
    // and when only the top of the grid fits
    const nearTop = (k: number) => k > 1.31;
    expect(fitSplashK({ start: 1.33, overflows: nearTop })).toBe(1.3);
  });

  it('every grid answer between the floor and the start is reachable', () => {
    for (let limit = 1; limit <= 1.45 + 1e-9; limit += 0.05) {
      const want = Math.round(limit * 100) / 100;
      const overflows = (k: number) => k > want + 1e-9;
      expect(fitSplashK({ start: 1.5, overflows })).toBe(want);
    }
  });
});
