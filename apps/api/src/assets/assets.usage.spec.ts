import { HttpStatus } from '@nestjs/common';
import { AssetsController } from './assets.controller';

/**
 * Media Library v1 (2026-08-31) — the three server truths the calm library
 * design leans on:
 *   1. GET /assets/:id/usage reports REAL references and reach.
 *   2. DELETE on an in-use asset strips ordinary playlist references and
 *      retires schedules when that leaves a media playlist empty.
 *   3. The list endpoint returns { assets, total } ONLY when the caller
 *      opts into pagination/search; a bare GET keeps the legacy array so
 *      the pre-v1 page keeps parsing.
 */

const ASSET = { id: 'a1', tenantId: 't1', fileUrl: 'https://x/store/recovery-lounge.jpg', mimeType: 'image/jpeg' };

function makeController(over: Partial<Record<string, any>> = {}) {
  const prisma: any = {
    client: {
      asset: {
        findFirst: jest.fn(async () => over.asset ?? { ...ASSET }),
        findMany: jest.fn(async () => over.assets ?? []),
        count: jest.fn(async () => over.total ?? 0),
        delete: jest.fn(async () => ({})),
      },
      playlistItem: {
        findMany: jest.fn(async () => over.items ?? []),
        deleteMany: jest.fn(async () => ({ count: (over.items ?? []).length })),
        count: jest.fn(async () => over.remainingItems ?? 0),
      },
      playlist: {
        findMany: jest.fn(async ({ where }: any) =>
          (over.playlists ?? []).filter((p: any) =>
            where.id ? where.id.in.includes(p.id) && (where.isProtected === undefined || p.isProtected === where.isProtected)
                     : true,
          ),
        ),
        // The shared emergency guard (emergency-content-use.ts) asks for a
        // protected playlist among the asset's own.
        findFirst: jest.fn(async ({ where }: any) =>
          (over.playlists ?? []).find((p: any) => where.id.in.includes(p.id) && p.isProtected) ?? null,
        ),
      },
      // Alert-pipeline columns the shared emergency guard reads. Default: not
      // wired anywhere. `tenantEmergency` makes an ORDINARY playlist a panic
      // default — the case the warned-deletion change had stopped refusing.
      tenant: { findFirst: jest.fn(async () => over.tenantEmergency ?? null) },
      screenEmergencyOverride: { findFirst: jest.fn(async () => over.override ?? null) },
      emergencyMessage: { findFirst: jest.fn(async () => over.liveMessage ?? null) },
      schedule: {
        findMany: jest.fn(async () => over.schedules ?? []),
        deleteMany: jest.fn(async () => ({ count: (over.schedules ?? []).length })),
        findFirst: jest.fn(async ({ where }: any) => where.isActive === false ? over.fallbackSchedule ?? null : null),
        update: jest.fn(async () => ({})),
      },
      screen: {
        // First-call shape differs per usage: emergency probe uses OR on
        // config fields; group/pin lookups use screenGroupId/id filters.
        findFirst: jest.fn(async () => over.emergencyScreen ?? null),
        findMany: jest.fn(async ({ where }: any) => {
          if (where.screenGroupId) return (over.groupScreens ?? []).filter((s: any) => where.screenGroupId.in.includes(s.screenGroupId));
          if (where.id) return (over.pinnedScreens ?? []).filter((s: any) => where.id.in.includes(s.id));
          return [];
        }),
      },
      auditLog: { create: jest.fn(async () => ({})) },
      $transaction: jest.fn(async (fn: any) => fn(prisma.client)),
    },
  };
  const storage: any = { extractPath: jest.fn(() => null), delete: jest.fn() };
  const controller = new AssetsController(prisma, storage, {} as any, {} as any, {} as any, { kickOff: () => {} } as any);
  return { controller, prisma };
}

const req = { user: { tenantId: 't1', id: 'u1', role: 'SCHOOL_ADMIN' } } as any;

describe('GET /assets/:id/usage', () => {
  it('reports playlists, reach and totals from real references', async () => {
    const { controller } = makeController({
      items: [{ playlistId: 'p1' }, { playlistId: 'p1' }, { playlistId: 'p2' }],
      playlists: [
        { id: 'p1', name: 'Summer Strength', isProtected: false },
        { id: 'p2', name: 'Lobby Rotation', isProtected: false },
      ],
      schedules: [
        { playlistId: 'p1', screenId: 's1', screenGroupId: null, daysOfWeek: null },
        { playlistId: 'p1', screenId: null, screenGroupId: 'g1', daysOfWeek: null },
      ],
      pinnedScreens: [{ id: 's1', tenantId: 't1' }],
      groupScreens: [
        { id: 's2', tenantId: 't1', screenGroupId: 'g1' },
        { id: 's3', tenantId: 't1', screenGroupId: 'g1' },
      ],
    });
    const out: any = await controller.usage(req, 'a1');
    const p1 = out.playlists.find((p: any) => p.id === 'p1');
    expect(p1).toMatchObject({ name: 'Summer Strength', itemCount: 2, scheduled: true, activeNow: true, screensReached: 3 });
    const p2 = out.playlists.find((p: any) => p.id === 'p2');
    expect(p2).toMatchObject({ itemCount: 1, scheduled: false, activeNow: false, screensReached: 0 });
    expect(out.totals).toEqual({ playlists: 2, screensReached: 3, locations: 1 });
    expect(out.protectedEmergency).toBe(false);
  });

  it('an unused asset reports empty usage, never nulls', async () => {
    const { controller } = makeController({ items: [] });
    const out: any = await controller.usage(req, 'a1');
    expect(out.playlists).toEqual([]);
    expect(out.totals).toEqual({ playlists: 0, screensReached: 0, locations: 0 });
  });

  it('protected playlist membership marks protectedEmergency', async () => {
    const { controller } = makeController({
      items: [{ playlistId: 'p9' }],
      playlists: [{ id: 'p9', name: 'Lockdown', isProtected: true }],
    });
    const out: any = await controller.usage(req, 'a1');
    expect(out.protectedEmergency).toBe(true);
  });
});

describe('DELETE /assets/:id — in-use safety', () => {
  it('removes an in-use asset and retires an empty media playlist schedule in the same transaction', async () => {
    const { controller, prisma } = makeController({
      items: [{ playlistId: 'p1' }],
      playlists: [{ id: 'p1', name: 'Summer Strength', isProtected: false }],
      schedules: [{ id: 's1', playlistId: 'p1', screenId: 'screen1', screenGroupId: null, isActive: true }],
    });
    await expect(controller.remove(req, 'a1')).resolves.toEqual({ deleted: true });
    expect(prisma.client.playlistItem.deleteMany).toHaveBeenCalledWith({ where: { assetId: 'a1', playlist: { tenantId: 't1' } } });
    expect(prisma.client.schedule.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 't1', playlistId: 'p1' } });
    expect(prisma.client.asset.delete).toHaveBeenCalled();
    const audit = prisma.client.auditLog.create.mock.calls[0][0].data;
    expect(JSON.parse(audit.details)).toMatchObject({ removedPlaylistItems: 1, removedSchedules: [{ id: 's1' }] });
  });

  it('keeps protected emergency playlists and their assets intact', async () => {
    const { controller, prisma } = makeController({
      items: [{ playlistId: 'p9' }],
      playlists: [{ id: 'p9', name: 'Lockdown', isProtected: true }],
    });
    await expect(controller.remove(req, 'a1')).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    expect(prisma.client.playlistItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.client.asset.delete).not.toHaveBeenCalled();
  });

  it('promotes another schedule when deleting the last published item', async () => {
    const { controller, prisma } = makeController({
      items: [{ playlistId: 'p1' }],
      playlists: [{ id: 'p1', name: 'Summer Strength', isProtected: false }],
      schedules: [{ id: 's1', playlistId: 'p1', screenId: 'screen1', screenGroupId: null, isActive: true }],
      fallbackSchedule: { id: 's2', playlistId: 'p2', screenId: 'screen1', screenGroupId: null, priority: 1 },
    });
    await controller.remove(req, 'a1');
    expect(prisma.client.schedule.update).toHaveBeenCalledWith({ where: { id: 's2', tenantId: 't1' }, data: { isActive: true } });
    expect(prisma.client.auditLog.create.mock.calls.map(([arg]: any[]) => arg.data.action)).toContain('SCHEDULE_AUTO_REACTIVATED');
  });

  it('keeps publishing when the playlist still has another item', async () => {
    const { controller, prisma } = makeController({
      items: [{ playlistId: 'p1' }],
      remainingItems: 1,
      playlists: [{ id: 'p1', name: 'Summer Strength', isProtected: false }],
      schedules: [{ id: 's1', playlistId: 'p1', screenId: 'screen1', screenGroupId: null, isActive: true }],
    });
    await controller.remove(req, 'a1');
    expect(prisma.client.schedule.deleteMany).not.toHaveBeenCalled();
  });

  it('an unreferenced asset still deletes with the audit row', async () => {
    const { controller, prisma } = makeController({ items: [] });
    const out: any = await controller.remove(req, 'a1');
    expect(out).toEqual({ deleted: true });
    expect(prisma.client.auditLog.create).toHaveBeenCalled();
  });
});

describe('GET /assets — response mode', () => {
  it('bare GET keeps the legacy array shape', async () => {
    const { controller } = makeController({ assets: [{ id: 'a1' }, { id: 'a2' }] });
    const out: any = await controller.list(req);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(2);
  });

  it('take/q opt into { assets, total } with the search composed into the count', async () => {
    const { controller, prisma } = makeController({ assets: [{ id: 'a1' }], total: 148 });
    const out: any = await controller.list(req, '25', undefined, 'recovery');
    expect(out.assets).toHaveLength(1);
    expect(out.total).toBe(148);
    const countWhere = prisma.client.asset.count.mock.calls[0][0].where;
    expect(countWhere.OR.some((c: any) => c.originalName)).toBe(true);
  });
});

// 2026-09-26 — the guard the warned-deletion change had narrowed away. A
// playlist becomes alert media through a tenant's panic default, a screen's
// per-type emergency playlist or a live override WITHOUT being flagged
// isProtected; deleting the only clip in it would leave the next lockdown
// with an empty playlist. The shared emergency-content check now runs inside
// the delete transaction and fails closed.
describe('DELETE /assets/:id — emergency content by any alert-pipeline path', () => {
  it("refuses an asset whose ordinary playlist is a tenant's panic default, before anything is removed", async () => {
    const { controller, prisma } = makeController({
      items: [{ playlistId: 'p-gym' }],
      playlists: [{ id: 'p-gym', name: 'Gym lockdown', isProtected: false, templateId: null }],
      tenantEmergency: { id: 't1' },
    });
    await expect(controller.remove(req, 'a1')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: expect.objectContaining({
        code: 'ASSET_IN_EMERGENCY_CONTENT',
        message: expect.stringContaining('an emergency playlist of tenant t1'),
      }),
    });
    expect(prisma.client.playlistItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.client.asset.delete).not.toHaveBeenCalled();
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses a file a live emergency message still carries, even with no playlist at all', async () => {
    const { controller, prisma } = makeController({ items: [], liveMessage: { id: 'm7' } });
    await expect(controller.remove(req, 'a1')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: expect.objectContaining({ code: 'ASSET_IN_EMERGENCY_CONTENT' }),
    });
    expect(prisma.client.asset.delete).not.toHaveBeenCalled();
  });

  it('the usage pre-check agrees with the delete, so the dialog never offers a refused delete', async () => {
    const { controller } = makeController({
      items: [{ playlistId: 'p-gym' }],
      playlists: [{ id: 'p-gym', name: 'Gym lockdown', isProtected: false }],
      tenantEmergency: { id: 't1' },
    });
    const out: any = await controller.usage(req, 'a1');
    expect(out.protectedEmergency).toBe(true);
  });

  it('fails CLOSED when the check itself cannot run', async () => {
    const { controller, prisma } = makeController({
      items: [{ playlistId: 'p1' }],
      playlists: [{ id: 'p1', name: 'Lobby', isProtected: false, templateId: null }],
    });
    (prisma.client.tenant.findFirst as jest.Mock).mockRejectedValueOnce(new Error('pool exhausted'));
    await expect(controller.remove(req, 'a1')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: expect.objectContaining({ code: 'ASSET_IN_EMERGENCY_CONTENT' }),
    });
    expect(prisma.client.playlistItem.deleteMany).not.toHaveBeenCalled();
  });
});
