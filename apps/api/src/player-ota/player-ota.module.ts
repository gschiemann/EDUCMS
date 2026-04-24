import { Module } from '@nestjs/common';
import { PlayerOtaController } from './player-ota.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  // PrismaModule needed so the controller can persist the APK
  // version that each device self-reports on its /update-check poll.
  imports: [PrismaModule],
  controllers: [PlayerOtaController],
})
export class PlayerOtaModule {}
