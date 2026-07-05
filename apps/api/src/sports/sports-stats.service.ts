import { Injectable } from '@nestjs/common';
import {
  PLAYER_STATS,
  STAT_SEMANTICS,
  statSemantic,
  parseStatValue,
} from '@cms/api-types';
import type { StatSemantic } from '@cms/api-types';
import type { PrismaClient, Prisma } from '@cms/database';
import { withDbRetry } from '../prisma/with-db-retry';

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
  // Diving (2026-07-01 split from swimming_diving).
  SCORE: 'Dive Score',
  DD: 'Degree of Difficulty',
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
  // DEPRECATED — see the SWIMMING_DIVING const in @cms/api-types. Kept for
  // pre-split games; `swimming` / `diving` below are the current sports.
  swimming_diving: { PTS: 2, PR: 3 },
  swimming: { PTS: 2, PR: 3 },
  // SCORE (a rate stat, not counting) is diving's marquee number — give it
  // an explicit weight so it isn't silently zeroed by the counting-only
  // DEFAULT_POTG_WEIGHT fallback.
  diving: { PTS: 2, SCORE: 3 },
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

/**
 * Safe accessor for a player's display string for a stat key.
 *
 * 2026-06-25 — alias-aware lookup. PLAYER_STATS carries SHORT codes
 * (e.g. 'G','A','ST') but rosters seeded/imported via CSV store the
 * LONG, lowercased label form (e.g. 'goals','assists','steals'); a
 * direct lookup then misses every stat and the board's leaders +
 * auto Player-of-Game come back empty. We resolve the short key to
 * its stored form via the stat's OWN human label (STAT_LABELS) plus a
 * case/space/underscore-insensitive scan, so 'G' also finds 'goals'.
 *
 * SAFETY: candidates are derived ONLY from the key itself and its own
 * label — never a cross-stat synonym — so a genuine mismatch yields
 * null (the prior behavior), never another stat's value. (E.g. water
 * polo stores 'drawn' = exclusions DRAWN, a different stat than the
 * model's 'EXC' = exclusions committed; it correctly stays unmatched
 * rather than showing a wrong, inverted-semantics leader.) Rosters
 * that already store the short key hit the fast exact path first.
 */
function rawStat(stats: unknown, key: string): string | null {
  if (!stats || typeof stats !== 'object') return null;
  const obj = stats as Record<string, unknown>;
  let v = obj[key];
  if (v == null) {
    const cands = new Set<string>([key.toLowerCase()]);
    const label = STAT_LABELS[key];
    if (label) {
      const l = label.toLowerCase();
      cands.add(l);
      cands.add(l.replace(/[\s_]+/g, ''));
    }
    for (const [k, val] of Object.entries(obj)) {
      const kl = k.toLowerCase();
      if (cands.has(kl) || cands.has(kl.replace(/[\s_]+/g, ''))) { v = val; break; }
    }
  }
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

// ════════════════════════════════════════════════════════════════════
// PHASE 2 — Persistent season/career AGGREGATION engine
// ════════════════════════════════════════════════════════════════════
//
// Phase 1 above is PURE + read-only (no DB). The functions below are the
// finalize-time persistence layer (spec §PHASE 2): when a game goes
// FINAL, roll each LINKED roster player's per-game COUNTING stats up into
// the materialized `PlayerSeasonStat` / `PlayerCareerStat` tables that the
// cross-game leaderboard endpoints read.
//
// Load-bearing invariants (spec C8 + §PHASE 2 verification):
//   • tenantId-scoped on EVERY query.
//   • Only `kind:'counting'` stats aggregate. Rate stats (AVG, judged
//     scores, golf PAR, race marks) are per-game — NEVER summed.
//   • Only roster rows WHERE personId != null aggregate. Unlinked rows
//     (opponents, typos, one-offs) are ignored so they never pollute the
//     persistent tables.
//   • IDEMPOTENT: a per-game marker (`game.stats.statsFinalizedAt`),
//     checked AND set inside the same transaction, makes re-FINAL a
//     no-op — re-running finalize must NOT double-count.
//   • The whole roll-up runs in ONE `$transaction` wrapped in
//     `withDbRetry` (transient pool blips retried; logic errors thrown).
//   • FAIL-OPEN is the CALLER's job (the setStatus hook wraps this in
//     try/catch so a stats bug never blocks "end game"). This fn may
//     throw on a real DB error; it's safe to call and validates inputs.
//
// The reads (`getStatLeaders` / `getAthleteCareer`) hit the indexed
// aggregate tables — fast, never the GameEvent stream, never on the poll.

/** Marker key stamped into `Game.stats` once a game's stats are rolled up. */
const STATS_FINALIZED_MARKER = 'statsFinalizedAt';

/**
 * One cross-game leaderboard row — a persistent person's MATERIALIZED
 * aggregate for a single stat. NOTE: distinct from the Phase 1 `Leader`
 * (the per-game, in-memory top-roster-player shape) — this one carries
 * the persistent `personId` + the rolled-up numeric `statValue`. The
 * spec's `getStatLeaders(): Promise<Leader[]>` maps to `StatLeader[]`
 * here (the name `Leader` is already taken by Phase 1 in this file).
 */
export interface StatLeader {
  personId: string;
  fullName: string;
  number: string | null;
  photoUrl: string | null;
  teamId: string | null;
  statKey: string;
  statValue: number;
  displayValue: string | null;
  gamesPlayed: number;
}

/** A persistent athlete's full season+career line, for the career page. */
export interface AthleteCareer {
  personId: string;
  fullName: string;
  number: string | null;
  position: string | null;
  photoUrl: string | null;
  teamId: string | null;
  gradYear: number | null;
  season: Array<{
    season: string;
    statKey: string;
    statValue: number;
    displayValue: string | null;
    gamesPlayed: number;
  }>;
  career: Array<{
    statKey: string;
    statValue: number;
    displayValue: string | null;
    gamesPlayed: number;
  }>;
}

/**
 * Normalize a person/team display name for find-or-create dedup —
 * lowercase + collapse internal whitespace + trim. Mirrors the
 * `normalizedKey` contract on `SportsPerson` (the CSV-reimport dedup key).
 */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Format an aggregated numeric value back into a display string for the
 * materialized `displayValue` column. Counting stats are integers (the
 * only kind we aggregate), so this rounds to the semantic's `decimals`
 * (default 0). Kept local — api-types ships no formatter.
 */
function formatStatValue(value: number, sem?: StatSemantic): string {
  const decimals = sem?.decimals ?? 0;
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(decimals);
}

/**
 * Derive the season string for a game. Game has no `season` column, so
 * we key off the calendar year the game was played:
 *   startedAt (when the game actually went LIVE) → "YYYY"
 *   else createdAt → "YYYY"
 *   else the current year → "YYYY"
 * Simple + stable: a finalize and a re-finalize derive the SAME season,
 * and leaderboards can filter by it. A richer "2025-26" academic-season
 * string is a future refinement (would need a Game.season column).
 */
export function deriveSeason(game: {
  startedAt?: Date | null;
  createdAt?: Date | null;
  season?: string | null;
}): string {
  // S3 (2026-06-22): prefer an explicit season if a caller ever sets one; else
  // derive an ACADEMIC "YYYY-YY" string (Aug→Jul) so a winter sport played
  // Dec–Mar stays in ONE season bucket instead of splitting across the New
  // Year. Same signature contract: a finalize and re-finalize derive the SAME
  // season string, and leaderboards filter by it.
  if (game.season && String(game.season).trim()) return String(game.season).trim();
  const raw = game.startedAt ?? game.createdAt ?? new Date();
  const d = raw instanceof Date && !Number.isNaN(raw.getTime()) ? raw : new Date();
  // getMonth() is 0-indexed; >= 7 means August or later → the academic year
  // that STARTS this calendar year. Jan–Jul belongs to the year that started
  // the previous August.
  const startYear = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * Link a per-game `RosterPlayer` to a persistent `SportsPerson`
 * (OUR-team-only, manual — opponents/typos never get persisted). Two paths:
 *
 *   • `personId` given → set `RosterPlayer.personId` directly (operator
 *     picked an existing athlete).
 *   • else `fullName` given → find-or-create a `SportsPerson` by
 *     `normalizedKey` within `(tenantId, teamId)` using the
 *     `tenant_person_identity` unique, then link.
 *
 * tenantId-scoped throughout: the roster row, the target person, and the
 * created person all carry/verify the tenantId. Returns the linked
 * `personId`.
 */
export async function linkRosterPlayerToPerson(
  prisma: PrismaClient,
  args: {
    tenantId: string;
    rosterPlayerId: string;
    personId?: string;
    fullName?: string;
    teamId?: string;
  },
): Promise<{ personId: string }> {
  const { tenantId, rosterPlayerId } = args;
  if (!tenantId) throw new Error('linkRosterPlayerToPerson: tenantId required');
  if (!rosterPlayerId)
    throw new Error('linkRosterPlayerToPerson: rosterPlayerId required');

  // Ownership gate — the roster row must belong to this tenant.
  const roster = await withDbRetry(
    () =>
      prisma.rosterPlayer.findFirst({
        where: { id: rosterPlayerId, tenantId },
        select: { id: true, name: true, number: true, photoUrl: true, position: true },
      }),
    { label: 'sports-stats.link.roster.find' },
  );
  if (!roster) {
    throw new Error(
      `linkRosterPlayerToPerson: roster player ${rosterPlayerId} not found for tenant`,
    );
  }

  // Path 1 — explicit personId. Verify it's this tenant's person.
  if (args.personId) {
    const person = await withDbRetry(
      () =>
        prisma.sportsPerson.findFirst({
          where: { id: args.personId, tenantId },
          select: { id: true },
        }),
      { label: 'sports-stats.link.person.find' },
    );
    if (!person) {
      throw new Error(
        `linkRosterPlayerToPerson: person ${args.personId} not found for tenant`,
      );
    }
    await withDbRetry(
      () =>
        prisma.rosterPlayer.update({
          where: { id: rosterPlayerId },
          data: { personId: person.id, teamId: args.teamId ?? undefined },
        }),
      { label: 'sports-stats.link.roster.update' },
    );
    return { personId: person.id };
  }

  // Path 2 — find-or-create by normalizedKey within (tenantId, teamId).
  const fullName = (args.fullName ?? roster.name ?? '').trim();
  if (!fullName) {
    throw new Error(
      'linkRosterPlayerToPerson: fullName (or a named roster row) required to find-or-create a person',
    );
  }
  const normalizedKey = normalizeName(fullName);
  const teamId = args.teamId ?? null;

  // Find-or-create by the dedup identity (tenantId, teamId, normalizedKey).
  // NOTE: the `tenant_person_identity` unique also includes the nullable
  // `gradYear`. We intentionally do NOT `upsert` on the named compound
  // unique here, because Postgres treats NULLs as DISTINCT in a unique
  // index — an upsert keyed on `gradYear: null` would not reliably match
  // an existing null-gradYear row and could spawn duplicates. A manual
  // link has no class year, so we find-or-create on the (tenant, team,
  // name) triple with a null gradYear and let the unique guard genuine
  // collisions.
  let person = await withDbRetry(
    () =>
      prisma.sportsPerson.findFirst({
        where: { tenantId, teamId, normalizedKey, gradYear: null },
        select: { id: true },
      }),
    { label: 'sports-stats.link.person.find2' },
  );
  if (!person) {
    person = await withDbRetry(
      () =>
        prisma.sportsPerson.create({
          data: {
            tenantId,
            teamId,
            fullName,
            normalizedKey,
            number: roster.number ?? undefined,
            position: roster.position ?? undefined,
            photoUrl: roster.photoUrl ?? undefined,
          },
          select: { id: true },
        }),
      { label: 'sports-stats.link.person.create' },
    );
  }

  await withDbRetry(
    () =>
      prisma.rosterPlayer.update({
        where: { id: rosterPlayerId },
        data: { personId: person.id, teamId: teamId ?? undefined },
      }),
    { label: 'sports-stats.link.roster.update2' },
  );

  return { personId: person.id };
}

/**
 * Finalize a game's player stats: roll each LINKED roster player's
 * per-game COUNTING stats into the persistent season + career aggregates.
 * Called by the setStatus(FINAL) hook (another agent), AFTER the status
 * commit, wrapped by the caller in try/catch (fail-open).
 *
 * Idempotent via the `game.stats.statsFinalizedAt` marker (checked + set
 * inside the same transaction): re-FINAL returns
 * `{ aggregated: 0, skipped: 'already-finalized' }` and double-counts
 * nothing. Multi-replica safe — two concurrent finalizes converge: the
 * first to commit the marker wins, the second sees the marker and no-ops.
 *
 * @returns `{ aggregated }` — count of distinct LINKED players rolled up.
 *          `{ aggregated: 0, skipped }` when nothing was done.
 */
export async function finalizeGameStats(
  prisma: PrismaClient,
  tenantId: string,
  gameId: string,
): Promise<{ aggregated: number; skipped?: string }> {
  if (!tenantId) throw new Error('finalizeGameStats: tenantId required');
  if (!gameId) throw new Error('finalizeGameStats: gameId required');

  return withDbRetry(
    () =>
      prisma.$transaction(async (tx) => {
        // Load the game tenant-scoped. Missing/cross-tenant → skip.
        const game = await tx.game.findFirst({
          where: { id: gameId, tenantId },
          select: {
            id: true,
            sport: true,
            stats: true,
            startedAt: true,
            createdAt: true,
          },
        });
        if (!game) return { aggregated: 0, skipped: 'game-not-found' };

        // ── Idempotency guard (inside the tx) ──
        const stats =
          game.stats && typeof game.stats === 'object' && !Array.isArray(game.stats)
            ? (game.stats as Record<string, unknown>)
            : {};
        if (stats[STATS_FINALIZED_MARKER]) {
          return { aggregated: 0, skipped: 'already-finalized' };
        }

        const sport = game.sport;
        const season = deriveSeason(game);

        // Only LINKED roster rows (personId != null) aggregate.
        const roster = await tx.rosterPlayer.findMany({
          where: { gameId, tenantId, personId: { not: null } },
          select: { personId: true, teamId: true, stats: true },
        });

        let aggregated = 0;

        for (const rp of roster) {
          const personId = rp.personId;
          if (!personId) continue; // narrow (where already guards)

          // Build this player's parsed COUNTING deltas for this game.
          const deltas: Array<{ statKey: string; delta: number; sem?: StatSemantic }> = [];
          for (const key of PLAYER_STATS[sport] ?? []) {
            const sem = statSemantic(sport, key);
            // ONLY counting stats accumulate. Rate stats (AVG, judged
            // scores, PAR, marks) are per-game — never summed.
            if (sem?.kind !== 'counting') continue;
            // Alias-aware read (2026-06-25 parity with the live board): the
            // model carries SHORT codes (e.g. 'G','A','ST') but CSV/seed
            // rosters store the LONG lowercased label form ('goals',
            // 'assists','steals'). A direct `rp.stats[key]` then misses every
            // stat and career/season totals roll up empty. Route through the
            // SAME `rawStat` accessor `computePlayerSurfaces` uses so both
            // surfaces resolve identically. SAFETY: `rawStat` only matches the
            // key or its own label, never a cross-stat synonym — worst case is
            // a miss (prior behavior), never another stat's value.
            const rawVal = rawStat(rp.stats, key);
            if (rawVal == null) continue;
            const parsed = parseStatValue(rawVal, sem);
            if (parsed == null) continue; // unparseable → skip, never throw
            deltas.push({ statKey: key, delta: parsed, sem });
          }

          // A linked player with no parseable counting stat this game
          // still "played" — but with nothing to roll up there's no row
          // to touch, so they don't count toward `aggregated` and don't
          // get a gamesPlayed bump (no row exists to bump). This keeps
          // gamesPlayed = games that contributed to that stat row.
          if (deltas.length === 0) continue;

          aggregated += 1;

          for (const { statKey, delta, sem } of deltas) {
            // ── SEASON upsert: ADD the delta ──
            const existingSeason = await tx.playerSeasonStat.findUnique({
              where: {
                person_season_stat: { personId, season, statKey, sport },
              },
              select: { statValue: true, gamesPlayed: true },
            });
            const newSeasonValue = (existingSeason?.statValue ?? 0) + delta;
            const newSeasonGames = (existingSeason?.gamesPlayed ?? 0) + 1;

            await tx.playerSeasonStat.upsert({
              where: {
                person_season_stat: { personId, season, statKey, sport },
              },
              update: {
                statValue: newSeasonValue,
                gamesPlayed: newSeasonGames,
                displayValue: formatStatValue(newSeasonValue, sem),
                lastGameId: gameId,
                teamId: rp.teamId ?? undefined,
              },
              create: {
                tenantId,
                personId,
                teamId: rp.teamId ?? undefined,
                sport,
                season,
                statKey,
                statValue: newSeasonValue,
                gamesPlayed: newSeasonGames,
                displayValue: formatStatValue(newSeasonValue, sem),
                lastGameId: gameId,
              },
            });

            // ── CAREER recompute: SUM all of this person's season rows
            //    for this statKey IN THIS SPORT (canonical — converges even if
            //    a season row is later corrected). MUST be sport-scoped: a
            //    SportsPerson can play multiple sports whose PLAYER_STATS codes
            //    collide (AST/PTS/G/A…); without the `sport` filter a multi-sport
            //    athlete's career total would sum unrelated sports' same-code
            //    stats into one figure (the same merge the unique-key fix closes
            //    on the write side). ──
            const seasonRows = await tx.playerSeasonStat.findMany({
              where: { personId, statKey, sport },
              select: { statValue: true, gamesPlayed: true },
            });
            const careerValue = seasonRows.reduce((s, r) => s + r.statValue, 0);
            const careerGames = seasonRows.reduce((s, r) => s + r.gamesPlayed, 0);

            await tx.playerCareerStat.upsert({
              where: { person_career_stat: { personId, statKey, sport } },
              update: {
                statValue: careerValue,
                gamesPlayed: careerGames,
                displayValue: formatStatValue(careerValue, sem),
                lastGameId: gameId,
                teamId: rp.teamId ?? undefined,
              },
              create: {
                tenantId,
                personId,
                teamId: rp.teamId ?? undefined,
                sport,
                statKey,
                statValue: careerValue,
                gamesPlayed: careerGames,
                displayValue: formatStatValue(careerValue, sem),
                lastGameId: gameId,
              },
            });
          }
        }

        // ── Stamp the idempotency marker (same tx) ──
        // Merge into the existing stats JSON so we never clobber the
        // operator's live stat values.
        await tx.game.update({
          where: { id: gameId },
          data: {
            stats: {
              ...stats,
              [STATS_FINALIZED_MARKER]: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });

        return { aggregated };
      }),
    { label: 'sports-stats.finalizeGameStats' },
  );
}

/**
 * Read the cross-game leaderboard for a stat from the MATERIALIZED
 * aggregate tables (never the GameEvent stream — fast + indexed). Honors
 * `higherBetter` from STAT_SEMANTICS when ordering.
 *
 * @param scope 'SEASON' reads `PlayerSeasonStat` (season required — falls
 *   back to all-seasons if omitted); 'CAREER' reads `PlayerCareerStat`.
 */
export async function getStatLeaders(
  prisma: PrismaClient,
  args: {
    tenantId: string;
    sport: string;
    season?: string;
    statKey: string;
    scope: 'SEASON' | 'CAREER';
    limit: number;
  },
): Promise<StatLeader[]> {
  const { tenantId, sport, season, statKey, scope } = args;
  if (!tenantId) throw new Error('getStatLeaders: tenantId required');
  if (!sport || !statKey) throw new Error('getStatLeaders: sport + statKey required');

  const limit = Math.max(1, Math.min(args.limit || 10, 100));
  const sem = statSemantic(sport, statKey);
  const order: Prisma.SortOrder = sem?.higherBetter === false ? 'asc' : 'desc';

  if (scope === 'CAREER') {
    const rows = await withDbRetry(
      () =>
        prisma.playerCareerStat.findMany({
          where: { tenantId, sport, statKey },
          orderBy: { statValue: order },
          take: limit,
          select: {
            personId: true,
            teamId: true,
            statKey: true,
            statValue: true,
            displayValue: true,
            gamesPlayed: true,
            person: {
              select: { fullName: true, number: true, photoUrl: true },
            },
          },
        }),
      { label: 'sports-stats.leaders.career' },
    );
    return rows.map((r) => ({
      personId: r.personId,
      fullName: r.person?.fullName ?? '',
      number: r.person?.number ?? null,
      photoUrl: r.person?.photoUrl ?? null,
      teamId: r.teamId ?? null,
      statKey: r.statKey,
      statValue: r.statValue,
      displayValue: r.displayValue ?? null,
      gamesPlayed: r.gamesPlayed,
    }));
  }

  // SEASON scope.
  const rows = await withDbRetry(
    () =>
      prisma.playerSeasonStat.findMany({
        where: {
          tenantId,
          sport,
          statKey,
          ...(season ? { season } : {}),
        },
        orderBy: { statValue: order },
        take: limit,
        select: {
          personId: true,
          teamId: true,
          statKey: true,
          statValue: true,
          displayValue: true,
          gamesPlayed: true,
          person: {
            select: { fullName: true, number: true, photoUrl: true },
          },
        },
      }),
    { label: 'sports-stats.leaders.season' },
  );
  return rows.map((r) => ({
    personId: r.personId,
    fullName: r.person?.fullName ?? '',
    number: r.person?.number ?? null,
    photoUrl: r.person?.photoUrl ?? null,
    teamId: r.teamId ?? null,
    statKey: r.statKey,
    statValue: r.statValue,
    displayValue: r.displayValue ?? null,
    gamesPlayed: r.gamesPlayed,
  }));
}

/**
 * Read one athlete's full materialized stat line — every season row + the
 * career roll-up — for the athlete career endpoint. tenantId-scoped (a
 * cross-tenant personId returns null). Reads the aggregate tables only.
 */
export async function getAthleteCareer(
  prisma: PrismaClient,
  args: { tenantId: string; personId: string },
): Promise<AthleteCareer | null> {
  const { tenantId, personId } = args;
  if (!tenantId) throw new Error('getAthleteCareer: tenantId required');
  if (!personId) throw new Error('getAthleteCareer: personId required');

  const person = await withDbRetry(
    () =>
      prisma.sportsPerson.findFirst({
        where: { id: personId, tenantId },
        select: {
          id: true,
          fullName: true,
          number: true,
          position: true,
          photoUrl: true,
          teamId: true,
          gradYear: true,
        },
      }),
    { label: 'sports-stats.career.person' },
  );
  if (!person) return null;

  const [seasonRows, careerRows] = await withDbRetry(
    () =>
      Promise.all([
        prisma.playerSeasonStat.findMany({
          where: { tenantId, personId },
          orderBy: [{ season: 'desc' }, { statKey: 'asc' }],
          select: {
            season: true,
            statKey: true,
            statValue: true,
            displayValue: true,
            gamesPlayed: true,
          },
        }),
        prisma.playerCareerStat.findMany({
          where: { tenantId, personId },
          orderBy: { statKey: 'asc' },
          select: {
            statKey: true,
            statValue: true,
            displayValue: true,
            gamesPlayed: true,
          },
        }),
      ]),
    { label: 'sports-stats.career.stats' },
  );

  return {
    personId: person.id,
    fullName: person.fullName,
    number: person.number ?? null,
    position: person.position ?? null,
    photoUrl: person.photoUrl ?? null,
    teamId: person.teamId ?? null,
    gradYear: person.gradYear ?? null,
    season: seasonRows.map((r) => ({
      season: r.season,
      statKey: r.statKey,
      statValue: r.statValue,
      displayValue: r.displayValue ?? null,
      gamesPlayed: r.gamesPlayed,
    })),
    career: careerRows.map((r) => ({
      statKey: r.statKey,
      statValue: r.statValue,
      displayValue: r.displayValue ?? null,
      gamesPlayed: r.gamesPlayed,
    })),
  };
}

/** One chronological row in an athlete's game log (S2). */
export interface AthleteGameLogEntry {
  gameId: string;
  date: string | null; // ISO of game start (or createdAt fallback)
  sport: string;
  opponent: string;
  homeAway: 'home' | 'away';
  teamScore: number | null;
  opponentScore: number | null;
  result: 'W' | 'L' | 'T' | null;
  /** This game's stat line for the athlete (the persisted per-game JSON). */
  stats: Record<string, string>;
}

/**
 * S2 — an athlete's recent game-by-game log, rebuilt from the per-game
 * RosterPlayer appearances (already persisted forever). Newest first, capped.
 * Two queries (rows, then their games by id) so it needs no relation field.
 */
export async function getAthleteGameLog(
  prisma: PrismaClient,
  args: { tenantId: string; personId: string; limit?: number },
): Promise<AthleteGameLogEntry[]> {
  const { tenantId, personId } = args;
  if (!tenantId || !personId) return [];
  const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
  const rows = await withDbRetry(
    () =>
      prisma.rosterPlayer.findMany({
        where: { tenantId, personId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { gameId: true, team: true, stats: true },
      }),
    { label: 'sports-stats.gamelog.rows' },
  );
  if (rows.length === 0) return [];
  const gameIds = [...new Set(rows.map((r) => r.gameId))];
  const games = await withDbRetry(
    () =>
      prisma.game.findMany({
        // tenantId here is defense-in-depth: gameIds already come only from
        // this tenant's roster rows above, but on a public minors' route we
        // scope the join too so a future refactor can't widen it.
        where: { id: { in: gameIds }, tenantId },
        select: {
          id: true, sport: true, homeTeam: true, awayTeam: true,
          homeScore: true, awayScore: true, startedAt: true, createdAt: true,
        },
      }),
    { label: 'sports-stats.gamelog.games' },
  );
  const gameById = new Map(games.map((g) => [g.id, g]));
  const out: AthleteGameLogEntry[] = [];
  for (const r of rows) {
    const g = gameById.get(r.gameId);
    if (!g) continue;
    const homeAway: 'home' | 'away' = r.team === 'away' ? 'away' : 'home';
    const teamScore = homeAway === 'home' ? g.homeScore : g.awayScore;
    const oppScore = homeAway === 'home' ? g.awayScore : g.homeScore;
    const opponent = (homeAway === 'home' ? g.awayTeam : g.homeTeam) ?? '';
    let result: 'W' | 'L' | 'T' | null = null;
    if (typeof teamScore === 'number' && typeof oppScore === 'number') {
      result = teamScore > oppScore ? 'W' : teamScore < oppScore ? 'L' : 'T';
    }
    const d = g.startedAt ?? g.createdAt ?? null;
    out.push({
      gameId: r.gameId,
      date: d instanceof Date ? d.toISOString() : null,
      sport: g.sport,
      opponent,
      homeAway,
      teamScore: teamScore ?? null,
      opponentScore: oppScore ?? null,
      result,
      stats: (r.stats as Record<string, string>) ?? {},
    });
  }
  return out;
}

/** The public, privacy-minimal athlete profile (S1) served by the token route. */
export interface PublicAthleteProfile {
  fullName: string;
  number: string | null;
  position: string | null;
  photoUrl: string | null;
  gradYear: number | null;
  teamName: string | null;
  career: AthleteCareer['career'];
  season: AthleteCareer['season'];
  gameLog: AthleteGameLogEntry[];
}

/**
 * S1 — resolve a SHARED athlete profile by its unguessable token. Returns null
 * unless the athlete exists AND isPublic (operator opted in) — so a revoked or
 * never-shared athlete 404s, and there is no person-id enumeration path. Only
 * the minimal PII the operator chose to share is included.
 */
export async function getPublicAthleteProfile(
  prisma: PrismaClient,
  token: string,
): Promise<PublicAthleteProfile | null> {
  if (!token || typeof token !== 'string') return null;
  const person = await withDbRetry(
    () =>
      prisma.sportsPerson.findFirst({
        where: { publicShareToken: token, isPublic: true },
        select: {
          id: true, tenantId: true, fullName: true, number: true,
          position: true, photoUrl: true, gradYear: true, teamId: true,
        },
      }),
    { label: 'sports-stats.public.person' },
  );
  if (!person) return null;
  const [career, gameLog, team] = await Promise.all([
    getAthleteCareer(prisma, { tenantId: person.tenantId, personId: person.id }),
    getAthleteGameLog(prisma, { tenantId: person.tenantId, personId: person.id, limit: 25 }),
    person.teamId
      ? withDbRetry(
          () => prisma.team.findFirst({ where: { id: person.teamId! }, select: { name: true } }),
          { label: 'sports-stats.public.team' },
        )
      : Promise.resolve(null),
  ]);
  return {
    fullName: person.fullName,
    number: person.number ?? null,
    position: person.position ?? null,
    photoUrl: person.photoUrl ?? null,
    gradYear: person.gradYear ?? null,
    teamName: team?.name ?? null,
    career: career?.career ?? [],
    season: career?.season ?? [],
    gameLog,
  };
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
