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

/** The celebration asset URL for a (sport, cueKey), or null if none is mapped. */
export function celebrationAsset(
  sport?: string | null,
  cueKey?: string | null,
): string | null {
  if (!sport || !cueKey) return null;
  const k = `${sport}/${cueKey}`;
  if (MARQUEE[k]) return `/celebrations/${MARQUEE[k]}.html`;
  if (DECK[k]) return `/celebrations/deck.html?cue=${DECK[k]}`;
  return null;
}

/** Full iframe src for a celebration, branded to a team hex color (optional). */
export function celebrationSrc(
  sport: string | null | undefined,
  cueKey: string | null | undefined,
  teamHex?: string | null,
): string | null {
  const base = celebrationAsset(sport, cueKey);
  if (!base) return null;
  const hex = (teamHex || '').replace('#', '').trim();
  if (!hex) return base;
  return base + (base.includes('?') ? '&' : '?') + 'team=' + encodeURIComponent(hex);
}
