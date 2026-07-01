/**
 * GeocodingController honesty tests — mobile bug #216 (2026-07-01).
 *
 * Before this fix, `provider` in the response reported whether Google was
 * CONFIGURED, not which provider actually resolved the query — so an
 * unconfigured deploy always claimed 'osm' even on a request that never
 * even reached Nominatim (e.g. Census resolved it, or no query was given).
 * These tests pin the honest contract: `provider` reflects the actual
 * source of the top hit, and `googleConfigured` separately tells the
 * frontend whether the precise (Google) tier exists at all — the two
 * concerns the UI needs to distinguish "no key configured" from "key
 * configured but this address genuinely wasn't found."
 */
import { GeocodingController } from './geocoding.controller';
import type { GeocodingService } from './geocoding.service';

/** Plain-object mocks typed as `jest.Mock`, not as bound class methods —
 *  keeps eslint's `unbound-method` rule happy when we later assert on them
 *  directly (e.g. `expect(mock.search).toHaveBeenCalledWith(...)`). */
interface GeocodingMock {
  search: jest.Mock;
  reverse: jest.Mock;
  googleEnabled: jest.Mock;
}

function makeGeocodingMock(overrides: Partial<GeocodingMock> = {}): {
  service: GeocodingService;
  mock: GeocodingMock;
} {
  const mock: GeocodingMock = {
    search: jest.fn().mockResolvedValue([]),
    reverse: jest.fn().mockResolvedValue(null),
    googleEnabled: jest.fn().mockReturnValue(false),
    ...overrides,
  };
  return { service: mock as unknown as GeocodingService, mock };
}

describe('GeocodingController.search', () => {
  it('reports the ACTUAL source of the top hit as `provider`, not just whether Google is configured', async () => {
    const { service } = makeGeocodingMock({
      search: jest.fn().mockResolvedValue([
        {
          display_name: '150 Chardon Ave, Chardon, OH, 44024',
          lat: '41.5894',
          lon: '-81.2006',
          source: 'census',
        },
      ]),
      googleEnabled: jest.fn().mockReturnValue(false),
    });
    const controller = new GeocodingController(service);
    const res = await controller.search('150 Chardon Ave');
    expect(res.provider).toBe('census');
    expect(res.googleConfigured).toBe(false);
    expect(res.results).toHaveLength(1);
  });

  it('reports "google" when Google resolved the top hit', async () => {
    const { service } = makeGeocodingMock({
      search: jest.fn().mockResolvedValue([
        {
          display_name: '1600 Pennsylvania Ave NW',
          lat: '38.8977',
          lon: '-77.0365',
          source: 'google',
        },
      ]),
      googleEnabled: jest.fn().mockReturnValue(true),
    });
    const controller = new GeocodingController(service);
    const res = await controller.search('1600 Pennsylvania Ave NW');
    expect(res.provider).toBe('google');
    expect(res.googleConfigured).toBe(true);
  });

  it('falls back to a config-derived provider guess when there are zero results (nothing to report a source for)', async () => {
    const { service } = makeGeocodingMock({
      search: jest.fn().mockResolvedValue([]),
      googleEnabled: jest.fn().mockReturnValue(false),
    });
    const controller = new GeocodingController(service);
    const res = await controller.search('complete gibberish');
    expect(res.results).toEqual([]);
    expect(res.googleConfigured).toBe(false);
    // No hits to derive a source from — falls back to naming the best
    // available keyless tier (census) rather than lying "osm" was tried last.
    expect(res.provider).toBe('census');
  });

  it('passes the optional lat/lng bias through to the service', async () => {
    const { service, mock } = makeGeocodingMock();
    const controller = new GeocodingController(service);
    await controller.search('123 Main St', '41.5', '-81.2');
    expect(mock.search).toHaveBeenCalledWith('123 Main St', {
      bias: { lat: 41.5, lng: -81.2 },
    });
  });

  it('omits bias when lat/lng are not finite numbers', async () => {
    const { service, mock } = makeGeocodingMock();
    const controller = new GeocodingController(service);
    await controller.search('123 Main St', 'not-a-number', undefined);
    expect(mock.search).toHaveBeenCalledWith('123 Main St', {
      bias: undefined,
    });
  });
});

describe('GeocodingController.reverse', () => {
  it('reports the actual source of the reverse-geocode hit', async () => {
    const { service } = makeGeocodingMock({
      reverse: jest.fn().mockResolvedValue({
        display_name: 'Somewhere, USA',
        lat: '1',
        lon: '2',
        source: 'nominatim',
      }),
      googleEnabled: jest.fn().mockReturnValue(false),
    });
    const controller = new GeocodingController(service);
    const res = await controller.reverse('1', '2');
    expect(res.provider).toBe('nominatim');
    expect(res.googleConfigured).toBe(false);
  });

  it('returns { result: null } without calling the service for invalid coordinates', async () => {
    const { service, mock } = makeGeocodingMock();
    const controller = new GeocodingController(service);
    const res = await controller.reverse('not-a-number', '2');
    expect(res).toEqual({ result: null });
    expect(mock.reverse).not.toHaveBeenCalled();
  });
});
