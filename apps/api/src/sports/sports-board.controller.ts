import {
  Controller, Get, Post, Param, Body, Headers, Query,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { SportsService } from './sports.service';
import { verifyFeedToken } from './sports-feed-token';

/**
 * VenueOS Sports — Sprint 13. The PUBLIC scoreboard surfaces.
 *
 * Deliberately UN-guarded — no JwtAuthGuard. A stadium scoreboard display
 * renders `GET board/:id` without anyone logging in. The game id is an
 * unguessable UUID and nothing here exposes tenant internals beyond the single
 * game's public state.
 *
 * `POST board/:id/feed` is the EXTERNAL score-feed ingest (the "two clocks"
 * gap): a Sportzcast/Scorebird box, console-reader bridge, or custom
 * integration pushes live score/clock machine-to-machine, authenticated by a
 * stateless game-scoped HMAC feed token (NOT a dashboard session). The
 * operator copies the feed URL+token from the game console
 * (GET /sports/games/:id/feed-credentials).
 *
 * Path is `api/v1/sports/board/:id…` — distinct from the guarded
 * `api/v1/sports/games/:id`, so the two controllers never collide.
 */
@Controller('api/v1/sports/board')
export class SportsBoardController {
  private readonly logger = new Logger(SportsBoardController.name);

  // Per-game in-memory rate limit for the feed endpoint. A real feed pushes
  // ~1-10 updates/sec; 40/10s leaves headroom while stopping a flood from a
  // leaked token. Sliding 10s window.
  private readonly feedHits = new Map<string, number[]>();
  private static readonly FEED_WINDOW_MS = 10_000;
  private static readonly FEED_MAX_PER_WINDOW = 40;

  constructor(private readonly sports: SportsService) {}

  @Get(':id')
  board(@Param('id') id: string) {
    return this.sports.getBoard(id);
  }

  @Post(':id/feed')
  async feed(
    @Param('id') id: string,
    @Headers('x-feed-token') headerToken: string | undefined,
    @Query('token') queryToken: string | undefined,
    @Body()
    body: {
      homeScore?: number;
      awayScore?: number;
      clockMs?: number;
      clockRunning?: boolean;
      segment?: number;
    },
  ) {
    // Rate-limit BEFORE any work (and before the constant-time token check) so
    // a flood of bad tokens can't be used to hammer the DB or time the HMAC.
    const now = Date.now();
    const recent = (this.feedHits.get(id) || []).filter(
      (t) => t > now - SportsBoardController.FEED_WINDOW_MS,
    );
    if (recent.length >= SportsBoardController.FEED_MAX_PER_WINDOW) {
      this.feedHits.set(id, recent);
      throw new HttpException('Feed rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.feedHits.set(id, recent);

    // Token in the X-Feed-Token header (preferred) or ?token= (for systems
    // that can only configure a URL). Constant-time, game-scoped verification.
    const token = headerToken || queryToken;
    if (!verifyFeedToken(id, token)) {
      throw new HttpException('Invalid or missing feed token', HttpStatus.UNAUTHORIZED);
    }

    const applied = await this.sports.ingestByFeed(id, body || {});
    return { ok: true, applied };
  }
}
