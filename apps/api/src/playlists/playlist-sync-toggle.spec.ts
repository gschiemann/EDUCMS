/**
 * PUT /playlists/:id/sync — "keep screens in sync", after it moved off the
 * screen group (2026-09-16).
 *
 * Greg: "we should move the option to keep screens in sync from the group menu
 * setting to the playlist settings...if i have different playlists assigned to
 * screens in the same group it doesnt make sense saying to keep them in sync".
 *
 * What these pin:
 *   • the flag is actually written, scoped to the caller's tenant;
 *   • it leaves a trail — this changes how every screen playing the playlist
 *     advances its content, exactly the class of change the group toggle it
 *     replaces audited as SCREEN_GROUP_SYNC_MODE_CHANGED;
 *   • the fleet is nudged rather than left to wait out its poll;
 *   • the column is ensured BEFORE the write (Railway never runs
 *     `prisma migrate deploy`, so a fresh deploy would otherwise 500);
 *   • emergency content refuses, like every other generic playlist door.
 */

import 'reflect-metadata';
import { PlaylistsController } from './playlists.controller';

const req = { user: { id: 'u1', tenantId: 't1' } };

function makeController(over: Record<string, unknown> = {}) {
  const auditRows: any[] = [];
  const playlist = {
    id: 'pl1',
    tenantId: 't1',
    name: 'Menu Boards Loop',
    isProtected: false,
    protectedKind: null,
    syncPlayback: false,
    ...over,
  };
  const updates: any[] = [];

  const client: any = {
    playlist: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.tenantId === playlist.tenantId && where.id === playlist.id ? playlist : null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        updates.push({ where, data });
        return { id: where.id, name: playlist.name, syncPlayback: data.syncPlayback };
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditRows.push(data);
        return data;
      }),
    },
  };

  const ensure = jest.fn(async () => undefined);
  const prisma = { client, ensurePlaylistMetadataColumns: ensure } as any;
  const controller = new PlaylistsController(prisma, {} as any, {} as any, {} as any);
  const notifySync = jest.fn();
  (controller as any).notifySync = notifySync;
  return { controller, auditRows, client, updates, ensure, notifySync, playlist };
}

describe('turning "keep screens in sync" on', () => {
  it('writes the flag, tenant-scoped', async () => {
    const h = makeController();
    const out = await h.controller.setSyncPlayback(req as any, 'pl1', { sync: true } as any);

    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].where).toEqual({ id: 'pl1', tenantId: 't1' });
    expect(h.updates[0].data).toEqual({ syncPlayback: true });
    expect(out).toMatchObject({ id: 'pl1', syncPlayback: true });
  });

  it('leaves an audit row naming the change, not just the playlist', async () => {
    const h = makeController();
    await h.controller.setSyncPlayback(req as any, 'pl1', { sync: true } as any);

    const row = h.auditRows.find((a) => a.action === 'PLAYLIST_SYNC_PLAYBACK_CHANGED');
    expect(row).toBeDefined();
    expect(row.tenantId).toBe('t1');
    expect(row.userId).toBe('u1');
    expect(row.targetType).toBe('Playlist');
    expect(row.targetId).toBe('pl1');
    expect(JSON.parse(row.details)).toMatchObject({
      name: 'Menu Boards Loop',
      from: false,
      to: true,
    });
  });

  it('nudges the fleet instead of leaving it to its next poll', async () => {
    const h = makeController();
    await h.controller.setSyncPlayback(req as any, 'pl1', { sync: true } as any);
    expect(h.notifySync).toHaveBeenCalledWith('t1');
  });

  it('ensures the column exists before it writes to it', async () => {
    const h = makeController();
    await h.controller.setSyncPlayback(req as any, 'pl1', { sync: true } as any);
    // Railway never runs `prisma migrate deploy`; without this the first
    // toggle after a deploy is a 500 on a missing column.
    expect(h.ensure).toHaveBeenCalled();
    expect(h.ensure.mock.invocationCallOrder[0])
      .toBeLessThan(h.client.playlist.update.mock.invocationCallOrder[0]);
  });
});

describe('turning it off', () => {
  it('writes false and records the direction it moved', async () => {
    const h = makeController({ syncPlayback: true });
    await h.controller.setSyncPlayback(req as any, 'pl1', { sync: false } as any);

    expect(h.updates[0].data).toEqual({ syncPlayback: false });
    const row = h.auditRows.find((a) => a.action === 'PLAYLIST_SYNC_PLAYBACK_CHANGED');
    expect(JSON.parse(row.details)).toMatchObject({ from: true, to: false });
  });
});

describe('what it refuses', () => {
  it("another tenant's playlist is not found, and nothing is written", async () => {
    const h = makeController({ tenantId: 'other-tenant' });
    await expect(
      h.controller.setSyncPlayback(req as any, 'pl1', { sync: true } as any),
    ).rejects.toMatchObject({ status: 404 });
    expect(h.client.playlist.update).not.toHaveBeenCalled();
    expect(h.auditRows).toHaveLength(0);
  });

  it('emergency content refuses — the same guard the other playlist doors carry', async () => {
    const h = makeController({ isProtected: true, protectedKind: 'lockdown' });
    await expect(
      h.controller.setSyncPlayback(req as any, 'pl1', { sync: true } as any),
    ).rejects.toMatchObject({ status: 403 });
    expect(h.client.playlist.update).not.toHaveBeenCalled();
  });
});
