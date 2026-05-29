import { Module } from '@nestjs/common';
import { PosController } from './pos.controller';
import { PosOAuthController } from './pos-oauth.controller';
import { PosService } from './pos.service';
import { MenuService } from './menu.service';
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
  providers: [PosService, MenuService, PosSyncCron],
  // MenuService is exported so ScreensController (declared in AppModule,
  // which imports PosModule) can resolve the device-authed
  // GET /screens/:id/menu read.
  exports: [PosService, MenuService],
})
export class PosModule {}
