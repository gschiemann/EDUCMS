/**
 * Celebration deck cue registry — TypeScript port of the CUES object
 * in venueos-celebration-deck.html.
 *
 * Every entry describes ONE cue declaratively. The shared
 * CelebrationDeckScene engine reads this config + renders the cinematic.
 * Adding a new cue = adding an entry here; no engine changes needed.
 *
 * 28 cues ported as of 2026-05-26 covering:
 *   Soccer:      penalty, yellow, red
 *   Water polo:  save, exclusion, powerplay
 *   Basketball:  dunk, buzzer, steal
 *   Hockey:      powerplay, penaltykill, hattrick, save
 *   Baseball:    grandslam, strikeout, doubleplay
 *   Football:    firstdown, sack, turnover
 *   Volleyball:  ace, block, setwon
 *   Wrestling:   pin, takedown, nearfall, techfall
 *
 * The 8 "marquee" v1 cinematics (water-polo-goal, soccer-goal-v1,
 * hockey-goal-v1, etc.) are SEPARATE — their own dedicated React
 * components for full custom hero art. See CelebrationWaterPoloGoal.
 */

export type DeckScene = 'grass' | 'ice' | 'pool' | 'court' | 'turf' | 'ballpark' | 'gym' | 'mat' | 'plate';
export type DeckBurst = 'fire' | 'energy' | 'ice' | 'water' | 'dust' | 'confetti' | 'fireworks' | 'none';
export type DeckMotif = 'card' | 'whistle' | 'glove' | 'bigK' | 'clock0' | 'hats' | 'shield' | 'plus1' | 'arrowFD' | 'swirl';
export type DeckBall = 'soccer' | 'basketball' | 'baseball' | 'football' | 'volleyball' | 'waterpolo' | 'puck';

export interface DeckProjectile {
  ball: DeckBall;
  /** [x, y] starting pixel coordinates inside the 1920×1080 canvas. */
  from: [number, number];
  /** Animation start ms (relative to scene start). */
  t0: number;
  /** Animation end ms (relative to scene start). */
  t1: number;
  /** Arc height in pixels. 0 = straight line. */
  arc?: number;
  /** Ball radius (default 32). */
  r?: number;
  /** Shrink during flight (depth illusion). */
  shrink?: boolean;
  /** Linear easing (instead of ease-out-quad). */
  ease?: 'lin';
}

export interface DeckTiming {
  fadeIn?: number;
  impact?: number;
  head?: number;
  hold?: number;
  end?: number;
}

export interface CelebrationDeckCfg {
  scene: DeckScene;
  headline: string;
  /** Headline font-size in design pixels (default 230). */
  headSize?: number;
  sub1: string;
  sub2?: string;
  burst: DeckBurst;
  motif?: DeckMotif;
  motifText?: string;
  motifColor?: string;
  projectile?: DeckProjectile;
  /** Custom impact-point resolver. Receives the scene's props {goal,
   *  rim, net, ...} and returns {x, y}. Without it, the engine
   *  picks from goal → rim → net → up → wall → mat → zone → center. */
  impactPt?: (P: { goal?: { x: number; y: number }; rim?: { x: number; y: number }; net?: { x: number; y: number }; up?: { x: number; y: number }; wall?: { x: number; y: number }; mat?: { x: number; y: number }; zone?: { x: number; y: number } }) => { x: number; y: number };
  /** Shake intensity in pixels (default 16). */
  shake?: number;
  /** Override default timings. */
  T?: DeckTiming;
}

/**
 * Cue id → config. Ids deliberately match the celebration-deck.html
 * registry exactly so an operator (or QA) can swap between the
 * standalone HTML deck and the React deck without losing identifiers.
 *
 * Operator-facing celebration buttons map onto these via pickCueConfig
 * (see ribbon page). Adding a new cue = adding an entry here +
 * registering the key in pickCueConfig.
 */
export const CELEBRATION_DECK_CUES: Record<string, CelebrationDeckCfg> = {
  // ── SOCCER ────────────────────────────────────────────────────
  'soccer-penalty': {
    scene: 'grass', headline: 'PENALTY!',
    sub1: 'HUNTINGTON BEACH  2  —  1  NEWPORT',
    sub2: "78'  ·  PENALTY  ·  #9 RIVERA",
    burst: 'fire',
    projectile: { ball: 'soccer', from: [430, 772], t0: 600, t1: 1000, arc: 130, r: 30, shrink: true },
  },
  'soccer-yellow': {
    scene: 'grass', headline: 'YELLOW CARD', headSize: 150,
    sub1: 'CAUTION', sub2: "58'  ·  #6 DELACRUZ",
    burst: 'none', motif: 'card', motifColor: '#ffd21a', shake: 6,
  },
  'soccer-red': {
    scene: 'grass', headline: 'RED CARD', headSize: 160,
    sub1: 'SENT OFF', sub2: "71'  ·  #4 BANKS",
    burst: 'none', motif: 'card', motifColor: '#e6362b', shake: 6,
  },

  // ── WATER POLO ────────────────────────────────────────────────
  'waterpolo-save': {
    scene: 'pool', headline: 'SAVE!',
    sub1: 'NEWPORT HARBOR  9  —  8  CORONA DEL MAR',
    sub2: '3RD  ·  BIG SAVE  ·  #1 GK',
    burst: 'water', motif: 'glove',
    projectile: { ball: 'waterpolo', from: [-160, 640], t0: 640, t1: 1000, arc: 80, r: 30 },
  },
  'waterpolo-exclusion': {
    scene: 'pool', headline: 'EXCLUSION', headSize: 160,
    sub1: 'MAN UP  —  6 ON 5', sub2: '2ND  ·  #7 EXCLUDED  ·  :20',
    burst: 'energy', motif: 'whistle',
  },
  'waterpolo-powerplay': {
    scene: 'pool', headline: 'POWER PLAY', headSize: 150,
    sub1: 'MAN ADVANTAGE', sub2: '6 ON 5',
    burst: 'energy', motif: 'plus1', motifText: '6v5',
  },

  // ── BASKETBALL ────────────────────────────────────────────────
  'basketball-dunk': {
    scene: 'court', headline: 'SLAM!', headSize: 240,
    sub1: 'MATER DEI  61  —  58  SANTA MARGARITA',
    sub2: '4TH  ·  DUNK  ·  #23 OKAFOR',
    burst: 'fire',
    projectile: { ball: 'basketball', from: [1500, 110], t0: 640, t1: 1000, arc: 0, r: 34 },
  },
  'basketball-buzzer': {
    scene: 'court', headline: 'BUZZER BEATER!', headSize: 140,
    sub1: 'AT THE HORN — WIN', sub2: '4TH  ·  0:00  ·  #3 REYES',
    burst: 'fire', motif: 'clock0',
    projectile: { ball: 'basketball', from: [1080, 715], t0: 560, t1: 1000, arc: 320, r: 32 },
  },
  'basketball-steal': {
    scene: 'court', headline: 'STEAL!',
    sub1: 'TAKEAWAY  —  FAST BREAK', sub2: '3RD  ·  #5 CHEN',
    burst: 'energy', motif: 'swirl',
  },

  // ── HOCKEY ────────────────────────────────────────────────────
  'hockey-powerplay': {
    scene: 'ice', headline: 'POWER PLAY', headSize: 150,
    sub1: 'MAN ADVANTAGE', sub2: '2ND  ·  5 ON 4',
    burst: 'energy', motif: 'plus1', motifText: '5v4',
  },
  'hockey-penaltykill': {
    scene: 'ice', headline: 'PENALTY KILL', headSize: 140,
    sub1: 'KILLED IT OFF', sub2: '2ND  ·  SHORTHANDED',
    burst: 'energy', motif: 'shield',
  },
  'hockey-hattrick': {
    scene: 'ice', headline: 'HAT TRICK!', headSize: 160,
    sub1: 'ICEHAWKS  4  —  2  TITANS',
    sub2: '3RD  ·  3 GOALS  ·  #17 NOVAK',
    burst: 'energy', motif: 'hats',
    projectile: { ball: 'puck', from: [-200, 700], t0: 660, t1: 1000, arc: 40, r: 30 },
  },
  'hockey-save': {
    scene: 'ice', headline: 'SAVE!',
    sub1: 'ICEHAWKS  2  —  2  TITANS',
    sub2: '3RD  ·  GLOVE SAVE  ·  #30',
    burst: 'ice', motif: 'glove',
    projectile: { ball: 'puck', from: [-200, 700], t0: 660, t1: 1000, arc: 40, r: 30 },
  },

  // ── BASEBALL ──────────────────────────────────────────────────
  'baseball-grandslam': {
    scene: 'ballpark', headline: 'GRAND SLAM!', headSize: 150,
    sub1: 'RIVER CATS  8  —  4  RAILRIDERS',
    sub2: 'BOT 6TH  ·  4-RUN SLAM  ·  #24 CRUZ',
    burst: 'fireworks',
    impactPt: () => ({ x: 1320, y: 300 }),
    projectile: { ball: 'baseball', from: [560, 980], t0: 520, t1: 1000, arc: 300, r: 30, shrink: true },
  },
  'baseball-strikeout': {
    scene: 'plate', headline: 'STRIKEOUT!', headSize: 150,
    sub1: 'EAGLES  3  —  1  BULLDOGS',
    sub2: 'TOP 7TH  ·  K  ·  #21 PARK',
    burst: 'energy', motif: 'bigK',
    projectile: { ball: 'baseball', from: [280, 300], t0: 640, t1: 980, arc: 0, r: 26, ease: 'lin' },
  },
  'baseball-doubleplay': {
    scene: 'plate', headline: 'DOUBLE PLAY!', headSize: 140,
    sub1: 'TWO OUTS — INNING OVER', sub2: '4-6-3',
    burst: 'energy', motif: 'plus1', motifText: '4-6-3',
  },

  // ── FOOTBALL ──────────────────────────────────────────────────
  'football-firstdown': {
    scene: 'turf', headline: 'FIRST DOWN!', headSize: 150,
    sub1: 'MOVE THE CHAINS', sub2: '1ST & 10  ·  #11 SOTO',
    burst: 'energy', motif: 'arrowFD',
  },
  'football-sack': {
    scene: 'turf', headline: 'SACK!',
    sub1: 'QB DOWN — LOSS OF 8', sub2: '3RD & LONG  ·  #55 OKAFOR',
    burst: 'fire',
    impactPt: () => ({ x: 960, y: 600 }),
  },
  'football-turnover': {
    scene: 'turf', headline: 'TURNOVER!',
    sub1: 'TAKEAWAY — BALL HAWK', sub2: '#21 RECOVERS',
    burst: 'energy', motif: 'swirl',
  },

  // ── VOLLEYBALL ────────────────────────────────────────────────
  'volleyball-ace': {
    scene: 'gym', headline: 'ACE!',
    sub1: 'MARINA  25  —  23  LAGUNA',
    sub2: 'SET 5  ·  ACE  ·  #1 PARK',
    burst: 'dust',
    projectile: { ball: 'volleyball', from: [300, 340], t0: 620, t1: 1000, arc: 0, r: 30 },
  },
  'volleyball-block': {
    scene: 'gym', headline: 'BLOCK!',
    sub1: 'STUFFED AT THE NET', sub2: 'SET 3  ·  #12 RUIZ',
    burst: 'energy',
    impactPt: () => ({ x: 960, y: 560 }),
    projectile: { ball: 'volleyball', from: [760, 330], t0: 640, t1: 1000, arc: 0, r: 30 },
  },
  'volleyball-setwon': {
    scene: 'gym', headline: 'SET WON!', headSize: 150,
    sub1: 'MARINA TAKES SET 4', sub2: '25  —  22',
    burst: 'confetti', motif: 'plus1', motifText: 'SET',
  },

  // ── WRESTLING ─────────────────────────────────────────────────
  'wrestling-pin': {
    scene: 'mat', headline: 'PIN!', headSize: 260,
    sub1: 'MISSION VIEJO  def.  EDISON',
    sub2: '2ND PD  ·  FALL  ·  113 LBS',
    burst: 'energy', motif: 'whistle', shake: 22,
    impactPt: () => ({ x: 960, y: 680 }),
  },
  'wrestling-takedown': {
    scene: 'mat', headline: 'TAKEDOWN!', headSize: 150,
    sub1: 'TWO POINTS', sub2: '1ST PD  ·  #145 LOPEZ',
    burst: 'energy', motif: 'plus1', motifText: '+2',
    impactPt: () => ({ x: 960, y: 680 }),
  },
  'wrestling-nearfall': {
    scene: 'mat', headline: 'NEAR FALL!', headSize: 150,
    sub1: 'BACK POINTS', sub2: '3RD PD  ·  #160',
    burst: 'energy', motif: 'plus1', motifText: '+3',
    impactPt: () => ({ x: 960, y: 680 }),
  },
  'wrestling-techfall': {
    scene: 'mat', headline: 'TECH FALL!', headSize: 150,
    sub1: '15-POINT LEAD — MATCH OVER',
    sub2: '#132 WARREN',
    burst: 'energy', motif: 'plus1', motifText: '15',
    impactPt: () => ({ x: 960, y: 680 }),
  },
};

/**
 * Try to map an operator-fired cue (with optional sport context) to a
 * deck cue config. Returns null if nothing matches — caller falls
 * back to whatever else it wants (the v1 marquees or the simpler v2
 * CSS widgets). Sport-context resolution: if the cue has a sport-
 * neutral key like 'save' or 'powerplay', the sport disambiguates
 * which deck cue plays (water polo save vs hockey save).
 */
export function pickDeckCue(
  key: string,
  sport: string | undefined,
  overrides?: Partial<CelebrationDeckCfg>,
): CelebrationDeckCfg | null {
  const k = key.toLowerCase();
  const s = (sport || '').toLowerCase();

  // Direct id lookup first — registry keys like 'waterpolo-save' win.
  const direct = CELEBRATION_DECK_CUES[k];
  if (direct) return overrides ? { ...direct, ...overrides } : direct;

  // Sport-prefixed resolution: 'save' + sport='water-polo' → waterpolo-save.
  const sportPrefix =
    s === 'water-polo' || s === 'waterpolo' ? 'waterpolo' :
    s === 'football'   ? 'football'  :
    s === 'basketball' ? 'basketball':
    s === 'hockey'     ? 'hockey'    :
    s === 'baseball' || s === 'softball' ? 'baseball' :
    s === 'volleyball' ? 'volleyball':
    s === 'soccer'     ? 'soccer'    :
    s === 'wrestling'  ? 'wrestling' : '';
  if (sportPrefix) {
    const composite = `${sportPrefix}-${k}`;
    const m = CELEBRATION_DECK_CUES[composite];
    if (m) return overrides ? { ...m, ...overrides } : m;
  }

  // Keyword aliases for common sport-celebration keys.
  const aliases: Record<string, string> = {
    save: `${sportPrefix}-save`,
    powerplay: `${sportPrefix}-powerplay`,
    'power-play': `${sportPrefix}-powerplay`,
    exclusion: 'waterpolo-exclusion',
    hattrick: 'hockey-hattrick',
    'hat-trick': 'hockey-hattrick',
    pin: 'wrestling-pin',
    takedown: 'wrestling-takedown',
    nearfall: 'wrestling-nearfall',
    'near-fall': 'wrestling-nearfall',
    techfall: 'wrestling-techfall',
    'tech-fall': 'wrestling-techfall',
    dunk: 'basketball-dunk',
    buzzerbeater: 'basketball-buzzer',
    'buzzer-beater': 'basketball-buzzer',
    buzzer: 'basketball-buzzer',
    steal: 'basketball-steal',
    grandslam: 'baseball-grandslam',
    'grand-slam': 'baseball-grandslam',
    strikeout: 'baseball-strikeout',
    doubleplay: 'baseball-doubleplay',
    'double-play': 'baseball-doubleplay',
    firstdown: 'football-firstdown',
    'first-down': 'football-firstdown',
    sack: 'football-sack',
    turnover: 'football-turnover',
    fumblerecovery: 'football-turnover',
    interception: 'football-turnover',
    ace: 'volleyball-ace',
    block: 'volleyball-block',
    setwon: 'volleyball-setwon',
    yellow: 'soccer-yellow',
    yellowcard: 'soccer-yellow',
    'yellow-card': 'soccer-yellow',
    red: 'soccer-red',
    redcard: 'soccer-red',
    'red-card': 'soccer-red',
    penalty: 'soccer-penalty',
    penaltykill: 'hockey-penaltykill',
    'penalty-kill': 'hockey-penaltykill',
  };
  const aliased = aliases[k];
  if (aliased && CELEBRATION_DECK_CUES[aliased]) {
    return overrides ? { ...CELEBRATION_DECK_CUES[aliased], ...overrides } : CELEBRATION_DECK_CUES[aliased]!;
  }
  return null;
}
