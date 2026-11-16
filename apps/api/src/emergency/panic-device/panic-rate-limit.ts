import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../realtime/redis.service';
import { RedisThrottlerStorage } from '../../realtime/redis-throttler-storage';

/**
 * Panic phones (2026-11-14) — the rate limits, keyed on IDENTITIES, never on
 * the address the API sees.
 *
 * Every panic request reaches the API from the web origin's servers (the
 * phone talks to `/api/panic/*` on its own origin; that route handler calls
 * here). Keyed on the address the API observes, every school in the fleet
 * would share one bucket per Vercel egress address — one abuser could spend
 * it and silence every panic phone at once. So the global per-IP throttle is
 * skipped on these routes (`@SkipThrottle`) and replaced by:
 *
 *   • the phone's REAL address, as the web origin saw it, forwarded by the
 *     BFF and trusted only behind SESSION_BFF_SECRET (the controller checks
 *     the secret before it reads the header), and
 *   • the credential's own device row (or, for enrolment, the person).
 *
 * Same Redis store and fail-open semantics as the global throttler
 * (`RedisThrottlerStorage`: shared across replicas, in-memory if Redis is
 * gone, a 250 ms bound on the eval). FAIL OPEN, deliberately: a counter must
 * never be the thing that stops an emergency from being sent.
 */
@Injectable()
export class PanicRateLimiter {
  private readonly logger = new Logger('PanicRateLimiter');
  private readonly storage: RedisThrottlerStorage;

  constructor(redis: RedisService) {
    this.storage = new RedisThrottlerStorage(redis);
  }

  /** Count one hit on `key`; false when it is over `limit` in the current minute. */
  async allow(key: string, limit: number): Promise<boolean> {
    try {
      const rec = await this.storage.increment(key, 60_000, limit, 0, 'panic-device');
      return !rec.isBlocked;
    } catch (e: any) {
      this.logger.warn(`panic rate limit unavailable (allowing): ${e?.message ?? e}`);
      return true;
    }
  }
}
