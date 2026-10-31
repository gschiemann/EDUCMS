import { NewsService } from './news.service';
import { safeFetch } from '../branding/safe-fetch';
jest.mock('../branding/safe-fetch', () => ({ safeFetch: jest.fn() }));
jest.mock('./feeds-cache', () => ({
  getCachedFeed: (redis: any, kind: string, key: string) =>
    redis?.get(`feeds:${kind}:${key}`) ?? null,
  setCachedFeed: (
    redis: any,
    kind: string,
    key: string,
    value: string,
    ttl: number,
  ) => redis?.set(`feeds:${kind}:${key}`, value, 'EX', ttl),
}));
const now = Date.parse('2026-10-28T12:00:00Z');
const xml = (title = '', host = 'cbsnews.com') =>
  `<rss><channel><title>GDELT</title>${title ? `<item><title>${title}</title><link>https://${host}/news/story</link><pubDate>${new Date(now).toUTCString()}</pubDate></item>` : ''}</channel></rss>`;
const mock = safeFetch as jest.Mock;
function setup() {
  const cache = new Map<string, { value: string; until: number }>();
  const publisher = {
    get: async (k: string) => {
      const r = cache.get(k);
      return r && r.until > Date.now() ? r.value : null;
    },
    set: async (
      k: string,
      v: string,
      mode: string,
      ttl: number,
      nx?: string,
    ) => {
      const r = cache.get(k);
      if (nx === 'NX' && r && r.until > Date.now()) return null;
      cache.set(k, {
        value: v,
        until: Date.now() + ttl * (mode === 'PX' ? 1 : 1000),
      });
      return 'OK';
    },
  };
  const service = new NewsService(
    { publisher } as any,
    { check: jest.fn() } as any,
  );
  return {
    service,
    drain: () => Promise.allSettled([...(service as any).refreshes.values()]),
  };
}
beforeEach(() => {
  jest.useFakeTimers({ now });
  mock.mockReset();
});
afterEach(() => jest.useRealTimers());
it('returns current indexed metadata before a pending search and coalesces both upstream requests', async () => {
  let finish!: (v: unknown) => void;
  mock.mockImplementation((url: string) =>
    url.includes('/gal/feed.rss')
      ? Promise.resolve({
          status: 200,
          body: Buffer.from(xml('National story')),
        })
      : new Promise((r) => {
          finish = r;
        }),
  );
  const { service, drain } = setup();
  const [one, two] = await Promise.all([
    service.get('national', '94583'),
    service.get('national', '90210'),
  ]);
  expect(one.items[0].title).toBe('National story');
  expect(one.limited).toBe(true);
  expect(one).toEqual(two);
  expect(
    mock.mock.calls.filter(([u]) => String(u).includes('/api/v2/doc/')),
  ).toHaveLength(1);
  expect(
    mock.mock.calls.filter(([u]) => String(u).includes('/gal/feed.rss')),
  ).toHaveLength(1);
  finish({
    status: 200,
    body: Buffer.from(
      JSON.stringify({
        articles: [
          {
            title: 'Search result',
            url: 'https://cbsnews.com/search',
            seendate: '20261028T110000Z',
          },
        ],
      }),
    ),
  });
  await drain();
  expect((await service.get('national', '')).items[0].title).toBe(
    'Search result',
  );
});
it('retains indexed stories across rolling windows and expires them honestly', async () => {
  let feed = xml('National story');
  mock.mockImplementation(async (url: string) =>
    url.includes('/gal/feed.rss')
      ? { status: 200, body: Buffer.from(feed) }
      : { status: 429, headers: {}, body: Buffer.from('Limited') },
  );
  const { service, drain } = setup();
  const one = await service.get('national', '');
  await drain();
  jest.setSystemTime(now + 16 * 60000);
  feed = xml();
  const two = await service.get('national', '');
  await drain();
  expect(two.items).toEqual(one.items);
  expect(two.items[0].indexedAt).toBe('2026-10-28T12:00:00Z');
  jest.setSystemTime(now + 7 * 3600000);
  const expired = await service.get('national', '');
  await drain();
  expect(expired.items).toEqual([]);
});
it('never widens an explicit publisher selection or relabels another city as local', async () => {
  mock.mockImplementation(async (url: string) =>
    url.includes('/gal/feed.rss')
      ? { status: 200, body: Buffer.from(xml('San Ramon opens a new park')) }
      : { status: 429, headers: {}, body: Buffer.from('Limited') },
  );
  const { service, drain } = setup();
  expect((await service.get('local', 'San Ramon')).items).toHaveLength(1);
  await drain();
  expect((await service.get('local', 'San Diego')).items).toEqual([]);
  await drain();
  expect((await service.get('national', '', ['bbc.com'])).items).toEqual([]);
  await drain();
});
