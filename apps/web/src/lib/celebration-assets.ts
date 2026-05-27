// Maps a (sport, celebration-key) pair to a cinematic celebration animation
// served statically from apps/web/public/celebrations/.
//
//  - Marquee scoring plays have bespoke, hand-tuned files (soccer-goal.html …).
//  - Every other cue renders through the shared deck engine
//    (deck.html?cue=KEY), which self-cache-busts its engine on load.
//
// Returns null when no celebration is mapped, so the caller falls back to the
// generic text/confetti cue. All celebration files are team-aware (?team=HEX).
//
//   sport  = SportDefinition.key   (e.g. 'football', 'water_polo', 'hockey')
//   cueKey = SportCelebration.key  (e.g. 'touchdown', 'goal', 'save')

const MARQUEE: Record<string, string> = {
  'football/touchdown': 'football-touchdown',
  'football/fieldGoal': 'football-fieldgoal',
  'basketball/threePointer': 'basketball-three',
  'soccer/goal': 'soccer-goal',
  'water_polo/goal': 'waterpolo-goal',
  'hockey/goal': 'hockey-goal',
  'baseball/homeRun': 'baseball-homerun',
  'softball/homeRun': 'baseball-homerun',
  'volleyball/kill': 'volleyball-kill',
};

const DECK: Record<string, string> = {
  // soccer
  'soccer/penalty': 'soccer-penalty',
  'soccer/yellowCard': 'soccer-yellow',
  'soccer/redCard': 'soccer-red',
  // water polo
  'water_polo/save': 'waterpolo-save',
  'water_polo/exclusion': 'waterpolo-exclusion',
  'water_polo/powerPlay': 'waterpolo-powerplay',
  // basketball
  'basketball/dunk': 'basketball-dunk',
  'basketball/buzzerBeater': 'basketball-buzzer',
  'basketball/steal': 'basketball-steal',
  // hockey
  'hockey/powerPlay': 'hockey-powerplay',
  'hockey/penaltyKill': 'hockey-penaltykill',
  'hockey/hatTrick': 'hockey-hattrick',
  'hockey/save': 'hockey-save',
  // baseball / softball (share the same visuals)
  'baseball/grandSlam': 'baseball-grandslam',
  'baseball/strikeout': 'baseball-strikeout',
  'baseball/doublePlay': 'baseball-doubleplay',
  'softball/grandSlam': 'baseball-grandslam',
  'softball/strikeout': 'baseball-strikeout',
  'softball/doublePlay': 'baseball-doubleplay',
  // football
  'football/firstDown': 'football-firstdown',
  'football/sack': 'football-sack',
  'football/turnover': 'football-turnover',
  // volleyball
  'volleyball/ace': 'volleyball-ace',
  'volleyball/block': 'volleyball-block',
  'volleyball/setWin': 'volleyball-setwon',
  // wrestling
  'wrestling/pin': 'wrestling-pin',
  'wrestling/takedown': 'wrestling-takedown',
  'wrestling/nearFall': 'wrestling-nearfall',
  'wrestling/techFall': 'wrestling-techfall',
};

// 2026-05-27 — v2 cue pack. Same canvas engine, two render targets
// (scoreboard 16:9 + ribbon 7.5:1) shipped together. Operator opts
// in per-game via `Game.stats.celebrationPack = 'v2'` set from Setup
// mode. Falls back to v1 art on any sport that isn't ported yet.
// Adding new sports is purely additive — drop the (sport, cueKey)
// pair in the table below.
const V2_KEYS: Record<string, string> = {
  // water polo (the live pilot install — first vertical to ship)
  'water_polo/goal':      'waterpolo-goal',
  'water_polo/save':      'waterpolo-save',
  'water_polo/exclusion': 'waterpolo-penalty', // v2 names the 20-sec excl. "penalty"
  'water_polo/penalty':   'waterpolo-penalty',
  'water_polo/powerPlay': 'waterpolo-powerplay',
  'water_polo/hatTrick':  'waterpolo-hattrick',
};

export type CelebrationPack = 'v1' | 'v2';

/** The celebration asset URL for a (sport, cueKey), or null if none is mapped. */
export function celebrationAsset(
  sport?: string | null,
  cueKey?: string | null,
  pack: CelebrationPack = 'v1',
): string | null {
  if (!sport || !cueKey) return null;
  const k = `${sport}/${cueKey}`;
  if (pack === 'v2' && V2_KEYS[k]) {
    return `/celebrations/v2/launcher.html?cue=${encodeURIComponent(V2_KEYS[k])}`;
  }
  if (MARQUEE[k]) return `/celebrations/${MARQUEE[k]}.html`;
  if (DECK[k]) return `/celebrations/deck.html?cue=${DECK[k]}`;
  // v2 graceful fallback — when a sport isn't ported (no soccer / hockey
  // v2 art yet), fall through to v1 so the operator still gets a
  // celebration instead of a black screen.
  if (pack === 'v2') return celebrationAsset(sport, cueKey, 'v1');
  return null;
}

/** Full iframe src for a celebration, branded to a team hex color (optional).
 *  `format` only affects v2 — that pack has separate scoreboard / ribbon
 *  render paths in a single launcher. v1 ignores it. */
export function celebrationSrc(
  sport: string | null | undefined,
  cueKey: string | null | undefined,
  teamHex?: string | null,
  pack: CelebrationPack = 'v1',
  format?: 'scoreboard' | 'ribbon',
): string | null {
  const base = celebrationAsset(sport, cueKey, pack);
  if (!base) return null;
  const hex = (teamHex || '').replace('#', '').trim();
  const params: string[] = [];
  if (hex) params.push('team=' + encodeURIComponent(hex));
  if (format) params.push('format=' + encodeURIComponent(format));
  if (params.length === 0) return base;
  return base + (base.includes('?') ? '&' : '?') + params.join('&');
}
