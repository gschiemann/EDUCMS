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
  ],
  celebrations: [
    { key: 'touchdown', label: 'Touchdown', emoji: '🏈' },
    { key: 'fieldGoal', label: 'Field Goal', emoji: '🥅' },
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
  stats: [
    { key: 'homeFouls', label: 'Home Fouls', scope: 'home', type: 'number', min: 0, max: 30 },
    { key: 'awayFouls', label: 'Away Fouls', scope: 'away', type: 'number', min: 0, max: 30 },
    { key: 'homeTimeouts', label: 'Home Timeouts', scope: 'home', type: 'number', min: 0, max: 5 },
    { key: 'awayTimeouts', label: 'Away Timeouts', scope: 'away', type: 'number', min: 0, max: 5 },
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
  segment: { name: 'Inning', count: 7, overtime: true },
  score: { unit: 'runs', increments: [1, 2, 3, 4] },
  stats: [
    { key: 'balls', label: 'Balls', scope: 'game', type: 'number', min: 0, max: 3 },
    { key: 'strikes', label: 'Strikes', scope: 'game', type: 'number', min: 0, max: 2 },
    { key: 'outs', label: 'Outs', scope: 'game', type: 'number', min: 0, max: 2 },
    { key: 'half', label: 'Inning Half', scope: 'game', type: 'text' },
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
    { key: 'save', label: 'Big Save', emoji: '🥅' },
  ],
};

const LACROSSE: SportDefinition = {
  key: 'lacrosse',
  name: 'Lacrosse',
  emoji: '🥍',
  mode: 'HEAD_TO_HEAD',
  clock: { type: 'countdown', segmentMs: 12 * 60_000 },
  segment: { name: 'Quarter', count: 4, overtime: true },
  score: { unit: 'goals', increments: [1] },
  stats: [
    { key: 'homeShots', label: 'Home Shots', scope: 'home', type: 'number', min: 0, max: 99 },
    { key: 'awayShots', label: 'Away Shots', scope: 'away', type: 'number', min: 0, max: 99 },
    { key: 'homeGroundBalls', label: 'Home Ground Balls', scope: 'home', type: 'number', min: 0, max: 99 },
    { key: 'awayGroundBalls', label: 'Away Ground Balls', scope: 'away', type: 'number', min: 0, max: 99 },
  ],
  celebrations: [
    { key: 'goal', label: 'GOAL!', emoji: '🥍' },
    { key: 'save', label: 'Save', emoji: '🥅' },
    { key: 'groundBall', label: 'Ground Ball', emoji: '🔄' },
    { key: 'manUp', label: 'Man Up', emoji: '⚡' },
  ],
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
    { key: 'save', label: 'Save', emoji: '🥅' },
    { key: 'penaltyCorner', label: 'Penalty Corner', emoji: '📐' },
    { key: 'greenCard', label: 'Green Card', emoji: '🟩' },
  ],
};

const WATER_POLO: SportDefinition = {
  key: 'water_polo',
  name: 'Water Polo',
  emoji: '🤽',
  mode: 'HEAD_TO_HEAD',
  clock: { type: 'countdown', segmentMs: 7 * 60_000 },
  segment: { name: 'Quarter', count: 4, overtime: true },
  score: { unit: 'goals', increments: [1] },
  stats: [
    { key: 'homeShots', label: 'Home Shots', scope: 'home', type: 'number', min: 0, max: 99 },
    { key: 'awayShots', label: 'Away Shots', scope: 'away', type: 'number', min: 0, max: 99 },
    { key: 'homeExclusions', label: 'Home Exclusions', scope: 'home', type: 'number', min: 0, max: 30 },
    { key: 'awayExclusions', label: 'Away Exclusions', scope: 'away', type: 'number', min: 0, max: 30 },
  ],
  celebrations: [
    { key: 'goal', label: 'GOAL!', emoji: '🤽' },
    { key: 'save', label: 'Save', emoji: '🥅' },
    { key: 'exclusion', label: 'Exclusion', emoji: '✋' },
    { key: 'powerPlay', label: 'Power Play', emoji: '⚡' },
  ],
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
};

/** Ordered list for pickers. */
export const SPORTS: SportDefinition[] = [
  FOOTBALL, BASKETBALL, BASEBALL, SOFTBALL, SOCCER, VOLLEYBALL, WRESTLING,
  HOCKEY, LACROSSE, FIELD_HOCKEY, WATER_POLO, PICKLEBALL,
];

/** Look up a sport definition by key; undefined if unknown. */
export function findSport(key: string | null | undefined): SportDefinition | undefined {
  return key ? SPORT_DEFINITIONS[key] : undefined;
}
