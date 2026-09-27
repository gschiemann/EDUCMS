/**
 * Scorekeeper-link SCOPES — the ONE permission model of a /console/<token>
 * link (K-12 sports launch program: K12-F34 scopes from lane A1, K12-F16
 * volunteer duties from lane B1, unified 2026-09-27).
 *
 * A scorekeeper share link used to be one flat capability: score + clock +
 * period + timeouts + cues, for every sport. Two things were wrong with that:
 * a volunteer could not do the jobs a table actually needs (shot clock, play
 * clock, team fouls, possession, penalties), and every link could do
 * everything — a clock operator's phone could change the score.
 *
 * A link is now minted for ONE job, its SCOPE, and the scope is bound into the
 * link's MAC (apps/api/src/sports/sports-console-token.ts): it cannot be read
 * from the token text, edited, or widened. This module is the one table both
 * sides read:
 *   - the API (sports-console.controller.ts) ENFORCES it on every request;
 *   - the web pad and the operator's share sheet RENDER from it.
 *
 * Two filters compose, in this order:
 *   1. the SCOPE grants a set of actions (a clock operator gets the game
 *      clock, the period and timeouts — never the score);
 *   2. the SPORT removes what it does not have (no shot clock in soccer, no
 *      play clock outside football, no timeouts in volleyball).
 *
 * `full` is every link minted before this model existed, and any mint that
 * names no scope. It keeps EXACTLY the five controls it was issued with — an
 * issued credential never gains power silently. The share sheet mints `table`
 * for "one person runs the whole table".
 *
 * What a link can NEVER do, whatever its scope (operator-only): change the
 * game status (going FINAL included), reopen a final game, roster, sponsors,
 * settings, templates, feed credentials, scenes, shot-clock setup, and
 * free-text stats that would put arbitrary words on a school's public
 * display (see consoleStatRules). A link can undo only its OWN most recent
 * action (the console controller's /undo route), never anyone else's.
 *
 * Pure data + functions: no I/O, no DOM. Safe to import from the API, the web
 * app and tests.
 */
import type { SportDefinition } from './sports';

/** The scopes a link can be minted with. */
export const CONSOLE_SCOPES = ['full', 'table', 'scorer', 'timer', 'shot', 'presentation'] as const;
export type ConsoleScope = (typeof CONSOLE_SCOPES)[number];

export function isConsoleScope(v: unknown): v is ConsoleScope {
  return typeof v === 'string' && (CONSOLE_SCOPES as readonly string[]).indexOf(v) !== -1;
}

/** Everything a link could ever be allowed to do. One action = one console
 *  route on the API. There is deliberately no status / final / reopen action. */
export const CONSOLE_ACTIONS = [
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
export type ConsoleAction = (typeof CONSOLE_ACTIONS)[number];

/** What each scope is issued with, before the sport filter. */
export const CONSOLE_SCOPE_ALLOWS: Readonly<Record<ConsoleScope, readonly ConsoleAction[]>> = {
  // The original five-control link. Frozen: never widened to newer duties.
  full: ['score', 'clock', 'segment', 'timeout', 'cue'],
  // One volunteer running the whole table (the common small-school case).
  table: CONSOLE_ACTIONS,
  // Official scorer: points, timeouts, celebrations, team fouls / stats, the
  // possession arrow and the penalty box. Never a clock.
  scorer: ['score', 'timeout', 'cue', 'stats', 'possession', 'penalties'],
  // Clock operator: game clock, period, timeouts. Never the score.
  timer: ['clock', 'segment', 'timeout'],
  // Shot-clock / play-clock operator: that clock only.
  shot: ['shotClock', 'playClock'],
  // Game presentation: celebrations only.
  presentation: ['cue'],
};

/** Football's play clock (the count to the snap), from the sport definition. */
export function sportHasPlayClock(def: SportDefinition | null | undefined): boolean {
  return !!def && !!def.playClock;
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

// ── stats a link may write ──────────────────────────────────────────

/** One sport stat a link may set through the console. */
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

/** Every sport stat a link may write, with its value rule. */
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

/** Upper bound on keys in one /stats write from a link. The baseball
 *  half-inning reset is the largest legitimate write (7 keys). */
export const CONSOLE_STATS_MAX_KEYS = 12;

/**
 * Validate a link's stats write. All-or-nothing: one unknown key or one
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

/** A penalty a link adds must be one of the sport's presets — label and
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

/** Largest shot-clock reset a link may send (the sport's longest option).
 *  The service refuses anything above the game's CONFIGURED length. */
export function consoleShotClockMaxSec(def: SportDefinition | null | undefined): number {
  const sc = def?.shotClock;
  if (!sc) return 0;
  let max = typeof sc.full === 'number' ? sc.full : 0;
  for (const o of sc.options || []) if (typeof o === 'number' && o > max) max = o;
  return max;
}

/** The play clock's two resets for the sport (NFHS football: 40 after a
 *  down, 25 after an administrative stoppage) — the only values the service
 *  accepts. Empty for a sport with no play clock. */
export function consolePlayClockResets(def: SportDefinition | null | undefined): number[] {
  const pc = def?.playClock;
  if (!pc) return [];
  return [pc.full, pc.short].filter((n) => typeof n === 'number' && n > 0);
}

// ── what a link can do ──────────────────────────────────────────────

/** Actions the SPORT has at all, whatever the scope. */
export function sportConsoleActions(def: SportDefinition | null | undefined): Set<ConsoleAction> {
  const actions = new Set<ConsoleAction>();
  if (!def) return actions;
  // Quick-score taps only exist for integer sports. A judged sport stores a
  // SCALED total (gymnastics 195.825 → 195825), so its +1/+5/+10 would add
  // 0.001 — the operator types those totals; a link never taps them.
  if (sportHasQuickScore(def)) actions.add('score');
  if (def.clock?.type && def.clock.type !== 'none') actions.add('clock');
  actions.add('segment');
  if (sportHasTeamTimeoutStats(def)) actions.add('timeout');
  if (Array.isArray(def.celebrations) && def.celebrations.length > 0) actions.add('cue');
  if (consoleStatRules(def).length > 0) actions.add('stats');
  if (sportHasPossessionArrow(def)) actions.add('possession');
  if (def.penaltyBox && Array.isArray(def.penaltyBox.presets) && def.penaltyBox.presets.length > 0) {
    actions.add('penalties');
  }
  if (def.shotClock) actions.add('shotClock');
  if (sportHasPlayClock(def)) actions.add('playClock');
  return actions;
}

/**
 * What a link may do: its scope's grant, intersected with the sport. This is
 * the ONE answer — the API checks every route against it and the pad renders
 * only these controls.
 *
 * Sport-specific rule: in a sport with no game clock (baseball, softball,
 * volleyball, pickleball) there is no clock operator, so the SCORER owns the
 * inning / set counter as well.
 */
export function consoleAllows(scope: ConsoleScope, def: SportDefinition | null | undefined): ConsoleAction[] {
  if (!def || !isConsoleScope(scope)) return [];
  const sport = sportConsoleActions(def);
  const granted = new Set<ConsoleAction>(CONSOLE_SCOPE_ALLOWS[scope]);
  if (scope === 'scorer' && def.clock?.type === 'none') granted.add('segment');
  return CONSOLE_ACTIONS.filter((a) => granted.has(a) && sport.has(a));
}

/**
 * The scopes the operator's share sheet offers for this sport. A clock
 * operator needs a clock; a shot-clock operator needs a shot clock or a play
 * clock; a presentation link needs celebrations. `full` is never offered —
 * it is the frozen original link (`table` is "the whole table").
 */
export function consoleScopesForSport(def: SportDefinition | null | undefined): ConsoleScope[] {
  if (!def) return [];
  const scopes: ConsoleScope[] = ['table', 'scorer'];
  if (def.clock?.type && def.clock.type !== 'none') scopes.push('timer');
  if (def.shotClock || sportHasPlayClock(def)) scopes.push('shot');
  if (Array.isArray(def.celebrations) && def.celebrations.length > 0) scopes.push('presentation');
  return scopes;
}

/**
 * Whether a link of `scope` may be minted for a game of this sport: `full`
 * always (it is the mint default), anything else only when the share sheet
 * would offer it — a link that could do nothing is never handed out.
 */
export function consoleScopeMintable(scope: ConsoleScope, def: SportDefinition | null | undefined): boolean {
  if (scope === 'full') return true;
  return consoleScopesForSport(def).indexOf(scope) !== -1;
}
