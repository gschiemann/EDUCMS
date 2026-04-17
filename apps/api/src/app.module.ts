import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ScreensController } from './screens/screens.controller';
import { EmergencyController } from './emergency/emergency.controller';
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
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { RealtimeModule } from './realtime/realtime.module';
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
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),
  ],
  controllers: [
    AppController,
    ScreensController,
    EmergencyController,
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
    CsrfController,
  ],
  providers: [
    AppService,
    WebsocketSignerService,
    AssetSanitizerService,
    SupabaseStorageService,
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
