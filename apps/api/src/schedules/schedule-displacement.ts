/**
 * GO-LIVE DISPLACEMENT — shared helper (extracted 2026-07-03).
 *
 * When a schedule goes LIVE in replace-mode, it must displace every OTHER
 * active schedule competing for the same target so the new one cleanly wins.
 * "Competing" = an active schedule that resolves onto the same screen(s):
 *
 *   - per-screen publish  → deactivate active rows pinned to that screenId.
 *   - group publish       → deactivate active rows on that screenGroupId AND
 *                           the per-screen pins on every MEMBER screen of the
 *                           group (the "publish reaches only 1 of N posters"
 *                           fix, 2026-06-26 — the single group schedule must
 *                           supersede stale member pins, or the manifest
 *                           returns both and each poster keeps its own pin).
 *
 * WHY THIS FILE EXISTS: the logic originally lived inline in
 * schedules.controller.ts `create()`, so it protected only the direct
 * publish path. The submit-for-review APPROVAL path
 * (submissions.controller.ts `decide()`) flips a staged DRAFT schedule to
 * active without going through create() — a second door to go-live that
 * silently bypassed this displacement. Result: approving a draft for
 * playlist B on a screen already showing playlist A (via an admin's live
 * schedule) left BOTH active, and the player interleaved A and B instead of
 * B replacing A. Any code path that flips a schedule to isActive=true MUST
 * run this helper first (inside its own transaction).
 *
 * Contract (matches create()'s original inline behavior EXACTLY):
 *  - Same-tenant only — never deactivate across tenants.
 *  - Replace-mode only: an APPEND-mode go-live deliberately does NOT displace
 *    (multiple playlists intentionally coexist on the target). Callers must
 *    skip this helper for append.
 *  - Only touches active rows OTHER than the one going live (excludeScheduleId).
 *  - Idempotent: no competing actives → deactivates nothing.
 *  - Runs inside the caller's transaction (`tx`) so the displacement + the
 *    go-live commit atomically.
 *
 * `tx` is any Prisma-client-like object exposing `schedule.findMany` and
 * `schedule.updateMany` (the real client, or a `$transaction` tx handle).
 *
 * Returns the number of rows deactivated.
 */
import { shouldDisplace, type WindowFields } from './schedule-window-overlap';

export async function displaceCompetingActiveSchedules(
  tx: any,
  opts: {
    tenantId: string;
    screenId: string | null;
    screenGroupId: string | null;
    /** The row about to go live (or already live) — never deactivate it. */
    excludeScheduleId?: string | null;
    /**
     * The window the incoming rule will occupy (2026-09-16). When supplied,
     * only rows whose window OVERLAPS it are stood down — breakfast beside
     * lunch on one screen is the SUPPORTED setup, not a clash. The fallback
     * tier (always-on at a negative priority) is exempt in both directions.
     *
     * OMITTED keeps the pre-2026-09-16 behaviour EXACTLY (displace every
     * competing active), which is what both existing displacement specs and
     * the 2026-06-26 group-supersession fix rely on.
     */
    incoming?: (WindowFields & { priority?: number | null }) | null;
  },
): Promise<number> {
  const { tenantId, screenId, screenGroupId, excludeScheduleId, incoming } = opts;

  // Build the same OR set create() built: the target's own pin/group, plus —
  // for a group target — the per-screen pins on every member screen.
  const replaceOr: any[] = [];
  if (screenId) replaceOr.push({ screenId });
  if (screenGroupId) {
    replaceOr.push({ screenGroupId });
    const memberScreens = await tx.screen.findMany({
      where: { tenantId, screenGroupId },
      select: { id: true },
    });
    const memberIds = memberScreens.map((m: { id: string }) => m.id);
    if (memberIds.length) replaceOr.push({ screenId: { in: memberIds } });
  }

  if (!replaceOr.length) return 0;

  const where: any = { tenantId, isActive: true, OR: replaceOr };
  // Never deactivate the row that IS going live (approval path: the draft is
  // still isActive=false at this point, so it can't match `isActive:true`
  // anyway — but exclude it defensively so re-ordering the flip is safe).
  if (excludeScheduleId) where.id = { not: excludeScheduleId };

  // WINDOW-AWARE PATH (2026-09-16). Only taken when the caller told us what
  // window is going live; without it the behaviour below is byte-identical to
  // what shipped before, so no existing caller changes.
  //
  // The comparison cannot be expressed in this `where` (day-set intersection is
  // not SQL here), so the candidates are read and filtered in memory. That is
  // one indexed read on an already-narrow target set, on a publish path that
  // runs once per operator click — not a hot path.
  if (incoming) {
    const candidates = await tx.schedule.findMany({
      where,
      select: {
        id: true, daysOfWeek: true, timeStart: true, timeEnd: true, priority: true,
      },
    });
    const doomed = (candidates ?? [])
      .filter((c: any) => shouldDisplace(c, incoming))
      .map((c: any) => c.id);
    if (!doomed.length) return 0;
    const res = await tx.schedule.updateMany({
      where: { id: { in: doomed } },
      data: { isActive: false },
    });
    return res?.count ?? 0;
  }

  const res = await tx.schedule.updateMany({ where, data: { isActive: false } });
  return res?.count ?? 0;
}
