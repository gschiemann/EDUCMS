'use client';

/**
 * PhoneRunTrays — the phone half of the Run view's desktop controls
 * (K-12 launch program, register row K12-F15).
 *
 * The audit, at 390 px: the desktop grid that holds team fouls / timeouts,
 * the shot clock, possession and exact-time correction was `hidden md:grid`,
 * and the phone dock carried only score, period and start/stop — "the user
 * cannot run a standard basketball game from the primary phone view despite
 * being able to score it". This component renders every one of those
 * controls below the thumb dock, phone only (`md:hidden`), through the SAME
 * `ctl` mutations the desktop tiles call — no data-layer change:
 *
 *   - scoring source  (manual / scoreboard console live / feed live)
 *   - last change + Undo (two taps — a phone mis-tap must not revert a score)
 *   - game clock      −1 s · +1 s · Set exact time
 *   - shot clock      reset to THIS game's length · short reset · start/stop
 *   - possession      Home / Away
 *   - team stats      every per-team row the desktop tile shows
 *   - penalty box     one tap to the existing penalty sheet
 *
 * Every control is ≥ 44×44 px; nothing depends on hover or right-click.
 * The shot-clock readout ticks only while the shot clock runs AND the tab is
 * visible (mobile performance standard: a pocketed phone runs no timers), and
 * it reads the page's ONE server clock through the shared projection
 * (K12-F17 — the same reading the board shows, held while the console's
 * reads are stale, K12-F40).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pause, Play, RotateCcw, Timer } from 'lucide-react';
import type { SportDefinition } from '@cms/api-types';
import {
  formatSportClock,
  parseClockEntry,
  projectCountdownMs,
  shotClockDisplayLen,
  shotClockMode,
  sportHasPossessionArrow,
} from '@cms/api-types';
import { useGameEvents, useUndoGameEvent, type useGameControl } from '@/hooks/use-api';
import { serverClock } from '@/lib/server-clock';
import { shotClockResets } from '@/lib/sports-stat-rows';
import { TeamStatGrid } from '@/components/sports/StatControls';
import { eventSummary } from './RecentEventsBar';
import { scoringSource } from './phone-run';

type Ctl = ReturnType<typeof useGameControl>;

const TRAY_BTN =
  'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm font-black text-slate-100 transition-colors active:bg-slate-600 disabled:opacity-40';

function TrayLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[11px] font-black uppercase tracking-widest text-slate-400">{children}</div>
  );
}

/** Re-render every `ms` while `active` and the tab is visible. */
function useVisibleTicker(active: boolean, ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const arm = () => {
      if (timer === null && document.visibilityState !== 'hidden') {
        timer = setInterval(() => setN((n) => (n + 1) | 0), ms);
      }
    };
    const disarm = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVis = () => (document.visibilityState === 'hidden' ? disarm() : arm());
    arm();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      disarm();
    };
  }, [active, ms]);
}

function SourceLine({ stats }: { stats: Record<string, unknown> }) {
  const t = useTranslations('sportsRunPhone');
  // Re-evaluated on every render; the console's 4 s game poll re-renders
  // this while the page is visible, which is enough to flip live → silent.
  const src = scoringSource(stats, Date.now());
  const text =
    src.kind === 'cts-live'
      ? t('sourceCtsLive')
      : src.kind === 'cts-stale'
        ? t('sourceCtsStale', { seconds: src.seconds })
        : src.kind === 'feed-live'
          ? t('sourceFeedLive')
          : src.kind === 'feed-stale'
            ? t('sourceFeedStale', { seconds: src.seconds })
            : t('sourceManual');
  const tone =
    src.kind === 'cts-live' || src.kind === 'feed-live'
      ? 'border-sky-700 bg-sky-950 text-sky-100'
      : src.kind === 'manual'
        ? 'border-slate-800 bg-slate-900 text-slate-300'
        : 'border-amber-700 bg-amber-950 text-amber-100';
  return (
    <div data-testid="phone-scoring-source" className={`rounded-lg border px-3 py-2 text-[13px] font-bold ${tone}`}>
      {text}
    </div>
  );
}

/** The most recent undoable change, with a deliberate two-tap Undo. Shares
 *  the event-log query (and its poll) with RecentEventsBar — no new fetch. */
function LastChange({ gameId, sport }: { gameId: string; sport: string }) {
  const t = useTranslations('sportsRunPhone');
  const { data: events } = useGameEvents(gameId);
  const undo = useUndoGameEvent(gameId);
  const [armedId, setArmedId] = useState<string | null>(null);
  const disarm = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (disarm.current) clearTimeout(disarm.current); }, []);
  const last = (events || []).find((ev) => ev.undoable);
  if (!last) return null;
  const armed = armedId === last.id;
  const onTap = () => {
    if (undo.isPending) return;
    if (!armed) {
      setArmedId(last.id);
      if (disarm.current) clearTimeout(disarm.current);
      disarm.current = setTimeout(() => setArmedId(null), 4000);
      return;
    }
    setArmedId(null);
    undo.mutate(last.id);
  };
  return (
    <div data-testid="phone-last-change" className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t('lastChange')}</div>
        <div className="truncate text-[13px] font-bold text-slate-100">{eventSummary(last, sport)}</div>
      </div>
      <button
        type="button"
        onClick={onTap}
        disabled={undo.isPending}
        className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-black transition-colors disabled:opacity-40 ${
          armed ? 'border-red-500 bg-red-600 text-white' : 'border-slate-600 bg-slate-800 text-slate-100'
        }`}
      >
        <RotateCcw className="h-4 w-4" aria-hidden />
        {undo.isPending ? t('undoing') : armed ? t('undoConfirm') : t('undo')}
      </button>
    </div>
  );
}

function ClockTray({ def, liveMs, ctl }: { def: SportDefinition; liveMs: number; ctl: Ctl }) {
  const t = useTranslations('sportsRunPhone');
  const [editing, setEditing] = useState<string | null>(null);
  // The shared exact-time parser (K12-F17): 7:42, 0:04.3, :04.3 or 4.3 —
  // tenths are typable; a bare number is refused (minutes or seconds?).
  const ms = editing === null ? null : parseClockEntry(editing);
  return (
    <div data-testid="phone-clock-tray">
      <TrayLabel>{t('clock')}</TrayLabel>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={TRAY_BTN}
          aria-label={t('minusSecondLabel')}
          onClick={() => ctl.clock.mutate({ action: 'set', ms: Math.max(0, liveMs - 1000) })}
        >
          {t('minusSecond')}
        </button>
        <button
          type="button"
          className={TRAY_BTN}
          aria-label={t('plusSecondLabel')}
          onClick={() => ctl.clock.mutate({ action: 'set', ms: liveMs + 1000 })}
        >
          {t('plusSecond')}
        </button>
        {editing === null ? (
          <button type="button" className={TRAY_BTN} onClick={() => setEditing(formatSportClock(def, liveMs))}>
            {t('setTime')}
          </button>
        ) : (
          <>
            <input
              autoFocus
              type="text"
              inputMode="decimal"
              value={editing}
              onChange={(e) => setEditing(e.target.value.replace(/[^0-9:.]/g, '').slice(0, 8))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ms !== null) {
                  ctl.clock.mutate({ action: 'set', ms });
                  setEditing(null);
                }
                if (e.key === 'Escape') setEditing(null);
              }}
              placeholder="M:SS"
              aria-label={t('setTimeLabel')}
              className="h-11 w-24 rounded-lg border border-amber-500 bg-slate-950 text-center text-xl font-black tabular-nums text-white outline-none"
            />
            <button
              type="button"
              disabled={ms === null}
              onClick={() => {
                if (ms !== null) ctl.clock.mutate({ action: 'set', ms });
                setEditing(null);
              }}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-amber-500 px-3 text-sm font-black text-amber-950 disabled:opacity-40"
            >
              {t('apply')}
            </button>
            <button type="button" className={TRAY_BTN} onClick={() => setEditing(null)}>
              {t('cancel')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ShotClockTray({ def, stats, ctl }: { def: SportDefinition; stats: Record<string, unknown>; ctl: Ctl }) {
  const t = useTranslations('sportsRunPhone');
  const resets = shotClockResets(def, stats);
  const sc = stats.shotClock && typeof stats.shotClock === 'object' ? (stats.shotClock as Record<string, unknown>) : null;
  const running = !!sc?.running;
  useVisibleTicker(running, 200);
  // K12-F05 — a shot clock the table switched OFF stays off; say so rather
  // than showing reset buttons the server refuses.
  if (shotClockMode(stats) === 'off') {
    return (
      <div data-testid="phone-shot-clock-tray">
        <TrayLabel>{t('shotClock')}</TrayLabel>
        <p className="text-[13px] font-semibold text-slate-400">{t('shotOff')}</p>
      </div>
    );
  }
  if (!resets) return null;
  const armed = shotClockDisplayLen(def, stats) > 0;
  const liveMs = projectCountdownMs(sc, serverClock.now());
  return (
    <div data-testid="phone-shot-clock-tray">
      <TrayLabel>{t('shotClock')}</TrayLabel>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`min-w-[48px] text-center text-3xl font-black tabular-nums ${
            armed && liveMs <= 5000 ? 'text-red-400' : 'text-amber-400'
          }`}
          aria-live="off"
        >
          {armed ? String(Math.max(0, Math.ceil(liveMs / 1000))) : '—'}
        </span>
        <button
          type="button"
          className={TRAY_BTN}
          aria-label={t('shotResetLabel', { seconds: resets.full })}
          onClick={() => ctl.shotClock.mutate({ action: 'reset', value: resets.full })}
        >
          {resets.full}
        </button>
        {resets.short !== null && (
          <button
            type="button"
            className={TRAY_BTN}
            aria-label={t('shotResetLabel', { seconds: resets.short })}
            onClick={() => ctl.shotClock.mutate({ action: 'reset', value: resets.short as number })}
          >
            {resets.short}
          </button>
        )}
        <button
          type="button"
          onClick={() => ctl.shotClock.mutate({ action: running ? 'stop' : 'start' })}
          aria-label={running ? t('shotStop') : t('shotStart')}
          className={`flex min-h-[44px] min-w-[56px] items-center justify-center gap-1 rounded-lg px-3 text-sm font-black text-white ${
            running ? 'bg-red-600 active:bg-red-700' : 'bg-emerald-600 active:bg-emerald-700'
          }`}
        >
          {running ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          {running ? t('stop') : t('start')}
        </button>
      </div>
    </div>
  );
}

function PossessionTray({ g, ctl }: { g: any; ctl: Ctl }) {
  const t = useTranslations('sportsRunPhone');
  const stats: Record<string, unknown> = g.stats || {};
  const cur = String(
    (typeof g.possession === 'string' && g.possession) || (typeof stats.possession === 'string' ? stats.possession : ''),
  ).toLowerCase();
  const opt = (side: 'home' | 'away', name: string) => (
    <button
      type="button"
      aria-pressed={cur === side}
      onClick={() => ctl.setPossession.mutate({ team: side })}
      className={`flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-1 truncate rounded-lg border px-2 text-sm font-black transition-colors ${
        cur === side ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-700 bg-slate-800 text-slate-300'
      }`}
    >
      {side === 'home' && <span aria-hidden>◀</span>}
      <span className="truncate">{name}</span>
      {side === 'away' && <span aria-hidden>▶</span>}
    </button>
  );
  return (
    <div data-testid="phone-possession-tray">
      <TrayLabel>{t('possession')}</TrayLabel>
      <div className="flex gap-2">
        {opt('home', g.homeTeam || t('home'))}
        {opt('away', g.awayTeam || t('away'))}
      </div>
    </div>
  );
}

export function PhoneRunTrays({
  gameId,
  g,
  def,
  liveMs,
  homeColor,
  awayColor,
  ctl,
  penaltyCount,
  onPenalties,
}: {
  gameId: string;
  g: any;
  def: SportDefinition;
  liveMs: number;
  homeColor: string;
  awayColor: string;
  ctl: Ctl;
  penaltyCount: number;
  onPenalties: () => void;
}) {
  const t = useTranslations('sportsRunPhone');
  const stats: Record<string, unknown> = g.stats || {};
  const hasClock = def.clock.type !== 'none';
  return (
    <section
      data-testid="phone-run-trays"
      aria-label={t('title')}
      className="md:hidden flex flex-col gap-3 border-t-2 border-slate-800 bg-slate-950 px-3 py-3 text-white"
    >
      <SourceLine stats={stats} />
      <LastChange gameId={gameId} sport={def.key} />
      {hasClock && <ClockTray def={def} liveMs={liveMs} ctl={ctl} />}
      {def.shotClock && <ShotClockTray def={def} stats={stats} ctl={ctl} />}
      {sportHasPossessionArrow(def) && <PossessionTray g={g} ctl={ctl} />}
      <TeamStatGrid
        def={def}
        stats={stats}
        homeTeam={g.homeTeam}
        awayTeam={g.awayTeam}
        homeColor={homeColor}
        awayColor={awayColor}
        canEdit={() => true}
        onStat={(patch) => ctl.stats.mutate({ stats: patch })}
        onTimeout={(team) => ctl.callTimeout.mutate({ team })}
      />
      {def.penaltyBox && (
        <button
          type="button"
          onClick={onPenalties}
          className="flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-amber-600 bg-amber-900 px-3 text-sm font-black text-amber-50 active:bg-amber-800"
        >
          <Timer className="h-4 w-4" aria-hidden />
          {def.penaltyBox.label}
          {penaltyCount > 0 && (
            <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-400 px-1.5 text-[11px] font-black tabular-nums text-amber-950">
              {penaltyCount}
            </span>
          )}
        </button>
      )}
    </section>
  );
}
