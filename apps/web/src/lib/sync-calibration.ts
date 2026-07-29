/**
 * sync-calibration — pure math for the camera auto-calibration wizard
 * (tier-3, 2026-07-28). docs/research/2026-07-28-multiscreen-sync/.
 *
 * The wizard films screens showing the CALIBRATE_FLASH pattern (120ms
 * white flash on every synced second, timed off each screen's TRIMMED
 * clock). From each tagged screen-region's per-frame luminance series we:
 *
 *   1. detect flash onsets (50%-crossing rising edges, sub-frame
 *      interpolated — beats the camera's 30/60fps quantization),
 *   2. reduce onsets to a circular phase within the 1000ms period
 *      (circular because a phase of 995ms and 5ms are 10ms apart, not
 *      990), with a coherence gate that rejects shaky/garbage captures,
 *   3. convert phase deltas between screens into trim updates:
 *      a screen whose flash appears LATER than the reference has more
 *      glass latency and gets MORE trim (trim = flip earlier).
 *
 * Derivation of the sign (design doc §8): screen i draws its flash when
 * trueServerTime T satisfies T + trim_i ≡ 0 (mod P), photons appear at
 * T + glass_i, so observed phase φ_i ≡ glass_i − trim_i + cameraConst.
 * Simultaneous photons across screens ⟺ (glass_i − newTrim_i) equal ⟺
 * newTrim_i = oldTrim_i + circularDelta(φ_i − φ_ref).
 *
 * Everything here is a pure function of arrays — no camera, no DOM —
 * exhaustively unit-tested (same discipline as syncClock/syncTimeline).
 */

export interface LumaSample {
  /** Capture-relative time of the video frame, ms. */
  tMs: number;
  /** Mean luminance of the tagged region for that frame (any scale). */
  v: number;
}

export const FLASH_PERIOD_MS = 1000;

/** Minimum peak-to-baseline contrast (relative to range) to accept. */
const MIN_CONTRAST_ABS = 20; // on a 0-255 luma scale
/** Two onsets closer than this are one flash (noise/dedupe). */
const MIN_ONSET_GAP_MS = 400;
/** Circular coherence gate: mean resultant length below this = garbage. */
const MIN_COHERENCE = 0.7;

/**
 * Rising-edge flash onsets with sub-frame interpolation. Returns [] when
 * the region never actually flashes (no contrast — wrong tag, screen off).
 */
export function detectFlashOnsets(samples: readonly LumaSample[]): number[] {
  if (samples.length < 8) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const s of samples) {
    if (!Number.isFinite(s.v) || !Number.isFinite(s.tMs)) continue;
    if (s.v < min) min = s.v;
    if (s.v > max) max = s.v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < MIN_CONTRAST_ABS) return [];
  const thr = min + (max - min) / 2;

  const onsets: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a.v < thr && b.v >= thr) {
      // Sub-frame: linear interpolation of the crossing instant.
      const frac = (thr - a.v) / (b.v - a.v);
      const t = a.tMs + frac * (b.tMs - a.tMs);
      if (onsets.length === 0 || t - onsets[onsets.length - 1] >= MIN_ONSET_GAP_MS) {
        onsets.push(t);
      }
    }
  }
  return onsets;
}

/**
 * Circular mean phase of the onsets within the flash period, ms ∈ [0, P).
 * Null when there are too few onsets or they don't agree (coherence gate)
 * — the wizard tells the operator to hold steadier / re-tag.
 */
export function circularPhaseMs(onsets: readonly number[], periodMs: number = FLASH_PERIOD_MS): number | null {
  if (onsets.length < 3) return null;
  let sinSum = 0;
  let cosSum = 0;
  for (const t of onsets) {
    const theta = (2 * Math.PI * (((t % periodMs) + periodMs) % periodMs)) / periodMs;
    sinSum += Math.sin(theta);
    cosSum += Math.cos(theta);
  }
  const n = onsets.length;
  const resultant = Math.sqrt(sinSum * sinSum + cosSum * cosSum) / n;
  if (resultant < MIN_COHERENCE) return null;
  const theta = Math.atan2(sinSum / n, cosSum / n);
  const phase = ((theta / (2 * Math.PI)) * periodMs + periodMs) % periodMs;
  return phase;
}

/**
 * ±confidence of a phase estimate, ms (circular std of onsets around the
 * mean). Shown to the operator ("measured ±4ms").
 */
export function phaseConfidenceMs(onsets: readonly number[], periodMs: number = FLASH_PERIOD_MS): number | null {
  const phase = circularPhaseMs(onsets, periodMs);
  if (phase === null) return null;
  let sumSq = 0;
  for (const t of onsets) {
    const d = circularDeltaMs(((t % periodMs) + periodMs) % periodMs, phase, periodMs);
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / onsets.length);
}

/** Signed shortest circular difference a−b, in (−P/2, P/2]. */
export function circularDeltaMs(a: number, b: number, periodMs: number = FLASH_PERIOD_MS): number {
  let d = (((a - b) % periodMs) + periodMs) % periodMs;
  if (d > periodMs / 2) d -= periodMs;
  return d;
}

export interface ScreenPhaseMeasurement {
  screenId: string;
  /** Observed flash phase from the camera, ms ∈ [0, P). */
  phaseMs: number;
  /** The trim the screen was running DURING the measurement. */
  currentTrimMs: number;
}

export interface TrimUpdate {
  screenId: string;
  /** Glass delta vs the reference screen (+ = appears later). */
  deltaMs: number;
  newTrimMs: number;
}

/**
 * Turn per-screen phases into trim updates that align every screen's
 * photons with the reference screen's. Reference keeps its current trim.
 */
export function computeTrimUpdates(
  measurements: readonly ScreenPhaseMeasurement[],
  refScreenId?: string,
  periodMs: number = FLASH_PERIOD_MS,
): TrimUpdate[] {
  if (measurements.length === 0) return [];
  const ref = measurements.find((m) => m.screenId === refScreenId) ?? measurements[0];
  return measurements.map((m) => {
    const deltaMs = circularDeltaMs(m.phaseMs, ref.phaseMs, periodMs);
    const newTrimMs = Math.max(-2000, Math.min(2000, Math.round(m.currentTrimMs + deltaMs)));
    return { screenId: m.screenId, deltaMs: Math.round(deltaMs * 10) / 10, newTrimMs };
  });
}
