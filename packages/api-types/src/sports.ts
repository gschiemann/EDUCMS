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

export interface SportDefinition {
  key: string;
  name: string;
  emoji: string;
  mode: SportMode;
  /** countdown = clock runs to 0 (US football/basketball); countup =
   *  clock counts up (soccer); none = no clock (baseball/volleyball) */
  clock: { type: ClockType; segmentMs?: number };
  /** the period structure — "Quarter" × 4, "Inning" × 7, "Set" × 5 … */
  segment: { name: string; count: number; overtime: boolean };
  /** score unit + the increments the control offers as quick buttons */
  score: { unit: string; increments: number[] };
  stats: SportStatField[];
  celebrations: SportCelebration[];
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

const FOOTBALL: SportDefinition = {
  key: 'football',
  name: 'Football',
  emoji: '🏈',
  mode: 'HEAD_TO_HEAD',
  clock: { type: 'countdown', segmentMs: 12 * 60_000 },
  segment: { name: 'Quarter', count: 4, overtime: true },
  score: { unit: 'points', increments: [1, 2, 3, 6] },
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
    { key: 'touchdown', label: 'Touchdown', emoji: '🏈' },
    { key: 'fieldGoal', label: 'Field Goal', emoji: '🏈' },
    { key: 'firstDown', label: 'First Down', emoji: '📍' },
    { key: 'sack', label: 'Sack', emoji: '💥' },
    { key: 'turnover', label: 'Turnover', emoji: '🔄' },
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
  stats: [
    { key: 'homeFouls', label: 'Home Fouls', scope: 'home', type: 'number', min: 0, max: 30 },
    { key: 'awayFouls', label: 'Away Fouls', scope: 'away', type: 'number', min: 0, max: 30 },
    { key: 'homeTimeouts', label: 'Home Timeouts', scope: 'home', type: 'number', min: 0, max: 5 },
    { key: 'awayTimeouts', label: 'Away Timeouts', scope: 'away', type: 'number', min: 0, max: 5 },
    // Possession arrow — 'home' / 'away'.
    { key: 'possession', label: 'Possession (home / away)', scope: 'game', type: 'text' },
  ],
  celebrations: [
    { key: 'threePointer', label: 'Three!', emoji: '🎯' },
    { key: 'dunk', label: 'Dunk', emoji: '💪' },
    { key: 'buzzerBeater', label: 'Buzzer Beater', emoji: '⏰' },
    { key: 'steal', label: 'Steal', emoji: '🖐️' },
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
  ],
  celebrations: [
    { key: 'homeRun', label: 'Home Run', emoji: '⚾' },
    { key: 'grandSlam', label: 'Grand Slam', emoji: '💎' },
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
    { key: 'grandSlam', label: 'Grand Slam', emoji: '💎' },
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
    { key: 'goal', label: 'GOAL!', emoji: '⚽' },
    { key: 'penalty', label: 'Penalty', emoji: '🎯' },
    { key: 'yellowCard', label: 'Yellow Card', emoji: '🟨' },
    { key: 'redCard', label: 'Red Card', emoji: '🟥' },
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
  score: { unit: 'points', increments: [1, 2, 3, 4] },
  stats: [
    { key: 'homeRideTime', label: 'Home Ride Time (s)', scope: 'home', type: 'number', min: 0, max: 600 },
    { key: 'awayRideTime', label: 'Away Ride Time (s)', scope: 'away', type: 'number', min: 0, max: 600 },
  ],
  celebrations: [
    { key: 'pin', label: 'PIN!', emoji: '🤼' },
    { key: 'takedown', label: 'Takedown', emoji: '💥' },
    { key: 'nearFall', label: 'Near Fall', emoji: '⚠️' },
    { key: 'techFall', label: 'Tech Fall', emoji: '🔥' },
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
  stats: [
    { key: 'homeShots', label: 'Home Shots', scope: 'home', type: 'number', min: 0, max: 99 },
    { key: 'awayShots', label: 'Away Shots', scope: 'away', type: 'number', min: 0, max: 99 },
    { key: 'homePenalties', label: 'Home Penalties', scope: 'home', type: 'number', min: 0, max: 30 },
    { key: 'awayPenalties', label: 'Away Penalties', scope: 'away', type: 'number', min: 0, max: 30 },
  ],
  celebrations: [
    { key: 'goal', label: 'GOAL!', emoji: '🚨' },
    { key: 'powerPlay', label: 'Power Play', emoji: '⚡' },
    { key: 'penaltyKill', label: 'Penalty Kill', emoji: '🛡️' },
    { key: 'hatTrick', label: 'Hat Trick', emoji: '🎩' },
    { key: 'save', label: 'Big Save', emoji: '🧤' },
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
  // offensive half.
  shotClock: { full: 80, short: 60, options: [0, 60, 80] },
  stats: [
    { key: 'homeShots', label: 'Home Shots', scope: 'home', type: 'number', min: 0, max: 99 },
    { key: 'awayShots', label: 'Away Shots', scope: 'away', type: 'number', min: 0, max: 99 },
    { key: 'homeGroundBalls', label: 'Home Ground Balls', scope: 'home', type: 'number', min: 0, max: 99 },
    { key: 'awayGroundBalls', label: 'Away Ground Balls', scope: 'away', type: 'number', min: 0, max: 99 },
  ],
  celebrations: [
    { key: 'goal', label: 'GOAL!', emoji: '🥍' },
    { key: 'save', label: 'Save', emoji: '🧤' },
    { key: 'groundBall', label: 'Ground Ball', emoji: '🔄' },
    { key: 'manUp', label: 'Man Up', emoji: '⚡' },
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
    { key: 'goal', label: 'GOAL!', emoji: '🏑' },
    { key: 'save', label: 'Save', emoji: '🧤' },
    { key: 'penaltyCorner', label: 'Penalty Corner', emoji: '📐' },
    { key: 'greenCard', label: 'Green Card', emoji: '🟩' },
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
    { key: 'goal', label: 'GOAL!', emoji: '🤽' },
    { key: 'save', label: 'Save', emoji: '🧤' },
    { key: 'exclusion', label: 'Exclusion', emoji: '✋' },
    { key: 'powerPlay', label: 'Power Play', emoji: '⚡' },
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
  score: { unit: 'points', increments: [1, 2, 3, 5, 8, 10] },
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
  score: { unit: 'points', increments: [1, 2, 3, 5, 8, 9] },
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
  // Team score accumulates across all apparatus; increments reflect
  // typical deduction-based scoring deltas per routine.
  score: { unit: 'points', increments: [1, 5, 10] },
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
  // standard; count covers the full round.
  segment: { name: 'Hole', count: 18, overtime: false },
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
  // Score is a judge-assigned decimal — increments reflect typical
  // score deltas entered after each routine.
  score: { unit: 'points', increments: [1, 5, 10] },
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
