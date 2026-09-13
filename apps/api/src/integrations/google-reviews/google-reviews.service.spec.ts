/**
 * GoogleReviewsService — the contract that costs money if it drifts.
 *
 * The field mask is asserted CHARACTER FOR CHARACTER, in both directions:
 * a mask missing `reviews` returns a payload with no reviews (the widget's
 * whole reason to exist), and a mask carrying an extra field silently moves
 * the request into a more expensive SKU. Neither is visible in a screenshot,
 * a type, or a green build — only in a bill. So it is pinned here.
 */

import {
  GoogleReviewsService,
  GoogleReviewsProviderError,
  DETAILS_FIELD_MASK,
  SEARCH_FIELD_MASK,
  PLACES_HOST,
  isValidPlaceId,
} from './google-reviews.service';
import { __clearReviewsMemoryCache } from './google-reviews-cache';
import type { RedisService } from '../../realtime/redis.service';

const KEY = 'test-google-key-DO-NOT-LOG';
const PLACE_ID = 'ChIJ_fixture_place_id_0000000000';

/** A RedisService stand-in with NO publisher — the cache falls through to its
 *  per-replica in-memory LRU, which is the path a Redis-less dev/CI box takes
 *  anyway. */
function noRedis(): RedisService {
  return { publisher: null } as unknown as RedisService;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function detailsBody(overrides: Record<string, unknown> = {}) {
  return {
    id: PLACE_ID,
    displayName: { text: 'Springfield Elementary' },
    rating: 4.7,
    userRatingCount: 218,
    googleMapsUri: 'https://maps.google.com/?cid=1',
    reviews: [
      {
        rating: 5,
        text: { text: 'Fast turnaround and the colour match was perfect.' },
        originalText: { text: 'Fast turnaround and the colour match was perfect.' },
        authorAttribution: {
          displayName: 'Dana R.',
          uri: 'https://www.google.com/maps/contrib/1',
          photoUri: 'https://lh3.googleusercontent.com/a/dana',
        },
        publishTime: '2026-08-02T17:04:11Z',
        relativePublishTimeDescription: 'a month ago',
        googleMapsUri: 'https://maps.google.com/review/1',
      },
      {
        rating: 3,
        text: { text: 'Good work but the parking is a nightmare.' },
        authorAttribution: {
          displayName: 'Miguel S.',
          uri: 'https://www.google.com/maps/contrib/2',
          photoUri: 'https://lh3.googleusercontent.com/a/miguel',
        },
        publishTime: '2026-07-19T09:00:00Z',
        relativePublishTimeDescription: '2 months ago',
        googleMapsUri: 'https://maps.google.com/review/2',
      },
    ],
    ...overrides,
  };
}

describe('GoogleReviewsService', () => {
  let fetchMock: jest.Mock;
  const realFetch = global.fetch;

  beforeEach(() => {
    __clearReviewsMemoryCache();
    process.env.GOOGLE_MAPS_API_KEY = KEY;
    fetchMock = jest.fn();
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    (global as unknown as { fetch: unknown }).fetch = realFetch;
    delete process.env.GOOGLE_MAPS_API_KEY;
    jest.restoreAllMocks();
  });

  // ── FIELD MASK ────────────────────────────────────────────────────────
  describe('field mask (the billing control)', () => {
    it('requests EXACTLY id,displayName,rating,userRatingCount,googleMapsUri,reviews — no more, no less', async () => {
      fetchMock.mockResolvedValue(jsonResponse(detailsBody()));
      await new GoogleReviewsService(noRedis()).getReviews(PLACE_ID);

      const [, init] = fetchMock.mock.calls[0];
      const mask = String(init.headers['X-Goog-FieldMask']);
      const requested = mask.split(',').map((s) => s.trim());

      // `reviews` MUST be present: without it the widget has nothing to draw.
      expect(requested).toContain('reviews');
      // and the whole set must be exactly this — an extra field is a silent
      // move into a more expensive Places SKU.
      expect(requested.sort()).toEqual(
        ['displayName', 'googleMapsUri', 'id', 'rating', 'reviews', 'userRatingCount'].sort(),
      );
      expect(mask).toBe(DETAILS_FIELD_MASK);
    });

    it('asks Text Search for exactly places.id,places.displayName,places.formattedAddress', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ places: [] }));
      await new GoogleReviewsService(noRedis()).searchPlaces('riot color jacksonville');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${PLACES_HOST}/v1/places:searchText`);
      expect(init.headers['X-Goog-FieldMask']).toBe(SEARCH_FIELD_MASK);
      expect(String(init.headers['X-Goog-FieldMask']).split(',').sort()).toEqual(
        ['places.displayName', 'places.formattedAddress', 'places.id'].sort(),
      );
    });
  });

  // ── THE KEY ───────────────────────────────────────────────────────────
  describe('the API key', () => {
    it('travels in the X-Goog-Api-Key header and NEVER in the URL', async () => {
      fetchMock.mockResolvedValue(jsonResponse(detailsBody()));
      await new GoogleReviewsService(noRedis()).getReviews(PLACE_ID);

      const [url, init] = fetchMock.mock.calls[0];
      expect(init.headers['X-Goog-Api-Key']).toBe(KEY);
      expect(String(url)).toBe(`${PLACES_HOST}/v1/places/${PLACE_ID}`);
      expect(String(url)).not.toContain(KEY);
      expect(String(url)).not.toContain('key=');
    });

    it('never writes the key to a log line, even when Google rejects the request', async () => {
      const warn = jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation(() => undefined);
      fetchMock.mockResolvedValue(jsonResponse({ error: { message: `bad key ${KEY}` } }, 403));

      await expect(new GoogleReviewsService(noRedis()).getReviews(PLACE_ID)).rejects.toBeInstanceOf(
        GoogleReviewsProviderError,
      );

      const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).not.toContain(KEY);
      expect(logged).toContain('403');
    });

    it('reports enabled=false and refuses to call out when the key is unset', async () => {
      delete process.env.GOOGLE_MAPS_API_KEY;
      const svc = new GoogleReviewsService(noRedis());
      expect(svc.enabled()).toBe(false);
      await expect(svc.getReviews(PLACE_ID)).rejects.toBeInstanceOf(GoogleReviewsProviderError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ── MAPPING ───────────────────────────────────────────────────────────
  describe('mapping Places JSON', () => {
    it('carries every attribution part the policy requires, plus the review’s own Maps link', async () => {
      fetchMock.mockResolvedValue(jsonResponse(detailsBody()));
      const { payload } = await new GoogleReviewsService(noRedis()).getReviews(PLACE_ID);

      expect(payload.place).toEqual({
        name: 'Springfield Elementary',
        rating: 4.7,
        count: 218,
        mapsUri: 'https://maps.google.com/?cid=1',
      });
      expect(payload.reviews).toHaveLength(2);
      expect(payload.reviews[0]).toEqual({
        author: 'Dana R.',
        authorUri: 'https://www.google.com/maps/contrib/1',
        photoUri: 'https://lh3.googleusercontent.com/a/dana',
        rating: 5,
        text: 'Fast turnaround and the colour match was perfect.',
        publishedAt: '2026-08-02T17:04:11Z',
        relative: 'a month ago',
        reviewUri: 'https://maps.google.com/review/1',
      });
    });

    it('passes Google’s own relative wording through — it never computes an age', async () => {
      fetchMock.mockResolvedValue(jsonResponse(detailsBody()));
      const { payload } = await new GoogleReviewsService(noRedis()).getReviews(PLACE_ID);
      expect(payload.reviews.map((r) => r.relative)).toEqual(['a month ago', '2 months ago']);
    });

    it('drops a review it cannot attribute rather than showing it anonymously', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          detailsBody({
            reviews: [
              { rating: 5, text: { text: 'No name on this one.' }, authorAttribution: {} },
              {
                rating: 4,
                text: { text: 'This one is attributed.' },
                authorAttribution: { displayName: 'Pat K.' },
              },
            ],
          }),
        ),
      );
      const { payload } = await new GoogleReviewsService(noRedis()).getReviews(PLACE_ID);
      expect(payload.reviews.map((r) => r.author)).toEqual(['Pat K.']);
    });

    it('never returns more than the five Google promises', async () => {
      const many = Array.from({ length: 9 }, (_, i) => ({
        rating: 5,
        text: { text: `Review number ${i}` },
        authorAttribution: { displayName: `Person ${i}` },
      }));
      fetchMock.mockResolvedValue(jsonResponse(detailsBody({ reviews: many })));
      const { payload } = await new GoogleReviewsService(noRedis()).getReviews(PLACE_ID);
      expect(payload.reviews).toHaveLength(5);
    });

    it('maps search candidates and caps them at five', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          places: Array.from({ length: 7 }, (_, i) => ({
            id: `ChIJcandidate${i}`,
            displayName: { text: `Riot Color ${i}` },
            formattedAddress: `${i} Main St, Jacksonville, FL`,
          })),
        }),
      );
      const candidates = await new GoogleReviewsService(noRedis()).searchPlaces('riot color');
      expect(candidates).toHaveLength(5);
      expect(candidates[0]).toEqual({
        placeId: 'ChIJcandidate0',
        name: 'Riot Color 0',
        address: '0 Main St, Jacksonville, FL',
      });
    });

    it('returns an empty candidate list (not an error) for a query too short to search', async () => {
      const candidates = await new GoogleReviewsService(noRedis()).searchPlaces('ri');
      expect(candidates).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ── CACHE ─────────────────────────────────────────────────────────────
  describe('cache', () => {
    it('serves the second read from cache — one upstream call, and fetchedAt stays the REAL fetch time', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-12T10:00:00Z').getTime());
      fetchMock.mockResolvedValue(jsonResponse(detailsBody()));
      const svc = new GoogleReviewsService(noRedis());

      const first = await svc.getReviews(PLACE_ID);
      expect(first.cached).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Five hours later — still inside the 6h TTL.
      jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-12T15:00:00Z').getTime());
      const second = await svc.getReviews(PLACE_ID);
      expect(second.cached).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // The freshness label must describe when GOOGLE was asked, not when this
      // response was assembled.
      expect(second.payload.fetchedAt).toBe(first.payload.fetchedAt);
    });

    it('re-fetches once the 6-hour TTL has expired', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-12T10:00:00Z').getTime());
      fetchMock.mockResolvedValue(jsonResponse(detailsBody()));
      const svc = new GoogleReviewsService(noRedis());
      await svc.getReviews(PLACE_ID);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // 6h + 1 minute.
      jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-12T16:01:00Z').getTime());
      const again = await svc.getReviews(PLACE_ID);
      expect(again.cached).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('keys the cache per place — a second business does not read the first one’s reviews', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(detailsBody()))
        .mockResolvedValueOnce(jsonResponse(detailsBody({ displayName: { text: 'Second Shop' } })));
      const svc = new GoogleReviewsService(noRedis());
      const a = await svc.getReviews(PLACE_ID);
      const b = await svc.getReviews('ChIJsecondplaceid123');
      expect(a.payload.place.name).toBe('Springfield Elementary');
      expect(b.payload.place.name).toBe('Second Shop');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  // ── FAILURE ───────────────────────────────────────────────────────────
  describe('failure', () => {
    it('never lets Google’s response body reach the caller', async () => {
      const leak = `secret-body-mentioning-${KEY}`;
      fetchMock.mockResolvedValue(jsonResponse({ error: { message: leak } }, 400));
      await new GoogleReviewsService(noRedis()).getReviews(PLACE_ID).then(
        () => {
          throw new Error('expected a rejection');
        },
        (err: Error) => {
          expect(err).toBeInstanceOf(GoogleReviewsProviderError);
          expect(err.message).not.toContain(leak);
          expect(err.message).not.toContain(KEY);
          expect(err.message).toContain('Places API (New)');
        },
      );
    });

    it('turns a network error into a plain sentence, not the undici message', async () => {
      fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 142.250.1.1:443'));
      await expect(new GoogleReviewsService(noRedis()).getReviews(PLACE_ID)).rejects.toThrow(
        /did not respond in time/i,
      );
    });

    it('refuses a place id that could walk out of its URL path segment', async () => {
      expect(isValidPlaceId('../../v1/places:searchText')).toBe(false);
      expect(isValidPlaceId('ChIJ/../secret')).toBe(false);
      expect(isValidPlaceId(PLACE_ID)).toBe(true);
      await expect(new GoogleReviewsService(noRedis()).getReviews('../evil')).rejects.toBeInstanceOf(
        GoogleReviewsProviderError,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
