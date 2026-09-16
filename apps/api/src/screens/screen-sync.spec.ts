/**
 * The frame-lock resolution rule — "keep screens in sync", after it moved from
 * ScreenGroup.syncMode to Playlist.syncPlayback (2026-09-16).
 *
 * This is the one place the rule is decided, so these cases ARE the contract:
 * the manifest builder and both fleet lists call `resolveScreenSync` /
 * `isScreenSyncActive` and can never disagree with each other.
 *
 * The case that matters most to a live wall is
 * "a locked group with no sync-on playlist is STILL synced" — that is the
 * guarantee that this deploy does not unlock the three groups that are locked
 * in production today, with no migration run and no data touched.
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

  // ── The back-compatibility guarantee ────────────────────────────────────
  it('a group still on the legacy locked flag stays synced with NO playlist flag set', () => {
    expect(
      resolveScreenSync({ groupSyncMode: 'locked', scheduledPlaylistSync: [false, false] }),
    ).toEqual({ enabled: true, source: 'group-legacy' });
  });

  it('the legacy flag needs no schedule information at all to keep a wall locked', () => {
    expect(resolveScreenSync({ groupSyncMode: 'locked' })).toEqual({
      enabled: true,
      source: 'group-legacy',
    });
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

  it('the playlist answer wins over the legacy group flag when both say lock', () => {
    // Same outcome either way; the SOURCE is what tells an operator (and the
    // data-move doc) that this group no longer needs its legacy flag.
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

  it('a legacy locked group keeps every one of its screens active with no targets at all', () => {
    expect(
      isScreenSyncActive({ id: 's1', screenGroupId: 'g1', groupSyncMode: 'locked' }, targets()),
    ).toBe(true);
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
    // A fleet list must still render; the caller then falls back to the legacy
    // group flag alone, which is the pre-change behaviour.
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
