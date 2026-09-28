import {
  PLAYER_STATS,
  STAT_SEMANTICS,
  statSemantic,
  parseStatValue,
  gameResult,
} from '@cms/api-types';
import type { StatSemantic } from '@cms/api-types';
import type { PrismaClient, Prisma } from '@cms/database';
import { withDbRetry } from '../prisma/with-db-retry';
import {
  loadStudentPolicy,
  studentFlags,
  studentRosterPrivacy,
  type StudentPrivacyDb,
} from './student-privacy';

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
//   • DURABLE + CORRECTION-AWARE (K12-F39, 2026-09-26): the FINAL command
//     queues a `game_stat_rollups` job in its own transaction; the job
//     records the revision it rolled up and the contribution it applied,
//     so a retry is a no-op and a corrected result moves the totals by the
//     difference. (Before: a marker in `game.stats`, set once, so a failed
//     roll-up was lost and a corrected result was never re-rolled.)
//   • The whole roll-up runs in ONE `$transaction` wrapped in
//     `withDbRetry` (transient pool blips retried; logic errors thrown).
//   • FAIL-OPEN is the CALLER's job (the post-commit hook and the retry
//     sweep record a failure on the job, never on "end game"). This fn may
//     throw on a real DB error; it's safe to call and validates inputs.
//
// The reads (`getStatLeaders` / `getAthleteCareer`) hit the indexed
// aggregate tables — fast, never the GameEvent stream, never on the poll.

/**
 * Marker key the pre-K12-F39 finalize stamped into `Game.stats` once a game's
 * stats were rolled up. No longer written (the roll-up job row replaced it);
 * read only to recognise games rolled up the old way.
 */
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
    sport: string;
    statKey: string;
    statValue: number;
    displayValue: string | null;
    gamesPlayed: number;
  }>;
  career: Array<{
    sport: string;
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
        select: { id: true, name: true, number: true, photoUrl: true, position: true, directoryOptOut: true },
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
        // SEC-009: tenant predicate in the WRITE, not only in the ownership
        // pre-read above — the link write can never land on a foreign roster
        // row even if the pre-read is later moved or dropped.
        prisma.rosterPlayer.update({
          where: { id: rosterPlayerId, tenantId },
          data: { personId: person.id, teamId: args.teamId ?? undefined },
        }),
      { label: 'sports-stats.link.roster.update' },
    );
    await carryOptOutToPerson(prisma, tenantId, person.id, roster.directoryOptOut === true);
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
      // SEC-009: tenant predicate in the WRITE (see update1 above).
      prisma.rosterPlayer.update({
        where: { id: rosterPlayerId, tenantId },
        data: { personId: person.id, teamId: teamId ?? undefined },
      }),
    { label: 'sports-stats.link.roster.update2' },
  );
  await carryOptOutToPerson(prisma, tenantId, person.id, roster.directoryOptOut === true);

  return { personId: person.id };
}

/**
 * K-12 launch, lane B3 (student privacy). A family's directory opt-out that was
 * recorded on a roster row follows the student once the row is linked to its
 * persistent athlete, so every later game hides them too. Only the PROTECTIVE
 * flag travels this way — a photo release (showing more of a student) is
 * recorded per student by a school administrator, never inferred from a link.
 */
async function carryOptOutToPerson(
  prisma: PrismaClient,
  tenantId: string,
  personId: string,
  optedOut: boolean,
): Promise<void> {
  if (!optedOut) return;
  await withDbRetry(
    () =>
      prisma.sportsPerson.update({
        where: { id: personId, tenantId },
        data: { directoryOptOut: true },
      }),
    { label: 'sports-stats.link.person.optout' },
  );
}

/**
 * K12-F39 — one counting stat one linked roster row contributed to the
 * season aggregates in one game. A game's CONTRIBUTION is the list of these;
 * the roll-up job stores the contribution it applied, so a corrected result
 * moves the season totals by the difference instead of adding the game twice.
 */
export interface StatContributionEntry {
  personId: string;
  teamId: string | null;
  sport: string;
  season: string;
  statKey: string;
  value: number;
}

/** Roll-up job states (`game_stat_rollups.state`). */
export const STAT_ROLLUP_STATE = {
  /** Queued by the FINAL command; not applied at this revision yet. */
  PENDING: 'PENDING',
  /** The season totals include this game at `appliedRevision`. */
  APPLIED: 'APPLIED',
  /** The last attempt threw; retried by the sweep with back-off. */
  FAILED: 'FAILED',
  /** The game was reopened before its roll-up applied; FINAL re-queues it. */
  REOPENED: 'REOPENED',
  /** Player stats are off for the tenant; nothing to roll up. */
  SKIPPED: 'SKIPPED',
} as const;
export type StatRollupState = (typeof STAT_ROLLUP_STATE)[keyof typeof STAT_ROLLUP_STATE];

/**
 * The counting stats a game's LINKED roster rows contribute. Pure. Rate stats
 * (AVG, judged scores, PAR, marks) are per-game and never summed; an
 * unparseable value is skipped, never thrown. Stored keys resolve through the
 * same alias-aware `rawStat` the live board uses (2026-06-25 parity: CSV and
 * seed rosters store long lowercased labels, the model carries short codes).
 */
export function computeGameContribution(
  game: { sport: string; startedAt?: Date | null; createdAt?: Date | null },
  roster: Array<{ personId: string | null; teamId?: string | null; stats: unknown }>,
): StatContributionEntry[] {
  const sport = game.sport;
  const season = deriveSeason(game);
  const out: StatContributionEntry[] = [];
  for (const rp of roster) {
    if (!rp.personId) continue;
    for (const key of PLAYER_STATS[sport] ?? []) {
      const sem = statSemantic(sport, key);
      if (sem?.kind !== 'counting') continue;
      const rawVal = rawStat(rp.stats, key);
      if (rawVal == null) continue;
      const parsed = parseStatValue(rawVal, sem);
      if (parsed == null) continue;
      out.push({ personId: rp.personId, teamId: rp.teamId ?? null, sport, season, statKey: key, value: parsed });
    }
  }
  return out;
}

/** A stored contribution, tolerating anything a JSON column can hold. */
function readContribution(raw: unknown): StatContributionEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is StatContributionEntry =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as StatContributionEntry).personId === 'string' &&
      typeof (e as StatContributionEntry).statKey === 'string' &&
      typeof (e as StatContributionEntry).sport === 'string' &&
      typeof (e as StatContributionEntry).season === 'string' &&
      typeof (e as StatContributionEntry).value === 'number',
  );
}

/**
 * Per season row (person, season, sport, stat): the summed value and how many
 * roster rows contributed — `gamesPlayed` counts games that contributed to
 * that stat row, as it always has.
 */
function bySeasonRow(entries: StatContributionEntry[]) {
  const rows = new Map<string, StatContributionEntry & { games: number }>();
  for (const e of entries) {
    const k = `${e.personId}|${e.season}|${e.sport}|${e.statKey}`;
    const cur = rows.get(k);
    if (cur) {
      cur.value += e.value;
      cur.games += 1;
      if (e.teamId) cur.teamId = e.teamId;
    } else {
      rows.set(k, { ...e, games: 1 });
    }
  }
  return rows;
}

/** A legacy (pre-K12-F39) roll-up stamped this into `Game.stats`. */
export function hasLegacyFinalizeMarker(stats: unknown): boolean {
  return (
    !!stats &&
    typeof stats === 'object' &&
    !Array.isArray(stats) &&
    !!(stats as Record<string, unknown>)[STATS_FINALIZED_MARKER]
  );
}

/**
 * K12-F39 — apply a game's queued season roll-up, exactly once per result
 * revision.
 *
 * The FINAL command queues a `game_stat_rollups` row (PENDING, the revision
 * to roll up) in its own transaction; this applies it:
 *   1. CLAIM the job with a conditional write on its attempt counter. The
 *      write takes the row lock, so two appliers (the post-commit hook on one
 *      replica, the sweep on another) serialise, and the second's condition
 *      no longer holds once the first commits — it does nothing.
 *   2. Compute the game's contribution from its (final, locked) box score.
 *   3. Move each season row by the DIFFERENCE from the contribution this job
 *      last applied — atomic increments, never read-modify-write, so two
 *      games finalizing at once for the same athlete cannot lose an update.
 *      A row no game contributes to any more is removed. Career rows are
 *      recomputed as the sum of the athlete's season rows for that sport.
 *   4. Record the applied revision + contribution; clear the error.
 * All in ONE transaction: a failure changes no total and leaves the job
 * PENDING/FAILED for the retry sweep. Re-applying an applied revision is a
 * no-op; a corrected result (reopen → fix → FINAL) is re-queued at its new
 * revision and rolls up as a correction.
 *
 * A game rolled up by the old marker-based finalize has no job; the reopen
 * that precedes any correction seeds its baseline (see SportsService). If a
 * job reaches here with no baseline for such a game, the current box score is
 * taken as the baseline — never added a second time.
 */
export async function applyGameStatRollup(
  prisma: PrismaClient,
  tenantId: string,
  gameId: string,
): Promise<{ applied: boolean; aggregated: number; revision?: number; skipped?: string }> {
  if (!tenantId) throw new Error('applyGameStatRollup: tenantId required');
  if (!gameId) throw new Error('applyGameStatRollup: gameId required');

  return withDbRetry(() => prisma.$transaction(async (tx) => {
    const job = await tx.gameStatRollup.findFirst({ where: { gameId, tenantId } });
    if (!job) return { applied: false, aggregated: 0, skipped: 'no-job' };
    if (job.state === STAT_ROLLUP_STATE.REOPENED || job.state === STAT_ROLLUP_STATE.SKIPPED) {
      return { applied: false, aggregated: 0, skipped: job.state.toLowerCase() };
    }
    if (job.state === STAT_ROLLUP_STATE.APPLIED && job.appliedRevision === job.targetRevision) {
      return { applied: false, aggregated: 0, skipped: 'already-applied' };
    }

    // 1 — claim.
    const claim = await tx.gameStatRollup.updateMany({
      where: { gameId, tenantId, attempts: job.attempts, targetRevision: job.targetRevision },
      data: { attempts: { increment: 1 } },
    });
    if (claim.count === 0) return { applied: false, aggregated: 0, skipped: 'busy' };

    const game = await tx.game.findFirst({
      where: { id: gameId, tenantId },
      select: { id: true, sport: true, status: true, stats: true, startedAt: true, createdAt: true },
    });
    if (!game) return { applied: false, aggregated: 0, skipped: 'game-not-found' };
    if (game.status !== 'FINAL') {
      // Reopened after it was queued: the box score may be mid-correction.
      // The next FINAL re-queues it at the corrected revision.
      await tx.gameStatRollup.update({
        where: { gameId, tenantId },
        data: { state: STAT_ROLLUP_STATE.REOPENED },
      });
      return { applied: false, aggregated: 0, skipped: 'not-final' };
    }

    // 2 — the contribution at this revision.
    const roster = await tx.rosterPlayer.findMany({
      where: { gameId, tenantId, personId: { not: null } },
      select: { personId: true, teamId: true, stats: true },
    });
    const next = computeGameContribution(game, roster);
    const legacyBaseline = job.appliedRevision == null && hasLegacyFinalizeMarker(game.stats);
    const prev = legacyBaseline ? next : readContribution(job.contribution);

    // 3 — season rows move by the difference; careers are re-summed.
    const before = bySeasonRow(prev);
    const after = bySeasonRow(next);
    const careers = new Map<string, { personId: string; statKey: string; sport: string; teamId: string | null }>();
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const b = before.get(key);
      const a = after.get(key);
      const dValue = (a?.value ?? 0) - (b?.value ?? 0);
      const dGames = (a?.games ?? 0) - (b?.games ?? 0);
      if (dValue === 0 && dGames === 0) continue;
      const ref = (a ?? b)!;
      const sem = statSemantic(ref.sport, ref.statKey);
      const where = {
        person_season_stat: {
          personId: ref.personId,
          season: ref.season,
          statKey: ref.statKey,
          sport: ref.sport,
        },
        tenantId,
      };
      const row = await tx.playerSeasonStat.upsert({
        where,
        create: {
          tenantId,
          personId: ref.personId,
          teamId: ref.teamId ?? undefined,
          sport: ref.sport,
          season: ref.season,
          statKey: ref.statKey,
          statValue: dValue,
          gamesPlayed: dGames,
          displayValue: formatStatValue(dValue, sem),
          lastGameId: gameId,
        },
        update: {
          statValue: { increment: dValue },
          gamesPlayed: { increment: dGames },
          lastGameId: gameId,
          ...(a?.teamId ? { teamId: a.teamId } : {}),
        },
      });
      if (row.gamesPlayed <= 0) {
        await tx.playerSeasonStat.delete({ where });
      } else {
        await tx.playerSeasonStat.update({
          where,
          data: { displayValue: formatStatValue(row.statValue, sem) },
        });
      }
      careers.set(`${ref.personId}|${ref.statKey}|${ref.sport}`, {
        personId: ref.personId,
        statKey: ref.statKey,
        sport: ref.sport,
        teamId: a?.teamId ?? ref.teamId ?? null,
      });
    }
    for (const c of careers.values()) {
      // Sport-scoped: PLAYER_STATS codes collide across sports (2026-07-04).
      const seasonRows = await tx.playerSeasonStat.findMany({
        where: { personId: c.personId, statKey: c.statKey, sport: c.sport, tenantId },
        select: { statValue: true, gamesPlayed: true },
      });
      if (seasonRows.length === 0) {
        await tx.playerCareerStat.deleteMany({
          where: { personId: c.personId, statKey: c.statKey, sport: c.sport, tenantId },
        });
        continue;
      }
      const sem = statSemantic(c.sport, c.statKey);
      const careerValue = seasonRows.reduce((s, r) => s + r.statValue, 0);
      const careerGames = seasonRows.reduce((s, r) => s + r.gamesPlayed, 0);
      await tx.playerCareerStat.upsert({
        where: { person_career_stat: { personId: c.personId, statKey: c.statKey, sport: c.sport }, tenantId },
        update: {
          statValue: careerValue,
          gamesPlayed: careerGames,
          displayValue: formatStatValue(careerValue, sem),
          lastGameId: gameId,
          teamId: c.teamId ?? undefined,
        },
        create: {
          tenantId,
          personId: c.personId,
          teamId: c.teamId ?? undefined,
          sport: c.sport,
          statKey: c.statKey,
          statValue: careerValue,
          gamesPlayed: careerGames,
          displayValue: formatStatValue(careerValue, sem),
          lastGameId: gameId,
        },
      });
    }

    // 4 — record what the totals now hold for this game.
    await tx.gameStatRollup.update({
      where: { gameId, tenantId },
      data: {
        state: STAT_ROLLUP_STATE.APPLIED,
        appliedRevision: job.targetRevision,
        contribution: next as unknown as Prisma.InputJsonValue,
        lastError: null,
      },
    });
    return {
      applied: true,
      aggregated: new Set(next.map((e) => e.personId)).size,
      revision: job.targetRevision,
    };
  }), { label: 'sports-stats.applyGameStatRollup' });
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
            sport: true,
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
            sport: true,
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
      sport: r.sport,
      statKey: r.statKey,
      statValue: r.statValue,
      displayValue: r.displayValue ?? null,
      gamesPlayed: r.gamesPlayed,
    })),
    career: careerRows.map((r) => ({
      sport: r.sport,
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
          // K12-F18 — the W / L / T comes from the sport's result model
          // (gameResult), which needs the status, the stats and the rules.
          status: true, stats: true, rules: true,
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
    const opponent = (homeAway === 'home' ? g.awayTeam : g.homeTeam) ?? '';
    // K12-F18 — the sport's RESULT, never the raw columns: a volleyball
    // match is its sets (its columns end 0–0), a wrestling dual its team
    // points, golf / cross-country the LOWER total. The totals shown beside
    // the W / L are the ones that decided it. A game still in play has no
    // W / L / T yet, and a FINAL that recorded nothing has none either.
    const res = gameResult(g);
    const teamScore = homeAway === 'home' ? res.home : res.away;
    const oppScore = homeAway === 'home' ? res.away : res.home;
    let result: 'W' | 'L' | 'T' | null = null;
    if (res.outcome === 'tie') result = 'T';
    else if (res.winner) result = res.winner === homeAway ? 'W' : 'L';
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
 *
 * K-12 launch, lane B3 — this page is a PUBLIC output of a student's name,
 * photo and stats, so the school's student-privacy policy applies on every
 * read (not only when the link was made): at a school that has not confirmed
 * its directory-information policy, or for a student whose family opted out,
 * the page 404s like a never-shared one; the photo shows only with the photo
 * attestation AND the student's own release. Revoking either hides the page on
 * its next load.
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
          directoryOptOut: true, photoRelease: true,
        },
      }),
    { label: 'sports-stats.public.person' },
  );
  if (!person) return null;
  const policy = await loadStudentPolicy(prisma as unknown as StudentPrivacyDb, person.tenantId);
  const shown = studentRosterPrivacy(studentFlags(person), policy);
  if (shown.names === 'hidden') return null;
  const [career, gameLog, team] = await Promise.all([
    getAthleteCareer(prisma, { tenantId: person.tenantId, personId: person.id }),
    getAthleteGameLog(prisma, { tenantId: person.tenantId, personId: person.id, limit: 25 }),
    person.teamId
      ? withDbRetry(
          // SEC-009: the public athlete profile resolves its team inside the
          // athlete's OWN tenant. Without the predicate a team id that had
          // been reassigned (or hand-edited) could surface another tenant's
          // team name on a public page.
          () =>
            prisma.team.findFirst({
              where: { id: person.teamId!, tenantId: person.tenantId },
              select: { name: true },
            }),
          { label: 'sports-stats.public.team' },
        )
      : Promise.resolve(null),
  ]);
  return {
    fullName: person.fullName,
    number: person.number ?? null,
    position: person.position ?? null,
    photoUrl: shown.photos ? (person.photoUrl ?? null) : null,
    gradYear: person.gradYear ?? null,
    teamName: team?.name ?? null,
    career: career?.career ?? [],
    season: career?.season ?? [],
    gameLog,
  };
}
