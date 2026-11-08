"use client";
/**
 * StreamingWidget — live streams, video links, embeds and cameras on a zone.
 * ───────────────────────────────────────────────────────────────────────
 *
 * Sprint 8c (2026-05-03) built it; the 2026-11-07 flagship audit
 * (`docs/handoffs/2026-11-07-streaming-widget-audit.md`) rebuilt the playback
 * and every state the glass can show.
 *
 * Source kinds (one classifier, `streaming/stream-source.ts`, shared with the
 * editor so the "will this work?" chip and the screen never disagree):
 *   • hls          → `LiveVideoStream`: hls.js on MSE browsers (Android
 *                     WebView, Taurus Chromium 83, Chrome, Firefox), native on
 *                     Apple WebKit; reconnect + backoff; frame counter.
 *   • progressive  → the same engine with a plain src (MP4/WebM), looped.
 *   • youtube / vimeo / twitch / kick → official embed in a sandboxed iframe
 *                     on the allowlist (INJ-006).
 *   • mjpeg        → an <img> on the camera's multipart feed.
 *   • snapshot     → an <img> refreshed on a timer, double-buffered.
 *   • rtsp / rtmp / srt → never playable in a browser: an honest "needs a
 *                     gateway" card, not a black box.
 *   • dash         → not bundled: an honest card.
 *
 * States on the glass (all calm, all localized, none a bare black box):
 * connecting (poster + spinner) → playing (optional LIVE badge) → stalled /
 * reconnecting (pill over the last frame) → offline (card over the poster
 * with the next retry). `data-stream-state` / `data-stream-kind` on the root
 * and `window.__eduStreams` carry the same facts for diagnostics.
 *
 * Emergency: a takeover alert returns a different tree from the player page,
 * so this widget UNMOUNTS (decoder and network released) and remounts from
 * the live edge on all-clear. A banner alert overlays it and leaves it
 * running.
 *
 * Ad overlays (unchanged behaviour): lower-third / side-rail / full-bleed on
 * the AdSlot cadence, only when `allowAdOverlay !== false` and live.
 *
 * Taurus: no `inset`, no flex `gap`, no backdrop-filter.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { parseYoutubeUrl, parseVimeoUrl, youtubeEmbedSrc, vimeoEmbedSrc } from './streaming-url-parse';
// Capability layer: best-codec pick for `playbackUrlVariants` and the
// too-old-WebView notice.
import { detectCapabilities, pickBestVideo } from '@/lib/capabilities';
import { STREAMING_EMBED_HOSTS, isAllowedStreamingHost } from './streaming-hosts';
import { detectStreamSource, reconnectDelayMs, type StreamKind } from './streaming/stream-source';
import { LiveVideoStream, type StreamStatus } from './streaming/LiveVideoStream';
import { sceneCss } from './scene-css';

interface AdSlotCfg {
  id: string;
  assetUrl: string;
  assetMime?: string;            // 'video/mp4' | 'image/png' | ...
  placement: 'lower-third' | 'side-rail' | 'full-bleed';
  intervalMs: number;
  durationMs: number;
  weight?: number;
}

export interface StreamingCfg {
  channelTitle?: string;
  playbackUrl?: string;
  /** Optional per-codec URL variants; the best one this device decodes wins. */
  playbackUrlVariants?: Array<{ url: string; codec: 'av1' | 'h265' | 'vp9' | 'h264' }>;
  embedUrl?: string;
  playbackType?: 'hls' | 'dash' | 'iframe' | 'rtmp' | 'rtsp';
  allowAdOverlay?: boolean;
  adSlots?: AdSlotCfg[];
  muted?: boolean;
  /** 0..100, applied only when unmuted. */
  volume?: number;
  fitMode?: 'cover' | 'contain';
  /** Shown while connecting and behind the offline card. */
  posterUrl?: string;
  /** LIVE badge on a live stream that is actually playing. Default on. */
  showLiveBadge?: boolean;
  /** Camera snapshot refresh, seconds. */
  refreshSeconds?: number;
  isLive?: boolean;
}

export function StreamingWidget({
  config,
  live,
  onStatus,
}: {
  config?: StreamingCfg;
  live?: boolean;
  /** Editor test player: receives every phase change. */
  onStatus?: (s: StreamStatus) => void;
}) {
  const t = useTranslations('streamingWidget');
  const c = config || {};
  const isLive = !!live;
  const fit = c.fitMode === 'contain' ? 'contain' : 'cover';
  const muted = c.muted ?? true;
  const volume = typeof c.volume === 'number' ? c.volume / 100 : undefined;
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scale = useContainerFontSize(rootRef);

  const resolvedPlaybackUrl = c.playbackUrlVariants && c.playbackUrlVariants.length > 0
    ? pickBestVideo(c.playbackUrlVariants) || c.playbackUrl || ''
    : c.playbackUrl || '';

  // Same rule as before 2026-11-07: an embedUrl means the embed path.
  const embed = c.playbackType === 'iframe' || !!c.embedUrl;
  const sourceUrl = embed ? (c.embedUrl || resolvedPlaybackUrl) : resolvedPlaybackUrl;
  const detected = useMemo(() => detectStreamSource(sourceUrl), [sourceUrl]);
  // An explicit channel type wins over the sniffer (saved channels carry it).
  let kind: StreamKind = detected.kind;
  if (c.playbackType === 'hls' && (kind === 'unknown' || kind === 'progressive')) kind = 'hls';
  if (c.playbackType === 'dash') kind = 'dash';
  if (c.playbackType === 'rtmp') kind = 'rtmp';
  if (c.playbackType === 'rtsp') kind = 'rtsp';
  const isEmbedKind = embed || kind === 'youtube' || kind === 'vimeo' || kind === 'twitch' || kind === 'kick';

  const handleStatus = (s: StreamStatus) => {
    setStatus(s);
    onStatus?.(s);
  };

  const shell = (children: React.ReactNode, state: string) => (
    <div
      ref={rootRef}
      className="absolute top-0 right-0 bottom-0 left-0"
      data-stream-kind={isEmbedKind ? 'embed' : kind}
      data-stream-state={state}
      style={{ overflow: 'hidden', background: '#000', fontSize: scale, lineHeight: 1.25 }}
    >
      {/* sceneCss: boosted above the flattened Tailwind preflight, which
          otherwise zeroes every padding/margin here (scene-css.ts). */}
      <style>{sceneCss(STREAM_CSS)}</style>
      {children}
    </div>
  );

  if (!sourceUrl) {
    return shell(
      <StreamStateCard icon="tv" title={c.channelTitle || t('noSource')} hint={t('noSourceHint')} poster={c.posterUrl} />,
      'empty',
    );
  }

  if (isEmbedKind) {
    return shell(
      <>
        <IframeStream url={sourceUrl} muted={muted} live={isLive} />
        {c.allowAdOverlay !== false && isLive && Array.isArray(c.adSlots) && c.adSlots.length > 0 && <AdOverlay slots={c.adSlots} />}
      </>,
      'embed',
    );
  }

  if (kind === 'rtsp' || kind === 'rtmp' || kind === 'srt') {
    const protocol = kind === 'srt' ? 'SRT / UDP' : kind.toUpperCase();
    return shell(
      <StreamStateCard icon="camera" title={t('gatewayTitle', { protocol })} hint={t('gatewayHint', { protocol })} poster={c.posterUrl} />,
      'needs-gateway',
    );
  }
  if (kind === 'dash') {
    return shell(<StreamStateCard icon="alert" title={t('dashTitle')} hint={t('dashHint')} poster={c.posterUrl} />, 'unsupported');
  }
  if (detected.verdict === 'blocked') {
    const r = detected.reason;
    const [title, hint] = r === 'insecure'
      ? [t('insecureTitle'), t('insecureHint')]
      : r === 'private-host'
        ? [t('privateTitle'), t('privateHint')]
        : [t('notUrlTitle'), t('notUrlHint')];
    return shell(<StreamStateCard icon="lock" title={title} hint={hint} poster={c.posterUrl} />, 'blocked');
  }

  if (kind === 'mjpeg' || kind === 'snapshot') {
    return shell(
      <CameraImageStream
        url={sourceUrl}
        snapshot={kind === 'snapshot'}
        refreshSeconds={c.refreshSeconds}
        fit={fit}
        poster={c.posterUrl}
        onStatus={handleStatus}
      />,
      status?.phase || 'connecting',
    );
  }

  // HLS / progressive / unknown-extension (tried as HLS).
  if (typeof window !== 'undefined') {
    const caps = detectCapabilities();
    if (caps.chromiumMajor > 0 && caps.chromiumMajor < 51) {
      return shell(
        <StreamStateCard icon="alert" title={t('unsupportedTitle')} hint={t('oldWebview', { version: `Chromium ${caps.chromiumMajor}` })} poster={c.posterUrl} />,
        'unsupported',
      );
    }
  }

  const phase = status?.phase || 'connecting';
  const showLiveBadge = c.showLiveBadge !== false && phase === 'playing' && status?.isLive === true;
  return shell(
    <>
      <LiveVideoStream url={sourceUrl} muted={muted} volume={volume} fit={fit} onStatus={handleStatus} />
      {phase === 'connecting' && (
        <StreamStateCard icon="spinner" title={t('connecting')} poster={c.posterUrl} subtle />
      )}
      {phase === 'offline' && (
        <StreamStateCard
          icon="offline"
          title={t('offlineTitle')}
          hint={t('offlineHint')}
          poster={c.posterUrl}
          retryAt={status?.nextRetryAt ?? null}
        />
      )}
      {phase === 'unsupported' && (
        <StreamStateCard icon="alert" title={t('unsupportedTitle')} hint={t('unsupportedHint')} poster={c.posterUrl} />
      )}
      {(phase === 'stalled' || phase === 'reconnecting') && (
        <div className="vos-stream-dim" aria-hidden="true" />
      )}
      {showLiveBadge && <StatusPill tone="live" label={t('live')} />}
      {(phase === 'stalled' || phase === 'reconnecting') && <StatusPill tone="warn" label={t('reconnecting')} />}
      {c.allowAdOverlay !== false && isLive && Array.isArray(c.adSlots) && c.adSlots.length > 0 && (
        <AdOverlay slots={c.adSlots} />
      )}
    </>,
    phase,
  );
}

// ─── Container-relative type scale (no container-query units: Taurus) ─────
function useContainerFontSize(ref: React.RefObject<HTMLDivElement | null>): number {
  const [size, setSize] = useState(16);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      // A 16:9-equivalent width: a tall narrow zone scales by its height.
      const basis = Math.min(w, h * 1.78);
      const next = Math.max(10, Math.min(36, Math.round(basis / 34)));
      setSize((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// ─── Shared styles (keyframes; long-hand positioning only) ────────────────
const STREAM_CSS = `
@keyframes vosStreamSpin { to { transform: rotate(360deg); } }
@keyframes vosStreamPulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@keyframes vosStreamFade { from { opacity: 0; } to { opacity: 1; } }
.vos-stream-card { position: absolute; top: 0; right: 0; bottom: 0; left: 0; display: flex; align-items: center; justify-content: center; text-align: center; color: #e2e8f0; background: #0b1120; background-image: radial-gradient(120% 90% at 50% 30%, #1e293b 0%, #0b1120 68%); animation: vosStreamFade .35s ease-out both; font-family: inherit; }
.vos-stream-card--subtle { background: rgba(2, 6, 23, 0.55); background-image: none; }
.vos-stream-poster { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; opacity: .38; }
.vos-stream-card--subtle .vos-stream-poster { opacity: 1; }
.vos-stream-scrim { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(180deg, rgba(2,6,23,.35) 0%, rgba(2,6,23,.78) 100%); }
.vos-stream-body { position: relative; max-width: 30em; padding: 1em 1.4em; display: flex; flex-direction: column; align-items: center; }
.vos-stream-icon { width: 2.6em; height: 2.6em; margin: 0 0 .85em; border-radius: 999px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.05); display: flex; align-items: center; justify-content: center; color: #cbd5e1; }
.vos-stream-icon svg { width: 1.25em; height: 1.25em; }
.vos-stream-spinner { width: 2.2em; height: 2.2em; margin: 0 0 .85em; border-radius: 999px; border: .16em solid rgba(255,255,255,.16); border-top-color: #f8fafc; animation: vosStreamSpin .9s linear infinite; }
.vos-stream-title { font-size: 1em; font-weight: 600; letter-spacing: -0.01em; color: #f8fafc; }
.vos-stream-hint { margin-top: .4em; font-size: .72em; line-height: 1.45; color: #94a3b8; }
.vos-stream-meta { margin-top: .9em; font-size: .6em; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #64748b; }
.vos-stream-dim { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(2, 6, 23, .35); pointer-events: none; }
.vos-stream-pill { position: absolute; top: 4%; left: 3%; display: flex; align-items: center; padding: .3em .75em .3em .6em; border-radius: 999px; background: rgba(15, 23, 42, .78); border: 1px solid rgba(255,255,255,.14); color: #f8fafc; font-size: .58em; font-weight: 700; letter-spacing: .14em; line-height: 1; pointer-events: none; z-index: 5; box-shadow: 0 .4em 1.2em rgba(0,0,0,.25); }
.vos-stream-pill-dot { width: .62em; height: .62em; border-radius: 999px; margin-right: .5em; background: #ef4444; box-shadow: 0 0 0 .22em rgba(239,68,68,.22); animation: vosStreamPulse 2s ease-in-out infinite; }
.vos-stream-pill--warn .vos-stream-pill-dot { background: #f59e0b; box-shadow: 0 0 0 .22em rgba(245,158,11,.22); }
`;

type CardIcon = 'tv' | 'camera' | 'alert' | 'lock' | 'offline' | 'spinner';

function CardGlyph({ icon }: { icon: Exclude<CardIcon, 'spinner'> }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
      {icon === 'tv' && (<><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8M12 17v4" /></>)}
      {icon === 'camera' && (<><rect x="3" y="7" width="13" height="10" rx="2" /><path d="M16 11l5-3v8l-5-3" /></>)}
      {icon === 'alert' && (<><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16h.01" /></>)}
      {icon === 'lock' && (<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>)}
      {icon === 'offline' && (<><path d="M2 8.8a15 15 0 0 1 20 0M5 12.6a10 10 0 0 1 14 0M8.5 16.2a5 5 0 0 1 7 0" /><path d="M12 20h.01" /><path d="M3 3l18 18" /></>)}
    </svg>
  );
}

function StreamStateCard({
  icon, title, hint, poster, retryAt, subtle,
}: {
  icon: CardIcon; title: string; hint?: string; poster?: string; retryAt?: number | null; subtle?: boolean;
}) {
  return (
    <div className={`vos-stream-card${subtle ? ' vos-stream-card--subtle' : ''}`} role="status" data-stream-card={icon}>
      {poster ? <img className="vos-stream-poster" src={poster} alt="" /> : null}
      {poster && !subtle ? <div className="vos-stream-scrim" /> : null}
      <div className="vos-stream-body">
        {icon === 'spinner' ? <div className="vos-stream-spinner" /> : <div className="vos-stream-icon"><CardGlyph icon={icon} /></div>}
        <div className="vos-stream-title">{title}</div>
        {hint ? <div className="vos-stream-hint">{hint}</div> : null}
        {retryAt ? <RetryCountdown at={retryAt} /> : null}
      </div>
    </div>
  );
}

function RetryCountdown({ at }: { at: number }) {
  const t = useTranslations('streamingWidget');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [at]);
  const seconds = Math.max(0, Math.ceil((at - now) / 1000));
  return <div className="vos-stream-meta">{seconds > 0 ? t('retryIn', { seconds }) : t('retryNow')}</div>;
}

function StatusPill({ tone, label }: { tone: 'live' | 'warn'; label: string }) {
  return (
    <div className={`vos-stream-pill${tone === 'warn' ? ' vos-stream-pill--warn' : ''}`} data-stream-pill={tone}>
      <span className="vos-stream-pill-dot" />
      <span>{label}</span>
    </div>
  );
}

// ─── Camera feeds: MJPEG (multipart <img>) and refreshed snapshots ────────
function CameraImageStream({
  url, snapshot, refreshSeconds, fit, poster, onStatus,
}: {
  url: string; snapshot: boolean; refreshSeconds?: number; fit: 'cover' | 'contain'; poster?: string;
  onStatus: (s: StreamStatus) => void;
}) {
  const t = useTranslations('streamingWidget');
  const [src, setSrc] = useState<string | null>(snapshot ? null : url);
  const [phase, setPhase] = useState<'connecting' | 'playing' | 'offline'>('connecting');
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const attemptRef = useRef(0);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  useEffect(() => {
    onStatusRef.current({
      phase, isLive: true, engine: 'none', attempt: attemptRef.current, nextRetryAt: retryAt,
      width: 0, height: 0, mutedByPolicy: false, lastError: phase === 'offline' ? 'image-error' : null,
    });
  }, [phase, retryAt]);

  // Snapshot: preload off-screen, swap only a decoded frame (no flicker).
  useEffect(() => {
    if (!snapshot) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const every = Math.max(2, Math.min(3600, refreshSeconds || 10)) * 1000;
    const load = () => {
      const next = `${url}${url.includes('?') ? '&' : '?'}_vos=${Date.now()}`;
      const img = new Image();
      img.onload = () => {
        if (disposed) return;
        attemptRef.current = 0;
        setRetryAt(null);
        setSrc(next);
        setPhase('playing');
        timer = setTimeout(load, every);
      };
      img.onerror = () => {
        if (disposed) return;
        attemptRef.current += 1;
        const delay = Math.max(every, reconnectDelayMs(attemptRef.current - 1));
        setRetryAt(Date.now() + delay);
        // Keep the last good frame; go offline only if we never had one.
        setPhase((p) => (p === 'playing' && attemptRef.current < 3 ? 'playing' : 'offline'));
        timer = setTimeout(load, delay);
      };
      img.src = next;
    };
    load();
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [url, snapshot, refreshSeconds]);

  // MJPEG: retry the multipart feed with backoff after an error.
  useEffect(() => {
    if (snapshot || phase !== 'offline' || !retryAt) return;
    const id = setTimeout(() => setSrc(`${url}${url.includes('?') ? '&' : '?'}_vos=${Date.now()}`), Math.max(0, retryAt - Date.now()));
    return () => clearTimeout(id);
  }, [snapshot, phase, retryAt, url]);

  return (
    <>
      {src ? (
        <img
          src={src}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: fit, display: 'block', background: '#000' }}
          onLoad={snapshot ? undefined : () => { attemptRef.current = 0; setRetryAt(null); setPhase('playing'); }}
          onError={snapshot ? undefined : () => {
            attemptRef.current += 1;
            setRetryAt(Date.now() + reconnectDelayMs(attemptRef.current - 1));
            setPhase('offline');
          }}
        />
      ) : null}
      {phase === 'connecting' && <StreamStateCard icon="spinner" title={t('connecting')} poster={poster} subtle />}
      {phase === 'offline' && (
        <StreamStateCard icon="offline" title={t('offlineTitle')} hint={t('offlineHint')} poster={poster} retryAt={retryAt} />
      )}
    </>
  );
}

// ─── Iframe player (YouTube / Twitch / Vimeo) ──────────────────────────
function IframeStream({ url, muted, live }: { url: string; muted: boolean; live: boolean }) {
  const t = useTranslations('streamingWidget');
  // Normalize each provider's URL into its embed form.
  const embedUrl = normalizeEmbedUrl(url, { muted, autoplay: live });

  // INJ-006 (2026-08-02) — normalizeEmbedUrl used to end with
  // "assume the URL is already an embed URL; return u", so ANY string an
  // operator (or a template-JSON edit) put in `embedUrl` was framed verbatim
  // on a life-safety display. Now an unrecognised host is refused and the
  // operator is told why, instead of the screen silently hosting a stranger's
  // page.
  if (!embedUrl) {
    return (
      <StreamStateCard
        icon="alert"
        title={t('unsupportedHostTitle')}
        hint={t('unsupportedHostHint', { hosts: STREAMING_EMBED_HOSTS.join(', ') })}
      />
    );
  }

  return (
    <iframe
      src={embedUrl}
      // SANDBOXED (2026-08-02, INJ-001a) — matching the FitnessLiveTVWidget
      // precedent at fitness/FitnessLiveTVWidget.tsx:342, which is
      // `allow-scripts allow-same-origin allow-presentation`.
      //
      // WHY `allow-same-origin` IS CORRECT *HERE* AND WRONG ON THE PROXY
      // FRAMES: `src` is guaranteed cross-origin (normalizeEmbedUrl only ever
      // returns an https URL on the STREAMING_EMBED_HOSTS allowlist), so
      // `allow-same-origin` restores the FRAME'S OWN foreign origin —
      // youtube.com, not ours. The same-origin policy still denies
      // parent.document and the player's localStorage device token. On the
      // WEBPAGE proxy frames the src is OUR origin, so the same token would
      // hand the page our DOM — which is exactly why it is absent there.
      //
      // MEASURED, not assumed: with `allow-same-origin` removed, a real
      // YouTube embed renders BLACK (the player's own storage/postMessage
      // handshake fails in an opaque origin). Vimeo survived either way.
      // Dropping the token would therefore delete YouTube streaming, the most
      // common provider here — a feature regression, not a hardening.
      //
      // What the sandbox still buys: no top-level navigation (a frame-bust to
      // a fake "all clear" page is the alert-suppression attack that
      // matters), no forms, no modals, no pointer lock, no downloads.
      // `allow-presentation` keeps cast / second-screen working. NOTE:
      // `allow-popups-to-escape-sandbox` is deliberately NOT listed — without
      // `allow-popups` it is inert, and popups have no place on signage.
      sandbox="allow-scripts allow-same-origin allow-presentation"
      allow="autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
      style={{ width: '100%', height: '100%', border: 0 }}
      title="Stream"
    />
  );
}

/**
 * The streaming hosts this widget knows how to embed live in
 * `./streaming-hosts` — 2026-08-03, so `fitness/FitnessLiveTVWidget.tsx`
 * (which frames operator URLs with the same `allow-same-origin` sandbox and
 * had NO allowlist) can share one source of truth instead of drifting again.
 * Re-exported here because the INJ-006 test suite and this file's own
 * `normalizeEmbedUrl` both import them from this module.
 */
export { STREAMING_EMBED_HOSTS, isAllowedStreamingHost } from './streaming-hosts';

export function normalizeEmbedUrl(input: string, opts: { muted: boolean; autoplay: boolean }): string {
  if (!input) return '';
  const u = input.trim();
  // YouTube + Vimeo: one shared parser (streaming-url-parse.ts) so the
  // App Library and the screen agree on every link shape — unlisted Vimeo
  // hashes, channels/showcases/events, YouTube Shorts/live/playlists.
  const yt = parseYoutubeUrl(u);
  if (yt) return youtubeEmbedSrc(yt, opts);
  const vimeo = parseVimeoUrl(u);
  if (vimeo) return vimeoEmbedSrc(vimeo, opts);
  // Twitch login → embed.
  const twitchMatch = u.match(/twitch\.tv\/([\w-]+)/);
  if (twitchMatch) {
    const channel = twitchMatch[1];
    // parent= must be the actual host the iframe runs on. We use the
    // current host at call time so this works on localhost + production.
    const parent = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    return `https://player.twitch.tv/?channel=${channel}&parent=${parent}&muted=${opts.muted}&autoplay=${opts.autoplay}`;
  }
  // ─── FALL-THROUGH: allowlist, don't assume (INJ-006) ────────────────
  // Previously: "assume the URL is already an embed URL; return u". That
  // framed anything at all — an attacker-supplied page, an intranet host, a
  // phishing clone — full-bleed on a school display, with the widget's own
  // `allow="autoplay; encrypted-media; picture-in-picture"` grant.
  //
  // Now: only a URL that (a) parses, (b) is https, and (c) lives on a host
  // this file actually recognises, survives. Everything else returns '' and
  // the caller renders the "unsupported streaming host" placeholder.
  //
  // There is deliberately NO loopback/dev exemption: it would be the one way
  // `src` could end up SAME-ORIGIN with the app, and this iframe carries
  // `allow-same-origin` (see the sandbox note above), which is only safe
  // while the src is guaranteed foreign.
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'https:') return '';
    if (!isAllowedStreamingHost(parsed.hostname)) return '';
    return u;
  } catch {
    // Not an absolute URL at all (relative path, javascript:, garbage).
    return '';
  }
}

// ─── Ad overlay engine ─────────────────────────────────────────────────
function AdOverlay({ slots }: { slots: AdSlotCfg[] }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!slots.length) return;
    let cleared = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let idx = 0;

    // Weighted round-robin pick.
    const expanded: number[] = [];
    slots.forEach((s, i) => {
      const w = Math.max(1, Math.min(10, s.weight ?? 1));
      for (let n = 0; n < w; n++) expanded.push(i);
    });

    const showNext = () => {
      if (cleared) return;
      idx = (idx + 1) % expanded.length;
      const slotIdx = expanded[idx];
      setActiveIdx(slotIdx);
      const slot = slots[slotIdx];
      timeout = setTimeout(() => {
        if (cleared) return;
        setActiveIdx(null);
      }, slot.durationMs);
    };

    // First impression after one interval — the stream shows first.
    const tickInterval = slots.reduce((min, s) => Math.min(min, s.intervalMs), 5 * 60_000);
    interval = setInterval(showNext, tickInterval);

    return () => {
      cleared = true;
      if (timeout) clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [slots]);

  if (activeIdx == null) return null;
  const slot = slots[activeIdx];
  if (!slot) return null;

  const placement = slot.placement || 'lower-third';
  const isVideo = slot.assetMime?.startsWith('video/');
  const inner = isVideo ? (
    <video src={slot.assetUrl} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  ) : (
    <img src={slot.assetUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  );

  if (placement === 'full-bleed') {
    return (
      <div className="absolute top-0 right-0 bottom-0 left-0 z-10" style={{ background: '#000' }}>
        {inner}
      </div>
    );
  }
  if (placement === 'side-rail') {
    return (
      <div className="absolute right-0 top-0 bottom-0 z-10" style={{ width: '20%', background: '#000', borderLeft: '2px solid rgba(255,255,255,0.1)' }}>
        {inner}
      </div>
    );
  }
  // lower-third (default). Solid scrim, no backdrop-filter: it is flaky on
  // Android WebView < 88 and costs a full-zone re-sample every frame over
  // live video on low-end boxes.
  return (
    <div className="absolute left-0 right-0 bottom-0 z-10" style={{ height: '18%', background: 'rgba(0,0,0,0.72)' }}>
      {inner}
    </div>
  );
}
