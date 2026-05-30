import { Module } from '@nestjs/common';
import { SampleDataController } from './sample-data.controller';
import { SampleDataService } from './sample-data.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StreamingModule } from '../streaming/streaming.module';
import { PosModule } from '../pos/pos.module';
import { AdsModule } from '../ads/ads.module';

/**
 * SampleDataModule — one-click integration test harness. Lets the
 * operator load realistic sample data into streaming / POS / ads
 * connections without registering for vendor sandbox accounts. Every
 * sample row is tagged with `[Sample]` so production data is safe.
 *
 * SampleDataService is exported so OnboardingModule can inject it to
 * auto-seed vertical-appropriate sample data on first signup.
 */
@Module({
  imports: [PrismaModule, StreamingModule, PosModule, AdsModule],
  controllers: [SampleDataController],
  providers: [SampleDataService],
  exports: [SampleDataService],
})
export class SampleDataModule {}
