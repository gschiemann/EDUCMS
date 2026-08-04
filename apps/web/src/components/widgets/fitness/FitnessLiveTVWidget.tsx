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
 *   • `xumo`            — look up from Xumo catalog
 *   • `youtube-live`    — resolve current live video from config.youtubeChannelUrl
 *                         via /api/v1/fitness/youtube-live/resolve, render as iframe
 *
 * FAST catalog providers (pluto, xumo) look up the hlsUrl from
 * fastChannelCatalogs.ts using config.channelId, then fall through to the
 * existing HLS playback path. Only catalogs with real, public, no-auth HLS
 * URLs ship (Pluto, Xumo); Samsung TV Plus / Tubi / Roku / LG were removed
 * because they require a partner/tokenized CDN URL we don't have — paste
 * such a URL via provider='hls' or provider='iframe' instead. If channelId
 * is not found in the catalog, an error overlay is shown with the channel ID
 * and catalog name.
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
// INJ-006 twin (2026-08-03) — the same host allowlist StreamingWidget got on
// 2026-08-02. See `../streaming-hosts` for why an allowlist is what makes
// `allow-same-origin` on these frames defensible.
import { STREAMING_EMBED_HOSTS, safeEmbedSrc } from '../streaming-hosts';

// ─── Provider type ────────────────────────────────────────────────────────────

export type LiveTVProvider =
  | 'hls'
  | 'iframe'
  | 'demo'
  | 'pluto'
  | 'xumo'
  | 'youtube-live';

/** FAST catalog providers that resolve channelId → hlsUrl.
 *  Only Pluto + Xumo ship real public HLS catalogs (see fastChannelCatalogs.ts). */
const CATALOG_PROVIDERS: ReadonlySet<LiveTVProvider> = new Set([
  'pluto', 'xumo',
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
   * For FAST catalog providers (pluto, xumo): the channel ID from the catalog.
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

    // Chromium path: lazy-load the BUNDLED hls.js (a real dependency,
    // `hls.js` in apps/web/package.json) via a normal dynamic import, so it
    // still code-splits into its own chunk and costs nothing on players that
    // never touch this widget.
    //
    // 2026-08-03 — this used to build a dynamic import through an indirect
    // Function-constructor eval, aimed at a public jsDelivr URL pinned only by
    // version string: unpinned (no SRI, no integrity check) third-party code
    // fetched at runtime and executed on the SAME surface that renders
    // lockdown / evacuation alerts, behind an eval no CSP worth having would
    // allow. `StreamingWidget.HlsStream` already did the right thing with a
    // plain `await import('hls.js')`; this is that, and nothing else about the
    // playback path changed. (The old URL/eval are deliberately not spelled
    // out here — `fitness-livetv-embed-guard.test.ts` asserts neither appears
    // anywhere in this file.)
    let cancelled = false;
    (async () => {
      try {
        const mod: { default?: unknown; Hls?: unknown } = await import('hls.js');
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

  // INJ-006 twin (2026-08-03) — BOTH iframe sources are gated by the shared
  // streaming-host allowlist before they can become an iframe `src`.
  //
  // `c.streamUrl` is a RAW operator string (it also arrives via template JSON
  // and the manifest), and it was previously framed verbatim with
  // `allow-scripts allow-same-origin allow-presentation`. That sandbox is only
  // defensible while the src is guaranteed FOREIGN — `allow-same-origin`
  // restores the frame's OWN origin, so a same-origin src would hand the page
  // our DOM, our localStorage device token, and the ability to fake an
  // all-clear on a life-safety display. The allowlist is what supplies that
  // guarantee, and it is exactly what was missing here.
  //
  // `ytResult.embedUrl` comes from our own resolver endpoint, but it is still
  // network-sourced JSON reaching an `src` on the same surface — gating it
  // costs one function call and removes the endpoint from the trust boundary.
  const safeIframeUrl = safeEmbedSrc(c.streamUrl);
  const safeYtEmbedUrl = safeEmbedSrc(ytResult?.embedUrl);

  const showIframe =
    effectiveProvider === 'iframe' && !!safeIframeUrl;

  /** Operator supplied an iframe URL, but it is not an allowlisted https host. */
  const showBlockedHost =
    (effectiveProvider === 'iframe' && !!c.streamUrl && !safeIframeUrl) ||
    (effectiveProvider === 'youtube-live' && !!ytResult?.embedUrl && !safeYtEmbedUrl);

  const showYtIframe =
    effectiveProvider === 'youtube-live' && !!safeYtEmbedUrl && !ytLoading && !ytError;

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
    && !showCatalogError && !showPlaceholderError && !showBlockedHost && (
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

        {/* Iframe (raw operator URL — allowlisted host only, see safeIframeUrl) */}
        {showIframe && (
          <iframe
            className="fltv-iframe"
            src={safeIframeUrl}
            allow="autoplay; encrypted-media; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-presentation"
            title={resolvedChannelName || 'Live TV'}
            referrerPolicy="no-referrer"
          />
        )}

        {/* Host not on the streaming allowlist — refuse to frame it, and say
            why. Previously this URL was rendered verbatim. */}
        {showBlockedHost && (
          <div className="fltv-overlay-state">
            <div className="fltv-overlay-icon">⚠️</div>
            <div className="fltv-overlay-label">Unsupported streaming host</div>
            <div className="fltv-overlay-sub">
              Embeds are limited to {STREAMING_EMBED_HOSTS.join(', ')} over https.
              Use an HLS (.m3u8) URL for any other provider.
            </div>
          </div>
        )}

        {/* YouTube Live — resolved embed (allowlisted host only) */}
        {showYtIframe && (
          <iframe
            className="fltv-iframe"
            src={safeYtEmbedUrl}
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
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  background: #000;
  overflow: hidden;
  font-family: 'Outfit', sans-serif;
}
.fltv-frame {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
}
.fltv-video, .fltv-iframe {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
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
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
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
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  z-index: 6; pointer-events: none;
  box-shadow: inset 0 0 120px rgba(0,0,0,0.6);
}
.fltv-glow-frame {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
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
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  background: linear-gradient(135deg, #0a0a0f, #1a1a22);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.fltv-demo-grid {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
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
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
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
