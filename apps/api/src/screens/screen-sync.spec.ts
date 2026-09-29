/**
 * The frame-lock resolution rule — "keep screens in sync", after it moved from
 * ScreenGroup.syncMode to Playlist.syncPlayback (2026-09-16).
 *
 * This is the one place the rule is decided, so these cases ARE the contract:
 * the manifest builder and both fleet lists call `resolveScreenSync` /
 * `isScreenSyncActive` and can never disagree with each other.
 *
 * 2026-09-29: the PLAYLIST is the only switch. A group still carrying the
 * legacy syncMode='locked' locks nothing — the operator could not clear that
 * flag (its UI was removed 09-16), so it kept screens synced after he turned the
 * playlist's sync off ("nothing changes").
 */

import {
  resolveScreenSync,
  isScreenSyncActive,
  readSyncActiveTargets,
  type SyncActiveTargets,
} from './screen-sync';

describe('resolveScreenSync — who is frame-locked, and why', () => {
  it('a playlist with sync on locks the screen playing it', () => {
    expect(resolveScreenSync({ scheduledPlaylistSync: [true] })).toEqual({
      enabled: true,
      source: 'playlist',
    });
  });

  it('nothing on ⇒ free-run, which is every playlist on the day this shipped', () => {
    expect(resolveScreenSync({ scheduledPlaylistSync: [false, false] })).toEqual({
      enabled: false,
      source: 'off',
    });
    // No group, no schedules at all — a paired screen with nothing assigned.
    expect(resolveScreenSync({})).toEqual({ enabled: false, source: 'off' });
  });

  // ── The playlist is the only switch (2026-09-29) ─────────────────────────
  it('a group still on the legacy locked flag does NOT lock its screens when no playlist asks for sync', () => {
    expect(
      resolveScreenSync({ groupSyncMode: 'locked', scheduledPlaylistSync: [false, false] }),
    ).toEqual({ enabled: false, source: 'off' });
    expect(resolveScreenSync({ groupSyncMode: 'locked' })).toEqual({ enabled: false, source: 'off' });
  });

  it("'off' and null group modes do not lock anything", () => {
    expect(resolveScreenSync({ groupSyncMode: 'off' }).enabled).toBe(false);
    expect(resolveScreenSync({ groupSyncMode: null }).enabled).toBe(false);
    // 'independent' appears in old fixtures and has never been a valid value;
    // anything that is not exactly 'locked' must read as off.
    expect(resolveScreenSync({ groupSyncMode: 'independent' }).enabled).toBe(false);
  });

  // ── ANY, not ALL ────────────────────────────────────────────────────────
  it('ANY sync-on playlist wins — a sync-off append row cannot veto it', () => {
    // The shape this protects: a video wall on a locked playlist, plus a
    // ticker appended to the same screens. "All" would mean adding the ticker
    // silently unlocks the wall.
    expect(resolveScreenSync({ scheduledPlaylistSync: [false, true, false] })).toEqual({
      enabled: true,
      source: 'playlist',
    });
  });

  it('a sync-on playlist locks a screen whatever its group says', () => {
    expect(
      resolveScreenSync({ groupSyncMode: 'locked', scheduledPlaylistSync: [true] }),
    ).toEqual({ enabled: true, source: 'playlist' });
  });

  it('nullish playlist flags count as off, never as unknown', () => {
    // A row read without the column (an older cached shape) must not lock a
    // wall by accident.
    expect(
      resolveScreenSync({ scheduledPlaylistSync: [null, undefined] }).enabled,
    ).toBe(false);
  });
});

describe('isScreenSyncActive — the fleet-list twin of the same rule', () => {
  const targets = (over: Partial<SyncActiveTargets> = {}): SyncActiveTargets => ({
    screenIds: new Set<string>(),
    groupIds: new Set<string>(),
    ...over,
  });

  it('a screen-pinned sync-on playlist locks exactly that screen', () => {
    const t = targets({ screenIds: new Set(['s1']) });
    expect(isScreenSyncActive({ id: 's1', screenGroupId: 'g1' }, t)).toBe(true);
    expect(isScreenSyncActive({ id: 's2', screenGroupId: 'g1' }, t)).toBe(false);
  });

  it('a group-targeted sync-on playlist locks every screen in that group', () => {
    const t = targets({ groupIds: new Set(['g1']) });
    expect(isScreenSyncActive({ id: 's1', screenGroupId: 'g1' }, t)).toBe(true);
    expect(isScreenSyncActive({ id: 's9', screenGroupId: 'g2' }, t)).toBe(false);
    expect(isScreenSyncActive({ id: 's9', screenGroupId: null }, t)).toBe(false);
  });

  it('an UNGROUPED screen can be locked by its own playlist — the group flag never could', () => {
    const t = targets({ screenIds: new Set(['solo']) });
    expect(isScreenSyncActive({ id: 'solo', screenGroupId: null }, t)).toBe(true);
  });

  it('a legacy locked group locks none of its screens when no sync-on playlist reaches them', () => {
    expect(
      isScreenSyncActive({ id: 's1', screenGroupId: 'g1', groupSyncMode: 'locked' }, targets()),
    ).toBe(false);
  });

  it('a group can now be PART synced — the shape the group flag could not express', () => {
    // Greg's case: one group, different playlists. Only the screens playing
    // the sync-on playlist are locked.
    const t = targets({ screenIds: new Set(['menu-left', 'menu-right']) });
    expect(isScreenSyncActive({ id: 'menu-left', screenGroupId: 'boards' }, t)).toBe(true);
    expect(isScreenSyncActive({ id: 'menu-right', screenGroupId: 'boards' }, t)).toBe(true);
    expect(isScreenSyncActive({ id: 'promo', screenGroupId: 'boards' }, t)).toBe(false);
  });
});

describe('readSyncActiveTargets — one query, and it never throws', () => {
  it('splits screen-pinned from group-targeted schedules', async () => {
    const findMany = jest.fn(async () => [
      { screenId: 's1', screenGroupId: null },
      { screenId: null, screenGroupId: 'g1' },
      { screenId: null, screenGroupId: 'g1' },
    ]);
    const out = await readSyncActiveTargets(
      { client: { schedule: { findMany } } } as any,
      'tenant-1',
    );
    expect([...out.screenIds]).toEqual(['s1']);
    expect([...out.groupIds]).toEqual(['g1']);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('asks only for LIVE schedules of sync-on playlists, in this tenant', async () => {
    const findMany = jest.fn(async () => []);
    const now = new Date('2026-09-16T12:00:00.000Z');
    await readSyncActiveTargets({ client: { schedule: { findMany } } } as any, 'tenant-1', now);
    const where = (findMany.mock.calls[0][0] as any).where;
    expect(where.tenantId).toBe('tenant-1');
    expect(where.isActive).toBe(true);
    expect(where.playlist).toEqual({ syncPlayback: true });
    // Same window the manifest's own schedule query uses: started, not ended.
    expect(where.startTime).toEqual({ lte: now });
    expect(where.OR).toEqual([{ endTime: { gte: now } }, { endTime: null }]);
  });

  it('a read failure degrades to "no playlist targets", never an exception', async () => {
    // A fleet list must still render; it then shows no screen as locked.
    const findMany = jest.fn(async () => {
      throw new Error('pooler blip');
    });
    const out = await readSyncActiveTargets(
      { client: { schedule: { findMany } } } as any,
      'tenant-1',
    );
    expect(out.screenIds.size).toBe(0);
    expect(out.groupIds.size).toBe(0);
  });
});
