/**
 * VenueOS Sports — THE clock contract (K-12 launch program, lane A2,
 * 2026-09-27). One pure module, shared by the API (which re-anchors clocks
 * inside game commands) and every web surface (operator console, volunteer
 * pad, board, ribbon, scorebug, sport widgets), so a clock reading can only
 * mean one thing wherever it is shown:
 *
 *   - PROJECTION: a clock is an ANCHOR — the reading `ms` taken at `at`
 *     (server clock domain), advancing while `running`. Every surface derives
 *     the live reading with the same math, from a SERVER time (K12-F17 — never
 *     the device's own clock; see apps/web/src/lib/server-clock.ts for how a
 *     browser estimates it).
 *   - EXPIRY: when a running game clock has run out (K12-F08 — the period then
 *     HOLDS at that reading until the table advances it).
 *   - DISPLAY: MM:SS, or seconds + tenths in the final minute for the sports
 *     whose scoreboards show tenths (K12-F17).
 *   - ENTRY: the exact-time correction a scorer types, tenths included and
 *     never ambiguous (K12-F17).
 *   - SHOT CLOCK MODE: never configured vs switched OFF vs on (K12-F05).
 *
 * Constraints: pure — no DOM, no React, no network, no Date.now() (callers
 * pass the time), so it unit-tests without a clock and ships to Chromium 83
 * (NovaStar Taurus) players.
 */
import type { ClockType, SportDefinition } from './sports';

/** When a clock reading was taken: an ISO string, epoch ms, or a Date. */
export type ClockAnchorTime = string | number | Date | null | undefined;

/** Epoch ms of an anchor time, or NaN when it is missing / unparseable. */
export function clockAnchorMs(at: ClockAnchorTime): number {
  if (at === null || at === undefined || at === '') return NaN;
  if (typeof at === 'number') return Number.isFinite(at) ? at : NaN;
  const t = at instanceof Date ? at.getTime() : new Date(String(at)).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function nonNegative(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The game clock's reading at `nowMs` (server clock domain). A stopped clock,
 * a clockless sport or an unreadable anchor reads its stored value; a running
 * countdown never reads below 0. Elapsed time is never negative: an anchor
 * stamped "in the future" (clock skew) holds the reading rather than winding
 * the clock backwards.
 */
export function projectGameClockMs(
  clock: { clockMs?: unknown; clockRunning?: unknown; clockUpdatedAt?: ClockAnchorTime },
  kind: ClockType,
  nowMs: number,
): number {
  const base = nonNegative(clock.clockMs);
  if (!clock.clockRunning || kind === 'none') return base;
  const at = clockAnchorMs(clock.clockUpdatedAt);
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return base;
  const elapsed = Math.max(0, nowMs - at);
  return kind === 'countup' ? base + elapsed : Math.max(0, base - elapsed);
}

/**
 * A secondary countdown's reading at `nowMs` — the shot clock, the football
 * play clock, one penalty-box timer — all stored as `{ ms, at, running }`.
 */
export function projectCountdownMs(
  entry: { ms?: unknown; at?: ClockAnchorTime | unknown; running?: unknown } | null | undefined,
  nowMs: number,
): number {
  if (!entry) return 0;
  const base = nonNegative(entry.ms);
  if (!entry.running) return base;
  const at = clockAnchorMs(entry.at as ClockAnchorTime);
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return base;
  return Math.max(0, base - Math.max(0, nowMs - at));
}

// ── expiry (K12-F08) ─────────────────────────────────────────────

function statsRecord(stats: unknown): Record<string, unknown> {
  return stats && typeof stats === 'object' && !Array.isArray(stats)
    ? (stats as Record<string, unknown>)
    : {};
}

/**
 * The reading at which a RUNNING game clock has run out: 0 for a countdown;
 * the segment length plus the operator's added (stoppage) minutes for a
 * count-up; null for a clockless sport.
 */
export function gameClockExpiryMs(def: SportDefinition, stats?: unknown): number | null {
  if (def.clock.type === 'countdown') return 0;
  if (def.clock.type === 'countup') {
    const added = nonNegative(statsRecord(stats).addedTime) * 60_000;
    return (def.clock.segmentMs ?? 0) + added;
  }
  return null;
}

/** Has a game clock reading `readingMs` run out for this sport? */
export function isGameClockExpired(def: SportDefinition, stats: unknown, readingMs: number): boolean {
  const limit = gameClockExpiryMs(def, stats);
  if (limit === null) return false;
  return def.clock.type === 'countdown' ? readingMs <= 0 : readingMs >= limit;
}

/**
 * Is `segment` played without a game clock? Football overtime (NFHS: untimed,
 * possession-based) — the clock is zeroed and stays off for every OT period.
 */
export function isUntimedSegment(def: SportDefinition, segment: number): boolean {
  return def.clock.untimedOvertime === true && segment > def.segment.count;
}

/**
 * K12-F08 — the period's clock has run out and the game is HOLDING there for
 * the table: a LIVE game whose stopped clock sits at its expiry reading. The
 * board keeps showing that end state (0:00 in the same quarter) until the
 * scorer advances the period; nothing advances it automatically.
 */
export function isPeriodClockOver(
  def: SportDefinition,
  game: { status?: unknown; clockRunning?: unknown; clockMs?: unknown; stats?: unknown; segment?: unknown },
): boolean {
  if (game.status !== 'LIVE' || game.clockRunning) return false;
  if (def.clock.type === 'none') return false;
  const segment = Number(game.segment);
  if (Number.isFinite(segment) && isUntimedSegment(def, segment)) return false;
  return isGameClockExpired(def, game.stats, nonNegative(game.clockMs));
}

// ── display (K12-F17) ────────────────────────────────────────────

/** Below this reading, a tenths-capable countdown shows seconds + tenths. */
export const CLOCK_TENTHS_BELOW_MS = 60_000;

/**
 * Does this sport's scoreboard show tenths at this reading? Only a countdown
 * whose definition says its boards show tenths (`clock.tenths`), and only in
 * the final minute. Count-up clocks never do — a soccer half's first minute
 * reads 0:12, not 12.3.
 */
export function clockShowsTenths(def: SportDefinition | null | undefined, readingMs: number): boolean {
  return (
    !!def &&
    def.clock.type === 'countdown' &&
    def.clock.tenths === true &&
    Math.max(0, readingMs) < CLOCK_TENTHS_BELOW_MS
  );
}

/**
 * Format a clock reading. MM:SS rounds UP (a countdown at 0.4 s reads 0:01;
 * 0:00 only ever means expired — the broadcast convention every surface has
 * used since the 2026-08-09 parity pass). Tenths mode (final minute) floors
 * both the seconds and the tenths, like a real shot clock: 59.94 reads 59.9.
 */
export function formatClockReading(ms: number, showTenths = false): string {
  const safe = Math.max(0, Number.isFinite(ms) ? ms : 0);
  if (showTenths && safe < CLOCK_TENTHS_BELOW_MS) {
    const s = Math.floor(safe / 1000);
    const tenths = Math.floor((safe % 1000) / 100);
    return `${s}.${tenths}`;
  }
  const totalSec = Math.ceil(safe / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** THE game-clock text for a sport at a reading — every surface uses this. */
export function formatSportClock(def: SportDefinition | null | undefined, ms: number): string {
  return formatClockReading(ms, clockShowsTenths(def, ms));
}

// ── entry (K12-F17) ──────────────────────────────────────────────

/**
 * Parse a scorer's exact-time correction. Only unambiguous forms:
 *
 *   "7:42"   "12:00"  "120:00"   minutes:seconds (seconds 0-59)
 *   "0:04.3" "7:42.5"            … with tenths (one digit)
 *   ":04.3"  ":45"               seconds (and tenths) — the final-minute form
 *   "4.3"    "0.3"   "59.9"      seconds + tenths (a decimal point, no colon)
 *
 * A bare number ("45") is refused: it could be minutes or seconds, and a
 * correction must say which. Returns milliseconds, or null.
 */
export function parseClockEntry(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const s = text.trim();
  let m = /^(\d{1,3})?:([0-5]?\d)(?:\.(\d))?$/.exec(s);
  if (m) {
    const minutes = m[1] === undefined ? 0 : parseInt(m[1], 10);
    const seconds = parseInt(m[2], 10);
    const tenths = m[3] === undefined ? 0 : parseInt(m[3], 10);
    return (minutes * 60 + seconds) * 1000 + tenths * 100;
  }
  m = /^([0-5]?\d)\.(\d)$/.exec(s);
  if (m) return parseInt(m[1], 10) * 1000 + parseInt(m[2], 10) * 100;
  return null;
}

// ── shot clock mode (K12-F05) ────────────────────────────────────

/**
 * unset — never configured: the first game-clock start arms it at the sport's
 *         default length (the operator never has to find a setup step).
 * off   — the table switched it OFF (length 0). It stays off across every
 *         start, pause, timeout, period and reload until someone turns it on.
 * on    — running at its configured length (`len` seconds).
 */
export type ShotClockMode = 'unset' | 'off' | 'on';

export function shotClockMode(stats: unknown): ShotClockMode {
  const sc = statsRecord(stats).shotClock;
  if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return 'unset';
  const len = Number((sc as Record<string, unknown>).len);
  return Number.isFinite(len) && len > 0 ? 'on' : 'off';
}
