/**
 * SyncClock — the player's shared-clock estimator for frame-locked
 * multi-screen sync (2026-07-28).
 * Design: docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md §4.
 *
 * Estimates "server time" from ping samples (WS TIME_PING/TIME_PONG,
 * or the HTTP /realtime/time fallback) using Cristian's algorithm with
 * NTP-style filtering:
 *
 *   sampleOffset = serverNow + rtt/2 - t1        (maps LOCAL MONO ms → server ms)
 *   keep the newest 24 samples → take the best-RTT 25% → median offset
 *
 * The min-RTT filter is what crushes jitter: a queued/delayed sample has
 * inflated RTT and gets discarded; the samples that survive bound the
 * asymmetry error at ±rtt_min/2.
 *
 * LOCAL TIMEBASE IS performance.now(), NEVER Date.now(). Android signage
 * boxes boot with no NTP and then STEP their wall clock minutes at a time
 * when NTP lands mid-session; performance.now() is monotonic and immune.
 * (The whole reason the emergency freshness gate grew clock-offset
 * compensation — see page.tsx AUTH_OK handling — is that Date.now() on
 * these devices lies.)
 *
 * SLEW, DON'T STEP: once locked, the applied offset chases the estimated
 * offset at ≤ SLEW_MS_PER_SEC so on-screen content never visibly jumps;
 * a correction > STEP_THRESHOLD_MS (clock was wildly wrong) steps
 * immediately — one visible snap, then locked.
 *
 * Pure TypeScript, zero React/DOM/network — the caller injects samples
 * and asks for now()/uncertainty. Exhaustively unit-testable without
 * mounting the 8.6k-line player page (same discipline as
 * emergencyReconcile.ts).
 */

export interface ClockSample {
  /** ms to ADD to local monotonic time to get server time. */
  offsetMs: number;
  rttMs: number;
  /** Local monotonic time (performance.now()) when the sample landed. */
  atMono: number;
}

export interface SyncClockStats {
  locked: boolean;
  offsetMs: number | null;
  uncertaintyMs: number;
  rttMs: number | null;
  sampleCount: number;
  lastSampleAgeMs: number | null;
  /** Estimated crystal skew (ppm) once enough well-spread samples exist. */
  skewPpm: number | null;
}

const MAX_SAMPLES = 24;
/** Best-RTT fraction of the window used for the offset estimate. */
const BEST_FRACTION = 0.25;
const MIN_SAMPLES_TO_LOCK = 4;
/** Max slew rate once locked — invisible to the eye. */
const SLEW_MS_PER_SEC = 2;
/** Corrections above this step instantly (initial lock / wild clock). */
const STEP_THRESHOLD_MS = 250;
/**
 * Crystal-drift allowance while coasting between samples. Commodity
 * device crystals run ±10–50 ppm; 30 ppm ≈ 1.8 ms/min is a conservative
 * middle. Feeds the uncertainty estimate; the SKEW MODEL below actively
 * cancels the measurable part of it.
 */
const DRIFT_PPM = 30;
/**
 * Crystal skew-rate model (GStreamer netclientclock-style calibration,
 * 2026-07-28 tier-1): this device's crystal runs fast/slow at some
 * near-constant rate (ppm). We estimate it by least-squares over the
 * lower-RTT half of the sample window and EXTRAPOLATE the offset while
 * coasting — so a screen that loses its network drifts at the residual
 * (thermal wobble, ~1 ppm/°C) instead of the full crystal rate. Gated
 * conservatively: needs SKEW_MIN_SAMPLES spanning SKEW_MIN_SPAN_MS,
 * slope clamped to ±SKEW_MAX_PPM, correction capped at ±SKEW_MAX_CORR_MS.
 */
const SKEW_MIN_SAMPLES = 8;
const SKEW_MIN_SPAN_MS = 60_000;
const SKEW_MAX_PPM = 150;
const SKEW_MAX_CORR_MS = 80;

export class SyncClock {
  private samples: ClockSample[] = [];
  private appliedOffsetMs: number | null = null;
  private lastSlewAtMono: number | null = null;

  /** Ingest one ping round-trip. t0/t1 are performance.now() ms. */
  addSample(serverNowMs: number, t0Mono: number, t1Mono: number): void {
    if (
      !Number.isFinite(serverNowMs) ||
      !Number.isFinite(t0Mono) ||
      !Number.isFinite(t1Mono) ||
      t1Mono < t0Mono
    ) {
      return;
    }
    const rttMs = t1Mono - t0Mono;
    // A pathological RTT carries ~no information (asymmetry bound is
    // ±rtt/2). Cap so one 30s-stalled response can't poison the window.
    if (rttMs > 10_000) return;
    const offsetMs = serverNowMs + rttMs / 2 - t1Mono;
    this.samples.push({ offsetMs, rttMs, atMono: t1Mono });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  /**
   * Crystal skew rate in ppm (positive = this device's mono clock runs
   * SLOW vs the server, so offset grows over time). Least-squares slope
   * of offset-vs-monoTime over the lower-RTT half of the window. Null
   * until enough well-spread samples exist.
   */
  estimateSkewPpm(): number | null {
    if (this.samples.length < SKEW_MIN_SAMPLES) return null;
    const byRtt = [...this.samples].sort((a, b) => a.rttMs - b.rttMs);
    const keep = byRtt.slice(0, Math.max(SKEW_MIN_SAMPLES, Math.ceil(byRtt.length / 2)));
    const n = keep.length;
    const span = Math.max(...keep.map((s) => s.atMono)) - Math.min(...keep.map((s) => s.atMono));
    if (span < SKEW_MIN_SPAN_MS) return null;
    const meanT = keep.reduce((a, s) => a + s.atMono, 0) / n;
    const meanO = keep.reduce((a, s) => a + s.offsetMs, 0) / n;
    let num = 0;
    let den = 0;
    for (const s of keep) {
      num += (s.atMono - meanT) * (s.offsetMs - meanO);
      den += (s.atMono - meanT) * (s.atMono - meanT);
    }
    if (den === 0) return null;
    const ppm = (num / den) * 1e6; // ms-per-ms → parts per million
    return Math.max(-SKEW_MAX_PPM, Math.min(SKEW_MAX_PPM, ppm));
  }

  /** Best current estimate of the mono→server offset at monoNow (unslewed). */
  private estimateOffsetMs(monoNow: number): number | null {
    if (this.samples.length === 0) return null;
    const byRtt = [...this.samples].sort((a, b) => a.rttMs - b.rttMs);
    const keep = Math.max(1, Math.min(byRtt.length, Math.ceil(byRtt.length * BEST_FRACTION)));
    const bestSamples = byRtt.slice(0, keep);
    const best = bestSamples.map((s) => s.offsetMs).sort((a, b) => a - b);
    const mid = Math.floor(best.length / 2);
    const median = best.length % 2 === 1 ? best[mid] : (best[mid - 1] + best[mid]) / 2;
    // Skew extrapolation: project the median forward from the best
    // samples' center of mass so coasting tracks the crystal's known
    // rate instead of freezing at the last fix.
    const skew = this.estimateSkewPpm();
    if (skew === null) return median;
    const refMono = bestSamples.reduce((a, s) => a + s.atMono, 0) / bestSamples.length;
    const corr = (skew / 1e6) * (monoNow - refMono);
    return median + Math.max(-SKEW_MAX_CORR_MS, Math.min(SKEW_MAX_CORR_MS, corr));
  }

  /**
   * Server-time "now" for the given local monotonic instant, with slew
   * applied. Returns null until the first sample exists.
   */
  now(monoNow: number): number | null {
    const target = this.estimateOffsetMs(monoNow);
    if (target === null) return null;

    if (this.appliedOffsetMs === null || Math.abs(target - this.appliedOffsetMs) > STEP_THRESHOLD_MS) {
      // Initial lock or wildly-wrong clock: step once.
      this.appliedOffsetMs = target;
      this.lastSlewAtMono = monoNow;
    } else {
      // Slew toward the estimate at the capped rate.
      const dtSec = Math.max(0, (monoNow - (this.lastSlewAtMono ?? monoNow)) / 1000);
      const maxMove = SLEW_MS_PER_SEC * dtSec;
      const diff = target - this.appliedOffsetMs;
      this.appliedOffsetMs += Math.abs(diff) <= maxMove ? diff : Math.sign(diff) * maxMove;
      this.lastSlewAtMono = monoNow;
    }
    return monoNow + this.appliedOffsetMs;
  }

  /**
   * How wrong now() might plausibly be, in ms: half the min RTT
   * (asymmetry bound) + spread of the best samples + drift while
   * coasting since the newest sample. Infinity until enough samples.
   */
  uncertaintyMs(monoNow: number): number {
    if (this.samples.length < MIN_SAMPLES_TO_LOCK) return Number.POSITIVE_INFINITY;
    const byRtt = [...this.samples].sort((a, b) => a.rttMs - b.rttMs);
    const keep = Math.max(1, Math.ceil(byRtt.length * BEST_FRACTION));
    const best = byRtt.slice(0, keep);
    const minRtt = best[0].rttMs;
    const offsets = best.map((s) => s.offsetMs);
    const spread = Math.max(...offsets) - Math.min(...offsets);
    const newestAt = Math.max(...this.samples.map((s) => s.atMono));
    const coastMs = Math.max(0, monoNow - newestAt);
    const driftAllowance = (coastMs / 1000) * (DRIFT_PPM / 1000);
    return minRtt / 2 + spread / 2 + driftAllowance;
  }

  /** Locked = enough samples and uncertainty below the caller's gate. */
  isLocked(monoNow: number, maxUncertaintyMs: number): boolean {
    return this.uncertaintyMs(monoNow) <= maxUncertaintyMs;
  }

  stats(monoNow: number): SyncClockStats {
    const byRtt = [...this.samples].sort((a, b) => a.rttMs - b.rttMs);
    const newestAt = this.samples.length ? Math.max(...this.samples.map((s) => s.atMono)) : null;
    const unc = this.uncertaintyMs(monoNow);
    return {
      locked: Number.isFinite(unc),
      offsetMs: this.appliedOffsetMs ?? this.estimateOffsetMs(monoNow),
      uncertaintyMs: unc,
      rttMs: byRtt.length ? byRtt[0].rttMs : null,
      sampleCount: this.samples.length,
      lastSampleAgeMs: newestAt !== null ? Math.max(0, monoNow - newestAt) : null,
      skewPpm: this.estimateSkewPpm(),
    };
  }

  /**
   * Adaptive sampling cadence (tier-1, 2026-07-28): a rock-solid clock
   * doesn't need frequent pings; a jittery WiFi clock does. Feeds the
   * player's TIME_PING scheduler.
   *   uncertainty < 15ms → 30s  (excellent — mostly wired)
   *   uncertainty < 40ms → 20s  (normal)
   *   otherwise          → 5s   (fight the jitter with sample volume)
   */
  recommendedPingIntervalMs(monoNow: number): number {
    const unc = this.uncertaintyMs(monoNow);
    if (!Number.isFinite(unc)) return 5_000; // acquiring — sample eagerly
    if (unc < 15) return 30_000;
    if (unc < 40) return 20_000;
    return 5_000;
  }

  /** Drop all samples (e.g. device slept — mono clock may have paused). */
  reset(): void {
    this.samples = [];
    this.appliedOffsetMs = null;
    this.lastSlewAtMono = null;
  }
}
