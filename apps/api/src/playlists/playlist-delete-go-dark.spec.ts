/**
 * P0-1 (launch-sprint Day 1, 2026-07-01) — deleting a PLAYLIST must not
 * blank a screen.
 *
 * CC-2 added the go-dark fallback to the schedules controller's own
 * mutation routes — but deleting a playlist hard-deletes every schedule
 * referencing it (playlists.controller.ts remove()), a SECOND DOOR into
 * the exact same failure that bypassed the fallback entirely: a screen
 * whose only active schedule pointed at the deleted playlist went dark
 * with zero recovery.
 *
 * These tests prove the playlist-delete door now runs the SAME shared
 * fallback (apps/api/src/schedules/go-dark-fallback.ts):
 *   - Deleting a playlist whose ACTIVE schedule was the only coverage for
 *     a screen promotes the best inactive candidate for that screen (which
 *     necessarily references a DIFFERENT playlist — the dying playlist's
 *     schedules are already deleted) + writes SCHEDULE_AUTO_REACTIVATED.
 *   - Group-targeted schedules get like-for-like restoration.
 *   - If another ACTIVE schedule still covers the target, nothing changes.
 *   - No candidate → no reactivation; the delete still succeeds.
 *
 * Unit-level like schedule-go-dark-fallback.spec.ts: the controller is
 * constructed directly with a mocked Prisma whose $transaction runs the
 * callback against the same in-memory rows, so we assert the realistic
 * post-deleteMany state the fallback queries actually see.
 */

import 'reflect-metadata';
import { PlaylistsController } from './playlists.controller';

type ScheduleRow = {
  id: string;
  tenantId: string;
  playlistId: string;
  screenId: string | null;
  screenGroupId: string | null;
  isActive: boolean;
  priority: number;
  startTime: Date;
  endTime: Date | null;
};

function matchScheduleWhere(r: ScheduleRow, where: any): boolean {
  if (!where) return true;
  if (where.tenantId !== undefined && r.tenantId !== where.tenantId) return false;
  if (where.playlistId !== undefined) {
    if (typeof where.playlistId === 'object' && where.playlistId?.not !== undefined) {
      if (r.playlistId === where.playlistId.not) return false;
    } else if (r.playlistId !== where.playlistId) return false;
  }
  if (where.isActive !== undefined && r.isActive !== where.isActive) return false;
  if (where.screenId !== undefined && r.screenId !== where.screenId) return false;
  if (where.screenGroupId !== undefined && r.screenGroupId !== where.screenGroupId) return false;
  if (where.id !== undefined) {
    if (typeof where.id === 'object' && where.id?.not !== undefined) {
      if (r.id === where.id.not) return false;
    } else if (r.id !== where.id) return false;
  }
  return true;
}

function sortRows(rows: ScheduleRow[], orderBy: any): ScheduleRow[] {
  if (!orderBy) return rows;
  const clauses: Array<Record<string, 'asc' | 'desc'>> = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const clause of clauses) {
      const [key, dir] = Object.entries(clause)[0] as [keyof ScheduleRow, 'asc' | 'desc'];
      const av = a[key] as any;
      const bv = b[key] as any;
      if (av === bv) continue;
      const cmp = av > bv ? 1 : -1;
      return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

function makeController(
  scheduleRows: ScheduleRow[],
  copies: Array<{ id: string; tenantId: string; name: string; isProtected: boolean }> = [],
  emergencyWiring: { tenant?: { id: string }; screen?: { id: string }; override?: { id: string } } = {},
) {
  const auditRows: any[] = [];

  const client = {
    playlist: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === 'pl-dying'
          ? { id: 'pl-dying', tenantId: 't1', name: 'Dying Playlist', isProtected: false }
          : null,
      ),
      delete: jest.fn(async () => ({})),
      findMany: jest.fn(async () => copies),
    },
    schedule: {
      findMany: jest.fn(async ({ where }: any) =>
        scheduleRows.filter((r) => matchScheduleWhere(r, where)),
      ),
      deleteMany: jest.fn(async ({ where }: any) => {
        for (let i = scheduleRows.length - 1; i >= 0; i--) {
          if (matchScheduleWhere(scheduleRows[i], where)) scheduleRows.splice(i, 1);
        }
        return {};
      }),
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        const matches = sortRows(
          scheduleRows.filter((r) => matchScheduleWhere(r, where)),
          orderBy,
        );
        return matches[0] ?? null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = scheduleRows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row ?? {};
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditRows.push(data);
        return data;
      }),
    },
    // Alert-pipeline columns the shared emergency guard reads on delete
    // (emergency-content-use.ts). Default: the playlist is wired nowhere.
    tenant: { findFirst: jest.fn(async () => emergencyWiring.tenant ?? null) },
    screen: { findFirst: jest.fn(async () => emergencyWiring.screen ?? null) },
    screenEmergencyOverride: { findFirst: jest.fn(async () => emergencyWiring.override ?? null) },
    $transaction: jest.fn(async (cb: any) => cb(client)),
  };

  const prisma = {
    client,
    ensurePlaylistMetadataColumns: jest.fn(async () => undefined),
  } as any;

  const controller = new PlaylistsController(prisma, {} as any, {} as any, {} as any);
  // notifySync publishes over Redis — irrelevant to this unit; stub it.
  (controller as any).notifySync = jest.fn();

  return { controller, scheduleRows, auditRows, client };
}

const req = { user: { id: 'u1', tenantId: 't1' } };

function row(partial: Partial<ScheduleRow> & { id: string; playlistId: string }): ScheduleRow {
  return {
    tenantId: 't1',
    screenId: null,
    screenGroupId: null,
    isActive: false,
    priority: 0,
    startTime: new Date('2026-01-01'),
    endTime: null,
    ...partial,
  };
}

describe('playlist delete — go-dark fallback (P0-1)', () => {
  it('promotes the best inactive candidate when the deleted playlist held the only active schedule for a screen', async () => {
    const { controller, scheduleRows, auditRows } = makeController([
      row({ id: 's-active', playlistId: 'pl-dying', screenId: 'scr1', isActive: true }),
      row({ id: 's-cand-low', playlistId: 'pl-other', screenId: 'scr1', priority: 1 }),
      row({ id: 's-cand-high', playlistId: 'pl-other', screenId: 'scr1', priority: 5 }),
    ]);

    const out = await controller.remove(req as any, 'pl-dying');

    expect(out).toEqual({ deleted: true });
    // The dying playlist's schedules are gone…
    expect(scheduleRows.find((r) => r.playlistId === 'pl-dying')).toBeUndefined();
    // …and the HIGHEST-priority candidate for the same screen was promoted.
    expect(scheduleRows.find((r) => r.id === 's-cand-high')?.isActive).toBe(true);
    expect(scheduleRows.find((r) => r.id === 's-cand-low')?.isActive).toBe(false);
    const reactivation = auditRows.find((a) => a.action === 'SCHEDULE_AUTO_REACTIVATED');
    expect(reactivation).toBeDefined();
    expect(reactivation.targetId).toBe('s-cand-high');
  });

  it('restores like-for-like for GROUP-targeted schedules', async () => {
    const { controller, scheduleRows, auditRows } = makeController([
      row({ id: 's-active', playlistId: 'pl-dying', screenGroupId: 'grp1', isActive: true }),
      row({ id: 's-cand', playlistId: 'pl-other', screenGroupId: 'grp1' }),
      // Per-screen schedule must NOT be promoted for a group target.
      row({ id: 's-wrong-kind', playlistId: 'pl-other', screenId: 'scrX' }),
    ]);

    await controller.remove(req as any, 'pl-dying');

    expect(scheduleRows.find((r) => r.id === 's-cand')?.isActive).toBe(true);
    expect(scheduleRows.find((r) => r.id === 's-wrong-kind')?.isActive).toBe(false);
    expect(auditRows.some((a) => a.action === 'SCHEDULE_AUTO_REACTIVATED')).toBe(true);
  });

  it('does nothing when another ACTIVE schedule still covers the target', async () => {
    const { controller, scheduleRows, auditRows } = makeController([
      row({ id: 's-dying', playlistId: 'pl-dying', screenId: 'scr1', isActive: true }),
      row({ id: 's-still-active', playlistId: 'pl-other', screenId: 'scr1', isActive: true }),
      row({ id: 's-cand', playlistId: 'pl-third', screenId: 'scr1' }),
    ]);

    await controller.remove(req as any, 'pl-dying');

    expect(scheduleRows.find((r) => r.id === 's-cand')?.isActive).toBe(false);
    expect(auditRows.some((a) => a.action === 'SCHEDULE_AUTO_REACTIVATED')).toBe(false);
  });

  it('delete still succeeds when no candidate exists (genuinely empty target)', async () => {
    const { controller, scheduleRows, auditRows } = makeController([
      row({ id: 's-only', playlistId: 'pl-dying', screenId: 'scr1', isActive: true }),
    ]);

    const out = await controller.remove(req as any, 'pl-dying');

    expect(out).toEqual({ deleted: true });
    expect(scheduleRows.length).toBe(0);
    expect(auditRows.some((a) => a.action === 'SCHEDULE_AUTO_REACTIVATED')).toBe(false);
    // The playlist-delete audit row itself is still written.
    expect(auditRows.some((a) => a.action === 'PLAYLIST_DELETED')).toBe(true);
  });

  it('inactive schedules of the dying playlist do not trigger reactivation for their targets', async () => {
    const { controller, auditRows, scheduleRows } = makeController([
      // Dying playlist has only an INACTIVE schedule on scr2 — that screen
      // was never covered by it, so no fallback should fire there.
      row({ id: 's-inactive', playlistId: 'pl-dying', screenId: 'scr2', isActive: false }),
      row({ id: 's-unrelated', playlistId: 'pl-other', screenId: 'scr2', isActive: false }),
    ]);

    await controller.remove(req as any, 'pl-dying');

    expect(scheduleRows.find((r) => r.id === 's-unrelated')?.isActive).toBe(false);
    expect(auditRows.some((a) => a.action === 'SCHEDULE_AUTO_REACTIVATED')).toBe(false);
  });

  it('removes distributed child copies and restores each child screen independently', async () => {
    const { controller, scheduleRows, auditRows, client } = makeController([
      row({ id: 'child-active', tenantId: 't2', playlistId: 'child-copy', screenId: 'child-screen', isActive: true }),
      row({ id: 'child-fallback', tenantId: 't2', playlistId: 'child-other', screenId: 'child-screen', isActive: false }),
    ], [{ id: 'child-copy', tenantId: 't2', name: 'Dying Playlist', isProtected: false }]);

    await controller.remove(req as any, 'pl-dying');

    expect(client.playlist.delete).toHaveBeenCalledWith({ where: { id: 'child-copy', tenantId: 't2' } });
    expect(client.playlist.delete).toHaveBeenCalledWith({ where: { id: 'pl-dying', tenantId: 't1' } });
    expect(scheduleRows.find((r) => r.id === 'child-active')).toBeUndefined();
    expect(scheduleRows.find((r) => r.id === 'child-fallback')?.isActive).toBe(true);
    expect(auditRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'PLAYLIST_DELETED', tenantId: 't2', targetId: 'child-copy' }),
      expect.objectContaining({ action: 'PLAYLIST_DELETED', tenantId: 't1', targetId: 'pl-dying' }),
    ]));
  });
});

// 2026-09-26 — `isProtected` is not the only way a playlist becomes alert
// media. A tenant's panic default, a screen's per-type emergency playlist and
// a live override all accept an ORDINARY playlist by id, with no foreign key,
// so deleting it (or one of its location copies) would leave a dangling id and
// the next lockdown with nothing. The shared guard refuses, inside the
// transaction, before any schedule or playlist row goes.
describe('playlist delete — emergency wiring by any alert-pipeline path', () => {
  it("refuses when a LOCATION COPY is a screen's emergency playlist, and deletes nothing", async () => {
    const { controller, scheduleRows, auditRows, client } = makeController(
      [row({ id: 's-active', playlistId: 'pl-dying', screenId: 'scr1', isActive: true })],
      [{ id: 'pl-copy-school', tenantId: 't-school', name: 'Dying Playlist', isProtected: false }],
      { screen: { id: 'scr-gym' } },
    );
    await expect(controller.remove(req as any, 'pl-dying')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'PLAYLIST_IN_EMERGENCY_USE',
        message: expect.stringContaining('an emergency playlist of screen scr-gym'),
      }),
    });
    expect(scheduleRows.find((r) => r.id === 's-active')).toBeDefined();
    expect(client.playlist.delete).not.toHaveBeenCalled();
    expect(client.schedule.deleteMany).not.toHaveBeenCalled();
    expect(auditRows).toHaveLength(0);
    // The guard was asked about the parent AND the copy in one query.
    expect(client.screen.findFirst).toHaveBeenCalledTimes(1);
    const screenWhere = (client.screen.findFirst as jest.Mock).mock.calls[0][0].where;
    expect(screenWhere.OR[0]).toEqual({ emergencyLockdownPlaylistId: { in: ['pl-copy-school', 'pl-dying'] } });
  });

  it("refuses when the parent is a tenant's panic default", async () => {
    const { controller, client } = makeController(
      [row({ id: 's-active', playlistId: 'pl-dying', screenId: 'scr1', isActive: true })],
      [],
      { tenant: { id: 't1' } },
    );
    await expect(controller.remove(req as any, 'pl-dying')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'PLAYLIST_IN_EMERGENCY_USE' }),
    });
    expect(client.playlist.delete).not.toHaveBeenCalled();
  });

  it('still deletes an ordinary playlist wired nowhere', async () => {
    const { controller, client } = makeController([
      row({ id: 's-active', playlistId: 'pl-dying', screenId: 'scr1', isActive: true }),
    ]);
    await expect(controller.remove(req as any, 'pl-dying')).resolves.toEqual({ deleted: true });
    expect(client.playlist.delete).toHaveBeenCalledTimes(1);
  });
});
