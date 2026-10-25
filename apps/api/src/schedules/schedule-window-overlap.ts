/**
 * DO TWO SCHEDULES WANT THE SAME SCREEN AT THE SAME MOMENT? (2026-09-16)
 *
 * Greg stated the rule during a live test:
 *
 *   "you cant have a screen active in two playlist at the same time unless its
 *    scheduled...example, i could have a playlist for breakfast, another for
 *    lunch, and another for dinner with different schedules but they cant be on
 *    at the same time"
 *
 * Sharing a screen is NOT a conflict. Sharing a screen AT THE SAME TIME is.
 *
 * WHY THIS FILE EXISTS. The identical rule already lives on the web side
 * (`apps/web/src/components/playlists/v1/playlistOps.ts` `windowsCollide`,
 * unit-tested, and the basis of the four-door conflict warning shipped in
 * a2f19eee). The SERVER did not have it, so displacement deactivated every
 * competing active row regardless of hours: publish breakfast, then lunch, then
 * dinner and you got three clean publishes, ZERO warnings — because the client
 * guard correctly stayed silent — and ONE surviving rule. The UI promised "these
 * do not collide" and the backend broke that promise seconds later. Silent wrong
 * is worse than over-warning.
 *
 * Web and API cannot share a module across the app boundary, so this is a
 * deliberate port. The semantics are byte-for-byte identical and a drift here
 * re-opens the same hole, so any change must be made in BOTH files.
 */

export interface WindowFields {
  daysOfWeek?: string | null;
  timeStart?: string | null;
  timeEnd?: string | null;
}

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const toMin = (hhmm: string | null | undefined, fallback: number): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
};

/**
 * An empty/absent daysOfWeek means EVERY day — never "no days". This matches
 * `schedule-window-validation.ts`'s documented reading ("null / omitted → NO
 * day-of-week restriction. Matches every day."), and the genuinely broken
 * zero-day case is rejected at the API boundary before it can reach here.
 */
const daysOf = (d: string | null | undefined): string[] =>
  !d ? ALL_DAYS : d.split(',').map((x) => x.trim()).filter(Boolean);

/**
 * Do two windows land on the same day at the same time?
 *
 * An empty daysOfWeek means EVERY day and an empty time means ALL day — so
 * "Always" collides with everything, which is the case worth getting right:
 * treating a missing field as "no constraint" rather than "no overlap" is what
 * would let a second always-on rule slip in beside the first.
 *
 * Touching edges do not collide: 08:00–12:00 and 12:00–17:00 are back to back.
 */
export function windowsCollide(a: WindowFields, b: WindowFields): boolean {
  const da = daysOf(a.daysOfWeek);
  const db = daysOf(b.daysOfWeek);
  if (!da.some((d) => db.includes(d))) return false;
  const as = toMin(a.timeStart, 0), ae = toMin(a.timeEnd, 24 * 60);
  const bs = toMin(b.timeStart, 0), be = toMin(b.timeEnd, 24 * 60);
  return as < be && bs < ae;
}

/** True when this window places no restriction at all — on 24/7. */
export function isAlwaysOn(w: WindowFields): boolean {
  return !w.daysOfWeek && !w.timeStart && !w.timeEnd;
}

/**
 * THE FALLBACK TIER — "base playlist", in the industry's words.
 *
 * Greg, arriving at it himself: "It's almost like every playlist needs and
 * always active schedule and if nothing assigned it goes to our splash screen".
 * That is exactly what every Model-A vendor ships: Yodeck "Default/Filler
 * Content", Xibo "Default Layout", Play Digital Signage "base playlist",
 * PiSignage "Default playlist". Five independent sources call a missing
 * fallback the single most common cause of a blank screen.
 *
 * It needs NO new column. A rule that is ALWAYS-ON and carries a NEGATIVE
 * priority is the fallback: `orderSchedulesForManifest` already sorts
 * `priority desc`, so it rides last among the replace rows, and the player
 * already picks the FIRST WINDOW-OPEN replace row — so a daypart wins while its
 * window is open and the fallback fills every gap. Nothing scheduled at all
 * still lands on the paired splash, which is the honest last resort.
 *
 * Nothing in the codebase treated a negative priority specially before this, so
 * the convention is free and cannot collide with existing data (every publish
 * door writes `priority: 0`).
 *
 * The tier is EXEMPT from displacement in both directions — it is the safety
 * net, so a daypart publish must never remove it, and publishing it must never
 * remove the content it is a net for.
 */
export const FALLBACK_PRIORITY = -1;

export function isFallbackRule(
  s: WindowFields & { priority?: number | null },
): boolean {
  return (s.priority ?? 0) < 0 && isAlwaysOn(s);
}

/**
 * DOES A RULE COVER ONLY PART OF THE TIME? (2026-10-24, launch QA U15)
 *
 * True for a day/time window (Mon–Fri 08:00–15:00), for an end date (the rule
 * stops by itself) and for a start that is still ahead (it has not begun).
 * The manifest only carries a rule inside its dates, and the player only plays
 * it inside its window — so outside those hours a screen whose ONLY rule is
 * this one shows nothing at all.
 *
 * `startTime` gets a minute of slack: a publish that means "now" is stamped by
 * the browser a few hundred milliseconds before the server reads it, and a
 * browser clock a little ahead must not read as "starts later".
 *
 * The web side keeps a byte-for-byte port (`playlistOps.ts` `isTimeLimited`) —
 * the conflict prompt must describe exactly what this server will do.
 */
export const START_SLACK_MS = 60_000;

export function isTimeLimited(
  rule: WindowFields & { startTime?: Date | string | null; endTime?: Date | string | null },
  nowMs: number = Date.now(),
): boolean {
  if (!isAlwaysOn(rule)) return true;
  if (rule.endTime != null && rule.endTime !== '') return true;
  if (rule.startTime == null || rule.startTime === '') return false;
  const start = new Date(rule.startTime).getTime();
  return Number.isFinite(start) && start > nowMs + START_SLACK_MS;
}

/**
 * KEEP THE ALWAYS-ON PLAYLIST AS THE FALLBACK (2026-10-24, launch QA U15).
 *
 * The owner's rule: publishing a time-limited playlist (school hours, Mon–Fri
 * 08:00–15:00) onto a screen that runs an always-on one must NOT switch the
 * always-on one off. It stays, as the fallback outside the new playlist's
 * hours, so the screen is never blank evenings and weekends. Only an explicit
 * "Replace everything" removes it.
 *
 * Kept = demoted to FALLBACK_PRIORITY, which is exactly the base-playlist tier
 * this file already defines: displacement exempts it, and the manifest ranks
 * it after every other replace rule (effective-schedule.ts), so the new
 * playlist wins inside its window and the old one fills every gap.
 *
 * A candidate qualifies only when the incoming rule is time-limited, the
 * candidate is ALWAYS-ON (no day/time window), replace-mode, and not already
 * the fallback. The caller excludes the incoming playlist's own rules — a
 * playlist narrowed to a window must not keep its own old all-day rule.
 */
export function keepsAsFallback(
  candidate: WindowFields & { priority?: number | null; mode?: string | null },
  incoming: WindowFields & { startTime?: Date | string | null; endTime?: Date | string | null; priority?: number | null },
  nowMs: number = Date.now(),
): boolean {
  if ((candidate.mode ?? 'replace') === 'append') return false;
  if (isFallbackRule(incoming)) return false;
  if (!isTimeLimited(incoming, nowMs)) return false;
  return isAlwaysOn(candidate) && !isFallbackRule(candidate);
}

/**
 * Should `candidate` (an existing ACTIVE row) be stood down to make room for
 * `incoming`?
 *
 * - The fallback tier is never displaced, and never displaces.
 * - Otherwise: only when the two windows actually overlap.
 * - `incoming` omitted (undefined) keeps the pre-2026-09-16 behaviour EXACTLY —
 *   displace everything — because both existing displacement specs call the
 *   helper without a window and the 2026-06-26 "publish reaches only 1 of N
 *   posters" group-supersession fix depends on that.
 */
export function shouldDisplace(
  candidate: WindowFields & { priority?: number | null },
  incoming?: (WindowFields & { priority?: number | null }) | null,
): boolean {
  if (!incoming) return true;
  if (isFallbackRule(candidate)) return false;
  if (isFallbackRule(incoming)) return false;
  return windowsCollide(incoming, candidate);
}
