/**
 * Rate limiter for the feeds endpoints (GET /api/v1/feeds/rss, /ics).
 *
 * Mirrors the in-memory sliding-window shape used by
 * `BrandingRateLimiter` / `DataSourceRateLimiter`, adapted for a route that
 * — like `ProxyController`'s `/proxy/web` — has NO auth guard, because it's
 * called by both the authed dashboard (widget preview) AND unauthed player
 * kiosks (a live board polling its own feed). There is no JWT/tenantId to
 * key off here, so unlike Branding/DataSource this limiter keys by:
 *
 *   1. Per-UPSTREAM-HOST bucket — the real abuse/rudeness boundary for a
 *      feed proxy is "how often do we hit this one blog/church calendar",
 *      not which of our tenants asked. A single popular feed shared by many
 *      tenants (e.g. a district athletics RSS) should be fetched at the
 *      CACHE's cadence (feeds-cache.ts), not the request cadence — this
 *      limiter is the backstop for cache-miss storms / malicious repeated
 *      cache-busting, not the primary defense (that's the TTL cache).
 *   2. A global ceiling as defense-in-depth against a distributed burst.
 *
 * A per-IP `@Throttle` decorator on the controller (NestJS's global
 * Redis-backed ThrottlerModule — see app.module.ts) is the FIRST wall, same
 * layering as `/proxy/web` and every other rate-limited public endpoint in
 * this codebase. This limiter is the second wall.
 */

import { Injectable, HttpException, HttpStatus } from '@nestjs/common';

const HOUR = 60 * 60 * 1000;

// A feed is cached for 5-15 min (see feeds.service.ts), so any single host
// should almost never see more than a handful of ORIGIN fetches per hour
// even across many tenants/screens — cache hits never reach this limiter's
// caller (feeds.controller.ts only calls .check() on a cache MISS). 60/hr
// per host gives generous headroom for cache churn/thundering-herd on a
// freshly-added feed while still capping runaway/abusive polling.
const PER_HOST = 60;
// Global ceiling across all hosts — defense-in-depth against a burst of
// many distinct hosts being hammered at once (e.g. a scripted abuse probe
// cycling through URLs to dodge the per-host bucket).
const GLOBAL = 3000;

@Injectable()
export class FeedsRateLimiter {
  private hostHits = new Map<string, number[]>();
  private globalHits: number[] = [];

  /** @param hostKey normalized upstream hostname (e.g. "example.com") */
  check(hostKey: string): void {
    const now = Date.now();
    const windowStart = now - HOUR;

    this.globalHits = this.globalHits.filter((t) => t >= windowStart);
    if (this.globalHits.length >= GLOBAL) {
      throw new HttpException(
        { message: 'Feeds service is busy right now. Try again shortly.', code: 'FEEDS_RATE_LIMIT_GLOBAL' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const hits = (this.hostHits.get(hostKey) || []).filter((t) => t >= windowStart);
    if (hits.length >= PER_HOST) {
      const resetInMin = Math.ceil((hits[0] + HOUR - now) / 60000);
      throw new HttpException(
        {
          message: `This feed is being refreshed too often. Try again in ${resetInMin} minutes.`,
          code: 'FEEDS_RATE_LIMIT_HOST',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    hits.push(now);
    this.globalHits.push(now);
    this.hostHits.set(hostKey, hits);
  }
}
