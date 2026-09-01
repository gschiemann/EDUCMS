/**
 * Is a Schedule row provably eligible RIGHT NOW, from data the server can
 * actually trust? (2026-09-01, Codex truth-contract audit.)
 *
 * The bug this closes: three independent call sites (assets/templates usage
 * builders, and the Playlists library summary) each grew their own "is this
 * schedule active now" check, and every one of them compared the CURRENT
 * TIME against `timeStart`/`timeEnd` using the SERVER's clock in UTC. That
 * is wrong by construction, not just imprecise: `Schedule.timeStart`/
 * `timeEnd` are wall-clock strings meant for the SCREEN's own local time —
 * screens.controller.ts's manifest resolver says so explicitly ("Fine-
 * grained daysOfWeek/timeStart windows are evaluated player-side") — and no
 * Tenant or Screen row carries a timezone to reproduce that server-side (the
 * one model in this schema that DOES need real time-of-day math, the menu
 * daypart windows, had to add its own explicit IANA `timezone` column for
 * exactly this reason — there is no ambient "the tenant's timezone" to fall
 * back on). An 8–10am template compared against UTC can read LIVE at 10pm
 * for a US tenant, in either direction depending on the offset.
 *
 * The fix is NOT to guess a timezone. It is to admit what the server can and
 * cannot know:
 *   - the schedule's DATE range (`startTime`/`endTime`) is a real `DateTime`
 *     — comparing it to `now` is exact, no timezone involved.
 *   - `daysOfWeek` is evaluated in UTC. A same-day boundary mismatch near
 *     midnight is the plausible failure mode here — far short of "reads
 *     LIVE twelve hours off" — and matches the precision every other
 *     day-of-week check in this codebase already uses.
 *   - an explicit `timeStart`/`timeEnd` HOUR-level window cannot be
 *     evaluated without the screen's actual local clock. Its presence make
 *     "is it in-window right now" UNKNOWABLE server-side, so this fails
 *     CLOSED: such a schedule is never claimed as active-now. It still
 *     counts as SCHEDULED — the platform knows the content is destined for
 *     those screens, just not provably this instant.
 */
export interface EligibilityInput {
  startTime: Date;
  endTime: Date | null;
  daysOfWeek: string | null;
  timeStart: string | null;
  timeEnd: string | null;
}

export type ScheduleEligibility =
  /** Date range covers now, day matches (or is unrestricted), and there is
   *  no hour-level window to make "now" unverifiable. */
  | 'active'
  /** A real, provable reason this is not active now. */
  | 'future'
  | 'expired'
  | 'day-mismatch'
  /** In its date+day window, but an hour-level window exists that the
   *  server has no reliable clock basis to evaluate. Not a claim either
   *  way — never treat this as "active", never treat it as "inactive". */
  | 'time-unverifiable';

const UTC_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function evaluateScheduleEligibility(
  schedule: EligibilityInput,
  now: Date,
): ScheduleEligibility {
  if (schedule.startTime > now) return 'future';
  if (schedule.endTime && schedule.endTime < now) return 'expired';

  const days = (schedule.daysOfWeek ?? '').trim().toLowerCase();
  if (days) {
    const utcDay = UTC_DAYS[now.getUTCDay()];
    if (!days.includes(utcDay)) return 'day-mismatch';
  }

  if (schedule.timeStart && schedule.timeEnd) return 'time-unverifiable';
  return 'active';
}

/** Convenience: does this evaluate to the one state that may be counted as
 *  "on right now"? Everything else — including `time-unverifiable` — is
 *  deliberately NOT active-now; see the module doc for why. */
export function isEligibleNow(schedule: EligibilityInput, now: Date): boolean {
  return evaluateScheduleEligibility(schedule, now) === 'active';
}
