/**
 * VenueOS Sports — Sprint 13. The Sport Engine.
 *
 * One declarative `SportDefinition` per sport drives the whole
 * scoreboard + game-control system: the clock model, the segment
 * structure (quarters / innings / sets / periods), the score
 * increments, the sport-specific stat fields, and the celebration
 * cues. The scoreboard renderer and the operator control surface are
 * both data-driven off this — adding a new sport is a new entry
 * here, not new UI code.
 *
 * Shipped set (12 sports, every clock model): football, basketball,
 * baseball, softball, soccer, volleyball, wrestling, hockey, lacrosse,
 * field hockey, water polo, pickleball — covering the vast majority
 * of US high-school + rec athletics. Leaderboard meet sports (track,
 * swimming, gymnastics) land with SportMode 'LEADERBOARD' in a later
 * wave — the schema already carries the `mode` field for them.
 */

export type ClockType = 'countdown' | 'countup' | 'none';
export type SportMode = 'HEAD_TO_HEAD' | 'LEADERBOARD';

/** A sport-specific stat the operator can set during a game. */
export interface SportStatField {
  /** stable key, stored in Game.stats JSON */
  key: string;
  label: string;
  /** whose stat — a game-wide value or a per-team value */
  scope: 'game' | 'home' | 'away';
  type: 'number' | 'text';
  /** for number fields — clamp range on the control */
  min?: number;
  max?: number;
}

/** A celebration cue — the operator taps it, every surface fires it. */
export interface SportCelebration {
  key: string;
  label: string;
  emoji: string;
  /**
   * AUTO trigger (Sprint 13). When a live score FEED reports a score
   * INCREASE of one of these point values for a team, this celebration
   * auto-fires for that team — "a feed reporting 14→21 fires the touchdown
   * cue itself." Set ONLY on standout, delta-unambiguous moments
   * (touchdown, three-pointer, goal, grand slam); NEVER on routine scoring
   * (every basketball bucket, every volleyball rally) or on moments a score
   * delta can't reveal (sack, steal, pin, solo home run). Manual operation
   * — the +/- console buttons (adjustScore) and the celebration launchpad
   * (fireCue) — is unaffected: AUTO fires only from the machine feed ingest
   * path, and only when the per-game toggle is on (default on).
   */
  autoPoints?: number[];
}

/**
 * A fired cue as it appears in the board's `cues[]` poll feed.
 * All three ad-ops fields are always present (null when not supplied
 * at fire time) so surfaces can check them without `undefined` guards.
 */
export interface FiredCue {
  id: string;
  key: string;
  label: string;
  emoji?: string;
  color?: string | null;
  mediaUrl?: string | null;
  durationMs?: number;
  custom?: boolean;
  target: 'BOARD' | 'RIBBON' | 'ALL';
  /**
   * T2-6 — When true, the ribbon surface renders a tight 2.5s text-crawl
   * strip (RibbonCelebrationStrip) instead of the full 4500ms cinematic
   * takeover. Scoreboard is unaffected — it always plays the full cinematic.
   *
   * Fires automatically when the operator uses the inline cue bar's
   * "Ribbon" chip; can also be sent explicitly via the API.
   *
   * Common cues where this matters: 'touchdown', 'three-pointer', 'goal'
   * fired with target: 'RIBBON'. A scoreboard-targeted cue ignores this
   * field entirely.
   */
  ribbonStrip?: boolean;
  snapshot?: Record<string, unknown>;
  /** URL of a sound clip to play when this cue fires. */
  audioUrl: string | null;
  /** Sponsor display name for co-branded celebration overlays. */
  sponsorName: string | null;
  /** Sponsor logo URL for co-branded celebration overlays. */
  sponsorLogoUrl: string | null;
  createdAt: string | Date;
}

/**
 * One live penalty in a game's penalty box, stored in the array at
 * Game.stats.penalties. Each penalty is its own anchor — projected
 * down like the game clock — and runs / freezes WITH the game clock
 * (a whistle stops play, the box, and the game clock together).
 */
export interface GamePenalty {
  id: string;
  team: 'home' | 'away';
  /** infraction name — "Minor", "Major", … (from the sport's presets) */
  label: string;
  /** the penalized player's jersey number, or '' if not entered */
  player: string;
  /** remaining ms at the anchor instant `at` */
  ms: number;
  /** ISO timestamp the `ms` reading was taken */
  at: string;
  /** counting down (true) or frozen at a stoppage (false) */
  running: boolean;
}

/**
 * Per-segment auto-reset rules (T2-10). Applied by `setSegment` and
 * `autoAdvanceExpiredClocks` on every segment advance.
 *
 * - `homeFouls` / `awayFouls` — reset to 0 on every new segment
 *   (basketball periods, hockey periods, etc.).
 * - `homeTimeouts` / `awayTimeouts` — reset policy:
 *     'segment' — reset at every segment boundary (rare; most sports don't)
 *     'half'    — reset at the midpoint (after segment count/2 — e.g.
 *                 halftime in football/basketball, after Q2 or P3)
 *     'never'   — never auto-reset (water polo full-game timeout bank)
 * - `shotClock` — if true, the shot clock is reset to its configured
 *   full length and stopped when the segment advances.
 *
 * A sport WITHOUT this field behaves exactly as before: no resets.
 */
export interface SegmentResetRules {
  homeFouls?: boolean;
  awayFouls?: boolean;
  homeTimeouts?: 'half' | 'segment' | 'never';
  awayTimeouts?: 'half' | 'segment' | 'never';
  shotClock?: boolean;
}

export interface SportDefinition {
  key: string;
  name: string;
  emoji: string;
  mode: SportMode;
  /** countdown = clock runs to 0 (US football/basketball); countup =
   *  clock counts up (soccer); none = no clock (baseball/volleyball).
   *  `segmentMsOptions` — when present, the operator picks the regulation
   *  period length at game creation (e.g. water polo 8:00 NCAA vs 7:00
   *  NFHS HS vs shorter age-group quarters). The pick is stored per-game
   *  as `stats.clockSegmentMs` (validated against this list) and every
   *  clock reset honors it; `segmentMs` stays the default. Omitted = the
   *  length is fixed.
   *  `otSegmentMs` — overtime period length when it differs from
   *  regulation (water polo OT is 3:00, not another 8:00). Resets past
   *  the regulation segment count use this instead of `segmentMs`. */
  clock: {
    type: ClockType;
    segmentMs?: number;
    segmentMsOptions?: { label: string; ms: number }[];
    otSegmentMs?: number;
  };
  /** the period structure — "Quarter" × 4, "Inning" × 7, "Set" × 5 …
   *  `countOptions` — when present, the operator picks the regulation
   *  segment count at setup (e.g. golf 9-hole vs 18-hole HS matches).
   *  `count` is the default; the chosen value is stored per-game and
   *  the surfaces clamp / label off it. Omitted = the count is fixed. */
  segment: { name: string; count: number; overtime: boolean; countOptions?: number[] };
  /** score unit + the increments the control offers as quick buttons */
  score: { unit: string; increments: number[] };
  /**
   * Decimal places the DISPLAYED score carries — for judged sports whose
   * team total is a decimal (gymnastics 195.825, competitive cheer 285.5).
   *
   * The DB column `Game.homeScore` / `awayScore` is an `Int`, so we never
   * migrate: the stored value is a SCALED integer — the decimal score
   * times `10 ** scoreDecimals` (195.825 → 195825 at 3 dp). Every render
   * site runs the stored int back through {@link formatScore}, and the
   * console enters an absolute total via {@link parseScoreInput}.
   *
   * `undefined` = an integer sport: the stored int IS the score, and
   * {@link formatScore} / {@link parseScoreInput} are the identity (modulo
   * rounding) — so EVERY existing sport behaves exactly as it did before.
   * Score COMPARISONS (leadingSide / winner highlight) always run on the
   * raw scaled int and are correct without formatting.
   */
  scoreDecimals?: number;
  /**
   * Some sports run TWO score layers at once — the head-to-head match
   * score the +/- chips drive (e.g. a single wrestler's match points)
   * AND a separate team tally the venue actually shows (e.g. a dual
   * meet's running team score). When present, the surfaces render a
   * dedicated team-points line and the operator gets its own quick-add
   * set so match-points and team-points are never conflated.
   *
   * `homeKey` / `awayKey` are the Game.stats JSON keys the team tally
   * lives under; `increments` are the team-points quick-add buttons
   * (distinct from `score.increments`, which stays the per-bout set).
   */
  teamScore?: {
    /** short label for the team tally line, e.g. "Team Score" / "Dual" */
    label: string;
    homeKey: string;
    awayKey: string;
    increments: number[];
  };
  stats: SportStatField[];
  celebrations: SportCelebration[];
  /**
   * Auto-reset rules applied on every segment advance (T2-10).
   * Absent = no auto-resets (fully backwards-compatible).
   */
  segmentReset?: SegmentResetRules;
  /** Sports with a timed penalty box — hockey, lacrosse, field
   *  hockey, water polo. `presets` are the quick-pick infraction
   *  durations the operator picks from; the penalty clock counts
   *  that player out and runs / freezes with the game clock.
   *  Omitted for sports with no timed penalty (football, basketball,
   *  soccer — a soccer red card removes a player but starts no
   *  timer). */
  penaltyBox?: {
    label: string;
    presets: { label: string; sec: number }[];
  };
  /** Sports with a possession/shot clock that runs alongside the game
   *  clock — basketball (24/14), water polo (30/20), lacrosse (80/60),
   *  etc. `full` = reset-to-full seconds; `short` = the short reset
   *  (offensive rebound / change of possession). `options` are the
   *  lengths the setup picker offers (0 = off). Omitted for sports with
   *  no shot clock — the console then hides the shot-clock controls. */
  shotClock?: {
    full: number;
    short: number;
    options: number[];
  };
  /**
   * Sports scored by a live panel of judges (diving today; gymnastics/
   * cheer's judged totals are hand-typed directly as the apparatus/routine
   * mark, so they don't need a panel UI). `defaultCount` seeds the
   * console's judge pad; the operator's actual choice for a given game is
   * remembered on `Game.stats.judgeCount` (a normal scalar sport-stat, NOT
   * sport-def config) so two meets on the same sport def can run different
   * panel sizes (a 3-judge dual meet vs. a 5-judge invite). `options` are
   * the sizes the console's selector offers — NFHS panels are 3, 5, or 7
   * (even, so ties never split the drop-high/low). Omitted = no sport
   * currently needs a judge-panel UI beyond the hand-typed score.
   */
  judgePanel?: {
    defaultCount: number;
    options: number[];
  };
}

export type GameStatus = 'SCHEDULED' | 'PRE_GAME' | 'LIVE' | 'HALFTIME' | 'FINAL';

// ── Structured stat shapes (stored on Game.stats JSON; NO migration) ──
/**
 * VenueOS Sports — three structured stat blobs the operator console
 * WRITES and every board surface READS. They ride on the existing
 * `Game.stats` JSON column alongside the scalar stat keys — no Prisma
 * migration, fully additive. The api owns validation (see
 * `SportsService.updateStats`): each top array is capped at 64 entries,
 * each nested array at 64, every string field sanitized to ≤64 chars,
 * and every number coerced to a finite int in sane bounds. Malformed
 * members are dropped, not rejected, so one bad row never voids the set.
 *
 * Strings the operator types are display-as-typed — `mark` carries a
 * free-form result ("1:52.31", "9.850", "142-06", "72 (+1)") and the
 * board renders it verbatim.
 */

/** One athlete/team line within a {@link MeetResult} finish event. */
export interface ResultEntry {
  /** finish place — 1 = winner. Sort key for the event's rows. */
  place: number;
  /** athlete or relay/team name — display-as-typed. */
  name: string;
  /** which side it counts for (dual meets), or null/absent for invites. */
  team?: 'home' | 'away' | null;
  /** lane / heat lane (track, swim) — optional. */
  lane?: number;
  /** the free-form result string: time / score / distance / strokes. */
  mark: string;
}

/**
 * A finish event's results — for LEADERBOARD sports (track / swim /
 * cross-country / golf) AND for gymnastics / cheer per-apparatus, where
 * `event` is the apparatus name ("Vault") and each `mark` is the decimal
 * score ("9.850"). `entries` is sorted by `entry.place`.
 */
export interface MeetResult {
  /** event / apparatus name — display-as-typed ("100 Free", "Vault"). */
  event: string;
  /** optional display order within the meet. */
  order?: number;
  entries: ResultEntry[];
}

/**
 * Basketball foul-trouble — a per-player running foul count. 5 fouls =
 * fouled out under HS rules; the board flags a player at the limit.
 */
export interface PlayerFoul {
  team: 'home' | 'away';
  /** jersey number. */
  jersey: number;
  /** player name — optional, display-as-typed. */
  name?: string;
  /** running foul count. */
  fouls: number;
}

/**
 * Water-polo per-player exclusions — 3 personals = ejected. The board
 * surfaces players approaching the limit.
 */
export interface PlayerExclusion {
  team: 'home' | 'away';
  /** cap (jersey) number. */
  jersey: number;
  /** player name — optional, display-as-typed. */
  name?: string;
  /** running exclusion count. */
  count: number;
}

/**
 * Diving judge panel — the CURRENT dive's raw per-judge scores (report
 * B2/B4/B5, Sports Wave S3 P0-3). A flat `number[]`, one entry per judge
 * in panel order (3/5/7 judges — see `DIVING.stats.judgeCount`), each in
 * [0,10] with half-point steps enforced by the console UI (the sanitizer
 * itself only bounds the RANGE — a judge score of 7.3 is a fat-finger, not
 * a security concern, so it's clamped not rejected). `DiveJudgesPanelWidget`
 * (SwimDiveWidgets.tsx) reads this to render the judge chips + the
 * drop-high/low computation; the console's diving judge pad is the sole
 * producer. Replaced wholesale on every "Award" tap — there is no partial-
 * update concept (a dive's panel is scored once, then the next dive starts
 * a fresh panel).
 */
export type JudgeScores = number[];

// ── Structured-stat validation (api writes; board reads) ──────────
/**
 * The structured `Game.stats` keys the operator console writes and the
 * board reads, distinct from the scalar sport-stat keys. Anything not in
 * this set (and not a sport-stat / META key) is dropped by `updateStats`.
 */
export const STRUCTURED_STAT_KEYS = ['results', 'playerFouls', 'playerExclusions', 'judgeScores'] as const;
export type StructuredStatKey = (typeof STRUCTURED_STAT_KEYS)[number];

/** Caps the validator enforces — top array, nested array, string length. */
export const STRUCTURED_STAT_MAX_ENTRIES = 64;
export const STRUCTURED_STAT_MAX_STRING = 64;

/** Clamp a value to a finite integer within [lo, hi]; non-finite → 0 (or lo if >0). */
function clampInt(v: unknown, lo: number, hi: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : NaN;
  if (!Number.isFinite(n)) return lo > 0 ? lo : 0;
  return Math.min(hi, Math.max(lo, n));
}

/** Trim an untrusted value to a sanitized string ≤ STRUCTURED_STAT_MAX_STRING chars. */
function clampStr(v: unknown): string {
  return String(v ?? '').slice(0, STRUCTURED_STAT_MAX_STRING);
}

/** Normalize an untrusted team value to 'home' | 'away' | null. */
function sideOf(v: unknown): 'home' | 'away' | null {
  return v === 'home' || v === 'away' ? v : null;
}

/**
 * Validate + sanitize the untrusted `results` blob into a bounded
 * MeetResult[]. Caps the top array and each `entries` array at
 * STRUCTURED_STAT_MAX_ENTRIES, sanitizes every string to ≤64 chars,
 * coerces places/lanes to sane ints, drops malformed members (a member
 * with no `event` string or no `entries` array is dropped). Returns []
 * for any non-array input.
 */
export function sanitizeResults(input: unknown): MeetResult[] {
  if (!Array.isArray(input)) return [];
  const out: MeetResult[] = [];
  for (const raw of input.slice(0, STRUCTURED_STAT_MAX_ENTRIES)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.event !== 'string' || !Array.isArray(r.entries)) continue;
    const entries: ResultEntry[] = [];
    for (const e of (r.entries as unknown[]).slice(0, STRUCTURED_STAT_MAX_ENTRIES)) {
      if (!e || typeof e !== 'object') continue;
      const en = e as Record<string, unknown>;
      const entry: ResultEntry = {
        place: clampInt(en.place, 0, 999),
        name: clampStr(en.name),
        mark: clampStr(en.mark),
      };
      if ('team' in en) entry.team = sideOf(en.team);
      if (typeof en.lane === 'number') entry.lane = clampInt(en.lane, 0, 999);
      entries.push(entry);
    }
    const result: MeetResult = { event: clampStr(r.event), entries };
    // `order` is meet-long DISPLAY ordering, not a place — writers encode it
    // as eventNumber*100+heat (CTS swim ingest, console lane pad), so event 12
    // heat 3 = 1203. The original [0,999] clamp silently truncated EVERY event
    // ≥ 10 to 999, collapsing distinct heats onto the same order and losing
    // their relative ordering (launch-sprint Day 2 fix, 2026-07-01 — found by
    // the lane-pad build). Widened bound fits event 99999 heat 99; place/lane
    // above keep their tight [0,999] clamps (those ARE bounded quantities).
    if (typeof r.order === 'number') result.order = clampInt(r.order, 0, 9_999_999);
    out.push(result);
  }
  return out;
}

/**
 * Validate + sanitize the untrusted `playerFouls` blob into a bounded
 * PlayerFoul[]. Caps the array at STRUCTURED_STAT_MAX_ENTRIES, requires
 * a valid team side, coerces jersey to [0,999] and fouls to [0,9],
 * sanitizes the optional name. Drops members with no valid team.
 */
export function sanitizePlayerFouls(input: unknown): PlayerFoul[] {
  if (!Array.isArray(input)) return [];
  const out: PlayerFoul[] = [];
  for (const raw of input.slice(0, STRUCTURED_STAT_MAX_ENTRIES)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const team = sideOf(r.team);
    if (!team) continue;
    const row: PlayerFoul = {
      team,
      jersey: clampInt(r.jersey, 0, 999),
      fouls: clampInt(r.fouls, 0, 9),
    };
    if ('name' in r) row.name = clampStr(r.name);
    out.push(row);
  }
  return out;
}

/**
 * Validate + sanitize the untrusted `playerExclusions` blob into a
 * bounded PlayerExclusion[]. Same rules as {@link sanitizePlayerFouls}
 * but with a `count` field clamped to [0,9].
 */
export function sanitizePlayerExclusions(input: unknown): PlayerExclusion[] {
  if (!Array.isArray(input)) return [];
  const out: PlayerExclusion[] = [];
  for (const raw of input.slice(0, STRUCTURED_STAT_MAX_ENTRIES)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const team = sideOf(r.team);
    if (!team) continue;
    const row: PlayerExclusion = {
      team,
      jersey: clampInt(r.jersey, 0, 999),
      count: clampInt(r.count, 0, 9),
    };
    if ('name' in r) row.name = clampStr(r.name);
    out.push(row);
  }
  return out;
}

/** Clamp a value to a finite number within [lo, hi]; non-finite → dropped
 *  (the caller filters these out, unlike clampInt which floors to `lo`) —
 *  a malformed judge score should vanish, not silently become a 0 that
 *  then gets scored as a real (harsh) number. */
function clampFiniteOrNaN(v: unknown, lo: number, hi: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : NaN;
  if (!Number.isFinite(n)) return NaN;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Validate + sanitize the untrusted `judgeScores` blob into a bounded
 * {@link JudgeScores}. Each score is clamped to [0,10] (the FINA/NFHS
 * judged-dive scale); malformed entries (non-numeric, NaN, Infinity) are
 * DROPPED rather than coerced to 0 — a garbage judge score disappearing
 * from the panel is safer than it silently counting as a 0.0. Half-point
 * granularity is a console-UI convention (the judge pad only ever taps
 * out X.0/X.5), not enforced here — the sanitizer's job is bounding the
 * range, not the step, so a legitimate integer or off-grid score from a
 * future non-console producer (a CTS-style judging console feed) still
 * persists. Caps at STRUCTURED_STAT_MAX_ENTRIES (a diving panel is never
 * more than 7 judges, but the bound is shared with every other structured
 * stat so one constant governs all of them). Returns [] for non-array
 * input — same "never throws, an empty/absent key renders nothing" rule
 * every structured-stat reader on the board side already follows.
 */
export function sanitizeJudgeScores(input: unknown): JudgeScores {
  if (!Array.isArray(input)) return [];
  const out: number[] = [];
  for (const raw of input.slice(0, STRUCTURED_STAT_MAX_ENTRIES)) {
    const n = clampFiniteOrNaN(raw, 0, 10);
    if (Number.isFinite(n)) out.push(Math.round(n * 10) / 10);
  }
  return out;
}

/**
 * Validate one structured stat key's untrusted value into its bounded
 * shape — the single entry point `updateStats` calls. Returns the
 * sanitized array (always an array, possibly empty), or `undefined` if
 * `key` is not a structured-stat key (so the caller skips it).
 */
export function sanitizeStructuredStat(
  key: string,
  value: unknown,
): MeetResult[] | PlayerFoul[] | PlayerExclusion[] | JudgeScores | undefined {
  switch (key) {
    case 'results':
      return sanitizeResults(value);
    case 'playerFouls':
      return sanitizePlayerFouls(value);
    case 'playerExclusions':
      return sanitizePlayerExclusions(value);
    case 'judgeScores':
      return sanitizeJudgeScores(value);
    default:
      return undefined;
  }
}

const FOOTBALL: SportDefinition = {
  key: 'football',
  name: 'Football',
  emoji: '🏈',
  mode: 'HEAD_TO_HEAD',
  clock: { type: 'countdown', segmentMs: 12 * 60_000 },
  segment: { name: 'Quarter', count: 4, overtime: true },
  score: { unit: 'points', increments: [1, 2, 3, 6] },
  // T2-10: timeouts reset at halftime (after Q2). Fouls and shot clock N/A.
  segmentReset: {
    homeTimeouts: 'half',
    awayTimeouts: 'half',
  },
  stats: [
    { key: 'down', label: 'Down', scope: 'game', type: 'number', min: 1, max: 4 },
    { key: 'distance', label: 'To Go', scope: 'game', type: 'number', min: 0, max: 99 },
    { key: 'ballOn', label: 'Ball On', scope: 'game', type: 'number', min: 0, max: 50 },
    { key: 'homeTimeouts', label: 'Home Timeouts', scope: 'home', type: 'number', min: 0, max: 3 },
    { key: 'awayTimeouts', label: 'Away Timeouts', scope: 'away', type: 'number', min: 0, max: 3 },
    // Possession — 'home' / 'away'. Drives the scoreboard possession marker.
    { key: 'possession', label: 'Possession (home / away)', scope: 'game', type: 'text' },
  ],
  celebrations: [
    // TD = 6; a batched feed may report TD+XP (7) or TD+2pt (8) as one
    // delta. Field goal = 3. Safety (+2) and a lone XP (+1) have no
    // celebration of their own, so they don't auto-fire.
    { key: 'touchdown', label: 'Touchdown', emoji: '🏈', autoPoints: [6, 7, 8] },
    { key: 'fieldGoal', label: 'Field Goal', emoji: '🏈', autoPoints: [3] },
    { key: 'firstDown', label: 'First Down', emoji: '📍' },
    { key: 'sack', label: 'Sack', emoji: '💥' },
    { key: 'turnover', label: 'Turnover', emoji: '🔄' },
    // T1-5: Horn fires automatically at clock expiry; also available as manual cue.
    { key: 'horn', label: 'Horn', emoji: '📯' },
  ],
};

const BASKETBALL: SportDefinition = {
  key: 'basketball',
  name: 'Basketball',
  emoji: '🏀',
  mode: 'HEAD_TO_HEAD',
  clock: { type: 'countdown', segmentMs: 8 * 60_000 },
  segment: { name: 'Quarter', count: 4, overtime: true },
  score: { unit: 'points', increments: [1, 2, 3] },
  // 24s pro / 30s college; 14s offensive-rebound short reset. HS varies
  // (35s where adopted, or off).
  shotClock: { full: 24, short: 14, options: [0, 24, 30, 35] },
  // T2-10: fouls reset every period; timeouts reset at halftime (after Q2).
  // Shot clock resets to configured full length at every period boundary.
  segmentReset: {
    homeFouls: true,
    awayFouls: true,
    homeTimeouts: 'half',
    awayTimeouts: 'half',
    shotClock: true,
  },
  stats: [
    { key: 'homeFouls', label: 'Home Fouls', scope: 'home', type: 'number', min: 0, max: 30 },
    { key: 'awayFouls', label: 'Away Fouls', scope: 'away', type: 'number', min: 0, max: 30 },
    { key: 'homeTimeouts', label: 'Home Timeouts', scope: 'home', type: 'number', min: 0, max: 5 },
    { key: 'awayTimeouts', label: 'Away Timeouts', scope: 'away', type: 'number', min: 0, max: 5 },
    // Possession arrow — 'home' / 'away'.
    { key: 'possession', label: 'Possession (home / away)', scope: 'game', type: 'text' },
  ],
  celebrations: [
    // Only the three-pointer auto-fires: +3 in a single possession is
    // unambiguously a three. A dunk (+2) is indistinguishable from any
    // other field goal and far too frequent to auto-celebrate.
    { key: 'threePointer', label: 'Three!', emoji: '🎯', autoPoints: [3] },
    { key: 'dunk', label: 'Dunk', emoji: '💪' },
    { key: 'buzzerBeater', label: 'Buzzer Beater', emoji: '⏰' },
    { key: 'steal', label: 'Steal', emoji: '🖐️' },
    // T1-5: Horn fires automatically at clock expiry; also available as manual cue.
    { key: 'horn', label: 'Horn', emoji: '📯' },
  ],
};

const BASEBALL: SportDefinition = {
  key: 'baseball',
  name: 'Baseball',
  emoji: '⚾',
  mode: 'HEAD_TO_HEAD',
  clock: { type: 'none' },
  // MLB / college regulation is 9 innings. Extra innings just keep
  // counting up (10TH, 11TH…) — segmentLabel never shows "OT" for a
  // sport whose segment is an Inning.
  segment: { name: 'Inning', count: 9, overtime: true },
  score: { unit: 'runs', increments: [1, 2, 3, 4] },
  stats: [
    { key: 'balls', label: 'Balls', scope: 'game', type: 'number', min: 0, max: 3 },
    { key: 'strikes', label: 'Strikes', scope: 'game', type: 'number', min: 0, max: 2 },
    { key: 'outs', label: 'Outs', scope: 'game', type: 'number', min: 0, max: 2 },
    { key: 'half', label: 'Inning Half', scope: 'game', type: 'text' },
    // Base runners — drive the scoreboard's lit base diamond. 0/1 each.
    { key: 'on1B', label: 'Runner on 1st', scope: 'game', type: 'number', min: 0, max: 1 },
    { key: 'on2B', label: 'Runner on 2nd', scope: 'game', type: 'number', min: 0, max: 1 },
    { key: 'on3B', label: 'Runner on 3rd', scope: 'game', type: 'number', min: 0, max: 1 },
    // Pitch count — per team's current pitcher; the operator resets it
    // on a pitching change. HS leagues enforce pitch-count limits.
    { key: 'homePitchCount', label: 'Home Pitch Count', scope: 'home', type: 'number', min: 0, max: 200 },
    { key: 'awayPitchCount', label: 'Away Pitch Count', scope: 'away', type: 'number', min: 0, max: 200 },
    // R-H-E line — hits + errors per side (runs = the score). The console's
    // per-side stat rows render any home*/away* number stat, so these surface
    // the classic Runs-Hits-Errors box automatically (2026-06-13 audit P1).
    { key: 'homeHits', label: 'Home Hits', scope: 'home', type: 'number', min: 0, max: 99 },
    { key: 'awayHits', label: 'Away Hits', scope: 'away', type: 'number', min: 0, max: 99 },
    { key: 'homeErrors', label: 'Home Errors', scope: 'home', type: 'number', min: 0, max: 99 },
    { key: 'awayErrors', label: 'Away Errors', scope: 'away', type: 'number', min: 0, max: 99 },
    // Marquee pitch-velocity element every broadcast / pro board shows.
    // Optional: the operator (or a radar-gun integration) sets the speed
    // of the last pitch and its type; surfaces show "94 MPH · FB" beside
    // the count and clear it on the next pitch. 0 = no reading to show.
    // (2026-06-13 audit P2 — pitch-speed / last-pitch-type display.)
    { key: 'lastPitchMph', label: 'Last Pitch (mph)', scope: 'game', type: 'number', min: 0, max: 110 },
    { key: 'lastPitchType', label: 'Last Pitch Type', scope: 'game', type: 'text' },
  ],
  celebrations: [
    // Home runs are operator-fired (or one-tap "HR" macro on the console),
    // NOT auto-fired from a run delta: a solo/2-run/3-run shot reports as
    // +1/+2/+3 — indistinguishable from a single+single, a double+error,
    // or a bases-clearing double. The ONLY unambiguous auto case is the
    // grand slam (+4 in one plate appearance), so it alone carries
    // autoPoints. True per-HR auto-celebration needs an event-typed feed
    // (HR/SO/DP events), tracked separately. (2026-06-13 audit P2.)
    { key: 'homeRun', label: 'Home Run', emoji: '⚾' },
    { key: 'grandSlam', label: 'Grand Slam', emoji: '💎', autoPoints: [4] },
    { key: 'strikeout', label: 'Strikeout', emoji: '🔥' },
    { key: 'doublePlay', label: 'Double Play', emoji: '⚡' },
  ],
};

const SOFTBALL: SportDefinition = {
  ...BASEBALL,
  key: 'softball',
  name: 'Softball',
  emoji: '🥎',
  // NCAA / high-school softball regulation is 7 innings (not 9).
  segment: { name: 'Inning', count: 7, overtime: true },
  // Own celebration set — softball spreads BASEBALL, whose Home Run
  // cue carries a baseball ⚾. Override so a softball home run shows
  // a softball, not a baseball.
  celebrations: [
    { key: 'homeRun', label: 'Home Run', emoji: '🥎' },
    { key: 'grandSlam', label: 'Grand Slam', emoji: '💎', autoPoints: [4] },
    { key: 'strikeout', label: 'Strikeout', emoji: '🔥' },
    { key: 'doublePlay', label: 'Double Play', emoji: '⚡' },
  ],
};

const SOCCER: SportDefinition = {
  key: 'soccer',
  name: 'Soccer',
  emoji: '⚽',
  mode: 'HEAD_TO_HEAD',
  clock: { type: 'countup', segmentMs: 40 * 60_000 },
  segment: { name: 'Half', count: 2, overtime: true },
  score: { unit: 'goals', increments: [1] },
  stats: [
    { key: 'homeShots', label: 'Home Shots', scope: 'home', type: 'number', min: 0, max: 99 },
    { key: 'awayShots', label: 'Away Shots', scope: 'away', type: 'number', min: 0, max: 99 },
    { key: 'addedTime', label: 'Added Time (min)', scope: 'game', type: 'number', min: 0, max: 15 },
    { key: 'homeYellowCards', label: 'Home Yellow Cards', scope: 'home', type: 'number', min: 0, max: 11 },
    { key: 'awayYellowCards', label: 'Away Yellow Cards', scope: 'away', type: 'number', min: 0, max: 11 },
    { key: 'homeRedCards', label: 'Home Red Cards', scope: 'home', type: 'number', min: 0, max: 11 },
    { key: 'awayRedCards', label: 'Away Red Cards', scope: 'away', type: 'number', min: 0, max: 11 },
  ],
  celebrations: [
    // Soccer only scores by goals, one at a time → every +1 is a goal.
    { key: 'goal', label: 'GOAL!', emoji: '⚽', autoPoints: [1] },
    { key: 'penalty', label: 'Penalty', emoji: '🎯' },
    { key: 'yellowCard', label: 'Yellow Card', emoji: '🟨' },
    { key: 'redCard', label: 'Red Card', emoji: '🟥' },
    // T1-5: Horn fires automatically at clock expiry; also available as manual cue.
    { key: 'horn', label: 'Horn', emoji: '📯' },
  ],
};

const VOLLEYBALL: SportDefinition = {
  key: 'volleyball',
  name: 'Volleyball',
  emoji: '🏐',
  mode: 'HEAD_TO_HEAD',
  clock: { type: 'none' },
  segment: { name: 'Set', count: 5, overtime: false },
  score: { unit: 'points', increments: [1] },
  stats: [
    { key: 'homeSets', label: 'Home Sets Won', scope: 'home', type: 'number', min: 0, max: 3 },
    { key: 'awaySets', label: 'Away Sets Won', scope: 'away', type: 'number', min: 0, max: 3 },
    { key: 'serving', label: 'Serving', scope: 'game', type: 'text' },
  ],
  celebrations: [
    { key: 'ace', label: 'Ace', emoji: '🎯' },
    { key: 'kill', label: 'Kill', emoji: '💥' },
    { key: 'block', label: 'Block', emoji: '🛑' },
    { key: 'setWin', label: 'Set Won', emoji: '🏆' },
  ],
};

const WRESTLING: SportDefinition = {
  key: 'wrestling',
  name: 'Wrestling',
  emoji: '🤼',
  mode: 'HEAD_TO_HEAD',
  clock: { type: 'countdown', segmentMs: 2 * 60_000 },
  segment: { name: 'Period', count: 3, overtime: true },
  // The +/- chips drive the CURRENT BOUT's match points — a single
  // wrestler scores 1 (escape) / 2 (takedown/reversal) / 3 (near fall)
  // / 4 (near fall) per move. This is NOT the team score.
  score: { unit: 'points', increments: [1, 2, 3, 4] },
  // Dual-meet team score: a separate running tally awarded per bout
  // result — decision +3, major +4, tech fall +5, pin/forfeit +6. The
  // venue board shows the TEAM score (Lions 24, Tigers 18) while the
  // match score shows the wrestler-on-the-mat's points. The increments
  // here are the result-value quick-adds so the operator credits a bout
  // win without conflating it with match points.
  teamScore: {
    label: 'Team Score',
    homeKey: 'homeTeamPoints',
    awayKey: 'awayTeamPoints',
    increments: [3, 4, 5, 6],
  },
  stats: [
    // Team-points tally — surfaced on board/page as the dual-meet score.
    { key: 'homeTeamPoints', label: 'Home Team Points', scope: 'home', type: 'number', min: 0, max: 99 },
    { key: 'awayTeamPoints', label: 'Away Team Points', scope: 'away', type: 'number', min: 0, max: 99 },
    // Per-bout context — the weight class + bout number the current
    // match points belong to, so the board reads "152 lbs · Bout 7".
    { key: 'weightClass', label: 'Weight Class', scope: 'game', type: 'text' },
    { key: 'boutNumber', label: 'Bout #', scope: 'game', type: 'number', min: 1, max: 14 },
    { key: 'homeRideTime', label: 'Home Ride Time (s)', scope: 'home', type: 'number', min: 0, max: 600 },
    { key: 'awayRideTime', label: 'Away Ride Time (s)', scope: 'away', type: 'number', min: 0, max: 600 },
  ],
  celebrations: [
    { key: 'pin', label: 'PIN!', emoji: '🤼' },
    { key: 'takedown', label: 'Takedown', emoji: '💥' },
    { key: 'nearFall', label: 'Near Fall', emoji: '⚠️' },
    { key: 'techFall', label: 'Tech Fall', emoji: '🔥' },
    // T1-5: Horn fires automatically at clock expiry; also available as manual cue.
    { key: 'horn', label: 'Horn', emoji: '📯' },
  ],
};

// ── Sprint 13 Phase 2 — catalog expansion ──────────────────────
// Four continuous-clock invasion sports + one rally sport. All pure
// config: the scoreboard, control surface, and broadcast scorebug
// are data-driven, so these light up across the whole product with
// zero new UI code.

const HOCKEY: SportDefinition = {
  key: 'hockey',
  name: 'Hockey',
  emoji: '🏒',
  mode: 'HEAD_TO_HEAD',
  clock: { type: 'countdown', segmentMs: 17 * 60_000 },
  segment: { name: 'Period', count: 3, overtime: true },
  score: { unit: 'goals', increments: [1] },
  // T2-10: hockey doesn't have a shot clock by default, but if one is
  // configured (future) it resets at period start. No fouls/timeouts to reset.
  segmentReset: {
    shotClock: true,
  },
  stats: [
    { key: 'homeShots', label: 'Home Shots', scope: 'home', type: 'number', min: 0, max: 99 },
    { key: 'awayShots', label: 'Away Shots', scope: 'away', type: 'number', min: 0, max: 99 },
    { key: 'homePenalties', label: 'Home Penalties', scope: 'home', type: 'number', min: 0, max: 30 },
    { key: 'awayPenalties', label: 'Away Penalties', scope: 'away', type: 'number', min: 0, max: 30 },
  ],
  celebrations: [
    { key: 'goal', label: 'GOAL!', emoji: '🚨', autoPoints: [1] },
    { key: 'powerPlay', label: 'Power Play', emoji: '⚡' },
    { key: 'penaltyKill', label: 'Penalty Kill', emoji: '🛡️' },
    { key: 'hatTrick', label: 'Hat Trick', emoji: '🎩' },
    { key: 'save', label: 'Big Save', emoji: '🧤' },
    // T1-5: Horn fires automatically at clock expiry; also available as manual cue.
    { key: 'horn', label: 'Horn', emoji: '📯' },
  ],
  penaltyBox: {
    label: 'Penalty box',
    presets: [
      { label: 'Minor', sec: 120 },
      { label: 'Double minor', sec: 240 },
      { label: 'Major', sec: 300 },
      { label: 'Misconduct', sec: 600 },
    ],
  },
};

const LACROSSE: SportDefinition = {
  key: 'lacrosse',
  name: 'Lacrosse',
  emoji: '🥍',
  mode: 'HEAD_TO_HEAD',
  clock: { type: 'countdown', segmentMs: 12 * 60_000 },
  segment: { name: 'Quarter', count: 4, overtime: true },
  score: { unit: 'goals', increments: [1] },
  // 80s NCAA men's shot clock; 60s short reset on a re-start in the
  // offensive half. Operator picks the length at setup:
  //   0  → off (no shot clock — many HS leagues and women's lacrosse,
  //          which has no shot clock at the NFHS level),
  //   60 → the short reset / some HS variants,
  //   80 → NCAA men's,
  //   90 → NCAA women's free-position / draw shot-clock variant.
  // (2026-06-13 audit P2 — women's / no-shot-clock nuance.)
  shotClock: { full: 80, short: 60, options: [0, 60, 80, 90] },
  // T2-10: shot clock resets at every quarter boundary.
  segmentReset: {
    shotClock: true,
  },
  stats: [
    { key: 'homeShots', label: 'Home Shots', scope: 'home', type: 'number', min: 0, max: 99 },
    { key: 'awayShots', label: 'Away Shots', scope: 'away', type: 'number', min: 0, max: 99 },
    { key: 'homeGroundBalls', label: 'Home Ground Balls', scope: 'home', type: 'number', min: 0, max: 99 },
    { key: 'awayGroundBalls', label: 'Away Ground Balls', scope: 'away', type: 'number', min: 0, max: 99 },
  ],
  celebrations: [
    { key: 'goal', label: 'GOAL!', emoji: '🥍', autoPoints: [1] },
    { key: 'save', label: 'Save', emoji: '🧤' },
    { key: 'groundBall', label: 'Ground Ball', emoji: '🔄' },
    { key: 'manUp', label: 'Man Up', emoji: '⚡' },
    // T1-5: Horn fires automatically at clock expiry; also available as manual cue.
    { key: 'horn', label: 'Horn', emoji: '📯' },
  ],
  penaltyBox: {
    label: 'Penalty box',
    presets: [
      { label: 'Technical :30', sec: 30 },
      { label: 'Personal 1:00', sec: 60 },
      { label: 'Personal 2:00', sec: 120 },
      { label: 'Personal 3:00', sec: 180 },
    ],
  },
};

const FIELD_HOCKEY: SportDefinition = {
  key: 'field_hockey',
  name: 'Field Hockey',
  emoji: '🏑',
  mode: 'HEAD_TO_HEAD',
  clock: { type: 'countdown', segmentMs: 15 * 60_000 },
  segment: { name: 'Quarter', count: 4, overtime: true },
  score: { unit: 'goals', increments: [1] },
  stats: [
    { key: 'homeShots', label: 'Home Shots', scope: 'home', type: 'number', min: 0, max: 99 },
    { key: 'awayShots', label: 'Away Shots', scope: 'away', type: 'number', min: 0, max: 99 },
    { key: 'homeCorners', label: 'Home Corners', scope: 'home', type: 'number', min: 0, max: 99 },
    { key: 'awayCorners', label: 'Away Corners', scope: 'away', type: 'number', min: 0, max: 99 },
  ],
  celebrations: [
    { key: 'goal', label: 'GOAL!', emoji: '🏑', autoPoints: [1] },
    { key: 'save', label: 'Save', emoji: '🧤' },
    { key: 'penaltyCorner', label: 'Penalty Corner', emoji: '📐' },
    { key: 'greenCard', label: 'Green Card', emoji: '🟩' },
    // T1-5: Horn fires automatically at clock expiry; also available as manual cue.
    { key: 'horn', label: 'Horn', emoji: '📯' },
  ],
  penaltyBox: {
    label: 'Suspensions',
    presets: [
      { label: 'Green 2:00', sec: 120 },
      { label: 'Yellow 5:00', sec: 300 },
      { label: 'Yellow 10:00', sec: 600 },
    ],
  },
};

const WATER_POLO: SportDefinition = {
  key: 'water_polo',
  name: 'Water Polo',
  emoji: '🤽',
  mode: 'HEAD_TO_HEAD',
  // Quarter length varies by level: NCAA / World Aquatics play 8:00 but
  // NFHS HIGH SCHOOL plays 7:00 and age-group/club commonly 5:00-6:00
  // (2026-07-12 world-class audit P1 — the old comment claimed NFHS was
  // 8:00, which is wrong, and the fixed length forced HS operators to
  // hand-set the clock every quarter). 8:00 stays the default; the New
  // Game modal offers the pick, stored per-game as stats.clockSegmentMs.
  // OT periods are 3:00 (NCAA), not another full quarter.
  clock: {
    type: 'countdown',
    segmentMs: 8 * 60_000,
    otSegmentMs: 3 * 60_000,
    segmentMsOptions: [
      { label: '8:00 — NCAA / World Aquatics', ms: 8 * 60_000 },
      { label: '7:00 — NFHS high school', ms: 7 * 60_000 },
      { label: '6:00 — age group', ms: 6 * 60_000 },
      { label: '5:00 — age group / club', ms: 5 * 60_000 },
    ],
  },
  segment: { name: 'Quarter', count: 4, overtime: true },
  score: { unit: 'goals', increments: [1] },
  // 30s shot clock, resets to 20 on offensive rebound / corner /
  // post-exclusion retained possession. THE must-have for the water
  // polo beta tester — the console now shows the shot-clock controls
  // because this field is set.
  shotClock: { full: 30, short: 20, options: [0, 20, 30] },
  // T2-10: shot clock resets at every quarter boundary. Timeouts bank
  // is per-game, not per-half — 'never' so they're preserved.
  segmentReset: {
    shotClock: true,
  },
  stats: [
    { key: 'homeShots', label: 'Home Shots', scope: 'home', type: 'number', min: 0, max: 99 },
    { key: 'awayShots', label: 'Away Shots', scope: 'away', type: 'number', min: 0, max: 99 },
    { key: 'homeExclusions', label: 'Home Exclusions', scope: 'home', type: 'number', min: 0, max: 30 },
    { key: 'awayExclusions', label: 'Away Exclusions', scope: 'away', type: 'number', min: 0, max: 30 },
    // Timeouts-left per team (T.O.L. on a regulation board). Picked up
    // automatically by the universal Timeouts widget + console stat tray.
    { key: 'homeTimeouts', label: 'Home Timeouts', scope: 'home', type: 'number', min: 0, max: 3 },
    { key: 'awayTimeouts', label: 'Away Timeouts', scope: 'away', type: 'number', min: 0, max: 3 },
  ],
  celebrations: [
    { key: 'goal', label: 'GOAL!', emoji: '🤽', autoPoints: [1] },
    { key: 'save', label: 'Save', emoji: '🧤' },
    { key: 'exclusion', label: 'Exclusion', emoji: '✋' },
    { key: 'powerPlay', label: 'Power Play', emoji: '⚡' },
    // T1-5: Horn fires automatically at clock expiry; also available as manual cue.
    { key: 'horn', label: 'Horn', emoji: '📯' },
  ],
  penaltyBox: {
    label: 'Exclusions',
    presets: [
      { label: 'Exclusion :20', sec: 20 },
      { label: 'Misconduct 4:00', sec: 240 },
    ],
  },
};

const PICKLEBALL: SportDefinition = {
  key: 'pickleball',
  name: 'Pickleball',
  emoji: '🥒',
  mode: 'HEAD_TO_HEAD',
  clock: { type: 'none' },
  segment: { name: 'Game', count: 3, overtime: false },
  score: { unit: 'points', increments: [1] },
  stats: [
    { key: 'homeGames', label: 'Home Games Won', scope: 'home', type: 'number', min: 0, max: 2 },
    { key: 'awayGames', label: 'Away Games Won', scope: 'away', type: 'number', min: 0, max: 2 },
    { key: 'serving', label: 'Serving', scope: 'game', type: 'text' },
    // Side-out scoring: in traditional doubles each side has TWO servers
    // (server 1 → side out → server 2 → side out → other team), so the
    // venue board shows "SERVING HOME · SERVER 2". Optional — rally-scoring
    // leagues (every point is a side-out, single server) can leave it at 1
    // and the surfaces simply won't draw the qualifier. (2026-06-13 audit P2.)
    { key: 'serverNum', label: 'Server # (1 / 2)', scope: 'game', type: 'number', min: 1, max: 2 },
  ],
  celebrations: [
    { key: 'ace', label: 'Ace', emoji: '🎯' },
    { key: 'winner', label: 'Winner', emoji: '💥' },
    { key: 'dink', label: 'Dink Rally', emoji: '🏓' },
    { key: 'gameWin', label: 'Game Won', emoji: '🏆' },
  ],
};

// ── Sprint 13 Phase 2 — leaderboard / meet sports ─────────────
// Six meet sports: no running game clock, team score is cumulative
// points earned across events. Mode is LEADERBOARD — scoreboard
// and control surface render a points tally rather than a
// head-to-head segment clock. Purely additive; no existing sports
// are modified.

const TRACK_AND_FIELD: SportDefinition = {
  key: 'track_and_field',
  name: 'Track & Field',
  emoji: '🏃',
  mode: 'LEADERBOARD',
  clock: { type: 'none' },
  // A track meet is structured as a series of events, not timed
  // periods. "Event" count is nominal — meets vary widely; 1
  // represents "continuous meet" so the segment counter stays
  // meaningful without implying a fixed event count.
  segment: { name: 'Event', count: 1, overtime: false },
  // NFHS dual-meet track scoring is place-based (1st=5, 2nd=3, 3rd=1 in a
  // dual; relays / larger meets vary). The quick-add buttons map to the
  // real place-point values an operator credits as each event finishes,
  // rather than generic 1/2/3 steps. (2026-06-13 audit P2.)
  score: { unit: 'points', increments: [1, 3, 5, 8] },
  stats: [
    { key: 'currentEvent', label: 'Current Event', scope: 'game', type: 'text' },
    { key: 'homeAthletes', label: 'Home Competitors', scope: 'home', type: 'number', min: 0, max: 999 },
    { key: 'awayAthletes', label: 'Away Competitors', scope: 'away', type: 'number', min: 0, max: 999 },
  ],
  celebrations: [
    { key: 'firstPlace', label: 'First Place!', emoji: '🥇' },
    { key: 'newRecord', label: 'New Record', emoji: '📋' },
    { key: 'personalBest', label: 'Personal Best', emoji: '⭐' },
    { key: 'teamLead', label: 'Team Takes Lead', emoji: '🏃' },
  ],
};

// DEPRECATED: split into `swimming` + `diving` (2026-07-01). Swimming is a
// lane/heat/time sport; diving is a judged panel-score sport with no lanes,
// clock, or splits — bundling them forced a lanes-and-times widget model
// onto a judges-and-DD sport (operator complaint 2026-06-30: "you grouped
// diving into the same sport but wouldn't that be totally different?
// SEPARATE it"). See docs/research/2026-06-30-swim-dive-scoreboards/00-REPORT.md.
//
// Kept here, in SPORT_DEFINITIONS, PLAYER_STATS, STAT_SEMANTICS, and
// CAREER_THRESHOLDS so `findSport('swimming_diving')` and every stat-engine
// lookup still resolve for EXISTING games created before the split — full
// back-compat, zero migration. REMOVED from the `SPORTS` ordered array (the
// new-game picker), which now offers `swimming` and `diving` separately.
const SWIMMING_DIVING: SportDefinition = {
  key: 'swimming_diving',
  name: 'Swimming & Diving',
  emoji: '🏊',
  mode: 'LEADERBOARD',
  clock: { type: 'none' },
  segment: { name: 'Event', count: 1, overtime: false },
  // NFHS dual-meet swimming individual-event scoring is 6-4-3-2-1 (places
  // 1-5); relays are 8-4-2 (double the top weights). The quick-add set
  // covers the place-point values an operator credits as heats finish.
  // (2026-06-13 audit P2.)
  score: { unit: 'points', increments: [1, 2, 3, 4, 6, 8] },
  stats: [
    { key: 'currentEvent', label: 'Current Event', scope: 'game', type: 'text' },
    { key: 'homeAthletes', label: 'Home Competitors', scope: 'home', type: 'number', min: 0, max: 999 },
    { key: 'awayAthletes', label: 'Away Competitors', scope: 'away', type: 'number', min: 0, max: 999 },
  ],
  celebrations: [
    { key: 'firstPlace', label: 'First Place!', emoji: '🥇' },
    { key: 'newRecord', label: 'New Record', emoji: '📋' },
    { key: 'personalBest', label: 'Personal Best', emoji: '⭐' },
    { key: 'perfectDive', label: 'Perfect Dive', emoji: '🏊' },
  ],
};

/**
 * SWIMMING — a lane/heat/time meet sport (2026-07-01 split). Every real
 * board is a lane grid: lane #, swimmer/team, seed/live time, place. See
 * `SWIM_LANE_GRID` widget (apps/web/src/components/widgets/sports/) for the
 * flagship render of this data, sourced from the `MeetResult`/`ResultEntry`
 * structured stats (stats.results — `entry.lane` was already optional
 * there, so no schema change was needed to add lanes).
 */
const SWIMMING: SportDefinition = {
  key: 'swimming',
  name: 'Swimming',
  emoji: '🏊',
  mode: 'LEADERBOARD',
  clock: { type: 'none' },
  segment: { name: 'Event', count: 1, overtime: false },
  // NFHS dual-meet swimming individual-event scoring is 6-4-3-2-1 (places
  // 1-5); relays are 8-4-2 (double the top weights). The quick-add set
  // covers the place-point values an operator credits as heats finish.
  score: { unit: 'points', increments: [1, 2, 3, 4, 6, 8] },
  stats: [
    { key: 'currentEvent', label: 'Current Event', scope: 'game', type: 'text' },
    { key: 'heat', label: 'Heat', scope: 'game', type: 'text' },
    { key: 'course', label: 'Course (SCY / SCM / LCM)', scope: 'game', type: 'text' },
    { key: 'homeAthletes', label: 'Home Competitors', scope: 'home', type: 'number', min: 0, max: 999 },
    { key: 'awayAthletes', label: 'Away Competitors', scope: 'away', type: 'number', min: 0, max: 999 },
  ],
  celebrations: [
    { key: 'firstPlace', label: 'First Place!', emoji: '🥇' },
    { key: 'newRecord', label: 'New Record', emoji: '📋' },
    { key: 'personalBest', label: 'Personal Best', emoji: '⭐' },
    { key: 'relayWin', label: 'Relay Win', emoji: '🏊' },
  ],
};

/**
 * DIVING — a judged panel-score sport (2026-07-01 split out of the legacy
 * combined `swimming_diving`). No lanes, no clock, no splits: a panel of
 * judges scores each dive 0-10, drops high/low, sums the middle scores ×
 * Degree of Difficulty (DD), and the diver's running total accumulates
 * across a fixed dive list (HS dual = 6 dives). Team total is a 2-decimal
 * judged score (e.g. 245.60) — stored as a scaled int like gymnastics'
 * 3-decimal convention, via `scoreDecimals`. See `DIVE_LEADERBOARD` widget.
 *
 * Sports Wave S3 (P0-3, 2026-07-02/03 sports deep-pass audit): before this,
 * `DiveJudgesPanelWidget` read `stats.judgeScores` but NOTHING on the
 * console ever wrote it — the judge loop (diver up → judges flash →
 * award → running total) was impossible; the operator did drop-high/low ×
 * DD math on paper. `judgeScores` is now a first-class STRUCTURED stat
 * (see {@link JudgeScores} / {@link sanitizeJudgeScores} — it's a
 * `number[]`, not a scalar, so it rides the structured-stat validation
 * path alongside `results`, not the plain scalar allow-list below).
 * `judgeCount` is the paired scalar: the panel size (3/5/7) the console's
 * judge pad remembers per-game, seeded from `judgePanel.defaultCount`.
 */
const DIVING: SportDefinition = {
  key: 'diving',
  name: 'Diving',
  emoji: '🤿',
  mode: 'LEADERBOARD',
  clock: { type: 'none' },
  segment: { name: 'Round', count: 1, overtime: false },
  // Running-total judged score (e.g. 245.60). Scaled int (24560) like
  // gymnastics/cheer; console enters the absolute total, surfaces format it.
  score: { unit: 'points', increments: [1, 5, 10] },
  scoreDecimals: 2,
  // NFHS dual meets run a 3-judge panel (no drops); invites/championships
  // commonly step up to 5 or 7 (drop 1/2 high + low). 3 is the safe
  // default for the everyday dual-meet operator this console is built for.
  judgePanel: { defaultCount: 3, options: [3, 5, 7] },
  stats: [
    { key: 'currentDiver', label: 'Current Diver', scope: 'game', type: 'text' },
    { key: 'diveCode', label: 'Dive Code (e.g. 105B)', scope: 'game', type: 'text' },
    // Degree of Difficulty is a decimal (1.2–4.1 in 0.1 steps) — kept as
    // text so the operator can type "2.4" without a stepper rounding it.
    { key: 'dd', label: 'Degree of Difficulty (DD)', scope: 'game', type: 'text' },
    { key: 'round', label: 'Round (Prelim / Semi / Final)', scope: 'game', type: 'text' },
    // Judge-panel size for THIS game — owned + rendered by the judge pad
    // (S3-1), not GameScopeStatEditor's generic stepper (see
    // GAME_STAT_TRAY_OWNED in the console page). A scalar, not part of
    // STRUCTURED_STAT_KEYS, so it persists through the plain allow-list.
    { key: 'judgeCount', label: 'Judge Panel Size', scope: 'game', type: 'number', min: 3, max: 7 },
    { key: 'homeAthletes', label: 'Home Competitors', scope: 'home', type: 'number', min: 0, max: 999 },
    { key: 'awayAthletes', label: 'Away Competitors', scope: 'away', type: 'number', min: 0, max: 999 },
  ],
  celebrations: [
    { key: 'perfectDive', label: 'Perfect Dive', emoji: '🤿' },
    { key: 'bigDD', label: 'Big DD', emoji: '🔥' },
    { key: 'firstPlace', label: 'First Place!', emoji: '🥇' },
    { key: 'newRecord', label: 'New Record', emoji: '📋' },
  ],
};

const CROSS_COUNTRY: SportDefinition = {
  key: 'cross_country',
  name: 'Cross Country',
  emoji: '🌲',
  mode: 'LEADERBOARD',
  clock: { type: 'none' },
  // Cross country is a single race; one "Race" segment is the
  // natural representation.
  segment: { name: 'Race', count: 1, overtime: false },
  // Points are awarded by finish position (1st = 1 pt, low score
  // wins — but the scoreboard shows accumulated points). Increments
  // reflect typical scoring: positions 1-5 score for the team.
  score: { unit: 'points', increments: [1, 2, 3, 4, 5] },
  stats: [
    { key: 'finishers', label: 'Finishers', scope: 'game', type: 'number', min: 0, max: 999 },
    { key: 'leadRunner', label: 'Lead Runner', scope: 'game', type: 'text' },
  ],
  celebrations: [
    { key: 'firstFinisher', label: 'First Finisher!', emoji: '🥇' },
    { key: 'newCourseRecord', label: 'Course Record', emoji: '📋' },
    { key: 'personalBest', label: 'Personal Best', emoji: '⭐' },
    { key: 'teamLead', label: 'Team Takes Lead', emoji: '🏃' },
  ],
};

const GYMNASTICS: SportDefinition = {
  key: 'gymnastics',
  name: 'Gymnastics',
  emoji: '🤸',
  mode: 'LEADERBOARD',
  clock: { type: 'none' },
  // A gymnastics meet rotates through apparatus events (vault, bars,
  // beam, floor). "Rotation" is the standard meet term.
  segment: { name: 'Rotation', count: 4, overtime: false },
  // Team score accumulates across all apparatus and is a 3-decimal
  // judged total (e.g. 195.825). Stored as a scaled int (195825); the
  // console enters the absolute total, surfaces format it back.
  score: { unit: 'points', increments: [1, 5, 10] },
  scoreDecimals: 3,
  stats: [
    { key: 'currentApparatus', label: 'Current Apparatus', scope: 'game', type: 'text' },
    { key: 'homeAthletes', label: 'Home Competitors', scope: 'home', type: 'number', min: 0, max: 50 },
    { key: 'awayAthletes', label: 'Away Competitors', scope: 'away', type: 'number', min: 0, max: 50 },
  ],
  celebrations: [
    { key: 'perfectScore', label: 'Perfect Score', emoji: '🤸' },
    { key: 'newRecord', label: 'New Record', emoji: '📋' },
    { key: 'allAround', label: 'All-Around Lead', emoji: '🏆' },
    { key: 'stickLanding', label: 'Stuck the Landing', emoji: '⭐' },
  ],
};

const GOLF: SportDefinition = {
  key: 'golf',
  name: 'Golf',
  emoji: '⛳',
  mode: 'LEADERBOARD',
  clock: { type: 'none' },
  // HS / college matches are typically 9 or 18 holes. 18 is the
  // standard default; `countOptions` lets the operator pick a 9-hole
  // round at setup so the hole counter fits the match. `overtime`
  // stays false — a leaderboard sport never goes to "OT"; surfaces
  // clamp at the last hole and label "F" (final) past the round.
  segment: { name: 'Hole', count: 18, overtime: false, countOptions: [9, 18] },
  // Golf scoring: strokes relative to par. Increments represent
  // single-stroke changes as players report in.
  score: { unit: 'strokes', increments: [1] },
  stats: [
    { key: 'currentHole', label: 'Current Hole', scope: 'game', type: 'number', min: 1, max: 18 },
    { key: 'homePar', label: 'Home vs Par', scope: 'home', type: 'text' },
    { key: 'awayPar', label: 'Away vs Par', scope: 'away', type: 'text' },
  ],
  celebrations: [
    { key: 'eagle', label: 'Eagle', emoji: '🦅' },
    { key: 'birdie', label: 'Birdie', emoji: '🐦' },
    { key: 'holeInOne', label: 'Hole in One!', emoji: '⛳' },
    { key: 'teamLead', label: 'Team Takes Lead', emoji: '🏆' },
  ],
};

const COMPETITIVE_CHEER: SportDefinition = {
  key: 'competitive_cheer',
  name: 'Competitive Cheer',
  emoji: '📣',
  mode: 'LEADERBOARD',
  clock: { type: 'none' },
  // Cheer competitions are judged across routine divisions / rounds;
  // "Round" is the common term at invitational and state-level meets.
  segment: { name: 'Round', count: 2, overtime: false },
  // Score is a judge-assigned 1-decimal routine total (e.g. 285.5).
  // Stored as a scaled int (2855); the console enters the absolute
  // total, surfaces format it back.
  score: { unit: 'points', increments: [1, 5, 10] },
  scoreDecimals: 1,
  stats: [
    { key: 'division', label: 'Division', scope: 'game', type: 'text' },
    { key: 'homeRoutine', label: 'Home Routine', scope: 'home', type: 'text' },
    { key: 'awayRoutine', label: 'Away Routine', scope: 'away', type: 'text' },
  ],
  celebrations: [
    { key: 'fullOut', label: 'Full Out!', emoji: '📣' },
    { key: 'perfectStunt', label: 'Perfect Stunt', emoji: '⭐' },
    { key: 'newRecord', label: 'New Record', emoji: '📋' },
    { key: 'roundWin', label: 'Round Win', emoji: '🏆' },
  ],
};

/**
 * All shipped sport definitions, keyed by `key`. `swimming_diving` stays
 * here (DEPRECATED, see the const above) purely so `findSport` resolves it
 * for games created before the 2026-07-01 swim/dive split — it is NOT in
 * the `SPORTS` picker array below.
 */
export const SPORT_DEFINITIONS: Record<string, SportDefinition> = {
  football: FOOTBALL,
  basketball: BASKETBALL,
  baseball: BASEBALL,
  softball: SOFTBALL,
  soccer: SOCCER,
  volleyball: VOLLEYBALL,
  wrestling: WRESTLING,
  hockey: HOCKEY,
  lacrosse: LACROSSE,
  field_hockey: FIELD_HOCKEY,
  water_polo: WATER_POLO,
  pickleball: PICKLEBALL,
  track_and_field: TRACK_AND_FIELD,
  swimming_diving: SWIMMING_DIVING,
  swimming: SWIMMING,
  diving: DIVING,
  cross_country: CROSS_COUNTRY,
  gymnastics: GYMNASTICS,
  golf: GOLF,
  competitive_cheer: COMPETITIVE_CHEER,
};

/**
 * Ordered list for pickers (the NEW-GAME picker). `SWIMMING_DIVING` is
 * deliberately ABSENT — replaced by `SWIMMING` + `DIVING` (2026-07-01
 * split). Existing games already on `swimming_diving` keep working via
 * `SPORT_DEFINITIONS` / `findSport` above; only the picker changed.
 */
export const SPORTS: SportDefinition[] = [
  FOOTBALL, BASKETBALL, BASEBALL, SOFTBALL, SOCCER, VOLLEYBALL, WRESTLING,
  HOCKEY, LACROSSE, FIELD_HOCKEY, WATER_POLO, PICKLEBALL,
  TRACK_AND_FIELD, SWIMMING, DIVING, CROSS_COUNTRY, GYMNASTICS, GOLF, COMPETITIVE_CHEER,
];

/** Look up a sport definition by key; undefined if unknown. */
export function findSport(key: string | null | undefined): SportDefinition | undefined {
  return key ? SPORT_DEFINITIONS[key] : undefined;
}

// ── Decimal team scores for judged sports (scaled-integer convention) ──
/**
 * Format a stored (scaled-integer) score for DISPLAY.
 *
 * For a judged sport with `def.scoreDecimals` set, the DB stores the
 * decimal team total times `10 ** scoreDecimals` (gymnastics 195.825 →
 * 195825), so this divides back down and fixes the decimal places:
 * `formatScore(gymnastics, 195825) === '195.825'`.
 *
 * For every other sport (`scoreDecimals` undefined) the stored int IS
 * the score and this is just `String(raw)` —
 * `formatScore(football, 7) === '7'`. Never throws: a null / undefined /
 * NaN raw becomes `'0'` (or `'0.000'` for a 3-decimal sport), so a
 * surface always has a printable string.
 *
 * Only the DISPLAYED text uses this — score COMPARISONS (leadingSide,
 * winner highlight) run on the raw scaled int and are already correct.
 */
export function formatScore(
  def: SportDefinition | undefined,
  raw: number,
): string {
  const decimals =
    def && typeof def.scoreDecimals === 'number' && def.scoreDecimals > 0
      ? def.scoreDecimals
      : 0;
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  if (decimals > 0) {
    return (n / 10 ** decimals).toFixed(decimals);
  }
  return String(Math.trunc(n));
}

/**
 * Parse an operator's decimal score entry into the stored (scaled-integer)
 * value — the inverse of {@link formatScore}. This is what the console
 * passes to the `setScore` mutation.
 *
 * For a judged sport (`def.scoreDecimals` set), the operator types the
 * absolute team total (e.g. "195.825") and this returns the scaled int
 * (`Math.round(195.825 * 1000) === 195825`). For an integer sport the
 * entry is rounded to a whole number. Never throws: a non-numeric / NaN
 * entry becomes `0`, and the result is clamped to `>= 0` (a score is
 * never negative).
 */
export function parseScoreInput(
  def: SportDefinition | undefined,
  text: string,
): number {
  const decimals =
    def && typeof def.scoreDecimals === 'number' && def.scoreDecimals > 0
      ? def.scoreDecimals
      : 0;
  const parsed = parseFloat(text);
  if (!Number.isFinite(parsed)) return 0;
  const scaled =
    decimals > 0
      ? Math.round(parsed * 10 ** decimals)
      : Math.round(parsed);
  return scaled < 0 ? 0 : scaled;
}

/**
 * Typical per-player stat abbreviations for each sport — used to seed
 * the roster editor so a player's stat fields make sense for their
 * sport (a basketball player shows PTS/REB/AST, not baseball's
 * AVG/HR/RBI). Operators can still type any custom stat key.
 */
export const PLAYER_STATS: Record<string, string[]> = {
  football: ['YDS', 'TD', 'REC', 'TKL', 'INT'],
  basketball: ['PTS', 'REB', 'AST', 'STL', 'BLK'],
  baseball: ['AVG', 'HR', 'RBI', 'H', 'R', 'SB'],
  softball: ['AVG', 'HR', 'RBI', 'H', 'R', 'SB'],
  soccer: ['G', 'A', 'SH', 'SV'],
  volleyball: ['K', 'AST', 'DIG', 'BLK', 'ACE'],
  wrestling: ['W', 'L', 'PIN', 'TD'],
  hockey: ['G', 'A', 'PTS', 'PIM', 'SOG'],
  lacrosse: ['G', 'A', 'GB', 'SH'],
  field_hockey: ['G', 'A', 'SH', 'SV'],
  water_polo: ['G', 'A', 'ST', 'EXC'],
  pickleball: ['W', 'L', 'PTS'],
  track_and_field: ['PTS', 'PL', 'PR', 'MK'],
  // DEPRECATED — see the SWIMMING_DIVING const. Kept so PLAYER_STATS[sport]
  // lookups for pre-split games (and STAT_SEMANTICS coverage) still resolve.
  swimming_diving: ['PTS', 'PL', 'PR', 'MK'],
  swimming: ['PL', 'TIME', 'PTS', 'PR'],
  diving: ['PL', 'SCORE', 'DD', 'PTS'],
  cross_country: ['PTS', 'PL', 'TIME', 'PR'],
  gymnastics: ['PTS', 'VT', 'UB', 'BB', 'FX'],
  golf: ['STR', 'PAR', 'HOLE', 'W'],
  competitive_cheer: ['PTS', 'PL', 'RND'],
};

// ── Ribbon content presets ─────────────────────────────────────
/**
 * VenueOS Sports — stadium ribbon content presets.
 *
 * The ribbon board (the long LED strip wrapping a venue) scrolls a
 * reel of content tiles. These presets are the operator's on/off
 * switches for what rides the reel: the score, the game clock, the
 * period, the sport-specific game situation, plus the engagement
 * tiles (crowd messages, player spotlights, sponsors).
 *
 * The catalog is SPORT-AWARE — `clock` only exists for sports that
 * have a game clock, `situation` only for sports with stat fields,
 * and every label adapts to the sport (baseball shows "Inning",
 * football "Quarter"; baseball's situation is "Count & bases",
 * football's is "Down & distance").
 *
 * Stored per game as a RIBBON_PRESETS GameEvent (latest-wins) — no
 * table, no migration. A game with no stored config shows every
 * applicable preset, so the ribbon "just works" untouched.
 */
export type RibbonPresetKey =
  | 'score'
  | 'segment'
  | 'clock'
  | 'situation'
  | 'prompts'
  | 'roster'
  | 'sponsors'
  | 'slides';

export interface RibbonPreset {
  key: RibbonPresetKey;
  /** Operator-facing name — adapts to the sport. */
  label: string;
  /** One-line hint shown beneath the toggle. */
  hint: string;
  /** Toggle grouping in the control panel. */
  group: 'core' | 'engagement';
}

/** The sport-specific label for the `situation` tile. */
function ribbonSituationLabel(def: SportDefinition): string {
  switch (def.key) {
    case 'football':
      return 'Down & distance';
    case 'baseball':
    case 'softball':
      return 'Count & bases';
    case 'basketball':
      return 'Fouls & possession';
    case 'soccer':
      return 'Shots & added time';
    case 'volleyball':
      return 'Sets & serve';
    case 'pickleball':
      return 'Games & serve';
    case 'wrestling':
      return 'Ride time';
    case 'hockey':
      return 'Shots & penalties';
    case 'lacrosse':
      return 'Shots & ground balls';
    case 'field_hockey':
      return 'Shots & corners';
    case 'water_polo':
      return 'Shots & exclusions';
    case 'track_and_field':
    // DEPRECATED key — pre-split games only; current event is still the
    // right label for it.
    case 'swimming_diving':
    case 'swimming':
      return 'Current event';
    case 'diving':
      return 'Current dive & DD';
    case 'cross_country':
      return 'Finishers & lead';
    case 'gymnastics':
      return 'Current apparatus';
    case 'golf':
      return 'Hole & par';
    case 'competitive_cheer':
      return 'Division & round';
    default:
      return 'Game situation';
  }
}

/**
 * The ribbon preset catalog for a sport — the toggles the operator
 * sees, in display order. `clock` is omitted for clockless sports
 * (baseball, volleyball, pickleball); `situation` is omitted for a
 * sport with no stat fields.
 */
export function ribbonPresetCatalog(def: SportDefinition): RibbonPreset[] {
  const noun = def.segment.name; // "Quarter" / "Inning" / "Set" / …
  const presets: RibbonPreset[] = [
    {
      key: 'score',
      label: 'Score',
      hint: 'Live team scoreline with logos',
      group: 'core',
    },
    {
      key: 'segment',
      label: noun,
      hint: `Current ${noun.toLowerCase()}`,
      group: 'core',
    },
  ];
  if (def.clock.type !== 'none') {
    presets.push({
      key: 'clock',
      label: def.clock.type === 'countup' ? 'Game clock' : 'Time remaining',
      hint:
        def.clock.type === 'countup'
          ? 'Live count-up game clock'
          : 'Live count-down game clock',
      group: 'core',
    });
  }
  if (def.stats.length > 0) {
    presets.push({
      key: 'situation',
      label: ribbonSituationLabel(def),
      hint: 'Sport-specific live game situation',
      group: 'core',
    });
  }
  presets.push(
    {
      key: 'prompts',
      label: 'Crowd messages',
      hint: 'Your custom ribbon messages, or default crowd chants',
      group: 'engagement',
    },
    {
      key: 'roster',
      label: 'Player spotlights',
      hint: 'Roster cards — photo, number, stat line',
      group: 'engagement',
    },
    {
      key: 'sponsors',
      label: 'Sponsor banners',
      hint: 'Sponsor logos in weighted rotation',
      group: 'engagement',
    },
    {
      key: 'slides',
      label: 'Image slides',
      hint: 'Full-bleed images you upload — sponsor banners, promos, welcome art',
      group: 'engagement',
    },
  );
  return presets;
}

/**
 * Every applicable preset key for a sport — the default-on set used
 * when a game has no stored ribbon config (the ribbon shows it all).
 */
export function defaultRibbonPresets(def: SportDefinition): RibbonPresetKey[] {
  return ribbonPresetCatalog(def).map((p) => p.key);
}

/**
 * Validate an untrusted preset list against a sport's catalog: keep
 * only keys that exist for THIS sport, de-duplicate, and return them
 * in catalog order for a stable, predictable reel. An all-empty
 * result is allowed — the operator cleared the reel; the ribbon then
 * falls back to the score alone so a board is never blank.
 */
export function sanitizeRibbonPresets(
  def: SportDefinition,
  input: unknown,
): RibbonPresetKey[] {
  const picked = new Set<string>();
  if (Array.isArray(input)) {
    for (const raw of input) picked.add(String(raw));
  }
  return ribbonPresetCatalog(def)
    .map((p) => p.key)
    .filter((k) => picked.has(k));
}

/**
 * Resolve the EFFECTIVE preset list for a game: the stored config if
 * one exists, otherwise every applicable preset (the "just works"
 * default). `stored` is the raw payload of the latest RIBBON_PRESETS
 * event — null/undefined when the reel has never been configured.
 */
export function resolveRibbonPresets(
  def: SportDefinition,
  stored: unknown,
): RibbonPresetKey[] {
  if (stored === null || stored === undefined) return defaultRibbonPresets(def);
  return sanitizeRibbonPresets(def, stored);
}

// ── Ribbon scroll speed ────────────────────────────────────────
/**
 * How fast the ribbon reel scrolls. The operator picks one of these
 * named speeds; the ribbon divides its loop duration by the
 * multiplier — a higher multiplier scrolls faster. "Slow" lets a
 * sponsor image dwell on screen far longer than the default.
 */
export type RibbonSpeed = 'slow' | 'normal' | 'fast' | 'veryfast';

export interface RibbonSpeedOption {
  key: RibbonSpeed;
  label: string;
  /** Scroll-rate multiplier — higher scrolls faster. */
  multiplier: number;
}

export const RIBBON_SPEEDS: RibbonSpeedOption[] = [
  { key: 'slow', label: 'Slow', multiplier: 0.45 },
  { key: 'normal', label: 'Normal', multiplier: 1 },
  { key: 'fast', label: 'Fast', multiplier: 1.8 },
  { key: 'veryfast', label: 'Very fast', multiplier: 2.8 },
];

export const DEFAULT_RIBBON_SPEED: RibbonSpeed = 'normal';

/** Normalize an untrusted speed value to a known RibbonSpeed. */
export function sanitizeRibbonSpeed(v: unknown): RibbonSpeed {
  const s = String(v || '').toLowerCase();
  return RIBBON_SPEEDS.some((o) => o.key === s)
    ? (s as RibbonSpeed)
    : DEFAULT_RIBBON_SPEED;
}

/** The scroll-rate multiplier for a speed value (defaults to 1×). */
export function ribbonSpeedMultiplier(v: unknown): number {
  const key = sanitizeRibbonSpeed(v);
  return RIBBON_SPEEDS.find((o) => o.key === key)?.multiplier ?? 1;
}

// ── Ribbon score recurrence (full-bowl wrap) ───────────────────
/**
 * How many times the score / clock anchor repeats around the stadium
 * ribbon. A straight ribbon along one wall wants ONE anchor; a
 * continuous full-bowl wrap that rings the whole seating bowl needs
 * the score to repeat so it stays glanceable from every seat. 'auto'
 * lets the ribbon size the count from its own aspect ratio.
 */
export type RibbonScoreRepeat = 'auto' | '1' | '2' | '3' | '4';

export interface RibbonScoreRepeatOption {
  key: RibbonScoreRepeat;
  label: string;
  /** Operator-facing one-liner — the picker shows this under the row. */
  hint: string;
}

export const RIBBON_SCORE_REPEATS: RibbonScoreRepeatOption[] = [
  {
    key: 'auto',
    label: 'Auto',
    hint: 'Auto-fits the score count to your ribbon’s width — the safe default.',
  },
  { key: '1', label: '1×', hint: 'One scorebug — a straight ribbon along a single wall.' },
  { key: '2', label: '2×', hint: 'The score shows twice around the ribbon.' },
  { key: '3', label: '3×', hint: 'The score shows three times — good for a full-bowl wrap.' },
  { key: '4', label: '4×', hint: 'The score shows four times around a long wrap.' },
];

export const DEFAULT_RIBBON_SCORE_REPEAT: RibbonScoreRepeat = 'auto';

/** Normalize an untrusted score-repeat value to a known key. */
export function sanitizeRibbonScoreRepeat(v: unknown): RibbonScoreRepeat {
  const s = String(v ?? '').toLowerCase();
  return RIBBON_SCORE_REPEATS.some((o) => o.key === s)
    ? (s as RibbonScoreRepeat)
    : DEFAULT_RIBBON_SCORE_REPEAT;
}

/**
 * The pinned score-anchor count for a score-repeat value, or 0 for
 * 'auto' — the ribbon then derives the count from its own width.
 */
export function ribbonScoreRepeatCount(v: unknown): number {
  const key = sanitizeRibbonScoreRepeat(v);
  return key === 'auto' ? 0 : Number(key);
}

// ════════════════════════════════════════════════════════════════
// PHASE 0 — Stat semantics, value parsing, career thresholds, and
// milestone seed defs for the Player-Stats / Records / Milestone
// engine. (Locked spec: docs/research/2026-06-15-sports-pro-gap-
// analysis/01-STATS-ENGINE-SPEC.md, "PHASE 0".)
//
// PURE TYPES-PACKAGE ADDITION — nothing reads this yet. Every later
// phase (leader computation, season/career aggregation, record
// detection, milestone cinematics) depends on knowing whether a stat
// SUMS across games (PTS, GOALS) or must be RECOMPUTED from its
// components (AVG, FG%, ERA), whether higher is better (false for
// golf strokes / race times / ERA), and how to parse a display
// string ("19", ".312", "1:52.31", "142-06") into a comparable
// number.
//
// These live as a SIBLING map to `SportStatField` / `PLAYER_STATS`,
// NOT as fields on them — `SportStatField` is the operator stat-entry
// control contract for the live console, and adding aggregation
// metadata there risks that load-bearing surface (conflict C4 in the
// locked spec).
// ════════════════════════════════════════════════════════════════

/**
 * The aggregation + comparison semantics for one player-stat key.
 *
 * `kind`:
 *   - `'counting'` — sums across games (PTS, GOALS, AST, REB, TKL…).
 *     Career/season totals are the SUM of per-game values.
 *   - `'rate'` — a derived value that must be RECOMPUTED from its
 *     components, never summed (AVG, FG%, ERA, a gymnastics apparatus
 *     score). Summing a batting average across games is meaningless,
 *     so aggregation pipelines must skip these for SUM and recompute
 *     from raw components when they have them.
 *
 * `higherBetter` — true for almost everything (more points/goals is
 * better); false for golf strokes, race/swim TIMEs, finishing PLACE,
 * losses (L), penalty minutes (PIM), exclusions (EXC), ERA — where a
 * LOWER number is the better performance.
 *
 * `decimals` — display precision hint (AVG → 3, a gymnastics score →
 * 3, percentages → 1). Omitted = integer.
 *
 * `timeMark` — true for "M:SS.cc" / ":SS.c" track-and-swim time marks
 * that `parseStatValue` converts to total CENTISECONDS for comparison
 * (lower = faster = better, paired with `higherBetter: false`).
 */
export interface StatSemantic {
  /** Matches an entry in `PLAYER_STATS[sport]`. */
  key: string;
  /** Sum across games (`counting`) vs recompute-from-components (`rate`). */
  kind: 'counting' | 'rate';
  /** false for golf strokes, race/swim TIME, ERA, place, losses. */
  higherBetter: boolean;
  /** Display precision (e.g. AVG → 3). Omitted = integer. */
  decimals?: number;
  /** "1:52.31" → centiseconds parse (track/swim time marks). */
  timeMark?: boolean;
}

/**
 * Stat semantics for EVERY key in `PLAYER_STATS`, all 18 sports. One
 * row per `PLAYER_STATS[sport][*]` key — a missing row breaks leader
 * computation downstream, so `sports-semantics.spec.ts` iterates
 * `PLAYER_STATS` and asserts full coverage (catches drift when a new
 * stat key is added to a sport).
 *
 * Classification notes for the non-obvious rows:
 *   - baseball/softball `AVG` is the lone `rate` (batting average,
 *     recompute from H/AB, never sum); all other batting counts sum.
 *   - golf `STR` (strokes) + `PAR` (over/under par) → `higherBetter:
 *     false`. `HOLE` / `W` (holes/matches won) sum, higher is better.
 *   - track/field/swim/XC `PL` (finishing place) → lower is better;
 *     `MK` (mark/result) is a free-form text result (distances like
 *     "142-06", heights, times of varied format) → treated as a
 *     non-summable `rate` and left to `parseStatValue` to interpret
 *     (often unparseable → null, which is correct: you can't rank a
 *     field mark and a swim time on one scale). `PR` (personal-record
 *     flag/count) is a `rate` marker, not a running total.
 *   - cross_country `TIME` is a true `timeMark` ("18:42.5") → lower is
 *     better.
 *   - gymnastics apparatus scores (VT/UB/BB/FX) + overall `PTS` are
 *     judged `rate` scores (averaged/recomputed, 3-decimal), not sums.
 *   - competitive_cheer `PTS` is a judged routine score (`rate`); `RND`
 *     (round number) and `PL` (place) are positional.
 *   - hockey `PIM` (penalty minutes) sums but lower is better.
 *   - water_polo `EXC` (exclusions/ejections) sums but lower is better.
 *   - wrestling/pickleball `L` (losses) sums but lower is better.
 */
export const STAT_SEMANTICS: Record<string, StatSemantic[]> = {
  football: [
    { key: 'YDS', kind: 'counting', higherBetter: true },
    { key: 'TD', kind: 'counting', higherBetter: true },
    { key: 'REC', kind: 'counting', higherBetter: true },
    { key: 'TKL', kind: 'counting', higherBetter: true },
    { key: 'INT', kind: 'counting', higherBetter: true },
  ],
  basketball: [
    { key: 'PTS', kind: 'counting', higherBetter: true },
    { key: 'REB', kind: 'counting', higherBetter: true },
    { key: 'AST', kind: 'counting', higherBetter: true },
    { key: 'STL', kind: 'counting', higherBetter: true },
    { key: 'BLK', kind: 'counting', higherBetter: true },
  ],
  baseball: [
    { key: 'AVG', kind: 'rate', higherBetter: true, decimals: 3 },
    { key: 'HR', kind: 'counting', higherBetter: true },
    { key: 'RBI', kind: 'counting', higherBetter: true },
    { key: 'H', kind: 'counting', higherBetter: true },
    { key: 'R', kind: 'counting', higherBetter: true },
    { key: 'SB', kind: 'counting', higherBetter: true },
  ],
  softball: [
    { key: 'AVG', kind: 'rate', higherBetter: true, decimals: 3 },
    { key: 'HR', kind: 'counting', higherBetter: true },
    { key: 'RBI', kind: 'counting', higherBetter: true },
    { key: 'H', kind: 'counting', higherBetter: true },
    { key: 'R', kind: 'counting', higherBetter: true },
    { key: 'SB', kind: 'counting', higherBetter: true },
  ],
  soccer: [
    { key: 'G', kind: 'counting', higherBetter: true },
    { key: 'A', kind: 'counting', higherBetter: true },
    { key: 'SH', kind: 'counting', higherBetter: true },
    { key: 'SV', kind: 'counting', higherBetter: true },
  ],
  volleyball: [
    { key: 'K', kind: 'counting', higherBetter: true },
    { key: 'AST', kind: 'counting', higherBetter: true },
    { key: 'DIG', kind: 'counting', higherBetter: true },
    { key: 'BLK', kind: 'counting', higherBetter: true },
    { key: 'ACE', kind: 'counting', higherBetter: true },
  ],
  wrestling: [
    { key: 'W', kind: 'counting', higherBetter: true },
    { key: 'L', kind: 'counting', higherBetter: false },
    { key: 'PIN', kind: 'counting', higherBetter: true },
    { key: 'TD', kind: 'counting', higherBetter: true },
  ],
  hockey: [
    { key: 'G', kind: 'counting', higherBetter: true },
    { key: 'A', kind: 'counting', higherBetter: true },
    { key: 'PTS', kind: 'counting', higherBetter: true },
    { key: 'PIM', kind: 'counting', higherBetter: false },
    { key: 'SOG', kind: 'counting', higherBetter: true },
  ],
  lacrosse: [
    { key: 'G', kind: 'counting', higherBetter: true },
    { key: 'A', kind: 'counting', higherBetter: true },
    { key: 'GB', kind: 'counting', higherBetter: true },
    { key: 'SH', kind: 'counting', higherBetter: true },
  ],
  field_hockey: [
    { key: 'G', kind: 'counting', higherBetter: true },
    { key: 'A', kind: 'counting', higherBetter: true },
    { key: 'SH', kind: 'counting', higherBetter: true },
    { key: 'SV', kind: 'counting', higherBetter: true },
  ],
  water_polo: [
    { key: 'G', kind: 'counting', higherBetter: true },
    { key: 'A', kind: 'counting', higherBetter: true },
    { key: 'ST', kind: 'counting', higherBetter: true },
    { key: 'EXC', kind: 'counting', higherBetter: false },
  ],
  pickleball: [
    { key: 'W', kind: 'counting', higherBetter: true },
    { key: 'L', kind: 'counting', higherBetter: false },
    { key: 'PTS', kind: 'counting', higherBetter: true },
  ],
  track_and_field: [
    { key: 'PTS', kind: 'counting', higherBetter: true },
    { key: 'PL', kind: 'rate', higherBetter: false },
    { key: 'PR', kind: 'rate', higherBetter: true },
    { key: 'MK', kind: 'rate', higherBetter: true },
  ],
  // DEPRECATED — see the SWIMMING_DIVING const. Kept so STAT_SEMANTICS
  // coverage for pre-split games (PLAYER_STATS.swimming_diving) still
  // resolves; `statSemantic('swimming_diving', …)` keeps working forever.
  swimming_diving: [
    { key: 'PTS', kind: 'counting', higherBetter: true },
    { key: 'PL', kind: 'rate', higherBetter: false },
    { key: 'PR', kind: 'rate', higherBetter: true },
    { key: 'MK', kind: 'rate', higherBetter: false, timeMark: true },
  ],
  swimming: [
    { key: 'PL', kind: 'rate', higherBetter: false },
    { key: 'TIME', kind: 'rate', higherBetter: false, timeMark: true },
    { key: 'PTS', kind: 'counting', higherBetter: true },
    { key: 'PR', kind: 'rate', higherBetter: true },
  ],
  diving: [
    { key: 'PL', kind: 'rate', higherBetter: false },
    // Judged dive score — a decimal running total (rate, not summed).
    { key: 'SCORE', kind: 'rate', higherBetter: true, decimals: 2 },
    // Degree of Difficulty — a decimal descriptor of the dive attempted,
    // not a counting/summable stat.
    { key: 'DD', kind: 'rate', higherBetter: true, decimals: 1 },
    { key: 'PTS', kind: 'counting', higherBetter: true },
  ],
  cross_country: [
    { key: 'PTS', kind: 'counting', higherBetter: false },
    { key: 'PL', kind: 'rate', higherBetter: false },
    { key: 'TIME', kind: 'rate', higherBetter: false, timeMark: true },
    { key: 'PR', kind: 'rate', higherBetter: true },
  ],
  gymnastics: [
    { key: 'PTS', kind: 'rate', higherBetter: true, decimals: 3 },
    { key: 'VT', kind: 'rate', higherBetter: true, decimals: 3 },
    { key: 'UB', kind: 'rate', higherBetter: true, decimals: 3 },
    { key: 'BB', kind: 'rate', higherBetter: true, decimals: 3 },
    { key: 'FX', kind: 'rate', higherBetter: true, decimals: 3 },
  ],
  golf: [
    { key: 'STR', kind: 'counting', higherBetter: false },
    { key: 'PAR', kind: 'rate', higherBetter: false },
    { key: 'HOLE', kind: 'counting', higherBetter: true },
    { key: 'W', kind: 'counting', higherBetter: true },
  ],
  competitive_cheer: [
    { key: 'PTS', kind: 'rate', higherBetter: true, decimals: 2 },
    { key: 'PL', kind: 'rate', higherBetter: false },
    { key: 'RND', kind: 'rate', higherBetter: true },
  ],
};

/**
 * Look up the `StatSemantic` for a (sport, statKey) pair, or
 * `undefined` if the sport/key isn't classified. Convenience helper
 * so callers don't re-scan `STAT_SEMANTICS[sport]` by hand.
 */
export function statSemantic(
  sport: string,
  key: string,
): StatSemantic | undefined {
  return STAT_SEMANTICS[sport]?.find((s) => s.key === key);
}

/**
 * Parse a `RosterPlayer.stats` display value into a comparable number
 * for ranking/aggregation, or `null` when the value can't be reduced
 * to a single scalar (a field mark like "142-06", "DNP", "—", "").
 *
 * NEVER throws — any unparseable input returns `null` so the live
 * game path can't be wedged by a malformed stat (fail-open, spec §4).
 *
 * Handled forms:
 *   - plain integers           "19"        → 19
 *   - decimals (leading-dot)   ".312"      → 0.312
 *   - decimals                 "9.85"      → 9.85
 *   - signed / over-par        "-3" "+2"   → -3 / 2
 *   - thousands separators     "1,250"     → 1250
 *   - time marks (sem.timeMark):
 *         "1:52.31"            → 11231     (centiseconds)
 *         ":45.2"              → 4520
 *         "18:42"              → 112200
 *   - distance/place strings that aren't a single scalar
 *     ("142-06", "5-10", "DNP", "DNF", "DQ", "—", "-", "")  → null
 *
 * The `sem` arg only changes behavior for time marks — without
 * `sem.timeMark`, a "1:52.31"-shaped string is ambiguous (could be a
 * mark, could be a "made-attempted" pair) and returns `null` rather
 * than guessing.
 */
export function parseStatValue(
  raw: string | number,
  sem?: StatSemantic,
): number | null {
  // Already a number — accept only finite values.
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw !== 'string') return null;

  const s = raw.trim();
  if (s === '') return null;

  // Time mark: "M:SS.cc" / "MM:SS" / ":SS.c" → total centiseconds.
  // Only when the semantic explicitly marks this key as a time.
  if (sem?.timeMark) {
    return parseTimeMarkToCentis(s);
  }

  // A bare "1:52.31" outside a timeMark context is ambiguous; refuse it.
  if (s.includes(':')) return null;

  // Dashed pairs ("142-06", "5-10", "12-3") are not a single scalar —
  // null. A leading minus sign ("-3") is a signed number, NOT a pair,
  // so only treat an INTERIOR dash as a pair separator.
  if (/[0-9]-[0-9]/.test(s)) return null;

  // Strip thousands separators, then require a clean numeric shape:
  // optional sign, optional digits, optional single decimal point.
  const cleaned = s.replace(/,/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a "M:SS.cc" / "MM:SS" / ":SS.c" time mark to total
 * centiseconds (1/100 s). Returns `null` on anything malformed.
 *   "1:52.31" → 1*6000 + 52*100 + 31 = 11231
 *   ":45.2"   → 45*100 + 20         = 4520
 *   "18:42"   → 18*6000 + 42*100    = 112200
 *   "52.31"   → 52*100 + 31         = 5231   (no colon, seconds-only)
 */
function parseTimeMarkToCentis(s: string): number | null {
  // Split optional minutes from "ss.cc".
  let minutesPart = '';
  let secondsPart = s;
  const colon = s.indexOf(':');
  if (colon !== -1) {
    minutesPart = s.slice(0, colon);
    secondsPart = s.slice(colon + 1);
  }

  // Minutes: empty (":45.2") counts as 0; else whole digits only.
  let minutes = 0;
  if (minutesPart !== '') {
    if (!/^\d+$/.test(minutesPart)) return null;
    minutes = Number(minutesPart);
  }

  // Seconds: "SS" or "SS.cc" — seconds whole, optional centis fraction.
  const m = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(secondsPart);
  if (!m) return null;
  const seconds = Number(m[1]);
  if (seconds >= 60) return null;
  // Pad/truncate the fraction to exactly 2 digits of centiseconds.
  const centis = m[2] ? Number((m[2] + '00').slice(0, 2)) : 0;

  return minutes * 6000 + seconds * 100 + centis;
}

/**
 * Career milestone thresholds, per sport, per COUNTING stat. The
 * engine fires a `CEL_MILESTONE_CAREER` cinematic when an athlete's
 * running career total crosses one of these marks. Focus is on the
 * marquee per-sport counting stat (basketball PTS, soccer G, etc.);
 * supporting stats carry sensible-but-lighter ladders. Rate stats
 * (AVG, judged scores) and lower-is-better stats (golf STR, race
 * TIME) have NO career threshold — you don't celebrate accumulating
 * strokes or losses.
 *
 * Tenant rows can shadow these defaults in Phase 2's
 * `StatMilestoneDef` table; this map is the seed.
 */
export const CAREER_THRESHOLDS: Record<string, Record<string, number[]>> = {
  football: {
    YDS: [1000, 2500, 5000, 7500, 10000],
    TD: [10, 25, 50, 75, 100],
    TKL: [50, 100, 200, 300],
  },
  basketball: {
    PTS: [500, 1000, 1500, 2000, 2500, 3000],
    REB: [250, 500, 1000, 1500],
    AST: [250, 500, 1000],
    STL: [100, 200, 300],
    BLK: [100, 200, 300],
  },
  baseball: {
    H: [25, 50, 100, 150, 200],
    HR: [10, 25, 50, 75, 100],
    RBI: [25, 50, 100, 150],
  },
  softball: {
    H: [25, 50, 100, 150, 200],
    HR: [10, 25, 50, 75, 100],
    RBI: [25, 50, 100, 150],
  },
  soccer: {
    G: [10, 25, 50, 75, 100],
    A: [10, 25, 50],
  },
  volleyball: {
    K: [100, 250, 500, 1000],
    DIG: [100, 250, 500, 1000],
    ACE: [50, 100, 200],
    AST: [250, 500, 1000],
  },
  wrestling: {
    W: [25, 50, 100, 150, 200],
    PIN: [10, 25, 50, 75, 100],
  },
  hockey: {
    G: [10, 25, 50, 100],
    A: [10, 25, 50, 100],
    PTS: [25, 50, 100, 150, 200],
  },
  lacrosse: {
    G: [25, 50, 100, 150, 200],
    A: [25, 50, 100],
    GB: [50, 100, 200],
  },
  field_hockey: {
    G: [10, 25, 50, 75, 100],
    A: [10, 25, 50],
  },
  water_polo: {
    G: [25, 50, 100, 150, 200],
    A: [25, 50, 100],
    ST: [25, 50, 100],
  },
  pickleball: {
    W: [10, 25, 50, 100],
    PTS: [100, 250, 500, 1000],
  },
  track_and_field: {
    PTS: [50, 100, 250, 500],
  },
  // DEPRECATED — see the SWIMMING_DIVING const. Kept for pre-split games.
  swimming_diving: {
    PTS: [50, 100, 250, 500],
  },
  swimming: {
    PTS: [50, 100, 250, 500],
  },
  diving: {
    PTS: [50, 100, 250, 500],
  },
  cross_country: {
    // PTS in XC is lower-is-better team scoring; no career ladder.
  },
  gymnastics: {
    // All-judged rate scores; no counting milestone.
  },
  golf: {
    W: [5, 10, 25, 50],
    HOLE: [100, 250, 500, 1000],
  },
  competitive_cheer: {
    // Judged routine scores; no counting milestone.
  },
};

/**
 * One milestone definition — a celebratable achievement slot the
 * engine watches for. `kind`:
 *   - `'THRESHOLD'` — a fixed career/season mark (the 1,000th point);
 *     `threshold` is set. Fires `CEL_MILESTONE_CAREER`.
 *   - `'RECORD'`    — a new school/program record for `statKey`
 *     (no fixed number — beats the standing record). Fires
 *     `CEL_MILESTONE_RECORD`.
 *   - `'NTH'`       — an Nth-of-something occurrence (Phase 3b live
 *     deltas, e.g. "100th career goal AS IT HAPPENS"); `threshold`
 *     is the N.
 *
 * `cueKey` points at the celebration cinematic in `CTS_CINEMATIC_
 * CUE_IDS` / the client `CUE_CATALOG`:
 *   - records  → 'CEL_MILESTONE_RECORD'
 *   - career   → 'CEL_MILESTONE_CAREER'
 */
export interface MilestoneDef {
  sport: string;
  statKey: string;
  kind: 'THRESHOLD' | 'RECORD' | 'NTH';
  /** The mark (THRESHOLD) or the N (NTH); absent for RECORD. */
  threshold?: number;
  /** Operator-/board-facing headline, e.g. "1,000 Career Points". */
  label: string;
  /** Celebration cinematic id (see `CTS_CINEMATIC_CUE_IDS`). */
  cueKey: string;
  emoji?: string;
}

/** The career-milestone cue id (1,000th point, 100th goal, …). */
export const CUE_MILESTONE_CAREER = 'CEL_MILESTONE_CAREER';
/** The new-record cue id (NEW SCHOOL RECORD). */
export const CUE_MILESTONE_RECORD = 'CEL_MILESTONE_RECORD';

/** Human label for a stat key, falling back to the key itself. */
function statKeyLabel(sport: string, key: string): string {
  const LABELS: Record<string, string> = {
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
    G: 'Goals',
    A: 'Assists',
    SOG: 'Shots on Goal',
    K: 'Kills',
    DIG: 'Digs',
    ACE: 'Aces',
    W: 'Wins',
    PIN: 'Pins',
    GB: 'Ground Balls',
    ST: 'Steals',
    HOLE: 'Holes Won',
  };
  return LABELS[key] ?? key;
}

/**
 * Seeded milestone definitions for all 18 sports, derived from
 * `CAREER_THRESHOLDS`:
 *   - one `THRESHOLD` row per (sport, counting-stat, threshold mark)
 *     → `CEL_MILESTONE_CAREER`
 *   - one generic `RECORD` row per (sport, counting-stat) that has a
 *     threshold ladder (the marquee stats) → `CEL_MILESTONE_RECORD`
 *
 * Phase 2 seeds these into the `StatMilestoneDef` table (idempotent,
 * `tenantId=null` defaults; tenant rows can shadow).
 */
export const MILESTONE_DEFS: MilestoneDef[] = (() => {
  const defs: MilestoneDef[] = [];
  for (const [sport, byStat] of Object.entries(CAREER_THRESHOLDS)) {
    for (const [statKey, marks] of Object.entries(byStat)) {
      const noun = statKeyLabel(sport, statKey);
      // Career-threshold rows.
      for (const threshold of marks) {
        defs.push({
          sport,
          statKey,
          kind: 'THRESHOLD',
          threshold,
          label: `${threshold.toLocaleString('en-US')} Career ${noun}`,
          cueKey: CUE_MILESTONE_CAREER,
          emoji: '⭐',
        });
      }
      // One generic record row per marquee counting stat.
      defs.push({
        sport,
        statKey,
        kind: 'RECORD',
        label: `New ${noun} Record`,
        cueKey: CUE_MILESTONE_RECORD,
        emoji: '🏆',
      });
    }
  }
  return defs;
})();
