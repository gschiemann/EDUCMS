import { CapacityWatchService, buildAlertEmail, evaluateReadings, Reading } from './capacity-watch.service';
import { METRIC_BY_KEY, tableMetricDef } from './capacity-metrics';
import { parseThresholds } from './capacity-math';

const T = parseThresholds({} as NodeJS.ProcessEnv);
const NOW = new Date('2026-10-12T12:00:00Z');
const GB = 1024 ** 3;

function reading(key: string, value: number, limit: number | null): Reading {
  return { def: METRIC_BY_KEY.get(key)!, value, limit };
}

function makeService(opts: { lease?: any; mailer?: any; prisma?: any } = {}) {
  const prisma = opts.prisma ?? {
    client: {
      $queryRaw: jest.fn().mockResolvedValue([]),
      screen: { count: jest.fn().mockResolvedValue(10) },
      capacitySample: { createMany: jest.fn(), deleteMany: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
      capacityAlertState: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
    },
  };
  const mailer = opts.mailer ?? { sendAlert: jest.fn().mockResolvedValue(undefined) };
  const svc = new CapacityWatchService(prisma, mailer, undefined, opts.lease);
  return { svc, prisma, mailer };
}

describe('evaluateReadings', () => {
  it('flags only metrics over threshold, skips informational ones', () => {
    const readings = [
      reading('db_size', 6.5 * GB, 8 * GB), // 81% warn
      reading('storage_bytes', 10 * GB, 100 * GB), // 10% ok
      { def: tableMetricDef('screens'), value: 5 * GB, limit: null },
    ];
    const { decisions, toAlert } = evaluateReadings(readings, new Map(), NOW, T);
    expect(decisions.map((d) => [d.key, d.level])).toEqual([
      ['db_size', 'warn'],
      ['storage_bytes', 'ok'],
    ]);
    expect(toAlert.map((a) => a.key)).toEqual(['db_size']);
  });

  it('respects remembered state (no repeat inside a day)', () => {
    const states = new Map([['db_size', { level: 'warn' as const, lastAlertAt: new Date(NOW.getTime() - 3600_000) }]]);
    const { toAlert, decisions } = evaluateReadings([reading('db_size', 6.5 * GB, 8 * GB)], states, NOW, T);
    expect(toAlert).toHaveLength(0);
    expect(decisions[0].stampAlert).toBe(false);
  });
});

describe('buildAlertEmail', () => {
  it('names the metric, percentage, and exact upgrade action; critical leads the subject', () => {
    const { toAlert } = evaluateReadings(
      [reading('db_connections', 55, 60), reading('db_size', 6 * GB, 8 * GB)],
      new Map(),
      NOW,
      T,
    );
    const { subject, body } = buildAlertEmail(toAlert, T);
    expect(subject).toContain('CAPACITY CRITICAL');
    expect(subject).toContain('Database connections');
    expect(body).toContain('92%');
    expect(body).toContain('Micro -> Small (+$5/mo');
    expect(body).toContain('/super/efficiency');
  });
});

describe('CapacityWatchService.tick', () => {
  it('follower: does nothing when the lease is held elsewhere', async () => {
    const lease = { tryAcquire: jest.fn().mockResolvedValue({ name: 'x', leader: false, degraded: false, fence: 3 }) };
    const { svc, prisma, mailer } = makeService({ lease });
    expect(await svc.tick()).toBe('follower');
    expect(prisma.client.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.client.capacitySample.createMany).not.toHaveBeenCalled();
    expect(mailer.sendAlert).not.toHaveBeenCalled();
  });

  it('leader: samples, persists, and emails when a metric crosses', async () => {
    const lease = { tryAcquire: jest.fn().mockResolvedValue({ name: 'x', leader: true, degraded: false, fence: 4 }) };
    const { svc, prisma, mailer } = makeService({ lease });
    prisma.client.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('pg_database_size')) return [{ v: 7 * GB }]; // 87.5% of 8 GiB
      return [];
    });
    expect(await svc.tick()).toBe('ran');
    expect(prisma.client.capacitySample.createMany).toHaveBeenCalledTimes(1);
    const rows = prisma.client.capacitySample.createMany.mock.calls[0][0].data;
    expect(rows.find((r: any) => r.metric === 'db_size').value).toBe(7 * GB);
    expect(prisma.client.capacityAlertState.upsert).toHaveBeenCalled();
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
    expect(mailer.sendAlert.mock.calls[0][2]).toBe('CAPACITY_WATCH_ALERT');
  });

  it('a failing probe is omitted, never fatal', async () => {
    const lease = { tryAcquire: jest.fn().mockResolvedValue({ name: 'x', leader: true, degraded: true, fence: 0 }) };
    const { svc, prisma } = makeService({ lease });
    prisma.client.$queryRaw.mockRejectedValue(new Error('storage schema missing'));
    expect(await svc.tick()).toBe('ran');
    const rows = prisma.client.capacitySample.createMany.mock.calls[0][0].data;
    expect(rows.map((r: any) => r.metric)).toEqual(expect.arrayContaining(['paired_screens', 'api_memory']));
    expect(rows.map((r: any) => r.metric)).not.toContain('db_size');
  });

  it('a thrown error in the pass is swallowed and reported as failed', async () => {
    const lease = { tryAcquire: jest.fn().mockResolvedValue({ name: 'x', leader: true, degraded: false, fence: 1 }) };
    const { svc, prisma } = makeService({ lease });
    prisma.client.capacitySample.createMany.mockRejectedValue(new Error('db down'));
    expect(await svc.tick()).toBe('failed');
  });

  it('does not overlap itself', async () => {
    let release!: (v: any) => void;
    const lease = { tryAcquire: jest.fn().mockReturnValue(new Promise((r) => (release = r))) };
    const { svc } = makeService({ lease });
    const first = svc.tick();
    expect(await svc.tick()).toBe('busy');
    release({ name: 'x', leader: false, degraded: false, fence: 1 });
    await first;
  });
});

describe('disabled paths', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
  });

  it('onModuleInit arms nothing under NODE_ENV=test', () => {
    const { svc } = makeService();
    svc.onModuleInit();
    expect((svc as any).timer).toBeNull();
    expect((svc as any).firstTimer).toBeNull();
  });

  it('onModuleInit arms nothing with CAPACITY_WATCH_DISABLED=1 outside test', () => {
    process.env.NODE_ENV = 'production';
    process.env.CAPACITY_WATCH_DISABLED = '1';
    const { svc } = makeService();
    svc.onModuleInit();
    expect((svc as any).timer).toBeNull();
  });

  it('onModuleInit arms timers otherwise, and onModuleDestroy clears them', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CAPACITY_WATCH_DISABLED;
    const { svc } = makeService();
    svc.onModuleInit();
    expect((svc as any).timer).not.toBeNull();
    svc.onModuleDestroy();
  });
});

describe('getReport', () => {
  it('returns latest value, pct, level, trend and the manual checklist', async () => {
    const { svc, prisma } = makeService();
    const t0 = new Date(NOW.getTime() - 2 * 24 * 3600_000);
    prisma.client.capacitySample.findMany.mockResolvedValue([
      { metric: 'db_size', value: 4 * GB, limitValue: 8 * GB, createdAt: t0 },
      { metric: 'db_size', value: 5 * GB, limitValue: 8 * GB, createdAt: NOW },
    ]);
    prisma.client.capacityAlertState.findMany.mockResolvedValue([{ metric: 'db_size', level: 'ok' }]);
    const rep = await svc.getReport(NOW);
    const m = rep.metrics[0];
    expect(m.key).toBe('db_size');
    expect(m.pct).toBeCloseTo(62.5, 5);
    expect(m.trend).toHaveLength(2);
    expect(m.growthPerDay).toBeCloseTo(0.5 * GB, -3);
    expect(m.daysToLimit).toBeCloseTo(6, 3);
    expect(rep.checklist.map((c) => c.label)).toEqual(expect.arrayContaining(['Vercel usage', 'Railway plan limits']));
  });
});
