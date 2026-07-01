/**
 * Response cache for the feeds module — keyed by the normalized upstream
 * URL, backed by Redis with an in-memory LRU fallback when Redis is
 * unavailable (mirrors the "boot without Redis" contract every other
 * module in this codebase honors — see RedisService's constructor doc).
 *
 * WHY THIS EXISTS (Greg's efficiency mandate, 2026-07-01): a 150-screen
 * fleet all showing the SAME RSS/calendar feed would otherwise hit the
 * origin once per screen per poll. A district athletic-department feed
 * polled by 150 boards every 5 minutes is 150 origin fetches/5min = 1800/hr
 * against one small blog's RSS endpoint — antisocial, and a good way to get
 * rate-limited or IP-banned by the upstream. Caching by URL means the
 * origin is hit ~once per TTL **total**, regardless of how many screens or
 * tenants are displaying that same feed.
 *
 * Design:
 *   - Redis path: a plain GET/SET/EX on `RedisService.publisher` (already a
 *     raw ioredis client — no separate cache abstraction exists in this
 *     codebase, see RedisService doc). Multi-replica safe — every API
 *     instance shares the same cache entries.
 *   - In-memory fallback: a bounded LRU `Map` (insertion-order eviction),
 *     used ONLY when `RedisService.publisher` is null (Redis absent/down).
 *     Per-replica only — acceptable degradation, matches the fail-open
 *     posture of every other cache/limiter in this codebase (branding
 *     rate limiter, ai-hourly-cap, etc.).
 *   - Fail-open on Redis errors: a cache miss or Redis hiccup NEVER blocks
 *     the request — it just means we fetch the origin again this time.
 */

import { Logger } from '@nestjs/common';

const logger = new Logger('FeedsCache');

/** Minimal structural type for the ioredis client we depend on — avoids a
 *  hard dependency on the realtime module's concrete Redis type. */
export interface FeedsCacheRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
}

const MEMORY_MAX_ENTRIES = 500;

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

/** Bounded in-memory LRU (insertion-order eviction — cheap, no external
 *  dependency; the codebase has no LRU library either, see player-ota's
 *  own hand-rolled Map-based LRU for the established pattern). */
class MemoryLru {
  private map = new Map<string, MemoryEntry>();

  get(key: string): string | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    // Re-insert to bump recency (Map preserves insertion order).
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string, ttlSeconds: number): void {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    while (this.map.size > MEMORY_MAX_ENTRIES) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
    }
  }
}

// Two independent LRUs (RSS vs ICS have different TTLs and we'd rather not
// let one starve the other's capacity under load).
const rssMemory = new MemoryLru();
const icsMemory = new MemoryLru();

export type FeedKind = 'rss' | 'ics';

function keyFor(kind: FeedKind, url: string): string {
  return `feeds:${kind}:${url}`;
}

export async function getCachedFeed(
  redis: FeedsCacheRedisClient | null | undefined,
  kind: FeedKind,
  url: string,
): Promise<string | null> {
  const key = keyFor(kind, url);
  if (redis) {
    try {
      const hit = await redis.get(key);
      if (hit != null) return hit;
    } catch (e: any) {
      logger.debug(`Redis GET failed, falling back to memory: ${e?.message || e}`);
    }
  }
  const memory = kind === 'rss' ? rssMemory : icsMemory;
  return memory.get(key);
}

export async function setCachedFeed(
  redis: FeedsCacheRedisClient | null | undefined,
  kind: FeedKind,
  url: string,
  payload: string,
  ttlSeconds: number,
): Promise<void> {
  const key = keyFor(kind, url);
  // Always write the in-memory fallback too — cheap, and it means a Redis
  // outage mid-flight doesn't suddenly cost every replica a cold cache.
  const memory = kind === 'rss' ? rssMemory : icsMemory;
  memory.set(key, payload, ttlSeconds);
  if (redis) {
    try {
      await redis.set(key, payload, 'EX', ttlSeconds);
    } catch (e: any) {
      logger.debug(`Redis SET failed (memory fallback already written): ${e?.message || e}`);
    }
  }
}
