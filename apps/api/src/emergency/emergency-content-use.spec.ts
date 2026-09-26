import {
  emergencyContentUse,
  playlistEmergencyUse,
  type EmergencyUseDb,
  SCREEN_EMERGENCY_MEDIA_URL_FIELDS,
  SCREEN_EMERGENCY_PLAYLIST_FIELDS,
  TENANT_EMERGENCY_PLAYLIST_FIELDS,
} from './emergency-content-use';

/**
 * The one guard every writer that must leave alert media alone now shares
 * (2026-09-26). Each branch of the alert pipeline's reads is a case, plus the
 * fail-closed rule: a check that cannot run is a reason to keep the content.
 */
type Where = {
  id?: unknown;
  isProtected?: unknown;
  OR?: unknown[];
  clearedAt?: unknown;
  playlistId?: unknown;
  mediaUrl?: unknown;
};
type Call = { where: Where };
function makeDb(over: Partial<Record<string, any>> = {}) {
  const calls: Record<string, Call[]> = {};
  const rec = (name: string, answer: (args: Call) => unknown) =>
    jest.fn((args: Call) => {
      (calls[name] ??= []).push(args);
      return Promise.resolve(answer(args));
    });
  const db = {
    playlistItem: { findMany: rec('items', () => over.items ?? []) },
    playlist: {
      findFirst: rec('playlist', () => over.protectedPlaylist ?? null),
    },
    tenant: { findFirst: rec('tenant', () => over.tenant ?? null) },
    screen: {
      findFirst: rec('screen', ({ where }: Call) => {
        const keys = (
          (where.OR ?? []) as Array<Record<string, unknown>>
        ).flatMap((o) => Object.keys(o));
        const isPlaylistLookup = keys.every((k) =>
          (SCREEN_EMERGENCY_PLAYLIST_FIELDS as readonly string[]).includes(k),
        );
        return isPlaylistLookup
          ? (over.screenPlaylist ?? null)
          : (over.screenMedia ?? null);
      }),
    },
    screenEmergencyOverride: {
      findFirst: rec('override', () => over.override ?? null),
    },
    emergencyMessage: { findFirst: rec('message', () => over.message ?? null) },
  };
  return { db: db as unknown as EmergencyUseDb, raw: db, calls };
}

const URL = 'https://x/storage/v1/object/public/assets/t1/lockdown.mp4';

describe('emergencyContentUse', () => {
  it('is null for an ordinary asset in ordinary playlists', async () => {
    const { db, calls } = makeDb({ items: [{ playlistId: 'p1' }] });
    await expect(emergencyContentUse(db, 'a1', URL)).resolves.toBeNull();
    // every path was actually consulted, with the asset's own playlist ids
    expect(calls.playlist[0].where).toEqual({
      id: { in: ['p1'] },
      isProtected: true,
    });
    expect(calls.tenant[0].where.OR).toHaveLength(
      TENANT_EMERGENCY_PLAYLIST_FIELDS.length,
    );
    expect(calls.screen[0].where.OR).toHaveLength(
      SCREEN_EMERGENCY_PLAYLIST_FIELDS.length,
    );
    expect(calls.screen[1].where.OR).toHaveLength(
      SCREEN_EMERGENCY_MEDIA_URL_FIELDS.length,
    );
    expect(calls.override).toHaveLength(2);
    expect(calls.message[0].where).toEqual({
      clearedAt: null,
      OR: [{ audioUrl: URL }, { mediaUrls: { contains: URL } }],
    });
  });

  it('names a protected playlist', async () => {
    const { db } = makeDb({
      items: [{ playlistId: 'p1' }],
      protectedPlaylist: { id: 'p1' },
    });
    await expect(emergencyContentUse(db, 'a1', URL)).resolves.toBe(
      'protected playlist p1',
    );
  });

  it("names a tenant's panic default even when the playlist is not flagged protected", async () => {
    const { db } = makeDb({
      items: [{ playlistId: 'p1' }],
      tenant: { id: 't1' },
    });
    await expect(emergencyContentUse(db, 'a1', URL)).resolves.toBe(
      'an emergency playlist of tenant t1',
    );
  });

  it("names a screen's per-type emergency playlist", async () => {
    const { db } = makeDb({
      items: [{ playlistId: 'p1' }],
      screenPlaylist: { id: 's-gym' },
    });
    await expect(emergencyContentUse(db, 'a1', URL)).resolves.toBe(
      'an emergency playlist of screen s-gym',
    );
  });

  it('names a screen whose emergency media URL is this file, with no playlist involved', async () => {
    const { db, calls } = makeDb({ items: [], screenMedia: { id: 's-lobby' } });
    await expect(emergencyContentUse(db, 'a1', URL)).resolves.toBe(
      'the emergency media of screen s-lobby',
    );
    expect(calls.playlist).toBeUndefined(); // no playlist ids → no playlist lookups
  });

  it('names a live override and a live message that carry the file', async () => {
    const { db: viaOverride } = makeDb({ items: [], override: { id: 'ov1' } });
    await expect(emergencyContentUse(viaOverride, 'a1', URL)).resolves.toBe(
      'live screen override ov1',
    );
    const { db: viaMessage } = makeDb({ items: [], message: { id: 'm1' } });
    await expect(emergencyContentUse(viaMessage, 'a1', URL)).resolves.toBe(
      'live emergency message m1',
    );
  });

  it('fails CLOSED when a read throws', async () => {
    const { db, raw } = makeDb({ items: [{ playlistId: 'p1' }] });
    (raw.tenant.findFirst as jest.Mock).mockRejectedValueOnce(
      new Error('pool exhausted'),
    );
    await expect(emergencyContentUse(db, 'a1', URL)).resolves.toBe(
      'the emergency check could not run: pool exhausted',
    );
  });

  it('fails CLOSED when a delegate is missing altogether (a transaction client that lacks it)', async () => {
    const { db } = makeDb({ items: [{ playlistId: 'p1' }] });
    delete db.tenant;
    await expect(emergencyContentUse(db, 'a1', URL)).resolves.toMatch(
      /^the emergency check could not run: /,
    );
  });
});

describe('playlistEmergencyUse', () => {
  it('is null for no ids without touching the database', async () => {
    const { db, calls } = makeDb();
    await expect(playlistEmergencyUse(db, [])).resolves.toBeNull();
    expect(Object.keys(calls)).toEqual([]);
  });

  it('checks the parent and every copy in one query per column set', async () => {
    const { db, calls } = makeDb({ override: { id: 'ov9' } });
    await expect(
      playlistEmergencyUse(db, ['parent', 'copy-a', 'copy-b', 'copy-a']),
    ).resolves.toBe('live screen override ov9');
    expect(calls.playlist[0].where.id).toEqual({
      in: ['parent', 'copy-a', 'copy-b'],
    });
    expect(calls.override[0].where).toEqual({
      playlistId: { in: ['parent', 'copy-a', 'copy-b'] },
    });
  });

  it("names a screen's emergency playlist for a copy at a location", async () => {
    const { db } = makeDb({ screenPlaylist: { id: 's-cafe' } });
    await expect(playlistEmergencyUse(db, ['copy-a'])).resolves.toBe(
      'an emergency playlist of screen s-cafe',
    );
  });
});
