import { ForecastService, parseForecastPeriods } from './forecast.service';
import { ForecastController } from './forecast.controller';
import { safeFetch } from '../branding/safe-fetch';
import { RedisService } from '../realtime/redis.service';
jest.mock('../branding/safe-fetch', () => ({ safeFetch: jest.fn() }));
const fetchMock = safeFetch as jest.Mock;
const response = (body: unknown) => ({ status: 200, body: Buffer.from(JSON.stringify(body)) });
const periods = Array.from({ length: 12 }, (_, i) => ({ startTime: `2026-10-${String(20 + Math.floor(i / 2)).padStart(2,'0')}T${i % 2 ? '18' : '06'}:00:00-10:00`, isDaytime: !(i % 2), temperature: i % 2 ? 65 : 80, shortForecast: 'Mostly Sunny', probabilityOfPrecipitation: { value: 20 } }));
beforeEach(() => fetchMock.mockReset());
it('pairs actual local-date day/night periods, caps at five days and never fabricates a daytime high', () => {
  const rows = parseForecastPeriods([{ startTime: '2026-10-19T18:00:00-10:00', isDaytime: false, temperature: 61 }, ...periods]);
  expect(rows).toHaveLength(5); expect(rows[0]).toEqual({ date: '2026-10-20', high: 80, low: 65, condition: 'Mostly Sunny', rain: 20 });
  expect(parseForecastPeriods([{ isDaytime: true, startTime: '2026-10-20T06:00:00Z', temperature: NaN }])).toEqual([]);
});
it('shares concurrent coordinate lookups, uses only approved NWS links and caches the forecast', async () => {
  const store = new Map<string,string>(); const redis = { publisher: { get: jest.fn(async (k: string) => store.get(k) || null), set: jest.fn(async (k: string,v: string) => { store.set(k,v); return 'OK'; }) } } as unknown as RedisService;
  const service = new ForecastService(redis);
  fetchMock.mockResolvedValueOnce(response({ properties: { forecast: 'https://api.weather.gov/gridpoints/HFO/1,2/forecast', relativeLocation: { properties: { city: 'Honolulu', state: 'HI' } } } })).mockResolvedValueOnce(response({ properties: { periods } }));
  const [one,two] = await Promise.all([service.get('21.3,-157.8', true), service.get('21.3,-157.8', true)]);
  expect(one).toEqual(two); expect(one.days).toHaveLength(5); expect(one.location).toBe('Honolulu, HI'); expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toContain('units=si'); await service.get('21.3,-157.8', true); expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('rejects off-host forecast links before making an outbound request', async () => {
  fetchMock.mockResolvedValue(response({ properties: { forecast: 'http://169.254.169.254/private' } }));
  const service = new ForecastService({ publisher: null } as RedisService);
  await expect(service.get('22,-158', false)).rejects.toThrow('Forecast unavailable'); expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('does not geocode invalid coordinates and does not leak upstream error details', async () => {
  const service = new ForecastService({ publisher: null } as RedisService);
  await expect(service.get('999,-158', false)).rejects.toThrow('Forecast unavailable'); expect(fetchMock).not.toHaveBeenCalled();
});
it('requires a nonempty bounded location and supported units before touching providers', async () => {
  const get = jest.fn(); const controller = new ForecastController({ get } as unknown as ForecastService);
  for (const location of [undefined, '', 'x'.repeat(121), ['a','b'] as unknown as string]) await expect(controller.get(location)).rejects.toThrow();
  await expect(controller.get('Honolulu','kelvin')).rejects.toThrow(); expect(get).not.toHaveBeenCalled();
});
