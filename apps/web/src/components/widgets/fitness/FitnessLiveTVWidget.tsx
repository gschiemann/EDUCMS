'use client';

/**
 * FitnessLiveTVWidget — live streaming video in a gym zone.
 *
 * Supports playback modes via config.streamType (legacy) OR config.provider (new):
 *
 *   Legacy streamType values (still fully supported):
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
 *   New provider values (config.provider):
 *   • `hls`             — same as legacy 'hls'; uses config.streamUrl
 *   • `iframe`          — same as legacy 'iframe'; uses config.streamUrl
 *   • `demo`            — same as legacy 'demo'
 *   • `pluto`           — look up HLS URL from Pluto TV catalog via config.channelId
 *   • `samsung-tv-plus` — look up from Samsung TV Plus catalog
 *   • `xumo`            — look up from Xumo catalog
 *   • `tubi`            — look up from Tubi catalog
 *   • `roku-free`       — look up from Roku Free catalog
 *   • `lg`              — look up from LG Channels catalog
 *   • `youtube-live`    — resolve current live video from config.youtubeChannelUrl
 *                         via /api/v1/fitness/youtube-live/resolve, render as iframe
 *
 * FAST catalog providers (pluto, xumo, samsung-tv-plus, tubi, roku-free, lg)
 * look up the hlsUrl from fastChannelCatalogs.ts using config.channelId, then
 * fall through to the existing HLS playback path. If channelId is not found in
 * the catalog, an error overlay is shown with the channel ID and catalog name.
 * Channels marked `placeholder: true` show a config-required overlay instead
 * of attempting playback.
 *
 * Channel logo: if the resolved channel has a `logo` field, it is shown in the
 * top-left channel bug area; otherwise falls back to config.channelLogoUrl,
 * then config.channelName text.
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

import { useEffect, useRef, useState, useCallback } from 'react';
import { findFastChannel } from './fastChannelCatalogs';
import type { FastChannel } from './fastChannelCatalogs';

// ─── Provider type ────────────────────────────────────────────────────────────

export type LiveTVProvider =
  | 'hls'
  | 'iframe'
  | 'demo'
  | 'pluto'
  | 'samsung-tv-plus'
  | 'xumo'
  | 'tubi'
  | 'roku-free'
  | 'lg'
  | 'youtube-live';

/** FAST catalog providers that resolve channelId → hlsUrl */
const CATALOG_PROVIDERS: ReadonlySet<LiveTVProvider> = new Set([
  'pluto', 'samsung-tv-plus', 'xumo', 'tubi', 'roku-free', 'lg',
]);

// ─── Config interface ─────────────────────────────────────────────────────────

export interface FitnessLiveTVConfig {
  /**
   * New unified provider field. When set, takes precedence over streamType.
   * Defaults to 'hls' if streamUrl is .m3u8, 'iframe' if streamUrl is set,
   * 'demo' if neither is set (preserving legacy behaviour).
   */
  provider?: LiveTVProvider;

  /**
   * Legacy stream type. Still fully supported. If `provider` is set, this
   * is ignored (except that streamUrl is still read by both).
   */
  streamType?: 'hls' | 'iframe' | 'demo';

  /** Raw stream URL — used by provider 'hls' and 'iframe'. */
  streamUrl?: string;

  /**
   * For FAST catalog providers (pluto, samsung-tv-plus, xumo, tubi,
   * roku-free, lg): the channel ID from the catalog.
   */
  channelId?: string;

  /**
   * For provider 'youtube-live': YouTube channel URL or video URL.
   * Examples:
   *   https://www.youtube.com/@CNN
   *   https://youtube.com/channel/UCVTyTA7KZpC4yvNo4lCP0YQ
   *   https://www.youtube.com/watch?v=dQw4w9WgXcQ
   */
  youtubeChannelUrl?: string;

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

// ─── YouTube Live resolution state ───────────────────────────────────────────

interface YtResolveResult {
  embedUrl: string;
  title?: string;
  channelName?: string;
}

// ─── Main widget ─────────────────────────────────────────────────────────────

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

  // ── Resolve effective provider ───────────────────────────────────────────
  const effectiveProvider: LiveTVProvider = c.provider || (
    c.streamType === 'iframe' ? 'iframe'
    : c.streamType === 'demo' ? 'demo'
    : c.streamUrl?.endsWith('.m3u8') ? 'hls'
    : c.streamUrl ? 'iframe'
    : 'demo'
  );

  // ── Resolve catalog channel for FAST providers ────────────────────────────
  const catalogChannel: FastChannel | undefined = CATALOG_PROVIDERS.has(effectiveProvider) && c.channelId
    ? findFastChannel(effectiveProvider, c.channelId)
    : undefined;

  const catalogNotFound = CATALOG_PROVIDERS.has(effectiveProvider) && c.channelId && !catalogChannel;
  const isPlaceholder = catalogChannel?.placeholder === true;

  // For FAST providers the resolved HLS URL comes from the catalog; the
  // final stream type sent to the video element is always 'hls'.
  const resolvedHlsUrl: string | undefined =
    CATALOG_PROVIDERS.has(effectiveProvider)
      ? (catalogChannel && !isPlaceholder ? catalogChannel.hlsUrl : undefined)
      : (effectiveProvider === 'hls' ? c.streamUrl : undefined);

  // ── Channel logo resolution ───────────────────────────────────────────────
  // Priority: catalog logo → config.channelLogoUrl → config.channelName text
  const resolvedLogoUrl = catalogChannel?.logo || c.channelLogoUrl;
  const resolvedChannelName = catalogChannel?.name || c.channelName;

  // ── HLS playback state ────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<unknown>(null);
  const [hasError, setHasError] = useState(false);

  // ── YouTube Live state ────────────────────────────────────────────────────
  const [ytResult, setYtResult] = useState<YtResolveResult | null>(null);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState(false);

  // ─── YouTube Live resolver ──────────────────────────────────────────────
  const resolveYoutubeLive = useCallback(async () => {
    const rawUrl = c.youtubeChannelUrl;
    if (!rawUrl) { setYtError(true); return; }
    setYtLoading(true);
    setYtError(false);
    setYtResult(null);
    try {
      const res = await fetch(
        `/api/v1/fitness/youtube-live/resolve?url=${encodeURIComponent(rawUrl)}`,
        { credentials: 'include' },
      );
      if (!res.ok) { setYtError(true); return; }
      const data: YtResolveResult = await res.json();
      setYtResult(data);
    } catch {
      setYtError(true);
    } finally {
      setYtLoading(false);
    }
  }, [c.youtubeChannelUrl]);

  // Trigger YouTube resolution once when the widget goes live
  useEffect(() => {
    if (!isLive) return;
    if (effectiveProvider !== 'youtube-live') return;
    void resolveYoutubeLive();
  }, [isLive, effectiveProvider, resolveYoutubeLive]);

  // ─── HLS wiring (native first, hls.js fallback) ──────────────────────────
  // Only runs when provider resolves to 'hls' and we have a real URL.
  // Only runs on `live` so the thumbnail render in /templates doesn't
  // trigger a stream fetch for every tile in the gallery.
  useEffect(() => {
    if (!isLive) return;
    const isHlsMode =
      effectiveProvider === 'hls' ||
      (CATALOG_PROVIDERS.has(effectiveProvider) && !isPlaceholder && !catalogNotFound);
    if (!isHlsMode) return;
    const video = videoRef.current;
    const url = resolvedHlsUrl;
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
        const mod: { default?: unknown; Hls?: unknown } = await (new Function(
          'u',
          'return import(/* webpackIgnore: true */ u)',
        )('https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.mjs') as Promise<{ default?: unknown; Hls?: unknown }>);
        if (cancelled) return;
        const Hls = (mod?.default || (mod as Record<string, unknown>)?.Hls) as {
          isSupported(): boolean;
          Events: Record<string, string>;
          new (opts: object): {
            loadSource(url: string): void;
            attachMedia(video: HTMLVideoElement): void;
            on(evt: string, cb: (evt: string, data: { fatal?: boolean }) => void): void;
            destroy(): void;
          };
        } | undefined;
        if (!Hls || !Hls.isSupported()) { setHasError(true); return; }
        const hls = new Hls({ maxBufferLength: 20, liveSyncDurationCount: 3 });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_evt: string, data: { fatal?: boolean }) => {
          if (data?.fatal) setHasError(true);
        });
        video.play().catch(() => { /* autoplay policy — muted fallback covers this */ });
      } catch {
        if (!cancelled) setHasError(true);
      }
    })();

    return () => {
      cancelled = true;
      try { (hlsRef.current as { destroy?: () => void } | null)?.destroy?.(); } catch {}
      hlsRef.current = null;
    };
  }, [isLive, effectiveProvider, resolvedHlsUrl, isPlaceholder, catalogNotFound]);

  // ── Derived render flags ──────────────────────────────────────────────────
  const showHls =
    !hasError && !!resolvedHlsUrl && (
      effectiveProvider === 'hls' ||
      (CATALOG_PROVIDERS.has(effectiveProvider) && !isPlaceholder && !catalogNotFound)
    );

  const showIframe =
    effectiveProvider === 'iframe' && !!c.streamUrl;

  const showYtIframe =
    effectiveProvider === 'youtube-live' && !!ytResult?.embedUrl && !ytLoading && !ytError;

  const showYtLoading =
    effectiveProvider === 'youtube-live' && ytLoading;

  const showYtError =
    effectiveProvider === 'youtube-live' && ytError && !ytLoading;

  const showCatalogError =
    !!catalogNotFound;

  const showPlaceholderError =
    !!isPlaceholder;

  const showDemo =
    !showHls && !showIframe && !showYtIframe && !showYtLoading && !showYtError
    && !showCatalogError && !showPlaceholderError && (
      effectiveProvider === 'demo' || hasError || !c.streamUrl
    );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fltv-root" style={{ '--fltv-accent': accent } as React.CSSProperties}>
      <style>{CSS}</style>

      <div className="fltv-frame">
        {/* ─── Playback surface ─── */}

        {/* HLS (direct or catalog-resolved) */}
        {showHls && (
          <video
            ref={videoRef}
            className="fltv-video"
            autoPlay
            muted={c.muted !== false}
            playsInline
            controls={false}
          />
        )}

        {/* Iframe (raw URL or youtube-live resolved) */}
        {showIframe && (
          <iframe
            className="fltv-iframe"
            src={c.streamUrl}
            allow="autoplay; encrypted-media; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-presentation"
            title={resolvedChannelName || 'Live TV'}
            referrerPolicy="no-referrer"
          />
        )}

        {/* YouTube Live — resolved embed */}
        {showYtIframe && (
          <iframe
            className="fltv-iframe"
            src={ytResult!.embedUrl}
            allow="autoplay; encrypted-media; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-presentation"
            title={ytResult!.title || resolvedChannelName || 'YouTube Live'}
            referrerPolicy="no-referrer"
          />
        )}

        {/* YouTube Live — loading */}
        {showYtLoading && (
          <div className="fltv-overlay-state">
            <div className="fltv-spinner" />
            <div className="fltv-overlay-label">Resolving live stream…</div>
          </div>
        )}

        {/* YouTube Live — no live stream found */}
        {showYtError && (
          <div className="fltv-overlay-state">
            <div className="fltv-overlay-icon">📡</div>
            <div className="fltv-overlay-label">Live stream not found</div>
            <div className="fltv-overlay-sub">
              {c.youtubeChannelUrl
                ? 'No active live broadcast on this channel'
                : 'No YouTube channel URL configured'}
            </div>
            <button className="fltv-overlay-btn" onClick={() => void resolveYoutubeLive()}>
              Retry
            </button>
          </div>
        )}

        {/* Catalog channel not found */}
        {showCatalogError && (
          <div className="fltv-overlay-state">
            <div className="fltv-overlay-icon">⚠️</div>
            <div className="fltv-overlay-label">Channel not found</div>
            <div className="fltv-overlay-sub">
              ID <code className="fltv-code">{c.channelId}</code> not in{' '}
              <code className="fltv-code">{effectiveProvider}</code> catalog
            </div>
          </div>
        )}

        {/* Catalog channel is a placeholder (URL not yet configured) */}
        {showPlaceholderError && (
          <div className="fltv-overlay-state">
            <div className="fltv-overlay-icon">🔗</div>
            <div className="fltv-overlay-label">Stream URL required</div>
            <div className="fltv-overlay-sub">
              <strong>{catalogChannel?.name}</strong> requires a real HLS URL from the
              provider. Contact your {effectiveProvider} account manager or switch to{' '}
              <code className="fltv-code">provider=&apos;iframe&apos;</code> with the
              channel embed URL.
            </div>
          </div>
        )}

        {/* Demo / error / no stream */}
        {showDemo && (
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
          {resolvedLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={resolvedLogoUrl} alt="" className="fltv-channel-logo" />
          ) : (
            <span className="fltv-channel-text">
              {resolvedChannelName || 'LIVE TV'}
            </span>
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

/* ─── Overlay states (errors, loading, placeholder) ─── */
.fltv-overlay-state {
  position: absolute; inset: 0;
  z-index: 8;
  background: linear-gradient(135deg, #0a0a0f, #1a1a22);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
}
.fltv-overlay-icon {
  font-size: clamp(28px, 5cqh, 48px);
}
.fltv-overlay-label {
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: clamp(14px, 2.5cqh, 22px);
  letter-spacing: 0.15em;
  color: var(--fltv-accent, #ff2a4d);
  text-transform: uppercase;
}
.fltv-overlay-sub {
  font-family: 'Outfit', sans-serif;
  font-weight: 600;
  font-size: clamp(11px, 1.6cqh, 14px);
  color: rgba(255,255,255,0.6);
  max-width: 80%;
  line-height: 1.5;
}
.fltv-overlay-btn {
  margin-top: 8px;
  padding: 8px 20px;
  background: transparent;
  border: 1px solid var(--fltv-accent, #ff2a4d);
  border-radius: 6px;
  color: var(--fltv-accent, #ff2a4d);
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(11px, 1.8cqh, 14px);
  letter-spacing: 0.15em;
  cursor: pointer;
  text-transform: uppercase;
  transition: background 0.2s;
}
.fltv-overlay-btn:hover {
  background: rgba(255,42,77,0.15);
}
.fltv-code {
  font-family: monospace;
  font-size: 0.9em;
  background: rgba(255,255,255,0.1);
  padding: 1px 4px;
  border-radius: 3px;
}

/* ─── YouTube loading spinner ─── */
.fltv-spinner {
  width: 36px; height: 36px;
  border: 3px solid rgba(255,255,255,0.15);
  border-top-color: var(--fltv-accent, #ff2a4d);
  border-radius: 50%;
  animation: fltv-spin 0.8s linear infinite;
}
@keyframes fltv-spin {
  to { transform: rotate(360deg); }
}
`;
