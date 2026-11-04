/**
 * Free travel data: DOT work zones (WZDx, CC0) and open GTFS-realtime
 * departures. Fixtures are real responses fetched 2026-11-01, trimmed:
 *   __fixtures__/wzdx-maryland.json        Maryland DOT SHA WZDx v4.1 (feed_info)
 *   __fixtures__/wzdx-minnesota.json       MnDOT WZDx v4.0 (road_event_feed_info)
 *   gtfs/__fixtures__/bart-gtfs-stops-routes.zip  BART static GTFS, stops.txt + routes.txt only
 *   gtfs/__fixtures__/bart-tripupdates.pb         BART GTFS-realtime TripUpdates, unmodified
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { deflateRawSync } from 'zlib';

import {
  feedsCovering,
  isActiveWorkZone,
  parseWorkZones,
  WORK_ZONE_FEEDS,
  WorkZonesService,
} from './work-zones.service';
import {
  parseCsv,
  parseTripUpdates,
  readZipEntries,
} from './gtfs/gtfs-formats';
import {
  buildStaticIndex,
  GTFS_AGENCIES,
  GtfsDeparturesService,
  indexTripUpdates,
} from './gtfs/gtfs-departures.service';
import { RoadConditionsService } from './road-conditions.service';

const fx = (p: string) => readFileSync(join(__dirname, p));

describe('WZDx work zones', () => {
  it('parses a real v4.1 feed (feed_info) into compact rows', () => {
    const { publisher, items } = parseWorkZones(
      fx('__fixtures__/wzdx-maryland.json').toString('utf8'),
    );
    expect(publisher).toBe('Maryland DOT SHA');
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      road: 'CO140 / SHOWALTER RD',
      type: 'Road work · Lanes closed',
      lat: 39.700509,
      lon: -77.739359,
    });
  });

  it('parses a real v4.0 feed (road_event_feed_info) including detours', () => {
    const { items } = parseWorkZones(
      fx('__fixtures__/wzdx-minnesota.json').toString('utf8'),
    );
    expect(items[0]).toMatchObject({
      road: 'Co Rd 96',
      type: 'Road work · Road closed',
    });
    expect(items.some((i) => i.type.startsWith('Detour'))).toBe(true);
  });

  it('refuses a feed whose licence is not CC0 — never shown', () => {
    const doc = JSON.parse(
      fx('__fixtures__/wzdx-maryland.json').toString('utf8'),
    );
    doc.feed_info.license = 'https://example.com/proprietary';
    expect(() => parseWorkZones(JSON.stringify(doc))).toThrow(/licence/);
    delete doc.feed_info.license;
    expect(() => parseWorkZones(JSON.stringify(doc))).toThrow(/licence/);
  });

  it('active-now rule: ended or far-future zones drop out; unknown dates stay', () => {
    const z = {
      id: 'x',
      type: '',
      road: '',
      area: '',
      impact: '',
      lat: 0,
      lon: 0,
      start: '',
      end: '',
    };
    const now = Date.parse('2026-11-01T12:00:00Z');
    expect(isActiveWorkZone({ ...z, end: '2026-10-01T00:00:00Z' }, now)).toBe(
      false,
    );
    expect(isActiveWorkZone({ ...z, start: '2026-12-01T00:00:00Z' }, now)).toBe(
      false,
    );
    expect(isActiveWorkZone(z, now)).toBe(true);
  });

  it('coverage: a location selects its state feed; an uncovered state gets none', () => {
    expect(feedsCovering(39.29, -76.61).map((f) => f.id)).toContain('maryland'); // Baltimore
    expect(feedsCovering(44.98, -93.27).map((f) => f.id)).toContain(
      'minnesota',
    ); // Minneapolis
    expect(feedsCovering(33.75, -84.39)).toEqual([]); // Atlanta — Georgia publishes no CC0 keyless feed
    expect(WORK_ZONE_FEEDS.every((f) => !/key|token/i.test(f.url))).toBe(true);
  });

  it('near(): filters by distance from the real feed through the shared cache', async () => {
    const body = fx('__fixtures__/wzdx-maryland.json').toString('utf8');
    const sources = {
      read: jest.fn(
        async (
          _k: string,
          _u: string,
          _t: number,
          parse: (b: string) => unknown,
        ) => ({ value: parse(body), fetchedAt: '2026-11-01T00:00:00Z' }),
      ),
    };
    const svc = new WorkZonesService(sources as never, {} as never);
    const r = await svc.near(39.7, -77.74, 25);
    expect(r.covered).toBe(true);
    expect(r.sources[0].name).toBe('Maryland DOT SHA');
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((i) => i.distanceKm <= 25)).toBe(true);
    expect(sources.read.mock.calls[0][0]).toBe('wzdx:maryland');
  });
});

describe('road conditions (CHP + WZDx)', () => {
  it('outside every free feed: supported:false with the coverage sentence, no error', async () => {
    const svc = new RoadConditionsService(
      { coordinates: async () => [33.75, -84.39, true] } as never,
      { get: jest.fn() } as never,
      {
        near: async () => ({
          covered: false,
          sources: [],
          failed: 0,
          items: [],
        }),
      } as never,
    );
    const r = await svc.get('Atlanta, GA');
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/15 states/);
  });
});

describe('GTFS formats', () => {
  it('zip: reads stored and deflated entries by basename', () => {
    const entries = readZipEntries(
      fx('gtfs/__fixtures__/bart-gtfs-stops-routes.zip'),
      ['stops.txt', 'routes.txt'],
    );
    expect(entries['stops.txt'].toString('utf8')).toMatch(/^"stop_id"/);
    expect(entries['routes.txt'].length).toBeGreaterThan(100);
    expect(() =>
      readZipEntries(deflateRawSync(Buffer.from('nope')), ['a']),
    ).toThrow(/zip/);
  });

  it('csv: quotes, escaped quotes, CRLF', () => {
    expect(parseCsv('a,b\r\n"x,1","say ""hi"""\r\n')).toEqual([
      { a: 'x,1', b: 'say "hi"' },
    ]);
  });

  it('protobuf: real BART TripUpdates decode to trips with stop times', () => {
    const { timestamp, trips } = parseTripUpdates(
      fx('gtfs/__fixtures__/bart-tripupdates.pb'),
    );
    expect(timestamp).toBeGreaterThan(1.7e9);
    expect(trips.length).toBeGreaterThan(5);
    expect(trips.some((t) => t.stops.some((s) => s.time > 0 && s.stopId))).toBe(
      true,
    );
  });
});

describe('GTFS departures', () => {
  const idx = buildStaticIndex(
    fx('gtfs/__fixtures__/bart-gtfs-stops-routes.zip'),
  );
  const pb = fx('gtfs/__fixtures__/bart-tripupdates.pb');
  const stamp = parseTripUpdates(pb).timestamp * 1000;

  it('static index: platforms fold into their parent station; routes named', () => {
    const lake = idx.stations.find((s) => s.id === 'LAKE')!;
    expect(lake.name).toBe('Lake Merritt');
    expect(lake.stops).toEqual(expect.arrayContaining(['A10-1', 'A10-2']));
    expect(idx.routes['1']).toBe('Yellow-S');
  });

  it('predictions index by station, next 2 h, soonest first, with destination', () => {
    const { byStation, updatedAt } = indexTripUpdates(pb, idx, stamp);
    expect(Date.parse(updatedAt)).toBe(stamp);
    const busiest = Object.values(byStation).sort(
      (a, b) => b.length - a.length,
    )[0];
    expect(busiest.length).toBeGreaterThan(0);
    expect(busiest.map((d) => d.time)).toEqual(
      [...busiest.map((d) => d.time)].sort(),
    );
    expect(
      busiest.every((d) => d.direction.startsWith('to ') || d.direction === ''),
    ).toBe(true);
    // BART's TripUpdates carry no route_id; the route comes from trips.txt.
    expect(busiest.every((d) => d.route !== 'Service')).toBe(true);
  });

  it('a stale realtime feed is refused (the board says unavailable, never shows old times)', () => {
    expect(() => indexTripUpdates(pb, idx, stamp + 10 * 60_000)).toThrow(
      /fresh/,
    );
  });

  it('agencies list carries a terms URL; no URL takes a key', () => {
    for (const a of GTFS_AGENCIES) {
      expect(a.termsUrl).toMatch(/^https:\/\//);
      expect(`${a.tripUpdatesUrl}${a.staticUrl}`).not.toMatch(/key|token/i);
    }
  });

  it('service: unknown agency / bad station id are 400s before any fetch', async () => {
    const sources = { read: jest.fn() };
    const svc = new GtfsDeparturesService(sources as never);
    await expect(svc.departures('nope', 'LAKE')).rejects.toMatchObject({
      status: 400,
    });
    await expect(svc.departures('bart', '../x')).rejects.toMatchObject({
      status: 400,
    });
    expect(sources.read).not.toHaveBeenCalled();
  });

  it('service: station search over the real static index', async () => {
    const zip = fx('gtfs/__fixtures__/bart-gtfs-stops-routes.zip').toString(
      'latin1',
    );
    const sources = {
      read: jest.fn(
        async (
          _k: string,
          _u: string,
          _t: number,
          parse: (b: string) => unknown,
        ) => ({ value: parse(zip), fetchedAt: 'x' }),
      ),
    };
    const svc = new GtfsDeparturesService(sources as never);
    const r = await svc.stations('bart', 'merritt');
    expect(r.items).toEqual([{ id: 'LAKE', name: 'Lake Merritt' }]);
    expect(sources.read.mock.calls[0][4]).toMatchObject({ binary: true });
  });
});
