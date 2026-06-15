/**
 * CTS source-of-truth merge — applied by every public sports surface
 * (board, ribbon, scorebug) so they all read identical data.
 *
 * Architecture: the CTS bridge (CtsBridge.tsx) on the kiosk forwards
 * parsed snapshots to `POST /api/v1/sports/games/:gameId/cts-snapshot`
 * at ~5 Hz. The API writes the snapshot to `Game.stats.cts =
 * { lastUpdateAt, ... }` — NO overwrite of `Game.homeScore/awayScore/
 * clockMs/clockRunning/segment`. Those persistent fields stay as the
 * OPERATOR INPUT layer (the +/- chips, the clock start/stop in the Run
 * console). The merge is purely a render-time overlay:
 *
 *   • CTS heartbeat fresh (≤ CTS_FRESH_MS):
 *       — clock / score / segment / shotClock come from `stats.cts`
 *       — operator inputs are silently ignored on the public surfaces
 *   • CTS heartbeat stale OR never seen:
 *       — board falls back to operator-input fields (today's behavior)
 *
 * This is what gives the operator a graceful path: if the CTS console
 * boot-loops mid-game or someone yanks the dongle, they tap "Run" and
 * adjust the score / clock manually. As soon as CTS comes back online
 * (within ~5 s of the next snapshot), the board re-snaps to CTS data.
 *
 * The freshness window is 5 s. The bridge POSTs at ~5 Hz when a game
 * is live (the CTS console emits multiple module packets per second
 * and we throttle); a 5 s gap means we're missing > 25 packets — far
 * past any realistic network blip. The threshold is intentionally
 * generous to ride out a slow poll cycle.
 */

/** One structured shot-clock entry as stored in `Game.stats.cts`. */
export interface CtsShotClockEntry {
  ms: number;
  running: boolean;
  len?: number;
  at?: string;
}

/** One CTS exclusion as stored in `Game.stats.cts.homeExclusions` /
 *  `awayExclusions`. */
export interface CtsExclusionEntry {
  playerJersey: number;
  secondsRemaining: number;
}

/** A CTS snapshot as written by the API into `Game.stats.cts`. Every
 *  field is OPTIONAL — only the fields the parser saw show up here.
 *  `lastUpdateAt` is an ISO timestamp set server-side when the snapshot
 *  arrived. */
export interface CtsStatsBlock {
  lastUpdateAt?: string;
  clockMs?: number;
  clockRunning?: boolean;
  segment?: number;
  homeScore?: number;
  awayScore?: number;
  /** Operator-set (or CTS-single-side) shot clock.  For per-team CTS
   *  shot clocks, see `homeShotClock` / `awayShotClock`. */
  shotClock?: CtsShotClockEntry;
  /** T2-1: per-side CTS shot clocks. */
  homeShotClock?: CtsShotClockEntry;
  awayShotClock?: CtsShotClockEntry;
  /** T2-1: active exclusions per team (water polo penalty box).
   *  Null entries = slot empty. */
  homeExclusions?: (CtsExclusionEntry | null)[];
  awayExclusions?: (CtsExclusionEntry | null)[];
  /** T2-1: timeouts remaining per team. */
  homeTimeoutsRemaining?: number;
  awayTimeoutsRemaining?: number;
  /** The raw CTS clock display string ("7:42" / ":15.3") — kept for
   *  diagnostics so an operator can compare what the bridge parsed
   *  vs what the API computed. Never rendered. */
  raw?: string;
}

/** Freshness threshold — the CTS heartbeat must be within this window
 *  for its data to count as the source of truth. 5 s is conservative;
 *  the bridge POSTs every ~200 ms (5 Hz). */
export const CTS_FRESH_MS = 5000;

/** Read the CTS stats block off a Game's stats blob, or null if absent
 *  / malformed. Safe to call on any shape — never throws. */
export function readCtsStats(stats: unknown): CtsStatsBlock | null {
  if (!stats || typeof stats !== 'object') return null;
  const c = (stats as Record<string, unknown>).cts;
  if (!c || typeof c !== 'object') return null;
  return c as CtsStatsBlock;
}

/** Is the CTS heartbeat fresh enough to be the source of truth? Pass
 *  `serverTime` (the API's `Date.now()` from the board response) so the
 *  freshness check uses the server's clock — robust to client clock
 *  skew on a kiosk that hasn't synced NTP in a while. */
export function isCtsFresh(
  cts: CtsStatsBlock | null,
  serverTime: number,
): boolean {
  if (!cts || !cts.lastUpdateAt) return false;
  const t = Date.parse(cts.lastUpdateAt);
  if (!Number.isFinite(t)) return false;
  return serverTime - t < CTS_FRESH_MS;
}

/** Status pill state for the Setup-mode panel. */
export type CtsStatusKind = 'fresh' | 'stale' | 'never';

export interface CtsStatus {
  kind: CtsStatusKind;
  /** Milliseconds since the last accepted snapshot, or null when never. */
  ageMs: number | null;
  /** Human-readable text for the pill. */
  label: string;
}

/** Compute a CtsStatus for the Setup UI. Pass `serverTime` from the
 *  board response so clock skew on the operator's browser doesn't lie. */
export function computeCtsStatus(
  stats: unknown,
  serverTime: number,
): CtsStatus {
  const cts = readCtsStats(stats);
  if (!cts || !cts.lastUpdateAt) {
    return { kind: 'never', ageMs: null, label: 'CTS not configured' };
  }
  const t = Date.parse(cts.lastUpdateAt);
  if (!Number.isFinite(t)) {
    return { kind: 'never', ageMs: null, label: 'CTS not configured' };
  }
  const ageMs = serverTime - t;
  if (ageMs < CTS_FRESH_MS) {
    return { kind: 'fresh', ageMs, label: 'CTS connected — receiving' };
  }
  return { kind: 'stale', ageMs, label: 'CTS stale — using operator inputs' };
}

/** A minimal shape of the board endpoint payload — the fields this
 *  helper actually reads. Compatible with the full BoardData in
 *  apps/web/src/app/board/[gameId]/page.tsx; we keep it loose here so
 *  callers can pass either route's data shape unchanged. */
export interface CtsMergeInput {
  segment: number;
  homeScore: number;
  awayScore: number;
  clockMs: number;
  clockRunning: boolean;
  clockUpdatedAt: string;
  stats: Record<string, unknown> | unknown;
  serverTime: number;
}

/** Apply the CTS-overlay if its heartbeat is fresh. Returns a new
 *  object with the overlaid fields; everything else (team names,
 *  colors, sponsors, ribbon messages) is left untouched.
 *
 *  - When CTS is fresh: clock anchor is re-anchored to NOW (using
 *    `serverTime`) so the local clock projector ticks from the CTS
 *    reading instead of the operator-input anchor. This matters: if
 *    we re-used the operator's stored `clockUpdatedAt`, the projector
 *    would think the CTS clock has been "running" for whatever delta
 *    has elapsed since the operator paused it, and the displayed clock
 *    would be wildly wrong on the first frame after CTS comes online.
 *
 *  - When CTS is stale or absent: returns the input as-is.
 *
 *  T2-1: also merges per-side shot clocks, exclusions, and timeouts
 *  when CTS is fresh.  Operator manual values stay sticky when CTS is
 *  missing or stale (existing pattern).
 *
 *  Pure — no side effects. Same data in → same data out. */
export function applyCtsOverlay<T extends CtsMergeInput>(input: T): T {
  const cts = readCtsStats(input.stats);
  if (!cts || !isCtsFresh(cts, input.serverTime)) {
    return input;
  }
  const next: T = { ...input };
  if (typeof cts.homeScore === 'number') next.homeScore = cts.homeScore;
  if (typeof cts.awayScore === 'number') next.awayScore = cts.awayScore;
  if (typeof cts.segment === 'number' && cts.segment >= 1) next.segment = cts.segment;
  if (typeof cts.clockMs === 'number') {
    next.clockMs = Math.max(0, cts.clockMs);
    // Re-anchor to CTS's lastUpdateAt so the projector ticks from the
    // moment CTS reported, not from whenever the operator last touched
    // the clock. lastUpdateAt is ISO; convert defensively.
    const ts = cts.lastUpdateAt ? Date.parse(cts.lastUpdateAt) : NaN;
    next.clockUpdatedAt = Number.isFinite(ts)
      ? new Date(ts).toISOString()
      : new Date(input.serverTime).toISOString();
  }
  if (typeof cts.clockRunning === 'boolean') next.clockRunning = cts.clockRunning;

  // Build a mutable stats copy that we'll augment with per-side CTS fields.
  let statsMutated = false;
  let stats: Record<string, unknown> =
    input.stats && typeof input.stats === 'object'
      ? { ...(input.stats as Record<string, unknown>) }
      : {};

  // Shot clock overlay (original single-side field — preserved for
  // backwards compatibility with older bridges).
  if (cts.shotClock && typeof cts.shotClock === 'object') {
    statsMutated = true;
    const sc = cts.shotClock;
    stats.shotClock = {
      ms: Math.max(0, Number(sc.ms) || 0),
      running: !!sc.running,
      len: typeof sc.len === 'number' ? sc.len : (stats.shotClock as { len?: number })?.len,
      at: sc.at || cts.lastUpdateAt || new Date(input.serverTime).toISOString(),
    };
  }

  // T2-1: per-side shot clocks.  Operator manual values stay sticky
  // when CTS is missing — only overwrite when CTS is fresh AND the
  // field is present.
  const ctsAt = cts.lastUpdateAt || new Date(input.serverTime).toISOString();
  if (cts.homeShotClock && typeof cts.homeShotClock === 'object') {
    statsMutated = true;
    const sc = cts.homeShotClock;
    stats.homeShotClock = {
      ms: Math.max(0, Number(sc.ms) || 0),
      running: !!sc.running,
      len: typeof sc.len === 'number' ? sc.len : undefined,
      at: sc.at || ctsAt,
    };
  }
  if (cts.awayShotClock && typeof cts.awayShotClock === 'object') {
    statsMutated = true;
    const sc = cts.awayShotClock;
    stats.awayShotClock = {
      ms: Math.max(0, Number(sc.ms) || 0),
      running: !!sc.running,
      len: typeof sc.len === 'number' ? sc.len : undefined,
      at: sc.at || ctsAt,
    };
  }

  // CTS shot-clock data seam (2026-06-15): the real water-polo/basketball
  // bridge POSTs only per-side homeShotClock/awayShotClock, but the board's
  // main shot-clock projector (and the ribbon) read the single-side
  // `stats.shotClock`. Without this the big-board shot clock stays dark/frozen
  // on a live CTS game — the marquee game-night failure for the first customer.
  // Derive a single-side shotClock from whichever per-side is ACTIVE (water
  // polo / basketball only ever run one shot clock at a time): prefer the
  // running side, else the side with time on it, else home. Only when the
  // legacy single-side field wasn't already provided above.
  if (!stats.shotClock && (cts.homeShotClock || cts.awayShotClock)) {
    const h = cts.homeShotClock && typeof cts.homeShotClock === 'object' ? cts.homeShotClock : null;
    const a = cts.awayShotClock && typeof cts.awayShotClock === 'object' ? cts.awayShotClock : null;
    const active =
      (h && (h.running || (Number(h.ms) || 0) > 0)) ? h :
      (a && (a.running || (Number(a.ms) || 0) > 0)) ? a :
      (h || a);
    if (active) {
      statsMutated = true;
      stats.shotClock = {
        ms: Math.max(0, Number(active.ms) || 0),
        running: !!active.running,
        len: typeof active.len === 'number' ? active.len : undefined,
        at: active.at || ctsAt,
      };
    }
  }

  // T2-1: exclusions.  Write the CTS-sourced exclusion arrays into
  // stats so scoreboard widgets (e.g. water polo penalty display) can
  // render them.  We keep the full 3-slot array (with nulls) so the
  // board can show empty slots.
  if (Array.isArray(cts.homeExclusions)) {
    statsMutated = true;
    stats.homeExclusions = cts.homeExclusions;
  }
  if (Array.isArray(cts.awayExclusions)) {
    statsMutated = true;
    stats.awayExclusions = cts.awayExclusions;
  }

  // T2-1: timeouts remaining.  Operator manual value stays sticky when
  // CTS is absent.
  if (typeof cts.homeTimeoutsRemaining === 'number') {
    statsMutated = true;
    stats.homeTimeoutsRemaining = cts.homeTimeoutsRemaining;
  }
  if (typeof cts.awayTimeoutsRemaining === 'number') {
    statsMutated = true;
    stats.awayTimeoutsRemaining = cts.awayTimeoutsRemaining;
  }

  if (statsMutated) {
    next.stats = stats;
  }
  return next;
}

/** Convert a CTS clock display string ("M:SS" or ":SS.t") to milliseconds.
 *  Used server-side when the parser has only the string form. Returns
 *  null when the input is malformed.
 *
 *  Examples:
 *    "7:42"  → 462000   (7 min 42 s)
 *    "0:08"  → 8000     (8 s)
 *    ":15.3" → 15300    (15.3 s — last-minute tenths)
 *    "15.3"  → 15300
 *    ""      → null
 */
export function parseCtsClockToMs(clock: string | undefined | null): number | null {
  if (typeof clock !== 'string') return null;
  const s = clock.trim();
  if (!s) return null;
  // Strip leading ':' for the ':SS.t' last-minute format.
  const cleaned = s.startsWith(':') ? s.slice(1) : s;
  // Form "M:SS" or "M:SS.t"
  if (cleaned.includes(':')) {
    const parts = cleaned.split(':');
    if (parts.length !== 2) return null;
    const minPart = parts[0] || '0';
    const secPart = parts[1] || '0';
    const mins = parseInt(minPart, 10);
    const secs = parseFloat(secPart);
    if (!Number.isFinite(mins) || !Number.isFinite(secs)) return null;
    return Math.round((mins * 60 + secs) * 1000);
  }
  // Form "SS.t" — seconds with optional tenths.
  const secs = parseFloat(cleaned);
  if (!Number.isFinite(secs)) return null;
  return Math.round(secs * 1000);
}
