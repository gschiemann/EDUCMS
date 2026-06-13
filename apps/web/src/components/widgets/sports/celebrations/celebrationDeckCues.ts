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
  // 2026-05-27 — Operator feedback: "the save lets the ball go into the
  // net, makes no sense, and the power play saying 6-5 isnt always
  // correct…couldnt it be 6-4 or 5-4 or any combo?"
  //
  // SAVE: previously the projectile flew from off-screen-left into the
  // GOAL center (P.goal = pool scene's goal frame). The ball ended up
  // IN the net — visually identical to a goal. Fixed by overriding
  // impactPt to the goalie's GLOVE position (W/2, y≈540). Ball now
  // flies in, the glove pops up in the goal mouth, ball stops at the
  // glove → reads as "goalie blocked it". Water-splash burst at the
  // glove sells the catch.
  //
  // EXCLUSION + POWER PLAY: water polo strength advantage is dynamic.
  // Most common is 6-on-5 (one exclusion), but it can be 6-on-4
  // (two simultaneous opposing exclusions) or 5-on-4 (one exclusion
  // each side simultaneously) — even 4-on-3 in extreme cases. The
  // hardcoded "6 ON 5" / "6v5" was wrong for any other combo. Made
  // generic: "TIMED EXCLUSION · 20s POWER PLAY" / "MAN ADVANTAGE".
  // sub1 still gets replaced by the live scoreline at fire time (see
  // ribbon page liveSub1), so the operator sees the real teams + score.
  // Future: expose a strength picker on the operator's celebration
  // button so they can stamp "6v4" etc. on the cue at fire time.
  'waterpolo-save': {
    scene: 'pool', headline: 'SAVE!',
    sub1: 'NEWPORT HARBOR  9  —  8  CORONA DEL MAR',
    sub2: 'GOALIE  ·  BIG SAVE',
    burst: 'water', motif: 'glove',
    // The glove motif draws at canvas (W/2, 540). Point the impact
    // there so the ball flies INTO the goalie's hand, not the net.
    impactPt: () => ({ x: 960, y: 540 }),
    projectile: { ball: 'waterpolo', from: [-160, 640], t0: 640, t1: 1000, arc: 80, r: 30 },
  },
  'waterpolo-exclusion': {
    scene: 'pool', headline: 'EXCLUSION', headSize: 160,
    sub1: 'TIMED EXCLUSION',
    sub2: '20-SECOND PENALTY  ·  POWER PLAY',
    burst: 'energy', motif: 'whistle',
  },
  'waterpolo-powerplay': {
    scene: 'pool', headline: 'POWER PLAY', headSize: 150,
    sub1: 'MAN ADVANTAGE',
    sub2: 'PLAY THE EXTRA',
    // motifText 'PP' (power play abbrev) — non-numeric so it's
    // accurate regardless of actual strength combo (6v5, 6v4, 5v4).
    burst: 'energy', motif: 'plus1', motifText: 'PP',
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
  // 2026-06-13 — deck-cue parity for the signature attack. The MARQUEE
  // path already has a bespoke volleyball-kill.html hero; this entry
  // gives the deck/alias path (feed / pickDeckCue) a matching scene so a
  // 'kill' resolved through the integration path no longer falls to
  // generic confetti. A hard downward spike: the ball drives steeply
  // from above the attacker into the floor at the net.
  'volleyball-kill': {
    scene: 'gym', headline: 'KILL!', headSize: 240,
    sub1: 'TERMINATED AT THE NET',
    sub2: 'SET 4  ·  KILL  ·  #7 NGUYEN',
    burst: 'fire',
    impactPt: (P) => P.net || { x: 960, y: 760 },
    projectile: { ball: 'volleyball', from: [820, 200], t0: 600, t1: 1000, arc: 0, r: 32, ease: 'lin' },
  },

  // ── FIELD HOCKEY ──────────────────────────────────────────────
  // 2026-06-13 — field hockey had ZERO cinematics; even the marquee
  // GOAL played only the generic burst. A grass-pitch goal scene reads
  // correctly (stick-and-cage sport on turf). GOAL drives the ball into
  // the cage; SAVE stops the shot at the keeper (the giant denial X).
  'fieldhockey-goal': {
    scene: 'grass', headline: 'GOAL!', headSize: 240,
    sub1: 'WARRIORS  2  —  1  HAWKS',
    sub2: 'Q3  ·  FIELD GOAL  ·  #11 PATEL',
    burst: 'fire',
    projectile: { ball: 'soccer', from: [380, 760], t0: 600, t1: 1000, arc: 90, r: 26, shrink: true },
  },
  // SAVE reuses the proven waterpolo-save pattern: a glove motif pops up
  // in front of the goal and the ball flies INTO it (impactPt = glove),
  // so it reads as "stopped" not "scored". The engine has no denial-X
  // (that's an HTML-only concept); the glove + energy burst sells it.
  'fieldhockey-save': {
    scene: 'grass', headline: 'SAVE!',
    sub1: 'KEEPER STANDS TALL',
    sub2: 'Q2  ·  BIG SAVE  ·  #1 GK',
    burst: 'energy', motif: 'glove',
    impactPt: () => ({ x: 960, y: 540 }),
    projectile: { ball: 'soccer', from: [-160, 700], t0: 600, t1: 1000, arc: 90, r: 26 },
  },

  // ── LACROSSE ──────────────────────────────────────────────────
  // 2026-06-13 — the CTS widget path had a CEL_LX_GOAL scene, but the
  // operator-console→board (celebrationSrc) path had nothing, so a
  // lacrosse marquee GOAL fell to the generic burst. A grass/turf goal
  // scene reads correctly for the stick-and-net field sport.
  'lacrosse-goal': {
    scene: 'grass', headline: 'GOAL!', headSize: 240,
    sub1: 'EAGLES  6  —  4  RAMS',
    sub2: 'Q3  ·  GOAL  ·  #7 BRENNAN',
    burst: 'fire',
    projectile: { ball: 'soccer', from: [400, 740], t0: 600, t1: 1000, arc: 110, r: 26, shrink: true },
  },
  'lacrosse-save': {
    scene: 'grass', headline: 'SAVE!',
    sub1: 'DENIED AT THE CREASE',
    sub2: 'Q2  ·  BIG SAVE  ·  #30 GK',
    burst: 'energy', motif: 'glove',
    impactPt: () => ({ x: 960, y: 540 }),
    projectile: { ball: 'soccer', from: [-160, 720], t0: 600, t1: 1000, arc: 90, r: 26 },
  },

  // ── GYMNASTICS ────────────────────────────────────────────────
  // 2026-06-13 — judged meet sport. No goal-in-net concept; the floor
  // scene (the `mat` circle in perspective) reads as a spotlit floor
  // routine. Perfect score / stuck landing / all-around lead are the
  // marquee moments. Scores are the operator-entered judged totals
  // (sub1 gets replaced by the live scoreline at fire time where the
  // caller supplies it).
  'gymnastics-perfectscore': {
    scene: 'mat', headline: 'PERFECT 10!', headSize: 200,
    sub1: 'FLAWLESS ROUTINE',
    sub2: 'FLOOR  ·  10.000  ·  #4 REYES',
    burst: 'fireworks', motif: 'plus1', motifText: '10',
    impactPt: () => ({ x: 960, y: 680 }),
  },
  'gymnastics-sticklanding': {
    scene: 'mat', headline: 'STUCK IT!', headSize: 180,
    sub1: 'STUCK THE LANDING',
    sub2: 'VAULT  ·  NO STEP  ·  #9 KIM',
    burst: 'energy', motif: 'plus1', motifText: '★',
    impactPt: () => ({ x: 960, y: 700 }),
  },
  'gymnastics-allaround': {
    scene: 'mat', headline: 'ALL-AROUND!', headSize: 160,
    sub1: 'ALL-AROUND LEAD',
    sub2: 'MEET  ·  TOP SCORE  ·  #11 NOVAK',
    burst: 'confetti', motif: 'plus1', motifText: 'AA',
    impactPt: () => ({ x: 960, y: 680 }),
  },

  // ── COMPETITIVE CHEER ─────────────────────────────────────────
  // 2026-06-13 — judged routine sport on a spring floor. Reuses the
  // `mat` spotlight-floor scene. Full-out / perfect stunt / round win
  // are the marquee moments. Confetti + energy bursts sell the crowd.
  'cheer-fullout': {
    scene: 'mat', headline: 'FULL OUT!', headSize: 200,
    sub1: 'HIT ZERO — FLAWLESS RUN',
    sub2: 'FINALS  ·  CLEAN ROUTINE',
    burst: 'fireworks', motif: 'plus1', motifText: '★',
    impactPt: () => ({ x: 960, y: 680 }),
  },
  'cheer-perfectstunt': {
    scene: 'mat', headline: 'PERFECT STUNT!', headSize: 150,
    sub1: 'HIT AND HELD',
    sub2: 'ROUND 2  ·  FLAWLESS',
    burst: 'energy', motif: 'plus1', motifText: '★',
    impactPt: () => ({ x: 960, y: 700 }),
  },
  'cheer-roundwin': {
    scene: 'mat', headline: 'ROUND WIN!', headSize: 160,
    sub1: 'TAKES THE ROUND',
    sub2: 'ROUND  ·  TOP SCORE',
    burst: 'confetti', motif: 'plus1', motifText: 'WIN',
    impactPt: () => ({ x: 960, y: 680 }),
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
  // 2026-05-27 — normalize the sport so 'water_polo' / 'water-polo' /
  // 'waterpolo' / 'Water Polo' all resolve identically. Canonical
  // sport keys per packages/api-types/src/sports.ts use UNDERSCORES
  // ('water_polo', 'field_hockey', etc.); the original code only
  // checked hyphens + collapsed forms, so every compound-name sport
  // silently fell through to a generic fallback. Bug found by
  // querying a live game DB row.
  const s = (sport || '').toLowerCase().replace(/[-_\s]/g, '');

  // Direct id lookup first — registry keys like 'waterpolo-save' win.
  const direct = CELEBRATION_DECK_CUES[k];
  if (direct) return overrides ? { ...direct, ...overrides } : direct;

  // Sport-prefixed resolution: 'save' + sport='water_polo' → waterpolo-save.
  const sportPrefix =
    s === 'waterpolo'  ? 'waterpolo'  :
    s === 'football'   ? 'football'   :
    s === 'basketball' ? 'basketball' :
    s === 'hockey'     ? 'hockey'     :
    s === 'baseball' || s === 'softball' ? 'baseball' :
    s === 'volleyball' ? 'volleyball' :
    s === 'soccer'     ? 'soccer'     :
    s === 'wrestling'  ? 'wrestling'  :
    // 2026-06-13 — compound-name field/judged sports now resolve too.
    s === 'fieldhockey' ? 'fieldhockey' :
    s === 'lacrosse'    ? 'lacrosse'    :
    s === 'gymnastics'  ? 'gymnastics'  :
    s === 'competitivecheer' || s === 'cheer' ? 'cheer' : '';
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
    kill: 'volleyball-kill',
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
    // Gymnastics (judged floor sport) — 2026-06-13.
    perfectscore: 'gymnastics-perfectscore',
    'perfect-score': 'gymnastics-perfectscore',
    sticklanding: 'gymnastics-sticklanding',
    'stick-landing': 'gymnastics-sticklanding',
    allaround: 'gymnastics-allaround',
    'all-around': 'gymnastics-allaround',
    // Competitive cheer (judged routine sport) — 2026-06-13.
    fullout: 'cheer-fullout',
    'full-out': 'cheer-fullout',
    perfectstunt: 'cheer-perfectstunt',
    'perfect-stunt': 'cheer-perfectstunt',
    roundwin: 'cheer-roundwin',
    'round-win': 'cheer-roundwin',
  };
  const aliased = aliases[k];
  if (aliased && CELEBRATION_DECK_CUES[aliased]) {
    return overrides ? { ...CELEBRATION_DECK_CUES[aliased], ...overrides } : CELEBRATION_DECK_CUES[aliased]!;
  }
  return null;
}
