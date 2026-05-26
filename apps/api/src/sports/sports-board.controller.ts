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

  /**
   * Sprint 13 — CTS celebration audit log.
   *
   * The CTS orchestrator runs on the kiosk player. When it picks a cue
   * from the operator's deck and fires the cinematic, it POSTs here
   * (best-effort, no await) so the GameEvent table captures a forensic
   * record of every celebration that played: cueId, team, source
   * (auto|preview|manual), and the live score at fire time. Drives the
   * sponsor proof-of-play report ("during this game, the GOLAZO cue
   * fired 4 times in front of the Pool Supply sponsor banner").
   *
   * Public + rate-limited (16 Hz per game, ample headroom — typical
   * water polo has < 0.05 Hz cue fires). The endpoint trusts the
   * client's cueId/team/source values because:
   *   - the player can already trigger arbitrary visuals (it's
   *     rendering them); falsifying an audit row gains nothing
   *   - the source field is purely informational (tells us "was this
   *     auto-detected from CTS, manually pushed from the Properties
   *     panel test button, or from a Stream Deck remote trigger")
   *   - bad rows are still tenant-scoped via the game id
   */
  @Post(':id/cts-cue-fired')
  async ctsCueFired(
    @Param('id') id: string,
    @Body()
    body: {
      cueId?: string;
      team?: 'home' | 'away' | 'horn';
      source?: 'auto' | 'preview' | 'manual';
      score?: string;
    },
  ) {
    const now = Date.now();
    const recent = (this.feedHits.get(`cue:${id}`) || []).filter(
      (t) => t > now - SportsBoardController.FEED_WINDOW_MS,
    );
    if (recent.length >= SportsBoardController.FEED_MAX_PER_WINDOW) {
      this.feedHits.set(`cue:${id}`, recent);
      throw new HttpException('Cue audit rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.feedHits.set(`cue:${id}`, recent);

    if (!body || typeof body !== 'object' || !body.cueId || typeof body.cueId !== 'string') {
      throw new HttpException('cueId is required', HttpStatus.BAD_REQUEST);
    }
    try {
      await this.sports.recordCueFired(id, {
        cueId: String(body.cueId).slice(0, 64),
        team: body.team === 'away' ? 'away' : body.team === 'horn' ? 'horn' : 'home',
        source: body.source === 'manual' ? 'manual' : body.source === 'preview' ? 'preview' : 'auto',
        score: typeof body.score === 'string' ? body.score.slice(0, 16) : undefined,
      });
    } catch {
      // Best-effort — the kiosk already rendered. Don't fail it.
    }
    return { ok: true };
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
