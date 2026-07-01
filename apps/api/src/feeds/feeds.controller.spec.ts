import { HttpException, HttpStatus } from '@nestjs/common';
import { FeedsController } from './feeds.controller';
import { FeedsService, SsrfError, FetchTooLargeError, FeedParseError, IcsParseError } from './feeds.service';
import { FeedsRateLimiter } from './feeds-rate-limiter';

function makeController(overrides?: { getRssFeed?: jest.Mock; getIcsFeed?: jest.Mock }) {
  const service = {
    normalizeUrl: (u: string) => {
      const parsed = new URL(u);
      return { url: parsed.toString(), host: parsed.hostname.toLowerCase() };
    },
    getRssFeed: overrides?.getRssFeed ?? jest.fn().mockResolvedValue({ title: 'X', items: [] }),
    getIcsFeed: overrides?.getIcsFeed ?? jest.fn().mockResolvedValue({ events: [], meta: {} }),
  } as unknown as FeedsService;
  const rateLimiter = { check: jest.fn() } as unknown as FeedsRateLimiter;
  return new FeedsController(service, rateLimiter);
}

describe('FeedsController — input validation', () => {
  it('rejects a missing url with FEEDS_MISSING_URL / 400', async () => {
    const controller = makeController();
    await expect(controller.rss(undefined)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: { code: 'FEEDS_MISSING_URL' },
    });
  });

  it('rejects an unparseable url with FEEDS_INVALID_URL / 400', async () => {
    const controller = makeController();
    await expect(controller.rss('not a url')).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: { code: 'FEEDS_INVALID_URL' },
    });
  });
});

describe('FeedsController — success path', () => {
  it('returns the RSS service result for a valid url', async () => {
    const controller = makeController();
    const result = await controller.rss('https://example.com/feed.xml');
    expect(result).toEqual({ title: 'X', items: [] });
  });

  it('returns the ICS service result for a valid url', async () => {
    const controller = makeController();
    const result = await controller.ics('https://example.com/cal.ics');
    expect(result).toEqual({ events: [], meta: {} });
  });
});

describe('FeedsController — error mapping (never leaks internals)', () => {
  it('maps SsrfError to a generic 400 FEEDS_SSRF, no IP/detail echoed', async () => {
    const controller = makeController({
      getRssFeed: jest.fn().mockRejectedValue(new SsrfError('DNS for evil.com resolved to private range (10.0.0.1)')),
    });
    let thrown: any;
    try {
      await controller.rss('https://evil.com/feed.xml');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect(thrown.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    const response = thrown.getResponse();
    expect(response.code).toBe('FEEDS_SSRF');
    expect(response.message).not.toMatch(/10\.0\.0\.1/); // never echo the resolved IP
    expect(response.message).not.toMatch(/evil\.com/); // generic message, no host echo
  });

  it('maps FetchTooLargeError to 413 FEEDS_TOO_LARGE', async () => {
    const controller = makeController({
      getRssFeed: jest.fn().mockRejectedValue(new FetchTooLargeError('Response exceeded 3145728 bytes')),
    });
    let thrown: any;
    try {
      await controller.rss('https://example.com/huge.xml');
    } catch (e) {
      thrown = e;
    }
    expect(thrown.getStatus()).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(thrown.getResponse().code).toBe('FEEDS_TOO_LARGE');
  });

  it('maps FeedParseError to 422 FEEDS_PARSE_FAILED', async () => {
    const controller = makeController({
      getRssFeed: jest.fn().mockRejectedValue(new FeedParseError('Document was not a recognizable RSS or Atom feed')),
    });
    let thrown: any;
    try {
      await controller.rss('https://example.com/notafeed.html');
    } catch (e) {
      thrown = e;
    }
    expect(thrown.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(thrown.getResponse().code).toBe('FEEDS_PARSE_FAILED');
  });

  it('maps IcsParseError to 422 FEEDS_PARSE_FAILED', async () => {
    const controller = makeController({
      getIcsFeed: jest.fn().mockRejectedValue(new IcsParseError('Document was not a recognizable iCalendar (.ics) file')),
    });
    let thrown: any;
    try {
      await controller.ics('https://example.com/notacalendar.txt');
    } catch (e) {
      thrown = e;
    }
    expect(thrown.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(thrown.getResponse().code).toBe('FEEDS_PARSE_FAILED');
  });

  it('maps an unknown error to 502 FEEDS_FETCH_FAILED', async () => {
    const controller = makeController({
      getRssFeed: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    let thrown: any;
    try {
      await controller.rss('https://example.com/down.xml');
    } catch (e) {
      thrown = e;
    }
    expect(thrown.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(thrown.getResponse().code).toBe('FEEDS_FETCH_FAILED');
  });

  it('passes through an HttpException thrown by the rate limiter unmodified', async () => {
    const service = {
      normalizeUrl: (u: string) => {
        const parsed = new URL(u);
        return { url: parsed.toString(), host: parsed.hostname.toLowerCase() };
      },
      getRssFeed: jest.fn(),
    } as unknown as FeedsService;
    const rateLimitException = new HttpException({ code: 'FEEDS_RATE_LIMIT_HOST' }, HttpStatus.TOO_MANY_REQUESTS);
    const rateLimiter = {
      check: jest.fn(() => {
        throw rateLimitException;
      }),
    } as unknown as FeedsRateLimiter;
    const controller = new FeedsController(service, rateLimiter);

    await expect(controller.rss('https://example.com/feed.xml')).rejects.toBe(rateLimitException);
  });
});
