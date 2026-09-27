/**
 * console-share — pure helpers for the scorekeeper console share-link
 * surfaces (Phase-2 Domain SHARE):
 *
 *   - the PUBLIC pad at /console/[token] (a volunteer's phone)
 *   - the operator's ShareConsoleLink card in the game console
 *
 * Pure math/string module — no React, no DOM, no network — so it
 * unit-tests without mounting either page. Chromium-83-safe by
 * construction (no replaceAll / Array.at / structuredClone / etc.),
 * matching board-poll.ts's discipline even though the pad itself is a
 * phone surface, not a Taurus one.
 */
import {
  formatClockReading,
  parseClockEntry,
  projectGameClockMs,
  type ClockType,
} from '@cms/api-types';

/**
 * The gameId embedded in a console share token, or null when the string
 * is not even console-token-shaped. CLIENT-side mirror of the API's
 * parseConsoleTokenGameId (apps/api/src/sports/sports-console-token.ts):
 * token shape is `<gameId>.<ver>.<iatSec>.<ttlSec>.<mac32hex>`, gameId is
 * a UUID-charset id. NO cryptographic meaning — the pad only uses this to
 * know which PUBLIC board endpoint to poll; every mutation is verified
 * server-side against the real MAC + live version.
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

/**
 * Whether a sport's definition declares team-timeout stats — the pad's
 * gate for rendering the Home/Away T.O. buttons (refuter P1, Phase-2
 * SHARE). Only football / basketball / water polo declare
 * homeTimeouts/awayTimeouts in their `stats` list, and the server now
 * rejects `/timeout` for every other sport, so an ungated button would be
 * a guaranteed dead tap.
 */
export function sportHasTeamTimeouts(
  def?: { stats?: { key?: string }[] } | null,
): boolean {
  const stats = def?.stats;
  if (!Array.isArray(stats)) return false;
  return stats.some((s) => s?.key === 'homeTimeouts' || s?.key === 'awayTimeouts');
}

/** The clock anchor a board poll payload carries. `receivedAt` is the
 *  LOCAL Date.now() sampled when the payload landed — serverTime minus it
 *  is the skew term, exactly the projection the board page runs. */
export interface PadClockAnchor {
  clockMs: number;
  clockRunning: boolean;
  /** ISO timestamp of the anchor write (Game.clockUpdatedAt). */
  clockUpdatedAt: string | null;
  serverTime: number;
  receivedAt: number;
}

/**
 * Project the live clock reading at `nowMs` (local Date.now() domain) from
 * a stored anchor — the same `local + skew ≈ server` math as the board
 * page's tick effect: elapsed = now + (serverTime − receivedAt) − anchorAt;
 * countdown clamps at 0, countup adds, 'none'/stopped returns the stored
 * reading unchanged. A missing/unparseable anchor timestamp falls back to
 * the stored reading (never NaN on screen).
 */
export function projectClockMs(
  anchor: PadClockAnchor,
  clockType: 'countdown' | 'countup' | 'none' | string,
  nowMs: number,
): number {
  // K12-F17 — the ONE projection every surface shares (sports-clock.ts),
  // evaluated at this anchor's server time.
  const kind: ClockType = clockType === 'countup' ? 'countup' : clockType === 'none' ? 'none' : 'countdown';
  return projectGameClockMs(anchor, kind, nowMs + (anchor.serverTime - anchor.receivedAt));
}

/**
 * m:ss with CEIL semantics — the broadcast convention every surface shares
 * (a countdown at 0.4s reads 0:01 until true zero, never 0:00 with time
 * left). Negative input clamps to 0. A surface that knows the sport should
 * prefer `formatSportClock(def, ms)`, which adds tenths in the final minute
 * where the sport's boards show them (K12-F17).
 */
export function fmtPadClock(ms: number): string {
  return formatClockReading(ms);
}

/** The pad's "set clock" input — the shared exact-time parser (K12-F17):
 *  m:ss, m:ss.t, :ss.t or ss.t (0.3 is a last-second correction), never an
 *  ambiguous bare number. Milliseconds, or null. */
export function parsePadClock(text: string): number | null {
  return parseClockEntry(text);
}
