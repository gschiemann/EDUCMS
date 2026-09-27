import {
  Controller, Get, Post, Patch, Param, Body, Req,
  HttpException, HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  consoleAllows,
  consolePenaltyPreset,
  consolePlayClockResets,
  consoleShotClockMaxSec,
  findSport,
  validateConsoleStats,
} from '@cms/api-types';
import { SportsService } from './sports.service';
import { consoleCommand, isValidCommandId } from './game-command';
import {
  type ConsoleAction,
  type ConsoleScope,
  parseConsoleTokenGameId,
  verifyConsoleTokenScope,
} from './sports-console-token';
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
 *   GET   :token/session     — token validity, the link's scope + what it
 *                              may do, and the public identity block
 *   PATCH :token/score       — quick-button delta OR absolute set
 *   PATCH :token/clock       — start / pause / set / reset
 *   PATCH :token/segment     — advance / set the period
 *   POST  :token/timeout     — call a team timeout
 *   POST  :token/cue         — fire a celebration cue (key/cueId/team ONLY)
 *   PATCH :token/shot-clock  — start / stop / reset (never configure)
 *   PATCH :token/play-clock  — football 40 / 25: start / stop / reset
 *   PATCH :token/stats       — sport stats in @cms/api-types consoleStatRules
 *   POST  :token/possession  — the possession arrow (basketball / football)
 *   PATCH :token/penalties   — add a PRESET penalty / release one early
 *   POST  :token/undo        — undo THIS link's own most recent action, once
 *
 * SCOPES (K12-F34 + K12-F16 — ONE permission model). A link is minted for
 * one job and the scope is inside its MAC (sports-console-token.ts). Every
 * route names the action it needs; a link may use it only when
 * consoleAllows(scope, sport) — the ONE table in @cms/api-types
 * (sports-console-scopes.ts) that the pad also renders from — grants it,
 * computed from the game's LIVE sport, never from anything the caller sends.
 * A refused action is 403 SPORTS_CONSOLE_SCOPE (authenticated, not allowed)
 * — never 401, which the pad reads as "link revoked". A pre-scope link
 * verifies as `full` and keeps exactly its original five routes.
 *
 * NOTHING else: no roster, no sponsors, no settings, no templates, no
 * feed credentials, no game create/delete, no status transitions (going
 * FINAL, and reopening a FINAL game, stay operator-only), no ribbon config,
 * no scene recall, no shot-clock setup, no free-text stats, and no undo of
 * anybody else's action. Every handler delegates to the SAME SportsService
 * method the authed SportsController uses, through the same command
 * pipeline (K12-F10/F11: one atomic compare-and-swap command, a durable
 * command id, the FINAL lock, an event + audit row attributed to this LINK
 * by fingerprint). Do NOT add a route here without a security review — the
 * controller spec pins the exact method list.
 *
 * The cue body is FILTERED to {key, cueId, team}: the authed cue endpoint
 * also accepts audioUrl / sponsor / scorer fields, which are injection
 * channels (arbitrary media URLs on every venue surface) a leaked
 * volunteer link must not carry. The penalty body is filtered the same way
 * (preset label + length, a jersey number, never a name).
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
   * {tenantId, consoleTokenVersion, sport}; (4) constant-time MAC verify
   * against the live version (bumping the column revokes every link) — which
   * also yields the scope the link was minted for; (5) the per-game budget,
   * spent ONLY by authenticated taps — the key survives token rotation, so a
   * leaked link scripted from many addresses still shares one window; (6)
   * the SCOPE gate — after the MAC (the scope is inside it) and after the
   * per-game budget (a leaked clock link hammering /score still spends the
   * game's window). A missing game and a bad token return the SAME 401 — no
   * game-existence oracle.
   */
  private async authorize(token: string, req: Request, action?: ConsoleAction): Promise<{
    gameId: string;
    tenantId: string;
    scope: ConsoleScope;
    allows: ConsoleAction[];
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
    const scope = meta ? verifyConsoleTokenScope(gameId, token, meta.consoleTokenVersion) : null;
    if (!meta || !scope) {
      this.throwInvalid();
    }
    const { limited } = await checkIngestLimit(
      this.redis.publisher,
      `console:${gameId}`,
      SportsConsoleController.MAX_PER_WINDOW,
      SportsConsoleController.WINDOW_MS,
    );
    if (limited) this.throwRateLimited();
    // The scope is the permission; the pad's layout is not. What it grants
    // is intersected with the game's LIVE sport.
    const allows = consoleAllows(scope, findSport(meta.sport));
    if (action && allows.indexOf(action) === -1) {
      throw new HttpException(
        {
          code: 'SPORTS_CONSOLE_SCOPE',
          message: 'This link was not issued for that control.',
          scope,
          action,
        },
        HttpStatus.FORBIDDEN,
      );
    }
    return { gameId, tenantId: meta.tenantId, scope, allows, meta };
  }

  private throwRejected(code: string, message: string, extra?: Record<string, unknown>): never {
    throw new HttpException({ code, message, ...(extra || {}) }, HttpStatus.BAD_REQUEST);
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
   * Token validity probe + the link's scope, what it may do in this sport,
   * and the minimal public identity block the pad's header needs (team
   * names / sport / status — all already public via GET /sports/board/:id).
   * The pad calls this once on load so a revoked or expired link shows the
   * friendly full-screen message immediately instead of on the first
   * rejected tap, and so it renders ONLY the controls the link can drive
   * (display only — every route re-checks server-side). Live game STATE is
   * polled from the public board endpoint, not here.
   */
  @Get(':token/session')
  async session(@Param('token') token: string, @Req() req: Request) {
    const { gameId, meta, scope, allows } = await this.authorize(token, req);
    return {
      ok: true,
      gameId,
      scope,
      allows,
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
    const { gameId, tenantId } = await this.authorize(token, req, 'score');
    // K12-F10/F34: the command id rides the body; the actor is this issued
    // link (a fingerprint of it — never the token itself).
    const { dto, ctx } = consoleCommand(token, body);
    if (typeof dto.delta === 'number') {
      return this.sports.adjustScore(tenantId, gameId, dto, ctx, {
        suppressAutoFinal: true,
      });
    }
    return this.sports.setScore(tenantId, gameId, dto, ctx);
  }

  /** Clock control: start | pause | set | reset. */
  @Patch(':token/clock')
  async clock(
    @Param('token') token: string,
    @Body() body: { action?: string; ms?: number },
    @Req() req: Request,
  ) {
    const { gameId, tenantId } = await this.authorize(token, req, 'clock');
    const { dto, ctx } = consoleCommand(token, body);
    return this.sports.clockAction(tenantId, gameId, dto, ctx);
  }

  /** Segment advance/set — validation lives in SportsService.setSegment. */
  @Patch(':token/segment')
  async segment(
    @Param('token') token: string,
    @Body() body: { segment?: number; delta?: number },
    @Req() req: Request,
  ) {
    const { gameId, tenantId } = await this.authorize(token, req, 'segment');
    const { dto, ctx } = consoleCommand(token, body);
    return this.sports.setSegment(tenantId, gameId, dto, ctx);
  }

  /** Team timeout — same atomic decrement + clock pause + TIMEOUT event. */
  @Post(':token/timeout')
  async timeout(
    @Param('token') token: string,
    @Body() body: { team?: string; type?: string },
    @Req() req: Request,
  ) {
    const { gameId, tenantId } = await this.authorize(token, req, 'timeout');
    const { dto, ctx } = consoleCommand(token, body);
    return this.sports.callTimeout(tenantId, gameId, dto, ctx);
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
    const { gameId, tenantId } = await this.authorize(token, req, 'cue');
    const raw = body || {};
    const dto: { key?: string; cueId?: string; team?: 'home' | 'away' } = {};
    if (typeof raw.key === 'string') dto.key = raw.key;
    if (typeof raw.cueId === 'string') dto.cueId = raw.cueId;
    if (raw.team === 'home' || raw.team === 'away') dto.team = raw.team;
    // K12-F34: attributed to this issued link, like every other console action.
    return this.sports.fireCue(tenantId, gameId, dto, consoleCommand(token, {}).ctx);
  }

  // ── K12-F16 volunteer duties ───────────────────────────────────────

  /**
   * Shot clock — start / stop / reset. `configure` (turning it off or
   * changing its length) is a setup decision and stays operator-only. A
   * reset value must be a whole number of seconds no longer than the sport's
   * longest option; the service then refuses anything above the game's
   * CONFIGURED length (K12-F05) and refuses every action while it is OFF.
   */
  @Patch(':token/shot-clock')
  async shotClock(
    @Param('token') token: string,
    @Body() body: { action?: string; value?: number },
    @Req() req: Request,
  ) {
    const { gameId, tenantId, meta } = await this.authorize(token, req, 'shotClock');
    const { dto: raw, ctx } = consoleCommand(token, body);
    const action = raw.action;
    if (action !== 'start' && action !== 'stop' && action !== 'reset') {
      this.throwRejected('SPORTS_CONSOLE_BAD_ACTION', 'action must be start | stop | reset');
    }
    const dto: { action: string; value?: number } = { action };
    if (action === 'reset' && raw.value !== undefined) {
      const max = consoleShotClockMaxSec(findSport(meta.sport));
      const v = raw.value;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > max) {
        this.throwRejected('SPORTS_CONSOLE_BAD_VALUE', `reset value must be 1-${max} seconds`);
      }
      dto.value = v;
    }
    return this.sports.setShotClock(tenantId, gameId, dto, ctx);
  }

  /**
   * Football play clock — start / stop / reset to the sport's two presets
   * (40 after a down, 25 after an administrative stoppage). `run: false`
   * parks a reset (the snap, or a 25 count waiting for the ready signal),
   * exactly as the operator console does (K12-F06).
   */
  @Patch(':token/play-clock')
  async playClock(
    @Param('token') token: string,
    @Body() body: { action?: string; value?: number; run?: boolean },
    @Req() req: Request,
  ) {
    const { gameId, tenantId, meta } = await this.authorize(token, req, 'playClock');
    const { dto: raw, ctx } = consoleCommand(token, body);
    const action = raw.action;
    if (action !== 'start' && action !== 'stop' && action !== 'reset') {
      this.throwRejected('SPORTS_CONSOLE_BAD_ACTION', 'action must be start | stop | reset');
    }
    const dto: { action: string; value?: number; run?: boolean } = { action };
    if (action === 'reset') {
      if (raw.value !== undefined) {
        const allowed = consolePlayClockResets(findSport(meta.sport));
        if (typeof raw.value !== 'number' || allowed.indexOf(raw.value) === -1) {
          this.throwRejected(
            'SPORTS_CONSOLE_BAD_VALUE',
            `the play clock resets to ${allowed.join(' or ')} seconds`,
          );
        }
        dto.value = raw.value;
      }
      if (raw.run !== undefined) {
        if (typeof raw.run !== 'boolean') {
          this.throwRejected('SPORTS_CONSOLE_BAD_VALUE', 'run must be true or false');
        }
        dto.run = raw.run;
      }
    }
    return this.sports.setPlayClock(tenantId, gameId, dto, ctx);
  }

  /**
   * Sport stats. All-or-nothing against @cms/api-types validateConsoleStats:
   * only keys the sport declares, numbers inside their declared range,
   * closed-set text (inning half, serve). Structured arrays, config keys
   * (celebration pack, feed, CTS) and free text are refused with the keys
   * named — the service only ever sees the validated object.
   */
  @Patch(':token/stats')
  async stats(
    @Param('token') token: string,
    @Body() body: { stats?: unknown },
    @Req() req: Request,
  ) {
    const { gameId, tenantId, meta } = await this.authorize(token, req, 'stats');
    const { dto, ctx } = consoleCommand(token, body);
    const checked = validateConsoleStats(findSport(meta.sport), dto.stats);
    if (!checked.ok) {
      this.throwRejected(
        'SPORTS_CONSOLE_STAT_REJECTED',
        'This scorekeeper link cannot set those values.',
        { rejected: checked.rejected },
      );
    }
    return this.sports.updateStats(tenantId, gameId, { stats: checked.stats }, ctx);
  }

  /** Possession arrow — the same typed-column write + event + audit row the
   *  operator console uses. */
  @Post(':token/possession')
  async possession(
    @Param('token') token: string,
    @Body() body: { team?: string },
    @Req() req: Request,
  ) {
    const { gameId, tenantId } = await this.authorize(token, req, 'possession');
    const { dto, ctx } = consoleCommand(token, body);
    const team = dto.team;
    if (team !== 'home' && team !== 'away') {
      this.throwRejected('SPORTS_CONSOLE_BAD_VALUE', 'team must be home | away');
    }
    return this.sports.setPossession(tenantId, gameId, { team }, ctx);
  }

  /**
   * Penalty box — add a penalty that matches one of the sport's PRESETS
   * (label and length together; the label is what the board shows, so a
   * free-text label would be a message channel), or release one early.
   * `clear` (empty the whole box) stays operator-only. The jersey is digits
   * only; the water-polo one-tap exclusion flag is passed through, the
   * player NAME never is.
   */
  @Patch(':token/penalties')
  async penalties(
    @Param('token') token: string,
    @Body()
    body: {
      action?: string;
      team?: string;
      lenSec?: number;
      label?: string;
      player?: string;
      penaltyId?: string;
      exclusion?: boolean;
    },
    @Req() req: Request,
  ) {
    const { gameId, tenantId, meta } = await this.authorize(token, req, 'penalties');
    const { dto: raw, ctx } = consoleCommand(token, body);
    if (raw.action === 'add') {
      if (raw.team !== 'home' && raw.team !== 'away') {
        this.throwRejected('SPORTS_CONSOLE_BAD_VALUE', 'team must be home | away');
      }
      const def = findSport(meta.sport);
      const preset = consolePenaltyPreset(def, raw.lenSec, raw.label);
      if (!preset) {
        this.throwRejected('SPORTS_CONSOLE_BAD_VALUE', 'penalty must be one of the sport presets');
      }
      const player = typeof raw.player === 'string' ? raw.player : '';
      if (player !== '' && !/^\d{1,3}$/.test(player)) {
        this.throwRejected('SPORTS_CONSOLE_BAD_VALUE', 'player must be a jersey number');
      }
      const dto: {
        action: 'add';
        team: 'home' | 'away';
        lenSec: number;
        label: string;
        player: string;
        exclusion?: boolean;
      } = { action: 'add', team: raw.team, lenSec: preset.sec, label: preset.label, player };
      if (raw.exclusion === true && def?.key === 'water_polo') dto.exclusion = true;
      return this.sports.setPenalties(tenantId, gameId, dto, ctx);
    }
    if (raw.action === 'remove') {
      const pid = raw.penaltyId;
      if (typeof pid !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(pid)) {
        this.throwRejected('SPORTS_CONSOLE_BAD_VALUE', 'penaltyId required');
      }
      return this.sports.setPenalties(tenantId, gameId, { action: 'remove', penaltyId: pid }, ctx);
    }
    this.throwRejected('SPORTS_CONSOLE_BAD_ACTION', 'action must be add | remove');
  }

  /**
   * Undo — the single-use inverse (K12-F09) of THIS link's own most recent
   * action, named by the command id the pad sent it with (`undoOf`).
   * SportsService.undoConsoleAction refuses anything that is not this link's
   * (the command receipt's actor must be this link's fingerprint — K12-F34),
   * anything older than the link's latest action, and anything the undo rail
   * would refuse (a cue, a shot-clock tap, an action a later one overwrote).
   * A second tap is answered from the first undo's receipt and changes
   * nothing. No scope check beyond a valid link: a link can only undo what
   * it was itself allowed to do.
   */
  @Post(':token/undo')
  async undo(
    @Param('token') token: string,
    @Body() body: { undoOf?: string },
    @Req() req: Request,
  ) {
    const { gameId, tenantId } = await this.authorize(token, req);
    const target = (body || {}).undoOf;
    if (!isValidCommandId(target)) {
      this.throwRejected('SPORTS_CONSOLE_BAD_VALUE', 'undoOf must be the command id of the action to undo');
    }
    return this.sports.undoConsoleAction(tenantId, gameId, target, consoleCommand(token, {}).ctx);
  }
}
