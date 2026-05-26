import { Module } from '@nestjs/common';
import { PosController } from './pos.controller';
import { PosOAuthController } from './pos-oauth.controller';
import { PosService } from './pos.service';
import { PosSyncCron } from './pos-sync.cron';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

/**
 * PosModule — Sprint 8d. POS catalog sync framework. Connects gym /
 * bar / restaurant / retail tenants to their POS so menu boards
 * auto-update from the live catalog. Per-provider sync handlers live
 * in `apps/api/src/pos/providers/<id>.ts`. Square shipped 2026-05-25
 * (OAuth + catalog poll + webhook + idempotency + audit). Toast /
 * Clover / Shopify follow the same pattern when their OAuth apps are
 * approved.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PosController, PosOAuthController],
  providers: [PosService, PosSyncCron],
  exports: [PosService],
})
export class PosModule {}
