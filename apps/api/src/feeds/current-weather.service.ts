import {
  Injectable,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { safeFetch } from '../branding/safe-fetch';
import { RedisService } from '../realtime/redis.service';
import { ForecastService } from './forecast.service';
import { FeedsRateLimiter } from './feeds-rate-limiter';
import { getCachedFeed, setCachedFeed } from './feeds-cache';
interface ModelWeather {
  temp: number;
  high: number | null;
  low: number | null;
  humidity: number | null;
  wind: number | null;
  weatherCode: number;
  locationName: string;
  forecastAt: string;
  updatedAt: string;
  fetchedAt: string;
  source: 'MET Norway';
  geocoded: boolean;
}
interface CachedWeather {
  value: ModelWeather;
  expiresAt: number;
  lastModified?: string;
  raw?: any;
}
export function metConditionCode(symbol: string): number {
  if (/thunder/.test(symbol)) return 95;
  if (/snow/.test(symbol)) return 73;
  if (/sleet/.test(symbol)) return 68;
  if (/showers/.test(symbol)) return 80;
  if (/rain/.test(symbol)) return 63;
  if (/fog/.test(symbol)) return 45;
  if (/^clearsky/.test(symbol)) return 0;
  if (/^fair/.test(symbol)) return 1;
  if (/^partlycloudy/.test(symbol)) return 2;
  if (/^cloudy/.test(symbol)) return 3;
  return -1;
}
export function parseCurrentModel(
  raw: any,
  location: string,
  geocoded: boolean,
  now = Date.now(),
): ModelWeather {
  const updatedAt = String(raw?.properties?.meta?.updated_at || '');
  const updated = Date.parse(updatedAt);
  if (
    !Number.isFinite(updated) ||
    updated > now + 3600000 ||
    updated < now - 24 * 3600000
  )
    throw new Error('Outdated weather model');
  const rows = (
    Array.isArray(raw?.properties?.timeseries) ? raw.properties.timeseries : []
  )
    .filter(
      (r: any) =>
        Number.isFinite(Date.parse(r?.time)) &&
        Date.parse(r.time) >= now - 3600000,
    )
    .sort((a: any, b: any) => Date.parse(a.time) - Date.parse(b.time));
  const first = rows[0];
  if (!first || Date.parse(first.time) > now + 2 * 3600000)
    throw new Error('No current-hour forecast');
  const details = first.data?.instant?.details;
  const temp = details?.air_temperature;
  if (typeof temp !== 'number' || !Number.isFinite(temp))
    throw new Error('No forecast temperature');
  const temperatures = rows
    .filter(
      (r: any) => Date.parse(r.time) < Date.parse(first.time) + 24 * 3600000,
    )
    .map((r: any) => r.data?.instant?.details?.air_temperature)
    .filter(
      (v: any): v is number => typeof v === 'number' && Number.isFinite(v),
    );
  const number = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const humidity = number(details.relative_humidity),
    speed = number(details.wind_speed);
  const symbol = String(
    first.data?.next_1_hours?.summary?.symbol_code ||
      first.data?.next_6_hours?.summary?.symbol_code ||
      '',
  );
  return {
    temp,
    high: temperatures.length >= 20 ? Math.max(...temperatures) : null,
    low: temperatures.length >= 20 ? Math.min(...temperatures) : null,
    humidity,
    wind: speed == null ? null : Math.round(speed * 2.236936),
    weatherCode: metConditionCode(symbol),
    locationName: location,
    forecastAt: first.time,
    updatedAt,
    fetchedAt: new Date(now).toISOString(),
    source: 'MET Norway',
    geocoded,
  };
}
@Injectable()
export class CurrentWeatherService {
  private readonly logger = new Logger(CurrentWeatherService.name);
  private pending = new Map<string, Promise<ModelWeather>>();
  constructor(
    private readonly redis: RedisService,
    private readonly forecast: ForecastService,
    private readonly limiter: FeedsRateLimiter,
  ) {}
  private async model(location: string): Promise<ModelWeather> {
    const key = 'met-current-v1:' + location.toLowerCase();
    const saved = await getCachedFeed(this.redis.publisher, 'weather', key);
    let prior: CachedWeather | undefined;
    try {
      prior = saved ? JSON.parse(saved) : undefined;
    } catch {
      /* refresh corrupt cache */
    }
    if (
      prior &&
      prior.expiresAt > Date.now() &&
      Date.parse(prior.value.updatedAt) >= Date.now() - 24 * 3600000
    )
      return prior.raw
        ? {
            ...parseCurrentModel(prior.raw, location, prior.value.geocoded),
            fetchedAt: prior.value.fetchedAt,
          }
        : prior.value;
    const running = this.pending.get(key);
    if (running) return running;
    if (this.pending.size >= 20) throw new Error('Weather source busy');
    const request = (async () => {
      const [lat, lon, geocoded] = await this.forecast.coordinates(
        location,
        /^\d{5}$/.test(location),
      );
      // A dataset shared by all displays; never expose the provider to browser bursts.
      this.limiter.check(`met:${lat.toFixed(4)},${lon.toFixed(4)}`);
      await this.pace();
      const url = new URL(
        'https://api.met.no/weatherapi/locationforecast/2.0/compact',
      );
      url.searchParams.set('lat', lat.toFixed(4));
      url.searchParams.set('lon', lon.toFixed(4));
      const response = await safeFetch(url.href, {
        timeoutMs: 10000,
        maxBytes: 512 * 1024,
        accept: 'application/json',
        userAgent: 'VenueOS/1.0 (https://venue-os.app)',
        ...(prior?.lastModified
          ? { headers: { 'If-Modified-Since': prior.lastModified } }
          : {}),
      });
      if (response.status === 203)
        this.logger.warn(
          'MET weather API reports deprecation; review the upstream API version.',
        );
      const expires = Date.parse(String(response.headers?.expires || ''));
      // Honor upstream expiry even if it exceeds the normal local refresh cadence.
      const expiresAt =
        Number.isFinite(expires) && expires > Date.now()
          ? expires
          : Date.now() + 30 * 60000;
      let value: ModelWeather;
      let raw = prior?.raw;
      if (response.status === 304 && prior)
        value = raw
          ? parseCurrentModel(raw, location, geocoded)
          : { ...prior.value, fetchedAt: new Date().toISOString() };
      else if (response.status === 200 || response.status === 203) {
        raw = JSON.parse(response.body.toString('utf8'));
        value = parseCurrentModel(raw, location, geocoded);
      } else throw new Error('Weather source unavailable');
      const lastModified =
        String(
          response.headers?.['last-modified'] || prior?.lastModified || '',
        ) || undefined;
      await setCachedFeed(
        this.redis.publisher,
        'weather',
        key,
        JSON.stringify({ value, expiresAt, lastModified, raw }),
        Math.max(86400, Math.ceil((expiresAt - Date.now()) / 1000)),
      );
      return value;
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
  private async pace() {
    const publisher = this.redis.publisher;
    if (!publisher) throw new Error('Weather pacing unavailable');
    // At most ten origin requests/second across replicas, under MET's
    // application-wide limit. No browser talks to the provider directly.
    for (let i = 0; i < 20; i++) {
      if (await publisher.set('feeds:met:pace', '1', 'PX', 100, 'NX')) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Weather source busy');
  }
  async get(location: string, metric: boolean) {
    let value: ModelWeather;
    try {
      value = await this.model(location.trim());
    } catch {
      throw new ServiceUnavailableException(
        'Weather forecast temporarily unavailable. Set a city, ZIP code or coordinates.',
      );
    }
    const unit = (n: number | null) =>
      n == null ? null : Math.round(metric ? n : (n * 9) / 5 + 32);
    return {
      ...value,
      temp: unit(value.temp),
      high: unit(value.high),
      low: unit(value.low),
      feelsLike: null,
      kind: 'forecast',
      highLowWindow: 'next 24 hours',
      units: metric ? 'metric' : 'imperial',
    };
  }
}
