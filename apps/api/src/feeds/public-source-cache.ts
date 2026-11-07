import { Injectable } from '@nestjs/common';
import { safeFetch } from '../branding/safe-fetch';
import { RedisService } from '../realtime/redis.service';
import { FeedsRateLimiter } from './feeds-rate-limiter';
import { getCachedFeed, setCachedFeed } from './feeds-cache';
/** Shared read-only source transport. Callers supply fixed, reviewed provider
 * URLs; operators never choose a host through these provider endpoints. */
@Injectable()
export class PublicSourceCache {
  private hot = new Map<
    string,
    { until: number; bytes: number; value: unknown }
  >();
  private hotBytes = 0;
  private remember(key: string, value: unknown, seconds: number) {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    const previous = this.hot.get(key);
    if (previous) {
      this.hotBytes -= previous.bytes;
      this.hot.delete(key);
    }
    if (bytes > 24 * 1024 * 1024) return;
    this.hot.set(key, { until: Date.now() + seconds * 1000, bytes, value });
    this.hotBytes += bytes;
    while (this.hotBytes > 24 * 1024 * 1024 || this.hot.size > 40) {
      const first = this.hot.keys().next().value!;
      this.hotBytes -= this.hot.get(first)!.bytes;
      this.hot.delete(first);
    }
  }
  private pending = new Map<string, Promise<unknown>>();
  constructor(
    private readonly redis: RedisService,
    private readonly limiter: FeedsRateLimiter,
  ) {}
  async read<T>(
    key: string,
    url: string,
    seconds: number,
    parse: (body: string) => T,
    options: {
      maxBytes?: number;
      paceMs?: number;
      provider?: string;
      hourlyLimit?: number;
      maxSourceAgeMs?: number;
      /** Hand `parse` the body as latin1 (byte-preserving) for binary sources: zip, protobuf. */
      binary?: boolean;
    } = {},
  ): Promise<{ value: T; fetchedAt: string }> {
    const local = this.hot.get(key);
    if (local && local.until > Date.now())
      return local.value as { value: T; fetchedAt: string };
    const saved = await getCachedFeed(
      this.redis.publisher,
      'rss',
      'public-source-v1:' + key,
    );
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (
          data.value != null &&
          Date.now() - Date.parse(data.fetchedAt) >= -60000 &&
          Date.now() - Date.parse(data.fetchedAt) < seconds * 1000
        ) {
          this.remember(
            key,
            data,
            Math.max(
              1,
              seconds - (Date.now() - Date.parse(data.fetchedAt)) / 1000,
            ),
          );
          return data;
        }
      } catch {
        /* refresh invalid cache */
      }
    }
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<{ value: T; fetchedAt: string }>;
    if (this.pending.size >= 40) throw new Error('Source busy');
    const request = (async () => {
      if (options.paceMs) {
        const publisher = this.redis.publisher;
        if (
          !publisher ||
          !(await publisher.set(
            'feeds:public:pace:' + (options.provider || new URL(url).hostname),
            '1',
            'PX',
            options.paceMs,
            'NX',
          ))
        )
          throw new Error('Source busy');
      }
      this.limiter.check(
        new URL(url).hostname + ':' + key,
        options.hourlyLimit ?? 60,
      );
      const response = await safeFetch(url, {
        timeoutMs: 10000,
        maxBytes: options.maxBytes || 512 * 1024,
        accept: 'application/json, application/xml, text/xml, text/plain, */*',
        userAgent:
          'VenueOS/1.0 (https://venue-os.app; public information display)',
      });
      if (response.status !== 200)
        throw new Error('Source temporarily unavailable');
      if (options.maxSourceAgeMs) {
        const updated = Date.parse(
          String(response.headers['last-modified'] || ''),
        );
        if (
          !Number.isFinite(updated) ||
          updated < Date.now() - options.maxSourceAgeMs ||
          updated > Date.now() + 60000
        )
          throw new Error('Source update is stale');
      }
      const data = {
        value: parse(
          response.body.toString(options.binary ? 'latin1' : 'utf8'),
        ),
        fetchedAt: new Date().toISOString(),
      };
      await setCachedFeed(
        this.redis.publisher,
        'rss',
        'public-source-v1:' + key,
        JSON.stringify(data),
        seconds,
      );
      this.remember(key, data, seconds);
      return data;
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
}
