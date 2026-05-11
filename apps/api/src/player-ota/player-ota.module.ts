import { Module } from '@nestjs/common';
import { PlayerOtaController } from './player-ota.controller';
import { CanaryAutoPromote } from './canary-auto-promote';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  // PrismaModule needed so the controller can persist the APK
  // version that each device self-reports on its /update-check poll.
  imports: [PrismaModule],
  controllers: [PlayerOtaController],
  // CanaryAutoPromote runs as a background service (process-internal
  // 5-min timer) — it auto-promotes tenants out of canary state once
  // the soak window elapses without install errors.
  providers: [CanaryAutoPromote],
})
export class PlayerOtaModule {}
