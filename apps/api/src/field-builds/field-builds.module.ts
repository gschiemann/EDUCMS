import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { FieldBuildsController } from './field-builds.controller';
import { FieldBuildsService } from './field-builds.service';
import { FIELD_GATE_ROUTES, FieldWindowGateMiddleware } from './field-window-gate.middleware';

/**
 * FIELD BUILD WINDOWS (2026-10-18). Its own module so the player-ota pipeline
 * is untouched: the update check picks the window up through the middleware
 * bound here, on its two routes only. PrismaService and RedisService are
 * global; the signer is per-module, like ScreensBulkModule's.
 */
@Module({
  controllers: [FieldBuildsController],
  providers: [FieldBuildsService, FieldWindowGateMiddleware, WebsocketSignerService],
  exports: [FieldBuildsService],
})
export class FieldBuildsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(FieldWindowGateMiddleware).forRoutes(...FIELD_GATE_ROUTES);
  }
}
