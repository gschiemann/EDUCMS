import { Module } from '@nestjs/common';
import { CleverController } from './clever.controller';
import { CleverService, CLEVER_HTTP_CLIENT } from './clever.service';
import { RealCleverHttpClient } from './clever-http.client';
import { CleverSyncCron } from './clever-sync.cron';
import { CleverOAuthStateStore } from './clever-oauth-state';

@Module({
  controllers: [CleverController],
  providers: [
    CleverService,
    CleverSyncCron,
    // CLV-01 — single-use server record for one OAuth handshake. RedisService
    // comes from the @Global RealtimeModule, so no import is needed here.
    CleverOAuthStateStore,
    { provide: CLEVER_HTTP_CLIENT, useClass: RealCleverHttpClient },
  ],
  exports: [CleverService],
})
export class CleverModule {}
