import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let notification: any;
  let screen: any;

  beforeEach(async () => {
    notification = {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      // createMany: the per-screen offline path was collapsed from N serial
      // upserts to a single createMany({ skipDuplicates }) (Audit P1 N+1 fix);
      // scanOfflineScreens now reports `notified` from its `count`.
      createMany: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    screen = { findMany: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: { client: { notification, screen } } },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  it('creates a notification when no dedupeKey collision', async () => {
    notification.create.mockResolvedValue({ id: 'n1' });
    const out = await service.notify({
      tenantId: 't1',
      kind: 'INFO',
      title: 'hi',
    });
    expect(out).toEqual({ id: 'n1' });
    expect(notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: 't1', kind: 'INFO', title: 'hi' }),
      }),
    );
  });

  it('dedupes via upsert when a matching key already exists', async () => {
    // After audit fix #11 the dedupe path uses upsert (atomic), not
    // findUnique→create. The DB returns the existing row when the
    // unique key collides; the no-op `update: {}` preserves it.
    notification.upsert.mockResolvedValue({ id: 'existing' });
    const out = await service.notify({
      tenantId: 't1',
      kind: 'SCREEN_OFFLINE',
      title: 'x',
      dedupeKey: 'screen-offline:abc:123',
    });
    expect(out).toEqual({ id: 'existing' });
    expect(notification.create).not.toHaveBeenCalled();
    expect(notification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId_dedupeKey: { tenantId: 't1', dedupeKey: 'screen-offline:abc:123' },
        }),
        create: expect.objectContaining({ kind: 'SCREEN_OFFLINE' }),
        update: {},
      }),
    );
  });

  it('listForUser includes tenant-wide + direct with newest first', async () => {
    notification.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const out = await service.listForUser({ tenantId: 't1', userId: 'u1', limit: 10 });
    expect(out).toHaveLength(2);
    const arg = notification.findMany.mock.calls[0][0];
    expect(arg.where.tenantId).toBe('t1');
    expect(arg.where.OR).toEqual([{ userId: 'u1' }, { userId: null }]);
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    expect(arg.take).toBe(10);
  });

  it('markRead fails silently if notification not visible to user', async () => {
    notification.findFirst.mockResolvedValue(null);
    const res = await service.markRead('n1', 't1', 'u1');
    expect(res).toEqual({ ok: false });
    expect(notification.update).not.toHaveBeenCalled();
  });

  it('markRead flips isRead when visible', async () => {
    notification.findFirst.mockResolvedValue({ id: 'n1' });
    notification.update.mockResolvedValue({ id: 'n1', isRead: true });
    const res = await service.markRead('n1', 't1', 'u1');
    expect(res).toEqual({ ok: true });
    expect(notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { isRead: true },
    });
  });

  it('markAllRead returns the count', async () => {
    notification.updateMany.mockResolvedValue({ count: 4 });
    const res = await service.markAllRead('t1', 'u1');
    expect(res).toEqual({ updated: 4 });
  });

  it('scanOfflineScreens creates one dedup-keyed notification per screen', async () => {
    const now = Date.now();
    // Both screens offline for >5min AND >90s before that — i.e. NOT
    // recently dropped. Per-screen path, no infra event.
    screen.findMany.mockResolvedValue([
      { id: 's1', name: 'Lobby', tenantId: 't1', lastPingAt: new Date(now - 10 * 60 * 1000) },
      { id: 's2', name: 'Hall', tenantId: 't1', lastPingAt: new Date(now - 20 * 60 * 1000) },
    ]);
    screen.groupBy.mockResolvedValue([
      { tenantId: 't1', _count: { _all: 10 } },
    ]);
    // Per-screen offline notifications now go through a single
    // createMany({ skipDuplicates }) (Audit P1 N+1 fix) — `notified` is its
    // returned count. The infra-event path still uses notify()/upsert, but
    // a 2/10 drop is below the cohort threshold so it stays per-screen.
    notification.createMany.mockResolvedValue({ count: 2 });

    const res = await service.scanOfflineScreens(5);
    expect(res.found).toBe(2);
    expect(res.notified).toBe(2);
    expect(res.infraEvents).toBe(0);
    expect(notification.upsert).not.toHaveBeenCalled();
    expect(notification.createMany).toHaveBeenCalledTimes(1);
    const batch = notification.createMany.mock.calls[0][0].data;
    expect(batch.map((r: any) => r.kind)).toEqual(['SCREEN_OFFLINE', 'SCREEN_OFFLINE']);
    expect(notification.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it('scanOfflineScreens emits INFRA_EVENT and suppresses per-screen when >50% drop in 90s', async () => {
    const now = Date.now();
    // 5-min threshold = 300s. Screens dropped 320-340s ago (i.e.
    // 20-40s past the threshold, well within the 90s cohort window).
    const recent = (s: number) => new Date(now - (300 + s) * 1000);
    screen.findMany.mockResolvedValue([
      { id: 's1', name: 'Lobby',   tenantId: 't1', lastPingAt: recent(20) },
      { id: 's2', name: 'Hall',    tenantId: 't1', lastPingAt: recent(25) },
      { id: 's3', name: 'Caf',     tenantId: 't1', lastPingAt: recent(30) },
      { id: 's4', name: 'Gym',     tenantId: 't1', lastPingAt: recent(40) },
    ]);
    // Tenant fleet is 5 paired screens; 4 just dropped (80% > 50% threshold).
    screen.groupBy.mockResolvedValue([
      { tenantId: 't1', _count: { _all: 5 } },
    ]);
    notification.upsert.mockImplementation(async (args: any) => ({ id: args.create.dedupeKey }));

    const res = await service.scanOfflineScreens(5);
    expect(res.found).toBe(4);
    expect(res.notified).toBe(0);          // per-screen suppressed
    expect(res.infraEvents).toBe(1);       // one aggregated notification

    // Confirm we wrote INFRA_EVENT, not SCREEN_OFFLINE
    expect(notification.upsert).toHaveBeenCalledTimes(1);
    const created = notification.upsert.mock.calls[0][0].create;
    expect(created.kind).toBe('INFRA_EVENT');
    expect(created.tenantId).toBe('t1');
    expect(created.dedupeKey).toMatch(/^infra-event:t1:/);
  });

  it('scanOfflineScreens does NOT trigger INFRA_EVENT for tiny fleets', async () => {
    const now = Date.now();
    const recent = (s: number) => new Date(now - (300 + s) * 1000);
    screen.findMany.mockResolvedValue([
      { id: 's1', name: 'Lobby', tenantId: 't1', lastPingAt: recent(20) },
      { id: 's2', name: 'Hall',  tenantId: 't1', lastPingAt: recent(40) },
    ]);
    // Fleet of 2 — below COHORT_MIN_FLEET (default 3). Even though
    // 100% of the fleet just dropped, this should fall through to
    // per-screen notifications (the dropping rate isn't statistically
    // meaningful at this scale) — i.e. the createMany batch path, not
    // an aggregated INFRA_EVENT upsert.
    screen.groupBy.mockResolvedValue([
      { tenantId: 't1', _count: { _all: 2 } },
    ]);
    notification.createMany.mockResolvedValue({ count: 2 });

    const res = await service.scanOfflineScreens(5);
    expect(res.found).toBe(2);
    expect(res.notified).toBe(2);
    expect(res.infraEvents).toBe(0);
    expect(notification.upsert).not.toHaveBeenCalled();
    expect(notification.createMany).toHaveBeenCalledTimes(1);
  });
});
