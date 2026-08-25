import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ActivationFunnelService } from './activation-funnel.service';
import { ActivationFunnelController } from './activation-funnel.controller';

/**
 * Self-contained module: owns its own controller + service, imports only
 * what it needs. Mirrors GeocodeBackfillModule's minimal pattern (a small,
 * manually-triggered SUPER_ADMIN-only endpoint with no cross-module
 * dependents) rather than EfficiencyModule's larger footprint (interceptor
 * + middleware + cron the app.module wires globally) — this endpoint is a
 * plain read, nothing else in the app needs to reach into it.
 *
 * Not @Global() — nothing outside this module needs ActivationFunnelService.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ActivationFunnelController],
  providers: [ActivationFunnelService],
})
export class ActivationFunnelModule {}
