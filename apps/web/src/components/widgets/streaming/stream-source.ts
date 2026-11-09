/**
 * stream-source — what kind of stream is this URL, and will a screen play it?
 *
 * 2026-11-07 (streaming-widget flagship audit). ONE pure classifier shared by
 * the editor (the "will this work?" chip under the pasted link) and the screen
 * (which engine mounts). Before this, the widget guessed "HLS" for anything
 * that was not a known embed host or `.mpd`, so an RTSP camera, an MJPEG
 * webcam or a plain MP4 all mounted hls.js and failed as a black box, and the
 * editor said nothing at all.
 *
 * Pure: no React, no DOM, no network. Tested per shape in
 * `__tests__/stream-source.test.ts`.
 *
 * Honesty rules (apps/web/src/app/player/CLAUDE.md rule 10, "copy states what the evidence proves"):
 *   - `supported` means the screen has an engine for it, not that the stream
 *     is up. Only the player's own frame counter proves it is playing.
 *   - RTSP / RTMP / SRT / UDP never play in a browser. They need a gateway
 *     that republishes them as HLS. We say so instead of trying.
 *   - DASH is not bundled (no dash.js on the player). We say so.
 *   - A private-network or plain-http address is refused by the API's zone
 *     URL guard (`apps/api/src/templates/zone-url-guard.ts`) and blocked as
 *     mixed content on the https player, so the editor flags it up front.
 */
import { parseVimeoUrl, parseYoutubeUrl } from '../streaming-url-parse';

export type StreamKind =
  | 'hls'
  | 'dash'
  | 'progressive'
  | 'youtube'
  | 'vimeo'
  | 'twitch'
  | 'kick'
  | 'mjpeg'
  | 'snapshot'
  | 'rtsp'
  | 'rtmp'
  | 'srt'
  | 'unknown';

export type StreamVerdict =
  /** The screen has an engine for this kind. */
  | 'supported'
  /** No recognisable extension — we will try it as HLS and tell the truth. */
  | 'probable'
  /** A camera / encoder protocol that needs an HLS gateway first. */
  | 'needs-gateway'
  /** Recognised, but the player cannot play it (DASH). */
  | 'unsupported'
  /** Will be refused on save or blocked on the screen (http, private host). */
  | 'blocked'
  | 'empty';

export interface StreamSource {
  kind: StreamKind;
  verdict: StreamVerdict;
  /** Which render path the widget uses. */
  engine: 'video' | 'embed' | 'image' | 'none';
  /** A short machine reason the editor maps to localized copy. */
  reason?: 'insecure' | 'private-host' | 'not-a-url' | 'gateway' | 'dash' | 'unknown-host';
  /** The trimmed URL as typed. */
  url: string;
}

const PRIVATE_V4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/;

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (PRIVATE_V4.test(h)) return true;
  // IPv6 loopback / unique-local / link-local.
  if (h === '::1' || /^f[cd][0-9a-f]{2}:/i.test(h) || /^fe80:/i.test(h)) return true;
  return false;
}

const GATEWAY_SCHEMES: Record<string, StreamKind> = {
  'rtsp:': 'rtsp',
  'rtsps:': 'rtsp',
  'rtmp:': 'rtmp',
  'rtmps:': 'rtmp',
  'srt:': 'srt',
  'udp:': 'srt',
  'rtp:': 'srt',
};

/** Classify a pasted stream link. Never throws. */
export function detectStreamSource(input: string | null | undefined): StreamSource {
  const url = String(input ?? '').trim();
  if (!url) return { kind: 'unknown', verdict: 'empty', engine: 'none', url };

  // Camera / encoder protocols first — `new URL('rtsp://…')` parses fine, so
  // the scheme is the whole signal.
  const scheme = (/^([a-z][a-z0-9+.-]*:)/i.exec(url)?.[1] || '').toLowerCase();
  if (GATEWAY_SCHEMES[scheme]) {
    return { kind: GATEWAY_SCHEMES[scheme], verdict: 'needs-gateway', engine: 'none', reason: 'gateway', url };
  }

  // Embeds — the same parsers the screen uses to build the iframe src.
  if (parseYoutubeUrl(url)) return { kind: 'youtube', verdict: 'supported', engine: 'embed', url };
  if (parseVimeoUrl(url)) return { kind: 'vimeo', verdict: 'supported', engine: 'embed', url };

  let parsed: URL;
  try {
    parsed = new URL(/^\/\//.test(url) ? `https:${url}` : url);
  } catch {
    return { kind: 'unknown', verdict: 'blocked', engine: 'none', reason: 'not-a-url', url };
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'twitch.tv' || host.endsWith('.twitch.tv')) {
    return { kind: 'twitch', verdict: 'supported', engine: 'embed', url };
  }
  if (host === 'kick.com' || host.endsWith('.kick.com')) {
    return { kind: 'kick', verdict: 'supported', engine: 'embed', url };
  }

  const path = `${parsed.pathname}${parsed.search}`.toLowerCase();
  let kind: StreamKind = 'unknown';
  if (/\.m3u8(\?|$|&)|format=m3u8|\/manifest\(format=m3u8/.test(path) || /\.m3u8/.test(parsed.pathname.toLowerCase())) kind = 'hls';
  else if (/\.mpd(\?|$)/.test(parsed.pathname.toLowerCase()) || /format=mpd/.test(path)) kind = 'dash';
  else if (/\.(mp4|m4v|webm|mov)$/.test(parsed.pathname.toLowerCase())) kind = 'progressive';
  else if (/\.(mjpe?g)$/.test(parsed.pathname.toLowerCase()) || /mjpe?g|action=stream|video\.cgi|faststream|nphmotionjpeg/.test(path)) kind = 'mjpeg';
  else if (/\.(jpe?g|png|webp)$/.test(parsed.pathname.toLowerCase()) || /snapshot|still\.jpg|image\.cgi/.test(path)) kind = 'snapshot';

  const engine: StreamSource['engine'] =
    kind === 'mjpeg' || kind === 'snapshot' ? 'image' : kind === 'dash' ? 'none' : 'video';

  // Delivery checks apply to every network kind.
  if (parsed.protocol === 'http:') {
    return { kind, verdict: 'blocked', engine, reason: 'insecure', url };
  }
  if (parsed.protocol !== 'https:') {
    return { kind, verdict: 'blocked', engine: 'none', reason: 'not-a-url', url };
  }
  if (isPrivateHost(parsed.hostname)) {
    return { kind, verdict: 'blocked', engine, reason: 'private-host', url };
  }

  if (kind === 'dash') return { kind, verdict: 'unsupported', engine: 'none', reason: 'dash', url };
  if (kind === 'unknown') return { kind, verdict: 'probable', engine: 'video', reason: 'unknown-host', url };
  return { kind, verdict: 'supported', engine, url };
}

/**
 * Which engine plays HLS on THIS browser (pure — the caller passes the facts).
 *
 *  - Apple WebKit (Safari, iOS, iPadOS) → native: AVFoundation is the most
 *    power-efficient and robust HLS stack there.
 *  - Anything with Media Source Extensions (Chromium, Android System WebView,
 *    the NovaStar Taurus Chromium 83, Firefox, Edge) → hls.js. Android
 *    WebView's `canPlayType('application/vnd.apple.mpegurl')` has answered
 *    "maybe" on some builds and routes to the legacy MediaPlayer path, which
 *    has no live-edge control and fails silently — the old widget took that
 *    path whenever canPlayType was non-empty.
 *  - Native-only (an old iOS without MSE) → native.
 *  - Neither → none (the widget says so instead of a black box).
 */
export function pickHlsEngine(facts: { nativeHls: boolean; mse: boolean; appleWebKit: boolean }): 'native' | 'hlsjs' | 'none' {
  if (facts.appleWebKit && facts.nativeHls) return 'native';
  if (facts.mse) return 'hlsjs';
  if (facts.nativeHls) return 'native';
  return 'none';
}

/** Apple WebKit = Safari / iOS browsers (every iOS browser is WebKit). */
export function isAppleWebKitUA(ua: string): boolean {
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  if (/Android|Chrome\/|Chromium|CriOS|Edg\/|OPR\//.test(ua)) return false;
  return /AppleWebKit/.test(ua) && /Safari\//.test(ua);
}

/**
 * Reconnect delay for attempt N (0-based): 1 s, 2 s, 4 s, 8 s, 16 s, then
 * 30 s forever, with ±20 % jitter so a venue's 20 screens that lost the same
 * stream do not re-hit the origin in lockstep. `rand` is injectable for tests.
 */
export function reconnectDelayMs(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(30_000, 1000 * Math.pow(2, Math.max(0, Math.min(attempt, 10))));
  const jitter = 1 + (rand() * 0.4 - 0.2);
  return Math.round(base * jitter);
}

/** Seconds without a new frame before a playing stream counts as stalled. */
export const STALL_AFTER_MS = 8_000;
/** Failed attempts (or ms without frames) before the honest "offline" card. */
export const OFFLINE_AFTER_ATTEMPTS = 2;
export const OFFLINE_AFTER_MS = 20_000;
