/**
 * Cache-behavior tests for the feeds module — the actual efficiency
 * mandate (Greg, 2026-07-01): a 150-screen fleet showing the same feed
 * must hit the origin ~once per TTL, not once per screen.
 *
 * Covers BOTH backends:
 *   - Redis path (mocked ioredis-shaped client) — multi-replica cache.
 *   - In-memory LRU fallback (no Redis client at all) — the "boot without
 *     Redis" contract every module in this codebase honors.
 */
import { getCachedFeed, setCachedFeed, FeedsCacheRedisClient } from './feeds-cache';

function makeFakeRedis(): FeedsCacheRedisClient & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async set(key: string, value: string) {
      store.set(key, value);
      return 'OK';
    },
  };
}

describe('feeds-cache — Redis-backed path', () => {
  it('returns null on a miss, then the cached value after set()', async () => {
    const redis = makeFakeRedis();
    expect(await getCachedFeed(redis, 'rss', 'https://example.com/feed.xml')).toBeNull();

    await setCachedFeed(redis, 'rss', 'https://example.com/feed.xml', '{"title":"X"}', 300);
    expect(await getCachedFeed(redis, 'rss', 'https://example.com/feed.xml')).toBe('{"title":"X"}');
  });

  it('keys RSS and ICS caches independently for the SAME url', async () => {
    const redis = makeFakeRedis();
    await setCachedFeed(redis, 'rss', 'https://example.com/x', '{"kind":"rss"}', 300);
    await setCachedFeed(redis, 'ics', 'https://example.com/x', '{"kind":"ics"}', 300);
    expect(await getCachedFeed(redis, 'rss', 'https://example.com/x')).toBe('{"kind":"rss"}');
    expect(await getCachedFeed(redis, 'ics', 'https://example.com/x')).toBe('{"kind":"ics"}');
  });

  it('falls back to memory (never throws) when Redis GET rejects', async () => {
    const redis: FeedsCacheRedisClient = {
      get: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
      set: jest.fn().mockResolvedValue('OK'),
    };
    // Pre-seed the memory fallback via a successful set() first, using a
    // DIFFERENT redis instance that fails only on get() — simulate a Redis
    // blip mid-session where the memory write already happened.
    const workingRedis = makeFakeRedis();
    await setCachedFeed(workingRedis, 'rss', 'https://example.com/blip', '{"ok":true}', 300);
    // Now query with the failing client — should fall through to the
    // shared in-memory LRU (module-level in feeds-cache.ts) without throwing.
    await expect(getCachedFeed(redis, 'rss', 'https://example.com/blip')).resolves.toBe('{"ok":true}');
  });

  it('does not throw when Redis SET rejects (memory fallback still written)', async () => {
    const redis: FeedsCacheRedisClient = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockRejectedValue(new Error('READONLY')),
    };
    await expect(
      setCachedFeed(redis, 'rss', 'https://example.com/set-fails', '{"a":1}', 300),
    ).resolves.toBeUndefined();
    // The in-memory fallback should still have it even though Redis SET failed.
    expect(await getCachedFeed(redis, 'rss', 'https://example.com/set-fails')).toBe('{"a":1}');
  });
});

describe('feeds-cache — in-memory fallback (Redis absent, null client)', () => {
  it('caches and retrieves without any Redis client at all', async () => {
    expect(await getCachedFeed(null, 'rss', 'https://example.com/no-redis')).toBeNull();
    await setCachedFeed(null, 'rss', 'https://example.com/no-redis', '{"x":1}', 300);
    expect(await getCachedFeed(null, 'rss', 'https://example.com/no-redis')).toBe('{"x":1}');
  });

  it('expires an entry after its TTL', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-01T00:00:00Z'));
    await setCachedFeed(null, 'ics', 'https://example.com/expiring', '{"e":1}', 1); // 1 second TTL
    expect(await getCachedFeed(null, 'ics', 'https://example.com/expiring')).toBe('{"e":1}');

    jest.setSystemTime(new Date('2026-07-01T00:00:05Z')); // 5s later — past TTL
    expect(await getCachedFeed(null, 'ics', 'https://example.com/expiring')).toBeNull();
    jest.useRealTimers();
  });

  it('is undefined-tolerant (same code path as null)', async () => {
    await setCachedFeed(undefined, 'rss', 'https://example.com/undef', '{"u":1}', 300);
    expect(await getCachedFeed(undefined, 'rss', 'https://example.com/undef')).toBe('{"u":1}');
  });
});
