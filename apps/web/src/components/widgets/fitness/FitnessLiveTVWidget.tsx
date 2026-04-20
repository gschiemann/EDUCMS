'use client';

/**
 * FitnessLiveTVWidget — live streaming video in a gym zone.
 *
 * Supports three playback modes via config.streamType:
 *   • `hls`     — HLS manifest (.m3u8). Primary path for live news,
 *                 sports, public aggregators. Safari/iOS and most
 *                 Android WebViews play HLS natively; for Chromium
 *                 desktop we lazy-load hls.js only when the browser
 *                 doesn't claim native support.
 *   • `iframe`  — for providers we can't hit directly (embed codes
 *                 from YouTube, Twitch, Kaltura, etc.). Treated as
 *                 hostile content — the iframe is fully sandboxed.
 *   • `demo`    — offline-friendly placeholder for the gallery
 *                 preview + Playwright screenshots.
 *
 * Licensing — IMPORTANT:
 *   Streaming TV into a commercial space (a gym) requires a
 *   commercial public-performance license with the broadcaster. We
 *   are the display tool; the gym contracts directly with their
 *   content provider (DirecTV for Business, ESPN Commercial, CNN
 *   Pressroom Live, etc.). Widget config stores the URL the gym's
 *   authorized integrator gave them; we don't broker rights.
 *
 * Visual language matches FitnessMusicPlayerWidget: charcoal frame,
 * neon accent ring, LIVE chip, channel bug top-left. Video is the
 * primary surface — chrome is minimal so nothing steals attention
 * from what's on screen.
 */

import { useEffect, useRef, useState } from 'react';

export interface FitnessLiveTVConfig {
  streamType?: 'hls' | 'iframe' | 'demo';
  streamUrl?: string;
  /** Display-only channel name — e.g. "ESPN", "CNN", "LOCAL NEWS 12". */
  channelName?: string;
  /** Optional channel logo URL. Overrides `channelName` if both set. */
  channelLogoUrl?: string;
  /** Hex color for the LIVE chip + accent ring. Defaults to red. */
  accentColor?: string;
  /** Start muted — most commercial kiosks run silent (gym has its own
   *  music) so captions are expected. true by default. */
  muted?: boolean;
  /** Show closed captions track (HLS-only; iframe providers expose
   *  their own CC controls which we can't touch from outside). */
  captionsOn?: boolean;
}

export function FitnessLiveTVWidget({
  config,
  live,
}: {
  config?: FitnessLiveTVConfig;
  live?: boolean;
}) {
  const c: FitnessLiveTVConfig = config || {};
  const isLive = !!live;
  const accent = c.accentColor || '#ff2a4d';
  const streamType = c.streamType || (c.streamUrl?.endsWith('.m3u8') ? 'hls' : c.streamUrl ? 'iframe' : 'demo');

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const [hasError, setHasError] = useState(false);

  // HLS wiring — native first (Safari/iOS/some Android), fall back to
  // hls.js dynamic import for Chromium. Only runs on `live` so the
  // thumbnail render in /templates doesn't trigger a stream fetch for
  // every tile in the gallery.
  useEffect(() => {
    if (!isLive) return;
    if (streamType !== 'hls') return;
    const video = videoRef.current;
    const url = c.streamUrl;
    if (!video || !url) return;

    setHasError(false);

    // Native HLS (Safari + most iOS/Android WebViews).
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.play().catch(() => { /* autoplay blocked; muted fallback below */ });
      return () => { video.src = ''; };
    }

    // Chromium path: lazy-load hls.js so we don't ship ~200KB to
    // players that never touch this widget. Gracefully degrade if
    // the CDN import fails.
    let cancelled = false;
    (async () => {
      try {
        // Dynamic runtime URL import — TS static analysis can't resolve
        // a https:// specifier so we wrap in an indirect Function() call.
        // `webpackIgnore` tells Next's bundler to leave it as a runtime
        // dynamic import rather than try to pre-bundle the CDN asset.
        const mod: any = await new Function('u', 'return import(/* webpackIgnore: true */ u)')(
          'https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.mjs',
        );
        if (cancelled) return;
        const Hls = mod?.default || mod?.Hls;
        if (!Hls || !Hls.isSupported()) { setHasError(true); return; }
        const hls = new Hls({ maxBufferLength: 20, liveSyncDurationCount: 3 });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_evt: any, data: any) => {
          if (data?.fatal) setHasError(true);
        });
        video.play().catch(() => { /* autoplay policy — muted fallback covers this */ });
      } catch {
        if (!cancelled) setHasError(true);
      }
    })();

    return () => {
      cancelled = true;
      try { hlsRef.current?.destroy?.(); } catch {}
      hlsRef.current = null;
    };
  }, [isLive, streamType, c.streamUrl]);

  return (
    <div className="fltv-root" style={{ '--fltv-accent': accent } as React.CSSProperties}>
      <style>{CSS}</style>

      <div className="fltv-frame">
        {/* ─── Playback surface ─── */}
        {streamType === 'hls' && !hasError && (
          <video
            ref={videoRef}
            className="fltv-video"
            autoPlay
            muted={c.muted !== false}
            playsInline
            controls={false}
          />
        )}

        {streamType === 'iframe' && c.streamUrl && (
          <iframe
            className="fltv-iframe"
            src={c.streamUrl}
            allow="autoplay; encrypted-media; picture-in-picture"
            // Sandbox blocks top-level navigation attempts from rogue
            // embeds — the gym operator entered this URL, but the
            // streaming service is still third-party.
            sandbox="allow-scripts allow-same-origin allow-presentation"
            title={c.channelName || 'Live TV'}
            referrerPolicy="no-referrer"
          />
        )}

        {(streamType === 'demo' || hasError || !c.streamUrl) && (
          <div className="fltv-demo">
            <div className="fltv-demo-grid">
              {Array.from({ length: 64 }).map((_, i) => (
                <span key={i} className="fltv-demo-cell" style={{ animationDelay: `${i * 0.04}s` }} />
              ))}
            </div>
            <div className="fltv-demo-label">
              {hasError ? 'Stream offline' : 'Preview mode'}
            </div>
          </div>
        )}

        {/* ─── Overlay chrome ─── */}
        {/* Top-left: channel bug (logo or text) */}
        <div className="fltv-channel">
          {c.channelLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.channelLogoUrl} alt="" className="fltv-channel-logo" />
          ) : (
            <span className="fltv-channel-text">{c.channelName || 'LIVE TV'}</span>
          )}
        </div>

        {/* Top-right: LIVE indicator with pulsing dot */}
        <div className="fltv-live-chip">
          <span className="fltv-live-dot" />
          <span className="fltv-live-text">LIVE</span>
        </div>

        {/* Subtle scanline + vignette for that "broadcast monitor" feel.
            Barely perceptible — we're not trying to look retro, just
            making the pane read as "this is a TV feed" vs "this is a
            web embed". */}
        <div className="fltv-scanlines" aria-hidden />
        <div className="fltv-vignette" aria-hidden />

        {/* Neon accent ring around the entire video — the visual
            handshake with the music widget sitting next to it. */}
        <div className="fltv-glow-frame" aria-hidden />
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800&display=swap');

.fltv-root {
  position: absolute; inset: 0;
  background: #000;
  overflow: hidden;
  font-family: 'Outfit', sans-serif;
}
.fltv-frame {
  position: absolute; inset: 0;
}
.fltv-video, .fltv-iframe {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  border: 0;
  background: #000;
  object-fit: cover;
}

/* ─── Channel bug ─── */
.fltv-channel {
  position: absolute; top: 4%; left: 4%;
  z-index: 10;
  padding: 8px 14px;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(10px);
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.15);
}
.fltv-channel-logo { height: clamp(20px, 4cqh, 36px); width: auto; }
.fltv-channel-text {
  font-weight: 800;
  font-size: clamp(14px, 2.5cqh, 22px);
  letter-spacing: 0.15em;
  color: #ffffff;
  text-transform: uppercase;
}

/* ─── LIVE chip ─── */
.fltv-live-chip {
  position: absolute; top: 4%; right: 4%;
  z-index: 10;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 14px;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(10px);
  border-radius: 6px;
  border: 1px solid var(--fltv-accent, #ff2a4d);
  box-shadow: 0 0 20px rgba(255,42,77,0.3);
}
.fltv-live-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--fltv-accent, #ff2a4d);
  box-shadow: 0 0 10px var(--fltv-accent, #ff2a4d);
  animation: fltv-pulse 1.3s ease-in-out infinite;
}
@keyframes fltv-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.6; transform: scale(1.15); }
}
.fltv-live-text {
  font-weight: 800;
  font-size: clamp(12px, 2cqh, 15px);
  letter-spacing: 0.3em;
  color: var(--fltv-accent, #ff2a4d);
}

/* ─── Broadcast-monitor aesthetic ─── */
.fltv-scanlines {
  position: absolute; inset: 0;
  z-index: 5; pointer-events: none;
  background-image: repeating-linear-gradient(
    to bottom,
    transparent 0 2px,
    rgba(0,0,0,0.07) 2px 3px
  );
  mix-blend-mode: multiply;
  opacity: 0.5;
}
.fltv-vignette {
  position: absolute; inset: 0;
  z-index: 6; pointer-events: none;
  box-shadow: inset 0 0 120px rgba(0,0,0,0.6);
}
.fltv-glow-frame {
  position: absolute; inset: 0;
  z-index: 7; pointer-events: none;
  box-shadow:
    inset 0 0 0 2px var(--fltv-accent, #ff2a4d),
    0 0 30px var(--fltv-accent, #ff2a4d);
  opacity: 0.15;
  animation: fltv-breathe 4s ease-in-out infinite;
}
@keyframes fltv-breathe {
  0%, 100% { opacity: 0.1; }
  50%      { opacity: 0.25; }
}

/* ─── Demo placeholder (no stream configured or preview) ─── */
.fltv-demo {
  position: absolute; inset: 0;
  background: linear-gradient(135deg, #0a0a0f, #1a1a22);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.fltv-demo-grid {
  position: absolute; inset: 0;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(8, 1fr);
  gap: 4px;
  padding: 8px;
}
.fltv-demo-cell {
  background: linear-gradient(135deg, var(--fltv-accent, #ff2a4d), transparent);
  opacity: 0;
  animation: fltv-demo-flicker 6s ease-in-out infinite;
  border-radius: 2px;
}
@keyframes fltv-demo-flicker {
  0%, 100% { opacity: 0; }
  50%      { opacity: 0.3; }
}
.fltv-demo-label {
  position: relative;
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: clamp(16px, 3cqh, 28px);
  letter-spacing: 0.3em;
  color: var(--fltv-accent, #ff2a4d);
  text-shadow: 0 0 20px var(--fltv-accent, #ff2a4d);
  z-index: 2;
  text-transform: uppercase;
}
`;
