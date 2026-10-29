import { FeedsRateLimiter } from './feeds-rate-limiter';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { safeFetch } from '../branding/safe-fetch';
import { RedisService } from '../realtime/redis.service';
import { getCachedFeed, setCachedFeed } from './feeds-cache';

export interface ForecastDay { date: string; high: number; low: number | null; condition: string; rain: number | null }
export interface ForecastResult { location: string; days: ForecastDay[]; fetchedAt: string; source: string; geocoded: boolean }

/** NWS forecasts are free for commercial use. Location lookups are cached for 30 days.
 * No browser/API keys, client-supplied upstream URLs or background location permission. */
@Injectable()
export class ForecastService {
  private pending = new Map<string, Promise<ForecastResult>>();
  constructor(private readonly redis: RedisService, private readonly limiter: FeedsRateLimiter = new FeedsRateLimiter()) {}
  private async json(url: string): Promise<any> {
    const r = await safeFetch(url, { maxBytes: 1024 * 1024, timeoutMs: 8000, accept: 'application/geo+json, application/json', userAgent: 'VenueOS/1.0 (https://venue-os.app; forecast widget)' });
    if (r.status < 200 || r.status >= 300) throw new Error('Forecast provider unavailable');
    return JSON.parse(r.body.toString());
  }
  async get(location: string, metric: boolean): Promise<ForecastResult> {
    const key = `${location.trim().toLowerCase()}|${metric ? 'C' : 'F'}`;
    const cached = await getCachedFeed(this.redis.publisher, 'weather', key);
    if (cached) { try { return JSON.parse(cached); } catch { /* refresh a corrupt cache */ } }
    const running = this.pending.get(key); if (running) return running;
    this.limiter.check('forecast:' + key);
    const promise = this.load(location.trim(), metric).then(async result => {
      await setCachedFeed(this.redis.publisher, 'weather', key, JSON.stringify(result), 900); return result;
    }).catch(() => { throw new ServiceUnavailableException('Forecast unavailable. Use a U.S. city, ZIP code or coordinates.'); }).finally(() => this.pending.delete(key));
    this.pending.set(key, promise); return promise;
  }
  private async coordinates(location: string): Promise<[number, number, boolean]> {
    const pair = /^(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(location);
    if (pair) {
      const lat = Number(pair[1]), lon = Number(pair[2]);
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Invalid coordinates');
      return [lat, lon, false];
    }
    const key = location.toLowerCase();
    const cached = await getCachedFeed(this.redis.publisher, 'geocode', key);
    if (cached) { try { const p = JSON.parse(cached); if (Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) return [p[0], p[1], true]; } catch { /* refresh */ } }
    // Nominatim's application-wide 1 request/second ceiling. No distributed fallback
    // when Redis fails: keep cached/coordinate forecasts working, refuse new lookups.
    if (this.redis.publisher) {
      const lease = await this.redis.publisher.set('weather:geocoder:rate', '1', 'PX', 1100, 'NX');
      if (!lease) throw new Error('Location lookup busy');
    } else {
      throw new Error('Location lookup temporarily unavailable');
    }
    const base = process.env.WEATHER_GEOCODER_URL || 'https://nominatim.openstreetmap.org/search';
    const url = new URL(base); url.searchParams.set('format', 'jsonv2'); url.searchParams.set('countrycodes', 'us'); url.searchParams.set('limit', '1'); url.searchParams.set('q', location);
    const data = await this.json(url.href); const lat = Number(data?.[0]?.lat), lon = Number(data?.[0]?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Location not found');
    await setCachedFeed(this.redis.publisher, 'geocode', key, JSON.stringify([lat, lon]), 30 * 86400);
    return [lat, lon, true];
  }
  private async load(location: string, metric: boolean): Promise<ForecastResult> {
    const [lat, lon, geocoded] = await this.coordinates(location);
    const points = await this.json(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
    const target = new URL(points?.properties?.forecast);
    if (target.protocol !== 'https:' || target.hostname !== 'api.weather.gov' || !target.pathname.startsWith('/gridpoints/')) throw new Error('Invalid forecast link');
    target.searchParams.set('units', metric ? 'si' : 'us');
    const result = await this.json(target.href);
    const days = parseForecastPeriods(result?.properties?.periods);
    if (days.length < 2) throw new Error('Incomplete forecast');
    const place = points?.properties?.relativeLocation?.properties;
    return { location: place?.city && place?.state ? `${place.city}, ${place.state}` : location, days, fetchedAt: new Date().toISOString(), source: 'National Weather Service', geocoded };
  }
}

export function parseForecastPeriods(periods: unknown): ForecastDay[] {
  const days = new Map<string, ForecastDay>();
  if (!Array.isArray(periods)) return [];
  for (const p of periods) {
    if (!p || typeof p.startTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(p.startTime) || typeof p.temperature !== 'number' || !Number.isFinite(p.temperature) || typeof p.isDaytime !== 'boolean') continue;
    const date = p.startTime.slice(0, 10);
    const d = days.get(date) || { date, high: NaN, low: null, condition: '', rain: null };
    if (p.isDaytime) { d.high = Math.round(p.temperature); d.condition = String(p.shortForecast || 'Forecast').slice(0, 100); const rain = p.probabilityOfPrecipitation?.value; d.rain = typeof rain === 'number' && rain >= 0 && rain <= 100 ? rain : null; }
    else d.low = Math.round(p.temperature);
    days.set(date, d);
  }
  // A night-only first period is not a fabricated daytime high.
  return [...days.values()].filter(d => Number.isFinite(d.high)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
}
