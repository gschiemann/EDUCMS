import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';

/**
 * Offline detection is TRANSITION-based since 2026-09-02 (efficiency audit
 * P0-4). The scanner used to re-select all 197 offline screens every 60 s and
 * hand the database a ~200-row `createMany({ skipDuplicates })` whose rows all
 * conflicted — correct output, pointless work, and the source of the repeated
 * `Notification.createMany` slow-query warnings.
 *
 * The contract these tests pin:
 *   - a crossing (healthy → offline) fires EXACTLY once
 *   - a steady-offline screen fires ZERO times on every later scan
 *   - a recovery (offline → healthy) is detected once and re-arms the screen
 *   - a restart does NOT re-fire (state resumes from Redis)
 *   - a screen that flaps within one interval fires once
 *   - the emitted rows are byte-identical to the pre-transition scanner
 */

/** Minimal ioredis stand-in: only GET/SET with EX are used by the service. */
class FakeRedis {
  store = new Map<string, string>();
  get = jest.fn(async (key: string) => this.store.get(key) ?? null);
  set = jest.fn(async (key: string, value: string, ..._rest: unknown[]) => {
    this.store.set(key, value);
    return 'OK';
  });
}

function makeRedisService(publisher: FakeRedis | null): RedisService {
  return { publisher } as unknown as RedisService;
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let notification: any;
  let screen: any;
  let tenant: any;
  let redis: FakeRedis;

  /** Build a service bound to the same fakes (used to simulate a restart). */
  async function buildService(sharedRedis: FakeRedis | null): Promise<NotificationsService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: { client: { notification, screen, tenant } } },
        { provide: RedisService, useValue: makeRedisService(sharedRedis) },
      ],
    }).compile();
    return module.get(NotificationsService);
  }

  beforeEach(async () => {
    notification = {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      // Per-screen offline rows go out as ONE createMany({ skipDuplicates }).
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    screen = { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) };
    // scanOfflineScreens looks up tenant name+parentId to roll offline alerts
    // up to HQ. Default: no parent (leaf).
    tenant = { findMany: jest.fn().mockResolvedValue([]) };
    redis = new FakeRedis();

    service = await buildService(redis);
  });

  /**
   * Run one scan whose sole purpose is to establish the baseline. A cold start
   * deliberately notifies nothing (otherwise every deploy is a 197-row storm).
   */
  async function seed(rows: any[]) {
    screen.findMany.mockResolvedValue(rows);
    const res = await service.scanOfflineScreens(5);
    expect(res.seeded).toBe(true);
    expect(res.notified).toBe(0);
    notification.createMany.mockClear();
    notification.upsert.mockClear();
    screen.groupBy.mockClear();
    tenant.findMany.mockClear();
    return res;
  }

  const offlineFor = (id: string, name: string, tenantId: string, minutes: number) => ({
    id,
    name,
    tenantId,
    lastPingAt: new Date(Date.now() - minutes * 60 * 1000),
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

  // ── The candidate read ───────────────────────────────────────────────────
  describe('scanOfflineScreens — the candidate query', () => {
    it('is bounded, ordered, and excludes revoked screens and ARCHIVED tenants', async () => {
      screen.findMany.mockResolvedValue([]);
      await service.scanOfflineScreens(5);

      const arg = screen.findMany.mock.calls[0][0];
      expect(arg.where.status).toEqual({ not: 'REVOKED' });
      expect(arg.where.tenantId).toEqual({ not: null });
      expect(arg.where.lastPingAt.lt).toBeInstanceOf(Date);
      // Archived tenants must never be scanned (they have no operator).
      expect(arg.where.tenant).toEqual({ is: { archivedAt: null } });
      expect(arg.take).toBe(5000);
      expect(arg.orderBy).toEqual({ lastPingAt: 'desc' });
    });
  });

  // ── Transition semantics ─────────────────────────────────────────────────
  describe('scanOfflineScreens — transitions', () => {
    it('a COLD START seeds the baseline and notifies nothing', async () => {
      screen.findMany.mockResolvedValue([
        offlineFor('s1', 'Lobby', 't1', 10),
        offlineFor('s2', 'Hall', 't1', 20),
      ]);

      const res = await service.scanOfflineScreens(5);

      expect(res).toMatchObject({ found: 2, notified: 0, infraEvents: 0, seeded: true });
      expect(notification.createMany).not.toHaveBeenCalled();
      // No grouping / tenant lookup either — a cold start is one SELECT.
      expect(screen.groupBy).not.toHaveBeenCalled();
      expect(tenant.findMany).not.toHaveBeenCalled();
    });

    it('a CROSSING fires exactly once and STEADY-offline fires zero afterwards', async () => {
      await seed([offlineFor('s1', 'Lobby', 't1', 10)]);

      // s2 crosses.
      const rows = [offlineFor('s1', 'Lobby', 't1', 11), offlineFor('s2', 'Hall', 't1', 6)];
      screen.findMany.mockResolvedValue(rows);
      screen.groupBy.mockResolvedValue([{ tenantId: 't1', _count: { _all: 10 } }]);
      notification.createMany.mockResolvedValue({ count: 1 });

      const first = await service.scanOfflineScreens(5);
      expect(first.crossings).toBe(1);
      expect(first.notified).toBe(1);
      expect(notification.createMany).toHaveBeenCalledTimes(1);
      const batch = notification.createMany.mock.calls[0][0].data;
      expect(batch).toHaveLength(1);
      expect(batch[0].kind).toBe('SCREEN_OFFLINE');
      expect(batch[0].title).toBe('Screen offline: Hall');
      expect(batch[0].dedupeKey).toMatch(/^screen-offline:s2:\d+$/);
      expect(notification.createMany.mock.calls[0][0].skipDuplicates).toBe(true);

      // Three more scans with the SAME screens still offline: zero writes.
      notification.createMany.mockClear();
      tenant.findMany.mockClear();
      for (let i = 0; i < 3; i++) {
        const res = await service.scanOfflineScreens(5);
        expect(res.crossings).toBe(0);
        expect(res.notified).toBe(0);
      }
      expect(notification.createMany).not.toHaveBeenCalled();
      // And no grouping / tenant lookup on a no-transition tick either.
      expect(tenant.findMany).not.toHaveBeenCalled();
    });

    it('a RECOVERY is reported once and re-arms the screen for the next drop', async () => {
      await seed([offlineFor('s1', 'Lobby', 't1', 10)]);

      // s1 comes back → no longer in the candidate set.
      screen.findMany.mockResolvedValue([]);
      const recoveredScan = await service.scanOfflineScreens(5);
      expect(recoveredScan.recovered).toBe(1);
      expect(recoveredScan.notified).toBe(0);
      expect(notification.createMany).not.toHaveBeenCalled();

      // Recovery is reported exactly ONCE — the next quiet scan is silent.
      const quiet = await service.scanOfflineScreens(5);
      expect(quiet.recovered).toBe(0);

      // …and the screen is re-armed: dropping again fires a fresh crossing.
      screen.findMany.mockResolvedValue([offlineFor('s1', 'Lobby', 't1', 6)]);
      screen.groupBy.mockResolvedValue([{ tenantId: 't1', _count: { _all: 10 } }]);
      notification.createMany.mockResolvedValue({ count: 1 });
      const again = await service.scanOfflineScreens(5);
      expect(again.crossings).toBe(1);
      expect(again.notified).toBe(1);
    });

    it('a screen that FLAPS within one interval fires once (the scan sees one state)', async () => {
      await seed([]);

      // The screen dropped and came back between ticks; at scan time it is
      // offline, so exactly one crossing is recorded.
      screen.findMany.mockResolvedValue([offlineFor('s1', 'Lobby', 't1', 6)]);
      screen.groupBy.mockResolvedValue([{ tenantId: 't1', _count: { _all: 10 } }]);
      notification.createMany.mockResolvedValue({ count: 1 });
      const a = await service.scanOfflineScreens(5);
      expect(a.crossings).toBe(1);

      // Still offline on the next tick → no second row.
      notification.createMany.mockClear();
      const b = await service.scanOfflineScreens(5);
      expect(b.crossings).toBe(0);
      expect(notification.createMany).not.toHaveBeenCalled();
    });

    it('a RESTART does not re-fire — state resumes from Redis', async () => {
      await seed([offlineFor('s1', 'Lobby', 't1', 10), offlineFor('s2', 'Hall', 't1', 20)]);
      expect(redis.set).toHaveBeenCalled();

      // New process, same Redis: the known-offline set is restored, so the
      // still-offline screens are NOT treated as fresh crossings.
      const restarted = await buildService(redis);
      screen.findMany.mockResolvedValue([
        offlineFor('s1', 'Lobby', 't1', 11),
        offlineFor('s2', 'Hall', 't1', 21),
      ]);

      const res = await restarted.scanOfflineScreens(5);
      expect(res.seeded).toBe(false);
      expect(res.crossings).toBe(0);
      expect(res.notified).toBe(0);
      expect(notification.createMany).not.toHaveBeenCalled();
    });

    it('WITHOUT Redis the scan still works — it just seeds silently on every boot', async () => {
      const noRedis = await buildService(null);
      screen.findMany.mockResolvedValue([offlineFor('s1', 'Lobby', 't1', 10)]);

      const seeded = await noRedis.scanOfflineScreens(5);
      expect(seeded.seeded).toBe(true);
      expect(seeded.notified).toBe(0);

      // In-process state still gives transition semantics within this process.
      screen.findMany.mockResolvedValue([
        offlineFor('s1', 'Lobby', 't1', 11),
        offlineFor('s2', 'Hall', 't1', 6),
      ]);
      screen.groupBy.mockResolvedValue([{ tenantId: 't1', _count: { _all: 10 } }]);
      notification.createMany.mockResolvedValue({ count: 1 });
      const res = await noRedis.scanOfflineScreens(5);
      expect(res.crossings).toBe(1);
      expect(res.notified).toBe(1);
    });
  });

  // ── Row shape (must stay byte-identical — the dashboard reads these) ─────
  describe('scanOfflineScreens — emitted row shape', () => {
    it('per-screen row keeps its exact title / body / link / dedupe key', async () => {
      await seed([]);

      const lastPingAt = new Date(Date.now() - 10 * 60 * 1000);
      screen.findMany.mockResolvedValue([
        { id: 's1', name: 'Lobby', tenantId: 't1', lastPingAt },
      ]);
      screen.groupBy.mockResolvedValue([{ tenantId: 't1', _count: { _all: 10 } }]);
      notification.createMany.mockResolvedValue({ count: 1 });

      await service.scanOfflineScreens(5);

      const bucket = Math.floor(lastPingAt.getTime() / (60 * 60 * 1000));
      expect(notification.createMany.mock.calls[0][0].data[0]).toEqual({
        tenantId: 't1',
        kind: 'SCREEN_OFFLINE',
        title: 'Screen offline: Lobby',
        body: `No heartbeat since ${lastPingAt.toISOString()}.`,
        link: '/screens',
        dedupeKey: `screen-offline:s1:${bucket}`,
      });
    });

    it('ALSO rolls an offline child screen up to its parent (HQ)', async () => {
      await seed([]);

      screen.findMany.mockResolvedValue([offlineFor('s1', 'Lobby', 'austin', 10)]);
      screen.groupBy.mockResolvedValue([{ tenantId: 'austin', _count: { _all: 10 } }]);
      tenant.findMany.mockResolvedValue([
        { id: 'austin', name: 'Acme — Austin', parentId: 'corp' },
      ]);
      notification.createMany.mockResolvedValue({ count: 2 });

      const res = await service.scanOfflineScreens(5);
      expect(res.crossings).toBe(1);

      const batch = notification.createMany.mock.calls[0][0].data;
      expect(batch).toHaveLength(2); // one for the store, one rolled up to HQ
      const storeRow = batch.find((r: any) => r.tenantId === 'austin');
      const hqRow = batch.find((r: any) => r.tenantId === 'corp');
      expect(storeRow?.dedupeKey).toMatch(/^screen-offline:s1:/);
      expect(hqRow).toBeTruthy();
      expect(hqRow.kind).toBe('SCREEN_OFFLINE');
      expect(hqRow.title).toContain('Acme — Austin');
      expect(hqRow.dedupeKey).toMatch(/^screen-offline-hq:s1:/);
    });
  });

  // ── Cohort outage (INFRA_EVENT) ─────────────────────────────────────────
  describe('scanOfflineScreens — cohort outage aggregation', () => {
    it('emits INFRA_EVENT and defers the per-screen rows when >50% drop inside the window', async () => {
      await seed([]);

      // Tenant fleet is 5 paired screens; 4 cross at once (80% > 50%).
      screen.findMany.mockResolvedValue([
        offlineFor('s1', 'Lobby', 't1', 6),
        offlineFor('s2', 'Hall', 't1', 6),
        offlineFor('s3', 'Caf', 't1', 6),
        offlineFor('s4', 'Gym', 't1', 6),
      ]);
      screen.groupBy.mockResolvedValue([{ tenantId: 't1', _count: { _all: 5 } }]);
      notification.upsert.mockImplementation(async (args: any) => ({ id: args.create.dedupeKey }));

      const res = await service.scanOfflineScreens(5);
      expect(res.crossings).toBe(4);
      expect(res.notified).toBe(0); // per-screen suppressed
      expect(res.infraEvents).toBe(1); // one aggregated notification

      expect(notification.createMany).not.toHaveBeenCalled();
      expect(notification.upsert).toHaveBeenCalledTimes(1);
      const created = notification.upsert.mock.calls[0][0].create;
      expect(created.kind).toBe('INFRA_EVENT');
      expect(created.tenantId).toBe('t1');
      expect(created.title).toBe('Possible infrastructure event — 4/5 screens dropped');
      expect(created.dedupeKey).toMatch(/^infra-event:t1:/);
    });

    it('a suppressed screen still gets its per-screen row once the cohort window closes', async () => {
      // Controlled clock: the cohort window is 90 s of WALL time, so the
      // "window closed" tick has to actually be later.
      let nowMs = Date.now();
      const clock = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
      try {
        await seed([]);

        const dropped = [
          offlineFor('s1', 'Lobby', 't1', 6),
          offlineFor('s2', 'Hall', 't1', 6),
          offlineFor('s3', 'Caf', 't1', 6),
        ];
        screen.findMany.mockResolvedValue(dropped);
        screen.groupBy.mockResolvedValue([{ tenantId: 't1', _count: { _all: 3 } }]);
        notification.upsert.mockImplementation(async (a: any) => ({ id: a.create.dedupeKey }));

        const outage = await service.scanOfflineScreens(5);
        expect(outage.infraEvents).toBe(1);
        expect(outage.notified).toBe(0);

        // 2 minutes later: nothing new crossed, the 90 s cohort window has
        // closed, the three screens are still offline → their deferred rows
        // are flushed ONCE.
        nowMs += 120_000;
        notification.createMany.mockResolvedValue({ count: 3 });
        const flush = await service.scanOfflineScreens(5);
        expect(flush.crossings).toBe(0);
        expect(flush.notified).toBe(3);
        expect(notification.createMany.mock.calls[0][0].data).toHaveLength(3);

        // …and never again.
        notification.createMany.mockClear();
        nowMs += 60_000;
        const quiet = await service.scanOfflineScreens(5);
        expect(quiet.notified).toBe(0);
        expect(notification.createMany).not.toHaveBeenCalled();
      } finally {
        clock.mockRestore();
      }
    });

    it('does NOT trigger INFRA_EVENT for tiny fleets', async () => {
      await seed([]);

      screen.findMany.mockResolvedValue([
        offlineFor('s1', 'Lobby', 't1', 6),
        offlineFor('s2', 'Hall', 't1', 6),
      ]);
      // Fleet of 2 — below COHORT_MIN_FLEET (default 3). Even though 100% of
      // the fleet just dropped, this falls through to per-screen rows.
      screen.groupBy.mockResolvedValue([{ tenantId: 't1', _count: { _all: 2 } }]);
      notification.createMany.mockResolvedValue({ count: 2 });

      const res = await service.scanOfflineScreens(5);
      expect(res.crossings).toBe(2);
      expect(res.notified).toBe(2);
      expect(res.infraEvents).toBe(0);
      expect(notification.upsert).not.toHaveBeenCalled();
      expect(notification.createMany).toHaveBeenCalledTimes(1);
    });
  });
});
