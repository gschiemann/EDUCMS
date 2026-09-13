/**
 * google-reviews-client — the contracts a wall screen depends on.
 *
 * Three of these are re-tests of bugs this codebase has already paid for once:
 *   • a paired screen must send its DEVICE token, or reviews work in the
 *     builder and are dead on the glass (the Tier-0 menu-board failure);
 *   • an EMPTY result is DATA and must replace what is on screen, while only a
 *     FAILURE keeps the last good payload (the sold-out-prices failure);
 *   • the last-good cache is BOUNDED, because Google's terms permit only
 *     temporary caching of Places content.
 */

import {
  fetchGoogleReviews,
  readLastGoodReviews,
  writeLastGoodReviews,
  selectReviews,
  LAST_GOOD_MAX_AGE_MS,
  type GoogleReviewItem,
  type GoogleReviewsPayload,
} from '../google-reviews-client';

const apiFetchMock = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

const deviceTokenMock = jest.fn<string | null, []>();
jest.mock('@/lib/menu/device-menu', () => ({
  resolveDeviceToken: () => deviceTokenMock(),
}));

const PLACE_ID = 'ChIJj61dQgK6j4AR4GeTYWZsKWw';

function review(over: Partial<GoogleReviewItem> = {}): GoogleReviewItem {
  return {
    author: 'Dana R.',
    authorUri: 'https://www.google.com/maps/contrib/1',
    photoUri: 'https://lh3.googleusercontent.com/a/dana',
    rating: 5,
    text: 'Great work.',
    publishedAt: '2026-08-02T17:04:11Z',
    relative: 'a month ago',
    reviewUri: 'https://maps.google.com/review/1',
    ...over,
  };
}

function payload(over: Partial<GoogleReviewsPayload> = {}): GoogleReviewsPayload {
  return {
    enabled: true,
    place: { name: 'Riot Color', rating: 4.7, count: 218, mapsUri: null },
    reviews: [review()],
    fetchedAt: '2026-09-12T06:00:00.000Z',
    ...over,
  };
}

const realFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  localStorage.clear();
  apiFetchMock.mockReset();
  deviceTokenMock.mockReset().mockReturnValue(null);
  fetchMock = jest.fn();
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
});

afterEach(() => {
  (global as unknown as { fetch: unknown }).fetch = realFetch;
  jest.restoreAllMocks();
});

describe('fetchGoogleReviews — which credential', () => {
  it('uses the DEVICE token on a paired screen, never the session path', async () => {
    deviceTokenMock.mockReturnValue('device-jwt-abc');
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => payload() });

    const res = await fetchGoogleReviews(PLACE_ID);

    expect(res?.reviews).toHaveLength(1);
    expect(apiFetchMock).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/integrations/google-reviews/reviews');
    expect(String(url)).toContain(`placeId=${PLACE_ID}`);
    expect(init.headers.Authorization).toBe('Bearer device-jwt-abc');
  });

  it('uses the session path in the builder, where there is no device token', async () => {
    apiFetchMock.mockResolvedValue(payload());
    const res = await fetchGoogleReviews(PLACE_ID);
    expect(res?.place?.name).toBe('Riot Color');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(apiFetchMock.mock.calls[0][0])).toContain('/integrations/google-reviews/reviews?placeId=');
  });
});

describe('fetchGoogleReviews — the null / [] / data contract', () => {
  it('returns null (a FAILURE) on a non-200, so the caller may keep its last good payload', async () => {
    deviceTokenMock.mockReturnValue('device-jwt-abc');
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    expect(await fetchGoogleReviews(PLACE_ID)).toBeNull();
  });

  it('returns null on a network throw', async () => {
    deviceTokenMock.mockReturnValue('device-jwt-abc');
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await fetchGoogleReviews(PLACE_ID)).toBeNull();
  });

  it('returns a payload with an EMPTY array as real data — not null (session path)', async () => {
    apiFetchMock.mockResolvedValue(payload({ reviews: [] }));
    const res = await fetchGoogleReviews(PLACE_ID);
    expect(res).not.toBeNull();
    expect(res?.reviews).toEqual([]);
  });

  it('returns a payload with an EMPTY array as real data — not null (device path)', async () => {
    // Asserted on BOTH branches deliberately: the two paths are separate
    // returns, so a collapse introduced in one is invisible to a test that
    // only exercises the other.
    deviceTokenMock.mockReturnValue('device-jwt-abc');
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => payload({ reviews: [] }) });
    const res = await fetchGoogleReviews(PLACE_ID);
    expect(res).not.toBeNull();
    expect(res?.reviews).toEqual([]);
  });

  it('reports enabled:false as a real answer, not a failure', async () => {
    apiFetchMock.mockResolvedValue({ enabled: false, place: null, reviews: [], fetchedAt: null });
    const res = await fetchGoogleReviews(PLACE_ID);
    expect(res?.enabled).toBe(false);
  });

  it('returns null for a body that is not the payload shape at all', async () => {
    apiFetchMock.mockResolvedValue({ oops: true });
    expect(await fetchGoogleReviews(PLACE_ID)).toBeNull();
  });
});

describe('last-good cache', () => {
  it('round-trips a payload for its own place id', () => {
    writeLastGoodReviews(PLACE_ID, payload());
    expect(readLastGoodReviews(PLACE_ID)?.place?.name).toBe('Riot Color');
    expect(readLastGoodReviews('ChIJsomethingelse')).toBeNull();
  });

  it('DROPS a payload older than the policy window instead of showing stale reviews', () => {
    const now = new Date('2026-09-12T12:00:00Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now - LAST_GOOD_MAX_AGE_MS - 60_000);
    writeLastGoodReviews(PLACE_ID, payload());
    jest.spyOn(Date, 'now').mockReturnValue(now);

    expect(readLastGoodReviews(PLACE_ID)).toBeNull();
    // …and it is removed, not merely hidden.
    expect(localStorage.getItem(`venueos_greviews_v1:${PLACE_ID}`)).toBeNull();
  });

  it('keeps a payload that is still inside the window', () => {
    const now = new Date('2026-09-12T12:00:00Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now - LAST_GOOD_MAX_AGE_MS + 60_000);
    writeLastGoodReviews(PLACE_ID, payload());
    jest.spyOn(Date, 'now').mockReturnValue(now);
    expect(readLastGoodReviews(PLACE_ID)).not.toBeNull();
  });

  it('survives a corrupt entry without throwing', () => {
    localStorage.setItem(`venueos_greviews_v1:${PLACE_ID}`, '{not json');
    expect(readLastGoodReviews(PLACE_ID)).toBeNull();
  });
});

describe('selectReviews', () => {
  const rows = [review({ rating: 5 }), review({ rating: 3 }), review({ rating: 4 }), review({ rating: null })];

  it('filters below the minimum rating', () => {
    expect(selectReviews(rows, { minRating: 4, maxItems: 5 }).map((r) => r.rating)).toEqual([5, 4]);
  });

  it('keeps un-rated reviews only when no minimum is set', () => {
    expect(selectReviews(rows, { minRating: 0, maxItems: 5 })).toHaveLength(4);
    expect(selectReviews(rows, { minRating: 1, maxItems: 5 })).toHaveLength(3);
  });

  it('caps at maxItems, and never above the five Google returns', () => {
    expect(selectReviews(rows, { minRating: 0, maxItems: 2 })).toHaveLength(2);
    expect(selectReviews(rows, { minRating: 0, maxItems: 99 })).toHaveLength(4);
  });
});
