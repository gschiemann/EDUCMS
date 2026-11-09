"use client";
/**
 * LiveVideoStream — the one <video> engine behind the STREAMING widget.
 *
 * 2026-11-07 (streaming-widget flagship audit). Replaces the old `HlsStream`,
 * which (a) preferred the browser's "native" HLS whenever canPlayType was
 * non-empty — on Android WebView that is the legacy MediaPlayer path, (b) had
 * no reconnect: one fatal hls.js error parked a red error chip over a black
 * frame for ever, (c) never noticed a live stream that silently froze, and
 * (d) could not tell anyone whether frames were actually reaching the glass.
 *
 * What it does now:
 *   - engine per browser (`pickHlsEngine`): Apple WebKit → native HLS;
 *     anything with MSE (Chromium, Android WebView 95+, Taurus Chromium 83)
 *     → hls.js; native error with MSE available → one hand-over to hls.js.
 *   - a frame counter: `requestVideoFrameCallback` where it exists (Chromium
 *     83+, Safari 15.4+), else `currentTime` progress, sampled once a second.
 *     The counter lives in a ref and in `data-stream-frames` — never React
 *     state — so a 30 fps stream costs no re-renders.
 *   - a watchdog: no new frame for STALL_AFTER_MS while "playing", or no first
 *     frame within the connect budget, tears the session down and reconnects
 *     with capped, jittered backoff (1 s → 30 s); `online` retries at once.
 *   - honest phases for the parent: connecting / playing / stalled /
 *     reconnecting / offline / unsupported.
 *   - low-end budget: `capLevelToPlayerSize` (a 480 px zone never decodes
 *     the 1080p rendition), a 10 s back buffer (hls.js default is unbounded),
 *     a 30 MB forward buffer, the transmuxer in a worker, and on teardown the
 *     src is released so the hardware decoder is freed for the next session.
 *   - VOD (a Mux / bipbop test asset, an MP4) loops — signage never ends.
 *
 * What it deliberately does NOT do: it never goes through the service
 * worker's playlist precache or the readiness gate (player rule 17). Those
 * index manifest PLAYLIST ITEMS; a stream URL lives in a template zone config
 * and is never pushed to PRECACHE_PLAYLIST. Segments are cross-origin, so
 * `sw-player.js` passes them to the network uncached.
 *
 * Taurus: no `inset`, no flex `gap`, no backdrop-filter in here.
 */
import { useEffect, useRef } from 'react';
import {
  isAppleWebKitUA,
  OFFLINE_AFTER_ATTEMPTS,
  pickHlsEngine,
  reconnectDelayMs,
  STALL_AFTER_MS,
} from './stream-source';

export type StreamPhase = 'connecting' | 'playing' | 'stalled' | 'reconnecting' | 'offline' | 'unsupported';

export interface StreamStatus {
  phase: StreamPhase;
  /** true = live edge stream, false = VOD/file, null = not known yet. */
  isLive: boolean | null;
  engine: 'native' | 'hlsjs' | 'progressive' | 'none';
  /** Consecutive failed sessions since the last good frame. */
  attempt: number;
  /** Epoch ms of the next reconnect, when one is scheduled. */
  nextRetryAt: number | null;
  width: number;
  height: number;
  /** Sound was requested but the browser only allowed muted autoplay. */
  mutedByPolicy: boolean;
  /** Short machine reason for the last failure. */
  lastError: string | null;
}

/** Live proof registry — `window.__eduStreams` — read by diagnostics/e2e. */
interface StreamProof {
  url: string; phase: StreamPhase; frames: number; lastFrameAt: number; engine: string; isLive: boolean | null;
}
function proofRegistry(): Record<string, StreamProof> | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __eduStreams?: Record<string, StreamProof> };
  if (!w.__eduStreams) w.__eduStreams = {};
  return w.__eduStreams;
}

let instanceSeq = 0;
const CONNECT_BUDGET_MS = 15_000;
const SOFT_STALL_MS = 2_500;

type HlsCtor = {
  isSupported(): boolean;
  Events: Record<string, string>;
  ErrorTypes: Record<string, string>;
  new (opts: object): HlsInstance;
};
type HlsInstance = {
  loadSource(url: string): void;
  attachMedia(video: HTMLVideoElement): void;
  on(evt: string, cb: (evt: string, data: any) => void): void;
  recoverMediaError(): void;
  destroy(): void;
};

export function LiveVideoStream({
  url,
  muted,
  volume,
  fit,
  onStatus,
}: {
  url: string;
  muted: boolean;
  /** 0..1, used only when not muted. */
  volume?: number;
  fit: 'cover' | 'contain';
  onStatus?: (s: StreamStatus) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const idRef = useRef<string>('');
  if (!idRef.current) idRef.current = `stream-${++instanceSeq}`;

  // Apply mute / volume without restarting the session.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    if (!muted && typeof volume === 'number') v.volume = Math.max(0, Math.min(1, volume));
  }, [muted, volume]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !url) return;
    const registry = proofRegistry();
    const id = idRef.current;

    let disposed = false;
    let hls: HlsInstance | null = null;
    let attempt = 0;
    let engineOverride: 'hlsjs' | null = null;
    let mediaRecoveries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let rvfcHandle: number | null = null;
    let frames = 0;
    let lastFrameAt = 0;
    let lastTime = -1;
    let sessionStart = 0;
    let sessionFailed = false;
    const hasRvfc = typeof (v as any).requestVideoFrameCallback === 'function';

    const status: StreamStatus = {
      phase: 'connecting', isLive: null, engine: 'none', attempt: 0, nextRetryAt: null,
      width: 0, height: 0, mutedByPolicy: false, lastError: null,
    };
    let lastSent = '';
    const emit = () => {
      if (disposed) return;
      v.setAttribute('data-stream-state', status.phase);
      if (registry) registry[id] = { url, phase: status.phase, frames, lastFrameAt, engine: status.engine, isLive: status.isLive };
      const key = `${status.phase}|${status.isLive}|${status.engine}|${status.attempt}|${status.nextRetryAt}|${status.width}x${status.height}|${status.mutedByPolicy}|${status.lastError}`;
      if (key === lastSent) return;
      lastSent = key;
      onStatusRef.current?.({ ...status });
    };
    const setPhase = (phase: StreamPhase) => { status.phase = phase; emit(); };

    const countFrame = () => {
      frames += 1;
      lastFrameAt = performance.now();
      if (!disposed && hasRvfc) rvfcHandle = (v as any).requestVideoFrameCallback(countFrame);
    };

    const play = () => {
      v.muted = mutedRef.current;
      const p = v.play();
      if (p && typeof p.catch === 'function') {
        p.catch((err: { name?: string }) => {
          if (disposed) return;
          // Autoplay with sound refused: play muted rather than show nothing.
          if (err?.name === 'NotAllowedError' && !v.muted) {
            v.muted = true;
            status.mutedByPolicy = true;
            emit();
            v.play().catch(() => { /* the watchdog will reconnect */ });
          }
        });
      }
    };

    const teardownSession = () => {
      if (rvfcHandle != null && typeof (v as any).cancelVideoFrameCallback === 'function') {
        try { (v as any).cancelVideoFrameCallback(rvfcHandle); } catch { /* ignore */ }
      }
      rvfcHandle = null;
      if (watchdog) { clearInterval(watchdog); watchdog = null; }
      try { hls?.destroy(); } catch { /* ignore */ }
      hls = null;
      // Release the decoder (low-end boxes have one or two).
      try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* ignore */ }
    };

    const fail = (reason: string) => {
      if (disposed || sessionFailed) return;
      sessionFailed = true;
      teardownSession();
      attempt += 1;
      const delay = reconnectDelayMs(attempt - 1);
      status.attempt = attempt;
      status.lastError = reason;
      status.nextRetryAt = Date.now() + delay;
      setPhase(attempt >= OFFLINE_AFTER_ATTEMPTS ? 'offline' : 'reconnecting');
      retryTimer = setTimeout(() => { retryTimer = null; startSession(); }, delay);
    };

    const onOnline = () => {
      if (disposed || !retryTimer) return;
      clearTimeout(retryTimer);
      retryTimer = null;
      startSession();
    };

    const onMeta = () => {
      status.width = v.videoWidth;
      status.height = v.videoHeight;
      if (status.engine !== 'hlsjs') status.isLive = !Number.isFinite(v.duration);
      emit();
    };
    const onEnded = () => {
      // VOD / file: signage loops.
      try { v.currentTime = 0; } catch { /* ignore */ }
      play();
    };
    const onNativeError = () => {
      if (disposed || status.engine === 'hlsjs') return;
      const mse = typeof window !== 'undefined' && !!(window as any).MediaSource;
      if (status.engine === 'native' && mse && !engineOverride) {
        // Native HLS refused it — hand it to hls.js once, right away.
        engineOverride = 'hlsjs';
        teardownSession();
        startSession();
        return;
      }
      fail(`media-error-${v.error?.code ?? 0}`);
    };

    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('resize', onMeta);
    v.addEventListener('ended', onEnded);
    v.addEventListener('error', onNativeError);
    window.addEventListener('online', onOnline);

    const startWatchdog = () => {
      watchdog = setInterval(() => {
        if (disposed) return;
        const now = performance.now();
        if (!hasRvfc) {
          // Fallback evidence: the media clock advancing while not paused.
          const t = v.currentTime;
          if (t !== lastTime && !v.paused) { frames += 1; lastFrameAt = now; }
          lastTime = t;
        }
        v.setAttribute('data-stream-frames', String(frames));
        if (registry && registry[id]) { registry[id].frames = frames; registry[id].lastFrameAt = lastFrameAt; }
        const sinceFrame = lastFrameAt ? now - lastFrameAt : Infinity;
        if (sinceFrame < SOFT_STALL_MS) {
          if (status.phase !== 'playing') {
            attempt = 0; status.attempt = 0; status.nextRetryAt = null; status.lastError = null;
            if (v.videoWidth) { status.width = v.videoWidth; status.height = v.videoHeight; }
            setPhase('playing');
          }
          return;
        }
        if (status.phase === 'playing' || status.phase === 'stalled') {
          if (sinceFrame >= STALL_AFTER_MS) fail('stall');
          else if (status.phase === 'playing') setPhase('stalled');
          return;
        }
        if (now - sessionStart > CONNECT_BUDGET_MS) fail('connect-timeout');
      }, 1000);
    };

    const startSession = () => {
      if (disposed) return;
      sessionFailed = false;
      mediaRecoveries = 0;
      sessionStart = performance.now();
      lastFrameAt = 0;
      lastTime = -1;
      if (status.phase !== 'offline') setPhase(attempt > 0 ? 'reconnecting' : 'connecting');
      if (hasRvfc) rvfcHandle = (v as any).requestVideoFrameCallback(countFrame);
      startWatchdog();

      const isHls = /\.m3u8/i.test(url) || !/\.(mp4|m4v|webm|mov)(\?|$)/i.test(url);
      if (!isHls) {
        status.engine = 'progressive';
        v.loop = true;
        v.src = url;
        emit();
        play();
        return;
      }
      v.loop = false;
      const nativeHls = v.canPlayType('application/vnd.apple.mpegurl') !== '';
      const mse = !!(window as any).MediaSource || !!(window as any).ManagedMediaSource;
      const choice = engineOverride || pickHlsEngine({ nativeHls, mse, appleWebKit: isAppleWebKitUA(navigator.userAgent) });
      if (choice === 'none') {
        status.engine = 'none';
        status.lastError = 'no-hls-engine';
        setPhase('unsupported');
        return;
      }
      if (choice === 'native') {
        status.engine = 'native';
        v.src = url;
        emit();
        play();
        return;
      }
      status.engine = 'hlsjs';
      emit();
      (async () => {
        try {
          const mod = (await import('hls.js')) as unknown as { default?: HlsCtor };
          if (disposed || sessionFailed) return;
          const Hls = (mod.default || (mod as unknown as HlsCtor)) as HlsCtor;
          if (!Hls.isSupported()) {
            status.lastError = 'no-hls-engine';
            setPhase('unsupported');
            return;
          }
          const inst = new Hls({
            enableWorker: true,
            // Signage wants stability, not two-second latency: LL-HLS doubles
            // the request rate and CPU on the boxes we ship to.
            lowLatencyMode: false,
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 8,
            capLevelToPlayerSize: true,
            backBufferLength: 10,
            maxBufferLength: 20,
            maxMaxBufferLength: 30,
            maxBufferSize: 30 * 1000 * 1000,
            startFragPrefetch: true,
          });
          hls = inst;
          inst.on(Hls.Events.LEVEL_LOADED, (_e, data) => {
            const live = !!data?.details?.live;
            if (status.isLive !== live) { status.isLive = live; emit(); }
          });
          inst.on(Hls.Events.ERROR, (_e, data) => {
            if (!data?.fatal || disposed) return;
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 1) {
              mediaRecoveries += 1;
              try { inst.recoverMediaError(); return; } catch { /* fall through */ }
            }
            fail(String(data.details || data.type || 'hls-fatal'));
          });
          inst.loadSource(url);
          inst.attachMedia(v);
          play();
        } catch {
          if (!disposed) fail('hls-load-failed');
        }
      })();
    };

    startSession();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      teardownSession();
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('resize', onMeta);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('error', onNativeError);
      window.removeEventListener('online', onOnline);
      if (registry) delete registry[id];
    };
  }, [url]);

  return (
    <video
      ref={videoRef}
      data-stream-video="true"
      data-stream-frames="0"
      autoPlay
      playsInline
      muted={muted}
      controls={false}
      disablePictureInPicture
      style={{ width: '100%', height: '100%', objectFit: fit, background: '#000', display: 'block' }}
    />
  );
}
