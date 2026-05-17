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
    const [cues, sponsors, roster] = await Promise.all([
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
      // The roster — drives player cards on the ribbon + scoreboard.
      this.prisma.client.rosterPlayer.findMany({
        where: { gameId: id },
        orderBy: [{ team: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true, team: true, name: true, number: true,
          position: true, photoUrl: true, stats: true,
        },
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
      homeLogoUrl: game.homeLogoUrl,
      awayLogoUrl: game.awayLogoUrl,
      clockMs: game.clockMs,
      clockRunning: game.clockRunning,
      clockUpdatedAt: game.clockUpdatedAt,
      stats: game.stats,
      spotlight: game.spotlight,
      cues: cues.map((c) => ({
        id: c.id,
        ...(c.payload as Record<string, unknown>),
        createdAt: c.createdAt,
      })),
      sponsors,
      roster,
      sponsorSpotSeconds: SPONSOR_SPOT_SECONDS,
      serverTime: Date.now(),
    };
  }

  // ── writes ───────────────────────────────────────────────────

  /** Bound a logo URL — trim, cap length, drop empties. */
  private cleanLogo(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const s = value.trim();
    return s ? s.slice(0, 2048) : null;
  }

  async createGame(
    tenantId: string,
    dto: {
      sport?: string;
      homeTeam?: string;
      awayTeam?: string;
      homeColor?: string;
      awayColor?: string;
      homeLogoUrl?: string;
      awayLogoUrl?: string;
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
        homeLogoUrl: this.cleanLogo(dto.homeLogoUrl),
        awayLogoUrl: this.cleanLogo(dto.awayLogoUrl),
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

  /**
   * Edit a game's identity — team names, colors, logos. Lets an
   * operator fix a typo or drop in a brand logo without recreating
   * the game (and losing the score/clock). Tenant-scoped.
   */
  async updateGameDetails(
    tenantId: string,
    id: string,
    dto: {
      homeTeam?: string;
      awayTeam?: string;
      homeColor?: string;
      awayColor?: string;
      homeLogoUrl?: string | null;
      awayLogoUrl?: string | null;
    },
  ) {
    await this.owned(tenantId, id);
    const data: Record<string, unknown> = {};
    if (dto.homeTeam !== undefined) {
      const t = String(dto.homeTeam).trim();
      if (!t) throw new BadRequestException('homeTeam cannot be empty');
      data.homeTeam = t.slice(0, 80);
    }
    if (dto.awayTeam !== undefined) {
      const t = String(dto.awayTeam).trim();
      if (!t) throw new BadRequestException('awayTeam cannot be empty');
      data.awayTeam = t.slice(0, 80);
    }
    if (dto.homeColor !== undefined) data.homeColor = dto.homeColor?.slice(0, 32) || null;
    if (dto.awayColor !== undefined) data.awayColor = dto.awayColor?.slice(0, 32) || null;
    if (dto.homeLogoUrl !== undefined) data.homeLogoUrl = this.cleanLogo(dto.homeLogoUrl);
    if (dto.awayLogoUrl !== undefined) data.awayLogoUrl = this.cleanLogo(dto.awayLogoUrl);
    return this.prisma.client.game.update({ where: { id }, data });
  }

  /**
   * Set (or clear) the broadcast spotlight — the featured-player /
   * promo panel on the scoreboard: a title, photo, subtitle, and up
   * to four stat lines. `clear` wipes it; otherwise the whole panel
   * is replaced. `visible` lets the operator stage a player and
   * toggle the panel on/off without losing the content.
   */
  async setSpotlight(
    tenantId: string,
    id: string,
    dto: {
      clear?: boolean;
      visible?: boolean;
      title?: string;
      photoUrl?: string;
      subtitle?: string;
      lines?: Array<{ label?: string; value?: string }>;
    },
  ) {
    await this.owned(tenantId, id);
    if (dto.clear) {
      return this.prisma.client.game.update({
        where: { id },
        data: { spotlight: {} },
      });
    }
    const title = String(dto.title ?? '').trim().slice(0, 80);
    if (!title) throw new BadRequestException('Spotlight title is required');
    const lines = Array.isArray(dto.lines)
      ? dto.lines
          .slice(0, 4)
          .map((l) => ({
            label: String(l?.label ?? '').trim().slice(0, 24),
            value: String(l?.value ?? '').trim().slice(0, 24),
          }))
          .filter((l) => l.label || l.value)
      : [];
    const spotlight = {
      visible: dto.visible !== false,
      title,
      photoUrl: this.cleanLogo(dto.photoUrl),
      subtitle: String(dto.subtitle ?? '').trim().slice(0, 80),
      lines,
    };
    return this.prisma.client.game.update({
      where: { id },
      data: { spotlight: spotlight as any },
    });
  }

  async deleteGame(tenantId: string, id: string) {
    await this.owned(tenantId, id);
    // Release any screens pushing this game's scoreboard so they fall
    // back to their scheduled content (the pointer has no FK).
    await this.prisma.client.screen.updateMany({
      where: { tenantId, activeBoardGameId: id },
      data: { activeBoardGameId: null, activeBoardSurface: null },
    });
    await this.prisma.client.game.delete({ where: { id } }); // cascades events
    return { deleted: true };
  }

  // ── scoreboard-to-screen push ────────────────────────────────

  /** The valid sports display surfaces an operator can push to a screen. */
  static readonly BOARD_SURFACES = ['BOARD', 'RIBBON', 'SCOREBUG'] as const;

  /** Normalize an untrusted surface value; defaults to BOARD. */
  private cleanSurface(surface: unknown): 'BOARD' | 'RIBBON' | 'SCOREBUG' {
    const s = String(surface || 'BOARD').toUpperCase();
    return s === 'RIBBON' || s === 'SCOREBUG' ? s : 'BOARD';
  }

  /**
   * Tenant's screens + whether each currently shows this game, and which
   * surface (scoreboard / ribbon / scorebug) it's showing.
   */
  async listGameScreens(tenantId: string, gameId: string) {
    await this.owned(tenantId, gameId);
    const screens = await this.prisma.client.screen.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        status: true,
        activeBoardGameId: true,
        activeBoardSurface: true,
      },
      orderBy: { name: 'asc' },
    });
    return screens.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      showing: s.activeBoardGameId === gameId,
      showingOther: !!s.activeBoardGameId && s.activeBoardGameId !== gameId,
      // The surface this screen renders when it IS showing this game.
      // Null surface on a pushed screen reads as BOARD (back-compat).
      surface:
        s.activeBoardGameId === gameId ? s.activeBoardSurface || 'BOARD' : null,
    }));
  }

  /**
   * Push this game to the given screens on a chosen surface — the full
   * scoreboard (BOARD), the LED ribbon (RIBBON), or the broadcast
   * scorebug (SCOREBUG). Defaults to BOARD.
   */
  async showOnScreens(
    tenantId: string,
    gameId: string,
    screenIds: unknown,
    surface?: unknown,
  ) {
    await this.owned(tenantId, gameId);
    const ids = Array.isArray(screenIds)
      ? screenIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
    if (ids.length === 0) throw new BadRequestException('screenIds is required');
    await this.prisma.client.screen.updateMany({
      where: { id: { in: ids }, tenantId },
      data: { activeBoardGameId: gameId, activeBoardSurface: this.cleanSurface(surface) },
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
    await this.prisma.client.screen.updateMany({
      where,
      data: { activeBoardGameId: null, activeBoardSurface: null },
    });
    return this.listGameScreens(tenantId, gameId);
  }

  // ── roster ───────────────────────────────────────────────────

  private cleanTeam(team: unknown): 'home' | 'away' {
    return String(team || '').toLowerCase() === 'away' ? 'away' : 'home';
  }

  /** Bound a free-text roster field — trim, cap length, null empties. */
  private cleanText(value: unknown, max: number): string | null {
    const s = String(value ?? '').trim().slice(0, max);
    return s || null;
  }

  /**
   * Normalize an untrusted stat map: string keys → string values,
   * trimmed and length-capped, max 24 entries. Keeps the scoreboard
   * safe from a pasted CSV with hundreds of junk columns.
   */
  private cleanStats(input: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (input && typeof input === 'object') {
      for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
        const key = String(k).trim().slice(0, 24);
        if (!key) continue;
        const val = String(v ?? '').trim().slice(0, 40);
        if (!val) continue;
        out[key] = val;
        if (Object.keys(out).length >= 24) break;
      }
    }
    return out;
  }

  /** Every player on a game, home + away, in display order. */
  async listRoster(tenantId: string, gameId: string) {
    await this.owned(tenantId, gameId);
    return this.prisma.client.rosterPlayer.findMany({
      where: { gameId },
      orderBy: [{ team: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Add one player to a game's roster. */
  async addPlayer(
    tenantId: string,
    gameId: string,
    dto: {
      team?: string; name?: string; number?: string;
      position?: string; photoUrl?: string; stats?: unknown;
    },
  ) {
    await this.owned(tenantId, gameId);
    const name = this.cleanText(dto.name, 80);
    if (!name) throw new BadRequestException('Player name is required.');
    const team = this.cleanTeam(dto.team);
    const sortOrder = await this.prisma.client.rosterPlayer.count({
      where: { gameId, team },
    });
    return this.prisma.client.rosterPlayer.create({
      data: {
        tenantId,
        gameId,
        team,
        name,
        number: this.cleanText(dto.number, 8),
        position: this.cleanText(dto.position, 24),
        photoUrl: this.cleanText(dto.photoUrl, 2048),
        stats: this.cleanStats(dto.stats),
        sortOrder,
      },
    });
  }

  /** Resolve a player within a tenant-owned game, or 404. */
  private async ownedPlayer(tenantId: string, gameId: string, playerId: string) {
    await this.owned(tenantId, gameId);
    const player = await this.prisma.client.rosterPlayer.findFirst({
      where: { id: playerId, gameId },
    });
    if (!player) throw new NotFoundException('Player not found');
    return player;
  }

  /** Edit a player — only the keys present in the dto are touched. */
  async updatePlayer(
    tenantId: string,
    gameId: string,
    playerId: string,
    dto: {
      team?: string; name?: string; number?: string;
      position?: string; photoUrl?: string; stats?: unknown;
    },
  ) {
    await this.ownedPlayer(tenantId, gameId, playerId);
    const data: Record<string, unknown> = {};
    if (dto.team !== undefined) data.team = this.cleanTeam(dto.team);
    if (dto.name !== undefined) {
      const n = this.cleanText(dto.name, 80);
      if (!n) throw new BadRequestException('Player name cannot be empty.');
      data.name = n;
    }
    if (dto.number !== undefined) data.number = this.cleanText(dto.number, 8);
    if (dto.position !== undefined) data.position = this.cleanText(dto.position, 24);
    if (dto.photoUrl !== undefined) data.photoUrl = this.cleanText(dto.photoUrl, 2048);
    if (dto.stats !== undefined) data.stats = this.cleanStats(dto.stats);
    return this.prisma.client.rosterPlayer.update({ where: { id: playerId }, data });
  }

  /** Remove a player from the roster. */
  async deletePlayer(tenantId: string, gameId: string, playerId: string) {
    await this.ownedPlayer(tenantId, gameId, playerId);
    await this.prisma.client.rosterPlayer.delete({ where: { id: playerId } });
    return { deleted: true };
  }

  /**
   * Parse one CSV line into cells — handles double-quoted fields with
   * embedded commas and "" escapes. Good enough for roster CSVs an
   * operator exports from a spreadsheet.
   */
  private parseCsvLine(line: string): string[] {
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else { cur += ch; }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(cur); cur = '';
      } else { cur += ch; }
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
  }

  /**
   * Bulk-import a roster from CSV text. The header row names the
   * columns: `team`, `name`/`player`, `number`/`no`/`#`,
   * `position`/`pos`, and `photo`/`photourl` are recognized — EVERY
   * other column becomes a stat keyed by its (upper-cased) header.
   * Imported players are appended; existing roster is kept.
   */
  async importRosterCsv(tenantId: string, gameId: string, csvText: string) {
    await this.owned(tenantId, gameId);
    const lines = String(csvText || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 2) {
      throw new BadRequestException('CSV needs a header row and at least one player row.');
    }
    if (lines.length - 1 > 200) {
      throw new BadRequestException('CSV is limited to 200 players per import.');
    }
    const header = this.parseCsvLine(lines[0]).map((h) => h.toLowerCase());
    const idxOf = (...keys: string[]) => header.findIndex((h) => keys.includes(h));
    const nameIdx = idxOf('name', 'player');
    if (nameIdx < 0) {
      throw new BadRequestException('CSV must have a "name" column.');
    }
    const teamIdx = idxOf('team');
    const numberIdx = idxOf('number', 'no', '#');
    const posIdx = idxOf('position', 'pos');
    const photoIdx = idxOf('photo', 'photourl', 'photo_url');
    const FIELD = new Set([
      'team', 'name', 'player', 'number', 'no', '#',
      'position', 'pos', 'photo', 'photourl', 'photo_url',
    ]);

    const [homeCount, awayCount] = await Promise.all([
      this.prisma.client.rosterPlayer.count({ where: { gameId, team: 'home' } }),
      this.prisma.client.rosterPlayer.count({ where: { gameId, team: 'away' } }),
    ]);
    const nextOrder: Record<string, number> = { home: homeCount, away: awayCount };

    const rows: any[] = [];
    for (let r = 1; r < lines.length; r++) {
      const cells = this.parseCsvLine(lines[r]);
      const name = this.cleanText(cells[nameIdx], 80);
      if (!name) continue;
      const team = this.cleanTeam(teamIdx >= 0 ? cells[teamIdx] : 'home');
      const stats: Record<string, string> = {};
      header.forEach((h, i) => {
        if (!h || FIELD.has(h)) return;
        const val = String(cells[i] ?? '').trim();
        if (val) stats[h.toUpperCase()] = val;
      });
      rows.push({
        tenantId,
        gameId,
        team,
        name,
        number: numberIdx >= 0 ? this.cleanText(cells[numberIdx], 8) : null,
        position: posIdx >= 0 ? this.cleanText(cells[posIdx], 24) : null,
        photoUrl: photoIdx >= 0 ? this.cleanText(cells[photoIdx], 2048) : null,
        stats: this.cleanStats(stats),
        sortOrder: nextOrder[team]++,
      });
    }
    if (rows.length === 0) {
      throw new BadRequestException('No valid player rows found in the CSV.');
    }
    await this.prisma.client.rosterPlayer.createMany({ data: rows });
    return this.listRoster(tenantId, gameId);
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
