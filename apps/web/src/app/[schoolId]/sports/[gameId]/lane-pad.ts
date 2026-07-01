/**
 * lane-pad — pure logic for the meet LANE PAD (task #271, 2026-07-01 launch
 * sprint Day 2). Docs: docs/research/2026-07-01-launch-sprint/00-PLAN.md +
 * docs/research/2026-07-01-sports-default-parity-audit/00-AUDIT.md finding 5:
 *
 * "Live swim meet entry = typing free-text rows in MeetResultsSection.
 * World-class is a lane pad: 8 pre-filled lane rows (from roster), tap
 * lane → type time → auto-place computed by sorting marks; heat advance
 * button."
 *
 * This module is PURE (no React, no Prisma, no fetch) so every rule here —
 * mark parsing, place computation, DQ/SCR handling, heat-advance snapshot
 * shape — is unit-testable without mounting the giant console page. The
 * component (`LanePadSection.tsx`) is a thin React shell around these
 * functions, writing through the EXISTING `ctl.stats.mutate({ stats: {
 * results: [...] } })` path `MeetResultsSection` already uses — no new
 * endpoint, no schema change. Every value this module produces is run
 * through `sanitizeResults` (`@cms/api-types`) before persistence, exactly
 * like every other write to `Game.stats.results`.
 *
 * Naming mirrors the CTS ingest module (`apps/api/src/sports/
 * swim-timing-feed.ts`) deliberately — the console's manual lane pad and
 * the automatic CTS bridge write the SAME `MeetResult`/`ResultEntry` shape,
 * so a meet can start manual and switch to CTS auto-ingest (or vice versa)
 * mid-event without the board ever seeing a shape it doesn't recognize.
 */

import type { MeetResult, ResultEntry } from '@cms/api-types';

/** Lane-pad row — one lane's live entry-in-progress. Superset of
 *  {@link ResultEntry}: `place` is always present (0 = unplaced) and two
 *  status chips (`dq`/`scr`) are tracked separately from `mark` so the
 *  operator can toggle them without losing whatever time was typed. */
export interface LaneRow {
  lane: number;
  name: string;
  team?: 'home' | 'away' | null;
  /** free-typed time/mark string, e.g. "1:52.31" or "11.42". Blank = no
   *  result yet (still racing / lane empty). */
  mark: string;
  /** Disqualified — excluded from auto-placing, rendered as "DQ". */
  dq?: boolean;
  /** Scratched (didn't start) — excluded from auto-placing, rendered as "SCR". */
  scr?: boolean;
  /** Operator-entered place override. 0/undefined = let auto-place decide. */
  placeOverride?: number;
}

/** The default lane count a fresh grid pre-fills with — matches
 *  `SwimLaneGridCfg.laneCount`'s own default (`SwimDiveWidgets.tsx`) so the
 *  console and the board agree on "a pool" out of the box. Operators on a
 *  6- or 10-lane pool add/remove rows inline; this is a starting point, not
 *  a setting (CLAUDE.md: "no new settings"). */
export const DEFAULT_LANE_COUNT = 8;
export const MIN_LANE_COUNT = 1;
export const MAX_LANE_COUNT = 12; // matches SwimLaneGridWidget's render clamp

/** Build a fresh set of blank lane rows, 1..count. Non-finite input (e.g.
 *  `NaN` from a bad parse) falls back to {@link DEFAULT_LANE_COUNT}; any
 *  finite number — including 0 or negative — clamps into [MIN, MAX] rather
 *  than silently substituting the default, so a caller that explicitly
 *  asks for 0 lanes gets the floor of 1, not a surprise 8. */
export function makeLaneRows(count: number = DEFAULT_LANE_COUNT): LaneRow[] {
  const base = Number.isFinite(count) ? Math.trunc(count) : DEFAULT_LANE_COUNT;
  const n = Math.max(MIN_LANE_COUNT, Math.min(MAX_LANE_COUNT, base));
  return Array.from({ length: n }, (_, i) => ({ lane: i + 1, name: '', mark: '' }));
}

/**
 * Parse a free-typed swim/track mark into total seconds for sorting.
 * Accepts:
 *   - "SS.hh"        → e.g. "11.42" (sprints, throws don't apply here)
 *   - "MM:SS.hh"      → e.g. "1:52.31"
 *   - "HH:MM:SS.hh"   → e.g. "1:05:12.00" (rare, long-distance track)
 *   - plain integer seconds → "112"
 * Returns null for anything that doesn't parse as a time (field-event
 * distances like "142-06" or golf-style "72 (+1)" never show up in lane
 * sports, but defensive: unparseable marks return null so the caller keeps
 * the operator's manual place rather than silently mis-sorting on NaN).
 */
export function parseMarkSeconds(mark: string): number | null {
  const s = mark.trim();
  if (!s) return null;
  // Reject anything with letters (DQ/SCR/NT/etc. are handled separately,
  // never as a sortable mark).
  if (/[a-zA-Z]/.test(s)) return null;
  const parts = s.split(':');
  if (parts.length > 3) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}(\.\d{1,3})?$/.test(p)) return null;
    nums.push(parseFloat(p));
  }
  if (nums.some((n) => !Number.isFinite(n))) return null;
  let total = 0;
  for (const n of nums) total = total * 60 + n;
  return total >= 0 ? total : null;
}

/**
 * Compute auto-places for a set of lane rows: sort by parsed mark
 * ascending (fastest = place 1), excluding DQ/SCR rows and rows with no
 * parseable mark from placing at all. An operator's `placeOverride` wins
 * over the computed place — auto-place is the DEFAULT, never a lock (per
 * the mission spec: "Operator can still override place — auto is the
 * DEFAULT, not a lock"). Rows that are DQ/SCR or have no mark AND no
 * override get place 0 (unplaced).
 *
 * Returns a NEW array (input untouched) with `computedPlace` filled in per
 * row, same order as input (lane order) — the caller decides display order.
 */
export function computePlaces(rows: LaneRow[]): (LaneRow & { computedPlace: number })[] {
  const placeable = rows
    .map((r, idx) => ({ r, idx }))
    .filter(({ r }) => !r.dq && !r.scr && !r.placeOverride && parseMarkSeconds(r.mark) !== null)
    .sort((a, b) => (parseMarkSeconds(a.r.mark) as number) - (parseMarkSeconds(b.r.mark) as number));

  const autoPlaceByIdx = new Map<number, number>();
  placeable.forEach(({ idx }, i) => autoPlaceByIdx.set(idx, i + 1));

  return rows.map((r, idx) => {
    if (r.placeOverride && r.placeOverride > 0) {
      return { ...r, computedPlace: r.placeOverride };
    }
    if (r.dq || r.scr) {
      return { ...r, computedPlace: 0 };
    }
    return { ...r, computedPlace: autoPlaceByIdx.get(idx) ?? 0 };
  });
}

/** The display mark for a lane row: DQ/SCR chips win over whatever time
 *  string was typed (mirrors `laneMark` in swim-timing-feed.ts, so a
 *  manually-entered DQ and a CTS-inferred DQ render identically). */
export function laneRowMark(row: LaneRow): string {
  if (row.dq) return 'DQ';
  if (row.scr) return 'SCR';
  return row.mark.trim();
}

/** Build the event label the SAME way the CTS feed does
 *  (`formatSwimEventLabel` in swim-timing-feed.ts) — "EVENT 12 — HEAT 3" —
 *  so a manually-entered heat and a CTS-ingested heat are indistinguishable
 *  on the board / in stats.results history. `heat` is a free-typed string
 *  (the `heat` scalar stat is `type: 'text'`), so it's included verbatim
 *  when present rather than parsed as an int. */
export function formatLaneEventLabel(currentEvent: string, heat: string): string {
  const ev = currentEvent.trim();
  const h = heat.trim();
  if (!ev && !h) return 'Event';
  if (ev && h) return `${ev} — HEAT ${h}`;
  return ev || `HEAT ${h}`;
}

/**
 * Convert a lane grid's current state into the persisted {@link MeetResult}
 * shape for "advance to next heat" — this is what gets pushed into
 * `stats.results` before the grid resets. Rows with neither a name nor a
 * mark/dq/scr are dropped (an untouched lane in an 8-lane grid with only 6
 * swimmers shouldn't leave 2 fabricated blank finishers in history —
 * mirrors `readResults`' "a finish row with neither a competitor nor a
 * mark is noise" rule on the read side).
 *
 * `order` uses the same `eventNumber*100 + heat` scheme as the CTS feed
 * when both parse as plain integers; otherwise falls back to a monotonic
 * `orderHint` the caller supplies (e.g. `Date.now()` truncated, or an
 * incrementing counter) so events still sort in entry order on the board.
 *
 * `order` is clamped to the SAME bound `sanitizeResults` (`@cms/api-types`)
 * enforces at persistence, so what this function returns is byte-identical
 * to what actually lands in `Game.stats.results`. That bound was originally
 * [0, 999] — which silently truncated `eventNumber*100 + heat` for any real
 * meet event ≥ 10, collapsing distinct heats onto order=999 (found while
 * building this module). ROOT CAUSE FIXED 2026-07-01 (launch-sprint Day 2):
 * the sanitizer's `order` clamp is now [0, 9_999_999] (place/lane keep
 * their tight bounds), so event 12 heat 3 persists as 1203 and meet-long
 * ordering survives. The drift-catcher test in swim-timing-feed.spec.ts
 * asserts the POST-sanitize value so this can never silently regress.
 */
const SANITIZE_ORDER_MAX = 9_999_999; // MUST match sanitizeResults' order clamp
export function buildHeatResult(
  currentEvent: string,
  heat: string,
  rows: LaneRow[],
  orderHint: number,
): MeetResult {
  const placed = computePlaces(rows);
  const entries: ResultEntry[] = placed
    .filter((r) => r.name.trim() || r.mark.trim() || r.dq || r.scr)
    .map((r) => {
      const entry: ResultEntry = {
        place: r.computedPlace,
        name: r.name.trim(),
        mark: laneRowMark(r),
        lane: r.lane,
      };
      if (r.team) entry.team = r.team;
      return entry;
    });

  const eventNum = parseInt(currentEvent.trim(), 10);
  const heatNum = parseInt(heat.trim(), 10);
  const rawOrder =
    Number.isFinite(eventNum) && eventNum > 0 && Number.isFinite(heatNum) && heatNum > 0
      ? eventNum * 100 + heatNum
      : orderHint;
  const order = Math.max(0, Math.min(SANITIZE_ORDER_MAX, Math.trunc(rawOrder)));

  return {
    event: formatLaneEventLabel(currentEvent, heat),
    order,
    entries,
  };
}

/**
 * Merge a freshly-built heat result into the existing `stats.results`
 * array: replace the entry for the SAME event label if present (re-saving
 * the same heat after a correction), else append. Mirrors
 * `mergeSwimResult` in swim-timing-feed.ts exactly, including its 64-entry
 * cap, so manual console saves and CTS auto-ingest saves behave
 * identically against the same history array — `sanitizeResults` enforces
 * the same cap again server-side as the final gate.
 */
export function mergeHeatResult(existing: MeetResult[], fresh: MeetResult): MeetResult[] {
  const idx = existing.findIndex((e) => e.event === fresh.event);
  const next = existing.slice();
  if (idx >= 0) {
    next[idx] = fresh;
  } else {
    next.push(fresh);
  }
  const MAX = 64;
  return next.length > MAX ? next.slice(next.length - MAX) : next;
}

/**
 * Convert a saved {@link MeetResult} (e.g. re-opening the current/last
 * heat for a correction) back into lane rows for the grid, filling any
 * lane 1..laneCount that has no saved entry with a blank row. Unlike
 * `SwimLaneGridWidget`'s render-only fill, this ALSO restores DQ/SCR chip
 * state from the `mark` string ("DQ"/"SCR" round-trip losslessly).
 */
export function resultToLaneRows(result: MeetResult | null | undefined, laneCount: number): LaneRow[] {
  const rows = makeLaneRows(laneCount);
  if (!result) return rows;
  const byLane = new Map<number, ResultEntry>();
  for (const e of result.entries) {
    if (typeof e.lane === 'number' && e.lane > 0 && !byLane.has(e.lane)) {
      byLane.set(e.lane, e);
    }
  }
  return rows.map((row) => {
    const e = byLane.get(row.lane);
    if (!e) return row;
    const mark = e.mark.trim().toUpperCase();
    return {
      lane: row.lane,
      name: e.name,
      team: e.team ?? null,
      mark: mark === 'DQ' || mark === 'SCR' ? '' : e.mark,
      dq: mark === 'DQ',
      scr: mark === 'SCR',
      placeOverride: e.place > 0 ? e.place : undefined,
    };
  });
}

/**
 * Roster auto-fill: given roster rows (the same minimal shape
 * `SwimRosterEntry` uses in swim-timing-feed.ts — `stats.lane` is the
 * per-heat lane hint an operator sets on the roster), produce a name/team
 * lookup by lane number. A roster entry with no lane set (unassigned, or a
 * different heat) is never joined onto a lane it wasn't assigned to — same
 * rule the CTS ingest follows.
 */
export interface LaneRosterEntry {
  name: string;
  team?: 'home' | 'away' | null;
  lane?: number | null;
}

export function rosterByLane(roster: LaneRosterEntry[]): Map<number, LaneRosterEntry> {
  const map = new Map<number, LaneRosterEntry>();
  for (const r of roster) {
    const lane = typeof r.lane === 'number' ? r.lane : Number(r.lane);
    if (Number.isFinite(lane) && lane > 0 && !map.has(lane)) {
      map.set(lane, r);
    }
  }
  return map;
}

/** Apply roster auto-fill to a fresh set of blank lane rows: only fills
 *  lanes that are still blank (no name typed) — never clobbers an
 *  operator's manual entry once they've started typing. */
export function applyRosterToLanes(rows: LaneRow[], roster: LaneRosterEntry[]): LaneRow[] {
  const byLane = rosterByLane(roster);
  return rows.map((row) => {
    if (row.name.trim()) return row;
    const entry = byLane.get(row.lane);
    if (!entry) return row;
    return { ...row, name: entry.name, team: entry.team ?? null };
  });
}
