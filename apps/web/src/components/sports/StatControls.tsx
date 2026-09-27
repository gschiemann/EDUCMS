'use client';

/**
 * StatControls — the per-team stat controls shared by the PHONE Run view
 * (PhoneRunTrays) and the volunteer scorekeeper pad (/console/[token])
 * (K12-F15 / F16).
 *
 * The desktop console edits each team's stats inside its ScoreTile; on a
 * phone that grid was hidden, and the pad never had it. TeamStatGrid renders
 * the SAME rows (lib/sports-stat-rows teamStatRows) as HOME | AWAY columns
 * sized for a thumb: every control is at least 44×44 px, nothing lives
 * behind hover or right-click, and two columns fit a 360 px screen.
 *
 * Dark theme only (both hosts are dark). Solid backgrounds, no blur.
 */
import { useTranslations } from 'next-intl';
import type { SportDefinition } from '@cms/api-types';
import {
  basketballBonus,
  fmtMinSec,
  parseMinSec,
  statNumber,
  teamStatRows,
  type TeamStatRow,
} from '@/lib/sports-stat-rows';
// Draft-while-editing: commits on blur / Enter, DISCARDS on Escape — the one
// typed-field contract the whole Run view shares (hooks/use-draft-field).
import { useDraftField } from '@/hooks/use-draft-field';

const STEP_BTN =
  'flex h-11 min-w-[44px] items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-lg font-bold text-slate-100 transition-colors active:bg-slate-600 disabled:opacity-30';

/**
 * − value + with 44 px targets. `typeIn` turns the value into a tap-to-type
 * field for wide ranges (pitch count 0–200) so a big miscount is one edit,
 * not forty taps.
 */
export function Stepper({
  value,
  min,
  max,
  label,
  onSet,
  disabled,
  typeIn,
}: {
  value: number;
  min: number;
  max: number;
  /** Accessible name of the stat, e.g. "Central Comets Fouls". */
  label: string;
  onSet: (n: number) => void;
  disabled?: boolean;
  typeIn?: boolean;
}) {
  const t = useTranslations('sportsControls');
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const field = useDraftField(
    () => String(value),
    (text) => {
      const n = parseInt(text, 10);
      if (Number.isFinite(n) && clamp(n) !== value) onSet(clamp(n));
    },
  );
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onSet(clamp(value - 1))}
        aria-label={t('decrease', { stat: label })}
        className={STEP_BTN}
      >
        −
      </button>
      {typeIn ? (
        <input
          type="text"
          inputMode="numeric"
          value={field.draft ?? String(value)}
          disabled={disabled}
          onFocus={field.onFocus}
          onChange={(e) => field.onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
          onBlur={field.onBlur}
          onKeyDown={field.onKeyDown}
          aria-label={t('typeValue', { stat: label })}
          className="h-11 w-12 rounded-lg border border-slate-700 bg-slate-950 text-center text-lg font-black tabular-nums text-white outline-none focus:border-indigo-400 disabled:opacity-40"
        />
      ) : (
        <span className="w-10 text-center text-lg font-black tabular-nums text-white" aria-live="polite">
          {value}
        </span>
      )}
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onSet(clamp(value + 1))}
        aria-label={t('increase', { stat: label })}
        className={STEP_BTN}
      >
        +
      </button>
    </div>
  );
}

/** m:ss entry for ride time (stored in seconds). */
function MinSecField({
  seconds,
  maxSeconds,
  label,
  onSet,
  disabled,
}: {
  seconds: number;
  maxSeconds: number;
  label: string;
  onSet: (secs: number) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('sportsControls');
  const field = useDraftField(
    () => fmtMinSec(seconds),
    (text) => {
      const secs = parseMinSec(text);
      if (secs !== null && secs !== seconds) onSet(Math.max(0, Math.min(maxSeconds, secs)));
    },
  );
  return (
    <input
      type="text"
      inputMode="numeric"
      value={field.draft ?? fmtMinSec(seconds)}
      disabled={disabled}
      onFocus={field.onFocus}
      onChange={(e) => field.onChange(e.target.value.replace(/[^0-9:]/g, '').slice(0, 6))}
      onBlur={field.onBlur}
      onKeyDown={field.onKeyDown}
      placeholder="0:00"
      aria-label={t('typeTime', { stat: label })}
      className="h-11 w-24 rounded-lg border border-slate-700 bg-slate-950 text-center text-lg font-black tabular-nums text-white outline-none focus:border-indigo-400 disabled:opacity-40"
    />
  );
}

/** Free-text per-team value (golf vs-par, cheer routine) — operator console only. */
function TextField({
  value,
  label,
  onSet,
  disabled,
}: {
  value: string;
  label: string;
  onSet: (v: string) => void;
  disabled?: boolean;
}) {
  const field = useDraftField(
    () => value,
    (text) => {
      if (text.trim() !== value) onSet(text.trim());
    },
  );
  return (
    <input
      type="text"
      value={field.draft ?? value}
      disabled={disabled}
      onFocus={field.onFocus}
      onChange={(e) => field.onChange(e.target.value)}
      onBlur={field.onBlur}
      onKeyDown={field.onKeyDown}
      placeholder="—"
      aria-label={label}
      className="h-11 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 text-center text-base font-black text-white outline-none focus:border-indigo-400 disabled:opacity-40"
    />
  );
}

export interface TeamStatGridProps {
  def: SportDefinition;
  stats: Record<string, unknown>;
  homeTeam: string;
  awayTeam: string;
  homeColor: string;
  awayColor: string;
  /** May this stat key be edited here? (The pad passes its role's rules.) */
  canEdit: (key: string) => boolean;
  onStat: (patch: Record<string, number | string>) => void;
  /** Call a team timeout (pause + decrement + cue). Omit to hide the buttons. */
  onTimeout?: (team: 'home' | 'away') => void;
  disabled?: boolean;
}

/** Every per-team stat of the sport as HOME | AWAY rows. Renders nothing
 *  when no row has anything this surface may do. */
export function TeamStatGrid({
  def,
  stats,
  homeTeam,
  awayTeam,
  homeColor,
  awayColor,
  canEdit,
  onStat,
  onTimeout,
  disabled,
}: TeamStatGridProps) {
  const t = useTranslations('sportsControls');
  const usable = (row: TeamStatRow) =>
    [row.home, row.away].some(
      (f) => !!f && (canEdit(f.key) || (row.kind === 'timeouts' && !!onTimeout)),
    );
  const rows = teamStatRows(def).filter(usable);
  if (rows.length === 0) return null;

  const teamName = (side: 'home' | 'away') =>
    (side === 'home' ? homeTeam : awayTeam) || (side === 'home' ? t('home') : t('away'));

  const cell = (row: TeamStatRow, side: 'home' | 'away') => {
    const f = side === 'home' ? row.home : row.away;
    if (!f) return <div />;
    const editable = canEdit(f.key);
    const name = `${teamName(side)} ${row.label}`;
    const value = statNumber(stats, f.key);
    const min = typeof f.min === 'number' ? f.min : 0;
    const max = typeof f.max === 'number' ? f.max : 99;

    if (row.kind === 'text') {
      const text = stats[f.key] === undefined || stats[f.key] === null ? '' : String(stats[f.key]);
      return editable ? (
        <TextField value={text} label={name} disabled={disabled} onSet={(v) => onStat({ [f.key]: v })} />
      ) : (
        <span className="text-lg font-black text-white">{text || '—'}</span>
      );
    }

    if (row.kind === 'rideTime') {
      return editable ? (
        <MinSecField
          seconds={value}
          maxSeconds={max}
          label={name}
          disabled={disabled}
          onSet={(secs) => onStat({ [f.key]: secs })}
        />
      ) : (
        <span className="text-lg font-black tabular-nums text-white">{fmtMinSec(value)}</span>
      );
    }

    if (row.kind === 'timeouts') {
      return (
        <div className="flex flex-col gap-1.5">
          {onTimeout && (
            <button
              type="button"
              disabled={disabled || value <= 0}
              onClick={() => onTimeout(side)}
              aria-label={`${t('callTimeout')} — ${teamName(side)}`}
              className="flex min-h-[48px] w-full items-center justify-center rounded-lg border border-amber-600 bg-amber-700 px-2 text-sm font-black uppercase tracking-wide text-amber-50 transition-colors active:bg-amber-600 disabled:opacity-40"
            >
              {value <= 0 ? t('noTimeoutsLeft') : `${t('callTimeout')} · ${t('timeoutsLeft', { count: value })}`}
            </button>
          )}
          {editable ? (
            <Stepper
              value={value}
              min={min}
              max={max}
              label={name}
              disabled={disabled}
              onSet={(n) => onStat({ [f.key]: n })}
            />
          ) : !onTimeout ? (
            <span className="text-lg font-black tabular-nums text-white">{value}</span>
          ) : null}
        </div>
      );
    }

    const bonus = row.kind === 'fouls' ? basketballBonus(def, value) : null;
    return (
      <div className="flex flex-col gap-1">
        {editable ? (
          <Stepper
            value={value}
            min={min}
            max={max}
            label={name}
            disabled={disabled}
            typeIn={max - min > 8}
            onSet={(n) => onStat({ [f.key]: n })}
          />
        ) : (
          <span className="text-lg font-black tabular-nums text-white">{value}</span>
        )}
        {bonus && (
          <span className="self-start rounded border border-amber-500/40 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-300">
            {bonus === 'DOUBLE BONUS' ? t('doubleBonus') : t('bonus')}
          </span>
        )}
      </div>
    );
  };

  return (
    <div data-testid="team-stat-grid">
      <div className="grid grid-cols-2 gap-2">
        {(['home', 'away'] as const).map((side) => (
          <div key={side} className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              {side === 'home' ? t('home') : t('away')}
            </div>
            <div
              className="truncate text-sm font-black"
              style={{ color: side === 'home' ? homeColor : awayColor }}
              title={teamName(side)}
            >
              {teamName(side)}
            </div>
          </div>
        ))}
      </div>
      {rows.map((row) => (
        <div key={row.id} role="group" aria-label={row.label} className="mt-3">
          <div className="mb-1 text-[11px] font-black uppercase tracking-widest text-slate-400">{row.label}</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0">{cell(row, 'home')}</div>
            <div className="min-w-0">{cell(row, 'away')}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
