"use client";

/**
 * Mobile-first home dashboard.
 *
 * Replaces the desktop FleetDashboard on phone-width viewports. Different
 * design language: vertical stack of self-contained cards, one-handed-
 * thumb reachable actions, status-first information hierarchy. Per the
 * competitor research (docs/research/MOBILE_COMPETITOR_REPORT.md):
 *
 *   "No competitor signage CMS mobile experience puts emergency control
 *    one-handed-reach. We lead with it."
 *
 * Layout (top → bottom):
 *
 *   1. Greeting + tenant + sign-out menu
 *   2. EMERGENCY hero — always-visible, always-accessible. Hold-to-trigger
 *      pattern matching the /panic page so muscle memory transfers.
 *   3. Quick actions row — 4 chips: Add content, New playlist, Pair
 *      screen, Schedule playlist.
 *   4. Live status card — N screens online, M pending reviews, K
 *      schedules running. One row per critical metric.
 *   5. Today's content — what playlists are scheduled to play in the
 *      next few hours.
 *   6. Recent activity feed.
 *
 * Renders only when `useIsMobile()` is true. The DashboardPage delegates
 * to it via a conditional render so we keep one route.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Siren, Plus, UploadCloud, MonitorPlay, ListMusic, CalendarClock,
  CheckCircle2, AlertTriangle, Activity, ArrowRight, ChevronRight,
  Clock, FolderOpen, Sparkles, Hand, Trophy,
} from 'lucide-react';
import {
  useScreens, usePlaylists, useSchedules, useAssets, useSubmissions, useTenantStatus, useFleet,
  useDistrictReadiness, useDistrictPendingApprovals,
} from '@/hooks/use-api';
import { FleetRollup } from '@/components/screens/FleetRollup';
import { DistrictCommandCenter } from '@/components/dashboard/district/DistrictCommandCenter';
import { MobileFleetCommand } from '@/components/dashboard/mobile/MobileFleetCommand';
import { StarterBoardCard } from '@/components/dashboard/StarterBoardCard';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { useMobileShell } from '@/lib/mobile-shell-pref';
import { useAppStore } from '@/lib/store';
import { hasPanicAuthority } from '@/lib/emergency-capability';
import { firstName as userFirstName } from '@/lib/user-display';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

/**
 * The mount point for the phone home screen.
 *
 * §M04 replaces this card stack with a phone version of Fleet Command for
 * anyone whose session can actually read a fleet. Everyone else — and anyone
 * who chose classic navigation — keeps the stack below, unchanged.
 *
 * `shellLoaded` gates the choice for the same reason the chrome does: paint
 * nothing rather than paint the wrong home and swap.
 */
export function MobileDashboard({ schoolId }: { schoolId: string }) {
  const { shell, loaded: shellLoaded } = useMobileShell();
  const user = useAppStore((s) => s.user);
  const role = user?.role;
  const { vertical } = useTenantCopy();
  const { data: tenant } = useTenantStatus();

  // Who may READ a fleet. Exactly the three roles on `GET /screens/fleet`'s
  // own @RequireRoles — and, verified route by route, the same three on
  // `/emergency/readiness/district` and `/submissions/pending-counts`, so one
  // boolean gates all three reads without any of them 403-ing.
  const canFleetRead =
    role === 'SUPER_ADMIN' || role === 'DISTRICT_ADMIN' || role === 'SCHOOL_ADMIN';
  const wantsFleetHome = shellLoaded && shell === 'v1' && canFleetRead;

  // All four reads are declared unconditionally (Rules of Hooks) and gated by
  // `enabled`. None of them polls, so an operator who backgrounds the phone
  // leaves no timer running — mobile-perf standard rule #1.
  const fleetQuery = useFleet({ enabled: wantsFleetHome });
  const { data: readiness } = useDistrictReadiness({ enabled: wantsFleetHome });
  const { data: approvals } = useDistrictPendingApprovals({ enabled: wantsFleetHome });
  const { data: schedules } = useSchedules();

  /**
   * §5.6 / §10 — CAPABILITY, NOT ROLE, and verified against the decorator on
   * the route each action actually calls rather than assumed from the role
   * name. CONTRIBUTOR is a real third answer here, not a shade of viewer:
   *
   *   POST /assets/upload  → …, CONTRIBUTOR   ✔ contributors upload
   *   POST /playlists      → …, CONTRIBUTOR   ✔ contributors create playlists
   *   POST /screens/pair   → admins only      ✘ contributors must not see it
   *
   * §10: "Never make a user discover permissions by receiving a 403 after a
   * high-stakes tap." A Pair Screen tile shown to a contributor is exactly
   * that tap.
   */
  const isViewer = role === 'RESTRICTED_VIEWER';
  const isContributor = role === 'CONTRIBUTOR';
  const isAdmin = role === 'SUPER_ADMIN' || role === 'DISTRICT_ADMIN' || role === 'SCHOOL_ADMIN';
  const can = {
    upload: !isViewer,
    createPlaylist: !isViewer,
    pairScreen: isAdmin,
    // A contributor's playlist goes out for review rather than straight to a
    // screen, so their fourth tile is the queue they can actually act on.
    submitOnly: isContributor,
  };

  // §M04 item 7 — "Playing/scheduled soon". SCHEDULE INTENT ONLY: an enabled
  // window on the calendar. §11.5 forbids calling that Live, and §11.2 keeps
  // delivery evidence in its own family — the assurance row above is the only
  // place this surface speaks about what a screen is actually showing.
  const scheduleRows = useMemo(() => {
    if (!Array.isArray(schedules)) return null;
    return (schedules as any[])
      .filter((s) => s.isActive)
      .slice(0, 4)
      .map((s) => ({
        key: String(s.id),
        name: s.playlist?.name || 'Untitled playlist',
        deviceLine: s.screen?.name || s.screenGroup?.name || 'All screens',
        timeStart: s.timeStart || '',
        timeEnd: s.timeEnd || '',
      }));
  }, [schedules]);

  // Never paint the wrong home and swap — same contract the chrome honors.
  if (!shellLoaded) return null;

  if (wantsFleetHome) {
    // §13 "Loading": a geometry-matched skeleton, not a spinner.
    if (fleetQuery.isPending) return <MobileHomeSkeleton />;
    // A fleet read that ERRORED falls through to the classic stack, which
    // carries its own independent reads and its own error states. Rendering
    // Fleet Command off a failed read would print an all-zero fleet, and a
    // zero that is really "we don't know" is the exact all-clear this
    // surface exists to never cry.
    if (fleetQuery.data) {
      return (
        <MobileFleetCommand
          schoolId={schoolId}
          fleet={fleetQuery.data as never}
          readiness={readiness}
          approvals={approvals}
          firstName={userFirstName(user)}
          orgName={tenant?.name ?? null}
          schedule={scheduleRows}
          can={can}
          isSportsVertical={vertical === 'SPORTS'}
        />
      );
    }
  }
  return <ClassicMobileDashboard schoolId={schoolId} />;
}

/**
 * §13 "Loading": geometry-matched skeletons, header stable, never a blank
 * screen with a centred spinner.
 */
function MobileHomeSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" data-testid="mobile-home-skeleton">
      <div className="h-4 w-2/3 rounded bg-slate-200" />
      <div className="h-28 rounded-2xl bg-slate-200" />
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-[68px] rounded-xl bg-slate-200" />)}
      </div>
      <div className="h-16 rounded-2xl bg-slate-200" />
    </div>
  );
}

function ClassicMobileDashboard({ schoolId }: { schoolId: string }) {
  const t = useTranslations();
  const user = useAppStore((s) => s.user);
  const role = user?.role;
  const isContributor = role === 'CONTRIBUTOR';
  const isViewer = role === 'RESTRICTED_VIEWER';
  // Sports is a sports-vertical surface — surface a Game Day shortcut
  // only for sports-vertical tenants, matching the desktop Sidebar.
  const { vertical } = useTenantCopy();
  const isSportsVertical = vertical === 'SPORTS';
  // 2026-05-14 — was `new Date().getHours()` during render which
  // caused a hydration mismatch (React #418). Server "now" hour vs
  // client "now" hour differ across timezones AND across the
  // hour-boundary at SSR. Gate behind a post-mount `mounted` flag
  // so server + client render the same neutral greeting until the
  // client populates the real one.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const greeting = (() => {
    if (!mounted) return 'Hello';
    const h = new Date().getHours();
    if (h < 5) return 'Working late';
    if (h < 12) return t('dashboard.greetingMorning');
    if (h < 18) return t('dashboard.greetingAfternoon');
    return t('dashboard.greetingEvening');
  })();

  const { data: screens } = useScreens();
  const { data: playlists } = usePlaylists();
  const { data: schedules } = useSchedules();
  const { data: assets } = useAssets();
  const { data: pendingSubmissions } = useSubmissions(
    isContributor ? { mine: true } : { status: 'PENDING' as const }
  );
  const { data: tenant } = useTenantStatus();

  // HQ fleet command center — Corporate sees every location's screens on one
  // map (same FleetRollup component + /screens/fleet data as desktop). Admin-
  // gated to match the endpoint's RBAC; a leaf store gets nothing extra.
  // Operator 2026-06-03: "I don't see the fleet map on the mobile app."
  const canFleet = role === 'SUPER_ADMIN' || role === 'DISTRICT_ADMIN';
  const { data: fleet } = useFleet({ enabled: canFleet });
  const isHQ = (fleet?.locations?.length ?? 0) > 1;
  // District command center — same two bounded reads as desktop. The operator
  // runs the district from a phone, so "which school needs me" has to be on
  // THIS surface too. Neither read polls (see use-api.ts), so this adds no
  // background timer to a backgrounded tab — mobile-perf standard rule #1.
  const { data: districtReadiness } = useDistrictReadiness({ enabled: canFleet && isHQ });
  const { data: districtApprovals } = useDistrictPendingApprovals({ enabled: canFleet && isHQ });

  const totalScreens = (screens || []).length;
  const onlineScreens = (screens || []).filter((s: any) => s.status === 'ONLINE').length;
  const offlineScreens = totalScreens - onlineScreens;
  const activeSchedules = (schedules || []).filter((s: any) => s.isActive).length;
  const pendingCount = (pendingSubmissions || []).length;
  const totalContent = (assets || []).length;
  const totalPlaylists = (playlists || []).length;

  // Today's running playlists — schedules whose time-of-day window is
  // currently active. Quick filter; same logic the player uses to
  // pick a manifest. Same `mounted` gate as the greeting — pre-mount
  // we pass `nowMin = -1` so every schedule's time window evaluates
  // truthy (matches SSR output exactly), then the post-mount value
  // takes over with the real minute.
  const nowMin = (() => {
    if (!mounted) return -1;
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  })();
  const isTimeOfDayActive = (sch: any): boolean => {
    if (!sch.timeStart || !sch.timeEnd) return true;
    const toMin = (s: string) => {
      const [h, m] = s.split(':').map((x: string) => parseInt(x, 10));
      return h * 60 + (m || 0);
    };
    return nowMin >= toMin(sch.timeStart) && nowMin <= toMin(sch.timeEnd);
  };
  const liveNow = (schedules || []).filter((s: any) => s.isActive && isTimeOfDayActive(s)).slice(0, 3);

  return (
    <div className="space-y-4">
      {/* Greeting card */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{greeting}</div>
        <div className="text-xl font-bold text-slate-900 mt-0.5 leading-tight">
          {userFirstName(user) || 'there'}{' '}
          <span className="text-slate-400 font-medium">·</span>{' '}
          <span className="text-slate-600 font-semibold">{tenant?.name || 'Venue OS'}</span>
        </div>
      </div>

      {/* Emergency hero — most-prominent, always-visible.
          CAPABILITY, NOT ROLE (2026-09-01, mobile design package §10 / §4.4):
          the gate was `!isContributor && !isViewer`, so a CONTRIBUTOR holding
          a granted `canTriggerPanic` — delegated emergency staff — had no
          route to /panic from the phone home screen. */}
      {hasPanicAuthority(user) && (
        <Link
          href={`/panic?schoolId=${schoolId}`}
          className="block rounded-2xl bg-gradient-to-br from-rose-500 via-rose-600 to-red-700 text-white p-5 shadow-lg shadow-rose-500/30 active:scale-[0.99] transition-transform"
        >
          <div className="flex items-center gap-3">
            <div className="shrink-0 w-12 h-12 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
              <Siren className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-extrabold leading-tight">{t('dashboard.emergencyTriggers')}</div>
              {/* i18n: panic-type taxonomy left English on purpose — the whole
                  emergency system (trigger flow, typed-confirm, panic editor)
                  gets ONE coordinated reviewed pass so these category names
                  never half-translate. See docs/research/2026-07-22-i18n-es-zh/00-HANDOFF.md. */}
              <div className="text-xs text-rose-100 leading-snug mt-0.5">
                Lockdown · Evacuate · Weather · Medical · All-clear
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-rose-200" />
          </div>
        </Link>
      )}

      {/* District command center — "which of my schools needs me today",
          directly under the emergency hero. Renders only for a parent tenant
          with child schools; a single school never sees it. */}
      {isHQ && fleet && (
        <DistrictCommandCenter
          fleet={fleet}
          readiness={districtReadiness}
          approvals={districtApprovals}
          districtName={tenant?.name || null}
        />
      )}

      {/* Simulated screen — a brand-new tenant's first look at their own
          board. Self-retiring: renders only while the fleet is empty AND a
          starter board exists (see StarterBoardCard.tsx), so an established
          venue never sees it. Sits BELOW the emergency hero on purpose —
          nothing outranks life-safety on this page. */}
      <StarterBoardCard schoolId={schoolId} />

      {/* Quick-action chip grid (2x2) */}
      <div className="grid grid-cols-2 gap-3">
        {/* Game day — the live scoreboard / ribbon / celebration
            console. First chip for sports venues: running the game
            from a phone IS the job, no laptop required. */}
        {isSportsVertical && (
          <QuickAction
            href={`/${schoolId}/sports`}
            icon={Trophy}
            label={t('dashboard.gameDay')}
            sub={t('dashboard.gameDaySub')}
            color="amber"
          />
        )}
        {/* Terminology aligned with desktop: "Assets" (matches the
            sidebar nav + /assets route), "Playlists" (matches the
            sidebar's Playlists entry), "Screens" (matches Screens
            nav). Operator: "we say asset in the dashboard...lets
            just keep everything consisitent mobile and desktop app". */}
        {!isViewer && (
          <QuickAction
            href={`/${schoolId}/assets`}
            icon={UploadCloud}
            label={t('dashboard.uploadAsset')}
            sub={t('dashboard.photosVideoLinks')}
            color="indigo"
          />
        )}
        {!isViewer && !isContributor && (
          <QuickAction
            href={`/${schoolId}/playlists`}
            icon={ListMusic}
            label={t('dashboard.newPlaylist')}
            sub={t('dashboard.bundleAssets')}
            color="emerald"
          />
        )}
        <QuickAction
          href={`/${schoolId}/screens`}
          icon={MonitorPlay}
          label={t('dashboard.screens')}
          sub={t('dashboard.onlineCount', { count: onlineScreens })}
          color="sky"
        />
        {!isViewer && !isContributor && (
          <QuickAction
            href={`/${schoolId}/playlists`}
            icon={CalendarClock}
            label={t('dashboard.scheduleLabel')}
            sub={t('dashboard.activeCount', { count: activeSchedules })}
            color="violet"
          />
        )}
        {isContributor && (
          <QuickAction
            href={`/${schoolId}/reviews?tab=mine`}
            icon={CheckCircle2}
            label={t('dashboard.mySubmissions')}
            sub={`${pendingCount} pending`}
            color="amber"
          />
        )}
      </div>

      {/* HQ fleet command center (Corporate) — full roll-up + map, same as
          desktop. Renders only for a parent tenant with child locations. */}
      {isHQ && fleet && <FleetRollup fleet={fleet} />}

      {/* Live status — 1-line metrics */}
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Activity className="w-3 h-3" /> {t('dashboard.rightNow')}
          </div>
        </div>
        <StatusRow
          label={t('dashboard.screensOnlineStat')}
          value={totalScreens > 0 ? `${onlineScreens} / ${totalScreens}` : '—'}
          tone={offlineScreens === 0 ? 'good' : 'warn'}
          icon={MonitorPlay}
          href={`/${schoolId}/screens`}
        />
        {!isContributor && (
          <StatusRow
            label={t('dashboard.pendingReviews')}
            value={pendingCount > 0 ? `${pendingCount}` : t('dashboard.allCaughtUp')}
            tone={pendingCount > 0 ? 'warn' : 'good'}
            icon={CheckCircle2}
            href={`/${schoolId}/reviews`}
            divider
          />
        )}
        {isContributor && (
          <StatusRow
            label={t('dashboard.mySubmissions')}
            value={pendingCount > 0 ? `${pendingCount} pending` : 'No pending'}
            tone="info"
            icon={Clock}
            href={`/${schoolId}/reviews?tab=mine`}
            divider
          />
        )}
        <StatusRow
          label={t('dashboard.assetsInLibrary')}
          value={`${totalContent}`}
          tone="info"
          icon={FolderOpen}
          href={`/${schoolId}/assets`}
          divider
        />
      </div>

      {/* Scheduled now — SCHEDULE INTENT, not a claim about any screen.
          (2026-09-01, mobile design package §11.5: `Live` must never mean "an
          enabled schedule"; §11.2 keeps delivery and render as separate
          evidence families.) This card reads Schedule rows against THIS
          PHONE's clock — it proves a window is open, never that a screen
          received, activated or rendered anything. The heading said "Playing
          right now" beside a pulsing green dot, which is the picture-level
          claim this data cannot support; green is reserved for "proved
          successful or matched" (§8.4). */}
      {liveNow.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <CalendarClock className="w-3 h-3" /> Scheduled now
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5 font-medium normal-case tracking-normal">
              Schedule windows open on this phone&apos;s clock. Screens confirm separately.
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {liveNow.map((sch: any) => {
              const pl = (playlists || []).find((p: any) => p.id === sch.playlistId);
              return (
                <Link
                  key={sch.id}
                  href={`/${schoolId}/playlists`}
                  className="px-4 py-3 flex items-center gap-3 active:bg-slate-50"
                >
                  <div className="shrink-0 w-2 h-2 rounded-full bg-slate-300" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-slate-900 truncate">{pl?.name || t('dashboard.playlistFallback')}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {sch.timeStart && sch.timeEnd ? `${sch.timeStart} – ${sch.timeEnd}` : t('dashboard.allDay')}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Spacer so the last card doesn't kiss the tab bar */}
      <div className="h-2" />
    </div>
  );
}

function QuickAction({
  href, icon: Icon, label, sub, color,
}: {
  href: string;
  icon: typeof Plus;
  label: string;
  sub: string;
  color: 'indigo' | 'emerald' | 'sky' | 'violet' | 'amber' | 'rose';
}) {
  const tones = {
    indigo: 'bg-indigo-50 text-indigo-600 ring-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    sky: 'bg-sky-50 text-sky-600 ring-sky-100',
    violet: 'bg-violet-50 text-violet-600 ring-violet-100',
    amber: 'bg-amber-50 text-amber-600 ring-amber-100',
    rose: 'bg-rose-50 text-rose-600 ring-rose-100',
  } as const;
  return (
    <Link
      href={href}
      className="group rounded-2xl bg-white border border-slate-200 shadow-sm p-4 active:scale-[0.98] transition-transform"
    >
      <div className={cn('w-10 h-10 rounded-xl ring-1 flex items-center justify-center mb-2', tones[color])}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="text-sm font-bold text-slate-900 leading-tight">{label}</div>
      <div className="text-[11px] text-slate-500 mt-0.5 truncate">{sub}</div>
    </Link>
  );
}

function StatusRow({
  label, value, tone, icon: Icon, href, divider,
}: {
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'info';
  icon: typeof Plus;
  href: string;
  divider?: boolean;
}) {
  const valueClass =
    tone === 'good' ? 'text-emerald-600'
    : tone === 'warn' ? 'text-amber-600'
    : 'text-slate-700';
  return (
    <Link
      href={href}
      className={cn(
        'px-4 py-3 flex items-center gap-3 active:bg-slate-50',
        divider && 'border-t border-slate-100'
      )}
    >
      <Icon className="w-4 h-4 text-slate-400 shrink-0" />
      <span className="flex-1 text-sm font-medium text-slate-700">{label}</span>
      <span className={cn('text-sm font-bold', valueClass)}>{value}</span>
      <ChevronRight className="w-4 h-4 text-slate-300" />
    </Link>
  );
}
