/**
 * loopBoundary — MEASURE the seam where a solo video starts over.
 *
 * Why (2026-09-29, video-loop audit F1/F2, RIOT Cleveland's 4K screen): the
 * player loops a solo video with the browser's own `loop`, which is a seek back
 * to 0; on an Android WebView the decoder restarts and the picture hitches. And
 * nothing could SEE it: `videoQuality.ts` deliberately ignores `waiting` during
 * a seek (a native loop IS one), so a 300 ms hold at the boundary read as
 * "played smoothly". This module is the missing instrument.
 *
 * What is measured, and how honestly:
 *   - the input is `requestVideoFrameCallback` metadata — `expectedDisplayTime`
 *     is when a frame is expected to reach the compositor's screen. It is
 *     best-effort timing in the compositor's clock, NOT a camera on the panel,
 *     so every report says `evidence: 'rvfc'` and the copy must too.
 *   - HOLD  = the time between the last frame before the seam and the first
 *             frame after it, MINUS the frames that should have fit in it. 0 is
 *             seamless; 300 means the picture froze for 300 ms too long.
 *   - SKIP  = content a hand-off trimmed (two-deck: the next deck began a little
 *             early, so a few frames of the ending never showed). 0 for native.
 *   - a missed callback is not a stall: `presentedFrames` (the element's own
 *     counter) says how many frames really went by, and the estimate is
 *     corrected by it, so a throttled callback cannot invent a hold.
 *   - nothing here reads the DOM, sets a timer or touches the network — pure,
 *     unit-tested without mounting the 13k-line page, and it never advances
 *     content (sync invariant untouched).
 */

/** `<video>` with the (feature-detected) requestVideoFrameCallback pair. */
export type RvfcVideoElement = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/** The parts of the rVFC metadata this uses. */
export interface FrameMeta {
  /** Media time of the presented frame, seconds. */
  mediaTime: number;
  /** When the frame is expected on screen — `performance.now()` timebase, ms. */
  expectedDisplayTime: number;
  /** The element's running count of frames sent to the compositor. */
  presentedFrames?: number;
  /** Optional browser decoder submission-to-ready duration, seconds. */
  processingDuration?: number;
}

export interface BoundaryEvent {
  /** Picture held past the frame period, ms (≥ 0). */
  holdMs: number;
  /** Content trimmed by a hand-off, ms (≥ 0). */
  skipMs: number;
  backend: 'native' | 'twodeck' | 'continuous';
}

export const DEFAULT_FRAME_PERIOD_MS = 1000 / 30;
/** A believable single-frame delta (fps between ~4 and ~500). */
const MIN_PERIOD_MS = 2;
const MAX_PERIOD_MS = 250;

/**
 * The frame period as the screen is really presenting it: the median of recent
 * deltas between CONSECUTIVE presented frames. Median, so one late frame does
 * not move it; only deltas of exactly one presented frame count.
 */
export class FramePeriodEstimator {
  private deltas: number[] = [];
  private prev: FrameMeta | null = null;
  constructor(private readonly keep = 30) {}

  push(m: FrameMeta): void {
    const p = this.prev;
    this.prev = m;
    if (!p || m.presentedFrames === undefined || p.presentedFrames === undefined) return;
    if (m.presentedFrames - p.presentedFrames !== 1) return;
    const d = m.expectedDisplayTime - p.expectedDisplayTime;
    if (!Number.isFinite(d) || d < MIN_PERIOD_MS || d > MAX_PERIOD_MS) return;
    this.deltas.push(d);
    if (this.deltas.length > this.keep) this.deltas.shift();
  }

  /** The median delta, or the default until there are enough samples. */
  periodMs(): number {
    if (this.deltas.length < 5) return DEFAULT_FRAME_PERIOD_MS;
    const s = [...this.deltas].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  /** Forget the previous frame (after a seek, a source change, a pause). */
  breakSequence(): void {
    this.prev = null;
  }
}

/**
 * The hold between two frames that should have been consecutive: the wall-clock
 * gap minus the time the frames in between (and the second frame itself) were
 * entitled to. Never negative — a boundary cannot be "faster than seamless".
 */
export function holdBetween(before: FrameMeta, after: FrameMeta, periodMs: number): number {
  const dt = after.expectedDisplayTime - before.expectedDisplayTime;
  if (!Number.isFinite(dt) || dt < 0) return 0;
  const frames =
    before.presentedFrames !== undefined && after.presentedFrames !== undefined
      ? Math.max(1, after.presentedFrames - before.presentedFrames)
      : 1;
  return Math.max(0, dt - frames * periodMs);
}

/**
 * The native loop: ONE element whose media time wraps from ≈ duration back to
 * ≈ 0 with no source change. Feed it every frame; it returns a BoundaryEvent
 * on the first frame after a wrap. `reset()` around anything that is NOT a
 * loop — an explicit seek, a source change, a pause — so it cannot report one.
 */
export class NativeWrapDetector {
  private prev: FrameMeta | null = null;
  private readonly period = new FramePeriodEstimator();

  onFrame(m: FrameMeta, durationS: number): BoundaryEvent | null {
    const prev = this.prev;
    this.prev = m;
    let event: BoundaryEvent | null = null;
    if (prev && Number.isFinite(durationS) && durationS > 0.2) {
      // A wrap is a big BACKWARD jump from near the end to near the start. The
      // tolerance is generous (a lagging callback lands a few frames late) but
      // bounded, so a user seek elsewhere in the file is never mistaken for one.
      const tol = Math.max(0.5, Math.min(2, durationS * 0.1));
      const wrapped =
        m.mediaTime < prev.mediaTime - durationS / 2 &&
        prev.mediaTime > durationS - tol &&
        m.mediaTime < tol;
      if (wrapped) {
        event = { holdMs: holdBetween(prev, m, this.period.periodMs()), skipMs: 0, backend: 'native' };
        this.period.breakSequence();
      }
    }
    this.period.push(m);
    return event;
  }

  reset(): void {
    this.prev = null;
    this.period.breakSequence();
  }
}

/** Continuous playback crosses an advancing timestamp boundary, never wraps
 * currentTime. Count only adjacent observed cycles; missed callbacks are still
 * corrected by the element's presented-frame counter.
 */
export class ContinuousBoundaryDetector {
  private prev: FrameMeta | null = null;
  private readonly period = new FramePeriodEstimator();
  constructor(private readonly durationTicks: number, private readonly timescale: number) {}
  onFrame(m: FrameMeta): BoundaryEvent | null {
    const p = this.prev;
    this.prev = m;
    const cycle = (time: number) => Math.floor((time * this.timescale + 0.5) / this.durationTicks);
    let event: BoundaryEvent | null = null;
    if (p && cycle(m.mediaTime) === cycle(p.mediaTime) + 1) {
      event = { backend: 'continuous', holdMs: holdBetween(p, m, this.period.periodMs()), skipMs: 0 };
    }
    this.period.push(m);
    return event;
  }
}

/** The report the telemetry tick ships (`telemetry.ts` → `loop`). */
export interface LoopBoundarySnapshot {
  backend: 'native' | 'twodeck' | 'continuous';
  boundaries: number;
  maxHoldMs: number;
  p95HoldMs: number;
  lastHoldMs: number;
  maxSkipMs: number;
  swaps: number;
  fallbacks: number;
  fallbackReason?: string;
}

/**
 * A bounded ring of recent boundaries, and the one report they add up to.
 * `take()` hands out a snapshot ONLY when something new was observed since the
 * last one — the wire is one sample per POST, latest wins, and a screen that
 * saw no boundary sends none (absent means "no boundary samples yet", never a
 * clean zero).
 */
export class LoopBoundaryTracker {
  private holds: number[] = [];
  private skips: number[] = [];
  private backend: 'native' | 'twodeck' | 'continuous' = 'native';
  private fresh = 0;
  private total = 0;
  private swaps = 0;
  private fallbacks = 0;
  private reason: string | undefined;

  constructor(private readonly capacity = 120) {}

  setBackend(b: 'native' | 'twodeck' | 'continuous'): void {
    this.backend = b;
  }

  /** A source/backend adoption starts a new measured session. Native seams
   * during preparation must not be reported as continuous-stream seams. */
  startSession(b: 'native' | 'twodeck' | 'continuous'): void {
    this.backend = b; this.holds = []; this.skips = [];
    this.fresh = 0; this.total = 0; this.swaps = 0; this.fallbacks = 0; this.reason = undefined;
  }

  record(e: BoundaryEvent): void {
    this.backend = e.backend;
    this.holds.push(Math.max(0, e.holdMs));
    this.skips.push(Math.max(0, e.skipMs));
    if (this.holds.length > this.capacity) {
      this.holds.shift();
      this.skips.shift();
    }
    this.fresh += 1;
    this.total += 1;
    if (e.backend === 'twodeck') this.swaps += 1;
  }

  noteFallback(reason: string): void {
    this.fallbacks += 1;
    this.reason = reason.slice(0, 64);
    this.backend = 'native';
    this.fresh += 1; // a fallback is news the dashboard should hear once
  }

  /** The current picture WITHOUT consuming it (tests, diagnostics). */
  peek(): LoopBoundarySnapshot | null {
    if (this.total === 0 && this.fallbacks === 0) return null;
    const sorted = [...this.holds].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : 0;
    return {
      backend: this.backend,
      boundaries: this.total,
      maxHoldMs: sorted.length ? sorted[sorted.length - 1] : 0,
      p95HoldMs: p95,
      lastHoldMs: this.holds.length ? this.holds[this.holds.length - 1] : 0,
      maxSkipMs: this.skips.length ? Math.max(...this.skips) : 0,
      swaps: this.swaps,
      fallbacks: this.fallbacks,
      ...(this.reason ? { fallbackReason: this.reason } : {}),
    };
  }

  take(): LoopBoundarySnapshot | null {
    if (this.fresh === 0) return null;
    const snap = this.peek();
    this.fresh = 0;
    return snap;
  }
}

/** The page's one tracker (one screen, one active loop at a time). */
export const loopBoundaryTracker = new LoopBoundaryTracker();

// Diagnostics, like `window.__eduSyncState`: the current picture without consuming it.
if (typeof window !== 'undefined') {
  (window as unknown as { __eduLoopBoundary?: () => LoopBoundarySnapshot | null }).__eduLoopBoundary = () =>
    loopBoundaryTracker.peek();
}
