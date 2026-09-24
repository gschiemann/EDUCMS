/**
 * videoQuality.ts — the player's playback sample for the last video: dropped
 * frames, and the pauses it made to buffer.
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
 * ── REBUFFER PAUSES (`stalls` / `stalledMs`) ────────────────────────────
 * The clip that stuttered turned out to be a 720p H.264 MP4 with its index
 * at the END of the file (no fast start): a DELIVERY problem, which drops no
 * frames at all — playback simply stops while the next bytes arrive. So the
 * tracker also listens to the element and counts an episode from `waiting`
 * (playback stopped for lack of data) to the `playing` that resumes it, or
 * to a `pause`/`ended` — plus the wall-clock time spent inside. Same delta
 * semantics as the frames: the counts restart at every re-base. An episode
 * still open at a report is counted in it, and carries on into the next
 * stretch from the re-base instant — each report says what happened inside
 * its own window, and since the server keeps only the latest, "paused 0
 * times (15 s)" must never be a possible reading.
 *
 * Two kinds of `waiting` are deliberately NOT pauses:
 *   - THE INITIAL LOAD. An activation that is not already buffered fires
 *     `waiting` before its first frame (HTML: play() at readyState ≤
 *     HAVE_CURRENT_DATA) — and on an element that has data, activation's
 *     reset to 0 (`currentTime = …`) is itself a seek, which lowers
 *     readyState on its own. So the first `waiting` before the first
 *     `playing` is time-to-first-frame, not a stop mid-clip; counting it
 *     would grade every cold start "paused once". A stall already under way
 *     at attach is ignored the same way (its `waiting` was never seen).
 *   - A SEEK. Chromium lowers readyState to HAVE_METADATA on EVERY seek and
 *     fires `waiting` when the element was playing (html_media_element.cc,
 *     SetReadyState's seeking branch). A solo playlist's native `loop` IS a
 *     seek back to 0, and so is the sync servo's correction — counted, every
 *     looping clip would read "paused 6 times" a minute. So a `waiting`
 *     between `seeking` and `seeked` is skipped. The EVENT flag leads, not
 *     `el.seeking` alone: Chromium can clear `seeking` (FinishSeek) before
 *     the `waiting` it queued at the seek's start is dispatched. A seek that
 *     then genuinely starves goes uncounted — the conservative side to be
 *     wrong on.
 *
 * An element that cannot be listened to reports frames only: the stall keys
 * are ABSENT ("not counted"), never 0 ("counted, none").
 *
 * Player reliability rules: no timers, no network, nothing that advances
 * content — a read of two counters and six event listeners, on an effect
 * the page already has, taken off again on detach.
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
  /** Rebuffer counting listens here; an element without them reports frames only. */
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
  seeking?: boolean;
}

/** Below this many frames a sample says nothing reliable (5 s at 30 fps). */
export const VIDEO_QUALITY_MIN_FRAMES = 150;

/** The media events rebuffer counting listens to. */
const STALL_EVENTS = ['waiting', 'playing', 'pause', 'ended', 'seeking', 'seeked'] as const;
type StallEvent = (typeof STALL_EVENTS)[number];

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

/** Rebuffer bookkeeping for the element on glass. */
interface Stalls {
  /** Pauses closed in this stretch. */
  count: number;
  /** Wall-clock ms inside them. */
  ms: number;
  /** When the open pause began (or this stretch took it over), else null. */
  openSinceMs: number | null;
  /** A `playing` has been seen since attach — before it, `waiting` is the initial load. */
  started: boolean;
  /** Between `seeking` and `seeked` — a `waiting` here is the seek, not a pause. */
  seeking: boolean;
  unlisten: () => void;
}

interface Active {
  el: VideoQualitySource;
  src: string;
  base: VideoQualityCounters;
  sinceMs: number;
  /** Null when the element cannot be listened to: frames only, no stall keys. */
  stalls: Stalls | null;
}

export class VideoQualityTracker {
  private active: Active | null = null;
  private pending: TelemetryVideoReport | null = null;
  /** Wall clock for the media-event handlers; `attach`/`detach`/`take` are handed theirs. */
  private readonly clock: () => number;

  constructor(clock: () => number = () => Date.now()) {
    this.clock = clock;
  }

  /** A slide became the one on glass. Records the base reading; replaces any earlier element. */
  attach(el: VideoQualitySource, src: string, nowMs: number): void {
    if (this.active) {
      if (this.active.el !== el) this.finish(nowMs);
      // The same element again: re-based silently, as before — never listened to twice.
      else this.drop();
    }
    const base = readVideoQuality(el);
    if (!base) return;
    this.active = { el, src, base, sinceMs: nowMs, stalls: this.listen(el) };
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
    const a = this.active;
    if (!a) return null;
    const report = this.delta(a, nowMs);
    if (!report) return null;
    // Re-base so the next tick reports only what happened after this one.
    const now = readVideoQuality(a.el);
    if (now) {
      a.base = now;
      a.sinceMs = nowMs;
      if (a.stalls) {
        a.stalls.count = 0;
        a.stalls.ms = 0;
        // A pause still open carries on into the next stretch from here.
        if (a.stalls.openSinceMs !== null) a.stalls.openSinceMs = nowMs;
      }
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
    a.stalls?.unlisten();
    const report = this.delta(a, nowMs);
    if (report) this.pending = report;
  }

  /** Let go of the active element without a report. */
  private drop(): void {
    this.active?.stalls?.unlisten();
    this.active = null;
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
    const s = a.stalls;
    if (s) {
      // A pause still open at this instant counts, up to now.
      const open = s.openSinceMs;
      report.stalls = s.count + (open === null ? 0 : 1);
      report.stalledMs = Math.floor(s.ms + (open === null ? 0 : Math.max(0, nowMs - open)));
    }
    return report;
  }

  /** Rebuffer counting on this element, or null when it cannot be listened to. */
  private listen(el: VideoQualitySource): Stalls | null {
    if (typeof el.addEventListener !== 'function' || typeof el.removeEventListener !== 'function') return null;
    const s: Stalls = { count: 0, ms: 0, openSinceMs: null, started: false, seeking: false, unlisten: () => {} };
    const close = () => {
      if (s.openSinceMs === null) return;
      s.count += 1;
      s.ms += Math.max(0, this.clock() - s.openSinceMs);
      s.openSinceMs = null;
    };
    const on: Record<StallEvent, () => void> = {
      waiting: () => {
        // The initial load, a seek, or a pause already open — not a new pause.
        if (!s.started || s.seeking || el.seeking === true || s.openSinceMs !== null) return;
        s.openSinceMs = this.clock();
      },
      playing: () => {
        s.started = true;
        // Frames are flowing, so no seek is pending — also clears a flag whose
        // `seeked` a reload (`load()`) cancelled before it was dispatched.
        s.seeking = false;
        close();
      },
      pause: close,
      ended: close,
      seeking: () => {
        s.seeking = true;
      },
      seeked: () => {
        s.seeking = false;
      },
    };
    s.unlisten = () => {
      try {
        for (const type of STALL_EVENTS) el.removeEventListener?.(type, on[type]);
      } catch {
        /* the element is going away regardless */
      }
    };
    try {
      for (const type of STALL_EVENTS) el.addEventListener?.(type, on[type]);
    } catch {
      // Telemetry must never break a slide: undo, and count frames only.
      s.unlisten();
      return null;
    }
    return s;
  }
}

/** The page's one tracker — one screen, one element on glass at a time. */
export const videoQualityTracker = new VideoQualityTracker();
