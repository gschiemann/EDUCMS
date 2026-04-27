"use client";

import { MonitorPlay, Plus, Loader2, Trash2, MapPin, MonitorCheck, Wifi, WifiOff, X, Smartphone, Monitor, Laptop, Tv, Globe, Clock, ExternalLink, QrCode, Map as MapIcon, List as ListIcon, Download, CheckCircle2, Settings, RefreshCw, Tag } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useScreenGroups, useCreateScreenGroup, useDeleteScreenGroup, useDeleteScreen, useUpdateScreen, useScreens, useUpdateScreenLocation, useForceApkUpdate, useLatestPlayerVersion } from '@/hooks/use-api';
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ScreenMapClient } from '@/components/screens/ScreenMapClient';
import { ScreenLocationModal } from '@/components/screens/ScreenLocationModal';
import { apiFetch } from '@/lib/api-client';
import { useUIStore } from '@/store/ui-store';
import { useParams, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { appConfirm } from '@/components/ui/app-dialog';

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
  const v: string | null = screen?.playerVersion ?? null;
  const at: string | null = screen?.playerVersionAt ?? null;
  const osInfo: string = (screen?.osInfo || '').toLowerCase();
  const browser: string = (screen?.browserInfo || '').toLowerCase();

  const isAndroidApk = osInfo.includes('android');
  const baseClass = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide';

  if (isAndroidApk) {
    return (
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

function ScreenSettingsMenu({
  screen,
  pushState,
  pending,
  onPushApk,
  previewHref,
}: {
  screen: any;
  pushState: { at: number; priorVersion: string | null } | undefined;
  pending: boolean;
  onPushApk: () => void;
  previewHref: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Viewport-anchored position for the portalled popover. Recomputed
  // on open + scroll + resize so the menu stays glued to the gear even
  // if the list scrolls behind it.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  const updateAnchor = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    // Right-align the menu with the button's right edge, pinned 8px
    // below it. `right` is measured from the viewport's right edge
    // so CSS `right` px works cleanly.
    setAnchor({ top: r.bottom + 8, right: window.innerWidth - r.right });
  };

  useEffect(() => {
    if (!open) return;
    updateAnchor();
    const handleDoc = (e: MouseEvent) => {
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
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleReflow, true); // capture so we catch scroll inside ancestors
    window.addEventListener('resize', handleReflow);
    return () => {
      document.removeEventListener('mousedown', handleDoc);
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
  const stillWaiting = pushed && !updatedSincePush && pushedMsAgo < 5 * 60_000;
  const timedOut = pushed && !updatedSincePush && pushedMsAgo >= 5 * 60_000;
  // Stage labels — rough phases of an OTA install. Times are
  // worst-case-ish; the dashboard auto-flips to the green "installed"
  // state the moment lastPingAt's playerVersion reflects the new
  // build, which short-circuits these stages.
  const stage = !pushed ? '' :
    updatedSincePush ? 'installed' :
    pushedMsAgo < 15_000  ? 'sending'      :   // 0-15s   WS dispatch + bridge call
    pushedMsAgo < 60_000  ? 'downloading'  :   // 15-60s  APK download
    pushedMsAgo < 150_000 ? 'installing'   :   // 60-150s install prompt + replace
    pushedMsAgo < 300_000 ? 'restarting'   :   // 150-300s screen reboot + first heartbeat
                            'timeout';

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
      className="fixed w-64 rounded-xl bg-white border border-slate-200 shadow-[0_12px_32px_rgba(15,23,42,0.18)] overflow-hidden z-[9999]"
      style={anchor ? { top: anchor.top, right: anchor.right } : { top: -9999, right: 0 }}
    >
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
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Player version</div>
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <div>
                <div className="text-slate-400">Current</div>
                <div className="font-bold text-slate-800">
                  {currentVersion ? `v${currentVersion}` : 'Not reported'}
                </div>
              </div>
              <div className="text-slate-300">→</div>
              <div className="text-right">
                <div className="text-slate-400">Latest</div>
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
              {upToDate === false && (
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

          {/* Push APK update — single source of truth for the action.
              Live "in progress" state is owned by the strip below
              (sending → downloading → installing → restarting →
              installed) so we don't double-message here. The button
              always shows the action label, just disables itself
              while a push is in flight. */}
          <button
            type="button"
            onClick={onPushApk}
            disabled={pending || stillWaiting || (upToDate === true && !pushed)}
            className="w-full flex items-center gap-3 px-3.5 py-3 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed border-b border-slate-100"
            title={upToDate === true && !pushed ? 'Already on the latest version' : 'Tells this kiosk to download + install the latest APK on its next check-in'}
          >
            <RefreshCw className={`w-4 h-4 shrink-0 ${upToDate === false ? 'text-amber-500' : 'text-indigo-500'}`} />
            <span className="flex-1 min-w-0">
              <span className="block">
                {upToDate === true && !pushed
                  ? 'On latest — push anyway'
                  : upToDate === false
                    ? `Push update to v${latestVersion}`
                    : 'Push update to this screen'}
              </span>
              <span className="block text-[10px] font-normal text-slate-400 mt-0.5">
                Manual only — auto-update is OFF unless you toggle it in Settings
              </span>
            </span>
          </button>

          {/* Push feedback strip — only when a push has been sent. Each
              stage corresponds to a real phase of the OTA install
              pipeline (WS hop → download → install → restart). Flips to
              the green "installed" state the moment lastPingAt's
              playerVersion reflects the new build — usually within
              ~30s of the install completing thanks to the heartbeat
              version capture. */}
          {pushed && (updatedSincePush || stillWaiting || timedOut) && (
            <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-100 text-[11px] leading-snug">
              {stage === 'installed' && (
                <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Kiosk installed v{currentVersion} ✓
                </span>
              )}
              {stage === 'sending' && (
                <span className="inline-flex items-center gap-1.5 text-indigo-700">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  Sending update signal to kiosk…
                </span>
              )}
              {stage === 'downloading' && (
                <span className="inline-flex items-center gap-1.5 text-indigo-700">
                  <Download className="w-3.5 h-3.5 animate-pulse shrink-0" />
                  Kiosk downloading new APK…
                </span>
              )}
              {stage === 'installing' && (
                <span className="inline-flex items-center gap-1.5 text-indigo-700">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  Installing on kiosk… (Android prompt may show on screen)
                </span>
              )}
              {stage === 'restarting' && (
                <span className="inline-flex items-center gap-1.5 text-indigo-700">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                  Kiosk restarting + reporting back…
                </span>
              )}
              {stage === 'timeout' && (
                <span className="inline-flex items-start gap-1 text-amber-700">
                  <WifiOff className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>No response after 5 minutes — check Wi-Fi + Android &ldquo;Install unknown apps&rdquo; permission. The kiosk will still pick up the update on its next boot.</span>
                </span>
              )}
            </div>
          )}

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
        title="Screen settings"
        aria-haspopup="true"
        aria-expanded={open}
        className="p-2 bg-white border border-slate-100 rounded-lg text-slate-400 hover:text-slate-800 hover:border-slate-300 hover:bg-slate-50 transition-all shadow-sm"
      >
        <Settings className="w-4 h-4" />
      </button>
      {/* Render into document.body via portal so no ancestor's
          overflow:hidden (the group card's rounded-corner clip, the
          divide-y wrapper, etc.) can clip the menu. Previous version
          used a normal absolute child — it was getting trimmed by the
          group card's bottom edge on every row except the last. */}
      {open && typeof document !== 'undefined' && createPortal(menu, document.body)}
    </div>
  );
}

export default function ScreensPage() {
  const { data: groups, isLoading, refetch } = useScreenGroups();
  const { data: allScreens, refetch: refetchScreens } = useScreens();
  const userRole = useUIStore((s) => s.user?.role);
  const isViewer = userRole === 'RESTRICTED_VIEWER';
  // Sprint 8 — fleet map view. Toggle persists in URL via search param so a
  // bookmarked map link still opens the map.
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
  const deleteScreen = useDeleteScreen();
  const updateScreen = useUpdateScreen();
  const forceApkUpdate = useForceApkUpdate();
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

  // Screens not assigned to any group
  const ungroupedScreens = (allScreens || []).filter((s: any) => !s.screenGroupId);

  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [showPairModal, setShowPairModal] = useState(false);
  const [pairGroupId, setPairGroupId] = useState<string>('');
  const [pairCode, setPairCode] = useState('');
  const [pairName, setPairName] = useState('');
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState('');
  const [editingScreen, setEditingScreen] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
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
      await apiFetch('/screens/pair', {
        method: 'POST',
        body: JSON.stringify({
          pairingCode: pairCode.trim().toUpperCase(),
          name: pairName.trim() || undefined,
          screenGroupId: pairGroupId || undefined,
        }),
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
        .screens-pair-btn { background: color-mix(in srgb, var(--brand-primary, #059669) 10%, white); color: var(--brand-primary, #059669); }
        .screens-pair-btn:hover { background: var(--brand-primary, #059669); color: white; }
        .screens-name-btn:hover { color: var(--brand-primary, #4f46e5); }
        .screens-ext-link:hover { color: var(--brand-primary, #4f46e5); border-color: color-mix(in srgb, var(--brand-primary, #4f46e5) 30%, transparent); background: color-mix(in srgb, var(--brand-primary, #4f46e5) 5%, white); }
      `}</style>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
            <MonitorPlay className="w-7 h-7" style={{ color: 'var(--brand-primary, #6366f1)' }} />
            Screens
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Pair devices, organize into groups, and manage your display fleet.</p>
        </div>
        <div className="flex gap-2 items-center">
          {/* List / Map / Floor plans — three views of the same fleet.
              Floor plans was its own sidebar entry until 2026-04-27 when
              the operator pointed out "this is just another way to see
              screens"; the toggle replaces it cleanly. */}
          <div className="inline-flex bg-slate-100 rounded-lg p-0.5 border border-slate-200">
            <button onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors ${viewMode === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <ListIcon className="w-3.5 h-3.5" /> List
            </button>
            <button onClick={() => setViewMode('map')}
              className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors ${viewMode === 'map' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <MapIcon className="w-3.5 h-3.5" /> Map
            </button>
            <button
              onClick={() => router.push(`/${schoolId}/floor-plans`)}
              className="px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 text-slate-500 hover:text-slate-700 hover:bg-white/50 transition-colors"
              title="Open the floor plans editor (drag screens onto a building map)"
            >
              <MapPin className="w-3.5 h-3.5" /> Floor plans
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
          <button onClick={() => { setShowPairModal(true); setPairGroupId(''); setPairCode(''); setPairName(''); setPairError(''); }}
            disabled={isViewer}
            title={isViewer ? 'Read-only — viewer role' : undefined}
            className="px-4 py-2 text-white text-sm font-semibold rounded-lg shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--brand-accent, var(--brand-primary, #059669))' }}>
            <Wifi className="w-4 h-4" /> Pair Screen
          </button>
          <button onClick={() => setShowCreateGroup(true)}
            disabled={isViewer}
            title={isViewer ? 'Read-only — viewer role' : undefined}
            className="px-4 py-2 text-white text-sm font-semibold rounded-lg shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--brand-primary, #4f46e5)' }}>
            <Plus className="w-4 h-4" /> New Group
          </button>
        </div>
      </div>

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
              latitude: s.latitude, longitude: s.longitude,
              address: s.address, lastPingAt: s.lastPingAt,
              lastCacheReport: s.lastCacheReport,
            }))}
          />
          {flatScreens.length > 0 && (
            <p className="text-[11px] text-slate-400">
              Tip: open a screen card below and click <span className="font-bold">📍 Set location</span> to put it on the map.
            </p>
          )}
        </div>
      )}

      {/* How it works banner */}
      <div className="bg-gradient-to-br from-emerald-50 to-teal-50/50 rounded-3xl border-transparent p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <h3 className="text-sm font-bold text-slate-800 mb-4">How to Connect a Screen</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="flex gap-3.5 items-center">
            <div className="w-10 h-10 rounded-2xl text-white flex items-center justify-center text-sm font-black shrink-0" style={{ background: 'var(--brand-primary, #059669)', boxShadow: '0 1px 2px color-mix(in srgb, var(--brand-primary, #059669) 30%, transparent)' }}>1</div>
            <div>
              <p className="text-sm font-bold text-slate-700">Open the Player URL</p>
              <p className="text-xs text-slate-500">On any device browser</p>
            </div>
          </div>
          <div className="flex gap-3.5 items-center">
            <div className="w-10 h-10 rounded-2xl text-white flex items-center justify-center text-sm font-black shrink-0" style={{ background: 'var(--brand-primary, #059669)', boxShadow: '0 1px 2px color-mix(in srgb, var(--brand-primary, #059669) 30%, transparent)' }}>2</div>
            <div>
              <p className="text-sm font-bold text-slate-700">Get Pairing Code</p>
              <p className="text-xs text-slate-500">6 digits on screen</p>
            </div>
          </div>
          <div className="flex gap-3.5 items-center">
            <div className="w-10 h-10 rounded-2xl text-white flex items-center justify-center text-sm font-black shrink-0" style={{ background: 'var(--brand-primary, #059669)', boxShadow: '0 1px 2px color-mix(in srgb, var(--brand-primary, #059669) 30%, transparent)' }}>3</div>
            <div>
              <p className="text-sm font-bold text-slate-700">Pair it Here</p>
              <p className="text-xs text-slate-500">Click &quot;Pair Screen&quot;</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-6 pt-4 border-t border-emerald-100/50">
          <code className="flex-1 px-4 py-2.5 bg-white rounded-xl text-sm font-mono text-slate-700 select-all shadow-sm">
            {playerUrl}
          </code>
          <button onClick={() => navigator.clipboard?.writeText(playerUrl)}
            className="px-4 py-2.5 text-white text-sm font-bold rounded-xl shrink-0 shadow-sm transition-all focus:scale-95"
            style={{ background: 'var(--brand-primary, #059669)' }}>
            Copy URL
          </button>
        </div>
      </div>

      {/* Create Group Form */}
      {showCreateGroup && (
        <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
          <h3 className="text-sm font-bold text-slate-800 mb-3">New Screen Group</h3>
          <div className="flex gap-3">
            <input ref={newGroupInputRef} value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="e.g., Main Hallway, Cafeteria, Library"
              className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2"
              style={{ '--tw-ring-color': 'var(--brand-primary, #6366f1)' } as React.CSSProperties}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()} />
            <button onClick={handleCreateGroup} disabled={createGroup.isPending}
              className="px-4 py-2 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
              style={{ background: 'var(--brand-primary, #4f46e5)' }}>
              {createGroup.isPending ? 'Creating...' : 'Create'}
            </button>
            <button onClick={() => setShowCreateGroup(false)} className="px-3 py-2 text-slate-400 hover:text-slate-600 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {isLoading && <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--brand-primary, #6366f1)' }} /></div>}

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
                      <h3 className="text-[15px] font-bold text-slate-800">{group.name}</h3>
                      <p className="text-xs font-medium text-slate-400 mt-0.5">
                        {screens.length} {screens.length === 1 ? 'screen' : 'screens'}
                        {online > 0 && <span className="text-emerald-500 ml-1.5">• {online} online</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2.5">
                    <button onClick={() => { setShowPairModal(true); setPairGroupId(group.id); setPairCode(''); setPairName(''); setPairError(''); }}
                      className="screens-pair-btn px-4 py-2 transition-colors text-xs font-bold rounded-xl flex items-center gap-1.5">
                      <Wifi className="w-4 h-4" /> Pair to Group
                    </button>
                    <button onClick={async () => { if (await appConfirm({ title: 'Delete group?', message: `"${group.name}" will be deleted. Screens in it won't be deleted.`, tone: 'danger', confirmLabel: 'Delete' })) deleteGroup.mutate(group.id); }}
                      className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {screens.length > 0 ? (
                  <div className="p-2 space-y-1">
                    {screens.map((screen: any) => (
                      <div key={screen.id} className="px-4 py-3 flex items-center gap-3.5 group/item hover:bg-slate-50 rounded-2xl transition-colors cursor-default">
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
                              <button onClick={() => handleRename(screen.id)} className="text-emerald-600 hover:underline text-xs font-bold">Save</button>
                              <button onClick={() => setEditingScreen(null)} className="text-slate-400 hover:text-slate-600 text-xs font-semibold">Cancel</button>
                            </div>
                          ) : (
                            <button
                              className="screens-name-btn text-sm font-bold text-slate-700 transition-colors text-left"
                              onClick={() => { setEditingScreen(screen.id); setEditName(screen.name); }}
                              title="Click to rename"
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
                          </div>
                        </div>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg ${
                          screen.status === 'ONLINE' ? 'bg-emerald-50 text-emerald-600'
                            : screen.status === 'PENDING' ? 'bg-amber-50 text-amber-600'
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                          {screen.status || 'OFFLINE'}
                        </span>
                        {/* Emergency offline-cache readiness chip — green = assets on disk,
                            amber = no report yet, red = reported empty (would fetch from network) */}
                        {(() => {
                          const r: any = (screen as any).lastCacheReport;
                          if (!r) {
                            return <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-slate-100 text-slate-400" title="Player has not reported cache status yet">cache: ?</span>;
                          }
                          const emCount = r?.emergency?.count || 0;
                          if (emCount > 0) {
                            return <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700" title={`${emCount} emergency assets cached on disk`}>🛡️ ready</span>;
                          }
                          return <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700" title="No emergency assets cached — would fetch from network during an alert">🛡️ none</span>;
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
                        {/* Sprint 8 — set or update map location. Always
                            visible now (was opacity-0 group-hover which
                            the operator reported as "weird — completely
                            hidden"). */}
                        <button
                          onClick={() => handleSetLocation(screen.id, screen.name, (screen as any).address)}
                          className={`p-2 bg-white border border-slate-100 rounded-lg transition-all shadow-sm ${
                            (screen as any).latitude != null
                              ? 'text-emerald-600 border-emerald-100 hover:bg-emerald-50'
                              : 'screens-ext-link text-slate-400'
                          }`}
                          title={(screen as any).latitude != null ? `On map: ${(screen as any).address || 'set'}` : 'Set map location'}
                        >
                          <MapPin className="w-4 h-4" />
                        </button>
                        {/* Delete — also always visible. Still muted
                            grey by default; only turns red on hover, so
                            an accidental tap is one explicit step away
                            from triggering the mutate. */}
                        <button onClick={() => deleteScreen.mutate(screen.id)}
                          className="p-2 bg-white border border-slate-100 rounded-lg text-slate-400 hover:text-red-500 hover:border-red-100 hover:bg-red-50 transition-all shadow-sm"
                          title="Delete screen">
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
                          previewHref={buildPreviewUrl(screen)}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-5 py-8 text-center">
                    <p className="text-xs text-slate-400">No screens paired to this group yet.</p>
                    <button onClick={() => { setShowPairModal(true); setPairGroupId(group.id); setPairCode(''); setPairName(''); setPairError(''); }}
                      className="text-xs font-semibold text-emerald-600 hover:underline mt-1">
                      Pair a screen →
                    </button>
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
              <h3 className="text-lg font-semibold text-slate-700">No Screen Groups Yet</h3>
              <p className="text-sm text-slate-500 mt-2 mb-4">Create a group, then pair screens to it.</p>
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
                    <h3 className="text-[15px] font-bold text-slate-800">Ungrouped Screens</h3>
                    <p className="text-xs font-medium text-slate-400 mt-0.5">Screens paired but not assigned to a group</p>
                  </div>
                </div>
              </div>
              <div className="p-2 space-y-1">
                {ungroupedScreens.map((screen: any) => (
                  <div key={screen.id} className="px-4 py-3 flex items-center gap-3.5 group/item hover:bg-slate-50 rounded-2xl transition-colors cursor-default">
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
                          <button onClick={() => handleRename(screen.id)} className="text-emerald-600 hover:underline text-xs font-bold">Save</button>
                          <button onClick={() => setEditingScreen(null)} className="text-slate-400 hover:text-slate-600 text-xs font-semibold">Cancel</button>
                        </div>
                      ) : (
                        <button
                          className="screens-name-btn text-sm font-bold text-slate-700 transition-colors text-left"
                          onClick={() => { setEditingScreen(screen.id); setEditName(screen.name); }}
                          title="Click to rename"
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
                    {/* Add to group dropdown */}
                    <div className="opacity-0 group-hover/item:opacity-100 transition-opacity flex items-center gap-2 mr-2">
                      <select 
                        className="text-[10px] border border-slate-200 rounded px-1.5 py-1 bg-white outline-none"
                        onChange={(e) => {
                          if (e.target.value) {
                            updateScreen.mutateAsync({ id: screen.id, screenGroupId: e.target.value });
                          }
                        }}
                        value=""
                      >
                        <option value="" disabled>Move to group...</option>
                        {groups?.map((g: any) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg ${
                      screen.status === 'ONLINE' ? 'bg-emerald-50 text-emerald-600'
                        : screen.status === 'PENDING' ? 'bg-amber-50 text-amber-600'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {screen.status || 'OFFLINE'}
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
                    <button onClick={() => deleteScreen.mutate(screen.id)}
                      className="p-2 bg-white border border-slate-100 rounded-lg text-slate-400 hover:text-red-500 hover:border-red-100 hover:bg-red-50 transition-all shadow-sm"
                      title="Delete screen">
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {/* Gear popover — always visible; preview lives
                        inside the menu now, not as a separate icon. */}
                    <ScreenSettingsMenu
                      screen={screen}
                      pushState={apkPushState[screen.id]}
                      pending={forceApkUpdate.isPending}
                      onPushApk={() => handlePushApkUpdate(screen.id, screen.name, (screen as any).playerVersion ?? null)}
                      previewHref={buildPreviewUrl(screen)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Pair Screen Modal ─── */}
      {showPairModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Pair a Screen">
          <button className="absolute inset-0 cursor-default" aria-label="Close dialog" onClick={() => setShowPairModal(false)} />
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative z-10">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Wifi className="w-5 h-5 text-emerald-600" /> Pair a Screen
              </h3>
              <button onClick={() => setShowPairModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-slate-500 mb-5">
              Enter the 6-digit code shown on the screen device.
            </p>

            <div className="space-y-4">
              <div>
                <label htmlFor="pair-code-input" className="block text-xs font-semibold text-slate-600 mb-1.5">Pairing Code</label>
                <input
                  id="pair-code-input"
                  ref={pairCodeInputRef}
                  value={pairCode}
                  onChange={e => setPairCode(e.target.value.toUpperCase())}
                  placeholder="e.g., ABC123"
                  maxLength={6}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-center text-2xl font-mono font-bold tracking-[0.3em] outline-none focus:ring-2 focus:ring-emerald-500 uppercase"
                  onKeyDown={e => e.key === 'Enter' && handlePairScreen()}
                />
              </div>

              <div>
                <label htmlFor="pair-name-input" className="block text-xs font-semibold text-slate-600 mb-1.5">Screen Name (optional)</label>
                <input
                  id="pair-name-input"
                  value={pairName}
                  onChange={e => setPairName(e.target.value)}
                  placeholder="e.g., Lobby Display, Room 201"
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label htmlFor="pair-group-select" className="block text-xs font-semibold text-slate-600 mb-1.5">Assign to Group</label>
                <select
                  id="pair-group-select"
                  value={pairGroupId}
                  onChange={e => setPairGroupId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">-- No group (assign later) --</option>
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
                {pairing ? 'Pairing...' : 'Pair Screen'}
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
                {showQrForScan ? 'Hide QR code' : 'Scan instead with phone'}
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
