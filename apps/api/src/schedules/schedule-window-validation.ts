import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * P5 (2026-08-25 audit) — REJECT a schedule whose day-of-week window
 * provably can never be reached, at the same API boundary every other
 * schedule business rule already lives in (schedules.controller.ts).
 *
 * BACKGROUND. The `Schedule` model's `daysOfWeek` column
 * (packages/database/prisma/schema.prisma: `daysOfWeek String? @map("days_of_week")`)
 * is a comma-joined day-abbreviation STRING ("Mon,Tue,Wed"), NOT an array —
 * apps/web's builder keeps the selection as an array client-side and only
 * `.join(',')`s it into this shape on submit
 * (apps/web/src/app/[schoolId]/playlists/page.tsx). Three states matter:
 *
 *   - null / omitted   → NO day-of-week restriction. Matches every day.
 *                         This is "always-on" and MUST keep working exactly
 *                         as today — never touched by this guard.
 *   - non-empty string → restricted to those days ("Mon,Wed,Fri").
 *   - '' (explicitly)  → the operator entered "day/time window" mode and
 *                         picked ZERO days. `[].join(',') === ''`.
 *
 * P7 (apps/web/src/lib/blast-radius.ts `reachWarnings`, live-test finding)
 * already blocks the third state client-side — "windowed" (the operator
 * chose a day/time window rather than always-on) with zero days picked is
 * a schedule that runs zero days, and it used to sail through with a
 * message reading "This will not appear on any screen." This module is the
 * SAME rule enforced at the API boundary, because `POST /schedules` (and
 * any update path) is reachable directly — the HQ fleet endpoint, imports,
 * and raw API clients all bypass the UI gate entirely (P5).
 *
 * "windowed" here = the schedule carries a same-day clock-time restriction
 * (timeStart and/or timeEnd explicitly set) — matching the rejection
 * message's own wording ("it has a time window"). A bare `daysOfWeek: ''`
 * with NO time window at all is deliberately NOT rejected: today,
 * create()/update() already fold it into `null` via `body.daysOfWeek ||
 * null` (the exact same truthy idiom the player uses on the analogous
 * PlaylistItem fields — `if (item.daysOfWeek)`,
 * apps/web/src/app/player/page.tsx), so on its own it is functionally "no
 * restriction," not "never runs." Rejecting it would block a state that
 * isn't provably broken, which the standing instruction (only reject what
 * is PROVABLY never-runs) rules out.
 *
 * NOT rejected, deliberately: `timeStart === timeEnd`. The one other
 * degenerate combo worth considering, but the codebase's own day/time
 * window evaluation (apps/web player `isItemValid`,
 * `currentMins < startMins || currentMins > endMins`, both comparisons
 * strict) is INCLUSIVE at both ends, so a zero-width window still matches
 * during that exact minute once a day — not provably never-runs, so left
 * alone.
 *
 * NOTE for future readers: as of this writing, the SCHEDULE-level
 * daysOfWeek/timeStart/timeEnd (as opposed to the PlaylistItem-level
 * fields the player's isItemValid actually enforces) are surfaced to the
 * player ONLY for the operator-facing "Stopped splash" summary
 * (`setManifestPlaylists` in apps/web/src/app/player/page.tsx) — they are
 * not currently used to gate which playlist's items get combined for
 * playback. That is a separate, pre-existing gap in manifest/player code
 * (out of scope here — see CLAUDE.md's "DO NOT touch manifest/cache code
 * / apps/web" boundary for this change) and does not change the case for
 * this guard: the rejected combination is nonsense input regardless of
 * whether it is enforced downstream today, and blocking it now is cheap
 * insurance against silently-broken data if/when that enforcement gap is
 * closed.
 */

export const SCHEDULE_ZERO_DAYS_WINDOWED_CODE = 'SCHEDULE_ZERO_DAYS_WINDOWED';
export const SCHEDULE_ZERO_DAYS_WINDOWED_MESSAGE =
  'This schedule would never run — it has a time window but no days selected. Pick at least one day or remove the window.';

export interface ScheduleWindowFields {
  /**
   * For create(): the raw, pre-`|| null`-coalesced value exactly as the
   * caller sent it. For update(): the EFFECTIVE post-write value — see
   * `resolveEffectiveScheduleWindow`.
   */
  daysOfWeek: string | null | undefined;
  timeStart: string | null | undefined;
  timeEnd: string | null | undefined;
}

/**
 * True only for the provably-never-runs combination: a real time window
 * (timeStart and/or timeEnd set) paired with an EXPLICITLY empty (not
 * null, not omitted) daysOfWeek.
 */
export function isZeroDayWindowedSchedule(
  fields: ScheduleWindowFields,
): boolean {
  const daysExplicitlyEmpty = fields.daysOfWeek === '';
  const hasTimeWindow = !!fields.timeStart || !!fields.timeEnd;
  return daysExplicitlyEmpty && hasTimeWindow;
}

/**
 * Throws the standard 400 when `fields` describes a zero-day windowed
 * schedule. No-op otherwise — including the ordinary null/omitted
 * "always-on" case, which must keep working exactly as today.
 */
export function assertScheduleWindowIsReachable(
  fields: ScheduleWindowFields,
): void {
  if (isZeroDayWindowedSchedule(fields)) {
    throw new HttpException(
      {
        code: SCHEDULE_ZERO_DAYS_WINDOWED_CODE,
        message: SCHEDULE_ZERO_DAYS_WINDOWED_MESSAGE,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Merge a PUT body against the existing row to get the state the write
 * would actually PRODUCE. A PUT that only sends `timeStart` must still be
 * checked against whatever `daysOfWeek` is already on the row (and vice
 * versa) — otherwise a two-step edit (clear the days in one PUT; the time
 * window was already there from an earlier PUT) sails through unchecked.
 */
export function resolveEffectiveScheduleWindow(
  body: {
    daysOfWeek?: string | null;
    timeStart?: string | null;
    timeEnd?: string | null;
  },
  existing: {
    daysOfWeek: string | null;
    timeStart: string | null;
    timeEnd: string | null;
  },
): ScheduleWindowFields {
  return {
    daysOfWeek:
      body.daysOfWeek !== undefined ? body.daysOfWeek : existing.daysOfWeek,
    timeStart:
      body.timeStart !== undefined ? body.timeStart : existing.timeStart,
    timeEnd: body.timeEnd !== undefined ? body.timeEnd : existing.timeEnd,
  };
}
