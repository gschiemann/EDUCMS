/**
 * FeedsService integration tests — proves the cache actually SHORT-CIRCUITS
 * the origin fetch (the efficiency mandate this module exists for), and
 * that RSS/ICS parsing wires end-to-end through the service.
 *
 * safeFetch is mocked so these are hermetic (no network); SSRF behavior is
 * proven separately in feeds.ssrf.spec.ts using the REAL safeFetch.
 */
import { Logger } from '@nestjs/common';

jest.mock('../branding/safe-fetch', () => {
  const actual = jest.requireActual('../branding/safe-fetch');
  return {
    __esModule: true,
    ...actual,
    safeFetch: jest.fn(),
  };
});

import { safeFetch } from '../branding/safe-fetch';
import { FeedsService } from './feeds.service';
import { RedisService } from '../realtime/redis.service';

const mockedFetch = safeFetch as unknown as jest.Mock;

function asResponse(body: string) {
  return {
    body: Buffer.from(body, 'utf8'),
    contentType: 'application/rss+xml',
    finalUrl: 'https://example.com/feed.xml',
    status: 200,
  };
}

const SAMPLE_RSS = `<rss version="2.0"><channel><title>Sample</title>
  <item><title>Hello</title><link>https://example.com/a</link></item>
</channel></rss>`;

const SAMPLE_ICS = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n` +
  `BEGIN:VEVENT\r\nDTSTART:20260705T140000Z\r\nSUMMARY:Meeting\r\nEND:VEVENT\r\n` +
  `END:VCALENDAR\r\n`;

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined as any);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined as any);
});
afterEach(() => jest.clearAllMocks());
afterAll(() => jest.restoreAllMocks());

describe('FeedsService.getRssFeed', () => {
  it('fetches + parses on a cold cache', async () => {
    mockedFetch.mockResolvedValue(asResponse(SAMPLE_RSS));
    const svc = new FeedsService(new RedisService());
    const result = await svc.getRssFeed('https://example.com/cold-rss-feed.xml');
    expect(result.title).toBe('Sample');
    expect(result.items).toHaveLength(1);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('a second request for the SAME url hits the cache, not the origin (the 150-screen-fleet proof)', async () => {
    mockedFetch.mockResolvedValue(asResponse(SAMPLE_RSS));
    const svc = new FeedsService(new RedisService());
    const url = 'https://example.com/shared-district-feed.xml';

    // Simulate 5 different "screens" all requesting the same feed.
    await Promise.all([svc.getRssFeed(url), svc.getRssFeed(url)]);
    await svc.getRssFeed(url);
    await svc.getRssFeed(url);
    await svc.getRssFeed(url);

    // Origin should be hit far fewer times than the 5 logical requests —
    // in the worst case (all concurrent, no cache yet) the very first
    // couple might race before the cache is warm, but it must NEVER be 5.
    expect(mockedFetch.mock.calls.length).toBeLessThan(5);
  });

  it('marks a cache hit result with cached: true', async () => {
    mockedFetch.mockResolvedValue(asResponse(SAMPLE_RSS));
    const svc = new FeedsService(new RedisService());
    const url = 'https://example.com/cache-flag-feed.xml';
    await svc.getRssFeed(url); // warm it
    const second = await svc.getRssFeed(url);
    expect(second.cached).toBe(true);
  });

  it('surfaces an upstream non-2xx as a parse-flavored error, not a silent empty feed', async () => {
    mockedFetch.mockResolvedValue({ ...asResponse(''), status: 404 });
    const svc = new FeedsService(new RedisService());
    await expect(svc.getRssFeed('https://example.com/missing-feed.xml')).rejects.toThrow(/404/);
  });
});

describe('FeedsService.getIcsFeed', () => {
  it('fetches + parses ICS on a cold cache', async () => {
    mockedFetch.mockResolvedValue({ ...asResponse(SAMPLE_ICS), contentType: 'text/calendar' });
    const svc = new FeedsService(new RedisService());
    const result = await svc.getIcsFeed('https://example.com/cold-calendar.ics');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Meeting');
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('caches ICS independently from RSS for the same host', async () => {
    mockedFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('.ics')
          ? { ...asResponse(SAMPLE_ICS), contentType: 'text/calendar' }
          : asResponse(SAMPLE_RSS),
      ),
    );
    const svc = new FeedsService(new RedisService());
    await svc.getRssFeed('https://example.com/mixed.rss');
    await svc.getIcsFeed('https://example.com/mixed.ics');
    expect(mockedFetch).toHaveBeenCalledTimes(2); // different cache keys, both cold
  });
});
