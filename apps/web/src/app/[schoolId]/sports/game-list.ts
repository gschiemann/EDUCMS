/**
 * game-list — pure logic for the Game Day list ordering + grouping +
 * "when is it" copy (Sports Wave S4-2, P2, 2026-07-02 deep-pass audit
 * finding: "Game list scales badly (flat grid, no LIVE-first, no dates, no
 * search)").
 *
 * PURE (no React, no fetch) so the ordering rule and the relative-time copy
 * are unit-testable without mounting `SportsHub`. Mirrors the `lane-pad.ts`
 * / `surface-health.ts` convention of extracting a giant console page's
 * logic into small, directly-tested modules.
 *
 * Ordering contract (audit P2 + lead fix-plan Wave S4):
 *   1. LIVE (and HALFTIME — still "on the air") first, most-recently-
 *      started first so the newest live game is at the top.
 *   2. Upcoming (SCHEDULED / PRE_GAME) next, dated games ordered by
 *      scheduledAt ascending (soonest first), undated games AFTER every
 *      dated one (sorted by createdAt ascending — oldest-created first,
 *      i.e. FIFO, so a batch of undated games doesn't reshuffle on every
 *      render).
 *   3. FINAL games last, collapsed behind a single disclosure — these are
 *      history, not something the operator needs to scan every visit.
 */

export type GameListStatus = 'SCHEDULED' | 'PRE_GAME' | 'LIVE' | 'HALFTIME' | 'FINAL';

/** Minimal shape this module needs — a subset of the full Game record. */
export interface GameListItem {
  id: string;
  status?: string | GameListStatus | null;
  scheduledAt?: string | Date | null;
  createdAt?: string | Date | null;
  startedAt?: string | Date | null;
}

export type GameListGroup = 'live' | 'upcoming' | 'past';

/** Which bucket a game's status sorts into. */
export function groupOf(status: string | null | undefined): GameListGroup {
  if (status === 'LIVE' || status === 'HALFTIME') return 'live';
  if (status === 'FINAL') return 'past';
  return 'upcoming'; // SCHEDULED | PRE_GAME | anything unrecognized
}

function toTime(v: string | Date | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Order a full game list per the contract above. Returns a NEW array (never
 * mutates the input) split into the three buckets in display order, each
 * bucket internally sorted:
 *   - live: most-recently-started first (startedAt desc; falls back to
 *     createdAt desc so a live game missing startedAt doesn't sort to the
 *     bottom).
 *   - upcoming: dated-ascending, then undated-by-createdAt-ascending.
 *   - past: most-recently-ended first (falls back to createdAt desc) — the
 *     last game played reads first inside the collapsed section.
 */
export function orderGames<T extends GameListItem>(games: T[]): {
  live: T[];
  upcoming: T[];
  past: T[];
} {
  const live: T[] = [];
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const g of games) {
    const bucket = groupOf(g.status as string);
    if (bucket === 'live') live.push(g);
    else if (bucket === 'past') past.push(g);
    else upcoming.push(g);
  }

  live.sort((a, b) => {
    const at = toTime(a.startedAt) ?? toTime(a.createdAt) ?? 0;
    const bt = toTime(b.startedAt) ?? toTime(b.createdAt) ?? 0;
    return bt - at; // most recent first
  });

  upcoming.sort((a, b) => {
    const at = toTime(a.scheduledAt);
    const bt = toTime(b.scheduledAt);
    if (at !== null && bt !== null) return at - bt; // soonest first
    if (at !== null) return -1; // dated before undated
    if (bt !== null) return 1;
    // Both undated — stable FIFO by createdAt ascending.
    const act = toTime(a.createdAt) ?? 0;
    const bct = toTime(b.createdAt) ?? 0;
    return act - bct;
  });

  past.sort((a, b) => {
    const at = toTime(a.startedAt) ?? toTime(a.createdAt) ?? 0;
    const bt = toTime(b.startedAt) ?? toTime(b.createdAt) ?? 0;
    return bt - at; // most recently played first
  });

  return { live, upcoming, past };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Tonight 7:00 PM" style relative-day + time copy for a scheduled game
 * card. `now` is injectable for tests; defaults to the real clock.
 *
 *   - Today            → "Tonight 7:00 PM" (evening, 5pm+) or "Today 7:00 PM"
 *   - Tomorrow         → "Tomorrow 7:00 PM"
 *   - Within 6 days    → "Friday 7:00 PM" (weekday name)
 *   - Further out      → "Aug 21, 7:00 PM"
 *   - Past a scheduled time that never went LIVE → still renders the same
 *     way; the list ordering (not this formatter) is what demotes it.
 */
export function formatGameWhen(value: string | Date | null | undefined, now: Date = new Date()): string {
  const t = toTime(value);
  if (t === null) return '';
  const d = new Date(t);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(d) - startOfDay(now)) / DAY_MS);

  if (dayDiff === 0) {
    const isEvening = d.getHours() >= 17;
    return `${isEvening ? 'Tonight' : 'Today'} ${time}`;
  }
  if (dayDiff === 1) return `Tomorrow ${time}`;
  if (dayDiff > 1 && dayDiff <= 6) {
    return `${d.toLocaleDateString(undefined, { weekday: 'long' })} ${time}`;
  }
  if (dayDiff === -1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}
