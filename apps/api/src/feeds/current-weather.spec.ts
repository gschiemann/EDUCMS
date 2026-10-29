import {
  CurrentWeatherService,
  parseCurrentModel,
  metConditionCode,
} from './current-weather.service';
import { CurrentWeatherController } from './current-weather.controller';
import { safeFetch } from '../branding/safe-fetch';
jest.mock('../branding/safe-fetch', () => ({ safeFetch: jest.fn() }));
const now = Date.parse('2026-10-29T15:25:00Z');
const model = () => ({
  properties: {
    meta: { updated_at: '2026-10-29T13:00:00Z' },
    timeseries: Array.from({ length: 30 }, (_, i) => ({
      time: new Date(
        Date.parse('2026-10-29T15:00:00Z') + i * 3600000,
      ).toISOString(),
      data: {
        instant: { details: { air_temperature: 10 + i, wind_speed: 2 } },
        next_1_hours: { summary: { symbol_code: 'cloudy' } },
      },
    })),
  },
});
beforeEach(() => {
  jest.useFakeTimers({ now });
  (safeFetch as jest.Mock).mockReset();
});
afterEach(() => jest.useRealTimers());
it('uses the current forecast hour and actual next-24-hour limits without inventing observations', () => {
  const data = parseCurrentModel(model(), '94583', true, now);
  expect(data).toMatchObject({
    temp: 10,
    high: 33,
    low: 10,
    humidity: null,
    wind: 4,
    weatherCode: 3,
    source: 'MET Norway',
    forecastAt: '2026-10-29T15:00:00.000Z',
  });
  expect(
    parseCurrentModel(model(), '94583', false, now + 2 * 3600000).temp,
  ).toBe(12);
  const partial = model();
  partial.properties.timeseries.length = 1;
  expect(parseCurrentModel(partial, '94583', false, now).high).toBeNull();
  expect(metConditionCode('sleet')).toBe(68);
  expect(metConditionCode('rainshowers_day')).toBe(80);
  expect(metConditionCode('unknown')).toBe(-1);
});
it('rejects stale, malformed and future-only models', () => {
  const old = model();
  old.properties.meta.updated_at = '2026-10-20T13:00:00Z';
  expect(() => parseCurrentModel(old, '94583', false, now)).toThrow('Outdated');
  expect(() => parseCurrentModel({}, '94583', false, now)).toThrow();
  const future = model();
  future.properties.timeseries = future.properties.timeseries.slice(10);
  expect(() => parseCurrentModel(future, '94583', false, now)).toThrow(
    'current-hour',
  );
});
function serviceFixture() {
  const cache = new Map<string, string>();
  const publisher = {
    get: async (k: string) => cache.get(k) || null,
    set: jest.fn(async (k: string, v: string, ...args: unknown[]) => {
      if (args.includes('NX')) return 'OK';
      cache.set(k, v);
      return 'OK';
    }),
  };
  const coordinates = jest.fn(async () => [37.7799123, -121.9780123, true]);
  const check = jest.fn();
  return {
    cache,
    publisher,
    coordinates,
    check,
    service: new CurrentWeatherService(
      { publisher } as any,
      { coordinates } as any,
      { check } as any,
    ),
  };
}
it('coalesces units, honors source expiry and re-evaluates the hour in its shared cached model', async () => {
  const f = serviceFixture();
  (safeFetch as jest.Mock).mockResolvedValue({
    status: 200,
    body: Buffer.from(JSON.stringify(model())),
    headers: {
      expires: new Date(now + 3 * 3600000).toUTCString(),
      'last-modified': 'Thu, 29 Oct 2026 13:00:00 GMT',
    },
  });
  const [fahrenheit, celsius] = await Promise.all([
    f.service.get('94583', false),
    f.service.get('94583', true),
  ]);
  expect(fahrenheit.temp).toBe(50);
  expect(celsius.temp).toBe(10);
  expect(celsius.feelsLike).toBeNull();
  expect(celsius.kind).toBe('forecast');
  expect(safeFetch).toHaveBeenCalledTimes(1);
  expect(String((safeFetch as jest.Mock).mock.calls[0][0])).toContain(
    'lat=37.7799&lon=-121.9780',
  );
  jest.setSystemTime(now + 2 * 3600000);
  expect((await f.service.get('94583', true)).temp).toBe(12);
  expect(safeFetch).toHaveBeenCalledTimes(1);
  jest.setSystemTime(now + 4 * 3600000);
  (safeFetch as jest.Mock).mockResolvedValue({
    status: 304,
    headers: { expires: new Date(now + 5 * 3600000).toUTCString() },
  });
  expect((await f.service.get('94583', true)).temp).toBe(14);
  expect((safeFetch as jest.Mock).mock.calls[1][1].headers).toMatchObject({
    'If-Modified-Since': 'Thu, 29 Oct 2026 13:00:00 GMT',
  });
  expect(f.publisher.set).toHaveBeenCalledWith(
    'feeds:met:pace',
    '1',
    'PX',
    100,
    'NX',
  );
});
it('returns a clear failure when shared request pacing is unavailable', async () => {
  const service = new CurrentWeatherService(
    { publisher: null } as any,
    { coordinates: async () => [0, 0, false] } as any,
    { check: jest.fn() } as any,
  );
  await expect(service.get('0,0', false)).rejects.toThrow(
    'temporarily unavailable',
  );
  expect(safeFetch).not.toHaveBeenCalled();
});
it('rejects URL injection, arrays, empty locations and unsupported units before accessing any source', () => {
  const get = jest.fn();
  const controller = new CurrentWeatherController({ get } as any);
  for (const place of [
    '',
    'x'.repeat(101),
    ['94583'],
    'https://evil.example',
    undefined,
  ])
    expect(() => controller.get(place as any)).toThrow();
  expect(() => controller.get('94583', 'kelvin')).toThrow();
  expect(get).not.toHaveBeenCalled();
  controller.get('San Ramon, CA', 'metric');
  expect(get).toHaveBeenCalledWith('San Ramon, CA', true);
});
