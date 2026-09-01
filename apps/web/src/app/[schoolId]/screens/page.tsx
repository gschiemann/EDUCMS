"use client";

/**
 * /[schoolId]/screens — Calm Operations v3, with the classic page one click
 * away (2026-08-31).
 *
 * Design contract: scratch/design/screens-menu/SCREEN-OPERATIONS-V3-DESIGN-HANDOFF.md.
 * This file is the SWITCHER and the data layer; every pixel of the default
 * surface lives in `components/screens/v3/`, and the previous 3.2k-line page
 * is preserved verbatim as ./ClassicScreensPage.tsx.
 *
 * ── Two rules this file exists to keep ───────────────────────────────
 *
 * 1. NEVER PAINT THE WRONG VARIANT FIRST. The operator, hours before this
 *    shipped, on the dashboard's own rollback toggle: "everytime i click on
 *    the dashboard, i see the old classic dashboard for about .5 seconds and
 *    then the new one loads." The stored preference is read BEFORE either
 *    surface renders; until then a quiet skeleton holds the space. The read
 *    is a synchronous localStorage hit in a mount effect, so on a warm client
 *    navigation the skeleton is a single frame at most.
 *
 * 2. THE COMMON PATH PAYS FOR ONE SURFACE. The classic page is loaded with
 *    next/dynamic, so an operator on v3 never downloads it. Fleet-wide
 *    rollback is the ONE constant below.
 */

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, QrCode, Wifi, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  useDistrictReadiness, usePlaylists, useSchedules, useScreenGroups, useScreens,
  useUpdateScreenGroup, useUpdateScreenLocation,
} from '@/hooks/use-api';
import { apiFetch } from '@/lib/api-client';
import { useUIStore } from '@/store/ui-store';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import { ScreenMapClient } from '@/components/screens/ScreenMapClient';
import { ReturnToFleetBanner } from '@/components/screens/ReturnToFleetBanner';
import { ScreenLocationModal } from '@/components/screens/ScreenLocationModal';
import type { DisplayScheduleTargetRef } from '@/components/screens/DisplayScheduleModal';
import { ScreenOperationsV3, type ScreensViewMode } from '@/components/screens/v3/ScreenOperationsV3';
import type { FilterKey, OpsScreen, ReadinessInput } from '@/components/screens/v3/screenOps';

/**
 * FLEET-WIDE ROLLBACK: flip this one constant to 'classic' and every operator
 * who has not made their own choice lands on the previous page. No deploy of
 * the v3 tree is removed; nothing else changes.
 */
const SCREENS_VIEW_DEFAULT: 'v3' | 'classic' = 'v3';
const VIEW_PREF_KEY = 'venueos_screens_view';

/**
 * The classic page is ~3.2k lines and pulls the whole per-screen settings
 * world with it. Lazy so the default path never downloads it. `ssr: false`
 * because it reads window on mount (deep links, preview URLs) — and because
 * the switcher above it has already decided which surface to paint.
 */
const ClassicScreensPage = dynamic(() => import('./ClassicScreensPage'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--brand-primary, #6366f1)' }} />
    </div>
  ),
});

/**
 * Two more surfaces an operator has to ASK for — the floor-plan grid and the
 * on/off schedule editor. Both are also imported by the classic page, so
 * splitting them here keeps one copy in the build rather than one per route
 * chunk, and keeps them off the default Screens paint entirely.
 */
const FloorPlansView = dynamic(
  () => import('@/components/screens/FloorPlansView').then((m) => m.FloorPlansView),
  {
    ssr: false,
    loading: () => (
      <div className="h-72 rounded-2xl bg-white border border-slate-200 animate-pulse" aria-label="Loading floor plans" />
    ),
  },
);
const DisplayScheduleModal = dynamic(
  () => import('@/components/screens/DisplayScheduleModal').then((m) => m.DisplayScheduleModal),
  { ssr: false, loading: () => null },
);
/** Device-first connect paths (APK / media player / browser) — below the fleet. */
const ConnectScreenCard = dynamic(
  () => import('@/components/screens/ConnectScreenCard').then((m) => m.ConnectScreenCard),
  { ssr: false, loading: () => null },
);

/** Portrait/landscape from a free-text resolution — mirrors the classic page. */
function orientationFromResolution(res?: string | null): 'portrait' | 'landscape' {
  if (!res) return 'landscape';
  const m = res.match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/i);
  if (!m) return 'landscape';
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  if (!w || !h) return 'landscape';
  return h > w ? 'portrait' : 'landscape';
}

export default function ScreensPage() {
  const t = useTranslations();
  const userRole = useUIStore((s) => s.user?.role);
  const authToken = useUIStore((s) => s.token);
  // Mirrors the API's own @RequireRoles set for display control — a control a
  // role can never use must not render enabled for that role. Every write this
  // page can reach (pair, refresh-web, screen PUT, orientation, force-update,
  // delete, screen-group CRUD) carries exactly this decorator set, so this is
  // the ONLY write gate the v3 surface needs. It replaced a second
  // `isViewer` (RESTRICTED_VIEWER-only) gate that left CONTRIBUTORs looking at
  // enabled buttons the API answers with 403.
  const canControlDisplay =
    userRole === 'SUPER_ADMIN' || userRole === 'DISTRICT_ADMIN' || userRole === 'SCHOOL_ADMIN';
  // The readiness read is admin-only; a CONTRIBUTOR/VIEWER would 403, and a
  // 403 must show as "unknown", never as a zero.
  const readinessEligible = canControlDisplay;

  // ── which surface? (decide before painting either) ───────────────
  const [viewPref, setViewPref] = useState<'v3' | 'classic'>(SCREENS_VIEW_DEFAULT);
  const [prefLoaded, setPrefLoaded] = useState(false);
  /** A one-visit hop into classic (from "Full settings"), never persisted. */
  const [classicOnce, setClassicOnce] = useState(false);
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_PREF_KEY);
      if (v === 'classic' || v === 'v3') setViewPref(v);
    } catch { /* storage unavailable — the default stands */ }
    setPrefLoaded(true);
  }, []);
  const setView = (v: 'v3' | 'classic') => {
    setViewPref(v);
    setClassicOnce(false);
    try { localStorage.setItem(VIEW_PREF_KEY, v); } catch { /* ignore */ }
  };
  const showClassic = viewPref === 'classic' || classicOnce;

  // ── deep links, read once and stripped (§7 + the dashboard's link) ──
  const [deepLinkScreenId, setDeepLinkScreenId] = useState<string | null>(null);
  const [deepLinkFilter, setDeepLinkFilter] = useState<FilterKey | null>(null);
  const [viewMode, setViewMode] = useState<ScreensViewMode>('list');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // WAIT for the preference. Whether `?screen=` may be stripped here depends
    // on which surface will consume it — the classic page reads it off the URL
    // itself — and on the first pass `viewPref` is still the module default.
    // Running early would delete a classic operator's deep link.
    if (!prefLoaded) return;
    try {
      const sp = new URLSearchParams(window.location.search);
      const id = sp.get('screen');
      // `?filter=attention` — how a dashboard exception link asks this page to
      // land on the problem set (handoff §7). Tell the lead before dashboard
      // links adopt it; nothing links here with it yet.
      const f = sp.get('filter');
      const v = sp.get('view');
      if (v === 'map' || v === 'floor' || v === 'list') setViewMode(v);
      if (f === 'attention' || f === 'content-behind' || f === 'push-delayed' || f === 'offline') {
        setDeepLinkFilter(f);
      }
      if (id) setDeepLinkScreenId(id);
      if (!id && !f && !v) return;
      // The screen id is consumed by whichever surface renders; strip only
      // what we've taken so back/refresh never re-opens a drawer.
      sp.delete('filter');
      sp.delete('view');
      if (!showClassic) sp.delete('screen');
      const qs = sp.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    } catch { /* malformed URL — the list still renders */ }
    // Runs once: the classic page reads `?screen=` from the URL itself, so
    // this must not strip it before that page has mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefLoaded]);

  // ── data (unchanged endpoints; nothing new on the API side) ──────
  const screensQuery = useScreens();
  const groupsQuery = useScreenGroups();
  const schedulesQuery = useSchedules();
  const playlistsQuery = usePlaylists();
  const readinessQuery = useDistrictReadiness({ enabled: readinessEligible && !showClassic });
  const updateLocation = useUpdateScreenLocation();
  const updateGroup = useUpdateScreenGroup();

  const screens = useMemo(() => ((screensQuery.data as OpsScreen[] | undefined) ?? []), [screensQuery.data]);
  const groups = useMemo(
    () => (((groupsQuery.data as any[] | undefined) ?? []).map((g) => ({
      id: g.id, name: g.name, address: g.address ?? null, syncMode: g.syncMode ?? null,
    }))),
    [groupsQuery.data],
  );

  // ── deployed page-bundle SHA — the reference every row is graded on.
  // Fetched ONCE on mount, no interval (the app-wide StaleBundleWatcher owns
  // mid-session deploys). A null SHA grades every row 'unknown', which is
  // silence — never a fleet-wide "out of date" accusation.
  const [deployedSha, setDeployedSha] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/build-info', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = await r.json();
        if (!cancelled && typeof j?.sha === 'string') setDeployedSha(j.sha);
      } catch { /* fail closed — no chip beats a false accusation */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const readiness: ReadinessInput = useMemo(() => {
    const schools = readinessQuery.data?.schools;
    if (!readinessEligible || !schools) {
      return { known: false, locationsReady: 0, locationsTotal: 0, anyNotConfigured: false, anyNeedsAttention: false };
    }
    // A location with no screens can't display anything — it is a setup task,
    // not an emergency gap, so it stays out of the denominator (the same rule
    // fleetCommand.ts applies).
    const screenful = schools.filter((s) => (s.screensTotal ?? 0) > 0);
    return {
      known: true,
      locationsReady: screenful.filter((s) => s.verdict === 'READY').length,
      locationsTotal: screenful.length,
      anyNotConfigured: screenful.some((s) => s.verdict === 'NOT_CONFIGURED'),
      anyNeedsAttention: screenful.some((s) => s.verdict === 'NEEDS_ATTENTION'),
    };
  }, [readinessQuery.data, readinessEligible]);

  // ── modals the v3 surface raises but does not own ────────────────
  const [locationModal, setLocationModal] = useState<{ id: string; name: string; address?: string | null } | null>(null);
  const [groupLocationModal, setGroupLocationModal] = useState<{ id: string; name: string; address?: string | null } | null>(null);
  const [displayScheduleTarget, setDisplayScheduleTarget] = useState<DisplayScheduleTargetRef | null>(null);

  // ── pair modal (same endpoint, same copy keys as classic) ────────
  const [showPairModal, setShowPairModal] = useState(false);
  useOverlayLock(showPairModal);
  const [pairCode, setPairCode] = useState('');
  const [pairName, setPairName] = useState('');
  const [pairGroupId, setPairGroupId] = useState('');
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState('');
  const [showQrForScan, setShowQrForScan] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  useEffect(() => {
    if (!showQrForScan || !pairCode.trim()) { setQrDataUrl(''); return; }
    const payload = typeof window !== 'undefined'
      ? `${window.location.origin}/pair?code=${encodeURIComponent(pairCode.trim().toUpperCase())}`
      : pairCode.trim().toUpperCase();
    let cancelled = false;
    // The QR encoder is ~50 KB and only ever runs when the operator taps
    // "Scan with phone" — import it then, not on every Screens page load.
    import('qrcode')
      .then((m) => m.default.toDataURL(payload, { width: 220, margin: 1 }))
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(''); });
    return () => { cancelled = true; };
  }, [showQrForScan, pairCode]);

  const refetchAll = useCallback(() => {
    screensQuery.refetch();
    groupsQuery.refetch();
  }, [screensQuery, groupsQuery]);

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
      refetchAll();
    } catch (e: any) {
      setPairError(e.message || 'Invalid pairing code');
    } finally {
      setPairing(false);
    }
  };

  /** Preview URL — the admin JWT rides the FRAGMENT so it never reaches a log. */
  const buildPreviewHref = useCallback(
    (screen: OpsScreen) => {
      const base = typeof window !== 'undefined' ? `${window.location.origin}/player` : '/player';
      const q = new URLSearchParams({
        deviceId: screen.deviceFingerprint ?? '',
        preview: '1',
        orientation: orientationFromResolution(screen.resolution),
      });
      return `${base}?${q.toString()}${authToken ? `#t=${encodeURIComponent(authToken)}` : ''}`;
    },
    [authToken],
  );

  /**
   * "Full settings" — everything the classic gear popover owns (LED canvas,
   * console profile, sync trim, hardware identity, device details). It is not
   * cleanly liftable out of that 3.2k-line page, and copying it would fork the
   * semantics — so v3 hands the operator over to it, deep-linked at THIS
   * screen, without persisting the classic preference.
   */
  const openFullSettings = (screenId: string) => {
    try {
      const sp = new URLSearchParams(window.location.search);
      sp.set('screen', screenId);
      window.history.replaceState(null, '', `${window.location.pathname}?${sp.toString()}`);
    } catch { /* the classic page still opens, just on the list */ }
    setClassicOnce(true);
  };

  // ── which surface? Hold the space until the decision lands. ──────
  if (!prefLoaded) {
    return (
      <div aria-hidden className="space-y-4">
        <div className="h-16 rounded-2xl bg-white border border-slate-200 animate-pulse" />
        <div className="h-14 rounded-2xl bg-white border border-slate-200 animate-pulse" />
        <div className="h-96 rounded-2xl bg-white border border-slate-200 animate-pulse" />
      </div>
    );
  }

  if (showClassic) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
          <p className="text-[12.5px] font-semibold text-slate-500">
            You’re on the classic Screens page.
          </p>
          <button
            type="button"
            onClick={() => setView('v3')}
            className="text-[12.5px] font-bold underline underline-offset-2"
            style={{ color: 'var(--brand-primary, #4f46e5)' }}
          >
            Back to the new view
          </button>
        </div>
        <ClassicScreensPage />
      </div>
    );
  }

  return (
    <>
      {/* Child location → one click back up to the parent's fleet view. */}
      <ReturnToFleetBanner />

      <ScreenOperationsV3
        screens={screens}
        groups={groups}
        schedules={(schedulesQuery.data as any[]) ?? []}
        playlists={(playlistsQuery.data as any[]) ?? []}
        deployedSha={deployedSha}
        readiness={readiness}
        isLoading={screensQuery.isLoading || groupsQuery.isLoading}
        isError={screensQuery.isError || groupsQuery.isError}
        onRetry={refetchAll}
        canControl={canControlDisplay}
        viewMode={viewMode}
        onViewMode={setViewMode}
        deepLinkScreenId={deepLinkScreenId}
        deepLinkFilter={deepLinkFilter}
        onPairScreen={() => {
          setShowPairModal(true);
          setPairCode(''); setPairName(''); setPairGroupId(''); setPairError('');
        }}
        onSetGroupLocation={(g) => setGroupLocationModal(g)}
        onOpenDisplaySchedule={(target) => setDisplayScheduleTarget(target)}
        onOpenFullSettings={openFullSettings}
        onSwitchClassic={() => setView('classic')}
        onChanged={refetchAll}
        buildPreviewHref={buildPreviewHref}
        renderMap={(visible) => (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-500">
              Every screen with an address. Pin colours show live status — screens on an alert pulse red.
            </p>
            <ScreenMapClient
              screens={visible.map((s: any) => ({
                id: s.id, name: s.name, status: s.status,
                latitude: s.effectiveLatitude ?? s.latitude,
                longitude: s.effectiveLongitude ?? s.longitude,
                address: s.effectiveAddress ?? s.address,
                geoSource: s.geoSource,
                lastPingAt: s.lastPingAt,
                lastCacheReport: s.lastCacheReport,
              }))}
            />
          </div>
        )}
        floorSlot={<FloorPlansView embedded />}
        connectSlot={
          <ConnectScreenCard
            pairedCount={screens.length}
            playerUrl={typeof window !== 'undefined' ? `${window.location.origin}/player` : '/player'}
            pairDisabled={!canControlDisplay}
            onPairScreen={() => {
              setShowPairModal(true);
              setPairCode(''); setPairName(''); setPairGroupId(''); setPairError('');
            }}
          />
        }
      />

      {/* ─── Pair screen ─────────────────────────────────────── */}
      {showPairModal && (
        <div className="fixed top-0 right-0 bottom-0 left-0 bg-black/50 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={t('screens.pairScreen')}>
          <button className="absolute top-0 right-0 bottom-0 left-0 cursor-default" aria-label={t('screens.closeDialog')} onClick={() => setShowPairModal(false)} />
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative z-10 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Wifi className="w-5 h-5 text-emerald-600" aria-hidden /> {t('screens.pairModalTitle')}
              </h2>
              <button onClick={() => setShowPairModal(false)} aria-label={t('screens.closeDialog')} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" aria-hidden />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-5">{t('screens.pairModalSubtitle')}</p>
            <div className="space-y-4">
              <div>
                <label htmlFor="pair-code-input" className="block text-xs font-semibold text-slate-600 mb-1.5">{t('screens.pairingCode')}</label>
                <input
                  id="pair-code-input"
                  autoFocus
                  value={pairCode}
                  onChange={(e) => setPairCode(e.target.value.toUpperCase())}
                  placeholder={t('screens.pairingCodePlaceholder')}
                  maxLength={6}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-center text-2xl font-mono font-bold tracking-[0.3em] outline-none focus:ring-2 focus:ring-emerald-500 uppercase"
                  onKeyDown={(e) => e.key === 'Enter' && handlePairScreen()}
                />
              </div>
              <div>
                <label htmlFor="pair-name-input" className="block text-xs font-semibold text-slate-600 mb-1.5">{t('screens.screenNameOptional')}</label>
                <input
                  id="pair-name-input"
                  value={pairName}
                  onChange={(e) => setPairName(e.target.value)}
                  placeholder={t('screens.screenNamePlaceholder')}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label htmlFor="pair-group-select" className="block text-xs font-semibold text-slate-600 mb-1.5">{t('screens.assignToGroup')}</label>
                <select
                  id="pair-group-select"
                  value={pairGroupId}
                  onChange={(e) => setPairGroupId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">{t('screens.noGroupAssignLater')}</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
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
                {pairing ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Wifi className="w-4 h-4" aria-hidden />}
                {pairing ? t('screens.pairing') : t('screens.pairScreenBtn')}
              </button>
              <button
                type="button"
                onClick={() => setShowQrForScan((v) => !v)}
                disabled={pairCode.length < 4}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-sm font-semibold rounded-xl flex items-center justify-center gap-2"
                aria-expanded={showQrForScan}
                data-testid="scan-instead-button"
              >
                <QrCode className="w-4 h-4" aria-hidden />
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

      {locationModal && (
        <ScreenLocationModal
          screenName={locationModal.name}
          currentAddress={locationModal.address}
          onClose={() => setLocationModal(null)}
          onSave={async (body) => {
            await updateLocation.mutateAsync({ id: locationModal.id, ...body });
            refetchAll();
          }}
        />
      )}
      {groupLocationModal && (
        <ScreenLocationModal
          screenName={groupLocationModal.name}
          currentAddress={groupLocationModal.address}
          onClose={() => setGroupLocationModal(null)}
          onSave={async (body) => {
            await updateGroup.mutateAsync({ id: groupLocationModal.id, ...body });
            refetchAll();
          }}
        />
      )}
      {displayScheduleTarget && (
        <DisplayScheduleModal
          target={displayScheduleTarget}
          readOnly={!canControlDisplay}
          onClose={() => setDisplayScheduleTarget(null)}
        />
      )}
    </>
  );
}
