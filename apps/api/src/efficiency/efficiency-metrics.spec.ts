import { EfficiencyMetricsService } from './efficiency-metrics.service';
import { RedisService } from '../realtime/redis.service';

/**
 * Efficiency monitor — 2026-09-02 rewrite (audit P0-6).
 *
 * The old monitor "should not be used to make hosting or scaling decisions":
 * it charged 5 awaited Redis commands to EVERY request (~2.76 M ops/day at
 * observed traffic), recorded response bytes as 0 because it read
 * Content-Length before serialisation, counted a conditional-header 200 as a
 * cache HIT, reset its "monthly" total on every restart, never read its own
 * Redis aggregates back, and kept only the first 200 latency samples of each
 * minute.
 *
 * These tests pin each of those.
 */

/** Records every pipelined command so the batching can be asserted exactly. */
class FakePipeline {
  constructor(private readonly sink: string[][]) {}
  hincrby(key: string, field: string, increment: number) {
    this.sink.push(['hincrby', key, field, String(increment)]);
    return this;
  }
  expire(key: string, seconds: number) {
    this.sink.push(['expire', key, String(seconds)]);
    return this;
  }
  hdel(key: string, ...fields: string[]) {
    this.sink.push(['hdel', key, ...fields]);
    return this;
  }
  exec = jest.fn(async () => []);
}

class FakeRedis {
  /** Every command issued, in order, flattened across pipelines. */
  commands: string[][] = [];
  /** How many pipelines were exec'd — i.e. how many Redis ROUND TRIPS. */
  pipelines = 0;
  hashes = new Map<string, Record<string, string>>();

  pipeline = jest.fn(() => {
    this.pipelines += 1;
    return new FakePipeline(this.commands);
  });
  hgetall = jest.fn(async (key: string) => this.hashes.get(key) ?? {});
  lpush = jest.fn(async () => 1);
  ltrim = jest.fn(async () => 'OK');
  expire = jest.fn(async () => 1);
}

function makeService(redis: FakeRedis | null): EfficiencyMetricsService {
  return new EfficiencyMetricsService({ publisher: redis } as unknown as RedisService);
}

function hit(
  svc: EfficiencyMetricsService,
  over: Partial<Parameters<EfficiencyMetricsService['recordRequest']>[0]> = {},
) {
  svc.recordRequest({
    route: 'GET /api/v1/screens',
    statusCode: 200,
    bytes: 1_000,
    durationMs: 10,
    isAsset: false,
    hadConditionalHeaders: false,
    wasNotModified: false,
    ...over,
  });
}

describe('EfficiencyMetricsService — batched Redis flush', () => {
  it('records a request WITHOUT touching Redis (0 commands per request)', () => {
    const redis = new FakeRedis();
    const svc = makeService(redis);

    for (let i = 0; i < 50; i++) hit(svc);

    expect(redis.pipeline).not.toHaveBeenCalled();
    expect(redis.commands).toHaveLength(0);
    // The snapshot still sees the traffic — it is accumulated in process.
    expect(svc.getSnapshot().requests.total).toBe(50);
    expect(svc.getSnapshot().collection.redisCommandsPerRequest).toBe(0);
  });

  it('flushes 200 requests in ONE pipeline (one round trip, not 1000 commands)', async () => {
    const redis = new FakeRedis();
    const svc = makeService(redis);

    for (let i = 0; i < 200; i++) hit(svc);
    // The 200th request triggers the flush; it runs on a microtask.
    await Promise.resolve();
    await Promise.resolve();

    expect(redis.pipelines).toBe(1);
    const hincrbys = redis.commands.filter((c) => c[0] === 'hincrby');
    // 4 minute fields + 1 hour field + 3 month fields = 8, regardless of the
    // 200 requests behind them. The old code issued 5 per REQUEST = 1000.
    expect(hincrbys.length).toBeLessThanOrEqual(10);
    const minuteRequests = hincrbys.find((c) => c[1].startsWith('eff:req:') && c[2] === 'requests');
    expect(minuteRequests?.[3]).toBe('200');
  });

  it('an explicit flush is a no-op when nothing is pending', async () => {
    const redis = new FakeRedis();
    const svc = makeService(redis);
    await svc.flush();
    expect(redis.pipelines).toBe(0);
  });

  it('re-queues the counters when the Redis pipeline fails — no data lost', async () => {
    const redis = new FakeRedis();
    redis.pipeline = jest.fn(() => {
      const p = new FakePipeline(redis.commands);
      p.exec = jest.fn(async () => {
        throw new Error('redis down');
      });
      return p;
    });
    const svc = makeService(redis);

    hit(svc, { bytes: 500 });
    await svc.flush();

    // Redis recovers; the same bytes flush on the next attempt.
    redis.commands.length = 0;
    redis.pipeline = jest.fn(() => new FakePipeline(redis.commands));
    await svc.flush();
    const bytesCmd = redis.commands.find((c) => c[0] === 'hincrby' && c[2] === 'bytes');
    expect(bytesCmd?.[3]).toBe('500');
  });

  it('works with no Redis at all — the snapshot is process-local, nothing throws', async () => {
    const svc = makeService(null);
    hit(svc, { bytes: 2_048, isAsset: true });
    await svc.flush();
    const snap = svc.getSnapshot();
    expect(snap.requests.total).toBe(1);
    expect(snap.egress.source).toBe('process');
    expect(snap.collection.redisConnected).toBe(false);
  });
});

describe('EfficiencyMetricsService — cache-hit semantics', () => {
  it('a 304 is a HIT; a 200 carrying conditional headers is a MISS', () => {
    const svc = makeService(null);
    // 3 × 304 → hits
    for (let i = 0; i < 3; i++) {
      hit(svc, { isAsset: true, bytes: 0, statusCode: 304, wasNotModified: true, hadConditionalHeaders: true });
    }
    // 1 × 200 WITH If-None-Match → miss (the old code scored this a hit)
    hit(svc, { isAsset: true, bytes: 5_000, hadConditionalHeaders: true });

    const snap = svc.getSnapshot();
    expect(snap.egress.cacheHits).toBe(3);
    expect(snap.egress.cacheMisses).toBe(1);
    expect(snap.egress.conditionalMisses).toBe(1);
    expect(snap.egress.cacheHitRatioPct).toBe(75);
  });

  it('a cache-miss STORM scores badly instead of looking like a 100% hit rate', () => {
    const svc = makeService(null);
    for (let i = 0; i < 10; i++) {
      hit(svc, { isAsset: true, bytes: 1_000_000, hadConditionalHeaders: true });
    }
    const snap = svc.getSnapshot();
    expect(snap.egress.cacheHitRatioPct).toBe(0);
    expect(snap.efficiency.worstOffenders.some((w) => w.includes('Cache hit ratio low'))).toBe(true);
  });
});

describe('EfficiencyMetricsService — egress accounting', () => {
  it('month-to-date totals come from Redis and survive a restart', async () => {
    const redis = new FakeRedis();
    const before = makeService(redis);
    hit(before, { isAsset: true, bytes: 3_000 });
    await before.flush();

    // Model what Redis now holds, then start a FRESH process against it.
    const monthKey = `eff:month:${new Date().toISOString().slice(0, 7).replace('-', '')}`;
    redis.hashes.set(monthKey, { bytes: '3000', assetBytes: '3000', requests: '1' });

    const after = makeService(redis);
    expect(after.getSnapshot().egress.rollingBytes).toBe(0); // nothing read yet
    await after.refreshRedisAggregates();

    const snap = after.getSnapshot();
    expect(snap.egress.source).toBe('redis');
    expect(snap.egress.monthAssetBytes).toBe(3_000);
    expect(snap.egress.rollingBytes).toBe(3_000);
  });

  it('states honestly which paths it observes and which egress it cannot see', () => {
    const snap = makeService(null).getSnapshot();
    expect(snap.egress.observes).toEqual(
      expect.arrayContaining([
        'GET|HEAD /api/v1/player/apk',
        'GET|HEAD /api/v1/player/manager-apk',
        'GET|HEAD /api/v1/streaming',
      ]),
    );
    expect(snap.egress.doesNotObserve.join(' ')).toMatch(/Supabase/);
    expect(snap.egress.note).toMatch(/NOT included/);
  });

  it('the anomaly baseline prefers the Redis hourly series over the process ring', async () => {
    const redis = new FakeRedis();
    const svc = makeService(redis);
    const now = new Date();
    const hourKey = (offsetHours: number) => {
      const d = new Date(now.getTime() - offsetHours * 3_600_000);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}`;
    };
    redis.hashes.set('eff:hours', {
      [hourKey(0)]: '5000000000',
      [hourKey(1)]: '1000000000',
      [hourKey(2)]: '1000000000',
      [hourKey(3)]: '1000000000',
    });
    await svc.refreshRedisAggregates();

    const snap = svc.getSnapshot();
    expect(snap.anomaly.baselineSource).toBe('redis');
    expect(snap.anomaly.currentHourBytes).toBe(5_000_000_000);
    expect(snap.anomaly.baselineAvgBytes).toBe(1_000_000_000);
    expect(snap.anomaly.ratio).toBe(5);
    expect(snap.anomaly.triggered).toBe(true);
    // …and the alert path agrees, from restart-durable data.
    expect(svc.shouldAlertAnomaly()).toEqual({ ratio: 5, currentHourGb: 5 });
  });
});

describe('EfficiencyMetricsService — latency sampling', () => {
  it('uses a uniform reservoir, so a slow burst LATE in the minute is visible', () => {
    const svc = makeService(null);
    // 5,000 fast requests first (the old code kept only the first 200 and
    // would report p95 = 5ms), then 5,000 slow ones.
    for (let i = 0; i < 5_000; i++) hit(svc, { durationMs: 5 });
    for (let i = 0; i < 5_000; i++) hit(svc, { durationMs: 900 });

    const snap = svc.getSnapshot();
    expect(snap.collection.latencySampling).toBe('uniform-reservoir');
    // Half the (uniform) sample should be slow → p95 lands in the slow band.
    expect(snap.requests.p95LatencyMs).toBe(900);
    // …and the median is still honest about the fast half.
    expect(snap.requests.p50LatencyMs).toBeLessThanOrEqual(900);
  });
});
