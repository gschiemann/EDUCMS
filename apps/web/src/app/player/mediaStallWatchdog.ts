/**
 * Media-stall detection (2026-08-30 deep audit, D-2 / 1.1.6-audit P0-5).
 *
 * THE BLIND SPOT THIS CLOSES. The render proof is a document-level
 * requestAnimationFrame counter: it proves the compositor paints, not that
 * the assigned VIDEO is advancing. A <video> that stalls mid-file — flaky
 * WiFi mid-buffer, a decoder wedge on cheap Android hardware, a CDN that
 * blackholes range requests — fires no `error` and no `ended`; it just sits
 * on a frozen frame while document rAF keeps the proof green forever. The
 * 1.1.6 audit called this out explicitly ("a stalled video can remain green
 * while rAF continues") and nothing detected it.
 *
 * DESIGN. A pure sampler (no DOM, no timers — testable in microseconds)
 * fed every few seconds with the element's observable state:
 *
 *   - `paused` / `ended` / `seeking` are INTENTIONAL states — reset the
 *     reference, never stalled (the inactive-slide pause, slide swaps,
 *     sync-servo seeks all land here).
 *   - `currentTime` CHANGED since the last sample (any direction — loops
 *     wrap, servos seek backwards) → healthy, reset the reference.
 *   - Unchanged while nominally playing for > `stallAfterMs` → 'stalled',
 *     reported ONCE per stall episode (re-arms only after progress resumes).
 *
 * The component escalates: first stall → one in-place recovery
 * (load() + play(), which restarts the fetch pipeline); a second stall in
 * the same slide lifetime → the existing `onError` path, which marks the
 * item failed and advances the rotation — because the operator rule is
 * that the SCREEN must never freeze, even if one file is broken. Under
 * frame-locked sync, `onError` already holds the slot instead of advancing
 * (the conductor owns advancement), so the sync invariant is preserved.
 *
 * Detection state also feeds the render-proof signature (`|stalled`
 * suffix via the module flag below) so a chronically stalling screen is
 * VISIBLE from the dashboard instead of green.
 */

export interface MediaSample {
  currentTimeMs: number;
  paused: boolean;
  ended: boolean;
  seeking: boolean;
}

export type MediaStallVerdict = 'ok' | 'idle' | 'stalled';

export interface MediaStallDetector {
  /** Feed one observation; returns 'stalled' exactly once per episode. */
  sample(nowMs: number, s: MediaSample): MediaStallVerdict;
  /** True while the current episode is unresolved (no progress since). */
  isStalled(): boolean;
  /** Forget everything (new src / slide activation). */
  reset(): void;
}

/** Default: 12 s without a frame of progress while nominally playing.
 *  Long enough that a slow seek/buffer blip never false-alarms; short
 *  enough that recovery + skip both land well inside a minute. */
export const MEDIA_STALL_AFTER_MS = 12_000;

export function createMediaStallDetector(
  stallAfterMs: number = MEDIA_STALL_AFTER_MS,
): MediaStallDetector {
  let lastTimeMs: number | null = null;
  let lastProgressAtMs = 0;
  let stalled = false;

  const reset = () => {
    lastTimeMs = null;
    lastProgressAtMs = 0;
    stalled = false;
  };

  return {
    reset,
    isStalled: () => stalled,
    sample(nowMs: number, s: MediaSample): MediaStallVerdict {
      if (s.paused || s.ended || s.seeking) {
        // Intentional non-progress — never an alarm, and it ends any
        // running episode (a pause IS a resolution of the stall).
        reset();
        return 'idle';
      }
      if (lastTimeMs === null || s.currentTimeMs !== lastTimeMs) {
        lastTimeMs = s.currentTimeMs;
        lastProgressAtMs = nowMs;
        stalled = false;
        return 'ok';
      }
      if (!stalled && nowMs - lastProgressAtMs > stallAfterMs) {
        stalled = true;
        return 'stalled'; // reported once; progress re-arms
      }
      return stalled ? 'idle' : 'ok';
    },
  };
}

// ── Page-level stall flag (feeds the render-proof signature) ─────────────
// One boolean for the whole page: "is the ACTIVE media element currently in
// an unresolved stall episode?" Written by the slide's watchdog effect,
// read by the render-state derivation, appended to the proof signature as
// `|stalled` so lastRenderedHash stops looking healthy on a frozen video.
let activeMediaStalled = false;
export function setActiveMediaStalled(v: boolean): void {
  activeMediaStalled = v;
}
export function isActiveMediaStalled(): boolean {
  return activeMediaStalled;
}
