/**
 * console-share — pure helpers for the scorekeeper console share-link
 * surfaces (Phase-2 Domain SHARE):
 *
 *   - the PUBLIC pad at /console/[token] (a volunteer's phone)
 *   - the operator's ShareConsoleLink card in the game console
 *
 * Clocks are NOT here any more (K12-F17 / F40, 2026-09-27): the pad and the
 * phone Run view project every clock — game, shot, play, penalty — from the
 * page's one server clock (lib/server-clock) through the shared contract in
 * @cms/api-types (projectGameClockMs / projectCountdownMs /
 * formatSportClock / parseClockEntry), exactly like the board.
 *
 * Pure string module — no React, no DOM, no network — so it unit-tests
 * without mounting either page. Chromium-83-safe by construction (no
 * replaceAll / Array.at / structuredClone / etc.), matching board-poll.ts's
 * discipline even though the pad itself is a phone surface, not a Taurus one.
 */

/**
 * The gameId embedded in a console share token, or null when the string
 * is not even console-token-shaped. CLIENT-side mirror of the API's
 * parseConsoleTokenGameId (apps/api/src/sports/sports-console-token.ts):
 * token shape is `<gameId>.<ver>.<iatSec>.<ttlSec>.<mac32hex>`, gameId is
 * a UUID-charset id. The link's SCOPE is inside the MAC, never in the text
 * (K12-F34) — what a link may do comes only from the server's /session
 * answer. NO cryptographic meaning — the pad only uses this to know which
 * PUBLIC board endpoint to poll; every mutation is verified server-side
 * against the real MAC + live version.
 */
export function consoleTokenGameId(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 5) return null;
  const gameId = parts[0];
  if (!gameId || !/^[A-Za-z0-9-]+$/.test(gameId)) return null;
  if (!/^\d+$/.test(parts[1]) || !/^\d+$/.test(parts[2]) || !/^\d+$/.test(parts[3])) return null;
  if (parts[4].length !== 32) return null;
  return gameId;
}

/** The /console/<token> URL for a given web origin. */
export function consoleShareUrl(origin: string, token: string): string {
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  return `${base}/console/${token}`;
}

/**
 * The quick-add score buttons for a sport — `def.score.increments`
 * (basketball [1,2,3], football [1,2,3,6], soccer [1]…). Mirrors how the
 * operator console derives its quick buttons: a sport that PUBLISHES an
 * empty set (judged / leaderboard sports — gymnastics, swim, track) gets
 * `[]` back and the caller hides the score pad entirely (the console does
 * exactly this — `if (!increments.length) return null`). Only a missing/
 * unresolvable sport definition falls back to a lone +1 so the pad never
 * renders a dead column for an unknown sport key.
 */
export function padIncrements(def?: { score?: { increments?: number[] } } | null): number[] {
  const inc = def?.score?.increments;
  if (Array.isArray(inc)) {
    return inc.filter((n) => typeof n === 'number' && isFinite(n) && n > 0);
  }
  return [1];
}
