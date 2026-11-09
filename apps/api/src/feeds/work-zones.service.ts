/**
 * Free road work and closure reports from state and city DOTs, through the
 * USDOT Work Zone Data Exchange (WZDx).
 *
 * WHERE THE LIST COMES FROM. The USDOT WZDx Feed Registry
 * (https://data.transportation.gov/d/69qe-yiui, "Public Domain U.S.
 * Government") lists every published feed. A feed is here only if (a) it
 * needs no API key and embeds no token in its URL, and (b) its own
 * `feed_info.license` declares CC0 1.0
 * (https://creativecommons.org/publicdomain/zero/1.0/) — checked 2026-11-01
 * AND re-checked on every fetch: a feed whose licence field stops saying CC0
 * is refused, never shown. Feeds that answered without a licence (Iowa,
 * Idaho, New England) and feeds that need a key are not listed.
 *
 * WHAT IT IS AND IS NOT. Planned and active work zones, lane closures and
 * detours as the DOT publishes them — not crashes, not travel times, not a
 * statement that a road is clear. The widget says so.
 */
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PublicSourceCache } from './public-source-cache';
import { ForecastService } from './forecast.service';
import { airDistanceKm } from './air-quality.service';

export interface WorkZoneFeed {
  id: string;
  publisher: string;
  region: string;
  url: string;
  /** minLon, minLat, maxLon, maxLat — the area the feed covers. */
  bbox: [number, number, number, number];
}

export const WORK_ZONE_FEEDS: WorkZoneFeed[] = [
  {
    id: 'utah',
    publisher: 'Utah DOT',
    region: 'Utah',
    url: 'https://udottraffic.utah.gov/wzdx/udot/v40/data',
    bbox: [-114.1, 36.9, -108.9, 42.1],
  },
  {
    id: 'minnesota',
    publisher: 'Minnesota DOT',
    region: 'Minnesota',
    url: 'https://mn.carsprogram.org/carsapi_v1/api/wzdx',
    bbox: [-97.3, 43.4, -89.4, 49.4],
  },
  {
    id: 'maryland',
    publisher: 'Maryland DOT SHA',
    region: 'Maryland',
    url: 'https://filter.ritis.org/wzdx_v4.1/mdot.geojson',
    bbox: [-79.5, 37.9, -75.0, 39.8],
  },
  {
    id: 'missouri',
    publisher: 'Missouri DOT',
    region: 'Missouri',
    url: 'https://traveler.modot.org/timconfig/feed/desktop/mo_wzdx.json',
    bbox: [-95.8, 35.9, -89.1, 40.7],
  },
  {
    id: 'wisconsin',
    publisher: 'Wisconsin DOT',
    region: 'Wisconsin',
    url: 'https://511wi.gov/api/wzdx',
    bbox: [-92.9, 42.4, -86.7, 47.1],
  },
  {
    id: 'maricopa',
    publisher: 'Maricopa County DOT',
    region: 'Maricopa County, Arizona',
    url: 'https://wzdxapi.aztech.org/construction',
    bbox: [-113.4, 32.4, -111.0, 34.1],
  },
  {
    id: 'hawaii',
    publisher: 'Hawaii DOT',
    region: 'Hawaii',
    url: 'https://ai.blyncsy.io/wzdx/hidot/feed',
    bbox: [-160.3, 18.9, -154.7, 22.3],
  },
  {
    id: 'washington',
    publisher: 'Washington State DOT',
    region: 'Washington',
    url: 'https://wzdx.wsdot.wa.gov/api/v4/WorkZoneFeed',
    bbox: [-124.8, 45.5, -116.9, 49.0],
  },
  {
    id: 'newjersey',
    publisher: 'NJIT / NJDOT',
    region: 'New Jersey',
    url: 'https://smartworkzones.njit.edu/nj/wzdx',
    bbox: [-75.6, 38.9, -73.9, 41.4],
  },
  {
    id: 'kentucky',
    publisher: 'Kentucky Transportation Cabinet',
    region: 'Kentucky',
    url: 'https://storage.googleapis.com/kytc-its-2020-openrecords/public/feeds/WZDx/kytc_wzdx_v4.1.geojson',
    bbox: [-89.6, 36.5, -81.9, 39.2],
  },
  {
    id: 'kansas',
    publisher: 'Kansas DOT',
    region: 'Kansas',
    url: 'https://ks.carsprogram.org/carsapi_v1/api/wzdx',
    bbox: [-102.1, 36.9, -94.5, 40.1],
  },
  {
    id: 'austin',
    publisher: 'City of Austin',
    region: 'Austin, Texas',
    url: 'https://data.austintexas.gov/download/d9mm-cjw9',
    bbox: [-98.2, 29.9, -97.3, 30.7],
  },
  {
    id: 'delaware',
    publisher: 'Delaware DOT',
    region: 'Delaware',
    url: 'https://wzdx.e-dot.com/del_dot_feed_wzdx_v4.1.geojson',
    bbox: [-75.8, 38.4, -75.0, 39.9],
  },
  {
    id: 'louisiana',
    publisher: 'Louisiana DOTD',
    region: 'Louisiana',
    url: 'https://wzdx.e-dot.com/la_dot_d_feed_wzdx_v4.1.geojson',
    bbox: [-94.1, 28.9, -88.8, 33.1],
  },
  {
    id: 'indiana',
    publisher: 'Indiana DOT',
    region: 'Indiana',
    url: 'https://in.carsprogram.org/carsapi_v1/api/wzdx',
    bbox: [-88.2, 37.7, -84.7, 41.8],
  },
  {
    id: 'mississippi',
    publisher: 'Mississippi DOT',
    region: 'Mississippi',
    url: 'https://api.mdottraffic.com/prod/v3/data/wzdx',
    bbox: [-91.7, 30.1, -88.1, 35.0],
  },
  {
    id: 'northdakota',
    publisher: 'North Dakota DOT',
    region: 'North Dakota',
    url: 'https://travelfiles.dot.nd.gov/geojson_nc/wzdx_geojson.json',
    bbox: [-104.1, 45.9, -96.5, 49.0],
  },
];

const CC0 = /^https?:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/?$/i;

export interface WorkZoneItem {
  id: string;
  type: string;
  road: string;
  area: string;
  impact: string;
  lat: number;
  lon: number;
  start: string;
  end: string;
}

const IMPACT: Record<string, string> = {
  'all-lanes-closed': 'Road closed',
  'some-lanes-closed': 'Lanes closed',
  'some-lanes-closed-merge-left': 'Lanes closed',
  'some-lanes-closed-merge-right': 'Lanes closed',
  'all-lanes-open-shift-left': 'Lanes shifted',
  'all-lanes-open-shift-right': 'Lanes shifted',
  'some-lanes-closed-split': 'Lanes closed',
  flagging: 'Flagging',
  'temporary-traffic-signal': 'Temporary signal',
  'alternating-one-way': 'One lane, alternating',
  'all-lanes-open': '',
  unknown: '',
};
const txt = (v: unknown, max: number) =>
  typeof v === 'string' && !/^(unknown|not known|n\/a|none|null)$/i.test(v.trim()) ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

function firstPoint(c: unknown): [number, number] | null {
  let cur: unknown = c;
  for (let i = 0; i < 4 && Array.isArray(cur) && Array.isArray(cur[0]); i++)
    cur = cur[0];
  if (!Array.isArray(cur)) return null;
  const lon = Number(cur[0]);
  const lat = Number(cur[1]);
  return Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
    ? [lat, lon]
    : null;
}

/** WZDx v4.x FeatureCollection → compact items. Throws unless the feed declares CC0. */
export function parseWorkZones(body: string): {
  publisher: string;
  items: WorkZoneItem[];
} {
  const json = JSON.parse(body.replace(/^﻿/, ''));
  const info = json?.feed_info ?? json?.road_event_feed_info;
  if (!info || !CC0.test(String(info.license || '').trim()))
    throw new Error('Feed licence is not CC0');
  if (json.type !== 'FeatureCollection' || !Array.isArray(json.features))
    throw new Error('Not a WZDx feed');
  const items: WorkZoneItem[] = [];
  for (const f of json.features) {
    const p = f?.properties;
    const core = p?.core_details;
    if (!core) continue;
    const pt = firstPoint(f?.geometry?.coordinates);
    if (!pt) continue;
    const roads = Array.isArray(core.road_names)
      ? core.road_names.map((r: unknown) => txt(r, 40)).filter(Boolean)
      : [];
    const kind = core.event_type === 'detour' ? 'Detour' : 'Road work';
    const impact = IMPACT[String(p.vehicle_impact || 'unknown')] ?? '';
    const cross = [
      txt(p.beginning_cross_street, 50),
      txt(p.ending_cross_street, 50),
    ]
      .filter(Boolean)
      .join(' to ');
    items.push({
      id: txt(f.id ?? p.road_event_id ?? core.name, 80) || `${pt[0]},${pt[1]}`,
      type: impact && impact !== 'Lanes shifted' ? `${kind} · ${impact}` : kind,
      road: roads.slice(0, 2).join(' / ') || txt(core.name, 60) || 'Road',
      // Description text is the DOT's own public notice; clipped, never rewritten.
      area: [
        txt(core.direction, 20).replace(/bound$/i, 'bound'),
        cross || txt(core.description, 120),
      ]
        .filter(Boolean)
        .join(' · '),
      impact: String(p.vehicle_impact || 'unknown'),
      lat: pt[0],
      lon: pt[1],
      start: txt(p.start_date, 30),
      end: txt(p.end_date, 30),
    });
    if (items.length >= 6000) break;
  }
  return { publisher: txt(info.publisher, 80), items };
}

/** Active now: started (or starts within 12 h) and not ended. Unknown dates count as active. */
export function isActiveWorkZone(z: WorkZoneItem, now = Date.now()): boolean {
  const s = Date.parse(z.start);
  const e = Date.parse(z.end);
  if (Number.isFinite(s) && s > now + 12 * 3600_000) return false;
  if (Number.isFinite(e) && e < now) return false;
  return true;
}

export function feedsCovering(lat: number, lon: number): WorkZoneFeed[] {
  return WORK_ZONE_FEEDS.filter(
    (f) =>
      lon >= f.bbox[0] &&
      lat >= f.bbox[1] &&
      lon <= f.bbox[2] &&
      lat <= f.bbox[3],
  );
}

@Injectable()
export class WorkZonesService {
  constructor(
    private readonly sources: PublicSourceCache,
    private readonly forecast: ForecastService,
  ) {}

  /** Zones within `radiusKm` of a U.S. location, from every covering feed. */
  async near(lat: number, lon: number, radiusKm: number) {
    const feeds = feedsCovering(lat, lon).slice(0, 3);
    const results = await Promise.all(
      feeds.map((f) =>
        this.sources
          .read(`wzdx:${f.id}`, f.url, 600, parseWorkZones, {
            maxBytes: 8 * 1024 * 1024,
            hourlyLimit: 30,
            provider: 'wzdx',
          })
          .then((r) => ({ feed: f, ...r }))
          .catch(() => null),
      ),
    );
    const now = Date.now();
    const ok = results.filter((r): r is NonNullable<typeof r> => r !== null);
    const items = ok
      .flatMap((r) =>
        r.value.items
          .filter((z) => isActiveWorkZone(z, now))
          .map((z) => ({
            ...z,
            distanceKm: Math.round(airDistanceKm(lat, lon, z.lat, z.lon)),
          })),
      )
      .filter((z) => z.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 30);
    return {
      covered: feeds.length > 0,
      sources: ok.map((r) => ({
        name: r.feed.publisher,
        region: r.feed.region,
        fetchedAt: r.fetchedAt,
      })),
      failed: feeds.length - ok.length,
      items,
    };
  }

  async get(location: string, radiusKm = 25) {
    try {
      const [lat, lon] = await this.forecast.coordinates(location);
      return {
        location,
        ...(await this.near(lat, lon, Math.max(5, Math.min(50, radiusKm)))),
      };
    } catch {
      throw new ServiceUnavailableException(
        'Road work reports unavailable. Use a U.S. city, ZIP code or coordinates.',
      );
    }
  }
}
