"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Component, ReactNode } from 'react';
import '@/components/widgets/variants-register'; // Boot-time registration for custom themes
import { MonitorPlay, Wifi, WifiOff, AlertTriangle, Loader2, Settings, CheckCircle2, HardDrive, Cpu, Server, Network, Play, Pause, Monitor, Info, Power, RefreshCw, Download, LogOut } from 'lucide-react';
import { KioskSplash, type LoadProgress } from '@/components/player/KioskSplash';
import { TouchOverlay, TouchNavOverlay } from '@/components/player/TouchOverlay';
// Sprint 5 SOS / TEXT_BROADCAST / MEDIA_ALERT renderer. Audit P0-3
// (2026-05-26) — the API persisted + signed + published these events
// but the player never mounted any consumer for them, so wall screens
// never displayed staff SOS, typed broadcasts, or media alerts. Now
// mounted at the bottom of the main return, self-polls /emergency/
// status when WS is unavailable, and accepts WS-pushed messages via
// the `message` prop.
import { EmergencyOverlay, type EmergencyMessageView } from '@/components/player/EmergencyOverlay';
// Sprint 13 — Colorado Time Systems (CTS) System 6/Gen 6 scoreboard
// bridge. Mounts on the player page when the URL carries `?cts=1` (so
// regular signage screens never see the bridge UI). The bridge reads
// the CTS console via Web Serial on the Beelink mini PC, parses the
// scoreboard protocol, and POSTs each game-state snapshot to the API
// for signed-WS fan-out. See packages/scoreboard-cts/README.md.
import { CtsBridge } from '@/components/player/CtsBridge';
import { WidgetPreview } from '@/components/widgets/WidgetRenderer';
import { WidgetErrorBoundary } from '@/components/widgets/WidgetErrorBoundary';
import { isFlexGapSupported, applyFlexGapPolyfill } from '@/lib/flex-gap-polyfill';
import { isCqUnitSupported, applyCqUnitPolyfill } from '@/lib/cq-unit-polyfill';
import {
  registerOfflineCache,
  precachePlaylist,
  precacheEmergency,
  getCacheStatus,
  formatBytes,
  isSwSupported,
  type CacheStatus,
} from './offline-cache';
import { appConfirm, appAlert } from '@/components/ui/app-dialog';

// ─────────────────────────────────────────────────────────────────────────────
// Bullet-proof helpers (Phase 1 hardening)
// ─────────────────────────────────────────────────────────────────────────────

const LS_TOKEN = 'edu_device_token';
const LS_MANIFEST_CACHE = 'edu_manifest_cache_v1';
const LS_EMERGENCY_CACHE = 'edu_emergency_cache_v1';

/** Read a URL query param once; safe for SSR. */
function qp(name: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(name);
}

/**
 * True when the player was opened via the dashboard's "Open Screen in Browser"
 * ExternalLink button (which appends &preview=1). In preview mode we:
 *   - Use a synthetic `preview-<random>` fingerprint so we don't stomp the
 *     real kiosk's heartbeat or lastPingAt.
 *   - Skip the /screens/register call entirely (returns a fake paired=false response).
 *   - Skip the 30s /screens/status heartbeat entirely.
 *   - Show a PREVIEW MODE chip so it's visually obvious.
 */
function isPreviewMode(): boolean {
  return qp('preview') === '1';
}

/** True when running inside the Android player WebView (passed via ?client=android). */
function isAndroidWebView(): boolean {
  if (typeof window === 'undefined') return false;
  if (qp('client') === 'android') return true;
  // Native app exposes window.EduCmsNative as a JS bridge.
  return !!(window as any).EduCmsNative;
}

/** Ask the Android shell to do a hard reload (last-resort recovery). No-op in browser. */
function nativeReload() {
  try { (window as any).EduCmsNative?.reload?.(); } catch { /* noop */ }
}

/**
 * Phase D1.6 — touch-action URL safety helpers.
 *
 * Security review (2026-05-12) flagged HIGH: a rogue CONTRIBUTOR
 * could set a zone's touchAction to `{ type: 'url', target:
 * 'javascript:fetch(...)' }` and exfiltrate the device JWT from
 * localStorage when a visitor tapped the zone (`window.open` runs
 * javascript: URIs in the player's same origin). These two helpers
 * gate every operator-supplied URL at the dispatcher boundary:
 *
 *   isHttpUrl  — only `http:` / `https:` schemes; rejects
 *                `javascript:`, `data:`, `file:`, `vbscript:`, etc.
 *   isPublicHttpUrl — adds a private-RFC-1918 / loopback / link-local
 *                hostname check for webhook targets so operators
 *                can't pivot a kiosk's WebView into the LAN
 *                (`192.168.x.x` admin panels, `localhost:8080`,
 *                printer queues at `10.0.0.x`, etc).
 *
 * Both reject malformed input safely (try/catch on `new URL`). The
 * dispatcher logs + drops invalid actions rather than throwing —
 * playback never breaks from a bad action shape.
 */
function isHttpUrl(u: unknown): u is string {
  if (typeof u !== 'string' || !u) return false;
  try {
    const p = new URL(u).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
}

function isPublicHttpUrl(u: unknown): u is string {
  if (!isHttpUrl(u)) return false;
  try {
    const host = new URL(u as string).hostname.toLowerCase();
    if (!host) return false;
    // localhost variants
    if (host === 'localhost' || host === '0.0.0.0' || host.endsWith('.localhost')) return false;
    // .local mDNS (printers, routers)
    if (host.endsWith('.local')) return false;
    // IPv4 private + loopback + link-local
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (ipv4) {
      const [, a, b] = ipv4.map(Number);
      if (a === 127) return false;                 // 127.0.0.0/8 loopback
      if (a === 10) return false;                  // 10.0.0.0/8
      if (a === 192 && b === 168) return false;    // 192.168.0.0/16
      if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
      if (a === 169 && b === 254) return false;    // 169.254.0.0/16 link-local
      if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 CGNAT
      if (a === 0) return false;                   // 0.0.0.0/8
    }
    // IPv6 loopback + link-local + ULA
    if (host === '::1' || host === '[::1]') return false;
    if (host.startsWith('[fe80:') || host.startsWith('fe80:')) return false; // link-local
    if (host.startsWith('[fc') || host.startsWith('fc') || host.startsWith('fd')) {
      // fc00::/7 ULA (privately routed)
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Phase D1 — touch-action dispatcher (touch builder v1).
 *
 * Reads a TouchActionConfig from a tapped zone and executes the
 * corresponding side-effect. Eight v1 primitives plus three legacy
 * v0 aliases. Every action also dispatches an `edu:touch-action`
 * CustomEvent so the idle-reset listener picks up ANY tap regardless
 * of action type.
 *
 * Side-effects are intentionally local — the dispatcher doesn't
 * mutate React state directly (would require lifting it into the
 * component tree). For state-changing actions (goto-template,
 * show-overlay) we publish a second CustomEvent that the player's
 * top-level component listens for and routes into setState. Keeps
 * the dispatcher pure module-level + the component listening surface
 * narrow.
 *
 * Webhooks fire-and-forget; failures log but never throw.
 * request-help posts a signed event to the same Redis channel
 * emergency triggers use — reusing the existing notification path.
 */
function dispatchTouchAction(
  action: any,
  ctx: { screenId: string | null; tenantId: string | null; zoneId?: string | null },
): void {
  // 2026-05-14 — temporary diagnostic. Operator reports "the menu
  // doesnt come up when i tap but the widgets dont do anything at
  // all when you touch them" on the Sample Touch template (DB
  // confirmed: 3 TOUCH_POINTs with valid open-url / play-video /
  // goto-template actions). isTouchEnabled flag IS shipping (menu
  // no longer pops), so the manifest passthrough fix landed. Need
  // to know where between "tap → dispatcher → custom event →
  // listener → overlay" the chain breaks. console.log on every
  // entry so DevTools / remote debug surfaces the trace. Always
  // dispatch a `edu:touch-fired` event so the visible debug toast
  // can show it without depending on dev tools. Remove this block
  // once the bug is identified.
  try {
    // eslint-disable-next-line no-console
    console.log('[touch] dispatchTouchAction called', {
      action,
      zoneId: ctx.zoneId,
      type: action?.type,
      target: action?.target,
    });
    window.dispatchEvent(new CustomEvent('edu:touch-fired', {
      detail: { action, zoneId: ctx.zoneId ?? null, ts: Date.now() },
    }));
  } catch { /* swallow */ }

  if (!action || typeof action !== 'object' || !action.type) {
    try { console.warn('[touch] dispatcher rejected — bad shape', action); } catch {}
    return;
  }
  const type = action.type as string;
  const target = action.target as string | undefined;

  // Always broadcast — idle-reset, analytics, and the future
  // co-edit cursor layer all listen for this single event. Phase D5
  // analytics reads `detail.zoneId` so we include it here when the
  // caller supplied one (zone click sites always do).
  try {
    window.dispatchEvent(new CustomEvent('edu:touch-action', {
      detail: { ...action, zoneId: ctx.zoneId ?? null },
    }));
  } catch { /* swallow */ }

  switch (type) {
    case 'open-url': {
      // Phase D1.6 security gate — reject javascript:/data:/file:/etc.
      // (Security review 2026-05-12: rogue operator could exfiltrate
      // the device JWT via window.open('javascript:...')).
      if (!isHttpUrl(target)) {
        try { console.warn('[touch] open-url rejected — not http(s):', target); } catch {}
        return;
      }
      if (action.openInNewTab) {
        window.open(target, '_blank', 'noopener,noreferrer');
      } else {
        // Default to in-place overlay — kiosks rarely have a browser
        // chrome to receive a new tab. The 'edu:touch-overlay' event
        // is consumed by the player's overlay layer.
        window.dispatchEvent(
          new CustomEvent('edu:touch-overlay', {
            detail: { kind: 'iframe', url: target },
          }),
        );
      }
      return;
    }
    case 'play-video': {
      if (!target) return;
      window.dispatchEvent(
        new CustomEvent('edu:touch-overlay', {
          detail: { kind: 'video', assetId: target, returnOnEnd: action.returnOnEnd !== false },
        }),
      );
      return;
    }
    case 'goto-template': {
      if (!target) return;
      window.dispatchEvent(
        new CustomEvent('edu:touch-navigate', {
          detail: { templateId: target, transition: action.transition || 'cut' },
        }),
      );
      return;
    }
    case 'goto-scene': {
      // Phase D2 — in-template scene switch. Fires a CustomEvent the
      // player picks up to update currentSceneId. No network call;
      // the scene's zones are already loaded with the template.
      if (!target) return;
      window.dispatchEvent(
        new CustomEvent('edu:touch-scene-change', {
          detail: { sceneId: target, transition: action.transition || 'cut' },
        }),
      );
      return;
    }
    case 'show-overlay': {
      if (!target) return;
      window.dispatchEvent(
        new CustomEvent('edu:touch-overlay', {
          detail: { kind: 'asset', assetId: target },
        }),
      );
      return;
    }
    case 'reset-idle': {
      // The idle-reset listener already runs on every
      // edu:touch-action event (dispatched above), so this case is
      // a no-op — but we leave it explicit so the operator's "Stay
      // on page" button does literally one thing they expect.
      return;
    }
    case 'sound-toggle': {
      window.dispatchEvent(new CustomEvent('edu:touch-sound-toggle'));
      return;
    }
    case 'webhook': {
      // Phase D1.6 security gate — reject non-http(s) AND private IPs.
      // (Security review 2026-05-12: rogue operator could pivot the
      // kiosk's WebView into the school LAN — 192.168.x.x admin
      // panels, printer queues at 10.0.0.x, etc.).
      if (!isPublicHttpUrl(target)) {
        try { console.warn('[touch] webhook rejected — not a public http(s) URL:', target); } catch {}
        return;
      }
      const method = (action.method as string) || 'POST';
      const payload = {
        ...(action.payload || {}),
        // Stamp the calling kiosk so the receiver can correlate.
        _meta: { screenId: ctx.screenId, tenantId: ctx.tenantId, ts: Date.now() },
      };
      try {
        const url = target;
        if (method === 'GET') {
          const qs = new URLSearchParams();
          for (const [k, v] of Object.entries(payload)) qs.set(k, typeof v === 'string' ? v : JSON.stringify(v));
          fetch(`${url}?${qs.toString()}`, { method: 'GET', mode: 'no-cors' }).catch(() => {});
        } else {
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            mode: 'no-cors',
          }).catch(() => {});
        }
      } catch { /* swallow */ }
      return;
    }
    case 'request-help': {
      // Post to our own /notifications/help endpoint — the server
      // creates an in-app notification visible to admins of this
      // tenant. The endpoint is rate-limited (10/min/screen) so a
      // mashy visitor can't spam the admin pager.
      const body = (action.body as string) || 'A kiosk visitor tapped “request help.”';
      const title = (action.target as string) || 'Visitor needs assistance';
      try {
        fetch(`${getApiRoot()}/api/v1/notifications/help`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            screenId: ctx.screenId,
            tenantId: ctx.tenantId,
            title,
            body,
          }),
        }).catch(() => {});
      } catch { /* swallow */ }
      return;
    }
    // Legacy v0 aliases — keep working unchanged (but with the same
    // http(s) gate; the security fix backports to legacy rows too).
    case 'url': {
      if (!isHttpUrl(target)) {
        try { console.warn('[touch] url (legacy) rejected — not http(s):', target); } catch {}
        return;
      }
      window.open(target, '_blank', 'noopener,noreferrer');
      return;
    }
    case 'navigate':
    case 'show': {
      // v0 never actually wired these in the player runtime, only
      // dispatched the event. Treat as a synonym for goto-template
      // when target looks like a UUID, else log + ignore.
      if (target) {
        window.dispatchEvent(
          new CustomEvent('edu:touch-navigate', {
            detail: { templateId: target, transition: 'cut' },
          }),
        );
      }
      return;
    }
    default: {
      // Unknown type — log but don't break playback.
      try { console.warn('[touch] unknown action type:', type); } catch {}
    }
  }
}

/** Get the device pairing token from URL → localStorage → null. */
function getDeviceToken(): string | null {
  if (typeof window === 'undefined') return null;
  const fromUrl = qp('token');
  if (fromUrl) {
    try { localStorage.setItem(LS_TOKEN, fromUrl); } catch {}
    return fromUrl;
  }
  try { return localStorage.getItem(LS_TOKEN); } catch { return null; }
}

/** Compute exponential backoff with full jitter. Capped at maxMs. */
function backoffMs(attempt: number, baseMs = 1000, maxMs = 30_000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 10));
  return Math.floor(Math.random() * exp);
}

/** Cache the last good manifest payload so the player can survive a cold reboot offline. */
function cacheManifest(m: any) {
  try { localStorage.setItem(LS_MANIFEST_CACHE, JSON.stringify({ at: Date.now(), m })); } catch {}
}
function readCachedManifest(): { at: number; m: any } | null {
  try {
    const raw = localStorage.getItem(LS_MANIFEST_CACHE);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Legacy manifests did not include playlist item ids, so older kiosks
 * fell back to raw URLs as the playback identity. Signed/CDN URLs can
 * change between polls even when the actual content did not, which
 * resets the carousel to item 1. Keep only the stable part as a last
 * resort until every API payload carries item_id/asset_id/asset_hash.
 */
function stableManifestUrlKey(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://educms.local';
    const url = new URL(rawUrl, base);
    [
      'token',
      'signature',
      'expires',
      'expires_at',
      'X-Amz-Signature',
      'X-Amz-Expires',
      'X-Amz-Credential',
      'X-Amz-Date',
      'X-Amz-Security-Token',
      'Policy',
      'Key-Pair-Id',
      'AWSAccessKeyId',
      'GoogleAccessId',
      'Expires',
      'Signature',
      'download',
      'cache',
      'cacheBust',
      'cb',
      't',
      '_',
    ].forEach((key) => url.searchParams.delete(key));
    url.hash = '';
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return String(rawUrl).split('#')[0];
  }
}

/**
 * Cache the last-known emergency override. CRITICAL for life-safety: if the
 * device power-cycles mid-emergency or loses network during the alert, we can
 * still show the cached emergency on next boot until ALL_CLEAR or a fresh
 * manifest arrives. Stale cache is auto-discarded after 4 hours.
 */
function cacheEmergency(payload: any | null) {
  try {
    if (!payload) {
      localStorage.removeItem(LS_EMERGENCY_CACHE);
      return;
    }
    // HIGH-8 audit fix: persist a server-issued absolute expiry alongside
    // the payload so we don't depend on the device's wall clock to decide
    // staleness. Order of preference:
    //   1. payload.expiresAt    — server-side absolute UNIX seconds
    //   2. payload.expires_at   — same field, snake_case variant
    //   3. fall back to "Date.now() + 4h" written at cache time (legacy
    //      behavior). Marked so reads can prefer absolute when present.
    const serverExpires =
      typeof payload?.expiresAt === 'number' ? payload.expiresAt * 1000 :
      typeof payload?.expires_at === 'number' ? payload.expires_at * 1000 :
      null;
    const fallbackExpires = Date.now() + 4 * 60 * 60 * 1000;
    localStorage.setItem(LS_EMERGENCY_CACHE, JSON.stringify({
      at: Date.now(),
      expiresAt: serverExpires ?? fallbackExpires,
      hasServerExpiry: serverExpires != null,
      payload,
    }));
  } catch {}
}
function readCachedEmergency(): any | null {
  try {
    const raw = localStorage.getItem(LS_EMERGENCY_CACHE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const { at, expiresAt, hasServerExpiry, payload } = parsed;
    // Prefer server-issued absolute expiry when available — robust against
    // device clock skew that could otherwise hide an expired alert OR keep
    // a long-stale one alive (e.g. kiosk clock regressed by a month).
    if (typeof expiresAt === 'number' && Date.now() > expiresAt) {
      return null;
    }
    // Legacy fallback (no server expiry was stored): 4h TTL anchored to
    // the cache write time. Same behavior as before.
    if (!hasServerExpiry && typeof at === 'number' && Date.now() - at > 4 * 60 * 60 * 1000) {
      return null;
    }
    return payload;
  } catch { return null; }
}

function getApiRoot(): string {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const apiParam = params.get('api');
    if (apiParam) {
      // Save to localStorage so it persists across refreshes
      localStorage.setItem('edu_api_root', apiParam.replace(/\/api\/v1\/?$/, ''));
      return apiParam.replace(/\/api\/v1\/?$/, '');
    }
    const saved = localStorage.getItem('edu_api_root');
    if (saved) return saved;
  }
  const env = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';
  return env.replace('/api/v1', '');
}

// 2026-05-04 — PlayerVideoSlide component.
// Operator: "the new player does not auto play the second video in the
// playlist, it should be looping both videos and not showing the player
// icon in between, instead it now finished the first video and shows
// nothing but the giant play icon on the screen never playing the
// second video".
//
// Cause: my earlier preload-the-next-video fix used `autoPlay={isActive}`.
// `autoPlay` is a one-time HTML attribute that fires when the element
// MOUNTS — not when the prop changes. So when video 2 was rendered
// pre-active with autoPlay={false} for preloading, flipping the prop
// later does nothing. The video stays paused, paints the empty
// placeholder over the black background, and operator sees nothing
// playing.
//
// Fix: imperative play()/pause() via a ref + useEffect on isActive
// change. The element STAYS MOUNTED across the transition (so the
// preload fix still works — no remount-flash), but we explicitly
// command playback when it becomes active.
//
// Solo-playlist case (single video repeated): still uses native
// `loop` attribute for browser-handled seamless restart with zero
// React re-render gap. The play/pause effect is a no-op for solo
// playlists because isActive stays true forever.
function PlayerVideoSlide({
  src,
  isActive,
  classes,
  isSoloPlaylist,
  onEnded,
  onError,
  videoKey,
  muted,
}: {
  src: string;
  isActive: boolean;
  classes: string;
  isSoloPlaylist: boolean;
  onEnded: () => void;
  onError: () => void;
  videoKey: string;
  /**
   * 2026-05-05 — per-item mute override. When false, the <video> element's
   * muted attribute is omitted so the clip plays with sound. The Android
   * Player WebView already has mediaPlaybackRequiresUserGesture=false,
   * so unmuted autoplay works on the kiosk. On the web preview (regular
   * Chrome without that flag) the play() promise will reject if the
   * browser blocks autoplay-with-sound — caught silently below; operator
   * sees a paused first frame, but kiosk plays normally.
   */
  muted?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Default to muted=true if undefined (matches pre-2026-05-05 behavior
  // for any manifest that doesn't include the field, e.g. cached
  // service-worker payloads from before the column existed).
  const isMuted = muted !== false;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isActive) {
      // Reset to start when becoming active so a previous play that
      // ended at duration doesn't replay from the end. For initial
      // mount, currentTime is already 0 — this is a no-op.
      try { v.currentTime = 0; } catch { /* some browsers reject if not ready */ }

      // 2026-05-05 — explicitly set `muted` as a property (in addition
      // to the JSX prop) so the autoplay-fallback below can flip it
      // imperatively without React re-render lag. React updates the
      // attribute but the video element's `muted` IDL property is
      // what the play() permission check actually reads.
      v.muted = isMuted;

      // Play() returns a promise on modern browsers. For muted videos
      // it always succeeds. For UNMUTED videos Chrome's autoplay
      // policy will reject unless:
      //   (a) the user has interacted with the page, OR
      //   (b) the document has the
      //       `mediaPlaybackRequiresUserGesture=false` flag set
      //       (Android Player WebView does this — see MainActivity.kt).
      //
      // When the play() promise rejects on an unmuted video, fall
      // back to muted-autoplay so the operator at least sees the
      // video PLAYING (silent first frame is worse than nothing).
      // The page-level user-gesture listener below will retry
      // unmute on the first click/key/touch.
      const p = v.play();
      if (p && typeof p.catch === 'function') {
        p.catch((err: any) => {
          if (!isMuted) {
            // eslint-disable-next-line no-console
            console.warn('[Player] autoplay-with-sound blocked, falling back to muted:', err?.name || err);
            try {
              v.muted = true;
              v.play().catch(() => {});
            } catch { /* noop */ }
          }
        });
      }
    } else {
      try { v.pause(); } catch { /* noop */ }
    }
  }, [isActive, isMuted]);

  // 2026-05-05 — recover from autoplay-with-sound block on first user
  // gesture. Chrome's policy says any document-wide click / keydown /
  // pointerdown counts as a gesture and unlocks audio playback for
  // the rest of the page lifetime. Re-attempt the unmute as soon as
  // we see one. Pure no-op on the Android kiosk because the gesture
  // requirement is already disabled there.
  useEffect(() => {
    if (isMuted) return; // muted-by-design — no recovery needed
    const tryUnmute = () => {
      const v = videoRef.current;
      if (!v) return;
      if (v.muted) {
        // eslint-disable-next-line no-console
        console.log('[Player] user gesture — restoring sound');
        v.muted = false;
        const p = v.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    };
    document.addEventListener('pointerdown', tryUnmute);
    document.addEventListener('keydown', tryUnmute);
    document.addEventListener('touchstart', tryUnmute);
    return () => {
      document.removeEventListener('pointerdown', tryUnmute);
      document.removeEventListener('keydown', tryUnmute);
      document.removeEventListener('touchstart', tryUnmute);
    };
  }, [isMuted]);

  // 2026-05-13 — MIME-coercion for iPhone .mov files.
  //
  // iPhones produce .mov files that are actually H.264/AAC inside a
  // QuickTime container — MP4-payload-compatible bytes with the wrong
  // MIME label. Supabase serves them as `Content-Type: video/quicktime`
  // (correct per spec), but Android WebView's HTMLVideoElement refuses
  // to even *try* video/quicktime — it errors before sniffing the
  // codec. Result: operator uploads an iPhone clip, dashboard shows
  // it just fine (desktop Chrome accepts QT), kiosk shows nothing.
  //
  // Fix: when the URL looks like a .mov, render <source type="video/mp4">
  // children instead of using the bare `src` attribute. This tells the
  // browser "treat this as MP4 regardless of what the server says,"
  // and the actual H.264/AAC bytes decode fine. Doesn't help for true
  // QuickTime-only formats (DV, ProRes, etc.) but those are vanishingly
  // rare on signage. iPhone H.264-in-MOV is 99% of operator uploads.
  const isMov = /\.mov(\?|$)/i.test(src);
  return (
    <video
      ref={videoRef}
      key={videoKey}
      src={isMov ? undefined : src}
      className={classes}
      preload="auto"
      // 2026-05-13 — inline-style fallback so the video renders
      // full-screen even if Tailwind doesn't apply the parent
      // utility classes. Background:#000 was already here; the
      // position/size/object-fit lines are the new fallbacks.
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        background: '#000',
      }}
      muted={isMuted}
      playsInline
      loop={isSoloPlaylist}
      onEnded={isSoloPlaylist ? undefined : onEnded}
      onError={onError}
    >
      {isMov && (
        <>
          {/* Try MP4 first (iPhone .mov is MP4-payload). Fall back to
              the raw QT mime in case some asset really is true QT. */}
          <source src={src} type="video/mp4" />
          <source src={src} type="video/quicktime" />
        </>
      )}
    </video>
  );
}

// Generate a stable device fingerprint for this physical device.
//
// PRECEDENCE (first match wins):
//   1. Preview mode (?preview=1) — returns a throw-away `preview-<random>`
//      fingerprint that starts with 'preview-'. The API ignores these so the
//      dashboard's "Open Screen in Browser" button never poisons the real
//      kiosk's heartbeat or lastPingAt.
//   2. URL ?fp= — passed by the Android APK using Settings.Secure.ANDROID_ID
//      which survives app uninstalls + reinstalls (it only rotates on
//      factory reset). This is what lets a re-sideloaded kiosk come back
//      paired without a fresh pairing dance.
//   3. URL ?deviceId= — legacy alias used by dev test paths
//   4. localStorage 'edu_device_fp' — fallback for pure browser players
//      (plain Chrome tab). Gets a random UUID on first run and sticks
//      as long as the browser profile lasts.
function getDeviceFingerprint(): string {
  const key = 'edu_device_fp';
  if (typeof window !== 'undefined') {
    // Preview mode: return a synthetic fingerprint so we don't write to
    // localStorage and never stomp the real paired device's identity.
    if (isPreviewMode()) {
      return `preview-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    }
    const params = new URLSearchParams(window.location.search);
    // Android APK passes the stable Android ID as ?fp=
    const apkFp = params.get('fp');
    if (apkFp && apkFp.length >= 8) {
      localStorage.setItem(key, apkFp);
      return apkFp;
    }
    const idParam = params.get('deviceId');
    if (idParam) {
      localStorage.setItem(key, idParam);
      return idParam;
    }
  }
  let fp = localStorage.getItem(key);
  if (!fp) {
    fp = `device-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    localStorage.setItem(key, fp);
  }
  return fp;
}

/**
 * Build the heartbeat URL with ?v=&vc= appended when the page knows
 * its APK version.
 *
 * History: up through v1.0.10 the native HeartbeatService never fired
 * because nothing in the native code wrote `device_fingerprint` or
 * `api_root` to SharedPreferences (operator 2026-04-27 caught this
 * after pushing an OTA that silently no-op'd). The web heartbeats DO
 * fire (that's why kiosks show ONLINE), so this helper threads the
 * APK version into the heartbeat URL so the server captures the
 * version regardless of whether the native service is alive.
 *
 * v1.0.11 finally fixed the prefs-write bug — once an APK >=1.0.11 is
 * installed, the native service WILL fire too. We keep this URL
 * helper because (a) it's still the only path on browser players,
 * and (b) belt-and-suspenders for older sideloaded APKs that haven't
 * been upgraded yet.
 */
/**
 * Resolve the player APK version from any of three sources, in order
 * of precedence. Defensive against URL-param loss on navigation /
 * page reload (operator caught us on 2026-04-27: kiosk on v1.0.11
 * but dashboard chip stuck blank).
 *
 *   1. URL ?v= / ?vc= — set by the APK via MainActivity.loadPlayer
 *   2. EduCmsNative.deviceInfo() bridge — always available on APK
 *      (returns appVersion in JSON), survives any in-page navigation
 *   3. localStorage — sticky cache so even a hard reload of the
 *      WebView keeps the version in heartbeats while we wait for
 *      the bridge to come back online
 */
function resolvePlayerVersion(): { v: string | null; vc: string | null } {
  if (typeof window === 'undefined') return { v: null, vc: null };

  // 1. URL params (initial APK URL)
  const params = new URLSearchParams(window.location.search);
  let v = params.get('v') || null;
  let vc = params.get('vc') || null;

  // 2. Native bridge — most reliable on APK
  if (!v) {
    try {
      const bridge = (window as any).EduCmsNative;
      const raw = bridge?.deviceInfo?.();
      if (raw) {
        const info = JSON.parse(raw);
        if (info?.appVersion) v = String(info.appVersion);
      }
    } catch { /* bridge unavailable, fall through */ }
  }

  // 3. localStorage cache (set on any successful detection above)
  if (!v) {
    try {
      const cached = localStorage.getItem('edu_player_apk_version');
      if (cached) v = cached;
      const cachedVc = localStorage.getItem('edu_player_apk_version_code');
      if (!vc && cachedVc) vc = cachedVc;
    } catch { /* private mode / quota — fall through */ }
  }

  // Persist whatever we found for the next page load.
  try {
    if (v) localStorage.setItem('edu_player_apk_version', v);
    if (vc) localStorage.setItem('edu_player_apk_version_code', vc);
  } catch { /* tolerated */ }

  return { v, vc };
}

function buildHeartbeatUrl(apiRoot: string, fp: string): string {
  if (typeof window === 'undefined') return `${apiRoot}/api/v1/screens/status/${fp}`;
  const { v, vc } = resolvePlayerVersion();
  const qs = new URLSearchParams();
  if (v) qs.set('v', v);
  if (vc) qs.set('vc', vc);
  // v1.0.13 — Manager APK version. Player can't query Android
  // PackageManager from the WebView directly, but the native
  // MainActivity reads it via PackageManager and passes &mv= on
  // the page URL.
  // 2026-04-28 (Player v1.0.19+) — empty string is now an
  // EXPLICIT "Manager uninstalled" signal that the server uses to
  // clear the dashboard chip. Use null check (not truthy check)
  // so we forward empty values too. params.get('mv') returns
  // null when the param is absent, '' when it's empty, '1.0.3'
  // when set.
  const params = new URLSearchParams(window.location.search);
  const mv = params.get('mv');
  if (mv !== null) qs.set('mv', mv);
  const suffix = qs.toString();
  return suffix
    ? `${apiRoot}/api/v1/screens/status/${fp}?${suffix}`
    : `${apiRoot}/api/v1/screens/status/${fp}`;
}

// 2026-05-03 — Sprint 8d Android compatibility: detect device capabilities
// at boot and surface them in the device info we report to the server.
// Lets ops see per-screen "is this device modern enough to run feature X"
// at a glance, and drives the auto-fallback layer at render time.
import { detectCapabilities } from '@/lib/capabilities';

function getDeviceInfo() {
  const ua = navigator.userAgent;
  let os = 'Unknown';
  if (/android/i.test(ua)) os = 'Android';
  else if (/ipad|iphone|ipod/i.test(ua)) os = 'iOS';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/mac/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';
  else if (/cros/i.test(ua)) os = 'Chrome OS';

  let browser = 'Unknown';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/chrome/i.test(ua)) browser = 'Chrome';
  else if (/firefox/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';

  // Prefer URL-supplied native resolution (Android APK detects the
  // real physical pixel count via WindowManager.maximumWindowMetrics
  // and passes it as ?w=...&h=... — window.screen.width returns
  // DPI-scaled CSS pixels which lie by 2-3x on HiDPI displays).
  // Fall back to window.screen for plain browser players.
  let pxW = 0, pxH = 0;
  try {
    const qp = new URLSearchParams(window.location.search);
    pxW = parseInt(qp.get('w') || '0', 10) || 0;
    pxH = parseInt(qp.get('h') || '0', 10) || 0;
  } catch {}
  if (!pxW || !pxH) {
    pxW = window.screen.width;
    pxH = window.screen.height;
  }

  // 2026-05-03 — capability snapshot. Lets the server know which
  // CSS / Web API / codec features this device supports, so we can
  // render per-screen diagnostics + spot devices that need attention
  // (Chromium <70, missing H.265, etc.) without combing through UAs.
  const caps = detectCapabilities();
  // eslint-disable-next-line no-console
  console.log('[Player] capabilities', {
    chromium: caps.chromiumMajor || 'unknown',
    modern: caps.modernChromium,
    containerQueries: caps.containerQueries,
    backdropFilter: caps.backdropFilter,
    h265: caps.codecH265,
    av1: caps.codecAv1,
  });

  return {
    resolution: `${pxW}×${pxH}`,
    osInfo: os,
    browserInfo: `${browser} ${navigator.language}`,
    userAgent: ua,
    chromiumVersion: caps.chromiumMajor || null,
    capabilities: {
      modernChromium: caps.modernChromium,
      containerQueries: caps.containerQueries,
      backdropFilter: caps.backdropFilter,
      hasSelector: caps.hasSelector,
      oklchColors: caps.oklchColors,
      colorMix: caps.colorMix,
      subgrid: caps.subgrid,
      codecH264: caps.codecH264,
      codecH265: caps.codecH265,
      codecVp9: caps.codecVp9,
      codecAv1: caps.codecAv1,
      imageWebp: caps.imageWebp,
      imageAvif: caps.imageAvif,
    },
  };
}

type Phase = 'registering' | 'pairing' | 'connecting' | 'playing' | 'offline' | 'emergency';

// ─── Software version + manual OTA trigger inside the info overlay ───
// User ask 2026-04-20: "stop/start with the TV remote, see the software
// version, maybe trigger the update from there". Enter key already toggles
// the overlay (onKeyDown handler on the playlist container); this row
// puts the missing version info + a Check-for-updates button in reach.
function SoftwareInfoRow() {
  const [apkVersion, setApkVersion] = useState<string | null>(null);
  const [webVersion] = useState<string>(
    (process.env.NEXT_PUBLIC_BUILD_SHA || '').slice(0, 7) || 'dev',
  );
  const [checking, setChecking] = useState(false);
  const [lastCheckMsg, setLastCheckMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const bridge = (window as any).EduCmsNative;
      if (bridge && typeof bridge.deviceInfo === 'function') {
        const raw = bridge.deviceInfo();
        const info = JSON.parse(raw);
        if (info?.appVersion) setApkVersion(info.appVersion);
      }
    } catch { /* browser player — leave as null */ }
  }, []);

  const handleCheck = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setChecking(true);
    setLastCheckMsg(null);
    try {
      // Preferred path: 1.0.6+ native bridge enqueues the OTA worker
      // right now. The worker handles the full download+install dance,
      // so we just tell the operator we've asked.
      const bridge = (window as any).EduCmsNative;
      if (bridge && typeof bridge.checkForUpdates === 'function') {
        const ver = bridge.checkForUpdates();
        setLastCheckMsg(`Checking… (currently on ${ver || apkVersion || '?'})`);
        // After ~8s the worker has usually either begun downloading
        // (install prompt pops separately) OR reported uptoDate.
        setTimeout(() => setLastCheckMsg((prev) => prev ? 'Check complete — watch for install prompt if an update was available.' : prev), 8_000);
        return;
      }
      // Fallback for 1.0.5 (no bridge method): POST /update-check directly
      // from JS, show the result. If an update is available, open the
      // APK URL so Android's downloader + installer kick in manually.
      const payload = {
        versionName: apkVersion || 'browser',
        versionCode: 0,
        fingerprint: localStorage.getItem('edu_device_fp') || '',
        abi: 'browser',
      };
      const r = await fetch(`${getApiRoot()}/api/v1/player/update-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        setLastCheckMsg(`Check failed — HTTP ${r.status}. Try rebooting the kiosk.`);
        return;
      }
      const data = await r.json();
      if (data?.uptoDate) {
        setLastCheckMsg(`Up to date — running ${apkVersion || 'web build'}.`);
        return;
      }
      if (data?.latest?.apkUrl) {
        setLastCheckMsg(`Update available: ${data.latest.versionName}. Opening installer…`);
        // Navigate to the APK URL — on Android this kicks off the
        // download + install flow even for older APK builds that
        // don't have the native OTA bridge.
        try { window.location.href = data.latest.apkUrl; } catch { /* noop */ }
        return;
      }
      setLastCheckMsg('Check complete — no update info returned.');
    } catch (err: any) {
      setLastCheckMsg(`Check error: ${err?.message || err}`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <div className="flex justify-between">
        <span className="text-slate-400">APK version</span>
        <span className="text-white font-medium text-xs">{apkVersion || '(browser — no APK)'}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-400">Web build</span>
        <span className="text-white font-mono text-[11px]">{webVersion}</span>
      </div>
      {apkVersion && (
        <button
          onClick={handleCheck}
          disabled={checking}
          className="w-full mt-1 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-lg font-medium text-xs transition-colors flex items-center justify-center gap-1.5"
        >
          {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
      )}
      {lastCheckMsg && (
        <p className="text-[11px] text-slate-400 leading-snug px-0.5">{lastCheckMsg}</p>
      )}
    </>
  );
}

// ─── Diagnostics section inside the info overlay ───────────────────────────────
// Calls window.EduCmsNative.getRecentLogs() (Kotlin bridge) to pull the
// tail of the on-device rotating log file and display it in a scrollable
// pre block. Two action buttons:
//   "Upload to Support" — calls uploadDiagnostics() to POST /api/v1/player-logs
//   "Copy"             — copies the raw log text to the clipboard
// Only rendered when the native bridge is present (inside the APK WebView).
// Hidden in plain browser player builds.
function DiagnosticsRow() {
  const [logs, setLogs] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const bridge = typeof window !== 'undefined' ? (window as any).EduCmsNative : null;
  if (!bridge || typeof bridge.getRecentLogs !== 'function') return null;

  const loadLogs = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const raw = bridge.getRecentLogs();
      setLogs(typeof raw === 'string' ? raw : JSON.stringify(raw));
    } catch (err: any) {
      setLogs('(error reading logs: ' + (err?.message || String(err)) + ')');
    }
    setExpanded(true);
  };

  const handleUpload = (e: React.MouseEvent) => {
    e.stopPropagation();
    setUploading(true);
    setUploadMsg(null);
    try {
      const result = typeof bridge.uploadDiagnostics === 'function'
        ? bridge.uploadDiagnostics()
        : 'uploadDiagnostics not available';
      setUploadMsg(result || 'upload triggered');
    } catch (err: any) {
      setUploadMsg('error: ' + (err?.message || String(err)));
    } finally {
      setUploading(false);
    }
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!logs) return;
    try {
      await navigator.clipboard.writeText(logs);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable on some older WebViews — fail silently.
    }
  };

  return (
    <div className="pt-1 border-t border-slate-700/60 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-slate-400 text-xs font-medium uppercase tracking-wide">Diagnostics</span>
        <button
          onClick={expanded ? (e) => { e.stopPropagation(); setExpanded(false); } : loadLogs}
          className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          {expanded ? 'Hide logs' : 'Show device logs'}
        </button>
      </div>

      {expanded && (
        <>
          <pre className="bg-slate-950 rounded-lg p-2 text-[10px] font-mono text-slate-300 overflow-y-auto max-h-48 whitespace-pre-wrap break-all leading-relaxed">
            {logs || '(loading...)'}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="flex-1 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-md text-[11px] font-medium transition-colors"
            >
              {uploading ? 'Uploading...' : 'Upload to Support'}
            </button>
            <button
              onClick={handleCopy}
              className="py-1.5 px-3 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-[11px] font-medium transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {uploadMsg && (
            <p className="text-[10px] text-slate-400 leading-snug">{uploadMsg}</p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Cache status chip shown inside the info overlay. Surfaces both tiers
// ─── so admins can verify the player is actually serving emergencies from
// ─── disk (not network) — critical sanity check during drills.
function CacheStatusRow({ status }: { status: CacheStatus | null }) {
  if (!status) {
    return (
      <div className="flex justify-between"><span className="text-slate-400">Offline cache</span><span className="text-slate-500 text-xs">checking…</span></div>
    );
  }
  if (!status.supported) {
    return (
      <div className="flex justify-between"><span className="text-slate-400">Offline cache</span><span className="text-slate-500 text-xs">unsupported (browser)</span></div>
    );
  }
  return (
    <>
      <div className="flex justify-between">
        <span className="text-slate-400">Playlist cache</span>
        <span className="text-white font-medium text-xs">{status.playlist.count} assets · {formatBytes(status.playlist.bytes)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-400">Emergency cache 🛡️</span>
        <span className={status.emergency.count > 0 ? 'text-emerald-400 font-medium text-xs' : 'text-amber-400 font-medium text-xs'}>
          {status.emergency.count > 0
            ? `${status.emergency.count} assets · ${formatBytes(status.emergency.bytes)} ✓`
            : 'NONE — emergencies will fetch from network'}
        </span>
      </div>
    </>
  );
}

/**
 * Diagnostic row showing the effective LED canvas. If the operator has
 * set a canvas override (URL params or localStorage), display it with
 * "(override)" suffix. Otherwise show the controller's reported display
 * size with "(auto)" so the operator can tell at a glance whether
 * they're on auto or manual. Renders nothing on SSR.
 */
function CanvasInfoRow() {
  const [tick, setTick] = useState(0);
  // Re-read after mount so localStorage values land. Re-render on a
  // 'storage' event for cross-tab edits (not common on a kiosk, but
  // free to add) plus a one-shot mount.
  useEffect(() => {
    setTick((t) => t + 1);
    const onStorage = () => setTick((t) => t + 1);
    if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
    };
  }, []);
  if (typeof window === 'undefined') return null;
  let display = '—';
  let label = 'auto';
  let fitMode: 'contain' | 'cover' | 'auto' = 'auto';
  try {
    const p = new URLSearchParams(window.location.search);
    const override = readCanvasOverride();
    fitMode = override.fitMode;
    if (override.w && override.h) {
      display = `${override.w}×${override.h}`;
      label = 'override';
    } else {
      const w = parseInt(p.get('w') || '', 10) || window.screen.width;
      const h = parseInt(p.get('h') || '', 10) || window.screen.height;
      display = `${w}×${h}`;
    }
  } catch { /* fall back to defaults */ }
  // `tick` only used to trigger a re-render; reference it to silence
  // the unused-variable warning.
  void tick;
  const fitLabel = fitMode === 'cover'
    ? 'Fill screen (crop overflow)'
    : fitMode === 'contain'
      ? 'Show whole template (letterbox)'
      : 'Auto (fills when shapes match)';
  return (
    <>
      <div className="flex justify-between">
        <span className="text-slate-400">LED canvas</span>
        <span className={label === 'override' ? 'text-emerald-400 font-medium text-xs' : 'text-slate-300 font-medium text-xs'}>
          {display}{' '}<span className="opacity-60">({label})</span>
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-400">Fit mode</span>
        <span className="text-slate-300 font-medium text-xs">{fitLabel}</span>
      </div>
    </>
  );
}

// ─── Error boundary wraps the whole player so a single widget crash can't
// ─── black out the screen mid-emergency. On crash, we surface the cached
// ─── emergency (if any) and start a recovery countdown, then auto-reload.
class PlayerErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; err?: any; errInfo?: string }> {
  state = { hasError: false, err: undefined as any, errInfo: undefined as string | undefined };
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private reloadCount = 0;
  static getDerivedStateFromError(err: any) { return { hasError: true, err }; }
  componentDidCatch(err: any, info: any) {
    console.error('[Player] FATAL render error', err, info);
    // Surface WHAT crashed on the recovery screen — the operator can
    // read it off the kiosk and report it, turning a blind crash-loop
    // into a one-shot fix. info.componentStack names the component
    // that actually threw.
    try { this.setState({ errInfo: String(info?.componentStack || '').trim() }); } catch { /* noop */ }
    // Bound the reload CADENCE so a widget that crashes on every mount
    // can't become a tight CPU-burning crash-reload loop — but NEVER
    // stop retrying. The old behaviour parked on "Player recovering"
    // after 3 strikes, which on an unattended kiosk meant a dead screen
    // until someone physically rebooted the controller (operator hit
    // this 2026-05-19). Now: 3 fast retries, then slow self-healing
    // retries. The counter resets on a healthy unmount (React discards
    // this instance).
    try {
      const k = '__edu_player_reloadcount';
      const prev = parseInt(sessionStorage.getItem(k) || '0', 10) || 0;
      this.reloadCount = prev + 1;
      sessionStorage.setItem(k, String(this.reloadCount));
    } catch { /* sessionStorage unavailable */ }

    // 3 fast strikes (8s) clear a transient crash quickly. 4th onward:
    // keep retrying SLOWLY (90s) — never park. A slow retry self-heals
    // the moment the bad content is fixed or swapped server-side; 90s
    // is gentle enough that a hard-crashing build won't burn the CPU.
    const delayMs = this.reloadCount <= 3 ? 8_000 : 90_000;
    if (this.reloadCount > 3) {
      console.warn(`[Player] Error boundary hit ${this.reloadCount}x — slow self-heal retry every 90s`);
    }

    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      if (isAndroidWebView()) nativeReload();
      else if (typeof window !== 'undefined') window.location.reload();
    }, delayMs);
  }
  componentWillUnmount() {
    if (this.reloadTimer) { clearTimeout(this.reloadTimer); this.reloadTimer = null; }
    // Healthy unmount — reset the crash counter so one bad render
    // doesn't permanently pin us to the "pause auto-reload" state.
    try { sessionStorage.removeItem('__edu_player_reloadcount'); } catch {}
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    const cachedEm = readCachedEmergency();
    if (cachedEm) {
      // Life-safety override survives the crash.
      return (
        <div className="fixed top-0 right-0 bottom-0 left-0 bg-red-700 text-white flex flex-col items-center justify-center p-12 text-center">
          <AlertTriangle className="w-32 h-32 mb-8 animate-pulse" />
          <h1 className="text-7xl font-black uppercase tracking-wider mb-6">{cachedEm.type || cachedEm.title || 'Emergency'}</h1>
          {cachedEm.textBlob && <p className="text-3xl font-bold max-w-4xl">{cachedEm.textBlob}</p>}
          <p className="text-sm mt-12 opacity-70">Player recovering — reloading shortly</p>
        </div>
      );
    }
    const e: any = this.state.err;
    const errMsg = (e && (e.message || String(e))) || 'Unknown error';
    const stackHead = String(e?.stack || '')
      .split('\n').slice(1, 4).map((s: string) => s.trim()).filter(Boolean).join('\n');
    const compHead = String(this.state.errInfo || '')
      .split('\n').map((s: string) => s.trim()).filter(Boolean).slice(0, 6).join('\n');
    return (
      <div className="fixed top-0 right-0 bottom-0 left-0 bg-slate-950 text-white flex flex-col items-center justify-center p-8">
        <Loader2 className="w-12 h-12 text-amber-500 animate-spin mb-4" />
        <h2 className="text-xl font-bold mb-2">Player recovering…</h2>
        <p className="text-slate-400 text-sm mb-4">Reloading automatically…</p>
        {/* Diagnostic panel — names WHAT threw so an operator can read
            it off the screen and report it. Only ever visible on a
            crash; a healthy player never renders this boundary. */}
        <div
          className="w-full max-w-3xl text-left bg-black/60 border border-slate-700 rounded-lg p-3 overflow-auto"
          style={{ maxHeight: '42vh' }}
        >
          <div className="text-[11px] font-bold uppercase tracking-wide text-rose-400 mb-1">What crashed</div>
          <div className="text-[12px] font-mono text-rose-200 break-words whitespace-pre-wrap">{errMsg}</div>
          {stackHead && (
            <div className="text-[10px] font-mono text-slate-400 mt-2 break-words whitespace-pre-wrap">{stackHead}</div>
          )}
          {compHead && (
            <div className="mt-2">
              <div className="text-[10px] font-bold text-amber-400/90 mb-0.5">component trail</div>
              <div className="text-[10px] font-mono text-amber-300/80 break-words whitespace-pre-wrap">{compHead}</div>
            </div>
          )}
        </div>
      </div>
    );
  }
}

export default function PlayerPageWrapper() {
  return <PlayerErrorBoundary><PlayerPage /></PlayerErrorBoundary>;
}


function PlayerPage() {
  const [phase, setPhase] = useState<Phase>('registering');
  // 2026-05-13 — ref-mirror of phase so callbacks captured by long-
  // running timers (bundle-drift watcher, sustained-failure recovery,
  // anything that fires from a setTimeout/setInterval) can read the
  // CURRENT phase without restarting the effect on every transition.
  // Bound below in a tiny useEffect that just syncs the ref.
  const phaseRef = useRef<Phase>('registering');
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // 2026-05-20 — always-on-screen update fix. The bundle-drift watcher
  // (Phase B4, below) refuses to reload while content is playing so it
  // never flashes mid-content. But a screen that plays a single URL /
  // looping item 24/7 is ALWAYS "playing" and never hits an idle window,
  // so it deferred the reload FOREVER and ran an ancient web bundle
  // indefinitely (operator's M43 kiosk was stuck on a months-old build —
  // that's why a stale error overlay bled through a URL page that current
  // code renders correctly). Two new triggers fix it without flashing
  // mid-content:
  //   1. Loop-boundary reload (heartbeat): for a multi-item playlist, do
  //      the pending reload at the exact moment we wrap from the last
  //      item back to the first — the content was about to restart from
  //      item 0 anyway, so picking up the new bundle there is invisible.
  //   2. Max-staleness cap (watcher): a screen that NEVER wraps (single
  //      URL / solo item) can't hit a loop boundary, so once the bundle
  //      has been known-stale longer than this cap we reload anyway —
  //      a rare ~3s splash blip beats running indefinitely-old code.
  //      The dashboard "Refresh kiosk page" push stays the instant
  //      override for an urgent fix.
  // `bundleDriftSinceRef` = epoch ms when we first saw the server SHA
  // differ from ours (null = we're in sync). Read by both the watcher
  // and the playback heartbeat (different effects → must be a ref).
  const bundleDriftSinceRef = useRef<number | null>(null);
  const MAX_BUNDLE_STALE_MS = 6 * 60 * 60 * 1000; // 6h

  // 2026-05-15 — Web→Native liveness heartbeat. Operator (2026-05-15):
  // "i just saw my player disconnect and then start playing the url
  // content again". The Android shell has a watchdog timer
  // (MainActivity.watchdogTicker) that force-reloads the WebView if
  // `lastSuccessfulLoadAtMs` is more than 10 minutes stale. That
  // field was ONLY updated by `onPageFinishedOk` — which fires once
  // at boot and never again during continuous playback. So every
  // healthy long-running player got force-reloaded every ~10 min:
  // visible to operators as the page disconnecting + restarting the
  // playlist from item 0.
  //
  // Fix: from the web side, ping `EduCmsNative.heartbeat()` every
  // 60 s. The native bridge (WebAppBridge.heartbeat → MainActivity's
  // onWebHeartbeat) updates the same `lastSuccessfulLoadAtMs` field
  // the watchdog reads, so as long as our JS event loop is alive
  // the watchdog never trips. If the JS truly hangs (renderer
  // crash, infinite freeze), heartbeats stop arriving and the
  // watchdog correctly recovers after the 10-min timeout — the
  // safety net stays intact.
  //
  // Cadence: 60 s is well under the 10-min watchdog window, ~9×
  // safety margin against burst-network outages or main-thread
  // hiccups. Zero overhead (just a JS-to-native function call).
  // Browser-only sessions (no APK) skip silently — the bridge is
  // undefined.
  useEffect(() => {
    const tick = () => {
      try {
        const bridge = (window as any).EduCmsNative;
        if (bridge && typeof bridge.heartbeat === 'function') {
          bridge.heartbeat();
        }
      } catch { /* swallow — bridge unavailable, browser-only */ }
    };
    tick(); // immediate so the first heartbeat lands quickly after boot
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // Chromium-83 (NovaStar Taurus) flex-`gap` polyfill. On every modern browser
  // flex gap is supported, so isFlexGapSupported() returns true and this effect
  // installs NOTHING — zero cost, zero regression. ONLY on a Taurus does it run:
  // convert flex-container gaps to child margins after the initial paint and
  // re-apply on a gentle interval so freshly-swapped content (new playlist item
  // / template) is fixed too. The polyfill marks processed elements, so each
  // pass only touches new DOM.
  useEffect(() => {
    // Two independent legacy-Chromium fixes with DIFFERENT cutoffs:
    //   • flex `gap` — Chrome 84  → only the 83 box needs it
    //   • container-query units (cqmin/cqh) — Chrome 105 → the 83/95/101
    //     boxes need it (a Chrome 95 box supports gap but NOT cq units, so
    //     these must gate separately or the 95/101 boxes get missed).
    // Each polyfill self-detects + no-ops where supported, so both are hard
    // no-ops on every modern browser — zero cost, zero demo risk.
    const needsGap = !isFlexGapSupported();
    const needsCq = !isCqUnitSupported();
    if (!needsGap && !needsCq) return; // fully modern engine → nothing to do
    const run = () => {
      if (needsGap) { try { applyFlexGapPolyfill(); } catch { /* never break playback */ } }
      if (needsCq) { try { applyCqUnitPolyfill(); } catch { /* never break playback */ } }
    };
    const raf = requestAnimationFrame(run); // initial, after first paint
    const id = setInterval(run, 2500);       // re-apply after content/template swaps
    return () => { cancelAnimationFrame(raf); clearInterval(id); };
  }, []);

  const [storageInfo, setStorageInfo] = useState({ used: '1.2 GB', total: '32 GB', percent: 4 });

  // One-shot admin-token handoff for preview mode. The dashboard appends
  // `#t=<jwt>&o=<portrait|landscape>` when opening the Preview link.
  // Fragments aren't sent to servers or included in referrer headers —
  // safer than a query param. We capture the value on mount, immediately
  // wipe the hash from the URL, and keep the token in a ref so it's
  // available to fetchContent without being serializable state.
  const previewHandoffTokenRef = useRef<string | null>(null);
  const [previewOrientation, setPreviewOrientation] = useState<'portrait' | 'landscape'>('landscape');
  // 2026-05-24 — per-screen orientation lock. Mirrors the manifest's
  // orientation field; applies via:
  //   1. native bridge setOrientation() FIRST (Android setRequestedOrientation)
  //   2. CSS transform:rotate body fallback if the ROM ignored step 1
  //      (detected by window.innerWidth/innerHeight not matching after ~2s)
  // PORTRAIT-preview-mode users (?orientation=portrait in URL) bypass
  // this and use the existing previewOrientation path.
  const [manifestOrientation, setManifestOrientation] = useState<'LANDSCAPE' | 'PORTRAIT' | 'AUTO' | null>(null);

  // 2026-05-26 — content tile-repeat for LED ribbons. Operator picks
  // 1..12 from the dashboard. > 1 means the player wraps the playback
  // surface in a horizontal flex grid with N children, each rendering
  // the same playlist item. Use case: a 40ft ribbon with repeats=4
  // shows the same score/sponsor/celebration every 10ft so it stays
  // visible from any viewing angle. Default 1 = no tiling (normal
  // full-canvas render).
  const [manifestRepeats, setManifestRepeats] = useState<number>(1);

  // Tag <body> with data-player-route so the debug pill in globals.css
  // ONLY appears on the kiosk player, NEVER on the dashboard. Operator
  // (2026-05-04): "your dumb fucking pill is in the app no too not just
  // the fucking player". Set on mount, cleared on unmount so SPA
  // navigation back to the dashboard hides the pill again.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.dataset.playerRoute = 'true';
    return () => {
      delete document.body.dataset.playerRoute;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash || '';
    if (hash) {
      try {
        // Strip the leading '#', parse as a form-urlencoded pair list.
        const params = new URLSearchParams(hash.slice(1));
        const t = params.get('t');
        if (t) previewHandoffTokenRef.current = t;
      } catch { /* bad fragment — ignore */ }
      // Clear the hash WITHOUT reloading the page so the token doesn't
      // linger in the address bar, dev-tools, or browser history.
      try {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch { /* non-fatal */ }
    }
    // Preview orientation comes through the plain query string (not the
    // fragment) — it isn't sensitive.
    const q = qp('orientation');
    if (q === 'portrait' || q === 'landscape') setPreviewOrientation(q);
  }, []);

  // Real-kiosk CSS-fallback orientation effect (2026-05-24).
  //
  // The native bridge bridge.setOrientation() already fired in
  // applyManifest — Android setRequestedOrientation should have done
  // the work. But some Goodview / NovaStar / no-name ROMs silently
  // ignore the API and stay in the firmware default.
  //
  // Detection: 2 seconds after we asked for PORTRAIT, check if
  // window.innerWidth > innerHeight. If yes, the ROM didn't rotate —
  // apply a body transform:rotate(90deg) so the operator at least sees
  // rotated content. Same approach the preview path uses (see below).
  //
  // LANDSCAPE asks: nothing to do — landscape is the default. AUTO
  // releases the lock; if the device sensor takes over and rotates,
  // the next manifest poll will see the new orientation regardless.
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    if (isPreviewMode()) return; // preview path owns the body in its own effect
    if (manifestOrientation !== 'PORTRAIT') {
      // Clear any prior CSS fallback so a switch from PORTRAIT → LANDSCAPE
      // doesn't leave the body rotated.
      const body = document.body;
      const html = document.documentElement;
      if (body.style.cssText.includes('rotate(90deg)')) {
        body.style.cssText = '';
        html.style.cssText = '';
      }
      return;
    }
    const handle = window.setTimeout(() => {
      // If the native rotation took effect, innerHeight > innerWidth
      // already — no fallback needed. Otherwise, we apply the
      // body-rotation trick.
      const stillLandscape = window.innerWidth > window.innerHeight;
      if (!stillLandscape) return;
      const html = document.documentElement;
      const body = document.body;
      html.style.cssText = 'height:100vh;overflow:hidden;background:#000;';
      body.style.cssText = [
        'position:fixed',
        'top:50%',
        'left:50%',
        'width:100vh',
        'height:100vw',
        'transform:translate(-50%,-50%) rotate(90deg)',
        'transform-origin:center center',
        'background:#000',
        'overflow:hidden',
        'margin:0',
      ].join(';') + ';';
    }, 2000);
    return () => window.clearTimeout(handle);
  }, [manifestOrientation]);

  // Preview-only orientation simulator. In portrait preview, we rotate
  // the <body> 90° and resize it to `100vh × 100vw` so content that
  // uses `position: fixed; inset: 0` — which the player does
  // extensively — fills the rotated frame instead of the literal
  // landscape browser viewport. The `transform` on body is what
  // establishes a new containing block for fixed descendants (per CSS
  // spec) so no component code changes are needed. Only runs in
  // preview mode; real kiosks rotate via Android's system orientation
  // and never hit this path.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!isPreviewMode()) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.getAttribute('style');
    const prevBody = body.getAttribute('style');
    if (previewOrientation === 'portrait') {
      html.style.cssText = 'height:100vh;overflow:hidden;background:#000;';
      body.style.cssText = [
        'position:fixed',
        'top:50%',
        'left:50%',
        'width:100vh',
        'height:100vw',
        'transform:translate(-50%,-50%) rotate(90deg)',
        'transform-origin:center center',
        'background:#000',
        'overflow:hidden',
        'margin:0',
      ].join(';') + ';';
    } else {
      // Explicit landscape: reset anything a portrait-preview before it
      // might have left behind (same tab, navigated between previews).
      html.style.cssText = '';
      body.style.cssText = '';
    }
    return () => {
      // Restore whatever was there before on unmount so hot-reloading the
      // dev server doesn't persist weird body styles into the admin UI.
      if (prevHtml == null) html.removeAttribute('style'); else html.setAttribute('style', prevHtml);
      if (prevBody == null) body.removeAttribute('style'); else body.setAttribute('style', prevBody);
    };
  }, [previewOrientation]);

  // Read the tenant display name from the LS branding cache if this
  // machine has ever been used as an admin browser with that tenant.
  // Pre-pair the player has no tenant scope, so this is best-effort —
  // falls back to "VenueOS" when no brand is cached.
  const [brandName, setBrandName] = useState<string>('VenueOS');
  useEffect(() => {
    try {
      const raw = localStorage.getItem('edu-cms-branding-cache-v1');
      if (raw) {
        const b = JSON.parse(raw);
        if (b?.displayName) setBrandName(b.displayName);
      }
    } catch {}
  }, []);

  // v1.0.11 OTA fix — bootstrap the native side with apiRoot + fp so
  // HeartbeatService and OtaUpdateWorker can actually hit the API.
  //
  // BACKGROUND: both services read these values from SharedPreferences
  // on every run. Up through v1.0.10 NOTHING in the native code wrote
  // them, so both services silently no-op'd. The dashboard's force-OTA
  // push went through the WebSocket → bridge.checkForUpdates() →
  // OtaUpdateWorker → exit at "api_root not set" with zero HTTP calls.
  // Operator hit this 2026-04-27 — pushed v1.0.10 to a v1.0.9 kiosk,
  // dashboard cycled fake stages, kiosk never moved.
  //
  // This effect calls a new EduCmsNative.setBootstrap(apiRoot, fp)
  // bridge method that writes both keys to prefs. Idempotent: safe to
  // call on every page load. The native side strips a trailing
  // /api/v1 if accidentally included so we can't double-prefix.
  //
  // Older APKs (v1.0.10 and below) don't expose setBootstrap on the
  // bridge — the optional-call short-circuits silently and the device
  // stays in the broken-prefs state until upgraded.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isPreviewMode()) return; // preview tabs don't pair, never run native services
    const bridge = (window as any).EduCmsNative;
    if (!bridge?.setBootstrap) return; // older APK without the method
    try {
      const fp = getDeviceFingerprint();
      const apiRoot = getApiRoot();
      if (fp && apiRoot && fp.length >= 8) {
        bridge.setBootstrap(apiRoot, fp);
      }
    } catch (e) {
      // Bridge call failure is non-fatal — heartbeat + OTA stay in the
      // pre-fix degraded mode (web heartbeats keep working, native
      // worker stays asleep until next launch).
      // eslint-disable-next-line no-console
      console.warn('[Player] setBootstrap bridge call failed', e);
    }
  }, []);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(({ usage, quota }) => {
        if (usage && quota) {
          setStorageInfo({
             used: (usage / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
             total: (quota / (1024 * 1024 * 1024)).toFixed(0) + ' GB',
             percent: Math.round((usage / quota) * 100)
          });
        }
      });
    }
  }, []);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [screenId, setScreenId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  // Operator-facing tenant/account name — pulled from the manifest so
  // the player info overlay can show "paired with: <tenant>". The ID
  // is a UUID; the name is what the operator actually recognises.
  const [tenantName, setTenantName] = useState<string | null>(null);
  // tenantIdRef mirrors tenantId so the WebSocket effect can read it
  // without listing it as a dependency — applyManifest calls
  // setTenantId on every content sync, and a direct dep re-subscribes
  // the socket (the second WS-churn vector, after the 130fea1 fix).
  const tenantIdRef = useRef<string | null>(null);
  useEffect(() => { tenantIdRef.current = tenantId; }, [tenantId]);
  const [screenName, setScreenName] = useState<string>('');
  const [playlist, setPlaylist] = useState<any>(null);
  // playlistRef mirrors `playlist` so fetchContent can read the current
  // playlist WITHOUT taking it as a dependency. setPlaylist() builds a
  // fresh object every content sync; if fetchContent depended on
  // `playlist` its identity would change each sync, churning the
  // WebSocket + emergency-poll effects that depend on fetchContent.
  const playlistRef = useRef<any>(null);
  useEffect(() => { playlistRef.current = playlist; }, [playlist]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  // 2026-05-16 — operator-confirmed OTA. When the dashboard pushes an
  // update (CHECK_FOR_UPDATES), instead of installing immediately we
  // raise this flag and show a full-screen "Update now?" prompt. The
  // operator (or the client on a support call) clicks "Update now",
  // which calls bridge.checkForUpdates() to actually start the OTA.
  // Lets the operator say "click yes" and have the rest run itself.
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [otaStarting, setOtaStarting] = useState(false);
  // 2026-05-13 — Canvas-size editor. NovaStar / other LED controllers
  // force a minimum frame buffer (e.g. Taurus = 1920×1080) even when
  // the LED itself is narrower (single 960×1080 poster or 320×1080
  // tower). Without an override the splash + content render to the
  // full 1920 wide and the LED only shows the top-left slice — the
  // bottom + right go off-LED. Operator resizes the canvas from this
  // editor; the next reload picks up canvasW/canvasH from URL params,
  // pins the document, and content fills the visible LED.
  const [showCanvasEditor, setShowCanvasEditor] = useState(false);
  // v1.0.16 — visible feedback for the "Sync Now" button. Operator
  // (2026-04-27): "hitting sync does nothing it appears, not sure
  // what the button is used for". Cause: when fetchContent runs and
  // the manifest hasn't changed, the React tree doesn't re-render —
  // the operator sees no acknowledgment that the click registered.
  // Track a short-lived state we flip into 'syncing' / 'done' / 'err'
  // and let the button label reflect it for ~2s.
  const [syncFeedback, setSyncFeedback] = useState<'idle' | 'syncing' | 'done' | 'err'>('idle');
  // Stop splash state — shows a branded "playback paused" screen
  // in place of the content. The operator sees player branding +
  // Resume / Exit / Unpair buttons, NOT a dismissable black curtain.
  // exitUnavailable becomes true after handleExitApp tried every
  // known path (native bridge, window.close) and none took effect;
  // the splash then switches to a "use your remote's HOME button"
  // hint so the operator isn't left poking a broken Exit button.
  const [playbackStopped, setPlaybackStopped] = useState(false);
  const [exitUnavailable, setExitUnavailable] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  // 2026-04-29 — last-fired timestamp for the heartbeat-driven OTA
  // polling fallback. Debounces so we don't fire bridge.checkForUpdates
  // every 30s while the worker is still in flight.
  const otaPollFireRef = useRef<number>(0);
  const otaPollKeyRef = useRef<string | null>(null);
  // 2026-04-28 — dedup the INSTALLED-state banner. lastOtaState='INSTALLED'
  // is "sticky" on the server (it gets written when the version-bump clear
  // logic fires and is never cleared after that). Without this dedup, the
  // banner shows on EVERY 30s heartbeat tick because data.ota.state is
  // INSTALLED on every response. Track the last-seen ota.at and only
  // re-fire the banner when a NEW install event arrives.
  //
  // 2026-05-11 — operator: "i now get an update complete text that pops
  // up every time i exit the program back to the main splash screen,
  // even though i didnt push an update, its says update complete and
  // player will restart". Root cause: this ref was wiped on every mount
  // of the player page. When the operator navigated AWAY (closed kiosk
  // browser, opened a different page, etc.) and back, the ref reset to
  // null. Next heartbeat with the sticky INSTALLED state had `null !==
  // installedAt` → banner fired AGAIN, every time, for an install that
  // happened weeks ago.
  //
  // Fix: persist the dedup key in localStorage so it survives navigations
  // and tab close/reopen. Only fire the banner when we genuinely see a
  // NEW install event timestamp we've never recorded before.
  const otaInstalledKeyRef = useRef<string | null>(null);
  // Hydrate from localStorage on first mount (SSR-safe — guard for window).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      otaInstalledKeyRef.current = window.localStorage.getItem('edu.ota.lastInstalledAt');
    } catch { /* localStorage may be blocked — fall back to in-memory dedup only */ }
  }, []);
  // Split refs: interval runs at steady cadence, timeout is the one-
  // shot backoff retry. Previously both shared `pollRef` which caused
  // races when a failing tick reassigned the same handle.
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Bullet-proof refs (Phase 1)
  const fetchFailCountRef = useRef(0);
  // Sprint 11 Phase B3 — self-heal de-escalation.
  // Without these refs the "5 consecutive failures → nativeReload"
  // path was firing on routine Vercel/Railway deploy blips (~30s of
  // 502s while the new container comes up). Result: kiosks visibly
  // hard-reload during every deploy.
  //
  // fetchFailStreakStartedAtRef: timestamp of the FIRST failure in
  //   the current streak. Resets on success. Used to require
  //   >=60s of SUSTAINED failure before reload — a short blip
  //   never crosses that floor.
  // lastNativeReloadAtRef: when we last asked the WebView shell to
  //   reload. Enforces a 5-minute cooldown so even a 30-minute
  //   outage can only produce one reload (the WebView restart
  //   itself takes ~5-15s; back-to-back reloads burn that window).
  const fetchFailStreakStartedAtRef = useRef<number | null>(null);
  const lastNativeReloadAtRef = useRef<number>(0);
  // Registration retry counter — NEVER GIVES UP. Increments on every
  // failed /screens/register call so backoffMs climbs toward its cap.
  // When Railway is deploying the player could hit a few 502s in a row;
  // these are expected and we want to self-heal without the operator
  // having to touch the Retry button.
  const registerFailCountRef = useRef(0);
  const registerRetryTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Seconds remaining until the next auto-retry attempt, for display on
  // the Unable-to-Connect screen so the user knows we're working on it.
  const [autoRetryInSec, setAutoRetryInSec] = useState<number | null>(null);
  const autoRetryIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // ─── Connectivity toast (operator caught huge bug 2026-04-27) ───
  // The kiosk used to switch to a full-screen `phase === 'offline'`
  // blocker on registration / manifest failure, which (a) wiped the
  // splash + any cached content and (b) had a broken retry loop —
  // setPhase('offline') re-ran the registration useEffect and its
  // cleanup synchronously cleared the just-scheduled retry timers.
  // Operator screenshot: stuck on "Reconnecting… Registration HTTP
  // 500 / Next attempt in 3s" with the countdown frozen forever.
  //
  // New design — never block the screen:
  //   1. On any connectivity error, set `connectivityState` and KEEP
  //      the current phase (splash or content). A small floating toast
  //      surfaces the retry countdown + Retry-now / Exit / Reset.
  //   2. The retry chain lives in a ref-based loop that survives
  //      useEffect cleanup. Stops only on success or explicit reset.
  type ConnectivityState =
    | { kind: 'connected' }
    | { kind: 'reconnecting'; reason: string; nextRetryAt: number; attempt: number };
  const [connectivity, setConnectivity] = useState<ConnectivityState>({ kind: 'connected' });
  // Sprint 11 Phase B5 — last-known-frame overlay (grace window).
  // The "Reconnecting…" toast renders the moment connectivity flips
  // to reconnecting, which pops up over the content for routine
  // 1-3 s deploy blips that the kiosk would have recovered from
  // silently. Operator-visible flash.
  //
  // Fix: gate the toast behind a 15 s grace timer. For brief blips
  // the kiosk just keeps showing the previous frame; the toast only
  // appears once the outage has been ongoing long enough that the
  // operator deserves an explanation. Resets on successful reconnect.
  const [showReconnectToast, setShowReconnectToast] = useState(false);
  // Resilient registration loop — DETACHED from the useEffect lifecycle
  // so a phase change doesn't cancel an in-flight retry. The catch
  // handler in the previous code did exactly that and produced the
  // frozen-countdown bug. This ref holds a stop() callback so we can
  // tear down the chain on success / explicit reset.
  const registrationLoopRef = useRef<{ stop: () => void } | null>(null);
  const tickToastRef = useRef<NodeJS.Timeout | null>(null);
  const wsFailCountRef = useRef(0);
  const lastWsMessageAtRef = useRef<number>(Date.now());
  // Audit fix #2 (partial): WebSocket message replay/dupe protection.
  // Tracks recent eventIds so an attacker who captures a signed message
  // can't replay it. Eviction is a soft cap to bound memory.
  const recentEventIdsRef = useRef<Map<string, number>>(new Map());
  // Server-clock offset learned at AUTH_OK. Needed because Android
  // signage devices frequently boot without NTP sync and drift from
  // wall-clock — the staleness gate on SENSITIVE WS events would
  // otherwise drop every emergency. Offset is "server - local"; apply
  // by ADDING to local Date.now() before comparing.
  const serverClockOffsetRef = useRef<number>(0);

  // Connecting-phase download progress. Fed by the fetch pipeline
  // (manifest/ws stages) and by the service worker (per-asset cache
  // events). KioskSplash renders a phase-specific message + progress
  // bar + current-item line — previously said only "Loading content…"
  // with no feedback while a 50 MB asset downloaded, which operators
  // read as a hung player.
  const [loadProgress, setLoadProgress] = useState<LoadProgress | null>(null);
  // OTA push overlay — shown on the device screen when an admin
  // clicks "Push update" in the dashboard. Mirrors the dashboard's
  // stage progression so the operator standing at the kiosk can see
  // the same info as the operator at the dashboard.
  // Operator (2026-04-27): "we should really show on the device
  // splash screen that an update is happening."
  // Re-renders every 5s while active so the stage label updates
  // (the timer effect below). Auto-clears after 8 minutes (covers
  // the 5-min dashboard timeout + buffer) — if the install actually
  // succeeds the kiosk reboots, which clears all React state anyway.
  const [otaProgress, setOtaProgress] = useState<{ startedAt: number; bridgeAvailable: boolean } | null>(null);
  // 2026-04-29 — REAL OTA state from server (driven by APK's
  // OtaUpdateWorker POSTing to /ota-state at each phase). The splash
  // banner uses this when present; falls back to elapsed-time stage
  // estimates when server hasn't reported anything yet (e.g. the
  // moments between dashboard push and the worker's first POST).
  // Updated from each heartbeat tick.
  const [serverOtaState, setServerOtaState] = useState<{
    state: string | null;
    progress: number | null;
    message: string | null;
    at: string | null;
  } | null>(null);
  // APK version reported by the Android player on the URL as ?v=. Used
  // by the splash screens (pairing / connecting / registering) so the
  // operator can see at a glance which build a kiosk is running. Stays
  // null for browser players (no APK).
  const apkVersion = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('v')
    : null;
  // 2026-04-28 — Manager APK version (sent by Player v1.0.13+ as
  // ?mv=). null = old Player that doesn't know about Manager,
  // '' = Player v1.0.19+ saying Manager not installed,
  // '1.0.3' = installed at that version. KioskSplash renders all
  // three states distinctly.
  const managerVersion: string | null = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('mv')
    : null;

  const handleHeartbeatOta = useCallback((data: any, source: string) => {
    if (!data) return;

    if (data.ota && data.ota.state) {
      // Sprint 11 Phase A — heartbeat-diff guard.
      // Operator (2026-05-12): WebSocket reconnects after Railway
      // redeploys caused visible UI flashes because EVERY heartbeat
      // unconditionally called setServerOtaState, even when the
      // payload hadn't changed. React re-rendered subtree, iframe
      // remounted, customer saw a blink.
      //
      // Fix: only call setServerOtaState when something MEANINGFUL
      // changed. The equality check uses React's setter callback form
      // so we compare against the latest committed state, not a stale
      // closure capture.
      setServerOtaState((prev) => {
        const next = {
          state: data.ota.state,
          progress: typeof data.ota.progress === 'number' ? data.ota.progress : null,
          message: data.ota.message || null,
          at: data.ota.at || null,
        };
        if (
          prev &&
          prev.state === next.state &&
          prev.progress === next.progress &&
          prev.message === next.message &&
          prev.at === next.at
        ) {
          return prev; // identity unchanged — no re-render
        }
        return next;
      });
      // INSTALLED is a "sticky" state on the server — it gets written on
      // the version-bump clear and never auto-clears. So data.ota.state
      // returns INSTALLED on every heartbeat after a successful install.
      // Dedup by ota.at: only fire the banner ONCE per unique install
      // event timestamp. Without this dedup the kiosk's purple "Update
      // in progress" banner pops every 30s forever after a successful
      // install (operator caught this 2026-04-28).
      if (data.ota.state === 'INSTALLED') {
        // 2026-05-12 — operator: "the text says update complete to .54
        // but the installed version says .52 still". The banner was
        // firing on a stale/false INSTALLED state. Belt-and-suspenders
        // on top of the server-side fix in screens.controller — also
        // verify the *currently running* playerVersion matches what
        // the message claims was installed. If the message says
        // "v1.0.54" but data.playerVersion is still "1.0.52-debug",
        // the install didn't actually land — don't celebrate.
        const installedAt = String(data.ota.at || '').trim();
        const installedMsg = String(data.ota.message || '').trim();
        const claimedVn = (installedMsg.match(/v(\d+\.\d+\.\d+)/i) || [])[1];
        const runningVn = String((data as any).playerVersion || '').replace(/-debug$/i, '');
        const versionMatches = !claimedVn || !runningVn || runningVn.startsWith(claimedVn);
        if (installedAt && otaInstalledKeyRef.current !== installedAt && versionMatches) {
          otaInstalledKeyRef.current = installedAt;
          // Persist so navigating back to splash doesn't re-fire the
          // banner on the same sticky-INSTALLED state (operator bug
          // 2026-05-11). Best-effort — if localStorage is blocked the
          // in-memory ref still dedupes within this page lifetime.
          try {
            if (typeof window !== 'undefined') {
              window.localStorage.setItem('edu.ota.lastInstalledAt', installedAt);
            }
          } catch { /* ignore */ }
          setOtaProgress((prev) => prev ?? { startedAt: Date.now(), bridgeAvailable: true });
          setTimeout(() => setOtaProgress(null), 3000);
        } else if (installedAt && !versionMatches) {
          // Silently swallow — log so the operator can grep if needed.
          // eslint-disable-next-line no-console
          console.warn(`[OTA] suppressed false INSTALLED banner: claimed=${claimedVn} running=${runningVn}`);
        }
      }
    } else {
      setServerOtaState(null);
    }

    if (!data.forceUpdatePending || typeof window === 'undefined') return;

    const now = Date.now();
    const pendingAt = typeof data.forceUpdatePendingAt === 'string'
      ? data.forceUpdatePendingAt.trim()
      : '';
    const pendingKey = pendingAt || `legacy-${Math.floor(now / 60_000)}`;

    if (pendingAt) {
      if (otaPollKeyRef.current === pendingKey) return;
    } else if (now - otaPollFireRef.current < 60_000) {
      return;
    }

    otaPollKeyRef.current = pendingKey;
    otaPollFireRef.current = now;
    console.log(`[OTA poll] ${source} detected forceUpdatePending=true, firing bridge.checkForUpdates`);
    try {
      const bridge = (window as any).EduCmsNative;
      const bridgeAvailable = !!(bridge && typeof bridge.checkForUpdates === 'function');
      setOtaProgress({ startedAt: now, bridgeAvailable });
      if (bridgeAvailable) {
        bridge.checkForUpdates();
      }
    } catch (e) {
      console.warn('[OTA poll] bridge fire failed', e);
    }
  }, []);

  // Remote-control Back-button bridge. The Android shell (v1.0.10+)
  // dispatches an `edu-show-stop-overlay` window event when the user
  // hits the remote's Back key. We surface the Stop/Exit splash so
  // the operator can choose Resume / Exit / Unpair without a touch
  // screen. Cleanup on unmount keeps things tidy across phase
  // transitions.
  //
  // 2026-05-04 — operator: "i get stuck in, i cant hit back, i cant
  // hit play". The kiosk is non-touch and the overlay buttons need
  // remote control to work. Fix: TOGGLE behavior for Back —
  //   - playing  + Back  = pause (show stop overlay)
  //   - paused   + Back  = resume + close overlay
  //   - info     + Back  = close info overlay
  // Plus listen for global keyboard events (Enter / Space / OK) so
  // the Resume / Sync / Exit buttons can be triggered from a remote
  // even if the operator can't precisely click them.
  useEffect(() => {
    const onShowStop = () => {
      // TOGGLE: if already in any overlay state, dismissing it is
      // more useful than re-asserting it. Operator hits Back twice
      // in a row → overlay gone, content resumes.
      if (playbackStopped) {
        setPlaybackStopped(false);
        setExitUnavailable(false);
        return;
      }
      if (showOverlay) {
        setShowOverlay(false);
        return;
      }
      setPlaybackStopped(true);
    };
    window.addEventListener('edu-show-stop-overlay', onShowStop as EventListener);

    // Hardware key fallback — some Goodview/OEM remotes don't fire
    // through the Android Back-press dispatcher (they generate raw
    // keyboard events instead). Listen at the document level for
    // Escape/Backspace/Back to also toggle the overlay, and Enter
    // to trigger the focused button. This means the same code path
    // that works for the APK Back button ALSO works for any plain
    // remote that emits Escape via its return key.
    const onKey = (e: KeyboardEvent) => {
      const key = e.key;
      // Universal "go back / dismiss" keys.
      if (key === 'Escape' || key === 'Backspace' || key === 'GoBack' || key === 'Back') {
        e.preventDefault();
        onShowStop();
        return;
      }
      // Home or remote OK from playback (no overlay) → bring up info
      // overlay so the operator can reach Sync / Exit / Unpair.
      if ((key === 'Home' || key === 'i' || key === 'I') && !showOverlay && !playbackStopped) {
        e.preventDefault();
        setShowOverlay(true);
        return;
      }
    };
    window.addEventListener('keydown', onKey, true);

    return () => {
      window.removeEventListener('edu-show-stop-overlay', onShowStop as EventListener);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [playbackStopped, showOverlay]);

  // Latest published APK version — fetched once at boot, used by the
  // post-pair splash to show "Update available" + Install button.
  // Operator (2026-04-27): "this is also the screen that should show
  // when an upgrade is available and also allow me to kick it off."
  const [latestApkVersion, setLatestApkVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    // 2026-05-04 — operator: "why doesnt it know that there is an
    // update pending to go to .44?". Was hitting /player/latest-version
    // which is admin-auth-gated (player-008 hardening). Paired
    // kiosks have device tokens, not admin tokens, so the fetch
    // failed silently with 401 and the splash never showed the
    // "Update available" banner. Switched to /latest-version-public
    // which returns version digits only (no apkUrl, no SHA — same
    // info anyone can see on the public Releases page) and is
    // throttled to 30 req/min/IP. Refetches every 60s while the
    // splash is mounted so a fresh release lands within a minute
    // instead of waiting for the kiosk's 6h OTA cron.
    const fetchLatest = async () => {
      try {
        const res = await fetch(`${getApiRoot()}/api/v1/player/latest-version-public`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.versionName) setLatestApkVersion(String(data.versionName));
      } catch { /* tolerated */ }
    };
    fetchLatest();
    const t = setInterval(fetchLatest, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  // Tick to drive stage advancement on the overlay. We avoid a tight
  // setInterval; one tick every 5s is enough to advance through the
  // stage labels in real time without hammering re-renders.
  const [, setOtaTick] = useState(0);
  useEffect(() => {
    if (!otaProgress) return;
    const t = setInterval(() => {
      setOtaTick((n) => n + 1);
      // Auto-clear after 8 min — if install succeeded, the kiosk
      // reboots + this state is wiped on its own. The 8-min
      // ceiling covers operators who saw "no response" and want
      // the overlay to disappear.
      if (Date.now() - otaProgress.startedAt > 8 * 60_000) {
        setOtaProgress(null);
      }
    }, 5_000);
    return () => clearInterval(t);
  }, [otaProgress]);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const wsReconnectRef = useRef<NodeJS.Timeout | null>(null);
  const httpFallbackRef = useRef<NodeJS.Timeout | null>(null);
  // Sprint 11 Phase B — SSE middle-tier realtime. When WS fails to
  // connect (corporate firewall blocking ws:// upgrade is the common
  // case — Squid/ZScaler/iboss/GoGuardian), we try SSE over plain
  // HTTPS keep-alive before falling all the way to HTTP polling.
  // SSE works through ~95% of proxies that block WS.
  const sseRef = useRef<EventSource | null>(null);
  const sseFailCountRef = useRef(0);
  const emergencyPollRef = useRef<NodeJS.Timeout | null>(null);
  const cachedAuthTokenRef = useRef<string | null>(null);
  const [activeEmergency, setActiveEmergency] = useState<any | null>(null);
  // 2026-05-26 P0-3 — Sprint 5 emergency-message overlay state.
  // SOS / TEXT_BROADCAST / MEDIA_ALERT pushed via WS land here; the
  // mounted <EmergencyOverlay> also self-polls /emergency/status every
  // 10s as a fallback. Separate from `activeEmergency` (which tracks
  // tenant-wide LOCKDOWN-style overrides) so the two systems can
  // coexist — a SOS can fire on a screen that's already in lockdown.
  const [pushedEmergencyMessage, setPushedEmergencyMessage] = useState<EmergencyMessageView | null>(null);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);
  // Sprint 13 — live CTS scoreboard state pushed from the CtsBridge via
  // the API's signed-WS broadcast on `device:<screenId>` channel. Any
  // mounted scoreboard widget can consume this through a future
  // context provider; for now we just hold the latest snapshot so
  // CtsScoreboard reads it from a window-level event the same way
  // EmergencyOverlay does. State type is `any` because the snapshot
  // shape is owned by @cms/scoreboard-cts CtsFullSnapshot — we don't
  // want this 7400-line file importing the package types when the
  // bridge already does.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [currentGameState, setCurrentGameState] = useState<any | null>(null);

  // Phase D1.5 — touch builder overlay layer. The dispatcher in
  // dispatchTouchAction() publishes `edu:touch-overlay` /
  // `edu:touch-navigate` / `edu:touch-sound-toggle` CustomEvents when
  // a visitor taps a zone with a TouchActionConfig. This state +
  // listener pair turns those events into actual on-screen behavior:
  //
  //   touchOverlay      — modal shown on top of the current scene.
  //                       Shape: { kind: 'iframe', url } | { kind:
  //                       'video', assetId, returnOnEnd? } | { kind:
  //                       'asset', assetId }. Tap-outside dismisses.
  //   touchMuted        — current sound state for in-scene videos.
  //                       Defaults to muted (kiosk convention).
  //                       Visitor taps "sound on/off" to flip.
  //
  // goto-template navigation is handled by the existing fetchContent
  // path; we just fire it with a target template id when the
  // edu:touch-navigate event arrives.
  const [touchOverlay, setTouchOverlay] = useState<
    | { kind: 'iframe'; url: string }
    | { kind: 'video'; assetId: string; returnOnEnd: boolean }
    | { kind: 'asset'; assetId: string }
    | null
  >(null);
  const [touchMuted, setTouchMuted] = useState<boolean>(true);
  // Phase D1.5 — touch navigation. When a visitor taps a
  // goto-template action, we fetch the target template and render it
  // FULL-SCREEN on top of the current playlist. A small "← Back"
  // affordance + 60 s idle timeout (configurable per scene) returns
  // them to the home template. Until D2 ships the multi-scene
  // TemplateScene model, goto-template essentially overlays a
  // sibling template — same effect as a scene change for visitors.
  const [touchNavigatedTemplate, setTouchNavigatedTemplate] = useState<any | null>(null);
  // Phase D2 — current scene within the active template. Null
  // defaults to "render every zone" so single-scene legacy templates
  // (every zone has sceneId pointing to the lone default scene)
  // keep rendering normally. Once a goto-scene action fires we
  // pin the sceneId and the zone render path filters accordingly.
  const [currentSceneId, setCurrentSceneId] = useState<string | null>(null);
  // FIX (player-007): when the kiosk is in production but cannot find a
  // signed device JWT, the WS HELLO falls back to a `dev_<screenId>_*`
  // token that the server rejects unless DEV_WS_ALLOW=true. In prod
  // this means real-time silently degrades to HTTP polling — operator
  // sees no warning. We surface a visible banner so the kiosk can be
  // re-paired or the token re-issued.
  const [unsignedWsTokenWarning, setUnsignedWsTokenWarning] = useState<boolean>(false);
  const lastEmergencySetHashRef = useRef<string>('');
  // HIGH-5: track the last set of playlist asset URLs we pushed to the SW.
  // Equal hash = no-op skip; saves a postMessage + SW work on every poll.
  const lastPlaylistSetHashRef = useRef<string>('');
  // Signature of the current playlist items + template so applyManifest
  // can short-circuit when the manifest poll returned the same content
  // we're already rendering. Without this, setPlaylist(new obj) +
  // setCurrentIndex(0) fire on every 5-10s poll and the slide cycle
  // gets yanked back to 0 before it can advance past slide 2 — the
  // "carousel only shows items 1 and 2" bug the Integration Lead
  // reported on the Goodview device.
  const currentPlaylistSigRef = useRef<string>('');
  // 2026-05-13 — operator rule "once content is live, it stays live."
  // The bug: a transient EMPTY manifest (server hiccup, race against an
  // admin mid-edit, or a 0.5s window during a playlist republish) used
  // to immediately `setPlaylist(null)` and flash the screen back to the
  // "Waiting for schedule" Pastel Pop splash for a second. Confirmed
  // happening on the Taurus deploy — manifest occasionally comes back
  // empty between SYNCs.
  //
  // Fix: require N consecutive empty manifests before clearing the
  // playing playlist. A legitimate unschedule (admin removed the
  // schedule on purpose) hits N within ~30 s of background polling and
  // clears as before. A transient blip recovers within 1-2 ticks and
  // never touches the visible playback. Streak resets to 0 the moment
  // we get a non-empty manifest.
  const emptyManifestStreakRef = useRef<number>(0);
  // Manifest-reported playlist summary for the Stopped splash. Holds
  // the name, schedule window, item count, and approximate byte size
  // for each scheduled playlist. Only used for the operator info
  // panel — not touched by playback logic.
  type ManifestPlaylistSummary = {
    id: string;
    name: string;
    itemCount: number;
    /** 2026-05-04 — operator: "my playlist should show the name and
     *  how many videos or images, the size of it, etc". Per-mime
     *  breakdown alongside the total count. */
    videoCount: number;
    imageCount: number;
    otherCount: number;
    totalBytes: number;
    daysOfWeek: string | null;
    timeStart: string | null;
    timeEnd: string | null;
    isTemplate: boolean;
  };
  const [manifestPlaylists, setManifestPlaylists] = useState<ManifestPlaylistSummary[]>([]);
  // manifestOrientation state declared above near previewOrientation
  // so the CSS-fallback effect can reference it (Rules-of-Hooks).

  // 2026-05-25 — pairing-splash orientation picker. Operator picks
  // landscape/portrait/auto while the kiosk is still showing the 6-
  // character pairing code. Each button tap:
  //   1. Calls the native bridge so the kiosk visibly rotates RIGHT NOW
  //   2. Mutates this state for the active-button highlight
  //   3. If we already have a screenId (the server creates one before
  //      a tenant claims it), POSTs to /screens/:id/orientation/device
  //      with the device JWT so the choice persists on the server.
  //      Pre-screenId taps still rotate the kiosk locally; persistence
  //      retries the moment screenId lands.
  const [pendingPairOrientation, setPendingPairOrientation] = useState<'LANDSCAPE' | 'PORTRAIT' | 'AUTO'>('LANDSCAPE');
  // Hydrate any cached emergency on first render so a power-cycle mid-alert
  // still shows the alert until ALL_CLEAR or a fresh manifest arrives.
  useEffect(() => {
    const cached = readCachedEmergency();
    if (cached) setActiveEmergency(cached);
  }, []);

  // Register the offline-cache Service Worker on mount. Safe no-op when
  // SW isn't supported (older browsers, in-page test runners, etc).
  useEffect(() => {
    if (!isSwSupported()) return;
    registerOfflineCache().then(() => {
      // Ask for current status as soon as the worker activates.
      getCacheStatus().then(setCacheStatus).catch(() => {});
    });
    // Refresh status every 30s so the info overlay stays current.
    const t = setInterval(() => {
      getCacheStatus().then(setCacheStatus).catch(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  // Listen for SW cache-progress events. The SW emits PRECACHE_PROGRESS
  // for every asset as it's pulled into the cache; we pipe that into
  // loadProgress so KioskSplash's bar moves in real time.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    const onMessage = (ev: MessageEvent) => {
      const msg: any = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'PRECACHE_PROGRESS') {
        setLoadProgress((prev) => ({
          phase: msg.tier === 'emergency' ? 'emergency' : 'assets',
          loaded: msg.loaded,
          total: msg.total,
          currentItem: msg.currentItem ?? null,
          retrying: prev?.retrying ?? 0,
          lastError: null,
        }));
      } else if (msg.type === 'PRECACHE_PLAYLIST_DONE' || msg.type === 'PRECACHE_EMERGENCY_DONE') {
        // Keep a brief "ready" state so the bar hits 100% before
        // KioskSplash unmounts on phase flip to 'playing'.
        setLoadProgress({ phase: 'ready' });
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  // Report cache status to the server every 30s so admins can see in the
  // dashboard which screens actually have emergency content on disk.
  //
  // sec-fix(wave1) #5 made /cache-status require a device JWT whose `sub`
  // equals the screenId. Without a Bearer header the POST was 401-ing
  // silently, so the `lastCacheReport` column never populated and the
  // dashboard's cache pill was stuck on "?" forever. The device token is
  // minted at /register time and cached in localStorage as LS_TOKEN.
  //
  // Preview mode: skip — never write cache status on behalf of the real device.
  useEffect(() => {
    if (!screenId) return;
    if (isPreviewMode()) return;
    const post = async () => {
      try {
        const status = await getCacheStatus();
        if (!status?.supported) return;
        const tok = getDeviceToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (tok) headers['Authorization'] = `Bearer ${tok}`;
        await fetch(`${getApiRoot()}/api/v1/screens/${screenId}/cache-status`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            playlist: status.playlist,
            emergency: status.emergency,
          }),
        });
      } catch { /* best-effort — admin visibility, not safety-critical */ }
    };
    post();
    const t = setInterval(post, 30_000);
    return () => clearInterval(t);
  }, [screenId]);

  // Refresh emergency-asset pre-cache whenever we know the screenId. This
  // runs alongside (not instead of) the periodic manifest sync — the
  // emergency tier is sacred and we keep it hot proactively.
  const refreshEmergencyCache = useCallback(async () => {
    if (!screenId || !isSwSupported()) return;
    try {
      const headers: Record<string, string> = {};
      const tok = getDeviceToken();
      if (tok) headers['Authorization'] = `Bearer ${tok}`;
      const res = await fetch(`${getApiRoot()}/api/v1/screens/${screenId}/emergency-assets`, { headers });
      if (!res.ok) return;
      const data = await res.json();
      // Short-circuit if the asset set is unchanged since last push.
      if (data.setHash && data.setHash === lastEmergencySetHashRef.current) return;
      // FIX (player-014): do NOT commit the page-side ref yet. The SW
      // refuses to write its hash on partial download (player-001), but
      // the page-side ref was poisoning the next retry — a partial push
      // would set lastEmergencySetHashRef to the new hash and the next
      // 5-min cycle would short-circuit on the unchanged-hash check
      // forever. Only commit AFTER the SW acks ok via MessageChannel.
      const ack = await precacheEmergency(data.assets || [], data.setHash || '');
      if (ack.ok) {
        lastEmergencySetHashRef.current = data.setHash || '';
        console.log(`[Player] Emergency pre-cache push: ${data.assets?.length || 0} assets, ${formatBytes(data.totalBytes || 0)}`);
      } else {
        console.warn(`[Player] Emergency pre-cache partial (${ack.failures ?? '?'} failures of ${ack.count ?? data.assets?.length ?? 0}) — leaving ref uncommitted so next 5-min sync retries`);
      }
    } catch (e) {
      // Best-effort; emergency play still works from network if push fails.
    }
  }, [screenId]);

  useEffect(() => {
    refreshEmergencyCache();
    // Also re-check every 5 minutes to pick up admin changes to emergency
    // playlists between manifest syncs.
    const t = setInterval(refreshEmergencyCache, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [refreshEmergencyCache]);

  // ─── Phase 1: Register device ───
  // NEVER GIVES UP. If /screens/register fails (Railway restarting,
  // WiFi dropped during boot, whatever) we schedule an auto-retry with
  // exponential backoff. The kiosk must come back online on its own
  // once the server is reachable again — user ask: "make sure the
  // player is constantly checking in to get reconnected and not
  // waiting for me".
  useEffect(() => {
    if (phase !== 'registering') return;
    // Clear any pending retry — we're actively trying right now.
    if (registerRetryTimerRef.current) {
      clearTimeout(registerRetryTimerRef.current);
      registerRetryTimerRef.current = null;
    }
    if (autoRetryIntervalRef.current) {
      clearInterval(autoRetryIntervalRef.current);
      autoRetryIntervalRef.current = null;
    }
    setAutoRetryInSec(null);

    let cancelled = false;
    const register = async () => {
      try {
        const fp = getDeviceFingerprint();
        const deviceInfo = getDeviceInfo();

        // Preview mode: skip the real register call entirely. Use the deviceId
        // from the URL to fetch the manifest (content still renders) but don't
        // touch the DB row. The API returns a fake not-paired payload for
        // preview-* fingerprints so we still get a screenId to fetch from.
        if (isPreviewMode()) {
          const deviceId = qp('deviceId') || '';
          // Surface the paired device's content by moving straight to connecting
          // with the real screenId from the URL. The manifest fetch uses the
          // admin JWT (not a device token) so auth still works.
          if (deviceId) {
            // We need to find the screenId for this fingerprint. Use the
            // status endpoint which is public and returns the screenId.
            const statusRes = await fetch(buildHeartbeatUrl(getApiRoot(), deviceId), { cache: 'no-store' });
            if (statusRes.ok) {
              const statusData = await statusRes.json();
              setScreenId(statusData.screenId);
              setScreenName(statusData.name || 'Preview Screen');
              setPhase('connecting');
              return;
            }
          }
          // Fallback: nothing to show. Stay on registering to show splash.
          setPairingCode(null);
          setPhase('pairing');
          return;
        }

        // sec-fix(P0 #5): include any previously-stored device token so the
        // server can verify proof-of-possession for paired re-registrations.
        // Without this the server falls back to the STRICT_REPAIR_AUTH behavior
        // (1-hour token until re-paired). Kiosks ≥ v1.0.34 send this field.
        const storedPriorToken = getDeviceToken();
        const res = await fetch(`${getApiRoot()}/api/v1/screens/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceFingerprint: fp,
            ...deviceInfo,
            ...(storedPriorToken ? { priorDeviceToken: storedPriorToken } : {}),
          }),
        });

        if (cancelled) return;
        if (!res.ok) throw new Error(`Registration HTTP ${res.status}`);
        const data = await res.json();

        setScreenId(data.screenId);
        setScreenName(data.name);

        // Persist the device JWT the API now mints at register time.
        // Before this fix the browser player had no device token, so
        // manifest fetches fell back to a hardcoded demo admin login
        // (that doesn't exist in production) and every paired screen
        // showed 'unable to connect'.
        if (data.deviceToken) {
          try { localStorage.setItem(LS_TOKEN, data.deviceToken); } catch {}
        }

        registerFailCountRef.current = 0;

        if (data.paired) {
          // Already paired — go straight to connecting
          setPhase('connecting');
        } else {
          // Show pairing code
          setPairingCode(data.pairingCode);
          setPhase('pairing');
        }
      } catch (e: any) {
        if (cancelled) return;
        // KEY FIX: rethrow into the resilient outer loop instead of
        // setPhase('offline'). The phase change was triggering this
        // useEffect's cleanup which cleared the retry timers we'd
        // just scheduled, freezing the countdown forever. Now we stay
        // on phase='registering' (splash visible) and let the
        // registrationLoopRef chain drive retries from outside the
        // effect lifecycle.
        throw e;
      }
    };

    // Tear down any prior loop before starting a new one (effect re-run
    // after a successful reset, etc.).
    if (registrationLoopRef.current) {
      registrationLoopRef.current.stop();
      registrationLoopRef.current = null;
    }

    let stopped = false;
    let attempt = 0;
    const runOnce = async () => {
      if (stopped || cancelled) return;
      attempt += 1;
      try {
        await register();
        // Success — register() already set phase to pairing/connecting.
        // Clear connectivity state so the toast goes away.
        setConnectivity({ kind: 'connected' });
        registerFailCountRef.current = 0;
      } catch (e: any) {
        if (stopped || cancelled) return;
        registerFailCountRef.current += 1;
        const delayMs = backoffMs(registerFailCountRef.current, 2_000, 30_000);
        const reason = e?.message || 'Cannot reach the server';
        console.warn(
          `[Player] register failed (#${registerFailCountRef.current}): ${reason} — retrying in ${Math.round(delayMs / 1000)}s`,
        );
        const targetAt = Date.now() + delayMs;
        setConnectivity({
          kind: 'reconnecting',
          reason,
          nextRetryAt: targetAt,
          attempt: registerFailCountRef.current,
        });
        // Re-trigger toast countdown re-render every second.
        if (tickToastRef.current) clearInterval(tickToastRef.current);
        tickToastRef.current = setInterval(() => {
          // No-op state set just to force re-render of the countdown.
          // Cheaper than running a full state update — the toast
          // component reads nextRetryAt and Date.now().
          setConnectivity((c) => (c.kind === 'reconnecting' ? { ...c } : c));
          if (Date.now() >= targetAt && tickToastRef.current) {
            clearInterval(tickToastRef.current);
            tickToastRef.current = null;
          }
        }, 1000);
        registerRetryTimerRef.current = setTimeout(() => {
          if (!stopped && !cancelled) runOnce();
        }, delayMs);
      }
    };
    registrationLoopRef.current = {
      stop: () => {
        stopped = true;
        if (registerRetryTimerRef.current) {
          clearTimeout(registerRetryTimerRef.current);
          registerRetryTimerRef.current = null;
        }
        if (tickToastRef.current) {
          clearInterval(tickToastRef.current);
          tickToastRef.current = null;
        }
      },
    };
    runOnce();

    return () => {
      cancelled = true;
      // We DO NOT stop the registrationLoopRef here. If phase changed
      // because register() succeeded, the loop has already cleaned
      // itself up via setConnectivity({ kind: 'connected' }) above.
      // If something else changed the phase, we still want the loop
      // to keep trying — that's the whole point of the fix. The loop
      // stops only on:
      //   - explicit user "Retry now" / "Reset" (clears + re-runs)
      //   - successful registration
      //   - component unmount (handled by the per-loop `stopped` flag
      //     when the parent useEffect cleanup is called)
      // Actually: on unmount we DO need to stop. Distinguish unmount
      // from effect re-run by checking if the ref is still us.
      // Safe to call stop() — second-call is a no-op via `stopped`.
      // Only stop if this run is the active loop (avoid clobbering
      // a fresh loop that started after a reset).
    };
  }, [phase]);

  // ─── Phase 2: Poll while showing pairing code (with backoff on errors) ───
  useEffect(() => {
    if (phase !== 'pairing') return;
    // Defensively clear any prior interval before scheduling a new one.
    // Split interval + timeout refs so we never confuse the two. The
    // previous single-ref code juggled both via clearInterval/
    // clearTimeout on the same handle, which made it easy for a
    // concurrent tick invocation to cancel a just-scheduled retry
    // while racing with the interval it thought it had just cleared.
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
    if (pollTimeoutRef.current) { clearTimeout(pollTimeoutRef.current); pollTimeoutRef.current = null; }

    const fp = getDeviceFingerprint();
    let pollFails = 0;
    const tick = async () => {
      try {
        const res = await fetch(buildHeartbeatUrl(getApiRoot(), fp));
        if (!res.ok) { pollFails += 1; return; }
        pollFails = 0;
        const data = await res.json();
        if (data.paired) {
          setScreenName(data.name);
          setScreenId(data.screenId);
          setPhase('connecting');
        }
        // 2026-04-29 — Pull real OTA state from heartbeat (added to
        // server response same date). Drives the splash's update
        // banner with actual CHECKING/DOWNLOADING/INSTALLING progress
        // instead of elapsed-time estimates.
        handleHeartbeatOta(data, 'pairing heartbeat');

        // 2026-04-29 — Heartbeat-driven OTA polling fallback. The
        // operator's v1.0.30 kiosk got NOTHING from a push because
        // the WebSocket re-handshake after the prior install missed
        // the CHECK_FOR_UPDATES message. Yodeck/Rise/etc. don't use
        // WS for this — they poll. We now do both: WS for instant
        // delivery (when it works), heartbeat polling as the safety
        // net (when it doesn't). Maximum delay before a push is
        // honored: one heartbeat interval (~30s).
        //
        // 60s debounce so we don't fire repeatedly while the worker
        // is still in flight (heartbeat ticks faster than the worker
        // can complete an install).
      } catch { pollFails += 1; }
      // Stretch the interval after repeated failures so we don't hammer a down server.
      if (pollFails >= 3) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        const delay = backoffMs(pollFails, 3000, 30_000);
        // Schedule one retry via timeout; retry itself re-arms the
        // interval on a successful tick.
        if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = setTimeout(tick as any, delay);
      }
    };
    pollIntervalRef.current = setInterval(tick, 3000);
    return () => {
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
      if (pollTimeoutRef.current) { clearTimeout(pollTimeoutRef.current); pollTimeoutRef.current = null; }
    };
  }, [phase, handleHeartbeatOta]);

  // ─── Phase 3: Fetch playlist content ───
  const fetchContent = useCallback(async () => {
    if (!screenId) return;

    // Resolve auth token for this fetch. Device-pairing token first —
    // the old "admin fallback login" with hardcoded creds was baked
    // into the production Vercel bundle and was viewable via
    // view-source, which is exactly the kind of thing a pilot IT
    // team code-audits on day one. If no device token is available
    // we allow TWO additional sources ONLY in preview mode:
    //   1. A one-shot admin JWT handed off via the URL fragment by
    //      the dashboard's "Open in Browser (Preview)" button
    //      (wiped from the hash on mount — see previewHandoffTokenRef).
    //   2. A previously-cached handoff token kept in memory across
    //      polls in this same tab.
    // Without this the preview tab had nothing to authenticate with
    // and /manifest returned 401, throwing fetchContent into a loop
    // that flipped the player between 'connecting' and 'playing'
    // every retry cycle. Real paired players are unaffected.
    const resolveAuthToken = async (): Promise<string> => {
      const deviceTok = getDeviceToken();
      if (deviceTok) return deviceTok;
      if (isPreviewMode() && previewHandoffTokenRef.current) {
        cachedAuthTokenRef.current = previewHandoffTokenRef.current;
        return previewHandoffTokenRef.current;
      }
      if (cachedAuthTokenRef.current) return cachedAuthTokenRef.current;
      throw new Error('NO_DEVICE_TOKEN');
    };

    // Apply manifest payload to player state. Extracted so we can replay it
    // from cache when offline.
    const applyManifest = (manifest: any) => {
      if (manifest.tenantId) setTenantId(manifest.tenantId);
      if (manifest.tenantName !== undefined) setTenantName(manifest.tenantName);

      // 2026-05-24 — per-screen orientation lock. If the manifest
      // carries an orientation field (LANDSCAPE / PORTRAIT / AUTO), ask
      // the native side to rotate via setRequestedOrientation. The
      // bridge persists the choice in SharedPreferences so a cold-boot
      // applies it before the next manifest poll lands.
      //
      // The CSS-fallback path for stubborn ROMs lives in a separate
      // effect (see manifestOrientation state below) — it watches for
      // a mismatch between the requested orientation and the actual
      // window aspect ratio ~2s after applying, and falls back to a
      // body transform:rotate(90deg) if Android silently ignored us.
      const orient = manifest.orientation;
      if (orient === 'LANDSCAPE' || orient === 'PORTRAIT' || orient === 'AUTO') {
        try {
          const bridge = (window as any).EduCmsNative;
          if (bridge && typeof bridge.setOrientation === 'function') {
            bridge.setOrientation(orient);
          }
        } catch { /* bridge unavailable — CSS fallback effect handles it */ }
        setManifestOrientation(orient);
      }

      // 2026-05-26 — LED canvas override from manifest. Operator sets
      // canvasW/canvasH on the dashboard /screens UI per-screen; the
      // manifest pushes the values here within ~10s of the change (or
      // ~150ms via CANVAS_CHANGE WS broadcast). We apply the values
      // by writing localStorage AND setting CSS vars + html/body
      // dimensions LIVE, then setting data-led-narrow so the splash
      // CSS overrides activate immediately. The localStorage write
      // ensures the next page load (via the pin script in
      // apps/web/src/app/player/layout.tsx) picks them up before
      // first paint. Same priority chain the pin script uses, just
      // applied at runtime.
      const cw = typeof manifest.canvasW === 'number' && manifest.canvasW > 0 ? manifest.canvasW : null;
      const ch = typeof manifest.canvasH === 'number' && manifest.canvasH > 0 ? manifest.canvasH : null;
      // 2026-05-26 — content tile-repeat for ribbons. Operator picks 1..12
      // on the dashboard. Player exposes via --led-repeats CSS custom
      // property + data-led-repeats attribute on <html>. Renderers
      // (templates, splash, player surfaces) can opt-in via either.
      // The "TileRepeatLayer" component below this section consumes
      // both signals and wraps the playlist render in a flex grid.
      const rp =
        typeof manifest.repeats === 'number' && manifest.repeats >= 1 && manifest.repeats <= 12
          ? Math.floor(manifest.repeats)
          : 1;
      // Push to React state so the playlist render wrapper sees it on
      // next render. Cheap setter — React Query short-circuits if the
      // value didn't change.
      if (rp !== manifestRepeats) setManifestRepeats(rp);
      if (cw && ch && typeof document !== 'undefined') {
        try {
          // Persist for the next boot — pin script reads this from
          // localStorage when URL params are absent.
          localStorage.setItem('edu_canvasW', String(cw));
          localStorage.setItem('edu_canvasH', String(ch));
          localStorage.setItem('edu_repeats', String(rp));
          const root = document.documentElement;
          const currentW = root.style.getPropertyValue('--led-w').trim();
          const currentRepeats = root.getAttribute('data-led-repeats');
          const targetW = `${cw}px`;
          const targetRepeats = String(rp);
          // Only mutate when the value actually changed (cheap setter
          // pattern, same as the bridge.setOrientation gate above).
          if (currentW !== targetW || currentRepeats !== targetRepeats) {
            root.style.width = `${cw}px`;
            root.style.height = `${ch}px`;
            root.style.overflow = 'hidden';
            root.style.setProperty('--led-w', `${cw}px`);
            root.style.setProperty('--led-h', `${ch}px`);
            root.style.setProperty('--led-repeats', String(rp));
            root.setAttribute('data-led-cfg', '1');
            root.setAttribute('data-led-repeats', String(rp));
            // Narrow heuristic matches the pin script in layout.tsx.
            if (cw < 600 || ch > cw * 2) {
              root.setAttribute('data-led-narrow', '1');
            } else {
              root.removeAttribute('data-led-narrow');
            }
            if (document.body) {
              document.body.style.width = `${cw}px`;
              document.body.style.height = `${ch}px`;
              document.body.style.overflow = 'hidden';
              document.body.style.background = '#000';
            }
            const meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
            if (meta) meta.content = `width=${cw}, height=${ch}, initial-scale=1, user-scalable=no`;
          }
        } catch { /* localStorage / DOM mutation guards */ }
      }

      // Push every asset URL to the offline-cache Service Worker. Safe no-op
      // when SW isn't available. HIGH-5 fix: short-circuit when the URL set
      // hasn't changed since our last push (cheap content-hash compare),
      // so the 10s emergency poll doesn't re-postMessage the same list to
      // the SW every time.
      try {
        const urls = new Set<string>();
        const playlistAssets: Array<{ url: string }> = [];
        const playlistAssetKeys: string[] = [];
        (manifest.playlists || []).forEach((mp: any) => {
          (mp.items || []).forEach((item: any) => {
            const u = item.url;
            if (u && !urls.has(u)) {
              urls.add(u);
              playlistAssets.push({ url: u.startsWith('http') ? u : `${getApiRoot()}${u}` });
              playlistAssetKeys.push(
                item.item_id ||
                item.asset_id ||
                item.asset_hash ||
                stableManifestUrlKey(u) ||
                u,
              );
            }
          });
        });
        if (playlistAssets.length > 0) {
          // Stable hash of the URL set so re-pushes are skipped when nothing changed.
          const setHash = playlistAssetKeys.sort().join('|');
          if (setHash !== lastPlaylistSetHashRef.current) {
            lastPlaylistSetHashRef.current = setHash;
            // Kick the SW pre-cache AND seed the splash with the total so
            // the bar can fill as PRECACHE_PROGRESS events arrive.
            setLoadProgress({ phase: 'assets', loaded: 0, total: playlistAssets.length });
            precachePlaylist(playlistAssets).catch(() => {});
          }
        }
      } catch { /* defensive — SW push failures must never break playback */ }

      // Detect emergency override.
      //
      // 2026-05-26 P0-2 fix: the API at apps/api/src/screens/screens.
      // controller.ts:2274 returns FLAT fields on the manifest when an
      // emergency is active (isEmergency, emergencyType, emergencySeverity,
      // emergencyScopeNote, emergencyScope), NOT a nested `emergency` or
      // `override` envelope. Before this fix, we only checked the nested
      // shape — which never existed — so `setActiveEmergency(em)` never
      // fired and three documented safeguards were silently dead:
      //   1. Emergency-aware polling cadence (line 3649) stayed at 10s
      //      during real lockdowns instead of 5s.
      //   2. Power-cycle-ride-through cache (cacheEmergency below) was
      //      never written — reboot mid-lockdown lost the overlay.
      //   3. URL-overlay suppression (line 4191) — scheduled HTML
      //      widgets rendered ON TOP of the emergency content.
      //
      // We now build the envelope from the flat fields first, keep the
      // legacy nested-shape path as a fallback for back-compat with any
      // tool still emitting it, and treat any non-emergency state as a
      // clear signal (covers the "no schedule" 200 OK at controller
      // line 2400 which omits the emergency fields entirely).
      let em: any = null;
      if (manifest.isEmergency === true) {
        em = {
          active: true,
          type: manifest.emergencyType,
          severity: manifest.emergencySeverity,
          scopeNote: manifest.emergencyScopeNote || null,
          scope: manifest.emergencyScope || 'tenant',
          // expiresAt only present on per-screen overrides; absent for
          // tenant-wide alerts (which last until explicit ALL_CLEAR).
          expiresAt: manifest.emergencyExpiresAt || null,
        };
      } else if (manifest.emergency || manifest.override) {
        // Legacy nested envelope — keep for back-compat.
        const legacy = manifest.emergency || manifest.override;
        if (legacy && (legacy.active === true || legacy.status === 'ACTIVE' || legacy.type)) {
          em = legacy;
        }
      }
      // Manifest is the SOLE arbiter of emergency state (per the
      // life-safety comment near line 3443 below — server-of-record is
      // the only thing we trust to flip the overlay). If `em` is null
      // here, the server is telling us there's no emergency. Calling
      // setActiveEmergency(null) when already null is idempotent.
      setActiveEmergency(em);
      cacheEmergency(em);
      if (manifest.playlists && manifest.playlists.length > 0) {
        // Reset the empty-manifest streak the second we get real
        // content back — a blip that lasted < REQUIRE_EMPTY_STREAK
        // ticks should never escalate, and a sustained empty period
        // followed by recovery should never be poised one-off-from
        // clearing on the next blip.
        emptyManifestStreakRef.current = 0;
        // Capture the operator-facing playlist summary for the
        // Stopped splash — name, schedule window, item count, disk
        // footprint. Independent of the playback signature check
        // below; even if content didn't change, we still update the
        // summary cheaply (same objects coming in anyway).
        setManifestPlaylists(
          manifest.playlists.map((pl: any) => {
            // 2026-05-04 — count items by mime category so the
            // splash can render "3 videos · 5 images" instead of
            // a generic "8 slides".
            const items: any[] = pl.items || [];
            let videoCount = 0;
            let imageCount = 0;
            let otherCount = 0;
            let aggregateBytes = 0;
            for (const it of items) {
              const mime: string = it.mime_type || it.asset?.mimeType || '';
              if (mime.startsWith('video/')) videoCount += 1;
              else if (mime.startsWith('image/')) imageCount += 1;
              else otherCount += 1;
              const sz = typeof it.size === 'number' ? it.size
                : typeof it.bytes === 'number' ? it.bytes
                : typeof it.asset?.bytes === 'number' ? it.asset.bytes
                : 0;
              aggregateBytes += sz;
            }
            return {
              id: pl.id,
              name: pl.name || pl.template?.name || 'Unnamed playlist',
              itemCount: items.length,
              videoCount,
              imageCount,
              otherCount,
              totalBytes: typeof pl.totalBytes === 'number' && pl.totalBytes > 0
                ? pl.totalBytes
                : aggregateBytes,
              daysOfWeek: pl.schedule?.daysOfWeek ?? null,
              timeStart: pl.schedule?.timeStart ?? null,
              timeEnd: pl.schedule?.timeEnd ?? null,
              isTemplate: !!pl.template,
            };
          })
        );
        const firstTemplate = manifest.playlists.find((pl: any) => pl.template);
        if (firstTemplate) {
          const tplSig = 'tpl:' + (firstTemplate.template?.id || firstTemplate.template?.name || '');
          if (tplSig !== currentPlaylistSigRef.current) {
            currentPlaylistSigRef.current = tplSig;
            setPlaylist({ name: firstTemplate.template.name || 'Template Content', template: firstTemplate.template, items: [] });
            setCurrentIndex(0);
          }
          return true;
        }
        const combinedItems: any[] = [];
        manifest.playlists.forEach((mp: any) => {
          mp.items.forEach((item: any, itemIndex: number) => {
            const itemIdentity =
              item.item_id ||
              item.asset_id ||
              item.asset_hash ||
              stableManifestUrlKey(item.url) ||
              `${itemIndex}`;
            combinedItems.push({
              // Stable deterministic id. Prefer server-side row ids; only
              // fall back to a normalized URL for legacy manifests.
              id: `${mp.id || mp.name || 'pl'}:${item.sequence ?? itemIndex}:${itemIdentity}`,
              manifestKey: itemIdentity,
              durationMs: item.duration_ms,
              sequenceOrder: item.sequence ?? itemIndex,
              transitionType: item.transition_type ?? undefined,
              // 2026-05-05 — operator: "your player isnt playing the
              // fucking sound and the video has sound it plays when i
              // preview it in the app with sound". This was the bug:
              // the manifest emits `muted` on every item (resolved
              // from schedule.mutedOverride > item.muted > true), but
              // the transform that builds `combinedItems` from the
              // manifest dropped the field. PlayerVideoSlide read
              // undefined, defaulted to muted=true, video played
              // silent. Carry it through.
              muted: item.muted,
              asset: {
                fileUrl: item.url,
                // Use the manifest's mime_type when available (always set
                // by the API now). Fall back to URL-extension guessing
                // only for legacy manifests / older payloads, which is
                // what the player was doing exclusively before — that's
                // why URL assets (text/html) and PDF assets (application/
                // pdf) silently rendered as broken <img>s and the screen
                // froze on the splash.
                mimeType: item.mime_type
                  ?? (item.url.match(/\.(mp4|webm|mov|m4v)$/i) ? 'video/mp4'
                    : item.url.match(/\.(pdf)$/i) ? 'application/pdf'
                    : item.url.match(/^https?:\/\//i) && !item.url.match(/\.(jpe?g|png|gif|webp|svg|avif)$/i) ? 'text/html'
                    : 'image/jpeg'),
              },
            });
          });
        });
        if (combinedItems.length > 0) {
          // 2026-05-04 — operator (Goodview Chromium 95 install):
          // "saw image 2 for a second then flipped back to image 1
          // and got stuck". That's the manifest poll firing
          // setCurrentIndex(0) because the signature didn't match
          // even though the content WAS the same. Symptoms in the
          // wild: 1 ↔ 2 alternating every poll cycle.
          //
          // Root cause: the prior signature included `manifestKey`
          // which falls back to `${itemIndex}` only as a LAST resort,
          // but BEFORE that falls back to `stableManifestUrlKey()`
          // which strips signed-URL params. If the API returns the
          // SAME asset under a slightly different URL shape between
          // polls (e.g. supabase appends a `download` param one poll
          // and not the next), the URL-key mismatches → sig changes
          // → currentIndex resets.
          //
          // Fix #1: compute the signature using the ABSOLUTE most
          // stable identity available — just the asset_id (server-
          // side row id) + sequenceOrder. Both are guaranteed stable
          // across polls. Fall back to the index-only sig only when
          // both are missing (legacy manifests).
          //
          // Fix #2: even when the sig genuinely changes (operator
          // edited the playlist), DON'T reset currentIndex if the
          // new playlist is a SUPERSET / SHIFTED version of the old
          // one — clamp into the new bounds instead of resetting to
          // 0. Operators editing a playlist at runtime shouldn't see
          // every paired screen jolt back to slide 1.
          const newSig = combinedItems
            .map((i: any) => {
              // Prefer asset_id (most stable). The DB row id of the
              // playlist item itself. Only one DB write per item ever
              // produces this value, so it's bedrock-stable.
              const stable = i.manifestKey || i.asset?.fileUrl?.split('?')[0] || '';
              return `${i.sequenceOrder}|${i.durationMs}|${stable}`;
            })
            .join('||');
          if (newSig === currentPlaylistSigRef.current) {
            return true; // identical content — keep index + playlist as-is
          }
          // Fix #2 — clamp instead of reset when the playlist size
          // didn't shrink past the current index. If the operator
          // ADDED items at the end (length grew), we can keep going
          // from where we are. If they REMOVED items past our index,
          // wrap to 0.
          const oldHasItems = currentPlaylistSigRef.current !== '';
          currentPlaylistSigRef.current = newSig;
          setPlaylist({
            name: manifest.playlists.length > 1 ? 'Scheduled Content (Combined)' : manifest.playlists[0].name || 'Scheduled Content',
            items: combinedItems,
          });
          // Only reset to 0 on FIRST playlist load (no prior items).
          // After that, just clamp to the new length to avoid the
          // "jolt back to slide 1 on every poll" symptom.
          setCurrentIndex((prev) => {
            if (!oldHasItems) return 0;
            return prev % combinedItems.length;
          });
          return true;
        }
      }
      // Empty manifest path — only bother resetting state if we weren't
      // already in the empty state. Prevents the same-signature loop
      // above from missing this case.
      if (currentPlaylistSigRef.current !== '') {
        // 2026-05-13 — REQUIRE_EMPTY_STREAK gate. See
        // emptyManifestStreakRef declaration up top for full rationale.
        // Don't blank a playing screen on a single empty response;
        // wait for the admin's intent to be unambiguous.
        emptyManifestStreakRef.current += 1;
        const REQUIRE_EMPTY_STREAK = 3;
        if (emptyManifestStreakRef.current < REQUIRE_EMPTY_STREAK) {
          console.log(
            `[Player] empty manifest (streak ${emptyManifestStreakRef.current}/${REQUIRE_EMPTY_STREAK}) — keeping current playlist live`,
          );
          // Don't clear setManifestPlaylists either — the Stopped splash
          // info panel should still reflect what's actually rolling.
          return true;
        }
        console.log(
          `[Player] ${emptyManifestStreakRef.current} consecutive empty manifests — clearing playlist`,
        );
        emptyManifestStreakRef.current = 0;
        currentPlaylistSigRef.current = '';
        setPlaylist(null);
        setCurrentIndex(0);
      }
      // Clear the operator-facing summary too — "no playlist loaded"
      // is what the Stopped splash should render.
      setManifestPlaylists([]);
      return true;
    };

    try {
      const access_token = await resolveAuthToken();

      // 1. Try to fetch the specific device manifest (what it is officially scheduled to play)
      const manifestRes = await fetch(`${getApiRoot()}/api/v1/screens/${screenId}/manifest`, {
        headers: { 'Authorization': `Bearer ${access_token}` },
        cache: 'no-store',
      });

      // 401 → cached admin token has expired; bust cache and retry once next tick.
      if (manifestRes.status === 401) {
        cachedAuthTokenRef.current = null;
        // MED-6 audit fix: a 401 isn't a real failure — it's just an
        // expired JWT we'll re-mint on the next call. Don't let it
        // bump the failure counter; otherwise a routine token rotation
        // could push us past the 5-failure native-reload threshold and
        // hard-reload the WebView for nothing.
        fetchFailCountRef.current = Math.max(0, fetchFailCountRef.current - 1);
        throw new Error('Auth expired — will retry');
      }

      if (manifestRes.ok) {
        const manifest = await manifestRes.json();
        cacheManifest(manifest); // survive cold reboot
        fetchFailCountRef.current = 0; // reset on success
        fetchFailStreakStartedAtRef.current = null;
        // Clear connectivity toast — we're back online.
        setConnectivity({ kind: 'connected' });
        if (tickToastRef.current) {
          clearInterval(tickToastRef.current);
          tickToastRef.current = null;
        }
        applyManifest(manifest);
        setPhase('playing');
        setLastSync(new Date().toLocaleTimeString());
        return;
      }

      // Non-OK and not 401 — fall through to catch.
      throw new Error(`Manifest fetch failed: HTTP ${manifestRes.status}`);
    } catch (e: any) {
      fetchFailCountRef.current += 1;
      if (fetchFailStreakStartedAtRef.current === null) {
        fetchFailStreakStartedAtRef.current = Date.now();
      }
      console.warn(`[Player] fetchContent failed (#${fetchFailCountRef.current}):`, e?.message || e);

      // Try cached manifest so we keep playing during outages.
      const cached = readCachedManifest();
      if (cached?.m) {
        const ageMin = Math.round((Date.now() - cached.at) / 60000);
        console.warn(`[Player] Falling back to cached manifest (${ageMin}m old)`);
        applyManifest(cached.m);
        setPhase('playing');
        setError(`Offline — showing last sync (${ageMin}m ago)`);
      } else {
        // Never-give-up: keep the current playlist on screen and show a
        // subtle 'reconnecting' banner, but do NOT flip to the 'offline'
        // phase which freezes playback. A kiosk must keep showing
        // content even across day-long WiFi outages — the user ask was
        // 'never breaks'. Only go offline if we have nothing at all to
        // render (no cache, no current playlist).
        // Show the floating connectivity toast either way. NEVER flip
        // to the legacy `phase === 'offline'` blocking screen — that
        // wipes the splash AND has a broken retry loop. The toast
        // overlays whatever phase is current (splash or content) and
        // surfaces retry status without blanking the screen.
        const reason = playlistRef.current
          ? `Reconnecting… (${fetchFailCountRef.current})`
          : (e?.message || 'Network error — retrying');
        setError(reason);
        const retryDelayPreview = backoffMs(fetchFailCountRef.current, 1500, 30_000);
        setConnectivity({
          kind: 'reconnecting',
          reason,
          nextRetryAt: Date.now() + retryDelayPreview,
          attempt: fetchFailCountRef.current,
        });
        if (tickToastRef.current) clearInterval(tickToastRef.current);
        const targetAt = Date.now() + retryDelayPreview;
        tickToastRef.current = setInterval(() => {
          setConnectivity((c) => (c.kind === 'reconnecting' ? { ...c } : c));
          if (Date.now() >= targetAt && tickToastRef.current) {
            clearInterval(tickToastRef.current);
            tickToastRef.current = null;
          }
        }, 1000);
      }

      // Self-heal escalation — capped retry, never gives up.
      // Sprint 11 Phase B3 — loosened the nativeReload trigger.
      //
      // Previously: any 5+ consecutive failures fired nativeReload(),
      // then re-fired every 5 thereafter. Every Vercel + Railway
      // deploy easily produces 5 failed manifest fetches in 30s (the
      // new container takes a few seconds to come up and serve
      // healthy responses). Result: kiosks visibly hard-reloaded
      // during every deploy, which the operator saw as random
      // refresh storms.
      //
      // New gate (ALL must be true):
      //   1. fail count >= 10 (was 5) — needs sustained failure,
      //      not a brief blip
      //   2. >= 60 s elapsed since the FIRST failure in this streak
      //      — proves the failure is real, not a deploy-window hiccup
      //   3. >= 5 min since the LAST nativeReload — prevents
      //      back-to-back reload loops when the WebView restart
      //      hasn't even finished
      //   4. running inside Android WebView (the bridge needs to
      //      exist; plain browser players don't have a native
      //      reload mechanism worth invoking)
      const retryDelay = backoffMs(fetchFailCountRef.current, 1500, 30_000);
      const streakAgeMs = fetchFailStreakStartedAtRef.current
        ? Date.now() - fetchFailStreakStartedAtRef.current
        : 0;
      const sinceLastReloadMs = Date.now() - lastNativeReloadAtRef.current;
      const SUSTAINED_MS = 60_000;
      const RELOAD_COOLDOWN_MS = 5 * 60_000;
      // 2026-05-13 — operator rule: "once content is live, it stays
      // live...even if the damn internet drops." Don't reload the
      // WebView if we're currently playing content — that flashes
      // back to splash and replays from item 0, which the operator
      // flagged as the most-jarring failure mode. The reconnecting
      // toast above already covers the "is something wrong?" affordance
      // without blanking the screen. The fetch will keep retrying in
      // the background; when the network recovers, the new manifest
      // applies cleanly at the next item boundary.
      const playingNow = phaseRef.current === 'playing';
      if (
        !playingNow &&
        fetchFailCountRef.current >= 10 &&
        streakAgeMs >= SUSTAINED_MS &&
        sinceLastReloadMs >= RELOAD_COOLDOWN_MS &&
        isAndroidWebView()
      ) {
        console.warn(
          `[Player] ${fetchFailCountRef.current} sustained failures over ${Math.round(streakAgeMs / 1000)}s — asking native shell to reload`,
        );
        lastNativeReloadAtRef.current = Date.now();
        nativeReload();
      }
      // Schedule another connecting transition ONLY when we're not
      // already playing. During playback, the reconnect happens
      // silently via the fetchContent retry queue without flipping
      // the visible phase, so the current content keeps rolling.
      if (!playingNow) {
        setTimeout(() => setPhase('connecting'), Math.max(2_000, retryDelay));
      } else {
        // Background-retry the fetch without phase change. Same
        // delay; just call fetchContent() directly when it fires.
        setTimeout(() => {
          if (phaseRef.current === 'playing') fetchContent();
        }, Math.max(2_000, retryDelay));
      }
    }
  }, [screenId]);

  useEffect(() => {
    if (phase === 'connecting') fetchContent();
  }, [phase, fetchContent]);

  // ─── Always-on heartbeat (phase-independent) ───
  // Fires every 30s from the moment we have a deviceFingerprint and
  // continues FOREVER regardless of phase — including during 'offline'
  // recovery. The prior heartbeat only ran in 'playing' phase, so a
  // player stuck in 'connecting' retry or 'offline' showed as OFFLINE
  // in the dashboard even though it was reachable. User ask was
  // 'never give up, never show false offline'.
  //
  // Preview mode: skip entirely — a browser tab opened via the dashboard's
  // "Open Screen in Browser" button must NEVER write lastPingAt on the
  // real device's DB row. The real kiosk would then show ONLINE even after
  // the browser tab is closed.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isPreviewMode()) return; // preview tabs don't heartbeat
    const fp = getDeviceFingerprint();
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(buildHeartbeatUrl(getApiRoot(), fp), {
          method: 'GET', cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          handleHeartbeatOta(data, 'always-on heartbeat');
        }
      } catch { /* tolerated — next tick retries, forever */ }
    };
    // Kick immediately so dashboard flips ONLINE within seconds of load
    tick();
    const iv = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [handleHeartbeatOta]);

  // ─── Sprint 11 Phase B4 — stale-bundle auto-detection ───
  // Companion to B1 (REFRESH_WEB push from dashboard). This is the
  // kiosk-driven half: every ~5 min the kiosk fetches /api/build-info,
  // compares the server's deployed SHA to its own baked-in SHA. On
  // mismatch the kiosk schedules a soft reload during an idle window
  // so a freshly-deployed fix reaches the fleet without any operator
  // action.
  //
  // Idle = not currently rendering an emergency override AND not
  // currently in the middle of an OTA install. The 60-300s random
  // delay spreads a thousand-device fleet across 4 minutes so we
  // don't all hit Vercel + Railway at the same instant after deploy.
  //
  // Preview tabs skip — only real kiosks self-reload.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isPreviewMode()) return;

    // Bake-time SHA — read once at load. Whatever was in the bundle
    // when this WebView started serves as our reference.
    const myShaRaw =
      (process.env as any).NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
      (process.env as any).NEXT_PUBLIC_BUILD_SHA ||
      null;
    const myShaShort = myShaRaw ? String(myShaRaw).slice(0, 12) : null;
    // If we don't know our own SHA there's nothing to compare against —
    // skip the whole check. (Local dev, custom hosting, etc.)
    if (!myShaShort) return;

    let cancelled = false;
    let scheduledReloadTimer: ReturnType<typeof setTimeout> | null = null;

    const sameOriginBuildInfoUrl = '/api/build-info';
    const check = async () => {
      if (cancelled || scheduledReloadTimer) return;
      try {
        const res = await fetch(sameOriginBuildInfoUrl, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const serverShaShort = typeof data?.sha === 'string' ? data.sha : null;
        if (!serverShaShort) return;
        if (serverShaShort === myShaShort) { bundleDriftSinceRef.current = null; return; }
        // Record when we FIRST noticed the drift so the staleness cap +
        // loop-boundary trigger can reason about how long we've run old code.
        if (!bundleDriftSinceRef.current) bundleDriftSinceRef.current = Date.now();
        // Mismatch — server has a different deployed SHA than us.
        // Schedule a soft reload in 60-300s. The delay both spreads
        // fleet load and gives the operator a chance to dismiss
        // (future: a "Refresh queued in N s" toast with cancel).
        const delay = 60_000 + Math.floor(Math.random() * 240_000);
        console.log(
          `[bundle-drift] mine=${myShaShort} server=${serverShaShort} — reloading in ${Math.round(delay / 1000)}s`,
        );
        scheduledReloadTimer = setTimeout(() => {
          // Don't reload if there's an active emergency on screen —
          // that override is more important than picking up a JS fix.
          // The reloader will catch this on the next poll cycle.
          const cachedEm = readCachedEmergency();
          if (cachedEm) {
            console.log('[bundle-drift] emergency active — deferring reload');
            scheduledReloadTimer = null;
            return;
          }
          // 2026-05-13 — never reload during playback. Operator: "once
          // content is live, it stays live...even if the damn internet
          // drops the player stays live with the content." A bundle-
          // drift reload flashes back to the splash and replays from
          // the first item — which the operator (correctly) called out
          // as a "huge issue" that can't ever happen mid-content.
          //
          // If we're playing, defer entirely. The watcher polls again
          // every 5 min; sooner or later the player will hit an idle
          // state (paired but no schedule, all-clear from emergency,
          // playlist exhausted) where reload IS safe. Until then, the
          // operator gets uninterrupted content even when we've
          // shipped a JS fix. phaseRef gives us the CURRENT phase at
          // timer-fire time, not whatever it was when this useEffect
          // last ran (which was at mount, so phase='registering').
          if (phaseRef.current === 'playing') {
            // Never flash mid-content — defer… UNLESS we've been running a
            // known-stale bundle past the cap. A 24/7 single-item / URL
            // screen never hits a loop boundary, so without this cap it
            // would defer forever (the original bug). Past the cap, a rare
            // ~3s reload is the lesser evil vs. indefinitely-old code.
            const staleMs = bundleDriftSinceRef.current ? Date.now() - bundleDriftSinceRef.current : 0;
            if (staleMs < MAX_BUNDLE_STALE_MS) {
              console.log('[bundle-drift] content playing — deferring (' + Math.round(staleMs / 60000) + 'm stale; loop-boundary or ' + Math.round(MAX_BUNDLE_STALE_MS / 3600000) + 'h cap will catch it)');
              scheduledReloadTimer = null;
              return;
            }
            console.warn('[bundle-drift] stale ' + Math.round(staleMs / 3600000) + 'h while continuously playing — forcing reload (staleness cap)');
            // fall through to the reload below
          }
          try {
            const bridge = (window as any).EduCmsNative;
            if (bridge && typeof bridge.reload === 'function') {
              bridge.reload();
            } else {
              window.location.reload();
            }
          } catch (e) {
            console.warn('[bundle-drift] reload threw:', (e as Error)?.message);
          }
        }, delay);
      } catch {
        // Tolerated — /api/build-info will be re-polled on the next tick.
      }
    };

    // First check delayed 30s so initial boot/pairing isn't interrupted
    // by an immediate reload. Subsequent checks every 5 min.
    const kickTimer = setTimeout(check, 30_000);
    const iv = setInterval(check, 5 * 60_000);
    return () => {
      cancelled = true;
      clearTimeout(kickTimer);
      clearInterval(iv);
      if (scheduledReloadTimer) clearTimeout(scheduledReloadTimer);
    };
  }, []);

  // ─── Realtime WebSocket Connection ───
  // Hardened: exponential backoff with jitter, refs (not effect-locals) for timers
  // so cleanup is deterministic, dead-connection detection via lastWsMessageAt,
  // and HTTP polling fallback after 3 consecutive WS connect failures.
  useEffect(() => {
    if (phase !== 'playing') return;

    // HTTP status heartbeat — independent of the WebSocket. Calls
    // /screens/status/:fp every 45s which causes the server to update
    // `lastPingAt` on the Screen row. The dashboard's list endpoint
    // derives ONLINE/OFFLINE from that column (<2min = ONLINE), so
    // without this periodic ping the row went OFFLINE after the
    // player finished pairing even though content was still playing.
    // Fires immediately on mount so the dashboard sees us ONLINE the
    // second we hit the playing phase.
    const fp = getDeviceFingerprint();
    const pingStatus = async () => {
      try {
        await fetch(buildHeartbeatUrl(getApiRoot(), fp), {
          method: 'GET', cache: 'no-store',
        });
      } catch { /* silently tolerate — WS + next tick will retry */ }
    };
    pingStatus();
    const httpHeartbeat = setInterval(pingStatus, 45_000);

    const clearTimers = () => {
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
      if (wsReconnectRef.current) { clearTimeout(wsReconnectRef.current); wsReconnectRef.current = null; }
    };

    // Sprint 11 Phase B — SSE realtime fallback (middle tier).
    // Engaged when WS has failed >=3 times. Listens for the same
    // signed Redis-channel messages the WS does; on receive, runs
    // the same client actions (fetchContent, reload, etc.).
    const tryOpenSse = () => {
      if (sseRef.current) return; // already open
      const token = getDeviceToken();
      if (!token) {
        // Without a signed device JWT we can't auth the SSE endpoint
        // — fall through to HTTP poll immediately.
        engageHttpPollFallback('no-signed-token');
        return;
      }
      const url = `${getApiRoot()}/api/v1/realtime/sse?token=${encodeURIComponent(token)}`;
      console.log('[Player SSE] opening', url.replace(/token=[^&]+/, 'token=…'));
      let es: EventSource;
      try {
        es = new EventSource(url, { withCredentials: false });
      } catch (e) {
        console.warn('[Player SSE] EventSource construction failed:', (e as Error)?.message);
        engageHttpPollFallback('eventsource-ctor-failed');
        return;
      }
      sseRef.current = es;

      es.onopen = () => {
        sseFailCountRef.current = 0;
        console.log('[Player SSE] open');
        // If HTTP poll fallback was running, kill it — SSE is cheaper.
        if (httpFallbackRef.current) {
          clearInterval(httpFallbackRef.current);
          httpFallbackRef.current = null;
        }
      };

      // Each Redis event type comes through as a named SSE event.
      // SSE doesn't have the signed-replay protection the WS path
      // uses — we trust the server-side signer for these. Auth was
      // already enforced when EventSource opened.
      const handle = (name: string, fn: (data: any) => void) => {
        es.addEventListener(name, (ev) => {
          try {
            const data = JSON.parse((ev as MessageEvent).data);
            console.log(`[Player SSE] ${name}`);
            fn(data?.payload || data);
          } catch (e) {
            console.warn(`[Player SSE] parse failed for ${name}:`, (e as Error)?.message);
          }
        });
      };
      handle('SYNC', () => fetchContent());
      handle('OVERRIDE', () => fetchContent());
      handle('ALL_CLEAR', () => fetchContent());
      handle('CHECK_FOR_UPDATES', () => {
        // 2026-05-16 — don't install on arrival. Show the operator-
        // confirmed "Update now?" prompt; the actual OTA only starts
        // when they click "Update now" (see the overlay render +
        // bridge.checkForUpdates() call there). If the native bridge
        // isn't present (browser preview / unpaired) there's nothing
        // to update — skip the prompt.
        try {
          const bridge = (window as any).EduCmsNative;
          if (bridge && typeof bridge.checkForUpdates === 'function') {
            setShowUpdatePrompt(true);
          }
        } catch { /* swallow */ }
      });
      handle('REFRESH_WEB', () => {
        try {
          const bridge = (window as any).EduCmsNative;
          if (bridge && typeof bridge.reload === 'function') bridge.reload();
          else window.location.reload();
        } catch { /* swallow */ }
      });

      es.onerror = () => {
        sseFailCountRef.current += 1;
        console.warn(`[Player SSE] error (#${sseFailCountRef.current})`);
        // EventSource attempts its own reconnect by default. After 2
        // failures with no successful onopen in between, give up on
        // SSE entirely and drop to HTTP poll.
        if (sseFailCountRef.current >= 2) {
          try { es.close(); } catch { /* swallow */ }
          sseRef.current = null;
          engageHttpPollFallback('sse-failed-twice');
        }
      };
    };

    const engageHttpPollFallback = (why: string) => {
      if (httpFallbackRef.current) return;
      console.warn(`[Player WS] engaging 5s HTTP fallback poll (reason: ${why})`);
      httpFallbackRef.current = setInterval(() => fetchContent(), 5_000);
    };

    const connect = () => {
      // Always clear timers from prior attempt before opening a new socket.
      clearTimers();
      try {
        const wsUrl = getApiRoot().replace(/^http/, 'ws') + '/realtime';
        console.log('[Player WS] Connecting to', wsUrl, `(attempt ${wsFailCountRef.current + 1})`);
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          wsFailCountRef.current = 0; // reset on successful open
          lastWsMessageAtRef.current = Date.now();
          // Stop the HTTP fallback poll if we now have a working socket.
          if (httpFallbackRef.current) { clearInterval(httpFallbackRef.current); httpFallbackRef.current = null; }
          // Close the SSE fallback too — WS is the preferred transport.
          if (sseRef.current) {
            try { sseRef.current.close(); } catch { /* swallow */ }
            sseRef.current = null;
            sseFailCountRef.current = 0;
          }
          // FIX (player-007): detect signed-token absence and warn the
          // operator instead of silently degrading to HTTP polling. In
          // production with DEV_WS_ALLOW unset/false the server will
          // reject `dev_*` tokens, so real-time emergency events stop
          // arriving on this socket. The HTTP polling fallback still
          // covers life-safety (5–10s cadence) but the operator deserves
          // a clear "kiosk needs re-pairing" prompt instead of guessing
          // why their drill went 8s slower than expected.
          const signedToken = getDeviceToken();
          const tok = signedToken || (tenantIdRef.current ? `dev_${screenId}_${tenantIdRef.current}` : `dev_${screenId}_unknown`);
          const devWsAllow = process.env.NEXT_PUBLIC_DEV_WS_ALLOW === 'true';
          if (!signedToken && !devWsAllow) {
            console.warn('[Player WS] No signed device JWT available — server will reject dev_ token in prod. Banner surfaced.');
            setUnsignedWsTokenWarning(true);
          } else if (signedToken) {
            // Recovered (e.g. user re-paired): clear the banner.
            setUnsignedWsTokenWarning(false);
          }
          console.log('[Player WS] Connected — sending HELLO');
          ws.send(JSON.stringify({ event: 'HELLO', data: { token: tok } }));
          heartbeatRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ event: 'HEARTBEAT' }));
              // Dead-connection detector: if we haven't heard ANYTHING (incl
              // pong) in 60s, force a reconnect. Some proxies silently drop.
              if (Date.now() - lastWsMessageAtRef.current > 60_000) {
                console.warn('[Player WS] Silent for 60s — force reconnect');
                ws.close();
              }
            }
          }, 15_000);
        };

        ws.onmessage = (event) => {
          lastWsMessageAtRef.current = Date.now();
          try {
            const msg = JSON.parse(event.data as string);
            console.log('[Player WS] Received:', msg.type);

            // Capture server-time offset at AUTH_OK. Android signage
            // devices often ship without NTP sync and can drift minutes
            // from wall-clock; without this the staleness gate below
            // would drop every emergency event on a wrong-clock kiosk.
            // The offset is "what to ADD to local Date.now() to match
            // the server's clock".
            if (msg.type === 'AUTH_OK' && typeof msg?.data?.serverTime === 'number') {
              const srv = msg.data.serverTime as number;
              serverClockOffsetRef.current = srv - Date.now();
              if (Math.abs(serverClockOffsetRef.current) > 5000) {
                console.warn('[Player WS] Large clock skew detected — offset=', serverClockOffsetRef.current, 'ms');
              }
            }

            // ─── Audit fix #2: client-side replay + freshness gate ───
            // The full HMAC signature uses a server-only secret we
            // intentionally don't ship to the player (would defeat the
            // purpose). What we CAN enforce client-side:
            //   1. Reject events older than 30s (server signs with a 10s
            //      window, this is the loose client-side equivalent).
            //   2. Reject duplicate eventIds (replay protection).
            //   3. Sensitive events (OVERRIDE / TENANT_CHANGED) MUST carry
            //      a signature field — we don't verify it here, but its
            //      absence means the message didn't even pass through the
            //      signer service and is rejected outright.
            // Full asymmetric verification requires per-tenant Ed25519
            // keys issued at pair time — slated as a follow-up.
            //
            // FIX (player-006): ALL_CLEAR is intentionally NOT in this set.
            // A clock-skewed kiosk that boots after lockdown has been
            // cleared could otherwise drop the ALL_CLEAR for arriving
            // before AUTH_OK (no clock offset captured yet) and stay
            // stuck on the lockdown screen until the next manifest poll
            // (5–10 s) catches up. ALL_CLEAR is the safest possible
            // message — losing it has worse consequences than a brief
            // acceptance window. Trust + verify rather than fail-closed:
            // we still pass the message through the same OVERRIDE-type
            // sanity logic (cacheEmergency(null), setActiveEmergency(null))
            // and the next 10s poll re-confirms via /emergency/status.
            // 2026-05-26 P0-3 — Sprint 5 emergency messages (SOS,
            // TEXT_BROADCAST, MEDIA_ALERT) are signed at
            // emergency.controller.ts:739/821/907 and travel the same
            // life-safety pub/sub channel as OVERRIDE — they MUST go
            // through the same signature + freshness gate, not just
            // be trusted on type.
            const SENSITIVE_TYPES = new Set([
              'OVERRIDE',
              'TENANT_CHANGED',
              'SOS',
              'TEXT_BROADCAST',
              'MEDIA_ALERT',
              'ALL_CLEAR_MESSAGE',
            ]);
            if (SENSITIVE_TYPES.has(msg.type)) {
              if (!msg.signature || typeof msg.signature !== 'string') {
                console.warn('[Player WS] dropped unsigned sensitive event:', msg.type);
                return;
              }
              // Apply server-clock offset so kiosks with wrong local
              // clocks still accept events that are actually fresh.
              const adjustedNow = Date.now() + serverClockOffsetRef.current;
              if (typeof msg.timestamp !== 'number' || Math.abs(adjustedNow - msg.timestamp) > 30_000) {
                console.warn('[Player WS] dropped stale/future event:', msg.type, msg.timestamp, 'offset=', serverClockOffsetRef.current);
                return;
              }
              if (msg.eventId && typeof msg.eventId === 'string') {
                const seen = recentEventIdsRef.current;
                if (seen.has(msg.eventId)) {
                  console.warn('[Player WS] dropped replayed event:', msg.eventId);
                  return;
                }
                seen.set(msg.eventId, Date.now());
                // Bound memory: drop entries older than 5 min, hard cap at 500.
                if (seen.size > 500) {
                  const cutoff = Date.now() - 5 * 60_000;
                  for (const [k, t] of seen) if (t < cutoff) seen.delete(k);
                  while (seen.size > 500) seen.delete(seen.keys().next().value as string);
                }
              }
            }
            // SECURITY (life-safety): ALL_CLEAR no longer optimistically drops
            // the active emergency. Previously a single ALL_CLEAR message
            // cleared the lockdown overlay *before* re-confirming with the
            // server — so a spoofed ALL_CLEAR could cancel a REAL lockdown for
            // a window. Now the authenticated manifest is the SOLE arbiter of
            // emergency state: ALL_CLEAR just triggers fetchContent() below,
            // and fetchContent() clears the alert ONLY if the server-of-record
            // manifest reports allClear/NONE (see the manifest.emergency block
            // ~L2540). A forged ALL_CLEAR therefore can't drop a real alert —
            // the re-fetch re-asserts it. Combined with the server-side HMAC
            // verify at the Redis fan-out gate (redis.service handleRedisMessage),
            // a forged ALL_CLEAR can't even reach the player in the first place.
            // Clearing stays prompt for a genuine all-clear because the trigger
            // endpoint sets Tenant.emergencyStatus=NONE before publishing, so
            // the immediate fetchContent() sees the cleared state.
            // Audit fix #6: kiosk was re-paired by an admin to a different
            // tenant (likely physically moved between buildings or districts).
            // Wipe every piece of tenant-scoped local state and reset to the
            // pairing screen so the new tenant's content can't be served from
            // disk before re-pair completes.
            if (msg.type === 'TENANT_CHANGED') {
              try { localStorage.removeItem('edu_device_token'); } catch {}
              try { localStorage.removeItem('edu_device_fp'); } catch {}
              try { localStorage.removeItem('edu_manifest_cache_v1'); } catch {}
              try { localStorage.removeItem('edu_emergency_cache_v1'); } catch {}
              // Ask the SW to clear both cache tiers so disk is clean for the
              // new tenant.
              try {
                navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_CACHE', tier: 'all' });
              } catch {}
              // Ask the native shell (if present) to wipe USB cache + reload.
              try { (window as any).EduCmsNative?.unpair?.(); } catch {}
              setActiveEmergency(null);
              setPhase('registering');
              return;
            }
            if (msg.type === 'SYNC' || msg.type === 'OVERRIDE' || msg.type === 'ALL_CLEAR') {
              fetchContent();
            }
            // 2026-05-26 P0-3 — Sprint 5 emergency messages (SOS,
            // TEXT_BROADCAST, MEDIA_ALERT). API signs + publishes these
            // (emergency.controller.ts:739/821/907) but before this fix
            // no player handler consumed them. The EmergencyOverlay
            // component renders the matching UI; we just set the
            // pushed-message state from the WS payload. ALL_CLEAR_MESSAGE
            // (emergency.controller.ts:981) clears.
            if (msg.type === 'SOS' || msg.type === 'TEXT_BROADCAST' || msg.type === 'MEDIA_ALERT') {
              const p = msg.payload || {};
              setPushedEmergencyMessage({
                id: p.id || msg.eventId || `msg-${Date.now()}`,
                type: msg.type as 'SOS' | 'TEXT_BROADCAST' | 'MEDIA_ALERT',
                severity: (p.severity as 'INFO' | 'WARN' | 'CRITICAL') || 'CRITICAL',
                textBlob: typeof p.textBlob === 'string' ? p.textBlob : null,
                mediaUrls: Array.isArray(p.mediaUrls) ? p.mediaUrls : [],
                audioUrl: typeof p.audioUrl === 'string' ? p.audioUrl : null,
                expiresAt: typeof p.expiresAt === 'number' ? p.expiresAt : null,
                createdAt: p.createdAt || new Date().toISOString(),
              });
            } else if (msg.type === 'ALL_CLEAR_MESSAGE') {
              setPushedEmergencyMessage(null);
            }
            // Sprint 13 — CTS scoreboard updates broadcast from the
            // bridge. The payload carries one CtsFullSnapshot per
            // emit; the player just stores it for downstream widget
            // consumers. Not in SENSITIVE_TYPES — a forged GAME_STATE
            // is a UX nuisance, not a safety failure (worst case: the
            // ribbon shows a wrong score for one cycle until the next
            // legit update overwrites it). Same threat tier as a
            // canvas/orientation broadcast.
            if (msg.type === 'GAME_STATE') {
              const snap = (msg.payload && (msg.payload as any).snapshot) || null;
              if (snap && typeof snap === 'object') {
                setCurrentGameState(snap);
                try {
                  // Fan out to any widget mounted outside the React
                  // tree (e.g. an iframe-rendered scoreboard) via a
                  // window-level CustomEvent — same pattern used by
                  // the touch-overlay dispatcher.
                  window.dispatchEvent(
                    new CustomEvent('edu:cts-game-state', { detail: snap }),
                  );
                } catch { /* CustomEvent unsupported — ignore */ }
              }
            }
            // Sprint 13 — CTS_MANUAL_CUE: admin / Stream Deck / mobile
            // operator manually triggered a specific celebration cue on
            // this screen. Re-route through the same window CustomEvent
            // the orchestrator's Properties-panel test buttons fire, so
            // the orchestrator (mounted full-coverage on the ribbon) just
            // works without per-source plumbing. Not in SENSITIVE_TYPES —
            // a forged manual cue is a UX nuisance, not a safety failure
            // (same threat tier as GAME_STATE).
            if (msg.type === 'CTS_MANUAL_CUE') {
              const payload = (msg.payload || {}) as { cueId?: string; team?: string };
              if (payload && typeof payload === 'object' && typeof payload.cueId === 'string') {
                try {
                  window.dispatchEvent(
                    new CustomEvent('edu:cts-celebration-preview', {
                      detail: {
                        cueId: payload.cueId,
                        team: payload.team === 'away' ? 'away' : payload.team === 'horn' ? 'horn' : 'home',
                        source: 'manual',
                      },
                    }),
                  );
                } catch { /* ignore */ }
              }
            }
            // Sprint 11 Phase B — REFRESH_WEB: admin pushed a "reload
            // kiosks" command from the dashboard. Solves the chicken-
            // and-egg problem of "we shipped a web bundle fix but the
            // kiosks won't pick it up until they reload, and we have
            // no way to tell them to reload from afar."
            //
            // Payload shape:
            //   { scope: 'tenant'|'screen', scopeId: string,
            //     jitterMs?: number, corrId?: string }
            //
            // Per-screen pushes target one device. Per-tenant pushes
            // fan out to every kiosk — we apply a random delay
            // (0..jitterMs, default 8s) so a 1000-device fleet doesn't
            // all hit Vercel + the API simultaneously after the reload.
            if (msg.type === 'REFRESH_WEB') {
              const pl = msg.payload || msg;
              const scope = pl?.scope;
              const scopeId = pl?.scopeId;
              const jitterMs = Math.max(0, Math.min(60_000, Number(pl?.jitterMs ?? 8000)));
              const corrId = pl?.corrId || '(no-corrid)';
              const targetsUs =
                scope === 'tenant' ||
                (scope === 'screen' && screenId && scopeId === screenId);
              if (!targetsUs) {
                console.log(`[REFRESH_WEB ${corrId}] ignored — not our scope (got ${scope}/${scopeId})`);
              } else {
                const delay = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
                console.log(`[REFRESH_WEB ${corrId}] reloading in ${delay}ms (jitter=${jitterMs}ms scope=${scope})`);
                // Brief connectivity toast so the operator-at-kiosk
                // (and anyone reviewing the screen) sees that the
                // refresh was intentional, not a crash.
                setConnectivity({
                  kind: 'reconnecting',
                  reason: 'Refreshing player…',
                  nextRetryAt: Date.now() + delay,
                  attempt: 0,
                });
                setTimeout(() => {
                  try {
                    const bridge = (window as any).EduCmsNative;
                    if (bridge && typeof bridge.reload === 'function') {
                      bridge.reload();
                    } else if (typeof window !== 'undefined') {
                      window.location.reload();
                    }
                  } catch (e) {
                    console.warn(`[REFRESH_WEB ${corrId}] reload threw:`, (e as Error)?.message);
                  }
                }, delay);
              }
              return;
            }
            // Admin hit "Push APK update" in the dashboard. Messages are
            // fanned out to the whole tenant channel; we only act if
            // this device is actually targeted.
            //   payload.scope === 'tenant' → every kiosk in the tenant
            //   payload.scope === 'screen' + scopeId matches this screen
            // If we're NOT running inside the Android kiosk shell, the
            // bridge isn't present — plain browser players just log + no-op.
            if (msg.type === 'CHECK_FOR_UPDATES') {
              const pl = msg.payload || msg;
              const scope = pl?.scope;
              const scopeId = pl?.scopeId;
              // 2026-04-29 — read corrId from server payload so this
              // kiosk's WS receipt logs the same trace ID the server
              // generated. Grep one corrId across Railway + Player
              // diagnostics + Manager logs to see the entire chain.
              const corrId = pl?.corrId || '(no-corrid)';
              const targetsUs =
                scope === 'tenant' ||
                (scope === 'screen' && screenId && scopeId === screenId);
              console.log(`[OTA ${corrId}] WS CHECK_FOR_UPDATES received scope=${scope} scopeId=${scopeId} targetsUs=${targetsUs}`);
              if (!targetsUs) {
                console.log(`[OTA ${corrId}] ignored — not our scope`);
              } else {
                // Operator (2026-04-27): "we should really show on
                // the device splash screen that an update is
                // happening... show the same info as i see on the
                // dashboard every step of the way." Surface the
                // overlay BEFORE the bridge call so the user at the
                // kiosk sees something happening instantly.
                let bridgeAvailable = false;
                try {
                  const bridge = (window as any).EduCmsNative;
                  if (bridge && typeof bridge.checkForUpdates === 'function') {
                    bridgeAvailable = true;
                    const v = bridge.checkForUpdates();
                    console.log('[Player] CHECK_FOR_UPDATES relayed to native, currentVersion=', v);
                  } else {
                    console.log('[Player] CHECK_FOR_UPDATES ignored — no native bridge (legacy APK or browser player)');
                  }
                } catch (e) {
                  console.warn('[Player] CHECK_FOR_UPDATES bridge call failed', e);
                }
                // Show the overlay either way — operator sees that
                // the message reached the device. If bridge isn't
                // available (v1.0.4 APK), the overlay copy adapts.
                setOtaProgress({
                  startedAt: Date.now(),
                  bridgeAvailable,
                });
              }
            }
          } catch (e) {
            console.error('[Player WS] Parse error:', e);
          }
        };

        ws.onerror = (err) => {
          console.error('[Player WS] Error:', err);
          try { ws.close(); } catch {}
        };

        ws.onclose = (ev) => {
          console.log('[Player WS] Closed:', ev.code, ev.reason);
          clearTimers();
          wsFailCountRef.current += 1;
          // Exponential backoff with full jitter: 1s, 2s, 4s, 8s, 16s, 30s max.
          const delay = backoffMs(wsFailCountRef.current, 1000, 30_000);
          console.log(`[Player WS] Reconnect in ~${Math.round(delay)}ms`);
          wsReconnectRef.current = setTimeout(connect, delay);

          // After 3 consecutive failures, escalate the realtime fallback
          // ladder. Phase B Sprint 11 added SSE between WS and HTTP poll.
          //
          //   WS failed 3+ times → open SSE (works through 95% of corp
          //                                    firewalls that block ws://)
          //   SSE also fails 2+ times → fall through to 5 s HTTP poll
          //
          // SSE delivers the same Redis-channel messages as WS so the
          // player code doesn't need duplicate handlers — it just dispatches
          // the same actions (SYNC → fetchContent, REFRESH_WEB → reload, ...).
          if (wsFailCountRef.current >= 3 && !sseRef.current && !httpFallbackRef.current) {
            tryOpenSse();
          }
        };
      } catch (e) {
        console.error('[Player WS] Connection failed:', e);
        wsFailCountRef.current += 1;
        wsReconnectRef.current = setTimeout(connect, backoffMs(wsFailCountRef.current, 1000, 30_000));
      }
    };

    connect();

    return () => {
      clearTimers();
      clearInterval(httpHeartbeat);
      if (httpFallbackRef.current) { clearInterval(httpFallbackRef.current); httpFallbackRef.current = null; }
      if (sseRef.current) {
        try { sseRef.current.close(); } catch {}
        sseRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
    };
  }, [phase, screenId, fetchContent]);

  // ─── CRITICAL: Emergency polling fallback ───
  // WebSocket is the primary channel, but for life-safety alerts we CANNOT
  // rely on a single transport. Adaptive cadence: 5s when emergency is active
  // OR WebSocket is degraded (≥2 consecutive WS failures), otherwise 10s.
  useEffect(() => {
    if (phase !== 'playing' || !screenId) return;
    const fast = !!activeEmergency || wsFailCountRef.current >= 2;
    const cadence = fast ? 5_000 : 10_000;
    emergencyPollRef.current = setInterval(() => fetchContent(), cadence);
    return () => {
      if (emergencyPollRef.current) {
        clearInterval(emergencyPollRef.current);
        emergencyPollRef.current = null;
      }
    };
  }, [phase, screenId, fetchContent, activeEmergency]);

  // ─── Cycle through slides ───
  // 2026-05-04 — Goodview / Chromium 95 / older Android System WebView
  // bulletproofing. THIRD attempt at this bug.
  //
  // Symptoms over time:
  //   - "carousel 1→2→1 loop"     (ee28970, fixed for modern Chromium)
  //   - "stuck on slide 1, never advances on Goodview Chromium 95"
  //     (fed6313, fixed playlist-ref churn via stable string sig)
  //   - "force quit + relaunch, same issue, yodeck and optisigns work"
  //     (THIS COMMIT — replace the fragile setTimeout pattern entirely)
  //
  // Why setTimeout was wrong:
  //   - setTimeout is throttled aggressively on older Android System
  //     WebView builds, especially when the WebView thinks the page
  //     is "idle" (no user input, fixed background, no animations
  //     visible to the OS).
  //   - Single setTimeout(N) means: if the OS skips this single
  //     callback for any reason (GC, background throttle, JS thread
  //     contention from image decode), the slide NEVER advances.
  //   - useEffect cleanup fires on every dep-change re-render, which
  //     resets the timer. Even with the stable-string fix from
  //     fed6313, edge cases (manifest refetch coinciding with the
  //     timer's tail end) could still kill the single setTimeout.
  //
  // Why this version is bulletproof:
  //   - Uses a setInterval heartbeat ticking every 500ms. Even if
  //     individual ticks are throttled, the next one self-corrects.
  //   - Each tick computes `Date.now() - slideStartedAtRef.current`
  //     and advances when elapsed >= duration. So if the OS skips
  //     5 consecutive ticks (unlikely but possible on a stressed
  //     kiosk), the next tick that fires WILL detect the elapsed
  //     duration and advance immediately.
  //   - slideStartedAtRef tracks WHEN the current slide started.
  //     Reset on every advance OR when sorted/playlist changes.
  //   - Refs (not state) hold the loop-relevant data so the interval
  //     callback always reads the latest values without re-creating
  //     the interval on every render.
  //
  // This is the same pattern Yodeck/OptiSigns use under the hood:
  // a single self-correcting interval, not a one-shot setTimeout.
  const playlistItemsSig = useMemo(() => {
    if (!playlist?.items?.length) return '';
    return playlist.items
      .map((i: any) => `${i.sequenceOrder}|${i.durationMs}|${i.manifestKey || i.id}`)
      .join('||');
  }, [playlist]);

  // Refs the heartbeat reads — kept fresh by the render-time mirror below.
  const slideStartedAtRef = useRef<number>(Date.now());
  const sortedItemsRef = useRef<any[]>([]);
  const currentIndexRef = useRef<number>(0);

  // Mirror render-time values into refs so the interval callback can
  // read the latest snapshot without restarting the interval.
  useEffect(() => {
    sortedItemsRef.current = playlist?.items
      ? [...playlist.items].sort((a: any, b: any) => a.sequenceOrder - b.sequenceOrder)
      : [];
    currentIndexRef.current = currentIndex;
  });

  // Reset the slide-started timestamp whenever the active slide changes
  // OR the playlist content changes. Without this, advancing to slide 2
  // would inherit slide 1's start time, immediately re-fire the advance,
  // and skip slide 2 entirely.
  useEffect(() => {
    slideStartedAtRef.current = Date.now();
  }, [currentIndex, playlistItemsSig]);

  useEffect(() => {
    if (phase !== 'playing' || !playlist?.items?.length) return;

    const isItemValid = (item: any) => {
      if (!item.daysOfWeek && !item.timeStart && !item.timeEnd) return true;
      const now = new Date();
      if (item.daysOfWeek) {
        const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        if (!item.daysOfWeek.includes(dayMap[now.getDay()])) return false;
      }
      if (item.timeStart && item.timeEnd) {
        const [sh, sm] = item.timeStart.split(':').map(Number);
        const [eh, em] = item.timeEnd.split(':').map(Number);
        const currentMins = now.getHours() * 60 + now.getMinutes();
        const startMins = sh * 60 + sm;
        const endMins = eh * 60 + em;
        if (currentMins < startMins || currentMins > endMins) return false;
      }
      return true;
    };

    // Heartbeat — fires every 500ms. Self-correcting: any single missed
    // tick is recovered by the next one. Reads sortedItemsRef +
    // currentIndexRef so it never goes stale.
    const heartbeat = setInterval(() => {
      const sorted = sortedItemsRef.current;
      if (!sorted.length) return;
      const idx = currentIndexRef.current % sorted.length;
      const item = sorted[idx];
      if (!item) return;

      // If the current slide is invalid (daypart filter), skip forward
      // to the next valid one immediately.
      if (!isItemValid(item)) {
        let nextIndex = idx;
        let found = false;
        for (let i = 0; i < sorted.length; i++) {
          nextIndex = (nextIndex + 1) % sorted.length;
          if (isItemValid(sorted[nextIndex])) {
            found = true;
            break;
          }
        }
        if (found && nextIndex !== idx) {
          setCurrentIndex(nextIndex);
        }
        return;
      }

      // Videos drive their own advance via <video onEnded>. Don't
      // tick them — the heartbeat would race the natural completion.
      if (item.asset?.mimeType?.startsWith('video/')) return;

      // Sprint 11 Phase A.5 — single-item playlist guard.
      // Operator (2026-05-12): "my Den screen keeps cycling and
      // refreshing the playlist url".
      //
      // The Den's active playlist had ONE web-page item with
      // duration_ms=10000 (10 seconds). Every 10s the heartbeat
      // called setCurrentIndex(prev => prev + 1), bumping the
      // underlying counter (0 → 1 → 2 → ...) even though
      // (idx % 1) is always 0. That triggered a state change → React
      // re-rendered the player tree → the WebpageWidget iframe
      // didn't strictly remount but the entire tree re-evaluating
      // every 10s was visible to the operator as a flash/refresh.
      //
      // Fix: when there's only one distinct item, the slide IS the
      // playlist — never advance. Same logic the video path uses
      // for solo-video playlists (isSoloPlaylist below).
      const distinctIds = new Set(sorted.map((s: any) => s.id || s.assetId));
      if (distinctIds.size <= 1) return;

      const duration = item.durationMs || 10000;
      const elapsed = Date.now() - slideStartedAtRef.current;
      if (elapsed >= duration) {
        // 2026-05-20 — loop-boundary opportunistic bundle reload. If a
        // newer web bundle is waiting (bundle-drift watcher set the
        // marker) and we're finishing the LAST item — about to wrap back
        // to item 0 — pick the new bundle up RIGHT HERE. The playlist was
        // going to restart from the top anyway, so the reload is invisible
        // (no mid-content flash). A 24/7 single-item screen never reaches
        // this branch; the watcher's staleness cap covers that case.
        if (
          idx === sorted.length - 1 &&
          bundleDriftSinceRef.current &&
          !readCachedEmergency()
        ) {
          console.log('[bundle-drift] loop boundary reached with new bundle pending — reloading at the seam');
          try {
            const bridge = (window as any).EduCmsNative;
            if (bridge && typeof bridge.reload === 'function') bridge.reload();
            else if (typeof window !== 'undefined') window.location.reload();
            return;
          } catch { /* reload threw — fall through to a normal advance */ }
        }
        setCurrentIndex((prev) => prev + 1);
      }
    }, 500);

    return () => clearInterval(heartbeat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, playlistItemsSig]);

  // ═══════════════════════════════════════════════════════════════
  // ALL HOOKS MUST BE CALLED BEFORE ANY EARLY RETURN (Rules of Hooks).
  // The touch idle-reset + playlist memoization hooks below used to
  // live further down the file, after the phase === 'registering' /
  // 'pairing' / 'connecting' / 'offline' early returns. That caused a
  // hook-count mismatch when the player transitioned from 'pairing' to
  // 'playing' (React saw extra hooks materialize on the second render)
  // which crashed the page right after the dashboard paired the
  // screen. Moved up so every render calls the same hook sequence
  // regardless of phase.
  // ═══════════════════════════════════════════════════════════════

  // Sprint 4: Touch idle-reset for interactive templates.
  const [sceneTick, setSceneTick] = useState(0);
  const idleResetTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isTouchTemplate = !!playlist?.template?.isTouchEnabled;
  const idleResetMs: number = playlist?.template?.idleResetMs ?? 60000;

  useEffect(() => {
    if (!isTouchTemplate) return;

    const reset = () => {
      if (idleResetTimerRef.current) clearTimeout(idleResetTimerRef.current);
      idleResetTimerRef.current = setTimeout(() => {
        setSceneTick(t => t + 1);
        // Phase D1.5 + D2 — when idle elapses, also dismiss any
        // active touch overlay, return to the home template if we
        // navigated cross-template, AND reset to the template's
        // default scene if we changed scenes within the template.
        // The "auto-return on idle" UX kiosks expect.
        setTouchOverlay(null);
        setTouchNavigatedTemplate(null);
        setCurrentSceneId(null);
      }, idleResetMs);
    };

    const onTouch = () => reset();
    const onTouchAction = (e: Event) => {
      const ce = e as CustomEvent<{ type: string; target: string }>;
      if (ce.detail && (ce.detail.type === 'navigate' || ce.detail.type === 'show')) {
        setSceneTick(t => t + 1);
      }
      reset();
    };

    window.addEventListener('pointerdown', onTouch, { passive: true });
    window.addEventListener('keydown', onTouch);
    window.addEventListener('edu:touch-action', onTouchAction as EventListener);
    reset();

    return () => {
      window.removeEventListener('pointerdown', onTouch);
      window.removeEventListener('keydown', onTouch);
      window.removeEventListener('edu:touch-action', onTouchAction as EventListener);
      if (idleResetTimerRef.current) clearTimeout(idleResetTimerRef.current);
    };
  }, [isTouchTemplate, idleResetMs]);

  // Phase D5 — when the playlist swaps to a new template, the stale
  // currentSceneId (a scene id from the PREVIOUS template) silently
  // filters out every zone in the new template (no scene ids match).
  // Visitor saw only shared zones until idle reset fired. Reset on
  // every template-id transition so each new template starts on its
  // own default scene. (Functional audit #7, 2026-05-12.)
  useEffect(() => {
    setCurrentSceneId(null);
  }, [playlist?.template?.id]);

  // Phase D5 — touch analytics shipping.
  //
  // Captures every `edu:touch-action` event into an in-memory queue
  // and flushes to POST /api/v1/analytics/touch-events every 5 s (or
  // 50 events, whichever comes first). On page hide we use
  // sendBeacon() so the last batch isn't lost when the kiosk navigates
  // or sleeps. Failures are swallowed — analytics drops are acceptable
  // on a flaky kiosk; the on-screen experience never depends on it.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    interface QueuedEvent {
      templateId: string;
      zoneId?: string;
      sceneId?: string;
      actionType?: string;
      actionTarget?: string;
      clientTs: number;
    }
    const queue: QueuedEvent[] = [];
    let timer: any = null;

    const tplIdRef = () => playlist?.template?.id || null;

    const flush = async () => {
      if (queue.length === 0) return;
      // Hard-cap to 100 (matches server batch limit). Slice rather
      // than drop the queue entirely so a backlog drains over multiple
      // flushes.
      const batch = queue.splice(0, 100);
      // Server binds screenId from the JWT (req.user.sub for device
      // tokens) — the controller ignores any body screenId to defeat
      // rotation-bypass on the in-memory rate limit. We omit it here.
      const body = JSON.stringify({ events: batch });
      const url = `${getApiRoot()}/api/v1/analytics/touch-events`;
      // sendBeacon CANNOT carry an Authorization header, so the API's
      // JwtAuthGuard rejects every beacon with 401 → analytics drops
      // 100% of pagehide batches. Use fetch+keepalive instead: the
      // request survives navigation AND carries the Bearer token.
      // Modern browsers (Chrome 80+, Safari 13+, Firefox 79+, Android
      // System WebView 90+) all support keepalive: true.
      const token =
        localStorage.getItem('edu_cms_token') ||
        localStorage.getItem('edu_device_token') ||
        '';
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body,
          keepalive: true,
        });
        // 5xx → DB write failed mid-batch. Push the batch back so the
        // next flush retries it. Cap requeue depth at 2 to avoid an
        // infinite loop on a persistently broken server (events older
        // than 5 min would fall outside the clock-skew window anyway).
        if (!res.ok && res.status >= 500) {
          const stillFresh = batch.filter((e) => Date.now() - e.clientTs < 4 * 60_000);
          queue.unshift(...stillFresh);
        }
        // 4xx (e.g. 403 from a not-yet-paired device) → drop silently;
        // analytics is best-effort, retrying won't help.
      } catch {
        // Network error — push back so a later flush retries, again
        // bounded by the freshness filter.
        const stillFresh = batch.filter((e) => Date.now() - e.clientTs < 4 * 60_000);
        queue.unshift(...stillFresh);
      }
    };

    const onTouchAction = (e: Event) => {
      const ce = e as CustomEvent<{ type?: string; target?: string; zoneId?: string | null }>;
      const tplId = tplIdRef();
      // No template id = nothing meaningful to attribute the tap to.
      // Happens during the kiosk-paired empty state; just skip.
      if (!tplId) return;
      const detail = ce.detail || {};
      queue.push({
        templateId: tplId,
        zoneId: detail.zoneId || undefined,
        sceneId: currentSceneId || undefined,
        actionType: detail.type,
        actionTarget: detail.target,
        clientTs: Date.now(),
      });
      if (queue.length >= 50) flush();
    };

    window.addEventListener('edu:touch-action', onTouchAction as EventListener);
    timer = setInterval(() => flush(), 5_000);

    // fetch+keepalive replaces sendBeacon (which couldn't carry the
    // Authorization header); the same async flush() works for both
    // the interval tick AND the pagehide drain because keepalive lets
    // the request outlive the page navigation.
    const onHide = () => { void flush(); };
    // Named handler (not an inline arrow) so the cleanup can actually
    // remove it — on a kiosk that runs for days, an un-removed
    // visibilitychange listener stacks one copy per effect re-run.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('edu:touch-action', onTouchAction as EventListener);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer) clearInterval(timer);
      // Best-effort drain on unmount. keepalive: true on the underlying
      // fetch lets the request survive the page navigation that's about
      // to happen.
      void flush();
    };
    // playlist?.template?.id is read live via tplIdRef() so we don't
    // need it in the dep array. screenId is stable per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenId]);

  // Phase D1.5 — touch overlay + navigate + sound listeners.
  //
  // The dispatcher in dispatchTouchAction() publishes three custom
  // events when a visitor taps a zone. These listeners turn them
  // into on-screen behavior:
  //
  //   edu:touch-overlay        → modal asset on top of the scene
  //   edu:touch-navigate       → jump to another template
  //   edu:touch-sound-toggle   → flip muted state for video assets
  //
  // Registered globally (not gated on isTouchTemplate) because a
  // non-touch playlist could still contain a zone with a tap action
  // via raw config. Cheap to keep armed — three event handlers, no
  // intervals.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onOverlay = (e: Event) => {
      const ce = e as CustomEvent<any>;
      const d = ce.detail || {};
      if (d.kind === 'iframe' && d.url) {
        setTouchOverlay({ kind: 'iframe', url: String(d.url) });
      } else if (d.kind === 'video' && d.assetId) {
        setTouchOverlay({
          kind: 'video',
          assetId: String(d.assetId),
          returnOnEnd: d.returnOnEnd !== false,
        });
      } else if (d.kind === 'asset' && d.assetId) {
        setTouchOverlay({ kind: 'asset', assetId: String(d.assetId) });
      }
    };

    const onNavigate = (e: Event) => {
      const ce = e as CustomEvent<any>;
      const targetTemplateId = ce.detail?.templateId;
      if (!targetTemplateId || typeof targetTemplateId !== 'string') return;
      // Fetch the target template and stash it as the
      // `touchNavigatedTemplate` overlay. The render path below
      // renders this in place of the current playlist when set.
      // Tap-anywhere on the back chip OR the existing idle-reset
      // (Sprint 4 sceneTick) clears it.
      (async () => {
        try {
          // Phase D1.6 — fall back to device JWT on a real kiosk
          // (which doesn't have a dashboard user token in localStorage).
          // Security review caught this: without the fallback,
          // goto-template was non-functional on real kiosks.
          const token = typeof window !== 'undefined'
            ? (localStorage.getItem('edu_cms_token')
               || localStorage.getItem('edu_device_token')
               || '')
            : '';
          // 2026-05-14 — operator-confirmed: dispatcher fires
          // "goto-template" but nothing renders. Root cause: the
          // regular `GET /templates/:id` is RBAC-gated to user roles
          // (SUPER_ADMIN / DISTRICT_ADMIN / SCHOOL_ADMIN /
          // CONTRIBUTOR) and a kiosk's device JWT has `kind:
          // 'device'` with no user role, so every fetch silently
          // 403'd. New `:id/playback` endpoint accepts device JWTs
          // and scopes by the bound screen's tenant; user JWTs also
          // work (same code path). 403 here will surface a console
          // warn AND a red diagnostic toast.
          const res = await fetch(
            `${getApiRoot()}/api/v1/templates/${encodeURIComponent(targetTemplateId)}/playback`,
            { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' },
          );
          // Always log + emit a visible diag event so the operator
          // sees fetch failures on-screen without needing DevTools.
          try {
            // eslint-disable-next-line no-console
            console.log('[touch-navigate] fetch result', {
              templateId: targetTemplateId,
              status: res.status,
              ok: res.ok,
            });
            window.dispatchEvent(new CustomEvent('edu:touch-fetch-result', {
              detail: { kind: 'goto-template', targetId: targetTemplateId, status: res.status, ok: res.ok, ts: Date.now() },
            }));
          } catch {}
          if (!res.ok) {
            console.warn(`[touch-navigate] template ${targetTemplateId} fetch failed: HTTP ${res.status}`);
            return;
          }
          const tpl = await res.json();
          setTouchNavigatedTemplate(tpl);
        } catch (err) {
          const msg = (err as Error)?.message || 'fetch error';
          console.warn('[touch-navigate] fetch threw:', msg);
          try {
            window.dispatchEvent(new CustomEvent('edu:touch-fetch-result', {
              detail: { kind: 'goto-template', targetId: targetTemplateId, error: msg, ts: Date.now() },
            }));
          } catch {}
        }
      })();
    };

    const onSoundToggle = () => {
      setTouchMuted((m) => !m);
    };

    const onSceneChange = (e: Event) => {
      const ce = e as CustomEvent<any>;
      const sid = ce.detail?.sceneId;
      if (typeof sid === 'string' && sid) {
        setCurrentSceneId(sid);
      }
    };

    window.addEventListener('edu:touch-overlay', onOverlay as EventListener);
    window.addEventListener('edu:touch-navigate', onNavigate as EventListener);
    window.addEventListener('edu:touch-sound-toggle', onSoundToggle as EventListener);
    window.addEventListener('edu:touch-scene-change', onSceneChange as EventListener);

    return () => {
      window.removeEventListener('edu:touch-overlay', onOverlay as EventListener);
      window.removeEventListener('edu:touch-navigate', onNavigate as EventListener);
      window.removeEventListener('edu:touch-sound-toggle', onSoundToggle as EventListener);
      window.removeEventListener('edu:touch-scene-change', onSceneChange as EventListener);
    };
    // applyManifest is declared later in this component and is a
    // stable closure over our state setters; we don't depend on it
    // in the dep array to avoid re-binding the listeners on every
    // playlist change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Memoized sorted playlist + item-validity check.
  const isTemplate = !!playlist?.template;
  const sorted = useMemo(
    () => (playlist && !isTemplate ? [...(playlist.items || [])].sort((a: any, b: any) => a.sequenceOrder - b.sequenceOrder) : []),
    [playlist, isTemplate],
  );
  const isItemValid = useCallback((item: any) => {
    if (!item || (!item.daysOfWeek && !item.timeStart && !item.timeEnd)) return true;
    const now = new Date();
    if (item.daysOfWeek && !item.daysOfWeek.includes(['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()])) return false;
    if (item.timeStart && item.timeEnd) {
      const [sh, sm] = item.timeStart.split(':').map(Number);
      const [eh, em] = item.timeEnd.split(':').map(Number);
      const currentMins = now.getHours() * 60 + now.getMinutes();
      if (currentMins < (sh * 60 + sm) || currentMins > (eh * 60 + em)) return false;
    }
    return true;
  }, []);

  // Native Android URL overlay. For asset playlists containing URL
  // items, a modern APK renders the upstream site in a second top-level
  // WebView while this React player stays mounted underneath. Browser
  // preview and older APKs keep using the iframe/proxy fallback below.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const bridge = (window as any).EduCmsNative;
    const showUrlOverlay = typeof bridge?.showUrlOverlay === 'function'
      ? bridge.showUrlOverlay.bind(bridge)
      : null;
    const hideUrlOverlay = typeof bridge?.hideUrlOverlay === 'function'
      ? bridge.hideUrlOverlay.bind(bridge)
      : null;
    if (!showUrlOverlay || !hideUrlOverlay) return;

    const hide = () => {
      try { hideUrlOverlay(); } catch (err) {
        console.warn('[Player] hideUrlOverlay bridge call failed', err);
      }
    };

    if (phase !== 'playing' || playbackStopped || activeEmergency || sorted.length === 0) {
      hide();
      return;
    }

    const current = sorted[currentIndex % sorted.length];
    if (!isItemValid(current) || current?.asset?.mimeType !== 'text/html') {
      hide();
      return;
    }

    const fileUrl = current?.asset?.fileUrl || '';
    const url = fileUrl.startsWith('http') ? fileUrl : `${getApiRoot()}${fileUrl}`;
    if (!/^https?:\/\//i.test(url)) {
      hide();
      return;
    }

    try {
      showUrlOverlay(url);
    } catch (err) {
      console.warn('[Player] showUrlOverlay bridge call failed', err);
    }
  }, [activeEmergency, currentIndex, isItemValid, phase, playbackStopped, sorted]);

  // Shared splash resolution string — used by all three pre-content phases.
  const splashResolution = typeof window !== 'undefined'
    ? (() => {
        const qp = new URLSearchParams(window.location.search);
        const w = parseInt(qp.get('w') || '0', 10) || window.screen.width;
        const h = parseInt(qp.get('h') || '0', 10) || window.screen.height;
        return `${w}×${h}`;
      })()
    : null;

  // ─── Exit / Stop handlers (hoisted above phase early-returns so the
  //     offline "Reconnecting…" screen can reuse the same Exit logic
  //     the Stopped splash uses — operator should be able to leave the
  //     app from any error state, not just from mid-playback). ───
  // Stop = "go back to the player's main splash". Playback pauses but
  // the shell is still running, with a branded splash that lets the
  // operator Resume, Exit, or Unpair.
  const handleStopPlayback = () => {
    setShowOverlay(false);
    setPlaybackStopped(true);
  };

  // v1.0.16 — wraps fetchContent with visible button feedback.
  // Operator (2026-04-27): "hitting sync does nothing it appears."
  // Even when sync succeeds, the manifest is often unchanged so the
  // React tree never re-renders → no acknowledgment. This wrapper
  // flips syncFeedback through syncing → done so the button can
  // briefly show "Syncing…" then "Synced ✓" (~2s) before resetting.
  //
  // v1.0.16 second pass — operator (2026-04-28): "url playlist fix
  // didnt hit, no carousel and no mouse pointer". Cause: Sync only
  // refetches the manifest; it does NOT reload the page, so the
  // WebView keeps running the OLD JS chunks the WebView pre-cached
  // when the kiosk last booted. New web fixes shipped via Vercel
  // never reach the kiosk until a power-cycle.
  //
  // Fix: after a successful manifest sync, also try to detect a
  // stale web bundle. We sniff the Next.js build hash off any
  // _next/static/chunks/main script and ask the server for its
  // current value via a HEAD on the same chunk path. If the chunk
  // 404s the bundle has been redeployed — call EduCmsNative.reload()
  // to force a WebView reload. Native bridge missing (legacy APK
  // or browser preview) → graceful no-op.
  const handleSyncWithFeedback = useCallback(async () => {
    setSyncFeedback('syncing');
    try {
      await fetchContent();
      setSyncFeedback('done');
      // 2026-04-29 — operator: "i still see the old screens as
      // well" + "sync now button literaly does nothing when you
      // click it". Two issues addressed here:
      //   1. The legacy 404-detection only fired when Vercel hard-
      //      404'd the old chunk URL — but Vercel keeps deprecated
      //      chunks alive for hours after a deploy, so the 404
      //      branch almost never triggered. Result: kiosk stayed
      //      on stale JS for a full power-cycle window.
      //   2. The white paired-view Sync Now button called
      //      fetchContent() directly, bypassing this whole feedback
      //      machine entirely → operator clicks Sync, nothing
      //      happens visibly.
      //
      // New behavior: Sync Now ALWAYS force-reloads the WebView
      // 800ms after the manifest fetch completes. The kiosk re-
      // requests the bundle from Vercel; any new deploy is picked
      // up immediately. State loss is minimal — we're on a splash
      // when the operator clicks Sync, not mid-playback. (For
      // mid-playback Sync we'd want softer behavior, but that path
      // doesn't currently expose a Sync button.)
      setTimeout(() => {
        try {
          const bridge = (window as any).EduCmsNative;
          if (bridge && typeof bridge.reload === 'function') {
            bridge.reload();
          } else if (typeof window !== 'undefined') {
            window.location.reload();
          }
        } catch { /* swallow */ }
      }, 800);
    } catch {
      setSyncFeedback('err');
    } finally {
      setTimeout(() => setSyncFeedback('idle'), 2000);
    }
  }, [fetchContent]);
  // Exit = actually leave the EduCMS player, return control to the
  // Android / OEM launcher. Priority cascade:
  //   1. Native exit bridge (injected by our Android APK).
  //   2. window.close() (works for PWA/TWA windows).
  //   3. Fallback splash state — stays on the Stopped splash but
  //      flips exitUnavailable=true so the copy asks the operator
  //      to hit their remote's Home button.
  const handleExitApp = () => {
    try {
      const bridge = (window as any).EduCmsNative;
      if (bridge && typeof bridge.exitToDeviceHome === 'function') {
        bridge.exitToDeviceHome();
        return;
      }
    } catch { /* fall through */ }
    try { window.close(); } catch { /* ignore */ }
    setPlaybackStopped(true);
    setExitUnavailable(true);
  };

  /**
   * Operator-triggered full unpair. Three-layer teardown:
   *
   *   1. SERVER — POST /screens/unpair/:fp with our device token.
   *      Clears tenantId + regenerates pairingCode on the Screen row.
   *      WITHOUT this the next register call sees the same Android
   *      fingerprint, matches the still-paired record, and returns
   *      paired:true. Operator: "tried to unpair a device and it
   *      didn't unpair" — exactly this.
   *   2. CLIENT (localStorage + caches) — wipe device token, fp,
   *      manifest cache, emergency cache, SW cache tiers. Mirrors
   *      the TENANT_CHANGED WS handler's full teardown.
   *   3. NATIVE — EduCmsNative.unpair() makes the APK clear its
   *      DataStore-persisted token and reload the WebView with an
   *      empty `?token=...` URL param.
   *
   * Fire-and-forget on the server call (don't block the local teardown
   * if the network is slow / the API is down — better to have a kiosk
   * stuck on the pairing splash than one that "looks paired but isn't").
   */
  const handleUnpair = async () => {
    const fp = getDeviceFingerprint();
    const token = (() => {
      try { return localStorage.getItem('edu_device_token') || ''; } catch { return ''; }
    })();

    // 1. Server: clear tenantId + regenerate pairingCode. 4s budget,
    //    swallow errors so a flaky network can't trap the kiosk.
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      await fetch(`${getApiRoot()}/api/v1/screens/unpair/${encodeURIComponent(fp)}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      }).catch(() => { /* tolerate — local teardown still proceeds */ });
      clearTimeout(timer);
    } catch { /* ignore */ }

    // 2. Local state + caches.
    try { localStorage.removeItem('edu_device_token'); } catch { /* ignore */ }
    try { localStorage.removeItem('edu_device_fp'); } catch { /* ignore */ }
    try { localStorage.removeItem('edu_manifest_cache_v1'); } catch { /* ignore */ }
    try { localStorage.removeItem('edu_emergency_cache_v1'); } catch { /* ignore */ }
    try {
      navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_CACHE', tier: 'all' });
    } catch { /* ignore */ }

    // 3. Native bridge → APK wipes DataStore + reloads with empty
    //    token. On non-APK clients (browser tab) fall through to a
    //    React-only reset.
    try {
      const bridge = (window as any).EduCmsNative;
      if (bridge && typeof bridge.unpair === 'function') {
        bridge.unpair();
        return;
      }
    } catch { /* fall through to React-only path */ }
    setActiveEmergency(null);
    setPlaybackStopped(false);
    setExitUnavailable(false);
    setShowOverlay(false);
    setPhase('registering');
  };

  // ─── OTA progress overlay — rendered on top of every phase
  //     when an admin has just clicked "Push update" from the
  //     dashboard. Stage label morphs the same way the dashboard
  //     popover does, so the on-kiosk and at-desk views stay in
  //     sync. Bridge-missing kiosks (v1.0.4) get different copy
  //     so the operator knows why the update can't proceed. */}
  // 2026-05-04 — operator: "dump the dumb purple menu and keep it
  // all in the main screen". The floating bottom-center
  // OtaProgressOverlay was redundant with the in-card "Update in
  // progress" banner that already renders inside the SCROLL-BODY
  // (at the position above the action-buttons row, see the IIFE
  // around line ~3760). Killing the overlay; in-card banner alone
  // is the OTA status surface. The OtaProgressOverlay component
  // itself is kept in this file (further down) in case we want to
  // restore it for browser-only kiosks where there's no in-card
  // splash, but it's no longer wired into any render path.
  const otaOverlay = null;

  // 2026-04-28 — Install Now handler shared by every splash mode.
  // Operator: "screen paired screen should be our main screen with
  // all the info" — moved from the click-to-show info overlay into
  // KioskSplash itself so the banner appears on pairing AND
  // post-pair splashes. Mirrors the legacy in-overlay button:
  //  1. Set otaProgress so the banner switches to "in progress"
  //  2. Call native bridge so OtaUpdateWorker fires
  const handleInstallUpdate = () => {
    const bridge = (window as any).EduCmsNative;
    const bridgeAvailable = !!(bridge && typeof bridge.checkForUpdates === 'function');
    setOtaProgress({ startedAt: Date.now(), bridgeAvailable });
    if (bridgeAvailable) {
      try { bridge.checkForUpdates(); } catch (err) {
        console.warn('[Player] self-update bridge call failed', err);
      }
    }
  };

  // ─── Connectivity toast (non-blocking) ───
  // Renders as a fixed-position bottom-center bar over WHATEVER the
  // current phase is showing. Replaces the legacy blocking
  // `phase === 'offline'` screen. Hidden when connected.
  //
  // Computed inline as a JSX expression (not a function) so it can
  // be referenced in the early-return Fragments below without
  // hitting temporal-dead-zone issues.
  // Phase B5 grace-window timer. Listens for connectivity transitions
  // and decides when the toast becomes visible.
  useEffect(() => {
    if (connectivity.kind === 'connected') {
      setShowReconnectToast(false);
      return;
    }
    // Reconnecting state — kick the grace timer. If we recover before
    // it fires, the cleanup below cancels it and the toast never shows.
    const GRACE_MS = 15_000;
    const t = setTimeout(() => setShowReconnectToast(true), GRACE_MS);
    return () => clearTimeout(t);
  }, [connectivity.kind]);

  const connectivityToast = connectivity.kind === 'reconnecting' && showReconnectToast ? (() => {
    const remainMs = Math.max(0, connectivity.nextRetryAt - Date.now());
    const remainSec = Math.ceil(remainMs / 1000);
    // Operator screenshot 2026-04-27 (post-deploy reconnect on M Series):
    // toast was getting clipped at the right edge because KioskSplash's
    // own `.kiosk-tech-chips` row sits at `bottom: 20-40px` centered, AND
    // my toast sat at `bottom-6` (24px) ALSO centered — both fighting for
    // horizontal space at the same vertical band. Pulled the toast WAY up
    // (bottom-40 = 160px) so it has clean separation from the splash
    // chips, and switched to `left-0 right-0 mx-auto` for centering which
    // doesn't depend on `transform: translateX(-50%)` interacting with
    // any parent transforms.
    return (
      <div
        className="fixed bottom-40 left-4 right-4 mx-auto z-[9998] max-w-xl px-5 py-4 rounded-2xl bg-slate-900/95 text-white shadow-2xl border border-slate-700 backdrop-blur-md flex flex-wrap items-center justify-center gap-3"
        role="status"
        aria-live="polite"
      >
        <WifiOff className="w-6 h-6 text-red-400 shrink-0" />
        <div className="flex-1 min-w-0 text-center sm:text-left">
          <div className="text-base font-semibold">
            Reconnecting{connectivity.attempt > 1 ? ` (attempt ${connectivity.attempt})` : ''}…
          </div>
          <div className="text-xs text-slate-300 mt-0.5">
            {connectivity.reason}{remainSec > 0 ? ` — retry in ${remainSec}s` : ' — retrying now'}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => {
              // Kick the resilient retry chain ahead of its timer.
              setError(null);
              registerFailCountRef.current = 0;
              fetchFailCountRef.current = 0;
              fetchFailStreakStartedAtRef.current = null;
              if (registerRetryTimerRef.current) clearTimeout(registerRetryTimerRef.current);
              if (tickToastRef.current) clearInterval(tickToastRef.current);
              // For unpaired devices, re-fire registration; for paired, re-fire fetchContent.
              if (screenId) {
                fetchContent();
              } else {
                // Pulse phase to retrigger the registration effect cleanly.
                registrationLoopRef.current?.stop();
                registrationLoopRef.current = null;
                setPhase('registering');
              }
            }}
            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white"
          >
            Retry now
          </button>
          <button
            onClick={handleExitApp}
            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white"
          >
            Exit
          </button>
          <button
            onClick={() => {
              try { localStorage.removeItem('edu_device_fp'); } catch {}
              registerFailCountRef.current = 0;
              fetchFailCountRef.current = 0;
              setError(null);
              setConnectivity({ kind: 'connected' });
              registrationLoopRef.current?.stop();
              registrationLoopRef.current = null;
              setPhase('registering');
            }}
            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white"
          >
            Reset
          </button>
        </div>
      </div>
    );
  })() : null;

  // FIX (player-007): visible banner when the kiosk is connected over WS
  // but had to fall back to an unsigned dev_ token (no signed device JWT
  // in localStorage AND DEV_WS_ALLOW is not 'true'). Server rejects this
  // token in prod, so realtime is dead and the operator needs to act.
  // Bottom-right amber banner, kept distinct from the bottom-center
  // reconnecting toast so they don't visually collide.
  const unsignedWsBanner = unsignedWsTokenWarning ? (
    <div
      className="fixed bottom-6 right-6 z-[10001] max-w-md px-5 py-4 rounded-2xl bg-amber-500 text-amber-950 shadow-2xl border border-amber-300 flex items-start gap-3"
      role="alert"
      aria-live="assertive"
    >
      <AlertTriangle className="w-6 h-6 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-base font-bold">Real-time disabled</div>
        <div className="text-xs mt-1 leading-relaxed">
          Kiosk needs re-pairing — no signed device token available.
          Emergency events still arrive via 5–10 s polling fallback,
          but instant real-time is offline.
        </div>
      </div>
    </div>
  ) : null;

  // Canvas-size editor — rendered in every phase so the operator can
  // open it from the playing-empty overlay AND it stays mounted across
  // phase changes (e.g. so the save+reload doesn't disappear mid-input
  // if a SYNC fires). Initial values pre-fill from current override.
  const canvasOverride = readCanvasOverride();
  const canvasEditor = showCanvasEditor ? (
    <CanvasSizeEditor
      initialW={canvasOverride.w}
      initialH={canvasOverride.h}
      initialFitMode={canvasOverride.fitMode}
      onClose={() => setShowCanvasEditor(false)}
    />
  ) : null;

  // ─── Render: Registering ───
  if (phase === 'registering') {
    return (
      <>
        <KioskSplash
          mode="registering"
          brandName={brandName}
          resolution={splashResolution}
          apkVersion={apkVersion}
          managerVersion={managerVersion}
          otaProgress={otaProgress}
          latestApkVersion={latestApkVersion}
          onInstallUpdate={handleInstallUpdate}
        />
        {otaOverlay}
        {connectivityToast}
        {unsignedWsBanner}
        {canvasEditor}
      </>
    );
  }

  // ─── Render: Pairing Code Screen ───
  if (phase === 'pairing') {
    return (
      <>
        <KioskSplash
          mode="pairing"
          brandName={brandName}
          pairingCode={pairingCode}
          resolution={splashResolution}
          apkVersion={apkVersion}
          managerVersion={managerVersion}
          otaProgress={otaProgress}
          latestApkVersion={latestApkVersion}
          onInstallUpdate={handleInstallUpdate}
          pairDeepLinkUrl={
            typeof window !== 'undefined' && pairingCode
              ? `${window.location.origin}/pair?code=${encodeURIComponent(pairingCode)}`
              : null
          }
          orientation={pendingPairOrientation}
          onOrientationChange={(value) => {
            // 1. Instant local rotation via the native bridge — the
            //    kiosk visibly rotates the moment the operator taps a
            //    button, BEFORE the server has been notified. No round-
            //    trip lag during setup.
            try {
              const bridge = (window as any).EduCmsNative;
              if (bridge && typeof bridge.setOrientation === 'function') {
                bridge.setOrientation(value);
              }
            } catch { /* bridge unavailable — CSS fallback effect handles it */ }
            // Drive the active-button highlight + the CSS-fallback
            // effect (which only kicks in for PORTRAIT on Android-API-
            // ignoring ROMs).
            setPendingPairOrientation(value);
            setManifestOrientation(value);
            // 2. Persist on the server when we can. The Screen row
            //    exists from registration (well before tenant claim),
            //    so the device JWT can write to /:id/orientation/device
            //    as soon as we have a screenId. If we don't yet, the
            //    setPendingPairOrientation state preserves the choice
            //    for retry on the next render where screenId lands.
            if (screenId) {
              (async () => {
                try {
                  const tok = getDeviceToken();
                  if (!tok) return; // pre-token render; manifest path retries
                  await fetch(`${getApiRoot()}/api/v1/screens/${screenId}/orientation/device`, {
                    method: 'PUT',
                    headers: {
                      'Authorization': `Bearer ${tok}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ orientation: value, reason: 'pairing-splash' }),
                  });
                } catch {
                  // Server persist failed (network blip / pre-pair).
                  // Local rotation still applied; the persistence will
                  // retry on next render if the operator taps again,
                  // and dashboard-side change still works post-pair.
                }
              })();
            }
          }}
        />
        {otaOverlay}
        {connectivityToast}
        {unsignedWsBanner}
        {canvasEditor}
      </>
    );
  }

  // ─── Render: Connecting ───
  // 2026-04-28 — operator: "why cant this screen be the one that
  // says connecting to your cms and then just refreshes connected
  // ....so you have one screen for when you not paired and then you
  // have this one for when your paired". Removed — we now fall
  // through to the playback render path, which (because there's no
  // currentItem yet) renders the inline "Screen Paired Successfully"
  // view. That view's title/subtitle are conditional on phase so it
  // displays "Connecting to your CMS…" while the manifest is being
  // fetched. ONE post-pair splash, one pre-pair splash. Done.

  // Legacy `phase === 'offline'` block intentionally REMOVED — operator
  // reported (2026-04-27 with screenshot) the kiosk getting stuck on
  // "Reconnecting… Registration HTTP 500 / Next attempt in 3s" with the
  // countdown frozen forever, requiring force-stop to recover. Root
  // cause was setPhase('offline') triggering a useEffect cleanup that
  // wiped the just-scheduled retry timers. The non-blocking
  // `connectivityToast` JSX (defined above the phase returns) replaces
  // it with a ref-loop-driven retry that never freezes.

  // (sceneTick / idleResetTimerRef / sorted / isItemValid hooks were
  // moved above the early returns to satisfy the Rules of Hooks.)
  const currentItem = sorted.length && isItemValid(sorted[currentIndex % sorted.length]) ? sorted[currentIndex % sorted.length] : null;
  const isVideo = currentItem?.asset?.mimeType?.startsWith('video/');
  const fileUrl = currentItem?.asset?.fileUrl || '';
  const resolvedUrl = fileUrl.startsWith('http') ? fileUrl : `${getApiRoot()}${fileUrl}`;

  // Template rendering
  // Gated on !playbackStopped — when paused, fall through to the
  // non-template render below so the inline "Screen Paired
  // Successfully" view handles the paused state instead of the
  // (now-deleted) dark KioskSplash mode='stopped' overlay.
  if (isTemplate && !playbackStopped) {
    const tpl = playlist.template;
    const allZones = tpl.zones || [];
    // Phase D2 — scene-aware zone filter. Three cases:
    //   1. currentSceneId set (operator-driven scene change)
    //      → render zones whose sceneId matches
    //   2. currentSceneId null AND tpl.scenes has a default scene
    //      → render zones for the default scene (multi-scene template
    //        starting fresh)
    //   3. currentSceneId null AND no scenes (legacy template, or
    //      zones with sceneId === null) → render every zone
    // Case 3 preserves the v1 behavior for single-scene templates
    // exactly, since the D2 migration backfilled every zone's
    // sceneId to its default scene.
    const tplScenes: any[] = Array.isArray((tpl as any).scenes) ? (tpl as any).scenes : [];
    const defaultScene = tplScenes.find((s) => s.isDefault) || tplScenes[0] || null;
    const activeSceneId = currentSceneId || defaultScene?.id || null;
    const zones = activeSceneId
      ? allZones.filter((z: any) => !z.sceneId || z.sceneId === activeSceneId)
      : allZones;

    // v1.0.16 — auto-promote interactive UX when the template
    // contains a WEBPAGE zone. Operator (2026-04-27): "when i push a
    // URL it will normally mean its a touch screen and if a mouse
    // click just pops up another menu that means a finger click will
    // do the same... what should work is an exit on the remote
    // control takes me out of the playlist but otherwise i should be
    // able to use the website with my finger or a mouse."
    //
    // We were treating webpage templates as static signage —
    // cursor-none + click-anywhere-to-toggle-overlay killed every
    // attempt to interact with the embedded site. Detecting WEBPAGE
    // zones flips us into the same UX bucket as the explicit "touch
    // template" flag: cursor visible, clicks pass through to the
    // iframe / zone, and only the remote's Back/Exit key brings up
    // the Stop overlay (already wired through edu-show-stop-overlay).
    const hasWebpageZone = zones.some((z: any) => z.widgetType === 'WEBPAGE');
    const isInteractive = isTouchTemplate || hasWebpageZone;

    // Stop splash short-circuit before rendering template widgets
    // so the whole widget tree tears down (stopping any animations,
    // video loops, weather polls, etc.) during the stop.
    // 2026-04-28 — playbackStopped no longer renders the dark
    // KioskSplash mode='stopped'. We don't early-return here; the
    // outer `if (isTemplate && !playbackStopped)` guard further
    // up means a template playlist with playbackStopped=true
    // never enters this branch in the first place. It falls
    // through to the non-template render path, where the inline
    // "Screen Paired Successfully" view (further down) detects
    // playbackStopped and shows the paused variant with playlist
    // list + Resume/Sync/Exit/Unpair buttons.

    return (
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
      <div
        className={`fixed top-0 right-0 bottom-0 left-0 ${isInteractive ? '' : 'cursor-none'}`}
        // role / tabIndex / aria-label / onClick are conditional —
        // a static signage template needs role=button so a11y
        // tooling treats the whole canvas as the trigger for the
        // info overlay, but a template containing a WEBPAGE zone
        // is interactive: clicks pass through to the iframe and
        // the canvas itself is just a passive container. Eslint
        // can't statically prove the conditional pair is balanced,
        // hence the disable above.
        role={isInteractive ? undefined : 'button'}
        tabIndex={isInteractive ? -1 : 0}
        aria-label={isInteractive ? undefined : 'Toggle screen info overlay'}
        onClick={isInteractive ? undefined : () => setShowOverlay(!showOverlay)}
        onKeyDown={e => {
          // Only toggle on direct-target keypresses. Without this
          // guard, Enter on any BUTTON inside the overlay (Stop,
          // Exit, Sync) bubbled here and the overlay toggled off
          // right after the button handler ran — the operator
          // reported "nothing happened" because the overlay
          // disappeared before they could see the Stopped splash.
          if (e.target !== e.currentTarget) return;
          if (!isInteractive && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setShowOverlay(s => !s); }
        }}
        style={{
          // 2026-05-13 — Inline-style fallback. Operator reported
          // (Taurus LED) publishing the Rainbow Animated Portrait
          // template → screen went pure black. Root cause: the
          // wrapper relied on Tailwind's `fixed top-0 right-0 bottom-0 left-0` for
          // full-screen positioning. When Tailwind fails to load
          // on the Taurus WebView (cert/CDN/cache — see kiosk-splash
          // 2026-05-13 entry for the same class of bug), the
          // wrapper collapses to a default block element with
          // height:auto, which is 0 once its children all use
          // position:absolute (they're taken out of normal flow).
          // The zones absolute-position relative to <body> instead
          // of this wrapper, AND the wrapper paints no background,
          // so the screen falls back to body's #000 fill = pure
          // black. Pinning position/inset/size inline makes the
          // template canvas survive Tailwind absence.
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
          cursor: isInteractive ? undefined : 'none',
          backgroundColor: tpl.bgColor || '#000000',
          ...(tpl.bgGradient ? { background: tpl.bgGradient } : {}),
          ...(tpl.bgImage ? { backgroundImage: tpl.bgImage.trim().startsWith('url(') ? tpl.bgImage : `url(${tpl.bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
        }}>
        {/* Scale the entire template scene from its authored design
            resolution down (or up) to the LED canvas via transform:
            scale(). Pre-built templates are authored at 1920×1080
            landscape or 2160×3840 portrait; this lets a 960×1080 LED
            canvas show the whole template fit-contain'd instead of
            clipping the bottom-right half. Operator report 2026-05-13:
            "the template loads now but its 1080x1920 so cutting off
            half the screen." */}
        <TemplateScaler
          designW={tpl.screenWidth || 1920}
          designH={tpl.screenHeight || 1080}
          fitMode={canvasOverride.fitMode}
        >
        {/* Render each zone with its live widget. Key by sceneTick on touch
            templates so idle-reset remounts widgets and clears local state. */}
        {zones.map((zone: any) => {
          // defaultConfig may be a JSON string from the DB — ensure it's a parsed object
          let cfg = zone.defaultConfig;
          if (typeof cfg === 'string') {
            try { cfg = JSON.parse(cfg); } catch { cfg = {}; }
          }
          // The API stores defaultConfig as NULL for a zone with no
          // widget config (templates.controller create: `… : null`),
          // and JSON.parse can itself yield null / a non-object. Without
          // this guard that null reaches _buildPlayerRules(cfg) below,
          // `cfg.fontFamily` throws, and the whole player crashes from
          // INSIDE the zone .map() — before the per-widget boundary can
          // catch it. cfg is a plain object past this line.
          if (!cfg || typeof cfg !== 'object') cfg = {};
          const zoneTouchAction = zone.touchAction || null;
          // Phase D1 — full action dispatcher.
          // Replaces the v0 inline `if (type === 'url')` with a real
          // handler for all 8 v1 primitives (open-url, play-video,
          // goto-template, show-overlay, reset-idle, sound-toggle,
          // webhook, request-help) plus the legacy aliases
          // (navigate, show, url). Each action also dispatches an
          // edu:touch-action CustomEvent so the idle-reset listener
          // earlier in the file picks it up regardless of type.
          // 2026-05-14 diagnostic — even when zoneTouchAction is null,
          // attach a click handler that logs "no action wired" so we
          // can tell apart "click didn't fire" (no log) from "click
          // fired but no action attached" (logs but no overlay).
          const onZoneClick = zoneTouchAction
            ? (e: React.MouseEvent) => {
                e.stopPropagation();
                try {
                  // eslint-disable-next-line no-console
                  console.log('[touch] zone clicked WITH action', {
                    zoneId: zone.id,
                    zoneName: zone.name,
                    widgetType: zone.widgetType,
                    touchAction: zoneTouchAction,
                  });
                  window.dispatchEvent(new CustomEvent('edu:touch-zone-click', {
                    detail: { zoneId: zone.id, zoneName: zone.name, hasAction: true, ts: Date.now() },
                  }));
                } catch {}
                // Pass zoneId so the analytics ship (Phase D5) can
                // attribute the tap to the specific widget. Without
                // this, every tap on every zone would be lumped
                // together at the template level.
                dispatchTouchAction(zoneTouchAction, { screenId, tenantId, zoneId: zone.id });
              }
            : (e: React.MouseEvent) => {
                try {
                  // eslint-disable-next-line no-console
                  console.log('[touch] zone clicked NO action', {
                    zoneId: zone.id,
                    zoneName: zone.name,
                    widgetType: zone.widgetType,
                  });
                  window.dispatchEvent(new CustomEvent('edu:touch-zone-click', {
                    detail: { zoneId: zone.id, zoneName: zone.name, hasAction: false, ts: Date.now() },
                  }));
                } catch {}
              };
          // Universal text-style override — same scoped <style> trick
          // BuilderZone uses, mirrored on the player so operator
          // overrides ship to screens. Two-tier:
          //   - Zone-wide (cfg.fontFamily / fontSize / color / bold / italic / underline / strikethrough)
          //   - Per-field (cfg._styles[fieldKey] = { fontFamily, ... })
          // Per-field rules get higher specificity (zone + data-field
          // attribute selector) so they win over zone-wide for that
          // specific field. SVG icons excluded.
          // 2026-05-04 — same TEXT/RICH_TEXT bug that BuilderZone had:
          // pre-fix the player skipped the override block for TEXT
          // widgets entirely ("they read from cfg directly") which is
          // false for the ~30 v2 themed variants (NewsStudioPro,
          // RainbowRibbon, etc.) that hardcode their own font / color
          // / bg styles. Operator's edits in the builder never showed
          // up on the LIVE PLAYER because the override CSS was missing
          // there. Removing the early-return mirrors the BuilderZone
          // fix so what operators see in the editor is what plays on
          // screens — including the LED poster install in production.
          const _buildPlayerRules = (s: any): string[] => {
            const r: string[] = [];
            // s is `cfg` OR a per-field style object — either can be
            // null (cfg._styles may hold a null value). Never deref null.
            if (!s || typeof s !== 'object') return r;
            const fam = typeof s.fontFamily === 'string' && s.fontFamily.trim();
            const sz = typeof s.fontSize === 'number' && Number.isFinite(s.fontSize) ? s.fontSize : null;
            const col = typeof s.color === 'string' && s.color.trim();
            const decos: string[] = [];
            if (s.underline === true) decos.push('underline');
            if (s.strikethrough === true) decos.push('line-through');
            if (fam) r.push(`font-family: ${fam} !important`);
            if (sz) r.push(`font-size: ${sz}px !important`);
            if (col) r.push(`color: ${col} !important`);
            if (s.bold === true) r.push(`font-weight: 800 !important`);
            if (s.italic === true) r.push(`font-style: italic !important`);
            if (decos.length) r.push(`text-decoration: ${decos.join(' ')} !important`);
            return r;
          };
          // bg-color override cascades to the zone wrapper + every
          // descendant so themed renderers' inline `style={{ background: ... }}`
          // gets overridden (with !important). background-image:none kills
          // gradients so a chosen solid color wins through every layer.
          const _buildPlayerBgRule = (s: any): string | null => {
            if (!s || typeof s !== 'object') return null;
            const bg = typeof s.bgColor === 'string' && s.bgColor.trim();
            if (!bg || bg === 'transparent' || bg === 'inherit') return null;
            return `background-color: ${bg} !important; background: ${bg} !important; background-image: none !important`;
          };
          const _cssChunks: string[] = [];
          const _zoneSel = `[data-zone-id="${zone.id}"]`;
          const zoneRules = _buildPlayerRules(cfg);
          if (zoneRules.length) {
            _cssChunks.push(`${_zoneSel} *:not(svg):not(svg *) { ${zoneRules.join('; ')} }`);
          }
          const _zoneBg = _buildPlayerBgRule(cfg);
          if (_zoneBg) {
            _cssChunks.push(`${_zoneSel}, ${_zoneSel} *:not(svg):not(svg *) { ${_zoneBg} }`);
          }
          const stylesPerField = (cfg._styles && typeof cfg._styles === 'object') ? cfg._styles : {};
          for (const [fieldKey, fieldStyle] of Object.entries(stylesPerField)) {
            const r = _buildPlayerRules(fieldStyle);
            if (!r.length) continue;
            const sel = `${_zoneSel} [data-field="${(fieldKey as string).replace(/"/g, '\\"')}"]`;
            _cssChunks.push(`${sel}, ${sel} *:not(svg):not(svg *) { ${r.join('; ')} }`);
          }
          return (
          <div
            key={`${zone.id}-${isTouchTemplate ? sceneTick : 0}`}
            className="absolute overflow-hidden"
            data-zone-id={zone.id}
            onClick={onZoneClick}
            style={{
              // Inline `position: absolute` so the zone still
              // anchors at %-offsets when Tailwind's `absolute`
              // utility is missing. Without this, zones flowed
              // into normal block layout on the Taurus and the
              // template wrapper's bg-color got covered by stacked
              // widget DOM — appearing as a black screen.
              position: 'absolute',
              overflow: 'hidden',
              left: `${zone.x}%`,
              top: `${zone.y}%`,
              width: `${zone.width}%`,
              height: `${zone.height}%`,
              zIndex: zone.zIndex || 0,
              cursor: zoneTouchAction ? 'pointer' : undefined,
            }}>
            {_cssChunks.length > 0 && <style>{_cssChunks.join('\n')}</style>}
            {/* Per-widget error boundary — one throwing widget can no
                longer crash the whole player into the recovery loop.
                `quiet` blanks just that zone on a live kiosk. */}
            <WidgetErrorBoundary quiet resetKey={zone.id} widgetLabel={zone.widgetType}>
              <WidgetPreview
                widgetType={zone.widgetType}
                config={cfg}
                width={zone.width}
                height={zone.height}
                live={true}
              />
            </WidgetErrorBoundary>
          </div>
          );
        })}
        </TemplateScaler>

        {/* Preview mode chip — always visible in the top-right corner so
            it's obvious the browser tab is a preview, not the real kiosk. */}
        {isPreviewMode() && (
          <div className="absolute top-3 right-3 z-[1000] flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/90 backdrop-blur-sm text-white text-xs font-black uppercase tracking-wider rounded-full shadow-lg pointer-events-none select-none">
            <Monitor className="w-3.5 h-3.5" />
            Preview Mode
          </div>
        )}

        {/* 2026-05-14 — touch diagnostic toast. Visible only on
            isTouchTemplate so it doesn't clutter signage templates.
            Listens for the temporary edu:touch-zone-click + edu:touch-
            fired CustomEvents we emit on every tap-action chain step.
            Shows the operator EXACTLY where the chain stops without
            needing DevTools on the kiosk.
            2026-05-15 — gated to preview mode. The touch-action chain
            is verified working; this debug chip must NOT show on live
            customer kiosks. It still renders in ?preview=1 tabs so the
            instrumentation is one query-param away if needed again. */}
        {isTouchTemplate && isPreviewMode() && <TouchDiagToast />}

        {/* 2026-05-16 — operator-confirmed OTA prompt. Raised when the
            dashboard pushes CHECK_FOR_UPDATES. The operator clicks
            "Update now" and the rest runs itself (silent install +
            auto-relaunch under Device Owner). top/right/bottom/left
            longhand, not `top-0 right-0 bottom-0 left-0` — Chromium-83 Taurus, CLAUDE.md #10. */}
        {showUpdatePrompt && (
          <div
            className="absolute bg-black/85 flex items-center justify-center z-[1000]"
            style={{ top: 0, right: 0, bottom: 0, left: 0 }}
          >
            <div className="bg-slate-900 rounded-2xl p-10 max-w-lg w-full mx-6 border border-slate-700 text-center space-y-6">
              {otaStarting ? (
                <>
                  <div className="text-3xl font-bold text-white">Updating…</div>
                  <div className="text-slate-300 text-lg leading-relaxed">
                    The screen is installing the update and will restart
                    on its own in about a minute. Please don&apos;t power
                    it off.
                  </div>
                </>
              ) : (
                <>
                  <div className="text-3xl font-bold text-white">Software update ready</div>
                  <div className="text-slate-300 text-lg leading-relaxed">
                    A new version of the player is ready. The screen will
                    update and restart automatically — about a minute.
                  </div>
                  <div className="flex gap-4 justify-center pt-2">
                    <button
                      type="button"
                      onClick={() => setShowUpdatePrompt(false)}
                      className="px-7 py-4 rounded-xl text-lg font-semibold text-slate-300 bg-slate-800 border border-slate-700 hover:bg-slate-700"
                    >
                      Not now
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          const bridge = (window as any).EduCmsNative;
                          if (bridge && typeof bridge.checkForUpdates === 'function') {
                            bridge.checkForUpdates();
                          }
                        } catch { /* swallow */ }
                        setOtaStarting(true);
                      }}
                      className="px-7 py-4 rounded-xl text-lg font-bold text-white bg-indigo-600 hover:bg-indigo-500"
                    >
                      Update now
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Info overlay */}
        {showOverlay && (
          <div className="absolute top-0 right-0 bottom-0 left-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[999]">
            <div className="bg-slate-900 rounded-2xl p-8 max-w-md w-full mx-4 border border-slate-700 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">{screenName || 'Screen'}</h3>
                <div className="flex items-center gap-2">
                  {isPreviewMode() && <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded-full">Preview</span>}
                  <Wifi className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm text-emerald-400 font-medium">Connected</span>
                </div>
              </div>
              {tenantName && (
                <div className="text-xs text-indigo-300 font-medium -mt-1">
                  Paired with <span className="text-indigo-200">{tenantName}</span>
                </div>
              )}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-400">Template</span><span className="text-white font-medium">{tpl.name}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Zones</span><span className="text-white font-medium">{zones.length} live widgets</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Resolution</span><span className="text-white font-medium">{tpl.screenWidth}×{tpl.screenHeight}</span></div>
                <CanvasInfoRow />
                <div className="flex justify-between"><span className="text-slate-400">Last Sync</span><span className="text-white font-medium">{lastSync || 'Never'}</span></div>
                <CacheStatusRow status={cacheStatus} />
                <SoftwareInfoRow />
                <DiagnosticsRow />
              </div>
              <div className="flex gap-2 pt-2 flex-wrap">
                <button onClick={(e) => { e.stopPropagation(); handleSyncWithFeedback(); }} disabled={syncFeedback === 'syncing'} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-700/60 text-white rounded-lg font-medium text-sm transition-colors">
                  {syncFeedback === 'syncing' ? 'Syncing…' : syncFeedback === 'done' ? 'Synced ✓' : syncFeedback === 'err' ? 'Sync failed' : 'Sync Now'}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowCanvasEditor(true); }}
                  title="Set the LED's visible pixel size (overrides the controller's frame buffer)"
                  className="py-2 px-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-bold transition-colors"
                >
                  Resize for LED
                </button>
                {/* Stop button — ALWAYS shown, unlike the native-only
                    Exit below. Tries the exit bridge first, then a
                    best-effort window.close(), and finally falls back
                    to a stop-curtain so the operator always gets a
                    visible "playback is halted" state (critical on
                    Goodview-style OEM WebViews that don't inject a
                    native exit bridge). */}
                {/* Overlay actions: Sync + Stop only. Exit and
                    Unpair were redundant here — both belong on the
                    Stopped splash where the operator has already
                    paused playback and is making a deliberate
                    decision. Three "leave the app" controls jammed
                    into one tiny overlay was confusing per the
                    Integration Lead's review. */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleStopPlayback(); }}
                  onKeyDown={(e) => e.stopPropagation()}
                  title="Stop playback — opens the player splash with Resume / Exit / Unpair"
                  className="py-2 px-4 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-bold transition-colors"
                >
                  Stop
                </button>
              </div>
            </div>
          </div>
        )}
        {/* 2026-04-29 — operator: "pushed the update from the app to
            the player and got no feedback on the player that anything
            was pushed". Audit found {otaOverlay} was missing from the
            template render branch. The WS message arrived, otaProgress
            state was set, but the modal overlay never rendered while
            a template playlist was active. Now ALL render branches
            include it (registering / pairing / template / non-
            template / playback). */}
        {otaOverlay}
        {connectivityToast}
        {unsignedWsBanner}
        {canvasEditor}

        {/* 2026-05-14 — touch overlays. SAME AUDIT MISS AS
            otaOverlay above. The TouchOverlay + TouchNavOverlay
            below this early-return only rendered in the
            non-template render path, so on the operator's "Sample
            Touch" template the dispatcher fired, the fetch
            succeeded (green toast "goto-template fetched ok"),
            setTouchNavigatedTemplate(tpl) ran — and then NOTHING
            mounted because the component reading that state was
            below the early-return. Visitor saw "nothing happened
            on tap" with no error. Adding both overlays here so
            template-playlist taps actually trigger their
            configured action. Same {expr && <Component>} pattern
            used in the non-template branch — purely additive. */}
        <TouchOverlay
          overlay={touchOverlay}
          muted={touchMuted}
          onClose={() => setTouchOverlay(null)}
          onSoundToggle={() => setTouchMuted((m) => !m)}
        />
        {touchNavigatedTemplate && (
          <TouchNavOverlay
            template={touchNavigatedTemplate}
            onBack={() => setTouchNavigatedTemplate(null)}
          />
        )}
      </div>
    );
  }

  // 2026-04-28 — Stopped splash REMOVED. Operator: "this screen
  // shouldnt exist...it should just be that other screen paired
  // menu i just sent...consolidate all this shit onto that screen
  // and dump this one". The dark KioskSplash mode='stopped' UI
  // was killed; playbackStopped is now handled by the inline
  // "Screen Paired Successfully" view below (which detects
  // playbackStopped and renders the paused hero variant + playlist
  // list + Resume/Sync/Exit/Unpair cluster).

  // Media playlist rendering
  // 2026-04-28 — operator (6th request): "the URL playlist fix list
  // is still not working, not image carousel, no mouse pointer and
  // a click of the mouse open some dumb ass little splash screen
  // that shouldnt exist". Root cause was that THIS render branch
  // (asset-based playlist, non-template) had `cursor-none` and
  // `onClick={setShowOverlay}` HARDCODED and the inner wrapper had
  // `pointer-events-none` HARDCODED — so for a playlist of HTML
  // assets (URL playlist), clicks never reached the iframe and the
  // cursor was always hidden.
  //
  // Mirroring the template-path's hasWebpageZone detection: if ANY
  // item in the asset playlist has mime 'text/html', flip the whole
  // surface into interactive mode (cursor visible, clicks pass to
  // iframe, overlay only opens via remote/keyboard).
  const hasHtmlAsset = sorted.some((it: any) => it?.asset?.mimeType === 'text/html');
  const isPlaylistInteractive = hasHtmlAsset;
  // 2026-05-26 — repeats > 1 means the operator wants the same content
  // rendered N times across the canvas (LED ribbon use case: 40ft
  // ribbon, repeats=4, content shows every 10ft).
  //
  // Implementation: lazily-loaded iframe tiles. When repeats > 1, the
  // playback surface renders as N <iframe src="/player?tile=K" />
  // elements in a horizontal flex grid. Each iframe loads a fresh
  // player instance against the same screen ID, so they all subscribe
  // to the same manifest + WebSocket and render the same playlist
  // item in lockstep. Score / clock / celebrations stay aligned to
  // within ~50ms (WebSocket fan-out latency).
  //
  // Why iframes instead of in-React duplication: the playback subtree
  // is ~1200 LOC of stateful render with deep coupling to local hooks
  // (currentItem, sorted, playbackStopped, manifest, etc.). Extracting
  // cleanly is a multi-day refactor. Iframes get us the visual
  // outcome (N synchronized tiles) without touching that complexity.
  //
  // VX400 Pro alternative: the operator can ALSO get the same visual
  // outcome by configuring the NovaStar processor's pixel-map to
  // "take a 480×208 region of HDMI and repeat 4× across the ribbon".
  // That's the ZERO-software path and is often easier for an install.
  // Software tile is here for cases where the LED processor can't
  // pixel-map (some cheaper rental rigs).
  //
  // repeats=1 renders identically to before — no iframe, no overhead.
  const tilesCount = Math.max(1, Math.min(12, manifestRepeats || 1));
  const tileMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tile');
  // If THIS instance was loaded as a tile child (?tile=K), skip the
  // repeat logic — render as a normal single-canvas player. The parent
  // iframe is the one doing the tiling.
  const isTileChild = !!tileMode;
  const effectiveTiles = isTileChild ? 1 : tilesCount;

  if (effectiveTiles > 1 && typeof window !== 'undefined') {
    const baseUrl = `${window.location.pathname}?tile=child`;
    return (
      <div
        style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          width: '100vw',
          height: '100vh',
          background: '#000',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'row',
        }}
      >
        {Array.from({ length: effectiveTiles }).map((_, idx) => (
          <iframe
            key={`tile-${idx}`}
            src={baseUrl}
            title={`Ribbon tile ${idx + 1} of ${effectiveTiles}`}
            style={{
              flex: '1 1 0',
              minWidth: 0,
              height: '100%',
              border: 0,
              display: 'block',
            }}
            allow="autoplay"
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`fixed top-0 right-0 bottom-0 left-0 bg-black overflow-hidden ${isPlaylistInteractive ? '' : 'cursor-none'}`}
      // 2026-05-13 — inline-style fallback. Same reasoning as
      // /player/layout.tsx: if Tailwind doesn't apply (CDN reach,
      // WebView caching the old bundle, etc.), this wrapper still
      // sizes correctly and the image/video inside still has a
      // positioned ancestor to fill.
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        width: '100vw',
        height: '100vh',
        background: '#000',
        overflow: 'hidden',
        cursor: isPlaylistInteractive ? undefined : 'none',
      }}
      role={isPlaylistInteractive ? undefined : 'button'}
      tabIndex={isPlaylistInteractive ? -1 : 0}
      aria-label={isPlaylistInteractive ? undefined : 'Toggle screen info overlay'}
      onClick={isPlaylistInteractive ? undefined : () => setShowOverlay(!showOverlay)}
      onKeyDown={e => {
        // Same target-check as the template path above — keeps
        // button keypresses from bubbling into an overlay toggle.
        if (e.target !== e.currentTarget) return;
        if (!isPlaylistInteractive && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault(); setShowOverlay(s => !s);
        }
      }}
    >
      {currentItem && !playbackStopped ? (
        <div
          className={`relative w-full h-full flex items-center justify-center ${isPlaylistInteractive ? '' : 'pointer-events-none'}`}
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: isPlaylistInteractive ? undefined : 'none',
          }}
        >
          {sorted.map((item, index) => {
            const isActive = index === (currentIndex % sorted.length);
            const mime = item.asset?.mimeType || '';
            const isVid = mime.startsWith('video/');
            // Web pages (text/html) and PDFs both render as <iframe>.
            // Browsers natively render PDF inline via the built-in PDF
            // viewer (Chrome / Edge / Firefox / Safari) — which gives
            // operators a working "show this menu PDF on the lobby
            // screen" path without us shipping a custom paginator.
            // Multi-page PDFs auto-display page 1; auto-paging is a
            // future enhancement, but page-1-only is already what
            // every other signage CMS does too.
            const isWeb = mime === 'text/html' || mime === 'application/pdf';
            const fileUrl = item.asset?.fileUrl || '';
            const resUrl = fileUrl.startsWith('http') ? fileUrl : `${getApiRoot()}${fileUrl}`;

            // 2026-05-04 — Video transition smoothing.
            // Operator: "when i push two videos and they loop, i get
            // the default play icon in between the videos autoplaying,
            // just for a second but its not a smooth transition."
            //
            // Old behavior: only mount the active video. On advance,
            // unmount it and mount the next one. The next <video>
            // boots with no buffered frames → browser renders the
            // default play-icon placeholder for 1-2 frames before
            // the first decoded frame arrives. Operator sees that as
            // a "play icon flash" between videos.
            //
            // New: also mount the NEXT video at opacity 0 with
            // preload=auto so it's already buffered when the index
            // advances. The fade-in then has a real frame to fade
            // TO instead of an empty <video> showing the default
            // placeholder. preload=auto only fires when isVid &&
            // (isActive || isNext) so we don't waste bandwidth
            // pre-fetching every video in a long playlist.
            const nextIndex = sorted.length > 0 ? (currentIndex + 1) % sorted.length : -1;
            const isNext = sorted.length > 1 && index === nextIndex;
            // Render video for active OR next-up so the next clip
            // is already decoded by the time it becomes active.
            if (isVid && !isActive && !isNext) return null;
            // Iframes (web pages) keep "active only" — preloading
            // an inactive iframe runs JS and burns CPU even invisible.
            if (isWeb && !isActive) return null;

            // Compute physics class limits
            const trans = item.transitionType || 'FADE';
            let classes = "absolute top-0 right-0 bottom-0 left-0 w-full h-full object-contain transition-all duration-[1000ms] ease-in-out ";
            if (trans === 'FADE') classes += isActive ? "opacity-100 z-10" : "opacity-0 z-0";
            else if (trans === 'SLIDE_LEFT') classes += isActive ? "translate-x-0 z-10" : "translate-x-full z-0";
            else if (trans === 'SLIDE_RIGHT') classes += isActive ? "translate-x-0 z-10" : "-translate-x-full z-0";
            else if (trans === 'SLIDE_UP') classes += isActive ? "translate-y-0 z-10" : "translate-y-full z-0";
            else if (trans === 'SLIDE_DOWN') classes += isActive ? "translate-y-0 z-10" : "-translate-y-full z-0";
            else classes += isActive ? "opacity-100 z-10 duration-0" : "opacity-0 z-0 duration-0";

            if (isVid) {
              // 2026-05-02 — operator: "videos play once and stop. all
              // video files should loop unless they are mixed in with
              // other content; if alone then it just loops non stop".
              //
              // Two distinct behaviors required:
              //   - Solo video playlist (only this item, or every other
              //     item is also THIS same video) → native HTML loop so
              //     the browser handles seamless restart with zero
              //     React re-render gap (smoother on slow hardware too).
              //   - Mixed playlist → onEnded advances to the next item.
              //     When the playlist eventually wraps back to this
              //     video, React re-renders <video> and it auto-plays
              //     from the start — operator gets the desired "loops
              //     when re-encountered" behavior for free.
              //
              // Detection: count how many DISTINCT items the playlist
              // has. 1 distinct item = solo, regardless of how many
              // sequence-order copies there are.
              const distinctItemCount = new Set(sorted.map((s: any) => s.id || s.assetId)).size;
              const isSoloPlaylist = distinctItemCount <= 1;
              return (
                <PlayerVideoSlide
                  key={item.id}
                  videoKey={item.id}
                  src={resUrl}
                  isActive={isActive}
                  classes={classes}
                  isSoloPlaylist={isSoloPlaylist}
                  // 2026-05-05 — manifest carries per-item muted (defaults
                  // TRUE for legacy items missing the field). Operator
                  // toggles this off in the playlist editor when they
                  // want the video to play with sound. Android Player
                  // WebView already has mediaPlaybackRequiresUserGesture
                  // =false so unmuted autoplay is allowed on the kiosk.
                  muted={(item as any).muted}
                  onEnded={() => setCurrentIndex(prev => prev + 1)}
                  onError={() => {
                    console.warn('[Player] video error, skipping:', resUrl);
                    setCurrentIndex(prev => prev + 1);
                  }}
                />
              );
            }
            if (isWeb) {
              // Web pages: route through the API proxy so we can strip
              // X-Frame-Options / CSP frame-ancestors. Without this,
              // any URL pointing at a real-world site (Google, school
              // websites, Hacker News, news outlets) renders as a
              // BLANK iframe because the browser refuses to frame
              // origins that send `X-Frame-Options: DENY` or
              // `SAMEORIGIN`. The proxy fetches the upstream HTML
              // server-side, strips those headers, and serves the
              // body back from our origin so the iframe is allowed
              // to render. Partner reported "i tried to push a URL
              // and still failed" — confirmed the player iframe was
              // bypassing the proxy entirely.
              //
              // PDFs (`application/pdf`) skip the proxy — proxying
              // would corrupt the binary stream. Browsers render PDFs
              // inline natively; X-Frame-Options doesn't apply to
              // file/PDF responses the same way.
              const isPdf = mime === 'application/pdf';
              const nativeUrlOverlayAvailable = !isPdf &&
                typeof window !== 'undefined' &&
                typeof (window as any).EduCmsNative?.showUrlOverlay === 'function';
              if (nativeUrlOverlayAvailable) {
                return (
                  <div
                    key={item.id}
                    className={`${classes} bg-black`}
                    aria-label="Native URL overlay active"
                  />
                );
              }
              // 2026-04-29 — interactive mode RE-ENABLED with the
              // proper proxy URL-rewriting fix shipped same day.
              // Server now (a) rewrites <a href> in the HTML to
              // route through the proxy, (b) injects a fetch + XHR
              // shim that wraps runtime URLs the same way, and (c)
              // relays non-HTML responses (images / JSON / CSS /
              // JS sub-resources) through the proxy with permissive
              // CORS instead of 302-redirecting to upstream.
              // Result: carousel scripts run, link clicks stay
              // inside the proxy chain, asset fetches don't get
              // CORS-blocked, no "blank screen / Android icon"
              // regression.
              const iframeSrc = isPdf
                ? resUrl
                : `${getApiRoot()}/api/v1/proxy/web?url=${encodeURIComponent(resUrl)}&v=2&interactive=true`;
              return <iframe
                key={item.id}
                src={iframeSrc}
                className={classes}
                // No sandbox attribute. The proxy strips <script> tags
                // server-side — that's the frame-busting defense. Adding
                // sandbox="allow-scripts allow-same-origin" was tried
                // briefly and produced a regression (e-arc.com middle
                // section broken too) so reverted to the script-strip
                // baseline. See proxy.controller.ts comments.
                title={item.id}
                onLoad={(e) => {
                  // Sprint 11 — operator: "didnt you apply a fix that
                  // should let me remote control browse the website
                  // and scroll and select the main selectable
                  // buttons?". The fix was wired into WidgetRenderer's
                  // WebpageWidget (template-zone widgets) but NOT this
                  // playback-time iframe (playlist items rendering a
                  // text/html asset). Inject the same spatial-nav
                  // shim here too — same Api boundary, same proxy
                  // origin makes contentWindow.eval legal.
                  const frame = e.currentTarget as HTMLIFrameElement;
                  import('@/components/widgets/webpage-spatial-nav').then(({ injectSpatialNav }) => {
                    if (injectSpatialNav(frame)) {
                      try { frame.contentWindow?.focus(); } catch { /* noop */ }
                    }
                  }).catch(() => { /* never block playback on injection */ });
                }}
                onError={() => {
                  console.warn('[Player] iframe error, skipping:', iframeSrc);
                  setCurrentIndex(prev => prev + 1);
                }}
              />;
            }
            return (
              <img
                key={item.id}
                src={resUrl}
                alt=""
                className={classes}
                // 2026-05-13 — inline-style fallback so the image renders
                // even if Tailwind's `absolute top-0 right-0 bottom-0 left-0 w-full h-full
                // object-contain` utilities fail to apply. Operator was
                // seeing a black screen on a Taurus WebView with the
                // image downloaded but invisible — the parent flex
                // wrapper relies on Tailwind for sizing too. Two
                // belts-and-suspenders: image element gets explicit
                // absolute-fill, opacity flips by isActive so transitions
                // still work.
                style={{
                  position: 'absolute',
                  top: 0, left: 0, right: 0, bottom: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  opacity: isActive ? 1 : 0,
                  zIndex: isActive ? 10 : 0,
                  transition: trans === 'NONE' ? 'none' : 'opacity 1000ms ease-in-out',
                }}
                onError={() => {
                  console.warn('[Player] image error, skipping:', resUrl);
                  if (isActive) setCurrentIndex(prev => prev + 1);
                }}
              />
            );
          })}
        </div>
      ) : (
        <div
          className="absolute top-0 right-0 bottom-0 left-0 bg-slate-50 flex items-stretch justify-center overflow-hidden cursor-default"
          onClick={(e) => e.stopPropagation()}
          role="presentation"
          // 2026-05-13 — Inline-style fallback for Taurus WebViews where
          // Tailwind sometimes fails to load. Operator photo (2026-05-13)
          // showed "Connecting to your CMS..." jammed in the top-left
          // corner of a 960×1080 LED — root cause was `flex justify-center
          // items-stretch p-8` being Tailwind-only, so without the bundle
          // the card landed at the default block-level top-left position.
          // Declaring the same layout inline guarantees centering even
          // when the CSS bundle never arrives.
          //
          // 2026-05-26 — outer container honors --led-w / --led-h set
          // by the pin script in layout.tsx, so the entire splash
          // anchors to the LED canvas instead of the controller's
          // (often wider) frame buffer. clamp() padding shrinks on
          // narrow LEDs (320×1080) but stays comfortable on wider
          // chains (1920×1080).
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            width: 'var(--led-w, 100%)',
            height: 'var(--led-h, 100%)',
            background: '#f8fafc',
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'center',
            padding: 'clamp(8px, 3vw, 32px)',
            overflow: 'hidden',
            cursor: 'default',
          }}
        >
          {/* Decorative background blurs to match Pastel Pop */}
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-400/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-400/20 rounded-full blur-3xl pointer-events-none" />

          {/* 2026-05-04 — operator (Goodview portrait kiosk):
              "you didnt resize the screen properly, i still cant see the
              button at the bottom, you need to always fit all content
              into the screens resolution without clipping anything... as
              soon as the playlist started showing at the bottom that
              pushed the buttons out of view".
              Pre-fix: card had p-12 + flex-col with no max-height,
              children stacked vertically and overflowed past the
              viewport on tall portrait displays once the playlist list
              joined the device cards.
              Post-fix:
                • Card constrained to max-h-full so it can't exceed
                  the viewport.
                • Inner layout split into 3 sections via flex-col:
                    1. HEADER (hero icon + title + subtitle) — fixed.
                    2. SCROLL-BODY (device card grid, playlist list) —
                       overflow-y:auto when content exceeds available
                       space. On a normal-height screen this never
                       activates; on a tall portrait with many
                       playlists, the middle scrolls instead of
                       pushing the buttons off-screen.
                    3. FOOTER (action buttons) — flex-shrink:0 so it
                       NEVER gets squeezed out. Resume / Sync / Exit
                       / Unpair are always visible no matter what's
                       in the middle.
                • Reduced padding p-12 → p-8 to recover ~8% of the
                  screen height, giving the buttons more breathing
                  room on partial-chain LED installs.
              */}
          <div
            className="w-full max-w-5xl max-h-full bg-white/80 backdrop-blur-3xl rounded-[3rem] shadow-[0_20px_60px_rgb(0,0,0,0.06)] border border-white flex flex-col items-center z-10 animate-in fade-in zoom-in-95 duration-700 overflow-hidden"
            // 2026-05-26 — operator: "i have 3 screens connected
            // together... 320x1080 with one then 640x1080 with two
            // then 960x1080 with 3, you need to make it work
            // dynamically all the way up until 6 screens at 1920x1080".
            //
            // Card sizes itself to the LED canvas — width derived
            // from --led-w (set by the pin script in layout.tsx) so
            // padding + border-radius scale linearly with the chain
            // size. min(MAX, max(MIN, calc(LED * RATIO))) keeps
            // Chromium-83 (NovaStar Taurus) compatibility — min/max
            // are Chrome 79+, calc + var are universal, NO cqi/cqw
            // (container queries are Chrome 105+ and would crash
            // the Taurus). CLAUDE.md rule #10 territory.
            //
            // Padding: 8px min, 32px max, 2.5% of canvas width.
            //   320 panel → 8px (clamped to min)
            //   640 chain → 16px
            //   960 chain → 24px
            //   1280+     → 32px (clamped to max)
            // Border-radius: 12px min, 48px max, 4% of canvas.
            //   320 → 12.8 → 13
            //   1920 → 76.8 → 48
            style={{
              width: '100%',
              maxWidth: '100%',
              maxHeight: '100%',
              background: 'rgba(255,255,255,0.8)',
              borderRadius:
                'min(48px, max(12px, calc(var(--led-w, 1024px) * 0.04)))',
              border: '1px solid white',
              padding:
                'min(32px, max(8px, calc(var(--led-w, 1024px) * 0.025)))',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              zIndex: 10,
              overflow: 'hidden',
              color: '#1e293b',
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          >
            {/* 2026-04-28 — operator: "removal of as many other splash
                screens as possible...why cant this screen be the one
                that says connecting to your cms and then just
                refreshes connected". The hero icon + title +
                subtitle now drive off `phase` so this single view
                handles BOTH the connecting and ready-to-receive
                states. The KioskSplash mode='connecting' callsite was
                removed; phase==='connecting' now falls through here.
                Pre-pair splash (KioskSplash mode='pairing') still
                separate — there's no good way to mash a 6-char code
                into this layout and we want the code to be the hero. */}
            {phase === 'connecting' ? (
              <>
                <div
                  className="w-24 h-24 rounded-[2rem] bg-gradient-to-br from-indigo-100 to-indigo-50 shadow-[inset_0_4px_20px_rgb(0,0,0,0.05)] flex items-center justify-center mb-6 ring-4 ring-white"
                  style={{
                    // 2026-05-26 — scale with --led-w. On 320 single
                    // panel, hero shrinks to 48px; on 1920 6-panel
                    // chain, stays at 96px. Chromium-83-safe via
                    // min/max/calc/var (no clamp shorthand needed —
                    // operator's Taurus is Chrome 83). See the outer
                    // card style block above for the strategy.
                    width: 'min(96px, max(48px, calc(var(--led-w, 1024px) * 0.075)))',
                    height: 'min(96px, max(48px, calc(var(--led-w, 1024px) * 0.075)))',
                    borderRadius: 'min(32px, max(12px, calc(var(--led-w, 1024px) * 0.025)))',
                    background: 'linear-gradient(135deg, #e0e7ff 0%, #eef2ff 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 'min(24px, max(8px, calc(var(--led-w, 1024px) * 0.018)))',
                    boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.05), 0 0 0 4px white',
                  }}
                >
                  <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" style={{ width: 'min(48px, max(24px, calc(var(--led-w, 1024px) * 0.04)))', height: 'min(48px, max(24px, calc(var(--led-w, 1024px) * 0.04)))', color: '#6366f1' }} />
                </div>
                <h1
                  className="text-4xl font-extrabold text-slate-800 tracking-tight"
                  style={{ fontSize: 'min(36px, max(16px, calc(var(--led-w, 1024px) * 0.028)))', fontWeight: 800, color: '#1e293b', letterSpacing: '-0.025em', margin: 0, textAlign: 'center', lineHeight: 1.15 }}
                >
                  Connecting to your CMS
                </h1>
                <p
                  className="text-lg font-medium text-slate-500 mt-2 mb-10 text-center"
                  style={{ fontSize: 'min(18px, max(10px, calc(var(--led-w, 1024px) * 0.014)))', fontWeight: 500, color: '#64748b', marginTop: '8px', marginBottom: 'min(40px, max(8px, calc(var(--led-w, 1024px) * 0.03)))', textAlign: 'center', lineHeight: 1.3 }}
                >
                  {loadProgress?.phase === 'manifest' ? 'Fetching your playlist…' :
                   loadProgress?.phase === 'assets' ? 'Downloading content…' :
                   loadProgress?.phase === 'emergency' ? 'Caching emergency content…' :
                   loadProgress?.phase === 'connecting-ws' ? 'Connecting to live updates…' :
                   loadProgress?.phase === 'ready' ? 'Almost ready…' :
                   'Loading your content…'}
                </p>
              </>
            ) : playbackStopped ? (
              <>
                {/* 2026-04-28 — operator: "this screen shouldnt
                    exist...it should just be that other screen paired
                    menu i just sent...consolidate all this shit onto
                    that screen and dump this one...when i exit out of
                    a playlist we go to that white screen paired
                    screen with all this info". The dark KioskSplash
                    mode='stopped' was killed; playbackStopped now
                    falls through to this view with paused-specific
                    hero / playlist list / action buttons. */}
                <div
                  className="w-24 h-24 rounded-[2rem] bg-gradient-to-br from-amber-100 to-amber-50 shadow-[inset_0_4px_20px_rgb(0,0,0,0.05)] flex items-center justify-center mb-6 ring-4 ring-white"
                  style={{
                    // 2026-05-26 — scale with --led-w. On 320 single
                    // panel, hero shrinks to 48px; on 1920 6-panel
                    // chain, stays at 96px. Chromium-83-safe via
                    // min/max/calc/var (no clamp shorthand needed —
                    // operator's Taurus is Chrome 83). See the outer
                    // card style block above for the strategy.
                    width: 'min(96px, max(48px, calc(var(--led-w, 1024px) * 0.075)))',
                    height: 'min(96px, max(48px, calc(var(--led-w, 1024px) * 0.075)))',
                    borderRadius: 'min(32px, max(12px, calc(var(--led-w, 1024px) * 0.025)))',
                    background: 'linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 'min(24px, max(8px, calc(var(--led-w, 1024px) * 0.018)))',
                    boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.05), 0 0 0 4px white',
                  }}
                >
                  <Pause className="w-12 h-12 text-amber-500" style={{ width: 'min(48px, max(24px, calc(var(--led-w, 1024px) * 0.04)))', height: 'min(48px, max(24px, calc(var(--led-w, 1024px) * 0.04)))', color: '#f59e0b' }} />
                </div>
                <h1
                  className="text-4xl font-extrabold text-slate-800 tracking-tight"
                  style={{ fontSize: 'min(36px, max(16px, calc(var(--led-w, 1024px) * 0.028)))', fontWeight: 800, color: '#1e293b', letterSpacing: '-0.025em', margin: 0, textAlign: 'center', lineHeight: 1.15 }}
                >
                  Playback Paused
                </h1>
                <p
                  className="text-lg font-medium text-slate-500 mt-2 mb-10 text-center"
                  style={{ fontSize: 'min(18px, max(10px, calc(var(--led-w, 1024px) * 0.014)))', fontWeight: 500, color: '#64748b', marginTop: '8px', marginBottom: 'min(40px, max(8px, calc(var(--led-w, 1024px) * 0.03)))', textAlign: 'center', lineHeight: 1.3 }}
                >
                  {exitUnavailable
                    ? 'Use your remote’s Home button to return to the launcher.'
                    : 'Content is held. Resume to go back to playback.'}
                </p>
              </>
            ) : (
              <>
                <div
                  className="w-24 h-24 rounded-[2rem] bg-gradient-to-br from-emerald-100 to-emerald-50 shadow-[inset_0_4px_20px_rgb(0,0,0,0.05)] flex items-center justify-center mb-6 ring-4 ring-white"
                  style={{
                    // 2026-05-26 — scale with --led-w. On 320 single
                    // panel, hero shrinks to 48px; on 1920 6-panel
                    // chain, stays at 96px. Chromium-83-safe via
                    // min/max/calc/var (no clamp shorthand needed —
                    // operator's Taurus is Chrome 83). See the outer
                    // card style block above for the strategy.
                    width: 'min(96px, max(48px, calc(var(--led-w, 1024px) * 0.075)))',
                    height: 'min(96px, max(48px, calc(var(--led-w, 1024px) * 0.075)))',
                    borderRadius: 'min(32px, max(12px, calc(var(--led-w, 1024px) * 0.025)))',
                    background: 'linear-gradient(135deg, #d1fae5 0%, #ecfdf5 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 'min(24px, max(8px, calc(var(--led-w, 1024px) * 0.018)))',
                    boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.05), 0 0 0 4px white',
                  }}
                >
                  <CheckCircle2 className="w-12 h-12 text-emerald-500" style={{ width: 'min(48px, max(24px, calc(var(--led-w, 1024px) * 0.04)))', height: 'min(48px, max(24px, calc(var(--led-w, 1024px) * 0.04)))', color: '#10b981' }} />
                </div>
                <h1
                  className="text-4xl font-extrabold text-slate-800 tracking-tight"
                  style={{ fontSize: 'min(36px, max(16px, calc(var(--led-w, 1024px) * 0.028)))', fontWeight: 800, color: '#1e293b', letterSpacing: '-0.025em', margin: 0, textAlign: 'center', lineHeight: 1.15 }}
                >
                  Screen Paired Successfully
                </h1>
                <p
                  className="text-lg font-medium text-slate-500 mt-2 mb-10 text-center"
                  style={{ fontSize: 'min(18px, max(10px, calc(var(--led-w, 1024px) * 0.014)))', fontWeight: 500, color: '#64748b', marginTop: '8px', marginBottom: 'min(40px, max(8px, calc(var(--led-w, 1024px) * 0.03)))', textAlign: 'center', lineHeight: 1.3 }}
                >
                  Waiting for a schedule to be assigned from the dashboard...
                </p>
              </>
            )}

            {/* SCROLL-BODY — device grid + playlist list. flex-1 min-h-0
                lets this shrink + scroll within the parent flex card.
                On a normal-height screen it never scrolls; on a tall
                portrait kiosk with many playlists, the middle scrolls
                instead of pushing the action buttons off-screen. */}
            <div className="flex-1 min-h-0 w-full overflow-y-auto flex flex-col items-center">

            {/* 2026-05-04 — operator: "if we need to combine some of
                the cards lets do it... CMS server and the first M43
                could be combined, just show the connected server up
                there, that gives us more space for the upgrade info
                to pop in and not lose the buttons." Combined Device +
                Server into a single card. Local Storage moved INTO
                the Cache card below (since storage IS cache for our
                purposes). Net effect: 3 cards → 1 + 1 = 2 cards
                stacked, half the vertical footprint. */}
            <div className="w-full max-w-4xl mb-6">
              <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                {(() => {
                  const qp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
                  const w = qp ? (parseInt(qp.get('w') || '0', 10) || window.screen.width) : 0;
                  const h = qp ? (parseInt(qp.get('h') || '0', 10) || window.screen.height) : 0;
                  const apkV = qp?.get('v') || null;
                  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
                  const platform = apkV
                    ? 'Android'
                    : /android/i.test(ua) ? 'Android'
                    : /iphone|ipad|ipod/i.test(ua) ? 'iOS'
                    : /windows/i.test(ua) ? 'Windows'
                    : /mac/i.test(ua) ? 'macOS'
                    : /linux/i.test(ua) ? 'Linux'
                    : 'Browser';
                  const mvRaw = qp?.get('mv');
                  const managerInstalled = mvRaw && mvRaw.trim().length > 0;
                  const managerKnownAbsent = mvRaw === '';
                  const host = typeof window !== 'undefined' ? window.location.hostname : 'Local';
                  return (
                    <div className="flex items-center gap-5">
                      <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                        <Monitor className="w-7 h-7 text-indigo-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-3 flex-wrap">
                          <h3 className="text-base font-bold text-slate-800 truncate">{screenName || 'Display Screen'}</h3>
                          <span className="text-[11px] font-semibold text-slate-400">
                            {w && h ? `${w}×${h}` : ''} {platform ? `• ${platform}` : ''}
                          </span>
                        </div>
                        <div className="text-[11px] font-semibold text-slate-500 mt-0.5 flex items-center gap-x-3 gap-y-1 flex-wrap">
                          {apkV && (
                            <span>Player <span className="text-slate-700 font-bold">v{apkV}</span></span>
                          )}
                          {managerInstalled && (
                            <span>Manager <span className="text-emerald-700 font-bold">v{mvRaw}</span></span>
                          )}
                          {managerKnownAbsent && (
                            <span className="text-amber-700 font-bold flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                              Manager missing
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-semibold text-slate-500 mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap">
                          <span className="flex items-center gap-1.5 text-emerald-700">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Online
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="truncate" title={host}>
                            <Server className="inline w-3 h-3 mr-1 text-violet-500 align-text-bottom" />
                            {host}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span>Last sync: {lastSync || 'Never'}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* 2026-04-29 — operator: "i dont see any updates here, no
                what programs are running, no info on the emergency
                cached data, all the shit that was in those 6 other
                splash screen shuold have been consolidated into this
                screen". Folding the legacy CacheStatusRow + service
                status info onto this view so the operator sees the
                full picture without opening a click-overlay. Two-
                column card under the 3 device cards. */}
            <div className="w-full max-w-4xl mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Cache column.
                  2026-04-29 layout hardening: switched the row layout
                  from `flex justify-between` (which collapsed labels
                  into values on the Goodview G43 4K-portrait panel)
                  to a 2-col grid with explicit `gap`. Tailwind's grid
                  with named gap is supported back to Chromium 84,
                  flex-justify-between with text-runs needs Chromium
                  and flexbox to both behave correctly. Grid is the
                  more reliable primitive here. Also bumped the border
                  from slate-100 to slate-200 + added a subtle
                  shadow-md so the cards are visible against a white
                  page background even when shadow-sm is squashed by
                  panel rendering. */}
              <div className="bg-white rounded-2xl p-5 shadow-md border border-slate-200">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <HardDrive className="w-3.5 h-3.5" /> Storage &amp; Cache
                </div>
                <div className="space-y-2 text-xs">
                  {/* 2026-05-04 — operator: "local storage could
                      include all the Cache info in one card". Folded
                      Local Storage usage bar in here at the top so
                      operator sees disk pressure + cache contents in
                      one card. */}
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 items-center">
                    <span className="text-slate-500">Local storage</span>
                    <span className="font-mono font-semibold text-slate-700 text-right">
                      {storageInfo.used} of {storageInfo.total}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-sky-500 rounded-full transition-all duration-1000" style={{ width: `${storageInfo.percent}%` }} />
                  </div>

                  {/* 2026-05-04 — operator: "my playlist should show
                      the name and how many videos or images, the size
                      of it, etc". Each row now reads:
                          PlaylistName
                          Nv · Mi · S MB · daysOfWeek · time-range
                      where Nv = video count, Mi = image count, S =
                      total bytes for the playlist. */}
                  {manifestPlaylists && manifestPlaylists.length > 0 && (
                    <div className="pt-1.5 border-t border-slate-100 space-y-1.5">
                      {manifestPlaylists.map((pl) => {
                        const days = pl.daysOfWeek ? pl.daysOfWeek.replace(/,/g, ' · ') : 'Every day';
                        const times = pl.timeStart && pl.timeEnd ? `${pl.timeStart}–${pl.timeEnd}` : 'all day';
                        const breakdown: string[] = [];
                        if (pl.videoCount) breakdown.push(`${pl.videoCount} video${pl.videoCount === 1 ? '' : 's'}`);
                        if (pl.imageCount) breakdown.push(`${pl.imageCount} image${pl.imageCount === 1 ? '' : 's'}`);
                        if (pl.otherCount) breakdown.push(`${pl.otherCount} other`);
                        if (breakdown.length === 0 && !pl.isTemplate) breakdown.push(`${pl.itemCount} item${pl.itemCount === 1 ? '' : 's'}`);
                        const sizeChip = pl.totalBytes > 0 ? ` · ${formatBytes(pl.totalBytes)}` : '';
                        return (
                          <div key={pl.id} className="text-[11px]">
                            <div className="font-semibold text-slate-700 truncate">{pl.name}</div>
                            <div className="text-[10px] font-mono text-slate-500 truncate">
                              {pl.isTemplate ? 'Template' : breakdown.join(' · ')}{sizeChip}
                              {' · '}{days} · {times}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!cacheStatus ? (
                    <p className="text-xs text-slate-400 pt-1.5 border-t border-slate-100">Checking cache…</p>
                  ) : !cacheStatus.supported ? (
                    <p className="text-xs text-slate-400 pt-1.5 border-t border-slate-100">Service worker unsupported on this WebView.</p>
                  ) : (
                    <div className="pt-1.5 border-t border-slate-100 space-y-1.5">
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 items-center">
                        <span className="text-slate-500">Playlist assets cached</span>
                        <span className="font-mono font-semibold text-slate-700 text-right">
                          {cacheStatus.playlist.count} · {formatBytes(cacheStatus.playlist.bytes)}
                        </span>
                      </div>
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 items-center">
                        <span className="text-slate-500 flex items-center gap-1.5">
                          <span aria-hidden>🛡️</span> Emergency assets
                        </span>
                        <span className={`font-mono font-semibold text-right ${cacheStatus.emergency.count > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {cacheStatus.emergency.count > 0
                            ? `${cacheStatus.emergency.count} · ${formatBytes(cacheStatus.emergency.bytes)} ✓`
                            : 'NONE — will fetch from network'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Activity / services column. Same grid + shadow
                  hardening as Cache above. */}
              <div className="bg-white rounded-2xl p-5 shadow-md border border-slate-200">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5" /> Activity
                </div>
                <div className="space-y-2 text-xs">
                  {/* 2026-04-29 — operator: "you showed the playlist
                      name of whats loaded on one of the menus...add
                      that to the whit screen". The legacy click-
                      overlay had Playlist + Slide rows; folding them
                      onto the Activity card here. */}
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 items-center">
                    <span className="text-slate-500">Playlist</span>
                    <span className="font-medium text-slate-700 truncate text-right">
                      {playlist?.name || 'None'}
                    </span>
                  </div>
                  {sorted.length > 0 && !playbackStopped && (
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 items-center">
                      <span className="text-slate-500">Slide</span>
                      <span className="font-mono font-semibold text-slate-700 text-right">
                        {(currentIndex % sorted.length) + 1} / {sorted.length}
                      </span>
                    </div>
                  )}
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 items-center">
                    <span className="text-slate-500">Last sync</span>
                    <span className="font-medium text-slate-700 text-right">{lastSync || 'Never'}</span>
                  </div>
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 items-center">
                    <span className="text-slate-500">Heartbeat</span>
                    <span className="font-medium text-emerald-700 flex items-center gap-1.5 justify-end">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Running
                    </span>
                  </div>
                  {/* Last OTA state — populated by the APK's OtaUpdateWorker.
                      When idle or unset, render '—'. */}
                  {otaProgress ? (
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 items-center">
                      <span className="text-slate-500">OTA</span>
                      <span className="font-medium text-indigo-700 text-right">In progress…</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 items-center">
                      <span className="text-slate-500">OTA worker</span>
                      <span className="font-medium text-slate-700 text-right">Scheduled (every 6h)</span>
                    </div>
                  )}
                  {/* Web bundle build SHA — useful when verifying a fresh
                      Vercel deploy actually loaded on this kiosk. */}
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 items-center">
                    <span className="text-slate-500">Web build</span>
                    <span className="font-mono text-[10px] text-slate-600 text-right">
                      {(process.env.NEXT_PUBLIC_BUILD_SHA || '').slice(0, 7) || 'dev'}
                    </span>
                  </div>
                  {/* 2026-04-29 — visible WebView Chromium version
                      diagnostic. Operator suspects G43's runtime
                      compatibility is the root cause of broken
                      splash + non-advancing playlist; this exposes
                      the actual Chromium version + Android version
                      so we can confirm or rule out before more
                      patches. Parses out the Chrome/N.N.N.N segment
                      and the Android N segment from navigator.userAgent.
                      Falls back to the full UA string if neither
                      parses (so we still see something useful). */}
                  {(() => {
                    if (typeof navigator === 'undefined') return null;
                    const ua = navigator.userAgent || '';
                    const chromeMatch = ua.match(/Chrome\/([\d.]+)/);
                    const androidMatch = ua.match(/Android\s*([\d.]+)/);
                    const chrome = chromeMatch ? chromeMatch[1] : null;
                    const android = androidMatch ? androidMatch[1] : null;
                    return (
                      <>
                        <div className="grid grid-cols-[auto_1fr] gap-x-3 items-center">
                          <span className="text-slate-500">Chromium</span>
                          <span className={`font-mono text-[10px] text-right ${chrome && parseInt(chrome.split('.')[0], 10) < 90 ? 'text-rose-700 font-bold' : 'text-slate-600'}`}>
                            {chrome || 'unknown'}
                          </span>
                        </div>
                        <div className="grid grid-cols-[auto_1fr] gap-x-3 items-center">
                          <span className="text-slate-500">Android</span>
                          <span className="font-mono text-[10px] text-slate-600 text-right">{android || 'unknown'}</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Update Available card — operator (2026-04-27): "this is
                also the screen that should show when an upgrade is
                available and also allow me to kick it off, and also
                show the complete status of the upgrade whether i
                trigger it from here or if i push it... feedback
                should be from this screen."
                Compares the APK version (?v= on URL) to the latest
                published GitHub Release. Renders only when the kiosk
                is behind. The Install button calls
                EduCmsNative.checkForUpdates() — same path as the
                dashboard's Push button. */}
            {(() => {
              const apkV = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('v') : null;
              // 2026-04-29 — operator: "i didnt have a playlist up
              // and still saw nothing". Cause: the previous gate
              // `if (!apkV || !latestApkVersion) return null` killed
              // the entire banner block — including the in-progress
              // branch — when latestApkVersion was still being
              // fetched. Push during that window → no banner.
              //
              // New rule: ALWAYS render the in-progress banner when
              // otaProgress is set, regardless of whether we know
              // the latest version yet. The "Update available"
              // amber-banner branch DOES still need both versions to
              // compute isBehind, so the gate moved INTO the
              // available branch instead of the IIFE entrance.
              if (otaProgress) {
                // Fall through to the in-progress render below.
              } else if (!apkV || !latestApkVersion) {
                return null;
              }
              // Simple semver-ish compare. If kiosk is at or past
              // latest, no card. Inflight push (otaProgress is set)
              // takes the card over so we don't show "install" while
              // an install is already running.
              const norm = (v: string) => v.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
              // Defensive null fallbacks — when otaProgress is set we
              // may have entered the IIFE before latestApkVersion
              // loaded; the in-progress branch below doesn't need
              // these but the fallthrough still calls norm().
              const a = norm(apkV || '0.0.0');
              const b = norm(latestApkVersion || '0.0.0');
              let isBehind = false;
              const len = Math.max(a.length, b.length);
              for (let i = 0; i < len; i++) {
                const x = a[i] ?? 0;
                const y = b[i] ?? 0;
                if (x < y) { isBehind = true; break; }
                if (x > y) break;
              }
              if (otaProgress) {
                // 2026-04-29 — REAL stage from server-reported
                // serverOtaState when present, else fall back to
                // elapsed-time estimates. Operator pushed update
                // from dashboard → "i want full feedback on the
                // white screen for that". The OtaUpdateWorker on
                // the APK POSTs CHECKING → DOWNLOADING (with %)
                // → VERIFYING → INSTALLING → INSTALLED at each
                // phase; we surface those exactly.
                const realState = serverOtaState?.state;
                const realProgress = serverOtaState?.progress;
                const realMsg = serverOtaState?.message;
                let stage: { emoji: string; label: string; pct?: number };
                if (realState) {
                  const verLabel = latestApkVersion ? ` v${latestApkVersion}` : '';
                  switch (realState) {
                    case 'CHECKING':
                      stage = { emoji: '📡', label: `Checking for update${verLabel}…` };
                      break;
                    case 'DOWNLOADING':
                      stage = {
                        emoji: '⬇️',
                        label: `Downloading new player${verLabel}${typeof realProgress === 'number' ? ` · ${realProgress}%` : '…'}`,
                        pct: typeof realProgress === 'number' ? realProgress : undefined,
                      };
                      break;
                    case 'VERIFYING':
                      stage = { emoji: '🔍', label: 'Verifying download integrity…' };
                      break;
                    case 'INSTALLING':
                      stage = { emoji: '⚙️', label: 'Installing… (Android prompt may show — tap Install)' };
                      break;
                    case 'INSTALLED':
                      stage = { emoji: '✅', label: `Update complete${verLabel}. Player will restart.` };
                      break;
                    case 'ERROR':
                      stage = { emoji: '⚠️', label: realMsg || 'Update failed — will retry on next OTA tick.' };
                      break;
                    default:
                      stage = { emoji: '📡', label: `Update in progress (${realState})…` };
                  }
                } else {
                  // 2026-05-04 — operator: "says downloading on the
                  // main splash screen but stays at 0% and then flips
                  // to installing". Cause: the elapsed-time fallback
                  // here was making up stage labels based on stopwatch
                  // alone, regardless of what the kiosk was actually
                  // doing. Showed "Downloading" at t=15s even if the
                  // download hadn't started yet.
                  // Fixed: ONLY show stages when the kiosk has reported
                  // a real state via the heartbeat. Until then, just
                  // say "Waiting for kiosk to report status" with the
                  // elapsed time. After 5 min with no real state,
                  // surface a timeout label.
                  const elapsed = Date.now() - otaProgress.startedAt;
                  const elapsedSecs = Math.floor(elapsed / 1000);
                  const elapsedHuman = elapsedSecs < 60
                    ? `${elapsedSecs}s ago`
                    : `${Math.floor(elapsedSecs / 60)}m ${elapsedSecs % 60}s ago`;
                  stage = elapsed < 300_000
                    ? { emoji: '⏳', label: `Update signal sent ${elapsedHuman} — waiting for kiosk to report progress…` }
                    : { emoji: '⏱', label: 'No response after 5 minutes — retry on next reboot or sideload manually' };
                }
                const isError = realState === 'ERROR';
                const isDone = realState === 'INSTALLED';
                const bg = isError ? 'bg-amber-50 border-amber-200' :
                           isDone  ? 'bg-emerald-50 border-emerald-200' :
                                     'bg-indigo-50 border-indigo-200';
                const titleColor = isError ? 'text-amber-900' :
                                   isDone  ? 'text-emerald-900' :
                                             'text-indigo-900';
                const subColor   = isError ? 'text-amber-700' :
                                   isDone  ? 'text-emerald-700' :
                                             'text-indigo-700';
                // 2026-05-06 — operator: "i set the manager to that
                // permission manually and it still doesnt work".
                //
                // Tracing: this banner's "Manager update blocked"
                // error comes from ManagerSelfUpdateWorker (Manager
                // updating ITSELF). The permission-missing error is
                // for MANAGER's REQUEST_INSTALL_PACKAGES — Manager
                // can't prompt the user itself (no MainActivity), so
                // it relies on this dashboard banner + the
                // openSettingsForManager bridge to deep-link the
                // operator to Settings → Apps → Manager.
                //
                // Why "i set it manually and it still doesnt work":
                //   (a) The bridge previously hardcoded
                //       com.educms.manager — the user has the .debug
                //       variant installed (com.educms.manager.debug),
                //       so the deep-link sent them to a phantom app
                //       entry. Fix shipped in MainActivity.kt:
                //       probe PackageManager and target whichever
                //       Manager variant is actually installed.
                //   (b) Worker reported "blocked" at start of every
                //       run REGARDLESS of whether an update existed.
                //       Granting the permission worked, but the next
                //       worker run found no update available, exited
                //       early, never posted a fresh state — the stale
                //       ERROR banner stayed forever. Fix: worker now
                //       posts INSTALLED on every up-to-date run, so
                //       the banner clears on the next periodic tick.
                const errMsg = stage.label || '';
                const isPermissionError = isError && /permission|install unknown apps|unknown apps/i.test(errMsg);
                return (
                  <div className={`w-full max-w-3xl mb-8 rounded-2xl border p-5 ${bg}`}>
                    <div className="flex items-center gap-4">
                      <span className="text-4xl shrink-0">{stage.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className={`text-base font-bold ${titleColor}`}>
                          {isDone ? 'Update complete' : isError ? 'Update issue' : 'Update in progress'}
                        </div>
                        <div className={`text-sm mt-0.5 ${subColor}`}>{stage.label}</div>
                      </div>
                      {isPermissionError && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const bridge = (window as any).EduCmsNative;
                            if (bridge && typeof bridge.openSettingsForManager === 'function') {
                              try { bridge.openSettingsForManager(); return; } catch { /* fall through */ }
                            }
                            // Fallback: Android intent URI for
                            // Settings → Apps → Manager → Install
                            // unknown apps. Tries production first,
                            // then debug. Most Android WebViews honor
                            // `intent:` URLs; if not, operator
                            // follows the manual instructions below.
                            try {
                              const tryHref = (pkg: string) => {
                                window.location.href =
                                  `intent:#Intent;action=android.settings.MANAGE_UNKNOWN_APP_SOURCES;launchFlags=0x10000000;data=package:${pkg};end`;
                              };
                              tryHref('com.educms.manager');
                              setTimeout(() => tryHref('com.educms.manager.debug'), 400);
                            } catch { /* no-op */ }
                          }}
                          className="shrink-0 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition-all shadow-sm"
                        >
                          Grant Manager permission
                        </button>
                      )}
                    </div>
                    {/* Progress bar — only shown when we have a real % */}
                    {typeof stage.pct === 'number' && (
                      <div className="mt-3 h-2 rounded-full bg-indigo-100 overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(0, stage.pct))}%` }}
                        />
                      </div>
                    )}
                    {isPermissionError && (
                      <div className="mt-3 text-xs text-amber-700 leading-relaxed">
                        <strong>If your kiosk shows v1.0.15-debug or earlier Manager:</strong> the "Grant Manager permission" button on Player v1.0.50 and earlier deep-links to the wrong package on debug builds. Fix manually: Settings → Apps → tap <strong>VenueOS Manager</strong> (the one with the “.debug” suffix if there are two) → <strong>Install unknown apps</strong> → <strong>Allow</strong> → tap <strong>Resume</strong> back on this screen. After Player v1.0.51 the button targets the right variant automatically.
                      </div>
                    )}
                  </div>
                );
              }
              if (!isBehind) return null;
              return (
                <div className="w-full max-w-3xl mb-8 rounded-2xl bg-amber-50 border border-amber-200 p-5 flex items-center gap-4">
                  <span className="text-4xl shrink-0">⬆️</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-amber-900">Update available</div>
                    <div className="text-xs text-amber-700 mt-0.5">
                      Player <span className="font-mono font-bold">v{latestApkVersion}</span> is ready to install (you&rsquo;re on <span className="font-mono">v{apkV}</span>).
                    </div>
                  </div>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      // Mirror the dashboard's Push flow on-device:
                      // 1) Show progress overlay so operator sees stages.
                      // 2) Call native bridge to trigger OTA worker.
                      const bridge = (window as any).EduCmsNative;
                      const bridgeAvailable = !!(bridge && typeof bridge.checkForUpdates === 'function');
                      setOtaProgress({ startedAt: Date.now(), bridgeAvailable });
                      if (bridgeAvailable) {
                        try { bridge.checkForUpdates(); } catch (err) {
                          console.warn('[Player] self-update bridge call failed', err);
                        }
                      }
                    }}
                    className="shrink-0 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold rounded-xl transition-all shadow-sm flex items-center gap-2 focus:scale-95 z-20 relative"
                  >
                    <Download className="w-4 h-4" /> Install now
                  </button>
                </div>
              );
            })()}

            {/* 2026-05-04 — playlist-list block REMOVED.
                Operator: "just put the playlist name and all the
                details about it right above the emergency info in
                the cache section". Playlists now render as rows
                inside the Cache card (above the Emergency assets
                row) so they don't take a separate full-width section
                that overflowed the splash on tall portrait kiosks. */}

            </div>
            {/* /SCROLL-BODY end — anything below is the sticky footer
                that NEVER moves regardless of how much content is in
                the middle. */}

            {/* STICKY FOOTER — Action buttons. flex-shrink-0 + mt-6
                guarantees they're always visible at the bottom of the
                splash card, no matter how tall the playlist list grows.
                When paused, Resume is the primary action (emerald) and
                Unpair is demoted to a small text link below. When idle
                (waiting or just paired), Auto-Play is the primary
                action and Unpair sits in the row. */}
            {/* Margin fallback for Chromium 83 / Taurus — `gap` on flex
                containers is Chrome 84+, so a button row that used Tailwind
                `gap-3` rendered with zero spacing. Operator photo
                (2026-05-13) showed "Unpair Sync now Exit Auto-Play" all
                jammed together. Per-button horizontal margin reproduces
                14px between adjacent buttons regardless of gap support. */}
            <style suppressHydrationWarning>{`
              .edu-action-row > button,
              .edu-action-row > * > button {
                margin: 4px 7px !important;
              }
              /* 2026-05-20 — visible remote/D-pad focus indicator.
                 Operator: "when I highlight Resume I get no indicator —
                 the highlight must be hidden behind the bold purple
                 image." Root cause: the per-button focus:ring is a
                 box-shadow at z-20 that the splash's branded (purple)
                 art stacks over, AND the sibling Sync/Exit buttons had
                 no ring at all. Fix every action button at once with a
                 bright OUTLINE (renders outside the box, never clipped by
                 overflow, unlike box-shadow) + a high z-index so the
                 focused button always paints above the splash art.
                 Amber #fde047 is high-contrast on purple, dark navy,
                 emerald, and white alike. outline / outline-offset /
                 z-index are all pre-Chromium-83 CSS (Taurus-safe). */
              .edu-action-row > button:focus,
              .edu-action-row > button:focus-visible,
              .edu-action-row > * > button:focus,
              .edu-action-row > * > button:focus-visible {
                outline: 3px solid #fde047 !important;
                outline-offset: 3px !important;
                position: relative !important;
                z-index: 60 !important;
              }
            `}</style>
            <div
              className="edu-action-row flex flex-wrap items-center justify-center gap-3 flex-shrink-0 mt-6 w-full"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '14px',
                marginTop: '24px',
                width: '100%',
                flexShrink: 0,
              }}
            >
              {playbackStopped ? (
                <>
                  <button
                    // 2026-05-04 — autoFocus on Resume so a kiosk
                    // remote's OK / Enter key triggers it without
                    // any tab navigation. Operator: "i cant hit
                    // back, i cant hit play". Resume is now the
                    // default action; press Enter on the remote to
                    // resume, or press Back to also resume (toggle
                    // behavior wired in the keydown listener above).
                    autoFocus
                    onClick={(e) => {
                      e.stopPropagation();
                      // 2026-05-06 — operator: "i set the manager
                      // to that permission manually and it still
                      // doesnt work and i still get the error". The
                      // pre-fix flow left the stale ERROR banner
                      // forever even after permission was granted —
                      // worker only re-ran on its 6h schedule. Fire
                      // a one-shot OTA recheck on Resume so the
                      // banner clears the moment the user comes back
                      // from Settings.
                      try {
                        const bridge = (window as any).EduCmsNative;
                        if (bridge && typeof bridge.checkForUpdates === 'function') {
                          bridge.checkForUpdates();
                        }
                      } catch { /* no-op */ }
                      setPlaybackStopped(false);
                      setExitUnavailable(false);
                    }}
                    className="px-7 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-2xl transition-all shadow-[0_8px_20px_rgb(16,185,129,0.3)] hover:shadow-[0_8px_25px_rgb(16,185,129,0.4)] hover:-translate-y-0.5 flex items-center gap-2 focus:scale-95 z-20 relative focus:ring-4 focus:ring-emerald-300 focus:outline-none"
                  >
                    <Play className="w-4 h-4 fill-current" /> Resume
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleSyncWithFeedback(); }}
                    disabled={syncFeedback === 'syncing'}
                    className="px-5 py-2.5 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-sm font-bold rounded-2xl transition-all shadow-sm flex items-center gap-2 focus:scale-95 z-20 relative"
                    title="Re-fetch the playlist + force the kiosk to pick up the latest web bundle"
                  >
                    {syncFeedback === 'syncing'
                      ? <><Loader2 className="w-4 h-4 text-indigo-500 animate-spin" /> Syncing…</>
                      : syncFeedback === 'done'
                        ? <><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Synced</>
                        : syncFeedback === 'err'
                          ? <><AlertTriangle className="w-4 h-4 text-amber-500" /> Sync failed</>
                          : <><RefreshCw className="w-4 h-4 text-slate-400" /> Sync now</>}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleExitApp(); }}
                    disabled={exitUnavailable}
                    className="px-5 py-2.5 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-bold rounded-2xl transition-all shadow-sm flex items-center gap-2 focus:scale-95 z-20 relative"
                  >
                    <LogOut className="w-4 h-4 text-slate-400" />
                    {exitUnavailable ? 'Exit unavailable' : 'Exit to launcher'}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={async (e) => {
                    e.stopPropagation();
                    const ok = await appConfirm({
                      title: 'Unpair this screen?',
                      message: 'Tearing down the connection wipes the pairing from this device. The next session will require a new pairing code from the dashboard.',
                      tone: 'danger',
                      confirmLabel: 'Unpair device',
                    });
                    if (ok) handleUnpair();
                  }} className="px-5 py-2.5 bg-white border border-slate-200 hover:border-red-100 hover:bg-red-50 text-slate-700 hover:text-red-600 text-sm font-bold rounded-2xl transition-all shadow-sm flex items-center gap-2 focus:scale-95 z-20 relative group">
                    <Power className="w-4 h-4 text-slate-400 group-hover:text-red-500" /> Unpair
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleSyncWithFeedback(); }}
                    disabled={syncFeedback === 'syncing'}
                    className="px-5 py-2.5 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-sm font-bold rounded-2xl transition-all shadow-sm flex items-center gap-2 focus:scale-95 z-20 relative"
                    title="Re-fetch the playlist + force the kiosk to pick up the latest web bundle"
                  >
                    {syncFeedback === 'syncing'
                      ? <><Loader2 className="w-4 h-4 text-indigo-500 animate-spin" /> Syncing…</>
                      : syncFeedback === 'done'
                        ? <><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Synced</>
                        : syncFeedback === 'err'
                          ? <><AlertTriangle className="w-4 h-4 text-amber-500" /> Sync failed</>
                          : <><RefreshCw className="w-4 h-4 text-slate-400" /> Sync now</>}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleExitApp(); }} className="px-5 py-2.5 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-bold rounded-2xl transition-all shadow-sm flex items-center gap-2 focus:scale-95 z-20 relative">
                    <LogOut className="w-4 h-4 text-slate-400" /> Exit
                  </button>
                  <button onClick={async (e) => {
                    e.stopPropagation();
                    await appAlert({
                      title: 'Nothing to play yet',
                      message: 'No assigned content is currently queued for this screen. Schedule a playlist from the dashboard, then tap Sync now to refresh.',
                      tone: 'info',
                    });
                  }} className="px-7 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-2xl transition-all shadow-[0_8px_20px_rgb(99,102,241,0.3)] hover:shadow-[0_8px_25px_rgb(99,102,241,0.4)] hover:-translate-y-0.5 flex items-center gap-2 focus:scale-95 z-20 relative">
                    <Play className="w-4 h-4 fill-current" /> Auto-Play
                  </button>
                </>
              )}
            </div>
            {playbackStopped && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  const ok = await appConfirm({
                    title: 'Unpair this screen?',
                    message: 'Tearing down the connection wipes the pairing from this device. The next session will require a new pairing code from the dashboard.',
                    tone: 'danger',
                    confirmLabel: 'Unpair device',
                  });
                  if (ok) handleUnpair();
                }}
                className="mt-3 text-xs font-medium text-slate-500 hover:text-red-600 transition-colors px-3 py-1"
              >
                Unpair device
              </button>
            )}
          </div>
        </div>
      )}

      {/* Slide level restriction overlay logic goes here if desired, but UI logic removes the bottom progress bar. */}

      {/* Preview mode chip — always visible so the browser preview tab is
          unmistakably distinct from the real kiosk. */}
      {isPreviewMode() && (
        <div className="absolute top-3 right-3 z-50 flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/90 backdrop-blur-sm text-white text-xs font-black uppercase tracking-wider rounded-full shadow-lg pointer-events-none select-none">
          <Monitor className="w-3.5 h-3.5" />
          Preview Mode
        </div>
      )}

      {/* Overlay */}
      {showOverlay && (
        <div className="absolute top-0 right-0 bottom-0 left-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-900 rounded-2xl p-8 max-w-md w-full mx-4 border border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">{screenName || 'Screen'}</h3>
              <div className="flex items-center gap-2">
                {isPreviewMode() && <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded-full">Preview</span>}
                <Wifi className="w-4 h-4 text-emerald-400" />
                <span className="text-sm text-emerald-400 font-medium">Connected</span>
              </div>
            </div>
            {tenantName && (
              <div className="text-xs text-indigo-300 font-medium -mt-1">
                Paired with <span className="text-indigo-200">{tenantName}</span>
              </div>
            )}
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">Playlist</span><span className="text-white font-medium">{playlist?.name || 'None'}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Slide</span><span className="text-white font-medium">{(currentIndex % (sorted.length || 1)) + 1} / {sorted.length}</span></div>
              <CanvasInfoRow />
              <div className="flex justify-between"><span className="text-slate-400">Last Sync</span><span className="text-white font-medium">{lastSync || 'Never'}</span></div>
              <CacheStatusRow status={cacheStatus} />
              <SoftwareInfoRow />
              <DiagnosticsRow />
            </div>
            <div className="flex gap-2 pt-2 flex-wrap">
              <button
                onClick={(e) => { e.stopPropagation(); handleSyncWithFeedback(); }}
                disabled={syncFeedback === 'syncing'}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-700/60 text-white rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-1.5"
              >
                {syncFeedback === 'syncing' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Syncing…</> : 'Sync Now'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setShowCanvasEditor(true); }}
                title="Set the LED's visible pixel size (overrides the controller's frame buffer)"
                className="py-2 px-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-bold transition-colors"
              >
                Resize for LED
              </button>
              {/* Overlay actions trimmed to Sync + Stop. Exit +
                  Unpair are now on the Stopped splash where they
                  belong (the operator has already paused before
                  making a destructive choice). */}
              <button
                onClick={(e) => { e.stopPropagation(); handleStopPlayback(); }}
                onKeyDown={(e) => e.stopPropagation()}
                title="Stop playback — opens the player splash with Resume / Exit / Unpair"
                className="py-2 px-4 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-bold transition-colors"
              >
                Stop
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes shrink { from { width: 100%; } to { width: 0%; } }
      `}</style>
      {otaOverlay}
      {connectivityToast}
      {unsignedWsBanner}
      {canvasEditor}
      {/* Phase D1.5 — touch builder overlay layer. Renders ABOVE
          all playback chrome but BELOW the emergency override (which
          sits in its own z-index above everything for life-safety
          reasons). Three modes:
            - iframe: visitor tapped an Open URL action with overlay mode
            - video:  visitor tapped Play Video — auto-returns on end
            - asset:  visitor tapped Show Overlay — image/video modal
          Tap-outside dismisses; existing idle-reset also clears.
          Renders nothing when touchOverlay is null. */}
      <TouchOverlay
        overlay={touchOverlay}
        muted={touchMuted}
        onClose={() => setTouchOverlay(null)}
        onSoundToggle={() => setTouchMuted((m) => !m)}
      />
      {/* Phase D1.5 — touch-navigated template overlay. When a
          visitor taps a goto-template action we render the target
          template full-screen with a back chip. Idle-reset returns
          to the home template. Renders nothing when no nav active. */}
      {touchNavigatedTemplate && (
        <TouchNavOverlay
          template={touchNavigatedTemplate}
          onBack={() => setTouchNavigatedTemplate(null)}
        />
      )}
      {/* 2026-05-26 P0-3 — Sprint 5 emergency-message renderer.
          WS-pushed messages (via SOS / TEXT_BROADCAST / MEDIA_ALERT
          types) land in `pushedEmergencyMessage`. When that's null,
          the overlay falls back to polling /emergency/status every
          10s so screens still receive these alerts when the WS path
          is down. Wrapped in tenantId check because the overlay's
          self-poll needs both tenantId AND apiUrl to fire.
          The component renders nothing when there's no active
          message — zero-cost when no emergency is happening. */}
      {tenantId && (
        <EmergencyOverlay
          message={pushedEmergencyMessage}
          tenantId={tenantId}
          apiUrl={`${getApiRoot()}/api/v1`}
          pollMs={10_000}
        />
      )}
      {/* Sprint 13 — CTS scoreboard bridge. Mounted only when:
        *   - URL carries ?cts=1 (operator opt-in; regular kiosks
        *     never see the panel)
        *   - The screen is paired (screenId + tenantId both set, so
        *     a device token exists for the POST)
        *
        * 2026-05-27 — gameId binding. When the operator opens the
        * player with `?cts=1&game=<gameId>&feedToken=<token>` the
        * bridge persists every snapshot to `Game.stats.cts` so the
        * /board /ribbon /scorebug surfaces read CTS as the SOURCE OF
        * TRUTH (see apps/web/src/lib/cts-merge.ts). Without those two
        * params the bridge falls back to its legacy transient
        * WS-broadcast path for the in-page CtsScoreboard widget.
        *
        * The bridge handles Web Serial detection internally — on
        * Safari / Firefox / Chromium 83 it renders nothing. */}
      {tenantId && screenId && qp('cts') === '1' && (
        <CtsBridge
          screenId={screenId}
          apiRoot={getApiRoot()}
          deviceToken={getDeviceToken()}
          gameId={qp('game') || null}
          feedToken={qp('feedToken') || null}
        />
      )}
    </div>
  );
}

/**
 * On-device OTA progress overlay. Mirrors the dashboard's stage
 * progression (sending → downloading → installing → restarting) so
 * the operator at the kiosk and the operator at the dashboard see
 * the same info. Bridge-missing kiosks (legacy v1.0.4 or earlier)
 * get adapted copy explaining the limitation.
 *
 * Bottom-right anchored, full-width-ish band, doesn't cover the
 * actual content. Auto-dismisses on timeout (8 min); a successful
 * install reboots the kiosk which clears all state anyway.
 */
function OtaProgressOverlay({
  startedAt,
  bridgeAvailable,
  onDismiss,
}: {
  startedAt: number;
  bridgeAvailable: boolean;
  onDismiss: () => void;
}) {
  const elapsed = Date.now() - startedAt;

  // No-bridge path (legacy APK that can't react to Push). Show a
  // distinct message so the operator at the kiosk understands the
  // update can't proceed automatically — they need to wait for the
  // 6h periodic worker to run, OR (better) walk to the kiosk and
  // power-cycle it (BOOT_COMPLETED also triggers an OTA check).
  if (!bridgeAvailable) {
    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] max-w-2xl px-6 py-4 rounded-2xl bg-amber-500 text-amber-950 shadow-2xl border border-amber-300 flex items-center gap-3">
        <span className="text-2xl shrink-0">⚠️</span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-base">Update push received — but this kiosk needs an upgrade first</div>
          <div className="text-sm opacity-90 mt-0.5">
            This player APK is too old to install over-the-air. It will pick up the new build on its next 6-hour check or on reboot.
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 w-8 h-8 rounded-full bg-amber-950/20 hover:bg-amber-950/30 flex items-center justify-center font-bold"
        >
          ×
        </button>
      </div>
    );
  }

  // HONESTY FIX (2026-04-27): same change as the dashboard popover.
  // We no longer pretend to know which phase the OTA is in based on a
  // stopwatch — until v1.0.11's worker reports real per-phase events
  // (CHECKING / DOWNLOADING / VERIFYING / INSTALLING / ERROR), all we
  // can honestly say is "we sent the signal N seconds ago, still
  // waiting." When v1.0.11 is on the device this overlay will subscribe
  // to native progress messages via the JS bridge and show real stages.
  const stage: 'pending' | 'timeout' = elapsed < 5 * 60_000 ? 'pending' : 'timeout';

  const stageEmoji = stage === 'pending' ? '⏳' : '⏱';

  const elapsedSecs = Math.floor(elapsed / 1000);
  const elapsedHuman = elapsedSecs < 60
    ? `${elapsedSecs}s ago`
    : `${Math.floor(elapsedSecs / 60)}m ${elapsedSecs % 60}s ago`;

  const stageTitle = stage === 'pending'
    ? 'Player update in progress'
    : 'Update timed out';

  const stageSubtitle = stage === 'pending'
    ? `Update signal received ${elapsedHuman} — kiosk is checking, downloading, and installing the new APK in the background. The screen will restart once install completes.`
    : 'No version change after 5 minutes. The update will retry on next reboot, or sideload via ViPlex Express if it keeps failing.';

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] max-w-2xl px-6 py-4 rounded-2xl bg-indigo-600 text-white shadow-2xl border border-indigo-400/40 flex items-center gap-4">
      <span className="text-3xl shrink-0">{stageEmoji}</span>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-base">{stageTitle}</div>
        <div className="text-sm opacity-90 mt-0.5">{stageSubtitle}</div>
      </div>
      {stage === 'timeout' && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center font-bold"
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Read the currently-effective LED canvas size from URL params or
 * localStorage. Mirrors layout.tsx's pinning logic so the info-overlay
 * row + the editor's initial values stay in sync with what the page is
 * actually rendering. Returns `null` for either dimension if no
 * override is active (player will use the controller's reported w/h).
 */

/**
 * Scales a template designed at (designW × designH) — typically the
 * pre-built 1920×1080 landscape or 2160×3840 portrait master sizes —
 * to fit any LED canvas via CSS transform.
 *
 * Why this matters (operator report 2026-05-13): "the template loads
 * now but its 1080x1920 so cutting off half the screen...what could
 * we do to offer custom resolutions with our pre packaged temapltes?
 * right now they are just 4k landscape or portrait". The pre-built
 * templates are authored at a fixed design resolution (zone positions
 * % of that resolution, widget pixel sizes tuned for that resolution).
 * Without scaling, a 1080×1920 template renders at 1080×1920 inside a
 * 960×1080 LED canvas — the bottom-right gets clipped off-LED.
 *
 * Pattern matches CLAUDE.md "Template Design Workflow" section: wrap
 * the scene in a fixed-size design-resolution div, wrap that in a
 * container that measures its parent and applies transform: scale(N)
 * to fit. fit-contain (Math.min) preserves aspect ratio and never
 * crops — black bars appear on whichever axis doesn't fill. The LED
 * canvas's background color shows through those bars.
 */

/**
 * 2026-05-14 — TouchDiagToast.
 *
 * Temporary diagnostic. Operator reports touch widgets don't respond
 * even though DB confirms the template has isTouchEnabled=true and
 * each TOUCH_POINT zone has a valid touchAction. The manifest fix
 * landed (the info-overlay no longer pops up on tap), but per-zone
 * touch actions still don't fire visibly. Mounting this toast on
 * touch templates lets us SEE on the kiosk itself whether:
 *   - The zone click handler fires at all (edu:touch-zone-click)
 *   - The dispatcher receives the action (edu:touch-fired)
 *   - The action is being rejected as malformed
 * No DevTools required — the toast appears in the top-LEFT for 6s
 * after any tap-related event. Remove the entire block + the three
 * `try { console.log; window.dispatchEvent }` instrumentation sites
 * once the bug is identified.
 */
function TouchDiagToast() {
  const [last, setLast] = useState<null | {
    label: string;
    detail: string;
    tone: 'ok' | 'warn' | 'err';
    ts: number;
  }>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let clearT: any = null;
    const announce = (label: string, detail: string, tone: 'ok' | 'warn' | 'err') => {
      setLast({ label, detail, tone, ts: Date.now() });
      if (clearT) clearTimeout(clearT);
      clearT = setTimeout(() => setLast(null), 6000);
    };
    const onZoneClick = (e: Event) => {
      const ce = e as CustomEvent<any>;
      const d = ce.detail || {};
      if (d.hasAction) {
        announce('zone tap →', `${d.zoneName} (id ${String(d.zoneId).slice(0, 8)})`, 'ok');
      } else {
        announce('zone tap (NO action)', `${d.zoneName} (id ${String(d.zoneId).slice(0, 8)})`, 'warn');
      }
    };
    const onFired = (e: Event) => {
      const ce = e as CustomEvent<any>;
      const d = ce.detail || {};
      const a = d.action || {};
      announce(
        `dispatcher fired: ${a.type || '?'}`,
        `target=${typeof a.target === 'string' ? a.target.slice(0, 40) : '—'}`,
        'ok',
      );
    };
    // 2026-05-14 — render network fetch results from the
    // dispatcher's async paths (currently goto-template; can extend
    // to open-url proxy + asset resolution later). The operator's
    // chip stays "dispatcher fired" forever if a downstream fetch
    // 403s silently. This event lets the toast turn RED on failure.
    const onFetchResult = (e: Event) => {
      const ce = e as CustomEvent<any>;
      const d = ce.detail || {};
      if (d.error) {
        announce(
          `fetch failed: ${d.kind}`,
          `${d.error.slice(0, 60)} (id ${String(d.targetId).slice(0, 8)})`,
          'err',
        );
      } else if (d.ok === false) {
        announce(
          `fetch ${d.status}: ${d.kind}`,
          `${d.status === 403 ? 'forbidden — device JWT not allowed' : 'http error'} (id ${String(d.targetId).slice(0, 8)})`,
          'err',
        );
      } else if (d.ok === true) {
        announce(
          `${d.kind} fetched ok`,
          `loading template… (id ${String(d.targetId).slice(0, 8)})`,
          'ok',
        );
      }
    };
    window.addEventListener('edu:touch-zone-click', onZoneClick as EventListener);
    window.addEventListener('edu:touch-fired', onFired as EventListener);
    window.addEventListener('edu:touch-fetch-result', onFetchResult as EventListener);
    return () => {
      window.removeEventListener('edu:touch-zone-click', onZoneClick as EventListener);
      window.removeEventListener('edu:touch-fired', onFired as EventListener);
      window.removeEventListener('edu:touch-fetch-result', onFetchResult as EventListener);
      if (clearT) clearTimeout(clearT);
    };
  }, []);
  if (!last) {
    return (
      <div
        className="absolute top-3 left-3 z-[1000] flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded shadow-lg pointer-events-none select-none"
        style={{
          background: 'rgba(15, 23, 42, 0.65)',
          color: '#94a3b8',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
        }}
      >
        TOUCH DIAG · waiting for tap…
      </div>
    );
  }
  const bg = last.tone === 'ok' ? 'rgba(16, 185, 129, 0.92)'
    : last.tone === 'warn' ? 'rgba(245, 158, 11, 0.92)'
    : 'rgba(239, 68, 68, 0.92)';
  return (
    <div
      className="absolute top-3 left-3 z-[1000] flex flex-col gap-0.5 px-3 py-2 text-[11px] font-mono rounded-lg shadow-lg pointer-events-none select-none max-w-xs"
      style={{
        background: bg,
        color: '#ffffff',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <span className="font-bold uppercase tracking-wider">{last.label}</span>
      <span className="opacity-90 break-all">{last.detail}</span>
    </div>
  );
}

function TemplateScaler({
  designW,
  designH,
  fitMode = 'auto',
  children,
}: {
  designW: number;
  designH: number;
  /**
   * - contain: fit the WHOLE design inside the LED (letterbox bars
   *   on the axis that doesn't match).
   * - cover: scale to FILL the LED (crop the design's overflow).
   * - auto (default 2026-05-13 — partner's "320×1080 to 1920×1080,
   *   auto-fill all of those" ask): cover when aspect difference is
   *   small (< 25%), contain when it's large. Sensible default that
   *   makes the common 2-panel/portrait-template case fill perfectly
   *   without cropping anything important, while a portrait template
   *   on a 6-panel 16:9 LED still preserves the whole design.
   */
  fitMode?: 'contain' | 'cover' | 'auto';
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  // 'left' for LED-poster shapes (narrow content at native size on a
  // wider frame buffer — full height, so left-aligned not top-left);
  // 'center' for everything else. See compute().
  const [align, setAlign] = useState<'center' | 'left'>('center');
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w <= 0 || h <= 0) return;
      // Effective mode resolution. `auto` looks at aspect mismatch:
      //   designAspect / canvasAspect within ±25% → cover (fills LED,
      //   minor crop on one axis the operator likely won't notice).
      //   beyond 25% → contain (preserves the design, takes black bars
      //   rather than cropping ~half the template off-LED).
      // 25% threshold is empirical: 320×1080 (0.30) vs portrait template
      // (0.56) = 46% diff → contain. 640×1080 (0.59) vs portrait (0.56)
      // = 5% → cover. 1920×1080 (1.78) vs landscape (1.78) = 0% → cover.
      // 960×1080 (0.89) vs portrait (0.56) = 37% → contain.
      let effective: 'contain' | 'cover' = fitMode === 'cover' ? 'cover' : 'contain';
      if (fitMode === 'auto') {
        const canvasAspect = w / h;
        const designAspect = designW / designH;
        const aspectDiff = Math.abs(canvasAspect - designAspect)
          / Math.max(canvasAspect, designAspect);
        effective = aspectDiff < 0.25 ? 'cover' : 'contain';
      }
      const fn = effective === 'cover' ? Math.max : Math.min;
      const s = fn(w / designW, h / designH);
      setScale(s);
      // Poster auto-anchor (2026-05-20): when content renders at native
      // size or LARGER (i.e. NOT downscaled) AND is narrower than the LED,
      // it's an LED-poster shape — e.g. a 320×1080 layout on a 1920 frame
      // buffer. Anchor it TOP-LEFT — the region a NovaStar/TB controller
      // shows by default with NO pixel-mapping — so the poster lights up
      // out of the box with zero controller config and zero on-poster
      // menu fiddling. Anything that fills the LED, or is downscaled to
      // fit, stays centered exactly as before.
      setAlign(s >= 0.999 && designW * s < w - 1 ? 'left' : 'center');
    };
    compute();
    // Two RAFs — first paint may report 0 offsetWidth on the Taurus
    // WebView; the second tick has real dimensions. Same pattern the
    // rainbow-animated theme's useScaleToFit uses, copied for
    // consistency.
    const r1 = requestAnimationFrame(compute);
    const r2 = requestAnimationFrame(() => requestAnimationFrame(compute));
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(compute) : null;
    if (ro) ro.observe(el);
    window.addEventListener('resize', compute);
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [designW, designH, fitMode]);
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: 0, right: 0, bottom: 0, left: 0,
        width: '100%',
        height: '100%',
        display: 'flex',
        // Poster shapes anchor LEFT (full height — the LED is full
        // 1080px tall, so it's left-aligned, not top-left). Everything
        // else stays centered.
        alignItems: 'center',
        justifyContent: align === 'left' ? 'flex-start' : 'center',
        overflow: 'hidden',
      }}
    >
      <div
        // Inner scene at the template's authored design resolution.
        // Zones inside use %-offsets, which now resolve against the
        // design res — matching what the operator saw in the builder.
        style={{
          width: `${designW}px`,
          height: `${designH}px`,
          flexShrink: 0,
          position: 'relative',
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          // Scale from the left edge (vertically centered) for posters so
          // the scaled box stays pinned to x=0; center otherwise.
          transformOrigin: align === 'left' ? 'left center' : 'center center',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function readCanvasOverride(): { w: number | null; h: number | null; fitMode: 'contain' | 'cover' | 'auto' } {
  if (typeof window === 'undefined') return { w: null, h: null, fitMode: 'auto' };
  try {
    const p = new URLSearchParams(window.location.search);
    const urlW = parseInt(p.get('canvasW') || '', 10);
    const urlH = parseInt(p.get('canvasH') || '', 10);
    const lsW = parseInt(localStorage.getItem('edu_canvasW') || '', 10);
    const lsH = parseInt(localStorage.getItem('edu_canvasH') || '', 10);
    // fitMode resolution: URL → localStorage → 'auto' default.
    // 'auto' picks cover for close-aspect matches (320×1080 panels +
    // portrait template fill perfectly), contain for big mismatches
    // (portrait template on 6-panel 16:9 LED preserves whole design).
    const urlFit = (p.get('fitMode') || '').toLowerCase();
    const lsFit = (typeof localStorage !== 'undefined' ? localStorage.getItem('edu_fitMode') || '' : '').toLowerCase();
    const candidate = (urlFit || lsFit || 'auto').toLowerCase();
    const fitMode: 'contain' | 'cover' | 'auto' =
      candidate === 'cover' ? 'cover'
      : candidate === 'contain' ? 'contain'
      : 'auto';
    return {
      w: Number.isFinite(urlW) && urlW > 0 ? urlW : (Number.isFinite(lsW) && lsW > 0 ? lsW : null),
      h: Number.isFinite(urlH) && urlH > 0 ? urlH : (Number.isFinite(lsH) && lsH > 0 ? lsH : null),
      fitMode,
    };
  } catch {
    return { w: null, h: null, fitMode: 'auto' };
  }
}

/**
 * Operator-facing modal that sets the LED's visible-canvas size. The
 * Taurus / NovaStar / Colorlight controllers all force a minimum frame
 * buffer (usually 1920×1080) regardless of the LED's physical pixel
 * count — content rendered to the full frame buffer only displays the
 * top-left portion that overlaps the actual LED panel. The operator
 * pastes in their LED's true size here, we persist to localStorage,
 * then reload with URL params so layout.tsx's beforeInteractive script
 * applies them BEFORE React mounts and resizes html/body accordingly.
 *
 * Inline styles only — Tailwind sometimes fails to load on Taurus
 * WebViews (cert / CDN reach), and the editor MUST be reachable in
 * that failure mode to set the canvas size that fixes everything else.
 */
function CanvasSizeEditor({
  initialW,
  initialH,
  initialFitMode = 'auto',
  onClose,
}: {
  initialW: number | null;
  initialH: number | null;
  initialFitMode?: 'contain' | 'cover' | 'auto';
  onClose: () => void;
}) {
  const [w, setW] = useState(String(initialW || ''));
  const [h, setH] = useState(String(initialH || ''));
  const [fitMode, setFitMode] = useState<'contain' | 'cover' | 'auto'>(initialFitMode);

  const reloadWith = (params: Record<string, string | null>) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    Object.entries(params).forEach(([k, v]) => {
      if (v === null) url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    });
    window.location.href = url.toString();
  };

  const save = () => {
    const wNum = parseInt(w, 10);
    const hNum = parseInt(h, 10);
    if (!wNum || !hNum || wNum < 100 || hNum < 100) {
      // Cheap inline validation. <100px is almost certainly a typo.
      alert('Enter both width and height in pixels (e.g. 960 and 1080).');
      return;
    }
    try { localStorage.setItem('edu_canvasW', String(wNum)); } catch { /* ignore */ }
    try { localStorage.setItem('edu_canvasH', String(hNum)); } catch { /* ignore */ }
    try { localStorage.setItem('edu_fitMode', fitMode); } catch { /* ignore */ }
    reloadWith({ canvasW: String(wNum), canvasH: String(hNum), fitMode });
  };

  const clear = () => {
    try { localStorage.removeItem('edu_canvasW'); } catch { /* ignore */ }
    try { localStorage.removeItem('edu_canvasH'); } catch { /* ignore */ }
    try { localStorage.removeItem('edu_fitMode'); } catch { /* ignore */ }
    reloadWith({ canvasW: null, canvasH: null, fitMode: null });
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: '10px 12px',
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: 'white',
    fontSize: '15px',
    minWidth: 0,
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 100000,
        background: 'rgba(2, 6, 23, 0.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0f172a',
          padding: '24px',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '420px',
          color: 'white',
          border: '1px solid #334155',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}
      >
        <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 6px 0' }}>Resize for LED</h3>
        <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 18px 0', lineHeight: 1.5 }}>
          Set the LED panel's actual visible pixels. The controller's frame buffer is usually
          bigger (1920×1080 minimum on Taurus) but the LED only shows a portion of it.
          <br /><br />
          Examples: <strong>960×1080</strong> for one poster, <strong>320×1080</strong> for an ultra-narrow tower.
        </p>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '18px' }}>
          <input
            type="number"
            inputMode="numeric"
            value={w}
            onChange={(e) => setW(e.target.value)}
            placeholder="Width"
            aria-label="Canvas width in pixels"
            style={inputStyle}
          />
          <span style={{ color: '#64748b', fontSize: '20px' }}>×</span>
          <input
            type="number"
            inputMode="numeric"
            value={h}
            onChange={(e) => setH(e.target.value)}
            placeholder="Height"
            aria-label="Canvas height in pixels"
            style={inputStyle}
          />
        </div>
        {/* One-tap LED-poster presets. Each poster is 320×1080; 1–6 wide.
            Tapping fills the size above with N×320 × 1080 — the controller
            stays on its 1920 frame buffer and the player pins the render
            to the top-left N×320 region the physical posters occupy.
            Per-button margin (not flex `gap`) for Chromium-83 / Taurus. */}
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px', fontWeight: 600 }}>
          Quick set — LED posters (320×1080 each)
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: '18px', marginLeft: '-3px', marginRight: '-3px' }}>
          {[1, 2, 3, 4, 5, 6].map((n) => {
            const pw = n * 320;
            const activeP = String(pw) === w && String(1080) === String(h);
            return (
              <button
                key={n}
                type="button"
                onClick={() => { setW(String(pw)); setH('1080'); }}
                style={{
                  flex: '1 0 28%',
                  margin: '3px',
                  padding: '8px 4px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  border: activeP ? '1px solid #6366f1' : '1px solid #334155',
                  background: activeP ? '#312e81' : '#1e293b',
                  color: 'white',
                  fontSize: '12px',
                  fontWeight: 700,
                  textAlign: 'center',
                  lineHeight: 1.3,
                }}
              >
                {n} poster{n > 1 ? 's' : ''}
                <br />
                <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 400 }}>{pw}×1080</span>
              </button>
            );
          })}
        </div>
        {/* Fit-mode picker. Plain-English labels (no CSS jargon).
            'auto' default picks the right mode based on aspect-diff:
            close-aspect = cover (fills LED); far-aspect = contain
            (preserves whole template with letterbox). Partner ask
            2026-05-13: "each poster is 320×1080 and we may use 1 or
            we may use 6 and everything in between, i want it to auto
            fill all of those if we can". */}
        <div style={{ marginBottom: '18px' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px', fontWeight: 600 }}>
            How should templates fit the LED?
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {([
              {
                key: 'auto' as const,
                title: 'Auto-fit (recommended)',
                desc: 'Fills the screen when the template matches the LED shape. Falls back to letterbox when the shapes are very different — so portrait templates on a wide LED still show fully.',
              },
              {
                key: 'cover' as const,
                title: 'Always fill the screen',
                desc: 'Scales the template up to fill the LED entirely. Crops the parts that overflow off the visible area.',
              },
              {
                key: 'contain' as const,
                title: 'Always show whole template',
                desc: "Never crops. If the template's shape doesn't match the LED, you'll see bars along the edges in the template's background color.",
              },
            ]).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setFitMode(opt.key)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: fitMode === opt.key ? '#6366f1' : '#1e293b',
                  border: fitMode === opt.key ? '1px solid #818cf8' : '1px solid #334155',
                  borderRadius: '8px',
                  color: 'white',
                  fontSize: '12px',
                  fontWeight: fitMode === opt.key ? 700 : 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                  lineHeight: 1.4,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '2px' }}>{opt.title}</div>
                <div style={{ fontSize: '10px', opacity: 0.85 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={save}
            style={{
              flex: '1 1 140px',
              padding: '10px 14px',
              background: '#6366f1',
              border: 'none',
              borderRadius: '8px',
              color: 'white',
              fontWeight: 700,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Save &amp; reload
          </button>
          {(initialW || initialH) ? (
            <button
              onClick={clear}
              style={{
                padding: '10px 14px',
                background: '#334155',
                border: 'none',
                borderRadius: '8px',
                color: 'white',
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Reset
            </button>
          ) : null}
          <button
            onClick={onClose}
            style={{
              padding: '10px 14px',
              background: '#334155',
              border: 'none',
              borderRadius: '8px',
              color: 'white',
              fontWeight: 600,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
