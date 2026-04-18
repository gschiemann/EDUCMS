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
      upsert: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    screen = { findMany: jest.fn() };

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
    screen.findMany.mockResolvedValue([
      { id: 's1', name: 'Lobby', tenantId: 't1', lastPingAt: new Date(now - 10 * 60 * 1000) },
      { id: 's2', name: 'Hall', tenantId: 't1', lastPingAt: new Date(now - 20 * 60 * 1000) },
    ]);
    // dedupe path now goes through upsert (audit fix #11)
    notification.upsert.mockImplementation(async (args: any) => ({ id: args.create.dedupeKey }));

    const res = await service.scanOfflineScreens(5);
    expect(res.found).toBe(2);
    expect(res.notified).toBe(2);
    expect(notification.upsert).toHaveBeenCalledTimes(2);
    const createdKinds = notification.upsert.mock.calls.map((c: any[]) => c[0].create.kind);
    expect(createdKinds).toEqual(['SCREEN_OFFLINE', 'SCREEN_OFFLINE']);
  });
});
