import {
  AirQualityService,
  airObservationTime,
  parseAirObservations,
  parseAirZipAreas,
} from './air-quality.service';
import { parseAirportConditions } from './airport-conditions.service';
import {
  parseTransitFeed,
  selectTransitArrivals,
} from './transit-arrivals.service';
import {
  parseParkingInventory,
  parseParkingOccupancy,
  groupParkingReports,
  ParkingReportsService,
} from './parking-reports.service';
import {
  parseRoadIncidents,
  RoadIncidentsService,
} from './road-incidents.service';
import { ParkingReportsController } from './parking-reports.controller';
import { AirQualityController } from './air-quality.controller';
import { TravelConditionsController } from './travel-conditions.controller';
const now = Date.parse('2026-10-30T02:00:00Z');
const airRow = (over: Record<number, string> = {}) => {
  const fields = [
    'x',
    '10/29/26',
    '19:00',
    'PDT',
    'x',
    'O',
    'Y',
    'Concord',
    'CA',
    '37.9',
    '-122',
    'PM2.5',
    '34',
    'Good',
    'x',
    'x',
    'Bay Area Air District',
  ];
  for (const [k, v] of Object.entries(over)) fields[+k] = v;
  return fields.join('|');
};
describe('public data semantics and freshness', () => {
  it('parses local observation time without host timezone or invalid-date rollover', () => {
    expect(airObservationTime('10/29/26', '19:00', 'PDT')).toBe(now);
    expect(airObservationTime('10/29/26', '16:00', 'HST')).toBe(now);
    expect(airObservationTime('02/30/26', '10:00', 'EST')).toBeNaN();
    expect(airObservationTime('10/29/26', '24:00', 'PDT')).toBeNaN();
    expect(airObservationTime('10/29/26', '19:00', 'BAD')).toBeNaN();
  });
  it('only serves observed AQI with matching EPA categories; no forecasts, yesterday or concentrations', () => {
    const rows = parseAirObservations(
      [
        airRow(),
        airRow({ 5: 'F' }),
        airRow({ 5: 'Y' }),
        airRow({ 12: '-1' }),
        airRow({ 13: 'Hazardous' }),
        airRow({ 8: 'ON' }),
        airRow({ 2: '10:00' }),
      ].join('\n'),
      now,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      aqi: 34,
      category: 'Good',
      observedAt: new Date(now).toISOString(),
    });
    expect(() =>
      parseAirObservations(airRow({ 1: '10/20/26' }), now),
    ).toThrow();
    expect(() => parseAirObservations(airRow({ 12: '' }), now)).toThrow();
    expect(parseAirZipAreas('Boston|MA|02108|42.36|-71.06')['02108'].city).toBe(
      'Boston',
    );
  });
  it('selects the current reporting area and preserves AQI category color', async () => {
    jest.useFakeTimers({ now });
    try {
      const rows = parseAirObservations(airRow(), now),
        cache = {
          read: jest.fn(async (key: string) => ({
            value:
              key === 'airnow-hourly'
                ? rows
                : {
                    '94583': {
                      city: 'Concord',
                      state: 'CA',
                      lat: 37.9,
                      lon: -122,
                    },
                  },
            fetchedAt: new Date(now).toISOString(),
          })),
        };
      const result = await new AirQualityService(cache as any, {} as any).get(
        '94583',
      );
      expect(result).toMatchObject({
        matchedZip: true,
        preliminary: true,
        observation: {
          aqi: 34,
          color: '#00e400',
          pollutants: [{ name: 'PM2.5', aqi: 34 }],
        },
      });
    } finally {
      jest.useRealTimers();
    }
  });
  it('preserves FAA restriction reasons instead of claiming all flights are cancelled', () => {
    const xml = `<AIRPORT_STATUS_INFORMATION><Update_Time>${new Date(now).toUTCString()}</Update_Time><Delay_type><Airport_Closure_List><Airport><ARPT>LAX</ARPT><Reason>Closed to non-scheduled general aviation</Reason></Airport></Airport_Closure_List></Delay_type></AIRPORT_STATUS_INFORMATION>`;
    expect(parseAirportConditions(xml, now).items[0]).toMatchObject({
      airport: 'LAX',
      type: 'Closure / restriction notice',
      reason: 'Closed to non-scheduled general aviation',
    });
    expect(() => parseAirportConditions(xml, now + 31 * 60000)).toThrow(
      'fresh',
    );
    expect(
      parseAirportConditions(
        `<AIRPORT_STATUS_INFORMATION><Update_Time>${new Date(now).toUTCString()}</Update_Time></AIRPORT_STATUS_INFORMATION>`,
        now,
      ).items,
    ).toEqual([]);
  });
  it('rejects stale transit feeds and excludes cancelled, skipped and uncertain arrivals', () => {
    const trip = (id: string, over: any = {}, stopOver: any = {}) => ({
      trip_update: {
        trip: { trip_id: id, route_id: 'bus', direction_id: 0, ...over },
        stop_time_update: [
          {
            stop_id: 'child',
            departure: { time: now / 1000 + 300, uncertainty: 300 },
            ...stopOver,
          },
        ],
      },
    });
    const feed = parseTransitFeed(
      JSON.stringify({
        header: { timestamp: now / 1000, incrementality: 'FULL_DATASET' },
        entity: [
          trip('good'),
          trip('cancel', { schedule_relationship: 'CANCELED' }),
          trip('skip', {}, { schedule_relationship: 'SKIPPED' }),
          trip(
            'uncertain',
            {},
            { departure: { time: now / 1000 + 100, uncertainty: 600 } },
          ),
          trip('non-revenue', { revenue: false }),
        ],
      }),
      now,
    );
    const results = selectTransitArrivals(
      feed,
      {
        child: {
          id: 'child',
          name: 'South',
          parent: 'place-sstat',
          platform: '1',
          type: 0,
        },
      },
      { bus: { id: 'bus', name: 'SL1', directions: ['Airport'], type: 3 } },
      'place-sstat',
      now,
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      route: 'SL1',
      direction: 'Airport',
      predictionKind: 'schedule-estimate',
    });
    expect(() =>
      parseTransitFeed(
        JSON.stringify({
          header: {
            timestamp: now / 1000 - 121,
            incrementality: 'FULL_DATASET',
          },
          entity: [],
        }),
        now,
      ),
    ).toThrow();
  });
  it('groups only recent parking sensors; an old vacancy or missing state is unknown', () => {
    const meters = parseParkingInventory(
      JSON.stringify(
        ['a', 'b', 'c'].map((spaceid) => ({
          spaceid,
          blockface: '100 MAIN ST',
          latlng: { latitude: '34.05', longitude: '-118.25' },
        })),
      ),
    );
    const states = parseParkingOccupancy(
      JSON.stringify([
        {
          spaceid: 'a',
          eventtime: '2026-10-30T01:59:00.000',
          occupancystate: 'VACANT',
        },
        {
          spaceid: 'b',
          eventtime: '2026-10-30T00:00:00.000',
          occupancystate: 'VACANT',
        },
      ]),
      now,
    );
    expect(
      groupParkingReports(meters, states, 34.05, -118.25, now)[0],
    ).toMatchObject({ vacant: 1, occupied: 0, unknown: 2 });
    expect(() =>
      parseParkingOccupancy(
        '[{"spaceid":"a","eventtime":"2025-01-01T00:00:00","occupancystate":"VACANT"}]',
        now,
      ),
    ).toThrow('recent');
    expect(() => parseParkingInventory('[]')).toThrow();
  });
  it('clearly refuses parking outside LA and road coverage outside California without calling their sources', async () => {
    const sources = { read: jest.fn() },
      forecast = { coordinates: jest.fn(async () => [40.7, -74]) };
    expect(
      await new ParkingReportsService(sources as any, forecast as any).get(
        'New York',
      ),
    ).toMatchObject({ supported: false, items: [] });
    expect(
      await new RoadIncidentsService(sources as any, forecast as any).get(
        'New York',
      ),
    ).toMatchObject({ supported: false, items: [] });
    expect(sources.read).not.toHaveBeenCalled();
  });
  it('returns mapped public incident summaries without dispatcher details or invented travel speeds', () => {
    const xml =
      '<State><Center><Dispatch><Log ID="x"><LATLON>"38139968:121623745"</LATLON><LogType>"1181-Trfc Collision-Minor Inj"</LogType><Location>"Sr12 / Jackson Slough Rd"</Location><Area>"South Sac"</Area><LogDetails><IncidentDetail>PERSONAL DATA</IncidentDetail></LogDetails></Log></Dispatch></Center></State>';
    const data = parseRoadIncidents(xml);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      type: 'Collision',
      road: 'Sr12 / Jackson Slough Rd',
      lat: 38.139968,
      lon: -121.623745,
    });
    expect(JSON.stringify(data)).not.toContain('PERSONAL DATA');
    expect(data[0]).not.toHaveProperty('speed');
  });
  it('rejects array, URL and malformed selector input before reaching providers', () => {
    const provider = { get: jest.fn() },
      controllers = [
        new AirQualityController(provider as any),
        new ParkingReportsController(provider as any, provider as any),
      ];
    for (const c of controllers)
      for (const location of [
        undefined,
        ['94583'],
        'http://127.0.0.1/',
        'x'.repeat(101),
      ])
        expect(() => c.get(location as any)).toThrow();
    const travel = new TravelConditionsController(
      provider as any,
      provider as any,
    );
    expect(() => travel.airport(['SFO'] as any)).toThrow();
    expect(() => travel.airport('AB')).toThrow();
    expect(() => travel.arrivals('__proto__')).toThrow();
    expect(provider.get).not.toHaveBeenCalled();
  });
});
