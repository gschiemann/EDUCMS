"use client";
import { decodedFrameCount } from './playbackSafety';

/** Muted, unsynced solo MP4. Preparation reads only verified local bytes.
 * The same element plays normally during preparation, then adopts ONE MSE
 * stream. Failures fall back once, with a separate per-file circuit breaker.
 */
import { useEffect, useRef } from 'react';
import { ContinuousBoundaryDetector, NativeWrapDetector, loopBoundaryTracker, type FrameMeta, type RvfcVideoElement } from './loopBoundary';
import { bootCheck, blockFor, isBlocked, markAlive, markStarted, markStopped, type KV } from './loopGuard';
import { readVideoQuality, videoQualityTracker } from './videoQuality';
import { createMediaStallDetector, setActiveMediaStalled } from './mediaStallWatchdog';
import { continuousGuardKey } from './continuousLoopRevision';
import { retainVideoFrame, releaseVideoFrame, reportContinuousFailure, reportContinuousPlaybackSample } from './continuousRecovery';

import { ContinuousPlaybackDiagnostics } from './continuousDiagnostics';
import type { startContinuousLoop } from './continuousLoop';

const NATIVE_STARTUP_MS = 45_000;

interface Props {
  src: string; sourceHash: string; videoKey: string; isActive: boolean; classes: string;
  onPlaying?: () => void; onError: () => void;
}

function scopedStorage(hash: string): KV | null {
  try {
    const store = window.localStorage;
    const key = (k: string) => continuousGuardKey(hash, k);
    return { getItem: k => store.getItem(key(k)), setItem: (k, v) => store.setItem(key(k), v), removeItem: k => store.removeItem(key(k)) };
  } catch { return null; }
}

export function ContinuousLoopVideo({ src, sourceHash, videoKey, isActive, classes, onPlaying, onError }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ onPlaying, onError });
  callbacks.current = { onPlaying, onError };

  useEffect(() => {
    const video = ref.current as RvfcVideoElement | null;
    const canvas = frameRef.current;
    if (!video || !isActive) return;
    const life = new AbortController();
    let disposed = false;
    let fellBack = false;
    let engine: ReturnType<typeof startContinuousLoop> | undefined;
    const diagnostics = new ContinuousPlaybackDiagnostics();
    diagnostics.reset(Date.now(), readVideoQuality(video));
    let diagnosticSeeking = false;
    let continuous: ContinuousBoundaryDetector | null = null;
    let frameId: number | undefined;
    let alive: ReturnType<typeof setInterval> | undefined;
    let preparationPhase = 'native-start';
    let firstFrameSeen = false;
    let startupAt = Date.now();
    let startupResumeTried = false;
    let resolveFirstFrame: () => void = () => undefined;
    const firstFrame = new Promise<void>(resolve => { resolveFirstFrame = resolve; });
    const native = new NativeWrapDetector();
    const kv = scopedStorage(sourceHash);
    const detector = createMediaStallDetector();
    let heldFrame = false;
    let replacementLoaded = false;
    const holdFrame = () => {
      if (!heldFrame && canvas) heldFrame = retainVideoFrame(video, canvas);
      replacementLoaded = false;
    };
    const releaseFrame = () => {
      if (canvas) releaseVideoFrame(canvas);
      heldFrame = false; replacementLoaded = false;
    };
    const onLoadedData = () => { replacementLoaded = true; };
    video.addEventListener('loadeddata', onLoadedData);
    const onHide = () => { if (kv) markStopped(kv); };
    window.addEventListener('pagehide', onHide);

    const fallback = (reason: string) => {
      if (disposed || fellBack) return;
      fellBack = true;
      resolveFirstFrame();
      reportContinuousFailure(reason, video, engine?.snapshot() ?? { phase: preparationPhase });
      if (video.getAttribute('src') !== src) holdFrame();
      // The fallback is final for this mount: stop preparing too. A package that
      // finished AFTER this point used to start the stream anyway — on a mount
      // that had already recorded the fallback and could no longer undo a failure.
      life.abort();
      engine?.dispose(); engine = undefined;
      continuous = null;
      native.reset();
      if (kv) { if (reason !== 'blocked') blockFor(kv, Date.now()); markStopped(kv); }
      if (alive) clearInterval(alive);
      loopBoundaryTracker.noteFallback(`continuous:${reason}`);
      video.dataset.loopBackend = 'native';
      // A preparation error need not disturb the already-playing native file.
      if (video.getAttribute('src') !== src) {
        firstFrameSeen = false; startupAt = Date.now(); detector.reset();
        video.src = src; video.loop = true; video.muted = true;
        video.play().catch(() => { /* active error / watchdog owns it */ });
      } else releaseFrame();
    };

    const onPlayingNow = () => {
      if (disposed) return;
      if (engine && !fellBack) { diagnosticSeeking = false; diagnostics.playing(Date.now()); }
      callbacks.current.onPlaying?.();
    };
    const onEmptied = () => {
      if (disposed) return;
      // A new source/load resets the element's counters. Rebuffering does
      // not: rebasing on every `playing` discarded all short bad stretches
      // and could leave the dashboard's quality sample hours out of date.
      diagnostics.reset(Date.now(), readVideoQuality(video));
      diagnosticSeeking = false;
      videoQualityTracker.detach(video, Date.now());
      videoQualityTracker.attach(video, src, Date.now());
    };
    const onVideoError = () => {
      if (engine && !fellBack) fallback('media-error');
      else if (!disposed) callbacks.current.onError();
    };
    const onWaiting = () => {
      if (!engine || fellBack || video.paused || video.seeking || diagnosticSeeking) return;
      try {
        const now = video.currentTime; const ranges = video.buffered;
        let ahead = 0;
        for (let i = 0; i < ranges.length; i++) {
          if (ranges.start(i) <= now && ranges.end(i) > now) { ahead = ranges.end(i) - now; break; }
        }
        diagnostics.waiting(Date.now(), ahead);
      }
      catch { /* A detached element must never affect playback. */ }
    };
    const onWaitEnd = () => diagnostics.closeWait(Date.now());
    const onSeeking = () => { diagnosticSeeking = true; onWaitEnd(); };
    const onSeeked = () => { diagnosticSeeking = false; };
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('pause', onWaitEnd);
    video.addEventListener('ended', onWaitEnd);
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('playing', onPlayingNow);
    video.addEventListener('emptied', onEmptied);
    video.addEventListener('error', onVideoError);
    video.loop = true; video.muted = true;
    video.play().catch(() => { /* active error / watchdog owns it */ });
    videoQualityTracker.attach(video, src, Date.now());
    loopBoundaryTracker.startSession('native');

    const onFrame = (_now: number, meta: FrameMeta) => {
      if (disposed) return;
      if (engine && !fellBack) diagnostics.frame(meta.processingDuration);
      if (!firstFrameSeen) { firstFrameSeen = true; resolveFirstFrame(); }
      if (heldFrame && replacementLoaded && video.readyState >= 2) releaseFrame();
      const event = continuous ? continuous.onFrame(meta) : native.onFrame(meta, video.duration);
      if (event) loopBoundaryTracker.record(event);
      frameId = video.requestVideoFrameCallback?.(onFrame);
    };
    frameId = video.requestVideoFrameCallback?.(onFrame);

    // Lazy: ordinary playback never downloads the parser or prepares fragments.
    const prepare = async () => {
      if (kv) { bootCheck(kv, Date.now()); if (isBlocked(kv, Date.now())) { fallback('blocked'); return; } }
      try {
        // A large cached MP4 can take longer than the steady-state stall
        // deadline to open on Android. Do not compete for flash/parser work
        // before its first decoded frame, or cancel preparation as a stall.
        await firstFrame;
        if (disposed || fellBack) return;
        preparationPhase = 'imports';
        const [{ prepareLoopPackage }, { startContinuousLoop }] = await Promise.all([
          import('./continuousLoopPackage'), import('./continuousLoop'),
        ]);
        if (disposed || fellBack) return;
        preparationPhase = 'package';
        const p = await prepareLoopPackage(src, sourceHash, life.signal);
        if (disposed || fellBack) return;
        continuous = new ContinuousBoundaryDetector(p.durationTicks, p.timescale);
        diagnostics.reset(Date.now(), readVideoQuality(video));
        engine = startContinuousLoop(video, p, life.signal, holdFrame);
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

    let recoveries = 0;
    let recoveryFailed = false;
    const watchdog = setInterval(() => {
      if (recoveryFailed) return;
      const now = Date.now();
      if (engine && !fellBack) {
        try {
          const pump = engine.snapshot();
          if (pump.diagnostics) reportContinuousPlaybackSample(diagnostics.sample(now, readVideoQuality(video),
            { ...pump.diagnostics, quotaBackoffs: pump.quotaBackoffs }));
        } catch { /* Diagnostic reads cannot trigger fallback or recovery. */ }
      }
      const starting = !firstFrameSeen;
      // A native open may interrupt the first play() while it obtains data.
      // A ready, paused file has not tested MSE at all. Resume it once on the
      // existing watchdog rather than waiting 45 s and blocking the engine.
      if (starting && !engine && video.paused && video.readyState >= 2 && !startupResumeTried) {
        startupResumeTried = true;
        video.play().catch(() => undefined);
      }
      // Startup has its own finite deadline. The 12-second playback detector
      // starts after an actual frame; currentTime=0/readyState=0 is not evidence
      // that a decoder which has never started has become stuck.
      const result = starting ? (now - startupAt >= NATIVE_STARTUP_MS ? 'stalled' : 'idle') :
        detector.sample(now, { currentTimeMs: video.currentTime * 1000, decodedFrames: decodedFrameCount(video),
          paused: video.paused, seeking: video.seeking, ended: video.ended });
      setActiveMediaStalled(detector.isStalled());
      if (result !== 'stalled') return;
      const reason = starting ? 'native-start-timeout' : 'clock-stalled';
      if (starting && !engine && !fellBack && preparationPhase === 'native-start') {
        // No MSE pipeline has run yet. One bounded native restart may still
        // produce its first frame; retain the waiting preparation promise so
        // that success can adopt continuous playback without a 24-hour ban.
        reportContinuousFailure(reason, video, { phase: preparationPhase }, 'native startup failed');
        if (++recoveries === 1) {
          startupAt = now;
          video.load(); video.play().catch(() => undefined);
        } else { recoveryFailed = true; callbacks.current.onError(); }
        return;
      }
      // The detector reports an episode ONCE. With the stream running, the
      // fallback itself restarts the element on the original file. While still
      // preparing, the element is already on the original file and the fallback
      // does not touch it — so that one report must also recover it, or nothing
      // ever does.
      if (engine && !fellBack) { fallback(reason); return; }
      if (!fellBack) fallback(reason);
      if (++recoveries === 1) {
        holdFrame(); firstFrameSeen = false; startupAt = now; detector.reset();
        video.load(); video.play().catch(() => undefined);
      } else { recoveryFailed = true; callbacks.current.onError(); }
    }, 4000);

    return () => {
      disposed = true; resolveFirstFrame(); life.abort(); engine?.dispose();
      clearInterval(watchdog); if (alive) clearInterval(alive);
      if (frameId !== undefined) video.cancelVideoFrameCallback?.(frameId);
      window.removeEventListener('pagehide', onHide);
      video.removeEventListener('playing', onPlayingNow); video.removeEventListener('error', onVideoError);
      video.removeEventListener('emptied', onEmptied);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('pause', onWaitEnd);
      video.removeEventListener('ended', onWaitEnd);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onLoadedData);
      releaseFrame();
      videoQualityTracker.detach(video, Date.now());
      if (kv) markStopped(kv);
      setActiveMediaStalled(false);
      video.pause();
    };
  }, [isActive, videoKey, src, sourceHash]);

  return <>
    <video ref={ref} src={src} className={classes} muted playsInline preload="auto"
      style={{ objectFit: 'fill' }} data-loop-backend="preparing-continuous" />
    <canvas ref={frameRef} aria-hidden="true" data-recovery-frame="true"
      style={{ display: 'none', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 11 }} />
  </>;
}
