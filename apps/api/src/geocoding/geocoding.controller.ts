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
@Controller('geocode')
@UseGuards(JwtAuthGuard)
export class GeocodingController {
  constructor(private readonly geocoding: GeocodingService) {}

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async search(@Query('q') q?: string) {
    const results = await this.geocoding.search(q ?? '');
    return { results, provider: this.geocoding.googleEnabled() ? 'google' : 'osm' };
  }
}
