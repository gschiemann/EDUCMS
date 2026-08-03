import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ScreensController } from './screens/screens.controller';
import { DevicesController } from './devices/devices.controller';
import { PanicContentController } from './panic-content/panic-content.controller';
import { EmergencyController } from './emergency/emergency.controller';
import { ScreenEmergencyController } from './emergency/screen-emergency.controller';
import { StatsController } from './stats/stats.controller';
import { AuditController } from './audit/audit.controller';
import { UsersController } from './users/users.controller';
import { PlaylistsController } from './playlists/playlists.controller';
import { PlaylistDistributionService } from './playlists/playlist-distribution.service';
import { ScreenGroupsController } from './screen-groups/screen-groups.controller';
import { SchedulesController } from './schedules/schedules.controller';
import { AssetsController } from './assets/assets.controller';
import { AssetFilesController } from './assets/asset-files.controller';
import { TemplatesController } from './templates/templates.controller';
import { TenantsController } from './tenants/tenants.controller';
import { ProxyController } from './proxy/proxy.controller';
import { RendererService } from './proxy/renderer.service';
import { HealthController } from './health/health.controller';
import { IntegrationsHealthController } from './health/integrations-health.controller';
import { GeocodingController } from './geocoding/geocoding.controller';
import { GeocodingService } from './geocoding/geocoding.service';
import { FloorPlansController } from './floor-plans/floor-plans.controller';
// 2026-05-27 — read-only player-hardware catalog endpoint
// (GET /api/v1/hardware/catalog). Backs the dashboard's per-screen
// Hardware panel; source of truth is packages/api-types/src/hardware-models.ts.
import { HardwareController } from './hardware/hardware.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { RealtimeModule } from './realtime/realtime.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';
import { SsoModule } from './sso/sso.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { EmailModule } from './email/email.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { LicenseModule } from './license/license.module';
// Task #60 — SUPER_ADMIN-only, manually-triggered lat/lng back-fill for
// legacy Tenant rows (address set, coords null). Not a cron; not auto-run.
import { GeocodeBackfillModule } from './geocode-backfill/geocode-backfill.module';
// 2026-05-25 Developer area: tenant REST API tokens + outbound webhooks.
import { ApiKeysModule } from './api-keys/api-keys.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { BrandingModule } from './branding/branding.module';
import { DataSourceModule } from './data-source/data-source.module';
// 2026-07-01 — Launch Sprint FEEDS domain: real RSS/Atom + ICS backend for
// the RSS_FEED / CALENDAR widgets (see feeds.module.ts doc for auth model).
import { FeedsModule } from './feeds/feeds.module';
import { UsbExportModule } from './usb-export/usb-export.module';
import { PlayerOtaModule } from './player-ota/player-ota.module';
import { PlayerLogsModule } from './player-logs/player-logs.module';
import { FitnessModule } from './fitness/fitness.module';
// 2026-05-16 — Sprint 13 VenueOS Sports: the Sport Engine.
import { SportsModule } from './sports/sports.module';
// 2026-05-03 — Sprint 8c streaming integrations.
import { StreamingModule } from './streaming/streaming.module';
// 2026-05-03 — Sprint 8c billing (Stripe Checkout scaffolding).
import { BillingModule } from './billing/billing.module';
// 2026-05-03 — Sprint 8d POS catalog sync framework.
import { PosModule } from './pos/pos.module';
// 2026-05-03 — Sprint 8d ad-network monetization framework.
import { AdsModule } from './ads/ads.module';
// 2026-05-03 — Sample-data test harness for integration smoke tests.
import { SampleDataModule } from './sample-data/sample-data.module';
// 2026-05-03 — Canva / Slides / PowerPoint design-import pipeline.
import { ImportsModule } from './imports/imports.module';
// 2026-05-03 — Claude-backed AI content generation.
import { AiModule } from './ai/ai.module';
// 2026-05-26 — venue background music: SomaFM / NPR-by-geo / NTS /
// custom Icecast/HLS stream + Apple-for-Business + Spotify-for-Business
// placeholders. Backs the MusicPlayerWidget.
import { MusicModule } from './music/music.module';
// 2026-05-26 — AI Integration Concierge: scrape an operator's URL or
// take a free-text description, classify, return ranked provider
// candidates (POS, music, streaming, calendar, etc.). See CLAUDE.md
// "AI Integration Concierge — vision" section.
import { IntegrationsModule } from './integrations/integrations.module';
import { AnalyticsModule } from './analytics/analytics.module';
// 2026-05-27 — Goodview EP6N GPIO IN/OUT controller + service.
// Exports GpioService so EmergencyController can auto-drive a wired
// status lamp on emergency trigger / all-clear.
import { GpioModule } from './screens/gpio.module';
// 2026-05-27 — One-click Bug Reporter. BugsController is registered
// in the `controllers` array below; BugsModule provides the
// enrichment + AI analyzer services that back it. See bugs/*.ts and
// packages/api-types/src/bugs.ts.
import { BugsModule } from './bugs/bugs.module';
import { BugsController } from './bugs/bugs.controller';
// 2026-05-30 — Real-time efficiency observability: per-route bytes/latency,
// slow-query logging, egress budget alerting, /super/efficiency endpoint.
import { EfficiencyModule } from './efficiency/efficiency.module';
import { EfficiencyInterceptor } from './efficiency/efficiency.interceptor';
import { ScreenWedgeDetectorCron } from './screens/screen-wedge-detector.cron';
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisThrottlerStorage } from './realtime/redis-throttler-storage';
import { ClientIpThrottlerGuard } from './security/client-ip-throttler.guard';
import { RedisService } from './realtime/redis.service';
import { APP_FILTER, APP_GUARD, APP_PIPE, APP_INTERCEPTOR } from '@nestjs/core';
import { SanitizationPipe } from './security/sanitization.pipe';
import { RequestLogInterceptor } from './security/request-log.interceptor';
import { DeviceIdentityInterceptor } from './security/device-identity.interceptor';
import { AnomalyMiddleware } from './security/anomaly.middleware';
import { CsrfMiddleware } from './security/csrf.middleware';
import { CsrfController } from './security/csrf.controller';
import { WebsocketSignerService } from './security/websocket-signer.service';
import { AssetSanitizerService } from './security/asset-sanitizer.service';
import { SupabaseStorageService } from './storage/supabase-storage.service';
import { StorageWatchdogService } from './storage/storage-watchdog.service';
import { MediaOptimizationService } from './storage/media-optimization.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RbacGuard } from './auth/rbac.guard';
import { SentryModule } from '@sentry/nestjs/setup';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';

@Module({
  imports: [
    SentryModule.forRoot(),
    PrismaModule,
    AuthModule,
    RealtimeModule,
    FeatureFlagsModule,
    SsoModule,
    EmailModule,
    OnboardingModule,
    NotificationsModule,
    SubmissionsModule,
    LicenseModule,
    GeocodeBackfillModule,
    ApiKeysModule,
    WebhooksModule,
    BrandingModule,
    DataSourceModule,
    FeedsModule,
    UsbExportModule,
    PlayerOtaModule,
    PlayerLogsModule,
    FitnessModule,
    SportsModule,
    StreamingModule,
    BillingModule,
    PosModule,
    AdsModule,
    SampleDataModule,
    ImportsModule,
    AiModule,
    MusicModule,
    IntegrationsModule,
    AnalyticsModule,
    GpioModule,
    BugsModule,
    EfficiencyModule,
    // 2026-05-06 — operator: kiosk wedged on "429 trying to
    // reconnect" right after fresh APK install. Cause: a fresh kiosk
    // boot fires a flurry of API hits in the first 60 s — manifest
    // poll (every 5 s × 12 = 12), screens/status heartbeat, ota-state
    // phase reports (5+), branding fetch, register handshake, plus
    // the WebView's /player page rehydrating playlists/templates.
    // Easily 80-150 requests/min during cold-boot. The old 100/min
    // global default 429'd the kiosk, the recovery probe ALSO 429'd,
    // and the screen was wedged.
    //
    // Bumping default to 600/min covers a worst-case cold-boot burst
    // by ~4× headroom. Per-endpoint @Throttle decorators (login,
    // register, ota-state, etc.) still impose tighter limits where
    // brute-force or abuse is the actual risk. Health endpoints are
    // explicitly @SkipThrottle()'d so the recovery probe is never
    // gated by ANY of these.
    // STORAGE IS REDIS-BACKED (RedisThrottlerStorage) — every @Throttle
    // limit (login brute-force 10/min, register 5/min, password-reset 3/hr,
    // invite 20/min, branding scrape, geocode, …) is now counted in ONE
    // SHARED Redis counter across every Railway replica (security P1,
    // 2026-06-26). Before this, storage was the default IN-MEMORY
    // ThrottlerStorageService, which is per-replica — so with multiple
    // replicas each kept its own bucket and no single bucket ever reached
    // the limit: the brute-force caps NEVER fired 429. RedisThrottlerStorage
    // reuses the EXISTING ioredis client (RedisService.publisher — no new
    // npm dep) and FAILS OPEN to an in-memory bucket when Redis is
    // unavailable, so the API still boots/serves with Redis down (CLAUDE.md
    // "Redis missing → API boots anyway") and a Redis blip never locks out
    // logins. The AI hourly cap remains separately Redis-backed
    // (ai/ai-hourly-cap.ts) — unaffected by this storage.
    //
    // forRootAsync so the storage can inject RedisService (provided +
    // exported @Global by RealtimeModule). Limits/TTLs are unchanged from
    // the previous forRoot config.
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ ttl: 60000, limit: 600 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
  ],
  controllers: [
    AppController,
    ScreensController,
    DevicesController,
    PanicContentController,
    EmergencyController,
    ScreenEmergencyController,
    StatsController,
    AuditController,
    UsersController,
    PlaylistsController,
    ScreenGroupsController,
    SchedulesController,
    AssetsController,
    AssetFilesController,
    TemplatesController,
    TenantsController,
    ProxyController,
    HealthController,
    IntegrationsHealthController,
    FloorPlansController,
    HardwareController,
    CsrfController,
    BugsController,
    GeocodingController,
  ],
  providers: [
    AppService,
    GeocodingService,
    PlaylistDistributionService,
    WebsocketSignerService,
    // 2026-05-27 — Auto-recovery for the "alive but content-frozen"
    // failure mode (operator: "is that a bug? it should keep itself
    // alive right? i wont be infront of customer screens to do this
    // when somehting doesnt load"). Every 60s, finds screens whose
    // ping is fresh but lastCacheReportAt is >5min stale and fires
    // REFRESH_WEB. See the file header for the G43 incident root
    // cause + signal design.
    ScreenWedgeDetectorCron,
    AssetSanitizerService,
    SupabaseStorageService,
    StorageWatchdogService,
    MediaOptimizationService,
    // Server-side URL renderer (Puppeteer + Alpine Chromium). Used by
    // ProxyController to handle JS-heavy / AJAX-loaded sites that the
    // legacy strip-scripts proxy can't render. See renderer.service.ts.
    RendererService,
    JwtAuthGuard,
    RbacGuard,
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    {
      // ClientIpThrottlerGuard (not the stock ThrottlerGuard): derives a
      // STABLE per-client tracker from the leftmost X-Forwarded-For entry so
      // the per-IP brute-force caps actually accumulate behind Railway's
      // multi-hop proxy. See the guard file for the live root-cause (2026-07-07).
      provide: APP_GUARD,
      useClass: ClientIpThrottlerGuard,
    },
    {
      provide: APP_PIPE,
      useClass: SanitizationPipe,
    },
    {
      // SECURITY (DT-01/DT-03, 2026-08-03). Must run BEFORE any other
      // interceptor that reads `req.user`: it replaces a device
      // principal's tenant identity — which JwtAuthGuard copies verbatim
      // out of a 180-day token claim — with the LIVE Screen row, and
      // rejects a screen whose credential has been revoked. Without it,
      // an unpaired / re-homed / dumpstered screen keeps reading its
      // former tenant's live emergency traffic. No-op for every
      // non-device principal. See device-identity.interceptor.ts.
      provide: APP_INTERCEPTOR,
      useClass: DeviceIdentityInterceptor,
    },
    {
      // Operational stdout breadcrumb for mutating requests. NOT the
      // audit safeguard — the durable audit trail is the AuditLog table
      // written by each route's domain code (P0-4, 2026-05-28).
      provide: APP_INTERCEPTOR,
      useClass: RequestLogInterceptor,
    },
    {
      // Efficiency observability — records per-route bytes/latency and
      // asset egress for the /super/efficiency dashboard. Zero overhead
      // on the hot path (fire-and-forget Redis, in-memory ring only).
      provide: APP_INTERCEPTOR,
      useClass: EfficiencyInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // CSRF must run before anomaly so blocked requests don't skew anomaly stats.
    consumer
      .apply(CsrfMiddleware, AnomalyMiddleware)
      .forRoutes('*');
  }
}
