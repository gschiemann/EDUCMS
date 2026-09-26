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
 *
 * Since 2026-09-26 deleting a PUBLISHED playlist needs `?confirm=in-use`
 * (the last describe block), so the fallback cases below pass it — they are
 * the operator-confirmed delete.
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

type ScreenRow = { id: string; tenantId: string; screenGroupId: string | null };

function makeController(
  scheduleRows: ScheduleRow[],
  copies: Array<{ id: string; tenantId: string; name: string; isProtected: boolean }> = [],
  emergencyWiring: { tenant?: { id: string }; screen?: { id: string }; override?: { id: string } } = {},
  screenRows: ScreenRow[] = [],
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
    screen: {
      findFirst: jest.fn(async () => emergencyWiring.screen ?? null),
      // The published refusal's reach: pinned screens OR group members.
      findMany: jest.fn(async ({ where }: any) =>
        screenRows.filter((s) =>
          (where.OR ?? []).some((c: any) =>
            (c.id && c.id.in.includes(s.id)) ||
            (c.screenGroupId && s.screenGroupId !== null && c.screenGroupId.in.includes(s.screenGroupId)),
          ),
        ),
      ),
    },
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

    const out = await controller.remove(req as any, 'pl-dying', 'in-use');

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

    await controller.remove(req as any, 'pl-dying', 'in-use');

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

    await controller.remove(req as any, 'pl-dying', 'in-use');

    expect(scheduleRows.find((r) => r.id === 's-cand')?.isActive).toBe(false);
    expect(auditRows.some((a) => a.action === 'SCHEDULE_AUTO_REACTIVATED')).toBe(false);
  });

  it('delete still succeeds when no candidate exists (genuinely empty target)', async () => {
    const { controller, scheduleRows, auditRows } = makeController([
      row({ id: 's-only', playlistId: 'pl-dying', screenId: 'scr1', isActive: true }),
    ]);

    const out = await controller.remove(req as any, 'pl-dying', 'in-use');

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

    await controller.remove(req as any, 'pl-dying', 'in-use');

    expect(scheduleRows.find((r) => r.id === 's-unrelated')?.isActive).toBe(false);
    expect(auditRows.some((a) => a.action === 'SCHEDULE_AUTO_REACTIVATED')).toBe(false);
  });

  it('removes distributed child copies and restores each child screen independently', async () => {
    const { controller, scheduleRows, auditRows, client } = makeController([
      row({ id: 'child-active', tenantId: 't2', playlistId: 'child-copy', screenId: 'child-screen', isActive: true }),
      row({ id: 'child-fallback', tenantId: 't2', playlistId: 'child-other', screenId: 'child-screen', isActive: false }),
    ], [{ id: 'child-copy', tenantId: 't2', name: 'Dying Playlist', isProtected: false }]);

    await controller.remove(req as any, 'pl-dying', 'in-use');

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
    await expect(controller.remove(req as any, 'pl-dying', 'in-use')).resolves.toEqual({ deleted: true });
    expect(client.playlist.delete).toHaveBeenCalledTimes(1);
  });
});

// 2026-09-26 — the warned delete (ba1a8ed) lived only in the NEW dashboard: a
// tab opened before that deploy, or an API-key client, removed a published
// playlist, its rules and every location copy without a word. Deleting a
// published playlist now needs `?confirm=in-use`; without it the answer is the
// 409 PLAYLIST_PUBLISHED the v1 library already handled, with its reach.
describe('playlist delete — a published playlist needs ?confirm=in-use', () => {
  const published = () => [
    row({ id: 's-pinned', playlistId: 'pl-dying', screenId: 'scr1', isActive: true }),
    row({ id: 's-group', playlistId: 'pl-dying', screenGroupId: 'grp1', isActive: false }),
    row({ id: 's-child', tenantId: 't2', playlistId: 'child-copy', screenId: 'child-screen', isActive: true }),
  ];
  const copy = [{ id: 'child-copy', tenantId: 't2', name: 'Dying Playlist', isProtected: false }];
  const screens: ScreenRow[] = [
    { id: 'scr1', tenantId: 't1', screenGroupId: null },
    { id: 'g-a', tenantId: 't1', screenGroupId: 'grp1' },
    { id: 'g-b', tenantId: 't1', screenGroupId: 'grp1' },
    { id: 'child-screen', tenantId: 't2', screenGroupId: null },
  ];

  it('an old client (no confirmation) is refused with PLAYLIST_PUBLISHED and its reach; nothing is removed or audited', async () => {
    const { controller, client, scheduleRows, auditRows } = makeController(published(), copy, {}, screens);
    await expect(controller.remove(req as any, 'pl-dying')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'PLAYLIST_PUBLISHED',
        reach: { rules: 3, screens: 4, locations: 2, copies: 1 },
        confirmQuery: 'confirm=in-use',
        message:
          '“Dying Playlist” is still published (3 publishing rules · 4 screens · copies at 1 other location), ' +
          'so it was not deleted. Refresh the page and remove it again to confirm.',
      }),
    });
    expect(client.playlist.delete).not.toHaveBeenCalled();
    expect(client.schedule.deleteMany).not.toHaveBeenCalled();
    expect(client.schedule.update).not.toHaveBeenCalled();
    expect(scheduleRows).toHaveLength(3);
    expect(auditRows).toHaveLength(0);
    expect((controller as any).notifySync).not.toHaveBeenCalled();
  });

  it('a location copy alone makes it published — the case the library cannot see from its own rules', async () => {
    const { controller, client } = makeController([], copy);
    await expect(controller.remove(req as any, 'pl-dying')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'PLAYLIST_PUBLISHED',
        reach: { rules: 0, screens: 0, locations: 2, copies: 1 },
      }),
    });
    expect(client.playlist.delete).not.toHaveBeenCalled();
  });

  it('a paused rule is still a publishing rule', async () => {
    const { controller, client } = makeController(
      [row({ id: 's-paused', playlistId: 'pl-dying', screenId: 'scr1', isActive: false })],
      [],
      {},
      screens,
    );
    await expect(controller.remove(req as any, 'pl-dying')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'PLAYLIST_PUBLISHED', reach: { rules: 1, screens: 1, locations: 1, copies: 0 } }),
    });
    expect(client.playlist.delete).not.toHaveBeenCalled();
  });

  it('a new client with ?confirm=in-use deletes it, and every PLAYLIST_DELETED row records the confirmed in-use delete', async () => {
    const { controller, client, auditRows } = makeController(published(), copy, {}, screens);
    await expect(controller.remove(req as any, 'pl-dying', 'in-use')).resolves.toEqual({ deleted: true });
    expect(client.playlist.delete).toHaveBeenCalledWith({ where: { id: 'child-copy', tenantId: 't2' } });
    expect(client.playlist.delete).toHaveBeenCalledWith({ where: { id: 'pl-dying', tenantId: 't1' } });
    const deleted = auditRows.filter((a) => a.action === 'PLAYLIST_DELETED');
    expect(deleted).toHaveLength(2);
    for (const a of deleted) expect(JSON.parse(a.details).confirmedInUse).toBe(true);
    // The reach lookup belongs to the refusal only.
    expect(client.screen.findMany).not.toHaveBeenCalled();
  });

  it('an unpublished playlist deletes without the flag, and its audit row says it was not an in-use delete', async () => {
    const { controller, client, auditRows } = makeController([
      row({ id: 's-other', playlistId: 'pl-other', screenId: 'scr1', isActive: true }),
    ]);
    await expect(controller.remove(req as any, 'pl-dying')).resolves.toEqual({ deleted: true });
    expect(client.playlist.delete).toHaveBeenCalledWith({ where: { id: 'pl-dying', tenantId: 't1' } });
    const deleted = auditRows.find((a) => a.action === 'PLAYLIST_DELETED');
    expect(JSON.parse(deleted.details)).toMatchObject({ scheduleCount: 0, confirmedInUse: false });
  });

  it.each(['true', 'yes', 'IN-USE', 'in_use', '', ' in-use'])('?confirm=%p is not a confirmation', async (value) => {
    const { controller, client } = makeController(published(), [], {}, screens);
    await expect(controller.remove(req as any, 'pl-dying', value)).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'PLAYLIST_PUBLISHED' }),
    });
    expect(client.playlist.delete).not.toHaveBeenCalled();
  });

  it('a repeated ?confirm (an array from the query parser) is not a confirmation', async () => {
    const { controller, client } = makeController(published(), [], {}, screens);
    await expect(controller.remove(req as any, 'pl-dying', ['in-use', 'in-use'] as any)).rejects.toMatchObject({ status: 409 });
    expect(client.playlist.delete).not.toHaveBeenCalled();
  });

  it("emergency wiring is still refused WITH the flag — a screen's emergency playlist", async () => {
    const { controller, client, auditRows } = makeController(published(), copy, { screen: { id: 'scr-gym' } }, screens);
    await expect(controller.remove(req as any, 'pl-dying', 'in-use')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'PLAYLIST_IN_EMERGENCY_USE' }),
    });
    expect(client.playlist.delete).not.toHaveBeenCalled();
    expect(auditRows).toHaveLength(0);
  });

  it("emergency wiring is still refused WITH the flag — a tenant's panic default", async () => {
    const { controller, client } = makeController(published(), [], { tenant: { id: 't1' } }, screens);
    await expect(controller.remove(req as any, 'pl-dying', 'in-use')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'PLAYLIST_IN_EMERGENCY_USE' }),
    });
    expect(client.playlist.delete).not.toHaveBeenCalled();
  });

  it('a protected location copy is still refused WITH the flag', async () => {
    const { controller, client } = makeController(
      published(),
      [{ id: 'child-copy', tenantId: 't2', name: 'Dying Playlist', isProtected: true }],
      {},
      screens,
    );
    await expect(controller.remove(req as any, 'pl-dying', 'in-use')).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: 'PLAYLIST_PROTECTED' }),
    });
    expect(client.playlist.delete).not.toHaveBeenCalled();
  });

  it('a protected playlist is still refused WITH the flag', async () => {
    const { controller, client } = makeController(published(), [], {}, screens);
    client.playlist.findFirst.mockImplementation(async ({ where }: any) =>
      where.id === 'pl-dying'
        ? { id: 'pl-dying', tenantId: 't1', name: 'Lockdown', isProtected: true, protectedKind: 'lockdown' } as any
        : null,
    );
    await expect(controller.remove(req as any, 'pl-dying', 'in-use')).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: 'PLAYLIST_PROTECTED' }),
    });
    expect(client.playlist.delete).not.toHaveBeenCalled();
  });

  it('the refusal stands when its reach cannot be read — the counts it has are kept', async () => {
    const { controller, client } = makeController(published(), copy, {}, screens);
    client.screen.findMany.mockRejectedValueOnce(new Error('pool exhausted'));
    await expect(controller.remove(req as any, 'pl-dying')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'PLAYLIST_PUBLISHED',
        reach: { rules: 3, screens: null, locations: null, copies: 1 },
        message: expect.stringContaining('(3 publishing rules · copies at 1 other location)'),
      }),
    });
    expect(client.playlist.delete).not.toHaveBeenCalled();
  });
});
