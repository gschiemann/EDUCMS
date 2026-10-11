import { Module } from '@nestjs/common';

import { DisplayModule } from '../../display/display.module';
import { WebsocketSignerService } from '../../security/websocket-signer.service';
import { ScreensBulkController } from './screens-bulk.controller';

/**
 * Bulk screen actions (2026-10-11). Its own module so the bulk controller can
 * reach DisplayService (exported by DisplayModule) without touching
 * ScreensController's constructor — which ~20 spec files build by hand.
 * PrismaService and RedisService are global.
 */
@Module({
  imports: [DisplayModule],
  controllers: [ScreensBulkController],
  providers: [WebsocketSignerService],
})
export class ScreensBulkModule {}
