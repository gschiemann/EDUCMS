"use client";

/**
 * Dashboard — fleet command center designed for customers running
 * 50 to 50,000 screens across dozens of sites, not a 5-screen demo.
 *
 * Design principles:
 * - Aggregates over individuals. No per-screen tiles — useless at scale.
 *   Show "4,847 / 5,000 online" with a sparkline, and a rollup table
 *   GROUPED BY SITE so the admin can spot "Lincoln HS has 8 screens
 *   dark" in one glance.
 * - Sort exceptions to the top. If a site has offline screens, it
 *   appears first in the rollup. If there are pending approvals, that
 *   card renders. Empty state = nothing to deal with = no card.
 * - No redundant actions. The top-right TopToolbar already has the
 *   Emergency trigger button; don't duplicate it here. The old
 *   "Trigger alert" link pointed at a non-existent route (/emergency
 *   404s — only /emergency/broadcast exists) — removed.
 * - Skimmable. Admins scan this while drinking coffee. Information
 *   density high, visual noise low. Big numbers, small labels.
 */

import {
  MonitorCheck, CloudOff, ListVideo, Upload, Plus, ArrowRight,
  Image as ImageIcon, MonitorPlay, Siren, CheckCircle2, Clock,
  AlertTriangle, Calendar, Zap, Users as UsersIcon, Building2,
  TrendingUp, TrendingDown, Activity, X,
} from 'lucide-react';
import { useRecentActivity } from '@/hooks/use-dashboard-data';
import {
  useScreens, useScreenGroups, usePlaylists, useAssets, useSchedules,
  useTenantStatus, useApproveAsset,
} from '@/hooks/use-api';
import { useAppStore } from '@/lib/store';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useMemo } from 'react';

export default function DashboardPage() {
  const { data: activity } = useRecentActivity();
  const { data: screens } = useScreens();
  const { data: screenGroups } = useScreenGroups();
  const { data: playlists } = usePlaylists();
  const { data: assets } = useAssets();
  const { data: schedules } = useSchedules();
  const { data: tenant } = useTenantStatus();
  const user = useAppStore((s) => s.user);
  const pathname = usePathname();
  const tenantBase = pathname?.split('/').slice(0, 2).join('/') || '';

  // Minute-clock for the header greeting + "live" scheduling match.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const approveAsset = useApproveAsset();

  // ══════════════════════════════════════════════════════════════════
  // Aggregate fleet computations — O(n) over already-fetched lists.
  // Everything is memoized so this doesn't re-run on every minute tick.
  // ══════════════════════════════════════════════════════════════════
  const allScreens = screens || [];
  const allGroups = screenGroups || [];

  const fleet = useMemo(() => {
    const total = allScreens.length;
    const online = allScreens.filter((s: any) => s.status === 'ONLINE').length;
    const pending = allScreens.filter((s: any) => s.status === 'PENDING' || !s.status).length;
    // "Stale" = online status but last ping >5min ago (suggests player
    // process frozen, but OS/network still reachable).
    const fiveMinAgo = Date.now() - 5 * 60_000;
    const stale = allScreens.filter((s: any) => {
      if (s.status !== 'ONLINE') return false;
      const last = s.lastPingAt ? new Date(s.lastPingAt).getTime() : 0;
      return last > 0 && last < fiveMinAgo;
    }).length;
    const offline = total - online - pending;
    const onlinePct = total > 0 ? (online / total) * 100 : 0;
    return { total, online, offline, pending, stale, onlinePct };
  }, [allScreens]);

  // Screens that are DOWN right now — sorted by how long they've been
  // silent (worst first). Capped at 5 for the card; link to /screens
  // for full list. This is the actionable exception list — no admin
  // needs to see every screen at scale, they need to see the BROKEN ones.
  const downScreens = useMemo(() => {
    return allScreens
      .filter((s: any) => s.status && s.status !== 'ONLINE' && s.status !== 'PENDING')
      .sort((a: any, b: any) => {
        const la = a.lastPingAt ? new Date(a.lastPingAt).getTime() : 0;
        const lb = b.lastPingAt ? new Date(b.lastPingAt).getTime() : 0;
        return la - lb; // Oldest ping first
      });
  }, [allScreens]);

  // Site / group rollup — KEY for district dashboards. Group screens by
  // screenGroup, compute online ratio, sort by "worst health" first so
  // the admin sees trouble spots without hunting.
  type SiteRow = { id: string; name: string; total: number; online: number; offline: number; pct: number };
  const sites = useMemo<SiteRow[]>(() => {
    const byGroupId: Record<string, SiteRow> = {};
    const unassigned: SiteRow = { id: '_unassigned', name: 'Unassigned', total: 0, online: 0, offline: 0, pct: 0 };
    for (const g of allGroups) {
      byGroupId[g.id] = { id: g.id, name: g.name, total: 0, online: 0, offline: 0, pct: 0 };
    }
    for (const s of allScreens as any[]) {
      const bucket = s.screenGroupId && byGroupId[s.screenGroupId] ? byGroupId[s.screenGroupId] : unassigned;
      bucket.total += 1;
      if (s.status === 'ONLINE') bucket.online += 1;
      else if (s.status && s.status !== 'PENDING') bucket.offline += 1;
    }
    const rows: SiteRow[] = [];
    for (const g of Object.values(byGroupId)) {
      if (g.total === 0) continue;
      g.pct = g.total > 0 ? (g.online / g.total) * 100 : 0;
      rows.push(g);
    }
    if (unassigned.total > 0) {
      unassigned.pct = unassigned.total > 0 ? (unassigned.online / unassigned.total) * 100 : 0;
      rows.push(unassigned);
    }
    // Sort: problem sites first (any offline), then by pct asc, then by size desc.
    rows.sort((a, b) => {
      if ((a.offline > 0) !== (b.offline > 0)) return a.offline > 0 ? -1 : 1;
      if (a.pct !== b.pct) return a.pct - b.pct;
      return b.total - a.total;
    });
    return rows;
  }, [allGroups, allScreens]);

  // Today's schedule — filter by DOW, sort by start time. Aggregate
  // count is what scales; we only surface the first few rows as a
  // preview, everything else is on /schedules.
  const today = now.getDay();
  const nowHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const todaysSchedules = useMemo(() => {
    return (schedules || [])
      .filter((s: any) => {
        if (s.isActive === false) return false;
        const dow: number[] | undefined = s.daysOfWeek;
        if (Array.isArray(dow) && dow.length > 0 && !dow.includes(today)) return false;
        return true;
      })
      .sort((a: any, b: any) => String(a.timeStart || '').localeCompare(String(b.timeStart || '')));
  }, [schedules, today]);

  const liveNowCount = useMemo(() => {
    return todaysSchedules.filter((s: any) => {
      const start = s.timeStart || '00:00';
      const end = s.timeEnd || '23:59';
      return nowHM >= start && nowHM <= end;
    }).length;
  }, [todaysSchedules, nowHM]);

  const playlistById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const p of (playlists || [])) m[p.id] = p;
    return m;
  }, [playlists]);

  const pendingAssets = useMemo(
    () => (assets || []).filter((a: any) => a.status === 'PENDING_APPROVAL'),
    [assets],
  );

  // Assets uploaded in the last 7 days — a proxy for "is anyone
  // actually using this CMS" / "is content fresh".
  const recentAssetCount = useMemo(() => {
    const since = Date.now() - 7 * 24 * 60 * 60_000;
    return (assets || []).filter((a: any) => new Date(a.createdAt).getTime() > since).length;
  }, [assets]);

  const emergencyActive = !!(tenant?.emergencyStatus && tenant.emergencyStatus !== 'INACTIVE');
  const emergencyMode = tenant?.emergencyStatus as string | undefined;

  // "Getting started" 3-step card visibility. Previously gated on
  // isEmpty (no assets + no screens) which meant:
  //   1) during the React Query fetch the card flashed true then
  //      disappeared once real data arrived — jarring UX.
  //   2) as soon as the user paired one screen, the whole guide
  //      vanished even though they still hadn't uploaded content or
  //      built a playlist. User asked to keep the card around.
  // Now the card stays until explicitly dismissed (per-user LS flag).
  // Auto-hides once the user has BOTH assets AND a paired screen +
  // a schedule, since at that point the 3 steps are all done.
  const [hintDismissed, setHintDismissed] = useState(false);
  useEffect(() => {
    try { setHintDismissed(localStorage.getItem('edu_dashboard_hint_dismissed') === '1'); } catch {}
  }, []);
  const dismissHint = () => {
    setHintDismissed(true);
    try { localStorage.setItem('edu_dashboard_hint_dismissed', '1'); } catch {}
  };
  const allStepsDone = (assets?.length || 0) > 0 && fleet.total > 0 && (schedules?.length || 0) > 0;
  const showOnboarding = !hintDismissed && !allStepsDone;
  const tenantName = (tenant as any)?.name || (user as any)?.tenantName || 'Your Organization';
  const firstName = (() => {
    const e = (user as any)?.email || '';
    const local = e.split('@')[0] || '';
    const bit = local.split(/[._-]/)[0];
    return bit ? bit.charAt(0).toUpperCase() + bit.slice(1) : 'there';
  })();
  const greeting = (() => {
    const h = now.getHours();
    if (h < 5) return 'Working late';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    if (h < 21) return 'Good evening';
    return 'Good night';
  })();

  // Incident count rolls up everything actionable into one number —
  // admin knows at a glance whether today needs attention.
  const incidentCount = fleet.offline + pendingAssets.length;

  return (
    <div className="space-y-6 pb-12">
      {/* ─── Header ─────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
            {greeting}, {firstName}
          </h1>
          <p className="text-sm font-medium text-slate-500 mt-1">
            {tenantName} · {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-slate-800 tabular-nums">
            {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </div>
          <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Local time</div>
        </div>
      </header>

      {/* ─── Status strip — single line, no redundant CTA ──────────
          The TopToolbar already carries the Emergency button in the top-
          right of every page — don't duplicate the action here. If an
          emergency is ACTIVE, we escalate to a full red banner. Otherwise
          a quiet one-line health summary is enough. */}
      {emergencyActive ? (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-red-600 to-red-500 text-white shadow-lg shadow-red-500/30 border border-red-400/50">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.2),transparent)]" />
          <div className="relative p-5 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur flex items-center justify-center shrink-0 animate-pulse">
              <Siren className="w-7 h-7" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-bold tracking-widest uppercase opacity-90">Active Emergency</div>
              <div className="text-xl font-bold mt-0.5">{emergencyMode || 'Emergency Alert Active'}</div>
              <div className="text-sm opacity-90 mt-0.5">All screens are displaying the emergency override.</div>
            </div>
            <Link
              href={`${tenantBase}/emergency/broadcast`}
              className="shrink-0 px-4 py-2.5 rounded-xl bg-white/95 text-red-600 text-sm font-bold hover:bg-white shadow-sm transition-colors"
            >
              Emergency Console
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-xl bg-white border border-slate-200 px-5 py-3 flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <span className={`relative flex h-2.5 w-2.5 ${incidentCount > 0 ? '' : ''}`}>
              <span className={`absolute inset-0 rounded-full ${incidentCount > 0 ? 'bg-amber-400' : 'bg-emerald-400'} animate-ping opacity-75`} />
              <span className={`relative rounded-full h-2.5 w-2.5 ${incidentCount > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            </span>
            <span className="text-sm font-bold text-slate-800">
              {incidentCount > 0 ? `${incidentCount} ${incidentCount === 1 ? 'item needs' : 'items need'} attention` : 'All systems normal'}
            </span>
          </div>
          <div className="h-5 w-px bg-slate-200" />
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Activity className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-semibold">{fleet.online.toLocaleString()}</span>
            <span className="text-slate-400">/ {fleet.total.toLocaleString()} screens online</span>
          </div>
          {liveNowCount > 0 && (
            <>
              <div className="h-5 w-px bg-slate-200" />
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <MonitorPlay className="w-3.5 h-3.5 text-indigo-500" />
                <span className="font-semibold">{liveNowCount}</span>
                <span className="text-slate-400">schedule{liveNowCount === 1 ? '' : 's'} playing now</span>
              </div>
            </>
          )}
          {fleet.stale > 0 && (
            <>
              <div className="h-5 w-px bg-slate-200" />
              <div className="flex items-center gap-2 text-xs text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span className="font-semibold">{fleet.stale}</span>
                <span>reporting stale</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── Getting started — 3-step guide ────────────────────── */}
      {showOnboarding && (
        <div className="relative bg-gradient-to-br from-indigo-50 via-white to-violet-50 rounded-2xl border border-indigo-100 p-8 shadow-sm">
          <button
            type="button"
            onClick={dismissHint}
            title="Hide this guide"
            aria-label="Hide getting-started guide"
            className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white/70 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
          <h2 className="text-lg font-bold text-slate-800 mb-2">Getting started</h2>
          <p className="text-sm text-slate-600 mb-6">Three steps to get your displays running. Dismiss this when you&rsquo;re set up.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <OnboardStep href={`${tenantBase}/assets`} step={1} color="sky" Icon={Upload} title="Upload Content" desc="Add images, videos, PDFs, or web URLs to your media library." cta="Go to Assets" />
            <OnboardStep href={`${tenantBase}/playlists`} step={2} color="violet" Icon={ListVideo} title="Build a Playlist" desc="Create a playlist and add your media with durations." cta="Go to Playlists" />
            <OnboardStep href={`${tenantBase}/screens`} step={3} color="emerald" Icon={MonitorPlay} title="Connect a Screen" desc="Pair devices or open the web player anywhere." cta="Go to Screens" />
          </div>
        </div>
      )}

      {/* ─── Fleet KPIs — aggregates, not counts ─────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          href={`${tenantBase}/screens`}
          label="Fleet Health"
          bigValue={`${fleet.onlinePct.toFixed(fleet.onlinePct === 100 ? 0 : 1)}%`}
          sub={`${fleet.online.toLocaleString()} / ${fleet.total.toLocaleString()} online`}
          tone={fleet.onlinePct >= 99 ? 'emerald' : fleet.onlinePct >= 90 ? 'amber' : 'rose'}
          Icon={MonitorCheck}
          emptyText={fleet.total === 0 ? 'No screens paired yet' : undefined}
        />
        <KpiCard
          href={`${tenantBase}/screens`}
          label="Down"
          bigValue={fleet.offline.toLocaleString()}
          sub={fleet.offline > 0 ? `${fleet.stale} stale pings` : 'all reporting in'}
          tone={fleet.offline > 0 ? 'rose' : 'slate'}
          Icon={CloudOff}
          mutedWhenZero
        />
        <KpiCard
          href={`${tenantBase}/schedules`}
          label="Playing Now"
          bigValue={liveNowCount.toLocaleString()}
          sub={`${todaysSchedules.length} scheduled today`}
          tone="indigo"
          Icon={MonitorPlay}
        />
        <KpiCard
          href={`${tenantBase}/assets`}
          label={pendingAssets.length > 0 ? 'Awaiting Approval' : 'Library'}
          bigValue={pendingAssets.length > 0 ? pendingAssets.length.toLocaleString() : (assets?.length || 0).toLocaleString()}
          sub={pendingAssets.length > 0
            ? 'queued for review'
            : recentAssetCount > 0 ? `+${recentAssetCount} this week` : 'total items'}
          tone={pendingAssets.length > 0 ? 'amber' : 'sky'}
          Icon={pendingAssets.length > 0 ? AlertTriangle : ImageIcon}
        />
        <KpiCard
          href={`${tenantBase}/screens`}
          label="Sites"
          bigValue={sites.length.toLocaleString()}
          sub={`${(playlists?.length || 0).toLocaleString()} playlists`}
          tone="violet"
          Icon={Building2}
        />
      </div>

      {/* ─── Sites rollup — the scalable equivalent of "per-screen tiles".
          One row per screen group. Troubled sites (any offline) sort to
          the top. This is what a district IT lead actually opens the
          dashboard to see at 8 AM. ──────────────────────────────── */}
      {sites.length > 0 && (
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-500" />
              <h2 className="text-sm font-bold text-slate-700">Sites</h2>
              <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
                Health by location
              </span>
            </div>
            <Link href={`${tenantBase}/screens`} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
              View all →
            </Link>
          </div>
          <div>
            {/* Header row */}
            <div className="px-5 py-2 border-b border-slate-100 grid grid-cols-12 gap-3 items-center bg-slate-50/50">
              <div className="col-span-5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Location</div>
              <div className="col-span-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Online</div>
              <div className="col-span-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Health</div>
              <div className="col-span-1" />
            </div>
            <div className="divide-y divide-slate-50">
              {sites.slice(0, 10).map((site) => {
                const healthy = site.offline === 0;
                return (
                  <Link
                    key={site.id}
                    href={`${tenantBase}/screens`}
                    className="px-5 py-3 grid grid-cols-12 gap-3 items-center hover:bg-slate-50 transition-colors group"
                  >
                    <div className="col-span-5 min-w-0 flex items-center gap-2.5">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${
                        healthy ? 'bg-emerald-500' : site.offline >= site.total / 2 ? 'bg-rose-500' : 'bg-amber-500'
                      }`} />
                      <span className="text-sm font-semibold text-slate-800 truncate">{site.name}</span>
                    </div>
                    <div className="col-span-2 text-right text-sm tabular-nums">
                      <span className={healthy ? 'text-emerald-700 font-semibold' : 'text-slate-700 font-semibold'}>
                        {site.online}
                      </span>
                      <span className="text-slate-400"> / {site.total}</span>
                    </div>
                    <div className="col-span-4 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            site.pct >= 99 ? 'bg-emerald-500' : site.pct >= 90 ? 'bg-amber-500' : 'bg-rose-500'
                          }`}
                          style={{ width: `${Math.max(2, site.pct)}%` }}
                        />
                      </div>
                      <span className={`text-[11px] font-bold tabular-nums shrink-0 ${
                        site.pct >= 99 ? 'text-emerald-600' : site.pct >= 90 ? 'text-amber-600' : 'text-rose-600'
                      }`}>
                        {site.pct.toFixed(site.pct === 100 ? 0 : 1)}%
                      </span>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </Link>
                );
              })}
            </div>
            {sites.length > 10 && (
              <div className="px-5 py-3 text-center border-t border-slate-100 bg-slate-50/30">
                <Link href={`${tenantBase}/screens`} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                  View remaining {sites.length - 10} site{sites.length - 10 === 1 ? '' : 's'} →
                </Link>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ─── Today's Schedule + Recent Activity ──────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Today's Schedule */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-500" />
              <h2 className="text-sm font-bold text-slate-700">Today's Schedule</h2>
              {todaysSchedules.length > 0 && (
                <span className="text-[11px] text-slate-400 font-semibold">
                  {liveNowCount} playing · {todaysSchedules.length} total
                </span>
              )}
            </div>
            <Link href={`${tenantBase}/schedules`} className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700">
              Manage →
            </Link>
          </div>
          <div className="divide-y divide-slate-50">
            {todaysSchedules.length === 0 ? (
              <div className="p-8 text-center">
                <Calendar className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">Nothing scheduled for today.</p>
                <Link href={`${tenantBase}/schedules`} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 mt-2 inline-flex items-center gap-1">
                  Create schedule <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            ) : (
              todaysSchedules.slice(0, 6).map((sched: any) => {
                const pl = playlistById[sched.playlistId];
                const isActive = nowHM >= (sched.timeStart || '00:00') && nowHM <= (sched.timeEnd || '23:59');
                return (
                  <div key={sched.id} className="px-5 py-3 flex items-center gap-3">
                    <div className={`w-1 h-10 rounded-full shrink-0 ${isActive ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                    <div className="w-16 text-[11px] font-mono font-semibold text-slate-500 shrink-0">
                      {sched.timeStart || '—'}
                      <div className="text-slate-400">{sched.timeEnd || ''}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">
                        {pl?.name || sched.name || 'Untitled schedule'}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {sched.screen?.name || sched.screenGroup?.name || 'All screens'}
                      </div>
                    </div>
                    {isActive && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 shrink-0">
                        Live
                      </span>
                    )}
                  </div>
                );
              })
            )}
            {todaysSchedules.length > 6 && (
              <div className="px-5 py-3 text-center bg-slate-50/30">
                <Link href={`${tenantBase}/schedules`} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                  View remaining {todaysSchedules.length - 6} →
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-700">Recent Activity</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {activity && activity.length > 0 ? (
              activity.slice(0, 8).map((log: any) => (
                <div key={log.id} className="px-5 py-3 flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-700 truncate">
                      {String(log.action || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">
                      {log.targetType?.toLowerCase()} · {new Date(log.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center">
                <p className="text-xs text-slate-400">Activity will appear here.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Exceptions + Quick Actions ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {pendingAssets.length > 0 && (
            <div className="bg-white rounded-2xl border border-amber-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-amber-100 flex items-center justify-between bg-amber-50/50">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <h2 className="text-sm font-bold text-slate-800">Pending Approvals</h2>
                  <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                    {pendingAssets.length}
                  </span>
                </div>
                <Link href={`${tenantBase}/assets`} className="text-[11px] font-semibold text-amber-700 hover:text-amber-800">
                  Review all →
                </Link>
              </div>
              <div className="divide-y divide-slate-50">
                {pendingAssets.slice(0, 4).map((a: any) => (
                  <div key={a.id} className="px-5 py-3 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden">
                      {a.fileUrl && /\.(png|jpg|jpeg|gif|webp)$/i.test(a.fileUrl) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.fileUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">{a.originalName || a.fileUrl?.split('/').pop() || 'Untitled'}</div>
                      <div className="text-[11px] text-slate-500">
                        {a.uploadedByUser?.email || 'Unknown uploader'} · {new Date(a.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      onClick={() => approveAsset.mutate(a.id)}
                      disabled={approveAsset.isPending}
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold disabled:opacity-50"
                    >
                      Approve
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {downScreens.length > 0 && (
            <div className="bg-white rounded-2xl border border-red-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-red-100 flex items-center justify-between bg-red-50/50">
                <div className="flex items-center gap-2">
                  <CloudOff className="w-4 h-4 text-red-600" />
                  <h2 className="text-sm font-bold text-slate-800">Screens Down</h2>
                  <span className="text-[11px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                    {downScreens.length}
                  </span>
                </div>
                <Link href={`${tenantBase}/screens`} className="text-[11px] font-semibold text-red-700 hover:text-red-800">
                  View all →
                </Link>
              </div>
              <div className="divide-y divide-slate-50">
                {downScreens.slice(0, 5).map((screen: any) => (
                  <div key={screen.id} className="px-5 py-3 flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">{screen.name}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {screen.location || screen.screenGroup?.name || 'Unknown location'}
                        {screen.lastPingAt && ` · last seen ${new Date(screen.lastPingAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingAssets.length === 0 && downScreens.length === 0 && !isEmpty && (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">Nothing needs attention.</p>
              <p className="text-xs text-slate-500 mt-1">No pending approvals, no offline screens.</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" /> Quick Actions
          </h2>
          <div className="space-y-1.5">
            <QuickLink href={`${tenantBase}/assets`} Icon={Upload} label="Upload Content" tone="sky" />
            <QuickLink href={`${tenantBase}/playlists`} Icon={Plus} label="New Playlist" tone="indigo" />
            <QuickLink href={`${tenantBase}/templates`} Icon={ListVideo} label="Pick a Template" tone="violet" />
            <QuickLink href={`${tenantBase}/screens`} Icon={MonitorPlay} label="Pair a Screen" tone="emerald" />
            <QuickLink href={`${tenantBase}/users`} Icon={UsersIcon} label="Invite Teammate" tone="slate" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Presentational subcomponents — kept in-file so the dashboard reads
// top-to-bottom without hunting.
// ════════════════════════════════════════════════════════════════════

function KpiCard({
  href, label, bigValue, sub, Icon, tone, emptyText, mutedWhenZero,
}: {
  href: string; label: string; bigValue: string; sub: string; Icon: any;
  tone: 'emerald' | 'rose' | 'amber' | 'indigo' | 'sky' | 'violet' | 'slate';
  emptyText?: string; mutedWhenZero?: boolean;
}) {
  const toneIcon: Record<string, string> = {
    emerald: 'from-emerald-400 to-emerald-600 shadow-emerald-500/30',
    rose:    'from-rose-400 to-rose-600 shadow-rose-500/30',
    amber:   'from-amber-400 to-amber-600 shadow-amber-500/30',
    indigo:  'from-indigo-400 to-indigo-600 shadow-indigo-500/30',
    sky:     'from-sky-400 to-sky-600 shadow-sky-500/30',
    violet:  'from-violet-400 to-violet-600 shadow-violet-500/30',
    slate:   'from-slate-300 to-slate-500 shadow-slate-400/20',
  };
  const toneValue: Record<string, string> = {
    emerald: 'text-emerald-600',
    rose:    'text-rose-600',
    amber:   'text-amber-600',
    indigo:  'text-indigo-600',
    sky:     'text-sky-600',
    violet:  'text-violet-600',
    slate:   'text-slate-500',
  };
  const isZero = bigValue === '0';
  const valueClass = mutedWhenZero && isZero ? 'text-slate-400' : toneValue[tone];
  return (
    <Link
      href={href}
      className="group bg-white rounded-xl border border-slate-200 p-4 hover:border-indigo-300 hover:shadow-md hover:-translate-y-0.5 transition-all"
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${toneIcon[tone]} flex items-center justify-center shadow`}>
          <Icon className="w-4 h-4 text-white" strokeWidth={2.5} />
        </div>
        <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all" />
      </div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">{label}</div>
      <div className={`text-[28px] font-black tracking-tight leading-none tabular-nums ${valueClass}`}>{bigValue}</div>
      <div className="mt-1 text-[11px] text-slate-500 truncate">{emptyText || sub}</div>
    </Link>
  );
}

function QuickLink({ href, Icon, label, tone }: { href: string; Icon: any; label: string; tone: 'sky'|'indigo'|'violet'|'emerald'|'red'|'slate' }) {
  const toneBg: Record<string, string> = {
    sky: 'hover:bg-sky-50 text-sky-600',
    indigo: 'hover:bg-indigo-50 text-indigo-600',
    violet: 'hover:bg-violet-50 text-violet-600',
    emerald: 'hover:bg-emerald-50 text-emerald-600',
    red: 'hover:bg-red-50 text-red-600',
    slate: 'hover:bg-slate-50 text-slate-600',
  };
  return (
    <Link href={href} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors group ${toneBg[tone]}`}>
      <Icon className="w-4 h-4 shrink-0" />
      <span className="text-sm font-semibold text-slate-700 flex-1">{label}</span>
      <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:translate-x-0.5 transition-all" />
    </Link>
  );
}

function OnboardStep({
  href, step, color, Icon, title, desc, cta,
}: { href: string; step: number; color: 'sky'|'violet'|'emerald'; Icon: any; title: string; desc: string; cta: string }) {
  const c: Record<string, { ring: string; icon: string; text: string }> = {
    sky:     { ring: 'hover:border-sky-300',     icon: 'bg-sky-50 text-sky-600 group-hover:bg-sky-100',         text: 'text-sky-600 group-hover:text-sky-700' },
    violet:  { ring: 'hover:border-violet-300',  icon: 'bg-violet-50 text-violet-600 group-hover:bg-violet-100', text: 'text-violet-600 group-hover:text-violet-700' },
    emerald: { ring: 'hover:border-emerald-300', icon: 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100', text: 'text-emerald-600 group-hover:text-emerald-700' },
  };
  return (
    <Link href={href} className={`group p-5 bg-white/70 backdrop-blur-md rounded-xl border border-slate-200 ${c[color].ring} hover:shadow-lg hover:-translate-y-1 transition-all duration-300`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-all ${c[color].icon}`}>
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="text-sm font-bold text-slate-800">{step}. {title}</h3>
      <p className="text-xs text-slate-500 mt-1">{desc}</p>
      <span className={`text-xs font-semibold mt-3 flex items-center gap-1 ${c[color].text}`}>
        {cta} <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
      </span>
    </Link>
  );
}
