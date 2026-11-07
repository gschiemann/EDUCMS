/**
 * Free road conditions for a location: California Highway Patrol incidents
 * (California) plus DOT work zones, closures and detours from every CC0 WZDx
 * feed that covers it (17 feeds, `work-zones.service.ts`). One answer, each
 * row tagged with its own source, so the board can credit every publisher.
 */
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ForecastService } from './forecast.service';
import { RoadIncidentsService } from './road-incidents.service';
import { WorkZonesService } from './work-zones.service';

@Injectable()
export class RoadConditionsService {
  constructor(
    private readonly forecast: ForecastService,
    private readonly chp: RoadIncidentsService,
    private readonly zones: WorkZonesService,
  ) {}

  async get(location: string, radiusKm = 25) {
    const radius = Math.max(5, Math.min(50, Math.round(radiusKm || 25)));
    let lat: number, lon: number;
    try {
      [lat, lon] = await this.forecast.coordinates(location);
    } catch {
      throw new ServiceUnavailableException(
        'Road reports unavailable. Use a U.S. city, ZIP code or coordinates.',
      );
    }
    const inCalifornia =
      lat >= 32.4 && lat <= 42.1 && lon >= -124.6 && lon <= -114;
    const [chp, zones] = await Promise.all([
      inCalifornia
        ? this.chp.get(`${lat},${lon}`).catch(() => null)
        : Promise.resolve(null),
      this.zones.near(lat, lon, radius).catch(() => null),
    ]);
    const sources: {
      name: string;
      url: string;
      licenseUrl?: string;
      fetchedAt: string;
    }[] = [];
    const items: {
      id: string;
      type: string;
      road: string;
      area: string;
      distanceKm: number;
      source: string;
    }[] = [];
    if (chp?.supported) {
      sources.push({
        name: 'California Highway Patrol',
        url: 'https://cad.chp.ca.gov/traffic.aspx',
        fetchedAt: chp.fetchedAt,
      });
      for (const i of chp.items)
        if (i.distanceKm <= radius)
          items.push({
            id: `chp:${i.id}`,
            type: i.type,
            road: i.road,
            area: i.area,
            distanceKm: i.distanceKm,
            source: 'CHP',
          });
    }
    if (zones) {
      for (const s of zones.sources) {
        sources.push({
          name: s.name,
          url: 'https://data.transportation.gov/d/69qe-yiui',
          licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
          fetchedAt: s.fetchedAt,
        });
      }
      for (const z of zones.items)
        items.push({
          id: `wzdx:${z.id}`,
          type: z.type,
          road: z.road,
          area: z.area,
          distanceKm: z.distanceKm,
          source: 'DOT',
        });
    }
    const covered = inCalifornia || !!zones?.covered;
    if (covered && !sources.length)
      throw new ServiceUnavailableException(
        'Road reports unavailable right now.',
      );
    return {
      location,
      radiusKm: radius,
      supported: covered,
      reason: covered
        ? undefined
        : 'No free road-report feed covers this location yet. Free coverage: California incidents, and DOT work zones in 15 states plus Austin and Maricopa County.',
      sources,
      fetchedAt:
        sources.map((s) => s.fetchedAt).sort()[0] || new Date().toISOString(),
      items: items.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 30),
    };
  }
}
