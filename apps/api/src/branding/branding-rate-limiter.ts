/**
 * Per-tenant + global rate limiter for the branding scraper.
 * In-memory sliding window; v1 only. A distributed Redis-backed
 * limiter is a later upgrade if we spread the API across multiple
 * instances.
 */

import { Injectable, HttpException, HttpStatus } from '@nestjs/common';

const HOUR = 60 * 60 * 1000;
// 2026-05-25 — bumped from 5 → 30 per operator: "what if we setup 20
// schools in a district out of no where, will i be able to do that
// and brand them all?" 5/hr capped a district admin at 5 schools per
// onboarding session, then forced them to wait an hour. 30/hr allows
// a typical district (15-25 schools) to be branded in one sitting,
// with a few retries if a scrape needs a different sub-page. Most
// tenants scrape 1-3 times TOTAL during onboarding and never again,
// so the average pressure stays far below this ceiling.
const PER_TENANT = 30;
// Bumped from 50 → 1000. The global cap protects the API from a
// pathological burst (e.g. someone scripting our scraper to mine
// brand assets from a list of sites). At 1000/hr the API can still
// absorb 30+ tenants each fully onboarding simultaneously without
// throttling honest customers. The per-tenant 30/hr cap is the
// actual abuse boundary; global is defense-in-depth.
const GLOBAL = 1000;
// Demo endpoint is unauthenticated public — that's the actual abuse
// vector. Keep it modest so a scripted demo-page scraper can't burn
// the global pool. The @Throttle({ttl:60s,limit:5}) decorator on
// the controller already enforces 5/min per IP from NestJS's
// throttler, so this 50/hr ceiling is the second wall (covers
// distributed abuse across many IPs hitting the demo).
const DEMO_HOURLY = 50;
const DEMO_BUCKET = '__demo__';

@Injectable()
export class BrandingRateLimiter {
  private tenantHits = new Map<string, number[]>();
  private globalHits: number[] = [];

  check(tenantId: string): void {
    const now = Date.now();
    const windowStart = now - HOUR;
    const isDemo = tenantId === DEMO_BUCKET;
    const perBucketLimit = isDemo ? DEMO_HOURLY : PER_TENANT;

    // Trim global
    this.globalHits = this.globalHits.filter(t => t >= windowStart);
    if (this.globalHits.length >= GLOBAL) {
      throw new HttpException(
        { message: 'Global branding scrape rate limit exceeded. Try again in an hour.', code: 'BRANDING_RATE_LIMIT_GLOBAL' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Per-tenant (or per-demo-bucket)
    const hits = (this.tenantHits.get(tenantId) || []).filter(t => t >= windowStart);
    if (hits.length >= perBucketLimit) {
      const resetInMin = Math.ceil((hits[0] + HOUR - now) / 60000);
      throw new HttpException(
        {
          message: isDemo
            ? `Demo branding-scrape limit reached. Try again in ${resetInMin} minutes, or sign in to use the full feature.`
            : `Too many branding scrapes for this tenant. Try again in ${resetInMin} minutes.`,
          code: isDemo ? 'BRANDING_RATE_LIMIT_DEMO' : 'BRANDING_RATE_LIMIT_TENANT',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    hits.push(now);
    this.globalHits.push(now);
    this.tenantHits.set(tenantId, hits);
  }
}
