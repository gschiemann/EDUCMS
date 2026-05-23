import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { SponsorsService } from './sponsors.service';
import {
  findSport,
  SPORTS,
  resolveRibbonPresets,
  sanitizeRibbonPresets,
  sanitizeRibbonSpeed,
  sanitizeRibbonScoreRepeat,
} from '@cms/api-types';
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

  // Per-game AUTO-celebrate toggle cache. Default ON; hydrated once per
  // gameId from the latest AUTO_CELEBRATE GameEvent on first feed touch,
  // then updated in place by setAutoCelebrate. Keeps the feed hot path
  // (ingest, 1-10 pushes/sec) from re-reading the toggle on every push.
  // Per-process — a single Railway instance; a cold start re-hydrates from
  // the persisted event, so an operator's OFF survives a restart.
  private readonly autoCelebrateCache = new Map<string, boolean>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly signer: WebsocketSignerService,
    @Inject(forwardRef(() => SponsorsService))
    private readonly sponsorsService: SponsorsService,
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

  /** Public ownership assertion (controllers that need to gate on tenant
   *  ownership without otherwise touching the game, e.g. feed-credentials). */
  async assertGameOwned(tenantId: string, id: string): Promise<void> {
    await this.owned(tenantId, id);
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

  /**
   * The current operator-set ribbon messages — the payload of the most
   * recent RIBBON GameEvent. The ribbon scrolls these in place of the
   * default crowd prompts. No new table: RIBBON rides the generic
   * GameEvent log, latest-event-wins.
   */
  private async latestRibbonMessages(gameId: string): Promise<string[]> {
    const ev = await this.prisma.client.gameEvent.findFirst({
      where: { gameId, type: 'RIBBON' },
      orderBy: { createdAt: 'desc' },
    });
    const raw = (ev?.payload as Record<string, unknown> | undefined)?.messages;
    return Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string') : [];
  }

  /**
   * The operator's stored ribbon preset config — the payload of the
   * most recent RIBBON_PRESETS GameEvent, or null when the reel has
   * never been configured. Rides the generic GameEvent log,
   * latest-event-wins — same pattern as RIBBON messages.
   */
  private async latestRibbonPresets(gameId: string): Promise<string[] | null> {
    const ev = await this.prisma.client.gameEvent.findFirst({
      where: { gameId, type: 'RIBBON_PRESETS' },
      orderBy: { createdAt: 'desc' },
    });
    if (!ev) return null;
    const raw = (ev.payload as Record<string, unknown> | undefined)?.presets;
    return Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string') : [];
  }

  /**
   * The EFFECTIVE ribbon preset list for a game — the stored config,
   * or the sport's full default-on set when the reel was never
   * configured. The ribbon page and the control panel both consume
   * this resolved array, so neither has to special-case "no config".
   */
  private async ribbonPresetsFor(gameId: string, sportKey: string): Promise<string[]> {
    const def = findSport(sportKey);
    if (!def) return [];
    return resolveRibbonPresets(def, await this.latestRibbonPresets(gameId));
  }

  /**
   * The ribbon's scroll speed — the latest RIBBON_SPEED event,
   * normalized to a known speed, defaulting to 'normal'.
   */
  private async latestRibbonSpeed(gameId: string): Promise<string> {
    const ev = await this.prisma.client.gameEvent.findFirst({
      where: { gameId, type: 'RIBBON_SPEED' },
      orderBy: { createdAt: 'desc' },
    });
    return sanitizeRibbonSpeed((ev?.payload as Record<string, unknown> | undefined)?.speed);
  }

  /**
   * The operator's full-bleed ribbon image slides — the URL list
   * from the latest RIBBON_SLIDES event. Rides the generic
   * GameEvent log, latest-event-wins.
   */
  private async latestRibbonSlides(gameId: string): Promise<string[]> {
    const ev = await this.prisma.client.gameEvent.findFirst({
      where: { gameId, type: 'RIBBON_SLIDES' },
      orderBy: { createdAt: 'desc' },
    });
    const raw = (ev?.payload as Record<string, unknown> | undefined)?.slides;
    return Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string') : [];
  }

  /**
   * How many times the score anchor repeats around the ribbon — the
   * latest RIBBON_SCORE event, normalized to a known value, default
   * 'auto'. A continuous full-bowl wrap repeats the score so it stays
   * readable from every seat. Rides the generic GameEvent log.
   */
  private async latestRibbonScoreRepeat(gameId: string): Promise<string> {
    const ev = await this.prisma.client.gameEvent.findFirst({
      where: { gameId, type: 'RIBBON_SCORE' },
      orderBy: { createdAt: 'desc' },
    });
    return sanitizeRibbonScoreRepeat((ev?.payload as Record<string, unknown> | undefined)?.repeat);
  }

  /**
   * One game, tenant-scoped — for the operator control surface.
   * Includes the current custom ribbon messages, the effective
   * preset config, the scroll speed, and the image slides so every
   * ribbon panel can pre-fill.
   */
  async getGame(tenantId: string, id: string) {
    const game = await this.owned(tenantId, id);
    const [ribbonMessages, ribbonPresets, ribbonSpeed, ribbonSlides, ribbonScoreRepeat] = await Promise.all([
      this.latestRibbonMessages(id),
      this.ribbonPresetsFor(id, game.sport),
      this.latestRibbonSpeed(id),
      this.latestRibbonSlides(id),
      this.latestRibbonScoreRepeat(id),
    ]);
    return { ...game, ribbonMessages, ribbonPresets, ribbonSpeed, ribbonSlides, ribbonScoreRepeat };
  }

  /**
   * Public board view — by game id only, NOT tenant-scoped. Scoreboard
   * data (score, clock, team names) is inherently public: it is shown
   * on a stadium display. The id is an unguessable UUID. Returns the
   * raw clock anchor (board ticks locally) + the recent celebration
   * cue feed (board dedupes by event id and fires new ones).
   */
  async getBoard(id: string) {
    // Lane-4 P0 fix: explicit `select` so this hot poll (every 750ms × N
    // viewers per game) only ships the fields the board actually consumes,
    // not every column on the row. Combined with the future ETag/cache layer
    // this measurably drops egress per game.
    const game = await this.prisma.client.game.findUnique({
      where: { id },
      select: {
        id: true, tenantId: true, sport: true, status: true, segment: true,
        homeTeam: true, awayTeam: true, homeScore: true, awayScore: true,
        homeColor: true, awayColor: true, homeLogoUrl: true, awayLogoUrl: true,
        clockMs: true, clockRunning: true, clockUpdatedAt: true,
        startedAt: true, stats: true, spotlight: true,
        scoreboardTemplateId: true, ribbonTemplateId: true, scorebugTemplateId: true,
      },
    });
    if (!game) throw new NotFoundException('Game not found');

    const since = new Date(Date.now() - CUE_FEED_WINDOW_MS);
    const [cues, sponsors, roster, ribbonMessages, ribbonPresets, ribbonSpeed, ribbonSlides, ribbonScoreRepeat] = await Promise.all([
      this.prisma.client.gameEvent.findMany({
        where: { gameId: id, type: 'CUE', createdAt: { gte: since } },
        orderBy: { createdAt: 'asc' },
      }),
      // Active, in-flight sponsors for the board's banner slot — routed
      // through SponsorsService.listActive so flight-window filtering
      // (flightStartAt / flightEndAt) is always applied consistently.
      // Public by design — sponsors exist to be shown on the scoreboard.
      this.sponsorsService.listActive(game.tenantId),
      // The roster — drives player cards on the ribbon + scoreboard.
      this.prisma.client.rosterPlayer.findMany({
        where: { gameId: id },
        orderBy: [{ team: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true, team: true, name: true, number: true,
          position: true, photoUrl: true, stats: true,
        },
      }),
      // Operator-set ribbon messages — the latest RIBBON event wins.
      this.latestRibbonMessages(id),
      // Which content presets ride the ribbon reel (resolved — stored
      // config, or the sport's full default-on set).
      this.ribbonPresetsFor(id, game.sport),
      // Ribbon scroll speed + the operator's full-bleed image slides.
      this.latestRibbonSpeed(id),
      this.latestRibbonSlides(id),
      // How many times the score anchor repeats around the ribbon.
      this.latestRibbonScoreRepeat(id),
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
      cues: cues.map((c) => {
        const p = (c.payload as Record<string, unknown>) ?? {};
        return {
          id: c.id,
          ...p,
          // Explicit contract fields — always present, null when absent so
          // the frontend never has to guard against `undefined`.
          audioUrl: (p.audioUrl as string | null) ?? null,
          sponsorName: (p.sponsorName as string | null) ?? null,
          sponsorLogoUrl: (p.sponsorLogoUrl as string | null) ?? null,
          createdAt: c.createdAt,
        };
      }),
      sponsors,
      roster,
      ribbonMessages,
      ribbonPresets,
      ribbonSpeed,
      ribbonSlides,
      ribbonScoreRepeat,
      sponsorSpotSeconds: SPONSOR_SPOT_SECONDS,
      serverTime: Date.now(),
      // Sprint 13 — operator-picked custom layout IDs. Each route
      // (/board /ribbon /scorebug) checks the matching field and,
      // if non-null, fetches + renders that Template (wrapped in
      // GameStateProvider) instead of the legacy hardcoded layout.
      scoreboardTemplateId: game.scoreboardTemplateId,
      ribbonTemplateId: game.ribbonTemplateId,
      scorebugTemplateId: game.scorebugTemplateId,
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
      // Sprint 13 — operator-picked custom layouts.
      scoreboardTemplateId?: string | null;
      ribbonTemplateId?: string | null;
      scorebugTemplateId?: string | null;
    },
  ) {
    const def = this.sportOf(String(dto.sport || ''));
    const homeTeam = String(dto.homeTeam || '').trim();
    const awayTeam = String(dto.awayTeam || '').trim();
    if (!homeTeam || !awayTeam) {
      throw new BadRequestException('homeTeam and awayTeam are required');
    }
    const status = dto.status && GAME_STATUSES.includes(dto.status) ? dto.status : 'SCHEDULED';

    // Seed per-team timeout counts to their max so the broadcast
    // timeout pips read full from the opening whistle — an unset
    // count renders as zero filled pips ("no timeouts left"), which
    // is wrong before a single timeout has been called.
    const initialStats: Record<string, number> = {};
    for (const key of ['homeTimeouts', 'awayTimeouts']) {
      const field = def.stats.find((s) => s.key === key);
      if (field && typeof field.max === 'number') initialStats[key] = field.max;
    }

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
        stats: initialStats,
        scoreboardTemplateId: dto.scoreboardTemplateId || null,
        ribbonTemplateId: dto.ribbonTemplateId || null,
        scorebugTemplateId: dto.scorebugTemplateId || null,
      },
    });
  }

  /**
   * Duplicate a game — clone its full PRESENTATION setup into a fresh
   * SCHEDULED game. Operator (2026-05-20): "if I have 5 games this week
   * I can build out all the content ahead of time." Per-game pre-build
   * already works on any SCHEDULED game; this is the "build once, reuse"
   * shortcut so a whole week of games starts from a finished template
   * instead of being assembled five times.
   *
   * Copies (the reusable presentation):
   *   - identity: sport, team names, colors, logos
   *   - the three surface template assignments (scoreboard / ribbon /
   *     scorebug)
   *   - ribbon config: messages, presets, speed, slides, score-repeat —
   *     replayed as fresh GameEvents on the new game (that's where the
   *     ribbon state lives; latest-event-wins)
   *   - roster (home + away players) so the lineup is a starting point
   *
   * Resets (never inherit live state): score, clock, segment, status
   * (always a clean SCHEDULED game), the broadcast spotlight (live
   * content, not setup), and the screen-group binding (a duplicate must
   * never silently start pushing to the source's live screens).
   *
   * Sponsors + custom cues are already tenant-level and reusable, so
   * they carry over for free with no copy. Tenant-scoped; additive — no
   * schema change.
   */
  async duplicateGame(tenantId: string, id: string) {
    const src = await this.owned(tenantId, id);
    const def = this.sportOf(src.sport);

    // Latest-wins ribbon config rows on the source (any may be absent).
    const ribbonTypes = [
      'RIBBON',
      'RIBBON_PRESETS',
      'RIBBON_SPEED',
      'RIBBON_SLIDES',
      'RIBBON_SCORE',
    ];
    const ribbonEvents = await Promise.all(
      ribbonTypes.map((type) =>
        this.prisma.client.gameEvent.findFirst({
          where: { gameId: id, type },
          orderBy: { createdAt: 'desc' },
        }),
      ),
    );

    // Seed timeouts fresh from the sport (mirrors createGame) so the
    // copy opens with full timeout pips, not the source's depleted count.
    const initialStats: Record<string, number> = {};
    for (const key of ['homeTimeouts', 'awayTimeouts']) {
      const field = def.stats.find((s) => s.key === key);
      if (field && typeof field.max === 'number') initialStats[key] = field.max;
    }

    const copy = await this.prisma.client.game.create({
      data: {
        tenantId,
        sport: src.sport,
        homeTeam: src.homeTeam,
        awayTeam: src.awayTeam,
        homeColor: src.homeColor,
        awayColor: src.awayColor,
        homeLogoUrl: src.homeLogoUrl,
        awayLogoUrl: src.awayLogoUrl,
        screenGroupId: null, // never inherit the source's live screen binding
        status: 'SCHEDULED',
        segment: 1,
        clockMs: this.segmentStartMs(def),
        clockRunning: false,
        clockUpdatedAt: new Date(),
        stats: initialStats,
        scoreboardTemplateId: src.scoreboardTemplateId,
        ribbonTemplateId: src.ribbonTemplateId,
        scorebugTemplateId: src.scorebugTemplateId,
      },
    });

    // Replay the ribbon config onto the copy (only events that exist).
    for (const ev of ribbonEvents) {
      if (ev) {
        await this.record(copy.id, ev.type, ev.payload as Record<string, unknown>);
      }
    }

    // Clone the roster (home + away). Players are per-game; copying
    // gives the operator the lineup to tweak rather than re-enter it.
    const roster = await this.prisma.client.rosterPlayer.findMany({
      where: { gameId: id },
      orderBy: { sortOrder: 'asc' },
    });
    if (roster.length > 0) {
      await this.prisma.client.rosterPlayer.createMany({
        data: roster.map((p) => ({
          tenantId,
          gameId: copy.id,
          team: p.team,
          name: p.name,
          number: p.number,
          position: p.position,
          photoUrl: p.photoUrl,
          stats: p.stats as any,
          sortOrder: p.sortOrder,
        })),
      });
    }

    return copy;
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
      // Sprint 13 — template reassignment.
      scoreboardTemplateId?: string | null;
      ribbonTemplateId?: string | null;
      scorebugTemplateId?: string | null;
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
    // Sprint 13 — template reassignment. Empty string → clear (null).
    if (dto.scoreboardTemplateId !== undefined)
      data.scoreboardTemplateId = dto.scoreboardTemplateId || null;
    if (dto.ribbonTemplateId !== undefined)
      data.ribbonTemplateId = dto.ribbonTemplateId || null;
    if (dto.scorebugTemplateId !== undefined)
      data.scorebugTemplateId = dto.scorebugTemplateId || null;
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
    // Label any screen claimed by a DIFFERENT game with that game's
    // matchup, so the operator sees who owns it before taking it over.
    const otherIds = [
      ...new Set(
        screens
          .map((s) => s.activeBoardGameId)
          .filter((id): id is string => !!id && id !== gameId),
      ),
    ];
    const otherGames = otherIds.length
      ? await this.prisma.client.game.findMany({
          where: { id: { in: otherIds } },
          select: { id: true, homeTeam: true, awayTeam: true },
        })
      : [];
    const labelById = new Map(
      otherGames.map((g) => [g.id, `${g.homeTeam} vs ${g.awayTeam}`]),
    );
    return screens.map((s) => {
      const showingOther =
        !!s.activeBoardGameId && s.activeBoardGameId !== gameId;
      return {
        id: s.id,
        name: s.name,
        status: s.status,
        showing: s.activeBoardGameId === gameId,
        showingOther,
        // Which game owns it, when another game does — for the
        // take-over confirmation.
        otherGame: showingOther
          ? labelById.get(s.activeBoardGameId as string) ?? 'another game'
          : null,
        // The surface this screen renders when it IS showing this game.
        // Null surface on a pushed screen reads as BOARD (back-compat).
        surface:
          s.activeBoardGameId === gameId ? s.activeBoardSurface || 'BOARD' : null,
      };
    });
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
    force?: unknown,
  ) {
    await this.owned(tenantId, gameId);
    const ids = Array.isArray(screenIds)
      ? screenIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
    if (ids.length === 0) throw new BadRequestException('screenIds is required');

    // A screen is owned by ONE game at a time. If any target screen is
    // already showing a DIFFERENT game, refuse — so two operators can
    // never overwrite each other's screen — unless `force` is set (an
    // explicit, confirmed take-over from the console).
    const targets = await this.prisma.client.screen.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, name: true, activeBoardGameId: true },
    });
    if (force !== true) {
      const conflicts = targets.filter(
        (s) => s.activeBoardGameId && s.activeBoardGameId !== gameId,
      );
      if (conflicts.length > 0) {
        throw new ConflictException({
          code: 'SCREEN_IN_USE',
          message: `Already showing another game: ${conflicts
            .map((c) => c.name)
            .join(', ')}. Take it over to switch.`,
          screenIds: conflicts.map((c) => c.id),
          screenNames: conflicts.map((c) => c.name),
        });
      }
    }

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
    // A score never goes below zero (e.g. a −1 correction at 0). Clamp
    // atomically + conditionally: `updateMany` with a `< 0` filter only
    // fires if the score is STILL negative at write time, so a
    // concurrent increment that already pushed it positive can't be
    // clobbered back to zero by this operator's stale read.
    const raw = team === 'home' ? updated.homeScore : updated.awayScore;
    if (raw < 0) {
      const clamp = await this.prisma.client.game.updateMany({
        where:
          team === 'home'
            ? { id, homeScore: { lt: 0 } }
            : { id, awayScore: { lt: 0 } },
        data: team === 'home' ? { homeScore: 0 } : { awayScore: 0 },
      });
      if (clamp.count > 0) {
        const fresh = await this.prisma.client.game.findUnique({ where: { id } });
        if (fresh) updated = fresh;
      }
    }
    await this.record(id, 'SCORE', {
      team,
      delta,
      homeScore: updated.homeScore,
      awayScore: updated.awayScore,
    });
    // Sport rules: volleyball / pickleball set-and-match scoring runs
    // off the rally score the moment a team reaches the set target.
    const def = this.sportOf((updated as any).sport);
    if (def.key === 'volleyball' || def.key === 'pickleball') {
      return this.applySetWin(updated, def);
    }
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

    // Penalties slave to the game clock — a whistle that stops the
    // game clock freezes the whole penalty box; a start resumes it.
    // Re-anchor every penalty to the new running state (skipped when
    // the box is empty, so non-penalty sports never touch stats).
    const data: Record<string, unknown> = {
      clockMs,
      clockRunning,
      clockUpdatedAt: now,
    };
    const syncedStats = this.syncPenaltiesToClock(game.stats, clockRunning, now);
    if (syncedStats) data.stats = syncedStats as any;

    const updated = await this.prisma.client.game.update({ where: { id }, data });
    await this.record(id, 'CLOCK', { action, clockMs, clockRunning });
    return updated;
  }

  /**
   * Basketball shot clock — a second countdown, independent of the
   * game clock. Level-aware: Pro 24s, College 30s, HS 35s, or Off.
   * Stored in Game.stats JSON under `shotClock` (no schema column);
   * every surface projects it from the anchor like the game clock.
   * `configure` sets the length; start / stop / reset run it.
   */
  async setShotClock(
    tenantId: string,
    id: string,
    dto: { action?: string; value?: number },
  ) {
    const game = await this.owned(tenantId, id);
    const action = String(dto.action || '');
    const stats: Record<string, unknown> =
      game.stats && typeof game.stats === 'object'
        ? { ...(game.stats as Record<string, unknown>) }
        : {};
    const prev: Record<string, unknown> =
      stats.shotClock && typeof stats.shotClock === 'object'
        ? (stats.shotClock as Record<string, unknown>)
        : {};
    let len = Number(prev.len) || 0;
    let ms = Math.max(0, Number(prev.ms) || 0);
    let running = !!prev.running;

    // The live reading, projected from the prior anchor.
    const live = (): number => {
      if (!running) return ms;
      const at = new Date(String(prev.at || '')).getTime();
      if (!Number.isFinite(at)) return ms;
      return Math.max(0, ms - (Date.now() - at));
    };

    switch (action) {
      case 'configure': {
        // value = shot-clock length in seconds: 0 (off) | 24 | 30 | 35.
        const v = Math.round(Number(dto.value));
        len = [0, 24, 30, 35].includes(v) ? v : 0;
        ms = len * 1000;
        running = false;
        break;
      }
      case 'start':
        if (len <= 0) throw new BadRequestException('Shot clock is off');
        ms = live();
        running = true;
        break;
      case 'stop':
        ms = live();
        running = false;
        break;
      case 'reset': {
        // value = seconds to reset to (full length, or a 14 / 20 partial).
        const v = Math.round(Number(dto.value));
        const sec = Number.isFinite(v) && v > 0 ? v : len;
        ms = Math.min(sec, len || sec) * 1000;
        running = len > 0;
        break;
      }
      default:
        throw new BadRequestException('action must be configure | start | stop | reset');
    }

    const shotClock = { len, ms, at: new Date().toISOString(), running };
    return this.prisma.client.game.update({
      where: { id },
      data: { stats: { ...stats, shotClock } as any },
    });
  }

  /**
   * Football play clock — the 40 / 25-second countdown between snaps.
   * A second clock, independent of the game clock; reset to 40 after a
   * normal play, 25 after a stoppage. Stored in Game.stats.playClock.
   */
  async setPlayClock(
    tenantId: string,
    id: string,
    dto: { action?: string; value?: number },
  ) {
    const game = await this.owned(tenantId, id);
    const action = String(dto.action || '');
    const stats: Record<string, unknown> =
      game.stats && typeof game.stats === 'object'
        ? { ...(game.stats as Record<string, unknown>) }
        : {};
    const prev: Record<string, unknown> =
      stats.playClock && typeof stats.playClock === 'object'
        ? (stats.playClock as Record<string, unknown>)
        : {};
    let ms = Math.max(0, Number(prev.ms) || 0);
    let running = !!prev.running;

    const live = (): number => {
      if (!running) return ms;
      const at = new Date(String(prev.at || '')).getTime();
      if (!Number.isFinite(at)) return ms;
      return Math.max(0, ms - (Date.now() - at));
    };

    switch (action) {
      case 'start':
        ms = live();
        running = true;
        break;
      case 'stop':
        ms = live();
        running = false;
        break;
      case 'reset': {
        // value = seconds to reset to (40 normal, 25 after a stoppage).
        const v = Math.round(Number(dto.value));
        const sec = Number.isFinite(v) && v > 0 && v <= 60 ? v : 40;
        ms = sec * 1000;
        running = true;
        break;
      }
      default:
        throw new BadRequestException('action must be start | stop | reset');
    }

    const playClock = { ms, at: new Date().toISOString(), running };
    return this.prisma.client.game.update({
      where: { id },
      data: { stats: { ...stats, playClock } as any },
    });
  }

  /**
   * Project one stored penalty anchor to its live remaining ms — the
   * same anchor math the game clock uses. A frozen penalty reads its
   * stored ms; a running one subtracts elapsed wall time.
   */
  private projectPenaltyMs(p: Record<string, unknown>, nowMs: number): number {
    const ms = Math.max(0, Number(p.ms) || 0);
    if (!p.running) return ms;
    const at = new Date(String(p.at || '')).getTime();
    if (!Number.isFinite(at)) return ms;
    return Math.max(0, ms - (nowMs - at));
  }

  /**
   * Re-anchor every penalty in a game's stats to a new running state,
   * projecting each to its live remaining time and dropping any that
   * already expired (a player whose box time ran out is back on the
   * ice). Returns the updated stats object, or null when the game has
   * no penalties — so callers can skip the stats write entirely for
   * the 14 sports with no penalty box.
   */
  private syncPenaltiesToClock(
    rawStats: unknown,
    running: boolean,
    now: Date,
  ): Record<string, unknown> | null {
    if (!rawStats || typeof rawStats !== 'object') return null;
    const stats = { ...(rawStats as Record<string, unknown>) };
    if (!Array.isArray(stats.penalties) || stats.penalties.length === 0) {
      return null;
    }
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    stats.penalties = (stats.penalties as unknown[])
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .map((p) => ({
        id: String(p.id || ''),
        team: p.team === 'away' ? 'away' : 'home',
        label: String(p.label || '').slice(0, 24),
        player: String(p.player || '').slice(0, 4),
        ms: this.projectPenaltyMs(p, nowMs),
        at: nowIso,
        running,
      }))
      .filter((p) => p.id && p.ms > 0);
    return stats;
  }

  /**
   * Penalty box — the timed penalties of hockey, lacrosse, field
   * hockey and water polo. Each penalty counts a player out for a
   * fixed duration; the box runs and freezes WITH the game clock.
   * Stored as an array in Game.stats.penalties (no schema column);
   * every surface projects each penalty from its own anchor.
   *
   *   add    — push a penalty for a team (lenSec + optional player #)
   *   remove — pull one penalty early (a power-play goal ends a minor)
   *   clear  — empty the box
   *
   * Every action re-anchors the surviving penalties to the game
   * clock's current running state and prunes any that hit 0:00.
   */
  async setPenalties(
    tenantId: string,
    id: string,
    dto: {
      action?: string;
      team?: string;
      penaltyId?: string;
      lenSec?: number;
      label?: string;
      player?: string;
    },
  ) {
    const game = await this.owned(tenantId, id);
    const action = String(dto.action || '');
    const now = new Date();
    // A penalty added while the clock runs starts counting at once;
    // added during a stoppage it waits, frozen, for the next start.
    const running = !!game.clockRunning;

    // Start from the stored box, re-anchored live + pruned of expired.
    const synced = this.syncPenaltiesToClock(game.stats, running, now);
    const baseStats: Record<string, unknown> =
      synced ??
      (game.stats && typeof game.stats === 'object'
        ? { ...(game.stats as Record<string, unknown>), penalties: [] }
        : { penalties: [] });
    let list = Array.isArray(baseStats.penalties)
      ? (baseStats.penalties as Record<string, unknown>[])
      : [];

    switch (action) {
      case 'add': {
        const sec = Math.round(Number(dto.lenSec));
        if (!Number.isFinite(sec) || sec < 5 || sec > 1800) {
          throw new BadRequestException('lenSec must be 5–1800 seconds');
        }
        if (list.length >= 12) {
          throw new BadRequestException('Penalty box is full (12 max)');
        }
        list = [
          ...list,
          {
            id: `pen_${now.getTime().toString(36)}_${Math.random()
              .toString(36)
              .slice(2, 7)}`,
            team: dto.team === 'away' ? 'away' : 'home',
            label: String(dto.label || '').slice(0, 24),
            // Jersey number — digits only, ≤ 3 (00–999 covers every code).
            player: String(dto.player || '').replace(/[^0-9]/g, '').slice(0, 3),
            ms: sec * 1000,
            at: now.toISOString(),
            running,
          },
        ];
        break;
      }
      case 'remove': {
        const pid = String(dto.penaltyId || '');
        if (!pid) throw new BadRequestException('penaltyId required');
        list = list.filter((p) => String(p.id) !== pid);
        break;
      }
      case 'clear':
        list = [];
        break;
      default:
        throw new BadRequestException('action must be add | remove | clear');
    }

    const updated = await this.prisma.client.game.update({
      where: { id },
      data: { stats: { ...baseStats, penalties: list } as any },
    });
    await this.record(id, 'PENALTY', { action, count: list.length });
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

  /**
   * Auto-advance any LIVE game whose running game-clock has expired —
   * a countdown clock that hit 0:00, or a count-up clock that reached
   * the segment length. Called every second by ClockAdvanceService so
   * the scoreboard rolls to the next quarter / period on its own, with
   * a fresh stopped clock, instead of the operator doing it by hand.
   *
   * At the final regulation segment the clock just stops — overtime is
   * the operator's call; we never auto-force a team into OT. Clockless
   * sports (baseball, volleyball, pickleball) advance by their own
   * rules and are skipped. Returns how many games changed.
   */
  async autoAdvanceExpiredClocks(): Promise<number> {
    const games = await this.prisma.client.game.findMany({
      where: { status: 'LIVE', clockRunning: true },
    });
    let changed = 0;
    for (const game of games) {
      const def = findSport(game.sport);
      if (!def || def.clock.type === 'none') continue;
      const segMs = def.clock.segmentMs ?? 0;
      const live = this.liveClockMs(game);
      const expired = def.clock.type === 'countdown' ? live <= 0 : live >= segMs;
      if (!expired) continue;

      const now = new Date();
      if (game.segment >= def.segment.count) {
        // Final regulation segment ended — stop the clock and let the
        // operator decide overtime / final. Never auto-force OT.
        await this.prisma.client.game.update({
          where: { id: game.id },
          data: {
            clockRunning: false,
            clockMs: def.clock.type === 'countdown' ? 0 : segMs,
            clockUpdatedAt: now,
          },
        });
        await this.record(game.id, 'CLOCK', { action: 'expired', clockRunning: false });
      } else {
        // Roll to the next segment with a fresh, stopped clock.
        const segment = game.segment + 1;
        await this.prisma.client.game.update({
          where: { id: game.id },
          data: {
            segment,
            clockMs: this.segmentStartMs(def),
            clockRunning: false,
            clockUpdatedAt: now,
          },
        });
        await this.record(game.id, 'SEGMENT', { segment, auto: true });
        await this.record(game.id, 'CLOCK', { action: 'auto-advance', clockRunning: false });
      }
      changed += 1;
    }
    return changed;
  }

  /**
   * Merge sport-specific stat values into the game's stats JSON.
   *
   * For baseball / softball the ball–strike–out count is a real rules
   * engine, not a free-form number: a 4th ball is a walk, a 3rd strike
   * is an out, and a 3rd out retires the side — flipping the half and
   * advancing the inning after the bottom. The operator just clicks
   * Ball / Strike / Out and the count cascades on its own.
   */
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

    // Sport rules: the baseball/softball count cascades automatically.
    const segmentDelta =
      game.sport === 'baseball' || game.sport === 'softball'
        ? this.applyBaseballCount(next)
        : 0;

    const data: Record<string, unknown> = { stats: next as any };
    if (segmentDelta) {
      const max = def.segment.overtime ? def.segment.count + 10 : def.segment.count;
      data.segment = Math.min(max, game.segment + segmentDelta);
    }

    const updated = await this.prisma.client.game.update({ where: { id }, data });
    await this.record(id, 'STAT', { stats: next });
    if (segmentDelta) await this.record(id, 'SEGMENT', { segment: data.segment });
    return updated;
  }

  /**
   * Baseball / softball count rules, applied in place to the merged
   * stats. Returns how many innings to advance (0 or 1).
   *   · 3rd strike → out; the count resets.
   *   · 4th ball   → walk; the count resets, no out.
   *   · 3rd out    → side retired: outs + count reset, the bases
   *                  clear, half flips Top↔Bottom; advancing past
   *                  the bottom bumps the inning.
   */
  private applyBaseballCount(s: Record<string, unknown>): number {
    const n = (v: unknown) =>
      typeof v === 'number' && isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
    let balls = n(s.balls);
    let strikes = n(s.strikes);
    let outs = n(s.outs);
    let half = String(s.half || 'Top');
    let segmentDelta = 0;

    // A strikeout takes precedence over a walk if both somehow trip in
    // one update (a single click only ever moves one count).
    if (strikes >= 3) {
      strikes = 0;
      balls = 0;
      outs += 1;
    } else if (balls >= 4) {
      balls = 0;
      strikes = 0;
    }

    if (outs >= 3) {
      outs = 0;
      balls = 0;
      strikes = 0;
      // Side retired — the bases clear for the new half. Without
      // this a stranded runner would haunt the next half-inning's
      // diamond on the scoreboard.
      s.on1B = 0;
      s.on2B = 0;
      s.on3B = 0;
      if (half.toLowerCase().startsWith('b')) {
        half = 'Top';
        segmentDelta = 1;
      } else {
        half = 'Bottom';
      }
    }

    s.balls = balls;
    s.strikes = strikes;
    s.outs = outs;
    s.half = half;
    return segmentDelta;
  }

  /**
   * Volleyball / pickleball set-and-match scoring. A set is won at its
   * target — pickleball games to 11, volleyball sets to 25 (the
   * deciding final set to 15) — by a 2-point margin. Winning a set
   * bumps that team's set count, resets the rally score to 0-0, and
   * advances to the next set; winning the majority ends the match.
   */
  private async applySetWin(game: any, def: SportDefinition): Promise<any> {
    const h: number = game.homeScore;
    const a: number = game.awayScore;
    const deciding = game.segment >= def.segment.count;
    const target = def.key === 'pickleball' ? 11 : deciding ? 15 : 25;
    let winner: 'home' | 'away' | null = null;
    if (h >= target && h - a >= 2) winner = 'home';
    else if (a >= target && a - h >= 2) winner = 'away';
    if (!winner) return game;

    const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);
    const isPickle = def.key === 'pickleball';
    const homeKey = isPickle ? 'homeGames' : 'homeSets';
    const awayKey = isPickle ? 'awayGames' : 'awaySets';
    const stats = { ...((game.stats as Record<string, unknown>) || {}) };
    const wonKey = winner === 'home' ? homeKey : awayKey;
    stats[wonKey] = n(stats[wonKey]) + 1;

    // Best-of: volleyball is best-of-5 (need 3 sets), pickleball
    // best-of-3 (need 2 games). majority = ceil((count + 1) / 2).
    const needed = Math.ceil((def.segment.count + 1) / 2);
    const matchOver = n(stats[homeKey]) >= needed || n(stats[awayKey]) >= needed;

    const data: Record<string, unknown> = {
      stats: stats as any,
      homeScore: 0,
      awayScore: 0,
    };
    if (matchOver) {
      data.status = 'FINAL';
      data.endedAt = new Date();
      data.clockRunning = false;
    } else {
      data.segment = Math.min(def.segment.count, game.segment + 1);
    }
    const updated = await this.prisma.client.game.update({
      where: { id: game.id },
      data,
    });
    await this.record(
      game.id,
      matchOver ? 'STATUS' : 'SEGMENT',
      matchOver ? { status: 'FINAL' } : { segment: data.segment },
    );
    return updated;
  }

  /**
   * Atomic state push from an external score source — a console tap-off
   * box or a league-feed adapter. Any subset of fields may be provided;
   * only the fields present in the dto are written. Clock fields are
   * re-anchored (clockUpdatedAt = now) whenever clockMs or clockRunning
   * is supplied, exactly as the 'set' clock action does. A GAME_EVENT
   * of type 'INGEST' is appended for the audit trail, and the update is
   * broadcast via the signed pub/sub fan-out so every board surface
   * picks it up without polling.
   */
  /**
   * Feed-authorized ingest: the caller proved possession of the game's feed
   * token (verified in the public board controller), so there's no dashboard
   * session / tenant context. Resolve the game's own tenant, then reuse the
   * exact same clamped `ingest()` path.
   */
  async ingestByFeed(
    id: string,
    dto: {
      homeScore?: number;
      awayScore?: number;
      clockMs?: number;
      clockRunning?: boolean;
      segment?: number;
    },
  ) {
    const game = await this.prisma.client.game.findUnique({
      where: { id },
      select: { tenantId: true },
    });
    if (!game) throw new NotFoundException('Game not found');
    // A machine feed has no operator at a launchpad, so this is the path
    // that should auto-fire celebrations on a score jump (the Sprint 13
    // "AUTO" trigger). The guarded admin /ingest endpoint passes no opts,
    // staying manual.
    return this.ingest(game.tenantId, id, dto, { auto: true });
  }

  async ingest(
    tenantId: string,
    id: string,
    dto: {
      homeScore?: number;
      awayScore?: number;
      clockMs?: number;
      clockRunning?: boolean;
      segment?: number;
    },
    opts: { auto?: boolean } = {},
  ) {
    const game = await this.owned(tenantId, id);
    const data: Record<string, unknown> = {};
    const applied: Record<string, unknown> = {};

    // Scores — clamp to non-negative integers; ignore non-numeric values.
    if (dto.homeScore !== undefined) {
      const v = Math.max(0, Math.round(Number(dto.homeScore)));
      if (Number.isFinite(v)) { data.homeScore = v; applied.homeScore = v; }
    }
    if (dto.awayScore !== undefined) {
      const v = Math.max(0, Math.round(Number(dto.awayScore)));
      if (Number.isFinite(v)) { data.awayScore = v; applied.awayScore = v; }
    }

    // Segment — clamp to >= 1.
    if (dto.segment !== undefined) {
      const v = Math.max(1, Math.round(Number(dto.segment)));
      if (Number.isFinite(v)) { data.segment = v; applied.segment = v; }
    }

    // Clock — re-anchor clockUpdatedAt = now whenever either clock field
    // is provided, exactly mirroring what the 'set' clock action does.
    const clockChanged = dto.clockMs !== undefined || dto.clockRunning !== undefined;
    if (clockChanged) {
      const now = new Date();
      if (dto.clockMs !== undefined) {
        const v = Math.max(0, Math.round(Number(dto.clockMs)));
        if (Number.isFinite(v)) { data.clockMs = v; applied.clockMs = v; }
      }
      if (dto.clockRunning !== undefined) {
        data.clockRunning = Boolean(dto.clockRunning);
        applied.clockRunning = data.clockRunning;
      }
      // Always update the anchor timestamp when any clock field changes,
      // so the board can derive the live clock correctly from the new
      // (clockMs, clockRunning, clockUpdatedAt) triple.
      data.clockUpdatedAt = now;
      applied.clockUpdatedAt = now;
    }

    if (Object.keys(data).length === 0) {
      // Nothing to apply — return the current game without a write.
      return game;
    }

    // Capture the prior scores as PRIMITIVES before the write — the delta
    // must compare pre- vs post-update values and never alias the same
    // mutable row object.
    const prevScores = { homeScore: game.homeScore, awayScore: game.awayScore };
    const updated = await this.prisma.client.game.update({ where: { id }, data });
    await this.record(id, 'INGEST', applied);

    // AUTO celebration trigger — only on the machine-feed path, and only
    // when a score field was actually applied. A score INCREASE matching a
    // celebration's autoPoints fires that celebration for the scoring team.
    // Best-effort: never let a celebration failure break the score sync.
    if (opts.auto && (data.homeScore !== undefined || data.awayScore !== undefined)) {
      try {
        await this.maybeAutoCelebrate(id, prevScores, updated, dto);
      } catch (e) {
        this.logger.debug(`auto-celebrate skipped for game ${id}: ${(e as Error).message}`);
      }
    }
    return updated;
  }

  /**
   * The Sprint 13 "AUTO" trigger. For each team whose score the feed just
   * increased, find the celebration whose `autoPoints` includes the delta
   * and fire it — routed through the SAME `record(id, 'CUE', …)` shape the
   * manual launchpad (`fireCue`) uses, so every board / ribbon / scorebug
   * surface plays it with zero rendering changes. Tagged `{ auto: true,
   * team }` so the overlay can theme to the scoring side. Honors the
   * per-game toggle (default ON).
   */
  private async maybeAutoCelebrate(
    id: string,
    prev: { homeScore: number; awayScore: number },
    next: any,
    dto: { homeScore?: number; awayScore?: number },
  ): Promise<void> {
    if (!(await this.autoCelebrateEnabled(id))) return;

    let def: SportDefinition;
    try {
      def = this.sportOf(next.sport);
    } catch {
      return; // unknown sport — nothing to map a delta to
    }

    const hits: Array<{ team: 'home' | 'away'; cue: SportDefinition['celebrations'][number] }> = [];
    for (const team of ['home', 'away'] as const) {
      const provided = team === 'home' ? dto.homeScore !== undefined : dto.awayScore !== undefined;
      if (!provided) continue;
      const before = team === 'home' ? prev.homeScore : prev.awayScore;
      const after = team === 'home' ? next.homeScore : next.awayScore;
      const delta = after - before;
      if (delta <= 0) continue; // only score INCREASES fire; corrections don't
      const cue = def.celebrations.find(
        (c) => Array.isArray(c.autoPoints) && c.autoPoints.includes(delta),
      );
      if (cue) hits.push({ team, cue });
    }
    if (hits.length === 0) return;

    const snapshot = this.cueSnapshot(next);
    for (const h of hits) {
      const event = await this.record(id, 'CUE', {
        key: h.cue.key,
        label: h.cue.label,
        emoji: h.cue.emoji,
        target: 'ALL',
        audioUrl: null,
        sponsorName: null,
        sponsorLogoUrl: null,
        auto: true,
        team: h.team,
        snapshot,
      });
      // Lane-8 P1: AUTO cues also get an immutable AuditLog row (forensics).
      try {
        await this.prisma.client.auditLog.create({
          data: {
            tenantId: next.tenantId,
            userId: null, // AUTO has no user actor — it's score-feed-driven.
            action: 'SPORTS_CUE_FIRED',
            targetType: 'Game',
            targetId: id,
            details: JSON.stringify({
              eventId: event.id,
              key: h.cue.key,
              label: h.cue.label,
              target: 'ALL',
              team: h.team,
              auto: true,
            }),
          },
        });
      } catch { /* best-effort */ }
    }
  }

  /**
   * Per-game AUTO-celebrate toggle. Reads the in-memory cache; on a miss,
   * hydrates ONCE from the latest AUTO_CELEBRATE GameEvent (default ON when
   * none exists). Fails OPEN to the default on any read error so a feed
   * game still gets its show — never blocks the score sync.
   */
  private async autoCelebrateEnabled(gameId: string): Promise<boolean> {
    const cached = this.autoCelebrateCache.get(gameId);
    if (cached !== undefined) return cached;
    let enabled = true;
    try {
      const ev = await this.prisma.client.gameEvent.findFirst({
        where: { gameId, type: 'AUTO_CELEBRATE' },
        orderBy: { createdAt: 'desc' },
      });
      const payload = ev?.payload as { enabled?: unknown } | null;
      if (payload && typeof payload.enabled === 'boolean') enabled = payload.enabled;
    } catch {
      /* fail open to default ON */
    }
    this.autoCelebrateCache.set(gameId, enabled);
    return enabled;
  }

  /** Read the current AUTO-celebrate toggle for a game (tenant-scoped). */
  async getAutoCelebrate(tenantId: string, id: string) {
    await this.owned(tenantId, id);
    return { enabled: await this.autoCelebrateEnabled(id) };
  }

  /** Flip the AUTO-celebrate toggle. Persists a latest-wins AUTO_CELEBRATE
   *  GameEvent (no migration) and updates the hot-path cache in place. */
  async setAutoCelebrate(tenantId: string, id: string, enabled: unknown) {
    await this.owned(tenantId, id);
    const val = Boolean(enabled);
    await this.record(id, 'AUTO_CELEBRATE', { enabled: val });
    this.autoCelebrateCache.set(id, val);
    return { enabled: val };
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
   * A frozen snapshot of the live game state at cue-fire time. Embedded
   * in the CUE event so a celebration overlay can show the EXACT score
   * and clock of the moment — even if the operator bumps the score a
   * second later. The board reads ready-to-display strings; there is no
   * client-side projection (a celebration is a frozen instant, not a
   * ticking clock).
   */
  private cueSnapshot(game: {
    sport: string;
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    homeColor: string | null;
    awayColor: string | null;
    segment: number;
    clockMs: number;
    clockRunning: boolean;
    clockUpdatedAt: Date;
  }): Record<string, unknown> {
    let segmentLabel = '';
    let clockText = '';
    try {
      const def = this.sportOf(game.sport);
      segmentLabel = this.segmentLabelOf(def, game.segment);
      if (def.clock.type !== 'none') {
        clockText = this.fmtClockText(this.liveClockMs(game));
      }
    } catch {
      // Unknown sport — the score still snapshots; clock/segment stay blank.
    }
    return {
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      homeColor: game.homeColor,
      awayColor: game.awayColor,
      segmentLabel,
      clockText,
    };
  }

  /** "M:SS" — celebration clock readout. */
  private fmtClockText(ms: number): string {
    const safe = Math.max(0, Math.round(ms));
    const m = Math.floor(safe / 60_000);
    const s = Math.floor((safe % 60_000) / 1000);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /** Short segment label — "Q3", "3RD INN", "SET 2", "OT". */
  private segmentLabelOf(def: SportDefinition, n: number): string {
    if (n > def.segment.count) {
      const ot = n - def.segment.count;
      return ot > 1 ? `OT${ot}` : 'OT';
    }
    const name = def.segment.name;
    if (name === 'Quarter') return `Q${n}`;
    if (name === 'Period') return `P${n}`;
    if (name === 'Inning') return `${this.ordinal(n)} INN`;
    if (name === 'Set') return `SET ${n}`;
    if (name === 'Half') return `${this.ordinal(n)} HALF`;
    return `${name.toUpperCase()} ${n}`;
  }

  private ordinal(n: number): string {
    const suf = ['TH', 'ST', 'ND', 'RD'];
    const v = n % 100;
    return `${n}${suf[(v - 20) % 10] || suf[v] || suf[0]}`;
  }

  /**
   * Normalize an untrusted cue target — which surfaces play the cue:
   *   BOARD  — scoreboards + broadcast scorebugs
   *   RIBBON — ribbon / fascia boards
   *   ALL    — every surface showing this game
   * Defaults to ALL. The target rides in the CUE payload; each
   * surface checks it before playing, so one tap can light up the
   * ribbon, the scoreboards, or every screen showing the game.
   */
  private cleanCueTarget(v: unknown): 'BOARD' | 'RIBBON' | 'ALL' {
    const s = String(v || 'ALL').toUpperCase();
    return s === 'BOARD' || s === 'RIBBON' ? s : 'ALL';
  }

  /**
   * Fire a cue. Either a built-in sport celebration (`key` — "Touchdown",
   * "GOAL!", validated against the sport) OR an operator-built custom
   * cue (`cueId` — a named trigger with uploaded takeover content).
   * `target` scopes which surfaces play it (scoreboard / ribbon / all).
   * Both land as a CUE GameEvent that every surface playing the game
   * polls; a surface plays the cue only when the target includes it.
   *
   * Optional co-branding: `audioUrl` plays a sound clip on every surface
   * that receives the cue; `sponsorName` + `sponsorLogoUrl` overlay a
   * co-branded attribution line ("This touchdown brought to you by …").
   * All three are optional — existing cues without them are unaffected.
   */
  async fireCue(
    tenantId: string,
    id: string,
    dto: {
      key?: string;
      cueId?: string;
      target?: string;
      audioUrl?: string;
      sponsorName?: string;
      sponsorLogoUrl?: string;
      // Lane-8 P1: scoring team — drives the celebration's team-color brand
      // shim. Manual path was previously missing this; only AUTO set it.
      team?: 'home' | 'away' | null;
    },
    actorUserId?: string,
  ) {
    const game = await this.owned(tenantId, id);
    const target = this.cleanCueTarget(dto.target);

    // Sanitize the three new optional co-branding / audio fields.
    const audioUrl = this.cleanText(dto.audioUrl, 2048);
    const sponsorName = this.cleanText(dto.sponsorName, 120);
    const sponsorLogoUrl = this.cleanText(dto.sponsorLogoUrl, 2048);
    const team = dto.team === 'home' || dto.team === 'away' ? dto.team : null;

    // Lane-8 P1: mirror every cue-fire into the immutable AuditLog so a
    // game-presentation forensics review can answer "who fired which
    // sponsor takeover at 7:42 in Q3" — record() only writes a GameEvent
    // (20s board-feed window), which evaporates after the moment.
    const auditDetails = (eventId: string, key: string, label: string) => ({
      eventId, key, label, target, team,
      hasAudio: !!audioUrl,
      hasSponsor: !!(sponsorName || sponsorLogoUrl),
    });
    const writeAudit = async (eventId: string, key: string, label: string) => {
      try {
        await this.prisma.client.auditLog.create({
          data: {
            tenantId,
            userId: actorUserId || null,
            action: 'SPORTS_CUE_FIRED',
            targetType: 'Game',
            targetId: id,
            details: JSON.stringify(auditDetails(eventId, key, label)),
          },
        });
      } catch {
        // Best-effort — never let an audit-log failure block a cue from
        // firing. The GameEvent is already persisted; this is forensics only.
      }
    };

    // Custom cue — operator-defined trigger from the cue deck.
    if (dto.cueId) {
      const cc = await this.prisma.client.customCue.findFirst({
        where: { id: dto.cueId, tenantId },
      });
      if (!cc) throw new BadRequestException('Custom cue not found');
      const event = await this.record(id, 'CUE', {
        key: `custom:${cc.id}`,
        label: cc.name,
        mediaUrl: cc.mediaUrl || null,
        color: cc.color || null,
        durationMs: cc.durationMs,
        displayMode: (cc as any).displayMode || 'overlay',
        custom: true,
        target,
        audioUrl,
        sponsorName,
        sponsorLogoUrl,
        team,
        snapshot: this.cueSnapshot(game),
      });
      await writeAudit(event.id, `custom:${cc.id}`, cc.name);
      return { fired: true, cueId: cc.id, target, eventId: event.id };
    }

    const def = this.sportOf(game.sport);
    const cue = def.celebrations.find((c) => c.key === dto.key);
    if (!cue) {
      throw new BadRequestException(`Unknown cue "${dto.key}" for ${def.name}`);
    }
    const event = await this.record(id, 'CUE', {
      key: cue.key,
      label: cue.label,
      emoji: cue.emoji,
      target,
      audioUrl,
      sponsorName,
      sponsorLogoUrl,
      team,
      snapshot: this.cueSnapshot(game),
    });
    await writeAudit(event.id, cue.key, cue.label);
    return { fired: true, cue, target, eventId: event.id };
  }

  /**
   * Set the stadium ribbon's custom message reel. Each line scrolls on
   * the ribbon in place of the default crowd prompts; an empty list
   * clears back to the auto prompts. Stored as a RIBBON GameEvent
   * (latest wins) — no new table, no migration.
   */
  async setRibbon(tenantId: string, id: string, dto: { messages?: unknown }) {
    await this.owned(tenantId, id);
    const messages = Array.isArray(dto.messages)
      ? dto.messages
          .map((m) => this.cleanText(m, 120))
          .filter((m): m is string => m !== null)
          .slice(0, 30)
      : [];
    await this.record(id, 'RIBBON', { messages });
    return { messages };
  }

  /**
   * Set which content presets ride the stadium ribbon reel — the
   * score, clock, period, sport-specific game situation, crowd
   * messages, player spotlights, sponsors. The list is validated
   * against the game's sport catalog (a `clock` preset can't be set
   * on a clockless sport like baseball). Stored as a RIBBON_PRESETS
   * GameEvent (latest wins) — no new table, no migration.
   */
  async setRibbonPresets(tenantId: string, id: string, dto: { presets?: unknown }) {
    const game = await this.owned(tenantId, id);
    const def = this.sportOf(game.sport);
    const presets = sanitizeRibbonPresets(def, dto.presets);
    await this.record(id, 'RIBBON_PRESETS', { presets });
    return { presets };
  }

  /**
   * Set how fast the ribbon reel scrolls. The value is normalized to
   * a known speed (slow / normal / fast / very fast). Stored as a
   * RIBBON_SPEED GameEvent, latest-wins — no table, no migration.
   */
  async setRibbonSpeed(tenantId: string, id: string, dto: { speed?: unknown }) {
    await this.owned(tenantId, id);
    const speed = sanitizeRibbonSpeed(dto.speed);
    await this.record(id, 'RIBBON_SPEED', { speed });
    return { speed };
  }

  /**
   * Set the ribbon's full-bleed image slides — a list of image URLs
   * the operator uploaded (sponsor banners, promos, welcome art).
   * Each fills the ribbon edge-to-edge as it scrolls past. Stored as
   * a RIBBON_SLIDES GameEvent, latest-wins — no table, no migration.
   */
  async setRibbonSlides(tenantId: string, id: string, dto: { slides?: unknown }) {
    await this.owned(tenantId, id);
    const slides = Array.isArray(dto.slides)
      ? dto.slides
          .map((s) => this.cleanText(s, 2048))
          .filter((s): s is string => s !== null)
          .slice(0, 20)
      : [];
    await this.record(id, 'RIBBON_SLIDES', { slides });
    return { slides };
  }

  /**
   * Set how many times the score anchor repeats around the stadium
   * ribbon — one scorebug for a straight ribbon, or a recurring score
   * for a continuous full-bowl wrap so it reads from every seat.
   * 'auto' lets the ribbon size the count to its own width. Stored as
   * a RIBBON_SCORE GameEvent, latest-wins — no table, no migration.
   */
  async setRibbonScoreRepeat(tenantId: string, id: string, dto: { repeat?: unknown }) {
    await this.owned(tenantId, id);
    const repeat = sanitizeRibbonScoreRepeat(dto.repeat);
    await this.record(id, 'RIBBON_SCORE', { repeat });
    return { repeat };
  }

  // ── cue deck (custom triggers) ───────────────────────────────

  /** Bound a cue duration to a sane 2–20s window. */
  private cleanDuration(v: unknown): number {
    const n = Number(v);
    if (!isFinite(n)) return 6000;
    return Math.min(20000, Math.max(2000, Math.round(n)));
  }

  /** The tenant's reusable cue deck, in display order. */
  async listCues(tenantId: string) {
    return this.prisma.client.customCue.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Create a custom cue (a trigger button + its takeover content). */
  async createCue(
    tenantId: string,
    dto: { name?: string; mediaUrl?: string; color?: string; durationMs?: number; displayMode?: string },
  ) {
    const name = this.cleanText(dto.name, 60);
    if (!name) throw new BadRequestException('Cue name is required.');
    const sortOrder = await this.prisma.client.customCue.count({ where: { tenantId } });
    return this.prisma.client.customCue.create({
      data: {
        tenantId,
        name,
        mediaUrl: this.cleanText(dto.mediaUrl, 2048),
        color: this.cleanText(dto.color, 32),
        durationMs: this.cleanDuration(dto.durationMs),
        displayMode: dto.displayMode === 'takeover' ? 'takeover' : 'overlay',
        sortOrder,
      },
    });
  }

  /** Resolve a tenant-owned cue, or 404. */
  private async ownedCue(tenantId: string, id: string) {
    const cc = await this.prisma.client.customCue.findFirst({ where: { id, tenantId } });
    if (!cc) throw new NotFoundException('Cue not found');
    return cc;
  }

  /** Edit a custom cue — only the keys present in the dto. */
  async updateCue(
    tenantId: string,
    id: string,
    dto: { name?: string; mediaUrl?: string; color?: string; durationMs?: number; displayMode?: string },
  ) {
    await this.ownedCue(tenantId, id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const n = this.cleanText(dto.name, 60);
      if (!n) throw new BadRequestException('Cue name cannot be empty.');
      data.name = n;
    }
    if (dto.mediaUrl !== undefined) data.mediaUrl = this.cleanText(dto.mediaUrl, 2048);
    if (dto.color !== undefined) data.color = this.cleanText(dto.color, 32);
    if (dto.durationMs !== undefined) data.durationMs = this.cleanDuration(dto.durationMs);
    if (dto.displayMode !== undefined) data.displayMode = dto.displayMode === 'takeover' ? 'takeover' : 'overlay';
    return this.prisma.client.customCue.update({ where: { id }, data });
  }

  /** Remove a custom cue from the deck. */
  async deleteCue(tenantId: string, id: string) {
    await this.ownedCue(tenantId, id);
    await this.prisma.client.customCue.delete({ where: { id } });
    return { deleted: true };
  }
}
