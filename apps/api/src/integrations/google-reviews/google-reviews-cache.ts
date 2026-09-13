/**
 * Response cache for the Google Reviews integration — Redis with an
 * in-memory LRU fallback. Structurally identical to `feeds/feeds-cache.ts`
 * (same GET/SET-EX on `RedisService.publisher`, same bounded insertion-order
 * LRU, same fail-open-on-Redis-error contract); see that file's header for the
 * reasoning behind the shape. Only the key prefix and the TTL differ.
 *
 * ── WHY IT EXISTS, TWICE OVER ────────────────────────────────────────────
 * 1. COST. `reviews` is the only field in our mask that bills under Google's
 *    "Place Details Enterprise + Atmosphere" SKU — the most expensive Places
 *    tier. A 150-screen fleet all showing one restaurant's reviews and polling
 *    would otherwise buy 150 Enterprise-tier calls per poll for one answer.
 *    Cached by placeId, the upstream is hit ~once per TTL in total, no matter
 *    how many screens or tenants display that business.
 * 2. POLITENESS / QUOTA. Same argument as feeds-cache: one origin, one call.
 *
 * ── WHY THE TTL IS SIX HOURS AND NOT LONGER ──────────────────────────────
 * Google Maps Platform Service Specific Terms §5.4 (Places API, *Caching*):
 *
 *   "Customer can temporarily cache latitude (lat) and longitude (lng) values
 *    from the Places API for up to 30 consecutive calendar days, after which
 *    Customer must delete the cached latitude and longitude values. Customer
 *    can cache Places API Place ID (place_id) values, in accordance with the
 *    Places API Policies."
 *
 * and the Places API Policies, *Exceptions from caching restrictions*:
 *
 *   "Note that the place ID, used to uniquely identify a place, is exempt from
 *    the caching restrictions. You can therefore store place ID values
 *    indefinitely."
 *
 * So exactly ONE Places value may be stored without a clock — the place ID —
 * and that is the only Places value this product persists (it lives in the
 * widget's `defaultConfig.placeId`). Everything else, review text included,
 * is *temporary caching* under the terms, with 30 consecutive calendar days
 * as the longest window the terms name for any Places content. Six hours sits
 * two orders of magnitude inside that ceiling while still collapsing a fleet's
 * worth of polls into ~4 upstream calls a day per business. Reviews are not
 * life-safety and do not change by the minute; a shorter TTL would buy
 * freshness nobody can perceive at the price of the most expensive SKU we
 * call. Raise this number only with a reason that survives the 30-day line.
 */

import { Logger } from '@nestjs/common';

const logger = new Logger('GoogleReviewsCache');

/** Minimal structural type for the ioredis client we depend on — avoids a
 *  hard dependency on the realtime module's concrete Redis type. */
export interface GoogleReviewsCacheRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
}

/**
 * Seconds a fetched review payload may be served from cache. See the header:
 * this is a *temporary* cache under the Maps terms, well inside the 30-day
 * ceiling those terms name, and nothing here is ever written to Postgres.
 */
export const REVIEWS_CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours

/** Hard upper bound for this module, expressed in the policy's own unit, so a
 *  future TTL edit has to walk past the number it would be violating. */
export const REVIEWS_CACHE_POLICY_MAX_SECONDS = 30 * 24 * 60 * 60; // 30 days

const MEMORY_MAX_ENTRIES = 200;

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

/** Bounded in-memory LRU (insertion-order eviction) — the per-replica
 *  fallback used only when Redis is absent/down. */
class MemoryLru {
  private map = new Map<string, MemoryEntry>();

  get(key: string): string | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
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

  clear(): void {
    this.map.clear();
  }
}

const reviewsMemory = new MemoryLru();

function keyFor(placeId: string): string {
  return `greviews:place:${placeId}`;
}

export async function getCachedReviews(
  redis: GoogleReviewsCacheRedisClient | null | undefined,
  placeId: string,
): Promise<string | null> {
  const key = keyFor(placeId);
  if (redis) {
    try {
      const hit = await redis.get(key);
      if (hit != null) return hit;
    } catch (e: any) {
      logger.debug(`Redis GET failed, falling back to memory: ${e?.message || e}`);
    }
  }
  return reviewsMemory.get(key);
}

export async function setCachedReviews(
  redis: GoogleReviewsCacheRedisClient | null | undefined,
  placeId: string,
  payload: string,
  ttlSeconds: number = REVIEWS_CACHE_TTL_SECONDS,
): Promise<void> {
  // Never let a caller (or a future edit) push a Places payload past the only
  // ceiling the Maps terms actually name for Places content.
  const ttl = Math.min(Math.max(1, Math.floor(ttlSeconds)), REVIEWS_CACHE_POLICY_MAX_SECONDS);
  const key = keyFor(placeId);
  // Always write the in-memory fallback too — cheap, and it means a Redis
  // outage mid-flight doesn't suddenly cost every replica a cold cache.
  reviewsMemory.set(key, payload, ttl);
  if (redis) {
    try {
      await redis.set(key, payload, 'EX', ttl);
    } catch (e: any) {
      logger.debug(`Redis SET failed (memory fallback already written): ${e?.message || e}`);
    }
  }
}

/** Test seam — drops the per-process fallback so one spec's writes cannot
 *  leak into the next one's expectations. Never called in production. */
export function __clearReviewsMemoryCache(): void {
  reviewsMemory.clear();
}
