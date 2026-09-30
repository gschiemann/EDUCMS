'use client';

import { useEffect, useRef } from 'react';
import { PlaylistVideoHandoff, type PlaylistVideoSource } from './playlistVideoHandoff';
import { decodedFrameCount } from './playbackSafety';
import { createMediaStallDetector, setActiveMediaStalled } from './mediaStallWatchdog';
import { videoQualityTracker } from './videoQuality';
import { blockFor, markAlive, markStarted, markStopped } from './loopGuard';

export interface PlaylistVideoDeckProps {
  active: PlaylistVideoSource;
  next: PlaylistVideoSource | null;
  onPlaying(): void;
  onEnded(id: string): void;
  onError(id: string): void;
}

/** Mounted only for normal, unlocked video playlists. Emergency rendering and
 * frame-locked playback continue through the existing PlayerVideoSlide. */
export function PlaylistVideoDeck(props: PlaylistVideoDeckProps) {
  const first = useRef<HTMLVideoElement>(null);
  const second = useRef<HTMLVideoElement>(null);
  const engine = useRef<PlaylistVideoHandoff | null>(null);
  const callbacks = useRef(props);
  useEffect(() => { callbacks.current = props; });

  useEffect(() => {
    const a = first.current;
    const b = second.current;
    if (!a || !b) return;
    const detector = createMediaStallDetector();
    let recoveries = 0;
    let dual = true;
    let tracked: HTMLVideoElement | null = null;
    let kv: Storage | null = null;
    try { kv = window.localStorage; } catch { /* restricted storage */ }
    const handoff = new PlaylistVideoHandoff([a, b], {
      now: () => performance.now(),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: id => window.clearTimeout(id),
    }, {
      present(video, source, previous) {
        if (previous) videoQualityTracker.detach(previous, Date.now());
        tracked = video;
        videoQualityTracker.attach(video, source.src, Date.now());
        detector.reset();
        recoveries = 0;
        callbacks.current.onPlaying();
      },
      ended: id => callbacks.current.onEnded(id),
      error: id => callbacks.current.onError(id),
      fallback(reason) {
        dual = false;
        // The picture keeps playing on one decoder for this session. Persist
        // the existing two-decoder circuit breaker across renderer restarts.
        if (kv) { blockFor(kv, Date.now()); markStopped(kv); }
        a.parentElement?.setAttribute('data-playlist-handoff-fallback', reason);
      },
    });
    engine.current = handoff;
    if (kv) markStarted(kv, Date.now());
    const alive = window.setInterval(() => { if (kv && dual) markAlive(kv, Date.now()); }, 60_000);
    const tick = window.setInterval(() => { if (!document.hidden) handoff.tick(); }, 80);
    const watchdog = window.setInterval(() => {
      const video = handoff.activeVideo;
      if (!video || document.hidden) return;
      const verdict = detector.sample(Date.now(), {
        currentTimeMs: video.currentTime * 1000,
        decodedFrames: decodedFrameCount(video),
        paused: video.paused, ended: video.ended, seeking: video.seeking,
      });
      setActiveMediaStalled(detector.isStalled());
      if (verdict !== 'stalled') return;
      if (++recoveries === 1) {
        const at = video.currentTime;
        video.load();
        try { video.currentTime = at; } catch { /* waits for metadata */ }
        void video.play().catch(() => { /* evaluated by the next sample */ });
      } else if (handoff.source) {
        setActiveMediaStalled(false);
        handoff.failCurrent();
      }
    }, 4_000);
    const pageHide = () => { if (kv) markStopped(kv); };
    const unmute = () => {
      const v = handoff.activeVideo;
      if (v && handoff.hasPicture && handoff.source?.muted === false && v.muted) {
        v.muted = false;
        void v.play().catch(() => { v.muted = true; });
      }
    };
    window.addEventListener('pagehide', pageHide);
    document.addEventListener('pointerdown', unmute);
    document.addEventListener('keydown', unmute);
    return () => {
      window.clearInterval(alive);
      window.clearInterval(tick);
      window.clearInterval(watchdog);
      window.removeEventListener('pagehide', pageHide);
      document.removeEventListener('pointerdown', unmute);
      document.removeEventListener('keydown', unmute);
      if (tracked) videoQualityTracker.detach(tracked, Date.now());
      handoff.destroy();
      engine.current = null;
      if (kv) markStopped(kv);
      setActiveMediaStalled(false);
    };
  }, []);

  useEffect(() => { engine.current?.update(props.active, props.next); }, [props.active, props.next]);

  return (
    <div data-playlist-handoff="decoded-frame" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
      {[first, second].map((ref, index) => (
        <video key={index} ref={ref} data-playlist-deck={index} preload="auto" playsInline muted
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'fill', background: '#000' }} />
      ))}
    </div>
  );
}
