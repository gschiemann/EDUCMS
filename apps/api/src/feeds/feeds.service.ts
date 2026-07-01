/**
 * FeedsService — fetch + parse + cache for RSS/Atom and ICS feeds.
 *
 * Every outbound fetch goes through `safeFetch` (the SSRF gate shared with
 * the branding scraper / webhook delivery / data-source proxy) — never a
 * raw `fetch()`. See ../branding/safe-fetch.ts for the full defense
 * (DNS-resolve + private-range rejection, connect-time DNS-rebind pin,
 * byte cap, timeout, bounded redirect re-validation).
 *
 * Caching (feeds-cache.ts): Redis-backed with an in-memory LRU fallback,
 * keyed by the normalized URL. RSS TTL 5 min, ICS TTL 15 min (calendars
 * change far less often than news feeds). A 150-screen fleet showing the
 * same feed therefore hits the origin ~once per TTL, not once per screen —
 * see feeds-cache.ts doc for the full math.
 */

import { Injectable, Logger } from '@nestjs/common';
import { safeFetch, SsrfError, FetchTooLargeError } from '../branding/safe-fetch';
import { RedisService } from '../realtime/redis.service';
import { getCachedFeed, setCachedFeed } from './feeds-cache';
import { parseRssOrAtom, FeedParseError } from './rss-parser';
import { parseIcs, IcsParseError } from './ics-parser';
import { RssFeedResult, IcsFeedResult } from './feeds.types';

const RSS_TTL_SECONDS = 5 * 60; // 5 minutes
const ICS_TTL_SECONDS = 15 * 60; // 15 minutes
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB — generous for even a large feed
const TIMEOUT_MS = 8000;

@Injectable()
export class FeedsService {
  private readonly logger = new Logger(FeedsService.name);

  constructor(private readonly redis: RedisService) {}

  /** Normalizes a URL for use as a cache/rate-limit key — strips fragment,
   *  keeps query (some feeds are parametrized), lowercases the host. */
  normalizeUrl(rawUrl: string): { url: string; host: string } {
    const u = new URL(rawUrl);
    u.hash = '';
    return { url: u.toString(), host: u.hostname.toLowerCase() };
  }

  async getRssFeed(rawUrl: string): Promise<RssFeedResult> {
    const { url } = this.normalizeUrl(rawUrl);

    const cached = await getCachedFeed(this.redis.publisher, 'rss', url);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as RssFeedResult;
        return { ...parsed, cached: true };
      } catch {
        // Corrupt cache entry — fall through to a fresh fetch rather than fail.
      }
    }

    const upstream = await safeFetch(url, {
      timeoutMs: TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    });

    if (upstream.status < 200 || upstream.status >= 300) {
      throw new FeedParseError(`Upstream returned HTTP ${upstream.status}`);
    }

    const xml = upstream.body.toString('utf8');
    const result = parseRssOrAtom(xml);

    await setCachedFeed(this.redis.publisher, 'rss', url, JSON.stringify(result), RSS_TTL_SECONDS);
    this.logger.debug(`RSS fetched+cached: ${result.items.length} items from ${new URL(url).hostname}`);
    return result;
  }

  async getIcsFeed(rawUrl: string): Promise<IcsFeedResult> {
    const { url } = this.normalizeUrl(rawUrl);

    const cached = await getCachedFeed(this.redis.publisher, 'ics', url);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as IcsFeedResult;
        return { ...parsed, cached: true };
      } catch {
        // Corrupt cache entry — fall through to a fresh fetch rather than fail.
      }
    }

    const upstream = await safeFetch(url, {
      timeoutMs: TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      accept: 'text/calendar, application/octet-stream, */*',
    });

    if (upstream.status < 200 || upstream.status >= 300) {
      throw new IcsParseError(`Upstream returned HTTP ${upstream.status}`);
    }

    const text = upstream.body.toString('utf8');
    const result = parseIcs(text);

    await setCachedFeed(this.redis.publisher, 'ics', url, JSON.stringify(result), ICS_TTL_SECONDS);
    this.logger.debug(
      `ICS fetched+cached: ${result.events.length} events (${result.meta.recurringEventCount} recurring) from ${new URL(url).hostname}`,
    );
    return result;
  }
}

// Re-export so the controller's catch block can `instanceof` these without
// importing from three different files.
export { SsrfError, FetchTooLargeError, FeedParseError, IcsParseError };
