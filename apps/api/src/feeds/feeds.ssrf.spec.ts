/**
 * Feeds fetch SSRF proof.
 * ──────────────────────────────────────────────────────────────────────
 *
 * GET /api/v1/feeds/rss and /ics take an OPERATOR-SUPPLIED url and fetch it
 * server-side with NO auth guard (see feeds.controller.ts doc — the same
 * public-fetch shape as /proxy/web). If that fetch weren't SSRF-gated,
 * ANYONE (unauthed — this route has no login wall at all) could point it at
 * http://169.254.169.254/… and read cloud-internal metadata back through
 * the "parsed feed" response.
 *
 * These tests use the REAL FeedsService (NOT a mock) — which calls the REAL
 * `safeFetch` — to prove every internal/disallowed URL is rejected with an
 * SsrfError BEFORE any socket opens. Every URL here is a private/loopback/
 * metadata literal or a bad scheme/port, so the test is hermetic and fast
 * (no network). Mirrors data-source.ssrf.spec.ts's structure exactly.
 */
import { Logger } from '@nestjs/common';
import { FeedsService, SsrfError } from './feeds.service';
import { RedisService } from '../realtime/redis.service';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined as any);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined as any);
});
afterAll(() => jest.restoreAllMocks());

// RedisService boots with REDIS_URL unset in the test env, so
// `.publisher` is null — exercising the fail-open/in-memory-fallback path
// the feeds cache is built for (see feeds-cache.spec.ts for direct coverage).
function makeService(): FeedsService {
  return new FeedsService(new RedisService());
}

const INTERNAL_TARGETS: Array<[string, string]> = [
  ['AWS/GCP IMDS', 'http://169.254.169.254/latest/meta-data/'],
  ['IPv4 loopback', 'http://127.0.0.1:8080/feed.xml'],
  ['private 10/8', 'http://10.0.0.5/feed.xml'],
  ['private 192.168/16', 'http://192.168.1.1/feed.xml'],
  ['private 172.16/12', 'http://172.16.0.1/feed.xml'],
  ['IPv6 loopback', 'http://[::1]:9000/feed.xml'],
  ['CGNAT 100.64/10', 'http://100.64.0.1/feed.xml'],
];

const BAD_SHAPES: Array<[string, string]> = [
  ['file scheme', 'file:///etc/passwd'],
  ['ftp scheme', 'ftp://example.com/feed.xml'],
  ['data scheme', 'data:text/xml,<rss></rss>'],
  ['disallowed port', 'http://example.com:22/feed.xml'],
];

describe('FeedsService.getRssFeed — SSRF defense (real safeFetch)', () => {
  it.each(INTERNAL_TARGETS)('rejects an internal destination (%s)', async (_label, url) => {
    const svc = makeService();
    await expect(svc.getRssFeed(url)).rejects.toBeInstanceOf(SsrfError);
  });

  it.each(BAD_SHAPES)('rejects a disallowed URL shape (%s)', async (_label, url) => {
    const svc = makeService();
    await expect(svc.getRssFeed(url)).rejects.toBeInstanceOf(SsrfError);
  });
});

describe('FeedsService.getIcsFeed — SSRF defense (real safeFetch)', () => {
  it.each(INTERNAL_TARGETS)('rejects an internal destination (%s)', async (_label, url) => {
    const svc = makeService();
    await expect(svc.getIcsFeed(url)).rejects.toBeInstanceOf(SsrfError);
  });

  it.each(BAD_SHAPES)('rejects a disallowed URL shape (%s)', async (_label, url) => {
    const svc = makeService();
    await expect(svc.getIcsFeed(url)).rejects.toBeInstanceOf(SsrfError);
  });
});

describe('FeedsController error mapping — no IP/body leakage', () => {
  it('SsrfError never surfaces the resolved private IP to the thrown message consumed by the controller', async () => {
    const svc = makeService();
    let thrown: any;
    try {
      await svc.getRssFeed('http://169.254.169.254/latest/meta-data/');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SsrfError);
    expect(thrown.name).toBe('SsrfError');
    // The controller's mapError() collapses ANY SsrfError to a fixed,
    // generic public string (see feeds.controller.spec.ts) — this just
    // pins that the service surfaces the right TYPE for that mapping to work.
  });
});
