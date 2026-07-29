"use client";

import { MonitorPlay, Plus, Loader2, Trash2, MapPin, MonitorCheck, Wifi, WifiOff, X, Smartphone, Monitor, Laptop, Tv, Globe, Clock, ExternalLink, QrCode, Map as MapIcon, List as ListIcon, Download, CheckCircle2, Settings, RefreshCw, Tag, Copy, Check, AlertCircle, Radio, Camera } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useScreenGroups, useCreateScreenGroup, useDeleteScreenGroup, useUpdateScreenGroup, useDeleteScreen, useUpdateScreen, useScreens, useUpdateScreenLocation, useForceApkUpdate, useLatestPlayerVersion, useRefreshWeb, useCanaryRollout, useSetScreenOrientation, useSetScreenCanvas, useHardwareCatalog, useSetScreenHardwareModel, useSetScreenConsoleProfile, useSetScreenSyncOffset, useSyncTrimSuggestions } from '@/hooks/use-api';
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ScreenMapClient } from '@/components/screens/ScreenMapClient';
import { ReturnToFleetBanner } from '@/components/screens/ReturnToFleetBanner';
import { ScreenLocationModal } from '@/components/screens/ScreenLocationModal';
import { FloorPlansView } from '@/components/screens/FloorPlansView';
// 2026-05-27 — PairScreenHardwareStep removed from the pair modal. The
// player APK already reports its hardware (Build.MANUFACTURER + MODEL)
// — operator should never have to type it. The step + its EP6N upsell
// cards moved to the per-screen settings page where they belong.
import { apiFetch } from '@/lib/api-client';
import { useUIStore } from '@/store/ui-store';
import { useParams, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { appConfirm } from '@/components/ui/app-dialog';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import { clampPopoverAnchor } from '@/lib/clamp-popover-anchor';

/**
 * Derive "portrait" | "landscape" from a free-text resolution string
 * like "1920x1080" or "1080x1920". Defaults to landscape when unknown
 * so the preview still renders (just not in the right orientation).
 */
function orientationFromResolution(res?: string | null): 'portrait' | 'landscape' {
  if (!res) return 'landscape';
  const m = res.match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/i);
  if (!m) return 'landscape';
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  if (!w || !h) return 'landscape';
  return h > w ? 'portrait' : 'landscape';
}

/**
 * Compact "time ago" formatter, e.g. "12s", "5m", "3h", "2d". Used on the
 * Screens list to replace the old "8:42:11 AM" (time-only, no date). The
 * caller is expected to also set a full-datetime tooltip so nothing is
 * lost — the chip is for at-a-glance, the tooltip is for forensics.
 */
function timeAgo(ts: string | number | Date): string {
  const then = typeof ts === 'string' || typeof ts === 'number' ? new Date(ts) : ts;
  const sec = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  if (sec < 45) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  // Older than a week: show MMM dd.
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Full human datetime for the tooltip, e.g. "Apr 23, 2026 2:13:04 PM".
 */
function fullDateTime(ts: string | number | Date): string {
  const then = typeof ts === 'string' || typeof ts === 'number' ? new Date(ts) : ts;
  return then.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
}

// OS-shape icon colored by CURRENT screen status (not OS type). Previously
// we used emerald for Android, sky for Windows, amber for Linux — which
// meant a Windows laptop showed a blue icon while its status pill was
// green, and a Linux kiosk showed a red-ish amber icon while the status
// dot glowed green. Operators read the color mismatch as "something's
// wrong". Making icon color mirror liveStatus kills the confusion: green
// dot → green icon, slate dot → slate icon.
function OsIcon({ os, status }: { os?: string; status?: string }) {
  const colorCls =
    status === 'ONLINE' ? 'text-emerald-500'
    : status === 'PENDING' ? 'text-amber-500'
    : 'text-slate-400';
  const cls = `w-4 h-4 ${colorCls}`;
  if (!os) return <Monitor className={cls} />;
  const l = os.toLowerCase();
  if (l.includes('android')) return <Smartphone className={cls} />;
  if (l.includes('ios') || l.includes('mac')) return <Laptop className={cls} />;
  if (l.includes('windows')) return <Monitor className={cls} />;
  if (l.includes('linux') || l.includes('chrome os')) return <Tv className={cls} />;
  return <Monitor className={cls} />;
}

/**
 * Per-screen settings popover — anchored off the gear button in each
 * screen row. First occupant is "Push APK update" with real feedback
 * about whether the push actually took effect; the component is
 * structured so more settings (restart, orientation, brightness, cache
 * clear, etc.) can slot in as menu items without reshuffling layout.
 *
 * Feedback logic:
 *   - just clicked Push       → "Waiting for kiosk response…" (spinner)
 *   - kiosk reported new ver  → "Updated to vN.M.P ✓" (emerald)
 *   - >90s with no version    → "No response — check Install
 *                                 permissions on the device"
 *   - currently up to date    → quiet success chip
 *
 * Built as a portal-free popover so it stays anchored to the row even
 * when the Screens list scrolls.
 */
/**
 * Platform-aware player chip on each screen card. Operator
 * (2026-04-27): "give a little android icon instead of the word
 * player... if its a browser do a browser icon based on what
 * browser type it is."
 *
 * Detection priority:
 *   1. osInfo === 'Android'  → Android APK player (mascot logo,
 *      grey chip), shows reported version or "—" when not yet.
 *   2. browserInfo present   → Browser player. Pick a brand-
 *      specific icon (Chrome / Firefox / Safari / Edge) when the
 *      string matches; fall back to lucide Globe for "Other".
 *   3. Nothing reported      → grey "—" chip.
 */
function PlayerKindChip({ screen }: { screen: any }) {
  // Strip the `-debug` suffix from displayed version. Debug builds set
  // `versionNameSuffix = "-debug"` in build.gradle.kts so the kiosk
  // reports e.g. "1.0.12-debug". The suffix is useful for crash logs
  // but visually noisy in the dashboard. Keep raw value in title for
  // forensics, show the clean version in the pill.
  const rawV: string | null = screen?.playerVersion ?? null;
  const v = rawV ? rawV.replace(/-debug$/, '') : null;
  const at: string | null = screen?.playerVersionAt ?? null;
  // v1.0.13 — Manager APK version (Player heartbeats &mv= when
  // Manager is installed). Renders as a smaller secondary chip.
  const rawMv: string | null = screen?.managerVersion ?? null;
  const mv = rawMv ? rawMv.replace(/-debug$/, '') : null;
  const mvAt: string | null = screen?.managerVersionAt ?? null;
  const osInfo: string = (screen?.osInfo || '').toLowerCase();
  const browser: string = (screen?.browserInfo || '').toLowerCase();

  const isAndroidApk = osInfo.includes('android');
  const baseClass = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide';

  if (isAndroidApk) {
    return (
      <span className="inline-flex items-center gap-1.5 flex-wrap">
        <span
          className={`${baseClass} ${v
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : 'bg-amber-50 text-amber-700 border border-amber-200'}`}
          title={v
            ? `Android Player v${v}${at ? ` · reported ${fullDateTime(at)}` : ''}`
            : 'Android Player — version not reported yet (next heartbeat ~30s)'}
        >
          {/* Official Android bot mascot — full simpleicons.org path,
              recognizable at 12px. The signature half-circle head with
              antennae + two eye dots reads as Android instantly. */}
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5" aria-hidden>
            <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-1.0019 0-.5511.4486-.9993.9993-.9993.5511 0 .9993.4486.9993.9993.0001.5533-.4482 1.0019-.9993 1.0019m-11.046 0c-.5511 0-.9993-.4486-.9993-1.0019 0-.5511.4486-.9993.9993-.9993.5511 0 .9993.4486.9993.9993 0 .5533-.4482 1.0019-.9993 1.0019m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1521-.5676.416.416 0 00-.5676.1521l-2.0223 3.503C15.5902 8.2439 13.8533 7.8508 12 7.8508s-3.5902.3931-5.1357 1.0993L4.841 5.4471a.4161.4161 0 00-.5676-.1521.4161.4161 0 00-.1521.5676l1.9973 3.4592C2.6889 11.1867.3432 14.6589 0 18.761h24c-.3432-4.1021-2.6889-7.5743-6.1185-9.4396"/>
          </svg>
          {v ? `v${v}` : '—'}
        </span>
        {/* Manager version chip — only renders when Manager is
            installed. Smaller + slate styling so it visually
            subordinates to the Player chip. Shield icon reads as
            "guardian" (Manager is the device-admin / OTA supervisor). */}
        {mv && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide bg-slate-100 text-slate-600 border border-slate-200"
            title={`EduCMS Manager v${mv}${mvAt ? ` · reported ${fullDateTime(mvAt)}` : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3" aria-hidden>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            mgr v{mv}
          </span>
        )}
      </span>
    );
  }

  // Browser player — figure out which one. Order matters; "Edge"
  // also includes "Chrome" in modern Chromium-Edge UA strings, so
  // check Edge first.
  let browserName = 'Browser';
  let icon: React.ReactNode = <Globe className="w-3 h-3" aria-hidden />;
  if (browser.includes('edg')) {
    browserName = 'Edge';
    icon = (
      // Microsoft Edge swirl
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3" aria-hidden>
        <path d="M21.86 14.32a8.46 8.46 0 01-1.39 2.83 9.42 9.42 0 01-7.55 3.71 9.43 9.43 0 01-6.34-2.5 9.5 9.5 0 003.5.66 8.5 8.5 0 008.43-7.4 6 6 0 00-2.04-4.66A8.5 8.5 0 0024 8a8.5 8.5 0 01-2.14 6.32zM5.6 17.97a8.7 8.7 0 01-3.6-7.3A8.5 8.5 0 0112 2a8.5 8.5 0 018.5 8.5 4.5 4.5 0 01-4.5 4.5c-2 0-3.5-1-3.5-3 0-2 2-2.5 2-4.5 0-2-1.5-3-3-3-3 0-5.5 3-5.5 6.5 0 2.5 1.5 5 1.5 5L5.6 18z"/>
      </svg>
    );
  } else if (browser.includes('firefox') || browser.includes('fxios')) {
    browserName = 'Firefox';
    icon = (
      // Firefox-ish flame
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3" aria-hidden>
        <path d="M12 2c-1 2-3 2-4 4 0-2 1-3 1-3-3 1-5 4-5 8 0 5 4 9 9 9s9-4 9-9c0-3-1-5-3-7 0 2-1 3-2 3 0-2-2-4-5-5zm-1 8c2 0 3 1 3 3s-1 3-3 3-3-1-3-3 1-3 3-3z"/>
      </svg>
    );
  } else if (browser.includes('chrome') || browser.includes('crios') || browser.includes('chromium')) {
    browserName = 'Chrome';
    icon = (
      // Chrome wheel — outer ring + 3-color spokes simplified to a
      // single-color glyph that reads as Chrome at 12px.
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
        <line x1="21.17" y1="8" x2="12" y2="8" />
        <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
        <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
      </svg>
    );
  } else if (browser.includes('safari')) {
    browserName = 'Safari';
    icon = (
      // Compass-ish Safari mark
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  return (
    <span
      className={`${baseClass} bg-sky-50 text-sky-700 border border-sky-200`}
      title={`Browser player · ${screen?.browserInfo || browserName}${at ? ` · last seen ${fullDateTime(at)}` : ''}`}
    >
      {icon}
      {browserName}
    </span>
  );
}

/**
 * Device fingerprint row — diagnostic field shown inside the gear popover.
 *
 * Why this exists (2026-04-28): during a live OTA incident the operator had
 * no way to retrieve the kiosk's fingerprint without opening DevTools and
 * reading the /api/v1/screens response JSON. The fingerprint is the only
 * DB key that ties a support ticket back to a specific kiosk row, so it
 * needs to be one click away from the screens list.
 *
 * Copy-to-clipboard pattern (not select-and-copy) because the popover is
 * 256px wide and the fingerprint is 30+ chars; manual selection at that
 * width is fiddly. Click → check icon flash → resets after 1.6s.
 */
// Phase B closeout — top-of-page fleet summary. 4 KPI tiles computed
// off the already-loaded screens array (zero extra network).
//
// Tiles:
//   TOTAL        all paired screens for this tenant
//   ONLINE       Screen.status === 'ONLINE'
//   OFFLINE      everything else (PENDING / unpaired excluded)
//   EMERGENCY    screens whose tenant.emergencyStatus is ACTIVE
//                OR which have an active ScreenEmergencyOverride
//                (we approximate using the per-screen `emergencyStatus`
//                flag in the screens payload; the canonical fan-out
//                lives in the manifest endpoint)
//   CANARY       only renders when the tenant has canaryFleetPercent
//                < 100 — shows live install/error counts so the admin
//                sees rollout progress without clicking through.
//
// Per the operator note "don't add new pages" — this enhances the
// existing dashboard rather than a separate fleet console.
function FleetSummaryStrip({ screens }: { screens: any[] }) {
  const t = useTranslations();
  const canary = useCanaryRollout();
  const total = screens.length;
  const online = screens.filter((s) => s.status === 'ONLINE').length;
  const offline = total - online;
  const emergencyActive = screens.filter(
    (s) => s.emergencyStatus === 'ACTIVE' || s.tenant?.emergencyStatus === 'ACTIVE',
  ).length;
  const canaryActive = (canary.data?.percent ?? 100) < 100;

  // No content yet? Render nothing — avoids the empty-state-on-empty-state
  // visual stacking when a tenant has just signed up and has 0 screens.
  if (total === 0 && !canaryActive) return null;

  const tile = (label: string, value: number | string, tone: 'ok' | 'warn' | 'alert' | 'neutral' = 'neutral') => {
    const palette = {
      ok:      { bg: 'bg-emerald-50',  ring: 'ring-emerald-100',  text: 'text-emerald-700',  num: 'text-emerald-700' },
      warn:    { bg: 'bg-amber-50',    ring: 'ring-amber-100',    text: 'text-amber-700',    num: 'text-amber-700' },
      alert:   { bg: 'bg-red-50',      ring: 'ring-red-100',      text: 'text-red-700',      num: 'text-red-700' },
      neutral: { bg: 'bg-slate-50',    ring: 'ring-slate-100',    text: 'text-slate-600',    num: 'text-slate-800' },
    }[tone];
    return (
      <div className={`${palette.bg} ring-1 ${palette.ring} rounded-2xl px-5 py-4 flex-1 min-w-[120px]`}>
        <div className={`text-[10px] font-bold uppercase tracking-wider ${palette.text}`}>{label}</div>
        <div className={`text-2xl font-black ${palette.num} mt-1`}>{value}</div>
      </div>
    );
  };

  return (
    <div className="flex flex-wrap gap-3">
      {tile(t('screens.total'), total, 'neutral')}
      {tile(t('screens.online'), online, online === total && total > 0 ? 'ok' : 'neutral')}
      {tile(t('screens.offline'), offline, offline > 0 ? 'warn' : 'neutral')}
      {tile(t('screens.emergency'), emergencyActive, emergencyActive > 0 ? 'alert' : 'neutral')}
      {canaryActive && (
        <CanaryRolloutTile canary={canary.data!} />
      )}
    </div>
  );
}

// Phase B closeout — canary rollout progress tile. Renders next to the
// summary counters only when canaryFleetPercent < 100, so the dashboard
// stays clean during normal "full rollout" state and lights up exactly
// when a rollout is in flight.
//
// Shows: cohort %, soak time remaining, ERROR count from the cohort
// (which is what halts the auto-promote service — operator should see
// this number FAST). Click jumps to /settings where the percent can be
// adjusted or promoted-to-100 manually.
function CanaryRolloutTile({ canary }: { canary: { percent: number; setAt: string | null; autoPromote: boolean; soakHours: number } }) {
  const router = useRouter();
  const params = useParams();
  const schoolId = params?.schoolId as string;
  const setAt = canary.setAt ? new Date(canary.setAt) : null;
  const elapsedMs = setAt ? Date.now() - setAt.getTime() : 0;
  const remainingMs = setAt && canary.soakHours
    ? Math.max(0, canary.soakHours * 3600_000 - elapsedMs)
    : 0;
  const remainLabel = remainingMs > 3600_000
    ? `${Math.ceil(remainingMs / 3600_000)}h left`
    : remainingMs > 0
      ? `${Math.ceil(remainingMs / 60_000)}m left`
      : 'soak elapsed';

  return (
    <button
      type="button"
      onClick={() => router.push(`/${schoolId}/settings`)}
      className="bg-amber-50 ring-1 ring-amber-100 rounded-2xl px-5 py-4 flex-1 min-w-[180px] text-left hover:bg-amber-100/60 transition-colors"
      title={canary.autoPromote ? `Auto-promote when soak elapses (${canary.soakHours}h)` : 'Manual promote mode'}
    >
      <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
        <RefreshCw className="w-3 h-3" /> Canary rollout
      </div>
      <div className="text-2xl font-black text-amber-700 mt-1">{canary.percent}%</div>
      <div className="text-[10px] text-amber-700/70 mt-1 font-semibold">
        {remainLabel}{canary.autoPromote ? ' · auto-promote' : ' · manual'}
      </div>
    </button>
  );
}

// Phase B closeout — per-screen diagnostics block inside the settings
// popover. Rolls up every field already on the Screen payload into a
// compact 2-column grid:
//
//   OS / browser         resolution
//   APK + reported-at    Manager + reported-at
//   Cache state          Last OTA state + message
//   Address / location   Latest fingerprint
//
// Operators previously had to inspect the React Query devtools or curl
// /api/v1/screens/status/<fp> to see this. Now it's one click in the
// gear popover next to the screen row. No new endpoint — purely a
// presentation enhancement.
function ScreenDiagnostics({ screen, groupSyncLocked }: { screen: any; groupSyncLocked?: boolean }) {
  const t = useTranslations();
  // 2026-05-24 — per-screen orientation lock control. Lives inside the
  // diagnostics drawer (right next to Resolution) so operators with a
  // sideways-mounted Goodview / Taurus screen can flip orientation in
  // one click without climbing a ladder.
  const setOrientation = useSetScreenOrientation();
  const setCanvas = useSetScreenCanvas();
  // 2026-07-28 — frame-locked sync latency trim (rendered only when the
  // parent group has syncMode='locked'; see groupSyncLocked prop).
  const setSyncOffset = useSetScreenSyncOffset();
  // Tier-2: fleet-learned starting trim for this screen's hardware model.
  const trimSuggestions = useSyncTrimSuggestions(!!groupSyncLocked);
  const modelSuggestion = (() => {
    if (!groupSyncLocked || !screen?.hardwareModel) return null;
    const s = trimSuggestions.data?.suggestions?.find(
      (x) => x.hardwareModel === screen.hardwareModel,
    );
    // Only worth surfacing when the fleet actually learned something
    // (≥3 samples, ≥10ms magnitude) and this screen is still untrimmed.
    if (!s || s.sampleCount < 3 || Math.abs(s.medianTrimMs) < 10) return null;
    if ((screen?.syncOffsetMs ?? 0) !== 0) return null;
    return s;
  })();
  const currentOrientation: string = screen?.orientation || 'LANDSCAPE';
  // 2026-05-26 — LED canvas (N-panel daisy-chain). Operator clicks a
  // panel count; we resolve to canvasW = 320 × N, canvasH = 1080.
  // null = clear override (uses the controller's native viewport,
  // fine for standard landscape kiosks).
  const currentCanvasW: number | null = typeof screen?.canvasW === 'number' ? screen.canvasW : null;
  const currentCanvasH: number | null = typeof screen?.canvasH === 'number' ? screen.canvasH : null;
  const currentPanelN: number | null =
    currentCanvasW && currentCanvasH === 1080 && currentCanvasW % 320 === 0
      ? currentCanvasW / 320
      : null;
  // 2026-05-27 — content tile-repeat UI picker removed from this card
  // (operator wanted score-repeat in the Ribbon Content panel as the
  // single source of truth). The `repeats` field stays in the data
  // model for the player's tile-rendering path — see player/page.tsx.
  const cache: any = screen?.lastCacheReport || null;
  const cacheLine = cache
    ? `${cache.totalAssets ?? '?'} assets · ${cache.totalBytes != null ? Math.round(cache.totalBytes / 1024 / 1024) + ' MB' : '? size'}`
    : 'not reported';
  const emergencyLine = cache?.emergency?.count != null
    ? `${cache.emergency.count} emergency assets`
    : 'no emergency report';

  const otaState: string | null = screen?.lastOtaState ?? null;
  const otaMsg: string | null = screen?.lastOtaMessage ?? null;
  const otaAt: string | null = screen?.lastOtaAt ?? null;
  const otaProg: number | null = screen?.lastOtaProgress ?? null;

  const playerV: string | null = screen?.playerVersion ?? null;
  const playerVAt: string | null = screen?.playerVersionAt ?? null;
  const managerV: string | null = screen?.managerVersion ?? null;
  const managerVAt: string | null = screen?.managerVersionAt ?? null;

  const row = (label: string, value: React.ReactNode, mono = false) => (
    <div className="flex flex-col min-w-0">
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`text-[11px] text-slate-700 truncate ${mono ? 'font-mono' : 'font-medium'}`} title={typeof value === 'string' ? value : undefined}>
        {value || <span className="text-slate-300">—</span>}
      </div>
    </div>
  );

  return (
    <div className="px-3.5 py-3 border-t border-slate-100 bg-slate-50/40">
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-2">
        Diagnostics
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {row('OS', screen?.osInfo)}
        {row('Resolution', screen?.resolution)}
        {/* 2026-05-24 — interactive orientation control. Asks the API
            to flip LANDSCAPE / PORTRAIT / AUTO; signed WS broadcast +
            manifest poll converge the kiosk within ~10s. */}
        <div className="flex flex-col min-w-0">
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{t('screens.orientation')}</div>
          <select
            value={currentOrientation}
            disabled={setOrientation.isPending}
            onChange={(e) => {
              const next = e.target.value as 'LANDSCAPE' | 'PORTRAIT' | 'AUTO';
              if (next === currentOrientation) return;
              setOrientation.mutate({ id: screen.id, orientation: next });
            }}
            className="text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded px-1.5 py-0.5 mt-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Flip the kiosk between landscape, portrait, or sensor-decides (AUTO). Takes effect on the device within ~10s via signed WS broadcast."
          >
            <option value="LANDSCAPE">{t('screens.landscape')}</option>
            <option value="PORTRAIT">{t('screens.portrait')}</option>
            <option value="AUTO">{t('screens.autoSensor')}</option>
          </select>
        </div>
        {/* 2026-05-26 — LED canvas (daisy-chained 320×1080 panels).
            Operator: "put it on the screen settings from the dashboard
            itself". Each click = 1-panel-step. Signed-WS pushes the
            new canvas to the kiosk in ~150ms; on-screen splash +
            content immediately resize to fit. "Off" clears the
            override (back to controller's native viewport). */}
        <div className="flex flex-col min-w-0 col-span-2">
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
            LED canvas (320×1080 panels)
          </div>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            <button
              type="button"
              onClick={(e) => {
                // 2026-05-26 — operator: "its stuck on 1 now and i cant
                // switch it to anything else". Zero PUT requests in the
                // audit log despite the operator clicking. Suspected
                // setCanvas.isPending stuck true (hung first request)
                // OR document-mousedown outside-handler in the popover
                // closing the menu before the React click fires.
                // Defenses:
                //   - stopPropagation so the popover's document-mouseup
                //     outside-handler can't see this and close the
                //     menu mid-click
                //   - Dropped `disabled={setCanvas.isPending}` — relying
                //     on React Query's internal queueing instead
                e.stopPropagation();
                if (currentCanvasW === null && currentCanvasH === null) return;
                // eslint-disable-next-line no-console
                console.log('[LED canvas] clicking Off', { screenId: screen.id, current: { w: currentCanvasW, h: currentCanvasH } });
                setCanvas.mutate({ id: screen.id, canvasW: null, canvasH: null });
              }}
              className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                currentPanelN === null && currentCanvasW === null
                  ? 'bg-slate-700 text-white border-slate-700'
                  : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              }`}
              title="Clear the LED canvas override. Player uses the controller's native viewport (fine for landscape kiosks)."
            >
              Off
            </button>
            {[1, 2, 3, 4, 5, 6].map((n) => {
              const w = 320 * n;
              const h = 1080;
              const active = currentPanelN === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (active) return;
                    // eslint-disable-next-line no-console
                    console.log('[LED canvas] clicking', n, { screenId: screen.id, w, h });
                    setCanvas.mutate({ id: screen.id, canvasW: w, canvasH: h });
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                    active
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-indigo-50 hover:border-indigo-200'
                  }`}
                  title={`${n} panel${n === 1 ? '' : 's'} = ${w}×${h}`}
                >
                  {n}
                </button>
              );
            })}
            <span className="text-[10px] text-slate-400 ml-1 font-mono">
              {currentCanvasW && currentCanvasH
                ? `${currentCanvasW}×${currentCanvasH}`
                : 'native'}
              {setCanvas.isPending && ' · saving…'}
              {setCanvas.isError && ' · error'}
            </span>
          </div>
        </div>
        {/* 2026-07-28 — frame-locked sync: per-screen latency trim. Only
            rendered when this screen's group has sync ON. Mixed display
            models add different FIXED pipeline delays (TV motion smoothing
            alone is 30-80ms) that no clock can see — this is the AVR
            lip-sync knob: point a phone camera at both screens, nudge
            until the flips align. Positive = this screen flips EARLIER
            (compensates a slow display). Same stopPropagation +
            no-disabled-on-pending patterns as the canvas buttons above. */}
        {groupSyncLocked && (
          <div className="col-span-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Sync trim</div>
            <div className="flex items-center flex-wrap gap-1">
              {[-25, -5, +5, +25].map((step) => (
                <button
                  key={step}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const cur = typeof screen?.syncOffsetMs === 'number' ? screen.syncOffsetMs : 0;
                    const next = Math.max(-2000, Math.min(2000, cur + step));
                    if (next !== cur) setSyncOffset.mutate({ id: screen.id, syncOffsetMs: next });
                  }}
                  className="px-2 py-0.5 rounded text-[10px] font-bold border bg-white text-slate-600 border-slate-200 hover:bg-indigo-50 hover:border-indigo-200 transition-colors"
                  title={`${step > 0 ? 'Flip this screen ' + step + 'ms earlier (display is slow)' : 'Flip this screen ' + -step + 'ms later (display is fast)'}`}
                >
                  {step > 0 ? `+${step}` : step}
                </button>
              ))}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if ((screen?.syncOffsetMs ?? 0) !== 0) setSyncOffset.mutate({ id: screen.id, syncOffsetMs: null });
                }}
                className="px-2 py-0.5 rounded text-[10px] font-bold border bg-white text-slate-500 border-slate-200 hover:bg-slate-50 transition-colors"
                title="Clear the trim back to 0ms"
              >
                Reset
              </button>
              <span className="text-[10px] text-slate-400 ml-1 font-mono">
                {(screen?.syncOffsetMs ?? 0)}ms
                {setSyncOffset.isPending && ' · saving…'}
                {setSyncOffset.isError && ' · error'}
              </span>
            </div>
            {/* Tier-2 — fleet-learned preset: other venues already trimmed
                this display model; offer their median as a one-tap start. */}
            {modelSuggestion && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSyncOffset.mutate({ id: screen.id, syncOffsetMs: modelSuggestion.medianTrimMs });
                }}
                className="mt-1 px-2 py-0.5 rounded text-[10px] font-bold border bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100 transition-colors"
                title={`Learned across the fleet: ${modelSuggestion.sampleCount} screens of this model (${screen.hardwareModel}) run a median trim of ${modelSuggestion.medianTrimMs > 0 ? '+' : ''}${modelSuggestion.medianTrimMs}ms. Apply it as a starting point, then fine-tune by eye or camera.`}
              >
                Model preset: {modelSuggestion.medianTrimMs > 0 ? '+' : ''}{modelSuggestion.medianTrimMs}ms · Apply
              </button>
            )}
          </div>
        )}
        {/* 2026-06-26 — Removed the "Image fit" (Fit/Fill/Stretch) control.
            Operator: don't add another setting to the screen menu — the
            player auto-fits (object-fit:fill / stretch) every image; a
            correctly-sized image looks perfect, a wrong one stretches. No
            per-screen toggle. */}
        {/* 2026-05-27 — Removed "Content tile-repeat" picker from screen
            settings. Operator: "we built the repeat of the score right
            into the [ribbon content] settings but then you added it
            again under the screen settings…keep it here in the ribbon
            setup area".
            For sports ribbons, the in-game "Score 1×/2×/3×/4×" picker
            in the Ribbon Content panel (sports/[gameId]) controls how
            the scoreboard recurs inside one ribbon render.
            The underlying `repeats` field + player tile-rendering code
            stay intact (player/page.tsx + screens.controller.ts) so a
            future non-sports use case (e.g. retail 40ft LED with a
            non-ribbon playlist) can re-surface this picker without
            re-plumbing the data path. */}
        {row(
          'Player APK',
          playerV ? (
            <>
              <span className="font-mono">v{playerV}</span>
              {playerVAt && <span className="text-slate-400"> · {timeAgo(playerVAt)}</span>}
            </>
          ) : null,
        )}
        {row(
          'Manager APK',
          managerV ? (
            <>
              <span className="font-mono">v{managerV}</span>
              {managerVAt && <span className="text-slate-400"> · {timeAgo(managerVAt)}</span>}
            </>
          ) : null,
        )}
        {row('Cache', cacheLine)}
        {row('Emergency cache', emergencyLine)}
        {row(
          'Last OTA',
          otaState ? (
            <span className="flex flex-col">
              <span className="font-semibold">
                {otaState}{otaProg != null && otaProg < 100 ? ` ${otaProg}%` : ''}
              </span>
              {otaMsg && <span className="text-[10px] text-slate-500 truncate" title={otaMsg}>{otaMsg}</span>}
              {otaAt && <span className="text-[10px] text-slate-400">{timeAgo(otaAt)}</span>}
            </span>
          ) : null,
        )}
        {row(
          'Location',
          screen?.address
            ? <span title={`${screen.latitude}, ${screen.longitude}`}>{screen.address}</span>
            : screen?.latitude != null
              ? <span className="font-mono">{Number(screen.latitude).toFixed(3)}, {Number(screen.longitude).toFixed(3)}</span>
              : null,
        )}
      </div>
      {/* 2026-05-27 — player-hardware panel. Drives capability-gated UI
          downstream (GPIO setup, dual-RS232 wiring, HDMI-IN streaming
          overlay). Hidden when the screen's hardwareModel is null or
          'unknown' — the operator picks a model from the dropdown to
          surface the capability chips + per-feature subpanels. */}
      <ScreenHardwarePanel screen={screen} />
    </div>
  );
}

/**
 * 2026-05-27 — Hardware identification + capability matrix for a single
 * screen. Lives inside the per-screen Diagnostics drawer (right under
 * the diagnostics grid).
 *
 * Reads the catalog from GET /api/v1/hardware/catalog (cached for the
 * session). Surfaces:
 *   - A dropdown of every known SKU (operator picks the hardware model)
 *   - Capability badges accurate to the picked model (only the trues show)
 *   - A Chromium-83 warning chip for Taurus deployments (CLAUDE.md rule #10)
 *
 * Saves go through the existing PUT /screens/:id endpoint; the API
 * validates the value against HARDWARE_CATALOG before persisting.
 */
function ScreenHardwarePanel({ screen }: { screen: any }) {
  const catalogQ = useHardwareCatalog();
  const setHardware = useSetScreenHardwareModel();
  const setConsole = useSetScreenConsoleProfile();
  // 2026-06-01 — which scoreboard console feeds this screen (water polo
  // pilot). Options kept in sync with the package's ConsoleProfileId +
  // the manifest allow-list; inlined here so the dashboard route doesn't
  // pull the player-oriented @cms/scoreboard-cts runtime into its bundle.
  const CONSOLE_OPTIONS: Array<{ id: string; label: string; group: string; help: string; provisional?: boolean }> = [
    { id: 'cts-gen6', label: 'CTS Gen 6 / System 6', group: 'Colorado Time Systems', help: 'Wired RS-232 (1/4" jack) → native serial port.' },
    { id: 'cts-gen7', label: 'CTS Gen 7 (RS-232 output)', group: 'Colorado Time Systems', help: 'Gen 7 via its RS-232 output (legacy CTS protocol — same as Gen 6). Its RS-485 "Gen7/WA-2" output is a different protocol, not decoded yet.' },
    { id: 'cts-wttc', label: 'CTS Wireless Tabletop (WTTC)', group: 'Colorado Time Systems', help: 'USB-B → FTDI USB-serial adapter (/dev/ttyUSB0). Byte format pending a live capture.', provisional: true },
    { id: 'daktronics-allsport', label: 'Daktronics All Sport 5000', group: 'Daktronics', help: 'Enhanced RTD over RS-232. Byte offsets pending a real-hardware capture — playClock/possession unconfirmed.', provisional: true },
  ];
  const CONSOLE_GROUPS = Array.from(new Set(CONSOLE_OPTIONS.map((o) => o.group)));
  const currentConsole: string =
    (screen?.config && typeof screen.config === 'object' && typeof screen.config.consoleProfile === 'string')
      ? screen.config.consoleProfile
      : '';
  const currentModelId: string = screen?.hardwareModel ?? 'unknown';
  const catalogModels = catalogQ.data?.models ?? [];
  const current = catalogModels.find((m) => m.id === currentModelId)
    // Fall back to the unknown entry while the catalog is loading.
    ?? catalogModels.find((m) => m.id === 'unknown')
    ?? null;
  const caps = current?.caps;
  // Build the badge list — only the trues show, accuracy beats noise.
  const badges: { label: string; tone?: 'warn' | 'info' }[] = [];
  if (caps) {
    if (caps.serialPorts >= 2) badges.push({ label: 'Dual RS232' });
    else if (caps.serialPorts >= 1) badges.push({ label: 'RS232' });
    if (caps.rs485) badges.push({ label: 'RS485' });
    if (caps.gpioIn > 0 || caps.gpioOut > 0) {
      badges.push({ label: `GPIO ${caps.gpioIn}in/${caps.gpioOut}out` });
    }
    if (caps.hdmiIn) badges.push({ label: 'HDMI IN' });
    if (caps.rj45Out) badges.push({ label: 'RJ45 passthrough' });
    if (caps.powerOutVolts != null) badges.push({ label: `${caps.powerOutVolts}V aux out` });
    if (caps.npuTops > 0) badges.push({ label: `${caps.npuTops} TOPS NPU` });
    if (caps.decode4k) badges.push({ label: '4K decode' });
    if (caps.fanless) badges.push({ label: 'Fanless' });
    if (caps.duty247Rated) badges.push({ label: '24/7 rated' });
  }

  return (
    <div className="px-3.5 py-3 border-t border-slate-100 bg-slate-50/40">
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-2">
        Hardware
      </div>
      <div className="flex flex-col gap-2">
        {/* Model picker — saves via PUT /screens/:id. */}
        <div className="flex flex-col min-w-0">
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
            Model
          </div>
          <select
            value={currentModelId}
            disabled={setHardware.isPending || catalogQ.isLoading}
            onChange={(e) => {
              const next = e.target.value;
              if (next === currentModelId) return;
              // Picking "unknown" stores 'unknown'; picking the
              // "Unassigned" sentinel (value '__clear__') sends null
              // to clear the column entirely. Operator distinction:
              // "I don't know" vs "this hasn't been set yet".
              const payload = next === '__clear__' ? null : next;
              setHardware.mutate({ id: screen.id, hardwareModel: payload });
            }}
            className="text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded px-1.5 py-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Pick the physical player hardware behind this screen. Drives capability badges + future I/O configuration panels."
          >
            {/* "__clear__" maps to null on save — explicitly mark unassigned. */}
            <option value="__clear__">Unassigned (clear)</option>
            {catalogModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {current && current.id !== 'unknown' && (
            <div className="text-[10px] text-slate-500 mt-1" title={current.socOs}>
              {current.socOs}
            </div>
          )}
        </div>

        {/* Capability badges — only trues show. Hidden when no model
            picked (current === unknown or null catalog). */}
        {current && current.id !== 'unknown' && badges.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {badges.map((b) => (
              <span
                key={b.label}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100"
              >
                <CheckCircle2 className="w-2.5 h-2.5" />
                {b.label}
              </span>
            ))}
          </div>
        )}

        {/* 2026-06-01 — scoreboard console picker (water-polo pilot).
            Shows for any known hardware model; persists
            Screen.config.consoleProfile → manifest → CtsBridge, which
            picks the serial settings + default tty + decoder. Gen 6 stays
            the default (unchanged for every existing install); WTTC
            selects the USB-serial (/dev/ttyUSB0) path. */}
        {current && current.id !== 'unknown' && (
          <div className="flex flex-col min-w-0 border-t border-slate-100 pt-2 mt-0.5">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
              Scoreboard console
            </div>
            <select
              value={currentConsole || '__none__'}
              disabled={setConsole.isPending}
              onChange={(e) => {
                const next = e.target.value;
                const payload = next === '__none__' ? null : next;
                if ((payload ?? '') === currentConsole) return;
                setConsole.mutate({ id: screen.id, consoleProfile: payload });
              }}
              className="text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded px-1.5 py-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Which scoreboard timing console feeds this screen. Drives the serial settings + the port the player opens."
            >
              <option value="__none__">Not set (defaults to CTS Gen 6)</option>
              {CONSOLE_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {CONSOLE_OPTIONS.filter((o) => o.group === g).map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {(() => {
              const sel = CONSOLE_OPTIONS.find((o) => o.id === currentConsole);
              return sel ? (
                <div className="text-[10px] text-slate-500 mt-1">
                  {sel.help}
                  {sel.provisional && (
                    <span className="ml-1 inline-block rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
                      capture pending
                    </span>
                  )}
                </div>
              ) : null;
            })()}
          </div>
        )}

        {/* CLAUDE.md rule #10 — Chromium 83 warning. Only fires for
            hardware whose minimum WebView is ≤ 83 (today: Taurus). */}
        {current && current.id !== 'unknown' && caps && caps.chromiumMin <= 83 && (
          <div
            className="flex items-start gap-2 px-2 py-1.5 rounded border border-amber-200 bg-amber-50 mt-1"
            title="This hardware ships an older Chromium that does not support modern CSS shorthand."
          >
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-[10px] text-amber-800 leading-snug">
              <span className="font-bold">Chromium {caps.chromiumMin} device.</span>
              {' '}Uses long-hand CSS per CLAUDE.md rule #10
              (no <code className="font-mono bg-amber-100 px-1 rounded">inset</code> shorthand,
              no flex <code className="font-mono bg-amber-100 px-1 rounded">gap</code>).
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DeviceFingerprintRow({ fingerprint }: { fingerprint: string }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);

  if (!fingerprint) {
    return (
      <div className="px-3.5 py-2.5 border-t border-slate-100 bg-slate-50/40">
        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">
          Device fingerprint
        </div>
        <div className="text-[10px] text-slate-400 italic">
          Not yet reported — kiosk has not registered.
        </div>
      </div>
    );
  }

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(fingerprint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Some browsers / iframes block clipboard. Fall back to a
      // text-area-and-execCommand selection so the operator can at
      // least Ctrl+C from a focused field.
      const ta = document.createElement('textarea');
      ta.value = fingerprint;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch {}
      document.body.removeChild(ta);
    }
  };

  return (
    <div className="px-3.5 py-2.5 border-t border-slate-100 bg-slate-50/40">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
          Device fingerprint
        </div>
        <button
          type="button"
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy fingerprint to clipboard'}
          aria-label={copied ? 'Copied' : 'Copy device fingerprint'}
          className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-slate-800 px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-600" />
              <span className="text-emerald-700">{t('screens.copied')}</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>{t('screens.copy')}</span>
            </>
          )}
        </button>
      </div>
      <div className="font-mono text-[10px] text-slate-700 break-all leading-tight select-all">
        {fingerprint}
      </div>
    </div>
  );
}

function ScreenSettingsMenu({
  screen,
  pushState,
  pending,
  onPushApk,
  onRefreshWeb,
  refreshWebPending,
  previewHref,
  groupSyncLocked,
}: {
  screen: any;
  pushState: { at: number; priorVersion: string | null } | undefined;
  pending: boolean;
  onPushApk: () => void;
  onRefreshWeb: () => void;
  refreshWebPending: boolean;
  previewHref: string;
  /** 2026-07-28 — parent group has frame-locked sync ON (shows the trim UI). */
  groupSyncLocked?: boolean;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Viewport-anchored position for the portalled popover. Recomputed
  // on open + scroll + resize so the menu stays glued to the gear even
  // if the list scrolls behind it.
  //
  // On mobile (viewport < 480px) we switch to a centred bottom-sheet so
  // the menu is never partially off the left edge regardless of where the
  // gear button sits horizontally in the action row.
  const [anchor, setAnchor] = useState<{
    top: number | null;
    bottom: number | null;
    right: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  // Anchor math lives in a standalone, unit-tested module (mobile bug #217,
  // 2026-07-01 — apps/web/src/lib/clamp-popover-anchor.ts +
  // clamp-popover-anchor.test.ts) so the exact clamping behavior can be
  // regression-tested across a matrix of button positions × viewport
  // widths without rendering this whole (hook-heavy) page component.
  const updateAnchor = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setAnchor(
      clampPopoverAnchor({
        buttonRect: { top: r.top, bottom: r.bottom, right: r.right },
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }),
    );
  };

  useEffect(() => {
    if (!open) return;
    updateAnchor();
    const handleDoc = (e: Event) => {
      const btn = buttonRef.current;
      const menu = menuRef.current;
      if (!menu) return;
      if (menu.contains(e.target as Node)) return;
      if (btn && btn.contains(e.target as Node)) return;
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const handleReflow = () => updateAnchor();
    document.addEventListener('mousedown', handleDoc);
    // pointerdown too: iOS Safari doesn't reliably fire mousedown on a tap on
    // empty (non-interactive) background, so tap-outside-to-close needs this.
    document.addEventListener('pointerdown', handleDoc);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleReflow, true); // capture so we catch scroll inside ancestors
    window.addEventListener('resize', handleReflow);
    return () => {
      document.removeEventListener('mousedown', handleDoc);
      document.removeEventListener('pointerdown', handleDoc);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleReflow, true);
      window.removeEventListener('resize', handleReflow);
    };
  }, [open]);

  // Push-feedback derivation — only renders when a push was initiated.
  const currentVersion: string | null = (screen as any).playerVersion ?? null;
  // Latest published APK — fetched on demand when the menu opens, so a
  // closed menu costs nothing. Cached 10min in React Query.
  const { data: latestVersionInfo } = useLatestPlayerVersion();
  const latestVersion: string | null = latestVersionInfo?.versionName ?? null;
  // Compare semver-ish strings — strip leading 'v' and compare numeric
  // dotted segments. Falls back to string equality when either side is
  // weird.
  const upToDate = (() => {
    if (!currentVersion || !latestVersion) return null;
    const norm = (v: string) => v.trim().replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    const a = norm(currentVersion);
    const b = norm(latestVersion);
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const x = a[i] ?? 0;
      const y = b[i] ?? 0;
      if (x < y) return false;
      if (x > y) return true;
    }
    return true;
  })();
  const pushed = !!pushState;
  const pushedMsAgo = pushState ? Date.now() - pushState.at : 0;
  const updatedSincePush = !!(pushState && currentVersion && currentVersion !== (pushState.priorVersion ?? null));
  // APK install end-to-end (WS hop + download + Android install prompt
  // + replace + restart + first heartbeat after restart) takes 1-3 min
  // on a fast network, longer on Wi-Fi behind a school firewall.
  // 90s was too aggressive — operator was seeing "no response" before
  // the install even finished. Bumped to 5 min. Stages give the
  // operator real signal during the wait instead of one big "Waiting…".
  // 2026-04-28 — bumped 5 min → 35 min to match the 30-min Manager
  // periodic OTA cadence (UX audit P0-I). Previous 5-min wall-clock
  // timeout fired before the periodic worker could even attempt
  // installation, causing every WS-failed push to show "Failed" even
  // though the next 30-min tick would succeed. The button stays
  // disabled during this window; lastOtaState surfacing (above)
  // gives device-truth signal in the meantime.
  const PUSH_TIMEOUT_MS = 35 * 60_000;
  const stillWaiting = pushed && !updatedSincePush && pushedMsAgo < PUSH_TIMEOUT_MS;
  const timedOut = pushed && !updatedSincePush && pushedMsAgo >= PUSH_TIMEOUT_MS;
  // HONESTY FIX (2026-04-27): the previous stage machine showed
  // sending → downloading → installing → restarting purely off a
  // stopwatch (`pushedMsAgo`). We had ZERO real signal from the kiosk
  // for any of those phases — the screen could be powered off and the
  // dashboard would still march through "downloading…installing…" then
  // declare "no response." Operator caught us lying when v1.0.9's OTA
  // worker was silently no-op'ing because SharedPreferences for
  // `api_root` were never written by the JS bridge (this is fixed in
  // v1.0.11 — until then the worker exits on launch).
  //
  // We only have TWO real signals from the kiosk:
  //   1. pushedMsAgo  — time since the operator clicked Push
  //   2. currentVersion — versionName the kiosk reports via heartbeat
  // So that's all we surface. `stage` is now one of:
  //   idle      | not pushed
  //   pending   | pushed, no new version yet (single honest "waiting")
  //   installed | heartbeat reports new versionName
  //   timeout   | 5 min elapsed without a version change
  // No fake intermediate steps. v1.0.11 will add real per-phase device
  // reporting (POST /api/v1/screens/:id/ota-state CHECKING|DOWNLOADING|
  // VERIFYING|INSTALLING|ERROR) and we'll surface those as honest
  // sub-states only AFTER the kiosk has actually told us each phase
  // started. See todo: "Replace dashboard's optimistic OTA timeline
  // with real device-reported state".
  const stage: 'idle' | 'pending' | 'installed' | 'timeout' = !pushed
    ? 'idle'
    : updatedSincePush
    ? 'installed'
    : pushedMsAgo >= PUSH_TIMEOUT_MS
    ? 'timeout'
    : 'pending';

  const menu = (
    // Plain positioned div, not role="menu". Using the WAI menu role
    // requires roving tabindex + arrow-key navigation + proper
    // menuitem children — this popover is just a set of buttons
    // under a heading, not a full keyboard menu. Keeping it as a
    // visual dropdown avoids hollow a11y affordances (and jsx-a11y's
    // "menu role without focus/keyboard" error that baseline+13'd
    // this file). No onClick here either; the outside-click listener
    // in the useEffect above handles dismissal, and click events on
    // the inner buttons don't need to stop bubbling through the
    // portal boundary.
    <div
      ref={menuRef}
      className="fixed rounded-xl bg-white border border-slate-200 shadow-[0_12px_32px_rgba(15,23,42,0.18)] overflow-y-auto overflow-x-hidden z-[9999]"
      style={
        anchor
          ? {
              ...(anchor.top != null ? { top: anchor.top } : {}),
              ...(anchor.bottom != null ? { bottom: anchor.bottom } : {}),
              right: anchor.right,
              // Width is DERIVED (was the static w-64=256px). On narrow
              // viewports the panel shrinks to fit so its left edge can never
              // run off-screen. `maxWidth` is a final hard cap regardless of
              // the measured `width`.
              width: anchor.width,
              maxWidth: 'calc(100vw - 24px)',
              maxHeight: anchor.maxHeight,
            }
          : { top: -9999, right: 0 }
      }
    >
          {/* Sticky close button — guarantees the popover is dismissable on
              touch (iOS tap-outside via document events is unreliable) without
              re-adding a chunky header. Stays pinned while the menu scrolls. */}
          <div className="sticky top-0 z-10 flex justify-end bg-white/95 backdrop-blur-sm px-1.5 pt-1.5 -mb-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('screens.closeSettings')}
              className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 active:bg-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* Menu — action rows only, no chunky header. The old
              header repeated the screen name + version that's
              already visible on the row; the Integration Lead
              called it redundant. Rows below are regular menuitem-
              style clickable entries. */}

          {/* APK version comparison strip — operator (2026-04-27):
              "when i hit settings on a screen, it should do a check
              and say this is the current version on the screen and
              this is the available version and have me click a
              button to push the upgrade." */}
          <div className="px-3.5 py-2.5 border-b border-slate-100 bg-slate-50/40">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('screens.playerVersion')}</div>
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <div>
                <div className="text-slate-400">{t('screens.current')}</div>
                <div className="font-bold text-slate-800">
                  {currentVersion ? `v${currentVersion}` : t('screens.notReported')}
                </div>
              </div>
              <div className="text-slate-300">→</div>
              <div className="text-right">
                <div className="text-slate-400">{t('screens.latest')}</div>
                <div className="font-bold text-slate-800">
                  {latestVersion ? `v${latestVersion}` : <Loader2 className="w-3 h-3 inline animate-spin text-slate-300" />}
                </div>
              </div>
            </div>
            {/* Status pill — green when up-to-date, amber when behind,
                grey when unknown. */}
            <div className="mt-2">
              {upToDate === true && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                  <CheckCircle2 className="w-3 h-3" /> Up to date
                </span>
              )}
              {/* 2026-04-29 — operator: "instead of saying upgrade
                  it should say install player when its not deteteced".
                  When the screen has no playerVersion at all (Manager
                  is alone on the kiosk, OR Player was uninstalled),
                  copy reads "Install Player" instead of "Update
                  available". The action is the same — Manager's
                  OtaWorker installs Player from scratch. */}
              {upToDate === false && !currentVersion && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
                  <Download className="w-3 h-3" /> Install Player
                </span>
              )}
              {upToDate === false && currentVersion && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                  <RefreshCw className="w-3 h-3" /> Update available
                </span>
              )}
              {upToDate === null && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">
                  Unknown — push to install latest
                </span>
              )}
            </div>
          </div>

          {/* One row, two states:
                IDLE → "Push update to v1.0.8" with the manual-only hint
                       below it.
                IN-FLIGHT → label morphs through the OTA stages
                       (sending → downloading → installing → restarting
                       → installed) with a stage-appropriate icon.
                       Disabled so it can't be re-clicked mid-push, but
                       still visible as a single source of truth. */}
          {(() => {
            // 2026-04-28 (UX audit P0-C + I) — surface the device-truth
            // signals the kiosk has been writing to lastOtaState all
            // along. The dashboard previously ignored them entirely
            // and ran a 5-min wall-clock timeout, lying to operators
            // every push because the periodic worker is on a 30-min
            // cadence. Now: device-truth wins. Wall-clock falls back
            // only when the device is silent.
            const otaState: string | null = (screen as any)?.lastOtaState ?? null;
            const otaProgress: number | null = (screen as any)?.lastOtaProgress ?? null;
            const otaMessage: string | null = (screen as any)?.lastOtaMessage ?? null;
            const otaAt: string | null = (screen as any)?.lastOtaAt ?? null;
            const otaAtMs = otaAt ? new Date(otaAt).getTime() : 0;
            const pushAtMs = pushed ? pushState.at : 0;
            // Only trust device state newer than this push. Otherwise
            // we'd show stale state from a previous OTA cycle.
            const deviceTruth = pushAtMs > 0 && otaAtMs > pushAtMs ? otaState : null;

            const isInFlight = pushed && !updatedSincePush;
            const TIMEOUT_MS = 35 * 60_000;  // matches periodic worker cadence
            const isTimedOut = isInFlight && pushedMsAgo > TIMEOUT_MS;

            // Effective stage — device truth first, wall-clock only as a
            // last resort.
            const effectiveStage: 'idle' | 'pending' | 'checking' | 'downloading' | 'verifying' | 'installing' | 'installed' | 'error' | 'timeout' =
              stage === 'installed' || updatedSincePush ? 'installed' :
              deviceTruth === 'INSTALLED' ? 'installed' :
              deviceTruth === 'ERROR' ? 'error' :
              deviceTruth === 'INSTALLING' ? 'installing' :
              deviceTruth === 'VERIFYING' ? 'verifying' :
              deviceTruth === 'DOWNLOADING' ? 'downloading' :
              deviceTruth === 'CHECKING' ? 'checking' :
              isTimedOut ? 'timeout' :
              isInFlight ? 'pending' :
              'idle';

            const stageIcon: React.ReactNode =
              effectiveStage === 'installed' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> :
              effectiveStage === 'error'     ? <WifiOff className="w-4 h-4 text-rose-600 shrink-0" /> :
              effectiveStage === 'timeout'   ? <WifiOff className="w-4 h-4 text-amber-600 shrink-0" /> :
              ['pending', 'checking', 'downloading', 'verifying', 'installing'].includes(effectiveStage)
                ? <Loader2 className="w-4 h-4 text-indigo-500 shrink-0 animate-spin" />
                : <RefreshCw className={`w-4 h-4 shrink-0 ${upToDate === false ? 'text-amber-500' : 'text-indigo-500'}`} />;

            const pendingSecs = Math.floor(pushedMsAgo / 1000);
            const pendingHumanAgo = pendingSecs < 60
              ? `${pendingSecs}s ago`
              : `${Math.floor(pendingSecs / 60)}m ${pendingSecs % 60}s ago`;
            const timeoutCopy =
              upToDate === true
                ? `No version change after 35 min — kiosk was already on the latest.`
                : `No update after 35 min. Power-cycle the screen, check "Install unknown apps" permission, or sideload via ViPlex.`;

            const stageLabel =
              effectiveStage === 'installed'   ? `Kiosk installed v${currentVersion} ✓` :
              effectiveStage === 'error'       ? `Install error: ${otaMessage || 'unknown error'}` :
              effectiveStage === 'installing'  ? `Installing on kiosk... ${otaMessage || ''}` :
              effectiveStage === 'verifying'   ? `Verifying APK signature on kiosk...` :
              effectiveStage === 'downloading' ? `Downloading on kiosk${otaProgress !== null ? ` (${otaProgress}%)` : '...'}` :
              effectiveStage === 'checking'    ? `Kiosk acknowledged push, checking server...` :
              effectiveStage === 'timeout'     ? timeoutCopy :
              effectiveStage === 'pending'     ? `Update sent ${pendingHumanAgo} — waiting for kiosk (≤ 35 min via periodic check)` :
              upToDate === true && !pushed     ? 'On latest — push anyway' :
              upToDate === false               ? `Push update to v${latestVersion}` :
                                                 'Push update to this screen';
            const stageColor =
              effectiveStage === 'installed' ? 'text-emerald-700 font-bold' :
              effectiveStage === 'error'     ? 'text-rose-700 font-bold' :
              effectiveStage === 'timeout'   ? 'text-amber-700 font-bold' :
              isInFlight                     ? 'text-indigo-700 font-bold' :
                                                 'text-slate-700 font-semibold';
            // Sub-line — surface real device telemetry when in-flight.
            const subline = isInFlight
              ? (deviceTruth
                  ? `Kiosk last reported ${deviceTruth} ${otaAt ? new Date(otaAt).toLocaleTimeString() : ''}`
                  : `If WS push didn’t reach kiosk, periodic check installs within 30 min`)
              : 'Manual only — auto-update is OFF unless you toggle it in Settings';
            return (
              <button
                type="button"
                onClick={onPushApk}
                disabled={pending || stillWaiting || (upToDate === true && !pushed)}
                className="w-full flex items-center gap-3 px-3.5 py-3 text-left text-xs hover:bg-slate-50 disabled:opacity-80 disabled:cursor-not-allowed border-b border-slate-100"
                title={upToDate === true && !pushed
                  ? 'Already on the latest version'
                  : 'Tells this kiosk to download + install the latest APK on its next check-in'}
              >
                {stageIcon}
                <span className="flex-1 min-w-0">
                  <span className={`block ${stageColor}`}>{stageLabel}</span>
                  {subline && (
                    <span className="block text-[10px] font-normal text-slate-400 mt-0.5">{subline}</span>
                  )}
                </span>
              </button>
            );
          })()}

          {/* Refresh page — Sprint 11 Phase B. Reloads the kiosk's
              WebView without a sideload or operator-at-kiosk button
              tap. Use after a web/player bundle hotfix lands on
              Vercel so the kiosk picks it up. NOT an APK update —
              that's the row above; this just re-fetches the JS
              bundle. Fleet-wide refresh is on the group footer.) */}
          <button
            type="button"
            onClick={() => { setOpen(false); onRefreshWeb(); }}
            disabled={refreshWebPending}
            className="w-full flex items-center gap-3 px-3.5 py-3 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
            title="Reloads the kiosk's player page (picks up any deployed JS fix). No APK install."
          >
            <RefreshCw className={`w-4 h-4 shrink-0 ${refreshWebPending ? 'animate-spin text-indigo-500' : 'text-slate-400'}`} />
            <span className="flex-1 min-w-0">
              <span className="block">{refreshWebPending ? 'Refreshing…' : 'Refresh kiosk page'}</span>
              <span className="block text-[10px] font-normal text-slate-400 mt-0.5">
                Reload JS bundle (not an APK update)
              </span>
            </span>
          </button>

          {/* Preview in browser — moved out of the row, into the menu. */}
          <a
            href={previewHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-3.5 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ExternalLink className="w-4 h-4 text-slate-400 shrink-0" />
            Open preview in browser
          </a>

          {/* Device fingerprint — diagnostic field. Surfaced 2026-04-28
              after a live OTA incident where the operator had no
              operator-friendly way to retrieve the fingerprint to
              probe /api/v1/screens/status/<fp>. The fingerprint is the
              only DB key tying support tickets to the kiosk. Copy
              button instead of select-text because the string is 30+
              chars in a 256px-wide popover. */}
          <DeviceFingerprintRow fingerprint={(screen as any).deviceFingerprint || ''} />

          {/* Phase B closeout — diagnostic detail block. Pulls everything
              the dashboard knows about this screen into one place inside
              the existing settings popover so admins don't have to chase
              info across the row chrome and dev tools. No new endpoint —
              all fields are already on the screen payload. */}
          <ScreenDiagnostics screen={screen} groupSyncLocked={groupSyncLocked} />

      {/* Footer placeholder — leaves room for restart / cache /
          orientation / brightness settings as we build them. */}
      <div className="px-3.5 py-2 bg-slate-50/60 border-t border-slate-100 text-[10px] text-slate-400">
        More coming soon — restart, orientation, cache clear.
      </div>
    </div>
  );

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={buttonRef}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title={t('screens.screenSettings')}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center justify-center h-11 w-11 sm:h-auto sm:w-auto sm:p-2 bg-white border border-slate-100 rounded-lg text-slate-400 hover:text-slate-800 hover:border-slate-300 hover:bg-slate-50 transition-all shadow-sm"
      >
        <Settings className="w-4 h-4" />
      </button>
      {/* Render into document.body via portal so no ancestor's
          overflow:hidden (the group card's rounded-corner clip, the
          divide-y wrapper, etc.) can clip the menu. Previous version
          used a normal absolute child — it was getting trimmed by the
          group card's bottom edge on every row except the last.
          The popover floats anchored to the gear (clamped on-screen at any
          width); tap-outside / Esc / the in-menu X all dismiss it. */}
      {open && typeof document !== 'undefined' && createPortal(menu, document.body)}
    </div>
  );
}

/**
 * Copy-to-clipboard button for the player URL.
 *
 * Three things the old inline `onClick={() => navigator.clipboard?...}`
 * got wrong, all of which made operators report "the button doesn't
 * work":
 *  1. No `cursor-pointer` — Tailwind v4's Preflight no longer sets it
 *     on <button>, so the pointer stayed an arrow and the control read
 *     as dead/un-clickable.
 *  2. No feedback — `navigator.clipboard.writeText` is silent, so a
 *     successful copy looked like nothing happened.
 *  3. No fallback — `navigator.clipboard` is `undefined` outside a
 *     secure context (plain-HTTP previews, some kiosk webviews), so
 *     the optional-chain silently no-op'd.
 * This component fixes all three: pointer cursor, a "Copied!" state,
 * and a legacy `execCommand('copy')` fallback.
 */
function CopyUrlButton({ url }: { url: string }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = async () => {
    let ok = false;
    // Modern path — only present in a secure context (HTTPS/localhost).
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch {
      /* fall through to the legacy path */
    }
    // Legacy fallback — works on plain HTTP and older webviews.
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    setCopied(ok);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center gap-1.5 px-4 py-2.5 text-white text-sm font-bold rounded-xl shrink-0 shadow-sm transition-all active:scale-95 cursor-pointer"
      style={{ background: copied ? '#16a34a' : 'var(--brand-primary, #4f46e5)' }}
    >
      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      {copied ? t('screens.copiedBang') : t('screens.copyUrl')}
    </button>
  );
}

export default function ScreensPage() {
  const t = useTranslations();
  const { data: groups, isLoading, isError, refetch } = useScreenGroups();
  const { data: allScreens, refetch: refetchScreens } = useScreens();
  const userRole = useUIStore((s) => s.user?.role);
  const isViewer = userRole === 'RESTRICTED_VIEWER';
  // Sprint 8 — fleet map view. Toggle persists in URL via search param so a
  // bookmarked map link still opens the map. (The HQ cross-location roll-up
  // now lives on the Corporate dashboard, not here — keeps Screens to a single
  // map of this tenant's own screens.)
  const [viewMode, setViewMode] = useState<'list' | 'map' | 'floor'>('list');
  const params = useParams<{ schoolId: string }>();
  const router = useRouter();
  const schoolId = params?.schoolId ?? '';
  const updateLocation = useUpdateScreenLocation();
  const flatScreens = useMemo(() => (allScreens || []) as any[], [allScreens]);

  // Autocomplete-driven location modal. The previous appPrompt-only flow
  // silently failed when Nominatim couldn't geocode the free-text string
  // (address saved, lat/lng null, map filtered the row out, operator
  // saw "nothing happened"). Modal forces a structured pick + sends the
  // suggestion's own lat/lng so the pin reliably drops.
  const [locationModal, setLocationModal] = useState<{ id: string; name: string; address?: string | null } | null>(null);
  const handleSetLocation = (screenId: string, screenName: string, currentAddress?: string | null) => {
    setLocationModal({ id: screenId, name: screenName, address: currentAddress });
  };
  const createGroup = useCreateScreenGroup();
  const deleteGroup = useDeleteScreenGroup();
  const updateGroup = useUpdateScreenGroup();
  const deleteScreen = useDeleteScreen();
  const updateScreen = useUpdateScreen();
  const forceApkUpdate = useForceApkUpdate();
  const refreshWeb = useRefreshWeb();
  const [apkUpdateToast, setApkUpdateToast] = useState<string | null>(null);
  // When a push was sent per-screen, timestamp + last-known version at
  // push-time. The ScreenSettingsMenu below uses these to give the
  // operator confidence the update "took" — if playerVersion changes
  // after pushedAt, we render a green "installed vX.Y.Z ✓" chip. If
  // it doesn't change within ~2 min, we flip to a warning that the
  // kiosk hasn't responded.
  const [apkPushState, setApkPushState] = useState<Record<string, { at: number; priorVersion: string | null }>>({});

  const handlePushApkUpdate = async (screenId?: string, screenName?: string, priorVersion?: string | null) => {
    try {
      await forceApkUpdate.mutateAsync({ screenId });
      if (screenId) {
        setApkPushState((s) => ({
          ...s,
          [screenId]: { at: Date.now(), priorVersion: priorVersion ?? null },
        }));
      }
      setApkUpdateToast(
        screenId
          ? `Update request sent to "${screenName}". Kiosk will pull + install within ~1 min.`
          : 'Update request sent to every paired kiosk. Each will pull + install within ~1 min.',
      );
      setTimeout(() => setApkUpdateToast(null), 6000);
    } catch (e: any) {
      setApkUpdateToast(`Push failed: ${e?.message || 'unknown error'}`);
      setTimeout(() => setApkUpdateToast(null), 8000);
    }
  };

  // Phase B — REFRESH_WEB push handler. Sends a signed WS message
  // that tells the targeted kiosk(s) to reload their JS bundle so a
  // freshly-deployed web fix actually reaches them. Reuses the apk-
  // update toast lane so we don't double-stack overlays.
  const handleRefreshWeb = async (screenId?: string, screenName?: string) => {
    try {
      await refreshWeb.mutateAsync({ screenId });
      setApkUpdateToast(
        screenId
          ? `Refresh request sent to "${screenName}". Player page reloads in a few seconds.`
          : 'Refresh request sent to every paired kiosk. Pages reload over the next ~10 s (jittered).',
      );
      setTimeout(() => setApkUpdateToast(null), 6000);
    } catch (e: any) {
      setApkUpdateToast(`Refresh failed: ${e?.message || 'unknown error'}`);
      setTimeout(() => setApkUpdateToast(null), 8000);
    }
  };

  // Screens not assigned to any group
  const ungroupedScreens = (allScreens || []).filter((s: any) => !s.screenGroupId);

  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [showPairModal, setShowPairModal] = useState(false);
  // Hide the mobile tab bar while the Pair-a-Screen modal is open so its
  // footer isn't occluded. ScreenLocationModal manages its own lock.
  useOverlayLock(showPairModal);
  const [pairGroupId, setPairGroupId] = useState<string>('');
  const [pairCode, setPairCode] = useState('');
  const [pairName, setPairName] = useState('');
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState('');
  // 2026-05-27 — Hardware model picker added BEFORE the pair-code entry
  // so we know what we're pairing (Goodview EP6N, ECBox3576, Taurus,
  // Pi5, generic-android, or web). Drives vertical-specific
  // recommendations + the EP6N upsell cards. Casts through `any` on the
  // API body so this lands cleanly whether or not Agent A has shipped
  // Screen.hardwareModel into the schema yet — the field is dropped at
  // the API boundary if the column doesn't exist (passthrough behavior
  // on the pair endpoint already accepts unknown body fields silently).
  // 2026-05-27 — pairHardwareModel + dismissedUpsells + tenantVertical
  // state lived here to feed PairScreenHardwareStep. All gone with the
  // step itself — hardware is auto-detected from the player's first
  // manifest call, not typed by the operator at pair time.
  const [editingScreen, setEditingScreen] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  // Inline screen-GROUP rename (mirrors the per-screen click-to-rename below).
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [showQrForScan, setShowQrForScan] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  // Generate a QR encoding the pairing code (or a deep-link to /pair?code=) so
  // a phone pointed at this modal can scan and complete pairing.
  useEffect(() => {
    if (!showQrForScan || !pairCode.trim()) { setQrDataUrl(''); return; }
    const payload = typeof window !== 'undefined'
      ? `${window.location.origin}/pair?code=${encodeURIComponent(pairCode.trim().toUpperCase())}`
      : pairCode.trim().toUpperCase();
    QRCode.toDataURL(payload, { width: 220, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [showQrForScan, pairCode]);
  const newGroupInputRef = useRef<HTMLInputElement>(null);
  const pairCodeInputRef = useRef<HTMLInputElement>(null);
  const editNameInputRef = useRef<HTMLInputElement>(null);

  // Focus new-group name input when the form opens
  useEffect(() => {
    if (showCreateGroup) newGroupInputRef.current?.focus();
  }, [showCreateGroup]);

  // Focus pairing code input when the modal opens
  useEffect(() => {
    if (showPairModal) pairCodeInputRef.current?.focus();
  }, [showPairModal]);

  // Focus the inline rename input when a screen enters edit mode
  useEffect(() => {
    if (editingScreen) editNameInputRef.current?.focus();
  }, [editingScreen]);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    await createGroup.mutateAsync({ name: newGroupName });
    setNewGroupName('');
    setShowCreateGroup(false);
  };

  const handlePairScreen = async () => {
    if (!pairCode.trim()) return;
    setPairing(true);
    setPairError('');
    try {
      // 2026-05-27 — body shape simplified after PairScreenHardwareStep
      // was removed from the modal. The player APK reports hardware
      // info via the manifest endpoint after pair; the server maps
      // Build.MODEL → Screen.hardwareModel without an operator step.
      const body: any = {
        pairingCode: pairCode.trim().toUpperCase(),
        name: pairName.trim() || undefined,
        screenGroupId: pairGroupId || undefined,
      };
      await apiFetch('/screens/pair', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setShowPairModal(false);
      setPairCode('');
      setPairName('');
      setPairGroupId('');
      refetch();
      refetchScreens();
    } catch (e: any) {
      setPairError(e.message || 'Invalid pairing code');
    } finally {
      setPairing(false);
    }
  };

  // 2026-05-27 — handleDismissUpsell removed alongside the pair-modal
  // hardware step. Will move to the per-screen settings page when the
  // EP6N I/O upsells are re-homed there.

  const handleRename = async (screenId: string) => {
    if (!editName.trim()) return;
    await updateScreen.mutateAsync({ id: screenId, name: editName.trim() });
    setEditingScreen(null);
  };

  const playerUrl = typeof window !== 'undefined' ? `${window.location.origin}/player` : 'http://localhost:3000/player';

  // Build the preview URL for a specific screen. We pass the admin's
  // JWT via a URL **fragment** (`#t=...`) because fragments don't get
  // logged by servers, sent in referrer headers, or captured in proxy
  // access logs. The player reads + immediately wipes the hash so the
  // token never sits in the browser's address bar beyond the first
  // tick. Orientation is a normal query param (not sensitive) so the
  // preview tab can letterbox to the real screen's aspect ratio the
  // moment it opens — no flash of wrong-orientation content.
  //
  // Without this handoff the preview tab had no credentials (it opens
  // in a fresh sessionStorage context) which meant the manifest fetch
  // threw NO_DEVICE_TOKEN, which flipped phase back to 'connecting',
  // which re-triggered the fetch, which looped forever. Reported by
  // the Integration Lead as "keeps refreshing the page".
  const authToken = useUIStore((s) => s.token);
  const buildPreviewUrl = (screen: { deviceFingerprint: string; resolution?: string | null }) => {
    const q = new URLSearchParams({
      deviceId: screen.deviceFingerprint,
      preview: '1',
      orientation: orientationFromResolution(screen.resolution),
    });
    const hash = authToken ? `#t=${encodeURIComponent(authToken)}` : '';
    return `${playerUrl}?${q.toString()}${hash}`;
  };

  return (
    <div className="space-y-6">
      {/* Brand-aware hover rules for pair action buttons. Using inline
          <style> keeps the brand var in play without fighting Tailwind. */}
      <style>{`
        .screens-pair-btn { background: color-mix(in srgb, var(--brand-primary, #4f46e5) 10%, white); color: var(--brand-primary, #4f46e5); }
        .screens-pair-btn:hover { background: var(--brand-primary, #4f46e5); color: white; }
        .screens-name-btn:hover { color: var(--brand-primary, #4f46e5); }
        .screens-ext-link:hover { color: var(--brand-primary, #4f46e5); border-color: color-mix(in srgb, var(--brand-primary, #4f46e5) 30%, transparent); background: color-mix(in srgb, var(--brand-primary, #4f46e5) 5%, white); }
      `}</style>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
            <MonitorPlay className="w-7 h-7" style={{ color: 'var(--brand-primary, #6366f1)' }} />
            {t('screens.title')}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('screens.subtitle')}</p>
        </div>
        {/* Mobile (<sm): the control cluster goes full-width and wraps so
            nothing (notably "New Group") is clipped off the right edge —
            the segmented List/Map/Floor toggle gets its own full-width
            row; Pair + New Group share the row below. Desktop is
            unchanged: a single inline `flex gap-2 items-center` row. */}
        <div className="flex flex-wrap gap-2 items-center w-full sm:w-auto">
          {/* List / Map / Floor plans — three views of the same fleet.
              Floor plans was its own sidebar entry until 2026-04-27 when
              the operator pointed out "this is just another way to see
              screens"; the toggle replaces it cleanly.

              2026-05-14 — Floor plans used to `router.push()` to a
              separate route, which broke the operator's "stay in the
              same frame" expectation ("once i open floor plan, i lose
              the ability to go back to list or map"). Now all three
              behave identically — flip viewMode, render inline. The
              floor-plans/[id] pin-placement editor stays a separate
              route because it's a focused full-screen workflow. */}
          <div className="flex w-full sm:inline-flex sm:w-auto bg-slate-100 rounded-lg p-0.5 border border-slate-200">
            <button onClick={() => setViewMode('list')}
              className={`flex-1 sm:flex-none justify-center px-3 py-2 sm:py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors ${viewMode === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <ListIcon className="w-3.5 h-3.5" /> {t('screens.viewList')}
            </button>
            <button onClick={() => setViewMode('map')}
              className={`flex-1 sm:flex-none justify-center px-3 py-2 sm:py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors ${viewMode === 'map' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <MapIcon className="w-3.5 h-3.5" /> {t('screens.viewMap')}
            </button>
            <button
              onClick={() => setViewMode('floor')}
              className={`flex-1 sm:flex-none justify-center px-3 py-2 sm:py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors ${viewMode === 'floor' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              title={t('screens.viewFloorPlans')}
            >
              <MapPin className="w-3.5 h-3.5" /> {t('screens.viewFloor')}
            </button>
          </div>
          {/* Per-device OTA push lives inline on each row (download
              icon, hover-visible). Intentionally no tenant-wide
              "Push to all kiosks" button — the blast version was loud
              and duplicated the per-row action; if an operator wants
              to update all screens they can still do it one click per
              row, which matches the audit-trail pattern used
              elsewhere (one force-update log per device, not a vague
              "sent to everyone"). */}
          {/* Pair Screen / New Group only apply to the list / map views.
              On the Floor plans tab the equivalent action is "Upload
              floor plan", which FloorPlansView renders inline so the
              operator isn't reading a "Pair Screen" button while
              looking at building blueprints. */}
          {viewMode !== 'floor' && (
            <>
              <button onClick={() => { setShowPairModal(true); setPairGroupId(''); setPairCode(''); setPairName(''); setPairError(''); }}
                disabled={isViewer}
                title={isViewer ? 'Read-only — viewer role' : undefined}
                className="flex-1 sm:flex-none justify-center px-4 py-2.5 sm:py-2 text-white text-sm font-semibold rounded-lg shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'var(--brand-accent, var(--brand-primary, #4f46e5))' }}>
                <Wifi className="w-4 h-4" /> {t('screens.pairScreenBtn')}
              </button>
              <button onClick={() => setShowCreateGroup(true)}
                disabled={isViewer}
                title={isViewer ? 'Read-only — viewer role' : undefined}
                className="flex-1 sm:flex-none justify-center px-4 py-2.5 sm:py-2 text-white text-sm font-semibold rounded-lg shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'var(--brand-primary, #4f46e5)' }}>
                <Plus className="w-4 h-4" /> {t('screens.newGroupBtn')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Phase B closeout — fleet summary strip. Always visible at the top
          of /screens. Computes counters off `flatScreens` (already loaded)
          so this has zero extra network cost. The strip surfaces the four
          numbers a district admin asks about every morning:
            ONLINE / OFFLINE / EMERGENCY-ACTIVE / CANARY-IN-PROGRESS
          For SUPER_ADMIN viewing this page while supervising a tenant,
          the same strip shows that tenant's counts (the SUPER cross-tenant
          rollup lives on /super, not here). */}
      {/* Child location → one-click back up to the parent's dashboard fleet
          view. Renders null for top-level tenants / when the user can't reach
          a parent, so it's safe to mount unconditionally. */}
      <ReturnToFleetBanner />

      <FleetSummaryStrip screens={flatScreens} />

      {/* Sprint 8 — fleet map view (only when toggled on) */}
      {viewMode === 'map' && (
        <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-5 space-y-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <MapIcon className="w-4 h-4" style={{ color: 'var(--brand-primary, #6366f1)' }} /> Fleet map
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Every screen with an address. Pin colors show live status — emergency-active screens pulse red. Click a pin for details.
            </p>
          </div>
          <ScreenMapClient
            screens={flatScreens.map(s => ({
              id: s.id, name: s.name, status: s.status,
              // The API hydrates effectiveLatitude/Longitude from the
              // screen's own lat/lng first, then falls back to the
              // tenant's building-address coords (set via the location
              // address autocomplete on /settings). Per-screen "Set
              // location" still wins; this keeps building screens
              // visible on the map even before precise pins are dropped.
              latitude: s.effectiveLatitude ?? s.latitude,
              longitude: s.effectiveLongitude ?? s.longitude,
              address: s.effectiveAddress ?? s.address,
              geoSource: s.geoSource,
              lastPingAt: s.lastPingAt,
              lastCacheReport: s.lastCacheReport,
            }))}
          />
          {flatScreens.length > 0 && (
            <p className="text-[11px] text-slate-400">
              Tip: every screen lands at its building&apos;s address by default. To drop a more precise pin, open the screen card and click <span className="font-bold">📍 Set location</span>.
            </p>
          )}
        </div>
      )}

      {/* Floor plans tab body — Sprint 8b grid rendered inline so the
          operator stays in the Screens tab UI when switching views.
          Drilling into an individual plan still routes to
          /floor-plans/[id] where the pin editor lives. */}
      {viewMode === 'floor' && <FloorPlansView embedded />}

      {/* List + Map tab bodies — banner, group form, groups list.
          Hidden when the operator's on the Floor plans tab so the page
          doesn't show two competing fleet views at once. The FleetSummary
          strip + Map block above ARE still visible on the Map tab
          (existing additive behavior — operators reading the map often
          want the list nearby for a status cross-check). */}
      {viewMode !== 'floor' && (
      <>
      {/* How it works banner */}
      <div className="bg-gradient-to-br from-emerald-50 to-teal-50/50 rounded-3xl border-transparent p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <h3 className="text-sm font-bold text-slate-800 mb-4">{t('screens.howToConnect')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="flex gap-3.5 items-center">
            <div className="w-10 h-10 rounded-2xl text-white flex items-center justify-center text-sm font-black shrink-0" style={{ background: 'var(--brand-primary, #4f46e5)', boxShadow: '0 1px 2px color-mix(in srgb, var(--brand-primary, #4f46e5) 30%, transparent)' }}>1</div>
            <div>
              <p className="text-sm font-bold text-slate-700">{t('screens.step1')}</p>
              <p className="text-xs text-slate-500">{t('screens.step1Sub')}</p>
            </div>
          </div>
          <div className="flex gap-3.5 items-center">
            <div className="w-10 h-10 rounded-2xl text-white flex items-center justify-center text-sm font-black shrink-0" style={{ background: 'var(--brand-primary, #4f46e5)', boxShadow: '0 1px 2px color-mix(in srgb, var(--brand-primary, #4f46e5) 30%, transparent)' }}>2</div>
            <div>
              <p className="text-sm font-bold text-slate-700">{t('screens.step2')}</p>
              <p className="text-xs text-slate-500">{t('screens.step2Sub')}</p>
            </div>
          </div>
          <div className="flex gap-3.5 items-center">
            <div className="w-10 h-10 rounded-2xl text-white flex items-center justify-center text-sm font-black shrink-0" style={{ background: 'var(--brand-primary, #4f46e5)', boxShadow: '0 1px 2px color-mix(in srgb, var(--brand-primary, #4f46e5) 30%, transparent)' }}>3</div>
            <div>
              <p className="text-sm font-bold text-slate-700">{t('screens.step3')}</p>
              <p className="text-xs text-slate-500">{t('screens.step3Sub')}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-6 pt-4 border-t border-emerald-100/50">
          <code className="flex-1 px-4 py-2.5 bg-white rounded-xl text-sm font-mono text-slate-700 select-all shadow-sm">
            {playerUrl}
          </code>
          <CopyUrlButton url={playerUrl} />
        </div>
      </div>

      {/* Create Group Form */}
      {showCreateGroup && (
        <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
          <h3 className="text-sm font-bold text-slate-800 mb-3">{t('screens.newGroup')}</h3>
          <div className="flex gap-3">
            <input ref={newGroupInputRef} value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)}
              placeholder={t('screens.groupNamePlaceholder')}
              className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2"
              style={{ '--tw-ring-color': 'var(--brand-primary, #6366f1)' } as React.CSSProperties}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()} />
            <button onClick={handleCreateGroup} disabled={createGroup.isPending}
              className="px-4 py-2 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
              style={{ background: 'var(--brand-primary, #4f46e5)' }}>
              {createGroup.isPending ? 'Creating...' : 'Create'}
            </button>
            <button onClick={() => setShowCreateGroup(false)} className="px-3 py-2 text-slate-400 hover:text-slate-600 text-sm">{t('screens.cancel')}</button>
          </div>
        </div>
      )}

      {isLoading && <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--brand-primary, #6366f1)' }} /></div>}

      {/* Load error — surface the failure instead of falling through to
          the "No Screen Groups Yet" empty state, which would make an
          outage look like an empty fleet. */}
      {isError && !isLoading && (
        <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center">
          <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Couldn&apos;t load your screens. Check your connection and try again.</p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 rounded-lg text-white text-sm font-semibold inline-flex items-center gap-1.5"
            style={{ background: 'var(--brand-primary, #4f46e5)' }}
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      )}

      {/* Groups */}
      {groups && (
        <div className="space-y-6">
          {groups.map((group: any) => {
            const screens = group.screens || [];
            const online = screens.filter((s: any) => s.status === 'ONLINE').length;

            return (
              <div key={group.id} className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
                <div className="px-6 py-5 flex justify-between items-center bg-slate-50/30">
                  <div className="flex items-center gap-4">
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--brand-primary, #6366f1) 10%, white)' }}>
                      <MonitorPlay className="w-5 h-5" style={{ color: 'var(--brand-primary, #4f46e5)' }} />
                    </div>
                    <div>
                      {editingGroupId === group.id ? (
                        <input
                          autoFocus
                          value={editGroupName}
                          onChange={(e) => setEditGroupName(e.target.value)}
                          onBlur={() => {
                            const n = editGroupName.trim();
                            if (n && n !== group.name) updateGroup.mutate({ id: group.id, name: n });
                            setEditingGroupId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const n = editGroupName.trim();
                              if (n && n !== group.name) updateGroup.mutate({ id: group.id, name: n });
                              setEditingGroupId(null);
                            } else if (e.key === 'Escape') {
                              setEditingGroupId(null);
                            }
                          }}
                          aria-label="Group name"
                          className="text-[15px] font-bold text-slate-800 bg-white border border-indigo-300 rounded-lg px-2 py-0.5 outline-none focus:ring-2 focus:ring-indigo-400 max-w-[220px]"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setEditingGroupId(group.id); setEditGroupName(group.name); }}
                          title={t('screens.clickToRenameGroup')}
                          className="text-[15px] font-bold text-slate-800 text-left hover:text-indigo-600 transition-colors"
                        >
                          {group.name}
                        </button>
                      )}
                      <p className="text-xs font-medium text-slate-400 mt-0.5">
                        {screens.length} {screens.length === 1 ? 'screen' : 'screens'}
                        {online > 0 && <span className="text-emerald-500 ml-1.5">• {online} online</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2.5">
                    {/* 2026-07-28 — frame-locked multi-screen sync toggle.
                        One button, no sub-settings: every screen in the
                        group plays the shared schedule on a shared clock,
                        flips landing within a frame of each other. Screens
                        pick the change up on their next manifest poll
                        (~10s), then lock in ~2s. */}
                    <button
                      onClick={() => updateGroup.mutate({ id: group.id, syncMode: group.syncMode === 'locked' ? 'off' : 'locked' })}
                      className={`px-4 py-2 transition-colors text-xs font-bold rounded-xl flex items-center gap-1.5 ${
                        group.syncMode === 'locked'
                          ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-[0_4px_12px_rgb(99,102,241,0.35)]'
                          : 'bg-white border border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'
                      }`}
                      title={group.syncMode === 'locked'
                        ? 'Frame-lock is ON — screens in this group play in perfect sync. Click to turn off.'
                        : 'Frame-lock this group: all its screens play the same content at the same instant (flips land within a frame). Publish the same playlist to the group, then watch the SYNC badges go green.'}
                    >
                      <Radio className="w-4 h-4" /> {group.syncMode === 'locked' ? 'Synced' : 'Sync'}
                    </button>
                    {/* Tier-3 — camera auto-calibration entry point. Only
                        meaningful once the group is frame-locked. */}
                    {group.syncMode === 'locked' && (
                      <a
                        href={`/${schoolId}/screens/sync-calibrate?groupId=${group.id}`}
                        className="px-3 py-2 transition-colors text-xs font-bold rounded-xl flex items-center gap-1.5 bg-white border border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
                        title="Point your phone camera at these screens and the wizard measures each display's true glass latency and sets the trims for you — like an AV receiver's mic calibration, for video walls."
                      >
                        <Camera className="w-4 h-4" /> Calibrate
                      </a>
                    )}
                    {/* 2026-05-26 — operator: "just add a pair screen
                        to group button in the top right of each group
                        so it makes more sense, maybe a little + sign
                        and the word Pair". Replaced the Wifi-icon
                        "Pair to Group" label with a clearer "+ Pair"
                        affordance. */}
                    <button onClick={() => { setShowPairModal(true); setPairGroupId(group.id); setPairCode(''); setPairName(''); setPairError(''); }}
                      className="screens-pair-btn px-4 py-2 transition-colors text-xs font-bold rounded-xl flex items-center gap-1.5"
                      title={t('screens.pairToGroup')}>
                      <Plus className="w-4 h-4" /> Pair
                    </button>
                    <button onClick={async () => { if (await appConfirm({ title: t('screens.deleteGroupTitle'), message: `"${group.name}" will be deleted. Screens in it won't be deleted.`, tone: 'danger', confirmLabel: 'Delete' })) deleteGroup.mutate(group.id); }}
                      className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {screens.length > 0 ? (
                  <div className="p-2 space-y-1">
                    {screens.map((screen: any) => (
                      // Mobile (<sm): reflow this desktop flex row into a
                      // stacked card — identity line, a wrapping status
                      // line, then a 44px-target action row — so the
                      // delete/location/gear buttons stop rendering off
                      // the right edge. The three `sm:contents` wrappers
                      // dissolve on desktop, leaving the original single
                      // `flex items-center gap-3.5` row byte-for-byte.
                      <div key={screen.id} className="px-4 py-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3.5 group/item hover:bg-slate-50 rounded-2xl transition-colors cursor-default">
                        <div className="flex items-center gap-3.5 min-w-0 sm:contents">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 shadow-sm ${screen.status === 'ONLINE' ? 'bg-emerald-500 shadow-emerald-500/50 animate-pulse' : 'bg-slate-300'}`} />
                        <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                          <OsIcon os={screen.osInfo} status={screen.status} />
                        </div>
                        <div className="flex-1 min-w-0">
                          {editingScreen === screen.id ? (
                            <div className="flex items-center gap-2">
                              <input ref={editNameInputRef} value={editName} onChange={e => setEditName(e.target.value)}
                                className="px-2 py-1 text-xs border border-indigo-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                onKeyDown={e => e.key === 'Enter' && handleRename(screen.id)} />
                              <button onClick={() => handleRename(screen.id)} className="text-emerald-600 hover:underline text-xs font-bold">{t('screens.save')}</button>
                              <button onClick={() => setEditingScreen(null)} className="text-slate-400 hover:text-slate-600 text-xs font-semibold">{t('screens.cancel')}</button>
                            </div>
                          ) : (
                            <button
                              className="screens-name-btn text-sm font-bold text-slate-700 transition-colors text-left"
                              onClick={() => { setEditingScreen(screen.id); setEditName(screen.name); }}
                              title={t('screens.clickToRename')}
                            >
                              {screen.name}
                            </button>
                          )}
                          <div className="flex flex-wrap gap-3 mt-1 text-[11px] font-medium text-slate-400">
                            {screen.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {screen.location}</span>}
                            {screen.resolution && <span>📐 {screen.resolution}</span>}
                            {screen.osInfo && <span>💻 {screen.osInfo}</span>}
                            {/* Hide the browser chip on Android APK players —
                                the WebView always reports itself as "Chrome
                                en-US" and operator (2026-04-27) called it
                                misleading: "why do you have a browser on the
                                android devices listed." Browser-only players
                                still show the chip + we surface the brand
                                separately in the PlayerKindChip glyph. */}
                            {screen.browserInfo && !((screen.osInfo || '').toLowerCase().includes('android')) && (
                              <span><Globe className="w-3 h-3 inline" /> {screen.browserInfo}</span>
                            )}
                            {screen.ipAddress && <span>🌐 {screen.ipAddress}</span>}
                            {/* Player version chip. Self-reported by the
                                Android APK on each /update-check (every 6h).
                                Always rendered so operators see at a glance
                                which screens haven't reported yet.
                                Operator (2026-04-27): "i should be able to
                                see the player version from the main screens
                                menu." Note: we used to try and detect "web
                                player" via browserInfo, but Android WebView
                                also reports as Chrome — false-positives on
                                APK installs. Now we just show v? until the
                                APK actually reports a version. */}
                            <PlayerKindChip screen={screen} />
                            {/* Inline component below; renders a platform-
                                aware chip — Android bot for APK players,
                                Chrome / Firefox / Safari / Edge / generic
                                Globe icon for browser players based on the
                                screen's browserInfo string. */}
                            {/* Real Chromium engine version (parsed from the
                                UA we already capture). Amber-flag screens below
                                Chrome 105 — those can't render container-query
                                (cqmin/cqh) templates; below 84 also lack flex
                                gap. Lets operators pick Taurus-safe content per
                                screen instead of guessing. */}
                            {typeof (screen as any).chromiumMajor === 'number' && (
                              <span
                                title={
                                  (screen as any).chromiumMajor < 105
                                    ? `Chrome ${(screen as any).chromiumMajor} — older engine. Container-query templates (cqmin/cqh)${(screen as any).chromiumMajor < 84 ? ' and flex-gap layouts' : ''} won't render correctly here. Use Taurus-safe templates (e.g. Animated Rainbow).`
                                    : `Chrome ${(screen as any).chromiumMajor} — modern engine, all templates supported.`
                                }
                                className={(screen as any).chromiumMajor < 105 ? 'text-amber-600 font-semibold' : 'text-slate-400'}
                              >
                                {(screen as any).chromiumMajor < 105 ? '⚠ ' : ''}Cr{(screen as any).chromiumMajor}
                              </span>
                            )}
                          </div>
                        </div>
                        </div>
                        {/* Status group — wraps onto its own line on mobile
                            (so the cramped pill cluster stops clipping),
                            dissolves to inline on desktop via sm:contents.
                            The cache chip gains a word label on mobile so
                            the bare 🛡️ emoji isn't the only signal. */}
                        <div className="flex flex-wrap items-center gap-2 sm:contents">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg ${
                          screen.status === 'ONLINE' ? 'bg-emerald-50 text-emerald-600'
                            : screen.status === 'PENDING' ? 'bg-amber-50 text-amber-600'
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                          {screen.status === 'ONLINE' ? t('screens.statusOnline') : screen.status === 'PENDING' ? t('screens.statusPending') : t('screens.statusOffline')}
                        </span>
                        {/* 2026-07-28 — frame-locked sync health chip. Only on
                            locked groups + online screens. Green = locked, with
                            the honest ± (worse of flip error / clock
                            uncertainty). Grey ≠ = this screen resolved
                            DIFFERENT content than its group siblings (e.g. a
                            per-screen schedule overrides the group's) — sync
                            can't hold across different playlists. Amber =
                            enabled but not locked yet (or telemetry stale). */}
                        {group.syncMode === 'locked' && screen.status === 'ONLINE' && (() => {
                          const r: any = (screen as any).lastSyncReport;
                          const atRaw = (screen as any).lastSyncReportAt;
                          const at = atRaw ? new Date(atRaw).getTime() : 0;
                          const fresh = !!at && Date.now() - at < 120_000;
                          if (fresh && r) {
                            const sigs = (screens as any[])
                              .map((s: any) => s?.lastSyncReport?.contentSig)
                              .filter(Boolean) as string[];
                            const counts = new Map<string, number>();
                            for (const sg of sigs) counts.set(sg, (counts.get(sg) ?? 0) + 1);
                            let modalSig: string | null = null; let best = 0;
                            for (const [sg, c] of counts) if (c > best) { best = c; modalSig = sg; }
                            if (r.contentSig && modalSig && sigs.length > 1 && r.contentSig !== modalSig) {
                              return (
                                <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500"
                                  title="This screen is playing different content than the rest of its group (a per-screen schedule likely overrides the group's). Screens can only frame-lock while showing the same playlist.">
                                  ≠ content
                                </span>
                              );
                            }
                            if (r.locked) {
                              const ms = Math.max(1, Math.round(Math.max(Number(r.errMs) || 0, Number(r.clockUncertaintyMs) || 0)));
                              // Tier-1/2 — network-quality coaching: chronic
                              // jitter is an installer problem (WiFi), not a
                              // software one. Say so instead of looking flaky.
                              const jittery = (Number(r.rttMs) || 0) > 150 || (Number(r.clockUncertaintyMs) || 0) > 25;
                              const detail = `flip ${r.errMs ?? '—'}ms · clock ±${r.clockUncertaintyMs ?? '—'}ms · rtt ${r.rttMs ?? '—'}ms · pipeline lead ${r.renderLeadMs ?? '—'}ms · crystal ${r.skewPpm ?? '—'}ppm`;
                              return (
                                <span
                                  className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg ${jittery ? 'bg-amber-50 text-amber-700' : 'bg-indigo-50 text-indigo-600'}`}
                                  title={
                                    jittery
                                      ? `Frame-locked, but this screen's network is jittery (${detail}). Sync is fighting it with faster sampling — for the tightest lock, run wired Ethernet to this screen.`
                                      : `Frame-locked. Clock agreement ±${ms}ms — flips land within a frame of the group. (${detail})`
                                  }
                                >
                                  sync ±{ms}ms{jittery ? ' ⚠' : ''}
                                </span>
                              );
                            }
                          }
                          return (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-amber-50 text-amber-600"
                              title="Sync is enabled for this group; this screen is still locking its clock (takes a few seconds after boot / toggle) or hasn't reported yet. If this persists, check the screen's network.">
                              sync…
                            </span>
                          );
                        })()}
                        {/* Emergency offline-cache readiness chip — green = assets on disk,
                            amber = no report yet, red = reported empty (would fetch from network) */}
                        {(() => {
                          const r: any = (screen as any).lastCacheReport;
                          if (!r) {
                            return <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-slate-100 text-slate-400" title="Player has not reported cache status yet">cache: ?</span>;
                          }
                          const emCount = r?.emergency?.count || 0;
                          if (emCount > 0) {
                            return <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700" title={`${emCount} emergency assets cached on disk`}>🛡️<span className="sm:hidden"> Cache ready</span><span className="hidden sm:inline"> ready</span></span>;
                          }
                          return <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700" title="No emergency assets cached — would fetch from network during an alert">🛡️<span className="sm:hidden"> No cache</span><span className="hidden sm:inline"> none</span></span>;
                        })()}
                        {screen.lastPingAt && (
                          // Relative "Xm ago" at a glance, full datetime in the
                          // tooltip. The old display was time-only — operators
                          // could never tell if "8:42 AM" was today or last week.
                          <span
                            className="text-[10px] font-medium text-slate-400 flex items-center gap-1 shrink-0 px-2"
                            title={`Last sync: ${fullDateTime(screen.lastPingAt)}`}
                          >
                            <Clock className="w-3 h-3" />
                            {timeAgo(screen.lastPingAt)}
                          </span>
                        )}
                        </div>
                        {/* Action group — on mobile this is a left-aligned
                            44px-target row above its own divider so every
                            control is on-screen + thumb-reachable; on
                            desktop sm:contents dissolves it back to the
                            trailing inline icon buttons. */}
                        <div className="flex items-center gap-2 pt-2 border-t border-slate-100 sm:contents sm:border-0 sm:pt-0">
                        {/* Sprint 8 — set or update map location. Always
                            visible now (was opacity-0 group-hover which
                            the operator reported as "weird — completely
                            hidden"). */}
                        <button
                          onClick={() => handleSetLocation(screen.id, screen.name, (screen as any).address)}
                          className={`flex items-center justify-center gap-1.5 h-11 px-3 sm:h-auto sm:p-2 bg-white border border-slate-100 rounded-lg transition-all shadow-sm ${
                            (screen as any).latitude != null
                              ? 'text-emerald-600 border-emerald-100 hover:bg-emerald-50'
                              : 'screens-ext-link text-slate-400'
                          }`}
                          title={(screen as any).latitude != null ? `On map: ${(screen as any).address || 'set'}` : 'Set map location'}
                        >
                          <MapPin className="w-4 h-4" />
                          <span className="sm:hidden text-xs font-semibold">{(screen as any).latitude != null ? 'Location' : 'Set location'}</span>
                        </button>
                        {/* Delete — also always visible. Still muted
                            grey by default; only turns red on hover, so
                            an accidental tap is one explicit step away
                            from triggering the mutate. */}
                        <button onClick={async () => { if (await appConfirm({ title: t('screens.deleteScreenTitle'), message: `"${screen.name}" will be removed and unpaired — this cannot be undone.`, tone: 'danger', confirmLabel: 'Delete' })) deleteScreen.mutate(screen.id); }}
                          className="flex items-center justify-center h-11 w-11 sm:h-auto sm:w-auto sm:p-2 bg-white border border-slate-100 rounded-lg text-slate-400 hover:text-red-500 hover:border-red-100 hover:bg-red-50 transition-all shadow-sm"
                          title={t('screens.deleteScreen')}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                        {/* Per-screen settings popover. ALWAYS visible
                            (no opacity-0 wrapper — the previous version
                            hid the gear until hover AND collapsed the
                            open popover when the mouse left the row,
                            which is why clicking just flashed the
                            header). Preview-in-browser now lives INSIDE
                            the menu instead of being its own icon. */}
                        <ScreenSettingsMenu
                          screen={screen}
                          pushState={apkPushState[screen.id]}
                          pending={forceApkUpdate.isPending}
                          onPushApk={() => handlePushApkUpdate(screen.id, screen.name, (screen as any).playerVersion ?? null)}
                          onRefreshWeb={() => handleRefreshWeb(screen.id, screen.name)}
                          refreshWebPending={refreshWeb.isPending}
                          previewHref={buildPreviewUrl(screen)}
                          groupSyncLocked={group.syncMode === 'locked'}
                        />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  // 2026-05-26 — operator: "the groups window is too
                  // large, it should be small and grow as you add
                  // more and more screens to it". Previous empty
                  // state was a `py-8` block with redundant "No
                  // screens paired" copy + a second "Pair a screen →"
                  // link in addition to the top-right Pair button.
                  // Collapsed to a single thin row so the card sizes
                  // to its content — the "+ Pair" button in the
                  // header is the only CTA the operator needs.
                  <div className="px-5 py-2 text-center">
                    <p className="text-[11px] text-slate-400">{t('screens.noScreensYet')} <span className="font-semibold text-slate-500">+ Pair</span></p>
                  </div>
                )}

                <div className="px-6 py-3 bg-slate-50/20 border-t border-slate-50 flex justify-between items-center rounded-b-3xl">
                  {group.schedules?.length > 0 ? (
                    <span className="text-[11px] text-emerald-600 font-bold flex items-center gap-2">
                      <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-sm shadow-emerald-500/50" />
                      Now Playing: {group.schedules[0].playlist?.name}
                      {group.schedules.length > 1 && <span className="text-slate-400 font-semibold ml-1">+{group.schedules.length - 1} more</span>}
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold text-slate-400">No playlist assigned</span>
                  )}
                  <span className="text-[11px] font-medium text-slate-400">{group._count?.schedules || 0} schedules</span>
                </div>
              </div>
            );
          })}

          {groups.length === 0 && (
            <div className="bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-12 text-center">
              <MonitorPlay className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-700">{t('screens.noGroupsTitle')}</h3>
              <p className="text-sm text-slate-500 mt-2 mb-4">{t('screens.noGroupsDesc')}</p>
              <button onClick={() => setShowCreateGroup(true)}
                className="px-4 py-2 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5"
                style={{ background: 'var(--brand-primary, #4f46e5)' }}>
                <Plus className="w-4 h-4" /> Create First Group
              </button>
            </div>
          )}

          {ungroupedScreens.length > 0 && (
            <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden mt-8">
              <div className="px-6 py-5 flex justify-between items-center bg-slate-50/30">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center">
                    <Monitor className="w-5 h-5 text-slate-500" />
                  </div>
                  <div>
                    <h3 className="text-[15px] font-bold text-slate-800">{t('screens.ungrouped')}</h3>
                    <p className="text-xs font-medium text-slate-400 mt-0.5">{t('screens.ungroupedDesc')}</p>
                  </div>
                </div>
              </div>
              <div className="p-2 space-y-1">
                {ungroupedScreens.map((screen: any) => (
                  // Mobile (<sm): same stacked-card reflow as the grouped
                  // rows — identity line, status line, action row — via
                  // sm:contents wrappers that dissolve on desktop.
                  <div key={screen.id} className="px-4 py-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3.5 group/item hover:bg-slate-50 rounded-2xl transition-colors cursor-default">
                    <div className="flex items-center gap-3.5 min-w-0 sm:contents">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 shadow-sm ${screen.status === 'ONLINE' ? 'bg-emerald-500 shadow-emerald-500/50 animate-pulse' : 'bg-slate-300'}`} />
                    <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                      <OsIcon os={screen.osInfo} status={screen.status} />
                    </div>
                    <div className="flex-1 min-w-0">
                      {editingScreen === screen.id ? (
                        <div className="flex items-center gap-2">
                          <input ref={editNameInputRef} value={editName} onChange={e => setEditName(e.target.value)}
                            className="px-2 py-1 text-xs border border-indigo-300 rounded-md focus:ring-2 focus:ring-indigo-500 outline-none"
                            onKeyDown={e => e.key === 'Enter' && handleRename(screen.id)} />
                          <button onClick={() => handleRename(screen.id)} className="text-emerald-600 hover:underline text-xs font-bold">{t('screens.save')}</button>
                          <button onClick={() => setEditingScreen(null)} className="text-slate-400 hover:text-slate-600 text-xs font-semibold">{t('screens.cancel')}</button>
                        </div>
                      ) : (
                        <button
                          className="screens-name-btn text-sm font-bold text-slate-700 transition-colors text-left"
                          onClick={() => { setEditingScreen(screen.id); setEditName(screen.name); }}
                          title={t('screens.clickToRename')}
                        >
                          {screen.name}
                        </button>
                      )}
                      <div className="flex flex-wrap gap-3 mt-1 text-[11px] font-medium text-slate-400">
                        {screen.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {screen.location}</span>}
                        {screen.resolution && <span>📐 {screen.resolution}</span>}
                        {screen.osInfo && <span>💻 {screen.osInfo}</span>}
                        {screen.browserInfo && <span><Globe className="w-3 h-3 inline" /> {screen.browserInfo}</span>}
                        {screen.ipAddress && <span>🌐 {screen.ipAddress}</span>}
                        {(screen as any).playerVersion && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold"
                            title={`APK v${(screen as any).playerVersion}${(screen as any).playerVersionAt ? ` · reported ${fullDateTime((screen as any).playerVersionAt)}` : ''}`}
                          >
                            <Download className="w-3 h-3" />
                            v{(screen as any).playerVersion}
                          </span>
                        )}
                      </div>
                    </div>
                    </div>
                    {/* Add to group dropdown — on mobile it's always
                        visible (touch has no hover; the old
                        opacity-0 group-hover made it permanently
                        unreachable on a phone) and full-width on its own
                        line; on desktop it keeps the hover-reveal
                        behavior in its original position. */}
                    <div className="opacity-100 sm:opacity-0 sm:group-hover/item:opacity-100 transition-opacity flex items-center gap-2 sm:mr-2">
                      <select
                        className="w-full sm:w-auto h-11 sm:h-auto text-xs sm:text-[10px] border border-slate-200 rounded-lg sm:rounded px-2.5 sm:px-1.5 py-1 bg-white outline-none"
                        onChange={(e) => {
                          if (e.target.value) {
                            updateScreen.mutateAsync({ id: screen.id, screenGroupId: e.target.value });
                          }
                        }}
                        value=""
                      >
                        <option value="" disabled>{t('screens.moveToGroup')}</option>
                        {groups?.map((g: any) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    </div>
                    {/* Status group — wraps to its own line on mobile,
                        inline on desktop via sm:contents. */}
                    <div className="flex flex-wrap items-center gap-2 sm:contents">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg ${
                      screen.status === 'ONLINE' ? 'bg-emerald-50 text-emerald-600'
                        : screen.status === 'PENDING' ? 'bg-amber-50 text-amber-600'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {screen.status === 'ONLINE' ? t('screens.statusOnline') : screen.status === 'PENDING' ? t('screens.statusPending') : t('screens.statusOffline')}
                    </span>
                    {screen.lastPingAt && (
                      <span
                        className="text-[10px] font-medium text-slate-400 flex items-center gap-1 shrink-0 px-2"
                        title={`Last sync: ${fullDateTime(screen.lastPingAt)}`}
                      >
                        <Clock className="w-3 h-3" />
                        {timeAgo(screen.lastPingAt)}
                      </span>
                    )}
                    </div>
                    {/* Action group — 44px-target row above its own
                        divider on mobile; sm:contents on desktop. */}
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-100 sm:contents sm:border-0 sm:pt-0">
                    <button onClick={async () => { if (await appConfirm({ title: t('screens.deleteScreenTitle'), message: `"${screen.name}" will be removed and unpaired — this cannot be undone.`, tone: 'danger', confirmLabel: 'Delete' })) deleteScreen.mutate(screen.id); }}
                      className="flex items-center justify-center h-11 w-11 sm:h-auto sm:w-auto sm:p-2 bg-white border border-slate-100 rounded-lg text-slate-400 hover:text-red-500 hover:border-red-100 hover:bg-red-50 transition-all shadow-sm"
                      title={t('screens.deleteScreen')}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {/* Gear popover — always visible; preview lives
                        inside the menu now, not as a separate icon. */}
                    <ScreenSettingsMenu
                      screen={screen}
                      pushState={apkPushState[screen.id]}
                      pending={forceApkUpdate.isPending}
                      onPushApk={() => handlePushApkUpdate(screen.id, screen.name, (screen as any).playerVersion ?? null)}
                      onRefreshWeb={() => handleRefreshWeb(screen.id, screen.name)}
                      refreshWebPending={refreshWeb.isPending}
                      previewHref={buildPreviewUrl(screen)}
                    />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      </>
      )}

      {/* ─── Pair Screen Modal ─── */}
      {showPairModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={t('screens.pairScreen')}>
          <button className="absolute inset-0 cursor-default" aria-label={t('screens.closeDialog')} onClick={() => { setShowPairModal(false); }} />
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative z-10 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Wifi className="w-5 h-5 text-emerald-600" /> {t('screens.pairModalTitle')}
              </h3>
              <button onClick={() => { setShowPairModal(false); }} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-slate-500 mb-5">
              {t('screens.pairModalSubtitle')}
            </p>

            <div className="space-y-4">
              {/* 2026-05-27 round 2 — operator: "the screen needs to
                  tell us all those answers and not ask the end user
                  anything when pairing....the player should tell us
                  the device and all the info i need to know". Right.
                  The PairScreenHardwareStep that lived here asked
                  "What hardware?" + showed a recommendation card + an
                  I/O upsell list — none of which the operator should
                  fill out at pair time. The player APK already reports
                  Build.MANUFACTURER + Build.MODEL on its first
                  manifest call, and a follow-up wires that into
                  Screen.hardwareModel server-side so the dashboard
                  AUTO-DETECTS the device. The EP6N I/O upsells
                  (fire-alarm GPIO, panic button, HDMI capture, status
                  lamp) move to the per-screen settings page where
                  they belong — never block pairing. */}
              <div>
                <label htmlFor="pair-code-input" className="block text-xs font-semibold text-slate-600 mb-1.5">{t('screens.pairingCode')}</label>
                <input
                  id="pair-code-input"
                  ref={pairCodeInputRef}
                  value={pairCode}
                  onChange={e => setPairCode(e.target.value.toUpperCase())}
                  placeholder={t('screens.pairingCodePlaceholder')}
                  maxLength={6}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-center text-2xl font-mono font-bold tracking-[0.3em] outline-none focus:ring-2 focus:ring-emerald-500 uppercase"
                  onKeyDown={e => e.key === 'Enter' && handlePairScreen()}
                />
              </div>

              <div>
                <label htmlFor="pair-name-input" className="block text-xs font-semibold text-slate-600 mb-1.5">{t('screens.screenNameOptional')}</label>
                <input
                  id="pair-name-input"
                  value={pairName}
                  onChange={e => setPairName(e.target.value)}
                  placeholder={t('screens.screenNamePlaceholder')}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label htmlFor="pair-group-select" className="block text-xs font-semibold text-slate-600 mb-1.5">{t('screens.assignToGroup')}</label>
                <select
                  id="pair-group-select"
                  value={pairGroupId}
                  onChange={e => setPairGroupId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">{t('screens.noGroupAssignLater')}</option>
                  {groups?.map((g: any) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>

              {pairError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2">
                  <p className="text-sm text-red-600 font-medium">{pairError}</p>
                </div>
              )}

              <button
                onClick={handlePairScreen}
                disabled={pairing || pairCode.length < 6}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl flex items-center justify-center gap-2"
              >
                {pairing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                {pairing ? t('screens.pairing') : t('screens.pairScreenBtn')}
              </button>

              <button
                type="button"
                onClick={() => setShowQrForScan(v => !v)}
                disabled={pairCode.length < 4}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-sm font-semibold rounded-xl flex items-center justify-center gap-2"
                aria-expanded={showQrForScan}
                data-testid="scan-instead-button"
              >
                <QrCode className="w-4 h-4" />
                {showQrForScan ? t('screens.hideQr') : t('screens.scanWithPhone')}
              </button>

              {showQrForScan && qrDataUrl && (
                <div className="flex flex-col items-center gap-2 border border-slate-200 rounded-xl p-4" data-testid="pair-qr-container">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrDataUrl} alt="QR code to pair screen with phone" width={220} height={220} />
                  <p className="text-xs text-slate-500 text-center">
                    On your phone, open <code className="font-mono">/pair</code> and scan this code.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast shown after "Push APK update". Auto-dismisses in 6s. */}
      {apkUpdateToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 max-w-md animate-in slide-in-from-bottom-4 duration-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-sm font-medium">{apkUpdateToast}</span>
        </div>
      )}

      {/* Address-autocomplete modal (replaces the old free-text appPrompt
          that silently dropped rows from the map when Nominatim couldn't
          geocode the typed string). */}
      {locationModal && (
        <ScreenLocationModal
          screenName={locationModal.name}
          currentAddress={locationModal.address}
          onClose={() => setLocationModal(null)}
          onSave={async (body) => {
            await updateLocation.mutateAsync({ id: locationModal.id, ...body });
            refetch();
            refetchScreens();
          }}
        />
      )}
    </div>
  );
}
