import { Module } from '@nestjs/common';
import { PlayLogController } from './play-log.controller';
import { PlayLogReadController } from './play-log-read.controller';
import { PlayLogRetentionService } from './play-log-retention.service';

/**
 * Device play log (2026-11-09, player stability gap 7): the device-
 * authenticated ingest, the tenant-scoped read / CSV export, and retention.
 * PrismaService, RedisService and LeaderLeaseService come from @Global()
 * modules, as for TelemetryModule.
 */
@Module({
  controllers: [PlayLogController, PlayLogReadController],
  providers: [PlayLogRetentionService],
})
export class PlayLogModule {}
