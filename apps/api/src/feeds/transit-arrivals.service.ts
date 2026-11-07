import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PublicSourceCache } from './public-source-cache';
interface Stop {
  id: string;
  name: string;
  parent: string;
  platform: string;
  type: number;
}
interface Route {
  id: string;
  name: string;
  directions: string[];
  type: number;
}
export function parseTransitStops(body: string): Record<string, Stop> {
  const json = JSON.parse(body);
  if (!Array.isArray(json.data) || json.links?.next)
    throw new Error('Incomplete stops');
  const result: Record<string, Stop> = Object.create(null);
  for (const row of json.data.slice(0, 20000)) {
    if (typeof row?.id !== 'string' || !row.attributes?.name) continue;
    result[row.id] = {
      id: row.id,
      name: String(row.attributes.name).slice(0, 150),
      parent: String(row.relationships?.parent_station?.data?.id || ''),
      platform: String(row.attributes.platform_code || ''),
      type: Number(row.attributes.location_type),
    };
  }
  if (Object.keys(result).length < 10) throw new Error('No station data');
  return result;
}
export function parseTransitRoutes(body: string): Record<string, Route> {
  const json = JSON.parse(body);
  if (!Array.isArray(json.data) || json.links?.next)
    throw new Error('Incomplete routes');
  return Object.fromEntries(
    json.data
      .slice(0, 1000)
      .map((r: any) => [
        r.id,
        {
          id: r.id,
          name: String(
            r.attributes?.short_name || r.attributes?.long_name || r.id,
          ).slice(0, 100),
          directions: Array.isArray(r.attributes?.direction_names)
            ? r.attributes.direction_names.map(String)
            : [],
          type: Number(r.attributes?.type),
        },
      ]),
  );
}
export function parseTransitFeed(body: string, now = Date.now()) {
  const raw = JSON.parse(body),
    stamp = Number(raw?.header?.timestamp) * 1000;
  if (
    !Number.isFinite(stamp) ||
    stamp < now - 120000 ||
    stamp > now + 60000 ||
    raw.header.incrementality !== 'FULL_DATASET' ||
    !Array.isArray(raw.entity) ||
    raw.entity.length > 10000
  )
    throw new Error('No fresh transit feed');
  return { updatedAt: new Date(stamp).toISOString(), entities: raw.entity };
}
export function selectTransitArrivals(
  feed: ReturnType<typeof parseTransitFeed>,
  stops: Record<string, Stop>,
  routes: Record<string, Route>,
  station: string,
  now = Date.now(),
) {
  const ids = new Set([
      station,
      ...Object.values(stops)
        .filter((s) => s.parent === station)
        .map((s) => s.id),
    ]),
    items: any[] = [],
    seen = new Set<string>();
  for (const entity of feed.entities) {
    if (entity.is_deleted) continue;
    const update = entity.trip_update,
      trip = update?.trip;
    if (
      !trip ||
      trip.revenue === false ||
      trip.schedule_relationship === 'CANCELED' ||
      trip.schedule_relationship === 'DELETED'
    )
      continue;
    const route = routes[trip.route_id];
    for (const stop of (Array.isArray(update.stop_time_update)
      ? update.stop_time_update
      : []
    ).slice(0, 600)) {
      if (
        !ids.has(stop.stop_id) ||
        stop.schedule_relationship === 'SKIPPED' ||
        stop.schedule_relationship === 'NO_DATA'
      )
        continue;
      const prediction = stop.departure || stop.arrival,
        at = Number(prediction?.time) * 1000;
      if (!Number.isFinite(at) || at < now - 30000 || at > now + 3 * 3600000)
        continue;
      if (route?.type === 3 && Number(prediction?.uncertainty) > 301) continue;
      const key = String(trip.trip_id) + '|' + stop.stop_id + '|' + at;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: key,
        route: route?.name || String(trip.route_id || 'Transit'),
        direction: route?.directions[Number(trip.direction_id)] || '',
        platform: stops[stop.stop_id]?.platform || '',
        time: new Date(at).toISOString(),
        status: String(stop.boarding_status || '').slice(0, 100),
        predictionKind:
          route?.type === 3 && prediction?.uncertainty === 300
            ? 'schedule-estimate'
            : 'prediction',
      });
    }
  }
  return items
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
    .slice(0, 30);
}
@Injectable()
export class TransitArrivalsService {
  constructor(private readonly sources: PublicSourceCache) {}
  private metadata() {
    return this.sources.read(
      'mbta-stops',
      'https://api-v3.mbta.com/stops?fields%5Bstop%5D=name,parent_station,location_type,platform_code&page%5Blimit%5D=20000',
      86400,
      parseTransitStops,
      { maxBytes: 10 * 1024 * 1024 },
    );
  }
  async stations() {
    try {
      const data = await this.metadata();
      return {
        source: 'MassDOT / MBTA',
        items: Object.values(data.value)
          .filter((s) => s.type === 1)
          .map(({ id, name }) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    } catch {
      throw new ServiceUnavailableException(
        'MBTA station list temporarily unavailable.',
      );
    }
  }
  async get(station: string) {
    try {
      const metadata = await this.metadata();
      const selected = metadata.value[station];
      if (!selected || selected.type !== 1)
        throw new BadRequestException('Choose a station from the MBTA list.');
      const [feed, routes] = await Promise.all([
        this.sources.read(
          'mbta-trip-updates',
          'https://cdn.mbta.com/realtime/TripUpdates_enhanced.json',
          30,
          parseTransitFeed,
          { maxBytes: 12 * 1024 * 1024, hourlyLimit: 180 },
        ),
        this.sources.read(
          'mbta-routes',
          'https://api-v3.mbta.com/routes?fields%5Broute%5D=short_name,long_name,direction_names,type&page%5Blimit%5D=1000',
          86400,
          parseTransitRoutes,
        ),
      ]);
      if (Date.parse(feed.value.updatedAt) < Date.now() - 120000)
        throw new Error('Old transit source');
      return {
        source: 'MassDOT / MBTA',
        sourceUrl: 'https://www.mbta.com/',
        station: selected.name,
        stationId: station,
        fetchedAt: feed.fetchedAt,
        updatedAt: feed.value.updatedAt,
        items: selectTransitArrivals(
          feed.value,
          metadata.value,
          routes.value,
          station,
        ),
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException(
        'MBTA arrivals temporarily unavailable.',
      );
    }
  }
}
