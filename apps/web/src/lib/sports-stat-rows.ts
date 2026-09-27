/**
 * sports-stat-rows — the per-team stat ROWS every game-control surface shows,
 * derived once from the SportDefinition (K12-F15 / F16).
 *
 * The desktop Run view renders each team's stats inside its ScoreTile
 * (fouls, timeouts, shots, exclusions, cards, hits/errors, pitch count, sets,
 * ride time…). The phone Run view hid that whole grid, and the volunteer pad
 * never had it. This module turns the sport's `stats` list into paired
 * HOME | AWAY rows — the same filter ScoreTile uses (per-team number + text
 * stats, clock stats excluded) — so the phone tray and the pad show exactly
 * the rows the desktop shows, in the sport's own order.
 *
 * Also the basketball bonus badge thresholds, shared with the desktop tile so
 * one edit moves every surface (the NFHS rules-profile work, register row
 * K12-F04, owns the actual numbers).
 *
 * Pure: no React, no DOM.
 */
import type { SportDefinition, SportStatField } from '@cms/api-types';

export type TeamStatKind = 'timeouts' | 'fouls' | 'counter' | 'rideTime' | 'text';

export interface TeamStatRow {
  /** The shared suffix after home/away — `Fouls` for homeFouls/awayFouls. */
  id: string;
  /** Short label without the team word — "Fouls", "Timeouts", "Pitch Count". */
  label: string;
  kind: TeamStatKind;
  home: SportStatField | null;
  away: SportStatField | null;
  min: number;
  max: number;
}

/** "Home Fouls" → "Fouls"; "Away Ride Time (s)" → "Ride Time (s)". */
export function shortStatLabel(label: string): string {
  return label.replace(/^(Home|Away)\s+/i, '');
}

function kindOf(f: SportStatField): TeamStatKind {
  const k = f.key.toLowerCase();
  if (f.type === 'text') return 'text';
  if (k.endsWith('timeouts')) return 'timeouts';
  if (k.endsWith('fouls')) return 'fouls';
  if (k.includes('ridetime')) return 'rideTime';
  return 'counter';
}

/** Per-team stats (home* / away*, number or text, no clock keys) — the
 *  exact set ScoreTile renders on the desktop. */
function isTeamStat(f: SportStatField, side: 'home' | 'away'): boolean {
  const k = f.key.toLowerCase();
  return (f.type === 'number' || f.type === 'text') && k.startsWith(side) && !k.includes('clock');
}

/** HOME | AWAY rows in the order the sport declares them. */
export function teamStatRows(def: SportDefinition | null | undefined): TeamStatRow[] {
  if (!def || !Array.isArray(def.stats)) return [];
  const rows: TeamStatRow[] = [];
  const byId = new Map<string, TeamStatRow>();
  for (const f of def.stats) {
    const side = isTeamStat(f, 'home') ? 'home' : isTeamStat(f, 'away') ? 'away' : null;
    if (!side) continue;
    const id = f.key.slice(4);
    let row = byId.get(id);
    if (!row) {
      row = {
        id,
        label: shortStatLabel(f.label),
        kind: kindOf(f),
        home: null,
        away: null,
        min: typeof f.min === 'number' ? f.min : 0,
        max: typeof f.max === 'number' ? f.max : 99,
      };
      byId.set(id, row);
      rows.push(row);
    }
    row[side] = f;
  }
  return rows;
}

/**
 * Basketball team-foul bonus badge — the SAME thresholds the board, ribbon
 * and desktop tile use today (≥7 BONUS, ≥10 DOUBLE BONUS). Register row
 * K12-F04 (NFHS: bonus from the 5th team foul of each quarter, no
 * one-and-one) changes these through the rules profile; keep every console
 * surface on this one function so it moves them all at once.
 */
export function basketballBonus(
  def: SportDefinition | null | undefined,
  fouls: number,
): 'BONUS' | 'DOUBLE BONUS' | null {
  if (!def || def.key !== 'basketball') return null;
  if (fouls >= 10) return 'DOUBLE BONUS';
  if (fouls >= 7) return 'BONUS';
  return null;
}

/**
 * The two shot-clock reset buttons for a game: FULL is the length THIS game
 * runs (the configured `stats.shotClock.len` — a 35-second NFHS game resets to
 * 35, not to the sport default), falling back to the sport's default before
 * the clock is first armed; SHORT is the sport's short reset when it is
 * shorter (basketball 14, water polo 20, lacrosse 60), else null.
 */
export function shotClockResets(
  def: SportDefinition | null | undefined,
  stats: Record<string, unknown> | null | undefined,
): { full: number; short: number | null } | null {
  const sc = def?.shotClock;
  if (!sc) return null;
  const stored = stats && stats.shotClock && typeof stats.shotClock === 'object'
    ? (stats.shotClock as Record<string, unknown>)
    : null;
  const len = stored && typeof stored.len === 'number' && stored.len > 0 ? stored.len : 0;
  const full = len || sc.full;
  const short = typeof sc.short === 'number' && sc.short > 0 && sc.short < full ? sc.short : null;
  return { full, short };
}

/** A number read from the stats blob, falling back when absent / not finite. */
export function statNumber(stats: Record<string, unknown> | null | undefined, key: string, fallback = 0): number {
  const v = stats ? stats[key] : undefined;
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

/** m:ss for a whole number of seconds (wrestling ride time). */
export function fmtMinSec(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "1:12" or a bare "72" → seconds; null when unparseable. */
export function parseMinSec(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  const m = t.match(/^(\d{1,3}):([0-5]?\d)$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  if (/^\d{1,4}$/.test(t)) return parseInt(t, 10);
  return null;
}

// ── baseball / softball count ───────────────────────────────────────

export type BaseballAction = 'ball' | 'strike' | 'foul' | 'out';

/**
 * The stats write for one count button — the operator console's BaseTrayBall
 * semantics, verbatim: Ball / Strike stop at 3 / 2 (the table records the
 * walk or strikeout as its own action); a Foul never makes the third strike;
 * Out retires the batter and clears the count (the server's cascade rolls the
 * side over at 3 outs). Null = the tap does nothing (foul at two strikes).
 */
export function baseballCountPatch(
  action: BaseballAction,
  stats: Record<string, unknown> | null | undefined,
): Record<string, number> | null {
  const balls = statNumber(stats, 'balls');
  const strikes = statNumber(stats, 'strikes');
  const outs = statNumber(stats, 'outs');
  switch (action) {
    case 'ball':
      return { balls: Math.min(3, balls + 1) };
    case 'strike':
      return { strikes: Math.min(2, strikes + 1) };
    case 'foul':
      return strikes < 2 ? { strikes: strikes + 1 } : null;
    case 'out':
      return { outs: outs + 1, balls: 0, strikes: 0 };
    default:
      return null;
  }
}

/** Is it the bottom half? ('Bot' / 'Bottom', any case). */
export function isBottomHalf(stats: Record<string, unknown> | null | undefined): boolean {
  const h = String((stats && stats.half) || '').toUpperCase();
  return h === 'BOT' || h === 'BOTTOM';
}

/**
 * Advance the half-inning: Top → Bot (same inning), Bot → next inning's Top.
 * Clears the count and the bases, like the console's half button. `segmentDelta`
 * is 1 when a new inning starts (the caller advances the segment).
 */
export function baseballHalfAdvance(stats: Record<string, unknown> | null | undefined): {
  patch: Record<string, number | string>;
  segmentDelta: 0 | 1;
} {
  const bottom = isBottomHalf(stats);
  return {
    patch: { half: bottom ? 'Top' : 'Bot', balls: 0, strikes: 0, outs: 0, on1B: 0, on2B: 0, on3B: 0 },
    segmentDelta: bottom ? 1 : 0,
  };
}
