import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { GeocodeBackfillService } from './geocode-backfill.service';
import { GeocodeBackfillController } from './geocode-backfill.controller';
// GeocodingService is provided directly in AppModule's flat `providers`
// array (not exported from a module of its own — see geocoding.controller.ts
// / app.module.ts), and AppModule is not @Global(). Nest DI doesn't share
// non-exported providers across modules, so — same pattern LicenseModule
// uses for SupabaseStorageService (license.module.ts) — re-provide it here
// too. GeocodingService has no constructor deps (only calls safeFetch), so
// this creates a second harmless instance, not a second source of truth.
import { GeocodingService } from '../geocoding/geocoding.service';
import { GeocodeAutoHealCron } from './geocode-autoheal.cron';

/**
 * Task #60 — legacy Tenant geocode back-fill. Self-contained module:
 * owns its own controller + service, imports only what it needs.
 *
 * Not @Global() — nothing outside this module needs GeocodeBackfillService.
 *
 * 2026-08-31: GeocodeAutoHealCron runs the same service hourly when
 * address-without-coordinates tenants exist, so a typed-in location address
 * reaches the fleet map without a SUPER_ADMIN invoking the manual endpoint.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [GeocodeBackfillController],
  providers: [GeocodeBackfillService, GeocodingService, GeocodeAutoHealCron],
})
export class GeocodeBackfillModule {}
