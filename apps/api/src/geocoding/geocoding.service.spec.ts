/**
 * GeocodingService provider-chain tests — mobile bug #216 (2026-07-01),
 * "location/address picker not finding real US street addresses."
 *
 * Root cause: with no GOOGLE_MAPS_API_KEY configured, the picker fell all
 * the way back to OSM Nominatim, whose crowd-sourced address-range data has
 * documented gaps on specific US house numbers (see ScreenLocationModal.tsx
 * / AddressAutocomplete.tsx comments — "2748 Emory Oak Ct" returned zero
 * Nominatim matches). Fix: insert the free, KEYLESS US Census Bureau
 * Geocoder (real TIGER/Line house-number coverage) as the primary keyless
 * tier, between Google (if configured) and Nominatim (final fallback).
 *
 * safeFetch is mocked so these tests are hermetic (no network) — the SSRF
 * behavior of safeFetch itself is proven elsewhere (webhook-dispatch.ssrf,
 * data-source.ssrf). Here we control exactly what each provider "returns"
 * and assert the service picks the right tier in the right order.
 */
jest.mock('../branding/safe-fetch', () => ({
  __esModule: true,
  safeFetch: jest.fn(),
}));

import { safeFetch } from '../branding/safe-fetch';
import { GeocodingService } from './geocoding.service';

// Typed as the real safeFetch signature (not a bare `jest.Mock`) so
// `mockedFetch.mock.calls[i][0]` resolves to `string`, not `any` —
// keeps eslint's no-unsafe-member-access rule happy on the URL assertions
// below without a `.calls[i][0] as string` cast at every call site.
const mockedFetch = safeFetch as unknown as jest.MockedFunction<
  typeof safeFetch
>;

function jsonResponse(body: unknown, status = 200) {
  return {
    body: Buffer.from(JSON.stringify(body), 'utf8'),
    contentType: 'application/json',
    finalUrl: 'https://example.com',
    status,
  };
}

function censusHit(matchedAddress: string, x: number, y: number) {
  return jsonResponse({
    result: {
      addressMatches: [{ matchedAddress, coordinates: { x, y } }],
    },
  });
}

function censusEmpty() {
  return jsonResponse({ result: { addressMatches: [] } });
}

function nominatimHit(display_name: string, lat: string, lon: string) {
  return jsonResponse([{ place_id: 1, display_name, lat, lon }]);
}

function nominatimEmpty() {
  return jsonResponse([]);
}

function googleHit(formatted_address: string, lat: number, lng: number) {
  return jsonResponse({
    status: 'OK',
    results: [{ formatted_address, geometry: { location: { lat, lng } } }],
  });
}

function googleZeroResults() {
  return jsonResponse({ status: 'ZERO_RESULTS', results: [] });
}

const ORIGINAL_ENV = process.env.GOOGLE_MAPS_API_KEY;

afterEach(() => {
  jest.clearAllMocks();
  if (ORIGINAL_ENV === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = ORIGINAL_ENV;
});

describe('GeocodingService.search — provider chain', () => {
  describe('no Google key configured (the common unconfigured-deploy case)', () => {
    beforeEach(() => {
      delete process.env.GOOGLE_MAPS_API_KEY;
    });

    it('resolves a real US house-number address via the Census Bureau geocoder (keyless)', async () => {
      mockedFetch.mockResolvedValueOnce(
        censusHit('150 CHARDON AVE, CHARDON, OH, 44024', -81.2006, 41.5894),
      );
      const svc = new GeocodingService();
      const results = await svc.search('150 Chardon Ave, Chardon, OH');

      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('census');
      expect(results[0].lat).toBe('41.5894');
      expect(results[0].lon).toBe('-81.2006');
      // Title-cased for display, not SHOUTY like the raw Census response.
      expect(results[0].display_name).toBe(
        '150 Chardon Ave, Chardon, OH, 44024',
      );
      // Only ONE outbound call — Census hit, so Nominatim was never reached.
      expect(mockedFetch).toHaveBeenCalledTimes(1);
      expect(mockedFetch.mock.calls[0][0]).toContain(
        'geocoding.geo.census.gov',
      );
    });

    it('falls back to Nominatim when Census has no match', async () => {
      mockedFetch.mockResolvedValueOnce(censusEmpty());
      mockedFetch.mockResolvedValueOnce(
        nominatimHit(
          '1600 Pennsylvania Ave NW, Washington, DC',
          '38.8977',
          '-77.0365',
        ),
      );
      const svc = new GeocodingService();
      const results = await svc.search('1600 Pennsylvania Ave NW');

      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('nominatim');
      expect(mockedFetch).toHaveBeenCalledTimes(2);
      expect(mockedFetch.mock.calls[0][0]).toContain(
        'geocoding.geo.census.gov',
      );
      expect(mockedFetch.mock.calls[1][0]).toContain(
        'nominatim.openstreetmap.org',
      );
    });

    it('falls back to Nominatim when Census errors (network failure, 5xx, bad JSON)', async () => {
      mockedFetch.mockRejectedValueOnce(new Error('Census timed out'));
      mockedFetch.mockResolvedValueOnce(
        nominatimHit('Somewhere, USA', '10', '20'),
      );
      const svc = new GeocodingService();
      const results = await svc.search('a real street address');

      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('nominatim');
    });

    it('returns empty when every keyless tier misses (never throws to the caller)', async () => {
      mockedFetch.mockResolvedValueOnce(censusEmpty());
      mockedFetch.mockResolvedValueOnce(nominatimEmpty());
      const svc = new GeocodingService();
      const results = await svc.search('complete gibberish address');
      expect(results).toEqual([]);
    });

    it('googleEnabled() is false so callers can surface an honest "no precise key" note', () => {
      const svc = new GeocodingService();
      expect(svc.googleEnabled()).toBe(false);
    });
  });

  describe('Google key configured', () => {
    beforeEach(() => {
      process.env.GOOGLE_MAPS_API_KEY = 'test-key-not-real';
    });

    it('prefers Google over Census/Nominatim when Google has a match', async () => {
      mockedFetch.mockResolvedValueOnce(
        googleHit(
          '1600 Pennsylvania Ave NW, Washington, DC 20500',
          38.8987,
          -77.0352,
        ),
      );
      const svc = new GeocodingService();
      const results = await svc.search('1600 Pennsylvania Ave NW');

      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('google');
      expect(mockedFetch).toHaveBeenCalledTimes(1);
      expect(mockedFetch.mock.calls[0][0]).toContain('maps.googleapis.com');
    });

    it('falls through to Census, then Nominatim, when Google returns ZERO_RESULTS', async () => {
      mockedFetch.mockResolvedValueOnce(googleZeroResults());
      mockedFetch.mockResolvedValueOnce(
        censusHit('150 CHARDON AVE, CHARDON, OH, 44024', -81.2006, 41.5894),
      );
      const svc = new GeocodingService();
      const results = await svc.search('150 Chardon Ave, Chardon, OH');

      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('census');
      expect(mockedFetch).toHaveBeenCalledTimes(2);
    });

    it('falls through to Census when Google errors (quota, network)', async () => {
      mockedFetch.mockRejectedValueOnce(new Error('Google HTTP 403'));
      mockedFetch.mockResolvedValueOnce(
        censusHit('150 CHARDON AVE, CHARDON, OH, 44024', -81.2006, 41.5894),
      );
      const svc = new GeocodingService();
      const results = await svc.search('150 Chardon Ave, Chardon, OH');
      expect(results[0].source).toBe('census');
    });

    it('googleEnabled() is true', () => {
      const svc = new GeocodingService();
      expect(svc.googleEnabled()).toBe(true);
    });
  });

  it('returns [] for a too-short query without making any network call', async () => {
    const svc = new GeocodingService();
    const results = await svc.search('ab');
    expect(results).toEqual([]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe('GeocodingService.reverse — unaffected by the Census addition (no reverse endpoint there)', () => {
  beforeEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it('goes straight to Nominatim reverse when Google is not configured', async () => {
    mockedFetch.mockResolvedValueOnce(
      jsonResponse({ display_name: 'Somewhere, USA' }),
    );
    const svc = new GeocodingService();
    const result = await svc.reverse(38.8977, -77.0365);
    expect(result?.source).toBe('nominatim');
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch.mock.calls[0][0]).toContain(
      'nominatim.openstreetmap.org/reverse',
    );
  });

  it('returns null (not throw) when reverse geocoding finds nothing', async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse({}));
    const svc = new GeocodingService();
    const result = await svc.reverse(0, 0);
    expect(result).toBeNull();
  });

  it('rejects out-of-range coordinates without making a network call', async () => {
    const svc = new GeocodingService();
    const result = await svc.reverse(999, 999);
    expect(result).toBeNull();
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
