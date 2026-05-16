import { Module } from '@nestjs/common';
import { SportsController } from './sports.controller';
import { SportsBoardController } from './sports-board.controller';
import { SportsService } from './sports.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';

/**
 * VenueOS Sports — Sprint 13. The Sport Engine module.
 *
 * DI note: PrismaService + RedisService resolve globally (PrismaModule
 * and RealtimeModule are both `@Global()`). WebsocketSignerService is
 * NOT global — it is only provided at AppModule level — so this module
 * must list it in its own providers, exactly like FitnessModule does.
 * Forgetting this crashes Nest at bootstrap before "API listening".
 */
@Module({
  controllers: [SportsController, SportsBoardController],
  providers: [SportsService, WebsocketSignerService],
})
export class SportsModule {}
