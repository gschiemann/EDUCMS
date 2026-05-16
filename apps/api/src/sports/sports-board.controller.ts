import { Controller, Get, Param } from '@nestjs/common';
import { SportsService } from './sports.service';

/**
 * VenueOS Sports — Sprint 13. The PUBLIC scoreboard read endpoint.
 *
 * Deliberately UN-guarded — no JwtAuthGuard. A stadium scoreboard
 * display renders this page without anyone logging in. Scoreboard data
 * (score, clock, team names, the celebration-cue feed) is inherently
 * public information shown on a big screen to a crowd. The game id is
 * an unguessable UUID, and nothing here exposes tenant internals
 * beyond the single game's public state.
 *
 * Path is `api/v1/sports/board/:id` — distinct from the guarded
 * `api/v1/sports/games/:id`, so the two controllers never collide.
 */
@Controller('api/v1/sports/board')
export class SportsBoardController {
  constructor(private readonly sports: SportsService) {}

  @Get(':id')
  board(@Param('id') id: string) {
    return this.sports.getBoard(id);
  }
}
