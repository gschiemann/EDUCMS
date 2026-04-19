/**
 * Per-tenant + global rate limiter for the branding scraper.
 * In-memory sliding window; v1 only. A distributed Redis-backed
 * limiter is a later upgrade if we spread the API across multiple
 * instances.
 */

import { Injectable, HttpException, HttpStatus } from '@nestjs/common';

const HOUR = 60 * 60 * 1000;
const PER_TENANT = 5;
const GLOBAL = 50;

@Injectable()
export class BrandingRateLimiter {
  private tenantHits = new Map<string, number[]>();
  private globalHits: number[] = [];

  check(tenantId: string): void {
    const now = Date.now();
    const windowStart = now - HOUR;

    // Trim global
    this.globalHits = this.globalHits.filter(t => t >= windowStart);
    if (this.globalHits.length >= GLOBAL) {
      throw new HttpException(
        { message: 'Global branding scrape rate limit exceeded. Try again in an hour.', code: 'BRANDING_RATE_LIMIT_GLOBAL' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Per-tenant
    const hits = (this.tenantHits.get(tenantId) || []).filter(t => t >= windowStart);
    if (hits.length >= PER_TENANT) {
      const resetInMin = Math.ceil((hits[0] + HOUR - now) / 60000);
      throw new HttpException(
        { message: `Too many branding scrapes for this tenant. Try again in ${resetInMin} minutes.`, code: 'BRANDING_RATE_LIMIT_TENANT' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    hits.push(now);
    this.globalHits.push(now);
    this.tenantHits.set(tenantId, hits);
  }
}
