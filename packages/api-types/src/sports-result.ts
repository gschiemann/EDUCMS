/**
 * VenueOS Sports — THE RESULT OF A GAME (K-12 sports launch program, lane A4,
 * 2026-09-27). Register row K12-F18 of the Codex readiness audit
 * (docs/research/2026-09-23-k12-sports-readiness-audit/): "resolve winners
 * from the sport result, not raw score columns".
 *
 * THE BUG this closes. Every surface that named a winner compared the raw
 * `homeScore` / `awayScore` columns — and in half the catalog those columns
 * are not the result:
 *  - volleyball and pickleball keep the RALLY score of the set in play there,
 *    zeroed each time a set is won. A 3–1 match ends with 0–0 in the columns,
 *    so the final board read "0–0 TIE" and the final cue said "TIED · GAME
 *    OVER" (the audit's reproduction, Chromium and WebKit);
 *  - wrestling keeps the BOUT on the mat there; a dual meet is won on TEAM
 *    points (`stats.homeTeamPoints` / `awayTeamPoints`), so the last bout's
 *    winner was crowned even when the other team won the dual;
 *  - golf (strokes) and cross-country (team places) are won by the LOWER
 *    total. Only the default board knew that; the ribbon and the final cue
 *    crowned the higher score.
 *
 * THE MODEL. `gameResult(game)` reads the game's own definition — the sport
 * with its bound rules profile applied (`sportForGame`, sports-rules.ts) — and
 * decides on the sport's result basis:
 *
 *   'sets'        a set-scored sport (the definition has a `setFormat`):
 *                 sets won (volleyball) or games won (pickleball), from
 *                 stats.homeSets / awaySets or homeGames / awayGames;
 *   'team-points' a sport with a separate team tally (`teamScore` — a
 *                 wrestling dual): the team points, not the bout;
 *   'low-score'   `lowScoreWins` (golf strokes, cross-country places): the
 *                 lower total wins, and a side with no total (0) cannot beat
 *                 a side that has one;
 *   'score'       everything else: the higher score wins (points, goals,
 *                 runs after the innings, a judged total, meet points).
 *
 * Two honest fallbacks, both named in the result's basis:
 *  - a set-scored game in which NO set has been completed is decided by the
 *    set in play (an exhibition set, a match stopped in its first set) —
 *    never reported as a 0–0 tie of sets nobody played;
 *  - a wrestling game whose team score was never used is a single bout: the
 *    bout's match points decide it.
 *
 * Before FINAL a result has a `leader` only; `winner` / `outcome` are set only
 * once the game is FINAL, so no surface can crown a team mid-game. A FINAL
 * with level totals is a TIE — except where 0–0 means nothing was recorded (a
 * meet with no points, a low-score sport with no totals, a set sport with no
 * points): that outcome is 'none', and no surface may call it a tie.
 *
 * `revision` is the game revision (Game.version, K12-F12) the result was read
 * from: a correction reopens the game, changes the row and ends it again, so
 * the corrected result is simply the result of the newer revision — there is
 * no second copy of it to keep in step.
 *
 * Pure: no DOM, no network, no clock — shared by the API (the final cue, the
 * athlete game log) and every web surface (board, ribbon, scorebug, game
 * list), and safe on Chromium 83 players.
 */
import { formatScore, type SportDefinition } from './sports';
import { sportForGame } from './sports-rules';

/** What decided the result (see the module comment). */
export type ResultBasis = 'score' | 'sets' | 'team-points' | 'low-score';

/**
 * A FINAL game's outcome: a side won, the totals are level (a real tie), or
 * nothing was recorded to decide it ('none' — never shown as a tie).
 */
export type GameOutcome = 'home' | 'away' | 'tie' | 'none';

/**
 * What a result's deciding totals count when they are NOT the score a board
 * shows all game: sets (volleyball), games (pickleball), a dual's team
 * points. Null when the totals are the score itself.
 */
export type ResultUnit = 'sets' | 'games' | 'team-points';

/** One completed set (volleyball) or game (pickleball): the points it ended on. */
export interface SetScore {
  home: number;
  away: number;
}

/** The fields of a game (a Game row, a board payload) a result is read from. */
export interface GameResultInput {
  sport?: string | null;
  rules?: unknown;
  status?: string | null;
  homeScore?: unknown;
  awayScore?: unknown;
  stats?: unknown;
  /** Game.version — carried into the result as its revision. */
  version?: unknown;
  /** The board payload's name for Game.version. */
  revision?: unknown;
}

export interface GameResult {
  /** What decided it. */
  basis: ResultBasis;
  /** The deciding totals: sets / games won, dual team points, strokes /
   *  places, or the score (a judged sport's scaled integer). */
  home: number;
  away: number;
  /** The same totals as a scoreboard prints them (a judged total's decimals). */
  homeText: string;
  awayText: string;
  /** What the totals count when they are not the score (see ResultUnit). */
  unit: ResultUnit | null;
  /** Who is ahead on the deciding totals now; null = level, or nothing to compare. */
  leader: 'home' | 'away' | null;
  /** The game is FINAL: `outcome` / `winner` are its result. */
  final: boolean;
  /** FINAL only (null before): who won, a tie, or 'none' (nothing recorded). */
  outcome: GameOutcome | null;
  /** FINAL only: the winning side; null for a tie, 'none', or a game in play. */
  winner: 'home' | 'away' | null;
  /** A set-scored game's completed sets in order — only when the recorded
   *  history accounts for every set won (a set count typed in by hand has
   *  none, and a partial list would print the wrong match). Otherwise []. */
  sets: SetScore[];
  /** The game revision the result was read from (null when not supplied). */
  revision: number | null;
}

/** The most sets / games the history keeps (best of seven, plus slack). */
export const SET_SCORES_MAX = 9;

/** stats key of the completed-set history (set-scored sports). */
export const SET_SCORES_KEY = 'setScores';

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** A finite, non-negative whole number, else 0. */
function count(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * The stats keys a set-scored sport counts won sets / games under, or null
 * for a sport that is not set-scored. Read from the definition (its stats
 * list), never from the sport key.
 */
export function setCountKeys(
  def: SportDefinition | null | undefined,
): { home: 'homeSets' | 'homeGames'; away: 'awaySets' | 'awayGames' } | null {
  if (!def?.setFormat) return null;
  if (def.stats.some((s) => s.key === 'homeSets')) return { home: 'homeSets', away: 'awaySets' };
  if (def.stats.some((s) => s.key === 'homeGames')) return { home: 'homeGames', away: 'awayGames' };
  return null;
}

/**
 * Read a stored set history. Malformed entries are dropped; the list is
 * capped at SET_SCORES_MAX. Never throws.
 */
export function readSetScores(stats: unknown): SetScore[] {
  const raw = isRecord(stats) ? stats[SET_SCORES_KEY] : undefined;
  if (!Array.isArray(raw)) return [];
  const out: SetScore[] = [];
  for (const e of raw) {
    if (!isRecord(e)) continue;
    out.push({ home: count(e.home), away: count(e.away) });
    if (out.length >= SET_SCORES_MAX) break;
  }
  return out;
}

/**
 * The set history after one more completed set — what the engine writes
 * (into `stats.setScores`) in the same write that credits the set, so an
 * undo of that write takes the entry back with the credit.
 */
export function appendSetScore(stats: unknown, home: number, away: number): SetScore[] {
  const next = [...readSetScores(stats), { home: count(home), away: count(away) }];
  return next.slice(-SET_SCORES_MAX);
}

/** Higher-wins comparison; null when level. */
function higher(home: number, away: number): 'home' | 'away' | null {
  if (home === away) return null;
  return home > away ? 'home' : 'away';
}

/**
 * Lower-wins comparison where 0 is "no total recorded": a recorded total beats
 * no total; both empty → nothing to compare.
 */
function lower(home: number, away: number): 'home' | 'away' | null {
  if (home === away) return null;
  if (home === 0) return 'away';
  if (away === 0) return 'home';
  return home < away ? 'home' : 'away';
}

/** THE result of a game — see the module comment. Never throws. */
export function gameResult(game: GameResultInput | null | undefined): GameResult {
  const def = sportForGame(game ? { sport: game.sport ?? null, rules: game.rules } : null);
  const stats = isRecord(game?.stats) ? game!.stats : {};
  const final = game?.status === 'FINAL';
  const scoreHome = count(game?.homeScore);
  const scoreAway = count(game?.awayScore);
  const rev = game?.version ?? game?.revision;
  const revision = typeof rev === 'number' && Number.isFinite(rev) ? rev : null;

  let basis: ResultBasis = 'score';
  let unit: ResultUnit | null = null;
  let home = scoreHome;
  let away = scoreAway;
  let sets: SetScore[] = [];
  // 0–0 on the deciding totals is a real tie (a 0–0 soccer draw) unless the
  // sport's zero means "nothing was recorded".
  let zeroMeansNothing = def?.mode === 'LEADERBOARD';

  const setKeys = setCountKeys(def);
  if (setKeys) {
    const homeSets = count(stats[setKeys.home]);
    const awaySets = count(stats[setKeys.away]);
    if (homeSets + awaySets > 0) {
      basis = 'sets';
      unit = setKeys.home === 'homeGames' ? 'games' : 'sets';
      home = homeSets;
      away = awaySets;
      const history = readSetScores(stats);
      sets = history.length === homeSets + awaySets ? history : [];
    }
    // No completed set: the set in play decides (basis stays 'score'); with
    // no points either, nothing was played.
    zeroMeansNothing = true;
  } else if (def?.teamScore) {
    const homeTeam = count(stats[def.teamScore.homeKey]);
    const awayTeam = count(stats[def.teamScore.awayKey]);
    if (homeTeam + awayTeam > 0) {
      basis = 'team-points';
      unit = 'team-points';
      home = homeTeam;
      away = awayTeam;
    }
    // A dual with no team points and no bout points recorded nothing.
    zeroMeansNothing = true;
  } else if (def?.lowScoreWins) {
    basis = 'low-score';
    zeroMeansNothing = true;
  }

  const leader = basis === 'low-score' ? lower(home, away) : higher(home, away);
  let outcome: GameOutcome | null = null;
  if (final) {
    if (leader) outcome = leader;
    else outcome = home === 0 && away === 0 && zeroMeansNothing ? 'none' : 'tie';
  }
  // Sets, games and team points are whole numbers; only a judged score
  // carries decimals.
  const text = (n: number) => (basis === 'score' || basis === 'low-score' ? formatScore(def, n) : String(n));
  return {
    basis,
    home,
    away,
    homeText: text(home),
    awayText: text(away),
    unit,
    leader,
    final,
    outcome,
    winner: outcome === 'home' || outcome === 'away' ? outcome : null,
    sets,
    revision,
  };
}

/**
 * The status-transition cue key of a FINAL result — what the API writes when
 * a game ends and the ribbon / board read. `status:final-none` is new with
 * K12-F18: a FINAL that recorded nothing is never announced as a tie.
 */
export function finalCueKey(result: Pick<GameResult, 'outcome'>): string {
  switch (result.outcome) {
    case 'home':
      return 'status:final-home';
    case 'away':
      return 'status:final-away';
    case 'tie':
      return 'status:final-tie';
    default:
      return 'status:final-none';
  }
}
