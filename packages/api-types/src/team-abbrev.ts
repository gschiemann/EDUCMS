/**
 * Team abbreviations — ONE rule for the API, the console and every scoreboard
 * surface (Muse beta S-04 / DEV-028, 2026-10-07).
 *
 * The ribbon and scorebug took the first three letters of each team name, so
 * "Muse Sports Test Home" vs "Muse Sports Test Away" read MUS vs MUS, and
 * "Lincoln" vs "Lincoln East" read LIN vs LIN. Now:
 *   1. An operator-set abbreviation (Game.homeAbbrev / awayAbbrev) wins.
 *   2. Otherwise it is DERIVED: one meaningful word → its first 3 letters;
 *      several → their initials (up to 4), ignoring filler like "High School".
 *   3. If the two derived abbreviations still collide, the away side is told
 *      apart by its last distinguishing word, and the console warns.
 */

export const TEAM_ABBREV_MAX = 5;
const VALID = /^[A-Z0-9]{1,5}$/;

/** Words that carry no identity on a scoreboard. */
const FILLER = new Set([
  'THE', 'OF', 'AND', 'AT',
  'HIGH', 'SCHOOL', 'HS', 'MIDDLE', 'MS', 'ACADEMY', 'COLLEGE', 'UNIVERSITY', 'PREP',
  'VARSITY', 'JV', 'BOYS', 'GIRLS',
]);

function words(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/['\u2019]/g, '') // "Mary's" is one word, not MARY + S
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Normalize an operator-typed abbreviation; null = empty / clear. Throws nothing — invalid → null. */
export function normalizeTeamAbbrev(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return v && VALID.test(v) ? v : null;
}

/** True when a submitted value is acceptable (empty clears; otherwise 1–5 of A–Z / 0–9). */
export function isValidTeamAbbrevInput(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw !== 'string') return false;
  const v = raw.trim();
  if (!v) return true;
  return VALID.test(v.toUpperCase());
}

/** Smart default from a team name. */
export function deriveTeamAbbrev(name: string | null | undefined): string {
  const all = words(name ?? '');
  if (all.length === 0) return '';
  const meaningful = all.filter((w) => !FILLER.has(w));
  const ws = meaningful.length ? meaningful : all;
  if (ws.length === 1) return ws[0].slice(0, 3);
  return ws.slice(0, 4).map((w) => w[0]).join('');
}

export interface ResolvedTeamAbbrevs {
  home: string;
  away: string;
  /** True when the two shown abbreviations are identical (the console warns). */
  collision: boolean;
}

/**
 * What every surface shows. Stored values win; derived values that collide
 * are told apart where the names differ.
 */
export function resolveTeamAbbrevs(game: {
  homeTeam?: string | null;
  awayTeam?: string | null;
  homeAbbrev?: string | null;
  awayAbbrev?: string | null;
}): ResolvedTeamAbbrevs {
  const storedHome = normalizeTeamAbbrev(game.homeAbbrev);
  const storedAway = normalizeTeamAbbrev(game.awayAbbrev);
  let home = storedHome ?? deriveTeamAbbrev(game.homeTeam);
  let away = storedAway ?? deriveTeamAbbrev(game.awayTeam);
  // Only two DERIVED values are de-collided automatically. When the operator
  // set one side, their choice is never rewritten — the console warns instead.
  if (home && home === away && !storedHome && !storedAway) {
    const hw = words(game.homeTeam ?? '').filter((w) => !FILLER.has(w));
    const aw = words(game.awayTeam ?? '').filter((w) => !FILLER.has(w));
    // The first word that differs between the two names identifies the away side.
    const diffAway = aw.find((w, i) => w !== hw[i]);
    if (diffAway) away = `${away.slice(0, 2)}${diffAway[0]}`.slice(0, TEAM_ABBREV_MAX);
  }
  return { home, away, collision: !!home && home === away };
}
