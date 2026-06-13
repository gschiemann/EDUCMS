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
   *  clock counts up (soccer); none = no clock (baseball/volleyball) */
  clock: { type: ClockType; segmentMs?: number };
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

// ── Structured-stat validation (api writes; board reads) ──────────
/**
 * The structured `Game.stats` keys the operator console writes and the
 * board reads, distinct from the scalar sport-stat keys. Anything not in
 * this set (and not a sport-stat / META key) is dropped by `updateStats`.
 */
export const STRUCTURED_STAT_KEYS = ['results', 'playerFouls', 'playerExclusions'] as const;
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
    if (typeof r.order === 'number') result.order = clampInt(r.order, 0, 999);
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

/**
 * Validate one structured stat key's untrusted value into its bounded
 * shape — the single entry point `updateStats` calls. Returns the
 * sanitized array (always an array, possibly empty), or `undefined` if
 * `key` is not a structured-stat key (so the caller skips it).
 */
export function sanitizeStructuredStat(
  key: string,
  value: unknown,
): MeetResult[] | PlayerFoul[] | PlayerExclusion[] | undefined {
  switch (key) {
    case 'results':
      return sanitizeResults(value);
    case 'playerFouls':
      return sanitizePlayerFouls(value);
    case 'playerExclusions':
      return sanitizePlayerExclusions(value);
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
  // NFHS / NCAA / FINA regulation quarters are 8:00 (was 7:00).
  clock: { type: 'countdown', segmentMs: 8 * 60_000 },
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

/** All shipped sport definitions, keyed by `key`. */
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
  cross_country: CROSS_COUNTRY,
  gymnastics: GYMNASTICS,
  golf: GOLF,
  competitive_cheer: COMPETITIVE_CHEER,
};

/** Ordered list for pickers. */
export const SPORTS: SportDefinition[] = [
  FOOTBALL, BASKETBALL, BASEBALL, SOFTBALL, SOCCER, VOLLEYBALL, WRESTLING,
  HOCKEY, LACROSSE, FIELD_HOCKEY, WATER_POLO, PICKLEBALL,
  TRACK_AND_FIELD, SWIMMING_DIVING, CROSS_COUNTRY, GYMNASTICS, GOLF, COMPETITIVE_CHEER,
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
  swimming_diving: ['PTS', 'PL', 'PR', 'MK'],
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
    case 'swimming_diving':
      return 'Current event';
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
