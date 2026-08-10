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
  if (!anchor.clockRunning || clockType === 'none') return anchor.clockMs;
  const anchorAt = anchor.clockUpdatedAt ? new Date(anchor.clockUpdatedAt).getTime() : NaN;
  if (!isFinite(anchorAt)) return anchor.clockMs;
  const skew = anchor.serverTime - anchor.receivedAt;
  const elapsed = nowMs + skew - anchorAt;
  if (clockType === 'countup') return anchor.clockMs + elapsed;
  return Math.max(0, anchor.clockMs - elapsed);
}

/**
 * m:ss with CEIL semantics — a byte-for-byte port of the operator
 * console's fmtClock (the broadcast-convention reference: a countdown at
 * 0.4s reads 0:01 until true zero, never 0:00 with time left — see the
 * 2026-05-27 sync note in [gameId]/page.tsx). Negative input clamps to 0.
 */
export function fmtPadClock(ms: number): string {
  const safe = Math.max(0, ms);
  const totalSec = Math.ceil(safe / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** `m:ss` → milliseconds, or null when unparseable — the console's
 *  parseClock, ported for the pad's "set clock" input. */
export function parsePadClock(text: string): number | null {
  const m = text.trim().match(/^(\d{1,3}):([0-5]?\d)$/);
  if (!m) return null;
  return (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 1000;
}
