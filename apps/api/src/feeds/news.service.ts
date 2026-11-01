import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { safeFetch } from '../branding/safe-fetch';
import { RedisService } from '../realtime/redis.service';
import { getCachedFeed, setCachedFeed } from './feeds-cache';
import { FeedsRateLimiter } from './feeds-rate-limiter';
import { parseRssOrAtom } from './rss-parser';
import type { RssFeedResult } from './feeds.types';

export type NewsScope = 'local' | 'national' | 'world';
export interface NewsArticle {
  title: string;
  link: string;
  publisher: string;
  indexedAt: string;
  scope: NewsScope;
}
export interface NewsResult {
  items: NewsArticle[];
  fetchedAt: string;
  location: string;
  scope: NewsScope;
  provider: 'GDELT';
  stale?: boolean;
  limited?: boolean;
}

/** Decode headline entities as text; React still escapes any markup. */
export function normalizeNewsTitle(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: ' ',
    hellip: '…',
    mdash: '—',
    ndash: '–',
    rsquo: '’',
    lsquo: '‘',
    rdquo: '”',
    ldquo: '“',
  };
  return value
    .replace(
      /&#(x[0-9a-f]+|[0-9]+);|&(amp|quot|apos|lt|gt|nbsp|hellip|mdash|ndash|rsquo|lsquo|rdquo|ldquo);/gi,
      (raw, numeric, name) => {
        if (name) return named[name.toLowerCase()];
        const n =
          numeric[0].toLowerCase() === 'x'
            ? parseInt(numeric.slice(1), 16)
            : Number(numeric);
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
          ? String.fromCodePoint(n)
          : raw;
      },
    )
    .trim();
}

/** Metadata only: never copy article bodies, logos or publisher photographs.
 * GDELT's dataset terms permit attributed commercial reuse. Coverage is search
 * based, not editorially curated, and seendate is INDEX time, not publication. */
export function parseNewsArticles(
  raw: unknown,
  scope: NewsScope,
  now = Date.now(),
): NewsArticle[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.reduce<NewsArticle[]>((out, a) => {
    if (
      !a ||
      typeof a.title !== 'string' ||
      !a.title.trim() ||
      typeof a.url !== 'string'
    )
      return out;
    try {
      const u = new URL(a.url);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
        return out;
      u.hash = '';
      for (const key of Array.from(u.searchParams.keys()))
        if (key.startsWith('utm_')) u.searchParams.delete(key);
      const d = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(
        String(a.seendate),
      );
      if (!d) return out;
      const indexedAt = `${d[1]}-${d[2]}-${d[3]}T${d[4]}:${d[5]}:${d[6]}Z`;
      const time = Date.parse(indexedAt);
      if (
        !Number.isFinite(time) ||
        time > now + 3600000 ||
        time < now - 86400000
      )
        return out;
      const key = a.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (seen.has(key) || seen.has(u.href) || out.length >= 60) return out;
      seen.add(key);
      seen.add(u.href);
      out.push({
        title: normalizeNewsTitle(a.title).slice(0, 360),
        link: u.href,
        publisher: u.hostname.replace(/^www\./, ''),
        indexedAt,
        scope,
      });
    } catch {
      /* discard malformed upstream rows */
    }
    return out;
  }, []);
}

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);
  private pending = new Map<string, Promise<NewsResult>>();
  private refreshes = new Map<string, Promise<NewsResult>>();
  private indexPending?: Promise<{ feed: RssFeedResult; fetchedAt: string }>;
  constructor(
    private readonly redis: RedisService,
    private readonly limiter: FeedsRateLimiter,
  ) {}
  private async json(url: string) {
    const r = await safeFetch(url, {
      timeoutMs:
        new URL(url).hostname === 'api.gdeltproject.org' ? 20000 : 8000,
      maxBytes: 1024 * 1024,
      accept: 'application/json',
      userAgent: 'VenueOS/1.0 (https://venue-os.app; news metadata)',
    });
    if (
      r.status === 429 &&
      this.redis.publisher &&
      new URL(url).hostname === 'api.gdeltproject.org'
    ) {
      const retry = Number(r.headers?.['retry-after']);
      await this.redis.publisher.set(
        'feeds:gdelt:cooldown',
        '1',
        'EX',
        Number.isFinite(retry) ? Math.max(30, Math.min(300, retry)) : 60,
      );
    }
    if (r.status !== 200)
      throw new Error(`News provider returned HTTP ${r.status}`);
    return JSON.parse(r.body.toString('utf8'));
  }
  async get(
    scope: NewsScope,
    location: string,
    sources: string[] = [],
  ): Promise<NewsResult> {
    // National/world are shared across ALL locations, not one cache per ZIP.
    const key = `news-v3:${scope}:${scope === 'local' ? location.toLowerCase() : 'us'}:${sources.join(',')}`;
    const cached = await getCachedFeed(this.redis.publisher, 'rss', key);
    if (cached) {
      try {
        return JSON.parse(cached) as NewsResult;
      } catch {
        /* refresh */
      }
    }
    const running = this.pending.get(key);
    if (running) return running;
    const lastGood = async (): Promise<NewsResult | null> => {
      const saved = await getCachedFeed(
        this.redis.publisher,
        'rss',
        `last-good:${key}`,
      );
      if (!saved) return null;
      try {
        const result = JSON.parse(saved) as NewsResult;
        if (
          result.items.length &&
          Date.now() - Date.parse(result.fetchedAt) <= 3600000
        )
          return { ...result, stale: true };
      } catch {
        /* invalid cache */
      }
      return null;
    };
    const remember = async (result: NewsResult, seconds: number) => {
      await setCachedFeed(
        this.redis.publisher,
        'rss',
        key,
        JSON.stringify(result),
        seconds,
      );
      if (result.items.length)
        await setCachedFeed(
          this.redis.publisher,
          'rss',
          `last-good:${key}`,
          JSON.stringify(result),
          3600,
        );
      return result;
    };
    const unavailable = () =>
      new ServiceUnavailableException(
        'News is temporarily unavailable. Retrying automatically.',
      );
    // Search may take twenty seconds or be throttled. Keep it bounded and
    // coalesced separately from the fast edition response: closing a browser
    // request must not start a second search for the same edition.
    let refresh = this.refreshes.get(key);
    if (
      !refresh &&
      this.refreshes.size < 12 &&
      !(await getCachedFeed(this.redis.publisher, 'rss', `backoff:${key}`))
    ) {
      // Recheck after the cache read yielded to another request.
      refresh = this.refreshes.get(key);
      if (!refresh) {
        refresh = this.load(scope, location, sources)
          .then(async (result) => {
            if (result.items.length) return remember(result, 600);
            return (await lastGood()) || result;
          })
          .catch(async (error: unknown) => {
            this.logger.warn(
              `News ${scope} fetch failed: ${error instanceof Error ? error.message : 'unknown upstream error'}`,
            );
            await setCachedFeed(
              this.redis.publisher,
              'rss',
              `backoff:${key}`,
              '1',
              60,
            );
            return (await lastGood()) || Promise.reject(unavailable());
          })
          .finally(() => this.refreshes.delete(key));
        this.refreshes.set(key, refresh);
        void refresh.catch(() => undefined); // A fast index response may finish before this background refresh.
      }
    }
    const waiting = this.pending.get(key);
    if (waiting) return waiting;
    if (this.pending.size >= 12)
      return (
        (await lastGood()) || {
          items: [],
          fetchedAt: new Date().toISOString(),
          location,
          scope,
          provider: 'GDELT',
          limited: true,
        }
      );
    const request = (async () => {
      try {
        const indexed = await this.recentIndex(scope, location, sources);
        if (indexed.items.length) {
          // A complete search edition always wins over the limited index.
          const complete = await getCachedFeed(
            this.redis.publisher,
            'rss',
            key,
          );
          if (complete) {
            const result = JSON.parse(complete) as NewsResult;
            if (result.items.length && !result.limited) return result;
          }
          return remember(indexed, 60);
        }
        const good = await lastGood();
        if (good) return good;
        // Return an honest empty edition promptly; the pending search fills
        // the shared cache, and clients retry limited editions after a minute.
        return indexed;
      } catch {
        if (refresh) {
          try {
            return await refresh;
          } catch {
            /* use last known edition below */
          }
        }
        return (await lastGood()) || Promise.reject(unavailable());
      }
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
  /** Official, shared 15-minute rolling index; no search API quota.
   * Same metadata-only boundary and selected domains. Never relabel unrelated
   * national stories as local when a city has no matching headline. */
  private async recentIndex(
    scope: NewsScope,
    location: string,
    sources: string[],
  ): Promise<NewsResult> {
    const key = 'gdelt-recent-index-v2';
    const saved = await getCachedFeed(this.redis.publisher, 'rss', key);
    let indexed: { feed: RssFeedResult; fetchedAt: string };
    if (saved) indexed = JSON.parse(saved);
    else {
      if (!this.indexPending)
        this.indexPending = (async () => {
          const publisher = this.redis.publisher;
          if (
            !publisher ||
            !(await publisher.set(
              'feeds:gdelt:index-lease',
              '1',
              'EX',
              15,
              'NX',
            ))
          )
            throw new Error('Recent news index busy');
          this.limiter.check('data.gdeltproject.org');
          const response = await safeFetch(
            'https://data.gdeltproject.org/gdeltv3/gal/feed.rss',
            {
              timeoutMs: 8000,
              maxBytes: 3 * 1024 * 1024,
              accept: 'application/rss+xml, application/xml',
              userAgent: 'VenueOS/1.0 (https://venue-os.app; news metadata)',
            },
          );
          if (response.status !== 200)
            throw new Error('Recent news index unavailable');
          const incoming = parseRssOrAtom(
            response.body.toString('utf8'),
            10000,
          );
          // The upstream replaces its feed every fifteen minutes. Retain real
          // indexed metadata across windows; never change a story's index time.
          const archive = await getCachedFeed(
            publisher,
            'rss',
            'gdelt-index-archive-v1',
          );
          let previous: RssFeedResult['items'] = [];
          try {
            previous = archive ? JSON.parse(archive) : [];
          } catch {
            /* cold archive */
          }
          const cutoff = Date.now() - 6 * 3600000;
          const seen = new Set<string>();
          const items = [...incoming.items, ...previous]
            .filter((item) => {
              const at = Date.parse(item.publishedAt || '');
              if (
                !Number.isFinite(at) ||
                at < cutoff ||
                at > Date.now() + 3600000 ||
                seen.has(item.link)
              )
                return false;
              seen.add(item.link);
              return true;
            })
            .slice(0, 12000);
          await setCachedFeed(
            publisher,
            'rss',
            'gdelt-index-archive-v1',
            JSON.stringify(items),
            6 * 3600,
          );
          const result = {
            feed: { ...incoming, items },
            fetchedAt: new Date().toISOString(),
          };
          await setCachedFeed(
            publisher,
            'rss',
            key,
            JSON.stringify(result),
            300,
          );
          return result;
        })().finally(() => {
          this.indexPending = undefined;
        });
      indexed = await this.indexPending;
    }
    const place = scope === 'local' ? await this.place(location) : '';
    const outlets = sources.length
      ? sources
      : scope === 'national'
        ? [
            'apnews.com',
            'reuters.com',
            'cnn.com',
            'cbsnews.com',
            'abcnews.go.com',
            'nbcnews.com',
            'npr.org',
            'pbs.org',
            'nytimes.com',
            'washingtonpost.com',
            'usatoday.com',
            'latimes.com',
            'cnbc.com',
            'axios.com',
            'politico.com',
            'thehill.com',
            'newsweek.com',
            'abcnews.com',
            'aol.com',
            'foxnews.com',
            'time.com',
            'forbes.com',
            'fortune.com',
            'bloomberg.com',
            'nypost.com',
            'theatlantic.com',
            'sfgate.com',
            'sacbee.com',
            'sfchronicle.com',
            'miamiherald.com',
            'bostonglobe.com',
            'seattletimes.com',
            'chicagotribune.com',
            'denverpost.com',
            'dallasnews.com',
            'tampabay.com',
            'oregonlive.com',
            'nj.com',
          ]
        : scope === 'world'
          ? [
              'bbc.com',
              'bbc.co.uk',
              'theguardian.com',
              'aljazeera.com',
              'dw.com',
              'france24.com',
              'rnz.co.nz',
              'cbc.ca',
              'abc.net.au',
              'independent.co.uk',
              'news.sky.com',
              'straitstimes.com',
              'scmp.com',
              'rte.ie',
              'japantimes.co.jp',
            ]
          : [];
    const rows = indexed.feed.items
      .filter((item) => {
        try {
          const url = new URL(item.link),
            host = url.hostname.replace(/^www\./, '');
          if (
            outlets.length &&
            !outlets.some(
              (outlet) => host === outlet || host.endsWith('.' + outlet),
            )
          )
            return false;
          if (
            scope === 'local' &&
            !item.title
              .toLowerCase()
              .includes(place.split(',')[0].trim().toLowerCase())
          )
            return false;
          // The rolling index is multilingual; keep the known English sections.
          if (
            ['bbc.com', 'bbc.co.uk'].includes(host) &&
            !url.pathname.startsWith('/news/')
          )
            return false;
          if (host === 'dw.com' && !url.pathname.startsWith('/en/'))
            return false;
          if (host === 'france24.com' && !url.pathname.startsWith('/en/'))
            return false;
          return true;
        } catch {
          return false;
        }
      })
      .map((item) => ({
        title: item.title,
        url: item.link,
        seendate: item.publishedAt
          ?.replace(/[-:]/g, '')
          .replace(/\.\d+Z$/, 'Z'),
      }));
    return {
      items: parseNewsArticles(rows, scope).slice(0, 20),
      fetchedAt: indexed.fetchedAt,
      location: place,
      scope,
      provider: 'GDELT',
      limited: true,
    };
  }
  private async place(location: string): Promise<string> {
    if (!/^\d{5}$/.test(location)) return location;
    const key = `news-zip:${location}`;
    const cached = await getCachedFeed(this.redis.publisher, 'geocode', key);
    if (cached) return cached;
    this.limiter.check('api.zippopotam.us');
    const result = await this.json(`https://api.zippopotam.us/us/${location}`);
    const name = result?.places?.[0]?.['place name'];
    if (typeof name !== 'string' || !/^[\p{L}\p{N} .,'-]{2,80}$/u.test(name))
      throw new Error('ZIP not found');
    await setCachedFeed(this.redis.publisher, 'geocode', key, name, 30 * 86400);
    return name;
  }
  private async pace() {
    const publisher = this.redis.publisher;
    if (!publisher || (await publisher.get('feeds:gdelt:cooldown')))
      throw new Error('News provider cooling down');
    // Coalesced channel misses queue briefly instead of failing two of three
    // simultaneous editions. The lease covers the request plus a completion-relative gap across replicas.
    for (let attempt = 0; attempt < 16; attempt++) {
      if (await publisher.set('feeds:gdelt:pace', '1', 'PX', 90000, 'NX'))
        return;
      if (attempt < 15)
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('News provider busy');
  }
  private async load(
    scope: NewsScope,
    location: string,
    sources: string[],
  ): Promise<NewsResult> {
    const place = scope === 'local' ? await this.place(location) : '';
    // Fail closed if shared upstream pacing is unavailable. No per-screen burst.
    await this.pace();
    this.limiter.check('api.gdeltproject.org');
    const phrase = place
      .split(',')[0]
      .replace(/[^\p{L}\p{N} .,'-]/gu, '')
      .replace(/,/g, ' ')
      .trim();
    let query =
      scope === 'local'
        ? `"${phrase}" sourcelang:english`
        : scope === 'national'
          ? 'sourcecountry:unitedstates sourcelang:english'
          : '-sourcecountry:unitedstates sourcelang:english';
    const automatic =
      scope === 'local'
        ? []
        : scope === 'national'
          ? [
              'apnews.com',
              'reuters.com',
              'cnn.com',
              'cbsnews.com',
              'abcnews.go.com',
              'nbcnews.com',
              'npr.org',
              'pbs.org',
            ]
          : [
              'bbc.com',
              'bbc.co.uk',
              'theguardian.com',
              'reuters.com',
              'aljazeera.com',
              'dw.com',
              'france24.com',
              'apnews.com',
            ];
    const outlets = sources.length ? sources : automatic;
    if (outlets.length)
      query += ` (${outlets.map((s) => `domainis:${s}`).join(' OR ')})`;
    const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
    for (const [k, v] of Object.entries({
      query,
      mode: 'artlist',
      format: 'json',
      maxrecords: '20',
      timespan: '1d',
      sort: 'datedesc',
    }))
      url.searchParams.set(k, v);
    let raw: any;
    try {
      raw = await this.json(url.href);
    } finally {
      await this.redis.publisher?.set('feeds:gdelt:pace', '1', 'PX', 6000);
    }
    if (!Array.isArray(raw?.articles)) throw new Error('Invalid news response');
    return {
      items: parseNewsArticles(raw.articles, scope),
      fetchedAt: new Date().toISOString(),
      location: place,
      scope,
      provider: 'GDELT',
    };
  }
}
