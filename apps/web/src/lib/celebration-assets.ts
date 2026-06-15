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
  // 2026-06-13 — field hockey + lacrosse are stick-and-cage field sports;
  // the hockey goal-in-net marquee hero reads correctly for both. Until
  // 2026-06-13 their marquee GOAL fired only the generic burst.
  'field_hockey/goal': 'hockey-goal',
  'lacrosse/goal': 'hockey-goal',
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
  // pickleball — a paddle/net sport with tennis-shaped scoring. Until
  // 2026-06-13 it had ZERO cinematics and every cue fell to generic
  // confetti. The serve-ace + put-away winner read cleanly on the
  // volleyball deck scenes; the signature dink rally gets its OWN
  // bespoke scene (pickleball-dink), and a game win reuses the set-won
  // confetti scene.
  'pickleball/ace': 'volleyball-ace',
  'pickleball/winner': 'volleyball-block',
  'pickleball/dink': 'pickleball-dink',
  'pickleball/gameWin': 'volleyball-setwon',
  // wrestling
  'wrestling/pin': 'wrestling-pin',
  'wrestling/takedown': 'wrestling-takedown',
  'wrestling/nearFall': 'wrestling-nearfall',
  'wrestling/techFall': 'wrestling-techfall',
  // field hockey — GOAL is a MARQUEE hero (see above); SAVE is a deck
  // scene (goalie-glove stop on the grass-pitch goal). 2026-06-13.
  'field_hockey/save': 'fieldhockey-save',
  // lacrosse — GOAL is a MARQUEE hero (see above); SAVE is a deck scene.
  'lacrosse/save': 'lacrosse-save',
  // gymnastics — judged floor sport; no goal-in-net. The spotlit-floor
  // deck scenes (mat circle in perspective) cover the marquee moments.
  // 2026-06-13: were falling through to generic emoji/confetti.
  'gymnastics/perfectScore': 'gymnastics-perfectscore',
  'gymnastics/stickLanding': 'gymnastics-sticklanding',
  'gymnastics/allAround': 'gymnastics-allaround',
  // competitive cheer — judged routine sport on a spring floor; reuses
  // the spotlit-floor deck scenes. 2026-06-13.
  'competitive_cheer/fullOut': 'cheer-fullout',
  'competitive_cheer/perfectStunt': 'cheer-perfectstunt',
  'competitive_cheer/roundWin': 'cheer-roundwin',
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
  // An exclusion is a 20-second EJECTION (man-up), NOT a penalty shot — they
  // are different events with different cinematics. (Was wrongly aliased to
  // waterpolo-penalty, which played a 5-meter penalty-shot scene.)
  'water_polo/exclusion': 'waterpolo-exclusion',
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
  // The horn is a UNIVERSAL cue (period start / end-of-game) fired across every
  // sport — route it to the shared deck horn cue (klaxon visual + synthesized
  // air-horn). 2026-06-15: previously unmapped → fell through to the generic
  // emoji+label, so it just said "HORN" with no sound.
  if (cueKey === 'horn') return `/celebrations/deck.html?cue=horn`;
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

/**
 * 2026-06-04 — live game data injected into a v2 cinematic at fire time.
 * The v2 launcher (`/celebrations/v2/launcher.html`) decodes this from the
 * `d` URL param and patches each cue's config BEFORE it paints, so the
 * scene shows the REAL teams / score / segment-clock and the operator-
 * attributed scorer — instead of the design-time placeholder names baked
 * into the cue files (RIVERA / OKONKWO / Newport Harbor 9 — 8). Only the
 * v2 launcher reads this; v1 marquee/deck files ignore it.
 */
export interface CelebrationLiveData {
  /** Home / away full team names (scorebug + score line). */
  home?: string;
  away?: string;
  /** Home / away short abbreviations (≤ ~4 chars). */
  ha?: string;
  aa?: string;
  /** Home / away scores. */
  hs?: number;
  as?: number;
  /** Home / away accent hex (no leading #). */
  hc?: string;
  ac?: string;
  /**
   * The featured player (scorer / goalie / etc). `null` / omitted name →
   * the cinematic renders NO player line (the engine guards on presence),
   * so firing without picking a player never shows a placeholder name.
   */
  player?: { number?: string; name?: string } | null;
  /** Context line, e.g. "4TH · 2:14". Empty string clears it. */
  context?: string;
}

/** UTF-8-safe base64url encode (player names + "·" carry multi-byte chars).
 *  Encodes the exact UTF-8 bytes of the JSON so the launcher's
 *  `decodeURIComponent(escape(atob()))` decode round-trips. */
function encodeLive(data: CelebrationLiveData): string {
  const json = JSON.stringify(data);
  let b64: string;
  if (typeof btoa !== 'undefined' && typeof TextEncoder !== 'undefined') {
    // UTF-8 → bytes → binary string → base64. Avoids the deprecated
    // escape()/unescape() pair while producing identical bytes.
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
    b64 = btoa(bin);
  } else {
    // SSR / Node fallback.
    b64 = Buffer.from(json, 'utf8').toString('base64');
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Loose shape of a fired cue carrying a frozen snapshot + optional scorer. */
interface CueWithSnapshot {
  snapshot?: {
    homeTeam?: string;
    awayTeam?: string;
    homeScore?: number;
    awayScore?: number;
    homeColor?: string | null;
    awayColor?: string | null;
    segmentLabel?: string;
    clockText?: string;
  } | null;
  scorerName?: string | null;
  scorerNumber?: string | null;
}

/**
 * Build the live-data payload for a v2 cinematic from a fired cue's frozen
 * snapshot + operator-attributed scorer. Returns undefined when there's no
 * snapshot AND no scorer (so legacy/preview calls keep the cue's demo data).
 */
export function celebrationLiveDataFromCue(
  cue: CueWithSnapshot | null | undefined,
): CelebrationLiveData | undefined {
  if (!cue) return undefined;
  const s = cue.snapshot || {};
  const hasSnap =
    !!(s.homeTeam || s.awayTeam) || typeof s.homeScore === 'number' || typeof s.awayScore === 'number';
  const scorer = (cue.scorerName || '').trim();
  if (!hasSnap && !scorer) return undefined;

  // Short abbreviation from a team name when no explicit abbr exists:
  // first word's first 3 letters (Newport Harbor → NEW, "Sea Kings" → SEA).
  const abbr = (n?: string) =>
    n ? n.trim().split(/\s+/)[0]!.slice(0, 4).toUpperCase() : undefined;

  return {
    home: s.homeTeam || undefined,
    away: s.awayTeam || undefined,
    ha: abbr(s.homeTeam),
    aa: abbr(s.awayTeam),
    hs: typeof s.homeScore === 'number' ? s.homeScore : undefined,
    as: typeof s.awayScore === 'number' ? s.awayScore : undefined,
    hc: (s.homeColor || '').replace('#', '').trim() || undefined,
    ac: (s.awayColor || '').replace('#', '').trim() || undefined,
    // Always present (possibly null) so the launcher clears any placeholder
    // name when the operator fired without picking a player.
    player: scorer ? { number: (cue.scorerNumber || '').trim(), name: scorer } : null,
    context: [s.segmentLabel, s.clockText].map((x) => (x || '').trim()).filter(Boolean).join(' · '),
  };
}

/** Full iframe src for a celebration, branded to a team hex color (optional).
 *  `format` (scoreboard | ribbon) selects the render layout — v2 has always
 *  honored it, and as of 2026-06-15 the v1 deck reads it too (ribbon = a
 *  short/wide band instead of the 16:9 scene, so it no longer squishes).
 *  `data` injects the live game state + scorer into the cinematic — BOTH
 *  packs read it now, so a fired cue shows the real teams, not placeholders. */
export function celebrationSrc(
  sport: string | null | undefined,
  cueKey: string | null | undefined,
  teamHex?: string | null,
  pack: CelebrationPack = 'v1',
  format?: 'scoreboard' | 'ribbon',
  data?: CelebrationLiveData,
): string | null {
  const base = celebrationAsset(sport, cueKey, pack);
  if (!base) return null;
  const hex = (teamHex || '').replace('#', '').trim();
  const params: string[] = [];
  if (hex) params.push('team=' + encodeURIComponent(hex));
  if (format) params.push('format=' + encodeURIComponent(format));
  // Live data injects the REAL teams / score / scorer into the cinematic.
  // 2026-06-15 — both the v2 launcher AND the v1 deck/marquee art now read
  // `d`, so a fired cue NEVER shows the design-time placeholder names
  // ("Newport Harbor 9–8", "#9 Rivera"). Previously this was gated to the
  // v2 launcher only, which is why every v1 celebration looked like test
  // HTML. The base64url payload is a few hundred bytes — negligible.
  if (data) {
    params.push('d=' + encodeLive(data));
  }
  if (params.length === 0) return base;
  return base + (base.includes('?') ? '&' : '?') + params.join('&');
}
