"use client";

/**
 * Dashboard — the Command Center the user lands on after login.
 *
 * The old page was titled "Network Dashboard" with 4 generic stat cards
 * (Screens / Library / Playlists / Locations) and no signal about what's
 * actually happening right now. That's useless for a school admin at
 * 7:30 AM — they want to know: is everything running? anything on fire?
 * what's playing on each screen? what needs my approval?
 *
 * This rewrite answers those questions in one glance, top to bottom:
 *
 *   1. Emergency status banner (red if active, green if clear) —
 *      ALWAYS visible, never scrolled past. Load-bearing for safety.
 *   2. Fleet-at-a-glance stat strip (online ratio, pending approvals,
 *      schedules running TODAY, active playlists).
 *   3. "What's playing now" — per-screen mini cards with the currently
 *      scheduled playlist resolved from the schedules+today+now window.
 *   4. Today's schedule timeline + recent activity.
 *   5. Pending approvals + offline devices (only if they have items).
 *   6. Quick actions.
 *
 * Role-aware: panic trigger button only shown if user.canTriggerPanic
 * or their role includes admin privileges.
 */

import {
  MonitorCheck, CloudOff, ListVideo, Upload, Plus, ArrowRight,
  Image as ImageIcon, MonitorPlay, Siren, CheckCircle2, Clock,
  AlertTriangle, Calendar, Zap, Radio, Users as UsersIcon,
} from 'lucide-react';
import { useDashboardStats, useRecentActivity } from '@/hooks/use-dashboard-data';
import {
  useScreens, useScreenGroups, usePlaylists, useAssets, useSchedules,
  useTenantStatus, useApproveAsset,
} from '@/hooks/use-api';
import { useAppStore } from '@/lib/store';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useMemo } from 'react';

export default function DashboardPage() {
  const { data: stats } = useDashboardStats();
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

  // Live clock — only ticks every minute; cheaper than the 30s the
  // individual widgets use and this is just for the greeting.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const approveAsset = useApproveAsset();

  // ──────────────────────────────────────────────────────────────
  // Derived signals — all O(n) on already-fetched lists, no extra
  // network calls. Memoized so typing in the nav doesn't re-compute.
  // ──────────────────────────────────────────────────────────────
  const allScreens = screens || [];
  const onlineCount = allScreens.filter((s: any) => s.status === 'ONLINE').length;
  const offlineScreens = allScreens.filter((s: any) => s.status && s.status !== 'ONLINE' && s.status !== 'PENDING');
  const offlineCount = offlineScreens.length;
  const totalScreens = allScreens.length;
  const onlinePct = totalScreens > 0 ? Math.round((onlineCount / totalScreens) * 100) : 0;

  const pendingAssets = useMemo(
    () => (assets || []).filter((a: any) => a.status === 'PENDING_APPROVAL'),
    [assets],
  );
  const assetCount = assets?.length || 0;
  const playlistCount = playlists?.length || 0;

  // Today's schedule rows — filter by daysOfWeek (0=Sun..6=Sat)
  // matching today's local DOW. Sort by timeStart ASC. Active = now is
  // between timeStart/timeEnd and isActive !== false.
  const today = now.getDay();
  const todaysSchedules = useMemo(() => {
    const rows = (schedules || []).filter((s: any) => {
      if (s.isActive === false) return false;
      const dow: number[] | undefined = s.daysOfWeek;
      // daysOfWeek is stored as integer array; some tenants stored it
      // as bitmap in earlier seeds — treat empty/missing as "every day"
      // so old rows don't disappear.
      if (Array.isArray(dow) && dow.length > 0 && !dow.includes(today)) return false;
      return true;
    });
    return rows.sort((a: any, b: any) => String(a.timeStart || '').localeCompare(String(b.timeStart || '')));
  }, [schedules, today]);

  const activeScheduleCount = useMemo(() => {
    const nowHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return todaysSchedules.filter((s: any) => {
      const start = s.timeStart || '00:00';
      const end = s.timeEnd || '23:59';
      return nowHM >= start && nowHM <= end;
    }).length;
  }, [todaysSchedules, now]);

  // Resolve "what's playing now" per screen — O(screens × schedules)
  // but both lists are small in practice (<100 of each).
  const nowHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const playlistById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const p of (playlists || [])) m[p.id] = p;
    return m;
  }, [playlists]);

  function currentPlaylistForScreen(screen: any): { name: string; id?: string } | null {
    const candidates = (schedules || []).filter((s: any) => {
      if (s.isActive === false) return false;
      const dow: number[] | undefined = s.daysOfWeek;
      if (Array.isArray(dow) && dow.length > 0 && !dow.includes(today)) return false;
      const start = s.timeStart || '00:00';
      const end = s.timeEnd || '23:59';
      if (!(nowHM >= start && nowHM <= end)) return false;
      // Target matches this screen directly OR via its group.
      if (s.screenId && s.screenId === screen.id) return true;
      if (s.screenGroupId && screen.screenGroupId && s.screenGroupId === screen.screenGroupId) return true;
      return false;
    });
    if (candidates.length === 0) return null;
    // Highest priority wins; tie-break by most-specific (screen over group).
    candidates.sort((a: any, b: any) => {
      const pDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (pDiff !== 0) return pDiff;
      return (a.screenId ? 0 : 1) - (b.screenId ? 0 : 1);
    });
    const winner = candidates[0];
    const pl = playlistById[winner.playlistId];
    return pl ? { name: pl.name, id: pl.id } : null;
  }

  const isEmpty = assetCount === 0 && totalScreens === 0;
  const emergencyActive = !!(tenant?.emergencyStatus && tenant.emergencyStatus !== 'INACTIVE');
  const emergencyMode = tenant?.emergencyStatus as string | undefined;

  // Role gate for panic trigger button (tenant admins + anyone with the
  // explicit capability flag). Matches the backend guard semantics.
  const canTriggerPanic = !!(user?.canTriggerPanic
    || user?.role === 'SUPER_ADMIN'
    || user?.role === 'DISTRICT_ADMIN'
    || user?.role === 'SCHOOL_ADMIN');

  const tenantName = (tenant as any)?.name || (user as any)?.tenantName || 'Your Organization';
  const greeting = (() => {
    const h = now.getHours();
    if (h < 5) return 'Working late';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    if (h < 21) return 'Good evening';
    return 'Good night';
  })();
  const firstName = (() => {
    const e = (user as any)?.email || '';
    const local = e.split('@')[0] || '';
    const bit = local.split(/[._-]/)[0];
    return bit ? bit.charAt(0).toUpperCase() + bit.slice(1) : 'there';
  })();

  return (
    <div className="space-y-6 pb-12">
      {/* ─── Header + live clock ──────────────────────────────── */}
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

      {/* ─── Emergency Status Banner ───────────────────────────────
          Load-bearing — this is the first thing the admin should see.
          Red + alarmed when active; quiet green "all clear" otherwise.
          Never scrolled past. */}
      {emergencyActive ? (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-red-600 to-red-500 text-white shadow-lg shadow-red-500/30 border border-red-400/50">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.2),transparent)]" />
          <div className="relative p-5 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur flex items-center justify-center shrink-0 animate-pulse">
              <Siren className="w-7 h-7" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-bold tracking-widest uppercase opacity-90">Active Emergency</div>
              <div className="text-xl font-bold mt-0.5">
                {emergencyMode || 'Emergency Alert Active'}
              </div>
              <div className="text-sm opacity-90 mt-0.5">All screens are displaying the emergency override.</div>
            </div>
            <Link
              href={`${tenantBase}/emergency`}
              className="shrink-0 px-4 py-2.5 rounded-xl bg-white/95 text-red-600 text-sm font-bold hover:bg-white shadow-sm transition-colors"
            >
              Open Emergency Console
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-gradient-to-r from-emerald-50 to-white border border-emerald-100 px-5 py-3 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-800">All systems normal</div>
            <div className="text-xs text-slate-500">No active alerts · {onlineCount}/{totalScreens} screens online</div>
          </div>
          {canTriggerPanic && (
            <Link
              href={`${tenantBase}/emergency`}
              className="shrink-0 text-xs font-semibold text-red-600 hover:text-red-700 flex items-center gap-1"
            >
              <Siren className="w-3.5 h-3.5" /> Trigger alert
            </Link>
          )}
        </div>
      )}

      {/* ─── Getting Started (first-run only) ────────────────── */}
      {isEmpty && (
        <div className="bg-gradient-to-br from-indigo-50 via-white to-violet-50 rounded-2xl border border-indigo-100 p-8 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 mb-2">Welcome to EduSignage</h2>
          <p className="text-sm text-slate-600 mb-6">Get your digital signage running in 3 steps:</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <OnboardStep href={`${tenantBase}/assets`} step={1} color="sky" Icon={Upload} title="Upload Content" desc="Add images, videos, PDFs, or web URLs to your media library." cta="Go to Assets" />
            <OnboardStep href={`${tenantBase}/playlists`} step={2} color="violet" Icon={ListVideo} title="Build a Playlist" desc="Create a playlist and add your media with durations." cta="Go to Playlists" />
            <OnboardStep href={`${tenantBase}/screens`} step={3} color="emerald" Icon={MonitorPlay} title="Connect a Screen" desc="Pair devices or open the web player anywhere." cta="Go to Screens" />
          </div>
        </div>
      )}

      {/* ─── Stat strip — fleet-at-a-glance ───────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          href={`${tenantBase}/screens`}
          label="Fleet Online"
          value={`${onlineCount}/${totalScreens || 0}`}
          hint={totalScreens === 0 ? 'No screens paired yet' : `${onlinePct}% of fleet reporting in`}
          dotColor={onlineCount === totalScreens && totalScreens > 0 ? 'emerald' : offlineCount > 0 ? 'rose' : 'slate'}
          Icon={MonitorCheck}
          iconTone="emerald"
        />
        <StatCard
          href={`${tenantBase}/assets`}
          label={pendingAssets.length > 0 ? 'Pending Approval' : 'Content Library'}
          value={pendingAssets.length > 0 ? String(pendingAssets.length) : String(assetCount)}
          hint={pendingAssets.length > 0
            ? `${pendingAssets.length} asset${pendingAssets.length === 1 ? '' : 's'} waiting for review`
            : assetCount === 0 ? 'Library is empty' : `${assetCount} item${assetCount === 1 ? '' : 's'}`}
          Icon={pendingAssets.length > 0 ? AlertTriangle : ImageIcon}
          iconTone={pendingAssets.length > 0 ? 'amber' : 'sky'}
          dotColor={pendingAssets.length > 0 ? 'amber' : 'slate'}
        />
        <StatCard
          href={`${tenantBase}/schedules`}
          label="Running Today"
          value={String(activeScheduleCount)}
          hint={`${todaysSchedules.length} scheduled for today`}
          Icon={Calendar}
          iconTone="indigo"
          dotColor={activeScheduleCount > 0 ? 'indigo' : 'slate'}
        />
        <StatCard
          href={`${tenantBase}/playlists`}
          label="Playlists"
          value={String(playlistCount)}
          hint={`${screenGroups?.length || 0} screen group${(screenGroups?.length || 0) === 1 ? '' : 's'}`}
          Icon={ListVideo}
          iconTone="violet"
        />
      </div>

      {/* ─── What's playing now — per-screen mini tiles ─────────── */}
      {totalScreens > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Radio className="w-4 h-4 text-emerald-600" />
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <h2 className="text-sm font-bold text-slate-700">Live Now</h2>
              <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
                What's on every screen
              </span>
            </div>
            <Link href={`${tenantBase}/screens`} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
              View all {totalScreens} <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {allScreens.slice(0, 8).map((screen: any) => {
              const playing = currentPlaylistForScreen(screen);
              const isOnline = screen.status === 'ONLINE';
              return (
                <Link
                  key={screen.id}
                  href={`${tenantBase}/screens`}
                  className="group bg-white rounded-xl border border-slate-200 p-4 hover:border-indigo-300 hover:shadow-md transition-all"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                      <span className="text-sm font-bold text-slate-800 truncate">{screen.name}</span>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      isOnline ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {screen.status || 'Offline'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 mb-2 truncate">
                    {screen.location || screen.screenGroup?.name || '—'}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <ListVideo className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    <span className={`truncate ${playing ? 'text-slate-700 font-semibold' : 'text-slate-400 italic'}`}>
                      {playing ? playing.name : 'No schedule active'}
                    </span>
                  </div>
                </Link>
              );
            })}
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

      {/* ─── Needs Attention + Quick Actions ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Needs Attention column — only renders cards that have items */}
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

          {offlineCount > 0 && (
            <div className="bg-white rounded-2xl border border-red-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-red-100 flex items-center justify-between bg-red-50/50">
                <div className="flex items-center gap-2">
                  <CloudOff className="w-4 h-4 text-red-600" />
                  <h2 className="text-sm font-bold text-slate-800">Offline Devices</h2>
                  <span className="text-[11px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                    {offlineCount}
                  </span>
                </div>
                <Link href={`${tenantBase}/screens`} className="text-[11px] font-semibold text-red-700 hover:text-red-800">
                  View all →
                </Link>
              </div>
              <div className="divide-y divide-slate-50">
                {offlineScreens.slice(0, 5).map((screen: any) => (
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

          {pendingAssets.length === 0 && offlineCount === 0 && !isEmpty && (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">Nothing needs attention.</p>
              <p className="text-xs text-slate-500 mt-1">No pending approvals, no offline screens.</p>
            </div>
          )}
        </div>

        {/* Quick Actions */}
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
            {canTriggerPanic && (
              <QuickLink href={`${tenantBase}/emergency`} Icon={Siren} label="Emergency Console" tone="red" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Presentational subcomponents — kept in-file so the whole dashboard
// reads top-to-bottom without hunting through files. These are dumb
// wrappers around Tailwind classes, no logic.
// ────────────────────────────────────────────────────────────────

function StatCard({
  href, label, value, hint, Icon, iconTone, dotColor = 'slate',
}: {
  href: string; label: string; value: string; hint: string;
  Icon: any; iconTone: 'emerald'|'sky'|'indigo'|'violet'|'amber'|'red';
  dotColor?: 'emerald'|'rose'|'amber'|'indigo'|'slate';
}) {
  const toneClasses: Record<string, string> = {
    emerald: 'from-emerald-400 to-emerald-600 shadow-emerald-500/30',
    sky:     'from-sky-400 to-sky-600 shadow-sky-500/30',
    indigo:  'from-indigo-400 to-indigo-600 shadow-indigo-500/30',
    violet:  'from-violet-400 to-violet-600 shadow-violet-500/30',
    amber:   'from-amber-400 to-amber-600 shadow-amber-500/30',
    red:     'from-red-400 to-red-600 shadow-red-500/30',
  };
  const dotClasses: Record<string, string> = {
    emerald: 'bg-emerald-500',
    rose:    'bg-rose-500',
    amber:   'bg-amber-500',
    indigo:  'bg-indigo-500',
    slate:   'bg-slate-300',
  };
  return (
    <Link
      href={href}
      className="group bg-white rounded-2xl border border-slate-200 p-5 hover:border-indigo-300 hover:shadow-lg hover:-translate-y-0.5 transition-all"
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${toneClasses[iconTone]} flex items-center justify-center shadow-lg`}>
          <Icon className="w-5 h-5 text-white" strokeWidth={2.5} />
        </div>
        <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all" />
      </div>
      <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1">{label}</div>
      <div className="text-3xl font-black tracking-tight text-slate-900">{value}</div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
        <span className={`w-1.5 h-1.5 rounded-full ${dotClasses[dotColor]}`} />
        <span className="truncate">{hint}</span>
      </div>
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
  const c: Record<string, { ring: string; icon: string; text: string; chip: string }> = {
    sky:     { ring: 'hover:border-sky-300',     icon: 'bg-sky-50 text-sky-600 group-hover:bg-sky-100',         text: 'text-sky-600 group-hover:text-sky-700',         chip: 'bg-sky-50 text-sky-700' },
    violet:  { ring: 'hover:border-violet-300',  icon: 'bg-violet-50 text-violet-600 group-hover:bg-violet-100', text: 'text-violet-600 group-hover:text-violet-700',   chip: 'bg-violet-50 text-violet-700' },
    emerald: { ring: 'hover:border-emerald-300', icon: 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100', text: 'text-emerald-600 group-hover:text-emerald-700', chip: 'bg-emerald-50 text-emerald-700' },
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
