import { Module } from '@nestjs/common';
import { EfficiencyMetricsService } from './efficiency-metrics.service';
import { EfficiencyInterceptor } from './efficiency.interceptor';
import { SlowQueryMiddleware } from './slow-query.middleware';
import { EfficiencyAlertingService } from './efficiency-alerting.service';
import { EfficiencyController } from './efficiency.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';

/**
 * EfficiencyModule — pluggable observability for VenueOS efficiency monitoring.
 *
 * No new npm dependencies introduced — uses the same setInterval pattern
 * as CanaryAutoPromoteService, PosSync, and WebhookRetryWorker (this codebase
 * deliberately avoids @nestjs/schedule to keep the dep surface flat).
 *
 * Registers:
 *  - EfficiencyMetricsService: in-process ring + Redis fan-out (singleton)
 *  - EfficiencyInterceptor: global interceptor (wired via app.module APP_INTERCEPTOR)
 *  - SlowQueryMiddleware: registers Prisma $use in onModuleInit
 *  - EfficiencyAlertingService: setInterval cron — 50/70/90% + anomaly alerting
 *  - EfficiencyController: GET /api/v1/super/efficiency (SUPER_ADMIN only)
 *
 * Exports EfficiencyMetricsService and EfficiencyInterceptor so app.module.ts
 * can reference EfficiencyInterceptor as APP_INTERCEPTOR.
 */
@Module({
  imports: [PrismaModule, AuthModule, EmailModule],
  providers: [
    EfficiencyMetricsService,
    EfficiencyInterceptor,
    SlowQueryMiddleware,
    EfficiencyAlertingService,
  ],
  controllers: [EfficiencyController],
  exports: [EfficiencyMetricsService, EfficiencyInterceptor],
})
export class EfficiencyModule {}
