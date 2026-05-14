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
import { useState } from 'react';
import {
  Siren, Plus, UploadCloud, MonitorPlay, ListMusic, CalendarClock,
  CheckCircle2, AlertTriangle, Activity, ArrowRight, ChevronRight,
  Clock, FolderOpen, Sparkles, Hand,
} from 'lucide-react';
import { useScreens, usePlaylists, useSchedules, useAssets, useSubmissions, useTenantStatus } from '@/hooks/use-api';
import { useAppStore } from '@/lib/store';
import { firstName as userFirstName } from '@/lib/user-display';
import { cn } from '@/lib/utils';

export function MobileDashboard({ schoolId }: { schoolId: string }) {
  const user = useAppStore((s) => s.user);
  const role = user?.role;
  const isContributor = role === 'CONTRIBUTOR';
  const isViewer = role === 'RESTRICTED_VIEWER';
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5) return 'Working late';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  const { data: screens } = useScreens();
  const { data: playlists } = usePlaylists();
  const { data: schedules } = useSchedules();
  const { data: assets } = useAssets();
  const { data: pendingSubmissions } = useSubmissions(
    isContributor ? { mine: true } : { status: 'PENDING' as const }
  );
  const { data: tenant } = useTenantStatus();

  const totalScreens = (screens || []).length;
  const onlineScreens = (screens || []).filter((s: any) => s.status === 'ONLINE').length;
  const offlineScreens = totalScreens - onlineScreens;
  const activeSchedules = (schedules || []).filter((s: any) => s.isActive).length;
  const pendingCount = (pendingSubmissions || []).length;
  const totalContent = (assets || []).length;
  const totalPlaylists = (playlists || []).length;

  // Today's running playlists — schedules whose time-of-day window is
  // currently active. Quick filter; same logic the player uses to
  // pick a manifest.
  const nowMin = (() => {
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
          <span className="text-slate-600 font-semibold">{tenant?.name || 'EduCMS'}</span>
        </div>
      </div>

      {/* Emergency hero — most-prominent, always-visible */}
      {!isContributor && !isViewer && (
        <Link
          href={`/panic?schoolId=${schoolId}`}
          className="block rounded-2xl bg-gradient-to-br from-rose-500 via-rose-600 to-red-700 text-white p-5 shadow-lg shadow-rose-500/30 active:scale-[0.99] transition-transform"
        >
          <div className="flex items-center gap-3">
            <div className="shrink-0 w-12 h-12 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
              <Siren className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-extrabold leading-tight">Emergency triggers</div>
              <div className="text-xs text-rose-100 leading-snug mt-0.5">
                Lockdown · Evacuate · Weather · Medical · All-clear
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-rose-200" />
          </div>
        </Link>
      )}

      {/* Quick-action chip grid (2x2) */}
      <div className="grid grid-cols-2 gap-3">
        {!isViewer && (
          <QuickAction
            href={`/${schoolId}/assets`}
            icon={UploadCloud}
            label="Add content"
            sub="Photos, video, links"
            color="indigo"
          />
        )}
        {!isViewer && !isContributor && (
          <QuickAction
            href={`/${schoolId}/playlists`}
            icon={ListMusic}
            label="Make a list"
            sub="Bundle content"
            color="emerald"
          />
        )}
        <QuickAction
          href={`/${schoolId}/screens`}
          icon={MonitorPlay}
          label="My screens"
          sub={`${onlineScreens} online`}
          color="sky"
        />
        {!isViewer && !isContributor && (
          <QuickAction
            href={`/${schoolId}/playlists`}
            icon={CalendarClock}
            label="Schedule"
            sub={`${activeSchedules} active`}
            color="violet"
          />
        )}
        {isContributor && (
          <QuickAction
            href={`/${schoolId}/reviews?tab=mine`}
            icon={CheckCircle2}
            label="My submissions"
            sub={`${pendingCount} pending`}
            color="amber"
          />
        )}
      </div>

      {/* Live status — 1-line metrics */}
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Activity className="w-3 h-3" /> Right now
          </div>
        </div>
        <StatusRow
          label="Screens online"
          value={totalScreens > 0 ? `${onlineScreens} / ${totalScreens}` : '—'}
          tone={offlineScreens === 0 ? 'good' : 'warn'}
          icon={MonitorPlay}
          href={`/${schoolId}/screens`}
        />
        {!isContributor && (
          <StatusRow
            label="Pending reviews"
            value={pendingCount > 0 ? `${pendingCount}` : 'All caught up'}
            tone={pendingCount > 0 ? 'warn' : 'good'}
            icon={CheckCircle2}
            href={`/${schoolId}/reviews`}
            divider
          />
        )}
        {isContributor && (
          <StatusRow
            label="My submissions"
            value={pendingCount > 0 ? `${pendingCount} pending` : 'No pending'}
            tone="info"
            icon={Clock}
            href={`/${schoolId}/reviews?tab=mine`}
            divider
          />
        )}
        <StatusRow
          label="Content in library"
          value={`${totalContent}`}
          tone="info"
          icon={FolderOpen}
          href={`/${schoolId}/assets`}
          divider
        />
      </div>

      {/* Playing right now */}
      {liveNow.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" /> Playing right now
            </div>
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
                  <div className="shrink-0 w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-slate-900 truncate">{pl?.name || 'Playlist'}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {sch.timeStart && sch.timeEnd ? `${sch.timeStart} – ${sch.timeEnd}` : 'All day'}
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
