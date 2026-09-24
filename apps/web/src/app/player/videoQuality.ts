/**
 * videoQuality.ts — the player's dropped-frame sample for the last video.
 *
 * "Was it the file or the player?" (Greg, 2026-09-24, after a Canva export
 * stuttered on a kiosk). The Media Library grades the FILE from ffprobe; this
 * is the SCREEN's side of the answer: what the compositor actually did with
 * the frames the decoder produced, read from the `<video>` element itself
 * (`getVideoPlaybackQuality()`, with the older WebKit counters as fallback)
 * and shipped on the routine telemetry POST as `video`. The dashboard shows it
 * as "Played smoothly / Hitched / Stuttered on this screen".
 *
 * Contract (pure, tested without the 8.6k-line page):
 *   - ONE active element at a time. `attach` on activation records a base
 *     reading; `detach` on deactivation/unmount takes the final delta.
 *   - A report is the DELTA since the last base — never the element's
 *     lifetime totals — so a looping clip reports each stretch on its own
 *     and a long clip reports mid-play, at most once per telemetry tick.
 *   - Fewer than `VIDEO_QUALITY_MIN_FRAMES` frames say nothing (a clip that
 *     was skipped past, a tick that landed right after activation).
 *   - `take` hands out at most ONE report and clears it — the wire is one
 *     sample per POST, latest wins, and the server keeps the latest.
 *
 * Player reliability rules: no timers, no network, nothing that advances
 * content — a read of two counters, on an event the page already has.
 */
import type { TelemetryVideoReport } from './telemetry';

export interface VideoQualityCounters {
  totalFrames: number;
  droppedFrames: number;
}

/** The subset of HTMLVideoElement this module reads — kept narrow for tests. */
export interface VideoQualitySource {
  getVideoPlaybackQuality?: () => { totalVideoFrames: number; droppedVideoFrames: number };
  /** Older WebKit (Chromium < 80 forks, Safari < 13.1). */
  webkitDecodedFrameCount?: number;
  webkitDroppedFrameCount?: number;
  videoWidth?: number;
  videoHeight?: number;
}

/** Below this many frames a sample says nothing reliable (5 s at 30 fps). */
export const VIDEO_QUALITY_MIN_FRAMES = 150;

const nonNegInt = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;

/** The element's lifetime counters, or null when the browser exposes neither API. */
export function readVideoQuality(v: VideoQualitySource | null | undefined): VideoQualityCounters | null {
  if (!v) return null;
  if (typeof v.getVideoPlaybackQuality === 'function') {
    try {
      const q = v.getVideoPlaybackQuality();
      const total = nonNegInt(q?.totalVideoFrames);
      const dropped = nonNegInt(q?.droppedVideoFrames);
      if (total !== null && dropped !== null) return { totalFrames: total, droppedFrames: Math.min(dropped, total) };
    } catch {
      /* fall through to the legacy counters */
    }
  }
  const total = nonNegInt(v.webkitDecodedFrameCount);
  const dropped = nonNegInt(v.webkitDroppedFrameCount);
  if (total !== null && dropped !== null) return { totalFrames: total, droppedFrames: Math.min(dropped, total) };
  return null;
}

interface Active {
  el: VideoQualitySource;
  src: string;
  base: VideoQualityCounters;
  sinceMs: number;
}

export class VideoQualityTracker {
  private active: Active | null = null;
  private pending: TelemetryVideoReport | null = null;

  /** A slide became the one on glass. Records the base reading; replaces any earlier element. */
  attach(el: VideoQualitySource, src: string, nowMs: number): void {
    if (this.active && this.active.el !== el) this.finish(nowMs);
    const base = readVideoQuality(el);
    if (!base) {
      this.active = null;
      return;
    }
    this.active = { el, src, base, sinceMs: nowMs };
  }

  /** The slide left the glass (ended, advanced, unmounted). Takes the final delta. */
  detach(el: VideoQualitySource, nowMs: number): void {
    if (!this.active || this.active.el !== el) return;
    this.finish(nowMs);
  }

  /**
   * The telemetry tick's read: the pending final sample if there is one,
   * else a mid-play sample from the active element when enough frames have
   * gone by since the last base. At most one report; clears what it returns.
   */
  take(nowMs: number): TelemetryVideoReport | null {
    if (this.pending) {
      const out = this.pending;
      this.pending = null;
      return out;
    }
    if (!this.active) return null;
    const report = this.delta(this.active, nowMs);
    if (!report) return null;
    // Re-base so the next tick reports only what happened after this one.
    const now = readVideoQuality(this.active.el);
    if (now) {
      this.active.base = now;
      this.active.sinceMs = nowMs;
    }
    return report;
  }

  /** For tests and diagnostics. */
  get hasPending(): boolean {
    return this.pending !== null;
  }

  private finish(nowMs: number): void {
    const a = this.active;
    this.active = null;
    if (!a) return;
    const report = this.delta(a, nowMs);
    if (report) this.pending = report;
  }

  private delta(a: Active, nowMs: number): TelemetryVideoReport | null {
    const now = readVideoQuality(a.el);
    if (!now) return null;
    const totalFrames = now.totalFrames - a.base.totalFrames;
    const droppedFrames = now.droppedFrames - a.base.droppedFrames;
    // A reset counter (the element reloaded) reads negative — nothing to say.
    if (totalFrames < VIDEO_QUALITY_MIN_FRAMES || droppedFrames < 0) return null;
    const report: TelemetryVideoReport = {
      url: a.src,
      totalFrames,
      droppedFrames: Math.min(droppedFrames, totalFrames),
      elapsedMs: Math.max(0, Math.floor(nowMs - a.sinceMs)),
    };
    const w = nonNegInt(a.el.videoWidth);
    const h = nonNegInt(a.el.videoHeight);
    if (w && h) {
      report.width = w;
      report.height = h;
    }
    return report;
  }
}

/** The page's one tracker — one screen, one element on glass at a time. */
export const videoQualityTracker = new VideoQualityTracker();
