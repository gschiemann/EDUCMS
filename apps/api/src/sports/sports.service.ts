import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { findSport, SPORTS } from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';
import { SPONSOR_SPOT_SECONDS } from './sponsor.constants';

/**
 * VenueOS Sports — Sprint 13. The game engine service.
 *
 * Every game mutation does three things, in order:
 *   1. update the `games` row (the system-of-record),
 *   2. append a `game_events` row (the append-only forensic log +
 *      the celebration-cue feed the board page polls),
 *   3. publish a signed message to the `game:<id>` Redis channel.
 *
 * Step 3 is future-proofing: the board page polls today (dead simple,
 * works on the offline-first player and every browser), but the signed
 * pub/sub fan-out is already wired so a WS-driven board is a drop-in
 * later with no protocol change — same pattern the emergency system uses.
 *
 * THE CLOCK IS AN ANCHOR. We never tick on the server. `clockMs` is the
 * clock reading at `clockUpdatedAt`; `clockRunning` says whether it is
 * advancing. The board page derives the live displayed clock from those
 * three every frame. The only place the server computes a live value is
 * `pause`, which re-anchors `clockMs` to the current displayed reading.
 */

type ClockAction = 'start' | 'pause' | 'set' | 'reset';

const GAME_STATUSES = ['SCHEDULED', 'PRE_GAME', 'LIVE', 'HALFTIME', 'FINAL'];
const CUE_FEED_WINDOW_MS = 20_000;

@Injectable()
export class SportsService {
  private readonly logger = new Logger(SportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly signer: WebsocketSignerService,
  ) {}

  // ── helpers ──────────────────────────────────────────────────

  /** Resolve the SportDefinition for a game, or 400 if the key is unknown. */
  private sportOf(sportKey: string): SportDefinition {
    const def = findSport(sportKey);
    if (!def) {
      throw new BadRequestException(`Unknown sport "${sportKey}"`);
    }
    return def;
  }

  /** Starting clock reading for a fresh game / a segment reset. */
  private segmentStartMs(def: SportDefinition): number {
    if (def.clock.type === 'countdown') return def.clock.segmentMs ?? 0;
    return 0; // countup starts at 0; "none" has no clock
  }

  /**
   * Compute the live displayed clock for a game. Only used on the
   * server by `pause` (to re-anchor) — the board page does this itself
   * every frame so the display is smooth.
   */
  private liveClockMs(game: {
    clockMs: number;
    clockRunning: boolean;
    clockUpdatedAt: Date;
    sport: string;
  }): number {
    if (!game.clockRunning) return game.clockMs;
    const def = this.sportOf(game.sport);
    const elapsed = Date.now() - new Date(game.clockUpdatedAt).getTime();
    if (def.clock.type === 'countup') return game.clockMs + elapsed;
    if (def.clock.type === 'countdown') return Math.max(0, game.clockMs - elapsed);
    return game.clockMs; // 'none'
  }

  /** Append an event row + best-effort signed pub/sub broadcast. */
  private async record(gameId: string, type: string, payload: Record<string, unknown>) {
    const event = await this.prisma.client.gameEvent.create({
      data: { gameId, type, payload: payload as any },
    });
    try {
      const signed = this.signer.signMessage('GAME_EVENT', {
        gameId,
        eventId: event.id,
        type,
        payload,
      });
      await this.redis.publish(`game:${gameId}`, signed);
    } catch (e) {
      // Pub/sub is an optimization — the board polls regardless.
      this.logger.debug(`game:${gameId} publish skipped: ${(e as Error).message}`);
    }
    return event;
  }

  /** Load a game scoped to its tenant, or 404. */
  private async owned(tenantId: string, id: string) {
    const game = await this.prisma.client.game.findFirst({
      where: { id, tenantId },
    });
    if (!game) throw new NotFoundException('Game not found');
    return game;
  }

  // ── reads ────────────────────────────────────────────────────

  /** Sport catalog — single source of truth lives in @cms/api-types. */
  listSports() {
    return SPORTS;
  }

  /** All games for a tenant, newest first. */
  async listGames(tenantId: string) {
    return this.prisma.client.game.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** One game, tenant-scoped — for the operator control surface. */
  async getGame(tenantId: string, id: string) {
    return this.owned(tenantId, id);
  }

  /**
   * Public board view — by game id only, NOT tenant-scoped. Scoreboard
   * data (score, clock, team names) is inherently public: it is shown
   * on a stadium display. The id is an unguessable UUID. Returns the
   * raw clock anchor (board ticks locally) + the recent celebration
   * cue feed (board dedupes by event id and fires new ones).
   */
  async getBoard(id: string) {
    const game = await this.prisma.client.game.findUnique({ where: { id } });
    if (!game) throw new NotFoundException('Game not found');

    const since = new Date(Date.now() - CUE_FEED_WINDOW_MS);
    const [cues, sponsors] = await Promise.all([
      this.prisma.client.gameEvent.findMany({
        where: { gameId: id, type: 'CUE', createdAt: { gte: since } },
        orderBy: { createdAt: 'asc' },
      }),
      // Active sponsors rotate through the board's banner slot. Public
      // by design — they exist to be shown on the scoreboard.
      this.prisma.client.sponsor.findMany({
        where: { tenantId: game.tenantId, active: true },
        orderBy: [{ weight: 'desc' }, { name: 'asc' }],
        select: { id: true, name: true, logoUrl: true, tagline: true, color: true, weight: true },
      }),
    ]);

    return {
      id: game.id,
      sport: game.sport,
      status: game.status,
      segment: game.segment,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      homeColor: game.homeColor,
      awayColor: game.awayColor,
      clockMs: game.clockMs,
      clockRunning: game.clockRunning,
      clockUpdatedAt: game.clockUpdatedAt,
      stats: game.stats,
      cues: cues.map((c) => ({
        id: c.id,
        ...(c.payload as Record<string, unknown>),
        createdAt: c.createdAt,
      })),
      sponsors,
      sponsorSpotSeconds: SPONSOR_SPOT_SECONDS,
      serverTime: Date.now(),
    };
  }

  // ── writes ───────────────────────────────────────────────────

  async createGame(
    tenantId: string,
    dto: {
      sport?: string;
      homeTeam?: string;
      awayTeam?: string;
      homeColor?: string;
      awayColor?: string;
      screenGroupId?: string;
      status?: string;
    },
  ) {
    const def = this.sportOf(String(dto.sport || ''));
    const homeTeam = String(dto.homeTeam || '').trim();
    const awayTeam = String(dto.awayTeam || '').trim();
    if (!homeTeam || !awayTeam) {
      throw new BadRequestException('homeTeam and awayTeam are required');
    }
    const status = dto.status && GAME_STATUSES.includes(dto.status) ? dto.status : 'SCHEDULED';

    return this.prisma.client.game.create({
      data: {
        tenantId,
        sport: def.key,
        homeTeam: homeTeam.slice(0, 80),
        awayTeam: awayTeam.slice(0, 80),
        homeColor: dto.homeColor?.slice(0, 32) || null,
        awayColor: dto.awayColor?.slice(0, 32) || null,
        screenGroupId: dto.screenGroupId || null,
        status,
        segment: 1,
        clockMs: this.segmentStartMs(def),
        clockRunning: false,
        clockUpdatedAt: new Date(),
        stats: {},
      },
    });
  }

  async deleteGame(tenantId: string, id: string) {
    await this.owned(tenantId, id);
    // Release any screens pushing this game's scoreboard so they fall
    // back to their scheduled content (the pointer has no FK).
    await this.prisma.client.screen.updateMany({
      where: { tenantId, activeBoardGameId: id },
      data: { activeBoardGameId: null },
    });
    await this.prisma.client.game.delete({ where: { id } }); // cascades events
    return { deleted: true };
  }

  // ── scoreboard-to-screen push ────────────────────────────────

  /** Tenant's screens + whether each currently shows this game's board. */
  async listGameScreens(tenantId: string, gameId: string) {
    await this.owned(tenantId, gameId);
    const screens = await this.prisma.client.screen.findMany({
      where: { tenantId },
      select: { id: true, name: true, status: true, activeBoardGameId: true },
      orderBy: { name: 'asc' },
    });
    return screens.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      showing: s.activeBoardGameId === gameId,
      showingOther: !!s.activeBoardGameId && s.activeBoardGameId !== gameId,
    }));
  }

  /** Push this game's live scoreboard to the given screens. */
  async showOnScreens(tenantId: string, gameId: string, screenIds: unknown) {
    await this.owned(tenantId, gameId);
    const ids = Array.isArray(screenIds)
      ? screenIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
    if (ids.length === 0) throw new BadRequestException('screenIds is required');
    await this.prisma.client.screen.updateMany({
      where: { id: { in: ids }, tenantId },
      data: { activeBoardGameId: gameId },
    });
    return this.listGameScreens(tenantId, gameId);
  }

  /** Stop showing this game — on a given subset, or every screen. */
  async hideFromScreens(tenantId: string, gameId: string, screenIds?: unknown) {
    await this.owned(tenantId, gameId);
    const where: Record<string, unknown> = { tenantId, activeBoardGameId: gameId };
    if (Array.isArray(screenIds) && screenIds.length > 0) {
      where.id = {
        in: screenIds.filter((x): x is string => typeof x === 'string' && x.length > 0),
      };
    }
    await this.prisma.client.screen.updateMany({ where, data: { activeBoardGameId: null } });
    return this.listGameScreens(tenantId, gameId);
  }

  /** Adjust a score by a signed delta (the quick +1/+2/+3/… buttons). */
  async adjustScore(
    tenantId: string,
    id: string,
    dto: { team?: string; delta?: number },
  ) {
    await this.owned(tenantId, id);
    const team = dto.team === 'away' ? 'away' : 'home';
    const delta = Number(dto.delta);
    if (!Number.isFinite(delta) || !Number.isInteger(delta)) {
      throw new BadRequestException('delta must be an integer');
    }
    // Atomic increment — two operators tapping a score button in the
    // same instant can't lose a point (a read-modify-write would).
    let updated = await this.prisma.client.game.update({
      where: { id },
      data:
        team === 'home'
          ? { homeScore: { increment: delta } }
          : { awayScore: { increment: delta } },
    });
    // A score never goes below zero (e.g. a −1 correction at 0).
    const value = team === 'home' ? updated.homeScore : updated.awayScore;
    if (value < 0) {
      updated = await this.prisma.client.game.update({
        where: { id },
        data: team === 'home' ? { homeScore: 0 } : { awayScore: 0 },
      });
    }
    await this.record(id, 'SCORE', {
      team,
      delta,
      homeScore: updated.homeScore,
      awayScore: updated.awayScore,
    });
    return updated;
  }

  /** Set both scores outright (operator typo fix). */
  async setScore(
    tenantId: string,
    id: string,
    dto: { homeScore?: number; awayScore?: number },
  ) {
    const game = await this.owned(tenantId, id);
    const clamp = (v: unknown, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : fallback;
    };
    const homeScore = clamp(dto.homeScore, game.homeScore);
    const awayScore = clamp(dto.awayScore, game.awayScore);

    const updated = await this.prisma.client.game.update({
      where: { id },
      data: { homeScore, awayScore },
    });
    await this.record(id, 'SCORE', { team: 'set', homeScore, awayScore });
    return updated;
  }

  /** Clock control: start | pause | set | reset. */
  async clockAction(
    tenantId: string,
    id: string,
    dto: { action?: string; ms?: number },
  ) {
    const game = await this.owned(tenantId, id);
    const def = this.sportOf(game.sport);
    const action = String(dto.action || '') as ClockAction;
    const now = new Date();

    let clockMs = game.clockMs;
    let clockRunning = game.clockRunning;

    switch (action) {
      case 'start':
        if (def.clock.type === 'none') {
          throw new BadRequestException(`${def.name} has no game clock`);
        }
        // Re-anchor at the current reading and let it run.
        clockMs = this.liveClockMs(game);
        clockRunning = true;
        break;
      case 'pause':
        // Freeze: store the live reading, stop advancing.
        clockMs = this.liveClockMs(game);
        clockRunning = false;
        break;
      case 'set': {
        const ms = Number(dto.ms);
        if (!Number.isFinite(ms) || ms < 0) {
          throw new BadRequestException('ms must be a non-negative number');
        }
        clockMs = Math.round(ms);
        break;
      }
      case 'reset':
        clockMs = this.segmentStartMs(def);
        clockRunning = false;
        break;
      default:
        throw new BadRequestException('action must be start | pause | set | reset');
    }

    const updated = await this.prisma.client.game.update({
      where: { id },
      data: { clockMs, clockRunning, clockUpdatedAt: now },
    });
    await this.record(id, 'CLOCK', { action, clockMs, clockRunning });
    return updated;
  }

  /** Advance / set the segment (quarter, inning, set, period). */
  async setSegment(
    tenantId: string,
    id: string,
    dto: { segment?: number; delta?: number },
  ) {
    const game = await this.owned(tenantId, id);
    const def = this.sportOf(game.sport);

    let segment = game.segment;
    if (typeof dto.segment === 'number') {
      segment = Math.round(dto.segment);
    } else if (typeof dto.delta === 'number') {
      segment = game.segment + Math.round(dto.delta);
    } else {
      throw new BadRequestException('provide segment or delta');
    }
    // Allow overtime segments past the regulation count when the sport
    // supports OT; otherwise clamp to [1, count].
    const max = def.segment.overtime ? def.segment.count + 10 : def.segment.count;
    segment = Math.min(max, Math.max(1, segment));

    // Advancing the segment resets the clock to the segment start and
    // stops it — for countdown AND countup. Count-up halves restart
    // from 0; without re-anchoring here, a running soccer clock would
    // jump forward by the entire halftime gap. 'none' clocks (baseball,
    // volleyball) have no clock to reset.
    const data: Record<string, unknown> = { segment };
    if (def.clock.type !== 'none') {
      data.clockMs = this.segmentStartMs(def);
      data.clockRunning = false;
      data.clockUpdatedAt = new Date();
    }

    const updated = await this.prisma.client.game.update({ where: { id }, data });
    await this.record(id, 'SEGMENT', { segment });
    return updated;
  }

  /** Merge sport-specific stat values into the game's stats JSON. */
  async updateStats(
    tenantId: string,
    id: string,
    dto: { stats?: Record<string, unknown> },
  ) {
    const game = await this.owned(tenantId, id);
    if (!dto.stats || typeof dto.stats !== 'object' || Array.isArray(dto.stats)) {
      throw new BadRequestException('stats must be an object');
    }
    const def = this.sportOf(game.sport);
    const allowed = new Set(def.stats.map((s) => s.key));
    const current = (game.stats as Record<string, unknown>) || {};
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(dto.stats)) {
      if (!allowed.has(key)) continue;
      // Bound the value: strings capped at 200 chars, numbers/booleans
      // pass, anything else (object/array) dropped — so a stat edit
      // can't bloat the game's stats JSON column.
      if (typeof value === 'string') next[key] = value.slice(0, 200);
      else if (typeof value === 'number' || typeof value === 'boolean') next[key] = value;
    }

    const updated = await this.prisma.client.game.update({
      where: { id },
      data: { stats: next as any },
    });
    await this.record(id, 'STAT', { stats: next });
    return updated;
  }

  /** Change the game status (SCHEDULED → LIVE → HALFTIME → FINAL …). */
  async setStatus(tenantId: string, id: string, dto: { status?: string }) {
    const game = await this.owned(tenantId, id);
    const status = String(dto.status || '');
    if (!GAME_STATUSES.includes(status)) {
      throw new BadRequestException(`status must be one of ${GAME_STATUSES.join(', ')}`);
    }
    const data: Record<string, unknown> = { status };
    if (status === 'LIVE' && !game.startedAt) data.startedAt = new Date();
    if (status === 'FINAL') {
      data.endedAt = new Date();
      data.clockRunning = false;
    }

    const updated = await this.prisma.client.game.update({ where: { id }, data });
    await this.record(id, 'STATUS', { status });
    return updated;
  }

  /**
   * Fire a celebration cue. The operator taps "Touchdown" / "GOAL!" /
   * "Home Run" and every surface playing this game fires the animation.
   * The cue key must be one the sport defines.
   */
  async fireCue(tenantId: string, id: string, dto: { key?: string }) {
    const game = await this.owned(tenantId, id);
    const def = this.sportOf(game.sport);
    const cue = def.celebrations.find((c) => c.key === dto.key);
    if (!cue) {
      throw new BadRequestException(
        `Unknown cue "${dto.key}" for ${def.name}`,
      );
    }
    const event = await this.record(id, 'CUE', {
      key: cue.key,
      label: cue.label,
      emoji: cue.emoji,
    });
    return { fired: true, cue, eventId: event.id };
  }
}
