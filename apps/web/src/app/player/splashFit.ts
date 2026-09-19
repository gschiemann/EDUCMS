/**
 * Fit the operator/diagnostic card to the glass (2026-09-19).
 *
 * Greg, photo of a TC32 (1920×1080) on "Playback Paused":
 *   "all 1920x1080 screens are cutting the resolution on the paired splash screen"
 *
 * THE PROBLEM. `--splash-k` scales every element of that card. It is derived
 * from the panel's LONG EDGE ONLY, with a 1.5 floor on any panel that has no
 * LED canvas pin (2026-09-02 — "12 px labels on a TV"). 1.5 is the right size
 * for a 2880×1620 panel. A 1920×1080 panel gets the same 1.5 on 1080 px of
 * height: the header and the footer grow, and the middle section — which the
 * 2026-05-04 layout makes `overflow-y: auto` so the buttons can never be pushed
 * off — is left a slice and SCROLLS. Measured: 585 px of content in a 405 px
 * window, 180 px hidden. A wall-mounted TV cannot scroll, so on glass that is
 * simply a card with its middle cut off.
 *
 * THE FIX. Width picks the STARTING scale, height gets a veto: if the middle
 * overflows at the starting scale, step down to the largest scale at which it
 * does not. Never below 1 (the design size — below that the text is smaller
 * than the dashboard's, and the scroll is the honest last resort, exactly as it
 * was before `--splash-k` existed).
 *
 * WHO THIS CANNOT TOUCH. A surface whose content already fits keeps its scale
 * exactly — `fitSplashK` returns `start` on the first probe and the caller
 * writes nothing. That is every LED wall (start === min === 1), every portrait
 * LCD (1920 px of height), and every 4K panel.
 *
 * PURE: no DOM, no React. The caller supplies `overflows`, which is the only
 * thing that knows about layout.
 */

/** Smallest scale the fit will ever choose — the card's own design size. */
export const SPLASH_K_MIN = 1;

/** Grid the fit searches on. 0.05 ≈ one visible size step; finer is noise. */
export const SPLASH_K_STEP = 0.05;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The largest scale in [min, start] (on the STEP grid, plus `start` itself) at
 * which `overflows(k)` is false.
 *
 *   • start fits            → start          (1 probe, nothing changes)
 *   • nothing fits          → min            (scroll remains the last resort)
 *   • otherwise             → binary search  (≤ 5 probes for 1.5 → 1)
 *
 * Binary search assumes overflow is monotonic in k, which holds for a layout
 * whose every dimension is `calc(N * k)`. Text wrapping can bend that by a
 * pixel or two, so the RETURNED value is always one that was itself probed and
 * found to fit — never an interpolation.
 */
export function fitSplashK(opts: {
  start: number;
  min?: number;
  step?: number;
  overflows: (k: number) => boolean;
}): number {
  const min = opts.min ?? SPLASH_K_MIN;
  const step = opts.step ?? SPLASH_K_STEP;
  const start = round2(opts.start);
  if (!(start > min)) return start;           // nothing to give back
  if (!opts.overflows(start)) return start;   // already fits — touch nothing

  // Grid points strictly below start, descending from the top: min + i*step.
  const n = Math.floor((start - min) / step + 1e-9);
  // If start sits exactly on the grid, its own point is already known to fail.
  const top = round2(min + n * step) >= start ? n - 1 : n;
  if (top < 0) return min;
  if (opts.overflows(min)) return min;         // even the design size overflows

  // Invariant: grid[lo] fits, grid[hi + 1] (or start) overflows.
  let lo = 0;
  let hi = top;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (opts.overflows(round2(min + mid * step))) hi = mid - 1;
    else lo = mid;
  }
  return round2(min + lo * step);
}
