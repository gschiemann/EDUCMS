/**
 * Forensic coverage for content mutations (2026-08-03).
 *
 * "Who changed what is on that screen" was unanswerable for most of the
 * content surface:
 *   - PlaylistsController audited ONLY `remove()`. Creating a playlist,
 *     renaming it, REPLACING every item in it (the write that decides what
 *     a screen actually plays, and CONTRIBUTOR-reachable), bulk-toggling its
 *     schedules on/off, and publishing it to a fleet of child locations all
 *     left nothing behind.
 *   - SchedulesController audited toggle + delete, and `update` ONLY when
 *     `isActive` flipped. So the PUBLISH action itself (create) wrote no
 *     SCHEDULE_CREATED at all, and a PUT that re-targeted a live schedule at
 *     a different screen wrote nothing whatsoever.
 *
 * These tests drive the real controller methods against in-memory Prisma
 * stubs and assert on the AuditLog rows actually written. AuditLog carries
 * DB-level immutability triggers, so every row here goes through the normal
 * Prisma create path.
 */

import 'reflect-metadata';
import { PlaylistsController } from './playlists.controller';
import { SchedulesController } from '../schedules/schedules.controller';

const req = { user: { id: 'u1', tenantId: 't1' } };

// ── Playlists ──────────────────────────────────────────────────────────────

function makePlaylistController(opts: { playlist?: any; scheduleCount?: number } = {}) {
  const auditRows: any[] = [];
  const playlist = opts.playlist ?? {
    id: 'pl1',
    tenantId: 't1',
    name: 'Lobby Loop',
    isProtected: false,
  };

  const client: any = {
    playlist: {
      findFirst: jest.fn(async () => playlist),
      findUnique: jest.fn(async () => ({ ...playlist, items: [] })),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: any) => ({ id: 'pl-new', ...data })),
      update: jest.fn(async ({ where, data }: any) => ({ ...playlist, id: where.id, ...data })),
    },
    asset: { count: jest.fn(async ({ where }: any) => where.id.in.length) },
    playlistItem: { deleteMany: jest.fn(async () => ({})), create: jest.fn(async () => ({})) },
    schedule: {
      updateMany: jest.fn(async () => ({ count: opts.scheduleCount ?? 3 })),
      // INJ-003 live-content gate probes this; null = not live-bound, so the
      // gate is a no-op and we exercise the audit path itself.
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({})),
    },
    template: { findFirst: jest.fn(async () => ({ id: 'tpl1' })) },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditRows.push(data);
        return data;
      }),
    },
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(client) : Promise.all(arg),
    ),
  };

  const prisma = { client, ensurePlaylistMetadataColumns: jest.fn(async () => undefined) } as any;
  const distribution = {
    publishToFleet: jest.fn(async () => ({
      perLocation: [{ tenantId: 'child-a' }, { tenantId: 'child-b' }],
    })),
  } as any;
  const controller = new PlaylistsController(prisma, {} as any, {} as any, distribution);
  (controller as any).notifySync = jest.fn();
  return { controller, auditRows, client };
}

describe('PlaylistsController — audit coverage', () => {
  it('audits PLAYLIST_CREATED', async () => {
    const { controller, auditRows } = makePlaylistController();
    await controller.create(req as any, { name: 'New Loop', templateId: 'tpl1' } as any);

    const row = auditRows.find((a) => a.action === 'PLAYLIST_CREATED');
    expect(row).toBeDefined();
    expect(row.tenantId).toBe('t1');
    expect(row.userId).toBe('u1');
    expect(row.targetType).toBe('Playlist');
    expect(row.targetId).toBe('pl-new');
    expect(JSON.parse(row.details).templateId).toBe('tpl1');
  });

  it('audits PLAYLIST_UPDATED with the previous name', async () => {
    const { controller, auditRows } = makePlaylistController();
    await controller.update(req as any, 'pl1', { name: 'Renamed' } as any);

    const row = auditRows.find((a) => a.action === 'PLAYLIST_UPDATED');
    expect(row).toBeDefined();
    expect(row.targetId).toBe('pl1');
    const details = JSON.parse(row.details);
    expect(details.previousName).toBe('Lobby Loop');
    expect(details.name).toBe('Renamed');
  });

  it('audits PLAYLIST_ITEMS_REPLACED with the ordered asset set', async () => {
    const { controller, auditRows } = makePlaylistController();
    await controller.reorderItems(req as any, 'pl1', {
      items: [
        { assetId: 'a2', durationMs: 5000, sequenceOrder: 1 },
        { assetId: 'a1', durationMs: 5000, sequenceOrder: 0 },
      ],
    } as any);

    const row = auditRows.find((a) => a.action === 'PLAYLIST_ITEMS_REPLACED');
    expect(row).toBeDefined();
    const details = JSON.parse(row.details);
    expect(details.itemCount).toBe(2);
    // Recorded in playback order, not request order.
    expect(details.assetIds).toEqual(['a1', 'a2']);
  });

  it('audits PLAYLIST_SCHEDULES_TOGGLED with the affected schedule count', async () => {
    const { controller, auditRows } = makePlaylistController({ scheduleCount: 4 });
    await controller.setActive(req as any, 'pl1', { active: false } as any);

    const row = auditRows.find((a) => a.action === 'PLAYLIST_SCHEDULES_TOGGLED');
    expect(row).toBeDefined();
    const details = JSON.parse(row.details);
    expect(details.active).toBe(false);
    expect(details.scheduleCount).toBe(4);
  });

  it('never starts a schedule while its 1080p playback copy is pending', async () => {
    const { controller, client } = makePlaylistController();
    client.schedule.findFirst.mockResolvedValueOnce({ pendingMediaError: null });
    await expect(controller.setActive(req as any, 'pl1', { active: true } as any))
      .rejects.toMatchObject({ status: 409 });
    expect(client.schedule.updateMany).not.toHaveBeenCalled();
  });

  it('guards against a copy queued after the read, and cancels pending publishing when paused', async () => {
    const { controller, client } = makePlaylistController();
    await controller.setActive(req as any, 'pl1', { active: true } as any);
    expect(client.schedule.updateMany).toHaveBeenCalledWith({
      where: { playlistId: 'pl1', tenantId: 't1', pendingMedia: false },
      data: { isActive: true },
    });
    await controller.setActive(req as any, 'pl1', { active: false } as any);
    expect(client.schedule.updateMany).toHaveBeenCalledWith({
      where: { playlistId: 'pl1', tenantId: 't1' },
      data: { isActive: false, pendingMedia: false, pendingMediaError: null },
    });
  });

  it('does not bypass a pending playback copy in a child location', async () => {
    const { controller, client } = makePlaylistController();
    client.playlist.findMany.mockResolvedValueOnce([{ id: 'child-pl', tenantId: 'child-tenant' }]);
    await controller.setActive(req as any, 'pl1', { active: true } as any);
    expect(client.schedule.updateMany).toHaveBeenCalledWith({
      where: { playlistId: { in: ['child-pl'] }, pendingMedia: false },
      data: { isActive: true },
    });
  });

  it('audits PLAYLIST_PUBLISHED_TO_FLEET with the target locations', async () => {
    const { controller, auditRows } = makePlaylistController();
    await controller.publishToFleet(req as any, 'pl1', { screenIds: ['s1', 's2'] });

    const row = auditRows.find((a) => a.action === 'PLAYLIST_PUBLISHED_TO_FLEET');
    expect(row).toBeDefined();
    const details = JSON.parse(row.details);
    expect(details.requestedScreenIds).toBe(2);
    expect(details.locations).toEqual(['child-a', 'child-b']);
  });

  it('keeps PLAYLIST_DELETED writing inside the transaction (unchanged)', async () => {
    const { controller, auditRows, client } = makePlaylistController();
    client.schedule.findMany = jest.fn(async () => []);
    client.playlist.delete = jest.fn(async () => ({}));

    await controller.remove(req as any, 'pl1');
    expect(auditRows.find((a) => a.action === 'PLAYLIST_DELETED')).toBeDefined();
  });
});

// ── Schedules ──────────────────────────────────────────────────────────────

function makeScheduleController(existing?: any) {
  const auditRows: any[] = [];
  const schedule = existing ?? {
    id: 'sch1',
    tenantId: 't1',
    playlistId: 'pl1',
    screenId: 'scr1',
    screenGroupId: null,
    isActive: true,
    priority: 0,
    daysOfWeek: null,
    timeStart: null,
    timeEnd: null,
    mutedOverride: null,
  };

  const client: any = {
    schedule: {
      findFirst: jest.fn(async () => schedule),
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async ({ data }: any) => ({
        id: 'sch-new',
        ...data,
        playlist: { id: data.playlistId, name: 'Lobby Loop' },
      })),
      update: jest.fn(async ({ where, data }: any) => ({
        ...schedule,
        id: where.id,
        ...data,
        playlist: { id: data.playlistId ?? schedule.playlistId, name: 'Lobby Loop' },
      })),
    },
    playlist: { findFirst: jest.fn(async () => ({ id: 'pl1' })) },
    screen: { findFirst: jest.fn(async () => ({ id: 'scr2' })) },
    screenGroup: { findFirst: jest.fn(async () => ({ id: 'grp1' })) },
    tenant: { findUnique: jest.fn(async () => ({ id: 't1', requireContentApproval: false })) },
    user: { findMany: jest.fn(async () => []) },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditRows.push(data);
        return data;
      }),
    },
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(client) : Promise.all(arg),
    ),
  };

  const prisma = { client } as any;
  const controller = new SchedulesController(prisma, {} as any, {} as any, { notify: jest.fn() } as any);
  (controller as any).notifySync = jest.fn();
  return { controller, auditRows, client, schedule };
}

describe('SchedulesController — audit coverage', () => {
  it('audits SCHEDULE_CREATED on publish (the action that puts content on a screen)', async () => {
    const { controller, auditRows } = makeScheduleController();

    await controller.create(req as any, {
      playlistId: 'pl1',
      screenId: 'scr1',
      startTime: '2026-08-03T00:00:00.000Z',
      priority: 2,
    } as any);

    const row = auditRows.find((a) => a.action === 'SCHEDULE_CREATED');
    expect(row).toBeDefined();
    expect(row.tenantId).toBe('t1');
    expect(row.userId).toBe('u1');
    expect(row.targetType).toBe('Schedule');
    expect(row.targetId).toBe('sch-new');
    const details = JSON.parse(row.details);
    expect(details.playlistId).toBe('pl1');
    expect(details.screenId).toBe('scr1');
    expect(details.isActive).toBe(true);
    expect(details.staged).toBe(false);
  });

  it('audits SCHEDULE_UPDATED when a PUT RE-TARGETS a schedule (no isActive change)', async () => {
    const { controller, auditRows } = makeScheduleController();

    await controller.update(req as any, 'sch1', { screenId: 'scr2' } as any);

    const row = auditRows.find((a) => a.action === 'SCHEDULE_UPDATED');
    expect(row).toBeDefined();
    const details = JSON.parse(row.details);
    expect(details.changedFields).toEqual(expect.arrayContaining(['screenId', 'screenGroupId']));
    expect(details.before.screenId).toBe('scr1');
    expect(details.after.screenId).toBe('scr2');
    // The active state did NOT change, so no toggle row should be written.
    expect(auditRows.find((a) => a.action === 'SCHEDULE_TOGGLED')).toBeUndefined();
  });

  it('does not write a redundant SCHEDULE_UPDATED for an isActive-only PUT', async () => {
    const { controller, auditRows } = makeScheduleController();

    await controller.update(req as any, 'sch1', { isActive: false } as any);

    expect(auditRows.find((a) => a.action === 'SCHEDULE_TOGGLED')).toBeDefined();
    expect(auditRows.find((a) => a.action === 'SCHEDULE_UPDATED')).toBeUndefined();
  });
});
