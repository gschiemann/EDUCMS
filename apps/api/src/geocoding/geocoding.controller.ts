import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GeocodingService } from './geocoding.service';

/**
 * `GET /api/v1/geocode?q=<address>` — authed server-side address lookup.
 *
 * The frontend address pickers call THIS instead of hitting Google directly,
 * so the (potentially paid) Google key stays server-only. Authed + rate-limited
 * because it proxies an external, metered service.
 */
// NOTE: this app has NO global prefix — every controller bakes in `api/v1`
// (see health/screens/etc.). Must be 'api/v1/geocode', NOT 'geocode', or the
// frontend's `${API_URL}/geocode` (API_URL already ends in /api/v1) 404s and
// the picker silently falls back to street-level OSM. (regression 2026-05-31)
@Controller('api/v1/geocode')
@UseGuards(JwtAuthGuard)
export class GeocodingController {
  constructor(private readonly geocoding: GeocodingService) {}

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async search(@Query('q') q?: string, @Query('lat') lat?: string, @Query('lng') lng?: string) {
    // Optional region bias (operator's coarse location) so an ambiguous street
    // name resolves to the one NEAR them, not a same-named street in another state.
    const blat = lat != null ? Number(lat) : NaN;
    const blng = lng != null ? Number(lng) : NaN;
    const bias =
      Number.isFinite(blat) && Number.isFinite(blng) ? { lat: blat, lng: blng } : undefined;
    const results = await this.geocoding.search(q ?? '', { bias });
    return { results, provider: this.geocoding.googleEnabled() ? 'google' : 'osm' };
  }

  /** `GET /api/v1/geocode/reverse?lat=&lng=` — lat/lng → nearest address.
   *  Powers "drop a pin on the fleet map → auto-fill the address". */
  @Get('reverse')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async reverse(@Query('lat') lat?: string, @Query('lng') lng?: string) {
    const la = lat != null ? Number(lat) : NaN;
    const ln = lng != null ? Number(lng) : NaN;
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return { result: null };
    const result = await this.geocoding.reverse(la, ln);
    return { result, provider: this.geocoding.googleEnabled() ? 'google' : 'osm' };
  }
}
