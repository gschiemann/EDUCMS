import { HttpException } from '@nestjs/common';
import { FeedsRateLimiter } from './feeds-rate-limiter';

describe('FeedsRateLimiter', () => {
  it('allows requests under the per-host ceiling', () => {
    const limiter = new FeedsRateLimiter();
    for (let i = 0; i < 10; i++) {
      expect(() => limiter.check('example.com')).not.toThrow();
    }
  });

  it('throws a 429 HttpException once a host exceeds its hourly ceiling', () => {
    const limiter = new FeedsRateLimiter();
    for (let i = 0; i < 60; i++) limiter.check('busy-host.com');
    let thrown: any;
    try {
      limiter.check('busy-host.com');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect(thrown.getStatus()).toBe(429);
    expect(thrown.getResponse()).toMatchObject({ code: 'FEEDS_RATE_LIMIT_HOST' });
  });

  it('keeps per-host buckets independent — a busy host does not block a quiet one', () => {
    const limiter = new FeedsRateLimiter();
    for (let i = 0; i < 60; i++) limiter.check('busy-host.com');
    expect(() => limiter.check('quiet-host.com')).not.toThrow();
  });

  it('throws the global ceiling once enough DISTINCT hosts are hit', () => {
    const limiter = new FeedsRateLimiter();
    for (let h = 0; h < 3000; h++) {
      limiter.check(`host-${h}.example.com`);
    }
    expect(() => limiter.check('one-more-host.example.com')).toThrow(HttpException);
  });
});
