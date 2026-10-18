/**
 * ScreenEventsService + the retention cron (2026-10-18): best-effort writes,
 * the dedup that keeps a reporting loop from flooding a screen's ledger, the
 * window read the drawer and the launch gate use, and the leader-leased
 * retention.
 */
import { LEDGER_KIND_LIST, LEDGER_DEDUP_MS, type LedgerEventInput } from './screen-events';
import {
  LEDGER_BULK_MAX_ROWS,
  LEDGER_WINDOW_LIST_MAX,
  ScreenEventsService,
  recordScreenEvent,
  resetScreenEventsDedupForTests,
  writeLedgerRows,
} from './screen-events.service';
import { ScreenEventsRetentionCron } from './screen-events-retention.cron';
import { LEASE } from '../../realtime/leader-lease.service';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');

function db() {
  return {
    screenEvent: {
      create: jest.fn(async ({ data }: any) => ({ id: `ev-${data.kind}` })),
      createMany: jest.fn(async ({ data }: any) => ({ count: data.length })),
      groupBy: jest.fn(async () => [] as any[]),
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => [] as any[]),
    },
  };
}

beforeEach(() => resetScreenEventsDedupForTests());

const reload = (over: Partial<LedgerEventInput> = {}): LedgerEventInput => ({
  screenId: 'scr-1', tenantId: 'ten-1', kind: 'page-reload', cause: 'wedge-detector', source: 'system', ...over,
});

describe('record', () => {
  it('writes one row with the ledger fields', async () => {
    const client = db();
    const svc = new ScreenEventsService({ client } as any);
    await expect(svc.record(reload({ detail: { corrId: 'w-1' }, versionCode: 10141 }), new Date(NOW))).resolves.toBe(true);
    expect(client.screenEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        screenId: 'scr-1', tenantId: 'ten-1', kind: 'page-reload', cause: 'wedge-detector', source: 'system',
        detail: { corrId: 'w-1' }, versionCode: 10141, sessionId: null, createdAt: new Date(NOW),
      }),
      select: { id: true },
    });
  });

  it('a repeat inside 60 s is folded; another cause, another screen or a later minute is not', async () => {
    const client = db();
    const svc = new ScreenEventsService({ client } as any);
    expect(await svc.record(reload(), new Date(NOW))).toBe(true);
    expect(await svc.record(reload(), new Date(NOW + 30_000))).toBe(false);
    expect(await svc.record(reload({ cause: 'operator' }), new Date(NOW + 30_000))).toBe(true);
    expect(await svc.record(reload({ screenId: 'scr-2' }), new Date(NOW + 30_000))).toBe(true);
    expect(await svc.record(reload(), new Date(NOW + LEDGER_DEDUP_MS + 1))).toBe(true);
    expect(client.screenEvent.create).toHaveBeenCalledTimes(4);
  });

  it('a reporting loop cannot flood: 600 identical reports in 10 minutes → one row a minute', async () => {
    const client = db();
    const svc = new ScreenEventsService({ client } as any);
    for (let i = 0; i < 600; i++) await svc.record(reload(), new Date(NOW + i * 1_000));
    expect(client.screenEvent.create).toHaveBeenCalledTimes(10);
  });

  it('an identity key holds for its own window (a session ends once)', async () => {
    const client = db();
    const svc = new ScreenEventsService({ client } as any);
    const stop = reload({ kind: 'engine-stop', cause: 'activity-paused', sessionId: 's-1', dedupMs: 24 * 3_600_000 });
    expect(await svc.record(stop, new Date(NOW))).toBe(true);
    expect(await svc.record(stop, new Date(NOW + 3_600_000))).toBe(false);
  });

  it('claims in Redis first, so replicas agree; a held key is a duplicate', async () => {
    const client = db();
    const set = jest.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    const redis: any = { isConnected: () => true, publisher: { set } };
    const svc = new ScreenEventsService({ client } as any, redis);
    expect(await svc.record(reload(), new Date(NOW))).toBe(true);
    expect(set).toHaveBeenCalledWith('venueos:screen-event:scr-1:page-reload:wedge-detector', '1', 'PX', LEDGER_DEDUP_MS, 'NX');
    // another replica already holds this one
    expect(await new ScreenEventsService({ client } as any, redis).record(reload(), new Date(NOW + 1_000))).toBe(false);
    expect(client.screenEvent.create).toHaveBeenCalledTimes(1);
  });

  it('a Redis that cannot answer leaves this process to decide (still bounded)', async () => {
    const client = db();
    const redis: any = { isConnected: () => true, publisher: { set: jest.fn().mockRejectedValue(new Error('down')) } };
    const svc = new ScreenEventsService({ client } as any, redis);
    expect(await svc.record(reload(), new Date(NOW))).toBe(true);
    expect(await svc.record(reload(), new Date(NOW + 1_000))).toBe(false);
  });

  it('never throws: a failed insert answers false', async () => {
    const client = db();
    client.screenEvent.create.mockRejectedValue(new Error('pool timeout'));
    const svc = new ScreenEventsService({ client } as any);
    await expect(svc.record(reload(), new Date(NOW))).resolves.toBe(false);
  });

  it('writes nothing for a screen with no tenant, or an unknown kind', async () => {
    const client = db();
    const svc = new ScreenEventsService({ client } as any);
    expect(await svc.record(reload({ tenantId: null }))).toBe(false);
    expect(await svc.record(reload({ kind: 'nope' as any }))).toBe(false);
    expect(client.screenEvent.create).not.toHaveBeenCalled();
  });

  it('one dedup map per process: a standalone writer folds against the injected service', async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    try {
      const client = db();
      expect(await new ScreenEventsService({ client } as any).record(reload())).toBe(true);
      expect(await recordScreenEvent({ client } as any, reload())).toBe(false);
      expect(await recordScreenEvent({ client } as any, null)).toBe(false);
      expect(client.screenEvent.create).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('recordAll writes each independent event once, in order', async () => {
    const client = db();
    const svc = new ScreenEventsService({ client } as any);
    expect(await svc.recordAll([reload(), reload(), reload({ cause: 'operator' })], new Date(NOW))).toBe(2);
  });
});

describe('recordMany (one event on many screens)', () => {
  it('chunks createMany and caps the rows', async () => {
    const client = db();
    const rows = Array.from({ length: LEDGER_BULK_MAX_ROWS + 500 }, (_, i) => reload({ screenId: `s-${i}`, cause: 'operator', source: 'operator' }));
    const n = await new ScreenEventsService({ client } as any).recordMany(rows, new Date(NOW));
    expect(n).toBe(LEDGER_BULK_MAX_ROWS);
    expect(client.screenEvent.createMany).toHaveBeenCalledTimes(LEDGER_BULK_MAX_ROWS / 1000);
  });

  it('a failed chunk is logged, the rest still go, nothing throws', async () => {
    const client = db();
    client.screenEvent.createMany.mockRejectedValueOnce(new Error('boom'));
    const warn = jest.fn();
    const rows = Array.from({ length: 1500 }, (_, i) => reload({ screenId: `s-${i}` }));
    await expect(writeLedgerRows({ client } as any, rows, new Date(NOW), warn)).resolves.toBe(500);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('skips rows that cannot be written (no tenant)', async () => {
    const client = db();
    await writeLedgerRows({ client } as any, [reload(), reload({ tenantId: null })], new Date(NOW));
    expect(client.screenEvent.createMany.mock.calls[0][0].data).toHaveLength(1);
  });
});

describe('window (the drawer + the launch gate)', () => {
  it('reads the summary from one grouped count and one drill count, and lists the newest rows', async () => {
    const client = db();
    client.screenEvent.groupBy.mockResolvedValue([
      { kind: 'page-reload', cause: 'operator', _count: { _all: 2 } },
      { kind: 'emergency-start', cause: 'lockdown', _count: { _all: 1 } },
      { kind: 'engine-stop', cause: 'content-changed', _count: { _all: 3 } },
    ]);
    client.screenEvent.count.mockResolvedValue(1);
    client.screenEvent.findMany.mockResolvedValue([
      { id: 'e2', kind: 'emergency-start', cause: 'lockdown', source: 'operator', detail: { drill: true }, sessionId: null, versionCode: null, createdAt: new Date(NOW - 1_000) },
      { id: 'e1', kind: 'page-reload', cause: 'operator', source: 'operator', detail: null, sessionId: null, versionCode: 10141, createdAt: new Date(NOW - 2_000) },
    ]);
    const out = await new ScreenEventsService({ client } as any).window('scr-1', 72, NOW);
    expect(out.summary).toEqual({ interruptions: 2, drills: 1, byKind: { 'page-reload': 2, 'emergency-start': 1, 'engine-stop': 3 } });
    expect(out.since).toBe(new Date(NOW - 72 * 3_600_000).toISOString());
    expect(out.events).toEqual([
      expect.objectContaining({ id: 'e2', kind: 'emergency-start', drill: true, interruption: false, at: new Date(NOW - 1_000).toISOString() }),
      expect.objectContaining({ id: 'e1', kind: 'page-reload', drill: false, interruption: true, versionCode: 10141 }),
    ]);
    expect(out.truncated).toBe(false);
    const where = { screenId: 'scr-1', kind: { in: LEDGER_KIND_LIST }, createdAt: { gte: new Date(NOW - 72 * 3_600_000) } };
    expect(client.screenEvent.groupBy).toHaveBeenCalledWith({ by: ['kind', 'cause'], where, _count: { _all: true } });
    expect(client.screenEvent.count).toHaveBeenCalledWith({ where: { ...where, kind: 'emergency-start', detail: { path: ['drill'], equals: true } } });
    expect(client.screenEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, take: LEDGER_WINDOW_LIST_MAX + 1 }));
  });

  it('says when the list is cut (the summary still counts every row)', async () => {
    const client = db();
    client.screenEvent.findMany.mockResolvedValue(
      Array.from({ length: LEDGER_WINDOW_LIST_MAX + 1 }, (_, i) => ({ id: `e${i}`, kind: 'page-reload', cause: 'operator', createdAt: new Date(NOW - i) })),
    );
    const out = await new ScreenEventsService({ client } as any).window('scr-1', 24, NOW);
    expect(out.events).toHaveLength(LEDGER_WINDOW_LIST_MAX);
    expect(out.truncated).toBe(true);
  });
});

describe('retention cron', () => {
  const client = () => ({ $executeRaw: jest.fn(async () => 3) });

  it('prunes past 30 days and past 2,000 rows per screen, bounded per tick', async () => {
    const c = client();
    const cron = new ScreenEventsRetentionCron({ client: c } as any, { tryAcquire: jest.fn(async () => ({ leader: true })) } as any);
    await expect(cron.sweep(NOW)).resolves.toEqual({ aged: 3, capped: 3 });
    expect(c.$executeRaw).toHaveBeenCalledTimes(2);
    const [ageSql, ...ageValues] = c.$executeRaw.mock.calls[0] as any[];
    expect(ageSql.join('?')).toMatch(/DELETE FROM "screen_events"[\s\S]*"created_at" < \?[\s\S]*LIMIT \?/);
    expect(ageValues).toEqual([new Date(NOW - ScreenEventsRetentionCron.MAX_AGE_MS), ScreenEventsRetentionCron.DELETE_BATCH]);
    const [capSql, ...capValues] = c.$executeRaw.mock.calls[1] as any[];
    expect(capSql.join('?')).toMatch(/row_number\(\) OVER \([\s\S]*PARTITION BY "screen_id" ORDER BY "created_at" DESC, "id" DESC/);
    expect(capValues).toEqual([2000, 2000, ScreenEventsRetentionCron.DELETE_BATCH]);
  });

  it('runs on the leader only', async () => {
    const c = client();
    const tryAcquire = jest.fn(async () => ({ leader: false }));
    const cron = new ScreenEventsRetentionCron({ client: c } as any, { tryAcquire } as any);
    await expect(cron.sweep(NOW)).resolves.toBeNull();
    expect(tryAcquire).toHaveBeenCalledWith(LEASE.SCREEN_EVENTS_RETENTION, undefined);
    expect(c.$executeRaw).not.toHaveBeenCalled();
  });

  it('a failing statement is logged and the other still runs', async () => {
    const c = { $executeRaw: jest.fn().mockRejectedValueOnce(new Error('lock timeout')).mockResolvedValueOnce(4) };
    const cron = new ScreenEventsRetentionCron({ client: c } as any);
    await expect(cron.sweep(NOW)).resolves.toEqual({ aged: 0, capped: 4 });
  });

  it('never starts a timer under test', () => {
    const cron = new ScreenEventsRetentionCron({ client: client() } as any);
    cron.onModuleInit();
    expect((cron as any).timer).toBeUndefined();
  });
});
