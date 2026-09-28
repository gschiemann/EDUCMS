/**
 * VenueOS Sports — RULES PROFILES (K-12 sports launch program, lane A3,
 * 2026-09-27). Register rows K12-F01 (a versioned rules profile bound to every
 * game), F02–F04 (NFHS basketball), F19 (volleyball / pickleball formats),
 * F20–F21 (baseball / softball), F22 (soccer), F23 (wrestling), F24
 * (lacrosse), F25 (hockey / field hockey / water polo) and F27 (say which
 * sports are NOT verified) of the Codex readiness audit
 * (docs/research/2026-09-23-k12-sports-readiness-audit/).
 *
 * THE MODEL
 *  - A PROFILE is a named, versioned rule set, `<id>@<version>` — for example
 *    `nfhs-basketball@2026-27`, where the version is the rule-book season the
 *    profile was checked against. Its `rules` are the rule VALUES the engine
 *    runs: period structure and lengths, overtime, timeout banks, the team-foul
 *    bonus, shot-clock options, the set format.
 *  - A game BINDS one profile when it is created: the profile's rules are
 *    resolved and copied onto the game (`Game.rulesProfile` + the `Game.rules`
 *    snapshot, see `snapshotRules`). From then on the engine and every surface
 *    read the GAME'S SNAPSHOT (`sportForGame`), never this catalog — so a new
 *    profile, or a new version of one, can never rewrite a game in progress or
 *    a finished result (F01).
 *  - A PUBLISHED PROFILE NEVER CHANGES. A rules change is a new version with a
 *    new key; the old key stays, so an older game still names what it ran.
 *    `sports-rules.spec.ts` pins a fingerprint of every published profile's
 *    rule values and fails when one is edited in place.
 *  - A game with NO snapshot was created before profiles existed. It runs the
 *    base SPORT_DEFINITIONS unchanged — the "classic" rules — exactly as it did
 *    before this change. Nothing migrates it silently: the table can switch a
 *    not-yet-started game to a profile (an audited command in the API).
 *
 * SOURCES. Every rule value a profile sets cites a source id (`RULES_SOURCES`)
 * in a comment on the value: the primary documents listed in the audit's
 * 05-RULES-SOURCES.md (and, for girls lacrosse, two documents published on
 * the NFHS resources page that file lists). A value the engine carried before
 * this work that no listed source confirms is named in the profile's
 * `unverified` list instead of being passed off as checked — that list is the
 * official scorer's review sheet (launch gate G01: an official scorer signs
 * each profile before a sport is sold as a K-12 game controller). No rule-book
 * text is reproduced: every rule is paraphrased.
 *
 * VERIFICATION STATUS — what the setup screen says (F27):
 *  - source-checked: every rule value is backed by a listed source;
 *  - partial:        some are; the others are listed in `unverified`;
 *  - not-verified:   no listed source; setup says "rules not verified".
 * None of these is an official approval — G01 still needs a signature.
 *
 * Pure: no DOM, no network, no clock — shared by the API and every web
 * surface, and safe on Chromium 83 players.
 */
import {
  findSport,
  SPORT_DEFINITIONS,
  type SegmentResetRules,
  type SetFormatRules,
  type SportDefinition,
  type SportStatField,
  type TeamFoulRules,
  type TimeoutRules,
} from './sports';

// ════════════════════════════════════════════════════════════════════
// Sources — one entry per document in 05-RULES-SOURCES.md a rule cites.
// ════════════════════════════════════════════════════════════════════

export interface RulesSource {
  id: string;
  /** The document, and what the profiles take from it (paraphrased). */
  title: string;
  url: string;
}

function source(id: string, title: string, url: string): RulesSource {
  return { id, title, url };
}

export const RULES_SOURCES: Readonly<Record<string, RulesSource>> = Object.freeze({
  // ── Basketball (05-RULES-SOURCES.md § Basketball) ──────────────────
  'nfhs-bb-changes-2023-24': source(
    'nfhs-bb-changes-2023-24',
    'NFHS basketball rules changes 2023-24 — Rule 4-8-1: no one-and-one; the bonus is two free throws from a team\'s fifth foul in each quarter',
    'https://www.nfhs.org/resources/sports/basketball-rules-changes-2023-24',
  ),
  'nfhs-bb-fouls-2023-24': source(
    'nfhs-bb-fouls-2023-24',
    'NFHS: free-throw procedures and foul administration amended (2023-24) — bonus from the opponent\'s fifth foul in each quarter; team fouls reset at the end of each quarter',
    'https://nfhs.org/stories/free-throw-procedures-and-foul-administration-amended-in-2023-24-high-school-basketball-rules-changes',
  ),
  'ncaa-nfhs-bb-2025-26': source(
    'ncaa-nfhs-bb-2025-26',
    '2025-26 NCAA/NFHS major basketball rules differences (NCAA-hosted), NFHS column — four 8-minute quarters; 4-minute overtime; three 60-second and two 30-second time-outs; bonus on the fifth team foul, no one-and-one; team fouls reset at the end of the first, second and third quarters; shot clock by state adoption (35 s); no shot-clock reset rule',
    'https://ncaaorg.s3.amazonaws.com/championships/sports/basketball/rules/common/2025-26PRXBB_MajorRulesDifferences.pdf',
  ),
  'kshsaa-bb-table-2026': source(
    'kshsaa-bb-table-2026',
    'KSHSAA basketball official timer and scorer guidelines (revised 8-12-2026) — at the start of overtime the fourth-quarter team fouls remain; never show more than five team fouls on the scoreboard; full (60 s) and 30-second time-outs (an association example, not a national default)',
    'https://www.kshsaa.org/public/basketball/pdf/kansastimerscorerguidelines.pdf',
  ),
  'nfhs-bb-clock-2026-27': source(
    'nfhs-bb-clock-2026-27',
    'NFHS basketball changes 2026-27 — Rule 5-9-5: at least 0.3 s runs off on a throw-in touched in the last 59.9 s, on a game clock that displays tenths',
    'https://nfhs.org/stories/clock-adjustments-addressed-to-support-officials-in-2026-27-high-school-basketball-rules-changes',
  ),
  'nfhs-bb-resources': source(
    'nfhs-bb-resources',
    'NFHS basketball resources — shot-clock guidance: the state association decides whether a shot clock is used; OFF is a supported state',
    'https://nfhs.org/sports/basketball/resources',
  ),
  // ── Football ───────────────────────────────────────────────────────
  'nfhs-fb-clock-2025': source(
    'nfhs-fb-clock-2025',
    'NFHS 2025 general instructions for football game and play-clock operators — separate game and play clocks; 40 s after a down, 25 s after administrative stoppages, a charged time-out and at the start of every period; overtime per the state association, with the game clock off',
    'https://assets.nfhs.org/umbraco/media/4016214/2025-nfhs-general-instructions-for-football-game-and-play-clock-operators-final-3-10-25.pdf',
  ),
  // ── Baseball / softball ────────────────────────────────────────────
  'nfhs-baseball-rules': source(
    'nfhs-baseball-rules',
    'NFHS baseball rules (2027 changes) — Rule 4-2-2: a regulation game is seven innings; an extra-inning tiebreaker (runner on second) is a suggested state-adoption option',
    'https://nfhs.org/sports/baseball/rules',
  ),
  'uil-baseball-regular': source(
    'uil-baseball-regular',
    'UIL baseball regular-season manual — seven innings unless tied; ten-run rule after five innings (four and a half with the home team ahead)',
    'https://www.uiltexas.org/baseball/manual/baseball-regular-season',
  ),
  'uil-baseball-post': source(
    'uil-baseball-post',
    'UIL baseball postseason information — games go seven innings; a suspended playoff game continues from the point of suspension',
    'https://www.uiltexas.org/baseball/manual/baseball-post-season-information',
  ),
  'uil-softball-regular': source(
    'uil-softball-regular',
    'UIL softball regular-season manual — seven innings unless tied; ten-run rule after five; optional fifteen-run rule after three',
    'https://www.uiltexas.org/softball/manual/softball-regular-season',
  ),
  'nfhs-pitch-count': source(
    'nfhs-pitch-count',
    'NFHS: every state association writes its own pitching-restriction policy (pitches per game and required rest days)',
    'https://www.nfhs.org/stories/reducing-pitching-injuries-count-pitches-don-t-count-on-surgery',
  ),
  // ── Soccer ─────────────────────────────────────────────────────────
  'nfhs-soccer-guide-2024-25': source(
    'nfhs-soccer-guide-2024-25',
    '2024-25 NFHS / NCAA / IFAB soccer comparison guide, NFHS column — two 40-minute periods or four 20-minute quarters; the clock stops for goals, penalty kicks and cards and at the referee\'s signal; the timer counts down the last ten seconds; overtime by state association, up to 20 minutes',
    'https://assets.nfhs.org/umbraco/media/7213076/2024-25-soccer-guide-final.pdf',
  ),
  'ohsaa-soccer-timekeeper': source(
    'ohsaa-soccer-timekeeper',
    'OHSAA soccer timer clock-management guidelines — varsity 40-minute halves, junior varsity 36-minute halves, countdown with the final ten seconds counted (an association example)',
    'https://www.ohsaa.org/Portals/0/Officiating/dod/Soccer/OHSAASoccerTimekeeperGuidance.pdf',
  ),
  'nfhs-soccer-2025-26': source(
    'nfhs-soccer-2025-26',
    'NFHS soccer rules changes 2025-26 — no change to periods, clock or overtime',
    'https://www.nfhs.org/resources/sports/soccer-rules-changes-2025-26',
  ),
  // ── Volleyball ─────────────────────────────────────────────────────
  'uil-volleyball-rally': source(
    'uil-volleyball-rally',
    'UIL volleyball rally-scoring regulations — varsity best of five to 25, fifth set to 15, no cap; sub-varsity and junior high best of three to 25 with a cap at 30 (third set too); two time-outs per set',
    'https://www.uiltexas.org/volleyball/page/volleyball-rally-scoring-regulations',
  ),
  'nfhs-vb-2026-27': source(
    'nfhs-vb-2026-27',
    'NFHS volleyball 2026-27 interpretations and comments on the rules — libero changes (a scorebook matter this scoreboard does not claim)',
    'https://www.nfhs.org/resources/sports/volleyball-rules-interpretations-2026-27',
  ),
  // ── Wrestling ──────────────────────────────────────────────────────
  'kshsaa-wrestling-2025-26': source(
    'kshsaa-wrestling-2025-26',
    'KSHSAA 2025-26 wrestling manual — NFHS Rule 6-7 overtime: a one-minute sudden victory, then two 30-second tiebreakers, then a 30-second ultimate tiebreaker; seventh/eighth-grade periods 1:00, 1:30, 1:30',
    'https://www.kshsaa.org/Publications/Wrestling.pdf',
  ),
  'nfhs-wrestling-poster-2024-25': source(
    'nfhs-wrestling-poster-2024-25',
    'NFHS wrestling rules poster 2024-25 — a takedown is worth three match points; near-fall points depend on how long near-fall criteria are held',
    'https://assets.nfhs.org/umbraco/media/7213294/2024-25-wrestling-rules-poster-11x17.pdf',
  ),
  'nfhs-wrestling-resources': source(
    'nfhs-wrestling-resources',
    'NFHS wrestling resources — scorers\' and timers\' instructions: no riding time among the scoring symbols; the match timekeeper keeps injury, blood and recovery time',
    'https://www.nfhs.org/sports/wrestling/resources',
  ),
  // ── Lacrosse ───────────────────────────────────────────────────────
  'nfhs-blax-shot-clock-2027': source(
    'nfhs-blax-shot-clock-2027',
    'NFHS (published 2026-08-13): by state association adoption, boys lacrosse may use a 70-second shot clock starting with the 2027 season',
    'https://nfhs.org/stories/states-may-adopt-shot-clocks-for-boys-lacrosse-starting-next-season',
  ),
  'nfhs-glax-resources': source(
    'nfhs-glax-resources',
    'NFHS girls lacrosse resources — timers\' rules (Rule 3-7: quarters; a two-minute team time-out; yellow card two minutes, red card four minutes, green/yellow delay card two minutes; running clock at a ten-goal differential) and the 2027 possession clock (90 s, state association adoption, full reset only)',
    'https://www.nfhs.org/sports/lacrosse-girls/resources',
  ),
  // ── Ice hockey, field hockey, water polo ───────────────────────────
  'nfhs-ice-hockey-resources': source(
    'nfhs-ice-hockey-resources',
    'NFHS ice hockey rules and resources (2026-27) — the current book and state overtime adoptions govern; no public page lists period, overtime or time-out allocations',
    'https://nfhs.org/sports/ice-hockey/resources',
  ),
  'nfhs-field-hockey-resources': source(
    'nfhs-field-hockey-resources',
    'NFHS field hockey resources (2026) — the current interpretations; overtime format is a state choice',
    'https://nfhs.org/sports/field-hockey/resources',
  ),
  'nfhs-water-polo-scoresheet': source(
    'nfhs-water-polo-scoresheet',
    'NFHS water polo official score sheet — four quarters and up to three overtime periods; full and 30-second time-outs are recorded separately',
    'https://assets.nfhs.org/umbraco/media/885740/water-polo-scoresheet.pdf',
  ),
});

// ════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════

export type RulesVerification = 'source-checked' | 'partial' | 'not-verified';

/** The competition level a profile is for (drives the setup label). */
export type RulesLevel = 'varsity' | 'sub-varsity' | 'junior-high' | 'any';

/**
 * The CHANGES a profile makes to a sport's base definition. `null` removes a
 * block (a boys-lacrosse 2026 game has no shot clock at all).
 */
export interface RulesDelta {
  clock?: Partial<SportDefinition['clock']>;
  segment?: Partial<SportDefinition['segment']>;
  shotClock?: SportDefinition['shotClock'] | null;
  playClock?: SportDefinition['playClock'] | null;
  segmentReset?: SegmentResetRules | null;
  teamFouls?: TeamFoulRules | null;
  timeouts?: TimeoutRules | null;
  setFormat?: SetFormatRules | null;
  penaltyBox?: SportDefinition['penaltyBox'] | null;
  stats?: {
    /** Stat keys the profile does not use (NFHS wrestling has no riding time). */
    remove?: string[];
    /** Stats the profile adds (volleyball timeouts). */
    add?: SportStatField[];
    /** New bounds for existing stats. */
    limits?: Record<string, { min?: number; max?: number }>;
  };
}

/** One published rules profile. */
export interface RulesProfile {
  /** `${id}@${version}` — what a game stores in `rulesProfile`. */
  key: string;
  id: string;
  version: string;
  sport: string;
  /** English name — audit rows and API responses. Surfaces compose a
   *  translated name from association / level / division / season / variant. */
  label: string;
  /** Who writes the rules — a proper noun, never translated. */
  association: string;
  level: RulesLevel;
  division?: 'boys' | 'girls';
  /** Rule-book season, e.g. '2026-27'. */
  season: string;
  /** Short variant tag the setup label adds ('quarters', 'bo1-15', …). */
  variant?: string;
  verification: RulesVerification;
  /** RULES_SOURCES ids this profile's values are checked against. */
  sources: string[];
  /** Values carried from the engine that no listed source confirms — the
   *  official scorer's review list (G01). */
  unverified: string[];
  /** Association options the table handles by hand (mercy, shootouts, …). */
  notes: string[];
  /** Offered for NEW games. */
  selectable: boolean;
  /** The sport's default for a new game. */
  isDefault?: boolean;
  /** The profile's changes to the sport's base definition. */
  rules: RulesDelta;
}

/**
 * THE SNAPSHOT a game stores in `Game.rules`: every rule value the game runs,
 * fully resolved when the profile is bound, so nothing outside the game row —
 * no later profile version, no edit to a base definition — can change it.
 */
export interface GameRules {
  v: 1;
  profile: string;
  sport: string;
  label: string;
  clock: SportDefinition['clock'];
  segment: SportDefinition['segment'];
  shotClock: SportDefinition['shotClock'] | null;
  playClock: SportDefinition['playClock'] | null;
  segmentReset: SegmentResetRules | null;
  teamFouls: TeamFoulRules | null;
  timeouts: TimeoutRules | null;
  setFormat: SetFormatRules | null;
  penaltyBox: SportDefinition['penaltyBox'] | null;
  stats: SportStatField[];
}

const MIN = 60_000;

// ════════════════════════════════════════════════════════════════════
// Resolving a profile into a definition, and a definition into a snapshot
// ════════════════════════════════════════════════════════════════════

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

function applyStatDelta(
  stats: SportStatField[],
  delta: NonNullable<RulesDelta['stats']>,
): SportStatField[] {
  const removed = new Set(delta.remove ?? []);
  const out = stats.filter((s) => !removed.has(s.key)).map((s) => ({ ...s }));
  for (const add of delta.add ?? []) {
    if (!out.some((s) => s.key === add.key)) out.push({ ...add });
  }
  for (const [key, lim] of Object.entries(delta.limits ?? {})) {
    const f = out.find((s) => s.key === key);
    if (!f) continue;
    if (typeof lim.min === 'number') f.min = lim.min;
    if (typeof lim.max === 'number') f.max = lim.max;
  }
  return out;
}

/** A base definition with a profile's changes applied (not yet a snapshot). */
function applyDelta(base: SportDefinition, delta: RulesDelta): SportDefinition {
  const def: SportDefinition = { ...base };
  if (delta.clock) def.clock = { ...base.clock, ...clone(delta.clock) };
  if (delta.segment) def.segment = { ...base.segment, ...clone(delta.segment) };
  const blocks = [
    'shotClock',
    'playClock',
    'segmentReset',
    'teamFouls',
    'timeouts',
    'setFormat',
    'penaltyBox',
  ] as const;
  for (const k of blocks) {
    const v = delta[k];
    if (v === undefined) continue;
    if (v === null) delete (def as unknown as Record<string, unknown>)[k];
    else (def as unknown as Record<string, unknown>)[k] = clone(v);
  }
  if (delta.stats) def.stats = applyStatDelta(base.stats, delta.stats);
  return def;
}

/** Every rule value of a definition, as a snapshot. */
function extractRules(
  def: SportDefinition,
  meta: { profile: string; label: string },
): GameRules {
  return {
    v: 1,
    profile: meta.profile,
    sport: def.key,
    label: meta.label,
    clock: clone(def.clock),
    segment: clone(def.segment),
    shotClock: def.shotClock ? clone(def.shotClock) : null,
    playClock: def.playClock ? clone(def.playClock) : null,
    segmentReset: def.segmentReset ? clone(def.segmentReset) : null,
    teamFouls: def.teamFouls ? clone(def.teamFouls) : null,
    timeouts: def.timeouts ? clone(def.timeouts) : null,
    setFormat: def.setFormat ? clone(def.setFormat) : null,
    penaltyBox: def.penaltyBox ? clone(def.penaltyBox) : null,
    stats: clone(def.stats),
  };
}

/**
 * K12-F01 — the snapshot a game stores when it binds `profile`: the sport's
 * base definition with the profile's changes applied, every rule value
 * resolved. Throws for a profile whose sport does not exist (a catalog bug).
 */
export function snapshotRules(profile: RulesProfile): GameRules {
  const base = findSport(profile.sport);
  if (!base) throw new Error(`rules profile ${profile.key}: unknown sport ${profile.sport}`);
  return extractRules(applyDelta(base, profile.rules), { profile: profile.key, label: profile.label });
}

// ════════════════════════════════════════════════════════════════════
// The catalog
// ════════════════════════════════════════════════════════════════════

type ProfileInput = Omit<RulesProfile, 'key' | 'unverified' | 'notes' | 'selectable'> & {
  unverified?: string[];
  notes?: string[];
  selectable?: boolean;
};

function profile(p: ProfileInput): RulesProfile {
  return {
    ...p,
    key: `${p.id}@${p.version}`,
    unverified: p.unverified ?? [],
    notes: p.notes ?? [],
    selectable: p.selectable ?? true,
  };
}

/** The version every CLASSIC profile carries: the engine as of this change. */
export const CLASSIC_RULES_VERSION = '2026-09';

/**
 * The CLASSIC profile of a sport: its base definition unchanged — what every
 * game created before profiles runs. Offered for new games too (a pro or
 * college venue's escape hatch, and the only profile of a sport no listed
 * source covers), always labelled "rules not verified".
 */
function classicProfile(def: SportDefinition): RulesProfile {
  return profile({
    id: `classic-${def.key}`,
    version: CLASSIC_RULES_VERSION,
    sport: def.key,
    label: `${def.name} — classic scoreboard rules (not verified)`,
    association: 'VenueOS',
    level: 'any',
    season: CLASSIC_RULES_VERSION,
    variant: 'classic',
    verification: 'not-verified',
    sources: [],
    notes: ['The rules the scoreboard ran before rules profiles existed. No rule book was checked.'],
    // The deprecated swimming_diving alias is never offered for a new game.
    selectable: def.key !== 'swimming_diving',
    rules: {},
  });
}

// ── Basketball — F02 / F03 / F04 ─────────────────────────────────────

const NFHS_BASKETBALL_2026_27 = profile({
  id: 'nfhs-basketball',
  version: '2026-27',
  sport: 'basketball',
  label: 'NFHS high school basketball (2026-27)',
  association: 'NFHS',
  level: 'varsity',
  season: '2026-27',
  verification: 'partial',
  isDefault: true,
  sources: [
    'ncaa-nfhs-bb-2025-26',
    'nfhs-bb-changes-2023-24',
    'nfhs-bb-fouls-2023-24',
    'kshsaa-bb-table-2026',
    'nfhs-bb-clock-2026-27',
    'nfhs-bb-resources',
  ],
  unverified: [
    'One extra 60-second time-out per team for each overtime period, unused time-outs carrying over (NFHS Rule 5-11-5 as officials\' associations reproduce it; not in the audit\'s source list).',
    'Scoreboard team fouls shown no higher than 5 — a KSHSAA table instruction; confirm for other associations.',
    'The 2025-26 NCAA/NFHS comparison was checked against the 2026-27 NFHS change list (clock rules only) — confirm against the 2026-27 book.',
  ],
  notes: [
    'Running-clock (mercy) provisions are local (KSHSAA: a 30-point differential by agreement) — the table runs the clock by hand.',
    'A shot clock is used only where the state association adopted it: pick "35 seconds" at setup, otherwise it stays off.',
  ],
  rules: {
    // Four 8-minute quarters; overtime periods are four minutes
    // [ncaa-nfhs-bb-2025-26]. Tenths in the final minute: 2026-27 Rule 5-9-5
    // administers 0.3 s on a clock that displays tenths [nfhs-bb-clock-2026-27].
    clock: { type: 'countdown', segmentMs: 8 * MIN, otSegmentMs: 4 * MIN, tenths: true },
    segment: { name: 'Quarter', count: 4, overtime: true },
    // Shot clock only by state adoption, 35 seconds, and the comparison has
    // no partial-reset rule for NFHS [ncaa-nfhs-bb-2025-26; nfhs-bb-resources]:
    // OFF by default, 35 when the table picks it, full resets only.
    shotClock: { full: 35, short: 0, options: [0, 35], defaultLen: 0 },
    // Team fouls reset at the end of the first, second and third quarters
    // [ncaa-nfhs-bb-2025-26; nfhs-bb-fouls-2023-24]; the time-out bank is per
    // GAME, never refilled at halftime [ncaa-nfhs-bb-2025-26].
    segmentReset: { homeFouls: true, awayFouls: true, homeTimeouts: 'never', awayTimeouts: 'never', shotClock: true },
    teamFouls: {
      // Two free throws from the opponent's fifth team foul in each quarter,
      // no one-and-one [nfhs-bb-changes-2023-24; ncaa-nfhs-bb-2025-26].
      bonusAt: 5,
      // Overtime keeps the fourth-quarter count [kshsaa-bb-table-2026;
      // "end of first, second and third quarters" — ncaa-nfhs-bb-2025-26].
      carryIntoOvertime: true,
      // Never more than 5 on the scoreboard [kshsaa-bb-table-2026].
      displayCap: 5,
    },
    // Three 60-second and two 30-second time-outs [ncaa-nfhs-bb-2025-26];
    // plus one 60-second per overtime period (see `unverified`).
    timeouts: { full: 3, short: 2, fullSec: 60, shortSec: 30, per: 'game', overtimeFull: 1 },
    // The TOTAL left (5 at tip-off) grows by one per overtime period; the
    // stepper allows up to 8 by hand (a small-range control, so the console
    // keeps its one-tap timeout chip). The engine's overtime additions are
    // never capped by it.
    stats: { limits: { homeTimeouts: { max: 8 }, awayTimeouts: { max: 8 } } },
  },
});

// ── Football ──────────────────────────────────────────────────────────

const NFHS_FOOTBALL_2025 = profile({
  id: 'nfhs-football',
  version: '2025',
  sport: 'football',
  label: 'NFHS high school football (2025)',
  association: 'NFHS',
  level: 'varsity',
  season: '2025',
  verification: 'partial',
  isDefault: true,
  sources: ['nfhs-fb-clock-2025'],
  unverified: [
    'Four 12-minute quarters (engine default; the clock-operator instructions do not state it).',
    'Three time-outs per team per half, not carried over (engine default).',
    'Time-outs in overtime periods are not tracked.',
  ],
  notes: [
    'Overtime follows the state association\'s procedure; the game clock is off in overtime.',
    'Running-clock (mercy) procedures are the state association\'s — run the clock by hand.',
  ],
  rules: {
    // Overtime per the state association with the game clock off
    // [nfhs-fb-clock-2025, section H].
    clock: { type: 'countdown', segmentMs: 12 * MIN, untimedOvertime: true },
    segment: { name: 'Quarter', count: 4, overtime: true },
    // 40 s after a down; 25 s after administrative stoppages, a charged
    // time-out and at the start of each period [nfhs-fb-clock-2025, I-L].
    playClock: { full: 40, short: 25 },
    segmentReset: { homeTimeouts: 'half', awayTimeouts: 'half' },
    timeouts: { full: 3, short: 0, per: 'half' },
  },
});

// ── Baseball / softball — F20 / F21 ───────────────────────────────────

const NFHS_BASEBALL_2027 = profile({
  id: 'nfhs-baseball',
  version: '2027',
  sport: 'baseball',
  label: 'NFHS high school baseball (2027)',
  association: 'NFHS',
  level: 'varsity',
  season: '2027',
  verification: 'source-checked',
  isDefault: true,
  sources: ['nfhs-baseball-rules', 'uil-baseball-regular', 'uil-baseball-post', 'nfhs-pitch-count'],
  notes: [
    'Run rules are the state association\'s (UIL: ten runs after five innings, four and a half with the home team ahead) — end the game by hand.',
    'The extra-inning tiebreaker (runner placed on second) is a state-adoption option — place the runner by hand.',
    'The pitch count is a display count only: each state association sets its own pitch limits and rest days, and this scoreboard does not decide eligibility.',
  ],
  rules: {
    // A regulation game is seven innings; extra innings keep counting
    // [nfhs-baseball-rules; uil-baseball-regular; uil-baseball-post].
    segment: { name: 'Inning', count: 7, overtime: true },
  },
});

const NFHS_SOFTBALL_2027 = profile({
  id: 'nfhs-softball',
  version: '2027',
  sport: 'softball',
  label: 'NFHS high school softball (2027)',
  association: 'NFHS',
  level: 'varsity',
  season: '2027',
  verification: 'source-checked',
  isDefault: true,
  sources: ['uil-softball-regular', 'nfhs-pitch-count'],
  notes: [
    'Run rules are the state association\'s (UIL: ten runs after five innings; optionally fifteen after three) — end the game by hand.',
    'The pitch count is a display count only, never an eligibility decision.',
  ],
  rules: {
    // Seven innings unless tied [uil-softball-regular].
    segment: { name: 'Inning', count: 7, overtime: true },
  },
});

// ── Soccer — F22 ──────────────────────────────────────────────────────

/** Shared by the NFHS soccer profiles: the clock counts DOWN and stops. */
const NFHS_SOCCER_NOTES = [
  'The clock counts down and stops for goals, penalty kicks, cards and whenever the referee signals — the table stops it; nothing is added at the end.',
  'Post-season tiebreakers (penalty kicks) are the state association\'s — record the result by hand.',
];

const NFHS_SOCCER_2025_26 = profile({
  id: 'nfhs-soccer',
  version: '2025-26',
  sport: 'soccer',
  label: 'NFHS high school soccer — two 40:00 halves (2025-26)',
  association: 'NFHS',
  level: 'varsity',
  season: '2025-26',
  verification: 'partial',
  isDefault: true,
  sources: ['nfhs-soccer-guide-2024-25', 'ohsaa-soccer-timekeeper', 'nfhs-soccer-2025-26'],
  unverified: [
    'Overtime as up to two 10:00 periods — NFHS leaves overtime to the state association (up to 20 minutes in all); confirm yours.',
    'Checked against the 2024-25 comparison guide and the 2025-26 change list; confirm against the 2026-27 book.',
  ],
  notes: NFHS_SOCCER_NOTES,
  rules: {
    // Two 40-minute periods on a clock that counts DOWN, the timer counting
    // the last ten seconds aloud [nfhs-soccer-guide-2024-25;
    // ohsaa-soccer-timekeeper]. Overtime: see `unverified`.
    clock: { type: 'countdown', segmentMs: 40 * MIN, otSegmentMs: 10 * MIN },
    segment: { name: 'Half', count: 2, overtime: true, maxOvertime: 2 },
    // The NFHS clock stops instead of adding time [nfhs-soccer-guide-2024-25].
    stats: { remove: ['addedTime'] },
  },
});

const NFHS_SOCCER_QUARTERS_2025_26 = profile({
  id: 'nfhs-soccer-quarters',
  version: '2025-26',
  sport: 'soccer',
  label: 'NFHS high school soccer — four 20:00 quarters (2025-26)',
  association: 'NFHS',
  level: 'any',
  season: '2025-26',
  variant: 'quarters',
  verification: 'partial',
  sources: ['nfhs-soccer-guide-2024-25', 'nfhs-soccer-2025-26'],
  unverified: [
    'Overtime as up to two 10:00 periods — the state association decides; confirm yours.',
  ],
  notes: NFHS_SOCCER_NOTES,
  rules: {
    // "Four 20-minute quarters" is the NFHS alternative to two 40-minute
    // periods [nfhs-soccer-guide-2024-25].
    clock: { type: 'countdown', segmentMs: 20 * MIN, otSegmentMs: 10 * MIN },
    segment: { name: 'Quarter', count: 4, overtime: true, maxOvertime: 2 },
    stats: { remove: ['addedTime'] },
  },
});

const OHSAA_SOCCER_JV_2025_26 = profile({
  id: 'ohsaa-soccer-jv',
  version: '2025-26',
  sport: 'soccer',
  label: 'OHSAA junior varsity soccer — two 36:00 halves',
  association: 'OHSAA',
  level: 'sub-varsity',
  season: '2025-26',
  verification: 'partial',
  sources: ['ohsaa-soccer-timekeeper', 'nfhs-soccer-guide-2024-25'],
  unverified: [
    'Junior-varsity overtime is not in the OHSAA timer guidance — overtime periods are 10:00 here; confirm.',
    'The OHSAA timer guidance is dated 2019; confirm it is current.',
  ],
  notes: [
    ...NFHS_SOCCER_NOTES,
    'OHSAA mercy procedure: in the second half, with a team six or more goals ahead, the referee does not stop the clock after a goal.',
  ],
  rules: {
    // Junior varsity: 36-minute halves, clock counting down
    // [ohsaa-soccer-timekeeper].
    clock: { type: 'countdown', segmentMs: 36 * MIN, otSegmentMs: 10 * MIN },
    segment: { name: 'Half', count: 2, overtime: true, maxOvertime: 2 },
    stats: { remove: ['addedTime'] },
  },
});

// ── Volleyball — F19 ──────────────────────────────────────────────────

/** Two time-outs per set, per team [uil-volleyball-rally]. */
const VOLLEYBALL_SET_TIMEOUTS: Pick<RulesDelta, 'timeouts' | 'segmentReset'> & {
  timeoutStats: SportStatField[];
} = {
  timeouts: { full: 2, short: 0, per: 'set' },
  segmentReset: { homeTimeouts: 'segment', awayTimeouts: 'segment' },
  timeoutStats: [
    { key: 'homeTimeouts', label: 'Home Timeouts', scope: 'home', type: 'number', min: 0, max: 2 },
    { key: 'awayTimeouts', label: 'Away Timeouts', scope: 'away', type: 'number', min: 0, max: 2 },
  ],
};

const NFHS_VOLLEYBALL_VARSITY_2026_27 = profile({
  id: 'nfhs-volleyball-varsity',
  version: '2026-27',
  sport: 'volleyball',
  label: 'High school varsity volleyball — best of 5 (2026-27)',
  association: 'NFHS',
  level: 'varsity',
  season: '2026-27',
  verification: 'source-checked',
  isDefault: true,
  sources: ['uil-volleyball-rally', 'nfhs-vb-2026-27'],
  notes: [
    'Match format checked against the UIL (Texas) varsity format; a state that plays varsity best of three picks the best-of-3 profile.',
    'A scoreboard, not an official scorebook: rotation, substitutions and the libero are the scorer\'s.',
  ],
  rules: {
    // Best of five; sets to 25, the fifth to 15; win by two; no cap
    // [uil-volleyball-rally — varsity].
    segment: { name: 'Set', count: 5, overtime: false },
    setFormat: { bestOf: 5, target: 25, decidingTarget: 15, winBy: 2 },
    timeouts: VOLLEYBALL_SET_TIMEOUTS.timeouts,
    segmentReset: VOLLEYBALL_SET_TIMEOUTS.segmentReset,
    stats: { add: VOLLEYBALL_SET_TIMEOUTS.timeoutStats, limits: { homeSets: { max: 3 }, awaySets: { max: 3 } } },
  },
});

const UIL_VOLLEYBALL_SUB_VARSITY_2026_27 = profile({
  id: 'uil-volleyball-sub-varsity',
  version: '2026-27',
  sport: 'volleyball',
  label: 'UIL sub-varsity volleyball — best of 3, cap 30',
  association: 'UIL',
  level: 'sub-varsity',
  season: '2026-27',
  verification: 'source-checked',
  sources: ['uil-volleyball-rally'],
  notes: ['A scoreboard, not an official scorebook: rotation, substitutions and the libero are the scorer\'s.'],
  rules: {
    // Best of three; every set to 25, win by two, capped at 30 — the third
    // set too [uil-volleyball-rally — sub-varsity].
    segment: { name: 'Set', count: 3, overtime: false },
    setFormat: { bestOf: 3, target: 25, decidingTarget: 25, winBy: 2, cap: 30, decidingCap: 30 },
    timeouts: VOLLEYBALL_SET_TIMEOUTS.timeouts,
    segmentReset: VOLLEYBALL_SET_TIMEOUTS.segmentReset,
    stats: { add: VOLLEYBALL_SET_TIMEOUTS.timeoutStats, limits: { homeSets: { max: 2 }, awaySets: { max: 2 } } },
  },
});

const UIL_VOLLEYBALL_JUNIOR_HIGH_2026_27 = profile({
  id: 'uil-volleyball-junior-high',
  version: '2026-27',
  sport: 'volleyball',
  label: 'UIL junior high volleyball — best of 3, cap 30',
  association: 'UIL',
  level: 'junior-high',
  season: '2026-27',
  verification: 'source-checked',
  sources: ['uil-volleyball-rally'],
  notes: [
    'By mutual consent the deciding set may be played after a 2-0 match: winning two sets does not end the match — tap End Game when you are done.',
  ],
  rules: {
    // Same format as sub-varsity; junior-high rules allow the third set by
    // mutual consent after a 2-0 match, so the match never ends itself
    // [uil-volleyball-rally — junior high].
    segment: { name: 'Set', count: 3, overtime: false },
    setFormat: { bestOf: 3, target: 25, decidingTarget: 25, winBy: 2, cap: 30, decidingCap: 30, autoFinal: false },
    timeouts: VOLLEYBALL_SET_TIMEOUTS.timeouts,
    segmentReset: VOLLEYBALL_SET_TIMEOUTS.segmentReset,
    stats: { add: VOLLEYBALL_SET_TIMEOUTS.timeoutStats, limits: { homeSets: { max: 3 }, awaySets: { max: 3 } } },
  },
});

// ── Pickleball — F19 (no listed source: every format is local) ────────

function pickleballFormat(
  variant: string,
  bestOf: number,
  target: number,
  label: string,
): RulesProfile {
  return profile({
    id: `pickleball-${variant}`,
    version: CLASSIC_RULES_VERSION,
    sport: 'pickleball',
    label,
    association: 'Local format',
    level: 'any',
    season: CLASSIC_RULES_VERSION,
    variant,
    verification: 'not-verified',
    sources: [],
    notes: ['Pickleball is not an NFHS sport: use the format your league or event sets. Games are won by two.'],
    rules: {
      segment: { name: 'Game', count: bestOf, overtime: false },
      setFormat: { bestOf, target, decidingTarget: target, winBy: 2 },
      stats: {
        limits: {
          homeGames: { max: Math.floor(bestOf / 2) + 1 },
          awayGames: { max: Math.floor(bestOf / 2) + 1 },
        },
      },
    },
  });
}

// ── Wrestling — F23 ───────────────────────────────────────────────────

/** NFHS Rule 6-7 overtime: a one-minute sudden victory, two 30-second
 *  tiebreakers, a 30-second ultimate tiebreaker [kshsaa-wrestling-2025-26]. */
const NFHS_WRESTLING_OVERTIME = {
  overtimeMs: [1 * MIN, 30_000, 30_000, 30_000],
  overtimeLabels: ['SV', 'TB1', 'TB2', 'UTB'],
};

const NFHS_WRESTLING_NOTES = [
  'Overtime is a one-minute sudden victory, then two 30-second tiebreakers, then a 30-second ultimate tiebreaker; a fall ends the match at any point.',
  'Injury, blood and recovery time are kept by the match timekeeper — this scoreboard does not time them.',
];

const NFHS_WRESTLING_2025_26 = profile({
  id: 'nfhs-wrestling',
  version: '2025-26',
  sport: 'wrestling',
  label: 'NFHS high school wrestling (2025-26)',
  association: 'NFHS',
  level: 'varsity',
  season: '2025-26',
  verification: 'partial',
  isDefault: true,
  sources: ['kshsaa-wrestling-2025-26', 'nfhs-wrestling-poster-2024-25', 'nfhs-wrestling-resources'],
  unverified: [
    'Three 2-minute regulation periods (engine default; the manual defers to the NFHS book).',
    'Team-point quick adds 3 / 4 / 5 / 6 (decision / major / technical fall / fall) (engine default).',
  ],
  notes: NFHS_WRESTLING_NOTES,
  rules: {
    clock: { type: 'countdown', segmentMs: 2 * MIN, overtimeMs: NFHS_WRESTLING_OVERTIME.overtimeMs },
    segment: {
      name: 'Period',
      count: 3,
      overtime: true,
      maxOvertime: 4,
      overtimeLabels: NFHS_WRESTLING_OVERTIME.overtimeLabels,
    },
    // No riding time in NFHS scoring [nfhs-wrestling-resources].
    stats: { remove: ['homeRideTime', 'awayRideTime'] },
  },
});

const KSHSAA_WRESTLING_MS_2025_26 = profile({
  id: 'kshsaa-wrestling-ms',
  version: '2025-26',
  sport: 'wrestling',
  label: 'KSHSAA 7th/8th grade wrestling — 1:00, 1:30, 1:30',
  association: 'KSHSAA',
  level: 'junior-high',
  season: '2025-26',
  verification: 'source-checked',
  sources: ['kshsaa-wrestling-2025-26', 'nfhs-wrestling-resources'],
  notes: [...NFHS_WRESTLING_NOTES, 'Consolation-round periods are one minute each — set the clock by hand.'],
  rules: {
    // Seventh/eighth grade: 1:00, 1:30, 1:30; overtime per the NFHS book
    // [kshsaa-wrestling-2025-26].
    clock: {
      type: 'countdown',
      segmentMs: 90_000,
      periodMs: [1 * MIN, 90_000, 90_000],
      overtimeMs: NFHS_WRESTLING_OVERTIME.overtimeMs,
    },
    segment: {
      name: 'Period',
      count: 3,
      overtime: true,
      maxOvertime: 4,
      overtimeLabels: NFHS_WRESTLING_OVERTIME.overtimeLabels,
    },
    stats: { remove: ['homeRideTime', 'awayRideTime'] },
  },
});

// ── Lacrosse — F24 ────────────────────────────────────────────────────

const BOYS_LAX_UNVERIFIED = [
  'Four 12-minute quarters, and overtime periods of the same length (engine default).',
  'Penalty-box presets: technical 0:30, personal 1:00 / 2:00 / 3:00 (engine default).',
  'Team time-outs are not tracked.',
];

const NFHS_LACROSSE_BOYS_2027 = profile({
  id: 'nfhs-lacrosse-boys',
  version: '2027',
  sport: 'lacrosse',
  label: 'NFHS boys lacrosse (2027)',
  association: 'NFHS',
  level: 'varsity',
  division: 'boys',
  season: '2027',
  verification: 'partial',
  isDefault: true,
  sources: ['nfhs-blax-shot-clock-2027'],
  unverified: BOYS_LAX_UNVERIFIED,
  notes: [
    'The 70-second shot clock is used only where the state association adopted it (pick it at setup); otherwise it stays off.',
    'The 60-second offensive-half requirement and the 20-second clearing count are the officials\'; the scoreboard shows the 70-second clock.',
  ],
  rules: {
    clock: { type: 'countdown', segmentMs: 12 * MIN },
    segment: { name: 'Quarter', count: 4, overtime: true },
    // By state adoption, a 70-second shot clock from the 2027 season
    // [nfhs-blax-shot-clock-2027]: OFF unless picked, full resets only.
    shotClock: { full: 70, short: 0, options: [0, 70], defaultLen: 0 },
    segmentReset: { shotClock: true },
  },
});

const NFHS_LACROSSE_BOYS_2026 = profile({
  id: 'nfhs-lacrosse-boys',
  version: '2026',
  sport: 'lacrosse',
  label: 'NFHS boys lacrosse (2026 — no shot clock)',
  association: 'NFHS',
  level: 'varsity',
  division: 'boys',
  season: '2026',
  variant: 'no-shot-clock',
  verification: 'partial',
  sources: ['nfhs-blax-shot-clock-2027'],
  unverified: BOYS_LAX_UNVERIFIED,
  notes: ['The state-option shot clock begins with the 2027 season; a 2026 game has none.'],
  rules: {
    clock: { type: 'countdown', segmentMs: 12 * MIN },
    segment: { name: 'Quarter', count: 4, overtime: true },
    // The shot clock is a 2027 state option — not retroactive
    // [nfhs-blax-shot-clock-2027].
    shotClock: null,
    segmentReset: null,
  },
});

const NFHS_LACROSSE_GIRLS_2027 = profile({
  id: 'nfhs-lacrosse-girls',
  version: '2027',
  sport: 'lacrosse',
  label: 'NFHS girls lacrosse (2027)',
  association: 'NFHS',
  level: 'varsity',
  division: 'girls',
  season: '2027',
  verification: 'partial',
  sources: ['nfhs-glax-resources'],
  unverified: [
    'Quarter length 12:00 and overtime periods of the same length (the timers\' rules name quarters but not their length).',
    'Team time-outs are not tracked (a time-out lasts two minutes).',
  ],
  notes: [
    'The 90-second possession clock is used only where the state association adopted it (pick it at setup); it only ever resets to 90.',
    'With a ten-goal differential the clock keeps running after goals and in the last minute (except for time-outs).',
  ],
  rules: {
    clock: { type: 'countdown', segmentMs: 12 * MIN },
    segment: { name: 'Quarter', count: 4, overtime: true },
    // A 90-second possession clock by state adoption, reset to 90 only
    // [nfhs-glax-resources — 2027 possession clock].
    shotClock: { full: 90, short: 0, options: [0, 90], defaultLen: 0, label: 'Possession clock' },
    segmentReset: { shotClock: true },
    // Yellow card two minutes, red card four minutes, green/yellow delay
    // card two minutes of elapsed playing time [nfhs-glax-resources —
    // timers' Rule 3-7].
    penaltyBox: {
      label: 'Cards',
      presets: [
        { label: 'Yellow 2:00', sec: 120 },
        { label: 'Red 4:00', sec: 240 },
        { label: 'Delay card 2:00', sec: 120 },
      ],
    },
  },
});

// ── Ice hockey, field hockey, water polo — F25 (basics, not verified) ──

const NFHS_ICE_HOCKEY_2026_27 = profile({
  id: 'nfhs-ice-hockey',
  version: '2026-27',
  sport: 'hockey',
  label: 'High school ice hockey (2026-27 — not verified)',
  association: 'NFHS',
  level: 'varsity',
  season: '2026-27',
  verification: 'not-verified',
  isDefault: true,
  sources: ['nfhs-ice-hockey-resources'],
  unverified: [
    'Three 17-minute periods (engine default).',
    'Overtime periods of 8:00 — overtime is a state-association adoption; confirm the length.',
    'One time-out per team per game.',
    'Penalty lengths: minor 2:00, double minor 4:00, major 5:00, misconduct 10:00 (engine default); coincidental and delayed penalties are run by hand.',
    'Tenths in the final minute (engine default).',
  ],
  notes: ['The 2026-27 NFHS book and your state\'s overtime adoption govern; no listed source states these values.'],
  rules: {
    clock: { type: 'countdown', segmentMs: 17 * MIN, otSegmentMs: 8 * MIN, tenths: true },
    segment: { name: 'Period', count: 3, overtime: true },
    timeouts: { full: 1, short: 0, per: 'game' },
    stats: {
      add: [
        { key: 'homeTimeouts', label: 'Home Timeouts', scope: 'home', type: 'number', min: 0, max: 1 },
        { key: 'awayTimeouts', label: 'Away Timeouts', scope: 'away', type: 'number', min: 0, max: 1 },
      ],
    },
  },
});

const NFHS_FIELD_HOCKEY_2026 = profile({
  id: 'nfhs-field-hockey',
  version: '2026',
  sport: 'field_hockey',
  label: 'High school field hockey (2026 — not verified)',
  association: 'NFHS',
  level: 'varsity',
  season: '2026',
  verification: 'not-verified',
  isDefault: true,
  sources: ['nfhs-field-hockey-resources'],
  unverified: [
    'Four 15-minute quarters (engine default).',
    'Overtime periods of 10:00 — overtime is the state\'s choice; confirm it (it is no longer a full 15:00 quarter).',
    'Card suspensions green 2:00, yellow 5:00 / 10:00 (engine default).',
  ],
  notes: ['Shootouts and team time-outs are run by hand.'],
  rules: {
    clock: { type: 'countdown', segmentMs: 15 * MIN, otSegmentMs: 10 * MIN },
    segment: { name: 'Quarter', count: 4, overtime: true },
  },
});

const NFHS_WATER_POLO_2026_28 = profile({
  id: 'nfhs-water-polo',
  version: '2026-28',
  sport: 'water_polo',
  label: 'High school water polo (2026-28 — not verified)',
  association: 'NFHS',
  level: 'varsity',
  season: '2026-28',
  verification: 'not-verified',
  isDefault: true,
  sources: ['nfhs-water-polo-scoresheet'],
  unverified: [
    'Seven-minute quarters as the default (the other lengths stay selectable).',
    'Overtime periods of 3:00 (engine default).',
    'One bank of three time-outs: the NFHS score sheet records full and 30-second time-outs separately, and their allocation is in the 2026-28 book — not in the source list.',
    'Shot clock 30 s with a 20 s reset; exclusion 0:20, misconduct 4:00 (engine default).',
  ],
  notes: ['Exclusion re-entry and misconduct administration are the officials\' — the penalty box times them.'],
  rules: {
    clock: { type: 'countdown', segmentMs: 7 * MIN, otSegmentMs: 3 * MIN, tenths: true },
    segment: { name: 'Quarter', count: 4, overtime: true },
    timeouts: { full: 3, short: 0, per: 'game' },
  },
});

// ── The catalog ───────────────────────────────────────────────────────

const CURATED_PROFILES: RulesProfile[] = [
  NFHS_BASKETBALL_2026_27,
  NFHS_FOOTBALL_2025,
  NFHS_BASEBALL_2027,
  NFHS_SOFTBALL_2027,
  NFHS_SOCCER_2025_26,
  NFHS_SOCCER_QUARTERS_2025_26,
  OHSAA_SOCCER_JV_2025_26,
  NFHS_VOLLEYBALL_VARSITY_2026_27,
  UIL_VOLLEYBALL_SUB_VARSITY_2026_27,
  UIL_VOLLEYBALL_JUNIOR_HIGH_2026_27,
  pickleballFormat('bo1-15', 1, 15, 'Pickleball — one game to 15 (local format)'),
  pickleballFormat('bo1-21', 1, 21, 'Pickleball — one game to 21 (local format)'),
  pickleballFormat('bo3-15', 3, 15, 'Pickleball — best of 3 games to 15 (local format)'),
  NFHS_WRESTLING_2025_26,
  KSHSAA_WRESTLING_MS_2025_26,
  NFHS_LACROSSE_BOYS_2027,
  NFHS_LACROSSE_BOYS_2026,
  NFHS_LACROSSE_GIRLS_2027,
  NFHS_ICE_HOCKEY_2026_27,
  NFHS_FIELD_HOCKEY_2026,
  NFHS_WATER_POLO_2026_28,
];

/**
 * Every published profile: the curated ones above, then one CLASSIC profile
 * per sport (the base definition). Order = the order the setup picker shows.
 */
export const RULES_PROFILES: readonly RulesProfile[] = Object.freeze([
  ...CURATED_PROFILES,
  ...Object.values(SPORT_DEFINITIONS).map(classicProfile),
]);

const PROFILES_BY_KEY: ReadonlyMap<string, RulesProfile> = new Map(
  RULES_PROFILES.map((p) => [p.key, p] as const),
);

/** A published profile by key, or undefined. */
export function findRulesProfile(key: string | null | undefined): RulesProfile | undefined {
  return key ? PROFILES_BY_KEY.get(key) : undefined;
}

/** The CLASSIC profile key of a sport. */
export function classicRulesKey(sportKey: string): string {
  return `classic-${sportKey}@${CLASSIC_RULES_VERSION}`;
}

/**
 * The profile a new game binds when the table picks none: the sport's
 * curated default, else its classic rules (every sport has one).
 */
export function defaultRulesProfile(sportKey: string): RulesProfile | undefined {
  const def = findSport(sportKey);
  if (!def) return undefined;
  return (
    RULES_PROFILES.find((p) => p.sport === def.key && p.isDefault && p.selectable) ??
    findRulesProfile(classicRulesKey(def.key))
  );
}

/**
 * The profiles a NEW game of `sportKey` may bind: the default first, then the
 * rest in catalog order (curated profiles before the classic rules).
 */
export function rulesProfilesForSport(sportKey: string | null | undefined): RulesProfile[] {
  if (!sportKey) return [];
  const list = RULES_PROFILES.filter((p) => p.sport === sportKey && p.selectable);
  const first = defaultRulesProfile(sportKey);
  if (!first || !list.includes(first)) return list;
  return [first, ...list.filter((p) => p !== first)];
}

// ════════════════════════════════════════════════════════════════════
// A game's effective definition
// ════════════════════════════════════════════════════════════════════

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Read a stored snapshot (from the database, or a board payload), or null
 * when there is none / it is not a snapshot of this sport. A null means
 * "classic rules" — never an error on a live surface.
 */
export function parseGameRules(raw: unknown, sportKey?: string | null): GameRules | null {
  if (!isRecord(raw)) return null;
  if (raw.v !== 1 || typeof raw.profile !== 'string' || typeof raw.sport !== 'string') return null;
  if (sportKey && raw.sport !== sportKey) return null;
  if (!isRecord(raw.clock) || !isRecord(raw.segment) || !Array.isArray(raw.stats)) return null;
  if (typeof raw.segment.count !== 'number' || typeof raw.segment.name !== 'string') return null;
  return raw as unknown as GameRules;
}

/** A base definition running a snapshot's rules. */
export function applyGameRules(base: SportDefinition, rules: GameRules): SportDefinition {
  const def: SportDefinition = {
    ...base,
    clock: { ...rules.clock },
    segment: { ...rules.segment },
    stats: rules.stats.map((s) => ({ ...s })),
    rulesProfile: { key: rules.profile, label: rules.label },
  };
  const blocks = [
    'shotClock',
    'playClock',
    'segmentReset',
    'teamFouls',
    'timeouts',
    'setFormat',
    'penaltyBox',
  ] as const;
  for (const k of blocks) {
    const v = rules[k];
    if (v === null || v === undefined) delete (def as unknown as Record<string, unknown>)[k];
    else (def as unknown as Record<string, unknown>)[k] = { ...(v as object) };
  }
  return def;
}

// Memo: one definition object per snapshot object, so a surface that asks
// every render gets a stable reference (and pays for the merge once) — and
// one per snapshot CONTENT, so a board that re-parses the same rules on
// every poll still gets the same definition object (effects keyed on it do
// not re-run every 750 ms).
const effectiveCache = new WeakMap<object, SportDefinition>();
const contentCache = new Map<string, SportDefinition>();
const CONTENT_CACHE_MAX = 64;

/**
 * K12-F01 — THE definition a game runs: its sport with its bound rules
 * snapshot applied, or the classic base definition for a game with no
 * snapshot. Every engine path and every surface that renders or validates a
 * GAME must use this — `findSport(game.sport)` ignores the game's rules.
 */
export function sportForGame(
  game: { sport?: string | null; rules?: unknown } | null | undefined,
): SportDefinition | undefined {
  const base = findSport(game?.sport ?? null);
  if (!base) return undefined;
  const raw = game?.rules;
  if (!isRecord(raw)) return base;
  const hit = effectiveCache.get(raw);
  if (hit) return hit;
  const rules = parseGameRules(raw, base.key);
  let def = base;
  if (rules) {
    const key = `${base.key}|${JSON.stringify(rules)}`;
    const same = contentCache.get(key);
    if (same) {
      def = same;
    } else {
      def = applyGameRules(base, rules);
      if (contentCache.size >= CONTENT_CACHE_MAX) contentCache.clear();
      contentCache.set(key, def);
    }
  }
  effectiveCache.set(raw, def);
  return def;
}

/** What a surface says about a game's rules (the setup / console line). */
export interface GameRulesInfo {
  /** The bound profile key; null = created before profiles (classic rules). */
  key: string | null;
  label: string;
  verification: RulesVerification;
  /** The catalog entry, while that key is still published. */
  profile: RulesProfile | null;
}

export function gameRulesInfo(
  game: { sport?: string | null; rules?: unknown } | null | undefined,
): GameRulesInfo {
  const def = findSport(game?.sport ?? null);
  const rules = parseGameRules(game?.rules, def?.key ?? null);
  if (!rules) {
    const classic = def ? findRulesProfile(classicRulesKey(def.key)) ?? null : null;
    return {
      key: null,
      label: classic?.label ?? 'Classic scoreboard rules (not verified)',
      verification: 'not-verified',
      profile: classic,
    };
  }
  const profile = findRulesProfile(rules.profile) ?? null;
  return {
    key: rules.profile,
    label: rules.label,
    verification: profile?.verification ?? 'not-verified',
    profile,
  };
}

// ════════════════════════════════════════════════════════════════════
// Rule helpers — the ONE implementation the API and every surface share
// ════════════════════════════════════════════════════════════════════

/** The engine's cap on overtime periods when the rules name none. */
export const DEFAULT_MAX_OVERTIME = 10;

/** The highest segment a game may reach (regulation + allowed overtime). */
export function maxSegment(def: SportDefinition): number {
  if (!def.segment.overtime) return def.segment.count;
  const ot = def.segment.maxOvertime;
  return def.segment.count + (typeof ot === 'number' && ot >= 0 ? ot : DEFAULT_MAX_OVERTIME);
}

/**
 * The clock length of `segment` (1-based): a per-period regulation length,
 * a finite overtime sequence, the overtime length, the per-game length the
 * table picked at setup (validated against the sport's options), else the
 * sport's segment length. 0 for a clockless sport.
 */
export function segmentLengthMs(def: SportDefinition, stats?: unknown, segment?: number): number {
  if (def.clock.type === 'none') return 0;
  const n = typeof segment === 'number' && Number.isFinite(segment) ? segment : 1;
  if (n > def.segment.count && def.segment.overtime) {
    const ot = n - def.segment.count;
    const seq = def.clock.overtimeMs;
    if (Array.isArray(seq) && seq.length > 0) return seq[Math.min(ot, seq.length) - 1];
    if (typeof def.clock.otSegmentMs === 'number') return def.clock.otSegmentMs;
  } else if (Array.isArray(def.clock.periodMs) && def.clock.periodMs.length > 0 && n >= 1) {
    return def.clock.periodMs[Math.min(n, def.clock.periodMs.length) - 1];
  }
  const override = isRecord(stats) ? stats.clockSegmentMs : undefined;
  if (typeof override === 'number' && def.clock.segmentMsOptions?.some((o) => o.ms === override)) {
    return override;
  }
  return def.clock.segmentMs ?? 0;
}

/**
 * The overtime period name for `segment`, or null when `segment` is not an
 * overtime period: the rules' own names (NFHS wrestling SV / TB1 / TB2 / UTB),
 * else OT, OT2, OT3 …
 */
export function overtimeLabel(def: SportDefinition, segment: number): string | null {
  if (!def.segment.overtime || segment <= def.segment.count) return null;
  const ot = segment - def.segment.count;
  const named = def.segment.overtimeLabels;
  if (Array.isArray(named) && named[ot - 1]) return named[ot - 1];
  return ot > 1 ? `OT${ot}` : 'OT';
}

/**
 * The CLASSIC basketball bonus lamp — what every surface showed before rules
 * profiles (bonus at 7 team fouls, double bonus at 10, counted per period).
 * Kept only for games with no bound profile.
 */
const CLASSIC_BASKETBALL_FOULS: TeamFoulRules = { bonusAt: 7, doubleBonusAt: 10, carryIntoOvertime: false };

/** The team-foul rules a game runs (null = the sport keeps no team fouls). */
export function teamFoulRules(def: SportDefinition | null | undefined): TeamFoulRules | null {
  if (!def) return null;
  if (def.teamFouls) return def.teamFouls;
  return def.key === 'basketball' ? CLASSIC_BASKETBALL_FOULS : null;
}

function statNum(stats: unknown, key: string): number {
  const v = isRecord(stats) ? stats[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * K12-F04 — is `side` IN THE BONUS (does it shoot free throws on the next
 * common foul)? That is decided by the OPPONENT's team fouls this period:
 * with HOME on five fouls and AWAY on two, AWAY is in the bonus. Returns the
 * lamp to light, or null.
 */
export function teamBonus(
  def: SportDefinition | null | undefined,
  side: 'home' | 'away',
  stats: unknown,
): 'BONUS' | 'DOUBLE BONUS' | null {
  const rules = teamFoulRules(def);
  if (!rules) return null;
  const opponentFouls = statNum(stats, side === 'home' ? 'awayFouls' : 'homeFouls');
  if (typeof rules.doubleBonusAt === 'number' && opponentFouls >= rules.doubleBonusAt) return 'DOUBLE BONUS';
  return opponentFouls >= rules.bonusAt ? 'BONUS' : null;
}

/**
 * The team-foul lamp for a TEAM'S OWN count (the scorer's view on a fouls
 * row): whether this many fouls has put the opponent in the bonus.
 */
export function foulsReachBonus(
  def: SportDefinition | null | undefined,
  fouls: number,
): 'BONUS' | 'DOUBLE BONUS' | null {
  const rules = teamFoulRules(def);
  if (!rules) return null;
  if (typeof rules.doubleBonusAt === 'number' && fouls >= rules.doubleBonusAt) return 'DOUBLE BONUS';
  return fouls >= rules.bonusAt ? 'BONUS' : null;
}

/** A team-foul count as a scoreboard shows it (the rules' display cap). */
export function displayTeamFouls(def: SportDefinition | null | undefined, fouls: number): number {
  const n = Math.max(0, Math.floor(Number.isFinite(fouls) ? fouls : 0));
  const cap = teamFoulRules(def)?.displayCap;
  return typeof cap === 'number' ? Math.min(cap, n) : n;
}

/** The stats key of a side's short-timeout sub-bank. */
export function shortTimeoutKey(side: 'home' | 'away'): 'homeShortTimeouts' | 'awayShortTimeouts' {
  return side === 'home' ? 'homeShortTimeouts' : 'awayShortTimeouts';
}

/**
 * How many timeouts a team starts a bank with (the game, a half, a set): the
 * profile's full + short allocation, else the classic stat maximum.
 */
export function timeoutAllocation(def: SportDefinition): number {
  if (def.timeouts) return def.timeouts.full + def.timeouts.short;
  const field = def.stats.find((s) => s.key === 'homeTimeouts');
  return typeof field?.max === 'number' ? field.max : 3;
}

/**
 * K12-F03 — a team's timeouts LEFT by kind. `homeTimeouts` is the total (what
 * boards show); the short sub-bank can never exceed it. A classic game (no
 * profile banks) reports everything as full.
 */
export function timeoutBanks(
  def: SportDefinition | null | undefined,
  side: 'home' | 'away',
  stats: unknown,
): { total: number; full: number; short: number } {
  const total = Math.max(0, statNum(stats, side === 'home' ? 'homeTimeouts' : 'awayTimeouts'));
  if (!def?.timeouts || def.timeouts.short <= 0) return { total, full: total, short: 0 };
  const raw = isRecord(stats) ? stats[shortTimeoutKey(side)] : undefined;
  const stored = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : def.timeouts.short;
  const short = Math.min(stored, total);
  return { total, full: total - short, short };
}

/** The set / game format of a set-scored sport (null for every other). */
export function setFormatOf(def: SportDefinition | null | undefined): SetFormatRules | null {
  return def?.setFormat ?? null;
}

/** Sets (games) a side needs to win the match. */
export function setsToWin(format: SetFormatRules): number {
  return Math.floor(format.bestOf / 2) + 1;
}

/**
 * K12-F19 — who has won the set at this score, if anyone: the target by the
 * winning margin, or the cap by any margin. `deciding` = the last possible
 * set (its own target / cap).
 */
export function setWinner(
  format: SetFormatRules,
  deciding: boolean,
  home: number,
  away: number,
): 'home' | 'away' | null {
  const target = deciding ? format.decidingTarget : format.target;
  const cap = deciding ? (format.decidingCap ?? format.cap) : format.cap;
  const lead = home - away;
  if (home >= target && lead >= format.winBy) return 'home';
  if (away >= target && -lead >= format.winBy) return 'away';
  if (typeof cap === 'number') {
    if (home >= cap && lead >= 1) return 'home';
    if (away >= cap && -lead >= 1) return 'away';
  }
  return null;
}

/** The label a table uses for the sport's shot / possession clock. */
export function shotClockLabel(def: SportDefinition | null | undefined): string {
  return def?.shotClock?.label ?? 'Shot clock';
}
