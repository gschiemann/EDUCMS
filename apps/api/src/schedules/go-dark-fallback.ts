/**
 * CC-2 go-dark fallback — shared helper (extracted 2026-07-01, launch-sprint
 * Day 1 P0-1).
 *
 * A screen must NEVER silently go dark. When the last ACTIVE schedule for a
 * target (screen or group) is removed/deactivated, promote the best inactive
 * candidate for the SAME target and write a SCHEDULE_AUTO_REACTIVATED audit
 * row.
 *
 * WHY THIS FILE EXISTS: the logic originally lived as a private method on
 * SchedulesController, so it protected only that controller's own mutation
 * routes. Deleting a PLAYLIST hard-deletes every schedule referencing it
 * (playlists.controller.ts) — a second door into the exact same go-dark
 * failure that silently bypassed the fallback. Any code path that removes or
 * deactivates schedules MUST call this helper inside its own transaction.
 *
 * Contract (unchanged from the original private method):
 *  - Exact-target semantics: a per-screen schedule matches rows with the
 *    same screenId AND screenGroupId IS NULL (and vice-versa for groups) —
 *    we restore like-for-like.
 *  - Idempotent: if an active schedule still covers the target, does nothing.
 *  - No candidate → returns null (target is genuinely empty; manifest-side
 *    defaults take over).
 *  - Runs inside the caller's transaction (`tx`) so the removal and the
 *    fallback commit atomically — a screen is never momentarily dark
 *    between the two writes.
 *
 * Returns the id of the schedule it re-activated, or null.
 */
export async function reactivateFallbackIfDark(
  tx: any,
  opts: {
    tenantId: string;
    userId: string | null;
    screenId: string | null;
    screenGroupId: string | null;
    removedScheduleId: string;
    /**
     * 2026-09-19 — never promote a rule of THIS playlist. The per-screen
     * "stop this playlist on screen S" door switches off EVERY rule the
     * playlist has on S (a breakfast window and a dinner window are two rows),
     * and `removedScheduleId` can only exclude one of them — so without this
     * the fallback re-activated the sibling window and the click did nothing.
     * Optional and additive: omitted, the candidate query is byte-identical.
     */
    excludePlaylistId?: string;
  },
): Promise<string | null> {
  const { tenantId, userId, screenId, screenGroupId, removedScheduleId, excludePlaylistId } = opts;

  // A schedule targets exactly ONE thing. Build the exact-target match —
  // null means "match the rows whose column IS NULL", which is correct
  // here: a per-screen schedule has screenGroupId=null, a group schedule
  // has screenId=null. We restore like-for-like.
  const targetWhere: { screenId: string | null; screenGroupId: string | null } = screenId
    ? { screenId, screenGroupId: null }
    : { screenId: null, screenGroupId: screenGroupId };

  // Nothing to do if the removed schedule had no target at all (shouldn't
  // happen — create() requires one — but be defensive).
  if (!screenId && !screenGroupId) return null;

  // Is the target still covered by an active schedule? If so, leave it be.
  const stillActive = await tx.schedule.findFirst({
    where: { tenantId, isActive: true, ...targetWhere },
    select: { id: true },
  });
  if (stillActive) return null;

  // Find the best inactive candidate for the SAME target to promote.
  // priority DESC, then most-recent startTime DESC (no updatedAt column).
  const candidate = await tx.schedule.findFirst({
    where: {
      tenantId,
      isActive: false,
      id: { not: removedScheduleId },
      ...(excludePlaylistId ? { playlistId: { not: excludePlaylistId } } : {}),
      ...targetWhere,
    },
    orderBy: [{ priority: 'desc' }, { startTime: 'desc' }],
    select: { id: true, playlistId: true, screenId: true, screenGroupId: true, priority: true },
  });
  if (!candidate) return null;

  await tx.schedule.update({
    where: { id: candidate.id, tenantId },
    data: { isActive: true },
  });

  await tx.auditLog.create({
    data: {
      tenantId,
      userId,
      action: 'SCHEDULE_AUTO_REACTIVATED',
      targetType: 'Schedule',
      targetId: candidate.id,
      details: JSON.stringify({
        reason: 'prevent_screen_blank',
        removedScheduleId,
        playlistId: candidate.playlistId,
        screenId: candidate.screenId,
        screenGroupId: candidate.screenGroupId,
        priority: candidate.priority,
      }),
    },
  });

  return candidate.id;
}
