/**
 * Deterministic manifest schedule ordering (2026-08-30 player reliability
 * program, W1-8 / audit P0-3).
 *
 * THE PROBLEM. The manifest handler returned every active schedule targeting
 * the screen OR its group as an UNORDERED bag (`findMany` with no orderBy —
 * i.e. whatever the database felt like, per replica, per plan). The player
 * then applied its own rule: "any playlist with a template wins absolutely."
 * Net effect: a months-old GROUP template schedule could silently shadow a
 * brand-new screen-specific media publish forever — a confirmed independent
 * stale-content path from the 1.1.6 audit. And because a direct screen
 * publish CANNOT deactivate a group schedule (that would black out the other
 * member screens — see schedule-displacement.ts), both rows legitimately
 * coexist; the missing piece was a deterministic precedence.
 *
 * THE RULE (replace-mode rows compete; append rows never compete):
 *   0. the FALLBACK tier rides last              (2026-10-24, launch QA U15 —
 *      an always-on rule at a negative priority, see
 *      schedule-window-overlap.ts FALLBACK_PRIORITY: a time-limited publish
 *      keeps the always-on playlist it lands on as the fallback outside its
 *      hours. Without this key a fallback PINNED to the screen would outrank a
 *      GROUP-wide school-hours rule by key 1 and the new playlist would never
 *      play there.)
 *   1. screen-pinned beats group-targeted        (the override the operator
 *                                                 just published wins)
 *   2. higher numeric priority beats lower
 *   3. later startTime beats earlier             (newest publish wins ties)
 *   4. stable id tie-breaker                     (identical across replicas)
 *
 * The API SORTS (winner first) and LABELS (`pin`, `mode`) — the player picks
 * the first replace row whose day/time window is open right now, which keeps
 * window evaluation client-side where it always lived (server-side window
 * evaluation would go stale for up to the manifest hot-cache TTL at every
 * lunch-menu boundary).
 *
 * Pure and Prisma-free so it unit-tests in microseconds.
 */

export interface OrderableSchedule {
  id: string;
  screenId?: string | null;
  screenGroupId?: string | null;
  priority?: number | null;
  mode?: string | null;
  startTime?: Date | string | null;
  /** The window fields — only read to recognise the fallback tier (key 0). */
  daysOfWeek?: string | null;
  timeStart?: string | null;
  timeEnd?: string | null;
}

/**
 * The fallback tier: ALWAYS-ON (no day/time window) at a NEGATIVE priority.
 * Mirrors `isFallbackRule` in schedules/schedule-window-overlap.ts (kept as a
 * local copy so this file stays dependency-free, like the web mirror in
 * screens/v3/screenOps.ts). Nothing wrote a negative priority before the
 * fallback tier existed, so every pre-existing manifest orders exactly as
 * before.
 */
function isFallbackTier(s: OrderableSchedule): boolean {
  return (s.priority ?? 0) < 0 && !s.daysOfWeek && !s.timeStart && !s.timeEnd;
}

/** 'screen' when the row is pinned to this exact screen, else 'group'. */
export function schedulePin(s: OrderableSchedule): 'screen' | 'group' {
  return s.screenId ? 'screen' : 'group';
}

function startMs(s: OrderableSchedule): number {
  if (!s.startTime) return 0;
  const t = new Date(s.startTime).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Sort schedules into manifest order: effective replace winner FIRST, then
 * the rest of the replace rows in precedence order, then append rows (which
 * keep the same precedence order among themselves — their order only
 * matters for item concatenation).
 */
export function orderSchedulesForManifest<T extends OrderableSchedule>(schedules: T[]): T[] {
  const rank = (s: OrderableSchedule): number => (schedulePin(s) === 'screen' ? 0 : 1);
  return [...schedules].sort((a, b) => {
    const aAppend = (a.mode ?? 'replace') === 'append' ? 1 : 0;
    const bAppend = (b.mode ?? 'replace') === 'append' ? 1 : 0;
    if (aAppend !== bAppend) return aAppend - bAppend; // replace rows first
    if (!aAppend) {
      const aFallback = isFallbackTier(a) ? 1 : 0;
      const bFallback = isFallbackTier(b) ? 1 : 0;
      if (aFallback !== bFallback) return aFallback - bFallback; // fallback tier last
    }
    if (rank(a) !== rank(b)) return rank(a) - rank(b); // screen-pin first
    const ap = a.priority ?? 0;
    const bp = b.priority ?? 0;
    if (ap !== bp) return bp - ap;                     // higher priority first
    const at = startMs(a);
    const bt = startMs(b);
    if (at !== bt) return bt - at;                     // newest start first
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;     // replica-stable tie
  });
}
