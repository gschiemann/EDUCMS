"use client";

/** Muted, unsynced solo MP4. Preparation reads only verified local bytes.
 * The same element plays normally during preparation, then adopts ONE MSE
 * stream. Failures fall back once, with a separate per-file circuit breaker.
 */
import { useEffect, useRef } from 'react';
import { ContinuousBoundaryDetector, NativeWrapDetector, loopBoundaryTracker, type FrameMeta, type RvfcVideoElement } from './loopBoundary';
import { bootCheck, blockFor, isBlocked, markAlive, markStarted, markStopped, type KV } from './loopGuard';
import { videoQualityTracker } from './videoQuality';
import { createMediaStallDetector, setActiveMediaStalled } from './mediaStallWatchdog';

interface Props {
  src: string; sourceHash: string; videoKey: string; isActive: boolean; classes: string;
  onPlaying?: () => void; onError: () => void;
}

function scopedStorage(hash: string): KV | null {
  try {
    const store = window.localStorage;
    const key = (k: string) => `continuous:${hash}:${k}`;
    return { getItem: k => store.getItem(key(k)), setItem: (k, v) => store.setItem(key(k), v), removeItem: k => store.removeItem(key(k)) };
  } catch { return null; }
}

export function ContinuousLoopVideo({ src, sourceHash, videoKey, isActive, classes, onPlaying, onError }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const callbacks = useRef({ onPlaying, onError });
  callbacks.current = { onPlaying, onError };

  useEffect(() => {
    const video = ref.current as RvfcVideoElement | null;
    if (!video || !isActive) return;
    const life = new AbortController();
    let disposed = false;
    let fellBack = false;
    let engine: { running: Promise<void>; dispose(): void } | undefined;
    let continuous: ContinuousBoundaryDetector | null = null;
    let frameId: number | undefined;
    let alive: ReturnType<typeof setInterval> | undefined;
    const native = new NativeWrapDetector();
    const kv = scopedStorage(sourceHash);
    const onHide = () => { if (kv) markStopped(kv); };
    window.addEventListener('pagehide', onHide);

    const fallback = (reason: string) => {
      if (disposed || fellBack) return;
      fellBack = true;
      console.warn('[Player] continuous loop fallback:', reason);
      engine?.dispose(); engine = undefined;
      continuous = null;
      native.reset();
      if (kv) { if (reason !== 'blocked') blockFor(kv, Date.now()); markStopped(kv); }
      if (alive) clearInterval(alive);
      loopBoundaryTracker.noteFallback(`continuous:${reason}`);
      video.dataset.loopBackend = 'native';
      // A preparation error need not disturb the already-playing native file.
      if (video.getAttribute('src') !== src) {
        video.src = src; video.loop = true; video.muted = true;
        video.play().catch(() => { /* active error / watchdog owns it */ });
      }
    };

    const onPlayingNow = () => {
      if (disposed) return;
      videoQualityTracker.detach(video, Date.now());
      videoQualityTracker.attach(video, src, Date.now());
      callbacks.current.onPlaying?.();
    };
    const onVideoError = () => {
      if (engine && !fellBack) fallback('media-error');
      else if (!disposed) callbacks.current.onError();
    };
    video.addEventListener('playing', onPlayingNow);
    video.addEventListener('error', onVideoError);
    video.loop = true; video.muted = true;
    video.play().catch(() => { /* active error / watchdog owns it */ });
    videoQualityTracker.attach(video, src, Date.now());
    loopBoundaryTracker.startSession('native');

    const onFrame = (_now: number, meta: FrameMeta) => {
      if (disposed) return;
      const event = continuous ? continuous.onFrame(meta) : native.onFrame(meta, video.duration);
      if (event) loopBoundaryTracker.record(event);
      frameId = video.requestVideoFrameCallback?.(onFrame);
    };
    frameId = video.requestVideoFrameCallback?.(onFrame);

    // Lazy: ordinary playback never downloads the parser or prepares fragments.
    const prepare = async () => {
      if (kv) { bootCheck(kv, Date.now()); if (isBlocked(kv, Date.now())) { fallback('blocked'); return; } }
      try {
        const [{ prepareLoopPackage }, { startContinuousLoop }] = await Promise.all([
          import('./continuousLoopPackage'), import('./continuousLoop'),
        ]);
        if (disposed) return;
        const p = await prepareLoopPackage(src, sourceHash, life.signal);
        if (disposed) return;
        continuous = new ContinuousBoundaryDetector(p.durationTicks, p.timescale);
        engine = startContinuousLoop(video, p, life.signal);
        video.dataset.loopBackend = 'continuous';
        loopBoundaryTracker.startSession('continuous');
        if (kv) markStarted(kv, Date.now());
        alive = setInterval(() => { if (kv) markAlive(kv, Date.now()); }, 60_000);
        await engine.running;
      } catch (e) {
        if (!disposed) fallback(e instanceof Error ? e.message : 'pipeline-error');
      }
    };
    void prepare();

    const detector = createMediaStallDetector();
    let recoveries = 0;
    const watchdog = setInterval(() => {
      const result = detector.sample(Date.now(), { currentTimeMs: video.currentTime * 1000,
        paused: video.paused, seeking: video.seeking, ended: video.ended });
      setActiveMediaStalled(detector.isStalled());
      if (result !== 'stalled') return;
      if (!fellBack) { fallback('clock-stalled'); return; }
      if (++recoveries === 1) { video.load(); video.play().catch(() => undefined); }
      else callbacks.current.onError();
    }, 4000);

    return () => {
      disposed = true; life.abort(); engine?.dispose();
      clearInterval(watchdog); if (alive) clearInterval(alive);
      if (frameId !== undefined) video.cancelVideoFrameCallback?.(frameId);
      window.removeEventListener('pagehide', onHide);
      video.removeEventListener('playing', onPlayingNow); video.removeEventListener('error', onVideoError);
      videoQualityTracker.detach(video, Date.now());
      if (kv) markStopped(kv);
      setActiveMediaStalled(false);
      video.pause();
    };
  }, [isActive, videoKey, src, sourceHash]);

  return <video ref={ref} src={src} className={classes} muted playsInline preload="auto"
    style={{ objectFit: 'fill' }} data-loop-backend="preparing-continuous" />;
}
