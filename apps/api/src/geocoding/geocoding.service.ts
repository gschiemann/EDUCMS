import { Injectable, Logger } from '@nestjs/common';
import { safeFetch } from '../branding/safe-fetch';

/**
 * Normalised geocode hit. `lat`/`lon` are strings to match the shape the
 * existing client-side pickers (ScreenLocationModal, AddressAutocomplete)
 * already consume from Nominatim, so the frontend mapping is trivial.
 */
export interface GeocodeResult {
  display_name: string;
  lat: string;
  lon: string;
  source: 'google' | 'nominatim';
}

/** Optional region bias so an ambiguous street (e.g. "Emory Oak Ct" exists in
 *  both TX and CA) resolves to the one NEAR the operator, not a far-away
 *  same-named street. */
export interface GeocodeBias {
  lat: number;
  lng: number;
}

/**
 * Server-side address geocoder.
 *
 * Provider order:
 *   1. **Google Geocoding** when `GOOGLE_MAPS_API_KEY` is set — authoritative
 *      US house-number coverage. The key lives ONLY on the server (pickers
 *      proxy through `GET /api/v1/geocode`).
 *   2. **OSM Nominatim** (US-pinned, free) fallback so the picker always
 *      returns something.
 *
 * Both honour an optional region bias (`bias`): Google via `bounds=`, Nominatim
 * via `viewbox=` (both are *bias*, not hard restrict — a strong out-of-box match
 * can still win, but same-named streets near the operator are preferred).
 *
 * All outbound calls go through `safeFetch` (DNS-pinned, timeout, byte-capped).
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  /** ~0.75° ≈ 50 mi box around the bias point — wide enough to cover a metro,
   *  tight enough to disambiguate same-named streets in different states. */
  private static readonly BIAS_DEG = 0.75;

  private get googleKey(): string | undefined {
    const k = process.env.GOOGLE_MAPS_API_KEY;
    return k && k.trim() ? k.trim() : undefined;
  }

  googleEnabled(): boolean {
    return !!this.googleKey;
  }

  async search(
    query: string,
    opts: { limit?: number; bias?: GeocodeBias } = {},
  ): Promise<GeocodeResult[]> {
    const q = (query || '').trim();
    if (q.length < 3) return [];
    const limit = opts.limit ?? 5;
    const bias = this.validBias(opts.bias);

    if (this.googleKey) {
      try {
        const hits = await this.google(q, limit, bias);
        if (hits.length) return hits;
      } catch (e) {
        this.logger.warn(
          `Google geocode failed for "${q.slice(0, 60)}", falling back to OSM: ${(e as Error).message}`,
        );
      }
    }
    return this.nominatim(q, limit, bias);
  }

  private validBias(b?: GeocodeBias): GeocodeBias | undefined {
    if (!b) return undefined;
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return undefined;
    if (Math.abs(b.lat) > 90 || Math.abs(b.lng) > 180) return undefined;
    return b;
  }

  private async google(q: string, limit: number, bias?: GeocodeBias): Promise<GeocodeResult[]> {
    let url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?address=${encodeURIComponent(q)}&components=country:US&key=${encodeURIComponent(this.googleKey!)}`;
    if (bias) {
      const d = GeocodingService.BIAS_DEG;
      // bounds=SWlat,SWlng|NElat,NElng
      url +=
        `&bounds=${(bias.lat - d).toFixed(4)},${(bias.lng - d).toFixed(4)}` +
        `|${(bias.lat + d).toFixed(4)},${(bias.lng + d).toFixed(4)}`;
    }
    const r = await safeFetch(url, {
      timeoutMs: 5000,
      maxBytes: 256 * 1024,
      accept: 'application/json',
      userAgent: 'VenueOS-Geocoder/1.0',
    });
    if (r.status < 200 || r.status >= 300) throw new Error(`Google HTTP ${r.status}`);
    const data = JSON.parse(r.body.toString('utf8')) as {
      status: string;
      error_message?: string;
      results?: Array<{
        formatted_address?: string;
        geometry?: { location?: { lat: number; lng: number } };
      }>;
    };
    if (data.status === 'ZERO_RESULTS') return [];
    if (data.status !== 'OK') {
      throw new Error(`Google status ${data.status}${data.error_message ? ` (${data.error_message})` : ''}`);
    }
    return (data.results || [])
      .filter((x) => x.formatted_address && x.geometry?.location)
      .slice(0, limit)
      .map((x) => ({
        display_name: x.formatted_address as string,
        lat: String(x.geometry!.location!.lat),
        lon: String(x.geometry!.location!.lng),
        source: 'google' as const,
      }));
  }

  private async nominatim(q: string, limit: number, bias?: GeocodeBias): Promise<GeocodeResult[]> {
    let url =
      `https://nominatim.openstreetmap.org/search` +
      `?format=json&addressdetails=0&countrycodes=us&limit=${limit}&q=${encodeURIComponent(q)}`;
    if (bias) {
      const d = GeocodingService.BIAS_DEG;
      // viewbox=lon1,lat1,lon2,lat2 (left,top,right,bottom); bounded=0 = bias not restrict.
      url +=
        `&viewbox=${(bias.lng - d).toFixed(4)},${(bias.lat + d).toFixed(4)},` +
        `${(bias.lng + d).toFixed(4)},${(bias.lat - d).toFixed(4)}&bounded=0`;
    }
    try {
      const r = await safeFetch(url, {
        timeoutMs: 5000,
        maxBytes: 256 * 1024,
        accept: 'application/json',
        userAgent: 'VenueOS-Geocoder/1.0 (+https://venue-os.app)',
      });
      if (r.status < 200 || r.status >= 300) return [];
      const arr = JSON.parse(r.body.toString('utf8')) as Array<{
        display_name: string;
        lat: string;
        lon: string;
      }>;
      return (Array.isArray(arr) ? arr : []).slice(0, limit).map((n) => ({
        display_name: n.display_name,
        lat: n.lat,
        lon: n.lon,
        source: 'nominatim' as const,
      }));
    } catch {
      return [];
    }
  }
}
