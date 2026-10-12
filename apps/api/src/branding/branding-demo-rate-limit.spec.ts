/**
 * H-12 (launch security re-audit, 2026-10-11) — the anonymous branding demo
 * scrape has a per-address HOURLY ceiling on top of the 5/min throttle and the
 * shared demo pool, so one visitor cannot use it as a free fetcher (or drain
 * the shared pool for everyone else). The signed-in scrape is unaffected.
 */
import { HttpException } from '@nestjs/common';
import { BrandingRateLimiter } from './branding-rate-limiter';

describe('BrandingRateLimiter.checkDemoIp', () => {
  it('allows a handful per address per hour, then 429 BRANDING_RATE_LIMIT_DEMO', () => {
    const l = new BrandingRateLimiter();
    let allowed = 0;
    let refusal: HttpException | null = null;
    for (let i = 0; i < 20; i++) {
      try {
        l.checkDemoIp('198.51.100.7');
        allowed++;
      } catch (e) {
        refusal = e as HttpException;
        break;
      }
    }
    expect(allowed).toBe(8);
    expect(refusal?.getStatus()).toBe(429);
    expect((refusal?.getResponse() as any).code).toBe('BRANDING_RATE_LIMIT_DEMO');
  });

  it('is per address — another visitor is not blocked by the first', () => {
    const l = new BrandingRateLimiter();
    for (let i = 0; i < 8; i++) l.checkDemoIp('198.51.100.7');
    expect(() => l.checkDemoIp('198.51.100.7')).toThrow(HttpException);
    expect(() => l.checkDemoIp('203.0.113.9')).not.toThrow();
  });

  it('does not touch the signed-in tenant bucket', () => {
    const l = new BrandingRateLimiter();
    for (let i = 0; i < 8; i++) l.checkDemoIp('198.51.100.7');
    expect(() => l.check('tenant-1')).not.toThrow();
  });
});
