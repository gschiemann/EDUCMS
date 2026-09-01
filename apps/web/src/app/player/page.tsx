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
import { reconcileStrandedEmergency } from './emergencyReconcile';
// 2026-08-01 security wave — pure guard modules (no React/DOM) so each is
// unit-tested without mounting this page.
//   trustGuards — R-01: the `?api=` / localStorage API-root override is the
//     player's entire trust anchor (WS, SSE, manifest, reconcile). Validate it.
//   pushGate    — R-04/R-05: ONE signature+freshness+replay gate shared by the
//     WS and SSE consumers, and the TENANT_CHANGED addressing check.
import { resolveApiRoot, resolveDeviceToken, type ApiRootPolicy } from './trustGuards';
import { checkSensitivePush, isTenantChangeForThisScreen } from './pushGate';
// 2026-08-30 — player reliability program (docs/research/2026-08-30-player-
// reliability-program/). Pure modules, unit-tested without mounting this page:
//   deviceCredential — proactive token renewal + controlled 401 recovery
//     decisions (the G43 credential-expiry deadlock killer);
//   manifestGate — single-flight + coalescing for every fetchContent trigger
//     (stale-response inversion is structurally impossible when reconciles
//     are serialized);
//   pairingLoop — a poll loop whose next tick is the default, so pairing
//     polling can never silently stop again;
//   wsAuthPolicy — WS failures reset on AUTH_OK, not TCP open, so repeated
//     AUTH_FAIL actually reaches the SSE/HTTP fallback ladder.
import { renewalDecision, mayAttemptRecovery } from './deviceCredential';
import { createManifestGate } from './manifestGate';
import { createPairingLoop } from './pairingLoop';
import { createWsAuthPolicy } from './wsAuthPolicy';
// 2026-08-30 deep audit D-1/F1 — serialized chains must bound every await
// ACROSS THE BODY READ, not just headers: a browser fetch has no timeout,
// and one hung socket (or a 200-then-stalled-body proxy) would otherwise
// wedge the manifest gate (including emergency polling), park credential
// recovery forever, or stop the pairing loop. See fetchTimeout.ts.
import { fetchJsonBounded } from './fetchTimeout';
// 2026-08-30 deep audit D-2 — a stalled <video> fires no error and no ended;
// document rAF keeps painting, so the render proof stayed green on a frozen
// frame forever (1.1.6 audit P0-5). Pure detector + a page-level flag the
// proof signature consumes.
import { createMediaStallDetector, setActiveMediaStalled, isActiveMediaStalled } from './mediaStallWatchdog';
// 2026-08-30 deep audit B-P0-1/2/3 — wrap-aware schedule windows + the
// window-edge signature that busts the 304 identity when a window opens or
// closes (windows are constants inside the ETag'd payload, so without this
// a verdict LATCHED: blank at boot-outside-window stayed blank all day).
import { isWindowOpen, windowSignature } from './scheduleWindow';
// 2026-09-01 — WHERE the "Re-pair required" chip may paint. Truth unchanged
// (the dashboard chip + every operator surface still say it, forever); only
// the PERMANENT placement over live public content is retired. Pure module.
import { shouldShowRepairChip, REPAIR_CHIP_BOOT_WINDOW_MS } from './repairChipPolicy';
// 2026-08-25 — ONE definition of "which page bundle am I running", shared by
// the bundle-drift detector (which compares it) and the render-proof POST
// (which reports it to the dashboard). Two answers would be a new lie.
import { readOwnBundleSha, normalizeBundleSha } from './bundleSha';
import { getServiceWorkerContainer, isServiceWorkerAvailable } from '../../lib/safe-service-worker';
// 2026-07-28 — frame-locked multi-screen sync (docs/research/2026-07-28-multiscreen-sync/).
// Pure modules (no React/DOM) so the math is unit-tested without mounting this page.
import { SyncClock } from './sync/syncClock';
import { resolveTimeline, advanceCounterTo, videoTargetMs, type TimelinePosition } from './sync/syncTimeline';
// Sprint 13 — Colorado Time Systems (CTS) System 6/Gen 6 scoreboard
// bridge. Mounts on the player page when the URL carries `?cts=1` (so
// regular signage screens never see the bridge UI). The bridge reads
// the CTS console via Web Serial on the Beelink mini PC, parses the
// scoreboard protocol, and POSTs each game-state snapshot to the API
// for signed-WS fan-out. See packages/scoreboard-cts/README.md.
import { CtsBridge } from '@/components/player/CtsBridge';
import { WidgetPreview } from '@/components/widgets/WidgetRenderer';
import { WidgetErrorBoundary } from '@/components/widgets/WidgetErrorBoundary';
import { useTaurusPolyfills } from '@/components/player/TaurusPolyfills';
import { resolveAssetUrl } from '@/lib/asset-cdn';
import { AllAssetsFailedTracker } from '@/lib/all-assets-failed-tracker';
import { lookupKioskFrame } from '@/lib/kiosk-frame-registry';
import {
  registerOfflineCache,
  precachePlaylist,
  precacheAppShell,
  precacheEmergency,
  getCacheStatus,
  formatBytes,
  isSwSupported,
  type CacheStatus,
} from './offline-cache';
import { appConfirm, appAlert } from '@/components/ui/app-dialog';
// 2026-05-29 — Sentry crash reporting for the player / renderer. Sentry is
// initialized in apps/web/sentry.client.config.ts and is GATED on
// NEXT_PUBLIC_SENTRY_DSN: when the DSN env is unset, Sentry.init() never runs
// and captureException() is a harmless no-op — so wiring it here costs nothing
// on a deploy without Sentry. When the DSN IS set (free tier is plenty), a
// player renderer crash is reported with full stack + component trail so we
// can ship a fix without an operator hand-walking logcat.
import * as Sentry from '@sentry/nextjs';
// AND-002 — the ONLY sanctioned way to reach the Android APK. Prefers the
// origin-scoped `EduCmsNativeChannel` and falls back to the legacy
// `window.EduCmsNative` object. Never touch `window.EduCmsNative`
// directly from this file again; see nativeBridge.ts for why.
import {
  hasNativeBridge,
  nativeCall,
  nativeCallOr,
  nativeFire,
  nativeHas,
  fireUserUpdateCheck,
} from './nativeBridge';
// 2026-09-01 (GUQ/G65/TC22 field find) — the remote Back trap. The APK's Back
// handler walks WebView back-history BEFORE it tells this page anything, and
// every native reload leaves a cross-document entry behind; the trap keeps ONE
// same-document entry on top so every Back lands here. See backTrap.ts.
import { installBackTrapListener, armBackTrap, releaseBackTrap } from './backTrap';
// Display-capability self-report (2026-08-13). The last mile that makes the
// fleet self-describing: without it the native probe is reachable only over
// an adb cable. See displayCapabilityReport.ts for the once-per-version rule.
import {
  reportDisplayCapabilities,
  recordCommandOutcome,
  readCommandOutcomes,
  type DisplayCommandOutcome,
} from './displayCapabilityReport';

/**
 * How long an outcome POST waits for its neighbours (2026-08-25, v1.1.5).
 *
 * Each POST re-probes the device and writes a row, so a burst — an operator
 * dragging the brightness slider, or the same frame arriving on BOTH the WS
 * and the SSE tier — must not become a burst of writes. The outcomes
 * themselves are already on disk in a ring, so coalescing loses nothing.
 */
const OUTCOME_REPORT_COALESCE_MS = 3_000;
// Display-control EMERGENCY INTERLOCK (2026-08-13). The native display
// layer can blank the panel and dim the backlight; while a life-safety
// alert is on screen it must do neither. See emergencyHold.ts for the
// raise-eagerly / release-only-from-the-server-of-record rule.
import { signalDisplayEmergencyHold } from './emergencyHold';
// Display CONTROL — the consumer half (2026-08-13). Everything the operator
// presses on the dashboard (volume / brightness / blank / wake) arrives as a
// signed DISPLAY_CONTROL push, and every on/off schedule arrives in the
// manifest's `display` block. Both are handed to the APK from here. See
// displayControl.ts for the wire-shape translation and the C4 gate.
import {
  DISPLAY_CONTROL_TYPE,
  dispatchDisplayControl,
  installDisplayConfig,
  type DeviceIdentity,
  type SoftBlankSink,
} from './displayControl';

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

/** id of the &lt;style&gt; element injected alongside a 90° body rotation. */
const ROTATION_FIX_STYLE_ID = 'edu-rotation-viewport-fix';

/**
 * Companion to the 90° body rotation — WITHOUT THIS THE ROTATION IS HALF-DONE.
 *
 * ⚠️ THE BUG (2026-08-24, reproduced in a real browser before fixing).
 * Both rotation paths set `body { width:100vh; height:100vw; transform:
 * rotate(90deg) }`, which correctly produces a portrait frame — `body` really
 * does measure 720×1280 on a 1280×720 viewport. The transform also makes body
 * the containing block for `position:fixed` descendants, exactly as the
 * existing comments claim.
 *
 * But **viewport units are always resolved against the VIEWPORT, never against
 * a transformed ancestor.** The player's root `<main>` carries Tailwind's
 * `min-h-screen` (= `min-height:100vh`), so inside that 720×1280 frame it
 * sized itself 720×**720** — a square. Measured live: `main.offsetHeight` was
 * 720 where the frame was 1280. The content therefore rendered as a band with
 * dead space above and below, which is precisely what the operator photographed
 * on a 2160×3840 panel: "the g43 is showing the content shrunk in landscape".
 *
 * The fix is to size the root off its containing block (`100%`) instead of the
 * viewport, which the rotated body has already given an explicit width/height.
 * Verified in-browser BEFORE shipping: injecting this exact rule moved `main`
 * from 720×720 to 720×1280 and corrected its `fixed`-positioned children to
 * 720×1280 as well.
 *
 * `!important` is required — it is overriding a Tailwind utility class.
 * Idempotent, and a no-op to remove when it was never added.
 */
function setRotationViewportFix(on: boolean): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(ROTATION_FIX_STYLE_ID);
  if (!on) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const style = document.createElement('style');
  style.id = ROTATION_FIX_STYLE_ID;
  // Scoped to the direct root only. Deliberately NOT a blanket
  // `[class*="h-screen"]` sweep: widgets and boards legitimately use viewport
  // units for their own scaling maths, and silently redefining those would
  // trade a visible letterbox for a subtle, much harder-to-diagnose drift.
  style.textContent =
    'body > main{width:100%!important;height:100%!important;min-height:100%!important;}';
  document.head.appendChild(style);
}

/** True when running inside the Android player WebView (passed via ?client=android). */
function isAndroidWebView(): boolean {
  if (typeof window === 'undefined') return false;
  if (qp('client') === 'android') return true;
  // Native app exposes a JS bridge — either transport counts.
  return hasNativeBridge();
}

// ── Remote Back trap — MODULE EVALUATION, on purpose (2026-09-01). ──────────
// The popstate listener must be registered before the Next App Router's own
// (a mount effect) so a trap traversal never reaches its ACTION_RESTORE — the
// "resync" the operator saw. And on the APK shell the trap is armed HERE, at
// script evaluation, not at mount: a Back pressed during "Connecting…" on a
// screen with reload history must land on our entry, not on a stale document
// below it. Next's HistoryUpdater rewrites the entry's state at hydration; the
// mount effect re-stamps the marker in place (see armBackTrap). Browser and
// Taurus players arm only while an emergency is displayed (effect below).
if (typeof window !== 'undefined') {
  installBackTrapListener();
  if (isAndroidWebView()) armBackTrap();
}

/** Ask the Android shell to do a hard reload (last-resort recovery). No-op in browser. */
function nativeReload() {
  nativeFire('reload');
}

/**
 * Hard, cache-busting reload used by the stale-bundle / bundle-drift paths.
 *
 * Why not plain `window.location.reload()`: Android System WebView (the
 * kiosk runtime, incl. the NovaStar Taurus Chromium-83 fork) is far more
 * aggressive than desktop Chrome about re-serving the *same* URL from its
 * HTTP cache on a reload — even when the document carries `no-store`. The
 * symptom is exactly the launch-blocking bug we're fixing: a deploy ships,
 * the kiosk "reloads", and the SAME stale JS comes back. Navigating to a
 * URL that differs by one query param (`?_v=<ts>`) forces the WebView to
 * treat it as a brand-new resource and fetch it fresh from the origin.
 *
 * Order of preference:
 *   1. The native bridge (`EduCmsNative.reload()`) when present — the APK's
 *      reload clears the WebView cache itself, so it's already a true hard
 *      reload and preserves the existing URL (the APK owns the URL).
 *   2. Otherwise, `location.replace()` to the same URL with a fresh `_v`
 *      cache-buster. `replace` (not `assign`) keeps the history stack flat
 *      so a kiosk can't accumulate back-entries over weeks of uptime.
 *
 * Existing query params (client=android, preview, fp overrides, etc.) are
 * preserved; only `_v` is (re)written. `Date.now()` is the timestamp — this
 * only ever runs in the browser, so it's deterministic enough.
 */
function hardCacheBustingReload() {
  if (typeof window === 'undefined') return;
  if (nativeFire('reload')) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('_v', String(Date.now()));
    window.location.replace(url.toString());
  } catch {
    // URL API or replace() threw (ancient WebView) — last-resort plain reload.
    try { window.location.reload(); } catch { /* noop */ }
  }
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

// 2026-05-28 — `tel:` + `mailto:` are first-class kiosk touch targets:
// the Phone Button + Email Button touch variants tell the operator (in
// their own picker descriptions) to "pair with open-url tel:+1…" /
// "mailto:…". But isHttpUrl() only accepts http(s), so the open-url
// dispatcher silently rejected those targets and the visitor's tap did
// NOTHING — exactly the "touch widget doesn't function" complaint.
//
// These two schemes are safe to navigate directly: they hand off to the
// OS dialer / mail client and can't exfiltrate the device JWT the way
// `javascript:` / `data:` / `file:` could (which stay blocked). We
// validate the scheme is EXACTLY tel:/mailto: (not a lookalike) before
// allowing it.
export function isContactUrl(u: unknown): u is string {
  if (typeof u !== 'string' || !u) return false;
  try {
    const p = new URL(u).protocol;
    return p === 'tel:' || p === 'mailto:';
  } catch {
    return false;
  }
}

// Thin, override-able navigation seam. Production sets
// `window.location.href` (the cross-browser way to invoke the OS dialer
// / mail client for tel:/mailto:). Exported so tests can assert the
// dispatcher decided to navigate without fighting jsdom's read-only
// `location`. Failures are swallowed — a kiosk WebView with no dialer
// shouldn't throw on a tap.
export const playerNav = {
  go(url: string): void {
    try { window.location.href = url; } catch { /* no-op on locked-down WebViews */ }
  },
};

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
export function dispatchTouchAction(
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
      // 2026-05-28 — tel:/mailto: hand off to the OS dialer / mail
      // client. An iframe overlay can't load these schemes, so navigate
      // them directly. This is what makes the Phone + Email touch
      // variants actually DO something when tapped.
      if (isContactUrl(target)) {
        playerNav.go(target as string);
        return;
      }
      // Phase D1.6 security gate — reject javascript:/data:/file:/etc.
      // (Security review 2026-05-12: rogue operator could exfiltrate
      // the device JWT via window.open('javascript:...')).
      if (!isHttpUrl(target)) {
        try { console.warn('[touch] open-url rejected — not http(s)/tel/mailto:', target); } catch {}
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
      // tel:/mailto: navigate directly (see open-url above).
      if (isContactUrl(target)) {
        playerNav.go(target as string);
        return;
      }
      if (!isHttpUrl(target)) {
        try { console.warn('[touch] url (legacy) rejected — not http(s)/tel/mailto:', target); } catch {}
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

/**
 * Get the device pairing token from URL → localStorage → null.
 *
 * R-01 (adjacent): `?token=` had the same "persist whatever the URL says"
 * shape as `?api=`. A valid token can only be minted by the server, so this
 * is not a repointable trust anchor — but an unvalidated blob still landed in
 * localStorage and then in every Bearer header + the SSE query string. Shape
 * hygiene now runs on BOTH write and read (see `trustGuards.ts`), so junk is
 * never persisted and a previously-poisoned value self-heals.
 */
function getDeviceToken(): string | null {
  if (typeof window === 'undefined') return null;
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { storage = null; }
  return resolveDeviceToken({
    search: window.location.search,
    storage,
    onReject: (reason) => {
      try { console.warn('[Player] rejected device token —', reason); } catch {}
    },
  });
}

/** Compute exponential backoff with full jitter. Capped at maxMs. */
function backoffMs(attempt: number, baseMs = 1000, maxMs = 30_000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 10));
  return Math.floor(Math.random() * exp);
}

// ── Durable REFRESH_WEB via the manifest (2026-08-30, reliability W1-11) ──
//
// The wedge detector used to publish REFRESH_WEB over the push channel only —
// the exact channel that is dead on a wedged screen (35 AUTO_RECOVERY_PUSH_
// DEAD audit rows in the week before this fix). The command now ALSO rides
// the manifest as `refreshRequestedAt`. Semantics are VALUE-IDENTITY, never
// clock comparison (Android boxes run minutes of skew and a timestamp
// inequality would reload-loop them): reload once per distinct value, persist
// the acknowledged value BEFORE acting, echo it on render-proof so the server
// clears the flag. Unreadable storage → do nothing (fail-safe: no ack means
// a reload could loop, so we refuse to start one).
const LS_REFRESH_ACK = 'edu_refresh_ack';
function readRefreshAck(): number | null {
  try {
    const v = localStorage.getItem(LS_REFRESH_ACK);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
function maybeExecuteDurableRefresh(manifest: any): void {
  // The command targets the SCREEN. An admin's "Open in Browser" preview
  // fetches the same manifest — reloading their tab (and consuming the ack
  // into the wrong localStorage) would be both baffling and wrong.
  if (isPreviewMode()) return;
  const req = manifest?.refreshRequestedAt;
  if (typeof req !== 'number' || !Number.isFinite(req)) return;
  let acked: number | null = null;
  try {
    const v = localStorage.getItem(LS_REFRESH_ACK);
    acked = v ? Number(v) : null;
  } catch {
    return; // storage unreadable → cannot guarantee once-only → refuse
  }
  if (acked === req) return;
  try {
    localStorage.setItem(LS_REFRESH_ACK, String(req));
    // B-P2-12 (2026-08-30): some stores ACCEPT the write and don't persist
    // it (ephemeral/partitioned storage). If the read-back disagrees, the
    // once-only guarantee is gone — refuse to reload rather than loop.
    if (localStorage.getItem(LS_REFRESH_ACK) !== String(req)) return;
  } catch {
    return; // ack MUST be durable before we act
  }
  console.warn('[Player] durable REFRESH_WEB arrived via manifest — reloading once');
  setTimeout(() => {
    // Deep-audit C-P1-7 (2026-08-30): this path exists precisely for
    // screens whose push channel is dead — and it burns its once-only ack
    // on the way in, so it must use the STRONGEST reload available, not a
    // bare location.reload() (which the Taurus WebView serves from cache,
    // spending the escape hatch without escaping). Same ladder as the WS
    // REFRESH_WEB arm: native reload first, cache-busting web reload as
    // the fallback. Emergency safety is by construction: the emergency
    // manifest branch never carries refreshRequestedAt, and this helper
    // only runs on live (non-cached) manifests.
    try {
      if (!nativeFire('reload')) hardCacheBustingReload();
    } catch { /* swallow */ }
  }, 250);
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
    // Deepest-audit E-P1-01 (2026-08-30): TENANT-WIDE alerts have NO server
    // expiry BY DESIGN — they last until an explicit, authenticated
    // all-clear. The old 4h client fallback contradicted that: a long
    // lockdown, an offline power cycle past hour four, or a wall-clock jump
    // silently dropped the cached alert and the screen booted to NORMAL
    // CONTENT mid-incident. A cached tenant-wide alert now persists until
    // the server of record clears it (the same rule the overlay + native
    // hold already follow); operator visibility for a stale-held alert is
    // the A-F10 'unconfirmed' chip, not a silent local expiry. Per-screen
    // overrides keep their server-issued absolute expiry.
    localStorage.setItem(LS_EMERGENCY_CACHE, JSON.stringify({
      at: Date.now(),
      expiresAt: serverExpires, // null = no expiry: only the server clears
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
    // E-P1-01 (2026-08-30): entries WITHOUT a server expiry are tenant-wide
    // alerts — they persist until the server clears them; there is no local
    // age-out anymore (see cacheEmergency). Entries WRITTEN by the old code
    // still carry a synthetic 4h `expiresAt` and age out through the check
    // above exactly once, on their own; nothing to migrate.
    void at; void hasServerExpiry; // retained fields, no longer gate reads
    return payload;
  } catch { return null; }
}

/**
 * R-01 (2026-08-01) — the API root is the player's ENTIRE trust anchor: the
 * WebSocket (`getApiRoot().replace(/^http/,'ws')`), the SSE stream, the
 * device-authenticated manifest (the SOLE arbiter of the lockdown overlay) and
 * the stranded-alert reconcile all derive from it. It used to accept any
 * `?api=` value verbatim and persist it to localStorage forever, so a single
 * drive-by load of `/player?api=https://evil.example` permanently handed the
 * screen to an attacker: they become the manifest (fake a lockdown, or
 * suppress a real one) and harvest the device JWT on the first HELLO.
 *
 * The override is now scheme-checked + host-allowlisted on BOTH write and
 * read, so an already-poisoned kiosk self-heals on its next load. Policy and
 * matching rules live in `trustGuards.ts` (unit-tested). The env default below
 * is the trust ROOT and is deliberately not validated against itself.
 */
function apiRootPolicy(): ApiRootPolicy {
  return {
    envApiUrl: process.env.NEXT_PUBLIC_API_URL || null,
    // Escape hatch for staging / on-prem installs. Comma-separated hosts.
    extraHosts: process.env.NEXT_PUBLIC_API_ROOT_ALLOWLIST || null,
    pageOrigin: typeof window !== 'undefined' ? window.location.origin : null,
    isProduction: process.env.NODE_ENV === 'production',
  };
}

function getApiRoot(): string {
  const env = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';
  const fallback = env.replace('/api/v1', '');
  if (typeof window === 'undefined') return fallback;
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { storage = null; }
  return resolveApiRoot({
    search: window.location.search,
    policy: apiRootPolicy(),
    storage,
    fallback,
    onReject: (reason, value) => {
      try { console.warn('[Player] refused untrusted API root —', reason, value); } catch {}
    },
  });
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
// ─── ScaledWebFrame (2026-07-10) ─────────────────────────────────────
// URL-asset auto-fit for narrow LED canvases. Operator pushed a web URL
// to the 960×1080 daisy-chain wall and it "didn't auto fit": the playlist
// iframe fills the canvas region 1:1, so the site laid out at a 960px
// viewport (squeezed tablet layout) instead of reading like a desktop
// page fitted to the board. Fix: when the LED canvas (--led-w/--led-h,
// set by player/layout.tsx from the screen's canvasW/canvasH) is
// narrower than a desktop breakpoint, render the iframe at a VIRTUAL
// 1280-wide viewport and transform:scale it down to the canvas — the
// site sees a desktop viewport, the wall shows the whole page. Canvases
// ≥1280 (every normal TV) keep the exact pre-fix direct iframe: zero
// regression. Automatic — no per-screen setting.
//
// Taurus rule #10: absolute + top/left + explicit width/height only
// (two physical sides — can never serialize to the `inset` shorthand);
// transform:scale is fine on Chromium 83.
const SCALED_WEB_VIRTUAL_W = 1280;
/**
 * Sandbox tokens for every frame that can carry third-party content.
 * `allow-same-origin` is DELIBERATELY ABSENT. These frames are served from
 * OUR origin (/api/v1/proxy/web), so the token would make the sandbox
 * decorative and hand the proxied third-party page parent.document, our
 * localStorage (device token) and top-navigation. (StreamingWidget and
 * FitnessLiveTVWidget DO carry it — but their src is always a foreign host,
 * where the token only restores the frame's own foreign origin. Different
 * situation, opposite answer.)
 *
 * `allow-popups-to-escape-sandbox` is inert without `allow-popups`, which we
 * do not grant; it is listed to pin intent if popups are ever enabled.
 */
const SCALED_WEB_SANDBOX = 'allow-scripts allow-popups-to-escape-sandbox';

function ScaledWebFrame({
  src,
  classes,
  title,
  onLoad,
  onError,
}: {
  src: string;
  classes: string;
  title: string;
  onLoad: (e: React.SyntheticEvent<HTMLIFrameElement>) => void;
  onError: () => void;
}) {
  // Canvas dims resolve post-mount (SSR/hydration safe): first paint is
  // the plain iframe, the effect upgrades to the scaled wrapper only on
  // sub-1280 canvases. One boot-time remount on LED walls — irrelevant
  // for a long-lived kiosk surface.
  //
  // Source precedence mirrors the app's own canvas chain (page.tsx
  // canvas-resize handler + layout.tsx pin script): URL param →
  // localStorage → --led-w CSS var. Reading params/localStorage first
  // (not just the CSS var) matters because a React root regeneration
  // after a hydration mismatch can wipe documentElement's inline styles
  // — observed under `next dev`; the durable sources are immune.
  const [canvas, setCanvas] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const pick = (urlKey: string, lsKey: string, cssVar: string) => {
        const fromUrl = parseInt(p.get(urlKey) || '', 10);
        if (Number.isFinite(fromUrl) && fromUrl > 0) return fromUrl;
        const fromLs = parseInt(localStorage.getItem(lsKey) || '', 10);
        if (Number.isFinite(fromLs) && fromLs > 0) return fromLs;
        const fromCss = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar));
        return Number.isFinite(fromCss) && fromCss > 0 ? fromCss : 0;
      };
      const w = pick('canvasW', 'edu_canvasW', '--led-w');
      const h = pick('canvasH', 'edu_canvasH', '--led-h');
      if (w > 0 && w < SCALED_WEB_VIRTUAL_W && h > 0) {
        setCanvas({ w, h });
      }
    } catch {
      /* no canvas pin → keep direct iframe */
    }
  }, []);

  // SANDBOX (2026-08-02, security wave INJ-001a): this frame carries
  // arbitrary third-party HTML relayed by /api/v1/proxy/web. Without
  // `allow-same-origin` it becomes a null origin — no parent DOM, no access
  // to the player's own-origin localStorage (device token), and no top-level
  // navigation, so a hostile page cannot frame-bust the kiosk to a fake
  // "all clear" screen. Remote-control spatial navigation still works: its
  // shim is baked into the proxied document server-side and armed over
  // postMessage (attachSpatialNavBridge in the onLoad below).
  // NEVER add allow-same-origin here.
  if (!canvas) {
    return (
      <iframe
        src={src}
        className={classes}
        title={title}
        sandbox={SCALED_WEB_SANDBOX}
        onLoad={onLoad}
        onError={onError}
      />
    );
  }

  const scale = canvas.w / SCALED_WEB_VIRTUAL_W;
  const virtualH = Math.round(canvas.h / scale);
  return (
    // Wrapper carries the playlist transition/opacity/z classes so
    // fades/slides behave exactly as before; the iframe inside is a
    // static desktop-viewport surface scaled to the canvas.
    <div className={classes} style={{ overflow: 'hidden' }}>
      <iframe
        src={src}
        title={title}
        sandbox={SCALED_WEB_SANDBOX}
        onLoad={onLoad}
        onError={onError}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: SCALED_WEB_VIRTUAL_W,
          height: virtualH,
          border: 0,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  );
}

// Frame-locked sync — compact stable hash of the playlist signature so the
// dashboard can compare "are these group screens even showing the same
// content?" without shipping the (long) per-item signature. djb2/hex.
function hashContentSig(sig: string): string {
  let h = 5381;
  for (let i = 0; i < sig.length; i++) {
    h = ((h << 5) + h + sig.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

// ─── Frame-locked sync: self-measured latency leads (tier-1, 2026-07-28) ──
// The browser CAN measure its own pipeline: how long a flip decision takes
// to reach a painted frame (React commit + raster, 1-2 frames on good SoCs,
// far more on wheezing kiosk hardware) and how long video.play() takes to
// present a first frame. Each device measures itself (EWMA) and leads its
// flips/prerolls by its own number — silently cancelling per-device
// pipeline differences that the manual trim would otherwise absorb.
// Persisted per device (localStorage — the URL-param/localStorage precedence
// pattern used for edu_canvasW) so a reboot starts calibrated.
const LS_SYNC_RENDER_LEAD = 'edu_sync_render_lead_v1';
const LS_SYNC_VIDEO_LEAD = 'edu_sync_video_lead_v1';

function readStoredLeadMs(key: string, fallback: number, maxMs: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = parseFloat(raw);
    return Number.isFinite(v) && v >= 0 && v <= maxMs ? v : fallback;
  } catch {
    return fallback;
  }
}

function storeLeadMs(key: string, v: number): void {
  try {
    localStorage.setItem(key, String(Math.round(v * 10) / 10));
  } catch { /* private mode / quota — in-memory EWMA still applies */ }
}

// ─── Tier-3 camera-calibration flash overlay (2026-07-28) ────────────────
// Full-screen black with a 120ms white flash on every synced second —
// timed off the SAME trimmed clock the content flips on, so what the
// phone camera measures is exactly the screen's effective display phase
// (including its current trim; the wizard then computes residual deltas).
// Falls back to the coarse AUTH_OK offset if the fine clock isn't locked
// yet. Taurus-safe: longhand positioning, rAF + background writes only.
function CalibrationFlashOverlay({
  clockRef,
  cfgRef,
  coarseOffsetRef,
}: {
  clockRef: { current: SyncClock | null };
  cfgRef: { current: { enabled: boolean; trimMs: number; groupId: string | null } };
  coarseOffsetRef: { current: number };
}) {
  const flashRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      raf = requestAnimationFrame(tick);
      const mono = performance.now();
      const fine = clockRef.current ? clockRef.current.now(mono) : null;
      const base = fine !== null ? fine : Date.now() + coarseOffsetRef.current;
      const t = base + cfgRef.current.trimMs;
      const on = ((t % 1000) + 1000) % 1000 < 120;
      const el = flashRef.current;
      if (el) {
        const want = on ? '#ffffff' : '#000000';
        if (el.style.background !== want) el.style.background = want;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
    // Refs are stable identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={flashRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 8990, // below the emergency overlay — life safety always wins
        background: '#000000',
        pointerEvents: 'none',
      }}
    />
  );
}

// ─── Frame-locked sync diagnostics HUD (?synchud=1) ──────────────────────
// Physical verification tool: point a phone camera (or the webcam rig) at
// two screens showing this HUD — the sweep bar + second-flash make skew
// directly filmable, and the readouts show clock quality live. Greg-style
// proof, per Standard Audit Surface §21.
//
// Taurus-safe by construction: longhand absolute positioning (never the
// `inset` shorthand — CLAUDE.md #10), solid rgba background (no
// backdrop-filter on Chromium 83), margins instead of flex `gap`.
// The sweep/flash are driven via refs from a rAF loop (no React re-render
// per frame); numeric readouts refresh on a 250ms interval.
function SyncHud({
  clockRef,
  posRef,
  activeRef,
  cfgRef,
  statsRef,
}: {
  clockRef: { current: SyncClock | null };
  posRef: { current: TimelinePosition | null };
  activeRef: { current: boolean };
  cfgRef: { current: { enabled: boolean; trimMs: number; groupId: string | null } };
  statsRef: { current: { lastFlipErrMs: number | null; flipErrEwmaMs: number | null } };
}) {
  const sweepRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('sync: acquiring…');

  useEffect(() => {
    let raf = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      raf = requestAnimationFrame(tick);
      const clock = clockRef.current;
      const mono = performance.now();
      const now = clock ? clock.now(mono) : null;
      const t = now !== null ? now + cfgRef.current.trimMs : null;
      if (sweepRef.current && t !== null) {
        const frac = ((t % 1000) + 1000) % 1000 / 1000;
        sweepRef.current.style.left = `${(frac * 100).toFixed(2)}%`;
      }
      if (flashRef.current && t !== null) {
        const inFlash = ((t % 1000) + 1000) % 1000 < 120;
        flashRef.current.style.opacity = inFlash ? '1' : '0';
      }
    };
    raf = requestAnimationFrame(tick);
    const readout = setInterval(() => {
      const clock = clockRef.current;
      const mono = performance.now();
      const s = clock?.stats(mono);
      const pos = posRef.current;
      const st = statsRef.current;
      const state = !cfgRef.current.enabled
        ? 'OFF'
        : activeRef.current
          ? 'LOCKED'
          : 'ACQUIRING';
      const unc = s && Number.isFinite(s.uncertaintyMs) ? `±${s.uncertaintyMs.toFixed(1)}ms` : '±∞';
      const off = s && s.offsetMs !== null ? `${s.offsetMs >= 0 ? '+' : ''}${s.offsetMs.toFixed(1)}ms` : '—';
      const rtt = s && s.rttMs !== null ? `${Math.round(s.rttMs)}ms` : '—';
      const flip = st.flipErrEwmaMs !== null ? `${st.flipErrEwmaMs.toFixed(1)}ms` : '—';
      const idx = pos ? `${pos.index}@${Math.round(pos.offsetInItemMs)}ms` : '—';
      const lead = (() => {
        try {
          const dbg = (window as any).__eduSyncState;
          return dbg && typeof dbg.renderLeadMs === 'number' ? `${dbg.renderLeadMs.toFixed(0)}ms` : '—';
        } catch { return '—'; }
      })();
      const skew = s?.skewPpm != null ? `${s.skewPpm.toFixed(1)}ppm` : '—';
      setText(
        `sync ${state} · clock ${off} ${unc} · rtt ${rtt} · skew ${skew} · slide ${idx} · flip ${flip} · lead ${lead} · trim ${cfgRef.current.trimMs}ms · n=${s?.sampleCount ?? 0}`,
      );
    }, 250);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      clearInterval(readout);
    };
    // Refs are stable identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9500,
        pointerEvents: 'none',
      }}
    >
      {/* Second-flash block — big enough to read on a phone video frame */}
      <div
        ref={flashRef}
        style={{
          position: 'absolute',
          top: 24,
          right: 24,
          width: 96,
          height: 96,
          background: '#ffffff',
          border: '4px solid #000000',
          borderRadius: 12,
          opacity: 0,
        }}
      />
      {/* Sweep track: marker crosses the full width once per synced second */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 14,
          background: 'rgba(0,0,0,0.75)',
        }}
      >
        <div
          ref={sweepRef}
          style={{
            position: 'absolute',
            top: 0,
            left: '0%',
            width: 4,
            height: 14,
            background: '#22d3ee',
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 0,
          padding: '6px 10px',
          background: 'rgba(0,0,0,0.75)',
          color: '#e2e8f0',
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 13,
          lineHeight: '18px',
          borderBottomRightRadius: 8,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function PlayerVideoSlide({
  src,
  isActive,
  classes,
  isSoloPlaylist,
  onEnded,
  onError,
  onPlaying,
  videoKey,
  muted,
  syncItemIndex,
  syncActiveRef,
  syncPosRef,
  syncItemCount,
}: {
  src: string;
  isActive: boolean;
  classes: string;
  isSoloPlaylist: boolean;
  onEnded: () => void;
  onError: () => void;
  /**
   * Frame-locked sync (2026-07-28) — when these are provided AND the
   * conductor is locked AND this slide is the timeline's current item,
   * a servo locks the media clock to the shared timeline slot
   * (docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md §6).
   * Passed as refs (stable identities) so servo updates never re-render
   * the slide. All optional — absent = exact legacy behavior.
   */
  syncItemIndex?: number;
  syncActiveRef?: { current: boolean };
  syncPosRef?: { current: TimelinePosition | null };
  /** Playlist length — the preroll effect needs to know whether THIS
   *  slide is the timeline's next-up item. */
  syncItemCount?: number;
  /** 2026-07-01 — fires on the first real decoded frame. Lets the parent
   *  clear its "every item has failed" tracker on genuine playback, not
   *  just on mount (a video can mount fine and still fail to decode). */
  onPlaying?: () => void;
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
      // Frame-locked sync: a late joiner activates MID-slot — seek to the
      // shared timeline offset instead of 0 so it lands in phase at once.
      try {
        let startMs = 0;
        const pos = syncPosRef?.current;
        if (syncActiveRef?.current && pos && pos.index === syncItemIndex) {
          const fileDurMs = Number.isFinite(v.duration) && v.duration > 0 ? v.duration * 1000 : null;
          startMs = videoTargetMs(pos.offsetInItemMs, fileDurMs);
        }
        v.currentTime = startMs / 1000;
      } catch { /* some browsers reject if not ready */ }

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

  // ── Media-stall watchdog (2026-08-30 deep audit D-2) ────────────────
  // Samples the element every 4 s while this slide is ACTIVE. Frozen
  // currentTime while nominally playing for >12 s = a stall the browser
  // never reports as an error: first episode gets ONE in-place recovery
  // (load() restarts the fetch/decode pipeline), a second episode fails
  // the item through the existing onError path — the rotation must never
  // freeze on one broken file. Under frame-locked sync onError already
  // HOLDS the slot instead of advancing (the conductor owns advancement),
  // so the sync invariant is untouched. The page-level flag makes the
  // stall visible in the render-proof hash instead of green.
  useEffect(() => {
    if (!isActive) return;
    const v = videoRef.current;
    if (!v) return;
    const detector = createMediaStallDetector();
    let recoveries = 0;
    const t = setInterval(() => {
      const verdict = detector.sample(Date.now(), {
        currentTimeMs: v.currentTime * 1000,
        paused: v.paused,
        ended: v.ended,
        seeking: v.seeking,
      });
      setActiveMediaStalled(detector.isStalled());
      if (verdict !== 'stalled') return;
      recoveries += 1;
      if (recoveries === 1) {
        console.warn('[Player] video stalled >12s with no progress — in-place recovery:', src);
        try {
          const at = v.currentTime;
          v.load(); // restart the whole fetch/decode pipeline
          v.muted = isMuted;
          try { v.currentTime = at; } catch { /* not seekable until data arrives */ }
          const p = v.play();
          if (p && typeof p.catch === 'function') p.catch(() => { /* watchdog re-evaluates */ });
        } catch { /* second episode below owns the persistent case */ }
      } else {
        console.warn('[Player] video stalled again after recovery — failing item:', src);
        setActiveMediaStalled(false);
        onError();
      }
    }, 4_000);
    return () => {
      clearInterval(t);
      setActiveMediaStalled(false);
    };
    // onError/src/isMuted are stable-in-behavior parent closures; keying on
    // the item identity (videoKey) resets the detector per slide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, videoKey]);

  // ─── Frame-locked sync: preroll + measured start lead (tier-1) ─────
  // This slide is mounted-hidden as the timeline's NEXT item (parent
  // already mounts next videos with preload=auto). Shortly before the
  // shared boundary we start PLAYING it hidden+muted so decoded frames
  // are already flowing when the flip lands — no first-frame stall, and
  // both screens' videos begin on the boundary rather than
  // play-latency-ms after it. The preroll window adapts to THIS device:
  // play()→first-presented-frame is measured via rVFC and EWMA'd into
  // localStorage. Cleanup never pauses — either the slide activates
  // (activation effect owns it) or the parent unmounts it entirely.
  useEffect(() => {
    if (isActive || syncItemIndex === undefined || !syncActiveRef || !syncPosRef) return;
    if (!syncItemCount || syncItemCount < 2) return;
    const v = videoRef.current;
    if (!v) return;
    let prerolled = false;
    let rvfcId: number | null = null;
    const hasRvfc = typeof (v as any).requestVideoFrameCallback === 'function';
    const t = setInterval(() => {
      if (prerolled) return;
      const pos = syncPosRef.current;
      if (!syncActiveRef.current || !pos) return;
      const prevIndex = (syncItemIndex - 1 + syncItemCount) % syncItemCount;
      if (pos.index !== prevIndex) return;
      const videoLead = readStoredLeadMs(LS_SYNC_VIDEO_LEAD, 150, 1000);
      const prerollMs = Math.max(250, Math.min(1200, 250 + videoLead));
      if (pos.boundaryAtMs - pos.atMs > prerollMs) return;
      prerolled = true;
      try {
        v.muted = true; // never leak audio while hidden; activation restores
        try { v.currentTime = 0; } catch { /* not seekable yet */ }
        const playCalledAtMono = performance.now();
        const p = v.play();
        if (p && typeof p.catch === 'function') p.catch(() => { /* activation retries */ });
        if (hasRvfc) {
          rvfcId = (v as any).requestVideoFrameCallback(() => {
            const measured = performance.now() - playCalledAtMono;
            if (Number.isFinite(measured) && measured >= 0 && measured <= 2000) {
              const prev = readStoredLeadMs(LS_SYNC_VIDEO_LEAD, 150, 1000);
              storeLeadMs(LS_SYNC_VIDEO_LEAD, Math.max(0, Math.min(1000, prev * 0.7 + measured * 0.3)));
            }
          });
        }
      } catch { /* best-effort — activation still plays */ }
    }, 120);
    return () => {
      clearInterval(t);
      if (hasRvfc && rvfcId !== null) {
        try { (v as any).cancelVideoFrameCallback(rvfcId); } catch { /* noop */ }
      }
    };
    // Refs are stable; index/count constant per mounted slide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, syncItemIndex, syncItemCount]);

  // ─── Frame-locked sync servo (2026-07-28) ──────────────────────────
  // Locks the media clock to the shared timeline slot. Measured browser
  // prior art (W3C timing / MediaSync) holds ±7ms with exactly this
  // seek + playbackRate-servo pattern — see research doc 02 §C2/§D.
  //
  //   |err| > 400ms → precise seek (+80ms lead for seek latency)
  //   |err| > 12ms  → playbackRate chase, capped ±4% (invisible; muted
  //                   signage video makes pitch moot anyway)
  //   else          → rate 1.0 (deadband)
  //
  // Measurement uses requestVideoFrameCallback where available (glass-
  // level mediaTime; shipped in Chromium 83 = the Taurus floor, but
  // feature-detected because WebView builds vary) with a currentTime
  // fallback. 250ms cadence — research: hold corrections ≥250ms to
  // avoid servo hunting. If the file is shorter than the slot the
  // target loops (offset mod file length) and error takes the shortest
  // path around the loop, so both screens loop in phase.
  useEffect(() => {
    if (!isActive || syncItemIndex === undefined || !syncActiveRef || !syncPosRef) return;
    const v = videoRef.current;
    if (!v) return;
    let stopped = false;
    let lastMediaTimeMs: number | null = null;
    let rvfcId: number | null = null;
    const hasRvfc = typeof (v as any).requestVideoFrameCallback === 'function';
    if (hasRvfc) {
      const onFrame = (_now: number, meta: any) => {
        if (stopped) return;
        if (meta && typeof meta.mediaTime === 'number') lastMediaTimeMs = meta.mediaTime * 1000;
        rvfcId = (v as any).requestVideoFrameCallback(onFrame);
      };
      rvfcId = (v as any).requestVideoFrameCallback(onFrame);
    }
    const servo = setInterval(() => {
      if (stopped) return;
      const pos = syncPosRef.current;
      if (!syncActiveRef.current || !pos || pos.index !== syncItemIndex) {
        if (v.playbackRate !== 1) v.playbackRate = 1;
        return;
      }
      const fileDurMs = Number.isFinite(v.duration) && v.duration > 0 ? v.duration * 1000 : null;
      const target = videoTargetMs(pos.offsetInItemMs, fileDurMs);
      const actual = lastMediaTimeMs !== null ? lastMediaTimeMs : v.currentTime * 1000;
      lastMediaTimeMs = null; // consumed — next presented frame refreshes it
      let err = target - actual;
      if (fileDurMs && Math.abs(err) > fileDurMs / 2) {
        // Looping slot: near the wrap the raw difference looks like ±file
        // length — take the shortest path around the loop instead.
        err = err > 0 ? err - fileDurMs : err + fileDurMs;
      }
      if (!Number.isFinite(err)) return;
      if (Math.abs(err) > 400) {
        try {
          let seekMs = target + 80; // static seek-latency lead
          if (fileDurMs && seekMs >= fileDurMs) seekMs -= fileDurMs;
          v.currentTime = Math.max(0, seekMs) / 1000;
        } catch { /* not seekable yet — next tick retries */ }
        if (v.playbackRate !== 1) v.playbackRate = 1;
      } else if (Math.abs(err) > 12) {
        v.playbackRate = 1 + Math.max(-0.04, Math.min(0.04, err / 2000));
      } else if (v.playbackRate !== 1) {
        v.playbackRate = 1;
      }
    }, 250);
    return () => {
      stopped = true;
      clearInterval(servo);
      if (hasRvfc && rvfcId !== null) {
        try { (v as any).cancelVideoFrameCallback(rvfcId); } catch { /* noop */ }
      }
      try { v.playbackRate = 1; } catch { /* noop */ }
    };
    // syncActiveRef/syncPosRef are stable ref objects; syncItemIndex is
    // constant per mounted slide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, syncItemIndex]);

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
        // 2026-06-26 — auto-fit: stretch the video to fill the screen (see the
        // image render). Inline overrides the object-fill class.
        objectFit: 'fill',
        background: '#000',
      }}
      muted={isMuted}
      playsInline
      loop={isSoloPlaylist}
      onEnded={isSoloPlaylist ? undefined : onEnded}
      onError={onError}
      onPlaying={onPlaying}
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
 * One-shot async read of the APK's `deviceInfo()`, cached into the same
 * localStorage key `resolvePlayerVersion` already reads. Exists because
 * the AND-002 bridge channel is message-passing (async) while
 * `resolvePlayerVersion` has synchronous callers. Safe to call on every
 * resolve — it self-guards after the first invocation.
 */
let deviceInfoPrimed = false;
function primeNativeDeviceInfo(): void {
  if (deviceInfoPrimed || typeof window === 'undefined') return;
  deviceInfoPrimed = true;
  if (!nativeHas('deviceInfo')) return;
  nativeCall<string>('deviceInfo')
    .then((raw) => {
      if (!raw) return;
      const info = JSON.parse(raw);
      if (info?.appVersion) {
        localStorage.setItem('edu_player_apk_version', String(info.appVersion));
      }
    })
    .catch(() => { /* browser player or old APK — sources 1 and 3 cover it */ });
}

/**
 * Resolve the player APK version from any of three sources, in order
 * of precedence. Defensive against URL-param loss on navigation /
 * page reload (operator caught us on 2026-04-27: kiosk on v1.0.11
 * but dashboard chip stuck blank).
 *
 *   1. URL ?v= / ?vc= — set by the APK via MainActivity.loadPlayer
 *   2. deviceInfo() bridge — always available on APK (returns
 *      appVersion in JSON), survives any in-page navigation
 *   3. localStorage — sticky cache so even a hard reload of the
 *      WebView keeps the version in heartbeats while we wait for
 *      the bridge to come back online
 *
 * AND-002 note: source 2 used to be a SYNCHRONOUS bridge call, and this
 * function has sync callers (buildHeartbeatUrl) that would be very
 * invasive to make async. So the bridge read is now primed once, off to
 * the side, and lands in source 3 — see primeNativeDeviceInfo. In
 * practice source 1 already covers the APK's first load (loadPlayer
 * always appends ?v=), so the only window where this differs is the
 * very first heartbeat after an in-page navigation that dropped the
 * query params on a device with an empty localStorage — and the prime
 * fills that in a microtask.
 */
function resolvePlayerVersion(): { v: string | null; vc: string | null } {
  if (typeof window === 'undefined') return { v: null, vc: null };

  // 1. URL params (initial APK URL)
  const params = new URLSearchParams(window.location.search);
  let v = params.get('v') || null;
  let vc = params.get('vc') || null;

  // 2. Native bridge — async now; result lands in localStorage below.
  primeNativeDeviceInfo();

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
    let cancelled = false;
    if (!nativeHas('deviceInfo')) return;
    nativeCall<string>('deviceInfo')
      .then((raw) => {
        if (cancelled || !raw) return;
        const info = JSON.parse(raw);
        if (info?.appVersion) setApkVersion(info.appVersion);
      })
      .catch(() => { /* browser player — leave as null */ });
    return () => { cancelled = true; };
  }, []);

  const handleCheck = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setChecking(true);
    setLastCheckMsg(null);
    try {
      // Preferred path: 1.0.6+ native bridge enqueues the OTA worker
      // right now. The worker handles the full download+install dance,
      // so we just tell the operator we've asked.
      if (nativeHas('checkForUpdates')) {
        const ver = await nativeCallOr<string>('', 'checkForUpdates');
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
  // ⚠️ These two MUST stay above the early return below. They were briefly
  // declared further down, next to handleEnroll, which made them CONDITIONAL
  // hooks — on a screen with no native bridge the component returns before
  // them, so the hook order changes the moment the bridge appears and React
  // throws #310, taking the whole player down. The rules-of-hooks CI gate
  // caught it; do not move them back for tidiness.
  const [enrolling, setEnrolling] = useState(false);
  const [enrollMsg, setEnrollMsg] = useState<string | null>(null);

  if (!nativeHas('getRecentLogs')) return null;

  const loadLogs = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(true);
    setLogs('(reading device log…)');
    try {
      const raw = await nativeCall<string>('getRecentLogs');
      setLogs(typeof raw === 'string' ? raw : JSON.stringify(raw));
    } catch (err: any) {
      setLogs('(error reading logs: ' + (err?.message || String(err)) + ')');
    }
  };

  const handleUpload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setUploading(true);
    setUploadMsg(null);
    try {
      if (!nativeHas('uploadDiagnostics')) {
        setUploadMsg('uploadDiagnostics not available');
      } else {
        const result = await nativeCall<string>('uploadDiagnostics');
        setUploadMsg(result || 'upload triggered');
      }
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

  // ── One-tap device-admin enrolment ────────────────────────────────────
  //
  // THE CALLER for `displayEnrollAdmin`. The enrolment wave built the whole
  // native side — PlayerAdminReceiver, the state machine, the bridge method —
  // and the review correctly filed "no caller in any web bundle" as a P0.
  // This is that caller.
  //
  // WHY IT MATTERS: DeviceAdminBlankProvider gives a REAL panel blank via
  // DevicePolicyManager.lockNow(), which needs an ACTIVE DEVICE ADMIN. That is
  // NOT device owner — no factory reset, no adb, no accounts constraint, just
  // one operator tap through the system dialog. Without it, blank falls
  // through to the screen-timeout provider (needs the WRITE_SETTINGS appop,
  // i.e. adb) or the software dim floor, which does not really turn the panel
  // off and saves no power.
  //
  // WHY IT LIVES HERE and not in the dashboard: the dashboard runs in a
  // browser and cannot reach the native bridge at all. Enrolment has to be
  // initiated from inside the APK's WebView, and this panel is the established
  // operator-on-device surface. The dashboard's job is to TELL you which
  // screens still need the tap — the probe reports `enrollment.oneTapAvailable`
  // for exactly that.
  //
  // Deliberately inside the expanded panel: enrolment must never fire
  // automatically or nag. A signage box that pops a system security dialog on
  // a wall in front of customers is worse than a screen that dims in software.
  const canEnroll = nativeHas('displayEnrollAdmin');

  const handleEnroll = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setEnrolling(true);
    setEnrollMsg(null);
    try {
      const raw = await nativeCall<string>('displayEnrollAdmin');
      // Native answers a JSON status string. Surface its own message when it
      // has one rather than inventing our own — it knows why it declined
      // (already enrolled, recently declined, no operator present).
      let msg = 'Follow the prompt on this screen.';
      try {
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object') {
          if (parsed.ok === false) {
            msg = typeof parsed.code === 'string' ? `Not started: ${parsed.code}` : 'Not started.';
          } else if (typeof parsed.state === 'string') {
            msg = `Enrolment: ${parsed.state}`;
          }
        }
      } catch {
        /* non-JSON answer — keep the generic prompt message */
      }
      setEnrollMsg(msg);
    } catch (err: any) {
      setEnrollMsg('error: ' + (err?.message || String(err)));
    } finally {
      setEnrolling(false);
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
          {canEnroll && (
            <div className="pt-2 border-t border-slate-700/60 space-y-1">
              <button
                onClick={handleEnroll}
                disabled={enrolling}
                className="w-full py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-md text-[11px] font-medium transition-colors"
              >
                {enrolling ? 'Opening…' : 'Enable scheduled screen off'}
              </button>
              <p className="text-[10px] text-slate-400 leading-snug">
                Lets this screen really power its panel down on a schedule
                instead of just dimming the image. Android will ask you to
                confirm once.
              </p>
              {enrollMsg && (
                <p className="text-[10px] text-slate-400 leading-snug">{enrollMsg}</p>
              )}
            </div>
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

/**
 * FitToViewport — life-safety scale-to-fit (LANE 1, 2026-06-27).
 *
 * Measures the natural content size vs the available box and scales the whole
 * block DOWN (never up) with a CSS transform so the message is ALWAYS the
 * largest size that fully fits — on 960×1080 portrait, 320×1080 ribbons, 4K,
 * anything. Used by the crash-recovery cached-emergency screen below, which
 * previously rendered FIXED sizes (text-7xl headline, w-32 icon, text-3xl
 * body, p-12) centered with NO fit → a real lockdown message wrapped taller
 * than a narrow/portrait canvas and was CLIPPED top AND bottom (the exact
 * cutoff class Greg caught on the live 960×1080 LED).
 *
 * transform:scale is Chromium-83-safe (Taurus). longhand top/right/bottom/left,
 * no `inset` (CLAUDE.md rule #10). Re-measures on resize + font load. A
 * one-frame unscaled flash self-corrects instantly.
 *
 * Mirrors the same component in apps/web/src/components/player/EmergencyOverlay.tsx
 * (kept local here so the crash boundary — a class component that can't use
 * hooks — can compose it without importing render internals).
 */
function FitToViewport({ children, padding = 40 }: { children: ReactNode; padding?: number }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const measure = () => {
      const outer = outerRef.current;
      const inner = innerRef.current;
      if (!outer || !inner) return;
      const aw = outer.clientWidth - padding * 2;
      const ah = outer.clientHeight - padding * 2;
      // scrollWidth/Height = the UNtransformed natural size (transform is
      // visual only, doesn't change the layout box), so this never feeds back.
      const cw = inner.scrollWidth;
      const ch = inner.scrollHeight;
      if (cw <= 0 || ch <= 0 || aw <= 0 || ah <= 0) return;
      const s = Math.min(1, aw / cw, ah / ch);
      setScale(s > 0 && Number.isFinite(s) ? s : 1);
    };
    measure();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      if (outerRef.current) ro.observe(outerRef.current);
      if (innerRef.current) ro.observe(innerRef.current);
    }
    const fonts = (document as { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (fonts?.ready?.then) fonts.ready.then(measure).catch(() => {});
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [children, padding]);

  return (
    <div
      ref={outerRef}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div
        ref={innerRef}
        style={{
          transform: scale < 1 ? `scale(${scale})` : undefined,
          transformOrigin: 'center center',
        }}
      >
        {children}
      </div>
    </div>
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
    // 2026-05-29 — report the player/renderer crash to Sentry. No-op unless
    // NEXT_PUBLIC_SENTRY_DSN is configured (Sentry.init gates on it in
    // sentry.client.config.ts), so this is free on a deploy without Sentry.
    // We tag it as a player renderer crash + attach the React component
    // stack so a kiosk that crash-loops in the field is diagnosable remotely
    // (closes the "Sentry UNCHECKED" item in apps/player/README.md). Wrapped
    // in try/catch so a Sentry failure can NEVER block the crash-recovery
    // reload path below — recovery is life-safety-adjacent and must proceed.
    try {
      Sentry.captureException(err, {
        tags: { surface: 'player', subsystem: 'renderer' },
        contexts: {
          react: { componentStack: String(info?.componentStack || '').slice(0, 4000) },
        },
      });
    } catch { /* never let crash reporting block crash recovery */ }
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
      // Life-safety override survives the crash. Wrapped in FitToViewport
      // (2026-06-27, LANE 1) so the cached lockdown message is NEVER clipped
      // on a 960×1080 portrait / 320×1080 ribbon / 4K canvas — the fixed
      // sizes below (text-7xl headline, w-32 icon, text-3xl body) wrapped
      // taller than a narrow canvas and were cut off top/bottom before the
      // fit wrapper (the same cutoff class Greg caught on the live LED).
      // 2026-06-28 — size the crash-emergency root to the LED CANVAS (not the
      // 1920 frame-buffer viewport), anchored top-left, so the cached takeover
      // isn't cropped by half on a 960-wide panel during a crash. Same fix as
      // the live EmergencyOverlay. Falls back to full viewport when no override.
      const led = readCanvasOverride();
      return (
        <div
          className="fixed bg-red-700 text-white"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            ...(led.w && led.h
              ? { width: `${led.w}px`, height: `${led.h}px` }
              : { right: 0, bottom: 0 }),
          }}
        >
          <FitToViewport padding={40}>
            <div className="flex flex-col items-center justify-center text-center max-w-5xl">
              <AlertTriangle className="w-32 h-32 mb-8 animate-pulse" />
              <h1 className="text-7xl font-black uppercase tracking-wider mb-6 break-words">{cachedEm.type || cachedEm.title || 'Emergency'}</h1>
              {cachedEm.textBlob && <p className="text-3xl font-bold whitespace-pre-wrap break-words">{cachedEm.textBlob}</p>}
              <p className="text-sm mt-12 opacity-70">Player recovering — reloading shortly</p>
            </div>
          </FitToViewport>
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
  //      URL / solo item / single-board template) can't hit a loop
  //      boundary, so once the bundle has been known-stale longer than
  //      this cap we reload anyway. The dashboard "Refresh kiosk page"
  //      push stays the instant override for an urgent fix.
  //
  // 2026-06-27 — LAUNCH-BLOCKING fix. The cap above used to be SIX HOURS,
  // which meant any continuously-looping kiosk (a single board, a solo
  // URL, a template-only screen) ran a known-stale bundle for up to 6h
  // after a deploy — confirmed live on a 960×1080 LED that never picked
  // up new player/emergency fixes. The loop-boundary reload only covers
  // multi-distinct-item PLAYLISTS (the heartbeat effect requires
  // playlist.items and skips single-distinct-item playlists), so a
  // single-board screen had NOTHING but this cap. The WS REFRESH_WEB push
  // doesn't help either: if a kiosk's WebSocket is flaky/down (the very
  // symptom — emergencies arrive via the HTTP manifest poll but reloads
  // don't), the WS-only push never lands.
  //
  // The cap is now ~12 minutes — roughly 1-2 typical playlist loops. A
  // brief between-loop splash blip is the correct trade for a kiosk that
  // is otherwise running stale code indefinitely. The watcher polls
  // /api/build-info on its OWN interval (WS-independent), so this fires
  // even when the socket is dead.
  // `bundleDriftSinceRef` = epoch ms when we first saw the server SHA
  // differ from ours (null = we're in sync). Read by both the watcher
  // and the playback heartbeat (different effects → must be a ref).
  const bundleDriftSinceRef = useRef<number | null>(null);
  const MAX_BUNDLE_STALE_MS = 12 * 60 * 1000; // 12 min (~1-2 playlist loops)
  // Reload-loop floor: epoch ms of the last bundle-drift reload we fired.
  // Guarantees we NEVER reload more than once per MIN_BUNDLE_RELOAD_GAP_MS
  // for the bundle-drift reason — so even if the server SHA never
  // converges (regional CDN skew, a build-info env var that drifts), the
  // kiosk degrades to "reload at most every ~10 min", not a crash-loop.
  const lastBundleReloadAtRef = useRef<number>(0);
  const MIN_BUNDLE_RELOAD_GAP_MS = 10 * 60 * 1000; // 10 min

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
      // 2026-08-30 (reliability program W2-4, web half) — on APK ≥ 1.1.7 the
      // heartbeat carries a `syncOk` verdict: "my authenticated manifest
      // reconcile succeeded within the last 10 minutes". A player wedged in
      // an auth-dead loop keeps its JS event loop alive, so the legacy
      // heartbeat kept certifying it to the native watchdog forever (the
      // G43 failure). With syncOk=false sustained 30 min, the native side
      // force-reloads — a fresh boot re-registers and recovers. Pre-1.1.7
      // APKs only expose heartbeat(); a raw JS bridge call with a mismatched
      // arity would not dispatch, so feature-detect and fall back.
      // C-P0-1 web half (2026-08-30): OFFLINE with content on glass is NOT
      // a sync failure — it is the operator's sacred case ("once content is
      // live, it stays live... even if the damn internet drops"). Without
      // this, a day-long outage read as syncOk:false and the native content
      // watchdog reload-cycled a happily-playing cached screen every 30
      // minutes (including cached EMERGENCIES). navigator.onLine is
      // conservative in the right direction: false means definitely
      // offline; true still requires a fresh manifest.
      const manifestFresh =
        lastManifestOkAtRef.current > 0 &&
        Date.now() - lastManifestOkAtRef.current < 10 * 60_000;
      // Deepest-audit R-P0-01 residual (2026-08-30): the offline case alone
      // left a hole — network UP but API down (Railway outage, venue DNS
      // poisoning) read syncOk:false while cached content played, and the
      // native content watchdog would reload a healthy screen every 30 min.
      // The operator rule is about CONTENT, not connectivity: content on
      // the glass is never interrupted by a sync-staleness reload, full
      // stop. The G43-class deadlock this watchdog exists for showed NO
      // content (idle:connecting) and is still caught.
      // renderStateRef.current.rendering is the existing single source of
      // "operator content OR an emergency is on the glass" (it feeds the
      // render proof) — and it's a ref, safe inside this mount-once closure
      // where raw state like playbackStopped would be stale.
      const contentOnGlass = renderStateRef.current.rendering;
      const syncOk = manifestFresh || contentOnGlass;
      // On the registering/pairing splash there is legitimately no manifest
      // to reconcile — stay on the legacy heartbeat so the native content
      // watchdog stays dormant instead of reload-cycling a screen that is
      // waiting for an operator to type the pairing code.
      const pastPairing =
        phaseRef.current !== 'registering' && phaseRef.current !== 'pairing';
      if (pastPairing && nativeHas('heartbeatV2')) {
        nativeFire('heartbeatV2', JSON.stringify({ syncOk }));
      } else {
        // No-op in the browser player — nativeFire returns false.
        nativeFire('heartbeat');
      }
    };
    tick(); // immediate so the first heartbeat lands quickly after boot
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // Chromium-83/95/101 (NovaStar Taurus) runtime fixes — flex `gap` +
  // container-query units. 2026-08-03: the effect that used to live inline
  // here moved verbatim into `useTaurusPolyfills` so `/board`, `/ribbon` and
  // `/scorebug` — which render this same widget tree and are in the
  // taurus-safety gate's SCAN_DIRS for exactly that reason — can mount it too
  // instead of silently going without. Same behaviour, one implementation.
  useTaurusPolyfills();

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

  // 2026-05-27 — operator-selected hardware model (Goodview EP6N, ECBox,
  // Taurus, Pi5, etc.) from /screens/:id/manifest. Drives hardware-
  // specific UI gating in KioskSplash (e.g. the "LED canvas not set"
  // banner only appears on LED-controller hardware; LCD-direct boxes
  // like the EP6N don't need it). null = legacy / unset (safe default
  // — show the LED banner). Older APKs / manifests without the field
  // leave this null, identical to today.
  const [manifestHardwareModel, setManifestHardwareModel] = useState<string | null>(null);

  // 2026-05-27 — EP6N dual-RS232 + GPIO wiring. The manifest's
  // `wiring` field comes from `Screen.config.wiring`. CtsBridge reads
  // this prop and opens the right number of native serial ports with
  // the right parser per port. Null = legacy single-port behavior.
  const [manifestWiring, setManifestWiring] = useState<{
    rs232_1?: 'cts' | 'streamdeck' | 'aux' | 'off';
    rs232_2?: 'cts' | 'streamdeck' | 'aux' | 'off';
  } | null>(null);

  // 2026-06-01 — which scoreboard console drives this screen, from
  // `Screen.config.consoleProfile` (surfaced on the manifest). Selects
  // BOTH the serial settings AND the default tty: Gen 6 / Daktronics →
  // native /dev/ttyS1; WTTC → USB-serial /dev/ttyUSB0. Passed to
  // CtsBridge; undefined = its built-in default ('cts-gen6'), so every
  // existing install is unchanged. The literal union mirrors the
  // package's ConsoleProfileId (kept in sync with the manifest allow-list
  // below) so we avoid importing the package into the player bundle.
  const [manifestConsoleProfile, setManifestConsoleProfile] = useState<
    'cts-gen6' | 'cts-gen7' | 'cts-wttc' | 'daktronics-allsport' | undefined
  >(undefined);

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
      // linger in the address bar, dev-tools, or browser history. Carry the
      // entry's state forward — a `null` here dropped the Back trap's marker
      // (and Next's own bookkeeping) from the current entry.
      try {
        history.replaceState(history.state ?? null, '', window.location.pathname + window.location.search);
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
  // ⚠️ THE ROTATION IS ONLY HALF THE JOB — see setRotationViewportFix.
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
      // Always clear the companion rule, even if the body was already clean —
      // leaving it behind would pin `main` to 100% of an UNrotated body.
      setRotationViewportFix(false);
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
      // Viewport units do not follow the rotated body — without this the root
      // <main> stays at 100vh and the content letterboxes. See
      // setRotationViewportFix.
      setRotationViewportFix(true);
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
      setRotationViewportFix(true);
    } else {
      // Explicit landscape: reset anything a portrait-preview before it
      // might have left behind (same tab, navigated between previews).
      html.style.cssText = '';
      body.style.cssText = '';
      setRotationViewportFix(false);
    }
    return () => {
      // Restore whatever was there before on unmount so hot-reloading the
      // dev server doesn't persist weird body styles into the admin UI.
      if (prevHtml == null) html.removeAttribute('style'); else html.setAttribute('style', prevHtml);
      if (prevBody == null) body.removeAttribute('style'); else body.setAttribute('style', prevBody);
      setRotationViewportFix(false);
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
    if (!nativeHas('setBootstrap')) return; // older APK without the method
    try {
      const fp = getDeviceFingerprint();
      const apiRoot = getApiRoot();
      if (fp && apiRoot && fp.length >= 8) {
        nativeFire('setBootstrap', apiRoot, fp);
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
  // 2026-07-01 — LAUNCH-SPRINT player deep pass, blank-screen class (b):
  // "an asset URL 404s mid-playlist." A single broken item was already
  // handled (onError → setCurrentIndex(prev => prev + 1) skips it), but if
  // EVERY item in the live playlist fails to load (bulk Supabase outage, a
  // bucket-migration that left stale signed URLs, an operator's whole
  // playlist pointing at a since-deleted folder), the skip-forward logic
  // had NO floor: currentIndex increments forever through the same N
  // broken items, each iteration mounts an <img>/<video>/<iframe> that
  // immediately errors again, and the screen shows nothing but the
  // container's black background — indefinitely, with zero operator-
  // facing signal. This is exactly the cardinal-sin blank state the
  // launch-sprint player audit called out.
  //
  // Fix: track which item ids have errored in the CURRENT playlist. Once
  // every distinct item has failed at least once (a full lap with no
  // successful render), flip `allAssetsFailed` and render an honest
  // "Content unavailable" card instead of continuing to flash black. A
  // single successful load (image onLoad / video onPlaying / iframe
  // onLoad) at any point clears the whole tracker — one good item is
  // proof the outage has ended, not just that item. Resets automatically
  // whenever the manifest delivers a different item set (see the
  // `playlistItemsSig` effect below) so a republish always gets a clean
  // slate rather than inheriting stale failure state.
  const [allAssetsFailed, setAllAssetsFailed] = useState(false);
  // Pure tracking logic lives in a small, independently unit-tested class
  // (see all-assets-failed-tracker.test.ts) so the "every item has failed"
  // detection doesn't need the full ~8000-line page component mounted to
  // verify. One instance per page mount, held in a ref so it survives
  // re-renders without itself triggering any.
  const assetsFailedTrackerRef = useRef(new AllAssetsFailedTracker());
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
  const wsRef = useRef<WebSocket | null>(null);
  // Bullet-proof refs (Phase 1)
  const fetchFailCountRef = useRef(0);
  // 2026-07-02 efficiency #2 — the last-seen manifest ETag. Sent as
  // If-None-Match so an unchanged manifest costs a 304 with no body instead
  // of a full JSON re-ship every poll. Replaced (or CLEARED) from every 200's
  // ETag header — the emergency-manifest branch returns 200 with NO ETag, so
  // an active alert wipes this and the post-all-clear poll can never 304 away
  // the isEmergency:false reset.
  const manifestEtagRef = useRef<string | null>(null);
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
  // ── Hydration guard (2026-08-30 deep audit, found via the e2e harness) ──
  // Several splash blocks read window/navigator INLINE during render
  // (hostname, ?v/?mv/?w/?h params, userAgent platform). The server pass
  // renders different text ('Local', 'Browser', no chips) than the first
  // client pass, so EVERY kiosk boot hydration-failed and React threw the
  // whole server tree away and re-rendered from scratch — wasted work on
  // exactly the weak hardware that can least afford it, and a wall of
  // "Hydration failed" errors in every console. Standard two-pass fix:
  // these blocks render their stable server shape until mounted, then fill
  // in the real device facts one frame later.
  const [bootMounted, setBootMounted] = useState(false);
  useEffect(() => { setBootMounted(true); }, []);
  // ── `--splash-k`: viewport scale for the OPERATOR/DIAGNOSTIC glass ──────
  // (2026-09-01, photographed on a real Goodview 4K panel.)
  //
  // Every non-content surface in this file — the connecting hero, "Playback
  // Paused", "Screen Paired Successfully", "Content Unavailable", and the
  // two fixed corner chips — sizes itself off `--led-w`. That var is set ONLY
  // for LED walls with a canvas pin (`layout.tsx`). A 2160×3840 TV panel has
  // no pin, so every `calc(var(--led-w, 1024px) * F)` computed for the 1024px
  // DEFAULT: a 28px headline and an 896px content column on 2160px of glass.
  // Unreadable from eight feet, which is the only distance that matters.
  //
  // `--splash-k` is the missing second input: a UNITLESS multiplier derived
  // from the actual viewport, so these surfaces scale on panels that have no
  // canvas pin while staying byte-identical on everything ≤1920 (k === 1) and
  // on every LED wall (whose long edge is well under 1920 per controller).
  // Capped at 3 so an absurd viewport can't blow the card off the glass.
  //
  // Written to documentElement (not state) on purpose: it must NOT re-render
  // the page — playback advancement stays a pure function of (manifest,
  // syncedNow). Mount + resize only; no rAF, no poll. Idempotent under
  // StrictMode's double-fire (same value written twice is a no-op).
  useEffect(() => {
    const apply = () => {
      const longEdge = Math.max(window.innerWidth, window.innerHeight);
      const raw = Math.min(3, Math.max(1, longEdge / 1920));
      document.documentElement.style.setProperty(
        '--splash-k',
        String(Math.round(raw * 100) / 100),
      );
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);
  // ── Repair-chip boot window (2026-09-01) ───────────────────────────────
  // `bootAtRef` is stamped once, on first render, and never moves. The
  // timeout below is the ONLY clock this feature owns — one shot, fired at
  // the boundary, purely so the chip actually leaves the glass when the
  // window closes instead of waiting for some unrelated re-render. No
  // interval, no per-frame read, and nothing here touches playback.
  const bootAtRef = useRef(Date.now());
  const [repairChipBootWindowOpen, setRepairChipBootWindowOpen] = useState(true);
  useEffect(() => {
    const remaining = REPAIR_CHIP_BOOT_WINDOW_MS - (Date.now() - bootAtRef.current);
    if (remaining <= 0) { setRepairChipBootWindowOpen(false); return; }
    const t = setTimeout(() => setRepairChipBootWindowOpen(false), remaining);
    return () => clearTimeout(t);
  }, []);
  // Resilient registration loop — DETACHED from the useEffect lifecycle
  // so a phase change doesn't cancel an in-flight retry. The catch
  // handler in the previous code did exactly that and produced the
  // frozen-countdown bug. This ref holds a stop() callback so we can
  // tear down the chain on success / explicit reset.
  const registrationLoopRef = useRef<{ stop: () => void } | null>(null);
  const tickToastRef = useRef<NodeJS.Timeout | null>(null);
  // ── 2026-08-30 player reliability program ─────────────────────────────
  // wsPolicyRef replaces the old `wsFailCountRef` whose counter was reset
  // in ws.onopen — i.e. on TCP connect, BEFORE auth — so a dead credential
  // looped open(0)→AUTH_FAIL→close(1) forever and the ≥3-failure SSE/HTTP
  // fallback never engaged. The policy resets ONLY on AUTH_OK.
  const wsPolicyRef = useRef(createWsAuthPolicy());
  // Reactive mirror of "WS is degraded (≥2 failures)" for the emergency
  // poll cadence effect. The old code read wsFailCountRef.current inside
  // the effect, whose deps never included it — so the advertised 5 s
  // degraded cadence only engaged if something ELSE re-ran the effect.
  const [wsDegraded, setWsDegraded] = useState(false);
  // Single-flight + coalescing for every fetchContent trigger (P0-8).
  const manifestGateRef = useRef(createManifestGate());
  // ── Emergency preempt lane (deep-audit F2) ────────────────────────────
  // The gate serializes reconciles, which means an OVERRIDE arriving while
  // a SLOW normal fetch is in flight would otherwise wait out that fetch's
  // full deadline before the coalesced follow-up could load the emergency
  // manifest. This ref holds the CURRENT manifest request's AbortController;
  // emergency triggers abort it, the in-flight run fails fast, and the
  // gate's follow-up — which fetches the now-emergency truth — runs
  // immediately. Serialization (and its stale-response guarantee) is
  // preserved: there is still never more than one request in flight.
  const manifestFetchAbortRef = useRef<AbortController | null>(null);
  // ── OVERRIDE confirmation window (deepest-audit E-P0-01) ──────────────
  // THE RACE. The API deliberately STARTS the signed OVERRIDE fan-out
  // before its database transaction commits (2026-08-15 bulletproofing:
  // fan-out speed over commit ordering). The player deliberately renders
  // emergencies only from the manifest (server of record). Between those
  // two correct decisions sat a gap: the OVERRIDE-triggered reconcile
  // could read the NOT-YET-COMMITTED manifest, see "normal", and then
  // nothing special happened until the next routine poll (~10 s) — and if
  // the transaction failed, the signed broadcast produced no alert at all,
  // silently.
  //
  // THE CONTRACT THAT CLOSES IT: a signed, freshness-gated OVERRIDE opens
  // a ~30 s CONFIRMATION WINDOW during which the player
  //   1. keeps the native blank-inhibit RAISED (a normal manifest inside
  //      the window cannot release it — a spurious hold costs ≤30 s of
  //      not-blanking, the safe direction);
  //   2. fetches manifests with the emergency cache-buster + no
  //      If-None-Match (a 304 or intermediary cache must not hide the
  //      commit);
  //   3. re-reconciles on a rapid ladder (~2.5/5/10/20 s) instead of
  //      waiting for the routine poll;
  //   4. on manifest-confirmed emergency (or a signed ALL_CLEAR): window
  //      closes, normal rules resume;
  //   5. on timeout: closes LOUDLY — the transaction failed or replica lag
  //      exceeded the window; the alert was NOT painted and the log says
  //      exactly that instead of pretending.
  // The overlay itself stays manifest-arbitered — this never paints from
  // the transport payload; it makes the player CHASE the committed truth.
  const pendingOverrideConfirmRef = useRef<{ firstAt: number; tries: number } | null>(null);
  const pendingOverrideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ── Window-edge → full refetch (deep-audit B-P0-1) ───────────────────
  // Playlist windows are CONSTANTS inside the ETag-hashed payload, so
  // 06:59 and 07:00 serve byte-identical 304s — and selection only runs on
  // a 200. These refs remember the last APPLIED manifest and the window
  // verdict it was applied under; when the local verdict flips (an edge
  // crossed), the reconcile drops its ETag so the next poll is a full 200
  // and winner selection re-runs. ≤2 extra full bodies per screen per day.
  const lastAppliedManifestRef = useRef<any>(null);
  const appliedWindowSigRef = useRef<string>('');
  // Credential recovery state: the SERVER said this device's credential is
  // unproven and a real re-pair is required (register `requiresRePair`).
  // Content keeps playing on renewed 1 h tokens; the dashboard + a local
  // chip tell the truth instead of the old silent death-at-the-top-of-the-
  // hour. Ref mirrors state for non-reactive readers (heartbeatV2, POSTs).
  const [repairRequired, setRepairRequired] = useState(false);
  const repairRequiredRef = useRef(false);
  // Cooldown + single-flight for attemptCredentialRecovery (401 path, WS
  // AUTH_FAIL path and the proactive renewal timer share one gate — a
  // broken server must surface as a failure state, not a register storm).
  const credRecoveryLastAtRef = useRef(0);
  const credRecoveryInFlightRef = useRef<Promise<'renewed' | 'repair-required' | 'failed' | 'cooldown' | 'skipped'> | null>(null);
  // Freshness of the last successful (2xx/304) manifest reconcile — feeds
  // the native heartbeatV2 `syncOk` signal (a stuck-unauthenticated player
  // must stop certifying itself to the native watchdog).
  const lastManifestOkAtRef = useRef(0);

  /**
   * Persist a server-accepted device token EVERYWHERE at once: localStorage
   * (the credential of record) + the native `edu_player` store via the
   * setDeviceToken bridge (so the OTA worker stays authenticated and — on
   * APK ≥ 1.1.7 — the next native reload injects the CURRENT token instead
   * of a fossil). One writer, no split brain.
   */
  // Deepest-audit R-P0-02 correction #3 (2026-08-30): once this page has
  // UNPAIRED, no in-flight credential response may repopulate the stores —
  // a recovery/boot register that resolves AFTER the operator's unpair
  // would otherwise resurrect a token for a screen they just revoked.
  const unpairedRef = useRef(false);
  const persistDeviceToken = useCallback((token: string) => {
    if (unpairedRef.current) {
      console.warn('[Player] refusing to persist a device token after unpair (late in-flight response)');
      return;
    }
    try { localStorage.setItem(LS_TOKEN, token); } catch {}
    try {
      if (nativeHas('setDeviceToken')) nativeFire('setDeviceToken', token);
    } catch {}
  }, []);

  /**
   * ── Controlled credential recovery (2026-08-30, audit P0-1) ────────────
   * ONE re-register attempt, shared by every trigger (manifest 401, WS
   * AUTH_FAIL, render-proof 401, proactive renewal), single-flighted and
   * cooldown-gated (60 s). This is the renewal mechanism the server already
   * supports: a still-valid proven prior token → fresh 180 d token + epoch
   * rotation (SCREEN_TOKEN_RENEWED); an expired/unproven prior → 1 h token
   * + requiresRePair (SCREEN_TOKEN_DOWNGRADED) which keeps last-known-good
   * content ALIVE while the dashboard says "re-pair required" honestly.
   * Never upgrades anything client-side; the server stays the judge.
   */
  const attemptCredentialRecovery = useCallback(
    (trigger: string): Promise<'renewed' | 'repair-required' | 'failed' | 'cooldown' | 'skipped'> => {
      if (isPreviewMode()) return Promise.resolve('skipped');
      if (credRecoveryInFlightRef.current) return credRecoveryInFlightRef.current;
      if (!mayAttemptRecovery(Date.now(), credRecoveryLastAtRef.current)) {
        return Promise.resolve('cooldown');
      }
      credRecoveryLastAtRef.current = Date.now();
      const attempt = (async (): Promise<'renewed' | 'repair-required' | 'failed'> => {
        try {
          const fp = getDeviceFingerprint();
          const prior = getDeviceToken();
          console.warn(`[Player] credential recovery (${trigger}) — re-registering${prior ? ' with prior token' : ''}`);
          // Bounded ACROSS THE BODY (D-1/F1): a hung register — headers OR
          // body — would park the recovery single-flight ref for the life
          // of the page. No retry ever.
          const { res, json: data } = await fetchJsonBounded(`${getApiRoot()}/api/v1/screens/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              deviceFingerprint: fp,
              ...(prior ? { priorDeviceToken: prior } : {}),
            }),
          }, 15_000);
          if (!res.ok || !data) {
            console.warn(`[Player] credential recovery failed: HTTP ${res.status}${data ? '' : ' (empty body)'}`);
            return 'failed';
          }
          if (data?.deviceToken) persistDeviceToken(data.deviceToken);
          const needsRePair = data?.requiresRePair === true;
          repairRequiredRef.current = needsRePair;
          setRepairRequired(needsRePair);
          // Recycle the realtime socket so it authenticates with the fresh
          // credential (connect() reads getDeviceToken() at open time).
          try { wsRef.current?.close(); } catch {}
          if (needsRePair) {
            console.warn('[Player] server says re-pair required — content continues on a temporary credential');
            return 'repair-required';
          }
          console.log('[Player] credential renewed');
          return 'renewed';
        } catch (e: any) {
          console.warn('[Player] credential recovery error:', e?.message || e);
          return 'failed';
        } finally {
          credRecoveryInFlightRef.current = null;
        }
      })();
      credRecoveryInFlightRef.current = attempt;
      return attempt;
    },
    [persistDeviceToken],
  );

  /**
   * Proactive renewal — the missing half of the credential lifecycle. A
   * kiosk page runs for months; registration only at boot means the 180 d
   * token silently ages to death (and after ANY downgrade the 1 h token
   * died at the top of the hour). Check every 10 min; re-register while the
   * token is still valid (inside 1/4 of its lifetime — 14 d for proven
   * tokens, ~15 min for the 1 h unproven holding pattern).
   */
  useEffect(() => {
    if (isPreviewMode()) return;
    const tick = () => {
      // B-P1-6 (2026-08-30): renew only while PLAYING. During registering /
      // pairing / connecting, another registrar owns the credential (boot
      // register, pairing exchange, 401 recovery) — a proactive register
      // racing them forks the epoch: both present the same prior, both
      // pass via the grace window, both rotate, and whichever response
      // persists LAST can leave the screen holding the superseded token —
      // a hard 401 exactly one grace-window later.
      if (phaseRef.current !== 'playing') return;
      const d = renewalDecision(Date.now(), getDeviceToken());
      if (d.renew) void attemptCredentialRecovery(`proactive-${d.reason}`);
    };
    const first = setTimeout(tick, 90_000); // boot register just ran — settle first
    const t = setInterval(tick, 10 * 60_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [attemptCredentialRecovery]);

  /**
   * Scrub `?token=` out of the visible URL (audit P0-2 item 5). The shell
   * injects it for the empty-storage bootstrap case; once resolveDeviceToken
   * has had the chance to adopt it (the getDeviceToken() call below), a
   * credential has no business sitting in browser history / screenshots /
   * the operator-info overlay. Every OTHER param (fp/w/h/dpr/mv/vc/api…)
   * stays — later effects read them.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has('token')) return;
      getDeviceToken(); // adopt-into-storage runs before the evidence vanishes
      // Deep-audit B-P1-5 (2026-08-30): NEVER scrub unless adoption
      // actually PERSISTED. On a runtime where setItem throws or silently
      // drops (private mode, storage quota, partitioned stores), the URL
      // param IS the working credential — getDeviceToken() re-reads it on
      // every call — and deleting it would take the screen's only
      // credential with it.
      let persisted = false;
      try { persisted = !!window.localStorage.getItem(LS_TOKEN); } catch { persisted = false; }
      if (!persisted) {
        console.warn('[Player] token adoption did not persist — keeping ?token= in the URL as the working credential');
        return;
      }
      url.searchParams.delete('token');
      // Carry the entry's state forward (the Back trap marker + Next's
      // bookkeeping live there) — `null` wiped both.
      window.history.replaceState(window.history.state ?? null, '', url.toString());
      console.log('[Player] scrubbed ?token= from the URL (credential lives in storage)');
    } catch { /* cosmetic hardening — never let it break boot */ }
  }, []);

  const lastWsMessageAtRef = useRef<number>(Date.now());
  // Audit fix #2 (partial): WebSocket message replay/dupe protection.
  // Tracks recent eventIds so an attacker who captures a signed message
  // can't replay it. Eviction is a soft cap to bound memory.
  const recentEventIdsRef = useRef<Map<string, number>>(new Map());
  /** Pending coalesce timer for the display-command outcome POST. */
  const outcomeReportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Server-clock offset learned at AUTH_OK. Needed because Android
  // signage devices frequently boot without NTP sync and drift from
  // wall-clock — the staleness gate on SENSITIVE WS events would
  // otherwise drop every emergency. Offset is "server - local"; apply
  // by ADDING to local Date.now() before comparing.
  const serverClockOffsetRef = useRef<number>(0);

  // ─── Display control (2026-08-13) ────────────────────────────────────
  // displayConfigFpRef — fingerprint of the `display` block we last handed
  //   the device. The manifest carries the block on EVERY poll, and
  //   `displaySetSchedule` re-persists, re-resolves the provider chain and
  //   re-arms an AlarmManager on each call — so re-installing an unchanged
  //   block every 5–10 s would churn SharedPreferences and the alarm for
  //   nothing. Diff first, install only on change. Same "cheap setter"
  //   pattern the orientation + LED-canvas branches use.
  // deviceIdentityRef — this box's Build.MANUFACTURER/MODEL/BOARD, learned
  //   once from the native probe. Used ONLY to pick which vendor recipe out
  //   of the shipped catalog to hand down; the device re-checks the match
  //   itself before ever using it (see displayControl.ts).
  const displayConfigFpRef = useRef<string>('');
  const deviceIdentityRef = useRef<DeviceIdentity>({});

  // ─── Frame-locked multi-screen sync (2026-07-28) ─────────────────────
  // docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md. All of this is
  // inert until the manifest's `sync.enabled` flips true (ScreenGroup.
  // syncMode === 'locked') — zero behavior change for the existing fleet.
  //
  // syncClockRef      — Cristian/NTP-style shared-clock estimator fed by
  //                     WS TIME_PONG samples (+ HTTP /realtime/time when
  //                     WS is down). performance.now() timebase.
  // syncConfigRef     — parsed from the manifest sync block every poll.
  // syncActiveRef     — true only while (enabled && clock locked); the
  //                     rAF conductor owns advancement then and the
  //                     legacy heartbeat/onEnded advance paths stand down.
  // syncPosRef        — the conductor's latest resolved timeline position
  //                     (video servo + HUD + telemetry read it).
  // syncStatsRef      — flip-error EWMA etc. for telemetry/HUD.
  const syncClockRef = useRef<SyncClock | null>(null);
  const syncConfigRef = useRef<{ enabled: boolean; trimMs: number; groupId: string | null }>({
    enabled: false, trimMs: 0, groupId: null,
  });
  const syncActiveRef = useRef<boolean>(false);
  const syncPosRef = useRef<TimelinePosition | null>(null);
  const syncStatsRef = useRef<{ lastFlipErrMs: number | null; flipErrEwmaMs: number | null }>({
    lastFlipErrMs: null, flipErrEwmaMs: null,
  });
  const syncPingStateRef = useRef<{ burstRemaining: number; lastPingAtMono: number }>({
    burstRemaining: 0, lastPingAtMono: 0,
  });
  // Tier-1 self-calibration: this device's measured decision→paint
  // latency (EWMA, persisted). The conductor leads every flip by it so
  // the PAINT — not the decision — lands on the shared boundary. Seeded
  // at one 60Hz frame; measured per flip via double-rAF.
  const syncRenderLeadRef = useRef<number>(
    typeof window !== 'undefined' ? readStoredLeadMs(LS_SYNC_RENDER_LEAD, 16, 150) : 16,
  );
  const syncRenderLeadSavedAtRef = useRef<number>(0);
  const [syncEnabled, setSyncEnabled] = useState(false);
  // Tier-3 camera calibration (2026-07-28): the dashboard wizard remotely
  // flips group screens into a full-screen synced flash pattern
  // (CALIBRATE_FLASH signed device message) so a phone camera can measure
  // true glass-to-glass offsets. Auto-expires (player-side too — a screen
  // can never stick in flash mode), suppressed entirely during
  // emergencies.
  const [calFlashUntil, setCalFlashUntil] = useState<number | null>(null);
  useEffect(() => {
    if (calFlashUntil === null) return;
    const remaining = calFlashUntil - Date.now();
    if (remaining <= 0) {
      setCalFlashUntil(null);
      return;
    }
    const t = setTimeout(() => setCalFlashUntil(null), remaining);
    return () => clearTimeout(t);
  }, [calFlashUntil]);
  // Diagnostics HUD (?synchud=1) — big beat-bar + clock/uncertainty
  // readouts, filmable across two screens for physical verification.
  // Hydration rule (2026-08-30): never initialize from window — the server
  // renders HUD-off, so the client must too, and flip in an effect.
  const [syncHudOn, setSyncHudOn] = useState<boolean>(false);
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('synchud') === '1') setSyncHudOn(true);
    } catch { /* no HUD — diagnostics only */ }
  }, []);

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
  // Gated on bootMounted (NOT `typeof window`): these feed conditional
  // splash chips, so a server/first-client-pass difference shifts sibling
  // elements and fails hydration on every boot (see bootMounted).
  const apkVersion = bootMounted
    ? new URLSearchParams(window.location.search).get('v')
    : null;
  // 2026-04-28 — Manager APK version (sent by Player v1.0.13+ as
  // ?mv=). null = old Player that doesn't know about Manager,
  // '' = Player v1.0.19+ saying Manager not installed,
  // '1.0.3' = installed at that version. KioskSplash renders all
  // three states distinctly.
  const managerVersion: string | null = bootMounted
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
        // 2026-08-25 — operator pushed an update and the panel's banner
        // TITLE sat on "Update in progress" indefinitely while the
        // sublabel said "no newer release offered". UP_TO_DATE is a
        // TERMINAL answer, not progress: show the outcome, then stand
        // down on its own (same pattern as the INSTALLED dismissal
        // above; longer dwell so someone standing at the panel can
        // actually read it).
        if (data.ota.state === 'UP_TO_DATE') {
          setTimeout(() => setOtaProgress(null), 12_000);
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
      const bridgeAvailable = nativeHas('checkForUpdates');
      setOtaProgress({ startedAt: now, bridgeAvailable });
      if (bridgeAvailable) {
        nativeFire('checkForUpdates');
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
      // SECURITY: remote input is inert while an emergency is displayed —
      // Back must not be able to cover a lockdown with the Stop splash
      // (or reach its Exit/Unpair buttons). See the emergency-lockout
      // effect above. Server-side all-clear is the only way out.
      if (activeEmergencyRef.current || pushedEmergencyMessageRef.current) {
        console.warn('[Player] remote input ignored — emergency active (controls locked)');
        return;
      }
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
      // SECURITY: same emergency lockout as onShowStop — raw-keyboard
      // remotes (Goodview/OEM Escape emitters) must not bypass it.
      if (activeEmergencyRef.current || pushedEmergencyMessageRef.current) {
        if (key === 'Escape' || key === 'Backspace' || key === 'GoBack' || key === 'Back' || key === 'Home' || key === 'i' || key === 'I') {
          e.preventDefault();
          console.warn('[Player] remote key ignored — emergency active (controls locked)');
        }
        return;
      }
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
  // Frame-locked sync — 200ms bookkeeping tick for TIME_PING sampling
  // (no-ops unless the manifest enabled sync). Cleared with heartbeatRef.
  const syncPingTimerRef = useRef<NodeJS.Timeout | null>(null);
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
  // Ref mirror of activeEmergency for fetchContent's closure (2026-07-31
  // stuck-lockdown fix): while an emergency is DISPLAYED, manifest polls
  // must bypass every HTTP cache layer (see the fetch below) — the fetch
  // callback can't read fresh state, so it reads this ref.
  const activeEmergencyRef = useRef<any | null>(null);
  useEffect(() => {
    activeEmergencyRef.current = activeEmergency;
  }, [activeEmergency]);
  // 2026-05-26 P0-3 — Sprint 5 emergency-message overlay state.
  // SOS / TEXT_BROADCAST / MEDIA_ALERT pushed via WS land here; the
  // mounted <EmergencyOverlay> also self-polls /emergency/status every
  // 10s as a fallback. Separate from `activeEmergency` (which tracks
  // tenant-wide LOCKDOWN-style overrides) so the two systems can
  // coexist — a SOS can fire on a screen that's already in lockdown.
  const [pushedEmergencyMessage, setPushedEmergencyMessage] = useState<EmergencyMessageView | null>(null);
  // Ref mirror for the remote-input lockout below (same pattern as
  // activeEmergencyRef — the key/back handlers live in a closure with
  // [playbackStopped, showOverlay] deps and must read live emergency state).
  const pushedEmergencyMessageRef = useRef<EmergencyMessageView | null>(null);
  useEffect(() => {
    pushedEmergencyMessageRef.current = pushedEmergencyMessage;
  }, [pushedEmergencyMessage]);

  // ── SOFT BLANK — the universal, unbrickable blank (2026-08-25) ─────────
  //
  // Operator contract: "wake and blank should just do that and turn on and
  // off should do that, keep them separate and make them work perfectly on
  // all our models."
  //
  // A remote BLANK used to be forwarded to the APK, which takes an Android
  // device-admin lock. On the incident night that lock latched a Goodview G43
  // and a Mobile A-Frame into a VENDOR standby — glass dark, IR remote and
  // the physical power button both dead, WAKE delivered and useless, mains
  // power-cycle required — and the A-Frame then woke itself back up minutes
  // later with nothing sent to it. So the vendor's own timer owned that
  // state, in both directions, and no probe verdict predicted which panel
  // would do which (an L55VEC with a byte-identical verdict recovered fine).
  //
  // Blank is now THIS: one black div in our own page. It cannot reach panel
  // power, so it can never latch; WAKE always removes it; and it behaves
  // identically on every model, including a browser player with no APK at
  // all. Hardware power moved to the separate POWER_OFF / POWER_ON pair,
  // which is gated server-side on a proven-mechanism allowlist.
  //
  // Session-only, and deliberately: a reload (REFRESH_WEB, a service-worker
  // update, a WebView OOM-kill) un-blanks the screen. That is the safe
  // direction to fail — a screen that comes back on by itself is a nuisance,
  // a screen that cannot come back is a truck roll — and it is exactly the
  // direction the vendor standby failed in. Persisting a blank across
  // reloads needs a server-held flag and is a recorded follow-up.
  const [softBlank, setSoftBlank] = useState(false);
  const softBlankRef = useRef(false);
  /**
   * The overlay's real DOM node, or null when it is not on the glass.
   *
   * ⚠️ THIS IS THE PROOF, AND `softBlank === true` IS NOT.
   *
   * The 2026-08-25 field failure was exactly this gap: state flipped, the
   * dispatcher logged "soft BLANK → overlay ON", the server audited
   * `dispatched / delivered:true` — and no pixel changed, because the render
   * exit that panel was taking never mounted the div. Every layer reported
   * success and the only honest witness (the DOM) was never asked.
   *
   * So the callback ref below is the witness, and `applyDisplayControl`
   * asks it a beat after every soft BLANK. A React ref callback fires on
   * mount and unmount, which is precisely "is it there".
   */
  const softBlankNodeRef = useRef<HTMLDivElement | null>(null);
  const applySoftBlank = useCallback((on: boolean) => {
    if (softBlankRef.current === on) return;
    softBlankRef.current = on;
    setSoftBlank(on);
  }, []);

  /**
   * SOFT DIM — the brightness half of the split (2026-08-25).
   *
   * Alpha, 0 … SOFT_DIM_MAX_ALPHA. Arrives only for panels whose brightness
   * mechanism the field proved is a silent no-op (a non-writable
   * `/sys/class/backlight/*` node falling through to `settings`), so on M43
   * and L55VEC this stays 0 forever and the APK keeps driving the real
   * backlight exactly as it does today.
   *
   * Rendered through the SAME node as the blank rather than a second
   * stacking layer: one node means one render-exit rule, one paint proof and
   * one emergency clear, instead of three of each that can drift apart. The
   * two states differ only in opacity and hit-testing — a blank is opaque
   * and swallows touches, a dim is translucent and must not.
   *
   * Session-only, like the blank, and for the same reason: a reload fails
   * BRIGHT. The worst case is a screen that comes back at full brightness
   * on its own, which is a nuisance; the other direction is a truck roll.
   */
  const [softDim, setSoftDim] = useState(0);
  const softDimRef = useRef(0);
  const applySoftDim = useCallback((alpha: number) => {
    const next = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0;
    if (softDimRef.current === next) return;
    softDimRef.current = next;
    setSoftDim(next);
  }, []);

  /**
   * The seam `dispatchDisplayControl` drives. The RULES live in
   * displayControl.ts (unit-tested without mounting this page); this object
   * is only the capabilities that module cannot have on its own — write the
   * overlay (opaque or dimmed), and read live emergency state.
   */
  const softBlankSinkRef = useRef<SoftBlankSink>({
    set: (on: boolean) => applySoftBlank(on),
    setDim: (alpha: number) => applySoftDim(alpha),
    emergencyDisplayed: () =>
      !!activeEmergencyRef.current || !!pushedEmergencyMessageRef.current,
  });

  // EMERGENCY ALWAYS PUNCHES THROUGH. Second of the two guarantees (the
  // first is the drop inside dispatchDisplayControl, the third is the render
  // condition on the overlay itself). Belt and braces on purpose: an alert
  // painted behind a black div is the one failure mode of this feature that
  // could get someone hurt, and the three checks fail independently.
  useEffect(() => {
    if (activeEmergency || pushedEmergencyMessage) {
      applySoftBlank(false);
      // The dim comes down too. A translucent black film over a lockdown
      // notice is not a blank, but it is contrast taken away from the one
      // thing on that screen that matters.
      applySoftDim(0);
    }
  }, [activeEmergency, pushedEmergencyMessage, applySoftBlank, applySoftDim]);

  // ── DISPLAY-CONTROL EMERGENCY INTERLOCK (2026-08-13) ──────────────────
  // The display-control layer in the APK can add a full-screen blackout
  // overlay ABOVE this WebView, dim the window to near-zero and blank the
  // panel on an AlarmManager schedule. None of that may happen while a
  // lockdown / evacuation / weather alert is on the glass.
  //
  // ⚠️ THIS EFFECT ONLY EVER RAISES THE HOLD — it never releases one.
  //
  // The native hold is PERSISTED across a process restart (that is half the
  // point of it). This web bundle, meanwhile, can reload on its own at any
  // time — a REFRESH_WEB, a service-worker update, a WebView OOM-kill. On
  // that reload the component mounts with `activeEmergency === null` for
  // the handful of frames before the cached emergency hydrates and the
  // first manifest lands. If this effect released on `false`, a reload
  // during a live lockdown would drop a legitimate hold and re-arm blanking
  // on a screen showing an active alert. So the release lives on exactly
  // one path — the manifest handler in fetchContent — which is the server
  // of record, and which also carries the live pushed-message state.
  //
  // Effects run after commit, i.e. in the same frame the alert paints, and
  // the call is a no-op on a browser player or an APK without the method.
  useEffect(() => {
    if (activeEmergency || pushedEmergencyMessage) signalDisplayEmergencyHold(true);
  }, [activeEmergency, pushedEmergencyMessage]);

  // SECURITY (2026-07-31, operator): "the remote shouldn't allow anyone to
  // even exit out of the warning — what if the bad guy has some universal
  // remote." During ANY displayed emergency (tenant-wide override OR pushed
  // SOS/broadcast), the local remote must be inert:
  //  1. Force-close the Stop/Exit splash + info overlay the moment an
  //     emergency activates — the alert takes the glass even if someone
  //     parked the kiosk on the splash first (the stopped splash renders
  //     ABOVE playback, so leaving it up would hide a lockdown).
  //  2. The back/key handlers below refuse to open overlays while an
  //     emergency is displayed.
  //  3. The Back trap (backTrap.ts) keeps ONE same-document entry on top of
  //     the WebView's history, so a remote Back can only ever traverse onto
  //     this page — never away from the alert — and the traversal re-arms it.
  // Clearing remains SERVER-ONLY (authenticated all-clear → manifest).
  //
  // 2026-09-01 (TC22 → GUQ/G65 field finds): this effect used to push and
  // pop its own `eduEmergencyLock` sentinel. The first fix released it on
  // all-clear; the field then showed the sentinel was only ONE source of
  // back-history — every native reload leaves a cross-document entry too, and
  // the APK's Back handler walks that stack one page load per press. The
  // trap now owns all of it: on the APK shell it is armed for the page's
  // whole life (module evaluation + the mount effect below), and here it is
  // armed for any client while an alert is displayed. Only a NON-shell player
  // (browser, Taurus) releases it on clear, so a browser Back can leave
  // /player again once the alert is over.
  useEffect(() => {
    const emergencyDisplayed = !!activeEmergency || !!pushedEmergencyMessage;
    if (!emergencyDisplayed) {
      if (!isAndroidWebView()) releaseBackTrap();
      return;
    }
    setPlaybackStopped(false);
    setExitUnavailable(false);
    setShowOverlay(false);
    armBackTrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!activeEmergency, !!pushedEmergencyMessage]);

  // APK shell: keep the Back trap armed for the page's whole life. Module
  // evaluation armed it before hydration; Next's HistoryUpdater then rewrote
  // the entry's state at hydration, so re-stamp the marker here (in place —
  // armBackTrap never stacks). Also exposes a mount counter so the e2e
  // harness can prove a trap traversal neither reloads nor remounts the page.
  useEffect(() => {
    try {
      const w = window as unknown as { __eduPlayerMounts?: number };
      w.__eduPlayerMounts = (w.__eduPlayerMounts || 0) + 1;
    } catch { /* diagnostics only */ }
    if (isAndroidWebView()) armBackTrap();
  }, []);

  // ── LIFE-SAFETY BACKSTOP (2026-07-04) — HTTP reconcile for a stranded
  // pushed emergency. `pushedEmergencyMessage` is set by WS/SSE and was
  // cleared ONLY by an ALL_CLEAR_MESSAGE over that same transport; if that
  // clear is dropped (WS blip) or freshness-gated (clock-skewed kiosk past the
  // 30s staleness gate), the SOS / broadcast / media-alert takeover strands on
  // the wall forever — and EmergencyOverlay's own self-poll is DISABLED while a
  // pushed `message` prop is present. This poll makes the SERVER the sole
  // arbiter for the pushed message too (the same principle the manifest already
  // applies to tenant-wide lockdowns): if the device-authed /emergency/messages
  // endpoint no longer lists the shown message as active, clear it. FAIL-SAFE
  // toward OVER-alerting — see reconcileStrandedEmergency(): only a SUCCESSFUL
  // poll that confirms absence TWICE in a row clears it; an offline/erroring
  // poll leaves the alert up untouched.
  useEffect(() => {
    if (!pushedEmergencyMessage) return; // nothing on screen to reconcile
    const token = getDeviceToken();
    if (!token) return; // only paired devices ever receive a WS-pushed message
    let stopped = false;
    let consecutiveMisses = 0;
    const shownId = pushedEmergencyMessage.id;
    const reconcile = async () => {
      try {
        const res = await fetch(`${getApiRoot()}/api/v1/emergency/messages`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (stopped || !res.ok) return; // transient failure ≠ a confirmed clear
        const json = await res.json();
        const activeIds = new Set<string>(
          (Array.isArray(json.active) ? json.active : []).map((r: { id: string }) => r.id),
        );
        const decision = reconcileStrandedEmergency(activeIds, shownId, consecutiveMisses);
        consecutiveMisses = decision.consecutiveMisses;
        if (decision.clear) {
          console.warn(
            `[Player] emergency message ${shownId} no longer active server-side — ` +
              `clearing stranded overlay (missed ALL_CLEAR_MESSAGE backstop)`,
          );
          setPushedEmergencyMessage(null);
        }
      } catch {
        /* offline — keep the alert up (fail-safe toward over-alerting) */
      }
    };
    // Interval-only (no immediate tick): the server persists the message row
    // BEFORE publishing the WS push, so by the first poll a still-live message
    // is guaranteed to be in the active set — the grace period prevents a
    // just-pushed alert from being reconciled away in a persist/poll race.
    const h = setInterval(reconcile, 12_000);
    return () => { stopped = true; clearInterval(h); };
  }, [pushedEmergencyMessage]);

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
  // 2026-07-31 stuck-lockdown root cause (verified live on a real kiosk via
  // render-proof + Railway HTTP logs): true when the currently-applied
  // playlist came from an isEmergency manifest. The empty-manifest blip
  // defense below must NEVER retain emergency content — after an all-clear
  // on a tenant with no regular content, the "last known-good content" IS
  // the emergency playlist, and the streak gate was pinning it on screen
  // indefinitely (compounded by 304s freezing the streak — see the 304
  // handler).
  const contentIsEmergencyRef = useRef<boolean>(false);
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
    // App-shell refresh, idle-timed so it never competes with first paint
    // or the media precache burst. Covers deploys that changed chunk names
    // without changing sw-player.js (no activate fires on those).
    const shellT = setTimeout(() => { precacheAppShell().catch(() => {}); }, 8_000);
    return () => { clearInterval(t); clearTimeout(shellT); };
  }, []);

  // Listen for SW cache-progress events. The SW emits PRECACHE_PROGRESS
  // for every asset as it's pulled into the cache; we pipe that into
  // loadProgress so KioskSplash's bar moves in real time.
  useEffect(() => {
    // `'serviceWorker' in navigator`, NOT `!navigator.serviceWorker`. Reading
    // the property INVOKES a getter that THROWS when service workers are
    // disabled for the context — "Failed to read the 'serviceWorker' property
    // from 'Navigator': Service worker is disabled". So the guard meant to
    // prevent the crash was itself the crash. The `in` operator only tests for
    // the property's presence and never invokes the getter.
    //
    // Disabled-SW contexts are real, not just tests: Chrome with site data
    // blocked, some enterprise/MDM policies, private-window variants, and
    // hardened WebView configurations.
    if (!isServiceWorkerAvailable()) return;
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
    getServiceWorkerContainer()?.addEventListener('message', onMessage);
    return () => getServiceWorkerContainer()?.removeEventListener('message', onMessage);
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

  // ─── Render-proof heartbeat (proof-of-display) ─────────────────────────
  // Closes the #1 reliability hole — a frozen kiosk still answers TCP reads,
  // so the server's lastPingAt stays fresh and the fleet map shows it
  // ONLINE/green while it's actually showing a stuck / black frame. The
  // 30s /cache-status POST above ALSO can't prove pixels — it fires on a
  // plain setInterval, which keeps running even if the renderer is wedged
  // and the screen shows nothing (that's exactly the wedge the
  // ScreenWedgeDetectorCron chases). lastPingAt and cache-report prove
  // "TCP-reachable + JS event loop alive"; neither proves "painting."
  //
  // The render-proof that DOES: a requestAnimationFrame loop. rAF callbacks
  // are driven by the compositor — the browser/WebView only schedules them
  // when it actually paints a frame. A frozen renderer, a backgrounded tab,
  // or a wedged compositor stops firing rAF entirely, so the frame counter
  // STOPS ADVANCING. We POST the counter (+ a content signature) every 30s
  // ONLY while we're actually rendering content (phase 'playing'/'emergency'
  // or an active emergency overlay) — so the server's lastRenderedAt is a
  // true proof-of-display, and the fleet list flags render-STALE/RED when it
  // goes stale even though lastPingAt is fresh.
  //
  // Additive + safe: best-effort POST to a NEW endpoint with a device JWT
  // (same auth as cache-status). Never touches the emergency path, the
  // manifest, lastPingAt, or any existing heartbeat. If it never POSTs (old
  // build / browser-only / network down) the server reads renderHealth
  // UNKNOWN — never falsely RED. Preview mode is skipped so it can't write
  // proof on behalf of the real paired device.
  const renderFramesRef = useRef(0);
  // Mirror the live render state into refs so the rAF loop + the 30s POST
  // timer read CURRENT values without restarting their effects on every
  // content/phase change (which would reset the frame counter mid-stream).
  const renderStateRef = useRef<{ rendering: boolean; sig: string; kind: string }>({
    rendering: false,
    sig: '',
    kind: 'idle',
  });
  useEffect(() => {
    // "Actually rendering content" = paired + past the splash phases, not
    // paused, and either playing a playlist/template or showing an
    // emergency. This gates render-proof so we don't claim proof-of-display
    // while sitting on the pairing/connecting splash (which DOES paint, but
    // isn't operator content — we only want to assert "the content the
    // operator scheduled is on screen").
    const emergencyOn = !!activeEmergency || phase === 'emergency';
    const playingContent = phase === 'playing' && !!playlist && !playbackStopped;
    const rendering = emergencyOn || playingContent;
    // Short content signature so lastRenderedHash is meaningful for
    // proof-of-display / incident replay without shipping a giant payload.
    let sig = '';
    let kind = 'idle';
    if (emergencyOn) {
      kind = 'emergency';
      const em: any = activeEmergency || {};
      sig = `em:${em.type || em.severity || 'active'}`;
    } else if (playingContent) {
      kind = (playlist as any)?.template ? 'template' : 'playlist';
      // currentPlaylistSigRef already tracks the live playlist/template
      // signature (it changes when the operator swaps content); use it as a
      // compact proof-of-display token. (We deliberately don't fold in the
      // slide index — currentIndexRef is declared lower in this component,
      // and the playlist signature alone is enough to prove WHAT is on screen.)
      sig = `pl:${currentPlaylistSigRef.current || (playlist as any)?.id || 'unknown'}`;
    }
    // ── IDLE IS ALSO A FACT (2026-08-25, v1.1.6) ────────────────────────
    // A freshly-paired panel with no schedule paints its own waiting screen
    // forever and reported NOTHING, so the fleet's render-trust chip stayed
    // silent on a brand-new install — and after the 2026-08-25 field night
    // the operator reads silence as breakage. It now proves liveness, but
    // under an `idle:` signature so nothing downstream can mistake it for
    // proof that OPERATOR CONTENT is on the glass. See the POST below.
    if (!rendering) sig = `idle:${phase}`;
    renderStateRef.current = { rendering, sig: sig.slice(0, 128), kind };
  }, [phase, playlist, playbackStopped, activeEmergency]);

  // The rAF paint counter. One loop for the lifetime of the page; it only
  // advances when the compositor paints. We DON'T gate the loop on
  // `rendering` — we always want a live paint counter — but the 30s POST
  // below only reports it when we're rendering operator content.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return;
    let raf = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      renderFramesRef.current = (renderFramesRef.current + 1) % Number.MAX_SAFE_INTEGER;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, []);

  // ── 2026-08-25 (v1.1.5) — hand the APK this screen's DEVICE JWT ────────
  //
  // `setBootstrap` (above) gave the out-of-process workers an ADDRESS. This
  // gives them an IDENTITY, and without it the OTA worker's
  // `/player/update-check` is anonymous — which silently disables the two
  // things the server only does for a request that PROVES it is this screen:
  //
  //   1. `source:"user"` — the panel's own Update button. Unproven, it is
  //      dropped on the floor and the tap on the glass stays gated with no
  //      error anywhere. That is the exact silent failure v1.1.5 kills.
  //   2. clearing an operator's pending APK push when the install lands
  //      (`persistReportedVersion` refuses unauthenticated install claims —
  //      OTA-01 — so today the flag rides its 24 h stale window instead).
  //
  // Keyed on `screenId` rather than mount-once BECAUSE OF PAIRING: on a
  // fresh panel the page renders long before a token exists, and a
  // mount-only effect would leave the worker anonymous until the next
  // reboot. `screenId` arriving IS the "we are paired now" signal.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isPreviewMode()) return;
    if (!nativeHas('setDeviceToken')) return; // pre-1.1.5 APK — untouched
    try {
      const deviceToken = getDeviceToken();
      // Only ever push a REAL token. An empty push is how the native side
      // is told to forget one (an unpair), and doing that from a render
      // that merely raced pairing would take a healthy screen's OTA auth
      // away for no reason.
      if (deviceToken) nativeFire('setDeviceToken', deviceToken);
    } catch (e) {
      // Non-fatal: the worker falls back to the anonymous check, which is
      // exactly what the whole fleet does today.
      // eslint-disable-next-line no-console
      console.warn('[Player] setDeviceToken bridge call failed', e);
    }
  }, [screenId]);

  // ── THE PAIRING GATE FOR DEVICE→SERVER TELEMETRY (2026-08-25, v1.1.6) ──
  //
  // `screenId` alone is NOT "this screen can talk to the server". A device
  // that has only REGISTERED holds a 15-minute unpaired credential, and every
  // tenant-scoped device route refuses it (`allowUnpaired: false` →
  // `screen_unpaired` → 401). It is also not a value that CHANGES at pairing:
  // the pair endpoint updates the same row, so `setScreenId` is handed an
  // identical string and React bails out of the state update.
  //
  // That combination is what made the capability report on a brand-new panel
  // a single guaranteed-401 attempt that could never re-run. This derived
  // value is the missing edge: null while the screen is on the registering /
  // pairing splash, the screen id the moment it is past it. Effects that write
  // to a tenant-scoped device route key on THIS, never on `screenId` alone.
  //
  // ⚠️ AND IT IS THE RIGHT EDGE FOR THE CREDENTIAL TOO, which is why it is
  // this boolean and not `paired` off the heartbeat. `POST /screens/pair`
  // bumps `credentialEpoch`, retiring the unpaired token this player is
  // holding — so a report fired on the pairing tick would 401 again, with a
  // different reason. Leaving the pairing splash happens only AFTER the poll
  // has re-registered and exchanged for a paired credential (see the
  // `exchanged` gate in the pairing poll below), so by the time this flips
  // there is a good token to send.
  const capabilityReportGate =
    screenId && phase !== 'registering' && phase !== 'pairing' ? screenId : null;

  // Report this device's display capabilities once per (screen × APK version).
  //
  // Deliberately AFTER first paint: this is admin visibility, not playback. It
  // must never compete with getting content on screen, and it must never
  // become a per-poll write — see displayCapabilityReport.ts for why the app
  // version is the cache key and why a non-2xx deliberately does not mark the
  // report as done.
  //
  // ── THE BUG THIS FIXES (field install, 2026-08-25, v1.1.5) ──────────────
  //
  // A brand-new panel (GUQ55) was INVISIBLE to every trust system ten minutes
  // after pairing: `lastPingAt` fresh (11 s), `displayCapabilitiesAt: never`.
  // The dashboard therefore had no verdict, so brightness / blank / panel
  // power were all gated off on a screen that had just been installed.
  //
  // ROOT CAUSE — two facts that only bite together:
  //
  //   1. `POST /screens/register` calls `setScreenId(data.screenId)` for an
  //      UNPAIRED device too (it is how the pairing splash knows its own row),
  //      so `screenId` becomes truthy ~1 s after boot — LONG before an
  //      operator types the code into the dashboard.
  //   2. `POST /screens/:id/display-capabilities` verifies with
  //      `{ allowUnpaired: false }` (display.controller.ts — an unpaired
  //      screen has no tenant to audit against), so that first attempt is a
  //      401 `screen_unpaired`. `reportDisplayCapabilities` correctly does NOT
  //      set its dedup marker on a non-2xx… but this effect was keyed on
  //      `[screenId]` ALONE, and PAIRING DOES NOT CHANGE THE SCREEN ID (the
  //      pair endpoint updates the same row). React bails out of the identical
  //      `setScreenId`, the dependency never changes, and the one-shot NEVER
  //      FIRES AGAIN. The panel had no content and therefore no reload, so
  //      nothing ever retried.
  //
  // THE FIX, in two deliberately narrow parts:
  //   • Key the effect on `capabilityReportGate` — the screen id PLUS whether
  //     this screen is past the pairing splash. Pairing flips that boolean, so
  //     the report re-runs exactly once, at the moment the credential becomes
  //     good enough for the endpoint to accept it.
  //   • Give it a bounded retry ladder, because "the first attempt is the only
  //     attempt" is the fragility underneath the bug: a Railway restart, a
  //     transient 5xx or a WiFi drop at second 8 of a screen's life produced
  //     the same permanent silence. Three attempts, then stop.
  //
  // It stays a per-EVENT write, never a per-poll one: the ladder halts on the
  // first success AND on every `skipped:` verdict, and nothing re-arms it
  // without a pairing transition or a page load.
  useEffect(() => {
    if (!capabilityReportGate) return;
    if (isPreviewMode()) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // 8 s (after first paint, as before), then 45 s, then 3 min.
    const LADDER_MS = [8_000, 45_000, 180_000];

    const attempt = (i: number) => {
      timer = setTimeout(() => {
        if (cancelled) return;
        void reportDisplayCapabilities({
          // The gate IS the screen id once it is non-null — using it here
          // keeps the "paired" proof and the id that gets reported as one
          // value, so they can never disagree.
          screenId: capabilityReportGate,
          apiRoot: getApiRoot(),
          token: getDeviceToken(),
          // Vendor-recipe matching needs Build.MANUFACTURER/MODEL/BOARD, and
          // the probe is the only bridge surface that reports `board`. The
          // next manifest poll re-translates the `display` block with this
          // identity, so the fingerprint moves and the (now recipe-carrying)
          // config installs — no extra probe, no extra install.
          onIdentity: (identity) => {
            deviceIdentityRef.current = { ...deviceIdentityRef.current, ...identity };
          },
        }).then((status) => {
          if (cancelled) return;
          if (status !== 'skipped: already reported this version') {
            console.log(`[display-caps] ${status}`);
          }
          // Retry ONLY a genuine failure. Every `skipped: …` is a permanent
          // property of this device or this build (no probe, no verdict,
          // already reported) that retrying cannot change — hammering those
          // is exactly the per-poll write this report exists to avoid.
          if (status.startsWith('failed') && i + 1 < LADDER_MS.length) attempt(i + 1);
        });
      }, LADDER_MS[i]);
    };
    attempt(0);

    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [capabilityReportGate, screenId]);

  // POST render-proof every 30s while rendering content.
  useEffect(() => {
    if (!screenId) return;
    if (isPreviewMode()) return;
    let lastReportedFrames = -1;
    let lastIdlePostAtMs = 0;
    // ── THE IDLE LANE (2026-08-25, v1.1.6) ──────────────────────────────
    //
    // WHY IT EXISTS. On the first install of GUQ55 a correctly-working,
    // freshly-paired panel reported `lastRenderedAt: never`, because
    // render-proof only ever fired while operator content was on screen and
    // this screen had no schedule yet. The fleet chip therefore said nothing
    // about a brand-new install — and "nothing" is the one thing an operator
    // who has just been burned reads as broken.
    //
    // WHY IT CANNOT LIE. `lastRenderedHash` carries an `idle:<phase>` prefix
    // for these posts, and the dashboard grades on it (see
    // components/screens/renderTrust.ts): an idle proof renders as "alive,
    // nothing on screen yet", NEVER as the green "showing content" that a
    // content proof earns. The word `painting` keeps its meaning.
    //
    // WHY IT IS NOT A WRITE AMPLIFIER. Five minutes, not thirty seconds —
    // one tenth of a playing screen's rate, and the server additionally
    // coalesces every render-proof write to ≤1 per 40 s. Every column it
    // touches (lastRenderedAt / Frames / Hash, lastBundleSha*) is already in
    // SCREEN_TELEMETRY_ONLY_FIELDS, so it can never bust a manifest hot-cache
    // entry — the 25 GB/mo egress rule in CLAUDE.md is respected by
    // construction, not by luck.
    //
    // AND IT STILL CANNOT HIDE A FREEZE: the frame-counter check below runs
    // for the idle lane too, so a wedged compositor reports nothing at all.
    const IDLE_PROOF_INTERVAL_MS = 5 * 60_000;
    // Compiled into the bundle — constant for the life of this document, so
    // read once per effect rather than on every 30s tick. A reload onto a
    // new bundle mounts a new document and re-reads it.
    const bundleSha = readOwnBundleSha();
    const post = async () => {
      const state = renderStateRef.current;
      const idle = !state.rendering;
      // An idle panel proves liveness, not content — and only once it is
      // PAIRED. An unpaired screen belongs to no tenant, so there is nobody
      // for the proof to be visible to and no reason to write its row.
      if (idle && !capabilityReportGate) return;
      if (idle && Date.now() - lastIdlePostAtMs < IDLE_PROOF_INTERVAL_MS) return;
      const frames = renderFramesRef.current;
      // If the paint counter hasn't advanced AT ALL since the last report,
      // the renderer is wedged — skip the POST so lastRenderedAt goes stale
      // and the fleet flags this screen RED. (Reporting a frozen counter
      // would keep lastRenderedAt fresh and HIDE the freeze — the exact bug.)
      if (frames === lastReportedFrames) return;
      lastReportedFrames = frames;
      if (idle) lastIdlePostAtMs = Date.now();
      try {
        const tok = getDeviceToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (tok) headers['Authorization'] = `Bearer ${tok}`;
        // Frame-locked sync telemetry piggybacks the existing 30s proof-of-
        // display POST (device-authed, best-effort, coalesced server-side).
        // Absent entirely when sync is off — the wire payload is unchanged
        // for the whole non-sync fleet.
        let syncReport: Record<string, unknown> | undefined;
        if (syncConfigRef.current.enabled) {
          const mono = performance.now();
          const cstats = syncClockRef.current?.stats(mono);
          syncReport = {
            locked: syncActiveRef.current,
            errMs: syncStatsRef.current.flipErrEwmaMs != null
              ? Math.round(syncStatsRef.current.flipErrEwmaMs * 10) / 10
              : null,
            clockUncertaintyMs: cstats && Number.isFinite(cstats.uncertaintyMs)
              ? Math.round(cstats.uncertaintyMs * 10) / 10
              : null,
            rttMs: cstats?.rttMs != null ? Math.round(cstats.rttMs) : null,
            contentSig: hashContentSig(currentPlaylistSigRef.current || ''),
            // Tier-1 self-calibration readouts (dashboard diagnostics):
            // this device's measured render-pipeline lead + crystal skew.
            renderLeadMs: Math.round(syncRenderLeadRef.current * 10) / 10,
            skewPpm: cstats?.skewPpm != null ? Math.round(cstats.skewPpm * 10) / 10 : null,
          };
        }
        // D-2 (2026-08-30): a live stall episode PREPENDS a marker so the
        // dashboard's lastRenderedHash stops reading healthy on a frozen
        // video. Prepended (not appended) because the sig is truncated at
        // 128 chars and a suffix would vanish on long playlist signatures.
        // Stalls only occur on `pl:` content sigs, so the idle: grading
        // path is never affected.
        //
        // A-F10 (2026-08-30): an EMERGENCY on glass that the server hasn't
        // re-confirmed for 2+ minutes gets its own marker — the screen may
        // be riding a cached alert through a credential/network failure
        // (correct never-give-up behavior), but an ALL-CLEAR cannot reach
        // it in that state and the operator must see that, not a green
        // "showing content". `em:` and `pl:` sigs are mutually exclusive,
        // so the two markers never stack.
        const alertUnconfirmed =
          state.sig.startsWith('em:') &&
          (lastManifestOkAtRef.current === 0 ||
            Date.now() - lastManifestOkAtRef.current > 2 * 60_000);
        const stallMarked = alertUnconfirmed
          ? `unconfirmed|${state.sig}`
          : isActiveMediaStalled() && state.sig.startsWith('pl:')
            ? `stall|${state.sig}`
            : state.sig;
        const proofRes = await fetch(`${getApiRoot()}/api/v1/screens/${screenId}/render-proof`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            frames,
            hash: stallMarked,
            contentKind: state.kind,
            // 2026-08-25 — WHICH PAGE BUNDLE THIS PANEL IS RUNNING.
            // The fix for a player bug ships in the web bundle and each
            // panel reloads onto it on its own schedule (see the
            // bundle-drift effect below), so for ~20 min after a deploy a
            // fixed button and a dead button are indistinguishable from the
            // dashboard. Reporting the SHA here — on the POST we already
            // make, device-authed, additive — lets the Screens list say
            // "this panel is still on an older page bundle" instead of
            // leaving the operator to infer it from deploy timestamps.
            // Omitted entirely (not null) when the build didn't stamp one,
            // so the wire payload is unchanged for a local/self-hosted
            // build and the server stores nothing rather than a fake probe.
            ...(bundleSha ? { bundleSha } : {}),
            ...(syncReport ? { sync: syncReport } : {}),
            // Durable-REFRESH acknowledgment (W1-11): echo the exact command
            // value we acted on so the server clears the pending flag.
            ...(readRefreshAck() !== null ? { refreshAckMs: readRefreshAck() } : {}),
          }),
        });
        // 2026-08-30 (reliability program W1-9) — this fetch used to be
        // fire-and-forget: a 401 here meant the server was REJECTING our
        // proof-of-display (dead credential) and we treated it as sent.
        // That is precisely how G43's lastRenderedAt went silently stale
        // while the screen thought it was reporting. A 401 now feeds the
        // credential recovery machine; other failures stay best-effort but
        // at least leave a console trail.
        if (!proofRes.ok) {
          if (proofRes.status === 401) {
            void attemptCredentialRecovery('render-proof-401');
          } else {
            console.warn(`[Player] render-proof POST rejected: HTTP ${proofRes.status}`);
          }
        }
      } catch { /* best-effort — admin visibility, not safety-critical */ }
    };
    post();
    const t = setInterval(post, 30_000);
    return () => clearInterval(t);
    // `capabilityReportGate` is read by the idle lane, so pairing must
    // re-arm this effect — otherwise a screen paired after boot would keep
    // the closure's stale `null` and never report idle liveness. The CONTENT
    // lane is unchanged: it still runs from the moment `screenId` exists.
  }, [screenId, capabilityReportGate]);

  // ─── Frame-locked sync: HTTP clock fallback + sleep-resume recovery ──
  // Primary sampling is TIME_PING over the WS (lower jitter). This effect
  // covers (a) WS-blocked networks (Squid/ZScaler fleets run SSE/HTTP-only
  // and would otherwise never lock a clock) and (b) device sleep, where
  // performance.now() can PAUSE (crbug.com/1206450) and silently poison
  // every pre-sleep sample — on resume we reset and re-lock from scratch.
  // Runs only while the manifest has sync enabled; checks every 5s and
  // only actually fetches when no WS sample landed in the last 25s.
  useEffect(() => {
    if (!syncEnabled) return;
    let cancelled = false;
    const sampleHttp = async () => {
      try {
        if (!syncClockRef.current) syncClockRef.current = new SyncClock();
        const clock = syncClockRef.current;
        const mono0 = performance.now();
        const res = await fetch(`${getApiRoot()}/api/v1/realtime/time`, { cache: 'no-store' });
        const mono1 = performance.now();
        if (!res.ok || cancelled) return;
        const j = await res.json().catch(() => null);
        if (j && typeof j.serverNow === 'number') clock.addSample(j.serverNow, mono0, mono1);
      } catch { /* offline — clock coasts on its drift model; telemetry flags staleness */ }
    };
    const t = setInterval(() => {
      const stats = syncClockRef.current?.stats(performance.now());
      const wsFeeding = !!stats && stats.lastSampleAgeMs !== null && stats.lastSampleAgeMs < 25_000;
      if (!wsFeeding) sampleHttp();
    }, 5_000);
    const onVis = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        syncClockRef.current?.reset();
        syncPingStateRef.current.burstRemaining = 10;
        sampleHttp();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    sampleHttp(); // immediate first fix — don't wait 5s to start locking
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [syncEnabled]);

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
      //
      // BUG #4 note — emergency asset URLs are INTENTIONALLY cached RAW (not
      // CDN-rewritten). The emergency media overlay (EmergencyOverlay.tsx)
      // renders `mediaUrls` verbatim with no resolveAssetUrl call, so the
      // cache key must stay on the raw origin URL to match its <img src>.
      // (The emergency PLAYLIST tier — manifest.playlists during an
      // emergency — renders through the normal playlist path, which DOES
      // resolveAssetUrl images, and is precached via the CDN-aware playlist
      // push above; the two stay in sync.) Do NOT wrap data.assets here.
      // Deep-audit F5 (2026-08-30): an EMPTY asset list is "this tenant has
      // no emergency assets configured / a partial response" — never an
      // instruction to wipe the never-evict tier. The SW refuses it too
      // (belt + braces); refusing HERE also keeps lastEmergencySetHashRef
      // uncommitted so a later real payload retries normally.
      if (!Array.isArray(data.assets) || data.assets.length === 0) return;
      const ack = await precacheEmergency(data.assets, data.setHash || '');
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
            const { res: statusRes, json: statusData } = await fetchJsonBounded(
              buildHeartbeatUrl(getApiRoot(), deviceId), { cache: 'no-store' }, 15_000);
            if (statusRes.ok && statusData) {
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
        // Bounded ACROSS THE BODY (D-1/F1): the never-gives-up registration
        // chain awaits this — a hung socket OR a stalled body used to stall
        // it with no throw, so no retry either.
        const { res, json: data } = await fetchJsonBounded(`${getApiRoot()}/api/v1/screens/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceFingerprint: fp,
            ...deviceInfo,
            ...(storedPriorToken ? { priorDeviceToken: storedPriorToken } : {}),
          }),
        }, 20_000);

        if (cancelled) return;
        if (!res.ok) throw new Error(`Registration HTTP ${res.status}`);
        if (!data) throw new Error('Registration returned an empty body');

        setScreenId(data.screenId);
        setScreenName(data.name);

        // Persist the device JWT the API now mints at register time.
        // Before this fix the browser player had no device token, so
        // manifest fetches fell back to a hardcoded demo admin login
        // (that doesn't exist in production) and every paired screen
        // showed 'unable to connect'.
        if (data.deviceToken) persistDeviceToken(data.deviceToken);

        // 2026-08-30 (reliability program W1-2) — `requiresRePair` is a REAL
        // state, not a hint to ignore. The server sets it when the prior
        // credential was stale/expired/absent: the token we just stored is a
        // 1-hour unproven one that keeps content alive (and the proactive
        // renewal timer keeps re-minting it), but this device's trust is
        // gone until an operator actually re-pairs it. Persist the fact and
        // surface it — the old code dropped it on the floor, which is how
        // G43 sat "ONLINE" and content-dead for 37 hours.
        const needsRePair = data.requiresRePair === true;
        repairRequiredRef.current = needsRePair;
        setRepairRequired(needsRePair);

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
  //
  // 2026-08-30 (reliability program W1-4) — rebuilt on createPairingLoop.
  // The old interval/one-shot-timeout mixture had a terminal state nobody
  // designed: after 3 failures the interval was cleared and ONE retry
  // timeout scheduled, whose comment promised "retry re-arms the interval
  // on a successful tick" — no code did. So a 3-blip outage followed by one
  // successful-but-still-unpaired poll stopped polling FOREVER, stranding
  // the screen on the pairing splash until a power cycle. The loop below is
  // timeout-chained: scheduling the next tick is the default; only stop()
  // (effect cleanup) or pairing completion ('done') can end it.
  useEffect(() => {
    if (phase !== 'pairing') return;

    const fp = getDeviceFingerprint();
    const loop = createPairingLoop({
      baseMs: 3000,
      backoff: (n) => backoffMs(n, 3000, 30_000),
      tick: async () => {
        // Bounded ACROSS THE BODY (D-1/F1): the loop AWAITS each tick — a
        // hung fetch OR stalled body here would stop pairing polling
        // forever, the exact failure this loop ended.
        const { res, json: data } = await fetchJsonBounded(buildHeartbeatUrl(getApiRoot(), fp), {}, 10_000);
        if (!res.ok || !data) return 'fail';
        if (data.paired) {
          // ⚠️ EXCHANGE THE CREDENTIAL BEFORE ADVANCING (2026-08-24).
          //
          // THE BUG THIS FIXES. This heartbeat tells us we are paired, but
          // its response carries NO deviceToken — deliberately, it is an
          // unauthenticated status endpoint. So the token we are still
          // holding is the UNPAIRED one minted by our first
          // `POST /screens/register`, back when this screen had no tenant.
          // Advancing straight to 'connecting' on that credential meant every
          // device-authenticated call — manifest, cache-status,
          // emergency-assets — 401'd forever, and the WS never authenticated.
          // The screen sat in a permanent "reconnecting" loop that ONLY a
          // manual refresh cleared, because a refresh re-runs Phase 1, which
          // re-registers and DOES persist the paired token.
          //
          // Observed live on 2026-08-24 on two freshly-installed boxes (M43
          // and G43 on v1.1.2): paired cleanly, then 401'd every 30s for ~9
          // minutes until the operator refreshed them by hand.
          //
          // So: do here what the refresh does. Re-register with our prior
          // token as proof-of-possession; the server sees the screen is now
          // paired and mints the full paired credential.
          //
          // ON FAILURE WE DO NOT ADVANCE. Staying on the pairing splash keeps
          // this 3s poll alive and self-heals on the next tick. Advancing
          // without a paired credential is the exact dead-end above, and it
          // is unrecoverable without physical access to the screen.
          let exchanged = false;
          try {
            const prior = getDeviceToken();
            const { res: rr, json: rd } = await fetchJsonBounded(`${getApiRoot()}/api/v1/screens/register`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                deviceFingerprint: fp,
                ...(prior ? { priorDeviceToken: prior } : {}),
              }),
            }, 15_000);
            if (rr.ok) {
              if (rd?.deviceToken) persistDeviceToken(rd.deviceToken);
              // 2026-08-30 — carry the server's trust verdict out of the
              // exchange too (a re-pair that raced the epoch grace window
              // lands here with requiresRePair=true).
              const needsRePair = rd?.requiresRePair === true;
              repairRequiredRef.current = needsRePair;
              setRepairRequired(needsRePair);
              // A 2xx even WITHOUT a body/token still counts: an older API
              // may not mint one here, and in that case the credential we
              // already hold is the best available. Never block on a field
              // we cannot require. (rd is null-safe above for that reason.)
              exchanged = true;
            }
          } catch {
            /* leave exchanged=false — the loop retries with backoff */
          }
          if (!exchanged) return 'fail';
          setScreenName(data.name);
          setScreenId(data.screenId);
          setPhase('connecting');
          return 'done';
        }
        // 2026-04-29 — Pull real OTA state from heartbeat (added to
        // server response same date). Drives the splash's update
        // banner with actual CHECKING/DOWNLOADING/INSTALLING progress
        // instead of elapsed-time estimates.
        //
        // 2026-04-29 — Heartbeat-driven OTA polling fallback. The
        // operator's v1.0.30 kiosk got NOTHING from a push because
        // the WebSocket re-handshake after the prior install missed
        // the CHECK_FOR_UPDATES message. Yodeck/Rise/etc. don't use
        // WS for this — they poll. We now do both: WS for instant
        // delivery (when it works), heartbeat polling as the safety
        // net (when it doesn't). Maximum delay before a push is
        // honored: one heartbeat interval (~30s).
        handleHeartbeatOta(data, 'pairing heartbeat');
        return 'continue';
      },
    });
    loop.start();
    return () => loop.stop();
  }, [phase, handleHeartbeatOta]);

  // ─── Phase 3: Fetch playlist content ───
  // 2026-08-30 (reliability program W1-6) — the body below is the INNER
  // reconcile; every caller goes through the single-flight `fetchContent`
  // wrapper defined after it. Six independent triggers used to invoke this
  // concurrently (reconcile interval, 5–10 s emergency poll, HTTP realtime
  // fallback, WS/SSE SYNC, manual sync, retry timers) and the last response
  // to ARRIVE won — even when it was the oldest. Serialized, a stale
  // in-flight response can never overwrite a newer one.
  const fetchContentInner = useCallback(async () => {
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
    /**
     * @param fromCache true when this manifest came off DISK (the offline
     *   fallback), not from the server. It is NOT the server of record, so
     *   the emergency-hold RELEASE must not run off it — see the interlock
     *   block below.
     */
    const applyManifest = (manifest: any, fromCache = false) => {
      // ── EMERGENCY FIRST (deep-audit F11, 2026-08-30) ────────────────────
      // This block used to sit ~300 lines down, behind orientation / canvas
      // / wiring / sync / display / SW-push handling. Every one of those is
      // individually try/caught today — but a future throw in any of them
      // would have skipped the emergency apply, and on the cached-fallback
      // path (inside fetchContent's catch) escaped into the manifest gate's
      // swallow, skipping retry scheduling too. The life-safety decision
      // now runs before anything that could conceivably fail. Body moved
      // verbatim from below except for the F8 guard, which makes a
      // previously-emergent invariant ENFORCED: a CACHED (offline-fallback)
      // manifest with no emergency must never clear a live overlay — only
      // the server of record clears an alert.
      //
      // Detect emergency override.
      //
      // 2026-05-26 P0-2 fix: the API returns FLAT fields on the manifest
      // when an emergency is active (isEmergency, emergencyType,
      // emergencySeverity, emergencyScopeNote, emergencyScope), NOT a
      // nested `emergency` / `override` envelope. See the original block's
      // history below at the "EMERGENCY INTERLOCK" comment.
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
      // The manifest is the SOLE arbiter of emergency state; the hold-raise
      // is forced on every poll, the release is server-only (see the
      // EMERGENCY INTERLOCK comment retained at the block's old site).
      // E-P0-01: a pending signed OVERRIDE keeps the hold raised through
      // the commit-race window — a normal manifest read BEFORE the trigger
      // transaction lands must not re-enable blanking. Bounded: the window
      // self-closes (confirm or 30s timeout) in the fetch path.
      const holdNow =
        !!em || !!pushedEmergencyMessageRef.current || !!pendingOverrideConfirmRef.current;
      if (holdNow || !fromCache) signalDisplayEmergencyHold(holdNow, holdNow);
      // F8 — ENFORCED overlay interlock: a cached normal manifest replayed
      // during an outage cannot clear a live alert. Previously this was
      // safe only because both stores shared one writer path; now it is a
      // stated, guarded rule.
      const cachedNormalWouldClearLiveAlert = fromCache && !em && !!activeEmergencyRef.current;
      if (cachedNormalWouldClearLiveAlert) {
        console.warn('[Player] cached (offline) manifest carries no emergency — keeping the live alert; only the server clears it');
      } else {
        setActiveEmergency(em);
        cacheEmergency(em);
      }

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
        // No-op off-APK — the CSS fallback effect handles it.
        nativeFire('setOrientation', orient);
        setManifestOrientation(orient);
      }

      // 2026-05-27 — hardware model from manifest. Drives the KioskSplash
      // LED-banner gate (LCD-direct boxes like the EP6N suppress it).
      // Null on legacy installs / older API; KioskSplash treats null as
      // "show banner" (safe default).
      const hwm =
        typeof manifest.hardwareModel === 'string' && manifest.hardwareModel.trim()
          ? manifest.hardwareModel.trim()
          : null;
      setManifestHardwareModel(hwm);

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
      // 2026-05-27 — EP6N wiring. Stashed in `Screen.config.wiring`
      // and surfaced on the manifest as `wiring`. CtsBridge reads it
      // to know which native RS232 port carries CTS vs Stream Deck.
      if (manifest.wiring && typeof manifest.wiring === 'object') {
        const w = manifest.wiring as { rs232_1?: string; rs232_2?: string };
        const allowed = new Set(['cts', 'streamdeck', 'aux', 'off']);
        const rs232_1 = allowed.has(w.rs232_1 ?? '')
          ? (w.rs232_1 as 'cts' | 'streamdeck' | 'aux' | 'off')
          : undefined;
        const rs232_2 = allowed.has(w.rs232_2 ?? '')
          ? (w.rs232_2 as 'cts' | 'streamdeck' | 'aux' | 'off')
          : undefined;
        if (rs232_1 !== undefined || rs232_2 !== undefined) {
          setManifestWiring({ rs232_1, rs232_2 });
        } else {
          setManifestWiring(null);
        }
      } else {
        setManifestWiring(null);
      }
      // 2026-06-01 — which scoreboard console this screen is wired to,
      // from `Screen.config.consoleProfile`. Validated against the known
      // ids (keep in sync with the package's ConsoleProfileId + the API
      // manifest allow-list). Unknown / absent → undefined (CtsBridge
      // uses its 'cts-gen6' default, so existing installs are unchanged).
      {
        const cpRaw = typeof manifest.consoleProfile === 'string' ? manifest.consoleProfile : '';
        const cpAllowed = new Set(['cts-gen6', 'cts-gen7', 'cts-wttc', 'daktronics-allsport']);
        const cp = cpAllowed.has(cpRaw)
          ? (cpRaw as 'cts-gen6' | 'cts-gen7' | 'cts-wttc' | 'daktronics-allsport')
          : undefined;
        if (cp !== manifestConsoleProfile) setManifestConsoleProfile(cp);
      }
      // 2026-07-28 — frame-locked multi-screen sync config. Allow-list
      // validated like wiring/consoleProfile above. Parsed only when the
      // manifest carries the block (older cached SW payloads / emergency
      // branch omit it → keep current config, defensive default = off).
      // trimMs is the per-screen display-latency trim, clamped ±2000ms.
      if (manifest.sync && typeof manifest.sync === 'object') {
        const sb: any = manifest.sync;
        const enabled = sb.enabled === true;
        const trimMs = enabled && typeof sb.trimMs === 'number' && Number.isFinite(sb.trimMs)
          ? Math.max(-2000, Math.min(2000, Math.round(sb.trimMs)))
          : 0;
        const groupId = enabled && typeof sb.groupId === 'string' ? sb.groupId : null;
        const wasEnabled = syncConfigRef.current.enabled;
        syncConfigRef.current = { enabled, trimMs, groupId };
        if (enabled && !wasEnabled) {
          // Just turned on (operator flipped the group toggle) — start
          // locking immediately rather than waiting for a reconnect.
          if (!syncClockRef.current) syncClockRef.current = new SyncClock();
          syncPingStateRef.current.burstRemaining = 10;
          console.log('[Player Sync] enabled by manifest — locking clock (group', groupId, ', trim', trimMs, 'ms)');
        }
        setSyncEnabled(enabled);
      }
      // ── DISPLAY CONTROL — install the on/off schedule + vendor recipe ──
      //
      // This is the ONLY delivery path for the feature's headline capability.
      // The dashboard's per-screen on/off windows and the vendor-recipe
      // catalog both ride the manifest's `display` block; without this call
      // `DisplayConfigStore.load` returns EMPTY on every screen in the fleet
      // and `DisplayScheduler` logs "no active schedules" forever.
      //
      // Three rules, all load-bearing:
      //   1. DIFF FIRST. The block arrives on every poll (5–10 s), and
      //      `setScheduleJson` re-persists, re-resolves the provider chain
      //      and re-arms an AlarmManager on every call. Fingerprint and skip.
      //   2. NEVER INSTALL AN ABSENT BLOCK. The emergency manifest branch and
      //      older cached payloads omit `display` entirely; treating that as
      //      "no schedules" would DISARM a screen's overnight windows during
      //      a lockdown. `toDeviceDisplayConfig` returns null and we no-op.
      //   3. TRANSLATE, DON'T FORWARD. The API's block and
      //      `DisplayConfigParser` do not speak the same shape (array-of-
      //      recipes vs one `recipe`); displayControl.ts owns the mapping.
      //
      // Channel-transport only, by design: `displaySetSchedule` is refused on
      // the legacy every-frame bridge (a standing nightly blank is strictly
      // worse than a one-off blank, which at least carries a dead-man), so on
      // a legacy-only box this is a logged no-op rather than a silent one.
      installDisplayConfig(manifest.display, deviceIdentityRef.current, displayConfigFpRef);
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
              // BUG #4 fix — the SW must cache under the SAME URL the <img>
              // renders, or offline images break the moment the CDN is
              // enabled. The render path (see resolvedUrl / resUrl below)
              // routes IMAGES through resolveAssetUrl (→ the CDN host) but
              // leaves video/web/pdf on the raw origin URL. Mirror that here
              // so the cache key === the rendered src. resolveAssetUrl is a
              // no-op until NEXT_PUBLIC_ASSET_CDN is set, so the non-CDN case
              // is byte-for-byte unchanged. Video/web/pdf stay raw so the SW
              // Range cache keeps keying on the origin URL.
              const absUrl = u.startsWith('http') ? u : `${getApiRoot()}${u}`;
              const isImage = item.mime_type
                ? String(item.mime_type).startsWith('image/')
                : (!u.match(/\.(mp4|webm|mov|m4v)$/i)
                  && !u.match(/\.(pdf)$/i)
                  && !(u.match(/^https?:\/\//i) && !u.match(/\.(jpe?g|png|gif|webp|svg|avif)$/i)));
              playlistAssets.push({ url: isImage ? resolveAssetUrl(absUrl) : absUrl });
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
      // EMERGENCY INTERLOCK (2026-08-13) — HISTORY PRESERVED, CODE MOVED.
      //
      // The emergency detection + hold + overlay writes that lived here for
      // months now run at the TOP of this function (deep-audit F11,
      // 2026-08-30) so no future throw in the preamble can skip the
      // life-safety decision. The rules are unchanged and still binding:
      //   • the manifest is the SOLE arbiter — only the server of record
      //     ever RELEASES the hold or clears the overlay;
      //   • the hold-raise is forced every poll (re-arms a restarted native
      //     process mid-alert); the release is deduped and server-only;
      //   • the pushed-message tier (SOS / TEXT_BROADCAST / MEDIA_ALERT)
      //     rides its own ref so a tenant manifest can't release a hold out
      //     from under a live SOS takeover;
      //   • a CACHED manifest is not the server of record: it may RAISE
      //     (never-give-up offline posture) but never RELEASE — and since
      //     F8 that includes the overlay itself, not just the native hold.
      if (manifest.playlists && manifest.playlists.length > 0) {
        // B-P2-10 (2026-08-30): the empty-streak reset moved DOWN into the
        // branches that actually APPLY content. Resetting here — on
        // playlists merely EXISTING — while the increment fires on
        // effective emptiness (all windows closed) made the two paths
        // disagree about what "empty" means and pinned the streak at 0↔1.
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
        // ── Effective content selection (2026-08-30, reliability W1-7/W1-8) ──
        //
        // OLD RULE: "any playlist with a template wins absolutely" — so a
        // months-old GROUP template schedule silently shadowed a brand-new
        // screen-specific media publish forever (a confirmed stale-content
        // path from the 1.1.6 audit, §P0-3). And the template apply
        // signature was just `tpl:<id|name>`, so editing zones/colors/text
        // under the same template ID never re-applied (§P0-4).
        //
        // NEW RULE (only when the API marks playlists with `schedule.mode`
        // — legacy manifests keep the old behavior bit-for-bit so a stale
        // cached manifest can't change semantics mid-deploy):
        //   winner  = FIRST replace-mode playlist in the server's ranked
        //             order (screen-pin > group, priority desc, newest
        //             startTime, stable id) whose schedule window is open
        //             right now;
        //   appends = every append-mode playlist whose window is open.
        // The winner decides template-vs-media; appends contribute items
        // only. Window math lives in scheduleWindow.ts (deep-audit
        // B-P0-2/B-P0-3): wrap-aware (22:00–06:00 works), start-day-owns-
        // the-wrap dow semantics, unit-tested per shape — because this
        // selection is the FIRST time playlist windows have ever been
        // enforced on the glass (manifests never carried per-item window
        // fields, so the old per-item gate always said "playable").
        const windowOpenNow = (sched: any): boolean => isWindowOpen(sched, new Date());
        const ranked = manifest.playlists.some((pl: any) => pl?.schedule?.mode != null);
        let templateWinner: any = null;
        let mediaSources: any[] = manifest.playlists;
        if (ranked) {
          const open = manifest.playlists.filter((pl: any) => windowOpenNow(pl.schedule));
          const winner = open.find((pl: any) => pl?.schedule?.mode !== 'append') ?? null;
          const appends = open.filter((pl: any) => pl?.schedule?.mode === 'append' && !pl.template);
          templateWinner = winner?.template ? winner : null;
          mediaSources = winner && !winner.template ? [winner, ...appends] : appends;
        } else {
          templateWinner = manifest.playlists.find((pl: any) => pl.template) ?? null;
        }
        if (templateWinner) {
          emptyManifestStreakRef.current = 0; // real content applied (B-P2-10)
          // B-P2-9 (2026-08-30): a template takeover ignores append
          // playlists by design (a full-screen template has no item
          // rotation to append into) — but silently is how operators lose
          // an afternoon. Say it, once per selection change.
          if (ranked) {
            const droppedAppends = manifest.playlists.filter(
              (pl: any) => pl?.schedule?.mode === 'append' && pl !== templateWinner,
            ).length;
            if (droppedAppends > 0) {
              console.warn(
                `[Player] template takeover active — ${droppedAppends} append playlist(s) are not shown while a template wins this screen`,
              );
            }
          }
          const tplSig =
            'tpl:' + (templateWinner.template?.id || templateWinner.template?.name || '')
            + (templateWinner.contentRev ? `:${templateWinner.contentRev}` : '');
          if (tplSig !== currentPlaylistSigRef.current) {
            currentPlaylistSigRef.current = tplSig;
            setPlaylist({ name: templateWinner.template.name || 'Template Content', template: templateWinner.template, items: [] });
            setCurrentIndex(0);
          }
          return true;
        }
        const combinedItems: any[] = [];
        mediaSources.forEach((mp: any) => {
          (mp.items || []).forEach((item: any, itemIndex: number) => {
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
          emptyManifestStreakRef.current = 0; // real content applied (B-P2-10)
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
            // Same content, but the emergency FLAG may have flipped (e.g. a
            // tenant whose everyday playlist doubles as its panic playlist).
            contentIsEmergencyRef.current = manifest.isEmergency === true;
            return true; // identical content — keep index + playlist as-is
          }
          // Fix #2 — clamp instead of reset when the playlist size
          // didn't shrink past the current index. If the operator
          // ADDED items at the end (length grew), we can keep going
          // from where we are. If they REMOVED items past our index,
          // wrap to 0.
          const oldHasItems = currentPlaylistSigRef.current !== '';
          currentPlaylistSigRef.current = newSig;
          contentIsEmergencyRef.current = manifest.isEmergency === true;
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
        // LIFE-SAFETY (2026-07-31): emergency content is NEVER retainable by
        // the blip defense. If the content on glass came from an emergency
        // manifest and the server now says non-emergency + empty, that IS
        // the all-clear on a tenant with no regular content — clear NOW.
        // (Verified live: the streak gate was keeping the lockdown playlist
        // on a real kiosk indefinitely after all-clear.)
        if (contentIsEmergencyRef.current && manifest.isEmergency !== true) {
          console.log('[Player] all-clear with no scheduled content — dropping emergency playlist immediately');
          emptyManifestStreakRef.current = 0;
          currentPlaylistSigRef.current = '';
          contentIsEmergencyRef.current = false;
          setPlaylist(null);
          setCurrentIndex(0);
          setManifestPlaylists([]);
          return true;
        }
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
        contentIsEmergencyRef.current = false;
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

      // LIFE-SAFETY (2026-07-31 stuck-lockdown incident): while an emergency
      // is DISPLAYED, every poll must come back as a FULL 200 from the
      // origin — no 304s, no intermediary caches. A stale Android WebView
      // HTTP cache or school proxy re-serving the emergency manifest after
      // all-clear left a real kiosk stuck on lockdown until manual resync
      // (server had cleared 13s after trigger; the device never saw it).
      // The `_eb` buster gives every emergency-mode poll a unique URL (no
      // URL-keyed cache can answer it) and If-None-Match is dropped so the
      // clear can never hide behind a 304. Normal (non-emergency) polls keep
      // the ETag/304 efficiency path untouched.
      // E-P0-01: a pending (signed, unconfirmed) OVERRIDE forces the same
      // cache-hostile fetch shape as a displayed emergency — the commit we
      // are chasing must not be able to hide behind a 304 or a proxy.
      const emergencyDisplayed =
        !!activeEmergencyRef.current || !!pendingOverrideConfirmRef.current;
      // 1. Try to fetch the specific device manifest (what it is officially scheduled to play)
      //
      // Bounded (2026-08-30 deep audit D-1): this await sits INSIDE the
      // single-flight manifest gate. Unbounded, one stalled socket froze
      // every reconcile trigger — including the 5–10 s emergency poll —
      // for the life of the page. 20 s guarantees the gate frees and the
      // next poll runs; the catch below already handles the AbortError as
      // an ordinary fetch failure (cached-content fallback, backoff, counters).
      // B-P0-1: a crossed window edge invalidates the 304 identity — the
      // payload is unchanged but what should be ON GLASS is not.
      if (lastAppliedManifestRef.current && manifestEtagRef.current) {
        const nowSig = windowSignature(lastAppliedManifestRef.current.playlists, new Date());
        if (nowSig !== appliedWindowSigRef.current) {
          console.log('[Player] schedule window edge crossed — forcing a full manifest refetch');
          manifestEtagRef.current = null;
        }
      }
      const manifestCtl = typeof AbortController === 'function' ? new AbortController() : undefined;
      manifestFetchAbortRef.current = manifestCtl ?? null;
      const { res: manifestRes, json: manifestBody } = await fetchJsonBounded(
        `${getApiRoot()}/api/v1/screens/${screenId}/manifest${emergencyDisplayed ? `?_eb=${Date.now()}` : ''}`,
        {
          headers: {
            'Authorization': `Bearer ${access_token}`,
            // Conditional poll (efficiency #2): server 304s when the payload
            // hash (everything except generatedAt) is unchanged.
            ...(!emergencyDisplayed && manifestEtagRef.current ? { 'If-None-Match': manifestEtagRef.current } : {}),
          },
          cache: 'no-store',
        },
        20_000,
        manifestCtl,
      );

      // 304 — nothing changed since the ETag'd manifest we already applied.
      // Same success bookkeeping as a 200, minus the re-apply.
      if (manifestRes.status === 304) {
        fetchFailCountRef.current = 0;
        fetchFailStreakStartedAtRef.current = null;
        lastManifestOkAtRef.current = Date.now();
        setConnectivity({ kind: 'connected' });
        if (tickToastRef.current) {
          clearInterval(tickToastRef.current);
          tickToastRef.current = null;
        }
        setLastSync(new Date().toLocaleTimeString());
        // 2026-07-31 stuck-content root cause (verified via Railway HTTP
        // logs on a real kiosk): a 304 re-CONFIRMS the last applied
        // manifest. When that manifest was EMPTY and the blip defense is
        // holding old content (streak > 0), this early return used to
        // freeze the streak below its threshold FOREVER — an ETag-stable
        // empty manifest 304s on every poll, so a disabled template (or
        // worse, the post-all-clear emergency playlist) stayed on glass
        // until a manual resync. A 304 is the strongest possible "the
        // empty manifest is still the truth" signal — count it.
        if (emptyManifestStreakRef.current > 0 && currentPlaylistSigRef.current !== '') {
          emptyManifestStreakRef.current += 1;
          if (emptyManifestStreakRef.current >= 3) {
            console.log(
              `[Player] ${emptyManifestStreakRef.current} consecutive empty confirmations (incl. 304s) — clearing playlist`,
            );
            emptyManifestStreakRef.current = 0;
            currentPlaylistSigRef.current = '';
            contentIsEmergencyRef.current = false;
            setPlaylist(null);
            setCurrentIndex(0);
            setManifestPlaylists([]);
          } else {
            console.log(
              `[Player] empty manifest re-confirmed by 304 (streak ${emptyManifestStreakRef.current}/3)`,
            );
          }
        }
        return;
      }

      // ── 401 → the credential is dead. RECOVER, don't wish. ──────────────
      //
      // 2026-08-30 (reliability program W1-3) — this branch used to clear a
      // preview-only admin-token cache, DECREMENT the failure counter, and
      // throw "will retry" on the theory that "a token will be re-minted on
      // the next call". Nothing ever re-minted anything: registration only
      // ran at boot, so once a (typically 1-hour, post-downgrade) device
      // token expired, every poll 401'd forever — and because the decrement
      // canceled the catch-block's increment, the ≥10-failure native-reload
      // escape hatch was MATHEMATICALLY unreachable. That is the exact
      // deadlock that kept G43 "ONLINE" and content-dead for 37 hours.
      //
      // Now: one controlled re-register (single-flighted, 60 s cooldown —
      // see attemptCredentialRecovery). On success the very next retry uses
      // the fresh credential; if the server says re-pair is required we keep
      // last-known-good content playing and say so honestly. Either way the
      // 401 COUNTS as a failure — sustained auth death must stay visible and
      // must be able to escalate; a successful recovery resets the counter
      // on the next 2xx/304 like any other outage.
      if (manifestRes.status === 401) {
        cachedAuthTokenRef.current = null;
        const outcome = await attemptCredentialRecovery('manifest-401');
        throw new Error(
          outcome === 'renewed'
            ? 'Auth expired — credential renewed, retrying'
            : outcome === 'repair-required'
              ? 'Credential unproven — re-pair required (content continues from last sync)'
              : `Auth expired — recovery ${outcome}`,
        );
      }

      if (manifestRes.ok) {
        const manifest = manifestBody;
        // A 200 with an empty/unparseable body is a FAILURE, not an empty
        // manifest (matches the old res.json() throw behavior). Checked
        // BEFORE the ETag store — recording an etag for a body we never
        // applied would let the next poll 304 against content this page
        // has never shown.
        if (!manifest) throw new Error('Manifest 200 with empty body');
        // Replace-or-clear, never keep: a 200 without an ETag (the emergency
        // branch) must drop the stale one or the next normal poll could 304.
        manifestEtagRef.current = manifestRes.headers.get('etag');
        cacheManifest(manifest); // survive cold reboot
        fetchFailCountRef.current = 0; // reset on success
        fetchFailStreakStartedAtRef.current = null;
        lastManifestOkAtRef.current = Date.now();
        // Clear connectivity toast — we're back online.
        setConnectivity({ kind: 'connected' });
        if (tickToastRef.current) {
          clearInterval(tickToastRef.current);
          tickToastRef.current = null;
        }
        applyManifest(manifest);
        // ── E-P0-01: OVERRIDE confirmation-window bookkeeping ────────────
        if (pendingOverrideConfirmRef.current) {
          if (manifest.isEmergency === true) {
            if (pendingOverrideTimerRef.current) { clearTimeout(pendingOverrideTimerRef.current); pendingOverrideTimerRef.current = null; }
            const waited = Date.now() - pendingOverrideConfirmRef.current.firstAt;
            pendingOverrideConfirmRef.current = null;
            console.log(`[Player] OVERRIDE confirmed by committed manifest after ${waited}ms`);
          } else {
            const w = pendingOverrideConfirmRef.current;
            if (Date.now() - w.firstAt > 30_000) {
              pendingOverrideConfirmRef.current = null;
              if (pendingOverrideTimerRef.current) { clearTimeout(pendingOverrideTimerRef.current); pendingOverrideTimerRef.current = null; }
              console.error(
                '[Player] SIGNED OVERRIDE NEVER CONFIRMED: the server manifest still shows no emergency 30s after a signed trigger broadcast. ' +
                'Either the trigger transaction FAILED after fan-out or replica lag exceeded the window. NO ALERT IS PAINTED on this screen. ' +
                'Releasing the provisional hold; routine polling continues.',
              );
            } else {
              // Chase the commit on a rapid ladder (~2.5/5/10/20s) instead
              // of waiting for the routine poll.
              w.tries += 1;
              const delay = Math.min(2_500 * 2 ** (w.tries - 1), 20_000);
              if (pendingOverrideTimerRef.current) clearTimeout(pendingOverrideTimerRef.current);
              pendingOverrideTimerRef.current = setTimeout(() => {
                pendingOverrideTimerRef.current = null;
                if (pendingOverrideConfirmRef.current) fetchContent();
              }, delay);
              console.warn(`[Player] OVERRIDE not yet in the manifest (commit race) — re-checking in ${delay}ms (attempt ${w.tries})`);
            }
          }
        }
        // B-P0-1: remember what was applied and under which window verdict,
        // so the next polls can detect an edge and bust the 304 identity.
        lastAppliedManifestRef.current = manifest;
        appliedWindowSigRef.current = windowSignature(manifest?.playlists, new Date());
        // Durable REFRESH_WEB — live manifests only (a disk-cached command
        // value is either already acked or pointless offline).
        maybeExecuteDurableRefresh(manifest);
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
        // fromCache=true — this payload came off disk, so it may not release
        // an emergency hold (see the interlock block in applyManifest).
        applyManifest(cached.m, true);
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
      // Schedule another attempt ONLY when we're not already playing.
      // During playback, the reconnect happens silently via the
      // fetchContent retry queue without flipping the visible phase, so
      // the current content keeps rolling.
      //
      // ⚠️ DEEP-AUDIT F3 (2026-08-30) — THE PERMANENTLY-DEAF FRESH SCREEN.
      // This branch used to retry via `setPhase('connecting')` alone. When
      // the phase already WAS 'connecting' (a fresh install / post-re-pair
      // screen whose FIRST fetch failed), that is a same-value setState:
      // React bails, the connecting-effect's deps never change, and no
      // second fetch EVER happens — while WS/SSE/HTTP-fallback/emergency
      // polling are all gated on phase==='playing' and the ≥10-failure
      // native-reload hatch sits frozen at 1 failure. One bad first fetch
      // = a screen that is deaf to everything, forever, while the
      // dashboard shows it ONLINE. (The shape of the 2026-08-24
      // two-fresh-boxes field incident.) The retry now drives
      // fetchContent() DIRECTLY; the setPhase stays for the splash states
      // where the phase genuinely differs.
      if (!playingNow) {
        setTimeout(() => {
          if (phaseRef.current === 'playing') return; // recovered meanwhile
          setPhase('connecting'); // no-op when already there — that's fine
          fetchContent();         // THE retry — never gated on a state edge
        }, Math.max(2_000, retryDelay));
      } else {
        // Background-retry the fetch without phase change. Same
        // delay; just call fetchContent() directly when it fires.
        setTimeout(() => {
          if (phaseRef.current === 'playing') fetchContent();
        }, Math.max(2_000, retryDelay));
      }
    }
  }, [screenId]);

  // The public reconcile entry point: at most ONE fetchContentInner in
  // flight; triggers that land mid-flight coalesce into exactly one
  // follow-up run (see manifestGate.ts).
  const fetchContent = useCallback(
    () => manifestGateRef.current.run(fetchContentInner),
    [fetchContentInner],
  );

  // Emergency preempt lane (deep-audit F2): abort any in-flight NORMAL
  // manifest request so the gate's coalesced follow-up — which will fetch
  // the emergency (or all-clear) truth — runs NOW instead of after the
  // stalled request's full deadline. Only OVERRIDE / ALL_CLEAR use this;
  // routine SYNC keeps plain coalescing.
  const preemptReconcile = useCallback(() => {
    try { manifestFetchAbortRef.current?.abort(); } catch { /* swallow */ }
    return fetchContent();
  }, [fetchContent]);

  // F2b — STABLE identity for the EmergencyOverlay hint. An inline arrow
  // at the mount site re-created the prop every render, and the overlay's
  // poll effect (which lists it as a dep) tore down + re-armed its
  // interval each time — poll churn on every parent render.
  const onTenantEmergencyHint = useCallback(() => {
    if (activeEmergencyRef.current) return; // already on glass
    console.warn('[Player] emergency-messages poll reports an active tenant emergency with no overlay — forcing manifest reconcile (F2b backstop)');
    preemptReconcile();
  }, [preemptReconcile]);

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

  // ─── Missed-event self-heal: periodic manifest reconcile ───
  // While a HEALTHY WebSocket is connected, the player only re-fetches the
  // manifest when a WS event (OVERRIDE / ALL_CLEAR / SYNC) arrives — there
  // is NO periodic content poll on a live socket (the 5s HTTP poll engages
  // only when the WS is DOWN; the 30s/45s heartbeats ping status, they do
  // not fetchContent). So if a single event is dropped in transit on a
  // still-open socket (proxy blip, transient loss), the player never
  // reconciles: a missed ALL_CLEAR strands the screen on a stale lockdown
  // overlay indefinitely, and a missed OVERRIDE misses a real alert until
  // the next event. The 60s silent-reconnect doesn't help because the WS
  // is still exchanging HEARTBEAT pongs.
  //
  // Fix: reconcile against the manifest on a slow steady cadence during
  // playback, INDEPENDENT of WS / SSE / fallback state. The manifest is the
  // SOLE arbiter of emergency state (see the fetchContent block ~L3080), so
  // this can ONLY ever converge the player toward server truth — it can
  // never drop a real emergency (the manifest reports it) nor raise a false
  // one (the manifest reports NONE). It is strictly gentler than the 5s
  // WS-down fallback and re-uses the exact same fetchContent() reconcile
  // path, so it introduces no new behavior class — only a bounded
  // (<=RECONCILE_MS) worst-case window for any missed real-time event.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const RECONCILE_MS = 30_000;
    const iv = setInterval(() => {
      if (phaseRef.current === 'playing') fetchContent();
    }, RECONCILE_MS);
    return () => clearInterval(iv);
  }, [fetchContent]);

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
    // when this WebView started serves as our reference. Sourced from
    // `./bundleSha` (2026-08-25) so the value the dashboard SEES on the
    // render-proof POST is byte-identical to the value this detector
    // reloads on; the chip's verdict then matches the panel's own.
    const myShaShort = readOwnBundleSha();
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
        // Normalized through the SAME helper as our own SHA so a width or
        // case difference between build paths can never read as drift.
        const serverShaShort = normalizeBundleSha(data?.sha);
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
          // Re-let the next poll schedule its own timer once this one
          // resolves (reload or defer). Cleared in every branch below.
          const clearTimer = () => { scheduledReloadTimer = null; };

          // Don't reload if there's an active emergency on screen —
          // that override is more important than picking up a JS fix.
          // The reloader will catch this on the next poll cycle.
          const cachedEm = readCachedEmergency();
          if (cachedEm) {
            console.log('[bundle-drift] emergency active — deferring reload');
            clearTimer();
            return;
          }
          // Reload-loop floor (2026-06-27). If we already fired a
          // bundle-drift reload very recently, do NOT fire again — the new
          // bundle is presumably loading / just loaded and our baked-in SHA
          // hasn't been refreshed in THIS still-running document. (After a
          // successful reload the new document reads the new SHA and the
          // drift clears.) This is the hard guarantee against a crash-loop
          // if the server SHA never converges with ours (regional CDN skew,
          // a build-info env var that drifts from the bundle's inlined SHA).
          const sinceLastReload = Date.now() - lastBundleReloadAtRef.current;
          if (lastBundleReloadAtRef.current && sinceLastReload < MIN_BUNDLE_RELOAD_GAP_MS) {
            console.log('[bundle-drift] reloaded ' + Math.round(sinceLastReload / 1000) + 's ago — holding off (min gap ' + Math.round(MIN_BUNDLE_RELOAD_GAP_MS / 60000) + 'm)');
            clearTimer();
            return;
          }
          // 2026-05-13 — historically we NEVER reloaded during playback
          // (operator: "once content is live, it stays live"). The flaw:
          // a 24/7 single-board / solo-URL / template-only screen is ALWAYS
          // "playing" and never hits a loop boundary, so it deferred the
          // reload for the full 6h cap and ran ancient code — confirmed
          // live on a 960×1080 LED that never picked up new player /
          // emergency fixes (2026-06-27, launch-blocking).
          //
          // New policy: while playing, defer ONLY until the (now ~12 min)
          // staleness cap, then force the reload. For a multi-item playlist
          // the loop-boundary path in the heartbeat usually catches it
          // first (invisible at the seam); this cap is the backstop for
          // screens that can't wrap. A brief between-loop splash blip is
          // the correct trade vs. indefinitely-stale code. phaseRef gives
          // us the CURRENT phase at timer-fire time (mount-time phase was
          // 'registering').
          if (phaseRef.current === 'playing') {
            const staleMs = bundleDriftSinceRef.current ? Date.now() - bundleDriftSinceRef.current : 0;
            if (staleMs < MAX_BUNDLE_STALE_MS) {
              console.log('[bundle-drift] content playing — deferring (' + Math.round(staleMs / 60000) + 'm stale; loop-boundary or ' + Math.round(MAX_BUNDLE_STALE_MS / 60000) + 'm cap will catch it)');
              clearTimer();
              return;
            }
            console.warn('[bundle-drift] stale ' + Math.round(staleMs / 60000) + 'm while continuously playing — forcing reload (staleness cap)');
            // fall through to the reload below
          }
          // Record BEFORE we navigate away so the floor is honored even if
          // the reload is async / the document survives momentarily.
          lastBundleReloadAtRef.current = Date.now();
          clearTimer();
          hardCacheBustingReload();
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
      if (syncPingTimerRef.current) { clearInterval(syncPingTimerRef.current); syncPingTimerRef.current = null; }
      if (wsReconnectRef.current) { clearTimeout(wsReconnectRef.current); wsReconnectRef.current = null; }
    };

    /**
     * Record one command outcome device-side, then push the ring to the
     * server with a fresh capability probe.
     *
     * ⚠️ THE RECORD IS UNCONDITIONAL; ONLY THE POST IS BEST-EFFORT. The
     * localStorage ring is what survives a network outage, an unpaired
     * screen and a preview tab, so it is written first and always — the
     * next successful report carries whatever accumulated. The POST rides
     * the existing device-authenticated `/display-capabilities` endpoint
     * (see displayCapabilityReport.ts for why that, and not a new one).
     *
     * Never awaited and never throws: an operator's Blank must not wait on
     * telemetry, and telemetry must never be able to break the realtime
     * consumer that also carries the lockdown OVERRIDE.
     */
    const reportCommandOutcome = (outcome: DisplayCommandOutcome) => {
      try {
        // THE RECORD IS UNCONDITIONAL. The ring is what survives an
        // offline screen, an unpaired one and a coalesced burst — the next
        // POST carries everything that accumulated.
        recordCommandOutcome(outcome);
        if (!screenId || isPreviewMode()) return;

        // ⚠️ COALESCE, DO NOT DROP. Each POST re-probes the device and
        // writes a row, so a burst (an operator dragging the brightness
        // slider; the same frame arriving on WS and SSE) must not become a
        // burst of writes. Because the ring is already on disk, delaying
        // the POST loses nothing — the later one reports the earlier
        // outcomes too. A trailing timer guarantees the LAST outcome always
        // lands, which is the one an operator is watching for.
        if (outcomeReportTimerRef.current) return;
        outcomeReportTimerRef.current = setTimeout(() => {
          outcomeReportTimerRef.current = null;
          void reportDisplayCapabilities({
            screenId,
            apiRoot: getApiRoot(),
            token: getDeviceToken(),
            commandOutcomes: readCommandOutcomes(),
          }).then((status) => {
            console.log(`[display-caps] outcome report — ${status}`);
          });
        }, OUTCOME_REPORT_COALESCE_MS);
      } catch {
        /* telemetry is never worth a thrown handler */
      }
    };

    /**
     * Gate + forward one DISPLAY_CONTROL frame to the APK.
     *
     * Shared by the WS and SSE arms so a screen behind a WS-blocking school
     * proxy (Squid / ZScaler / iboss / GoGuardian) gets the same behaviour —
     * that population is exactly why the SSE tier exists, and every previous
     * realtime feature wired on one transport only silently no-op'd there.
     *
     * The body lives in displayControl.ts (scope check, per-eventId dedup on
     * the LRU shared with the life-safety gate, C4 recovery exemption, the
     * soft/hard split, the bridge call) so the path an operator's click
     * actually takes is unit tested without mounting this page.
     *
     * The 5th argument is the seam for the 2026-08-25 blank/power split: a
     * SOFT frame (BLANK/WAKE) is answered by the black overlay in THIS page
     * and never reaches the native bridge — forwarding it is what fires the
     * device-admin lock that latched two panels. HARD frames (a translated
     * POWER_OFF/POWER_ON) still go straight through.
     *
     * The 6th is the v1.1.5 OUTCOME seam: the APK's verdict settles
     * asynchronously, so without it this function's "sent" is the same
     * not-quite-a-fact as the server's `delivered:true`.
     */
    const applyDisplayControl = (envelope: any, via: 'WS' | 'SSE') => {
      const outcomePayload = envelope?.payload ?? envelope ?? {};
      const outcomeActionId =
        typeof outcomePayload?.actionId === 'string' ? outcomePayload.actionId : null;
      const outcomeAction =
        typeof outcomePayload?.action === 'string' ? outcomePayload.action : null;

      const result = dispatchDisplayControl(
        envelope,
        screenId,
        {
          seenEventIds: recentEventIdsRef.current,
          serverClockOffsetMs: serverClockOffsetRef.current,
        },
        via,
        softBlankSinkRef.current,
        // ── P1 (2026-08-25) — CLOSE THE SILENT-FAILURE LOOP ──────────────
        // The APK's verdict is the only place the truth lives, and until
        // now it settled on a promise nobody was listening to. Ship it:
        // which mechanism ran, whether it took, and whether any readable
        // backlight value actually moved. `applied:true, changed:false` is
        // the silent no-op that cost the 2026-08-25 night, and it is now a
        // row in the fleet report instead of a console line on a wall.
        (verdict) => {
          let parsed: any = null;
          try {
            parsed = verdict.raw ? JSON.parse(verdict.raw) : null;
          } catch {
            /* a non-JSON answer still deserves a row — see below */
          }
          reportCommandOutcome({
            actionId: outcomeActionId,
            action: outcomeAction,
            via,
            at: new Date().toISOString(),
            status: 'device',
            mechanism: parsed?.mechanism ?? parsed?.provider ?? null,
            applied: parsed?.ok === true,
            code: parsed?.code ?? (verdict.error ? 'bridge-error' : null),
            message: parsed?.message ?? verdict.error ?? null,
            changed: parsed?.evidence?.changed ?? null,
            evidence: parsed?.evidence ?? null,
          });
        },
      );

      // A frame that never reached a mechanism still has an outcome worth
      // recording — "the overlay drew it", "this player has no bridge",
      // "an alert was on the glass so the blank was refused" are all
      // answers, and their absence is what made a dark screen
      // unexplainable. The 'sent' branch is skipped because the device
      // callback above owns it.
      //
      // ⚠️ BUT NOT EVERY DROP. `not-ours`, `unsigned`, `stale` and `replay`
      // are decided BEFORE (or by) the signature/scope gate, which means a
      // remote party who can reach this socket could otherwise drive a
      // server write per forged frame — a write amplifier reachable by
      // anyone, keyed on nothing. `replay` is also the ordinary,
      // by-design outcome of a frame arriving on both the WS and SSE
      // tiers. So only the drops that describe a decision THIS player made
      // about an ACCEPTED frame are reported.
      const REPORTABLE_DROPS = new Set(['emergency', 'bad-action', 'threw']);
      const reportable =
        result.status !== 'sent' &&
        (result.status !== 'dropped' || REPORTABLE_DROPS.has((result as any).reason));
      if (reportable) {
        reportCommandOutcome({
          actionId: outcomeActionId,
          action: outcomeAction,
          via,
          at: new Date().toISOString(),
          status: result.status,
          // 'setup-opened' (v1.1.6) is the OPEN_SETUP lane: the frame was
          // handed to the APK's setup bridge, which is as much as this
          // layer can ever know — the APK owns whether the card actually
          // appears (manager gate / lock task / emergency) and logs its
          // own refusal on the panel.
          mechanism:
            result.status === 'soft'
              ? 'web-overlay'
              : result.status === 'setup-opened'
                ? 'setup-checklist'
                : null,
          applied: result.status === 'soft' || result.status === 'setup-opened',
          code: result.status === 'dropped' ? (result as any).reason ?? null : null,
          message: null,
          changed: null,
        });
      }

      // ── NOTHING THE OPERATOR PRESSES MAY VANISH WITHOUT A TRACE ────────
      //
      // The dashboard's `delivered:true` means "the Redis fan-out was up",
      // never "this screen acted" (see ApplyActionResult.delivered in
      // display.service.ts). So the panel is the ONLY place the truth exists,
      // and until this block it existed for exactly as long as a console line
      // scrolled past on a wall-mounted kiosk nobody can open devtools on.
      //
      // Two cheap, endpoint-free witnesses:
      //
      //  1. A rolling verdict log on `window.__eduDisplayControl`, mirroring
      //     the `__eduSyncState` / `__eduSyncFlips` diagnostics the sync work
      //     already established. Readable over ScreenConnect / the browser
      //     console / a Playwright eval, with zero server surface.
      //  2. PAINT CONFIRMATION. A soft BLANK that reports success but whose
      //     div is not in the DOM a beat later is the 2026-08-25 bug, and it
      //     now screams instead of smiling. 400 ms is far longer than a React
      //     commit even on a Chromium-83 Taurus, and the check re-reads live
      //     emergency state first so an alert legitimately punching through
      //     is never mistaken for the defect.
      try {
        const dbg = ((window as any).__eduDisplayControl ||= { last: null, recent: [] });
        const pl = envelope?.payload ?? envelope ?? {};
        const entry = {
          at: new Date().toISOString(),
          via,
          requested: pl?.action ?? null,
          soft: pl?.soft === true,
          hard: pl?.hard === true,
          actionId: pl?.actionId ?? null,
          result,
          offsetMs: serverClockOffsetRef.current,
        };
        dbg.last = entry;
        dbg.recent.push(entry);
        if (dbg.recent.length > 20) dbg.recent.shift();
      } catch { /* SSR-safe / hostile-global no-op — never break the socket */ }

      //
      // Covers the soft DIM as well as the soft BLANK (brightness split):
      // a dim that reports success and paints nothing is the same lie, on
      // the axis the operator was actually complaining about.
      if (result.status === 'soft' && result.overlay) {
        const what = result.action === 'SET_BRIGHTNESS' ? 'DIM' : 'BLANK';
        setTimeout(() => {
          if (softBlankNodeRef.current) return; // painted — nothing to say
          // A WAKE (or a raise back to 100%) landed inside the window and
          // legitimately took the overlay down.
          if (!softBlankRef.current && softDimRef.current === 0) return;
          if (softBlankSinkRef.current.emergencyDisplayed()) return; // correctly withheld
          console.error(
            `[display] SOFT ${what} ACCEPTED BUT NOT PAINTED — the overlay div ` +
              'is not in the DOM. This render branch is missing ' +
              '{softBlankOverlay}; the operator moved a control and the glass ' +
              'did not change. (2026-08-25 regression class — see the const in ' +
              'page.tsx.)',
          );
          try {
            const dbg = (window as any).__eduDisplayControl;
            if (dbg?.last) dbg.last.paintConfirmed = false;
          } catch { /* no-op */ }
        }, 400);
      }

      return result;
    };

    // Sprint 11 Phase B — SSE realtime fallback (middle tier).
    // Engaged when WS has failed >=3 times. Listens for the same
    // signed Redis-channel messages the WS does; on receive, runs
    // the same client actions (fetchContent, reload, etc.).
    const tryOpenSse = async () => {
      if (sseRef.current) return; // already open
      const token = getDeviceToken();
      if (!token) {
        // Without a signed device JWT we can't auth the SSE endpoint
        // — fall through to HTTP poll immediately.
        engageHttpPollFallback('no-signed-token');
        return;
      }

      // ── SDE-02 / DT-08 (2026-08-04) — put a 60-SECOND TICKET in the URL,
      // not the 180-day fleet credential.
      //
      // `EventSource` cannot set request headers, which is why the device JWT
      // ended up in `?token=` originally. URLs land in Railway/Vercel access
      // logs, on-path proxy logs and Android WebView history — none of which
      // anyone treats as a credential store, and that token authenticates this
      // screen for six months.
      //
      // The server half shipped on 2026-08-03 and has been waiting for this:
      // `POST /screens/:id/stream-ticket` is a normal header-authenticated
      // POST (no EventSource limitation applies), and
      // `GET /realtime/sse?ticket=…` already verifies the ticket, refuses a
      // REVOKED screen, and requires the ticket's epoch to still equal the
      // screen's live credentialEpoch.
      //
      // FALLS BACK TO THE LEGACY `?token=` LEG ON ANY FAILURE — no screenId
      // yet, mint returns non-OK, network error, malformed body. That is
      // deliberate: SSE is the middle realtime tier for a screen that may be
      // showing a lockdown alert, and a ticket-mint hiccup must degrade to
      // today's behaviour rather than drop the tier. The legacy leg stays
      // accepted server-side for exactly this reason; it can be deleted once
      // the fleet is confirmed on tickets.
      let authQuery = `token=${encodeURIComponent(token)}`;
      let usingTicket = false;
      if (screenId) {
        try {
          // B-P2-11 (2026-08-30): BOUNDED. This await gates BOTH fallback
          // tiers — while a hung mint sat here, sseRef and httpFallbackRef
          // both stayed null, so neither SSE nor the 5 s HTTP poll ever
          // armed on a screen whose WS was already dead. 8 s, then the
          // legacy leg / HTTP tier take over.
          const { res, json: body } = await fetchJsonBounded(
            `${getApiRoot()}/api/v1/screens/${encodeURIComponent(screenId)}/stream-ticket`,
            { method: 'POST', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
            8_000,
          );
          if (res.ok) {
            if (body && typeof body.ticket === 'string' && body.ticket) {
              authQuery = `ticket=${encodeURIComponent(body.ticket)}`;
              usingTicket = true;
            }
          }
        } catch { /* fall through to the legacy leg below */ }
      }
      if (!usingTicket) {
        console.warn('[Player SSE] stream-ticket unavailable — using legacy ?token= leg');
      }

      // We awaited above, so re-check: a second call (or a WS recovery) may
      // have opened the stream while the mint was in flight. Without this the
      // player can end up with two EventSources and double-process every
      // event, including emergency messages.
      if (sseRef.current) return;

      const url = `${getApiRoot()}/api/v1/realtime/sse?${authQuery}`;
      console.log('[Player SSE] opening', url.replace(/(token|ticket)=[^&]+/, '$1=…'));
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

      // R-04 (2026-08-01) — the SSE tier now runs the SAME client-side gate
      // the WS path does. It previously ran NONE of it, and an on-path
      // attacker can deterministically force screens onto SSE by killing the
      // WS upgrade three times (`wsFailCountRef >= 3 → tryOpenSse()`), then
      // replay one captured ALL_CLEAR_MESSAGE to keep a real SOS / broadcast
      // suppressed. The SSE frame carries the identical verified envelope
      // (sse.service.ts `broadcastToScope` writes the whole `parsed` message
      // that passed `verifyWsHmac`), so signature/timestamp/eventId are all
      // already on the wire. `recentEventIdsRef` is shared with the WS path,
      // so a frame seen on one transport can't be replayed on the other.
      //
      // Freshness needs a server-clock offset, and on an SSE-only kiosk (WS
      // blocked by a school proxy) AUTH_OK never arrives over WS — so the
      // SSE AUTH_OK below feeds the same ref. Without that, a clock-skewed
      // Android box would drop every SSE emergency: a life-safety regression.
      const gateSse = (name: string, data: any): boolean => {
        const verdict = checkSensitivePush(
          data,
          {
            seenEventIds: recentEventIdsRef.current,
            serverClockOffsetMs: serverClockOffsetRef.current,
          },
          name,
        );
        if (!verdict.accepted) {
          // Keep the literal phrase "dropped stale/future event" for the stale
          // case. The P0-1 regression guard (emergency-path.spec.ts tests 3+4)
          // counts occurrences of exactly that string to prove the freshness
          // gate is neither firing on good ms timestamps nor silently
          // loosened. The pushGate refactor renamed it and the guard went
          // blind — the gate still worked, but nothing could see it working.
          console.warn(
            `[Player SSE] dropped ${
              verdict.reason === 'stale' ? 'stale/future event' : `${verdict.reason} sensitive event`
            }:`,
            name, data?.eventId, 'ts=', data?.timestamp,
            'offset=', serverClockOffsetRef.current,
          );
          return false;
        }
        return true;
      };
      // The server's very first SSE frame is `AUTH_OK { ts }` — the only
      // server-time sample an SSE-only kiosk ever gets. Same semantics as the
      // WS AUTH_OK offset capture ("what to ADD to local Date.now()").
      es.addEventListener('AUTH_OK', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data);
          const srv = typeof data?.ts === 'number' ? data.ts : null;
          if (srv == null) return;
          serverClockOffsetRef.current = srv - Date.now();
          if (Math.abs(serverClockOffsetRef.current) > 5000) {
            console.warn('[Player SSE] Large clock skew detected — offset=', serverClockOffsetRef.current, 'ms');
          }
        } catch { /* swallow */ }
      });
      // Each Redis event type comes through as a named SSE event.
      const handle = (name: string, fn: (data: any) => void) => {
        es.addEventListener(name, (ev) => {
          try {
            const data = JSON.parse((ev as MessageEvent).data);
            if (!gateSse(name, data)) return;
            console.log(`[Player SSE] ${name}`);
            fn(data?.payload || data);
          } catch (e) {
            console.warn(`[Player SSE] parse failed for ${name}:`, (e as Error)?.message);
          }
        });
      };
      handle('SYNC', () => fetchContent());
      handle('OVERRIDE', () => {
        // Mirror of the WS branch — a new emergency-path behaviour MUST be
        // handled on both transports or it silently no-ops for every screen
        // behind a WS-blocking proxy (Squid / ZScaler / iboss / GoGuardian),
        // which is exactly the population this SSE tier exists for.
        signalDisplayEmergencyHold(true, true);
        // E-P0-01: same confirmation window as the WS arm.
        pendingOverrideConfirmRef.current = { firstAt: Date.now(), tries: 0 };
        preemptReconcile(); // F2: don't wait out an in-flight normal fetch
      });
      handle('ALL_CLEAR', () => {
        if (pendingOverrideConfirmRef.current) {
          pendingOverrideConfirmRef.current = null;
          if (pendingOverrideTimerRef.current) { clearTimeout(pendingOverrideTimerRef.current); pendingOverrideTimerRef.current = null; }
        }
        preemptReconcile();
      });
      handle('CHECK_FOR_UPDATES', () => {
        // 2026-05-16 — don't install on arrival. Show the operator-
        // confirmed "Update now?" prompt; the actual OTA only starts
        // when they click "Update now" (see the overlay render +
        // bridge.checkForUpdates() call there). If the native bridge
        // isn't present (browser preview / unpaired) there's nothing
        // to update — skip the prompt.
        if (nativeHas('checkForUpdates')) {
          setShowUpdatePrompt(true);
        }
      });
      handle('REFRESH_WEB', () => {
        // Cache-busting reload (not plain reload) so the NovaStar/Taurus
        // WebView fetches the CURRENT bundle instead of re-serving the cached
        // one — see the WS REFRESH_WEB handler for the full rationale.
        // Deep-audit F6 (2026-08-30): same emergency gate as the WS arm —
        // never navigate a live alert off the glass for a refresh.
        const fireSseRefresh = (attempt: number) => {
          if (activeEmergencyRef.current || pushedEmergencyMessageRef.current) {
            if (attempt >= 60) return;
            console.log('[REFRESH_WEB sse] emergency active — deferring reload');
            setTimeout(() => fireSseRefresh(attempt + 1), 30_000);
            return;
          }
          if (!nativeFire('reload')) hardCacheBustingReload();
        };
        fireSseRefresh(0);
      });
      // ── DISPLAY CONTROL on the SSE tier ───────────────────────────────
      // Registered directly rather than through `handle()`, because that
      // wrapper hands the callback only `data.payload` while this gate needs
      // the whole envelope (signature / timestamp / eventId). Mirror of the
      // WS arm — a new realtime behaviour wired on ONE transport silently
      // no-ops for every screen behind a WS-blocking proxy, which is the
      // exact population this tier exists for.
      es.addEventListener(DISPLAY_CONTROL_TYPE, (ev) => {
        try {
          applyDisplayControl(JSON.parse((ev as MessageEvent).data), 'SSE');
        } catch (e) {
          console.warn('[Player SSE] parse failed for DISPLAY_CONTROL:', (e as Error)?.message);
        }
      });
      // P0-2 (life-safety) — Sprint 5 emergency messages on the SSE
      // tier. SSE exists precisely for the WS-blocked-proxy case
      // (Squid/ZScaler/iboss/GoGuardian); before this fix the SSE
      // consumer registered SYNC/OVERRIDE/ALL_CLEAR/CHECK_FOR_UPDATES/
      // REFRESH_WEB but NOT SOS/TEXT_BROADCAST/MEDIA_ALERT, so a kiosk
      // behind a WS-blocking proxy silently dropped every staff SOS /
      // typed broadcast / media alert. Mirror the WS handler at
      // ~L3697. Auth + server-side HMAC were already enforced when the
      // EventSource opened (device JWT) and at the Redis fan-out gate;
      // the SSE `handle()` wrapper hands us the inner signed payload.
      const onEmergencyMessage = (type: 'SOS' | 'TEXT_BROADCAST' | 'MEDIA_ALERT') => (p: any) => {
        signalDisplayEmergencyHold(true, true);
        const payload = p || {};
        setPushedEmergencyMessage({
          // The DB row id arrives as `messageId` in the signed payload;
          // the WS path falls back to `id`. Accept either.
          id: payload.messageId || payload.id || `msg-${Date.now()}`,
          type,
          severity: (payload.severity as 'INFO' | 'WARN' | 'CRITICAL') || 'CRITICAL',
          // TEXT_BROADCAST signs the field as `text`; SOS/MEDIA_ALERT
          // sign it as `textBlob`. Read both so broadcasts aren't blank.
          textBlob:
            typeof payload.textBlob === 'string'
              ? payload.textBlob
              : typeof payload.text === 'string'
                ? payload.text
                : null,
          mediaUrls: Array.isArray(payload.mediaUrls) ? payload.mediaUrls : [],
          audioUrl: typeof payload.audioUrl === 'string' ? payload.audioUrl : null,
          expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : null,
          createdAt: payload.createdAt || new Date().toISOString(),
        });
      };
      handle('SOS', onEmergencyMessage('SOS'));
      handle('TEXT_BROADCAST', onEmergencyMessage('TEXT_BROADCAST'));
      handle('MEDIA_ALERT', onEmergencyMessage('MEDIA_ALERT'));
      handle('ALL_CLEAR_MESSAGE', () => setPushedEmergencyMessage(null));
      // Tier-3 camera calibration — mirror of the WS branch (a new WS
      // type MUST be handled on both transports or it silently no-ops
      // for SSE-tier screens; recon doc 01 gotcha #12).
      handle('CALIBRATE_FLASH', (pl: any) => {
        if (pl?.on === true) {
          const dur = Math.max(5, Math.min(120, Number(pl?.durationSec) || 60));
          setCalFlashUntil(Date.now() + dur * 1000);
        } else {
          setCalFlashUntil(null);
        }
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
        console.log('[Player WS] Connecting to', wsUrl, `(attempt ${wsPolicyRef.current.failCount() + 1})`);
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          // 2026-08-30 (reliability program W1-5) — a TCP `open` is NOT a
          // working realtime channel; only AUTH_OK is. The failure counter
          // used to reset here, so a dead credential looped
          // open(0)→AUTH_FAIL→close(1) forever and the ≥3-failure SSE/HTTP
          // fallback never engaged. The counter now resets — and the
          // SSE/HTTP fallbacks now tear down — in the AUTH_OK branch of
          // onmessage instead.
          wsPolicyRef.current.onTcpOpen();
          lastWsMessageAtRef.current = Date.now();
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
          // Frame-locked sync — TIME_PING sampler. A cheap 200ms
          // bookkeeping tick: sends a clock-sync ping only while the
          // manifest has sync enabled — burst of 10 at ~200ms spacing
          // after AUTH_OK (locks the clock in ~2s), then 1 ping / 20s
          // steady-state (crystal drift is ~0.4ms per 20s — see
          // docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md §4).
          // Disabled screens pay one ref-read per tick and send nothing.
          if (syncPingTimerRef.current) clearInterval(syncPingTimerRef.current);
          syncPingTimerRef.current = setInterval(() => {
            if (!syncConfigRef.current.enabled) return;
            if (ws.readyState !== WebSocket.OPEN) return;
            const st = syncPingStateRef.current;
            const mono = performance.now();
            // Adaptive cadence (tier-1): a pristine wired clock pings
            // every 30s; a jittery WiFi clock fights back at 5s. The
            // clock itself recommends the interval from its live
            // uncertainty.
            const spacing = st.burstRemaining > 0
              ? 180
              : (syncClockRef.current?.recommendedPingIntervalMs(mono) ?? 20_000);
            if (mono - st.lastPingAtMono < spacing) return;
            if (st.burstRemaining > 0) st.burstRemaining--;
            st.lastPingAtMono = mono;
            try {
              ws.send(JSON.stringify({ event: 'TIME_PING', data: { t0: mono } }));
            } catch { /* socket raced closed — reconnect path handles it */ }
          }, 200);
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
            // 2026-07-25 — FIELD-NAME MISMATCH. The gateway frames every message
            // as { type, payload, idempotencyKey, timestamp } and puts serverTime
            // in `payload` — this read `msg.data`, which never exists. The
            // optional chaining made it fail silently, so the offset stayed 0 and
            // the ±30s freshness gate below dropped EVERY signed emergency push on
            // a clock-skewed kiosk (Android signage boxes routinely boot without
            // NTP). Those screens fell back to slow HTTP polling during a
            // lockdown. Read `payload`, keeping `data` as a defensive fallback.
            // 2026-08-30 (reliability program W1-5) — AUTH_OK is the ONLY
            // event that resets the WS failure streak and stands down the
            // SSE/HTTP fallbacks (they used to stand down on TCP open,
            // before auth had proven anything).
            if (msg.type === 'AUTH_OK') {
              wsPolicyRef.current.onAuthOk();
              setWsDegraded(false);
              if (httpFallbackRef.current) { clearInterval(httpFallbackRef.current); httpFallbackRef.current = null; }
              if (sseRef.current) {
                try { sseRef.current.close(); } catch { /* swallow */ }
                sseRef.current = null;
                sseFailCountRef.current = 0;
              }
            }
            // AUTH_FAIL — the server rejected our device token at the
            // application layer (it closes 4001 right after). Feed the
            // credential recovery machine: one controlled re-register, then
            // the reconnect (scheduled by onclose) authenticates with the
            // fresh token. The policy counts the FAIL+close pair as one
            // failure, so three rejected connects genuinely reach the
            // SSE/HTTP fallback ladder.
            if (msg.type === 'AUTH_FAIL') {
              wsPolicyRef.current.onAuthFail();
              console.warn('[Player WS] AUTH_FAIL from server — attempting credential recovery');
              void attemptCredentialRecovery('ws-auth-fail');
              return;
            }

            const authServerTime =
              (msg?.payload as any)?.serverTime ?? (msg as any)?.data?.serverTime;
            if (msg.type === 'AUTH_OK' && typeof authServerTime === 'number') {
              const srv = authServerTime as number;
              serverClockOffsetRef.current = srv - Date.now();
              if (Math.abs(serverClockOffsetRef.current) > 5000) {
                console.warn('[Player WS] Large clock skew detected — offset=', serverClockOffsetRef.current, 'ms');
              }
              // Frame-locked sync: fresh socket → fresh clock burst
              // (the 200ms sampler in onopen drains this counter).
              syncPingStateRef.current.burstRemaining = 10;
            }

            // Frame-locked sync — TIME_PONG carries our echoed t0
            // (performance.now() at send) + the server's Redis-aligned
            // serverNow. Feed the Cristian estimator and stop: it's a
            // control reply like AUTH_OK, nothing else consumes it.
            if (msg.type === 'TIME_PONG') {
              const p: any = (msg as any)?.payload ?? (msg as any)?.data ?? {};
              if (typeof p.serverNow === 'number' && typeof p.t0 === 'number') {
                if (!syncClockRef.current) syncClockRef.current = new SyncClock();
                syncClockRef.current.addSample(p.serverNow, p.t0, performance.now());
              }
              return;
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
            //
            // R-04 (2026-08-01): this block used to live inline HERE ONLY, so
            // the SSE fallback consumer enforced none of it. It is now the
            // shared `checkSensitivePush` (pushGate.ts), called identically
            // from the SSE `handle()` wrapper below, sharing this same
            // `recentEventIdsRef` LRU so a frame replayed on the OTHER
            // transport is caught too.
            const wsVerdict = checkSensitivePush(msg, {
              seenEventIds: recentEventIdsRef.current,
              serverClockOffsetMs: serverClockOffsetRef.current,
            });
            if (!wsVerdict.accepted) {
              // See the SSE gate above: the literal "dropped stale/future
              // event" phrase is what the P0-1 freshness guard counts.
              console.warn(
                `[Player WS] dropped ${
                  wsVerdict.reason === 'stale'
                    ? 'stale/future event'
                    : `${wsVerdict.reason} sensitive event`
                }:`,
                msg.type, msg.eventId, 'ts=', msg.timestamp,
                'offset=', serverClockOffsetRef.current,
              );
              return;
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
            //
            // R-05 (2026-08-01, consumer half): this teardown used to run
            // WITHOUT reading `payload.screenId`, even though the server signs
            // one — so ONE frame de-provisioned every screen that received it,
            // and recovery needed a human at each kiosk. Require an exact match
            // against this screen's own id and fail CLOSED (missing/unknown
            // screenId ⇒ ignore the message entirely).
            if (msg.type === 'TENANT_CHANGED') {
              if (!isTenantChangeForThisScreen(msg, screenId)) {
                console.warn(
                  '[Player WS] ignored TENANT_CHANGED not addressed to this screen —',
                  'target=', (msg.payload as any)?.screenId, 'self=', screenId,
                );
                return;
              }
              try { localStorage.removeItem('edu_device_token'); } catch {}
              try { localStorage.removeItem('edu_device_fp'); } catch {}
              try { localStorage.removeItem('edu_manifest_cache_v1'); } catch {}
              try { localStorage.removeItem('edu_emergency_cache_v1'); } catch {}
              // Ask the SW to clear both cache tiers so disk is clean for the
              // new tenant.
              try {
                getServiceWorkerContainer()?.controller?.postMessage({ type: 'CLEAR_CACHE', tier: 'all' });
              } catch {}
              // Ask the native shell (if present) to wipe USB cache + reload.
              nativeFire('unpair');
              setActiveEmergency(null);
              setPhase('registering');
              return;
            }
            if (msg.type === 'SYNC' || msg.type === 'OVERRIDE' || msg.type === 'ALL_CLEAR') {
              // EMERGENCY INTERLOCK (2026-08-13) — raise the native display
              // hold the instant an OVERRIDE lands, ahead of the manifest
              // round-trip that confirms it. A spurious hold costs "this
              // screen won't blank for a minute"; a late hold costs a
              // lockdown alert behind a black overlay.
              //
              // ALL_CLEAR deliberately does NOT lower it. The same reasoning
              // as the block below: a forged or replayed ALL_CLEAR must not
              // be able to re-enable blanking on a screen that is still in a
              // real emergency. The hold drops when the MANIFEST says clear.
              if (msg.type === 'OVERRIDE') {
                signalDisplayEmergencyHold(true, true);
                // E-P0-01: open the confirmation window — this signed,
                // gate-passed trigger may precede its own DB commit; the
                // reconcile ladder chases the committed manifest.
                pendingOverrideConfirmRef.current = { firstAt: Date.now(), tries: 0 };
              }
              if (msg.type === 'ALL_CLEAR' && pendingOverrideConfirmRef.current) {
                // A signed all-clear supersedes a pending trigger.
                pendingOverrideConfirmRef.current = null;
                if (pendingOverrideTimerRef.current) { clearTimeout(pendingOverrideTimerRef.current); pendingOverrideTimerRef.current = null; }
              }
              // F2 (2026-08-30): OVERRIDE/ALL_CLEAR preempt an in-flight
              // normal fetch so the emergency truth isn't queued behind a
              // slow request; routine SYNC keeps plain coalescing.
              if (msg.type === 'OVERRIDE' || msg.type === 'ALL_CLEAR') {
                preemptReconcile();
              } else {
                fetchContent();
              }
            }
            // 2026-05-26 P0-3 — Sprint 5 emergency messages (SOS,
            // TEXT_BROADCAST, MEDIA_ALERT). API signs + publishes these
            // (emergency.controller.ts:739/821/907) but before this fix
            // no player handler consumed them. The EmergencyOverlay
            // component renders the matching UI; we just set the
            // pushed-message state from the WS payload. ALL_CLEAR_MESSAGE
            // (emergency.controller.ts:981) clears.
            if (msg.type === 'SOS' || msg.type === 'TEXT_BROADCAST' || msg.type === 'MEDIA_ALERT') {
              // Interlock: a pushed alert takes the glass exactly like a
              // tenant override, so the display hold goes up with it.
              signalDisplayEmergencyHold(true, true);
              const p = msg.payload || {};
              setPushedEmergencyMessage({
                id: p.id || msg.eventId || `msg-${Date.now()}`,
                type: msg.type as 'SOS' | 'TEXT_BROADCAST' | 'MEDIA_ALERT',
                severity: (p.severity as 'INFO' | 'WARN' | 'CRITICAL') || 'CRITICAL',
                // The signer names the broadcast body `text`, not `textBlob`
                // (see emergency.controller.ts). The SSE path reads both; the
                // WS path historically read only `textBlob`, so a TEXT_BROADCAST
                // over WebSocket rendered BLANK. Read both. (P0-2 adjacent fix,
                // 2026-05-28 audit.)
                textBlob:
                  typeof p.textBlob === 'string'
                    ? p.textBlob
                    : typeof p.text === 'string'
                      ? p.text
                      : null,
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
            // Tier-3 camera calibration — remote flash mode. Device-scoped
            // (published to our device:<id> channel), benign (visual only,
            // auto-expiring), so not in SENSITIVE_TYPES.
            if (msg.type === 'CALIBRATE_FLASH') {
              const pl = (msg.payload || (msg as any).data || {}) as any;
              if (pl?.on === true) {
                const dur = Math.max(5, Math.min(120, Number(pl?.durationSec) || 60));
                console.log('[Player] CALIBRATE_FLASH on for', dur, 's');
                setCalFlashUntil(Date.now() + dur * 1000);
              } else {
                console.log('[Player] CALIBRATE_FLASH off');
                setCalFlashUntil(null);
              }
              return;
            }

            // ── DISPLAY CONTROL (2026-08-13) ──────────────────────────
            // The operator pressed volume / brightness / blank / wake / reboot
            // on the screen card. `DisplayService.applyAction` signs this,
            // publishes it to `device:<screenId>`, audits it as `dispatched`
            // and answers the dashboard `delivered:true`. THIS ARM is what
            // makes any of that true on the glass — without it the message was
            // parsed and dropped, and the dashboard reported success for an
            // action that never happened.
            //
            // Gate + scope + dedup live in displayControl.ts (pure, tested).
            // Note the C4 asymmetry it implements: a risk-direction action
            // (BLANK / dim / REBOOT) must be signed and fresh, a WAKE is never
            // dropped by a clock check — a dark screen the operator cannot
            // recover from the dashboard is the worst outcome in this feature.
            if (msg.type === DISPLAY_CONTROL_TYPE) {
              applyDisplayControl(msg, 'WS');
              return;
            }
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
                // Deep-audit F6 (2026-08-30): this was the ONE reload path
                // with no emergency gate — a wedge-detector auto-refresh
                // landing mid-lockdown navigated the alert off the glass
                // for the page-load duration. Same posture as bundle-drift:
                // defer while an emergency (or pushed SOS/broadcast) is
                // displayed, re-check every 30 s, give up after 30 min
                // (the detector re-issues on its own cooldown).
                const fireRefresh = (attempt: number) => {
                  if (activeEmergencyRef.current || pushedEmergencyMessageRef.current) {
                    if (attempt >= 60) {
                      console.warn(`[REFRESH_WEB ${corrId}] emergency still active after 30min — dropping (detector will re-issue)`);
                      return;
                    }
                    console.log(`[REFRESH_WEB ${corrId}] emergency active — deferring reload`);
                    setTimeout(() => fireRefresh(attempt + 1), 30_000);
                    return;
                  }
                  try {
                    // AND-002 — nativeFire returns false when NO transport
                    // took the call (browser player / older APK without the
                    // method), which is exactly when we need the web
                    // fallback below. It never throws.
                    //
                    // CRITICAL (2026-06-28): a plain window.location.reload()
                    // on the NovaStar/Taurus WebView re-serves the CACHED
                    // bundle — so an operator hitting "refresh" (or the
                    // dashboard refresh-web) NEVER pulled new code, and every
                    // emergency/template fix appeared not to ship. Use the
                    // cache-busting reload (location.replace + fresh ?_v=) so
                    // refresh-web actually fetches the current bundle. This is
                    // the same helper the stale-bundle auto-reload uses.
                    if (!nativeFire('reload')) hardCacheBustingReload();
                  } catch (e) {
                    console.warn(`[REFRESH_WEB ${corrId}] reload threw:`, (e as Error)?.message);
                  }
                };
                setTimeout(() => fireRefresh(0), delay);
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
                // AND-002 — the capability probe stays SYNCHRONOUS so
                // `bridgeAvailable` is correct for the setOtaProgress call
                // immediately below (the overlay copy depends on it). The
                // call itself returns the APK versionName, so it goes
                // through nativeCall and its log lands a tick later; the
                // native side has already started the OTA check by then.
                const bridgeAvailable = nativeHas('checkForUpdates');
                if (bridgeAvailable) {
                  nativeCall<string>('checkForUpdates')
                    .then((v) => {
                      console.log('[Player] CHECK_FOR_UPDATES relayed to native, currentVersion=', v);
                    })
                    .catch((e) => {
                      console.warn('[Player] CHECK_FOR_UPDATES bridge call failed', e);
                    });
                } else {
                  console.log('[Player] CHECK_FOR_UPDATES ignored — no native bridge (legacy APK or browser player)');
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
          wsPolicyRef.current.onConnectionFailure();
          // Reactive degraded flag for the emergency-poll cadence effect
          // (the old code read a ref the effect's deps never watched, so
          // the advertised 5 s degraded cadence didn't reliably engage).
          if (wsPolicyRef.current.failCount() >= 2) setWsDegraded(true);
          // Exponential backoff with full jitter: 1s, 2s, 4s, 8s, 16s, 30s max.
          // A-F9 (2026-08-30 deep audit): while a credential recovery
          // register is IN FLIGHT, an instant reconnect would re-HELLO with
          // the OLD token and burn AUTH_FAIL cycles until the register
          // lands (~4–8 s of churn). Hold the reconnect just past the
          // register's typical completion so the next connect authenticates
          // with the FRESH credential on the first try.
          const delay = credRecoveryInFlightRef.current
            ? 4_000
            : backoffMs(wsPolicyRef.current.failCount(), 1000, 30_000);
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
          if (wsPolicyRef.current.shouldEscalateFallback() && !sseRef.current && !httpFallbackRef.current) {
            // `async` since SDE-02 (it mints a stream ticket first). Fire and
            // forget exactly as before — it owns its own error handling and
            // falls back to the HTTP poll tier internally, so awaiting here
            // would only stall the WS close handler.
            void tryOpenSse();
          }
        };
      } catch (e) {
        console.error('[Player WS] Connection failed:', e);
        wsPolicyRef.current.onConnectionFailure();
        if (wsPolicyRef.current.failCount() >= 2) setWsDegraded(true);
        wsReconnectRef.current = setTimeout(connect, backoffMs(wsPolicyRef.current.failCount(), 1000, 30_000));
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
  // Deep-audit F7 (2026-08-30): depend on the PRIMITIVE, not the object —
  // applyManifest builds a fresh `em` literal every poll, so an object dep
  // tore this interval down and rebuilt it on every emergency poll (5 s
  // cadence became 5 s + latency, with phase drift).
  const emergencyActive = !!activeEmergency;
  useEffect(() => {
    if (phase !== 'playing' || !screenId) return;
    // 2026-08-30 (reliability program) — `wsDegraded` is reactive state fed
    // by the WS policy. The old code read wsFailCountRef.current here, but
    // this effect's deps never included it, so the advertised 5 s degraded
    // cadence only engaged if phase/emergency happened to churn the effect.
    const fast = emergencyActive || wsDegraded;
    const cadence = fast ? 5_000 : 10_000;
    emergencyPollRef.current = setInterval(() => fetchContent(), cadence);
    return () => {
      if (emergencyPollRef.current) {
        clearInterval(emergencyPollRef.current);
        emergencyPollRef.current = null;
      }
    };
  }, [phase, screenId, fetchContent, emergencyActive, wsDegraded]);

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

  // Clear the all-broken-assets failure tracker whenever the manifest
  // delivers a genuinely different item set (republish, edit, or a fresh
  // playlist after the outage that caused the failures is fixed). A
  // republish deserves a clean slate rather than instantly re-triggering
  // "Content unavailable" off stale failure ids that no longer exist.
  useEffect(() => {
    assetsFailedTrackerRef.current.reset();
    setAllAssetsFailed(false);
  }, [playlistItemsSig]);

  // While showing "Content Unavailable" (every item failed), the normal
  // sorted.map() render is replaced by the fallback card, so nothing is
  // mounted to naturally retry the failing URLs (an <img>/<video> that
  // isn't in the DOM can't fire a fresh request). Without an explicit
  // retry, a TRANSIENT outage (Supabase blip, CDN hiccup) would strand
  // the kiosk on this card forever even after the origin recovers — a
  // second silent-failure mode masquerading as a fix for the first one.
  // Self-correcting retry: clear the flag every 30s so the next render
  // remounts the current item and gives it a fresh chance. If it's still
  // broken, markItemFailed immediately re-sets the flag (visually a
  // no-op — the card doesn't flicker because both states render the same
  // card); if it recovers, markItemSucceeded clears it and playback
  // resumes automatically. 30s mirrors the emergency-poll / OTA-heartbeat
  // order of magnitude elsewhere in this file — frequent enough to
  // recover promptly, far too infrequent to thundering-herd the origin.
  useEffect(() => {
    if (!allAssetsFailed) return;
    const t = setInterval(() => {
      assetsFailedTrackerRef.current.reset();
      setAllAssetsFailed(false);
    }, 30_000);
    return () => clearInterval(t);
  }, [allAssetsFailed]);

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
      // Frame-locked sync: while the rAF conductor is locked and driving,
      // the legacy free-run advance stands down entirely (the conductor
      // also carries the loop-seam bundle-reload check). If the clock
      // ever unlocks (uncertainty blows out), syncActiveRef drops false
      // and this heartbeat resumes seamlessly — screens degrade to
      // today's free-run behavior rather than freezing.
      if (syncActiveRef.current) return;
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
          !readCachedEmergency() &&
          // Honor the reload-loop floor here too — if a watcher reload just
          // fired, don't immediately re-fire at the next seam.
          (!lastBundleReloadAtRef.current ||
            Date.now() - lastBundleReloadAtRef.current >= MIN_BUNDLE_RELOAD_GAP_MS)
        ) {
          console.log('[bundle-drift] loop boundary reached with new bundle pending — reloading at the seam');
          lastBundleReloadAtRef.current = Date.now();
          hardCacheBustingReload();
          return;
        }
        setCurrentIndex((prev) => prev + 1);
      }
    }, 500);

    return () => clearInterval(heartbeat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, playlistItemsSig]);

  // ═══ Frame-locked sync conductor (2026-07-28) ══════════════════════════
  // docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md §3+§5.
  //
  // THE INVARIANT: what is on screen is a pure function of (playlist,
  // syncedNow). Every screen in the group evaluates resolveTimeline()
  // against the same shared clock and lands on the same slide within a
  // frame — no GO commands, no leader, reboots rejoin in phase.
  //
  // A rAF loop (not setInterval) so the flip decision runs on the frame
  // containing the boundary: flip precision ≤1 frame. Every tick:
  //   1. clock unlocked (uncertainty > gate)? → stand down; the legacy
  //      heartbeat keeps free-running exactly as today. Self-healing in
  //      both directions.
  //   2. resolve the timeline at syncedNow (+ per-screen trim). A small
  //      FLIP_LEAD makes the React commit land ON the boundary frame
  //      rather than one after it.
  //   3. index changed? → advance the monotonic counter congruently
  //      (advanceCounterTo — consumers all read % N, and the +1 preload
  //      contract keeps working). Loop-seam bundle reload is preserved
  //      from the legacy path.
  //
  // A stalled/frozen tab self-corrects on the next frame that runs — the
  // conductor can jump multiple items forward (or effectively "rewind" by
  // forward-wrap), which the legacy elapsed-timer could never do.
  useEffect(() => {
    if (phase !== 'playing' || !syncEnabled) {
      syncActiveRef.current = false;
      return;
    }
    const SYNC_MAX_UNCERTAINTY_MS = 80;
    const SYNC_FLIP_LEAD_MS = 8; // ~half a 60Hz frame
    let raf = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      raf = requestAnimationFrame(tick);
      const clock = syncClockRef.current;
      const sorted = sortedItemsRef.current;
      if (!clock || !sorted.length) {
        syncActiveRef.current = false;
        return;
      }
      const mono = performance.now();
      if (!clock.isLocked(mono, SYNC_MAX_UNCERTAINTY_MS)) {
        syncActiveRef.current = false;
        return;
      }
      const serverNow = clock.now(mono);
      if (serverNow === null) {
        syncActiveRef.current = false;
        return;
      }
      const t = serverNow + syncConfigRef.current.trimMs;
      const posNow = resolveTimeline(sorted, t);
      if (!posNow) {
        syncActiveRef.current = false;
        return;
      }
      syncActiveRef.current = true;
      syncPosRef.current = posNow; // video servo + HUD + telemetry read this
      // Support/test observability: current sync state on window (mutated
      // in place — no allocation churn). The Playwright two-screen harness
      // and field debugging read this; it is NOT a public API.
      try {
        const dbg = ((window as any).__eduSyncState ||= {});
        dbg.locked = true;
        dbg.idx = posNow.index;
        dbg.serverNow = t;
        dbg.offsetInItemMs = posNow.offsetInItemMs;
        dbg.renderLeadMs = syncRenderLeadRef.current;
      } catch { /* SSR-safe no-op */ }
      // Tier-1 self-calibration: lead the flip DECISION by this device's
      // measured decision→paint latency so the painted frame — the thing
      // the viewer and the camera see — lands on the shared boundary. A
      // slow SoC leads more, a fast one less; glass-side alignment
      // improves automatically with zero operator involvement.
      const flipLeadMs = SYNC_FLIP_LEAD_MS + Math.max(0, Math.min(150, syncRenderLeadRef.current));
      const posFlip = resolveTimeline(sorted, t + flipLeadMs)!;
      const cur = currentIndexRef.current;
      const next = advanceCounterTo(cur, posFlip.index, sorted.length);
      if (next === cur) return;
      // Loop-seam opportunistic bundle reload — parity with the legacy
      // heartbeat's check: only at the wrap back to item 0, only with a
      // pending bundle, never during an emergency, floor-limited.
      const wrapped = (cur % sorted.length) + (next - cur) >= sorted.length;
      if (
        wrapped &&
        bundleDriftSinceRef.current &&
        !readCachedEmergency() &&
        (!lastBundleReloadAtRef.current ||
          Date.now() - lastBundleReloadAtRef.current >= MIN_BUNDLE_RELOAD_GAP_MS)
      ) {
        console.log('[Player Sync] loop seam with new bundle pending — reloading (rejoins in phase)');
        lastBundleReloadAtRef.current = Date.now();
        hardCacheBustingReload();
        return;
      }
      // Flip-error telemetry: offset into the new item at decision time,
      // minus the deliberate lead ≈ how late this flip is vs the shared
      // boundary. Only meaningful for single-step advances.
      if (next - cur === 1) {
        const err = Math.max(0, posFlip.offsetInItemMs - flipLeadMs);
        const s = syncStatsRef.current;
        s.lastFlipErrMs = err;
        s.flipErrEwmaMs = s.flipErrEwmaMs === null ? err : s.flipErrEwmaMs * 0.7 + err * 0.3;
        // Measure THIS flip's decision→paint latency: double-rAF fires
        // after the browser paints the frame containing the new slide.
        // EWMA (α=0.2) smooths raster jitter; clamp guards a stalled tab
        // from poisoning the lead; persisted at most every 10s.
        const decisionMono = mono;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const measured = performance.now() - decisionMono;
            if (!Number.isFinite(measured) || measured < 0 || measured > 400) return;
            const prev = syncRenderLeadRef.current;
            const nextLead = Math.max(0, Math.min(150, prev * 0.8 + measured * 0.2));
            syncRenderLeadRef.current = nextLead;
            const nowMono = performance.now();
            if (nowMono - syncRenderLeadSavedAtRef.current > 10_000) {
              syncRenderLeadSavedAtRef.current = nowMono;
              storeLeadMs(LS_SYNC_RENDER_LEAD, nextLead);
            }
          });
        });
      }
      // Flip log for the two-screen Playwright harness + field debugging:
      // server-time-stamped flips let two screens' logs be compared
      // directly (both clocks converge on the same server clock, so
      // |tA - tB| for the same boundary IS the sync skew, independent of
      // when an observer happens to sample either page). Bounded to 40.
      try {
        const flips: any[] = ((window as any).__eduSyncFlips ||= []);
        flips.push({ toIdx: posFlip.index, serverT: t, itemStartT: t + SYNC_FLIP_LEAD_MS - posFlip.offsetInItemMs });
        if (flips.length > 40) flips.splice(0, flips.length - 40);
      } catch { /* no-op */ }
      setCurrentIndex(next);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      syncActiveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, playlistItemsSig, syncEnabled]);

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

  // Wave 2a (2026-06-27) — PASSIVE multi-scene auto-advance. A NON-touch
  // template with >1 scene (an AI-generated "set" / lobby loop) plays itself:
  // walk currentSceneId through the scenes on a timer so each board shows in
  // turn. Touch templates are untouched (they advance on tap); single-scene
  // signage is untouched (effect no-ops). Taurus-safe (setInterval only).
  useEffect(() => {
    if (isTouchTemplate) return;
    const tpl: any = playlist?.template;
    const scenes: any[] = Array.isArray(tpl?.scenes) ? tpl.scenes : [];
    if (scenes.length < 2) return;
    // Only cycle scenes that actually HAVE zones — a truncated set can leave a
    // trailing scene with zero zones; never auto-advance onto a blank board
    // (beta-QA P1). A zone with no sceneId belongs to the default scene.
    const allZones: any[] = Array.isArray(tpl?.zones) ? tpl.zones : [];
    const ordered = [...scenes]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .filter((s) =>
        allZones.some((z: any) => z.sceneId === s.id || (!!s.isDefault && !z.sceneId)),
      );
    if (ordered.length < 2) return;
    const perSceneMs = 8000;
    // Start from the current/default scene, then cycle.
    const startId =
      currentSceneId || ordered.find((s) => s.isDefault)?.id || ordered[0]?.id || null;
    let idx = Math.max(0, ordered.findIndex((s) => s.id === startId));
    setCurrentSceneId(ordered[idx]?.id ?? null);
    const timer = setInterval(() => {
      idx = (idx + 1) % ordered.length;
      setCurrentSceneId(ordered[idx]?.id ?? null);
    }, perSceneMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTouchTemplate, playlist?.template?.id]);

  // ── Kiosk (EXTERNAL_HTML) wired-button actions ───────────────────
  // The Touch Kiosks pack runs inside a sandboxed null-origin iframe, so
  // a kiosk can't navigate the player or call our API itself. When a
  // visitor taps a [data-action] button the operator wired in the builder
  // ("When tapped…"), the in-iframe edit-shim posts {type:'educms-action',
  // key, action}. We run that action through the SAME security-gated
  // dispatcher TOUCH_POINT zones use (http-only URLs, no private IPs, no
  // javascript:). Only the player mounts this — the builder preview never
  // executes, it just previews. zoneId carries the kiosk field key so the
  // touch-analytics queue attributes the tap.
  //
  // W0-02 HARDENING (audit 2026-07-12, P0 "AI-authored JavaScript can
  // control the player"): this handler used to execute the action OBJECT
  // carried in the message, from ANY window. Now:
  //   1. `event.source` must be a board iframe WE mounted (the
  //      kiosk-frame-registry — sibling/foreign windows are rejected);
  //   2. the tapped `key` is resolved against that zone's OPERATOR-SAVED
  //      action map (config.actionOverrides). The `action` field in the
  //      message is IGNORED — an in-frame script can never supply its own
  //      action. Lossless: the shim itself only fires for keys present in
  //      the same overrides map, so every legitimately wired button still
  //      resolves.
  useEffect(() => {
    const onKioskAction = (e: MessageEvent) => {
      const d = e.data as { type?: string; key?: string; action?: unknown } | null;
      if (!d || typeof d !== 'object' || d.type !== 'educms-action') return;
      const savedActions = lookupKioskFrame(e.source);
      if (!savedActions) return; // not a frame we mounted — reject
      const key = typeof d.key === 'string' ? d.key : '';
      const action = key ? savedActions[key] : undefined;
      if (!action || typeof action !== 'object') return; // no approved key → no exec
      dispatchTouchAction(action, {
        screenId,
        tenantId,
        zoneId: `kiosk:${key}`,
      });
    };
    window.addEventListener('message', onKioskAction);
    return () => window.removeEventListener('message', onKioskAction);
  }, [screenId, tenantId]);

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

  // 2026-07-01 — all-assets-failed tracker (blank-screen class b). See the
  // allAssetsFailed state declaration above for the full rationale. These
  // two callbacks are the only mutation points: markItemFailed records one
  // more broken item and — only once every DISTINCT item in the current
  // playlist has failed at least once — flips the honest fallback card on.
  // markItemSucceeded (called from any onLoad/onPlaying) is proof the
  // outage (if there was one) is over, so it clears everything immediately
  // rather than waiting for a full recovery lap. Defined here (before any
  // early `return`) rather than down by the render logic that reads
  // `currentItem` — Rules of Hooks forbids a hook call after a component's
  // early returns have already executed on a given render.
  const markItemFailed = useCallback((itemId: string | undefined) => {
    if (!itemId || !sorted.length) return;
    const allIds = sorted.map((s: any) => s.id as string).filter(Boolean);
    const allFailed = assetsFailedTrackerRef.current.recordFailure(itemId, allIds);
    if (allFailed) setAllAssetsFailed(true);
  }, [sorted]);
  const markItemSucceeded = useCallback(() => {
    assetsFailedTrackerRef.current.recordSuccess();
    setAllAssetsFailed(false);
  }, []);

  // Native Android URL overlay. For asset playlists containing URL
  // items, a modern APK renders the upstream site in a second top-level
  // WebView while this React player stays mounted underneath. Browser
  // preview and older APKs keep using the iframe/proxy fallback below.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // AND-002 — capability probe is SYNCHRONOUS (nativeHas) so this effect
    // can bail before doing any work on a browser player / older APK,
    // exactly as the old `typeof bridge.showUrlOverlay === 'function'`
    // check did. Both methods are fire-and-forget (nativeFire).
    if (!nativeHas('showUrlOverlay') || !nativeHas('hideUrlOverlay')) return;

    const hide = () => {
      nativeFire('hideUrlOverlay');
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

    nativeFire('showUrlOverlay', url);
  }, [activeEmergency, currentIndex, isItemValid, phase, playbackStopped, sorted]);

  // Shared splash resolution string — used by all three pre-content phases.
  // Gated on bootMounted (NOT `typeof window`): the server pass and the
  // FIRST client pass must render identical trees, or hydration fails on
  // every boot — the chip's presence shifts its siblings (see bootMounted).
  const splashResolution = bootMounted
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
          // AND-002 — false means no transport took it (browser player /
          // older APK), which is the web-fallback case.
          if (!nativeFire('reload') && typeof window !== 'undefined') {
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
    // AND-002 — nativeFire is synchronous and total: true means a
    // transport (secure channel, else legacy object) accepted the call,
    // false means there is no APK here and we fall through to the web
    // cascade below. Same shape the try/typeof probe had.
    //
    // ⚠️ On a lock-task-pinned kiosk this is THE operator escape hatch —
    // MainActivity's onExitToDeviceHome lambda calls
    // LockTaskController.disengage() before it does anything else. Do not
    // "simplify" this button away.
    if (nativeFire('exitToDeviceHome')) return;
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
    // R-P0-02: gate ALL token writers FIRST — before any await gives an
    // in-flight register response the chance to land mid-teardown.
    unpairedRef.current = true;
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
      getServiceWorkerContainer()?.controller?.postMessage({ type: 'CLEAR_CACHE', tier: 'all' });
    } catch { /* ignore */ }

    // 3. Native bridge → APK wipes DataStore + reloads with empty
    //    token. On non-APK clients (browser tab) fall through to a
    //    React-only reset. AND-002 — nativeFire returns false exactly
    //    in that no-APK case and never throws.
    // Teardown complete: lift the token-writer gate so the FRESH pairing
    // cycle that starts now can store its new unpaired credential. Any
    // in-flight response from BEFORE this point already lost the race to
    // the gate above. (On the APK path the whole page reloads, which
    // resets the ref anyway.)
    unpairedRef.current = false;
    if (nativeFire('unpair')) return;
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

  // ── "Software update ready / Updating…" — ONE node, EVERY playback
  // branch (2026-09-01, TC22/G55 field find). This modal used to be inlined
  // in the TEMPLATE branch only, so a screen running a media playlist or a
  // ribbon tile grid never showed the operator the update it had just been
  // pushed — the same class of miss the {otaOverlay} audit notes below
  // document three times. Built once here; mounted in the template branch,
  // the media branch and the tile branch. top/right/bottom/left longhand,
  // not `inset` — Chromium-83 Taurus, CLAUDE.md #10.
  const updatePromptNode = showUpdatePrompt ? (
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
                  // AND-002 — fire-and-forget; nativeFire never
                  // throws, so the prompt always advances.
                  // 2026-08-25 — A HUMAN IS PRESSING THIS. Route it
                  // through the user-initiated method so the check
                  // carries `source:"user"` and is honoured even
                  // while the fleet rollout is held; fall back to the
                  // gated method on a pre-1.1.5 APK.
                  fireUserUpdateCheck();
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
  ) : null;

  // 2026-04-28 — Install Now handler shared by every splash mode.
  // Operator: "screen paired screen should be our main screen with
  // all the info" — moved from the click-to-show info overlay into
  // KioskSplash itself so the banner appears on pairing AND
  // post-pair splashes. Mirrors the legacy in-overlay button:
  //  1. Set otaProgress so the banner switches to "in progress"
  //  2. Call native bridge so OtaUpdateWorker fires
  const handleInstallUpdate = () => {
    // AND-002 — sync capability probe keeps setOtaProgress's
    // `bridgeAvailable` (which drives the banner copy) correct on the
    // same tick, exactly as the old `typeof bridge.checkForUpdates`
    // check did. The call itself is fire-and-forget here — we don't use
    // the returned versionName on this path.
    const bridgeAvailable = nativeHas('checkForUpdates');
    setOtaProgress({ startedAt: Date.now(), bridgeAvailable });
    if (bridgeAvailable) {
      // 2026-08-25 — "Install now" on the splash is a person at the panel,
      // so it carries `source:"user"` and is honoured even while the fleet
      // rollout is held. See fireUserUpdateCheck for the relay/human split.
      //
      // ⚠️ The RESUME button further down deliberately does NOT use this.
      // It fires a re-check to clear a stale error banner, not because
      // anybody asked to be updated — promoting it would install a held
      // build on somebody who only pressed Resume.
      const path = fireUserUpdateCheck();
      console.log(`[OTA] Install now pressed on the panel → ${path} path`);
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
        className="fixed bottom-40 left-4 right-4 mx-auto z-[9998] max-w-xl px-5 py-4 rounded-2xl bg-slate-900/95 text-white shadow-2xl border border-slate-700 backdrop-blur-md flex flex-wrap items-center justify-center [&>*+*]:ml-3"
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
        <div className="flex [&>*+*]:ml-2 shrink-0">
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
  //
  // 2026-09-01 — the fixed corner chips size themselves off Tailwind
  // utilities, so on a 4K panel with no LED canvas pin they were a 14px
  // headline in a 384px box on 2160px of glass: an alert nobody standing in
  // the room can read. Every dimension below is the same value the Tailwind
  // class already computed, multiplied by `--splash-k` — identical at ≤1920,
  // proportional above it. Only two physical sides are ever set (bottom +
  // right / top + right), so these objects can never serialize to the
  // Chromium-83-hostile `inset` shorthand (CLAUDE.md rule #10, 3rd variant).
  const unsignedWsBanner = unsignedWsTokenWarning ? (
    <div
      className="fixed bottom-6 right-6 z-[10001] max-w-md px-5 py-4 rounded-2xl bg-amber-500 text-amber-950 shadow-2xl border border-amber-300 flex items-start [&>*+*]:ml-3"
      role="alert"
      aria-live="assertive"
      style={{
        bottom: 'calc(24px * var(--splash-k, 1))',
        right: 'calc(24px * var(--splash-k, 1))',
        maxWidth: 'calc(448px * var(--splash-k, 1))',
        paddingTop: 'calc(16px * var(--splash-k, 1))',
        paddingBottom: 'calc(16px * var(--splash-k, 1))',
        paddingLeft: 'calc(20px * var(--splash-k, 1))',
        paddingRight: 'calc(20px * var(--splash-k, 1))',
        // rounded-2xl under this repo's redefined radius scale (globals.css).
        borderRadius: 'calc(var(--radius, 1rem) * 1.8 * var(--splash-k, 1))',
      }}
    >
      <AlertTriangle
        className="w-6 h-6 shrink-0 mt-0.5"
        style={{
          width: 'calc(24px * var(--splash-k, 1))',
          height: 'calc(24px * var(--splash-k, 1))',
          marginTop: 'calc(2px * var(--splash-k, 1))',
        }}
      />
      <div
        className="flex-1 min-w-0"
        style={{ marginLeft: 'calc(12px * var(--splash-k, 1))' }}
      >
        <div
          className="text-base font-bold"
          style={{ fontSize: 'calc(16px * var(--splash-k, 1))', lineHeight: 1.5 }}
        >
          Real-time disabled
        </div>
        <div
          className="text-xs mt-1 leading-relaxed"
          style={{
            fontSize: 'calc(12px * var(--splash-k, 1))',
            marginTop: 'calc(4px * var(--splash-k, 1))',
          }}
        >
          Kiosk needs re-pairing — no signed device token available.
          Emergency events still arrive via 5–10 s polling fallback,
          but instant real-time is offline.
        </div>
      </div>
    </div>
  ) : null;

  // 2026-08-30 (reliability program W1-2) — the SERVER said this device's
  // credential is unproven (`requiresRePair` at register time). Content
  // keeps playing on renewed temporary tokens, so this is deliberately a
  // small corner chip, not a takeover — but it must exist: the silent
  // version of this state is how a screen ran for days on hourly tokens
  // with nobody told. Kept clear of the bottom-center toast and the
  // bottom-right unsigned-WS banner (which covers the unpaired-no-token
  // case; this one is "paired but trust expired").
  const repairRequiredChipNode = (
    <div
      className="fixed top-6 right-6 z-[10001] max-w-sm px-4 py-3 rounded-xl bg-amber-500/95 text-amber-950 shadow-xl border border-amber-300 flex items-start [&>*+*]:ml-2.5"
      role="alert"
      aria-live="polite"
      style={{
        top: 'calc(24px * var(--splash-k, 1))',
        right: 'calc(24px * var(--splash-k, 1))',
        maxWidth: 'calc(384px * var(--splash-k, 1))',
        paddingTop: 'calc(12px * var(--splash-k, 1))',
        paddingBottom: 'calc(12px * var(--splash-k, 1))',
        paddingLeft: 'calc(16px * var(--splash-k, 1))',
        paddingRight: 'calc(16px * var(--splash-k, 1))',
        // rounded-xl under this repo's redefined radius scale (globals.css).
        borderRadius: 'calc(var(--radius, 1rem) * 1.4 * var(--splash-k, 1))',
      }}
    >
      <AlertTriangle
        className="w-5 h-5 shrink-0 mt-0.5"
        style={{
          width: 'calc(20px * var(--splash-k, 1))',
          height: 'calc(20px * var(--splash-k, 1))',
          marginTop: 'calc(2px * var(--splash-k, 1))',
        }}
      />
      <div
        className="flex-1 min-w-0"
        style={{ marginLeft: 'calc(10px * var(--splash-k, 1))' }}
      >
        <div
          className="text-sm font-bold"
          style={{ fontSize: 'calc(14px * var(--splash-k, 1))', lineHeight: 1.4285714 }}
        >
          Re-pair required
        </div>
        <div
          className="text-[11px] mt-0.5 leading-relaxed"
          style={{
            fontSize: 'calc(11px * var(--splash-k, 1))',
            marginTop: 'calc(2px * var(--splash-k, 1))',
          }}
        >
          This screen&rsquo;s trusted credential expired. Content continues on a
          temporary key, but re-pair it from the dashboard to restore full trust.
        </div>
      </div>
    </div>
  );

  // ── WHERE the chip is allowed to paint (2026-09-01) ────────────────────
  //
  // The chip used to render from all four render exits unconditionally,
  // which meant it sat over LIVE PUBLIC CONTENT — a lobby board, a menu, a
  // scoreboard — all day, for a condition the public cannot act on. Operator
  // call: admin state does not own public glass.
  //
  // The TRUTH is unchanged and still stated in three places that matter:
  // the dashboard chip (never expires), every operator surface here (splash /
  // paused / diagnostics card / info overlay — unconditional, forever), and
  // for the first 5 minutes after boot even over content, so an installer who
  // just power-cycled the panel gets an honest walk-up diagnostic. W1-2's
  // requirement — never silently "fine" while running on temporary tokens —
  // is preserved; only the PERMANENT public-glass placement is retired. See
  // `repairChipPolicy.ts`.
  //
  // `onOperatorSurface` is decided per render exit, not once, because two of
  // the exits (the template branch and the main return) can be showing EITHER
  // live content or a diagnostic view depending on state.
  const renderRepairRequiredChip = (onOperatorSurface: boolean) =>
    !unsignedWsTokenWarning &&
    shouldShowRepairChip({
      repairRequired,
      onOperatorSurface,
      // `repairChipBootWindowOpen` is the one-shot timeout's verdict; while it
      // is still open we hand the policy the real elapsed time. Both paths
      // agree — the state exists only to guarantee a re-render at the edge.
      msSinceBoot: repairChipBootWindowOpen
        ? Date.now() - bootAtRef.current
        : REPAIR_CHIP_BOOT_WINDOW_MS,
    })
      ? repairRequiredChipNode
      : null;

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

  // ── SOFT BLANK (2026-08-25) — the universal, unbrickable blank ─────────
  //
  // ⚠️ THIS IS A CROSS-BRANCH OVERLAY. It is hoisted here, beside
  // {otaOverlay} / {connectivityToast} / {unsignedWsBanner} /
  // {renderRepairRequiredChip(…)} / {canvasEditor},
  // because this component has FIVE render exits and an overlay that lives in
  // only one of them is a feature that silently does nothing on every screen
  // that takes a different exit.
  //
  // THAT IS NOT HYPOTHETICAL — it is the third time in this file:
  //   2026-04-29  {otaOverlay} missing from the TEMPLATE branch → "pushed the
  //               update and got no feedback on the player".
  //   2026-05-14  <TouchOverlay>/<TouchNavOverlay> missing from the TEMPLATE
  //               branch → "nothing happened on tap".
  //   2026-08-25  THIS overlay, shipped inside the non-template branch only.
  //               Field proof: G43 and M43 were both playing a single-zone
  //               EXTERNAL_HTML template playlist, so both took the
  //               `isTemplate && !playbackStopped` early return and never
  //               mounted the div. Every press audited `dispatched /
  //               delivered:true / mechanism web-overlay`; the panel logged
  //               "soft BLANK → overlay ON"; nothing changed on the glass.
  //               L55VEC, the one panel where Blank worked, had no active
  //               template schedule and so fell through to the main return.
  //
  // The rule that ends the pattern: render `{softBlankOverlay}` from EVERY
  // return in this component. `__tests__/softBlankRenderExits.test.ts` parses
  // this file and fails the build if any render exit omits it.
  //
  // The operator's Blank button is THIS: one black div, drawn by the player
  // itself. It never reaches the APK, so it can never take the device-admin
  // lock that latched a Goodview G43 and a Mobile A-Frame into an
  // unrecoverable vendor standby on the incident night. WAKE removes it; a
  // reload removes it; an emergency removes it. Hardware power is a separate
  // pair of verbs (POWER_OFF / POWER_ON) behind a proven-mechanism allowlist.
  //
  // EMERGENCY ALWAYS PUNCHES THROUGH — three independent guarantees:
  //   1. dispatchDisplayControl DROPS a BLANK while an emergency is displayed
  //      (and clears any overlay already up);
  //   2. the state-edge effect above force-clears on the emergency edge;
  //   3. this render condition, which cannot paint black over an alert even
  //      if 1 and 2 both somehow failed.
  // Plus zIndex 9990, BELOW EmergencyOverlay's 9999, so the overlay would
  // lose the stacking contest anyway.
  //
  // ⚠️ TAURUS (CLAUDE.md #10): longhand top/right/bottom/left, never `inset` /
  // `inset-0`. All four are the SAME value, which is the uniform case the
  // Chromium-83 polyfill is built to force-zero — the non-uniform
  // serialization landmine (variant 3) does not apply.
  //
  // ── ONE NODE, TWO STATES (brightness split, 2026-08-25 later) ─────────
  //
  // The soft DIM renders through this same div at partial opacity instead of
  // stacking a second layer. One node means one render-exit rule, one paint
  // proof and one emergency clear — three of each is how they drift apart.
  // BLANK wins when both are set: opaque, and it swallows touches, which a
  // dim must never do.
  //
  // A dim can never reach opacity 1 (SOFT_DIM_MAX_ALPHA caps it at 0.85), so
  // "dimmed" always stays visibly distinguishable from "blanked" — and a
  // brightness slider can never black out a wall-mounted panel.
  const softBlankOverlay =
    (softBlank || softDim > 0) && !activeEmergency && !pushedEmergencyMessage ? (
      <div
        data-edu-soft-blank={softBlank ? '1' : undefined}
        data-edu-soft-dim={!softBlank && softDim > 0 ? String(softDim) : undefined}
        ref={softBlankNodeRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          zIndex: 9990,
          background: '#000000',
          opacity: softBlank ? 1 : softDim,
          // A BLANK swallows touches rather than letting a visitor interact
          // with content they cannot see — a kiosk that looks off must behave
          // off; Wake, or any page reload, brings it back. A DIM must not:
          // the content is still readable and still meant to be usable, so
          // the film has to be transparent to hit-testing.
          pointerEvents: softBlank ? 'auto' : 'none',
        }}
      />
    ) : null;

  // ─── Pre-content escape panel (2026-08-30, field install) ───
  // Two brand-new units were bricked at install time: the remote's Back key
  // dispatched edu-show-stop-overlay → setPlaybackStopped(true), but the
  // `registering` / `pairing` early returns render NOTHING for that state —
  // Back visibly did nothing (and a second press toggled it back off). The
  // operator had no exit, no retry, and no way back into the on-device
  // setup checklist (its only glass re-entry is a TOUCH corner-hold).
  //
  // This panel is what Back now opens on the pre-content phases. Remote-first:
  // autoFocus on the primary so OK/Enter works with zero navigation, and
  // every control is a real <button> so D-pad spatial nav reaches it.
  // Spacing via margins, not `gap` (Chromium-83 Taurus floor); positioning
  // via four longhand sides (never `inset`).
  const retryConnectionNow = () => {
    // Kick the resilient retry chain ahead of its timer — same recovery the
    // connectivity toast's "Retry now" runs.
    setError(null);
    registerFailCountRef.current = 0;
    fetchFailCountRef.current = 0;
    fetchFailStreakStartedAtRef.current = null;
    if (registerRetryTimerRef.current) clearTimeout(registerRetryTimerRef.current);
    if (tickToastRef.current) clearInterval(tickToastRef.current);
    if (screenId) {
      fetchContent();
    } else {
      registrationLoopRef.current?.stop();
      registrationLoopRef.current = null;
      setPhase('registering');
    }
  };
  const escapeButtonCls =
    'px-6 py-3 text-sm font-bold rounded-2xl transition-all shadow-sm focus:outline-none focus:ring-4 focus:ring-indigo-300 focus:scale-95';
  const preContentEscapeOverlay = playbackStopped ? (
    <div
      role="dialog"
      aria-label="Screen options"
      style={{
        position: 'fixed',
        top: 0, right: 0, bottom: 0, left: 0,
        zIndex: 9985,
        background: 'rgba(15, 23, 42, 0.92)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div className="bg-white rounded-3xl shadow-2xl px-8 py-7 max-w-md w-[92%] text-center">
        <h2 className="text-xl font-extrabold text-slate-800 mb-1">Screen options</h2>
        <p className="text-xs text-slate-500 mb-5">
          {connectivity.kind === 'reconnecting'
            ? `Not connected — ${connectivity.reason || 'cannot reach the server'} (attempt ${connectivity.attempt}). Check this screen's network can reach ${(() => { try { return new URL(getApiRoot()).host; } catch { return 'the CMS server'; } })()}.`
            : 'Use the remote: arrows to move, OK to choose, Back to close.'}
        </p>
        <div className="flex flex-wrap items-center justify-center [&>*]:m-1.5">
          <button
            autoFocus
            onClick={() => { setPlaybackStopped(false); setExitUnavailable(false); }}
            className={`${escapeButtonCls} bg-indigo-600 hover:bg-indigo-700 text-white`}
          >
            Keep waiting
          </button>
          <button
            onClick={() => { setPlaybackStopped(false); setExitUnavailable(false); retryConnectionNow(); }}
            className={`${escapeButtonCls} bg-white border border-slate-200 hover:bg-slate-50 text-slate-700`}
          >
            Retry now
          </button>
          {bootMounted && isAndroidWebView() && (
            <button
              onClick={() => {
                // Raise the native first-boot checklist so the grants can be
                // finished from the glass (v1.1.6+ APKs). Fire-and-forget —
                // the APK logs its own refusal if a gate owns the screen.
                nativeFire('openSetupChecklist');
                setPlaybackStopped(false);
                setExitUnavailable(false);
              }}
              className={`${escapeButtonCls} bg-white border border-slate-200 hover:bg-slate-50 text-slate-700`}
            >
              Device setup
            </button>
          )}
          <button
            onClick={handleExitApp}
            disabled={exitUnavailable}
            className={`${escapeButtonCls} bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-50`}
          >
            {exitUnavailable ? 'Exit unavailable' : 'Exit to launcher'}
          </button>
        </div>
      </div>
    </div>
  ) : null;
  // One-line standing hint so the escape panel is discoverable from across
  // the room on a kiosk. Gated on bootMounted (hydration contract — it reads
  // the bridge) and shown only where a remote is plausible (Android shell).
  const remoteBackHint = bootMounted && isAndroidWebView() && !playbackStopped ? (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        bottom: 4, left: 0, right: 0,
        zIndex: 9984,
        textAlign: 'center',
        fontSize: 11,
        fontWeight: 600,
        color: 'rgba(100, 116, 139, 0.85)',
        pointerEvents: 'none',
      }}
    >
      Remote: press Back for screen options
    </div>
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
          hardwareModel={manifestHardwareModel}
        />
        {otaOverlay}
        {connectivityToast}
        {unsignedWsBanner}
        {/* Splash = an operator surface: the chip is unconditional here. */}
        {renderRepairRequiredChip(true)}
        {canvasEditor}
        {softBlankOverlay}
        {preContentEscapeOverlay}
        {remoteBackHint}
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
          hardwareModel={manifestHardwareModel}
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
            // AND-002 — fire-and-forget, never throws. A false return
            // means no APK here and the CSS fallback effect handles it.
            nativeFire('setOrientation', value);
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
        {/* Splash = an operator surface: the chip is unconditional here. */}
        {renderRepairRequiredChip(true)}
        {canvasEditor}
        {softBlankOverlay}
        {preContentEscapeOverlay}
        {remoteBackHint}
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

  // (sceneTick / idleResetTimerRef / sorted / isItemValid /
  // markItemFailed / markItemSucceeded hooks were moved above the early
  // returns to satisfy the Rules of Hooks.)
  const currentItem = sorted.length && isItemValid(sorted[currentIndex % sorted.length]) ? sorted[currentIndex % sorted.length] : null;
  const isVideo = currentItem?.asset?.mimeType?.startsWith('video/');
  const fileUrl = currentItem?.asset?.fileUrl || '';
  const rawResolvedUrl = fileUrl.startsWith('http') ? fileUrl : `${getApiRoot()}${fileUrl}`;
  // audit §2 P0-4 — route IMAGES through the asset CDN edge proxy so repeat
  // cross-kiosk/cross-load fetches hit the edge instead of Supabase origin.
  // resolveAssetUrl is a no-op until NEXT_PUBLIC_ASSET_CDN is set, so this is
  // inert today. IMAGES ONLY: video stays on the raw Supabase URL because the
  // service-worker range cache is keyed on it — proxying video would change
  // the key and re-download every loop. (full-resolution preserved; the proxy
  // changes the host, not the bytes — safe for 1080p/4K unlike transforms.)
  const resolvedUrl = currentItem?.asset?.mimeType?.startsWith('image/')
    ? resolveAssetUrl(rawResolvedUrl)
    : rawResolvedUrl;

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
              // 2026-05-28 (§19) — zone rotation + opacity, set in the
              // builder's "Position & size" panel and stored under
              // defaultConfig._zoneRotation / _zoneOpacity. Mirrors
              // BuilderZone exactly so the player matches the editor.
              // `transform: rotate()` + `opacity` are Chromium-83-safe
              // (Taurus runs Chrome 83); no `inset`. Identity values are
              // skipped so untouched zones carry no extra transform.
              ...(() => {
                const c = (cfg || {}) as Record<string, unknown>;
                const rot = typeof c._zoneRotation === 'number' ? c._zoneRotation : 0;
                const opa = typeof c._zoneOpacity === 'number' ? c._zoneOpacity : 1;
                const extra: React.CSSProperties = {};
                if (rot) extra.transform = `rotate(${rot}deg)`;
                if (opa < 1) extra.opacity = opa;
                return extra;
              })(),
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
                // Sports Wave S2 (2026-07-02) — this IS a real screen. A
                // sports widget with no bound game (no ambient
                // GameStateProvider, no config.gameId) must render its
                // dignified "bind a game" empty state here, never the
                // builder-only fabricated sample. See GameStateContext.tsx.
                renderSurface="player"
              />
            </WidgetErrorBoundary>
          </div>
          );
        })}
        </TemplateScaler>

        {/* Empty-scene dead-end fallback (2026-06-26). On a multi-scene
            touch kiosk, a visitor can tap a button whose goto-scene target
            has ZERO renderable zones (e.g. an AI-generated kiosk's
            "Concessions" / "Restrooms" destination scene was left empty).
            Without this, the canvas just goes blank — bgColor only — and
            the visitor is stranded until the 60s idle-reset fires. The
            cross-template "Nothing to show here" fallback only lives in
            TouchNavOverlay, which doesn't cover in-template scene switches.

            Trigger: interactive context + the active scene has no zones +
            we've navigated AWAY from the home/default scene (so there's
            somewhere to go back TO). We never show this for a legacy
            single-scene template that's simply empty on the home scene —
            there'd be no "Back" destination and it isn't the dead-end bug.

            Taurus-safe: longhand top/right/bottom/left (no `inset`), no
            flex `gap` (margins instead), per CLAUDE.md #10. */}
        {isInteractive && zones.length === 0 && activeSceneId && defaultScene?.id && activeSceneId !== defaultScene.id && (
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
          <div
            className="absolute flex items-center justify-center text-white text-center px-8 z-[900]"
            style={{ top: 0, right: 0, bottom: 0, left: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="text-4xl font-black mb-3">This section is empty</h2>
              <p className="text-lg text-white/60 mb-8">There&apos;s nothing here yet.</p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  // Return to the home/default scene. Reuse the same
                  // scene-change path a goto-scene action fires so all the
                  // idle-reset + analytics listeners stay consistent.
                  try {
                    window.dispatchEvent(new CustomEvent('edu:touch-scene-change', {
                      detail: { sceneId: defaultScene.id, transition: 'cut' },
                    }));
                  } catch {}
                  setCurrentSceneId(defaultScene.id);
                }}
                className="px-7 py-4 rounded-xl text-lg font-bold text-white bg-white/15 hover:bg-white/25 border border-white/30 transition-colors"
              >
                ← Back
              </button>
            </div>
          </div>
        )}

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
        {updatePromptNode}

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
        {/* Live template content on the glass. Operator surface only while
            the info overlay is open; otherwise the boot-window rule applies. */}
        {renderRepairRequiredChip(showOverlay)}
        {canvasEditor}
        {/* 2026-08-25 — SAME AUDIT MISS, THIRD TIME. The blank/power split
            put the soft-blank overlay in the non-template branch only, so
            on G43 and M43 — both playing a single-zone EXTERNAL_HTML
            template playlist — the operator's Blank and Wake buttons did
            nothing at all while the server audited every press as
            dispatched + delivered. This is the branch that was missing. */}
        {softBlankOverlay}

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
      <>
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
        {/* The tile CHILDREN are full player documents and each blanks
            itself, but the parent owns the whole viewport — so it draws the
            overlay too rather than relying on N children all succeeding.
            Same uniform rule as every other exit; see the const's header. */}
        {softBlankOverlay}
        {/* Same rule for the update prompt: the parent owns the glass. */}
        {updatePromptNode}
      </>
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
        top: 0, left: 0,
        // 2026-06-26 — size the playlist content area to the LED CANVAS
        // (--led-w/--led-h, set from the screen's canvasW/canvasH), pinned
        // TOP-LEFT, so a published image/video FILLS the region the LED
        // controller maps. Bug: raw 100vw = the full 1920 device frame, so a
        // custom 960×1080 image centered in 1920 and a narrow LED (which maps
        // only the top-left canvas region) showed just the left slice on one
        // panel. The /board route already fills because it's a canvas-sized
        // iframe; plain media didn't. Falls back to 100vw/100vh on browsers /
        // screens with no canvas configured — unchanged there.
        //
        // 2026-07-03 — Rule #10 variant 3: `right`/`bottom` are DELIBERATELY
        // OMITTED (not set to 'auto'). Explicitly declaring all four of
        // top/right/bottom/left in one style object — even with right/bottom
        // as 'auto' — makes the browser's CSSOM re-serialize them into the
        // `inset` SHORTHAND in the DOM `style` attribute: `inset: 0px auto
        // auto 0px`. That string STARTS WITH "inset: 0", which collides with
        // the player/layout.tsx Chromium-83 polyfill's `[style*="inset: 0"]`
        // selector — it force-zeroes right/bottom (!important), which
        // happens to be harmless here ONLY because width/height already pin
        // the box, but is a landmine pattern to avoid regardless. Omitting
        // right/bottom entirely means only top+left ever reach the `style`
        // attribute — never four sides — so this object can NEVER serialize
        // to `inset` at all. Zero behavior change: an unset side and an
        // explicit 'auto' side compute identically for a `position:fixed`
        // box whose size comes from width/height. See CLAUDE.md rule #10.
        width: 'var(--led-w, 100vw)',
        height: 'var(--led-h, 100vh)',
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
      {currentItem && !playbackStopped && !allAssetsFailed ? (
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
            const rawResUrl = fileUrl.startsWith('http') ? fileUrl : `${getApiRoot()}${fileUrl}`;
            // audit §2 P0-4 — images go through the CDN edge proxy (no-op until
            // NEXT_PUBLIC_ASSET_CDN set). Video/web/pdf stay raw: video for the
            // SW range cache, iframe assets for Range support. (preload path)
            const resUrl = mime.startsWith('image/') ? resolveAssetUrl(rawResUrl) : rawResUrl;

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
            let classes = "absolute top-0 right-0 bottom-0 left-0 w-full h-full object-fill transition-all duration-[1000ms] ease-in-out ";
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
                  // Frame-locked sync: the conductor owns advancement.
                  // onEnded must not shift phase on one screen (a video
                  // ending early holds its slot — deterministic), and an
                  // error must not skip ahead either (the slot is held so
                  // the whole group re-converges at the next boundary;
                  // the failure still feeds the all-failed tracker).
                  onEnded={() => {
                    if (!syncActiveRef.current) setCurrentIndex(prev => prev + 1);
                  }}
                  onError={() => {
                    console.warn('[Player] video error, skipping:', resUrl);
                    markItemFailed(item.id);
                    if (!syncActiveRef.current) setCurrentIndex(prev => prev + 1);
                  }}
                  onPlaying={markItemSucceeded}
                  syncItemIndex={index}
                  syncActiveRef={syncActiveRef}
                  syncPosRef={syncPosRef}
                  syncItemCount={sorted.length}
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
              // AND-002 — this is a RENDER gate, so the capability check
              // must stay synchronous (nativeHas). Awaiting a round trip
              // here would flash the iframe fallback for a frame before
              // swapping to the native-overlay placeholder.
              const nativeUrlOverlayAvailable = !isPdf && nativeHas('showUrlOverlay');
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
              // Web pages route through ScaledWebFrame so narrow LED
              // canvases (<1280px) get a desktop-viewport render scaled
              // to fit instead of a squeezed 960px layout. PDFs keep the
              // direct iframe — the native viewer already fits pages.
              if (!isPdf) {
                return (
                  <ScaledWebFrame
                    key={item.id}
                    src={iframeSrc}
                    classes={classes}
                    title={item.id}
                    onLoad={(e) => {
                      const frame = e.currentTarget as HTMLIFrameElement;
                      // 2026-08-02 — the shim is baked into the proxied
                      // document server-side now (the frame is sandboxed, so
                      // contentWindow.eval is gone). This ARMS it and starts
                      // forwarding remote-control keys over postMessage.
                      import('@/components/widgets/webpage-spatial-nav').then(({ attachSpatialNavBridge }) => {
                        attachSpatialNavBridge(frame);
                      }).catch(() => { /* never block playback on the bridge */ });
                      markItemSucceeded();
                    }}
                    onError={() => {
                      console.warn('[Player] iframe error, skipping:', iframeSrc);
                      markItemFailed(item.id);
                      setCurrentIndex(prev => prev + 1);
                    }}
                  />
                );
              }
              // PDF-ONLY BRANCH. Every text/html asset returned above via
              // ScaledWebFrame (which IS sandboxed); `isPdf` is the only way
              // to reach here, and `iframeSrc` is the raw asset URL.
              //
              // ⚠️ DELIBERATELY NOT SANDBOXED — measured, not assumed
              // (2026-08-02). Chrome refuses to run its built-in PDF viewer
              // inside ANY sandboxed iframe: a 4-cell probe (no sandbox /
              // "allow-scripts allow-popups-to-escape-sandbox" /
              // "allow-scripts allow-same-origin" / EVERY sandbox token)
              // against the same PDF rendered the viewer ONLY in the
              // unsandboxed cell — all three sandboxed cells painted nothing.
              // So adding `sandbox` here does not harden this frame, it
              // deletes the "show the lunch menu PDF on the lobby screen"
              // feature outright.
              //
              // Residual exposure is bounded: the asset is served from the
              // Supabase storage host, i.e. already cross-origin, so the
              // same-origin policy alone denies parent.document / our
              // localStorage. What sandbox WOULD have added is top-navigation
              // and popup blocking, which only matter if an asset stored with
              // mimeType 'application/pdf' is actually served with an HTML
              // Content-Type. Close that at upload validation (out of this
              // file's scope), not by breaking PDFs here.
              return <iframe
                key={item.id}
                src={iframeSrc}
                className={classes}
                title={item.id}
                onLoad={() => {
                  // Spatial nav intentionally NOT attached: this frame is a
                  // cross-origin PDF, so the proxy never injected a shim into
                  // it and there is nothing to arm. (The previous
                  // `injectSpatialNav` call here always threw SecurityError
                  // and was silently swallowed — it never did anything.)
                  markItemSucceeded();
                }}
                onError={() => {
                  console.warn('[Player] iframe error, skipping:', iframeSrc);
                  markItemFailed(item.id);
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
                // 2026-06-26 — auto-fit: stretch the image to exactly fill the
                // screen (object-fit: fill). A correctly-sized image looks
                // perfect; a wrong aspect looks stretched/shrunk. No per-screen
                // setting, no letterbox, no crop, no blur — the operator's model.
                // Inline overrides the object-fill class; belt-and-suspenders
                // for Taurus WebViews where Tailwind utilities may not apply.
                style={{
                  position: 'absolute',
                  top: 0, left: 0, right: 0, bottom: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'fill',
                  opacity: isActive ? 1 : 0,
                  zIndex: isActive ? 10 : 0,
                  transition: trans === 'NONE' ? 'none' : 'opacity 1000ms ease-in-out',
                }}
                onLoad={markItemSucceeded}
                onError={() => {
                  console.warn('[Player] image error, skipping:', resUrl);
                  markItemFailed(item.id);
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
          {/* ── `--splash-k` for the Tailwind-sized half of this card ───────
              2026-09-01. The hero + card chrome above scale through their
              own `calc(… * var(--splash-k, 1))` inline styles. Everything
              BELOW the hero — the device row, storage/activity columns, the
              playlist list, the update banner, every action button — takes
              its size from Tailwind utilities, which are fixed rem values
              that no inline style can reach without rewriting ~200 class
              usages one at a time inside an 11.9k-line file.

              So the utilities themselves are re-declared here, scoped to
              this card (`.edu-diag-scale`), in terms of the same var. Every
              value below is Tailwind's OWN default for that class, so at
              k === 1 — every viewport ≤1920, every LED wall, every browser
              preview — the computed pixels are byte-identical to today.
              Above 1920 they scale together instead of leaving 11px rows
              stranded inside a column that just got twice as wide.

              ⚠️ THE `:not(#\#)` TAIL IS LOAD-BEARING, NOT DECORATION. This
              repo's Tailwind build (shadcn/tailwind.css) emits every utility
              with a four-deep ID-specificity hack —
              `.text-xs:not(#\#):not(#\#):not(#\#):not(#\#)`, i.e. (4,1,0).
              A plain `.edu-diag-scale .text-xs` is (0,2,0) and LOSES: the
              first cut of this block parsed fine, matched the right
              elements, and changed nothing on screen. Repeating the same
              tail here makes these (4,2,0) — one class ahead of Tailwind,
              and deliberately WITHOUT `!important`, so the hero's inline
              `--led-w` formulas still win over these exactly as they do
              today.

              Chromium-83 safe on purpose: only `calc()` + `var()` (both
              universal) and a single-simple-selector `:not()` (CSS3, and
              already shipped to these same panels by Tailwind itself). No
              `clamp()`, no `gap`, no container queries. The `<style>`
              element (rather than a global stylesheet) also means this
              survives the Taurus case where the Tailwind bundle never loads
              at all — the same reason the inline fallbacks above it exist. */}
          <style suppressHydrationWarning>{`
            /* Font sizes — Tailwind’s own values, so k === 1 is byte-identical. */
            .edu-diag-scale .text-\\[10px\\]:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { font-size: calc(10px * var(--splash-k, 1)); }
            .edu-diag-scale .text-\\[11px\\]:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { font-size: calc(11px * var(--splash-k, 1)); }
            .edu-diag-scale .text-xs:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { font-size: calc(12px * var(--splash-k, 1)); line-height: calc(16px * var(--splash-k, 1)); }
            .edu-diag-scale .text-sm:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { font-size: calc(14px * var(--splash-k, 1)); line-height: calc(20px * var(--splash-k, 1)); }
            .edu-diag-scale .text-base:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { font-size: calc(16px * var(--splash-k, 1)); line-height: calc(24px * var(--splash-k, 1)); }
            .edu-diag-scale .text-lg:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { font-size: calc(18px * var(--splash-k, 1)); line-height: calc(28px * var(--splash-k, 1)); }
            .edu-diag-scale .text-4xl:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { font-size: calc(36px * var(--splash-k, 1)); }
            /* AFTER the size rules on purpose: equal specificity, later wins, so an
               explicit leading-* utility keeps beating the line-height above it. */
            .edu-diag-scale .leading-relaxed:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { line-height: 1.625; }

            /* Icon + indicator boxes. */
            .edu-diag-scale .w-1\\.5:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { width: calc(6px * var(--splash-k, 1)); }
            .edu-diag-scale .h-1\\.5:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { height: calc(6px * var(--splash-k, 1)); }
            .edu-diag-scale .w-2:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { width: calc(8px * var(--splash-k, 1)); }
            .edu-diag-scale .h-2:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { height: calc(8px * var(--splash-k, 1)); }
            .edu-diag-scale .w-3:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { width: calc(12px * var(--splash-k, 1)); }
            .edu-diag-scale .h-3:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { height: calc(12px * var(--splash-k, 1)); }
            .edu-diag-scale .w-3\\.5:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { width: calc(14px * var(--splash-k, 1)); }
            .edu-diag-scale .h-3\\.5:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { height: calc(14px * var(--splash-k, 1)); }
            .edu-diag-scale .w-4:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { width: calc(16px * var(--splash-k, 1)); }
            .edu-diag-scale .h-4:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { height: calc(16px * var(--splash-k, 1)); }
            .edu-diag-scale .w-7:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { width: calc(28px * var(--splash-k, 1)); }
            .edu-diag-scale .h-7:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { height: calc(28px * var(--splash-k, 1)); }
            .edu-diag-scale .w-12:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { width: calc(48px * var(--splash-k, 1)); }
            .edu-diag-scale .h-12:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { height: calc(48px * var(--splash-k, 1)); }
            .edu-diag-scale .w-14:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { width: calc(56px * var(--splash-k, 1)); }
            .edu-diag-scale .h-14:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { height: calc(56px * var(--splash-k, 1)); }
            .edu-diag-scale .w-24:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { width: calc(96px * var(--splash-k, 1)); }
            .edu-diag-scale .h-24:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { height: calc(96px * var(--splash-k, 1)); }

            /* Padding. */
            .edu-diag-scale .p-5:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { padding: calc(20px * var(--splash-k, 1)); }
            .edu-diag-scale .px-3:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { padding-left: calc(12px * var(--splash-k, 1)); padding-right: calc(12px * var(--splash-k, 1)); }
            .edu-diag-scale .px-4:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { padding-left: calc(16px * var(--splash-k, 1)); padding-right: calc(16px * var(--splash-k, 1)); }
            .edu-diag-scale .px-5:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { padding-left: calc(20px * var(--splash-k, 1)); padding-right: calc(20px * var(--splash-k, 1)); }
            .edu-diag-scale .px-7:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { padding-left: calc(28px * var(--splash-k, 1)); padding-right: calc(28px * var(--splash-k, 1)); }
            .edu-diag-scale .py-1:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { padding-top: calc(4px * var(--splash-k, 1)); padding-bottom: calc(4px * var(--splash-k, 1)); }
            .edu-diag-scale .py-2:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { padding-top: calc(8px * var(--splash-k, 1)); padding-bottom: calc(8px * var(--splash-k, 1)); }
            .edu-diag-scale .py-2\\.5:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { padding-top: calc(10px * var(--splash-k, 1)); padding-bottom: calc(10px * var(--splash-k, 1)); }
            .edu-diag-scale .pt-1\\.5:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { padding-top: calc(6px * var(--splash-k, 1)); }

            /* Margins. */
            .edu-diag-scale .mt-0\\.5:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { margin-top: calc(2px * var(--splash-k, 1)); }
            .edu-diag-scale .mt-1:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { margin-top: calc(4px * var(--splash-k, 1)); }
            .edu-diag-scale .mt-2:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { margin-top: calc(8px * var(--splash-k, 1)); }
            .edu-diag-scale .mt-3:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { margin-top: calc(12px * var(--splash-k, 1)); }
            .edu-diag-scale .mt-6:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { margin-top: calc(24px * var(--splash-k, 1)); }
            .edu-diag-scale .mb-3:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { margin-bottom: calc(12px * var(--splash-k, 1)); }
            .edu-diag-scale .mb-6:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { margin-bottom: calc(24px * var(--splash-k, 1)); }
            .edu-diag-scale .mb-8:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { margin-bottom: calc(32px * var(--splash-k, 1)); }
            .edu-diag-scale .mb-10:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { margin-bottom: calc(40px * var(--splash-k, 1)); }
            .edu-diag-scale .mr-1:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { margin-right: calc(4px * var(--splash-k, 1)); }
            /* Same selector shape Tailwind emits for space-y-*. */
            .edu-diag-scale .space-y-1\\.5 > :not([hidden]) ~ :not([hidden]):not(#\\#):not(#\\#):not(#\\#):not(#\\#) { margin-top: calc(6px * var(--splash-k, 1)); }
            .edu-diag-scale .space-y-2 > :not([hidden]) ~ :not([hidden]):not(#\\#):not(#\\#):not(#\\#):not(#\\#) { margin-top: calc(8px * var(--splash-k, 1)); }

            /* Corner radii. ⚠️ globals.css REDEFINES the radius scale
               (--radius-xl: calc(var(--radius) * 1.4) …, --radius: 1rem), so
               rounded-xl is 22.4px here, NOT Tailwind stock 12px. Mirroring
               the same formula keeps a tenant --radius override working —
               hardcoding 12/16/24 visibly resquared every card (caught by a
               before/after pixel diff at 1920, 14.5k pixels on card edges). */
            .edu-diag-scale .rounded-xl:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { border-radius: calc(var(--radius, 1rem) * 1.4 * var(--splash-k, 1)); }
            .edu-diag-scale .rounded-2xl:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { border-radius: calc(var(--radius, 1rem) * 1.8 * var(--splash-k, 1)); }
            .edu-diag-scale .rounded-3xl:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { border-radius: calc(var(--radius, 1rem) * 2.2 * var(--splash-k, 1)); }
            /* Arbitrary-value radii are literal px, not scale tokens. */
            .edu-diag-scale .rounded-\\[2rem\\]:not(#\\#):not(#\\#):not(#\\#):not(#\\#) { border-radius: calc(32px * var(--splash-k, 1)); }
          `}</style>
          <div
            className="edu-diag-scale w-full max-w-5xl max-h-full bg-white/80 backdrop-blur-3xl rounded-[3rem] shadow-[0_20px_60px_rgb(0,0,0,0.06)] border border-white flex flex-col items-center z-10 animate-in fade-in zoom-in-95 duration-700 overflow-hidden"
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
                'calc(min(48px, max(12px, calc(var(--led-w, 1024px) * 0.04))) * var(--splash-k, 1))',
              border: '1px solid white',
              padding:
                'calc(min(32px, max(8px, calc(var(--led-w, 1024px) * 0.025))) * var(--splash-k, 1))',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              // 2026-07-31 — operator photo (HDMI dongle → Dell monitor):
              // 'center' pushed the content block DOWN whenever the WebView
              // viewport is taller than the physically visible panel
              // (overscan / 16:10-EDID dongles) — bottom rows + buttons
              // clipped off-glass while the top showed dead whitespace. No
              // CSS can detect that crop, but top-anchoring means any
              // excess height clips EMPTY SPACE below the content instead
              // of the footer buttons. Same "fit all content, never clip"
              // rule as the 2026-05-04 Goodview portrait fix above.
              justifyContent: 'flex-start',
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
            {allAssetsFailed ? (
              // 2026-07-01 — LAUNCH-SPRINT player deep pass, blank-screen
              // class (b): every item in the live playlist has failed to
              // load (bulk Supabase outage, stale signed URLs after a
              // bucket migration, a whole playlist pointing at deleted
              // assets). Rather than the screen silently flashing black
              // forever while currentIndex races through the same broken
              // items, show an honest, branded "content unavailable" card
              // — the same visual language as every other splash state,
              // never a raw error, never a blank frame. Auto-recovers the
              // instant ANY item loads again (markItemSucceeded) or the
              // manifest delivers a different item set — no operator
              // action required, this is purely a "don't lie with black"
              // fix, not a new failure mode.
              <>
                <div
                  className="w-24 h-24 rounded-[2rem] bg-gradient-to-br from-rose-100 to-rose-50 shadow-[inset_0_4px_20px_rgb(0,0,0,0.05)] flex items-center justify-center mb-6 ring-4 ring-white"
                  style={{
                    width: 'calc(min(96px, max(48px, calc(var(--led-w, 1024px) * 0.075))) * var(--splash-k, 1))',
                    height: 'calc(min(96px, max(48px, calc(var(--led-w, 1024px) * 0.075))) * var(--splash-k, 1))',
                    borderRadius: 'calc(min(32px, max(12px, calc(var(--led-w, 1024px) * 0.025))) * var(--splash-k, 1))',
                    background: 'linear-gradient(135deg, #ffe4e6 0%, #fff1f2 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 'calc(min(24px, max(8px, calc(var(--led-w, 1024px) * 0.018))) * var(--splash-k, 1))',
                    boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.05), 0 0 0 4px white',
                  }}
                >
                  <AlertTriangle className="w-12 h-12 text-rose-500" style={{ width: 'calc(min(48px, max(24px, calc(var(--led-w, 1024px) * 0.04))) * var(--splash-k, 1))', height: 'calc(min(48px, max(24px, calc(var(--led-w, 1024px) * 0.04))) * var(--splash-k, 1))', color: '#f43f5e' }} />
                </div>
                <h1
                  className="text-4xl font-extrabold text-slate-800 tracking-tight"
                  style={{ fontSize: 'calc(min(36px, max(16px, calc(var(--led-w, 1024px) * 0.028))) * var(--splash-k, 1))', fontWeight: 800, color: '#1e293b', letterSpacing: '-0.025em', margin: 0, textAlign: 'center', lineHeight: 1.15 }}
                >
                  Content Unavailable
                </h1>
                <p
                  className="text-lg font-medium text-slate-500 mt-2 mb-10 text-center"
                  style={{ fontSize: 'calc(min(18px, max(10px, calc(var(--led-w, 1024px) * 0.014))) * var(--splash-k, 1))', fontWeight: 500, color: '#64748b', marginTop: 'calc(8px * var(--splash-k, 1))', marginBottom: 'calc(min(40px, max(8px, calc(var(--led-w, 1024px) * 0.03))) * var(--splash-k, 1))', textAlign: 'center', lineHeight: 1.3 }}
                >
                  The scheduled content couldn&apos;t load. We&apos;ll keep retrying automatically — no action needed.
                </p>
              </>
            ) : phase === 'connecting' && !playbackStopped ? (
              // ⚠️ `&& !playbackStopped` (2026-08-30, field install): this
              // branch used to WIN the ternary over `playbackStopped`, so on
              // a screen stuck at "Connecting to your CMS" the remote's Back
              // key toggled playbackStopped invisibly — the operator was
              // trapped on the connecting hero with no way to reach
              // Exit/Unpair/Sync. Two brand-new units bricked this way.
              // When the operator asks for the pause surface, it wins.
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
                    width: 'calc(min(96px, max(48px, calc(var(--led-w, 1024px) * 0.075))) * var(--splash-k, 1))',
                    height: 'calc(min(96px, max(48px, calc(var(--led-w, 1024px) * 0.075))) * var(--splash-k, 1))',
                    borderRadius: 'calc(min(32px, max(12px, calc(var(--led-w, 1024px) * 0.025))) * var(--splash-k, 1))',
                    background: 'linear-gradient(135deg, #e0e7ff 0%, #eef2ff 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 'calc(min(24px, max(8px, calc(var(--led-w, 1024px) * 0.018))) * var(--splash-k, 1))',
                    boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.05), 0 0 0 4px white',
                  }}
                >
                  <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" style={{ width: 'calc(min(48px, max(24px, calc(var(--led-w, 1024px) * 0.04))) * var(--splash-k, 1))', height: 'calc(min(48px, max(24px, calc(var(--led-w, 1024px) * 0.04))) * var(--splash-k, 1))', color: '#6366f1' }} />
                </div>
                <h1
                  className="text-4xl font-extrabold text-slate-800 tracking-tight"
                  style={{ fontSize: 'calc(min(36px, max(16px, calc(var(--led-w, 1024px) * 0.028))) * var(--splash-k, 1))', fontWeight: 800, color: '#1e293b', letterSpacing: '-0.025em', margin: 0, textAlign: 'center', lineHeight: 1.15 }}
                >
                  Connecting to your CMS
                </h1>
                <p
                  className="text-lg font-medium text-slate-500 mt-2 mb-10 text-center"
                  style={{ fontSize: 'calc(min(18px, max(10px, calc(var(--led-w, 1024px) * 0.014))) * var(--splash-k, 1))', fontWeight: 500, color: '#64748b', marginTop: 'calc(8px * var(--splash-k, 1))', marginBottom: 'calc(min(40px, max(8px, calc(var(--led-w, 1024px) * 0.03))) * var(--splash-k, 1))', textAlign: 'center', lineHeight: 1.3 }}
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
                    width: 'calc(min(96px, max(48px, calc(var(--led-w, 1024px) * 0.075))) * var(--splash-k, 1))',
                    height: 'calc(min(96px, max(48px, calc(var(--led-w, 1024px) * 0.075))) * var(--splash-k, 1))',
                    borderRadius: 'calc(min(32px, max(12px, calc(var(--led-w, 1024px) * 0.025))) * var(--splash-k, 1))',
                    background: 'linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 'calc(min(24px, max(8px, calc(var(--led-w, 1024px) * 0.018))) * var(--splash-k, 1))',
                    boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.05), 0 0 0 4px white',
                  }}
                >
                  <Pause className="w-12 h-12 text-amber-500" style={{ width: 'calc(min(48px, max(24px, calc(var(--led-w, 1024px) * 0.04))) * var(--splash-k, 1))', height: 'calc(min(48px, max(24px, calc(var(--led-w, 1024px) * 0.04))) * var(--splash-k, 1))', color: '#f59e0b' }} />
                </div>
                <h1
                  className="text-4xl font-extrabold text-slate-800 tracking-tight"
                  style={{ fontSize: 'calc(min(36px, max(16px, calc(var(--led-w, 1024px) * 0.028))) * var(--splash-k, 1))', fontWeight: 800, color: '#1e293b', letterSpacing: '-0.025em', margin: 0, textAlign: 'center', lineHeight: 1.15 }}
                >
                  Playback Paused
                </h1>
                <p
                  className="text-lg font-medium text-slate-500 mt-2 mb-10 text-center"
                  style={{ fontSize: 'calc(min(18px, max(10px, calc(var(--led-w, 1024px) * 0.014))) * var(--splash-k, 1))', fontWeight: 500, color: '#64748b', marginTop: 'calc(8px * var(--splash-k, 1))', marginBottom: 'calc(min(40px, max(8px, calc(var(--led-w, 1024px) * 0.03))) * var(--splash-k, 1))', textAlign: 'center', lineHeight: 1.3 }}
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
                    width: 'calc(min(96px, max(48px, calc(var(--led-w, 1024px) * 0.075))) * var(--splash-k, 1))',
                    height: 'calc(min(96px, max(48px, calc(var(--led-w, 1024px) * 0.075))) * var(--splash-k, 1))',
                    borderRadius: 'calc(min(32px, max(12px, calc(var(--led-w, 1024px) * 0.025))) * var(--splash-k, 1))',
                    background: 'linear-gradient(135deg, #d1fae5 0%, #ecfdf5 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 'calc(min(24px, max(8px, calc(var(--led-w, 1024px) * 0.018))) * var(--splash-k, 1))',
                    boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.05), 0 0 0 4px white',
                  }}
                >
                  <CheckCircle2 className="w-12 h-12 text-emerald-500" style={{ width: 'calc(min(48px, max(24px, calc(var(--led-w, 1024px) * 0.04))) * var(--splash-k, 1))', height: 'calc(min(48px, max(24px, calc(var(--led-w, 1024px) * 0.04))) * var(--splash-k, 1))', color: '#10b981' }} />
                </div>
                <h1
                  className="text-4xl font-extrabold text-slate-800 tracking-tight"
                  style={{ fontSize: 'calc(min(36px, max(16px, calc(var(--led-w, 1024px) * 0.028))) * var(--splash-k, 1))', fontWeight: 800, color: '#1e293b', letterSpacing: '-0.025em', margin: 0, textAlign: 'center', lineHeight: 1.15 }}
                >
                  Screen Paired Successfully
                </h1>
                <p
                  className="text-lg font-medium text-slate-500 mt-2 mb-10 text-center"
                  style={{ fontSize: 'calc(min(18px, max(10px, calc(var(--led-w, 1024px) * 0.014))) * var(--splash-k, 1))', fontWeight: 500, color: '#64748b', marginTop: 'calc(8px * var(--splash-k, 1))', marginBottom: 'calc(min(40px, max(8px, calc(var(--led-w, 1024px) * 0.03))) * var(--splash-k, 1))', textAlign: 'center', lineHeight: 1.3 }}
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
            <div className="w-full max-w-4xl mb-6" style={{ maxWidth: 'calc(896px * var(--splash-k, 1))' }}>
              <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                {(() => {
                  // Hydration guard: window/navigator reads gate on
                  // bootMounted so the server pass and the FIRST client
                  // pass render identical text (see bootMounted above).
                  const qp = bootMounted ? new URLSearchParams(window.location.search) : null;
                  const w = qp ? (parseInt(qp.get('w') || '0', 10) || window.screen.width) : 0;
                  const h = qp ? (parseInt(qp.get('h') || '0', 10) || window.screen.height) : 0;
                  const apkV = qp?.get('v') || null;
                  const ua = bootMounted && typeof navigator !== 'undefined' ? navigator.userAgent : '';
                  const platform = !bootMounted
                    ? ''
                    : apkV
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
                  const host = bootMounted ? window.location.hostname : '';
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
            <div className="w-full max-w-4xl mb-8 grid grid-cols-1 md:grid-cols-2 gap-4" style={{ maxWidth: 'calc(896px * var(--splash-k, 1))' }}>
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
              // Hydration guard (see bootMounted): identical server/first-
              // client render; the ?v= read fills in a frame later.
              const apkV = bootMounted ? new URLSearchParams(window.location.search).get('v') : null;
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
                    // 2026-08-14 — terminal state of a healthy check. The APK
                    // used to return silently here, so a pushed-but-already-
                    // current kiosk sat on "Checking for update…" until the
                    // 8-min auto-clear. Say what actually happened instead.
                    case 'UP_TO_DATE':
                      stage = { emoji: '✅', label: realMsg || 'Already up to date — nothing to install.' };
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
                // UP_TO_DATE is terminal too — "in progress" over a
                // "nothing to install" sublabel read as a hang (2026-08-25).
                const isCurrent = realState === 'UP_TO_DATE';
                const bg = isError ? 'bg-amber-50 border-amber-200' :
                           (isDone || isCurrent) ? 'bg-emerald-50 border-emerald-200' :
                                     'bg-indigo-50 border-indigo-200';
                const titleColor = isError ? 'text-amber-900' :
                                   (isDone || isCurrent) ? 'text-emerald-900' :
                                             'text-indigo-900';
                const subColor   = isError ? 'text-amber-700' :
                                   (isDone || isCurrent) ? 'text-emerald-700' :
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
                  <div className={`w-full max-w-3xl mb-8 rounded-2xl border p-5 ${bg}`} style={{ maxWidth: 'calc(768px * var(--splash-k, 1))' }}>
                    <div className="flex items-center gap-4">
                      <span className="text-4xl shrink-0">{stage.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className={`text-base font-bold ${titleColor}`}>
                          {isDone ? 'Update complete' : isCurrent ? 'Already up to date' : isError ? 'Update issue' : 'Update in progress'}
                        </div>
                        <div className={`text-sm mt-0.5 ${subColor}`}>{stage.label}</div>
                      </div>
                      {isPermissionError && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            // AND-002 — fire-and-forget; true means a
                            // transport took it, false means no APK and
                            // we fall through to the intent: URL below.
                            //
                            // NOTE: this button is a NON-device-owner
                            // affordance (it grants Manager "install
                            // unknown apps", which a device owner never
                            // needs). We only ever enter lock task mode
                            // WHEN Manager is device owner, so the OS
                            // refusing to launch Settings from a locked
                            // task cannot strand this path in practice.
                            // See LockTaskController's header.
                            if (nativeFire('openSettingsForManager')) return;
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
                <div className="w-full max-w-3xl mb-8 rounded-2xl bg-amber-50 border border-amber-200 p-5 flex items-center gap-4" style={{ maxWidth: 'calc(768px * var(--splash-k, 1))' }}>
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
                      // AND-002 — sync probe so the overlay copy is right
                      // on this tick; the call itself is fire-and-forget.
                      const bridgeAvailable = nativeHas('checkForUpdates');
                      setOtaProgress({ startedAt: Date.now(), bridgeAvailable });
                      if (bridgeAvailable) {
                        // 2026-08-25 — the operator is standing at the
                        // panel pressing this. See fireUserUpdateCheck.
                        fireUserUpdateCheck();
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
                margin: calc(4px * var(--splash-k, 1)) calc(7px * var(--splash-k, 1)) !important;
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
                outline: calc(3px * var(--splash-k, 1)) solid #fde047 !important;
                outline-offset: calc(3px * var(--splash-k, 1)) !important;
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
                gap: 'calc(14px * var(--splash-k, 1))',
                marginTop: 'calc(24px * var(--splash-k, 1))',
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
                      // AND-002 — fire-and-forget; never throws, so
                      // Resume always resumes.
                      nativeFire('checkForUpdates');
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
                  <button
                    // 2026-08-24 — autoFocus on the IDLE-state primary action,
                    // mirroring what the paused branch above has had since
                    // 2026-05-04.
                    //
                    // THE BUG THIS FIXES. Only `Resume` (the PAUSED branch)
                    // ever got autoFocus. In the idle / just-paired state —
                    // which is where a screen sits for its entire first
                    // install, before any schedule exists — nothing claimed
                    // focus at all. So a remote's first D-pad press landed
                    // wherever the DOM happened to start, which is the
                    // `overflow-y-auto` info column ABOVE this footer, and the
                    // operator had to scroll the whole info block before
                    // reaching any action. Operator, on two freshly-installed
                    // screens: "i get stuck in the info block and cant
                    // navigate to the actual buttons anymore to trigger a
                    // refresh or go back... both seem like they should start
                    // on the button".
                    //
                    // On a panel where the info column overflows far enough,
                    // it is not merely tedious, it is a DEAD END — the footer
                    // is flex-shrink-0 OUTSIDE the scroller, so D-pad
                    // navigation inside a tall scroll region can fail to ever
                    // hand focus onward. That is why the same build behaved
                    // differently on two screens: the one whose layout was
                    // squeezed (a portrait panel being forced landscape) could
                    // not get out, while the taller one merely had to scroll.
                    //
                    // Safe against the sibling autoFocus above: the two live
                    // in opposite arms of the `playbackStopped ?` ternary, so
                    // exactly one is ever mounted.
                    autoFocus
                    onClick={async (e) => {
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

      {/* Frame-locked sync diagnostics HUD — opt-in via ?synchud=1. Film
          two screens side-by-side: the sweep bar + second flash make skew
          directly visible. */}
      {syncHudOn && (
        <SyncHud
          clockRef={syncClockRef}
          posRef={syncPosRef}
          activeRef={syncActiveRef}
          cfgRef={syncConfigRef}
          statsRef={syncStatsRef}
        />
      )}

      {/* Tier-3 camera calibration — remotely-armed synced flash pattern.
          Auto-expires; never shown during an emergency. */}
      {calFlashUntil !== null && !activeEmergency && (
        <CalibrationFlashOverlay
          clockRef={syncClockRef}
          cfgRef={syncConfigRef}
          coarseOffsetRef={serverClockOffsetRef}
        />
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
      {/* 2026-09-01 — the update prompt reaches MEDIA playlists too (see
          updatePromptNode's header: it was template-branch-only). */}
      {updatePromptNode}
      {connectivityToast}
      {unsignedWsBanner}
        {/* Main return: the diagnostics card (paused / connecting / no content /
            all-assets-failed) IS the operator surface; live playback is not. */}
        {renderRepairRequiredChip(!(currentItem && !playbackStopped && !allAssetsFailed) || showOverlay)}
      {canvasEditor}
      {softBlankOverlay}
      {/* Back-key discoverability on the post-pair "Connecting" hero — the
          escape surface itself is the playbackStopped branch above (its
          ternary now beats phase === 'connecting'; 2026-08-30 field fix). */}
      {phase === 'connecting' ? remoteBackHint : null}
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
          // P0-2 (life-safety) — paired kiosks carry a device JWT, not a
          // session cookie. Passing it makes the overlay poll the
          // device-authed /emergency/messages endpoint with a Bearer
          // token (the user-session /emergency/status 401s for devices,
          // and the old credentials:'include' poll silently swallowed
          // it). screenId is passed for completeness; the server reads
          // the screen id from the token's verified `sub`.
          screenId={screenId}
          deviceToken={getDeviceToken()}
          // Deep-audit F2b (2026-08-30) — the second, manifest-independent
          // leg for tenant-wide alerts: the overlay's own poll already
          // carries the tenant's live emergencyStatus; when it says ACTIVE
          // and this page is NOT displaying an alert, force an immediate
          // (preempting) reconcile instead of waiting out a slow poll.
          // Stable useCallback — see its definition for why.
          onTenantEmergencyHint={onTenantEmergencyHint}
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
          wiring={manifestWiring || undefined}
          consoleProfile={manifestConsoleProfile}
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
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] max-w-2xl px-6 py-4 rounded-2xl bg-amber-500 text-amber-950 shadow-2xl border border-amber-300 flex items-center [&>*+*]:ml-3">
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
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] max-w-2xl px-6 py-4 rounded-2xl bg-indigo-600 text-white shadow-2xl border border-indigo-400/40 flex items-center [&>*+*]:ml-4">
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
