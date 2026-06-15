import { Injectable } from '@nestjs/common';
import {
  PLAYER_STATS,
  STAT_SEMANTICS,
  statSemantic,
  parseStatValue,
} from '@cms/api-types';
import type { StatSemantic } from '@cms/api-types';

/**
 * VenueOS Sports — Phase 1-A of the player-stats engine.
 *
 * PURE, READ-ONLY computation of the two player surfaces the board
 * consumes — **stat leaders** and an auto **player-of-the-game** — from
 * the per-game `roster[]` that `getBoardFresh` ALREADY loads. There is
 * NO DB query here, NO persistence, NO migration: every input is the
 * roster row shape the board cache already has in hand once per second.
 *
 * FAIL-SAFE INVARIANT (spec §4): nothing in this file may throw on the
 * live game path. `computePlayerSurfaces` wraps its whole body in
 * try/catch and returns the empty result `{ leaders: [], playerOfGame:
 * null }` on any error — a bug here must never break the board.
 *
 * The output shapes are the LOCKED contract that the board / scorebug /
 * console render agents consume (B/C/D). Keep them in sync with the
 * `getBoardFresh` payload delta in `sports.service.ts`.
 */

/** A single roster row exactly as `getBoardFresh` selects it. */
export interface RosterRow {
  id: string;
  team: string; // 'home' | 'away' (free-text column; normalized below)
  name: string;
  number: string | null;
  position: string | null;
  photoUrl: string | null;
  /** Flexible display-string map, e.g. `{ PTS: "24", AVG: ".312" }`. */
  stats: unknown;
}

/** One stat leader — the top roster player for a single stat key. */
export interface Leader {
  statKey: string;
  label: string;
  team: 'home' | 'away';
  playerName: string;
  playerNumber: string | null;
  photoUrl: string | null;
  /** The player's ORIGINAL display string, NOT the parsed number. */
  value: string;
}

/** The auto-computed player of the game, shaped for the SpotlightBand. */
export interface PlayerOfGame {
  name: string;
  number: string | null;
  team: 'home' | 'away';
  photoUrl: string | null;
  headline: string;
  lines: Array<{ label: string; value: string }>;
}

export interface PlayerSurfaces {
  leaders: Leader[];
  playerOfGame: PlayerOfGame | null;
}

/**
 * Human-readable label for a stat key. `PLAYER_STATS[sport]` carries
 * only the short keys (e.g. `PTS`) and the api-types label helper is
 * not exported, so we keep a local lookup here and fall back to the
 * raw key when unknown. Board surfaces show this; `statKey` carries the
 * machine key for any keyed rendering.
 */
const STAT_LABELS: Record<string, string> = {
  PTS: 'Points',
  YDS: 'Yards',
  TD: 'Touchdowns',
  TKL: 'Tackles',
  REC: 'Receptions',
  INT: 'Interceptions',
  REB: 'Rebounds',
  AST: 'Assists',
  STL: 'Steals',
  BLK: 'Blocks',
  H: 'Hits',
  HR: 'Home Runs',
  RBI: 'RBI',
  R: 'Runs',
  SB: 'Stolen Bases',
  AVG: 'Avg',
  G: 'Goals',
  A: 'Assists',
  SH: 'Shots',
  SV: 'Saves',
  SOG: 'Shots on Goal',
  K: 'Kills',
  DIG: 'Digs',
  ACE: 'Aces',
  W: 'Wins',
  L: 'Losses',
  PIN: 'Pins',
  GB: 'Ground Balls',
  ST: 'Steals',
  EXC: 'Exclusions',
  PIM: 'Penalty Min',
  HOLE: 'Holes Won',
  STR: 'Strokes',
  PAR: 'To Par',
  PL: 'Place',
  PR: 'PR',
  MK: 'Mark',
  TIME: 'Time',
  VT: 'Vault',
  UB: 'Uneven Bars',
  BB: 'Balance Beam',
  FX: 'Floor',
  RND: 'Round',
};

function labelFor(key: string): string {
  return STAT_LABELS[key] ?? key;
}

/**
 * Player-of-the-game weights, per sport, per stat key. The marquee
 * scoring stat is weighted highest; supporting stats carry sensible
 * lighter weights. A weighted sum of each player's parsed stats (each
 * normalized for higher-is-better) yields the POTG score.
 *
 * Sports / keys absent here fall back to a default weight of 1.0 for
 * any `counting` higher-is-better stat (rate / lower-is-better stats
 * are skipped in the POTG score so we never reward losses, strokes,
 * places, or slow times).
 */
const POTG_WEIGHTS: Record<string, Record<string, number>> = {
  football: { TD: 6, YDS: 0.05, REC: 1, INT: 4, TKL: 1.5 },
  basketball: { PTS: 1, REB: 1.2, AST: 1.5, STL: 2, BLK: 2 },
  baseball: { HR: 4, RBI: 2, H: 1.5, R: 1.5, SB: 1.5 },
  softball: { HR: 4, RBI: 2, H: 1.5, R: 1.5, SB: 1.5 },
  soccer: { G: 5, A: 3, SH: 0.5, SV: 1.5 },
  volleyball: { K: 2, AST: 1.5, DIG: 1.5, BLK: 2, ACE: 2.5 },
  wrestling: { W: 4, PIN: 5, TD: 1.5 },
  hockey: { G: 5, A: 3, PTS: 1, SOG: 0.5 },
  lacrosse: { G: 5, A: 3, GB: 1, SH: 0.5 },
  field_hockey: { G: 5, A: 3, SH: 0.5, SV: 1.5 },
  water_polo: { G: 5, A: 3, ST: 1.5 },
  pickleball: { W: 4, PTS: 1 },
  track_and_field: { PTS: 2, PR: 3 },
  swimming_diving: { PTS: 2, PR: 3 },
  cross_country: { PR: 3 },
  gymnastics: { PTS: 3, VT: 1, UB: 1, BB: 1, FX: 1 },
  golf: { HOLE: 2, W: 4 },
  competitive_cheer: { PTS: 3, RND: 1 },
};

/** Default weight for an unlisted higher-is-better counting stat. */
const DEFAULT_POTG_WEIGHT = 1.0;

/** Normalize the free-text `team` column to the contract union. */
function normTeam(team: string): 'home' | 'away' {
  return team === 'away' ? 'away' : 'home';
}

/** Safe accessor for a player's display string for a stat key. */
function rawStat(stats: unknown, key: string): string | null {
  if (!stats || typeof stats !== 'object') return null;
  const v = (stats as Record<string, unknown>)[key];
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * PURE: compute the board's player surfaces (stat leaders + auto
 * player-of-the-game) from a sport key and the already-loaded roster.
 *
 * Returns `{ leaders: [], playerOfGame: null }` when there is no
 * roster, no classified sport, or no parseable stat — and on ANY
 * thrown error (fail-open). The caller OMITS the keys entirely when
 * the result is empty so the flag-off / empty payload is byte-identical.
 */
export function computePlayerSurfaces(
  sport: string,
  roster: readonly RosterRow[] | null | undefined,
): PlayerSurfaces {
  const empty: PlayerSurfaces = { leaders: [], playerOfGame: null };
  try {
    if (!sport || !Array.isArray(roster) || roster.length === 0) return empty;

    const keys = PLAYER_STATS[sport];
    const sems = STAT_SEMANTICS[sport];
    if (!keys || !sems) return empty;

    // ── Leaders: one per stat key with any parseable, non-null value ──
    const leaders: Leader[] = [];
    for (const key of keys) {
      const sem: StatSemantic | undefined = statSemantic(sport, key);
      let best: RosterRow | null = null;
      let bestVal: number | null = null;
      let bestRaw = '';
      for (const p of roster) {
        const raw = rawStat(p.stats, key);
        if (raw == null) continue;
        const val = parseStatValue(raw, sem);
        if (val == null) continue;
        if (
          bestVal == null ||
          (sem?.higherBetter === false ? val < bestVal : val > bestVal)
        ) {
          best = p;
          bestVal = val;
          bestRaw = raw;
        }
      }
      if (best && bestVal != null) {
        leaders.push({
          statKey: key,
          label: labelFor(key),
          team: normTeam(best.team),
          playerName: best.name,
          playerNumber: best.number ?? null,
          photoUrl: best.photoUrl ?? null,
          value: bestRaw,
        });
      }
    }

    // ── Player of the game: weighted score across the roster ──
    const weights = POTG_WEIGHTS[sport] ?? {};
    let topPlayer: RosterRow | null = null;
    let topScore = -Infinity;
    for (const p of roster) {
      let score = 0;
      let counted = 0;
      for (const key of keys) {
        const sem = statSemantic(sport, key);
        // Skip lower-is-better stats entirely — never reward losses,
        // strokes, places, penalty minutes, or slow times in the POTG.
        if (sem?.higherBetter === false) continue;
        const raw = rawStat(p.stats, key);
        if (raw == null) continue;
        const val = parseStatValue(raw, sem);
        if (val == null) continue;
        const w =
          weights[key] ??
          (sem?.kind === 'counting' ? DEFAULT_POTG_WEIGHT : 0);
        if (w === 0) continue;
        score += val * w;
        counted += 1;
      }
      if (counted > 0 && score > topScore) {
        topScore = score;
        topPlayer = p;
      }
    }

    let playerOfGame: PlayerOfGame | null = null;
    if (topPlayer && topScore > -Infinity) {
      // Build the player's top 2-3 stat lines (by weighted contribution,
      // then by raw magnitude) for the spotlight body.
      const tp = topPlayer;
      const ranked: Array<{ key: string; val: number; raw: string; w: number }> = [];
      for (const key of keys) {
        const sem = statSemantic(sport, key);
        if (sem?.higherBetter === false) continue;
        const raw = rawStat(tp.stats, key);
        if (raw == null) continue;
        const val = parseStatValue(raw, sem);
        if (val == null) continue;
        const w =
          weights[key] ??
          (sem?.kind === 'counting' ? DEFAULT_POTG_WEIGHT : 0);
        ranked.push({ key, val, raw, w });
      }
      ranked.sort((a, b) => b.val * b.w - a.val * a.w || b.val - a.val);
      const lines = ranked
        .slice(0, 3)
        .map((r) => ({ label: labelFor(r.key), value: r.raw }));

      // Only spotlight a player who actually has a stat line to show.
      if (lines.length > 0) {
        const headline = lines
          .map((l) => `${l.value} ${l.label}`)
          .join(' · ');
        playerOfGame = {
          name: tp.name,
          number: tp.number ?? null,
          team: normTeam(tp.team),
          photoUrl: tp.photoUrl ?? null,
          headline,
          lines,
        };
      }
    }

    return { leaders, playerOfGame };
  } catch {
    // Fail-open — a bug here must NEVER break the board.
    return empty;
  }
}

/**
 * Thin injectable wrapper so the service is available via Nest DI if a
 * later phase needs it; the computation itself is the exported pure fn
 * above (called directly from the board cache build to avoid any
 * per-request injection overhead on the hot poll).
 */
@Injectable()
export class SportsStatsService {
  computePlayerSurfaces(
    sport: string,
    roster: readonly RosterRow[] | null | undefined,
  ): PlayerSurfaces {
    return computePlayerSurfaces(sport, roster);
  }
}
