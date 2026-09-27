/**
 * Volunteer console ROLES — K-12 sports launch program, register row K12-F16.
 *
 * A scorekeeper share link (/console/<token>) used to be one flat capability:
 * score + clock + period + timeouts + cues, for every sport. The audit found
 * two problems with that: a volunteer could not do the jobs the table
 * actually needs (shot clock, play clock, team stats, penalties), and every
 * link could do everything — a clock operator's phone could change the score.
 *
 * This module is the ONE definition both sides read:
 *   - the API (sports-console.controller.ts) ENFORCES it on every request —
 *     the role rides inside the link's HMAC, so it cannot be edited;
 *   - the web pad and the operator's share card RENDER from it.
 *
 * Two filters compose, in this order:
 *   1. the ROLE grants a set of capabilities (a clock operator gets the game
 *      clock, the period and timeouts — never the score);
 *   2. the SPORT removes what it does not have (no shot clock in soccer, no
 *      play clock outside football, no timeouts in volleyball).
 *
 * What a volunteer link can NEVER do, whatever its role (operator-only):
 * change the game status (going FINAL included), roster, sponsors, settings,
 * templates, feed credentials, scenes, and free-text stats that would put
 * arbitrary words on a school's public display (see consoleStatRules).
 *
 * Pure data + functions: no I/O, no DOM. Safe to import from the API, the
 * web app, and tests.
 */
import type { SportDefinition } from './sports';

/** The roles an operator can hand out. */
export const CONSOLE_ROLES = ['table', 'scorer', 'timer', 'shot'] as const;
export type ConsoleRole = (typeof CONSOLE_ROLES)[number];

/** Everything a volunteer link could ever be allowed to do. One capability =
 *  one console route on the API. */
export const CONSOLE_CAPABILITIES = [
  'score',
  'clock',
  'segment',
  'timeout',
  'cue',
  'stats',
  'possession',
  'penalties',
  'shotClock',
  'playClock',
] as const;
export type ConsoleCapability = (typeof CONSOLE_CAPABILITIES)[number];

export function isConsoleRole(v: unknown): v is ConsoleRole {
  return typeof v === 'string' && (CONSOLE_ROLES as readonly string[]).indexOf(v) !== -1;
}

/**
 * Links minted BEFORE roles existed (5-part tokens) keep exactly the
 * allowlist they were issued under. An issued credential never gains power
 * silently — the new capabilities only ride on links minted with a role.
 */
export const LEGACY_CONSOLE_CAPABILITIES: readonly ConsoleCapability[] = [
  'score',
  'clock',
  'segment',
  'timeout',
  'cue',
];

/** What each role is issued with, before the sport filter. */
export const CONSOLE_ROLE_GRANTS: Readonly<Record<ConsoleRole, readonly ConsoleCapability[]>> = {
  // One volunteer running the whole table (the common small-school case).
  table: CONSOLE_CAPABILITIES,
  // Official scorer: points, team stats, fouls, timeouts, possession arrow,
  // penalties, celebrations. Never the game clock.
  scorer: ['score', 'timeout', 'cue', 'stats', 'possession', 'penalties'],
  // Clock operator: game clock, period, timeouts. Never the score.
  timer: ['clock', 'segment', 'timeout'],
  // Shot-clock / play-clock operator: that clock only.
  shot: ['shotClock', 'playClock'],
};

/** Football is the one sport with a play clock (40 / 25). */
export function sportHasPlayClock(def: SportDefinition | null | undefined): boolean {
  return !!def && def.key === 'football';
}

/** Team-timeout stats declared by the sport (football, basketball, water
 *  polo). The API refuses /timeout for every other sport. */
export function sportHasTeamTimeoutStats(def: SportDefinition | null | undefined): boolean {
  if (!def || !Array.isArray(def.stats)) return false;
  return def.stats.some((s) => s.key === 'homeTimeouts' || s.key === 'awayTimeouts');
}

/**
 * Whether the sport scores by quick +N taps. False for sports with no
 * increments (meets) AND for judged sports (`scoreDecimals` > 0), whose
 * stored total is scaled — a +1 tap there would add one thousandth.
 */
export function sportHasQuickScore(def: SportDefinition | null | undefined): boolean {
  if (!def || !def.score || !Array.isArray(def.score.increments)) return false;
  if (typeof def.scoreDecimals === 'number' && def.scoreDecimals > 0) return false;
  return def.score.increments.length > 0;
}

/** The possession arrow the operator console shows (basketball, football). */
export function sportHasPossessionArrow(def: SportDefinition | null | undefined): boolean {
  if (!def || !Array.isArray(def.stats)) return false;
  return (
    def.stats.some((s) => s.key === 'possession') &&
    (def.key === 'basketball' || def.key === 'football')
  );
}

// ── stats a volunteer may write ─────────────────────────────────────

/** One sport stat a volunteer link may set through the console. */
export type ConsoleStatRule =
  | {
      key: string;
      label: string;
      scope: 'game' | 'home' | 'away';
      kind: 'int';
      min: number;
      max: number;
    }
  | {
      key: string;
      label: string;
      scope: 'game' | 'home' | 'away';
      kind: 'choice';
      values: readonly string[];
    };

/**
 * Text stats whose values are a closed set — safe for a volunteer because
 * they cannot spell a message. Every OTHER text stat (weight class, current
 * event, lead runner, dive code, routine, vs-par, pitch type…) is free text
 * that lands on the public display; those stay operator-only.
 */
const CHOICE_STATS: Readonly<Record<string, readonly string[]>> = {
  // Baseball / softball inning half. The console writes 'Top' / 'Bot'; the
  // server's count cascade writes 'Top' / 'Bottom'.
  half: ['Top', 'Bot', 'Bottom'],
  // Volleyball / pickleball serve. '' clears it.
  serving: ['home', 'away', ''],
};

/** Declared stats that have their OWN console route, never /stats. */
const STATS_ROUTE_EXCLUDED: ReadonlySet<string> = new Set([
  // setPossession writes the typed Game.possession column + an audit row.
  'possession',
]);

/**
 * Baseball / softball: the operator console's "Out" button sends outs + 1,
 * and the THIRD out (one past the declared max of 2) is how the server's
 * count cascade retires the side. A volunteer pad must be able to send it.
 */
const CASCADE_MAX: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  baseball: { outs: 3 },
  softball: { outs: 3 },
};

/** Every sport stat a volunteer link may write, with its value rule. */
export function consoleStatRules(def: SportDefinition | null | undefined): ConsoleStatRule[] {
  if (!def || !Array.isArray(def.stats)) return [];
  const out: ConsoleStatRule[] = [];
  const cascade = CASCADE_MAX[def.key] || {};
  for (const s of def.stats) {
    if (STATS_ROUTE_EXCLUDED.has(s.key)) continue;
    if (s.type === 'number') {
      const min = typeof s.min === 'number' ? s.min : 0;
      const declaredMax = typeof s.max === 'number' ? s.max : 999;
      const max = typeof cascade[s.key] === 'number' ? Math.max(declaredMax, cascade[s.key]) : declaredMax;
      out.push({ key: s.key, label: s.label, scope: s.scope, kind: 'int', min, max });
    } else if (Object.prototype.hasOwnProperty.call(CHOICE_STATS, s.key)) {
      out.push({ key: s.key, label: s.label, scope: s.scope, kind: 'choice', values: CHOICE_STATS[s.key] });
    }
  }
  return out;
}

/** Upper bound on keys in one /stats write from a volunteer link. The
 *  baseball half-inning reset is the largest legitimate write (7 keys). */
export const CONSOLE_STATS_MAX_KEYS = 12;

/**
 * Validate a volunteer's stats write. All-or-nothing: one unknown key or one
 * out-of-range value refuses the whole write (and names the keys), so the pad
 * can say exactly what was refused instead of half-applying a change.
 */
export function validateConsoleStats(
  def: SportDefinition | null | undefined,
  input: unknown,
): { ok: true; stats: Record<string, number | string> } | { ok: false; rejected: string[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, rejected: ['stats'] };
  }
  const entries = Object.keys(input as Record<string, unknown>).map(
    (k) => [k, (input as Record<string, unknown>)[k]] as const,
  );
  if (entries.length === 0 || entries.length > CONSOLE_STATS_MAX_KEYS) {
    return { ok: false, rejected: ['stats'] };
  }
  const rules = new Map<string, ConsoleStatRule>();
  for (const r of consoleStatRules(def)) rules.set(r.key, r);
  const stats: Record<string, number | string> = {};
  const rejected: string[] = [];
  for (const [key, value] of entries) {
    const rule = rules.get(key);
    if (!rule) {
      rejected.push(key);
      continue;
    }
    if (rule.kind === 'int') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < rule.min || value > rule.max) {
        rejected.push(key);
        continue;
      }
      stats[key] = value;
    } else {
      if (typeof value !== 'string' || rule.values.indexOf(value) === -1) {
        rejected.push(key);
        continue;
      }
      stats[key] = value;
    }
  }
  return rejected.length > 0 ? { ok: false, rejected } : { ok: true, stats };
}

// ── penalties / clocks ──────────────────────────────────────────────

/** A penalty a volunteer adds must be one of the sport's presets — label and
 *  length together (the preset label is what the board shows). */
export function consolePenaltyPreset(
  def: SportDefinition | null | undefined,
  lenSec: unknown,
  label: unknown,
): { label: string; sec: number } | null {
  const presets = def?.penaltyBox?.presets || [];
  for (const p of presets) {
    if (p.sec === lenSec && p.label === label) return { label: p.label, sec: p.sec };
  }
  return null;
}

/** Largest shot-clock reset a volunteer may send (the sport's longest option). */
export function consoleShotClockMaxSec(def: SportDefinition | null | undefined): number {
  const sc = def?.shotClock;
  if (!sc) return 0;
  let max = typeof sc.full === 'number' ? sc.full : 0;
  for (const o of sc.options || []) if (typeof o === 'number' && o > max) max = o;
  return max;
}

/** The play clock's two standard resets (NFHS football: 40 after a play,
 *  25 after an administrative stoppage). */
export const PLAY_CLOCK_RESETS_SEC: readonly number[] = [40, 25];
/** The server clamps play-clock resets to this; the console refuses above it. */
export const PLAY_CLOCK_MAX_SEC = 60;

// ── what a link can do ──────────────────────────────────────────────

/** Capabilities the SPORT has at all, whatever the role. */
export function sportConsoleCapabilities(
  def: SportDefinition | null | undefined,
): Set<ConsoleCapability> {
  const caps = new Set<ConsoleCapability>();
  if (!def) return caps;
  // Quick-score taps only exist for integer sports. A judged sport stores a
  // SCALED total (gymnastics 195.825 → 195825), so its +1/+5/+10 would add
  // 0.001 — the operator types those totals; a volunteer pad never taps them.
  if (sportHasQuickScore(def)) caps.add('score');
  if (def.clock?.type && def.clock.type !== 'none') caps.add('clock');
  caps.add('segment');
  if (sportHasTeamTimeoutStats(def)) caps.add('timeout');
  if (Array.isArray(def.celebrations) && def.celebrations.length > 0) caps.add('cue');
  if (consoleStatRules(def).length > 0) caps.add('stats');
  if (sportHasPossessionArrow(def)) caps.add('possession');
  if (def.penaltyBox && Array.isArray(def.penaltyBox.presets) && def.penaltyBox.presets.length > 0) {
    caps.add('penalties');
  }
  if (def.shotClock) caps.add('shotClock');
  if (sportHasPlayClock(def)) caps.add('playClock');
  return caps;
}

/**
 * What a link may do: its role's grant, intersected with the sport.
 * `role === null` is a pre-role (legacy) link.
 *
 * Sport-specific rule: in a sport with no game clock (baseball, softball,
 * volleyball, pickleball) there is no clock operator, so the SCORER owns the
 * inning / set counter as well.
 */
export function consoleCapabilities(
  role: ConsoleRole | null,
  def: SportDefinition | null | undefined,
): ConsoleCapability[] {
  if (!def) return [];
  const sport = sportConsoleCapabilities(def);
  const granted = new Set<ConsoleCapability>(role ? CONSOLE_ROLE_GRANTS[role] : LEGACY_CONSOLE_CAPABILITIES);
  if (role === 'scorer' && def.clock?.type === 'none') granted.add('segment');
  return CONSOLE_CAPABILITIES.filter((c) => granted.has(c) && sport.has(c));
}

/**
 * The roles an operator is offered for this sport. A clock operator needs a
 * clock; a shot-clock operator needs a shot clock or a play clock.
 */
export function consoleRolesForSport(def: SportDefinition | null | undefined): ConsoleRole[] {
  if (!def) return [];
  const roles: ConsoleRole[] = ['table', 'scorer'];
  if (def.clock?.type && def.clock.type !== 'none') roles.push('timer');
  if (def.shotClock || sportHasPlayClock(def)) roles.push('shot');
  return roles;
}
