import {
  Controller, Get, Post, Patch, Param, Body, Req,
  HttpException, HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { SportsService } from './sports.service';
import { verifyConsoleToken, parseConsoleTokenGameId } from './sports-console-token';
import { RedisService } from '../realtime/redis.service';
import { checkIngestLimit } from '../security/ingest-rate-limit';
import { clientIpFromRequest } from '../security/client-ip';

/**
 * VenueOS Sports — Phase-2 Domain SHARE. The PUBLIC scorekeeper console.
 *
 * Deliberately UN-guarded (no JwtAuthGuard) — the whole point is a
 * student/volunteer scorekeeper driving LIMITED game controls from a
 * /console/<token> link + QR without a tenant account. Auth is the
 * stateless game-scoped console HMAC token in the PATH (see
 * sports-console-token.ts): the token carries the game id, is minted
 * against the game's live Game.consoleTokenVersion (bump = every link for
 * the game dies), always expires, and can never verify as a feed token
 * (distinct "console:" MAC purpose).
 *
 * ── THE ALLOWLIST IS THE SECURITY BOUNDARY ─────────────────────────
 * Only the routes on this controller are reachable with a console token:
 *
 *   GET   :token/session   — token validity + the public identity block
 *   PATCH :token/score     — quick-button delta OR absolute set
 *   PATCH :token/clock     — start / pause / set / reset
 *   PATCH :token/segment   — advance / set the period
 *   POST  :token/timeout   — call a team timeout
 *   POST  :token/cue       — fire a celebration cue (key/cueId/team ONLY)
 *
 * NOTHING else: no roster, no sponsors, no settings, no templates, no
 * feed credentials, no game create/delete, no status transitions (going
 * FINAL stays operator-only), no ribbon config, no scene recall, no undo.
 * Every handler delegates to the SAME SportsService method the authed
 * SportsController uses, so every server-side invariant (atomic score
 * increments + clamp, clock anchor math, celebration mutex/auto-fire,
 * GameEvents + undo rail, stats-race Serializable tx) rides along
 * unchanged. Do NOT add a route here without a security review — the
 * controller spec pins the exact method list.
 *
 * The cue body is FILTERED to {key, cueId, team}: the authed cue endpoint
 * also accepts audioUrl / sponsor / scorer fields, which are injection
 * channels (arbitrary media URLs on every venue surface) a leaked
 * volunteer link must not carry.
 *
 * Path is `api/v1/sports/console/:token/…` — distinct from the guarded
 * `api/v1/sports/games/:id` and the public read-only `api/v1/sports/
 * board/:id`, so the three controllers never collide.
 *
 * CSRF: the mutation paths are exempted in csrf.middleware.ts (enumerated
 * exactly, never blanket) — auth is the capability token in the path, not
 * an ambient cookie, so CSRF's threat model does not apply (same argument
 * as the feed ingest trio).
 */
@Controller('api/v1/sports/console')
export class SportsConsoleController {
  // Same envelope as the board controller's feed endpoints: a scorekeeper
  // is human-speed (a handful of taps/min); 40/10s per game stops a leaked
  // link (or a scripted abuser) from hammering mutations while never
  // throttling a legitimate volunteer. Multi-replica-safe via
  // ingest-rate-limit.ts (Redis fixed window, in-memory fallback).
  private static readonly WINDOW_MS = 10_000;
  private static readonly MAX_PER_WINDOW = 40;
  // Pre-verify budget keyed per CLIENT IP (refuter P2, Phase-2 SHARE):
  // the per-game budget above is only spent AFTER the MAC verifies, so an
  // attacker who knows the public game id can no longer drain the
  // volunteer's window with garbage tokens — their hammering is capped
  // against their OWN address here instead. 2× the per-game budget so the
  // IP gate can never bind first for the one legitimate pad. Residual: an
  // attacker sharing the venue NAT can still drain this shared-IP bucket,
  // a far narrower threat than "anyone on the internet" (and generic
  // DDoS territory the edge owns, not this controller).
  private static readonly IP_MAX_PER_WINDOW = 80;

  constructor(
    private readonly sports: SportsService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Shared per-request gate, in the same defensive order as the feed
   * ingest: (1) shape-parse the token — garbage is rejected before any
   * I/O; (2) pre-verify rate-limit keyed per CLIENT IP — a garbage-MAC
   * hammerer spends only their own budget, so they can't lock the
   * legitimate volunteer out (refuter P2; the old key was the
   * attacker-suppliable game id); (3) ONE small DB read for
   * {tenantId, consoleTokenVersion}; (4) constant-time MAC verify against
   * the live version (bumping the column revokes every link); (5) the
   * per-game budget, spent ONLY by authenticated taps — the key survives
   * token rotation, so a leaked link scripted from many addresses still
   * shares one window. A missing game and a bad token return the SAME
   * 401 — no game-existence oracle.
   */
  private async authorize(token: string, req: Request): Promise<{
    gameId: string;
    tenantId: string;
    meta: NonNullable<Awaited<ReturnType<SportsService['getConsoleShareMeta']>>>;
  }> {
    const gameId = parseConsoleTokenGameId(token);
    if (!gameId) this.throwInvalid();
    const ip = clientIpFromRequest(req) || 'unknown';
    const { limited: ipLimited } = await checkIngestLimit(
      this.redis.publisher,
      `console-ip:${ip}`,
      SportsConsoleController.IP_MAX_PER_WINDOW,
      SportsConsoleController.WINDOW_MS,
    );
    if (ipLimited) this.throwRateLimited();
    const meta = await this.sports.getConsoleShareMeta(gameId);
    if (!meta || !verifyConsoleToken(gameId, token, meta.consoleTokenVersion)) {
      this.throwInvalid();
    }
    const { limited } = await checkIngestLimit(
      this.redis.publisher,
      `console:${gameId}`,
      SportsConsoleController.MAX_PER_WINDOW,
      SportsConsoleController.WINDOW_MS,
    );
    if (limited) this.throwRateLimited();
    return { gameId, tenantId: meta!.tenantId, meta: meta! };
  }

  private throwRateLimited(): never {
    throw new HttpException(
      { code: 'SPORTS_CONSOLE_RATE_LIMITED', message: 'Console rate limit exceeded' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private throwInvalid(): never {
    throw new HttpException(
      {
        code: 'SPORTS_CONSOLE_TOKEN_INVALID',
        message: 'This scorekeeper link is invalid, expired, or has been revoked.',
      },
      HttpStatus.UNAUTHORIZED,
    );
  }

  /**
   * Token validity probe + the minimal public identity block the pad's
   * header needs (team names / sport / status — all already public via
   * GET /sports/board/:id). The pad calls this once on load so a revoked
   * or expired link shows the friendly full-screen message immediately
   * instead of on the first rejected tap. Live game STATE is polled from
   * the public board endpoint, not here.
   */
  @Get(':token/session')
  async session(@Param('token') token: string, @Req() req: Request) {
    const { gameId, meta } = await this.authorize(token, req);
    return {
      ok: true,
      gameId,
      sport: meta.sport,
      status: meta.status,
      homeTeam: meta.homeTeam,
      awayTeam: meta.awayTeam,
    };
  }

  /**
   * Score — same delta-vs-absolute dispatch as the authed controller,
   * EXCEPT the delta path passes suppressAutoFinal: volleyball/pickleball
   * set-and-match scoring may credit the winning set, but going FINAL
   * stays operator-only (the documented boundary above — a leaked link
   * must not be able to end a live game on every venue surface).
   */
  @Patch(':token/score')
  async score(
    @Param('token') token: string,
    @Body() body: { team?: string; delta?: number; homeScore?: number; awayScore?: number },
    @Req() req: Request,
  ) {
    const { gameId, tenantId } = await this.authorize(token, req);
    const dto = body || {};
    if (typeof dto.delta === 'number') {
      return this.sports.adjustScore(tenantId, gameId, dto, undefined, {
        suppressAutoFinal: true,
      });
    }
    return this.sports.setScore(tenantId, gameId, dto);
  }

  /** Clock control: start | pause | set | reset. */
  @Patch(':token/clock')
  async clock(
    @Param('token') token: string,
    @Body() body: { action?: string; ms?: number },
    @Req() req: Request,
  ) {
    const { gameId, tenantId } = await this.authorize(token, req);
    return this.sports.clockAction(tenantId, gameId, body || {});
  }

  /** Segment advance/set — validation lives in SportsService.setSegment. */
  @Patch(':token/segment')
  async segment(
    @Param('token') token: string,
    @Body() body: { segment?: number; delta?: number },
    @Req() req: Request,
  ) {
    const { gameId, tenantId } = await this.authorize(token, req);
    return this.sports.setSegment(tenantId, gameId, body || {});
  }

  /** Team timeout — same atomic decrement + clock pause + TIMEOUT event. */
  @Post(':token/timeout')
  async timeout(
    @Param('token') token: string,
    @Body() body: { team?: string; type?: string },
    @Req() req: Request,
  ) {
    const { gameId, tenantId } = await this.authorize(token, req);
    return this.sports.callTimeout(tenantId, gameId, body || {});
  }

  /**
   * Fire a celebration cue. The forwarded DTO is a hard-filtered subset —
   * key / cueId / team ONLY. audioUrl, sponsor*, scorer* and target are
   * DELIBERATELY dropped: those let the caller put arbitrary media URLs /
   * text on every surface in the venue, which is operator trust, not
   * volunteer trust.
   */
  @Post(':token/cue')
  async cue(
    @Param('token') token: string,
    @Body() body: { key?: string; cueId?: string; team?: 'home' | 'away' },
    @Req() req: Request,
  ) {
    const { gameId, tenantId } = await this.authorize(token, req);
    const raw = body || {};
    const dto: { key?: string; cueId?: string; team?: 'home' | 'away' } = {};
    if (typeof raw.key === 'string') dto.key = raw.key;
    if (typeof raw.cueId === 'string') dto.cueId = raw.cueId;
    if (raw.team === 'home' || raw.team === 'away') dto.team = raw.team;
    return this.sports.fireCue(tenantId, gameId, dto);
  }
}
