import { PublicSourceCache } from './public-source-cache';
import { FeedsRateLimiter } from './feeds-rate-limiter';
import { safeFetch } from '../branding/safe-fetch';
jest.mock('../branding/safe-fetch', () => ({ safeFetch: jest.fn() }));
const now = Date.parse('2026-10-30T02:00:00Z');
beforeEach(() => {
  jest.useFakeTimers({ now });
  (safeFetch as jest.Mock).mockReset();
});
afterEach(() => jest.useRealTimers());
function fixture() {
  const saved = new Map<string, string>();
  const redis = {
    publisher: {
      get: jest.fn(async (k: string) => saved.get(k) || null),
      set: jest.fn(async (k: string, v: string) => {
        saved.set(k, v);
        return 'OK';
      }),
    },
  };
  return {
    cache: new PublicSourceCache(redis as any, new FeedsRateLimiter()),
    redis,
    saved,
  };
}
it('coalesces same-source misses, reuses parsed hot values and refreshes after expiry', async () => {
  const { cache } = fixture(),
    parse = jest.fn(JSON.parse);
  (safeFetch as jest.Mock).mockResolvedValue({
    status: 200,
    body: Buffer.from('{"ok":1}'),
    headers: {},
  });
  const a = await Promise.all(
    Array.from({ length: 20 }, () =>
      cache.read('coalesce', 'https://example.com/feed', 30, parse),
    ),
  );
  expect(a.every((x) => x.value.ok === 1)).toBe(true);
  expect(safeFetch).toHaveBeenCalledTimes(1);
  expect(parse).toHaveBeenCalledTimes(1);
  await cache.read('coalesce', 'https://example.com/feed', 30, parse);
  expect(safeFetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(31000);
  await cache.read('coalesce', 'https://example.com/feed', 30, parse);
  expect(safeFetch).toHaveBeenCalledTimes(2);
});
it('rejects source snapshots with stale or missing Last-Modified instead of claiming a fresh report', async () => {
  const { cache } = fixture();
  (safeFetch as jest.Mock).mockResolvedValue({
    status: 200,
    body: Buffer.from('[]'),
    headers: { 'last-modified': new Date(now - 6 * 60000).toUTCString() },
  });
  await expect(
    cache.read('stale-source', 'https://example.com/feed', 60, JSON.parse, {
      maxSourceAgeMs: 300000,
    }),
  ).rejects.toThrow('stale');
  (safeFetch as jest.Mock).mockResolvedValue({
    status: 200,
    body: Buffer.from('[]'),
    headers: {},
  });
  await expect(
    cache.read('stale-source', 'https://example.com/feed', 60, JSON.parse, {
      maxSourceAgeMs: 300000,
    }),
  ).rejects.toThrow('stale');
});
it('does not cache invalid source content or poison a later retry', async () => {
  const { cache } = fixture();
  (safeFetch as jest.Mock).mockResolvedValue({
    status: 200,
    body: Buffer.from('broken'),
    headers: {},
  });
  await expect(
    cache.read('retry', 'https://example.com/feed', 60, JSON.parse),
  ).rejects.toThrow();
  (safeFetch as jest.Mock).mockResolvedValue({
    status: 200,
    body: Buffer.from('[]'),
    headers: {},
  });
  expect(
    (await cache.read('retry', 'https://example.com/feed', 60, JSON.parse))
      .value,
  ).toEqual([]);
});
it('keeps default host limits and the global ceiling while allowing a reviewed bulk refresh cadence', () => {
  const limiter = new FeedsRateLimiter();
  for (let i = 0; i < 180; i++) limiter.check('mbta-bulk', 180);
  expect(() => limiter.check('mbta-bulk', 180)).toThrow();
  for (let i = 0; i < 60; i++) limiter.check('bad-limit', NaN);
  expect(() => limiter.check('bad-limit', NaN)).toThrow();
  for (let i = 240; i < 3000; i++) limiter.check('other-' + i, 180);
  expect(() => limiter.check('global', 180)).toThrow();
});
