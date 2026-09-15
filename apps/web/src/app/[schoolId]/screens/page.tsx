"use client";

/**
 * /[schoolId]/screens — Calm Operations v3.
 * away (2026-08-31).
 *
 * Design contract: scratch/design/screens-menu/SCREEN-OPERATIONS-V3-DESIGN-HANDOFF.md.
 * This file is the data layer for the Screens page; every pixel of the
 * surface lives in `components/screens/v3/`. The classic page and its
 * switcher were retired on 2026-09-14 (Greg: "dump classic view … make sure
 * we aren't missing anything, then kill it") after a capability audit —
 * `docs/research/2026-09-14-greg-test-updates/15-classic-vs-v3-screens-audit.md`
 * — and the ports it named (empty groups, synced playback, pair-into-group,
 * per-screen location, frame-lock status, IP address).
 */

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, QrCode, Wifi, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  usePlaylists, useSchedules, useScreenGroups, useScreens,
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
import type { FilterKey, OpsScreen } from '@/components/screens/v3/screenOps';

/**
 */
const FloorPlansView = dynamic(
  () => import('@/components/screens/FloorPlansView').then((m) => m.FloorPlansView),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    ),
  },
);
const DisplayScheduleModal = dynamic(
  () => import('@/components/screens/DisplayScheduleModal').then((m) => m.DisplayScheduleModal),
  { ssr: false, loading: () => null },
);
const ConnectScreenCard = dynamic(
  () => import('@/components/screens/ConnectScreenCard').then((m) => m.ConnectScreenCard),
  { ssr: false, loading: () => null },
);

/** Portrait/landscape from a free-text resolution. */
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


  // ── deep links, read once and stripped (§7 + the dashboard's link) ──
  const [deepLinkScreenId, setDeepLinkScreenId] = useState<string | null>(null);
  const [deepLinkFilter, setDeepLinkFilter] = useState<FilterKey | null>(null);
  const [viewMode, setViewMode] = useState<ScreensViewMode>('list');
  useEffect(() => {
    if (typeof window === 'undefined') return;
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
      sp.delete('screen');
      const qs = sp.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    } catch { /* malformed URL — the list still renders */ }
    // Runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── data (unchanged endpoints; nothing new on the API side) ──────
  const screensQuery = useScreens();
  const groupsQuery = useScreenGroups();
  const schedulesQuery = useSchedules();
  const playlistsQuery = usePlaylists();
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

  // 2026-09-14: the location-readiness read fed only the Screens page's
  // assurance strip; the strip is gone (Greg: unactionable), so the page no
  // longer fetches readiness — the Overview pill owns that verdict.

  // ── modals the v3 surface raises but does not own ────────────────
  const [locationModal, setLocationModal] = useState<{ id: string; name: string; address?: string | null } | null>(null);
  const [groupLocationModal, setGroupLocationModal] = useState<{ id: string; name: string; address?: string | null } | null>(null);
  const [displayScheduleTarget, setDisplayScheduleTarget] = useState<DisplayScheduleTargetRef | null>(null);

  // ── pair modal ──────────────────────────────────────────────────
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
        isLoading={screensQuery.isLoading || groupsQuery.isLoading}
        isError={screensQuery.isError || groupsQuery.isError}
        onRetry={refetchAll}
        canControl={canControlDisplay}
        viewMode={viewMode}
        onViewMode={setViewMode}
        deepLinkScreenId={deepLinkScreenId}
        deepLinkFilter={deepLinkFilter}
        onPairScreen={(groupId) => {
          setShowPairModal(true);
          setPairCode(''); setPairName(''); setPairGroupId(groupId ?? ''); setPairError('');
        }}
        onSetScreenLocation={(s) => setLocationModal(s)}
        onSetGroupLocation={(g) => setGroupLocationModal(g)}
        onOpenDisplaySchedule={(target) => setDisplayScheduleTarget(target)}
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
