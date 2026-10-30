import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PublicSourceCache } from './public-source-cache';
import { ForecastService } from './forecast.service';
import { airDistanceKm } from './air-quality.service';
interface Meter {
  id: string;
  block: string;
  lat: number;
  lon: number;
}
interface Occupancy {
  state: 'VACANT' | 'OCCUPIED' | 'UNKNOWN';
  at: string;
}
export function parseParkingInventory(body: string): Meter[] {
  const data = JSON.parse(body);
  if (!Array.isArray(data) || !data.length || data.length >= 50000)
    throw new Error('Incomplete parking inventory');
  const result: Meter[] = [];
  for (const row of data) {
    const lat = Number(row.latlng?.latitude),
      lon = Number(row.latlng?.longitude);
    if (
      typeof row.spaceid !== 'string' ||
      !row.blockface ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < 33 ||
      lat > 35 ||
      lon < -120 ||
      lon > -117
    )
      continue;
    result.push({
      id: row.spaceid.slice(0, 80),
      block: String(row.blockface).slice(0, 150),
      lat,
      lon,
    });
  }
  if (!result.length) throw new Error('No meter locations');
  return result;
}
export function parseParkingOccupancy(
  body: string,
  now = Date.now(),
): Record<string, Occupancy> {
  const rows = JSON.parse(body);
  if (!Array.isArray(rows) || !rows.length || rows.length >= 50000)
    throw new Error('Incomplete parking reports');
  const data: Record<string, Occupancy> = Object.create(null);
  let newest = 0;
  for (const row of rows) {
    if (typeof row.spaceid !== 'string' || typeof row.eventtime !== 'string')
      continue;
    // The LADOT column metadata explicitly defines this floating timestamp as UTC.
    const at = Date.parse(row.eventtime + 'Z');
    if (!Number.isFinite(at) || at > now + 5 * 60000) continue;
    const state = ['VACANT', 'OCCUPIED'].includes(row.occupancystate)
      ? row.occupancystate
      : 'UNKNOWN';
    const old = data[row.spaceid];
    if (old && Date.parse(old.at) >= at) continue;
    data[row.spaceid] = { state, at: new Date(at).toISOString() };
    newest = Math.max(newest, at);
  }
  if (newest < now - 15 * 60000) throw new Error('No recent parking updates');
  return data;
}
export function groupParkingReports(
  meters: Meter[],
  states: Record<string, Occupancy>,
  lat: number,
  lon: number,
  now = Date.now(),
) {
  const groups = new Map<
    string,
    {
      name: string;
      vacant: number;
      occupied: number;
      unknown: number;
      distanceKm: number;
      updatedAt: string | null;
    }
  >();
  for (const meter of meters) {
    const km = airDistanceKm(lat, lon, meter.lat, meter.lon);
    if (km > 1.5) continue;
    const row = groups.get(meter.block) || {
      name: meter.block,
      vacant: 0,
      occupied: 0,
      unknown: 0,
      distanceKm: km,
      updatedAt: null,
    };
    const state = states[meter.id],
      recent = state && Date.parse(state.at) >= now - 30 * 60000;
    if (recent && state.state === 'VACANT') row.vacant++;
    else if (recent && state.state === 'OCCUPIED') row.occupied++;
    else row.unknown++;
    row.distanceKm = Math.min(row.distanceKm, km);
    if (
      recent &&
      (!row.updatedAt || Date.parse(state.at) > Date.parse(row.updatedAt))
    )
      row.updatedAt = state.at;
    groups.set(meter.block, row);
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        Number(b.vacant + b.occupied > 0) - Number(a.vacant + a.occupied > 0) ||
        a.distanceKm - b.distanceKm,
    )
    .slice(0, 16)
    .map((r) => ({ ...r, distanceKm: Math.round(r.distanceKm * 10) / 10 }));
}
@Injectable()
export class ParkingReportsService {
  constructor(
    private readonly sources: PublicSourceCache,
    private readonly forecast: ForecastService,
  ) {}
  async get(location: string) {
    try {
      const [lat, lon] = await this.forecast.coordinates(location);
      const base = {
        source: 'LADOT / LA ExpressPark',
        sourceUrl: 'https://data.lacity.org/d/e7h6-4a3e',
        region: 'Los Angeles street meters',
        location,
      };
      if (lat < 33.6 || lat > 34.5 || lon < -118.9 || lon > -118)
        return {
          ...base,
          supported: false,
          reason: 'This free source covers Los Angeles street meters only.',
          items: [],
          fetchedAt: new Date().toISOString(),
        };
      const [inventory, reports] = await Promise.all([
        this.sources.read(
          'ladot-meter-inventory',
          'https://data.lacity.org/resource/s49e-q6j2.json?$select=spaceid,blockface,latlng&$limit=50000',
          86400,
          parseParkingInventory,
          { maxBytes: 10 * 1024 * 1024 },
        ),
        this.sources.read(
          'ladot-occupancy',
          'https://data.lacity.org/resource/e7h6-4a3e.json?$limit=50000',
          60,
          parseParkingOccupancy,
          { maxBytes: 8 * 1024 * 1024, hourlyLimit: 120 },
        ),
      ]);
      return {
        ...base,
        supported: true,
        fetchedAt: reports.fetchedAt,
        items: groupParkingReports(inventory.value, reports.value, lat, lon),
      };
    } catch {
      throw new ServiceUnavailableException(
        'Parking reports temporarily unavailable.',
      );
    }
  }
}
