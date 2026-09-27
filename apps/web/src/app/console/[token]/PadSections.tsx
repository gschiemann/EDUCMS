'use client';

/**
 * The volunteer scorekeeper pad's sections (K12-F16). Presentational: the
 * page owns the connection state and the single-flight command sender, and
 * passes `send` + `disabled` down. Every section renders only when the link's
 * server-issued `allows` include it, and every control is ≥ 44 px.
 *
 * Clocks read the page's ONE server clock (`nowMs` = serverClock.now(), held
 * while the link is stale) through the shared projections and formatter in
 * @cms/api-types (K12-F17) — the same readings the board shows.
 *
 * Dark, solid backgrounds (mobile performance standard — no blur).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ConsoleStatRule, SportDefinition } from '@cms/api-types';
import {
  consolePlayClockResets,
  consoleStatRules,
  formatClockReading,
  formatSportClock,
  parseClockEntry,
  projectCountdownMs,
  shotClockDisplayLen,
  shotClockMode,
} from '@cms/api-types';
import { Stepper, TeamStatGrid } from '@/components/sports/StatControls';
import {
  baseballCountPatch,
  baseballHalfAdvance,
  isBottomHalf,
  shotClockResets,
  statNumber,
} from '@/lib/sports-stat-rows';
import type { PadStep } from '@/lib/console-pad-commands';

/**
 * Fire one console command. `label` is what the volunteer sees while it is
 * pending, if it is refused, and on the Undo card. `next` is an optional
 * second request run only after the first succeeds (the baseball half-inning:
 * clear the count, then advance the inning) — the pad sends one command at a
 * time, so a two-part action must travel as one.
 */
export type PadSend = (label: string, step: PadStep, next?: PadStep) => void;

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
 *  state (next period clears fouls and the clock server-side) or that take
 *  something back (Undo). */
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
  const [armedState, setArmed] = useState(false);
  // While disabled (connection lost, command in flight) the button neither
  // shows nor acts armed; the arm itself still lapses on its 4 s timer.
  const armed = armedState && !disabled;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
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

/** Whole seconds for a shot / play clock readout (ceil — 0.4 s reads 1). */
function wholeSeconds(ms: number): string {
  return String(Math.max(0, Math.ceil(ms / 1000)));
}

// ── undo ───────────────────────────────────────────────────────────

/**
 * Undo THIS link's own latest change (the server's single-use inverse,
 * K12-F09). Two taps, like every take-back on the pad.
 */
export function PadUndoCard({ label, disabled, onUndo }: { label: string; disabled: boolean; onUndo: () => void }) {
  const t = useTranslations('sportsPad');
  return (
    <section data-testid="pad-undo" className="mx-4 mt-3 flex items-center gap-3 rounded-2xl bg-slate-900 p-3">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">{t('lastChange')}</div>
        <div className="truncate text-sm font-black text-white">{label}</div>
      </div>
      <div className="w-36 shrink-0">
        <ConfirmButton
          label={t('undo')}
          confirmLabel={t('undoConfirm')}
          disabled={disabled}
          onConfirm={onUndo}
          className={padBtn('w-full bg-slate-700 text-white')}
        />
      </div>
    </section>
  );
}

// ── the scoreboard's secondary clock readout ───────────────────────

/** The shot clock (or the football play clock) under the game clock, as the
 *  board shows it: hidden when the table switched it off. */
export function PadSubClockReadout({
  def,
  stats,
  nowMs,
}: {
  def: SportDefinition;
  stats: Record<string, unknown>;
  nowMs: number;
}) {
  let text: string | null = null;
  if (def.shotClock) {
    const len = shotClockDisplayLen(def, stats);
    text = len > 0 ? wholeSeconds(projectCountdownMs(stats.shotClock as Record<string, unknown>, nowMs)) : null;
  } else if (def.playClock) {
    const pc = stats.playClock as Record<string, unknown> | undefined;
    text =
      !pc || typeof pc !== 'object'
        ? String(def.playClock.full)
        : pc.off
          ? null
          : wholeSeconds(projectCountdownMs(pc, nowMs));
  }
  if (text === null) return null;
  return (
    <div className="mt-1 font-mono text-lg font-black tabular-nums text-amber-400" data-testid="pad-subclock">
      {text}
    </div>
  );
}

// ── game clock ─────────────────────────────────────────────────────

export function PadClockSection({
  def,
  running,
  clockNow,
  disabled,
  send,
}: {
  def: SportDefinition;
  running: boolean;
  clockNow: number;
  disabled: boolean;
  send: PadSend;
}) {
  const t = useTranslations('sportsPad');
  const [edit, setEdit] = useState<string | null>(null);
  // The shared exact-time parser (K12-F17): m:ss, m:ss.t, :ss.t or ss.t —
  // "4.3" is a last-second correction; a bare number is refused.
  const ms = edit === null ? null : parseClockEntry(edit);
  const clock = (body: Record<string, unknown>): PadStep => ({ kind: 'clock', path: '/clock', method: 'PATCH', body });
  const apply = () => {
    if (ms === null || disabled) return;
    send(t('cmdClockSet', { time: formatSportClock(def, ms) }), clock({ action: 'set', ms }));
    setEdit(null);
  };
  return (
    <PadCard title={t('clockTitle')} testId="pad-clock">
      <div className="flex items-stretch">
        <button
          type="button"
          disabled={disabled}
          onClick={() => send(running ? t('clockStop') : t('clockStart'), clock({ action: running ? 'pause' : 'start' }))}
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
            send(
              t('cmdClockNudge', { delta: t('minusSecond') }),
              clock({ action: 'set', ms: Math.max(0, Math.round(clockNow) - 1000) }),
            )
          }
          className={PAD_BTN}
        >
          {t('minusSecond')}
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label={t('plusSecondLabel')}
          onClick={() =>
            send(t('cmdClockNudge', { delta: t('plusSecond') }), clock({ action: 'set', ms: Math.round(clockNow) + 1000 }))
          }
          className={PAD_BTN}
        >
          {t('plusSecond')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setEdit(edit === null ? formatSportClock(def, clockNow) : null)}
          className={PAD_BTN}
        >
          {t('clockSet')}
        </button>
      </div>
      {edit !== null && (
        <>
          <div className="mt-2 flex items-center gap-2">
            <input
              autoFocus
              value={edit}
              onChange={(e) => setEdit(e.target.value.replace(/[^0-9:.]/g, '').slice(0, 8))}
              onKeyDown={(e) => {
                // Escape cancels — the typed time is never sent. Enter applies.
                if (e.key === 'Escape') setEdit(null);
                if (e.key === 'Enter') apply();
              }}
              inputMode="decimal"
              placeholder="12:00"
              aria-label={t('clockSetLabel')}
              aria-describedby="pad-clock-hint"
              className="min-h-[48px] w-28 rounded-lg border border-slate-600 bg-slate-800 px-3 text-center font-mono text-lg font-bold text-white"
            />
            <button
              type="button"
              disabled={disabled || ms === null}
              onClick={apply}
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
          <p id="pad-clock-hint" className="mt-1.5 text-[11px] font-semibold text-slate-400">
            {t('clockSetHint')}
          </p>
        </>
      )}
    </PadCard>
  );
}

// ── shot clock / play clock ────────────────────────────────────────

export function PadShotClockSection({
  def,
  stats,
  nowMs,
  disabled,
  send,
}: {
  def: SportDefinition;
  stats: Record<string, unknown>;
  nowMs: number;
  disabled: boolean;
  send: PadSend;
}) {
  const t = useTranslations('sportsPad');
  if (!def.shotClock) return null;
  const shot = (body: Record<string, unknown>): PadStep => ({
    kind: 'shotClock',
    path: '/shot-clock',
    method: 'PATCH',
    body,
  });
  // K12-F05 — OFF is the table's decision, kept across the game; the server
  // refuses every start / stop / reset while it is off. Say so, no buttons.
  if (shotClockMode(stats) === 'off') {
    return (
      <PadCard title={t('shotTitle')} testId="pad-shot-clock">
        <p className="text-[13px] font-semibold text-slate-300">{t('shotOff')}</p>
      </PadCard>
    );
  }
  const resets = shotClockResets(def, stats);
  if (!resets) return null;
  const sc = stats.shotClock as Record<string, unknown> | undefined;
  const running = !!sc?.running;
  const armed = shotClockDisplayLen(def, stats) > 0;
  return (
    <PadCard title={t('shotTitle')} testId="pad-shot-clock">
      <div className="flex items-center gap-3">
        <div className="min-w-[72px] text-center font-mono text-5xl font-black tabular-nums text-amber-400">
          {armed ? wholeSeconds(projectCountdownMs(sc, nowMs)) : '—'}
        </div>
        <div className="grid flex-1 grid-cols-2 gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => send(t('cmdShotReset', { seconds: resets.full }), shot({ action: 'reset', value: resets.full }))}
            className={PAD_BTN}
          >
            {resets.full}
          </button>
          {resets.short !== null ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                send(t('cmdShotReset', { seconds: resets.short as number }), shot({ action: 'reset', value: resets.short }))
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
        onClick={() => send(running ? t('shotStop') : t('shotStart'), shot({ action: running ? 'stop' : 'start' }))}
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
  def,
  stats,
  nowMs,
  disabled,
  send,
}: {
  def: SportDefinition;
  stats: Record<string, unknown>;
  nowMs: number;
  disabled: boolean;
  send: PadSend;
}) {
  const t = useTranslations('sportsPad');
  const cfg = def.playClock;
  if (!cfg) return null;
  const play = (body: Record<string, unknown>): PadStep => ({
    kind: 'playClock',
    path: '/play-clock',
    method: 'PATCH',
    body,
  });
  const pc =
    stats.playClock && typeof stats.playClock === 'object' ? (stats.playClock as Record<string, unknown>) : null;
  const running = !!pc?.running;
  // NFHS instruction M (K12-F06): a count longer than the time left in the
  // quarter is switched off by the server until the next reset.
  const off = pc?.off === true;
  return (
    <PadCard title={t('playTitle')} testId="pad-play-clock">
      <div className="flex items-center gap-3">
        <div className="min-w-[72px] text-center font-mono text-5xl font-black tabular-nums text-amber-400">
          {off ? '—' : pc ? wholeSeconds(projectCountdownMs(pc, nowMs)) : String(cfg.full)}
        </div>
        <div className="grid flex-1 grid-cols-2 gap-2">
          {consolePlayClockResets(def).map((sec) => (
            <button
              key={sec}
              type="button"
              disabled={disabled}
              onClick={() => send(t('cmdPlayReset', { seconds: sec }), play({ action: 'reset', value: sec }))}
              className={PAD_BTN}
            >
              {sec}
            </button>
          ))}
        </div>
      </div>
      {off && <p className="mt-2 text-[12px] font-semibold text-amber-300">{t('playOff')}</p>}
      <button
        type="button"
        disabled={disabled}
        onClick={() => send(running ? t('playStop') : t('playStart'), play({ action: running ? 'stop' : 'start' }))}
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
  const seg = (delta: number): PadStep => ({ kind: 'segment', path: '/segment', method: 'PATCH', body: { delta } });
  return (
    <PadCard title={t('periodTitle')} testId="pad-period">
      <div className="grid grid-cols-2 gap-2">
        <ConfirmButton
          label={t('periodPrev', { segment: segName })}
          confirmLabel={t('tapToConfirm')}
          disabled={disabled}
          onConfirm={() => send(t('periodPrev', { segment: segName }), seg(-1))}
        />
        <ConfirmButton
          label={t('periodNext', { segment: segName })}
          confirmLabel={t('tapToConfirm')}
          disabled={disabled}
          onConfirm={() => send(t('periodNext', { segment: segName }), seg(1))}
        />
      </div>
    </PadCard>
  );
}

// ── team stats (and timeout calls) ──────────────────────────────────

const statsStep = (patch: Record<string, unknown>): PadStep => ({
  kind: 'stats',
  path: '/stats',
  method: 'PATCH',
  body: { stats: patch },
});

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
    // A clock operator sees only the timeout calls here — title it that way.
    <PadCard title={canStats ? t('teamTitle') : t('timeoutsTitle')} testId="pad-team">
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
          send(t('cmdStat', { stat: labelOf(key), value: String(value) }), statsStep(patch));
        }}
        onTimeout={
          canTimeout
            ? (team) =>
                send(t('cmdTimeout', { team: team === 'home' ? homeTeam : awayTeam }), {
                  kind: 'timeout',
                  path: '/timeout',
                  method: 'POST',
                  body: { team },
                })
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
  const stat = (patch: Record<string, number | string>, label: string) => send(label, statsStep(patch));

  return (
    <PadCard title={t('gameStatsTitle')} testId="pad-game-stats">
      {isBaseball && (
        <PadBaseballCount stats={stats} canSegment={canSegment} disabled={disabled} send={send} onStat={stat} />
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
                statsStep(patch),
                segmentDelta ? { kind: 'segment', path: '/segment', method: 'PATCH', body: { delta: 1 } } : undefined,
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
      onClick={() =>
        send(t('cmdPossession', { team: name }), {
          kind: 'possession',
          path: '/possession',
          method: 'POST',
          body: { team: side },
        })
      }
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
  nowMs,
  disabled,
  send,
}: {
  def: SportDefinition;
  stats: Record<string, unknown>;
  homeTeam: string;
  awayTeam: string;
  nowMs: number;
  disabled: boolean;
  send: PadSend;
}) {
  const t = useTranslations('sportsPad');
  const [team, setTeam] = useState<'home' | 'away'>('home');
  const [player, setPlayer] = useState('');
  const box = def.penaltyBox;
  if (!box) return null;
  const pen = (body: Record<string, unknown>): PadStep => ({ kind: 'penalties', path: '/penalties', method: 'PATCH', body });
  const raw = Array.isArray(stats.penalties) ? (stats.penalties as Record<string, unknown>[]) : [];
  const live = raw
    .map((p) => ({
      id: String(p.id || ''),
      team: p.team === 'away' ? ('away' as const) : ('home' as const),
      label: String(p.label || ''),
      player: String(p.player || ''),
      ms: projectCountdownMs(p, nowMs),
    }))
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
              <span className="font-mono text-lg font-black tabular-nums text-amber-400">{formatClockReading(p.ms)}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  send(
                    t('cmdRelease', { who: `${teamName(p.team)}${p.player ? ` #${p.player}` : ''}` }),
                    pen({ action: 'remove', penaltyId: p.id }),
                  )
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
              send(t('cmdPenalty', { team: teamName(team), penalty: preset.label }), pen(body));
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
            onClick={() => send(c.label, { kind: 'cue', path: '/cue', method: 'POST', body: { key: c.key } })}
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
