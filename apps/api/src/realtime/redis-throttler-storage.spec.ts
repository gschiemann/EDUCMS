import { RedisThrottlerStorage } from './redis-throttler-storage';
import type { RedisService } from './redis.service';

/**
 * Unit tests for the Redis-backed ThrottlerStorage (security P1).
 *
 * The bug: the default in-memory ThrottlerStorageService counts per-replica,
 * so on multi-replica Railway no @Throttle limit ever fired 429. These tests
 * prove the new storage (a) increments a SHARED counter on each hit, (b)
 * blocks the (limit+1)th hit, and (c) FAILS OPEN (never throws / never locks
 * out) when Redis is absent or errors.
 */

/**
 * Minimal faithful re-implementation of the Lua script's behaviour over a
 * plain JS Map, so we can assert the storage drives Redis correctly without a
 * live server. Keyed by the exact Redis keys the storage builds.
 */
function makeFakeRedisEval() {
  const hits = new Map<string, { count: number; expiresAt: number }>();
  const blocks = new Map<string, number>(); // key -> blockExpiresAt (ms epoch)

  const evalFn = jest.fn(
    async (
      _script: string,
      _numkeys: number,
      hitKey: string,
      blockKey: string,
      ttlStr: string,
      limitStr: string,
      blockDurStr: string,
    ): Promise<[number, number, number, number]> => {
      const ttl = Number(ttlStr);
      const limit = Number(limitStr);
      const blockDur = Number(blockDurStr);
      const now = Date.now();

      // PTTL block key
      const blockExpiresAt = blocks.get(blockKey);
      const blockPttl =
        blockExpiresAt && blockExpiresAt > now ? blockExpiresAt - now : -2;
      const isBlocked = blockPttl > 0;

      if (isBlocked) {
        const rec = hits.get(hitKey);
        const count = rec ? rec.count : limit + 1;
        const hitPttl = rec && rec.expiresAt > now ? rec.expiresAt - now : ttl;
        return [count, hitPttl, 1, blockPttl];
      }

      // INCR + first-hit PEXPIRE
      let rec = hits.get(hitKey);
      if (!rec || rec.expiresAt <= now) {
        rec = { count: 0, expiresAt: now + ttl };
        hits.set(hitKey, rec);
      }
      rec.count += 1;
      if (rec.count === 1) rec.expiresAt = now + ttl;
      const hitPttl = rec.expiresAt - now;

      if (rec.count > limit) {
        blocks.set(blockKey, now + blockDur);
        return [rec.count, hitPttl, 1, blockDur];
      }
      return [rec.count, hitPttl, 0, 0];
    },
  );

  return { evalFn, hits, blocks };
}

function makeStorage(evalFn: jest.Mock, status: string = 'ready') {
  const redis = {
    publisher: { status, eval: evalFn },
  } as unknown as RedisService;
  return new RedisThrottlerStorage(redis);
}

describe('RedisThrottlerStorage', () => {
  const TTL = 60_000; // 60s window
  const LIMIT = 3;
  const BLOCK = 60_000;
  const NAME = 'default';

  it('increments a shared counter on each hit and does NOT block while at/under the limit', async () => {
    const { evalFn } = makeFakeRedisEval();
    const storage = makeStorage(evalFn);

    const r1 = await storage.increment('1.2.3.4', TTL, LIMIT, BLOCK, NAME);
    expect(r1.totalHits).toBe(1);
    expect(r1.isBlocked).toBe(false);

    const r2 = await storage.increment('1.2.3.4', TTL, LIMIT, BLOCK, NAME);
    expect(r2.totalHits).toBe(2); // 2nd+ hit increments
    expect(r2.isBlocked).toBe(false);

    const r3 = await storage.increment('1.2.3.4', TTL, LIMIT, BLOCK, NAME);
    expect(r3.totalHits).toBe(3); // exactly at the limit — still allowed
    expect(r3.isBlocked).toBe(false);

    // It actually drove Redis (the shared store), not in-memory.
    expect(evalFn).toHaveBeenCalledTimes(3);
  });

  it('blocks the (limit+1)th hit', async () => {
    const { evalFn } = makeFakeRedisEval();
    const storage = makeStorage(evalFn);

    for (let i = 0; i < LIMIT; i++) {
      const r = await storage.increment('9.9.9.9', TTL, LIMIT, BLOCK, NAME);
      expect(r.isBlocked).toBe(false);
    }
    // The 4th hit (limit=3) trips the block.
    const tripped = await storage.increment('9.9.9.9', TTL, LIMIT, BLOCK, NAME);
    expect(tripped.totalHits).toBe(LIMIT + 1);
    expect(tripped.isBlocked).toBe(true);
    expect(tripped.timeToBlockExpire).toBeGreaterThan(0);

    // A subsequent hit stays blocked and the count is frozen (not incremented).
    const stillBlocked = await storage.increment(
      '9.9.9.9',
      TTL,
      LIMIT,
      BLOCK,
      NAME,
    );
    expect(stillBlocked.isBlocked).toBe(true);
    expect(stillBlocked.totalHits).toBe(LIMIT + 1); // frozen, not 5
  });

  it('reports timeToExpire/timeToBlockExpire in SECONDS (library contract)', async () => {
    const { evalFn } = makeFakeRedisEval();
    const storage = makeStorage(evalFn);
    const r = await storage.increment('5.5.5.5', TTL, LIMIT, BLOCK, NAME);
    // 60_000ms window → ~60s, never the raw ms value.
    expect(r.timeToExpire).toBeLessThanOrEqual(60);
    expect(r.timeToExpire).toBeGreaterThan(0);
  });

  it('keeps separate buckets per IP', async () => {
    const { evalFn } = makeFakeRedisEval();
    const storage = makeStorage(evalFn);
    await storage.increment('a', TTL, LIMIT, BLOCK, NAME);
    await storage.increment('a', TTL, LIMIT, BLOCK, NAME);
    const b = await storage.increment('b', TTL, LIMIT, BLOCK, NAME);
    expect(b.totalHits).toBe(1); // independent of 'a'
  });

  describe('fail-open behaviour (Redis must never lock out logins)', () => {
    it('falls back to in-memory storage when there is no Redis publisher', async () => {
      const redis = { publisher: null } as unknown as RedisService;
      const storage = new RedisThrottlerStorage(redis);

      const r1 = await storage.increment('1.1.1.1', TTL, LIMIT, BLOCK, NAME);
      expect(r1.totalHits).toBe(1);
      expect(r1.isBlocked).toBe(false);
      // Still enforces locally — fail-open means "don't crash", not "don't count".
      const r2 = await storage.increment('1.1.1.1', TTL, LIMIT, BLOCK, NAME);
      expect(r2.totalHits).toBe(2);
    });

    it('falls back to in-memory storage when Redis is not in the ready state', async () => {
      const { evalFn } = makeFakeRedisEval();
      const storage = makeStorage(evalFn, 'reconnecting');
      const r = await storage.increment('2.2.2.2', TTL, LIMIT, BLOCK, NAME);
      expect(r.totalHits).toBe(1);
      // eval must NOT be called when the client isn't ready.
      expect(evalFn).not.toHaveBeenCalled();
    });

    it('falls back to in-memory (never throws) when eval rejects mid-flight', async () => {
      const evalFn = jest
        .fn()
        .mockRejectedValue(new Error('READONLY redis is down'));
      const storage = makeStorage(evalFn);

      // Must resolve to a non-blocking record, NOT throw.
      await expect(
        storage.increment('3.3.3.3', TTL, LIMIT, BLOCK, NAME),
      ).resolves.toEqual(
        expect.objectContaining({ totalHits: 1, isBlocked: false }),
      );
      expect(evalFn).toHaveBeenCalledTimes(1);
    });
  });
});
