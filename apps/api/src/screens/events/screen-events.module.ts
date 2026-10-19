import { Global, Module } from '@nestjs/common';
import { ScreenEventsService } from './screen-events.service';
import { ScreenEventsRetentionCron } from './screen-events-retention.cron';

/**
 * The interruption ledger (2026-10-18). Global so every writer — the screens
 * and bulk controllers, telemetry, the emergency controllers, the wedge
 * detector, the media-publication sweep, the demotion service — injects the
 * ONE ScreenEventsService (and its one dedup map) without importing a
 * module. Every injection site is `@Optional()`, so the specs that build
 * those classes by hand keep working and simply record nothing.
 * PrismaService / RedisService / LeaderLeaseService are global.
 */
@Global()
@Module({
  providers: [ScreenEventsService, ScreenEventsRetentionCron],
  exports: [ScreenEventsService],
})
export class ScreenEventsModule {}
