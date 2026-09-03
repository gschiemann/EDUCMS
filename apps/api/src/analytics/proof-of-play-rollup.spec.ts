import {
  DEFAULT_ROLLUP_RETENTION_DAYS,
  HOUR_MS,
  ProofOfPlayRollupService,
  RollupCapableClient,
  hourFloor,
  rollupWatermark,
} from './proof-of-play-rollup.service';
import { ProofOfPlaySampler } from './proof-of-play.sampler';

/**
 * Proof-of-play rollup (efficiency/scale audit 2026-09-02, finding L4).
 *
 * What has to hold, because this table feeds a customer-facing display-time
 * report and the raw stream behind it is now deleted after ~14 days:
 *
 *   1. Only COMPLETE hours are aggregated.
 *   2. The watermark advances only with the rows, in one transaction — and it
 *      advances over an EMPTY hour too, or an idle fleet stalls it forever.
 *   3. Re-running an hour is idempotent (ON CONFLICT DO UPDATE = assignment).
 *   4. RAW RETENTION NEVER OUTRUNS THE ROLLUP: the purge cuts at
 *      min(policy, watermark), so a stopped rollup keeps data instead of
 *      losing it. This is the interlock that makes 90 → 14 days safe.
 */

interface RecordedWrite {
  sql: string;
  values: unknown[];
}

/**
 * Minimal Postgres stand-in: enough SQL shape recognition to exercise the
 * service's real statements, with an in-memory raw-sample table.
 */
class FakePg implements RollupCapableClient {
  rawSamples: Array<{ tenant: string; screen: string; playlist: string; at: number }> = [];
  /** tenant|screen|playlist|hourStart → samples */
  rolled = new Map<string, number>();
  watermark: Date | null = null;
  writes: RecordedWrite[] = [];
  /** Set to make the state table look unmigrated. */
  stateTableMissing = false;

  async $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T> {
    if (query.includes('playback_rollup_state')) {
      if (this.stateTableMissing) throw new Error('relation "playback_rollup_state" does not exist');
      return (this.watermark ? [{ rolled_through: this.watermark }] : []) as unknown as T;
    }
    if (query.includes('MIN("sampled_at")')) {
      if (this.rawSamples.length === 0) return [{ oldest: null }] as unknown as T;
      const oldest = Math.min(...this.rawSamples.map((r) => r.at));
      return [{ oldest: new Date(oldest) }] as unknown as T;
    }
    if (query.includes('FROM "playback_samples"')) {
      const from = (values[0] as Date).getTime();
      const to = (values[1] as Date).getTime();
      const counts = new Map<string, number>();
      for (const row of this.rawSamples) {
        if (row.at < from || row.at >= to) continue;
        const key = `${row.tenant}|${row.screen}|${row.playlist}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts.entries()].map(([key, samples]) => {
        const [tenant_id, screen_id, playlist_id] = key.split('|');
        return { tenant_id, screen_id, playlist_id, samples };
      }) as unknown as T;
    }
    throw new Error(`unexpected query: ${query}`);
  }

  async $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number> {
    this.writes.push({ sql: query, values });
    if (query.includes('INSERT INTO "playback_sample_hours"')) {
      for (let i = 0; i < values.length; i += 5) {
        const key = `${values[i]}|${values[i + 1]}|${values[i + 2]}|${(values[i + 3] as Date).getTime()}`;
        // Mirrors ON CONFLICT DO UPDATE SET samples = EXCLUDED.samples:
        // assignment, never accumulation.
        this.rolled.set(key, values[i + 4] as number);
      }
      return values.length / 5;
    }
    if (query.includes('INSERT INTO "playback_rollup_state"')) {
      this.watermark = values[1] as Date;
      return 1;
    }
    if (query.includes('DELETE FROM "playback_sample_hours"')) {
      const cutoff = (values[0] as Date).getTime();
      let deleted = 0;
      for (const key of [...this.rolled.keys()]) {
        if (Number(key.split('|')[3]) < cutoff) {
          this.rolled.delete(key);
          deleted += 1;
        }
      }
      return deleted;
    }
    throw new Error(`unexpected write: ${query}`);
  }

  async $transaction<T>(fn: (tx: RollupCapableClient) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

const T0 = Date.UTC(2026, 8, 1, 0, 0, 0); // hour-aligned

function serviceOn(pg: FakePg): ProofOfPlayRollupService {
  return new ProofOfPlayRollupService({ client: pg } as never);
}

describe('hourFloor', () => {
  it('snaps to the top of the UTC hour', () => {
    expect(hourFloor(T0 + 59 * 60_000 + 59_000).getTime()).toBe(T0);
    expect(hourFloor(T0).getTime()).toBe(T0);
  });
});

describe('ProofOfPlayRollupService.tick', () => {
  it('aggregates complete hours and leaves the in-progress hour alone', async () => {
    const pg = new FakePg();
    // Two samples in hour 0, one in hour 1, one in hour 2 (still running).
    pg.rawSamples = [
      { tenant: 't1', screen: 's1', playlist: 'p1', at: T0 + 60_000 },
      { tenant: 't1', screen: 's1', playlist: 'p1', at: T0 + 600_000 },
      { tenant: 't1', screen: 's1', playlist: 'p1', at: T0 + HOUR_MS + 60_000 },
      { tenant: 't1', screen: 's1', playlist: 'p1', at: T0 + 2 * HOUR_MS + 60_000 },
    ];

    const result = await serviceOn(pg).tick(T0 + 2 * HOUR_MS + 120_000);

    expect(result.hours).toBe(2);
    expect(pg.rolled.get(`t1|s1|p1|${T0}`)).toBe(2);
    expect(pg.rolled.get(`t1|s1|p1|${T0 + HOUR_MS}`)).toBe(1);
    // The current hour is still accumulating — aggregating it would freeze a
    // partial count into a report.
    expect(pg.rolled.has(`t1|s1|p1|${T0 + 2 * HOUR_MS}`)).toBe(false);
    expect(pg.watermark?.getTime()).toBe(T0 + 2 * HOUR_MS);
  });

  it('advances the watermark across an EMPTY hour (idle fleet must not stall it)', async () => {
    const pg = new FakePg();
    pg.rawSamples = [
      { tenant: 't1', screen: 's1', playlist: 'p1', at: T0 + 60_000 },
      // hour 1: nothing at all
      { tenant: 't1', screen: 's1', playlist: 'p1', at: T0 + 2 * HOUR_MS + 60_000 },
    ];

    await serviceOn(pg).tick(T0 + 3 * HOUR_MS + 60_000);

    expect(pg.rolled.get(`t1|s1|p1|${T0}`)).toBe(1);
    expect(pg.rolled.get(`t1|s1|p1|${T0 + 2 * HOUR_MS}`)).toBe(1);
    expect(pg.watermark?.getTime()).toBe(T0 + 3 * HOUR_MS);
  });

  it('resumes from the watermark instead of re-scanning history', async () => {
    const pg = new FakePg();
    pg.watermark = new Date(T0 + HOUR_MS);
    pg.rawSamples = [
      { tenant: 't1', screen: 's1', playlist: 'p1', at: T0 + 60_000 }, // already rolled
      { tenant: 't1', screen: 's1', playlist: 'p1', at: T0 + HOUR_MS + 60_000 },
    ];

    const result = await serviceOn(pg).tick(T0 + 2 * HOUR_MS + 60_000);

    expect(result.hours).toBe(1);
    expect(pg.rolled.has(`t1|s1|p1|${T0}`)).toBe(false);
    expect(pg.rolled.get(`t1|s1|p1|${T0 + HOUR_MS}`)).toBe(1);
  });

  it('is idempotent: re-running an hour does not double the count', async () => {
    const pg = new FakePg();
    pg.rawSamples = [
      { tenant: 't1', screen: 's1', playlist: 'p1', at: T0 + 60_000 },
      { tenant: 't1', screen: 's1', playlist: 'p1', at: T0 + 120_000 },
    ];

    await serviceOn(pg).tick(T0 + HOUR_MS + 60_000);
    expect(pg.rolled.get(`t1|s1|p1|${T0}`)).toBe(2);

    // A crash after the rows but before the commit would replay this hour.
    pg.watermark = new Date(T0);
    await serviceOn(pg).tick(T0 + HOUR_MS + 60_000);
    expect(pg.rolled.get(`t1|s1|p1|${T0}`)).toBe(2);
  });

  it('bounds a backfill so 90 days of history does not land in one tick', async () => {
    const pg = new FakePg();
    pg.rawSamples = [{ tenant: 't1', screen: 's1', playlist: 'p1', at: T0 + 60_000 }];
    process.env.PROOF_OF_PLAY_ROLLUP_MAX_HOURS = '3';
    try {
      const result = await serviceOn(pg).tick(T0 + 100 * HOUR_MS);
      expect(result.hours).toBe(3);
      expect(pg.watermark?.getTime()).toBe(T0 + 3 * HOUR_MS);
    } finally {
      delete process.env.PROOF_OF_PLAY_ROLLUP_MAX_HOURS;
    }
  });

  it('plants a watermark when there are no samples at all', async () => {
    const pg = new FakePg();
    const result = await serviceOn(pg).tick(T0 + 90 * 60_000);
    expect(result.hours).toBe(0);
    expect(pg.watermark?.getTime()).toBe(T0 + HOUR_MS);
  });

  it('purges aggregate rows past the rollup retention window', async () => {
    const pg = new FakePg();
    const old = T0 - (DEFAULT_ROLLUP_RETENTION_DAYS + 5) * 86_400_000;
    pg.rolled.set(`t1|s1|p1|${old}`, 6);
    pg.watermark = new Date(T0);
    pg.rawSamples = [{ tenant: 't1', screen: 's1', playlist: 'p1', at: T0 + 60_000 }];

    await serviceOn(pg).tick(T0 + 2 * HOUR_MS);

    expect(pg.rolled.has(`t1|s1|p1|${old}`)).toBe(false);
    expect(pg.rolled.get(`t1|s1|p1|${T0}`)).toBe(1);
  });

  it('swallows an unmigrated state table instead of crashing the API', async () => {
    const pg = new FakePg();
    pg.stateTableMissing = true;
    await expect(serviceOn(pg).tick(T0 + HOUR_MS)).resolves.toEqual({ hours: 0, rows: 0 });
  });
});

describe('rollupWatermark', () => {
  it('returns null when no row has been written yet', async () => {
    await expect(rollupWatermark(new FakePg())).resolves.toBeNull();
  });

  it('returns the stored instant once the rollup has run', async () => {
    const pg = new FakePg();
    pg.watermark = new Date(T0);
    await expect(rollupWatermark(pg)).resolves.toEqual(new Date(T0));
  });
});

/**
 * The interlock that makes shortening raw retention safe. These run against
 * the sampler because that is where the cut is decided.
 */
describe('raw retention never outruns the rollup', () => {
  function samplerWith(watermark: Date | null, missing = false) {
    const deleteMany = jest.fn(async () => ({ count: 1 }));
    const client = {
      $queryRawUnsafe: jest.fn(async () => {
        if (missing) throw new Error('relation "playback_rollup_state" does not exist');
        return watermark ? [{ rolled_through: watermark }] : [];
      }),
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          $queryRaw: jest.fn(async () => [{ locked: true }]),
          playbackSample: { deleteMany },
        }),
      ),
    };
    return { sampler: new ProofOfPlaySampler({ client } as never), deleteMany };
  }

  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.PROOF_OF_PLAY_RETENTION_DAYS;
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('clamps the cut to the watermark when the rollup is STALLED', async () => {
    // The rollup died 30 days ago; the 14-day policy would happily delete the
    // 16 days of raw detail that was never aggregated.
    const watermark = new Date(Date.now() - 30 * 86_400_000);
    const { sampler, deleteMany } = samplerWith(watermark);

    await sampler.purgeTick();

    const cutoff: Date = deleteMany.mock.calls[0][0].where.sampledAt.lt;
    // Nothing newer than the watermark is in the aggregate, so nothing newer
    // than the watermark may be deleted — the report would silently lose it.
    expect(cutoff.getTime()).toBe(watermark.getTime());
  });

  it('uses the 14-day policy once the rollup is CAUGHT UP', async () => {
    const { sampler, deleteMany } = samplerWith(new Date(Date.now() - HOUR_MS));

    await sampler.purgeTick();

    const cutoff: Date = deleteMany.mock.calls[0][0].where.sampledAt.lt;
    expect(Math.abs(cutoff.getTime() - (Date.now() - 14 * 86_400_000))).toBeLessThan(2_000);
  });

  it('keeps the pre-rollup 90-day default when NO aggregate exists', async () => {
    const { sampler, deleteMany } = samplerWith(null, true);

    await sampler.purgeTick();

    const cutoff: Date = deleteMany.mock.calls[0][0].where.sampledAt.lt;
    // Dropping to 14 days here would erase 76 days of reportable detail with
    // nothing standing in for it.
    expect(Math.abs(cutoff.getTime() - (Date.now() - 90 * 86_400_000))).toBeLessThan(2_000);
  });

  it('still honours an EXPLICIT retention setting with no aggregate', async () => {
    process.env.PROOF_OF_PLAY_RETENTION_DAYS = '30';
    const { sampler, deleteMany } = samplerWith(null, true);

    await sampler.purgeTick();

    const cutoff: Date = deleteMany.mock.calls[0][0].where.sampledAt.lt;
    expect(Math.abs(cutoff.getTime() - (Date.now() - 30 * 86_400_000))).toBeLessThan(2_000);
  });
});
