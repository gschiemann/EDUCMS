import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { ProofOfPlaySampler } from './proof-of-play.sampler';
import { ProofOfPlayRollupService } from './proof-of-play-rollup.service';

/**
 * AnalyticsModule — Phase D5 (2026-05-12).
 *
 * Hosts the touch-event ingest + aggregate endpoints and the
 * proof-of-play analytics surface (the ProofOfPlaySampler background
 * service + the /analytics/proof-of-play report). Uses the global
 * PrismaService. Adding new analytics surfaces goes here so the
 * dashboard has ONE module to talk to.
 */
@Module({
  controllers: [AnalyticsController],
  providers: [ProofOfPlaySampler, ProofOfPlayRollupService],
})
export class AnalyticsModule {}
