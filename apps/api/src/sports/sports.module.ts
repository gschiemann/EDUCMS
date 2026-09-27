import { Module } from '@nestjs/common';
import { SportsController } from './sports.controller';
import { SportsBoardController } from './sports-board.controller';
import { SportsConsoleController } from './sports-console.controller';
import { SportsService } from './sports.service';
import { ClockAdvanceService } from './clock-advance.service';
import { GameScheduleService } from './game-schedule.service';
import { SponsorsController } from './sponsors.controller';
import { SponsorsService } from './sponsors.service';
import { SportsRosterPrivacyController } from './sports-roster-privacy.controller';
import { SportsRosterPrivacyService } from './sports-roster-privacy.service';
import { StudentPrivacyController } from './student-privacy.controller';
import { StudentPrivacyService } from './student-privacy.service';
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
  controllers: [
    SportsController,
    SportsBoardController,
    SportsConsoleController,
    SponsorsController,
    SportsRosterPrivacyController,
    StudentPrivacyController,
  ],
  providers: [
    SportsService,
    ClockAdvanceService,
    GameScheduleService,
    SponsorsService,
    WebsocketSignerService,
    SportsRosterPrivacyService,
    StudentPrivacyService,
  ],
})
export class SportsModule {}
