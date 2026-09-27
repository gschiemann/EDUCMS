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

import { isConsoleRole, type ConsoleRole } from '@cms/api-types';

/**
 * Split a console token, shape-only. Two shapes (the API's
 * sports-console-token.ts is the authority):
 *   pre-role  `<gameId>.<ver>.<iatSec>.<ttlSec>.<mac32hex>`
 *   role      `<gameId>.<ver>.<iatSec>.<ttlSec>.<role>.<mac32hex>` (K12-F16)
 */
function splitToken(token: unknown): { gameId: string; role: ConsoleRole | null } | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  let role: ConsoleRole | null = null;
  if (parts.length === 6) {
    const r = parts[4];
    if (!isConsoleRole(r)) return null;
    role = r;
  } else if (parts.length !== 5) {
    return null;
  }
  const gameId = parts[0];
  if (!gameId || !/^[A-Za-z0-9-]+$/.test(gameId)) return null;
  if (!/^\d+$/.test(parts[1]) || !/^\d+$/.test(parts[2]) || !/^\d+$/.test(parts[3])) return null;
  if (parts[parts.length - 1].length !== 32) return null;
  return { gameId, role };
}

/**
 * The gameId embedded in a console share token, or null when the string
 * is not even console-token-shaped. CLIENT-side mirror of the API's
 * parseConsoleTokenGameId (apps/api/src/sports/sports-console-token.ts).
 * NO cryptographic meaning — the pad only uses this to know which PUBLIC
 * board endpoint to poll; every mutation is verified server-side against
 * the real MAC + live version.
 */
export function consoleTokenGameId(token: unknown): string | null {
  const parsed = splitToken(token);
  return parsed ? parsed.gameId : null;
}

/**
 * The role word a link carries (null for a pre-role link). DISPLAY ONLY —
 * what the pad may actually do comes from the server's session response,
 * and every route re-checks it.
 */
export function consoleTokenRole(token: unknown): ConsoleRole | null {
  const parsed = splitToken(token);
  return parsed ? parsed.role : null;
}

/** A shot / play clock as the board payload stores it (`stats.shotClock`,
 *  `stats.playClock`): a reading `ms` taken at `at`, counting down while
 *  `running`. `len` is the shot clock's configured length (0 = off). */
export interface PadSubClock {
  ms: number;
  running: boolean;
  at: string | null;
  len: number;
}

/** Read a stored sub-clock, or null when the game has none. */
export function readSubClock(v: unknown): PadSubClock | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const ms = typeof o.ms === 'number' && isFinite(o.ms) ? Math.max(0, o.ms) : 0;
  const len = typeof o.len === 'number' && isFinite(o.len) ? Math.max(0, o.len) : 0;
  return {
    ms,
    running: o.running === true,
    at: typeof o.at === 'string' ? o.at : null,
    len,
  };
}

/**
 * Live reading of a sub-clock at `nowMs` (local clock), corrected by the same
 * server skew the game clock uses (`serverTime − receivedAt`). Counts DOWN and
 * clamps at 0; a stopped clock or an unparseable anchor reads its stored ms.
 */
export function projectSubClockMs(clock: PadSubClock, skewMs: number, nowMs: number): number {
  if (!clock.running) return clock.ms;
  const at = clock.at ? new Date(clock.at).getTime() : NaN;
  if (!isFinite(at)) return clock.ms;
  return Math.max(0, clock.ms - (nowMs + skewMs - at));
}

/** Whole seconds for a shot / play clock readout (ceil — 0.4 s reads 1). */
export function fmtSubClockSec(ms: number): string {
  return String(Math.max(0, Math.ceil(ms / 1000)));
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
