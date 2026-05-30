/**
 * Per-tenant + global rate limiter for the Custom-data (REST/JSON +
 * Google-Sheet-CSV) fetch proxy. In-memory sliding window — same shape
 * as BrandingRateLimiter (a distributed Redis-backed limiter is the
 * later upgrade if the API spreads across replicas; until then the
 * in-memory window is a real per-instance cap, which is the abuse
 * boundary we actually care about for an authed operator endpoint).
 *
 * This endpoint fetches an operator-supplied URL server-side, so it is
 * an SSRF surface AND an outbound-egress surface. The rate limit is the
 * second wall behind `safeFetch`: even if a tenant points a template at
 * a public feed and the builder polls it, we cap how often the server
 * will reach out on that tenant's behalf.
 */

import { Injectable, HttpException, HttpStatus } from '@nestjs/common';

const HOUR = 60 * 60 * 1000;
// A live template polls this endpoint on the builder-preview path; the
// player consumes the SAME hook but a deployed wall doesn't hammer it
// (the poll cadence is generous). 120/hr/tenant comfortably covers a
// few templates each refreshing a custom feed every minute or two while
// an operator iterates, and still walls off a tenant scripting the
// proxy to mine third-party feeds.
const PER_TENANT = 120;
// Global defense-in-depth: protects the API from a pathological burst
// across many tenants (or one tenant cycling tenants). The per-tenant
// cap above is the real abuse boundary; this is the blast-radius cap.
const GLOBAL = 4000;

@Injectable()
export class DataSourceRateLimiter {
  private tenantHits = new Map<string, number[]>();
  private globalHits: number[] = [];

  check(tenantId: string): void {
    const now = Date.now();
    const windowStart = now - HOUR;

    // Trim + check global first.
    this.globalHits = this.globalHits.filter((t) => t >= windowStart);
    if (this.globalHits.length >= GLOBAL) {
      throw new HttpException(
        {
          message: 'Global custom-data fetch rate limit exceeded. Try again in an hour.',
          code: 'DATA_SOURCE_RATE_LIMIT_GLOBAL',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const hits = (this.tenantHits.get(tenantId) || []).filter((t) => t >= windowStart);
    if (hits.length >= PER_TENANT) {
      const resetInMin = Math.ceil((hits[0] + HOUR - now) / 60000);
      throw new HttpException(
        {
          message: `Too many custom-data fetches for this tenant. Try again in ${resetInMin} minutes.`,
          code: 'DATA_SOURCE_RATE_LIMIT_TENANT',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    hits.push(now);
    this.globalHits.push(now);
    this.tenantHits.set(tenantId, hits);
  }
}
