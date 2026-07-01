import {
  checkIngestLimit,
  _resetIngestRateLimitMemoryForTests,
  type IngestRateLimitRedisClient,
} from './ingest-rate-limit';

/**
 * Unit tests for the multi-replica-safe ingest rate limiter (launch-sprint
 * #272a). Proves: (a) a shared Redis counter enforces the limit across
 * "replicas" (simulated by two independent limiter calls against the same
 * fake Redis store), (b) it rolls over after the window expires, (c) it
 * falls back to an in-memory bucket when Redis is absent/not-ready/throws,
 * and (d) different keys are isolated from each other.
 */

/** Minimal fake ioredis EVAL that faithfully implements the INCR+PEXPIRE window. */
function makeFakeRedis(status: string = 'ready') {
  const store = new Map<string, { count: number; expiresAt: number }>();

  const eval_ = jest.fn(
    (
      _script: string,
      _numKeys: number,
      key: string,
      windowMsStr: string,
    ): Promise<number> => {
      const windowMs = Number(windowMsStr);
      const now = Date.now();
      let rec = store.get(key);
      if (!rec || rec.expiresAt <= now) {
        rec = { count: 0, expiresAt: now + windowMs };
        store.set(key, rec);
      }
      rec.count += 1;
      return Promise.resolve(rec.count);
    },
  );

  const client: IngestRateLimitRedisClient = { status, eval: eval_ };
  return { client, eval_, store };
}

describe('checkIngestLimit', () => {
  beforeEach(() => {
    _resetIngestRateLimitMemoryForTests();
    jest.useRealTimers();
  });

  describe('Redis-backed path', () => {
    it('allows hits at/under the limit and drives Redis (not the in-memory fallback)', async () => {
      const { client, eval_ } = makeFakeRedis();
      const max = 3;
      const windowMs = 10_000;

      const r1 = await checkIngestLimit(client, 'game-a', max, windowMs);
      expect(r1).toEqual({ limited: false, count: 1 });
      const r2 = await checkIngestLimit(client, 'game-a', max, windowMs);
      expect(r2).toEqual({ limited: false, count: 2 });
      const r3 = await checkIngestLimit(client, 'game-a', max, windowMs);
      expect(r3).toEqual({ limited: false, count: 3 }); // exactly at limit — still allowed

      expect(eval_).toHaveBeenCalledTimes(3);
    });

    it('rejects the (max+1)th hit within the window', async () => {
      const { client } = makeFakeRedis();
      const max = 2;
      const windowMs = 10_000;

      await checkIngestLimit(client, 'game-b', max, windowMs);
      await checkIngestLimit(client, 'game-b', max, windowMs);
      const tripped = await checkIngestLimit(client, 'game-b', max, windowMs);
      expect(tripped.limited).toBe(true);
      expect(tripped.count).toBe(3);
    });

    it('keeps a SEPARATE bucket per key (per-endpoint prefixing e.g. cts:/swim:)', async () => {
      const { client } = makeFakeRedis();
      const max = 1;
      const windowMs = 10_000;

      const a1 = await checkIngestLimit(client, 'cts:game-1', max, windowMs);
      expect(a1.limited).toBe(false);
      // A different key (even for the "same" underlying game id via a
      // different prefix) must not share the bucket.
      const b1 = await checkIngestLimit(client, 'swim:game-1', max, windowMs);
      expect(b1.limited).toBe(false);
      // Hitting the first key again DOES trip it.
      const a2 = await checkIngestLimit(client, 'cts:game-1', max, windowMs);
      expect(a2.limited).toBe(true);
    });

    it('rolls the window over — a fresh window resets the count', async () => {
      const { client } = makeFakeRedis();
      const max = 1;
      const windowMs = 20; // short window so the test is fast

      const first = await checkIngestLimit(client, 'game-c', max, windowMs);
      expect(first.limited).toBe(false);
      const second = await checkIngestLimit(client, 'game-c', max, windowMs);
      expect(second.limited).toBe(true);

      // Wait for the window to roll over.
      await new Promise((resolve) => setTimeout(resolve, windowMs + 15));

      const afterRollover = await checkIngestLimit(
        client,
        'game-c',
        max,
        windowMs,
      );
      expect(afterRollover.limited).toBe(false);
      expect(afterRollover.count).toBe(1);
    });

    it('does not call Redis when the client is not in "ready" state (falls back to memory)', async () => {
      const { client, eval_ } = makeFakeRedis('reconnecting');
      const result = await checkIngestLimit(client, 'game-d', 5, 10_000);
      expect(result.limited).toBe(false);
      expect(eval_).not.toHaveBeenCalled();
    });
  });

  describe('fallback path (Redis absent or erroring)', () => {
    it('falls back to an in-memory bucket when redis is null', async () => {
      const r1 = await checkIngestLimit(null, 'game-e', 2, 10_000);
      expect(r1.limited).toBe(false);
      const r2 = await checkIngestLimit(null, 'game-e', 2, 10_000);
      expect(r2.limited).toBe(false);
      const r3 = await checkIngestLimit(null, 'game-e', 2, 10_000);
      expect(r3.limited).toBe(true); // still enforces the limit locally
    });

    it('falls back to an in-memory bucket when redis is undefined', async () => {
      const r1 = await checkIngestLimit(undefined, 'game-f', 1, 10_000);
      expect(r1.limited).toBe(false);
      const r2 = await checkIngestLimit(undefined, 'game-f', 1, 10_000);
      expect(r2.limited).toBe(true);
    });

    it('never throws when eval() rejects mid-flight — falls back to memory', async () => {
      const client: IngestRateLimitRedisClient = {
        status: 'ready',
        eval: jest.fn().mockRejectedValue(new Error('READONLY redis is down')),
      };
      await expect(
        checkIngestLimit(client, 'game-g', 5, 10_000),
      ).resolves.toEqual(expect.objectContaining({ limited: false }));
    });

    it('keeps separate in-memory buckets per key', async () => {
      await checkIngestLimit(null, 'k1', 1, 10_000);
      const otherKey = await checkIngestLimit(null, 'k2', 1, 10_000);
      expect(otherKey.limited).toBe(false); // independent of k1
    });

    it('in-memory fallback is a sliding window (old hits expire)', async () => {
      const windowMs = 20;
      const first = await checkIngestLimit(null, 'game-h', 1, windowMs);
      expect(first.limited).toBe(false);
      const second = await checkIngestLimit(null, 'game-h', 1, windowMs);
      expect(second.limited).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, windowMs + 15));

      const afterExpiry = await checkIngestLimit(null, 'game-h', 1, windowMs);
      expect(afterExpiry.limited).toBe(false);
    });
  });
});
