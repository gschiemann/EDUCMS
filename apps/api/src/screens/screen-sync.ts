/**
 * Who is frame-locked, and why — the ONE rule every surface answers with.
 *
 * 2026-09-16. "Keep screens in sync" used to be `ScreenGroup.syncMode`. The
 * operator's objection was structural, not cosmetic: "if i have different
 * playlists assigned to screens in the same group it doesnt make sense saying
 * to keep them in sync". Two of the three locked groups in production carry
 * several DIFFERENT playlists across their screens, so a group-level flag was
 * a claim about a filing cabinet. Frame-lock is a property of the CONTENT an
 * operator wants mirrored, so it now lives on `Playlist.syncPlayback`.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────
 *
 *   enabled = ANY playlist scheduled onto this screen right now has
 *             syncPlayback === true
 *          OR this screen's group still carries the legacy syncMode='locked'
 *
 * Two decisions worth stating out loud, because both are load-bearing:
 *
 * 1. **ANY, not ALL.** An operator turns sync on for the playlist they want
 *    mirrored. A sync-off APPEND row (a ticker, a house ad) must not veto it —
 *    "all" would mean adding a ticker silently unlocks a video wall. The
 *    server cannot do better than a rule over the candidate set: which
 *    playlist is showing at this instant is decided ON THE DEVICE, against
 *    its own clock, from the day/time windows in the manifest
 *    (screens.controller `applyManifest` selection). A per-playlist decision
 *    would be a PLAYER change, and every already-deployed bundle would ignore
 *    it — see docs/research/2026-09-15-sync-to-playlists/01-SYNC-CODE-MAP.md §3.
 *
 * 2. **The legacy group arm is an OR, and it is why this deploy is safe.**
 *    A group sitting at syncMode='locked' keeps `enabled: true` on its very
 *    next poll with NO migration run, no backfill, no data touched. The data
 *    move (02-DATA-MIGRATION.md) is a cleanup that moves INTENT; correctness
 *    never depended on it having happened. The group value is read-only now —
 *    the UI that could set it is gone — so this arm can only ever shrink.
 *
 * The manifest block this feeds stays `{enabled, groupId, trimMs}`, so no
 * player changes and the frame-lock invariant is untouched: while sync is
 * active, what is on screen is still a pure function of (manifest, syncedNow).
 * It is part of the ETag-hashed payload, and it carries no clock field.
 */

/** Where a screen's frame-lock came from. Surfaced for logs + tests, never to the player. */
export type SyncSource = 'playlist' | 'group-legacy' | 'off';

export interface ScreenSyncResolution {
  enabled: boolean;
  source: SyncSource;
}

export interface ScreenSyncInputs {
  /** `ScreenGroup.syncMode` for this screen's group; null/absent when it has none. */
  groupSyncMode?: string | null;
  /**
   * `Playlist.syncPlayback` for EVERY playlist scheduled onto this screen in
   * the window the caller resolved. Order is irrelevant; nullish entries (an
   * older row, a playlist read without the column) count as OFF.
   */
  scheduledPlaylistSync?: ReadonlyArray<boolean | null | undefined>;
}

/**
 * Pure. No Prisma, no clock, no I/O — the manifest builder and the dashboard
 * list both call this so they can never disagree about who is locked.
 */
export function resolveScreenSync(inputs: ScreenSyncInputs): ScreenSyncResolution {
  const byPlaylist = (inputs.scheduledPlaylistSync ?? []).some((on) => on === true);
  if (byPlaylist) return { enabled: true, source: 'playlist' };
  // LEGACY FALLBACK — see the header. Read-only: no surface writes syncMode.
  if ((inputs.groupSyncMode ?? null) === 'locked') return { enabled: true, source: 'group-legacy' };
  return { enabled: false, source: 'off' };
}

/**
 * The screens and groups a tenant's sync-on playlists currently reach.
 *
 * ONE query for a whole fleet list, never one per row (§26). The dashboard
 * needs this because the trim control and the calibration wizard used to gate
 * on `syncMode === 'locked'`; with the group toggle retired they gate on
 * whether the screen is ACTUALLY frame-locked, which is this.
 */
export interface SyncActiveTargets {
  /** Screen ids reached by a screen-pinned schedule of a sync-on playlist. */
  screenIds: Set<string>;
  /** Group ids reached by a group-targeted schedule of a sync-on playlist. */
  groupIds: Set<string>;
}

export const EMPTY_SYNC_TARGETS: SyncActiveTargets = {
  screenIds: new Set<string>(),
  groupIds: new Set<string>(),
};

interface ScheduleReader {
  client: {
    schedule: {
      findMany: (args: unknown) => Promise<Array<{ screenId?: string | null; screenGroupId?: string | null }>>;
    };
  };
}

/**
 * Reads the sync-on schedule targets for one tenant.
 *
 * The window matches the manifest's own schedule query exactly (active,
 * started, not ended) so the dashboard cannot claim frame-lock for a campaign
 * that has already expired. Fine-grained daysOfWeek/timeStart windows are
 * deliberately NOT applied — they are evaluated on the device, and a control
 * that appears an hour before the window opens is far better than one that
 * vanishes from under an operator mid-calibration.
 *
 * NEVER THROWS. A fleet list must render even if this read blips; the caller
 * then falls back to the legacy group arm alone, which is the pre-change
 * behaviour.
 */
export async function readSyncActiveTargets(
  prisma: ScheduleReader,
  tenantId: string,
  now: Date = new Date(),
): Promise<SyncActiveTargets> {
  try {
    const rows = await prisma.client.schedule.findMany({
      where: {
        tenantId,
        isActive: true,
        startTime: { lte: now },
        OR: [{ endTime: { gte: now } }, { endTime: null }],
        playlist: { syncPlayback: true },
      },
      select: { screenId: true, screenGroupId: true },
    });
    const screenIds = new Set<string>();
    const groupIds = new Set<string>();
    for (const r of rows) {
      if (r.screenId) screenIds.add(r.screenId);
      if (r.screenGroupId) groupIds.add(r.screenGroupId);
    }
    return { screenIds, groupIds };
  } catch {
    return { screenIds: new Set<string>(), groupIds: new Set<string>() };
  }
}

/** Is THIS screen frame-locked right now? The list-side twin of `resolveScreenSync`. */
export function isScreenSyncActive(
  screen: { id: string; screenGroupId?: string | null; groupSyncMode?: string | null },
  targets: SyncActiveTargets,
): boolean {
  const reachedByPlaylist =
    targets.screenIds.has(screen.id) ||
    (!!screen.screenGroupId && targets.groupIds.has(screen.screenGroupId));
  return resolveScreenSync({
    groupSyncMode: screen.groupSyncMode ?? null,
    scheduledPlaylistSync: [reachedByPlaylist],
  }).enabled;
}
