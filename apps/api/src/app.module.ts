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
import { ScreenGroupsController } from './screen-groups/screen-groups.controller';
import { SchedulesController } from './schedules/schedules.controller';
import { AssetsController } from './assets/assets.controller';
import { AssetFilesController } from './assets/asset-files.controller';
import { TemplatesController } from './templates/templates.controller';
import { TenantsController } from './tenants/tenants.controller';
import { ProxyController } from './proxy/proxy.controller';
import { RendererService } from './proxy/renderer.service';
import { HealthController } from './health/health.controller';
import { FloorPlansController } from './floor-plans/floor-plans.controller';
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
// 2026-05-25 Developer area: tenant REST API tokens + outbound webhooks.
import { ApiKeysModule } from './api-keys/api-keys.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { BrandingModule } from './branding/branding.module';
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
import { AnalyticsModule } from './analytics/analytics.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_PIPE, APP_INTERCEPTOR } from '@nestjs/core';
import { SanitizationPipe } from './security/sanitization.pipe';
import { AuditInterceptor } from './security/audit.interceptor';
import { AnomalyMiddleware } from './security/anomaly.middleware';
import { CsrfMiddleware } from './security/csrf.middleware';
import { CsrfController } from './security/csrf.controller';
import { WebsocketSignerService } from './security/websocket-signer.service';
import { AssetSanitizerService } from './security/asset-sanitizer.service';
import { SupabaseStorageService } from './storage/supabase-storage.service';
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
    ApiKeysModule,
    WebhooksModule,
    BrandingModule,
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
    AnalyticsModule,
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
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 600,
    }]),
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
    FloorPlansController,
    CsrfController,
  ],
  providers: [
    AppService,
    WebsocketSignerService,
    AssetSanitizerService,
    SupabaseStorageService,
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
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_PIPE,
      useClass: SanitizationPipe,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
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
