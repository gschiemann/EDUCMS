/**
 * Shared cache + spend caps for the live-data families.
 *
 * ── ONE FETCH PER QUERY PER TTL, NOT PER SCREEN ──────────────────────────
 * Every screen showing the same airport / league / grid cell / symbol reads
 * the same cached answer. Redis first (shared by replicas), a bounded
 * per-process LRU as the fallback, and in-flight de-duplication so a fleet
 * polling a cold key buys one upstream call, not one per screen.
 *
 * ── TWO SPEND WALLS, CHARGED ONLY ON A MISS ──────────────────────────────
 *   • per tenant per family per hour (`tenantHourlyCap`)   — one account
 *     cannot run up the bill;
 *   • per provider per hour, cluster-wide (`providerHourlyCeiling`) — no
 *     combination of accounts can either. With no Redis it falls back to a
 *     per-process counter rather than failing open: this wall exists to bound
 *     money, so "Redis is down" must not mean "unbounded".
 * A warm cache spends nothing and charges nothing.
 */

import { HttpException, HttpStatus } from '@nestjs/common';

import {
  aiRecordEvent,
  aiWindowCount,
  AI_HOURLY_WINDOW_MS,
} from '../../ai/ai-hourly-cap';
import type { RedisService } from '../../realtime/redis.service';
import {
  providerHourlyCeiling,
  tenantHourlyCap,
  type LiveDataFamily,
} from './live-data-providers';

const MEMORY_MAX_ENTRIES = 300;
const MEMORY_MAX_BYTES = 8 * 1024 * 1024;

interface Entry {
  value: string;
  expiresAt: number;
  bytes: number;
}

const memory = new Map<string, Entry>();
let memoryBytes = 0;
const pending = new Map<string, Promise<CachedRead<unknown>>>();
const localHits = new Map<string, number[]>();

function memGet(key: string): string | null {
  const e = memory.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    memory.delete(key);
    memoryBytes -= e.bytes;
    return null;
  }
  return e.value;
}

function memSet(key: string, value: string, ttlSeconds: number): void {
  const prev = memory.get(key);
  if (prev) {
    memory.delete(key);
    memoryBytes -= prev.bytes;
  }
  const bytes = Buffer.byteLength(value);
  if (bytes > MEMORY_MAX_BYTES) return;
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000, bytes });
  memoryBytes += bytes;
  while (memory.size > MEMORY_MAX_ENTRIES || memoryBytes > MEMORY_MAX_BYTES) {
    const first = memory.keys().next().value;
    if (first === undefined) break;
    memoryBytes -= memory.get(first)!.bytes;
    memory.delete(first);
  }
}

export interface CachedRead<T> {
  value: T;
  /** When the provider was actually called — the only source for a freshness label. */
  fetchedAt: string;
  cached: boolean;
}

const RL_TENANT = (family: LiveDataFamily) => `livedata:rl:tenant:${family}:`;
const RL_PROVIDER = 'livedata:rl:provider:';

function busy(code: string, message: string): HttpException {
  return new HttpException({ code, message }, HttpStatus.TOO_MANY_REQUESTS);
}

async function chargeMiss(
  redis: RedisService,
  family: LiveDataFamily,
  tenantId: string,
): Promise<void> {
  const publisher = redis.publisher as never;
  if (tenantId) {
    const used = await aiWindowCount(publisher, tenantId, RL_TENANT(family));
    if (used >= tenantHourlyCap()) {
      throw busy(
        'LIVE_DATA_TENANT_CAP',
        'This live data is refreshing too often for this account. It will be back shortly.',
      );
    }
  }
  if (redis.publisher) {
    const used = await aiWindowCount(publisher, family, RL_PROVIDER);
    if (used >= providerHourlyCeiling())
      throw busy(
        'LIVE_DATA_PROVIDER_CAP',
        'Live data is busy right now. Try again shortly.',
      );
    await aiRecordEvent(publisher, family, RL_PROVIDER);
  } else {
    const now = Date.now();
    const hits = (localHits.get(family) || []).filter(
      (t) => t > now - AI_HOURLY_WINDOW_MS,
    );
    if (hits.length >= providerHourlyCeiling())
      throw busy(
        'LIVE_DATA_PROVIDER_CAP',
        'Live data is busy right now. Try again shortly.',
      );
    hits.push(now);
    localHits.set(family, hits);
  }
  if (tenantId) await aiRecordEvent(publisher, tenantId, RL_TENANT(family));
}

/**
 * Read `key` (must never contain a secret) through the cache, calling
 * `load` at most once per TTL across the fleet.
 */
export async function cachedLiveRead<T>(
  redis: RedisService,
  family: LiveDataFamily,
  key: string,
  ttlSeconds: number,
  tenantId: string,
  load: () => Promise<T>,
  ttlFor?: (value: T) => number,
): Promise<CachedRead<T>> {
  const fullKey = `livedata:v1:${family}:${key}`;
  const raw = (await readRedis(redis, fullKey)) ?? memGet(fullKey);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { value: T; fetchedAt: string };
      if (
        parsed &&
        parsed.value !== undefined &&
        typeof parsed.fetchedAt === 'string'
      ) {
        return {
          value: parsed.value,
          fetchedAt: parsed.fetchedAt,
          cached: true,
        };
      }
    } catch {
      /* refetch a corrupt entry */
    }
  }
  const inflight = pending.get(fullKey);
  if (inflight) return inflight as Promise<CachedRead<T>>;
  if (pending.size >= 60)
    throw busy(
      'LIVE_DATA_BUSY',
      'Live data is busy right now. Try again shortly.',
    );
  const run = (async () => {
    await chargeMiss(redis, family, tenantId);
    const value = await load();
    const fetchedAt = new Date().toISOString();
    const blob = JSON.stringify({ value, fetchedAt });
    const ttl = Math.max(1, Math.floor(ttlFor ? ttlFor(value) : ttlSeconds));
    memSet(fullKey, blob, ttl);
    if (redis.publisher) {
      try {
        await redis.publisher.set(fullKey, blob, 'EX', ttl);
      } catch {
        /* memory copy already written */
      }
    }
    return { value, fetchedAt, cached: false };
  })().finally(() => pending.delete(fullKey));
  pending.set(fullKey, run);
  return run;
}

async function readRedis(
  redis: RedisService,
  key: string,
): Promise<string | null> {
  if (!redis.publisher) return null;
  try {
    return await redis.publisher.get(key);
  } catch {
    return null;
  }
}

/** Test seam. */
export function __clearLiveDataCache(): void {
  memory.clear();
  memoryBytes = 0;
  pending.clear();
  localHits.clear();
}
