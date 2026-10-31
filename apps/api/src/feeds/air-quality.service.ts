import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PublicSourceCache } from './public-source-cache';
import { ForecastService } from './forecast.service';
const US = new Set(
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP'.split(
    ' ',
  ),
);
const OFFSETS: Record<string, number> = {
  UTC: 0,
  GMT: 0,
  EST: -5,
  EDT: -4,
  CST: -6,
  CDT: -5,
  MST: -7,
  MDT: -6,
  PST: -8,
  PDT: -7,
  AKST: -9,
  AKDT: -8,
  HST: -10,
  AST: -4,
  ADT: -3,
  CHST: 10,
};
export const AQI_BANDS = [
  { max: 50, label: 'Good', color: '#00e400' },
  { max: 100, label: 'Moderate', color: '#ffff00' },
  { max: 150, label: 'Unhealthy for Sensitive Groups', color: '#ff7e00' },
  { max: 200, label: 'Unhealthy', color: '#ff0000' },
  { max: 300, label: 'Very Unhealthy', color: '#8f3f97' },
  { max: 500, label: 'Hazardous', color: '#7e0023' },
];
export interface AirObservation {
  area: string;
  state: string;
  lat: number;
  lon: number;
  pollutant: string;
  aqi: number;
  category: string;
  primary: boolean;
  observedAt: string;
  agency: string;
}
export function airObservationTime(
  date: string,
  time: string,
  zone: string,
): number {
  const d = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(date),
    t = /^(\d{2}):(\d{2})$/.exec(time),
    offset = OFFSETS[zone.toUpperCase()];
  if (!d || !t || offset === undefined) return NaN;
  const month = Number(d[1]),
    day = Number(d[2]),
    hour = Number(t[1]),
    minute = Number(t[2]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  )
    return NaN;
  const local = Date.UTC(2000 + Number(d[3]), month - 1, day, hour, minute);
  const check = new Date(local);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day)
    return NaN;
  return local - offset * 3600000;
}
export function parseAirObservations(
  body: string,
  now = Date.now(),
): AirObservation[] {
  const result: AirObservation[] = [];
  for (const line of body.split(/\r?\n/).slice(0, 30000)) {
    const f = line.split('|');
    if (f.length < 17 || f[5] !== 'O' || !US.has(f[8]) || !f[12].trim())
      continue;
    const at = airObservationTime(f[1], f[2], f[3]),
      aqi = Number(f[12]),
      lat = Number(f[9]),
      lon = Number(f[10]);
    const band = AQI_BANDS.find((b) => aqi <= b.max);
    if (
      !Number.isFinite(at) ||
      at < now - 3 * 3600000 ||
      at > now + 15 * 60000 ||
      !Number.isInteger(aqi) ||
      aqi < 0 ||
      !band ||
      f[13].trim().toLowerCase() !== band.label.toLowerCase() ||
      !Number.isFinite(lat) ||
      Math.abs(lat) > 90 ||
      !Number.isFinite(lon) ||
      Math.abs(lon) > 180
    )
      continue;
    result.push({
      area: f[7].slice(0, 100),
      state: f[8],
      lat,
      lon,
      pollutant: f[11].slice(0, 20),
      aqi,
      category: f[13].trim(),
      primary: f[6] === 'Y',
      observedAt: new Date(at).toISOString(),
      agency: f[16].slice(0, 150),
    });
  }
  if (!result.length) throw new Error('No current hourly observations');
  return result;
}
interface ZipArea {
  city: string;
  state: string;
  lat: number;
  lon: number;
}
export function parseAirZipAreas(body: string): Record<string, ZipArea> {
  const result: Record<string, ZipArea> = {};
  for (const line of body.split(/\r?\n/).slice(0, 100000)) {
    const [city, state, zip, rawLat, rawLon] = line.split('|');
    if (!US.has(state) || !/^\d{5}$/.test(zip)) continue;
    const lat = Number(rawLat),
      lon = Number(rawLon);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    )
      continue;
    result[zip] = { city: city.slice(0, 100), state, lat, lon };
  }
  if (!Object.keys(result).length)
    throw new Error('No reporting-area ZIP mapping');
  return result;
}
export function airDistanceKm(a: number, b: number, c: number, d: number) {
  const rad = Math.PI / 180,
    x =
      Math.sin(((c - a) * rad) / 2) ** 2 +
      Math.cos(a * rad) *
        Math.cos(c * rad) *
        Math.sin(((d - b) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(x)));
}
@Injectable()
export class AirQualityService {
  constructor(
    private readonly sources: PublicSourceCache,
    private readonly forecast: ForecastService,
  ) {}
  async get(location: string) {
    try {
      const feed = await this.sources.read(
        'airnow-hourly',
        'https://files.airnowtech.org/airnow/today/reportingarea.dat',
        600,
        parseAirObservations,
        { maxBytes: 4 * 1024 * 1024 },
      );
      const rows = feed.value.filter(
        (r) =>
          Date.parse(r.observedAt) >= Date.now() - 3 * 3600000 &&
          Date.parse(r.observedAt) <= Date.now() + 15 * 60000,
      );
      let lat: number, lon: number, mapped: ZipArea | undefined;
      if (/^\d{5}$/.test(location)) {
        const mapping = await this.sources.read(
          'airnow-zip-map',
          'https://files.airnowtech.org/airnow/today/cityzipcodes.csv',
          86400,
          parseAirZipAreas,
          { maxBytes: 4 * 1024 * 1024 },
        );
        mapped = mapping.value[location];
      }
      if (mapped) {
        lat = mapped.lat;
        lon = mapped.lon;
      } else {
        [lat, lon] = await this.forecast.coordinates(location);
      }
      const areas = new Map<string, AirObservation[]>();
      for (const row of rows) {
        const key = row.area + '|' + row.state;
        const group = areas.get(key) || [];
        group.push(row);
        areas.set(key, group);
      }
      const options = [...areas.values()]
        .map((group) => ({
          group,
          km: airDistanceKm(lat, lon, group[0].lat, group[0].lon),
        }))
        .sort((a, b) => a.km - b.km);
      const exact = mapped
        ? options.find(
            (x) =>
              x.group[0].area.toLowerCase() === mapped.city.toLowerCase() &&
              x.group[0].state === mapped.state,
          )
        : undefined;
      const selected = exact || options[0];
      if (!selected || selected.km > 100)
        return {
          source: 'EPA AirNow',
          location,
          area: null,
          observation: null,
          reason: 'No current reporting area within 100 km',
          fetchedAt: feed.fetchedAt,
        };
      const latest = Math.max(
        ...selected.group.map((r) => Date.parse(r.observedAt)),
      );
      const current = selected.group.filter(
        (r) => Date.parse(r.observedAt) === latest,
      );
      const primary =
        current.find((r) => r.primary) ||
        [...current].sort((a, b) => b.aqi - a.aqi)[0];
      return {
        source: 'EPA AirNow',
        sourceUrl: 'https://www.airnow.gov/',
        location,
        area: primary.area,
        state: primary.state,
        distanceKm: Math.round(selected.km),
        matchedZip: !!exact,
        preliminary: true,
        fetchedAt: feed.fetchedAt,
        observation: {
          aqi: primary.aqi,
          category: primary.category,
          color: AQI_BANDS.find((b) => primary.aqi <= b.max)!.color,
          observedAt: primary.observedAt,
          agency: primary.agency,
          pollutants: current.map((r) => ({
            name: r.pollutant,
            aqi: r.aqi,
            category: r.category,
          })),
        },
      };
    } catch {
      throw new ServiceUnavailableException(
        'Air quality temporarily unavailable. Choose a U.S. city, ZIP or coordinates.',
      );
    }
  }
}
