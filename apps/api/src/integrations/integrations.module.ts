/**
 * IntegrationsModule — wires the AI Integration Concierge discovery
 * primitive into the Nest dependency graph.
 *
 * 2026-05-26 — Created after the third attempt; the prior two
 * attempts were wiped by parallel-agent contention before the
 * worktree isolation rule landed.
 */
import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationDiscoveryService } from './discovery.service';
import { HardwareRecommenderService } from './hardware-recommender.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [IntegrationsController],
  providers: [IntegrationDiscoveryService, HardwareRecommenderService],
  exports: [IntegrationDiscoveryService, HardwareRecommenderService],
})
export class IntegrationsModule {}
