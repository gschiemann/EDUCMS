"use client";

/**
 * SeamlessLoopVideo — a solo, MUTED video that repeats by HAND-OFF instead of by
 * seek (video-loop audit F1; the engine and its safety rules are in
 * `loopDecks.ts` — read its header first).
 *
 * Two `<video>` elements are stacked, both fully opaque (never `opacity: 0` or
 * `display: none`: a browser may not present frames for a hidden element, and
 * the hand-off is only ever revealed after a frame has really been presented).
 * The top one plays; the one beneath is parked on frame 0 with that frame
 * decoded. A few frames before the end the engine resumes the standby, and the
 * `z-index` swap happens inside the requestVideoFrameCallback that saw its first
 * frame. The finished element is re-parked for the next lap.
 *
 * Used ONLY when `pickLoopBackend` says so (`loopEligibility.ts`); everything
 * else — sound, sync, emergency, `.mov`, no rVFC, a device that gave up —
 * keeps `PlayerVideoSlide` and the browser's own loop. The active element keeps
 * `loop = true` for its whole life, so every failure lands on exactly today's
 * behaviour.
 */
import { useEffect, useRef } from 'react';
import { LoopDeckEngine, type DeckLike } from './loopDecks';
import { loopBoundaryTracker } from './loopBoundary';
import {
  blockFor, isBlocked, isDeviceShapedFailure, markAlive, markStarted, markStopped, readLeadMs, writeLeadMs, type KV,
} from './loopGuard';
import { createMediaStallDetector, setActiveMediaStalled } from './mediaStallWatchdog';
import { videoQualityTracker } from './videoQuality';

const DECK_STYLE = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  // The player's auto-fit: stretch the video to fill the screen (same as the
  // single-element path).
  objectFit: 'fill' as const,
  background: '#000',
};

/** Wait this long after the first frame before preparing the standby, so the
 *  active element's own buffering is not competing with a second 4K load. */
const STANDBY_DELAY_MS = 1500;

function storage(): KV | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export interface SeamlessLoopVideoProps {
  src: string;
  isActive: boolean;
  classes: string;
  videoKey: string;
  /** The first real frame (clears the parent's "all items failed" tracker, sets readiness). */
  onPlaying?: () => void;
  /** The active element failed, or stalled twice — the parent's existing failure path. */
  onError: () => void;
  /** The two-deck path gave up on this device; the native loop carries on. */
  onFallback?: (reason: string) => void;
}

export function SeamlessLoopVideo({
  src, isActive, classes, videoKey, onPlaying, onError, onFallback,
}: SeamlessLoopVideoProps) {
  const r0 = useRef<HTMLVideoElement>(null);
  const r1 = useRef<HTMLVideoElement>(null);
  const activeIdx = useRef<0 | 1>(0);
  // Latest callbacks without re-running the lifecycle effect.
  const cbs = useRef({ onPlaying, onError, onFallback });
  cbs.current = { onPlaying, onError, onFallback };

  useEffect(() => {
    const d0 = r0.current;
    const d1 = r1.current;
    if (!d0 || !d1) return;
    if (!isActive) {
      try { d0.pause(); d1.pause(); } catch { /* noop */ }
      return;
    }

    const kv = storage();
    const decks = [d0, d1] as const;
    let engine: LoopDeckEngine | null = null;
    let disposed = false;
    let standbyTimer: number | null = null;
    let aliveTimer: number | null = null;
    let started = false;

    d0.muted = true;
    d1.muted = true;
    d0.loop = true; // the native loop is the safety net from the first frame
    activeIdx.current = 0;
    d0.style.zIndex = '2';
    d1.style.zIndex = '1';

    // ── start playback of the top element (as the single-element path does) ──
    try {
      const p = d0.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* the watchdog / error path owns it */ });
    } catch { /* noop */ }
    videoQualityTracker.attach(d0, src, Date.now());

    const startEngine = () => {
      if (disposed || started) return;
      // The boot check may have blocked the path since this slide mounted.
      if (kv && isBlocked(kv, Date.now())) return;
      started = true;
      const e = new LoopDeckEngine(
        [d0 as unknown as DeckLike, d1 as unknown as DeckLike],
        src,
        {
          now: () => performance.now(),
          setTimeout: (fn, ms) => window.setTimeout(fn, ms),
          clearTimeout: (id) => window.clearTimeout(id),
          loadLeadMs: () => (kv ? readLeadMs(kv) : null),
          saveLeadMs: (ms) => { if (kv) writeLeadMs(kv, ms); },
        },
        {
          onReveal: (next, previous) => {
            // Inside the rVFC callback that saw the standby's first frame.
            decks[next].style.zIndex = '2';
            decks[previous].style.zIndex = '1';
            const before = decks[previous];
            const after = decks[next];
            activeIdx.current = next;
            videoQualityTracker.detach(before, Date.now());
            videoQualityTracker.attach(after, src, Date.now());
            cbs.current.onPlaying?.();
          },
          onBoundary: (ev) => loopBoundaryTracker.record(ev),
          onFallback: (reason, permanent) => {
            loopBoundaryTracker.noteFallback(reason);
            if (kv && permanent && isDeviceShapedFailure(reason)) blockFor(kv, Date.now());
            if (kv) markStopped(kv);
            cbs.current.onFallback?.(reason);
          },
        },
      );
      engine = e;
      loopBoundaryTracker.setBackend('twodeck');
      if (kv) markStarted(kv, Date.now());
      aliveTimer = window.setInterval(() => { if (kv) markAlive(kv, Date.now()); }, 60_000);
      e.start();
    };

    const onFirstPlaying = () => {
      cbs.current.onPlaying?.();
      if (standbyTimer === null) standbyTimer = window.setTimeout(startEngine, STANDBY_DELAY_MS);
    };
    d0.addEventListener('playing', onFirstPlaying, { once: true });

    // ── errors: the ACTIVE element's failure is the item's failure ──────────
    const onDeckError = (idx: 0 | 1) => () => {
      if (disposed || idx !== activeIdx.current) return; // the standby is the engine's business
      cbs.current.onError();
    };
    const e0 = onDeckError(0);
    const e1 = onDeckError(1);
    d0.addEventListener('error', e0);
    d1.addEventListener('error', e1);

    // ── the same stall watchdog the single-element path has ─────────────────
    const detector = createMediaStallDetector();
    let recoveries = 0;
    const watchdog = window.setInterval(() => {
      const v = decks[activeIdx.current];
      const verdict = detector.sample(Date.now(), {
        currentTimeMs: v.currentTime * 1000,
        paused: v.paused,
        ended: v.ended,
        seeking: v.seeking,
      });
      setActiveMediaStalled(detector.isStalled());
      if (verdict !== 'stalled') return;
      recoveries += 1;
      if (recoveries === 1) {
        try {
          const at = v.currentTime;
          v.load();
          v.muted = true;
          try { v.currentTime = at; } catch { /* not seekable yet */ }
          const p = v.play();
          if (p && typeof p.catch === 'function') p.catch(() => { /* re-evaluated next tick */ });
        } catch { /* the second episode owns the persistent case */ }
      } else {
        setActiveMediaStalled(false);
        cbs.current.onError();
      }
    }, 4_000);

    const onHide = () => { if (kv) markStopped(kv); };
    window.addEventListener('pagehide', onHide);

    return () => {
      disposed = true;
      if (standbyTimer !== null) window.clearTimeout(standbyTimer);
      if (aliveTimer !== null) window.clearInterval(aliveTimer);
      window.clearInterval(watchdog);
      setActiveMediaStalled(false);
      window.removeEventListener('pagehide', onHide);
      d0.removeEventListener('playing', onFirstPlaying);
      d0.removeEventListener('error', e0);
      d1.removeEventListener('error', e1);
      engine?.destroy();
      videoQualityTracker.detach(decks[activeIdx.current], Date.now());
      if (kv) markStopped(kv);
      loopBoundaryTracker.setBackend('native');
    };
    // The item's identity (videoKey) resets everything; src/callbacks are stable for a slide's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, videoKey]);

  return (
    // `classes` is the SLIDE's (absolute fill + its transition/opacity/z-index),
    // so it goes on the wrapper only — on the two elements it would apply an
    // opacity or a transform twice. The elements are plain, opaque, stacked.
    <div className={classes} style={{ background: '#000', overflow: 'hidden' }} data-loop-backend="twodeck">
      <video ref={r0} src={src} style={DECK_STYLE} muted playsInline preload="auto" data-loop-deck="0" />
      <video ref={r1} style={DECK_STYLE} muted playsInline preload="auto" data-loop-deck="1" />
    </div>
  );
}
