import { Module } from '@nestjs/common';
import { CleverController } from './clever.controller';
import { CleverService, CLEVER_HTTP_CLIENT } from './clever.service';
import { RealCleverHttpClient } from './clever-http.client';
import { CleverSyncCron } from './clever-sync.cron';

@Module({
  controllers: [CleverController],
  providers: [
    CleverService,
    CleverSyncCron,
    { provide: CLEVER_HTTP_CLIENT, useClass: RealCleverHttpClient },
  ],
  exports: [CleverService],
})
export class CleverModule {}
