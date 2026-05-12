import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';

/**
 * AnalyticsModule — Phase D5 (2026-05-12).
 *
 * Hosts the touch-event ingest + aggregate endpoints. Uses the global
 * PrismaService (no providers entry needed). Adding new analytics
 * surfaces (e.g. screen heartbeats, asset-view dwell time) goes here
 * so the dashboard has ONE module to talk to.
 */
@Module({
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
