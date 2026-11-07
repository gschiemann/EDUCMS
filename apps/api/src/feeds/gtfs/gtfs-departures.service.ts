/**
 * Generic GTFS-realtime departures for agencies that publish open feeds.
 *
 * The board needs two things per agency: the static GTFS (stop and route
 * names, refreshed daily) and the TripUpdates feed (predictions, refreshed
 * every 30 s). Both are fetched by the API from FIXED, reviewed URLs and
 * cached for the whole fleet — operators choose an agency and a stop from
 * lists, never a URL.
 *
 * ADDING AN AGENCY is one entry in `GTFS_AGENCIES`, and only after reading
 * its terms: the feed must be keyless and its licence must allow a
 * third-party app to redistribute and display it. Each entry carries the
 * terms URL it was checked against. Candidates still awaiting a licence
 * read (MTA NYC — "commercial … applications may be charged a license fee";
 * King County, Calgary, Edmonton, Halifax; SEPTA needs written permission)
 * are deliberately not listed.
 */
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PublicSourceCache } from '../public-source-cache';
import { parseCsv, parseTripUpdates, readZipEntries } from './gtfs-formats';

export interface GtfsAgency {
  id: string;
  name: string;
  region: string;
  tripUpdatesUrl: string;
  staticUrl: string;
  termsUrl: string;
  /** Credit shown on the glass. Neither licence requires one; we name the source anyway. */
  credit: string;
  /** Licence terms the board must honour, shown in the credit line. */
  note: string;
}

export const GTFS_AGENCIES: GtfsAgency[] = [
  {
    id: 'bart',
    name: 'BART',
    region: 'San Francisco Bay Area',
    tripUpdatesUrl: 'https://api.bart.gov/gtfsrt/tripupdate.aspx',
    staticUrl: 'https://www.bart.gov/dev/schedules/google_transit.zip',
    // "non-exclusive, limited and revocable rights to use, reproduce, and redistribute BART Data"
    termsUrl:
      'https://www.bart.gov/schedules/developers/developer-license-agreement',
    credit: 'BART open data',
    note: 'Unofficial display · provided as is',
  },
  {
    id: 'rtd-denver',
    name: 'RTD Denver',
    region: 'Denver metro',
    tripUpdatesUrl: 'https://www.rtd-denver.com/files/gtfs-rt/TripUpdate.pb',
    staticUrl: 'https://www.rtd-denver.com/files/gtfs/google_transit.zip',
    // §3: "non-exclusive, limited and revocable rights to use, reproduce, and redistribute the Data"
    termsUrl:
      'https://www.rtd-denver.com/open-records/open-spatial-information/gtfs-realtime-license-agreement',
    credit: 'RTD open data',
    note: 'Unofficial display · provided as is',
  },
];

export interface GtfsStation {
  id: string;
  name: string;
  /** Child stop ids (platforms) whose predictions belong to this station. */
  stops: string[];
}
interface StaticIndex {
  stations: GtfsStation[];
  /** stop id → station id */
  stationOf: Record<string, string>;
  /** stop id → platform label */
  platformOf: Record<string, string>;
  routes: Record<string, string>;
  /** trip id → [route id, index into `headsigns`] — feeds often omit route_id. */
  trips: Record<string, [string, number]>;
  headsigns: string[];
}

export function buildStaticIndex(zip: Buffer): StaticIndex {
  const files = readZipEntries(zip, ['stops.txt', 'routes.txt', 'trips.txt']);
  if (!files['stops.txt'] || !files['routes.txt'])
    throw new Error('GTFS is missing stops or routes');
  const stops = parseCsv(files['stops.txt'].toString('utf8'), 60000);
  const stations = new Map<string, GtfsStation>();
  const stationOf: Record<string, string> = Object.create(null);
  const platformOf: Record<string, string> = Object.create(null);
  // Parents first, so a platform can attach to its station by id.
  for (const s of stops) {
    const type = Number(s.location_type || 0);
    if (!s.stop_id || type > 1) continue; // entrances, nodes, boarding areas
    if (type === 1 || !s.parent_station) {
      stations.set(s.stop_id, {
        id: s.stop_id,
        name: (s.stop_name || s.stop_id).slice(0, 120),
        stops: [],
      });
    }
  }
  for (const s of stops) {
    if (!s.stop_id || Number(s.location_type || 0) !== 0) continue;
    const station =
      s.parent_station && stations.has(s.parent_station)
        ? s.parent_station
        : s.stop_id;
    if (!stations.has(station)) continue;
    stations.get(station)!.stops.push(s.stop_id);
    stationOf[s.stop_id] = station;
    platformOf[s.stop_id] = (s.platform_code || '').slice(0, 20);
  }
  const routes: Record<string, string> = Object.create(null);
  for (const r of parseCsv(files['routes.txt'].toString('utf8'), 5000)) {
    if (r.route_id)
      routes[r.route_id] = (
        r.route_short_name ||
        r.route_long_name ||
        r.route_id
      ).slice(0, 60);
  }
  const trips: Record<string, [string, number]> = Object.create(null);
  const headsigns: string[] = [];
  const headsignAt = new Map<string, number>();
  if (files['trips.txt']) {
    for (const t of parseCsv(files['trips.txt'].toString('utf8'), 150000)) {
      if (!t.trip_id) continue;
      const h = (t.trip_headsign || '').slice(0, 80);
      let i = headsignAt.get(h);
      if (i === undefined) {
        i = headsigns.push(h) - 1;
        headsignAt.set(h, i);
      }
      trips[t.trip_id] = [t.route_id || '', i];
    }
  }
  const list = Array.from(stations.values()).filter((s) => s.stops.length);
  if (list.length < 5) throw new Error('GTFS has too few stops');
  return { stations: list, stationOf, platformOf, routes, trips, headsigns };
}

export interface Departure {
  id: string;
  route: string;
  direction: string;
  platform: string;
  time: string;
  status: string;
  predictionKind: 'prediction';
}

/** Compact per-station prediction index: stationId → departures (next 2 h, ≤ 12). */
export function indexTripUpdates(
  buf: Buffer,
  idx: StaticIndex,
  now = Date.now(),
) {
  const { timestamp, trips } = parseTripUpdates(buf);
  const stamp = timestamp * 1000;
  if (!stamp || stamp < now - 5 * 60_000 || stamp > now + 60_000)
    throw new Error('No fresh realtime feed');
  const byStation: Record<string, Departure[]> = Object.create(null);
  const nameOf = new Map(idx.stations.map((s) => [s.id, s.name]));
  for (const t of trips) {
    if (t.canceled) continue;
    const lastStop = t.stops[t.stops.length - 1];
    const trip = idx.trips[t.tripId];
    const routeId = t.routeId || trip?.[0] || '';
    const headsign = trip ? idx.headsigns[trip[1]] : '';
    const towards =
      headsign ||
      (lastStop ? nameOf.get(idx.stationOf[lastStop.stopId]) || '' : '');
    for (const u of t.stops) {
      if (u.skipped || !u.time) continue;
      const ms = u.time * 1000;
      if (ms < now - 30_000 || ms > now + 2 * 3600_000) continue;
      const station = idx.stationOf[u.stopId];
      if (!station || u === lastStop) continue; // a train arriving at its last stop is not a departure
      (byStation[station] ||= []).push({
        id: `${t.tripId}:${u.stopId}`,
        route: idx.routes[routeId] || routeId || 'Service',
        direction: towards ? `to ${towards}` : '',
        platform: idx.platformOf[u.stopId] || '',
        time: new Date(ms).toISOString(),
        status:
          u.delay && u.delay >= 120
            ? `${Math.round(u.delay / 60)} min late`
            : '',
        predictionKind: 'prediction',
      });
    }
  }
  for (const k of Object.keys(byStation))
    byStation[k] = byStation[k]
      .sort((a, b) => a.time.localeCompare(b.time))
      .slice(0, 12);
  return { updatedAt: new Date(stamp).toISOString(), byStation };
}

const latin1 = (s: string) => Buffer.from(s, 'latin1');

@Injectable()
export class GtfsDeparturesService {
  constructor(private readonly sources: PublicSourceCache) {}

  agencies() {
    return {
      items: GTFS_AGENCIES.map(({ id, name, region, termsUrl }) => ({
        id,
        name,
        region,
        termsUrl,
      })),
    };
  }

  private agency(id: string): GtfsAgency {
    const a = GTFS_AGENCIES.find((x) => x.id === id);
    if (!a) throw new BadRequestException('Choose a transit agency.');
    return a;
  }

  private staticIndex(a: GtfsAgency) {
    return this.sources.read(
      `gtfs-static:${a.id}`,
      a.staticUrl,
      86400,
      (b) => buildStaticIndex(latin1(b)),
      {
        maxBytes: 16 * 1024 * 1024,
        hourlyLimit: 6,
        binary: true,
      },
    );
  }

  async stations(agencyId: string, q = '') {
    const a = this.agency(agencyId);
    try {
      const { value } = await this.staticIndex(a);
      const query = q.trim().toLowerCase().slice(0, 60);
      const items = value.stations
        .filter(
          (s) =>
            !query ||
            s.name.toLowerCase().includes(query) ||
            s.id.toLowerCase() === query,
        )
        .sort((x, y) => x.name.localeCompare(y.name))
        .slice(0, 40)
        .map((s) => ({ id: s.id, name: s.name }));
      return { agency: a.name, items };
    } catch {
      throw new ServiceUnavailableException(
        `${a.name} station list unavailable right now.`,
      );
    }
  }

  async departures(agencyId: string, stationId: string) {
    const a = this.agency(agencyId);
    if (!/^[\w.:-]{1,64}$/.test(stationId || ''))
      throw new BadRequestException('Choose a station.');
    try {
      const idx = (await this.staticIndex(a)).value;
      const station = idx.stations.find((s) => s.id === stationId);
      if (!station)
        throw new BadRequestException(
          'That station is not in this agency’s schedule.',
        );
      const rt = await this.sources.read(
        `gtfs-rt:${a.id}`,
        a.tripUpdatesUrl,
        30,
        (b) => indexTripUpdates(latin1(b), idx),
        {
          maxBytes: 8 * 1024 * 1024,
          hourlyLimit: 240,
          binary: true,
        },
      );
      return {
        agency: a.name,
        source: a.credit,
        sourceUrl: a.termsUrl,
        note: a.note,
        station: station.name,
        stationId: station.id,
        updatedAt: rt.value.updatedAt,
        fetchedAt: rt.fetchedAt,
        items: rt.value.byStation[station.id] || [],
      };
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new ServiceUnavailableException(
        `${a.name} predictions unavailable right now.`,
      );
    }
  }
}
