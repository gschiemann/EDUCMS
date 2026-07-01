/**
 * Multi-replica-safe rate limiter for token-authenticated feed-ingest
 * endpoints (launch-sprint task #272a, 2026-07-01).
 *
 * THE BUG THIS FIXES: `SportsBoardController`'s three ingest endpoints
 * (`:id/feed`, `:id/cts-snapshot`, `:id/swim-timing-snapshot`) rate-limited
 * with a plain in-memory `Map<string, number[]>` (`feedHits`). On Railway's
 * multi-replica deploy, each replica keeps its own Map, so the effective
 * cap is N× the configured max, and a replica restart silently resets any
 * hammering that had already accumulated. Flagged as residual hardening
 * (P3) in docs/research/2026-07-01-new-endpoint-security-audit/00-AUDIT.md.
 *
 * THE FIX: a shared Redis fixed-window counter, ONE round-trip per check
 * (atomic INCR+PEXPIRE via a Lua `EVAL`, same pattern as
 * `RedisThrottlerStorage` in `../realtime/redis-throttler-storage.ts`) —
 * cheaper than the AI-cap module's sorted-set sliding window (3 ops:
 * ZREMRANGEBYSCORE + ZCARD + ZADD) because these ingest endpoints run at up
 * to ~10 Hz per game and a fixed window is precise enough for an
 * anti-hammer guard (the existing in-memory implementation was ALSO a
 * (slightly more precise) sliding window, but the security property that
 * matters — "a leaked token / misbehaving bridge can't flood us" — doesn't
 * need sub-window precision, and one Redis op beats three at this call
 * rate). A fixed window can, in the worst case, allow up to ~2× `max`
 * across a window boundary; that is an acceptable trade for a 3x cheaper
 * check on a per-request-in-the-hot-path operation guarding a leaked-token
 * flood, not a precise quota.
 *
 * FALLBACK: when Redis is unavailable (`publisher` null or not `ready`, or
 * the EVAL throws), we fall back to the EXACT SAME in-memory sliding-window
 * Map logic the controller used before this change — so a single-replica
 * dev box or a Redis blip keeps enforcing the limit locally (fail-CLOSED
 * for the limit itself, never fail-open to "no rate limit at all"; this is
 * an abuse guard, not a paid-feature cap like ai-hourly-cap.ts, so there is
 * no "don't block a paying customer" concern — the opposite direction, a
 * flood, is the risk being defended against). The boot-without-redis rule
 * (CLAUDE.md "Redis missing → API boots anyway") is preserved: nothing here
 * throws or blocks boot when Redis is absent.
 */

/** Minimal structural type for the ioredis client we use. */
export interface IngestRateLimitRedisClient {
  status?: string;
  eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
}

export interface IngestLimitResult {
  /** True when the caller is OVER the limit and must be rejected (429). */
  limited: boolean;
  /** Hit count as of this check (informational only). */
  count: number;
}

/**
 * Atomic INCR + first-hit-PEXPIRE in one round-trip. Returns the post-
 * increment count. KEYS[1] = counter key, ARGV[1] = window (ms).
 */
const INCR_WINDOW_LUA = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local count = redis.call('INCR', key)
if count == 1 then
  redis.call('PEXPIRE', key, windowMs)
end
return count
`;

/**
 * In-memory fallback store — module-scoped so it is shared across every
 * caller of `checkIngestLimit` in this process, matching the semantics of
 * the per-controller `feedHits` Map it replaces. Sliding window (filters
 * timestamps older than `windowMs`), same as the original implementation.
 */
const memoryHits = new Map<string, number[]>();

function checkMemoryFallback(
  key: string,
  max: number,
  windowMs: number,
): IngestLimitResult {
  const now = Date.now();
  const recent = (memoryHits.get(key) || []).filter((t) => t > now - windowMs);
  if (recent.length >= max) {
    memoryHits.set(key, recent);
    return { limited: true, count: recent.length };
  }
  recent.push(now);
  memoryHits.set(key, recent);
  return { limited: false, count: recent.length };
}

/**
 * Check + record one hit against `key`'s sliding/fixed rate-limit window.
 * Redis-backed (shared across every replica) when available; falls back to
 * an in-memory sliding window scoped to this process otherwise.
 *
 * One Redis round-trip per call (atomic EVAL) — do not add a second op
 * (e.g. a separate TTL read) unless the caller genuinely needs it; these
 * endpoints run at up to ~10 Hz per game across potentially dozens of
 * concurrent games, so extra round-trips are real load.
 *
 * @param redis   the ioredis client (`RedisService.publisher`), or
 *                null/undefined when Redis isn't configured.
 * @param key     rate-limit bucket key, e.g. `cts:${gameId}`. Callers are
 *                responsible for namespacing (this module does not prefix).
 * @param max     max hits allowed within `windowMs`.
 * @param windowMs window length in milliseconds.
 */
export async function checkIngestLimit(
  redis: IngestRateLimitRedisClient | null | undefined,
  key: string,
  max: number,
  windowMs: number,
): Promise<IngestLimitResult> {
  if (!redis || redis.status !== 'ready') {
    return checkMemoryFallback(key, max, windowMs);
  }
  try {
    const count = (await redis.eval(
      INCR_WINDOW_LUA,
      1,
      `ingest-rl:${key}`,
      String(windowMs),
    )) as number;
    return { limited: Number(count) > max, count: Number(count) };
  } catch {
    // Redis errored mid-flight — fall back to the in-memory bucket rather
    // than letting a flood through uncounted.
    return checkMemoryFallback(key, max, windowMs);
  }
}

/**
 * Test-only helper: clears the module-scoped in-memory fallback store so
 * specs don't leak state between cases/files.
 */
export function _resetIngestRateLimitMemoryForTests(): void {
  memoryHits.clear();
}
