import { NewsController } from './news.controller';
import { NewsService, parseNewsArticles, normalizeNewsTitle } from './news.service';
import { safeFetch } from '../branding/safe-fetch';
jest.mock('../branding/safe-fetch', () => ({ safeFetch: jest.fn() }));

const now = Date.parse('2026-10-28T12:00:00Z');
const article = {
  title: 'A real headline',
  url: 'https://example.com/story?utm_source=test',
  seendate: '20261028T110000Z',
};
describe('Newsroom metadata boundary', () => {
  it('rejects unsafe links, invalid/future/old dates and syndicated duplicate headlines', () => {
    const rows = parseNewsArticles(
      [
        article,
        { ...article, url: 'https://other.example/story' },
        { ...article, url: 'javascript:alert(1)' },
        { ...article, title: 'Future', seendate: '20261128T110000Z' },
        { ...article, title: 'Old', seendate: '20260928T110000Z' },
      ],
      'local',
      now,
    );
    expect(rows).toEqual([
      {
        title: 'A real headline',
        link: 'https://example.com/story',
        publisher: 'example.com',
        indexedAt: '2026-10-28T11:00:00Z',
        scope: 'local',
      },
    ]);
    expect(rows[0]).not.toHaveProperty('publishedAt');
    expect(rows[0]).not.toHaveProperty('image');
  });
  it('rejects query arrays, injected query language, unknown scopes and oversized source sets', () => {
    const c = new NewsController({ get: jest.fn() } as any);
    expect(() => c.get('other', '94583')).toThrow();
    expect(() => c.get('local', ['94583'] as any)).toThrow();
    expect(() => c.get('local', '"San Ramon" OR politics')).toThrow();
    expect(() => c.get('local', '')).toThrow();
    expect(() => c.get('world', '', 'bbc.com) OR foo')).toThrow();
    expect(() =>
      c.get(
        'world',
        '',
        Array.from({ length: 9 }, (_, i) => `a${i}.com`).join(','),
      ),
    ).toThrow();
  });
  it('shares cache and coalesces simultaneous cold requests without repeated upstream calls', async () => {
    const cache = new Map<string, string>();
    const redis = {
      publisher: {
        get: jest.fn(async (k: string) => cache.get(k) || null),
        set: jest.fn(async (k: string, v: string) => {
          cache.set(k, v);
          return 'OK';
        }),
      },
    };
    const check = jest.fn();
    const mock = safeFetch as jest.Mock;
    mock.mockResolvedValue({
      status: 200,
      body: Buffer.from(
        JSON.stringify({
          articles: [
            {
              ...article,
              seendate: new Date()
                .toISOString()
                .replace(/[-:]/g, '')
                .replace(/\.\d+Z$/, 'Z'),
            },
          ],
        }),
      ),
    });
    const s = new NewsService(redis as any, { check } as any);
    const [one, two] = await Promise.all([
      s.get('national', '94583'),
      s.get('national', '90210'),
    ]);
    expect(one).toEqual(two);
    await s.get('national', '10001');
    expect(mock).toHaveBeenCalledTimes(2);
    expect(check).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls.filter(([url]) => String(url).includes('api.gdeltproject.org'))).toHaveLength(1);
    expect(one.provider).toBe('GDELT');
  });
  it('refuses uncached fetches when shared pacing is unavailable', async () => {
    const mock = safeFetch as jest.Mock;
    mock.mockClear();
    const s = new NewsService(
      { publisher: null } as any,
      { check: jest.fn() } as any,
    );
    await expect(s.get('world', '')).rejects.toThrow('temporarily unavailable');
    expect(mock).not.toHaveBeenCalled();
  });
});

it('keeps the last good edition during 429 cooldown and does not stampede upstream', async () => {
  jest.useFakeTimers({ now });
  const rows = new Map<string, { value: string; expires: number }>();
  const redis = {
    publisher: {
      get: jest.fn(async (key: string) => {
        const row = rows.get(key);
        return row && row.expires > Date.now() ? row.value : null;
      }),
      set: jest.fn(
        async (
          key: string,
          value: string,
          mode: string,
          ttl: number,
          nx?: string,
        ) => {
          const row = rows.get(key);
          if (nx === 'NX' && row && row.expires > Date.now()) return null;
          rows.set(key, {
            value,
            expires: Date.now() + ttl * (mode === 'PX' ? 1 : 1000),
          });
          return 'OK';
        },
      ),
    },
  };
  const fetcher = safeFetch as jest.Mock;
  fetcher.mockClear();
  fetcher.mockResolvedValueOnce({
    status: 200,
    headers: {},
    body: Buffer.from(JSON.stringify({ articles: [article] })),
  });
  const s = new NewsService(redis as any, { check: jest.fn() } as any);
  try {
    const good = await s.get('national', '', ['cooldown.example']);
    jest.setSystemTime(now + 11 * 60000);
    fetcher.mockResolvedValueOnce({
      status: 429,
      headers: { 'retry-after': '120' },
      body: Buffer.from('Rate limited'),
    });
    const held = await s.get('national', '', ['cooldown.example']);
    expect(held.items).toEqual(good.items);
    expect(held.fetchedAt).toBe(good.fetchedAt);
    expect(held.stale).toBe(true);
    expect(redis.publisher.set).toHaveBeenCalledWith(
      'feeds:gdelt:cooldown',
      '1',
      'EX',
      120,
    );
    await s.get('national', '', ['cooldown.example']);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/api/v2/doc/'))).toHaveLength(2);
    jest.setSystemTime(now + 61 * 60000);
    fetcher.mockResolvedValueOnce({
      status: 429,
      headers: {},
      body: Buffer.from('Rate limited'),
    });
    await expect(s.get('national', '', ['cooldown.example'])).rejects.toThrow(
      'temporarily unavailable',
    );
  } finally {
    jest.useRealTimers();
  }
});

it('uses an established-outlet query and a current one-day window for national coverage', async () => {
  const redis = {
    publisher: {
      get: jest.fn(async () => null),
      set: jest.fn(async () => 'OK'),
    },
  };
  const fetcher = safeFetch as jest.Mock;
  fetcher.mockClear();
  fetcher.mockResolvedValue({
    status: 200,
    headers: {},
    body: Buffer.from(JSON.stringify({ articles: [] })),
  });
  await new NewsService(redis as any, { check: jest.fn() } as any).get(
    'national',
    '',
    ['query.example'],
  );
  const target = new URL(fetcher.mock.calls[0][0]);
  expect(target.searchParams.get('query')).toContain(
    'sourcecountry:unitedstates',
  );
  expect(target.searchParams.get('query')).toContain('domainis:query.example');
  expect(target.searchParams.get('timespan')).toBe('1d');
});

it('accepts an empty optional location for national and international client URLs', () => {
  const get = jest.fn();
  const controller = new NewsController({ get } as any);
  controller.get('national', '', '');
  controller.get('world', '', '');
  expect(get).toHaveBeenNthCalledWith(1, 'national', '', []);
  expect(get).toHaveBeenNthCalledWith(2, 'world', '', []);
  expect(() => controller.get('local', '', '')).toThrow();
});

it('recovers search throttling from the shared official rolling index without mixing publisher selections or local cities', async () => {
  const cache = new Map<string, string>();
  const redis = {
    publisher: {
      get: jest.fn(async (k: string) => cache.get(k) || null),
      set: jest.fn(async (k: string, v: string) => {
        cache.set(k, v);
        return 'OK';
      }),
    },
  };
  const stamp = new Date().toUTCString();
  const xml = `<rss><channel><title>GDELT</title><item><title>San Ramon opens new park</title><link>https://cbsnews.com/local-park</link><pubDate>${stamp}</pubDate></item><item><title>Global summit begins</title><link>https://bbc.com/news/summit</link><pubDate>${stamp}</pubDate></item><item><title>Other language</title><link>https://bbc.com/arabic/story</link><pubDate>${stamp}</pubDate></item></channel></rss>`;
  const fetcher = safeFetch as jest.Mock;
  fetcher.mockReset();
  fetcher.mockImplementation(async (url: string) =>
    url.includes('/gal/feed.rss')
      ? { status: 200, body: Buffer.from(xml) }
      : { status: 429, headers: {}, body: Buffer.from('Rate limited') },
  );
  const service = new NewsService(redis as any, { check: jest.fn() } as any);
  const national = await service.get('national', '', ['cbsnews.com']);
  expect(national.limited).toBe(true);
  expect(national.items.map((i) => i.publisher)).toEqual(['cbsnews.com']);
  const world = await service.get('world', '', ['bbc.com']);
  expect(world.items.map((i) => i.title)).toEqual(['Global summit begins']);
  const local = await service.get('local', 'San Ramon', ['cbsnews.com']);
  expect(local.items.map((i) => i.title)).toEqual(['San Ramon opens new park']);
  const otherCity = await service.get('local', 'Honolulu', ['cbsnews.com']);
  expect(otherCity.items).toEqual([]);
  expect(
    fetcher.mock.calls.filter((c) => c[0].includes('/gal/feed.rss')),
  ).toHaveLength(1);
  expect(
    fetcher.mock.calls.filter((c) => c[0].includes('/doc/doc')),
  ).toHaveLength(1);
});

it('normalizes escaped headline punctuation as text and rejects day-old search metadata', () => {
 expect(normalizeNewsTitle('Yukon gov&#39;t &amp; utilities&#x2019; response')).toBe("Yukon gov't & utilities’ response");
 expect(normalizeNewsTitle('&lt;img src=x onerror=alert(1)&gt;')).toBe('<img src=x onerror=alert(1)>');
 expect(parseNewsArticles([{...article, seendate:'20261026T110000Z'}], 'national', now)).toEqual([]);
});
