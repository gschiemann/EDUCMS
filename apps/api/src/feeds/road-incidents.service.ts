import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { PublicSourceCache } from './public-source-cache';
import { ForecastService } from './forecast.service';
import { airDistanceKm } from './air-quality.service';
const array = (v: any): any[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: any) =>
  String(v ?? '')
    .replace(/^"|"$/g, '')
    .trim()
    .slice(0, 180);
export function parseRoadIncidents(body: string) {
  const state = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    processEntities: false,
  }).parse(body)?.State;
  if (!state?.Center) throw new Error('Invalid CHP feed');
  const items: {
    id: string;
    type: string;
    road: string;
    area: string;
    lat: number;
    lon: number;
  }[] = [];
  for (const center of array(state.Center))
    for (const dispatch of array(center.Dispatch))
      for (const log of array(dispatch.Log)) {
        const coords = /^(\d{7,9}):(\d{8,9})$/.exec(text(log.LATLON));
        if (!coords) continue;
        const lat = Number(coords[1]) / 1e6,
          lon = -Number(coords[2]) / 1e6;
        if (lat < 32 || lat > 42.1 || lon < -124.6 || lon > -114) continue;
        const rawType = text(log.LogType);
        // Display travel information only. Never publish dispatcher narratives,
        // plate numbers, names, medical details or a person's home address.
        const type = /sigalert/i.test(rawType)
          ? 'Traffic alert'
          : /collision/i.test(rawType)
            ? 'Collision'
            : /hazard/i.test(rawType)
              ? 'Road hazard'
              : /closure|closed/i.test(rawType)
                ? 'Road closure'
                : /construction/i.test(rawType)
                  ? 'Road work'
                  : /disabled|traffic break/i.test(rawType)
                    ? 'Traffic disruption'
                    : '';
        if (!type) continue;
        items.push({
          id: text(log.ID),
          type,
          road: text(log.Location)
            .replace(/^\d+\s+(?=[A-Za-z])/, '')
            .slice(0, 140),
          area: text(log.Area),
          lat,
          lon,
        });
      }
  return items.slice(0, 3000);
}
@Injectable()
export class RoadIncidentsService {
  constructor(
    private readonly sources: PublicSourceCache,
    private readonly forecast: ForecastService,
  ) {}
  async get(location: string) {
    try {
      const [lat, lon] = await this.forecast.coordinates(location);
      const base = {
        source: 'California Highway Patrol',
        sourceUrl: 'https://cad.chp.ca.gov/traffic.aspx',
        region: 'California',
        location,
      };
      if (lat < 32.4 || lat > 42.1 || lon < -124.6 || lon > -114)
        return {
          ...base,
          supported: false,
          reason: 'This free source covers California only.',
          items: [],
          fetchedAt: new Date().toISOString(),
        };
      const feed = await this.sources.read(
        'chp-incidents',
        'https://media.chp.ca.gov/sa_xml/sa.xml',
        60,
        parseRoadIncidents,
        {
          maxBytes: 4 * 1024 * 1024,
          hourlyLimit: 120,
          maxSourceAgeMs: 5 * 60000,
        },
      );
      return {
        ...base,
        supported: true,
        fetchedAt: feed.fetchedAt,
        items: feed.value
          .map((r) => ({
            ...r,
            distanceKm: Math.round(airDistanceKm(lat, lon, r.lat, r.lon)),
          }))
          .filter((r) => r.distanceKm <= 50)
          .sort((a, b) => a.distanceKm - b.distanceKm)
          .slice(0, 30),
      };
    } catch {
      throw new ServiceUnavailableException(
        'Current CHP road reports unavailable.',
      );
    }
  }
}
