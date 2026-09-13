/**
 * GoogleReviewsController — the wire contract.
 *
 * Three things are load-bearing here and each one is a bug we have shipped
 * before in some other shape:
 *   1. NO KEY IS NOT AN OUTAGE. An unconfigured deploy answers 200
 *      `{ enabled: false }`; a 500 there would make "the admin hasn't added a
 *      key" look identical to "Google is down" on a wall.
 *   2. THE GUARD IS ON. Every route spends money on our metered Google key,
 *      so an unauthenticated caller must not reach any of them. Asserted off
 *      the controller's own guard metadata, because a unit test that calls the
 *      method directly bypasses guards entirely and would happily pass on an
 *      un-guarded controller.
 *   3. GOOGLE'S BODY NEVER COMES BACK. A provider error is a 502 with a plain
 *      sentence; the upstream body can quote the request, key included.
 */

import { ForbiddenException, HttpException, HttpStatus, UseGuards } from '@nestjs/common';

import { GoogleReviewsController } from './google-reviews.controller';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { GoogleReviewsProviderError, type GoogleReviewsService } from './google-reviews.service';
import { __clearReviewsMemoryCache, setCachedReviews } from './google-reviews-cache';
import type { RedisService } from '../../realtime/redis.service';

const PLACE_ID = 'ChIJj61dQgK6j4AR4GeTYWZsKWw';

const PAYLOAD = {
  place: { name: 'Riot Color Jacksonville', rating: 4.7, count: 218, mapsUri: 'https://maps.google.com/?cid=1' },
  reviews: [
    {
      author: 'Dana R.',
      authorUri: 'https://www.google.com/maps/contrib/1',
      photoUri: 'https://lh3.googleusercontent.com/a/dana',
      rating: 5,
      text: 'Fast turnaround and the colour match was perfect.',
      publishedAt: '2026-08-02T17:04:11Z',
      relative: 'a month ago',
      reviewUri: 'https://maps.google.com/review/1',
    },
  ],
  fetchedAt: '2026-09-12T06:00:00.000Z',
};

interface ServiceMock {
  enabled: jest.Mock;
  searchPlaces: jest.Mock;
  getReviews: jest.Mock;
}

function makeService(overrides: Partial<ServiceMock> = {}): { service: GoogleReviewsService; mock: ServiceMock } {
  const mock: ServiceMock = {
    enabled: jest.fn().mockReturnValue(true),
    searchPlaces: jest.fn().mockResolvedValue([]),
    getReviews: jest.fn().mockResolvedValue({ payload: PAYLOAD, cached: false }),
    ...overrides,
  };
  return { service: mock as unknown as GoogleReviewsService, mock };
}

function noRedis(): RedisService {
  return { publisher: null } as unknown as RedisService;
}

const sessionReq = { user: { id: 'u1', tenantId: 't1', role: 'SCHOOL_ADMIN' } };
const deviceReq = { user: { kind: 'device', sub: 'screen-1', tenantId: 't1' } };

describe('GoogleReviewsController', () => {
  beforeEach(() => {
    __clearReviewsMemoryCache();
    delete process.env.GOOGLE_REVIEWS_FETCH_HOURLY_CAP;
  });

  // ── AUTH ──────────────────────────────────────────────────────────────
  describe('auth', () => {
    it('is guarded by JwtAuthGuard, so an unauthenticated caller never reaches a route', () => {
      // `@UseGuards(JwtAuthGuard)` on the class stores the guard here. Reading
      // the metadata is the only way a unit test can see it: calling the
      // handler directly bypasses the Nest pipeline, so a controller with the
      // decorator deleted would pass every other test in this file.
      const guards = Reflect.getMetadata('__guards__', GoogleReviewsController) as unknown[] | undefined;
      expect(guards).toBeDefined();
      expect(guards).toContain(JwtAuthGuard);
      // Sanity: the metadata key really is what @UseGuards writes.
      class Probe {}
      UseGuards(JwtAuthGuard)(Probe);
      expect(Reflect.getMetadata('__guards__', Probe)).toContain(JwtAuthGuard);
    });

    it('refuses place search from a paired screen — a wall has no business spending on Text Search', async () => {
      const { service, mock } = makeService();
      const c = new GoogleReviewsController(service, noRedis());
      await expect(c.searchPlaces(deviceReq, { query: 'riot color' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(mock.searchPlaces).not.toHaveBeenCalled();
    });

    it('refuses place search from a machine API key too', async () => {
      const { service, mock } = makeService();
      const c = new GoogleReviewsController(service, noRedis());
      await expect(
        c.searchPlaces({ user: { kind: 'api-key', tenantId: 't1' } }, { query: 'riot color' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mock.searchPlaces).not.toHaveBeenCalled();
    });

    it('serves reviews to a paired screen — the widget renders on the wall, not just the builder', async () => {
      const { service } = makeService();
      const c = new GoogleReviewsController(service, noRedis());
      const res = await c.getReviews(deviceReq, PLACE_ID);
      expect(res.enabled).toBe(true);
      expect(res.reviews).toHaveLength(1);
    });
  });

  // ── NO KEY ────────────────────────────────────────────────────────────
  describe('with no GOOGLE_MAPS_API_KEY', () => {
    it('status says enabled:false instead of throwing', () => {
      const { service } = makeService({ enabled: jest.fn().mockReturnValue(false) });
      expect(new GoogleReviewsController(service, noRedis()).status()).toEqual({ enabled: false });
    });

    it('reviews answers 200 with an empty, honest payload', async () => {
      const { service, mock } = makeService({ enabled: jest.fn().mockReturnValue(false) });
      const res = await new GoogleReviewsController(service, noRedis()).getReviews(sessionReq, PLACE_ID);
      expect(res).toEqual({ enabled: false, place: null, reviews: [], fetchedAt: null, cached: false });
      expect(mock.getReviews).not.toHaveBeenCalled();
    });

    it('place search answers 200 with no candidates', async () => {
      const { service, mock } = makeService({ enabled: jest.fn().mockReturnValue(false) });
      const res = await new GoogleReviewsController(service, noRedis()).searchPlaces(sessionReq, { query: 'riot' });
      expect(res).toEqual({ enabled: false, candidates: [] });
      expect(mock.searchPlaces).not.toHaveBeenCalled();
    });
  });

  // ── PAYLOAD ───────────────────────────────────────────────────────────
  describe('reviews payload', () => {
    it('returns fetchedAt from the service payload — never a stamp made on the way out', async () => {
      const { service } = makeService({
        getReviews: jest.fn().mockResolvedValue({ payload: PAYLOAD, cached: true }),
      });
      const res = await new GoogleReviewsController(service, noRedis()).getReviews(sessionReq, PLACE_ID);
      expect(res.fetchedAt).toBe('2026-09-12T06:00:00.000Z');
      expect(res.cached).toBe(true);
    });

    it('400s with "Pick your business first" when no placeId is supplied', async () => {
      const { service } = makeService();
      const c = new GoogleReviewsController(service, noRedis());
      await expect(c.getReviews(sessionReq, '  ')).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });
  });

  // ── PROVIDER ERRORS ───────────────────────────────────────────────────
  describe('provider errors', () => {
    it('maps a provider failure to 502 with the plain reason and nothing from Google', async () => {
      const { service } = makeService({
        getReviews: jest
          .fn()
          .mockRejectedValue(new GoogleReviewsProviderError('Google Places is not answering right now.', 'PROVIDER_UNAVAILABLE')),
      });
      const c = new GoogleReviewsController(service, noRedis());
      await c.getReviews(sessionReq, PLACE_ID).then(
        () => {
          throw new Error('expected a rejection');
        },
        (err: HttpException) => {
          expect(err.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
          expect(err.getResponse()).toEqual({
            code: 'GOOGLE_REVIEWS_PROVIDER_UNAVAILABLE',
            message: 'Google Places is not answering right now.',
          });
        },
      );
    });

    it('maps an unexpected throw to a 502 that says nothing about the throw', async () => {
      const { service } = makeService({
        getReviews: jest.fn().mockRejectedValue(new Error('TypeError: cannot read properties of undefined')),
      });
      const c = new GoogleReviewsController(service, noRedis());
      await c.getReviews(sessionReq, PLACE_ID).then(
        () => {
          throw new Error('expected a rejection');
        },
        (err: HttpException) => {
          expect(err.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
          expect(JSON.stringify(err.getResponse())).not.toContain('TypeError');
        },
      );
    });
  });

  // ── PER-TENANT CAP ────────────────────────────────────────────────────
  describe('per-tenant hourly cap', () => {
    /** A minimal in-memory stand-in for the ioredis sorted-set calls the
     *  shared AI window helper makes. */
    function fakeRedis(seedCount: number): { redis: RedisService; sets: Map<string, Set<string>> } {
      const sets = new Map<string, Set<string>>();
      const publisher = {
        store: new Map<string, string>(),
        async get(k: string) {
          return this.store.get(k) ?? null;
        },
        async set(k: string, v: string) {
          this.store.set(k, v);
          return 'OK';
        },
        async zremrangebyscore() {
          return 0;
        },
        async zcard(key: string) {
          return sets.get(key)?.size ?? 0;
        },
        async zadd(key: string, _score: number, member: string) {
          const s = sets.get(key) ?? new Set<string>();
          s.add(member);
          sets.set(key, s);
          return 1;
        },
        async pexpire() {
          return 1;
        },
      };
      const seeded = new Set<string>();
      for (let i = 0; i < seedCount; i++) seeded.add(`seed-${i}`);
      sets.set('greviews:rl:fetch:t1', seeded);
      return { redis: { publisher } as unknown as RedisService, sets };
    }

    it('429s a cache MISS once the tenant is over its hourly upstream budget', async () => {
      process.env.GOOGLE_REVIEWS_FETCH_HOURLY_CAP = '2';
      const { redis } = fakeRedis(2);
      const { service, mock } = makeService();
      const c = new GoogleReviewsController(service, redis);
      await expect(c.getReviews(sessionReq, PLACE_ID)).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
      expect(mock.getReviews).not.toHaveBeenCalled();
    });

    it('does NOT charge the cap when the answer is already cached — a fleet polling a warm cache spends nothing', async () => {
      process.env.GOOGLE_REVIEWS_FETCH_HOURLY_CAP = '2';
      const { redis, sets } = fakeRedis(2);
      // Warm the cache for this place so the request costs Google nothing.
      await setCachedReviews((redis as unknown as { publisher: any }).publisher, PLACE_ID, JSON.stringify(PAYLOAD));
      const { service } = makeService({
        getReviews: jest.fn().mockResolvedValue({ payload: PAYLOAD, cached: true }),
      });
      const c = new GoogleReviewsController(service, redis);
      const res = await c.getReviews(sessionReq, PLACE_ID);
      expect(res.enabled).toBe(true);
      // Over the cap, and still served — and no new spend recorded.
      expect(sets.get('greviews:rl:fetch:t1')?.size).toBe(2);
    });

    it('records one upstream event per real fetch', async () => {
      const { redis, sets } = fakeRedis(0);
      const { service } = makeService();
      const c = new GoogleReviewsController(service, redis);
      await c.getReviews(sessionReq, PLACE_ID);
      expect(sets.get('greviews:rl:fetch:t1')?.size).toBe(1);
    });
  });
});
