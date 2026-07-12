/**
 * SwimTimingFeed — normalizes a decoded CTS SWIMMING scoreboard-serial
 * snapshot (`@cms/scoreboard-cts`'s `SwimTimingSnapshot`) into the
 * EXISTING `MeetResult`/`ResultEntry` shape (`packages/api-types/src/
 * sports.ts`) that `Game.stats.results` already carries — the same
 * structured stat the console's Meet-Results editor writes and every
 * swim/dive board widget (`SWIM_LANE_GRID`, `SWIM_SPLITS_PANEL`, …)
 * reads via `readResults`.
 *
 * docs/research/2026-06-30-swim-dive-scoreboards/00-REPORT.md part A7:
 * "VenueOS's ingest must join these two streams on (event, heat, lane)"
 * — names/seed come from meet-management data (here: `RosterPlayer` rows
 * scoped to this game, since VenueOS has no separate Hy-Tek/Splash
 * import yet); times/place/splits come from the timer. This module is
 * PURE (no Prisma, no NestJS) so it's fully unit-testable without a DB —
 * the service layer (`SportsService.ingestSwimTimingSnapshot`) supplies
 * the roster rows and previous results, and persists what comes back.
 *
 * NO Prisma migration: this rides the existing `results` structured-stat
 * key exactly like the console's meet-results grid does. `sanitizeResults`
 * (already used by `updateStats`) is the final gate before persistence —
 * this module's job is only to produce a plausible pre-sanitize shape.
 */

import type { MeetResult, ResultEntry } from '@cms/api-types';
import type { SwimTimingSnapshot } from '@cms/scoreboard-cts';

/** Minimal roster shape this module needs — a subset of Prisma's
 *  `RosterPlayer` so this file has no Prisma dependency. The service
 *  layer maps its real rows down to this before calling in. */
export interface SwimRosterEntry {
  /** 'home' | 'away' — dual-meet side, or undefined for an unassigned /
   *  invitational entry (surfaced as neither, matching ResultEntry.team). */
  team?: 'home' | 'away' | null;
  name: string;
  /** Lane assignment for the CURRENT heat, if known. A roster entry with
   *  no lane set (not yet assigned, or belongs to a different heat) is
   *  never joined onto a lane it wasn't assigned to. */
  lane?: number | null;
}

/**
 * Build the event label the way every other meet-sport board in this
 * repo formats one ("EVENT 12 — HEAT 3"), so a SwimTimingFeed-produced
 * MeetResult reads identically to an operator-typed one. Heat 0 (not yet
 * reported by the console) omits the heat suffix rather than showing
 * "HEAT 0", which would read as real data.
 */
export function formatSwimEventLabel(eventNumber: number, heat: number): string {
  const evPart = eventNumber > 0 ? `EVENT ${eventNumber}` : 'EVENT';
  return heat > 0 ? `${evPart} — HEAT ${heat}` : evPart;
}

/**
 * Decide the display `mark` for one lane from its decoded timing state.
 * A real finish time from the timer wins; otherwise the mark is BLANK.
 *
 * The feed NEVER fabricates a "DQ" (2026-07-12 world-class audit P0). The
 * CTS timing console only knows lane TIMES — a disqualification is a
 * referee decision entered separately (the console lane pad's DQ/SCR
 * chips), and a lane that posts no time is simply empty / a no-show, not
 * disqualified. The old code painted a red "DQ" on any blank lane the
 * instant a heat *looked* over — so a 6-swimmer heat in an 8-lane pool
 * flashed DQs on the two genuinely-empty lanes mid-race. Blank stays
 * blank; a name-less blank row is then dropped downstream (readResults),
 * so empty lanes vanish instead of inventing a placeholder.
 */
export function laneMark(lane: { display: string; blank: boolean }): string {
  return lane.display || '';
}

/**
 * Normalize one decoded {@link SwimTimingSnapshot} into a single
 * {@link MeetResult} for the CURRENT event/heat, joining lane → roster
 * name/team when a roster entry claims that lane. Lanes with no roster
 * entry render lane + time only (name '') — report A7/A5: "if absent,
 * render lane+time only — never fabricate names." A lane with neither a
 * name nor a time is dropped downstream (readResults), so empty lanes
 * never show as a fabricated row.
 */
export function normalizeSwimSnapshot(
  snapshot: SwimTimingSnapshot,
  roster: SwimRosterEntry[] = [],
): MeetResult {
  const rosterByLane = new Map<number, SwimRosterEntry>();
  for (const r of roster) {
    if (typeof r.lane === 'number' && r.lane > 0 && !rosterByLane.has(r.lane)) {
      rosterByLane.set(r.lane, r);
    }
  }

  const lanes = Object.values(snapshot.lanes).sort((a, b) => a.lane - b.lane);
  const entries: ResultEntry[] = lanes.map((laneState) => {
    const rosterEntry = rosterByLane.get(laneState.lane);
    const entry: ResultEntry = {
      place: laneState.place,
      name: rosterEntry?.name ?? '',
      mark: laneMark(laneState),
      lane: laneState.lane,
    };
    if (rosterEntry?.team) entry.team = rosterEntry.team;
    return entry;
  });

  const eventNumber = snapshot.eventHeat?.eventNumber ?? 0;
  const heat = snapshot.eventHeat?.heat ?? 0;

  return {
    event: formatSwimEventLabel(eventNumber, heat),
    // `order` lets the board's pickEvent() find "the current heat" among
    // several tracked events on stats.results — a monotonically
    // increasing (event*100+heat) sorts later heats/events higher, which
    // matches "last heat is the fastest / most-current" (report A2).
    order: eventNumber * 100 + heat,
    entries,
  };
}

/**
 * Merge a freshly-normalized event/heat MeetResult into the game's
 * existing `results` array: replace the entry for the SAME (event
 * label) if present, else append. Caps at 64 entries (oldest dropped
 * first) — the same ceiling `sanitizeResults` enforces, applied here too
 * so a long meet's history doesn't silently grow past what persistence
 * will keep anyway.
 */
export function mergeSwimResult(existing: MeetResult[], fresh: MeetResult): MeetResult[] {
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
 * Extract the team-score MeetResult-adjacent view for a dual meet, if
 * the console reported one. VenueOS has no dedicated "team score" widget
 * field on MeetResult (it's a whole-meet running total, not a per-event
 * result), so this returns a plain object for the caller to fold into
 * whichever scalar stat keys the sport's team-score display already
 * uses (mirrors how ingestCtsSnapshot's water-polo path writes CTS
 * scores through to the operator score columns) rather than inventing a
 * new structured-stat shape.
 */
export function extractSwimTeamScore(
  snapshot: SwimTimingSnapshot,
): { homeScore: number; awayScore: number } | null {
  if (!snapshot.teamScore) return null;
  return { homeScore: snapshot.teamScore.homeScore, awayScore: snapshot.teamScore.awayScore };
}
