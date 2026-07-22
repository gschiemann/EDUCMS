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
  TrendingUp, TrendingDown, Activity, X, RefreshCw,
} from 'lucide-react';
import { useRecentActivity } from '@/hooks/use-dashboard-data';
import {
  useScreens, useScreenGroups, usePlaylists, useAssets, useSchedules,
  useTenantStatus, useApproveAsset, useSubmissions, useTenantBranding, useFleet,
  type SubmissionRow,
} from '@/hooks/use-api';
import { useAppStore } from '@/lib/store';
import { useUIStore } from '@/store/ui-store';
import { useIsMobile } from '@/hooks/use-mobile';
import { firstName as userFirstName } from '@/lib/user-display';
import { MobileDashboard } from '@/components/dashboard/MobileDashboard';
import { FleetRollup } from '@/components/screens/FleetRollup';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { transformedImageUrl } from '@/lib/asset-image';

export default function DashboardPage() {
  const t = useTranslations();
  const isMobile = useIsMobile();
  const params = useParams<{ schoolId?: string }>();
  // HQ fleet command center (Corporate dashboard). Admin-gated; a leaf tenant
  // gets nothing extra. Declared before any early return to satisfy rules-of-hooks.
  const fleetRole = useUIStore((s) => s.user?.role);
  const canFleet = fleetRole === 'SUPER_ADMIN' || fleetRole === 'DISTRICT_ADMIN';
  const fleetRollupQuery = useFleet({ enabled: canFleet });
  const fleetRollup = fleetRollupQuery.data;
  const isHQ = (fleetRollup?.locations?.length ?? 0) > 1;
  const schoolId = params?.schoolId || '';

  // All hooks below run on EVERY render regardless of viewport (Rules
  // of Hooks). MobileDashboard re-uses the same hooks anyway, so the
  // network cost is identical between the two paths. The mobile path
  // simply uses its own JSX tree — see the early return at the very
  // end of this function.

  const { data: activity } = useRecentActivity();
  const screensQuery = useScreens();
  const { data: screens } = screensQuery;
  const { data: screenGroups } = useScreenGroups();
  const playlistsQuery = usePlaylists();
  const { data: playlists } = playlistsQuery;
  const assetsQuery = useAssets();
  const { data: assets } = assetsQuery;
  const { data: schedules } = useSchedules();
  const { data: tenant } = useTenantStatus();
  // 2026-05-25 — restored takeover sprint #1: pull TenantBranding so
  // the dashboard hero shows displayName + tagline + brand-tinted
  // gradient. SSR-safe via react-query (queryFn doesn't run on the
  // server, so the SSR crash that triggered the original NUCLEAR
  // REVERT can't re-occur). Falls back to tenant.name when no
  // branding is adopted.
  const { data: branding } = useTenantBranding();
  // When the core fleet queries fail, every list below is empty and the
  // dashboard masks the outage as a fresh, content-less tenant. Surface
  // the failure with a retry instead.
  const loadError = screensQuery.isError || playlistsQuery.isError || assetsQuery.isError;
  const retryLoad = () => {
    screensQuery.refetch();
    playlistsQuery.refetch();
    assetsQuery.refetch();
  };
  const user = useAppStore((s) => s.user);
  const userRole = useUIStore((s) => s.user?.role);
  const isViewer = userRole === 'RESTRICTED_VIEWER';
  const isContributor = userRole === 'CONTRIBUTOR';
  const pathname = usePathname();
  const tenantBase = pathname?.split('/').slice(0, 2).join('/') || '';
  const { data: mySubmissions } = useSubmissions({ mine: true });

  // Minute-clock for the header greeting + "live" scheduling match.
  // 2026-05-14 — was `useState(() => new Date())` which produced a
  // hydration mismatch (React error #418): the server's "now" vs
  // the client's "now" differ, and any tile derived from `today` /
  // `nowHM` rendered different HTML on each side. Prod smoke had
  // been failing on all 7 tenant dashboards for 30+ commits because
  // of this. Fix: start `null` (matches between server + client),
  // populate in useEffect after hydration, fall back to safe
  // defaults in the render path until then.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 60_000);
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
  // `now === null` during the SSR/hydration phase (before the post-
  // mount useEffect populates it). Use a neutral default so the
  // rendered HTML matches between server and client — `today = -1`
  // means "no day-of-week filter applies" (every active schedule
  // passes), and `nowHM = ''` makes the empty-string compare to
  // `>= '00:00'` always true → `liveNowCount` reflects total active
  // schedules until the client populates `now` ~16ms later.
  const today = now ? now.getDay() : -1;
  const nowHM = now ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` : '';
  // Schedule.daysOfWeek is a comma-joined string of day tokens
  // ('Mon,Wed,Fri') — NOT a number[]. Map JS getDay() (Sun=0) to the
  // matching token so the filter actually narrows to today's schedules.
  // During SSR/hydration `today` is -1 → token '' → no filter applies
  // (every active schedule passes), matching the prior neutral default.
  const todayTok = today >= 0 ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][today] : '';
  const todaysSchedules = useMemo(() => {
    return (schedules || [])
      .filter((s: any) => {
        if (s.isActive === false) return false;
        const days = String(s.daysOfWeek || '')
          .split(',').map((d: string) => d.trim()).filter(Boolean);
        if (days.length > 0 && todayTok && !days.includes(todayTok)) return false;
        return true;
      })
      .sort((a: any, b: any) => String(a.timeStart || '').localeCompare(String(b.timeStart || '')));
  }, [schedules, todayTok]);

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
  // Backwards-compat — some downstream sections still reference
  // `isEmpty` for "nothing to do here" empty states. Kept as an alias.
  const isEmpty = (assets?.length || 0) === 0 && fleet.total === 0;

  // "Getting started" 3-step card visibility. We used to auto-hide the
  // card when {assets, screens, schedules} were all populated, but the
  // React Query fetch timing made it flicker — it would flash in while
  // data was loading and then vanish once the last query resolved. The
  // Integration Lead asked for a steady, always-visible guide that only
  // goes away when they explicitly close it. Now the only gate is the
  // per-user "I dismissed this" flag in localStorage.
  const [hintDismissed, setHintDismissed] = useState(false);
  useEffect(() => {
    try { setHintDismissed(localStorage.getItem('edu_dashboard_hint_dismissed') === '1'); } catch {}
  }, []);
  const dismissHint = () => {
    setHintDismissed(true);
    try { localStorage.setItem('edu_dashboard_hint_dismissed', '1'); } catch {}
  };
  // 2026-05-26 — operator: "once i close the quick startup steps on
  // the dashboard, how do i ever pull it back up again." Add a
  // restoreHint() handler + render a small "Show getting started"
  // link in place of the card when dismissed, so the operator can
  // always re-open the 3-step guide from where it disappeared.
  const restoreHint = () => {
    setHintDismissed(false);
    try { localStorage.removeItem('edu_dashboard_hint_dismissed'); } catch {}
  };
  const showOnboarding = !hintDismissed;
  const tenantName = (tenant as any)?.name || (user as any)?.tenantName || 'Your Organization';
  // 2026-05-11 — operator: "say Hi Greg not gschiemann." Helper
  // prefers User.firstName when set; falls back to email-prefix for
  // legacy rows that haven't filled in their profile. Single source
  // of truth in lib/user-display.ts so the sidebar + top toolbar +
  // avatar pick up the same name.
  const firstName = userFirstName(user);
  const greeting = (() => {
    // Pre-mount (now === null) we render a neutral "Hello" so the
    // server-side HTML matches the client's first paint. Real
    // time-aware greeting kicks in after the post-mount useEffect.
    if (!now) return 'Hello';
    const h = now.getHours();
    if (h < 5) return 'Working late';
    if (h < 12) return t('dashboard.greetingMorning');
    if (h < 17) return t('dashboard.greetingAfternoon');
    if (h < 21) return t('dashboard.greetingEvening');
    return t('dashboard.greetingNight');
  })();

  // Incident count rolls up everything actionable into one number —
  // admin knows at a glance whether today needs attention.
  const incidentCount = fleet.offline + pendingAssets.length;

  // 2026-05-14 — mobile-first early return. All hooks above ran
  // unconditionally so Rules of Hooks are satisfied. MobileDashboard
  // reads the same data via its own hook calls (React Query dedupes
  // requests), so no extra network calls.
  if (isMobile) {
    return <MobileDashboard schoolId={schoolId} />;
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Brand-aware overrides — swaps hardcoded indigo for CSS vars */}
      <style>{`
        .dash-link { color: var(--brand-primary, #4f46e5); }
        .dash-link:hover { color: color-mix(in srgb, var(--brand-primary, #4f46e5) 80%, black); }
        .dash-kpi-card:hover { border-color: color-mix(in srgb, var(--brand-primary, #6366f1) 50%, transparent); }
        .group:hover .dash-arrow { color: var(--brand-primary, #6366f1); }
        .dash-quick-brand:hover { background: color-mix(in srgb, var(--brand-primary, #6366f1) 8%, white); }
      `}</style>
      {/* ─── Header ─────────────────────────────────────────────
          2026-05-25 — restored takeover sprint #1's branded gradient
          hero. When tenant has adopted branding (displayName +
          optional tagline), render a soft brand-tinted banner with
          a blur orb in the top-right. Falls back to the plain
          greeting when no branding is adopted.

          SSR safety: hero rendering is gated on `branding?.displayName`,
          which is null on SSR (react-query queryFn doesn't run server-
          side). So unbranded tenants get the plain block on first
          paint; branded ones repaint into the hero post-hydration.
          No throw paths in the render tree → SSR crash that killed
          the original takeover cannot re-occur from this surface. */}
      {branding?.displayName ? (
        <header
          className="relative rounded-2xl overflow-hidden p-6"
          style={{
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--brand-primary, #4f46e5) 18%, white), color-mix(in srgb, var(--brand-primary, #4f46e5) 8%, white))',
            border: '1px solid color-mix(in srgb, var(--brand-primary, #4f46e5) 18%, white)',
            // 2026-05-26 — operator: "your gradient goes over the
            // rounded menu, please fix that". The blurred orb below
            // uses `filter: blur(20px)` which Chrome renders OUTSIDE
            // the parent's overflow:hidden + border-radius clip
            // (known compositor quirk with filtered descendants of
            // rounded containers). `isolation: isolate` creates a new
            // stacking context here so the filtered child is clipped
            // by THIS box's rounded edges instead of leaking past
            // them. Belt-and-suspenders is the explicit clipper div
            // below.
            isolation: 'isolate',
          }}
        >
          {/* Orb clipper — explicitly re-clips the blurred orb to the
              parent's rounded-2xl radius. Even when `overflow: hidden`
              on the parent fails to clip the filter (the Chrome bug
              above), this wrapper guarantees the blur stays inside. */}
          <div
            aria-hidden
            className="absolute top-0 right-0 bottom-0 left-0 overflow-hidden pointer-events-none"
            style={{ borderRadius: 'inherit' }}
          >
            <div
              className="absolute -top-12 -right-12 w-48 h-48 rounded-full"
              style={{
                background:
                  'radial-gradient(circle, color-mix(in srgb, var(--brand-primary, #4f46e5) 35%, transparent), transparent 70%)',
                filter: 'blur(20px)',
              }}
            />
          </div>
          <div className="relative flex items-start justify-between gap-6 flex-wrap">
            <div className="min-w-0 flex-1">
              <h1
                className="text-3xl font-extrabold tracking-tight leading-tight"
                style={{ color: 'color-mix(in srgb, var(--brand-primary, #4f46e5) 85%, black)' }}
              >
                Welcome back to {branding.displayName}
              </h1>
              {branding.tagline && (
                <p
                  className="text-sm font-medium mt-1.5 max-w-2xl"
                  style={{ color: 'color-mix(in srgb, var(--brand-primary, #4f46e5) 70%, black)' }}
                >
                  {branding.tagline}
                </p>
              )}
              <div className="flex items-center gap-x-3 gap-y-1 mt-3 flex-wrap text-[12px] font-semibold text-slate-700">
                {now && (
                  <span>
                    {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                  </span>
                )}
                {Array.isArray(screens) && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span>
                      {t('dashboard.screensOnlineOf', { online: screens.filter((s: any) => s.status === 'ONLINE').length, total: screens.length })}
                    </span>
                  </>
                )}
                {Array.isArray(schedules) && schedules.length > 0 && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span>{t('dashboard.schedulesCount', { count: schedules.length })}</span>
                  </>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-2xl font-bold text-slate-800 tabular-nums">
                {now ? now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}
              </div>
              <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                {t('dashboard.localTime')}
              </div>
            </div>
          </div>
        </header>
      ) : (
        <header className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
              {greeting}, {firstName}
            </h1>
            <p className="text-sm font-medium text-slate-500 mt-1">
              {tenantName}{now && ` · ${now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-slate-800 tabular-nums">
              {now ? now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}
            </div>
            <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">{t('dashboard.localTime')}</div>
          </div>
        </header>
      )}

      {/* ─── Load error ─────────────────────────────────────────
          If the core fleet queries failed, say so plainly — otherwise
          the cards below all read zero and an outage looks like an
          empty tenant. */}
      {loadError && (
        <div className="rounded-xl bg-white border border-rose-200 px-5 py-4 flex items-center gap-4 flex-wrap">
          <AlertTriangle className="w-6 h-6 text-rose-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-800">{t('dashboard.loadError')}</div>
            <div className="text-[13px] text-slate-500 mt-0.5">
              {t('dashboard.loadErrorDesc')}
            </div>
          </div>
          <button
            onClick={retryLoad}
            className="shrink-0 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" /> {t('dashboard.retry')}
          </button>
        </div>
      )}

      {/* HQ fleet command center — every child location's screens on one map +
          per-store list + search/filter (Corporate dashboard). Renders only for
          a parent with child locations; clicking a store switches into it. */}
      {isHQ && fleetRollup && <FleetRollup fleet={fleetRollup} />}

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
              <div className="text-[11px] font-bold tracking-widest uppercase opacity-90">{t('dashboard.activeEmergency')}</div>
              <div className="text-xl font-bold mt-0.5">{emergencyMode || t('dashboard.emergencyAlertActive')}</div>
              <div className="text-sm opacity-90 mt-0.5">{t('dashboard.emergencyOverrideAll')}</div>
            </div>
            <Link
              href={`${tenantBase}/emergency/broadcast`}
              className="shrink-0 px-4 py-2.5 rounded-xl bg-white/95 text-red-600 text-sm font-bold hover:bg-white shadow-sm transition-colors"
            >
              {t('dashboard.emergencyConsole')}
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
              {incidentCount > 0 ? t('dashboard.itemsNeedAttention', { count: incidentCount }) : t('dashboard.allSystemsNormal')}
            </span>
          </div>
          <div className="h-5 w-px bg-slate-200" />
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Activity className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-semibold">{fleet.online.toLocaleString()}</span>
            <span className="text-slate-400">{t('dashboard.fleetOnlineOf', { total: fleet.total.toLocaleString() })}</span>
          </div>
          {liveNowCount > 0 && (
            <>
              <div className="h-5 w-px bg-slate-200" />
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <MonitorPlay className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary, #6366f1)' }} />
                <span className="font-semibold">{liveNowCount}</span>
                <span className="text-slate-400">{t('dashboard.schedulesPlayingNow', { count: liveNowCount })}</span>
              </div>
            </>
          )}
          {fleet.stale > 0 && (
            <>
              <div className="h-5 w-px bg-slate-200" />
              <div className="flex items-center gap-2 text-xs text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span className="font-semibold">{fleet.stale}</span>
                <span>{t('dashboard.reportingStale')}</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── Getting started — 3-step guide ──────────────────────
          2026-05-26: when dismissed, render a tiny "Show getting
          started" pill in its place so the operator can always pull
          the guide back up. Without this, dismissing was a one-way
          door — operators who closed it early lost the 3-step
          onramp for good. */}
      {!showOnboarding && (
        <button
          type="button"
          onClick={restoreHint}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-800 text-xs font-semibold transition-colors"
        >
          <span aria-hidden>↺</span> Show getting started
        </button>
      )}
      {showOnboarding && (
        <div className="relative bg-gradient-to-br from-indigo-50 via-white to-violet-50 rounded-2xl border border-indigo-100 p-8 shadow-sm">
          <button
            type="button"
            onClick={dismissHint}
            title={t('dashboard.hideGuide')}
            aria-label={t('dashboard.hideGuideAria')}
            className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white/70 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
          <h2 className="text-lg font-bold text-slate-800 mb-2">{t('dashboard.gettingStarted')}</h2>
          <p className="text-sm text-slate-600 mb-6">{t('dashboard.gettingStartedDesc')}</p>
          {/* Step order reflects the real setup flow: you can't pick a
              target for a playlist if no screens are paired yet, so
              "Connect a Screen" is step 1. Assets comes next (what
              will play), then Playlist (what to play + where). */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <OnboardStep href={`${tenantBase}/screens`} step={1} color="emerald" Icon={MonitorPlay} title={t('dashboard.step1Title')} desc={t('dashboard.step1Desc')} cta={t('dashboard.step1Cta')} />
            <OnboardStep href={`${tenantBase}/assets`} step={2} color="sky" Icon={Upload} title={t('dashboard.step2Title')} desc={t('dashboard.step2Desc')} cta={t('dashboard.step2Cta')} />
            <OnboardStep href={`${tenantBase}/playlists`} step={3} color="violet" Icon={ListVideo} title={t('dashboard.step3Title')} desc={t('dashboard.step3Desc')} cta={t('dashboard.step3Cta')} />
          </div>
        </div>
      )}

      {/* ─── Fleet KPIs — aggregates, not counts ─────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          href={`${tenantBase}/screens`}
          label={t('dashboard.fleetHealth')}
          bigValue={`${fleet.onlinePct.toFixed(fleet.onlinePct === 100 ? 0 : 1)}%`}
          sub={`${fleet.online.toLocaleString()} / ${fleet.total.toLocaleString()} online`}
          tone={fleet.onlinePct >= 99 ? 'emerald' : fleet.onlinePct >= 90 ? 'amber' : 'rose'}
          Icon={MonitorCheck}
          emptyText={fleet.total === 0 ? t('dashboard.noScreensPaired') : undefined}
        />
        <KpiCard
          href={`${tenantBase}/screens`}
          label={t('dashboard.down')}
          bigValue={fleet.offline.toLocaleString()}
          sub={fleet.offline > 0 ? t('dashboard.stalePings', { count: fleet.stale }) : t('dashboard.allReportingIn')}
          tone={fleet.offline > 0 ? 'rose' : 'slate'}
          Icon={CloudOff}
          mutedWhenZero
        />
        <KpiCard
          href={`${tenantBase}/playlists`}
          label={t('dashboard.playingNow')}
          bigValue={liveNowCount.toLocaleString()}
          sub={t('dashboard.scheduledToday', { count: todaysSchedules.length })}
          tone="indigo"
          Icon={MonitorPlay}
        />
        <KpiCard
          href={`${tenantBase}/assets`}
          label={pendingAssets.length > 0 ? t('dashboard.awaitingApproval') : t('dashboard.library')}
          bigValue={pendingAssets.length > 0 ? pendingAssets.length.toLocaleString() : (assets?.length || 0).toLocaleString()}
          sub={pendingAssets.length > 0
            ? 'queued for review'
            : recentAssetCount > 0 ? `+${recentAssetCount} this week` : 'total items'}
          tone={pendingAssets.length > 0 ? 'amber' : 'sky'}
          Icon={pendingAssets.length > 0 ? AlertTriangle : ImageIcon}
        />
        <KpiCard
          href={`${tenantBase}/screens`}
          label={t('dashboard.sites')}
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
            <Link href={`${tenantBase}/screens`} className="dash-link text-xs font-semibold">
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
                      <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:translate-x-0.5 transition-all dash-arrow" />
                    </div>
                  </Link>
                );
              })}
            </div>
            {sites.length > 10 && (
              <div className="px-5 py-3 text-center border-t border-slate-100 bg-slate-50/30">
                <Link href={`${tenantBase}/screens`} className="dash-link text-xs font-semibold">
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
              <Calendar className="w-4 h-4" style={{ color: 'var(--brand-primary, #6366f1)' }} />
              <h2 className="text-sm font-bold text-slate-700">{t('dashboard.todaysSchedule')}</h2>
              {todaysSchedules.length > 0 && (
                <span className="text-[11px] text-slate-400 font-semibold">
                  {liveNowCount} playing · {todaysSchedules.length} total
                </span>
              )}
            </div>
            <Link href={`${tenantBase}/playlists`} className="dash-link text-[11px] font-semibold">
              Manage →
            </Link>
          </div>
          <div className="divide-y divide-slate-50">
            {todaysSchedules.length === 0 ? (
              <div className="p-8 text-center">
                <Calendar className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">{t('dashboard.nothingScheduled')}</p>
                <Link href={`${tenantBase}/playlists`} className="dash-link text-xs font-semibold mt-2 inline-flex items-center gap-1">
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
                <Link href={`${tenantBase}/playlists`} className="dash-link text-xs font-semibold">
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
            <h2 className="text-sm font-bold text-slate-700">{t('dashboard.recentActivity')}</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {activity && activity.length > 0 ? (
              activity.slice(0, 8).map((log: any) => (
                <div key={log.id} className="px-5 py-3 flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: 'var(--brand-primary, #818cf8)' }} />
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
                <p className="text-xs text-slate-400">{t('dashboard.activityAppearHere')}</p>
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
                  <h2 className="text-sm font-bold text-slate-800">{t('dashboard.pendingApprovals')}</h2>
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
                        // 2026-05-30 — EGRESS FIX: 40px pending-asset thumb → 80px transform
                        <img src={transformedImageUrl(a.fileUrl, { width: 80, quality: 60 })} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">{a.originalName || a.fileUrl?.split('/').pop() || t('dashboard.untitled')}</div>
                      <div className="text-[11px] text-slate-500">
                        {a.uploadedByUser?.email || 'Unknown uploader'} · {new Date(a.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      onClick={() => approveAsset.mutate(a.id)}
                      disabled={approveAsset.isPending || isViewer}
                      title={isViewer ? t('dashboard.readOnlyViewer') : undefined}
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold disabled:opacity-50"
                    >
                      {t('dashboard.approve')}
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
                  <h2 className="text-sm font-bold text-slate-800">{t('dashboard.screensDown')}</h2>
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

          {isContributor && (mySubmissions || []).length > 0 && (
            <div className="bg-white rounded-2xl border border-indigo-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-indigo-100 flex items-center justify-between bg-indigo-50/50">
                <div className="flex items-center gap-2">
                  <ListVideo className="w-4 h-4 text-indigo-600" />
                  <h2 className="text-sm font-bold text-slate-800">{t('dashboard.mySubmissions')}</h2>
                </div>
                <Link href={`${tenantBase}/reviews`} className="text-[11px] font-semibold text-indigo-700 hover:text-indigo-800">
                  View all →
                </Link>
              </div>
              <div className="divide-y divide-slate-50">
                {(mySubmissions || []).slice(0, 5).map((sub: SubmissionRow) => (
                  <div key={sub.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-800">
                          {t('dashboard.submissionItems', { count: sub.assetIds.length + sub.playlistIds.length + sub.scheduleIds.length })}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {new Date(sub.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                        {sub.reviewerNote && sub.status === 'REJECTED' && (
                          <div className="text-[10px] text-rose-600 italic mt-1">{sub.reviewerNote}</div>
                        )}
                      </div>
                      <SubmissionStatusPill status={sub.status} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isContributor && (mySubmissions || []).length === 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
              <ListVideo className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">{t('dashboard.noSubmissions')}</p>
              <p className="text-xs text-slate-500 mt-1">{t('dashboard.buildAndSubmit')}</p>
            </div>
          )}

          {pendingAssets.length === 0 && downScreens.length === 0 && !isContributor && !isEmpty && (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">{t('dashboard.nothingNeedsAttention')}</p>
              <p className="text-xs text-slate-500 mt-1">{t('dashboard.noPendingNoOffline')}</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" /> Quick Actions
          </h2>
          <div className="space-y-1.5">
            <QuickLink href={`${tenantBase}/assets`} Icon={Upload} label={t('dashboard.uploadContent')} tone="sky" />
            <QuickLink href={`${tenantBase}/playlists`} Icon={Plus} label={t('dashboard.newPlaylist')} tone="indigo" />
            <QuickLink href={`${tenantBase}/templates`} Icon={ListVideo} label={t('dashboard.pickTemplate')} tone="violet" />
            <QuickLink href={`${tenantBase}/screens`} Icon={MonitorPlay} label={t('dashboard.pairScreen')} tone="emerald" />
            <QuickLink href={`${tenantBase}/settings`} Icon={UsersIcon} label={t('dashboard.inviteTeammate')} tone="slate" />
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
    // indigo tone intentionally omitted — handled via inline style below
    sky:     'from-sky-400 to-sky-600 shadow-sky-500/30',
    violet:  'from-violet-400 to-violet-600 shadow-violet-500/30',
    slate:   'from-slate-300 to-slate-500 shadow-slate-400/20',
  };
  const toneValue: Record<string, string> = {
    emerald: 'text-emerald-600',
    rose:    'text-rose-600',
    amber:   'text-amber-600',
    // indigo tone intentionally omitted — handled via inline style below
    sky:     'text-sky-600',
    violet:  'text-violet-600',
    slate:   'text-slate-500',
  };
  const isZero = bigValue === '0';
  const isBrandTone = tone === 'indigo';
  const valueClass = mutedWhenZero && isZero ? 'text-slate-400' : (isBrandTone ? '' : toneValue[tone]);
  const valueStyle = isBrandTone && !(mutedWhenZero && isZero)
    ? { color: 'var(--brand-primary, #4f46e5)' }
    : undefined;
  const iconBoxStyle = isBrandTone
    ? { background: 'linear-gradient(135deg, var(--brand-primary, #6366f1), color-mix(in srgb, var(--brand-primary, #6366f1) 70%, #4338ca))' }
    : undefined;
  return (
    <Link
      href={href}
      className="dash-kpi-card group bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md hover:-translate-y-0.5 transition-all"
    >
      <div className="flex items-start justify-between mb-3">
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center shadow ${isBrandTone ? '' : `bg-gradient-to-br ${toneIcon[tone]}`}`}
          style={iconBoxStyle}
        >
          <Icon className="w-4 h-4 text-white" strokeWidth={2.5} />
        </div>
        <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:translate-x-0.5 transition-all dash-arrow" />
      </div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">{label}</div>
      <div className={`text-[28px] font-black tracking-tight leading-none tabular-nums ${valueClass}`} style={valueStyle}>{bigValue}</div>
      <div className="mt-1 text-[11px] text-slate-500 truncate">{emptyText || sub}</div>
    </Link>
  );
}

function QuickLink({ href, Icon, label, tone }: { href: string; Icon: any; label: string; tone: 'sky'|'indigo'|'violet'|'emerald'|'red'|'slate' }) {
  const toneBg: Record<string, string> = {
    sky: 'hover:bg-sky-50 text-sky-600',
    // indigo: handled via brandedClass below
    violet: 'hover:bg-violet-50 text-violet-600',
    emerald: 'hover:bg-emerald-50 text-emerald-600',
    red: 'hover:bg-red-50 text-red-600',
    slate: 'hover:bg-slate-50 text-slate-600',
  };
  const isBrand = tone === 'indigo';
  return (
    <Link href={href} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors group ${isBrand ? 'dash-quick-brand' : toneBg[tone]}`} style={isBrand ? { color: 'var(--brand-primary, #4f46e5)' } : undefined}>
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

function SubmissionStatusPill({ status }: { status: SubmissionRow['status'] }) {
  const tPill = useTranslations();
  const cls = status === 'PENDING'
    ? 'bg-amber-100 text-amber-700'
    : status === 'APPROVED'
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-rose-100 text-rose-700';
  const label = status === 'PENDING' ? tPill('dashboard.statusPending')
    : status === 'APPROVED' ? tPill('dashboard.statusApproved')
    : status === 'REJECTED' ? tPill('dashboard.statusRejected')
    : status;
  return <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded ${cls}`}>{label}</span>;
}
