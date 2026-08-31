"use client";

/**
 * FleetCommandCenter — the Fleet Command HQ dashboard (2026-08-31, Phase 1).
 *
 * Design source: scratch/design/multi-location-dashboard/ (operator-approved
 * direction, 2026-08-31) — Fleet Command as the default HQ surface:
 *
 *   1. ONE assurance rail separating five independent truths (content
 *      current / device online / push live / emergency ready / showing
 *      content). "Online" is one pill of five, never a health synonym.
 *   2. A compact prioritized EXCEPTION INBOX (replaces the classic view's
 *      four full-width alert strips — the alarm-fatigue complaint).
 *   3. A CONTENT CONVERGENCE summary — the live derived state, and (Phase 2)
 *      the real deployment record whenever a "Push update" is still in
 *      flight, with a drawer naming the screens it is waiting on.
 *   4. A dense worst-first LOCATION TABLE with content/push/emergency truth.
 *
 * All derivation lives in fleetCommand.ts (pure, unit-tested). This file is
 * presentation + navigation only.
 *
 * ── ROLLBACK CONTRACT (operator condition for shipping this) ─────────
 * The classic dashboard (DistrictCommandCenter + KPI/status sections) is
 * fully preserved behind the per-user toggle in dashboard/page.tsx
 * (localStorage `venueos_hq_dashboard`). "Classic view" up top switches
 * back instantly — no deploy. Flipping the fleet-wide default back is the
 * one-line `HQ_DASHBOARD_DEFAULT` constant in dashboard/page.tsx.
 *
 * Brand-aware by construction: every tinted surface derives from
 * --brand-primary via color-mix (the BrandStyleInjector tokens), so a
 * crimson gym and a navy district each see their own dashboard. Health
 * colors stay semantic (emerald/amber/rose) — "screens down" must never
 * inherit a red brand's decoration.
 *
 * Dashboard surface (not player/widget) → CSS gap/inset are fine here.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Building2, CheckCircle2, CloudOff, FileCheck2,
  Inbox, Loader2, MonitorCheck, MonitorPlay, MonitorX, RefreshCw, Search,
  ShieldAlert, ShieldCheck, Wifi, X, Zap,
} from 'lucide-react';
import { useTenantSwitch } from '@/hooks/use-tenant-switch';
import { VERTICAL_LABELS, normalizeVertical } from '@cms/api-types';
import type {
  FleetResponse, DistrictReadinessResponse, DistrictPendingApprovals, DeploymentRow,
} from '@/hooks/use-api';
import { buildFleetCommand, type AssuranceState, type ExceptionRow, type LocationRow } from './fleetCommand';
import { filterScorecards } from './districtRollup';
import { ProofDrawer, timeAgo, type ProofDrawerScreen } from './ProofDrawer';
import { ScreenMapClient } from '@/components/screens/ScreenMapClient';

const PILL_TONE: Record<AssuranceState, string> = {
  ok: 'border-emerald-200 bg-emerald-50/60 text-emerald-700',
  warn: 'border-amber-200 bg-amber-50/70 text-amber-700',
  bad: 'border-rose-200 bg-rose-50/70 text-rose-700',
  unknown: 'border-slate-200 bg-slate-50 text-slate-400',
};

const INBOX_ICON: Record<ExceptionRow['kind'], typeof CloudOff> = {
  emergency: ShieldAlert,
  'not-painting': MonitorX,
  offline: CloudOff,
  'content-behind': RefreshCw,
  'push-stale': Wifi,
  approvals: Inbox,
  setup: MonitorPlay,
};

const INBOX_TONE: Record<ExceptionRow['kind'], string> = {
  emergency: 'text-rose-600 bg-rose-50',
  'not-painting': 'text-rose-600 bg-rose-50',
  offline: 'text-amber-600 bg-amber-50',
  'content-behind': 'text-amber-600 bg-amber-50',
  'push-stale': 'text-slate-500 bg-slate-100',
  approvals: 'text-slate-500 bg-slate-100',
  setup: 'text-sky-600 bg-sky-50',
};

/** A deployment older than this is history, not something to watch. */
const RECENT_DEPLOYMENT_MS = 24 * 60 * 60 * 1000;

/**
 * Is this push still "the current one"? Reads the wall clock at render on
 * purpose — the boundary has to age with the page, and the branch it gates is
 * client-only (this app never prefetches react-query on the server, so the
 * deployments payload is always absent during SSR), so there is no
 * server/client render to disagree. A push with an unparseable timestamp is
 * treated as NOT recent: fail closed rather than pin a bad record to the card.
 */
function isRecentPush(createdAt: string): boolean {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && Date.now() - t < RECENT_DEPLOYMENT_MS;
}

export function FleetCommandCenter({
  fleet,
  readiness,
  approvals,
  deployments,
  orgName,
  onSwitchClassic,
}: {
  fleet: FleetResponse;
  readiness?: DistrictReadinessResponse | null;
  approvals?: DistrictPendingApprovals | null;
  /** Recent "Push update" actions (Phase 2). Absent → live-derived card only. */
  deployments?: { deployments: DeploymentRow[] } | null;
  orgName?: string | null;
  onSwitchClassic: () => void;
}) {
  const { switchToTenant, switchingId } = useTenantSwitch();
  const [q, setQ] = useState('');
  // ── Network Atlas (Phase 3) — the locations section's second view. ──
  // The map is a VIEW of this section, not a second module: FleetRollup no
  // longer renders under Fleet Command (classic keeps it), so locations
  // exist exactly once on the page in either mode.
  const [view, setView] = useState<'list' | 'map'>('list');

  // Deployed bundle SHA — same fail-closed fetch the Screens page uses: a
  // null SHA grades content 'unknown' (gray pill), never a false accusation.
  const [deployedSha, setDeployedSha] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/build-info', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = await r.json();
        if (!cancelled && typeof j?.sha === 'string') setDeployedSha(j.sha);
      } catch { /* fail closed */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const fc = useMemo(
    () =>
      buildFleetCommand({
        screens: fleet.screens as any,
        deployedSha,
        rollupInput: {
          locations: fleet.locations,
          rootId: fleet.root?.id ?? null,
          screens: fleet.screens as any,
          readiness: readiness ?? null,
          approvals: approvals ?? null,
        },
      }),
    [fleet.screens, fleet.locations, fleet.root?.id, readiness, approvals, deployedSha],
  );

  const vertical = normalizeVertical((fleet.root as { vertical?: string | null } | null)?.vertical);
  const nounOne = VERTICAL_LABELS[vertical].singular.toLowerCase();
  const nounMany = VERTICAL_LABELS[vertical].plural.toLowerCase();
  const n = (count: number) => (count === 1 ? nounOne : nounMany);

  const enter = (row: { tenantId: string; slug: string }, path: string) =>
    switchToTenant({ id: row.tenantId, slug: row.slug }, `/${row.slug}/${path}`);

  const visible = useMemo(
    () => filterScorecards(fc.locations, q) as LocationRow[],
    [fc.locations, q],
  );

  // Map pins ride the SAME effective-geo the fleet map has always used
  // (screen pin > group > location address). Pin click switches into the
  // owning location's Screens page — same one-tap contract as the rows.
  const mapScreens = useMemo(
    () =>
      fleet.screens.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        latitude: s.effectiveLatitude,
        longitude: s.effectiveLongitude,
        address: s.effectiveAddress,
        geoSource: s.geoSource,
        lastPingAt: s.lastPingAt,
        lastCacheReport: s.lastCacheReport,
      })),
    [fleet.screens],
  );
  const mappableCount = useMemo(
    () => mapScreens.filter((s) => s.latitude != null && s.longitude != null).length,
    [mapScreens],
  );
  const openScreenLocation = (screenId: string) => {
    const src = fleet.screens.find((s) => s.id === screenId)?.sourceTenant;
    if (src) enter({ tenantId: src.id, slug: src.slug }, 'screens');
  };

  // ── Deployment record (Phase 2) ───────────────────────────────────
  // Server order is unspecified, so date the records here — a card that
  // shows an older push as the current one is worse than no card.
  const rows = deployments?.deployments;
  const latestDeployment = useMemo(() => {
    if (!rows?.length) return null;
    return rows.reduce((a, b) => (Date.parse(b.createdAt) > Date.parse(a.createdAt) ? b : a));
  }, [rows]);
  const recentDeployment =
    latestDeployment && isRecentPush(latestDeployment.createdAt) ? latestDeployment : null;
  /** In flight — the card leads with it. */
  const activeDeployment = recentDeployment && !recentDeployment.convergence.done ? recentDeployment : null;
  /** Landed everywhere — one quiet line under the live card, never a banner. */
  const settledDeployment = recentDeployment && recentDeployment.convergence.done ? recentDeployment : null;

  // Proof drawer: which deployment the operator is inspecting (never a stale
  // id — it is resolved against the current payload every render).
  const [proofId, setProofId] = useState<string | null>(null);
  const proofDeployment = rows?.find((d) => d.id === proofId) ?? null;
  const proofTriggerRef = useRef<HTMLButtonElement>(null);
  const closeProof = () => {
    setProofId(null);
    proofTriggerRef.current?.focus(); // the trigger never unmounts
  };

  // The deployments payload carries a target COUNT, not target ids, so the
  // only screens we can NAME are the ones still holding this push's value.
  // (A future API rev may add targetIds — then map those instead.)
  const proofScreens: ProofDrawerScreen[] = useMemo(() => {
    if (!proofDeployment) return [];
    return fleet.screens
      .filter((s) => s.pendingRefreshAtMs != null && s.pendingRefreshAtMs === proofDeployment.valueMs)
      .map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        renderHealth: s.renderHealth ?? null,
        renderStale: s.renderStale ?? null,
        pendingRefreshAtMs: s.pendingRefreshAtMs ?? null,
        locationName: s.sourceTenant?.name ?? '',
      }));
  }, [fleet.screens, proofDeployment]);

  const viewScreensButton = (deployment: DeploymentRow) => (
    <button
      ref={proofTriggerRef}
      type="button"
      onClick={() => setProofId(deployment.id)}
      className="mt-1.5 text-[11.5px] font-black hover:underline underline-offset-2"
      style={{ color: 'var(--brand-primary, #4f46e5)' }}
    >
      View screens →
    </button>
  );

  const pills: Array<{ key: string; label: string; Icon: typeof Wifi; pill: typeof fc.assurance.online; hint: string }> = [
    { key: 'content', label: 'Content current', Icon: FileCheck2, pill: fc.assurance.contentCurrent, hint: 'Screens confirmed on the latest published content. Gray = nothing to compare yet.' },
    { key: 'online', label: 'Devices online', Icon: Wifi, pill: fc.assurance.online, hint: 'Screens answering heartbeats. Online alone does not prove a picture — that is the last pill.' },
    { key: 'push', label: 'Push live', Icon: Zap, pill: fc.assurance.pushLive, hint: 'Screens with an instant connection. Others still update via ~10s check-ins.' },
    { key: 'emergency', label: 'Emergency ready', Icon: ShieldCheck, pill: fc.assurance.emergencyReady, hint: `${nounMany.charAt(0).toUpperCase() + nounMany.slice(1)} able to display an emergency alert right now — its own check, never inferred from content health.` },
    { key: 'painting', label: 'Showing content', Icon: MonitorCheck, pill: fc.assurance.showingContent, hint: 'Screens with a confirmed picture on the glass (render-proof).' },
  ];

  return (
    <section
      aria-label="Fleet command"
      className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden"
    >
      {/* ─── Header ──────────────────────────────────────────────── */}
      <div className="px-5 pt-5 pb-4 flex items-center gap-2 flex-wrap">
        <Building2 className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-primary, #4f46e5)' }} aria-hidden />
        <h2 className="text-base font-black text-slate-800">
          {orgName || fleet.root?.name || 'Fleet'} — fleet command
        </h2>
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          {fc.locations.length} {n(fc.locations.length)} · {fleet.stats.total} screens
        </span>
        <button
          type="button"
          onClick={onSwitchClassic}
          className="ml-auto text-[11px] font-bold text-slate-400 hover:text-slate-600 underline underline-offset-2"
          title="Go back to the previous dashboard layout (you can switch again any time)"
        >
          Classic view
        </button>
      </div>

      {/* ─── 1 · Assurance rail — five independent truths ────────── */}
      <div className="px-5 pb-2">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {pills.map(({ key, label, Icon, pill, hint }) => (
            <div
              key={key}
              className={`rounded-2xl border px-3 py-2.5 flex items-center gap-2.5 ${PILL_TONE[pill.state]}`}
              title={hint}
            >
              <Icon className="w-4 h-4 shrink-0" aria-hidden />
              <div className="min-w-0">
                <div className="text-sm font-black leading-tight">
                  {pill.state === 'unknown' ? '—' : `${pill.n}/${pill.total}`}
                </div>
                <div className="text-[10.5px] font-bold uppercase tracking-wide opacity-80 truncate">{label}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10.5px] text-slate-400 font-semibold mt-1.5">
          Five separate checks — connectivity, content, delivery, emergency and on-glass proof. Gray means that check hasn&rsquo;t answered.
        </p>
      </div>

      {/* ─── 2+3 · Exception inbox + convergence ─────────────────── */}
      <div className="px-5 py-3 grid md:grid-cols-[1fr_260px] gap-3 items-start">
        <div className="rounded-2xl border border-slate-200">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
            <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500">Needs attention</h3>
            {fc.inbox.length > 0 && (
              <span className="text-[11px] font-black text-slate-400">{fc.inbox.length + fc.inboxOverflow}</span>
            )}
          </div>
          {fc.inbox.length === 0 ? (
            fc.allClear ? (
              <div className="px-4 py-3.5 flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden />
                <p className="text-sm font-bold text-emerald-800">
                  All {fc.locations.length} {n(fc.locations.length)} healthy — nothing needs you right now.
                </p>
              </div>
            ) : (
              <div className="px-4 py-3.5 flex items-center gap-2.5">
                <Loader2 className="w-4 h-4 text-slate-400 animate-spin shrink-0" aria-hidden />
                <p className="text-sm font-semibold text-slate-500">
                  Nothing urgent so far — still waiting on{' '}
                  {[!fc.coverage.readiness && 'the emergency check', !fc.coverage.approvals && 'the review queue']
                    .filter(Boolean)
                    .join(' and ')}.
                </p>
              </div>
            )
          ) : (
            <ul>
              {fc.inbox.map((row, i) => {
                const Icon = INBOX_ICON[row.kind];
                return (
                  <li key={`${row.kind}:${row.tenantId}`} className={i > 0 ? 'border-t border-slate-100' : ''}>
                    <button
                      type="button"
                      onClick={() => enter(row, row.path)}
                      disabled={!!switchingId}
                      className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-slate-50 disabled:opacity-60 disabled:cursor-wait group"
                    >
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${INBOX_TONE[row.kind]}`}>
                        <Icon className="w-3.5 h-3.5" aria-hidden />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-bold text-slate-800 truncate">{row.headline}</span>
                        <span className="block text-[11.5px] text-slate-500 truncate">{row.detail}</span>
                      </span>
                      {switchingId === row.tenantId ? (
                        <Loader2 className="w-4 h-4 text-slate-400 animate-spin shrink-0" aria-hidden />
                      ) : (
                        <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 shrink-0" aria-hidden />
                      )}
                    </button>
                  </li>
                );
              })}
              {fc.inboxOverflow > 0 && (
                <li className="border-t border-slate-100 px-4 py-2 text-[11.5px] font-bold text-slate-400">
                  +{fc.inboxOverflow} more below in the {nounOne} list
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Convergence — a live push takes the card; otherwise the derived
            state stands exactly as it did in Phase 1. */}
        <div className="rounded-2xl border border-slate-200 px-4 py-3">
          <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-2">Content convergence</h3>
          {activeDeployment ? (
            <>
              <p className="text-[12px] font-bold text-slate-700 truncate" title={activeDeployment.label}>
                {activeDeployment.label}
              </p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-black text-slate-800">{activeDeployment.convergence.converged}</span>
                <span className="text-sm font-bold text-slate-400">/ {activeDeployment.targetCount} confirmed</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round((activeDeployment.convergence.converged / Math.max(1, activeDeployment.targetCount)) * 100)}%`,
                    background: 'var(--brand-primary, #6366f1)',
                  }}
                />
              </div>
              <p className="mt-2 text-[11.5px] font-semibold text-slate-500">
                {(() => {
                  const left = Math.max(0, activeDeployment.targetCount - activeDeployment.convergence.converged);
                  return `${left} screen${left === 1 ? '' : 's'} still picking up this push`;
                })()}
              </p>
              {viewScreensButton(activeDeployment)}
            </>
          ) : (
            <>
              {fc.convergence.gradeable === 0 ? (
                <p className="text-[12.5px] font-semibold text-slate-400">
                  Nothing to compare yet — screens report their content version as they check in.
                </p>
              ) : (
                <>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-black text-slate-800">{fc.convergence.confirmed}</span>
                    <span className="text-sm font-bold text-slate-400">/ {fc.convergence.gradeable} confirmed</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.round((fc.convergence.confirmed / Math.max(1, fc.convergence.gradeable)) * 100)}%`,
                        background: fc.convergence.settled ? '#10b981' : 'var(--brand-primary, #6366f1)',
                      }}
                    />
                  </div>
                  <p className="mt-2 text-[11.5px] font-semibold text-slate-500">
                    {fc.convergence.settled
                      ? 'Every reporting screen is on the current content.'
                      : `${fc.convergence.propagating} screen${fc.convergence.propagating === 1 ? '' : 's'} still picking up the latest update.`}
                  </p>
                </>
              )}
              {settledDeployment && (
                <div className="mt-2 pt-2 border-t border-slate-100">
                  <p className="text-[11.5px] font-semibold text-slate-400">
                    Last push confirmed everywhere · {timeAgo(settledDeployment.createdAt)}
                  </p>
                  {viewScreensButton(settledDeployment)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ─── 4 · Locations — dense, worst first ──────────────────── */}
      <div className="px-5 pb-5 pt-1">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500">
            Your {nounMany}
          </h3>
          <div className="flex bg-slate-100 rounded-lg p-0.5" role="tablist" aria-label="Locations view">
            {(['list', 'map'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`px-3 py-1 rounded-md text-[11px] font-bold capitalize ${
                  view === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          {view === 'list' && fc.locations.length > 8 && (
            <div className="ml-auto relative">
              <Search className="w-3.5 h-3.5 text-slate-300 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Filter ${nounMany}…`}
                aria-label={`Filter ${nounMany} by name`}
                className="pl-8 pr-7 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold w-44 focus:ring-2 focus:ring-indigo-300 outline-none"
              />
              {q && (
                <button type="button" onClick={() => setQ('')} aria-label="Clear filter" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                  <X className="w-3.5 h-3.5" aria-hidden />
                </button>
              )}
            </div>
          )}
        </div>

        {view === 'map' ? (
          <div className="rounded-2xl border border-slate-200 overflow-hidden">
            {mappableCount === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm font-bold text-slate-500">No addresses on the map yet.</p>
                <p className="text-[12px] text-slate-400 mt-1">
                  Add an address to a {nounOne}, a screen group, or a screen — its pins appear here.
                </p>
              </div>
            ) : (
              <ScreenMapClient screens={mapScreens} renderSidebar={false} onScreenClick={openScreenLocation} />
            )}
          </div>
        ) : (
        <div className="rounded-2xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-left" style={{ minWidth: 640 }}>
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100">
                <th className="px-4 py-2">Location</th>
                <th className="px-3 py-2">Screens</th>
                <th className="px-3 py-2">Content</th>
                <th className="px-3 py-2">Push</th>
                <th className="px-3 py-2">Emergency</th>
                <th className="px-3 py-2" aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-4 text-sm font-semibold text-slate-400">No {nounOne} matches{q.trim() ? ` “${q.trim()}”` : ''}.</td></tr>
              )}
              {visible.map((row) => {
                const worst =
                  !row.hasScreens ? { text: 'No screens set up yet', cls: 'text-slate-400' }
                  : row.readiness === 'NOT_CONFIGURED' ? { text: 'Can’t display an emergency alert', cls: 'text-rose-600' }
                  : row.notPainting > 0 ? { text: `${row.notPainting} no picture confirmed`, cls: 'text-rose-600' }
                  : row.screensOffline > 0 ? { text: `${row.screensOffline} offline`, cls: 'text-amber-600' }
                  : row.contentBehind > 0 ? { text: `${row.contentBehind} behind on content`, cls: 'text-amber-600' }
                  : null;
                return (
                  <tr
                    key={row.tenantId}
                    onClick={() => enter(row, !row.hasScreens ? 'screens' : worst ? (row.readiness === 'NOT_CONFIGURED' ? 'settings/emergency' : 'screens') : 'dashboard')}
                    className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/70 cursor-pointer"
                  >
                    <td className="px-4 py-2.5">
                      <div className="text-[13px] font-bold text-slate-800 flex items-center gap-2">
                        {row.name}
                        {row.isSelf && <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 border border-slate-200 rounded px-1 py-0.5">HQ</span>}
                        {row.pendingApprovals > 0 && (
                          <span className="text-[9.5px] font-black rounded-full px-1.5 py-0.5 text-white" style={{ background: 'var(--brand-primary, #6366f1)' }}>
                            {row.pendingApprovals}
                          </span>
                        )}
                      </div>
                      {worst && <div className={`text-[11px] font-bold ${worst.cls}`}>{worst.text}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-[12.5px] font-bold text-slate-700 whitespace-nowrap">
                      <span className={row.screensOffline > 0 ? 'text-amber-600' : ''}>{row.screensOnline}</span>
                      <span className="text-slate-300">/{row.screensTotal}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[12px] font-bold whitespace-nowrap">
                      {!row.hasScreens
                        ? <span className="text-slate-300">—</span>
                        : row.contentBehind > 0
                          ? <span className="text-amber-600">{row.contentBehind} behind</span>
                          : <span className="text-emerald-600">Up to date</span>}
                    </td>
                    <td className="px-3 py-2.5 text-[12px] font-bold whitespace-nowrap">
                      {!row.hasScreens
                        ? <span className="text-slate-300">—</span>
                        : row.pushStale > 0
                          ? <span className="text-slate-500">{row.pushStale} on ~10s</span>
                          : <span className="text-emerald-600">Live</span>}
                    </td>
                    <td className="px-3 py-2.5 text-[12px] font-bold whitespace-nowrap">
                      {!row.hasScreens ? <span className="text-slate-300">—</span> : (<>
                      {row.readiness === 'READY' && <span className="text-emerald-600">Ready</span>}
                      {row.readiness === 'NEEDS_ATTENTION' && <span className="text-amber-600">Gaps</span>}
                      {row.readiness === 'NOT_CONFIGURED' && (
                        <span className="text-rose-600 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" aria-hidden />Not set up</span>
                      )}
                      {row.readiness === 'UNKNOWN' && <span className="text-slate-300">—</span>}
                      </>)}
                    </td>
                    <td className="px-3 py-2.5">
                      {switchingId === row.tenantId
                        ? <Loader2 className="w-4 h-4 text-slate-400 animate-spin" aria-hidden />
                        : <ArrowRight className="w-4 h-4 text-slate-300" aria-hidden />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {proofDeployment && (
        <ProofDrawer
          deployment={proofDeployment}
          screens={proofScreens}
          locationNoun={{ one: nounOne, many: nounMany }}
          onClose={closeProof}
        />
      )}
    </section>
  );
}
