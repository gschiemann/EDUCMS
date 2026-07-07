import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { RedisService } from './redis.service';

/**
 * The record shape `ThrottlerStorage.increment` must return. The library
 * does NOT re-export `ThrottlerStorageRecord` from its package root in
 * v6.5.0, so we derive the exact type from the interface's method signature
 * rather than importing a name that isn't there.
 */
type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

/**
 * Redis-backed ThrottlerStorage (security P1, 2026-06-26).
 *
 * THE BUG THIS FIXES: `@nestjs/throttler`'s default `ThrottlerStorageService`
 * is IN-MEMORY, so every per-endpoint `@Throttle` limit (login 10/min,
 * register 5/min, password-reset 3/hr, invite 20/min, …) is counted PER
 * REPLICA. VenueOS runs multiple Railway replicas, so each replica keeps its
 * own bucket and no single bucket ever reaches the limit — the brute-force
 * caps NEVER fire 429. (Proof: 8 rapid bad logins → all 401, zero 429,
 * `x-ratelimit-remaining` never decremented past 8.)
 *
 * THE FIX: back the throttler with a SHARED Redis counter so all replicas
 * INCR the same key. We reuse the EXISTING ioredis client
 * (`RedisService.publisher`) — no new npm dependency (CI runs
 * `--frozen-lockfile`).
 *
 * Signature matches `@nestjs/throttler` v6.5.0 exactly:
 *   increment(key, ttl, limit, blockDuration, throttlerName)
 *     => Promise<{ totalHits, timeToExpire, isBlocked, timeToBlockExpire }>
 * (`ttl` / `blockDuration` are in MILLISECONDS in v5/v6.)
 *
 * FAIL-OPEN: if Redis is unavailable, we DELEGATE to an in-memory
 * `ThrottlerStorageService` fallback instead of throwing. A Redis blip must
 * NEVER lock out logins — and the API is required to boot/serve with Redis
 * down (CLAUDE.md "Redis missing → API boots anyway"). This mirrors how the
 * rest of the app treats Redis as optional (see `ai-hourly-cap.ts`,
 * `RedisService.sismember`). At our committed `numReplicas:1` the in-memory
 * fallback is still effectively global; with Redis present every replica
 * shares one bucket.
 *
 * Concurrency: the hit count + the TTL-on-first-hit are applied as ONE
 * atomic Lua script via `EVAL`, so concurrent requests across replicas can't
 * race the INCR/EXPIRE pair (the classic "INCR returns 1 on two callers
 * because EXPIRE hadn't run yet" hole).
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  /**
   * In-memory fallback used whenever Redis is unavailable. Owning an
   * instance (rather than re-deriving a record by hand) keeps the
   * fail-open path's semantics identical to the library's own storage.
   */
  private readonly memoryFallback = new ThrottlerStorageService();

  /**
   * One-shot fail-open warning latch (2026-07-06). The fail-open path used to
   * log at .debug() (dropped by Railway), so a silent, permanent fail-open to
   * per-replica memory — which defeats the shared brute-force cap across
   * replicas — was invisible in prod. Warn ONCE (not per-request) the first
   * time we fall open, naming the branch + reason, so the condition is
   * diagnosable without spamming the log.
   */
  private warnedFailOpen = false;

  /**
   * Max time to wait for the Redis EVAL before failing open to memory. A
   * healthy pooled EVAL is sub-5ms; 250ms is generous headroom while still
   * bounding a login's added latency if Redis is unreachable.
   */
  private static readonly EVAL_TIMEOUT_MS = 250;

  /**
   * Atomic INCR + first-hit-PEXPIRE + block bookkeeping in one round-trip.
   *
   * KEYS[1] = hit-count key, KEYS[2] = block-marker key
   * ARGV[1] = ttl (ms), ARGV[2] = limit, ARGV[3] = blockDuration (ms)
   *
   * Returns: { totalHits, timeToExpire(ms), isBlocked(0|1), timeToBlockExpire(ms) }
   *
   * Mirrors the library's in-memory algorithm:
   *  - while blocked, hits are NOT incremented (the count is frozen)
   *  - the (limit+1)th hit trips the block for `blockDuration`
   *  - when the block window lapses, the counter resets and this hit counts
   */
  private static readonly INCREMENT_LUA = `
local hitKey   = KEYS[1]
local blockKey = KEYS[2]
local ttl      = tonumber(ARGV[1])
local limit    = tonumber(ARGV[2])
local blockDur = tonumber(ARGV[3])

local blockPttl = redis.call('PTTL', blockKey)
local isBlocked = blockPttl > 0

if isBlocked then
  -- Frozen while blocked: report the current count without incrementing.
  local hits = tonumber(redis.call('GET', hitKey)) or limit + 1
  local hitPttl = redis.call('PTTL', hitKey)
  if hitPttl < 0 then hitPttl = ttl end
  return { hits, hitPttl, 1, blockPttl }
end

-- Not blocked: count this hit and set the window TTL on first hit.
local hits = redis.call('INCR', hitKey)
if hits == 1 then
  redis.call('PEXPIRE', hitKey, ttl)
end
local hitPttl = redis.call('PTTL', hitKey)
if hitPttl < 0 then
  -- No TTL somehow (e.g. key set without expiry): re-arm it.
  redis.call('PEXPIRE', hitKey, ttl)
  hitPttl = ttl
end

if hits > limit then
  -- Trip the block: freeze further hits for blockDuration. Guard blockDur>0:
  -- Redis SET ... PX 0 (or negative) is an "invalid expire time" ERROR that
  -- would throw out of EVAL and force the whole throttler to fail-open to
  -- per-replica memory — silently defeating the shared cap. When no
  -- blockDuration is configured we simply don't set a separate block key; the
  -- count still exceeds the limit within the window so this branch keeps
  -- returning isBlocked=1 on every subsequent hit until the window lapses.
  if blockDur > 0 then
    redis.call('SET', blockKey, '1', 'PX', blockDur)
  end
  return { hits, hitPttl, 1, blockDur }
end

return { hits, hitPttl, 0, 0 }
`;

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const client = this.redis.publisher;

    // FAIL-OPEN only when there is genuinely NO client. We deliberately do NOT
    // gate on `client.status === 'ready'` (2026-07-06 fix): on multi-replica
    // prod that strict check was forcing a PERMANENT fail-open to per-replica
    // memory — the cap never fired 429 (16 rapid bad logins, zero 429, live).
    // ioredis reports transient statuses ('connecting'/'reconnecting') even when
    // the connection is usable and its offline queue would run the command the
    // instant it's ready. Instead we ATTEMPT the eval under a short timeout
    // (below); if Redis is truly down the timeout+catch fail us open FAST, so a
    // login is never blocked or hung.
    if (!client) {
      if (!this.warnedFailOpen) {
        this.warnedFailOpen = true;
        this.logger.warn(
          'Redis throttler fail-open: no publisher client — rate-limit caps are PER-REPLICA (not shared).',
        );
      }
      return this.memoryFallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }

    // Namespace per throttler so two @Throttle definitions sharing a tracker
    // (same IP) don't collide. `throttle:{name}:{ip-derived key}`.
    const hitKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle:block:${throttlerName}:${key}`;

    try {
      // Bounded eval: a healthy Redis EVAL is sub-5ms. Racing it against a
      // short timeout means that if the connection is mid-reconnect or Redis is
      // genuinely down, we fail OPEN fast (via catch) instead of hanging the
      // login on ioredis's offline queue. This is what makes it safe to have
      // dropped the strict `status === 'ready'` pre-gate above.
      const res = (await Promise.race([
        client.eval(
          RedisThrottlerStorage.INCREMENT_LUA,
          2,
          hitKey,
          blockKey,
          String(ttl),
          String(limit),
          String(blockDuration),
        ),
        new Promise((_resolve, reject) =>
          setTimeout(
            () => reject(new Error('throttler eval timeout')),
            RedisThrottlerStorage.EVAL_TIMEOUT_MS,
          ),
        ),
      ])) as [number, number, number, number];

      const [totalHits, timeToExpireMs, isBlocked, timeToBlockExpireMs] = res;

      return {
        totalHits: Number(totalHits),
        // The library expects SECONDS for timeToExpire / timeToBlockExpire
        // (its in-memory storage returns ceil(ms/1000)). Match that so the
        // guard's `x-ratelimit-reset` / `retry-after` headers are correct.
        timeToExpire: Math.ceil(Number(timeToExpireMs) / 1000),
        isBlocked: Number(isBlocked) === 1,
        timeToBlockExpire: Math.ceil(Number(timeToBlockExpireMs) / 1000),
      };
    } catch (err) {
      // Redis errored mid-flight — fail OPEN to the in-memory bucket rather
      // than 500/lock-out. Warn ONCE (not per-request) so a real, persistent
      // EVAL failure (which silently defeats the shared cap) is visible in
      // Railway logs, while a one-off flap doesn't spam.
      if (!this.warnedFailOpen) {
        this.warnedFailOpen = true;
        this.logger.warn(
          `Redis throttler fail-open (EVAL error): ${
            (err as Error)?.message ?? err
          } — rate-limit caps counted PER-REPLICA until this clears.`,
        );
      }
      return this.memoryFallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }
}
