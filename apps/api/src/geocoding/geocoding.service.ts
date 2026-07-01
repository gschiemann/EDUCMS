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
  source: 'google' | 'census' | 'nominatim';
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
 *   2. **US Census Bureau Geocoder** (2026-07-01, mobile bug #216) — free,
 *      keyless, and (per the Census TIGER/Line address-range dataset) has
 *      REAL US house-number coverage — the gap the old two-tier chain left
 *      wide open when GOOGLE_MAPS_API_KEY was unset: Nominatim/OSM's
 *      address-range data is crowd-sourced and has real coverage holes on
 *      specific residential house numbers (documented in ScreenLocationModal
 *      / AddressAutocomplete's comments — "2748 Emory Oak Ct" returned 0
 *      Nominatim matches). This is the PRIMARY keyless US path now; OSM
 *      Nominatim is the final fallback for the (rare) address Census also
 *      misses, and for anything the "onelineaddress" free-text parser
 *      doesn't like the shape of.
 *   3. **OSM Nominatim** (US-pinned, free) — last-resort fallback so the
 *      picker always returns SOMETHING.
 *
 * Google + Nominatim honour an optional region bias (`bias`): Google via
 * `bounds=`, Nominatim via `viewbox=` (both are *bias*, not hard restrict —
 * a strong out-of-box match can still win, but same-named streets near the
 * operator are preferred). The Census "onelineaddress" endpoint has no bias
 * parameter — it always returns its single best TIGER/Line match.
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
          `Google geocode failed for "${q.slice(0, 60)}", falling back to Census/OSM: ${(e as Error).message}`,
        );
      }
    }
    // Keyless primary: Census Bureau TIGER/Line address ranges have real US
    // house-number coverage (mobile bug #216). Try it before Nominatim.
    try {
      const hits = await this.census(q);
      if (hits.length) return hits;
    } catch (e) {
      this.logger.warn(
        `Census geocode failed for "${q.slice(0, 60)}", falling back to OSM: ${(e as Error).message}`,
      );
    }
    return this.nominatim(q, limit, bias);
  }

  /**
   * Reverse geocode (lat/lng → nearest address). Powers "drop a pin on the
   * fleet map → auto-fill the address". Google first (rooftop), Nominatim
   * fallback. Returns null when nothing resolves.
   */
  async reverse(lat: number, lng: number): Promise<GeocodeResult | null> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

    if (this.googleKey) {
      try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${encodeURIComponent(this.googleKey)}`;
        const r = await safeFetch(url, {
          timeoutMs: 5000,
          maxBytes: 256 * 1024,
          accept: 'application/json',
          userAgent: 'VenueOS-Geocoder/1.0',
        });
        if (r.status >= 200 && r.status < 300) {
          const data = JSON.parse(r.body.toString('utf8')) as {
            status: string;
            results?: Array<{ formatted_address?: string }>;
          };
          if (data.status === 'OK' && data.results?.[0]?.formatted_address) {
            return {
              display_name: data.results[0].formatted_address,
              lat: String(lat),
              lon: String(lng),
              source: 'google',
            };
          }
        }
      } catch (e) {
        this.logger.warn(`Google reverse-geocode failed, falling back to OSM: ${(e as Error).message}`);
      }
    }

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
      const r = await safeFetch(url, {
        timeoutMs: 5000,
        maxBytes: 256 * 1024,
        accept: 'application/json',
        userAgent: 'VenueOS-Geocoder/1.0 (+https://venue-os.app)',
      });
      if (r.status >= 200 && r.status < 300) {
        const data = JSON.parse(r.body.toString('utf8')) as { display_name?: string };
        if (data?.display_name) {
          return { display_name: data.display_name, lat: String(lat), lon: String(lng), source: 'nominatim' };
        }
      }
    } catch {
      /* ignore — caller handles null (operator can still type the address) */
    }
    return null;
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

  /**
   * US Census Bureau Geocoder — free, keyless, no rate-limit key required.
   * Docs: https://geocoding.geo.census.gov/geocoder/. Uses the
   * "onelineaddress" search against the current TIGER/Line public
   * address-range benchmark, which has real US house-number coverage
   * (unlike Nominatim's crowd-sourced OSM data, which has documented gaps
   * on specific residential addresses). US-only by design — no bias/viewbox
   * param exists on this endpoint (it always returns its single best match),
   * so `bias` isn't threaded through here; Nominatim (which DOES support
   * viewbox) remains the tie-breaker fallback for ambiguous same-named
   * streets in different states when Census's one match is a mismatch.
   */
  private async census(q: string): Promise<GeocodeResult[]> {
    const url =
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress` +
      `?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
    const r = await safeFetch(url, {
      timeoutMs: 5000,
      maxBytes: 256 * 1024,
      accept: 'application/json',
      userAgent: 'VenueOS-Geocoder/1.0',
    });
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`Census HTTP ${r.status}`);
    }
    const data = JSON.parse(r.body.toString('utf8')) as {
      result?: {
        addressMatches?: Array<{
          matchedAddress?: string;
          coordinates?: { x: number; y: number }; // x=lon, y=lat
        }>;
      };
    };
    const matches = data.result?.addressMatches ?? [];
    return matches
      .filter((m) => m.matchedAddress && m.coordinates)
      .map((m) => ({
        display_name: this.titleCaseCensusAddress(m.matchedAddress as string),
        lat: String(m.coordinates!.y),
        lon: String(m.coordinates!.x),
        source: 'census' as const,
      }));
  }

  /** Census returns SHOUTY addresses in a fixed 4-part comma-separated shape:
   *  "150 CHARDON AVE, CHARDON, OH, 44024" (street, city, state, zip).
   *  Title-case the street + city so it reads naturally in the picker
   *  dropdown next to Google/Nominatim results (already mixed-case), but
   *  leave the state abbreviation UPPERCASE (title-casing "OH" → "Oh" reads
   *  wrong) and the ZIP untouched (it's numeric, title-casing is a no-op
   *  anyway). Falls back to a plain title-case of the whole string if the
   *  input doesn't match the expected 4-part shape (defensive — Census is
   *  documented to always return this shape, but never trust an external
   *  API's format 100%). */
  private titleCaseCensusAddress(raw: string): string {
    const titleCase = (s: string) =>
      s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    const parts = raw.split(',').map((p) => p.trim());
    if (parts.length === 4) {
      const [street, city, state, zip] = parts;
      return `${titleCase(street)}, ${titleCase(city)}, ${state.toUpperCase()}, ${zip}`;
    }
    return titleCase(raw);
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
