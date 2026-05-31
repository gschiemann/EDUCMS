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

/**
 * Server-side address geocoder.
 *
 * Provider order:
 *   1. **Google Geocoding** when `GOOGLE_MAPS_API_KEY` is set — authoritative
 *      US house-number coverage (finds addresses OSM/Census miss, e.g.
 *      "2748 Emory Oak Court, The Woodlands TX"). The key lives ONLY on the
 *      server and is never shipped to the browser (this is why the pickers
 *      proxy through `GET /api/v1/geocode` instead of calling Google direct).
 *   2. **OSM Nominatim** (US-pinned, free, no key) as the fallback so the
 *      picker still returns *something* when Google is unconfigured, rate-
 *      limited, or returns ZERO_RESULTS.
 *
 * All outbound calls go through `safeFetch` (DNS-pinned, timeout, byte-capped)
 * per the project rule "never call fetch(url) directly in the API".
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  private get googleKey(): string | undefined {
    const k = process.env.GOOGLE_MAPS_API_KEY;
    return k && k.trim() ? k.trim() : undefined;
  }

  /** True when a Google key is configured — surfaced in the endpoint payload + health. */
  googleEnabled(): boolean {
    return !!this.googleKey;
  }

  async search(query: string, limit = 5): Promise<GeocodeResult[]> {
    const q = (query || '').trim();
    if (q.length < 3) return [];

    if (this.googleKey) {
      try {
        const hits = await this.google(q, limit);
        if (hits.length) return hits;
        // Google returned ZERO_RESULTS — fall through to OSM, which sometimes
        // has a street-level match Google's strict matcher rejected.
      } catch (e) {
        this.logger.warn(
          `Google geocode failed for "${q.slice(0, 60)}", falling back to OSM: ${(e as Error).message}`,
        );
      }
    }
    return this.nominatim(q, limit);
  }

  private async google(q: string, limit: number): Promise<GeocodeResult[]> {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?address=${encodeURIComponent(q)}&components=country:US&key=${encodeURIComponent(this.googleKey!)}`;
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
      // REQUEST_DENIED / OVER_QUERY_LIMIT / INVALID_REQUEST etc. — log the
      // Google reason (helps the operator fix their key/billing) then fall back.
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

  private async nominatim(q: string, limit: number): Promise<GeocodeResult[]> {
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?format=json&addressdetails=0&countrycodes=us&limit=${limit}&q=${encodeURIComponent(q)}`;
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
