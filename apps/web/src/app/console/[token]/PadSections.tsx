'use client';

/**
 * The volunteer scorekeeper pad's sections (K12-F16). Presentational: the
 * page owns the connection state and the single-flight command sender, and
 * passes `send` + `disabled` down. Every section renders only when the link's
 * server-issued capabilities include it, and every control is ≥ 44 px.
 *
 * Dark, solid backgrounds (mobile performance standard — no blur).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ConsoleStatRule, SportDefinition } from '@cms/api-types';
import { consoleStatRules, PLAY_CLOCK_RESETS_SEC } from '@cms/api-types';
import { Stepper, TeamStatGrid } from '@/components/sports/StatControls';
import {
  baseballCountPatch,
  baseballHalfAdvance,
  isBottomHalf,
  shotClockResets,
  statNumber,
} from '@/lib/sports-stat-rows';
import { fmtPadClock, fmtSubClockSec, parsePadClock, projectSubClockMs, readSubClock } from '@/lib/console-share';

/** One request of a console command. */
export interface PadStep {
  path: string;
  method: 'PATCH' | 'POST';
  body: Record<string, unknown>;
}

/**
 * Fire one console command. `label` is what the volunteer sees while it is
 * pending or if it is refused. `next` is an optional second request run only
 * after the first succeeds (the baseball half-inning: clear the count, then
 * advance the inning) — the pad sends one command at a time, so a two-part
 * action must travel as one command.
 */
export type PadSend = (
  label: string,
  path: string,
  method: 'PATCH' | 'POST',
  body: Record<string, unknown>,
  next?: PadStep,
) => void;

/** A pad button: 48 px tall, solid colour (no overrides needed). */
export function padBtn(tone = 'bg-slate-800 text-white', textCase = 'uppercase tracking-wide'): string {
  return `flex min-h-[48px] items-center justify-center rounded-xl px-3 text-[13px] font-black ${textCase} transition-opacity active:opacity-80 disabled:opacity-40 ${tone}`;
}

export const PAD_BTN = padBtn();

export function PadCard({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className="mx-4 mt-3 rounded-2xl bg-slate-900 p-3">
      <h2 className="mb-2 text-[11px] font-black uppercase tracking-wider text-slate-400">{title}</h2>
      {children}
    </section>
  );
}

/** A tap that needs a second tap within 4 s — for actions that reset other
 *  state (next period clears fouls and the clock server-side). */
function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
  className,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (disabled) setArmed(false);
  }, [disabled]);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setArmed(false), 4000);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
      className={armed ? padBtn('bg-amber-500 text-amber-950') : (className ?? PAD_BTN)}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

// ── game clock ─────────────────────────────────────────────────────

export function PadClockSection({
  running,
  clockNow,
  disabled,
  send,
}: {
  running: boolean;
  clockNow: number;
  disabled: boolean;
  send: PadSend;
}) {
  const t = useTranslations('sportsPad');
  const [edit, setEdit] = useState<string | null>(null);
  const ms = edit === null ? null : parsePadClock(edit);
  return (
    <PadCard title={t('clockTitle')} testId="pad-clock">
      <div className="flex items-stretch">
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            send(running ? t('clockStop') : t('clockStart'), '/clock', 'PATCH', {
              action: running ? 'pause' : 'start',
            })
          }
          className={`min-h-[56px] flex-1 rounded-xl text-base font-black uppercase tracking-wide text-white active:opacity-80 disabled:opacity-40 ${
            running ? 'bg-red-600' : 'bg-emerald-600'
          }`}
        >
          {running ? t('clockStop') : t('clockStart')}
        </button>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <button
          type="button"
          disabled={disabled}
          aria-label={t('minusSecondLabel')}
          onClick={() =>
            send(t('cmdClockNudge', { delta: '−1s' }), '/clock', 'PATCH', {
              action: 'set',
              ms: Math.max(0, Math.round(clockNow) - 1000),
            })
          }
          className={PAD_BTN}
        >
          −1s
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label={t('plusSecondLabel')}
          onClick={() =>
            send(t('cmdClockNudge', { delta: '+1s' }), '/clock', 'PATCH', {
              action: 'set',
              ms: Math.round(clockNow) + 1000,
            })
          }
          className={PAD_BTN}
        >
          +1s
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setEdit(edit === null ? fmtPadClock(clockNow) : null)}
          className={PAD_BTN}
        >
          {t('clockSet')}
        </button>
      </div>
      {edit !== null && (
        <div className="mt-2 flex items-center gap-2">
          <input
            autoFocus
            value={edit}
            onChange={(e) => setEdit(e.target.value.replace(/[^0-9:]/g, '').slice(0, 6))}
            inputMode="numeric"
            placeholder="12:00"
            aria-label={t('clockSetLabel')}
            className="min-h-[48px] w-28 rounded-lg border border-slate-600 bg-slate-800 px-3 text-center font-mono text-lg font-bold text-white"
          />
          <button
            type="button"
            disabled={disabled || ms === null}
            onClick={() => {
              if (ms === null) return;
              send(t('cmdClockSet', { time: fmtPadClock(ms) }), '/clock', 'PATCH', { action: 'set', ms });
              setEdit(null);
            }}
            className="min-h-[48px] flex-1 rounded-lg bg-sky-600 text-sm font-black uppercase tracking-wide text-white disabled:opacity-40"
          >
            {t('apply')}
          </button>
          <button
            type="button"
            onClick={() => setEdit(null)}
            aria-label={t('cancel')}
            className="min-h-[48px] min-w-[48px] rounded-lg bg-slate-700 text-sm font-bold text-slate-200"
          >
            ✕
          </button>
        </div>
      )}
    </PadCard>
  );
}

// ── shot clock / play clock ────────────────────────────────────────

export function PadShotClockSection({
  def,
  stats,
  skewMs,
  nowMs,
  disabled,
  send,
}: {
  def: SportDefinition;
  stats: Record<string, unknown>;
  skewMs: number;
  nowMs: number;
  disabled: boolean;
  send: PadSend;
}) {
  const t = useTranslations('sportsPad');
  const resets = shotClockResets(def, stats);
  if (!resets) return null;
  const sc = readSubClock(stats.shotClock);
  const running = !!sc?.running;
  const armed = !!sc && (sc.len > 0 || sc.ms > 0);
  const ms = sc ? projectSubClockMs(sc, skewMs, nowMs) : 0;
  return (
    <PadCard title={t('shotTitle')} testId="pad-shot-clock">
      <div className="flex items-center gap-3">
        <div className="min-w-[72px] text-center font-mono text-5xl font-black tabular-nums text-amber-400">
          {armed ? fmtSubClockSec(ms) : '—'}
        </div>
        <div className="grid flex-1 grid-cols-2 gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => send(t('cmdShotReset', { seconds: resets.full }), '/shot-clock', 'PATCH', { action: 'reset', value: resets.full })}
            className={PAD_BTN}
          >
            {resets.full}
          </button>
          {resets.short !== null ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                send(t('cmdShotReset', { seconds: resets.short as number }), '/shot-clock', 'PATCH', {
                  action: 'reset',
                  value: resets.short,
                })
              }
              className={PAD_BTN}
            >
              {resets.short}
            </button>
          ) : (
            <span />
          )}
        </div>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          send(running ? t('shotStop') : t('shotStart'), '/shot-clock', 'PATCH', {
            action: running ? 'stop' : 'start',
          })
        }
        className={`mt-2 min-h-[56px] w-full rounded-xl text-base font-black uppercase tracking-wide text-white active:opacity-80 disabled:opacity-40 ${
          running ? 'bg-red-600' : 'bg-emerald-600'
        }`}
      >
        {running ? t('shotStop') : t('shotStart')}
      </button>
    </PadCard>
  );
}

export function PadPlayClockSection({
  stats,
  skewMs,
  nowMs,
  disabled,
  send,
}: {
  stats: Record<string, unknown>;
  skewMs: number;
  nowMs: number;
  disabled: boolean;
  send: PadSend;
}) {
  const t = useTranslations('sportsPad');
  const pc = readSubClock(stats.playClock);
  const running = !!pc?.running;
  const ms = pc ? projectSubClockMs(pc, skewMs, nowMs) : 40_000;
  return (
    <PadCard title={t('playTitle')} testId="pad-play-clock">
      <div className="flex items-center gap-3">
        <div className="min-w-[72px] text-center font-mono text-5xl font-black tabular-nums text-amber-400">
          {pc && pc.at ? fmtSubClockSec(ms) : '40'}
        </div>
        <div className="grid flex-1 grid-cols-2 gap-2">
          {PLAY_CLOCK_RESETS_SEC.map((sec) => (
            <button
              key={sec}
              type="button"
              disabled={disabled}
              onClick={() => send(t('cmdPlayReset', { seconds: sec }), '/play-clock', 'PATCH', { action: 'reset', value: sec })}
              className={PAD_BTN}
            >
              {sec}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          send(running ? t('playStop') : t('playStart'), '/play-clock', 'PATCH', {
            action: running ? 'stop' : 'start',
          })
        }
        className={`mt-2 min-h-[56px] w-full rounded-xl text-base font-black uppercase tracking-wide text-white active:opacity-80 disabled:opacity-40 ${
          running ? 'bg-red-600' : 'bg-emerald-600'
        }`}
      >
        {running ? t('playStop') : t('playStart')}
      </button>
    </PadCard>
  );
}

// ── period ─────────────────────────────────────────────────────────

export function PadSegmentSection({
  segName,
  disabled,
  send,
}: {
  segName: string;
  disabled: boolean;
  send: PadSend;
}) {
  const t = useTranslations('sportsPad');
  return (
    <PadCard title={t('periodTitle')} testId="pad-period">
      <div className="grid grid-cols-2 gap-2">
        <ConfirmButton
          label={t('periodPrev', { segment: segName })}
          confirmLabel={t('tapToConfirm')}
          disabled={disabled}
          onConfirm={() => send(t('periodPrev', { segment: segName }), '/segment', 'PATCH', { delta: -1 })}
        />
        <ConfirmButton
          label={t('periodNext', { segment: segName })}
          confirmLabel={t('tapToConfirm')}
          disabled={disabled}
          onConfirm={() => send(t('periodNext', { segment: segName }), '/segment', 'PATCH', { delta: 1 })}
        />
      </div>
    </PadCard>
  );
}

// ── team stats (and timeout calls) ──────────────────────────────────

export function PadTeamSection({
  def,
  stats,
  homeTeam,
  awayTeam,
  homeColor,
  awayColor,
  canStats,
  canTimeout,
  disabled,
  send,
}: {
  def: SportDefinition;
  stats: Record<string, unknown>;
  homeTeam: string;
  awayTeam: string;
  homeColor: string;
  awayColor: string;
  canStats: boolean;
  canTimeout: boolean;
  disabled: boolean;
  send: PadSend;
}) {
  const t = useTranslations('sportsPad');
  const editable = new Set(canStats ? consoleStatRules(def).map((r) => r.key) : []);
  const labelOf = (key: string) => def.stats.find((s) => s.key === key)?.label || key;
  return (
    <PadCard title={t('teamTitle')} testId="pad-team">
      <TeamStatGrid
        def={def}
        stats={stats}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        homeColor={homeColor}
        awayColor={awayColor}
        disabled={disabled}
        canEdit={(key) => editable.has(key)}
        onStat={(patch) => {
          const [key, value] = Object.entries(patch)[0] || [];
          if (!key) return;
          send(t('cmdStat', { stat: labelOf(key), value: String(value) }), '/stats', 'PATCH', { stats: patch });
        }}
        onTimeout={
          canTimeout
            ? (team) => send(t('cmdTimeout', { team: team === 'home' ? homeTeam : awayTeam }), '/timeout', 'POST', { team })
            : undefined
        }
      />
    </PadCard>
  );
}

/** Game-wide stats: the baseball count, football down & distance, serve,
 *  and any other number the sport lets a volunteer set. */
export function PadGameStatsSection({
  def,
  stats,
  homeTeam,
  awayTeam,
  canSegment,
  disabled,
  send,
}: {
  def: SportDefinition;
  stats: Record<string, unknown>;
  homeTeam: string;
  awayTeam: string;
  canSegment: boolean;
  disabled: boolean;
  send: PadSend;
}) {
  const t = useTranslations('sportsPad');
  const rules = consoleStatRules(def).filter((r) => r.scope === 'game');
  if (rules.length === 0) return null;
  const isBaseball = def.key === 'baseball' || def.key === 'softball';
  const isFootball = def.key === 'football';
  const BASEBALL_KEYS = new Set(['balls', 'strikes', 'outs', 'on1B', 'on2B', 'on3B', 'half']);
  const FOOTBALL_KEYS = new Set(['down', 'distance', 'ballOn']);
  const generic = rules.filter(
    (r) => !(isBaseball && BASEBALL_KEYS.has(r.key)) && !(isFootball && FOOTBALL_KEYS.has(r.key)),
  );
  const stat = (patch: Record<string, number | string>, label: string) =>
    send(label, '/stats', 'PATCH', { stats: patch });

  return (
    <PadCard title={t('gameStatsTitle')} testId="pad-game-stats">
      {isBaseball && (
        <PadBaseballCount
          stats={stats}
          canSegment={canSegment}
          disabled={disabled}
          send={send}
          onStat={stat}
        />
      )}
      {isFootball && <PadFootballDowns def={def} stats={stats} disabled={disabled} onStat={stat} />}
      {generic.map((r) => (
        <PadGenericStat key={r.key} rule={r} stats={stats} homeTeam={homeTeam} awayTeam={awayTeam} disabled={disabled} onStat={stat} />
      ))}
    </PadCard>
  );
}

function PadGenericStat({
  rule,
  stats,
  homeTeam,
  awayTeam,
  disabled,
  onStat,
}: {
  rule: ConsoleStatRule;
  stats: Record<string, unknown>;
  homeTeam: string;
  awayTeam: string;
  disabled: boolean;
  onStat: (patch: Record<string, number | string>, label: string) => void;
}) {
  const t = useTranslations('sportsPad');
  if (rule.kind === 'choice') {
    if (rule.key !== 'serving') return null; // the inning half lives in the count panel
    const cur = String(stats.serving || '');
    const opt = (side: 'home' | 'away', name: string) => (
      <button
        type="button"
        disabled={disabled}
        aria-pressed={cur === side}
        onClick={() => onStat({ serving: side }, t('cmdStat', { stat: rule.label, value: name }))}
        className={`min-h-[48px] min-w-0 flex-1 truncate rounded-xl px-2 text-sm font-black disabled:opacity-40 ${
          cur === side ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
        }`}
      >
        {name}
      </button>
    );
    return (
      <div className="mt-2">
        <div className="mb-1 text-[11px] font-black uppercase tracking-widest text-slate-400">{rule.label}</div>
        <div className="flex gap-2">
          {opt('home', homeTeam)}
          {opt('away', awayTeam)}
        </div>
      </div>
    );
  }
  const value = statNumber(stats, rule.key, rule.min);
  return (
    <div className="mt-2 flex items-center justify-between gap-2">
      <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">{rule.label}</div>
      <Stepper
        value={value}
        min={rule.min}
        max={rule.max}
        label={rule.label}
        disabled={disabled}
        typeIn={rule.max - rule.min > 8}
        onSet={(n) => onStat({ [rule.key]: n }, t('cmdStat', { stat: rule.label, value: String(n) }))}
      />
    </div>
  );
}

function PadBaseballCount({
  stats,
  canSegment,
  disabled,
  send,
  onStat,
}: {
  stats: Record<string, unknown>;
  canSegment: boolean;
  disabled: boolean;
  send: PadSend;
  onStat: (patch: Record<string, number | string>, label: string) => void;
}) {
  const t = useTranslations('sportsPad');
  const balls = statNumber(stats, 'balls');
  const strikes = statNumber(stats, 'strikes');
  const outs = statNumber(stats, 'outs');
  const bottom = isBottomHalf(stats);
  const act = (a: 'ball' | 'strike' | 'foul' | 'out', label: string) => {
    const patch = baseballCountPatch(a, stats);
    if (patch) onStat(patch, label);
  };
  const bases: { key: 'on1B' | 'on2B' | 'on3B'; label: string }[] = [
    { key: 'on1B', label: '1B' },
    { key: 'on2B', label: '2B' },
    { key: 'on3B', label: '3B' },
  ];
  return (
    <div data-testid="pad-baseball-count">
      <div className="mb-2 text-center font-mono text-2xl font-black tabular-nums text-white">
        {balls}–{strikes} · {t('outs', { count: outs })}
      </div>
      <div className="grid grid-cols-4 gap-2">
        <button type="button" disabled={disabled} onClick={() => act('ball', t('ball'))} className={padBtn('bg-red-700 text-white')}>
          {t('ball')}
        </button>
        <button type="button" disabled={disabled} onClick={() => act('strike', t('strike'))} className={PAD_BTN}>
          {t('strike')}
        </button>
        <button type="button" disabled={disabled || strikes >= 2} onClick={() => act('foul', t('foul'))} className={PAD_BTN}>
          {t('foul')}
        </button>
        <button type="button" disabled={disabled} onClick={() => act('out', t('out'))} className={padBtn('bg-amber-700 text-white')}>
          {t('out')}
        </button>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {bases.map((b) => {
          const on = statNumber(stats, b.key) > 0;
          return (
            <button
              key={b.key}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => onStat({ [b.key]: on ? 0 : 1 }, t('cmdBase', { base: b.label }))}
              className={`min-h-[48px] rounded-xl text-sm font-black disabled:opacity-40 ${
                on ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {b.label}
            </button>
          );
        })}
        {canSegment ? (
          <ConfirmButton
            label={bottom ? t('halfBottom') : t('halfTop')}
            confirmLabel={t('tapToConfirm')}
            disabled={disabled}
            className={padBtn('bg-indigo-700 text-white')}
            onConfirm={() => {
              const { patch, segmentDelta } = baseballHalfAdvance(stats);
              send(
                segmentDelta ? t('cmdNextInning') : t('cmdHalf'),
                '/stats',
                'PATCH',
                { stats: patch },
                segmentDelta ? { path: '/segment', method: 'PATCH', body: { delta: 1 } } : undefined,
              );
            }}
          />
        ) : (
          <span className="flex min-h-[48px] items-center justify-center rounded-xl bg-slate-800 text-sm font-black text-slate-300">
            {bottom ? t('halfBottom') : t('halfTop')}
          </span>
        )}
      </div>
    </div>
  );
}

function PadFootballDowns({
  def,
  stats,
  disabled,
  onStat,
}: {
  def: SportDefinition;
  stats: Record<string, unknown>;
  disabled: boolean;
  onStat: (patch: Record<string, number | string>, label: string) => void;
}) {
  const t = useTranslations('sportsPad');
  const down = Math.min(4, Math.max(1, statNumber(stats, 'down', 1)));
  const rule = (key: string) => def.stats.find((s) => s.key === key);
  const dist = rule('distance');
  const ball = rule('ballOn');
  return (
    <div data-testid="pad-football-downs">
      <div className="grid grid-cols-5 gap-2">
        {[1, 2, 3, 4].map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled}
            aria-pressed={d === down}
            onClick={() => onStat({ down: d }, t('cmdDown', { down: t(`down${d}`) }))}
            className={`min-h-[48px] rounded-xl text-sm font-black disabled:opacity-40 ${
              d === down ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {t(`down${d}`)}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onStat({ down: 1, distance: 10 }, t('firstAndTen'))}
          className="min-h-[48px] rounded-xl bg-emerald-700 px-1 text-[11px] font-black leading-tight text-white disabled:opacity-40"
        >
          {t('firstAndTen')}
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">{dist?.label || 'To Go'}</div>
        <Stepper
          value={statNumber(stats, 'distance', 10)}
          min={dist?.min ?? 0}
          max={dist?.max ?? 99}
          label={dist?.label || 'To Go'}
          disabled={disabled}
          typeIn
          onSet={(n) => onStat({ distance: n }, t('cmdStat', { stat: dist?.label || 'To Go', value: String(n) }))}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">{ball?.label || 'Ball On'}</div>
        <Stepper
          value={statNumber(stats, 'ballOn', 0)}
          min={ball?.min ?? 0}
          max={ball?.max ?? 50}
          label={ball?.label || 'Ball On'}
          disabled={disabled}
          typeIn
          onSet={(n) => onStat({ ballOn: n }, t('cmdStat', { stat: ball?.label || 'Ball On', value: String(n) }))}
        />
      </div>
    </div>
  );
}

// ── possession ─────────────────────────────────────────────────────

export function PadPossessionSection({
  possession,
  homeTeam,
  awayTeam,
  disabled,
  send,
}: {
  possession: string;
  homeTeam: string;
  awayTeam: string;
  disabled: boolean;
  send: PadSend;
}) {
  const t = useTranslations('sportsPad');
  const cur = possession.toLowerCase();
  const opt = (side: 'home' | 'away', name: string) => (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={cur === side}
      onClick={() => send(t('cmdPossession', { team: name }), '/possession', 'POST', { team: side })}
      className={`min-h-[52px] min-w-0 flex-1 truncate rounded-xl px-2 text-sm font-black disabled:opacity-40 ${
        cur === side ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
      }`}
    >
      {side === 'home' ? '◀ ' : ''}
      {name}
      {side === 'away' ? ' ▶' : ''}
    </button>
  );
  return (
    <PadCard title={t('possessionTitle')} testId="pad-possession">
      <div className="flex gap-2">
        {opt('home', homeTeam)}
        {opt('away', awayTeam)}
      </div>
    </PadCard>
  );
}

// ── penalties ──────────────────────────────────────────────────────

export function PadPenaltySection({
  def,
  stats,
  homeTeam,
  awayTeam,
  skewMs,
  nowMs,
  disabled,
  send,
}: {
  def: SportDefinition;
  stats: Record<string, unknown>;
  homeTeam: string;
  awayTeam: string;
  skewMs: number;
  nowMs: number;
  disabled: boolean;
  send: PadSend;
}) {
  const t = useTranslations('sportsPad');
  const [team, setTeam] = useState<'home' | 'away'>('home');
  const [player, setPlayer] = useState('');
  const box = def.penaltyBox;
  if (!box) return null;
  const raw = Array.isArray(stats.penalties) ? (stats.penalties as Record<string, unknown>[]) : [];
  const live = raw
    .map((p) => {
      const sc = readSubClock(p);
      return {
        id: String(p.id || ''),
        team: p.team === 'away' ? ('away' as const) : ('home' as const),
        label: String(p.label || ''),
        player: String(p.player || ''),
        ms: sc ? projectSubClockMs(sc, skewMs, nowMs) : 0,
      };
    })
    .filter((p) => p.id && p.ms > 0)
    .sort((a, b) => a.ms - b.ms);
  const teamName = (side: 'home' | 'away') => (side === 'home' ? homeTeam : awayTeam);
  return (
    <PadCard title={box.label} testId="pad-penalties">
      {live.length > 0 && (
        <ul className="mb-3 space-y-2">
          {live.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-xl bg-slate-800 px-3 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black text-white">
                  {teamName(p.team)}
                  {p.player ? ` #${p.player}` : ''}
                </div>
                <div className="text-[11px] font-bold text-slate-400">{p.label}</div>
              </div>
              <span className="font-mono text-lg font-black tabular-nums text-amber-400">{fmtPadClock(p.ms)}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  send(t('cmdRelease', { who: `${teamName(p.team)}${p.player ? ` #${p.player}` : ''}` }), '/penalties', 'PATCH', {
                    action: 'remove',
                    penaltyId: p.id,
                  })
                }
                className="min-h-[44px] rounded-lg bg-slate-700 px-3 text-xs font-black uppercase text-white disabled:opacity-40"
              >
                {t('release')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        {(['home', 'away'] as const).map((side) => (
          <button
            key={side}
            type="button"
            aria-pressed={team === side}
            onClick={() => setTeam(side)}
            className={`min-h-[48px] min-w-0 flex-1 truncate rounded-xl px-2 text-sm font-black ${
              team === side ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {teamName(side)}
          </button>
        ))}
      </div>
      <input
        value={player}
        onChange={(e) => setPlayer(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
        inputMode="numeric"
        placeholder={t('jerseyPlaceholder')}
        aria-label={t('jerseyLabel')}
        className="mt-2 min-h-[48px] w-full rounded-xl border border-slate-600 bg-slate-800 px-3 text-center text-lg font-bold text-white"
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        {box.presets.map((preset) => (
          <button
            key={`${preset.label}-${preset.sec}`}
            type="button"
            disabled={disabled}
            onClick={() => {
              const body: Record<string, unknown> = {
                action: 'add',
                team,
                lenSec: preset.sec,
                label: preset.label,
                player,
              };
              // Water polo: an exclusion with a cap number also counts toward
              // the player's three (the operator console's one-tap does this).
              if (def.key === 'water_polo' && player) body.exclusion = true;
              send(t('cmdPenalty', { team: teamName(team), penalty: preset.label }), '/penalties', 'PATCH', body);
              setPlayer('');
            }}
            className={padBtn('bg-slate-800 text-white', 'normal-case')}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </PadCard>
  );
}

// ── celebrations ──────────────────────────────────────────────────

export function PadCueSection({
  def,
  disabled,
  send,
}: {
  def: SportDefinition;
  disabled: boolean;
  send: PadSend;
}) {
  const t = useTranslations('sportsPad');
  const cues = (def.celebrations || []).slice(0, 8);
  if (cues.length === 0) return null;
  return (
    <PadCard title={t('cuesTitle')} testId="pad-cues">
      <div className="grid grid-cols-4 gap-2">
        {cues.map((c) => (
          <button
            key={c.key}
            type="button"
            disabled={disabled}
            onClick={() => send(c.label, '/cue', 'POST', { key: c.key })}
            className="min-h-[64px] rounded-xl bg-slate-800 px-1 text-center active:opacity-80 disabled:opacity-40"
          >
            <div className="text-xl">{c.emoji}</div>
            <div className="mt-0.5 text-[10px] font-bold leading-tight text-slate-300">{c.label}</div>
          </button>
        ))}
      </div>
    </PadCard>
  );
}
