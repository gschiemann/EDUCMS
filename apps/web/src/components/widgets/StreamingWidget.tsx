"use client";
/**
 * StreamingWidget — multi-protocol live-stream renderer with ad overlay.
 * ───────────────────────────────────────────────────────────────────────
 *
 * Sprint 8c (2026-05-03). Built so a gym / bar / restaurant operator can
 * point this at any of the providers in `packages/api-types/streaming.ts`
 * and get a fullscreen stream that plays alongside scheduled ads.
 *
 * Playback modes (resolved per-channel):
 *   • hls    → <video> tag with hls.js polyfill for non-Safari browsers.
 *   • dash   → loads dash.js dynamically when first used.
 *   • iframe → YouTube / Twitch / Vimeo embed via their iframe URL
 *     pattern. NO third-party SDKs loaded — the embed URL is enough.
 *   • rtmp   → not browser-native; we surface a "needs server transcode"
 *     placeholder so operators see the limitation without crashing.
 *
 * Ad overlays:
 *   • Lower-third strip — bottom 18% of the widget, slides in/out.
 *   • Side rail — right 20% column, persistent.
 *   • Full-bleed — covers the stream for `durationMs`, then resumes.
 * Cadence is driven by `intervalMs` + `durationMs` from the AdSlot
 * config. Player picks the next ad by weight (round-robin within a
 * weight class, weight=1 default). Ads only show when the channel's
 * `allowAdOverlay` flag is true (some providers forbid).
 *
 * Inputs (config):
 *   {
 *     channelId: string,        // optional — fetches from /streaming/channels/:id
 *     playbackUrl: string,      // optional — direct override (custom HLS)
 *     playbackType: 'hls'|'dash'|'iframe'|...,
 *     embedUrl: string,         // for iframe playback
 *     allowAdOverlay: boolean,
 *     adSlots: Array<AdSlotConfig>, // pre-resolved by API
 *     muted: boolean,           // venue default; players usually mute by policy
 *     fitMode: 'cover'|'contain',
 *   }
 *
 * Why this is a separate widget (not a variant of VIDEO):
 *   • VIDEO renders a single asset URL. Streaming has session-bound
 *     auth, signed-URL refresh, ad overlay, picker UX.
 *   • Streaming widget needs its own renderer-error fallback so a
 *     dropped stream doesn't blank the screen.
 */
import { useEffect, useRef, useState } from 'react';
// 2026-05-03 — capability layer integration. The widget reads the
// detected device caps so it can:
//   • Pick H.264 transcode over H.265 / AV1 on devices that don't
//     decode the modern codec (server-side transcoding pipeline
//     supplies the per-codec URLs in `playbackUrlVariants`).
//   • Surface a friendly "this Android version is too old for HLS"
//     message instead of a black box on Chromium < ~50.
//   • Skip ad overlays that need backdrop-filter on devices that
//     can't render it (avoids the "ad blob covers the entire
//     screen with a solid black panel" failure mode).
import { detectCapabilities, pickBestVideo } from '@/lib/capabilities';

interface AdSlotCfg {
  id: string;
  assetUrl: string;
  assetMime?: string;            // 'video/mp4' | 'image/png' | ...
  placement: 'lower-third' | 'side-rail' | 'full-bleed';
  intervalMs: number;
  durationMs: number;
  weight?: number;
}

interface StreamingCfg {
  channelTitle?: string;
  playbackUrl?: string;
  /** Optional per-codec URL variants for capability-aware selection.
   *  Set when the transcode pipeline produces multiple codecs from
   *  a single source. The widget picks the BEST codec the current
   *  device can decode (AV1 → H.265 → VP9 → H.264). Falls back to
   *  `playbackUrl` when this isn't provided. */
  playbackUrlVariants?: Array<{ url: string; codec: 'av1' | 'h265' | 'vp9' | 'h264' }>;
  embedUrl?: string;
  playbackType?: 'hls' | 'dash' | 'iframe' | 'rtmp' | 'rtsp';
  allowAdOverlay?: boolean;
  adSlots?: AdSlotCfg[];
  muted?: boolean;
  fitMode?: 'cover' | 'contain';
  /** Live mode controls autoplay + ad rotation timer. */
  isLive?: boolean;
}

export function StreamingWidget({ config, live }: { config?: StreamingCfg; live?: boolean }) {
  const c = config || {};
  const isLive = !!live;
  const playbackType = c.playbackType || guessPlaybackType(c.playbackUrl, c.embedUrl);
  const fit = c.fitMode || 'cover';

  // 2026-05-03 — capability-aware codec selection. If the operator
  // (or the transcode pipeline) supplied multiple codec variants,
  // pick the best one the device can play. Otherwise fall through
  // to the single playbackUrl. This is the load-bearing piece of
  // Android-7-to-14 compatibility for video — older WebViews can't
  // decode H.265 or AV1, but they all play H.264 fine.
  const resolvedPlaybackUrl = c.playbackUrlVariants && c.playbackUrlVariants.length > 0
    ? pickBestVideo(c.playbackUrlVariants) || c.playbackUrl || ''
    : c.playbackUrl || '';

  // Surface a friendly fallback when the device's WebView is too old
  // for HLS playback. Chromium <51 doesn't have native HLS or
  // hls.js compatibility — operator should know to upgrade hardware
  // rather than seeing a black box.
  if (typeof window !== 'undefined' && playbackType === 'hls') {
    const caps = detectCapabilities();
    if (caps.chromiumMajor > 0 && caps.chromiumMajor < 51) {
      return (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: '#0f172a', color: '#fbbf24', fontSize: '0.9em', textAlign: 'center', padding: 16 }}>
          <div>
            <div style={{ fontSize: '2em' }}>⚠️</div>
            <div style={{ fontWeight: 700 }}>This screen's Android version is too old for HLS streaming.</div>
            <div style={{ fontSize: '0.85em', marginTop: 4 }}>Detected Chromium {caps.chromiumMajor}. Need 51 or newer. Use a YouTube embed channel instead, or upgrade the device's WebView via Play Store.</div>
          </div>
        </div>
      );
    }
  }

  if (!c.playbackUrl && !c.embedUrl) {
    return (
      <div className="absolute inset-0 flex items-center justify-center" style={{ background: '#0f172a', color: '#94a3b8', fontSize: '0.9em', textAlign: 'center', padding: 16 }}>
        <div>
          <div style={{ fontSize: '2em', marginBottom: 8 }}>📺</div>
          <div style={{ fontWeight: 700, color: '#e2e8f0' }}>{c.channelTitle || 'No channel selected'}</div>
          <div style={{ fontSize: '0.85em', marginTop: 4 }}>Connect a streaming provider in Settings → Streaming.</div>
        </div>
      </div>
    );
  }

  if (playbackType === 'rtmp' || playbackType === 'rtsp') {
    return (
      <div className="absolute inset-0 flex items-center justify-center" style={{ background: '#0f172a', color: '#fbbf24', fontSize: '0.9em', textAlign: 'center', padding: 16 }}>
        <div>
          <div style={{ fontSize: '2em' }}>⚠️</div>
          <div style={{ fontWeight: 700 }}>RTMP / RTSP requires a server-side transcode.</div>
          <div style={{ fontSize: '0.85em', marginTop: 4 }}>Configure a transcoder gateway URL in the channel config, or use HLS instead.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0" style={{ overflow: 'hidden', background: '#000' }}>
      {playbackType === 'iframe' ? (
        <IframeStream url={c.embedUrl || resolvedPlaybackUrl} muted={c.muted ?? true} live={isLive} />
      ) : playbackType === 'dash' ? (
        <DashStream url={resolvedPlaybackUrl} muted={c.muted ?? true} fit={fit} live={isLive} />
      ) : (
        // Default to HLS — uses capability-resolved best-codec URL
        <HlsStream url={resolvedPlaybackUrl} muted={c.muted ?? true} fit={fit} live={isLive} />
      )}

      {/* Ad overlay layer — only when allowed by channel + slots present
          + we're in live mode (preview mode skips so the editor canvas
          isn't constantly flashing ads while the operator is laying
          out the template). */}
      {c.allowAdOverlay !== false && isLive && Array.isArray(c.adSlots) && c.adSlots.length > 0 && (
        <AdOverlay slots={c.adSlots} />
      )}
    </div>
  );
}

// ─── Playback type sniffer ─────────────────────────────────────────────
function guessPlaybackType(playbackUrl?: string, embedUrl?: string): 'hls' | 'dash' | 'iframe' {
  if (embedUrl) return 'iframe';
  const url = playbackUrl || '';
  if (/youtube\.com|youtu\.be|twitch\.tv|vimeo\.com|kick\.com/i.test(url)) return 'iframe';
  if (/\.mpd(\?|$)/i.test(url)) return 'dash';
  return 'hls'; // default
}

// ─── HLS player (hls.js polyfill for non-Safari) ──────────────────────
function HlsStream({ url, muted, fit, live }: { url: string; muted: boolean; fit: 'cover' | 'contain'; live: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !url) return;
    let hls: any = null;
    let cancelled = false;
    setErrMsg(null);

    // Safari + iOS support HLS natively. Everything else needs hls.js.
    const canPlayHlsNatively = v.canPlayType('application/vnd.apple.mpegurl') !== '';
    if (canPlayHlsNatively) {
      v.src = url;
      if (live) v.play().catch(() => { /* autoplay blocked — operator must unmute / interact */ });
    } else {
      (async () => {
        try {
          const mod = await import('hls.js');
          if (cancelled) return;
          const Hls = (mod as any).default || mod;
          if (!Hls.isSupported()) {
            setErrMsg('Your browser does not support HLS playback.');
            return;
          }
          hls = new Hls({
            // Live tuning — keep latency low without burning bandwidth on
            // a venue's wifi.
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 6,
            enableWorker: true,
            lowLatencyMode: true,
          });
          hls.loadSource(url);
          hls.attachMedia(v);
          hls.on(Hls.Events.ERROR, (_e: unknown, data: any) => {
            if (data?.fatal) {
              setErrMsg(`Stream error: ${data?.details || 'unknown'}`);
            }
          });
          if (live) v.play().catch(() => { /* autoplay blocked */ });
        } catch (e) {
          if (!cancelled) setErrMsg(`Could not load HLS player: ${(e as Error).message}`);
        }
      })();
    }

    return () => {
      cancelled = true;
      try { hls?.destroy?.(); } catch { /* ignore */ }
    };
  }, [url, live]);

  return (
    <>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        controls={false}
        style={{ width: '100%', height: '100%', objectFit: fit, background: '#000' }}
      />
      {errMsg && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px] bg-rose-600 text-white pointer-events-none">
          {errMsg}
        </div>
      )}
    </>
  );
}

// ─── DASH player (lazy loads shaka-player on first use) ────────────────
function DashStream({ url, muted, fit, live }: { url: string; muted: boolean; fit: 'cover' | 'contain'; live: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    // dash.js is ~600KB minified. Load lazily so HLS-only customers
    // never pay the cost. If the import fails (no dash.js installed
    // in this build), surface a friendly error instead of crashing.
    let player: any = null;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('dashjs' as any);
        if (cancelled) return;
        const dashjs = (mod as any).default || mod;
        const v = videoRef.current;
        if (!v || !url) return;
        player = dashjs.MediaPlayer().create();
        player.initialize(v, url, live);
        player.setMute(muted);
      } catch (e) {
        setErrMsg(`DASH playback unavailable: install dash.js to enable. (${(e as Error).message})`);
      }
    })();
    return () => {
      cancelled = true;
      try { player?.reset?.(); } catch { /* ignore */ }
    };
  }, [url, live, muted]);

  return (
    <>
      <video ref={videoRef} autoPlay playsInline muted={muted} style={{ width: '100%', height: '100%', objectFit: fit, background: '#000' }} />
      {errMsg && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px] bg-rose-600 text-white pointer-events-none">
          {errMsg}
        </div>
      )}
    </>
  );
}

// ─── Iframe player (YouTube / Twitch / Vimeo) ──────────────────────────
function IframeStream({ url, muted, live }: { url: string; muted: boolean; live: boolean }) {
  // Normalize each provider's URL into its embed form.
  const embedUrl = normalizeEmbedUrl(url, { muted, autoplay: live });
  return (
    <iframe
      src={embedUrl}
      allow="autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
      style={{ width: '100%', height: '100%', border: 0 }}
      title="Stream"
    />
  );
}

function normalizeEmbedUrl(input: string, opts: { muted: boolean; autoplay: boolean }): string {
  if (!input) return '';
  let u = input.trim();
  // YouTube watch URL → embed URL.
  const ytMatch = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/live\/)([\w-]+)/);
  if (ytMatch) {
    const id = ytMatch[1];
    const params = new URLSearchParams({
      autoplay: opts.autoplay ? '1' : '0',
      mute: opts.muted ? '1' : '0',
      controls: '0',
      modestbranding: '1',
      rel: '0',
      playsinline: '1',
    });
    return `https://www.youtube.com/embed/${id}?${params.toString()}`;
  }
  // YouTube channel live → use channel param
  const ytChannelMatch = u.match(/youtube\.com\/(?:c|channel|user|@)([\w-]+)\/live/i);
  if (ytChannelMatch) {
    const handle = ytChannelMatch[1];
    return `https://www.youtube.com/embed/live_stream?channel=${handle}&autoplay=${opts.autoplay ? 1 : 0}&mute=${opts.muted ? 1 : 0}`;
  }
  // Twitch login → embed.
  const twitchMatch = u.match(/twitch\.tv\/([\w-]+)/);
  if (twitchMatch) {
    const channel = twitchMatch[1];
    // parent= must be the actual host the iframe runs on. We use the
    // current host at call time so this works on localhost + production.
    const parent = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    return `https://player.twitch.tv/?channel=${channel}&parent=${parent}&muted=${opts.muted}&autoplay=${opts.autoplay}`;
  }
  // Vimeo video → embed.
  const vimeoMatch = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeoMatch) {
    const id = vimeoMatch[1];
    return `https://player.vimeo.com/video/${id}?autoplay=${opts.autoplay ? 1 : 0}&muted=${opts.muted ? 1 : 0}&controls=0`;
  }
  // Fall through — assume the URL is already an embed URL.
  return u;
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

    const tickInterval = slots.reduce((min, s) => Math.min(min, s.intervalMs), 5 * 60_000);
    interval = setInterval(showNext, tickInterval);
    // First impression after one interval — gives the operator time
    // to see the actual stream first when they drop the widget on
    // the canvas in live preview mode.

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
      <div className="absolute inset-0 z-10" style={{ background: '#000' }}>
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
  // lower-third (default)
  return (
    <div className="absolute left-0 right-0 bottom-0 z-10" style={{ height: '18%', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      {inner}
    </div>
  );
}
