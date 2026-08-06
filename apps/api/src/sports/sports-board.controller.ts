import {
  Controller, Get, Post, Param, Body, Headers, Query, Res,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { SportsService } from './sports.service';
import { verifyFeedToken, verifyFeedTokenFromQuery } from './sports-feed-token';
// 2026-07-01 swim/dive DEPTH pass — swim-timing-snapshot ingest.
import type { SwimTimingSnapshot } from '@cms/scoreboard-cts';
// 2026-07-01 launch-sprint #272a — multi-replica-safe ingest rate limiter.
import { RedisService } from '../realtime/redis.service';
// Trust wave (2026-08-06) — X-Server-Time header rides every board response
// (incl. 304s, which have no body for serverTime); Redis-TIME-aligned.
import { TimeSyncService } from '../realtime/time-sync.service';
import { checkIngestLimit } from '../security/ingest-rate-limit';

/**
 * RFC 9110 §13.1.2 — If-None-Match carries one or more entity-tags (or `*`).
 * We only ever mint strong tags, but a proxy may weaken one in transit, and
 * weak comparison is the mandated mode for If-None-Match — so accept the
 * `W/`-prefixed form of our own tag too.
 */
function ifNoneMatchHits(header: string, etag: string): boolean {
  return header.split(',').some((raw) => {
    const t = raw.trim();
    return t === '*' || t === etag || t === `W/${etag}`;
  });
}

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

  // Per-game rate limit for the PUBLIC (non-token-checked) endpoints below
  // (`athletes/:token`, `cts-cue-fired`) — still in-memory/per-replica; these
  // are lower-stakes audit/read surfaces, not the token-authenticated feed
  // ingest trio (see ingest-rate-limit.ts for those). A real feed pushes
  // ~1-10 updates/sec; 40/10s leaves headroom while stopping a flood from a
  // leaked token/link. Sliding 10s window.
  private readonly feedHits = new Map<string, number[]>();
  private static readonly FEED_WINDOW_MS = 10_000;
  private static readonly FEED_MAX_PER_WINDOW = 40;

  constructor(
    private readonly sports: SportsService,
    private readonly redis: RedisService,
    private readonly timeSync: TimeSyncService,
  ) {}

  /**
   * Trust wave (2026-08-06) — conditional board poll. Every response carries:
   *   - `ETag`: strong hash of the payload minus serverTime (SportsService
   *     computes it once per cache fill).
   *   - `X-Server-Time`: fresh Redis-aligned server clock, so a 304 still
   *     hands the board a skew sample despite the empty body.
   *   - `Cache-Control: no-cache`: pollers must revalidate every time — the
   *     whole point is the cheap 304, never a silently-reused stale body.
   * A matching If-None-Match short-circuits to an empty 304. The 200 body
   * still carries `serverTime` (per-request fresh) for deployed boards that
   * don't send If-None-Match yet.
   */
  @Get(':id')
  async board(
    @Param('id') id: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Throws NotFoundException for an unknown id BEFORE any header below is
    // set — the 404 contract is unchanged.
    const { payload, etag } = await this.sports.getBoardWithMeta(id);
    res.setHeader('ETag', etag);
    res.setHeader('X-Server-Time', String(this.timeSync.now()));
    res.setHeader('Cache-Control', 'no-cache');
    if (ifNoneMatch && ifNoneMatchHits(ifNoneMatch, etag)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return; // 304 — empty body by contract
    }
    return payload;
  }

  /**
   * S1 (2026-06-22) — PUBLIC athlete profile by unguessable share token. The
   * "so a parent can see their kid's stats after the game" surface. 404 unless
   * the athlete exists AND the operator opted into sharing (isPublic) — so a
   * revoked / never-shared athlete is invisible and there is NO person-id
   * enumeration path. Minimal PII (only what the operator chose to share).
   * Rate-limited via the feed window so a leaked link can't be mass-scraped.
   * Two-segment path (`board/athletes/:token`) so it never collides with the
   * single-segment `board/:id` above.
   */
  @Get('athletes/:token')
  async athleteProfile(@Param('token') token: string) {
    const now = Date.now();
    const key = `athlete:${token}`;
    const recent = (this.feedHits.get(key) || []).filter(
      (t) => t > now - SportsBoardController.FEED_WINDOW_MS,
    );
    if (recent.length >= SportsBoardController.FEED_MAX_PER_WINDOW) {
      this.feedHits.set(key, recent);
      throw new HttpException({ code: 'SPORTS_ATHLETE_RATE_LIMITED', message: 'Rate limit exceeded' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.feedHits.set(key, recent);

    const profile = await this.sports.getPublicAthleteProfile(token);
    if (!profile) throw new HttpException({ code: 'SPORTS_ATHLETE_NOT_FOUND', message: 'Athlete not found' }, HttpStatus.NOT_FOUND);
    return profile;
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
      throw new HttpException({ code: 'SPORTS_CUE_AUDIT_RATE_LIMITED', message: 'Cue audit rate limit exceeded' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.feedHits.set(`cue:${id}`, recent);

    if (!body || typeof body !== 'object' || !body.cueId || typeof body.cueId !== 'string') {
      throw new HttpException({ code: 'SPORTS_CUE_ID_REQUIRED', message: 'cueId is required' }, HttpStatus.BAD_REQUEST);
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

  /**
   * Feed auth for the three ingest endpoints (/feed, /cts-snapshot,
   * /swim-timing-snapshot).
   *
   * HEADER (`x-feed-token`) accepts every valid token shape — legacy bare
   * (v0) and structured. QUERY (`?token=`) accepts ONLY short-lived
   * structured tokens (0 < ttl ≤ 7 days): query strings leak into
   * proxy/CDN/WAF access logs, so a non-expiring credential must never ride
   * in a URL (audit W0-01.4). URL-only CTS-adapter boxes stay supported —
   * the operator mints a short-lived URL token with
   * `GET /sports/games/:id/feed-credentials?ttlSeconds=…` (≤ 604800).
   *
   * When a token is VALID but arrives via query in a non-compliant shape
   * (bare or ttl too long) we return a distinct code telling the integrator
   * exactly how to fix their setup instead of a generic "invalid token".
   */
  private assertFeedAuth(
    gameId: string,
    headerToken: string | undefined,
    queryToken: string | undefined,
    currentVersion: number,
  ): void {
    if (headerToken) {
      if (verifyFeedToken(gameId, headerToken, currentVersion)) return;
    } else if (verifyFeedTokenFromQuery(gameId, queryToken, currentVersion)) {
      return;
    }
    // Distinguish "wrong channel" from "bad token" for query-only callers:
    // the token verifies fine, it just may not travel in a URL. No oracle is
    // opened — a caller holding a valid token can already confirm validity
    // via the header path.
    const validButWrongChannel =
      !headerToken &&
      typeof queryToken === 'string' &&
      queryToken.length > 0 &&
      verifyFeedToken(gameId, queryToken, currentVersion);
    if (validButWrongChannel) {
      throw new HttpException(
        {
          code: 'SPORTS_FEED_QUERY_TOKEN_NOT_SHORT_LIVED',
          message:
            'This token is only accepted in the x-feed-token header. ?token= accepts short-lived tokens only (ttl <= 7 days) — mint one with GET /sports/games/:id/feed-credentials?ttlSeconds=604800 or less.',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    throw new HttpException(
      { code: 'SPORTS_FEED_TOKEN_INVALID', message: 'Invalid or missing feed token' },
      HttpStatus.UNAUTHORIZED,
    );
  }

  /**
   * Sprint 13 — CTS console snapshot ingest.
   *
   * The CtsBridge in apps/web/src/components/player/CtsBridge.tsx parses
   * the live RS232 feed and POSTs the latest snapshot here at ~5 Hz.
   * The API writes it under `Game.stats.cts = { lastUpdateAt, ... }`
   * — see SportsService.ingestCtsSnapshot for the source-of-truth rule.
   *
   * Auth: x-feed-token header (preferred) or ?token= query (for the
   * weird cases where only a URL is configurable on a CTS-adapter box —
   * short-lived structured tokens only, ttl ≤ 7 days; audit W0-01.4).
   * Same stateless game-scoped HMAC as `/feed`. Reuses the feed rate-limit
   * pool — a misbehaving bridge can't fan out to more than 80 POSTs / 10 s
   * total (40 to /feed + 40 here).
   *
   * NEVER touches the persistent operator-input columns
   * (`Game.homeScore/awayScore/clockMs/clockRunning/segment`). That's
   * what gives the operator a graceful manual-override path when CTS
   * goes dark: the +/- chips in the Run console keep working and the
   * board falls back to them as soon as the CTS heartbeat goes stale.
   */
  @Post(':id/cts-snapshot')
  async ctsSnapshot(
    @Param('id') id: string,
    @Headers('x-feed-token') headerToken: string | undefined,
    @Query('token') queryToken: string | undefined,
    @Body()
    body: {
      clockMs?: number;
      clockRunning?: boolean;
      segment?: number;
      homeScore?: number;
      awayScore?: number;
      shotClock?: { ms: number; running: boolean; len?: number; at?: string };
      // T2-1 — per-side shot clocks (water polo), exclusions (3 slots per
      // side), and per-team timeouts remaining. Older bridges that only
      // ship the 7 original fields keep working — these are optional.
      homeShotClock?: { raw?: string; ms?: number; running?: boolean };
      awayShotClock?: { raw?: string; ms?: number; running?: boolean };
      homeExclusions?: ({ playerJersey: number; secondsRemaining: number } | null)[];
      awayExclusions?: ({ playerJersey: number; secondsRemaining: number } | null)[];
      homeTimeoutsRemaining?: number;
      awayTimeoutsRemaining?: number;
      horn?: boolean;
      raw?: string;
    },
  ) {
    // Rate-limit BEFORE auth — same defensive ordering as /feed. Multi-
    // replica-safe (Redis-backed with in-memory fallback) — see
    // ingest-rate-limit.ts.
    const { limited } = await checkIngestLimit(
      this.redis.publisher,
      `cts:${id}`,
      SportsBoardController.FEED_MAX_PER_WINDOW,
      SportsBoardController.FEED_WINDOW_MS,
    );
    if (limited) {
      throw new HttpException({ code: 'SPORTS_CTS_SNAPSHOT_RATE_LIMITED', message: 'CTS snapshot rate limit exceeded' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    // Game-scoped HMAC, verified against the game's CURRENT feed-token version
    // (incrementing Game.feedTokenVersion revokes all outstanding tokens).
    // The version read happens AFTER the rate-limit gate so a bad-token flood
    // can't drive DB reads. Header accepts every valid shape (legacy bare
    // still verifies at v0); ?token= is short-lived-structured only — see
    // assertFeedAuth (audit W0-01.4).
    const ctsVersion = await this.sports.getFeedTokenVersion(id);
    this.assertFeedAuth(id, headerToken, queryToken, ctsVersion);

    return this.sports.ingestCtsSnapshot(id, (body || {}) as Record<string, unknown>, {
      source: 'cts-feed',
    });
  }

  /**
   * Sprint 13 DEPTH pass (2026-07-01) — CTS SWIMMING scoreboard-serial
   * ingest. docs/research/2026-06-30-swim-dive-scoreboards/00-REPORT.md
   * part A7 + docs/research/2026-07-01-swim-dive-depth/.
   *
   * A DIFFERENT wire format and data model from `cts-snapshot` above
   * (water polo — clock/score/shot-clock/exclusions). Swimming is a
   * lane/heat/time sport: the bridge box runs `@cms/scoreboard-cts`'s
   * `SwimTimingParser` against the RS-232 line and POSTs the ALREADY-
   * DECODED `SwimTimingSnapshot` JSON here (same "parse locally, post
   * JSON" division of labor as the water-polo CtsBridge) — this endpoint
   * never touches raw serial bytes.
   *
   * Auth: identical stateless game-scoped HMAC feed token as every other
   * console-facing endpoint on this controller (x-feed-token header
   * preferred; short-lived ?token= fallback — audit W0-01.4). Same
   * rate-limit pool (40/10s per game,
   * keyed separately so a swim bridge and a water-polo bridge on two
   * different games never share a bucket).
   *
   * Writes ONLY into `Game.stats.results` (the MeetResult contract the
   * console's Meet-Results editor already writes) — no score/segment
   * write-through, because swimming has no equivalent "operator column"
   * for in-progress lane times the way water polo has a running score.
   */
  @Post(':id/swim-timing-snapshot')
  async swimTimingSnapshot(
    @Param('id') id: string,
    @Headers('x-feed-token') headerToken: string | undefined,
    @Query('token') queryToken: string | undefined,
    @Body() body: SwimTimingSnapshot,
  ) {
    // Multi-replica-safe (Redis-backed with in-memory fallback) — see
    // ingest-rate-limit.ts.
    const { limited } = await checkIngestLimit(
      this.redis.publisher,
      `swim:${id}`,
      SportsBoardController.FEED_MAX_PER_WINDOW,
      SportsBoardController.FEED_WINDOW_MS,
    );
    if (limited) {
      throw new HttpException({ code: 'SPORTS_SWIM_TIMING_RATE_LIMITED', message: 'Swim timing snapshot rate limit exceeded' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    // Header accepts every valid shape; ?token= is short-lived-structured
    // only — see assertFeedAuth (audit W0-01.4).
    const swimVersion = await this.sports.getFeedTokenVersion(id);
    this.assertFeedAuth(id, headerToken, queryToken, swimVersion);

    return this.sports.ingestSwimTimingSnapshot(id, body || ({} as SwimTimingSnapshot), {
      source: 'swim-timing-feed',
    });
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
    // Multi-replica-safe (Redis-backed with in-memory fallback) — see
    // ingest-rate-limit.ts.
    const { limited } = await checkIngestLimit(
      this.redis.publisher,
      id,
      SportsBoardController.FEED_MAX_PER_WINDOW,
      SportsBoardController.FEED_WINDOW_MS,
    );
    if (limited) {
      throw new HttpException({ code: 'SPORTS_FEED_RATE_LIMITED', message: 'Feed rate limit exceeded' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    // Token in the X-Feed-Token header (preferred) or ?token= (URL-only
    // systems; short-lived structured tokens only — audit W0-01.4).
    // Constant-time, game-scoped verification against the game's CURRENT
    // feed-token version — incrementing Game.feedTokenVersion revokes every
    // outstanding token for the game. The version read happens AFTER the
    // rate-limit gate so a bad-token flood can't drive DB reads. Legacy bare
    // tokens still verify at version 0 via the header.
    const feedVersion = await this.sports.getFeedTokenVersion(id);
    this.assertFeedAuth(id, headerToken, queryToken, feedVersion);

    const applied = await this.sports.ingestByFeed(id, body || {});
    return { ok: true, applied };
  }
}
