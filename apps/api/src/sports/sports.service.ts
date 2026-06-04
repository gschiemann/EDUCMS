import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { SponsorsService } from './sponsors.service';
// 2026-05-26 — reused inside getBoard() to resolve the operator-
// picked scoreboard/ribbon/scorebug templates with parsed zone
// defaultConfig (Prisma stores it as a JSON string). Bundles the
// templates directly into the public /sports/board response so
// public surfaces don't have to fetch the auth-gated /templates/:id.
import { mapTemplate } from '../templates/templates.controller';
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
import { makeFeedToken } from './sports-feed-token';

/**
 * VenueOS Sports — Sprint 13. The game engine service.
 *
 * Every game mutation does two things, in order:
 *   1. update the `games` row (the system-of-record),
 *   2. append a `game_events` row (the append-only forensic log +
 *      the celebration-cue feed the board page polls).
 *
 * Real-time delivery is the 750ms polling path on the public board
 * endpoint (with a 1s in-memory cache + per-write invalidation). There
 * is intentionally NO pub/sub fan-out for game-state events: an earlier
 * draft published a signed `game:<id>` message on every write, but
 * RedisService.psubscribe only listens on `tenant:* | group:* | device:*`,
 * so the signed message landed on the bus and died — theater, not
 * delivery. If a true WS-driven board lands later, register `game:*` on
 * the RedisService psubscribe list at THAT point (and verify the gate
 * with verifyWsHmac the way the broadcast bus does). Audit-Fix 2.
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

  // Audit-Fix 2: `redis` + `signer` are kept on the DI signature so the
  // existing module wiring (and the spec setup) stays compatible. They
  // are currently unused — see record() and the class-level note. If a
  // WS-driven board lands, restore the publish at THAT point.
  constructor(
    private readonly prisma: PrismaService,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private readonly redis: RedisService,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  /**
   * Append a game_events row + invalidate the board cache.
   *
   * Audit-Fix 2: real-time delivery is the 750ms polling path; no pub/sub
   * fan-out for game-state events. We previously signed every GAME_EVENT
   * and published to `game:<gameId>` — but RedisService.psubscribe only
   * listens on `tenant:* | group:* | device:*`, so the signed message
   * landed on the bus and DIED. The board cache is invalidated explicitly
   * on every write here, and the public board controller's 750ms poll +
   * 1s in-memory cache carries the data within a perceived sub-second.
   * (If a true WS-driven board lands later, add `game:*` to the
   * RedisService psubscribe list at THAT point — not before.)
   */
  private async record(gameId: string, type: string, payload: Record<string, unknown>) {
    const event = await this.prisma.client.gameEvent.create({
      data: { gameId, type, payload: payload as any },
    });
    // Lane-4 P0: every write to a game (cue/score/clock/penalty/segment/
    // ribbon) flows through this method — invalidate the board cache so the
    // next poll sees the change instantly instead of waiting up to 1s.
    this.invalidateBoardCache(gameId);
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

  // ── feed-token revocation (Sprint 13) ─────────────────────────
  //
  // The external score-feed token (sports-feed-token.ts) is a stateless
  // game-scoped HMAC. Game.feedTokenVersion is folded into the MAC so bumping
  // it instantly invalidates every outstanding token for the game. These two
  // methods are the read + increment paths.

  /**
   * The game's current feed-token version. UN-guarded (the PUBLIC board
   * controller calls this from the feed/cts-snapshot ingest, which has no
   * dashboard session). A missing game returns 0 — the caller's HMAC compare
   * fails anyway, and a non-existent game has no valid token. Selects only the
   * one integer column to keep this off the hot ingest path's cost.
   */
  async getFeedTokenVersion(gameId: string): Promise<number> {
    if (!gameId) return 0;
    const row = await this.prisma.client.game.findUnique({
      where: { id: gameId },
      select: { feedTokenVersion: true },
    });
    return row?.feedTokenVersion ?? 0;
  }

  /**
   * Revoke all outstanding feed tokens for a game by incrementing
   * Game.feedTokenVersion. Tenant-scoped (404 if the game isn't the caller's).
   * Returns the freshly-minted CURRENT token so the operator can immediately
   * re-copy working credentials to their vendor. Writes an immutable AuditLog
   * row (privileged action — Standard Audit Surface §16).
   */
  async revokeFeedToken(
    tenantId: string,
    gameId: string,
    actorUserId?: string,
  ): Promise<{ success: true; feedTokenVersion: number; token: string }> {
    // Ownership gate (throws NotFound if the game isn't this tenant's).
    await this.owned(tenantId, gameId);

    const updated = await this.prisma.client.game.update({
      where: { id: gameId },
      data: { feedTokenVersion: { increment: 1 } },
      select: { feedTokenVersion: true },
    });
    const version = updated.feedTokenVersion;

    // Immutable AuditLog row — who revoked the feed credential, and the new
    // version. Best-effort to match the rest of this service's audit writes.
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: actorUserId || null,
          action: 'SPORTS_FEED_TOKEN_REVOKED',
          targetType: 'Game',
          targetId: gameId,
          details: JSON.stringify({ feedTokenVersion: version }),
        },
      });
    } catch { /* best-effort */ }

    return {
      success: true,
      feedTokenVersion: version,
      token: makeFeedToken(gameId, { version }),
    };
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

  // Lane-4 P0 — in-process board cache. The /board/:id endpoint polls at
  // 750ms × N viewers per game; each call fans out to 8 Prisma queries.
  // A 1-second TTL drops that hot path by ~99% (a 750ms-poll window crosses
  // at most one boundary). The cue feed advances by record() writing a new
  // GameEvent whose `id` the board dedups by — so a 1-second cache lag on
  // cue arrival is invisible (the next poll picks it up). Operator score
  // updates are similarly bounded to <1s perceived lag.
  //
  // Cache is invalidated explicitly on writes (record + game.update paths)
  // via invalidateBoardCache(); the TTL is the belt-and-suspenders.
  private boardCache = new Map<string, { ts: number; payload: any }>();
  private static readonly BOARD_CACHE_TTL_MS = 1000;
  private invalidateBoardCache(gameId: string) { this.boardCache.delete(gameId); }

  /**
   * Public board view — by game id only, NOT tenant-scoped. Scoreboard
   * data (score, clock, team names) is inherently public: it is shown
   * on a stadium display. The id is an unguessable UUID. Returns the
   * raw clock anchor (board ticks locally) + the recent celebration
   * cue feed (board dedupes by event id and fires new ones).
   *
   * Lane-4 P0: response is memoized for BOARD_CACHE_TTL_MS so a 50-viewer
   * game serving the same payload for ~750ms hits the DB once, not 50×.
   */
  async getBoard(id: string) {
    const now = Date.now();
    const hit = this.boardCache.get(id);
    if (hit && now - hit.ts < SportsService.BOARD_CACHE_TTL_MS) {
      return hit.payload;
    }
    const fresh = await this.getBoardFresh(id);
    this.boardCache.set(id, { ts: now, payload: fresh });
    return fresh;
  }

  private async getBoardFresh(id: string) {
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
    // 2026-05-26 — operator hit "template error http 401 on the cts
    // ribbon preview". Root cause: the public /ribbon/[gameId] page
    // resolved Game.ribbonTemplateId then fetched
    // /api/v1/templates/:id — which is admin-auth-required. Browser
    // had no JWT (it's a public surface), 401, modal showed
    // "Template error: HTTP 401". Fix: resolve all three surface
    // templates server-side here and BUNDLE them into the board
    // response. CustomScoreboardScene now reads the template from
    // the same /sports/board fetch it already does for cues +
    // sponsors + roster — one network call, no second auth-gated
    // endpoint to fail on. Tenant-scope is enforced server-side: a
    // template only ships if isSystem OR tenantId === game.tenantId
    // (a leaked or maliciously-set foreign template id returns
    // null and the ribbon falls back to its built-in render).
    const templateInclude = {
      zones: { orderBy: { sortOrder: 'asc' as const } },
    } as const;
    const resolveTemplate = async (tplId: string | null) => {
      if (!tplId) return null;
      const t = await this.prisma.client.template.findFirst({
        where: {
          id: tplId,
          OR: [{ tenantId: game.tenantId }, { isSystem: true }],
        },
        include: templateInclude,
      });
      return t ? mapTemplate(t) : null;
    };

    const [
      cues, sponsors, roster, ribbonMessages, ribbonPresets,
      ribbonSpeed, ribbonSlides, ribbonScoreRepeat,
      scoreboardTemplate, ribbonTemplate, scorebugTemplate,
      latestLiveOverlayEvent,
    ] = await Promise.all([
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
      // Sprint 13 fix — inline the resolved templates so public
      // scoreboard / ribbon / scorebug surfaces never have to call
      // the auth-gated /templates/:id endpoint.
      resolveTemplate(game.scoreboardTemplateId),
      resolveTemplate(game.ribbonTemplateId),
      resolveTemplate(game.scorebugTemplateId),
      // T2-5: latest live-game text overlay. Latest-wins — the board
      // renders whatever the last LIVE_OVERLAY event says. `kind: 'clear'`
      // means "no active overlay".
      this.prisma.client.gameEvent.findFirst({
        where: { gameId: id, type: 'LIVE_OVERLAY' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, payload: true, createdAt: true },
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
      // 2026-05-26 — resolved templates so public board surfaces can
      // render the operator-picked layout without a second
      // authenticated fetch to /api/v1/templates/:id. CustomScoreboardScene
      // reads these instead of hitting the auth-gated endpoint. Tenant-
      // scope already enforced above (system OR same-tenant only).
      scoreboardTemplate,
      ribbonTemplate,
      scorebugTemplate,
      // T2-5: active live-game text overlay (null = none).
      // `kind: 'clear'` means the last overlay was explicitly dismissed —
      // the frontend treats that as null. Any other kind is the live overlay.
      liveOverlay: (() => {
        if (!latestLiveOverlayEvent) return null;
        const p = (latestLiveOverlayEvent.payload as Record<string, unknown>) ?? {};
        if (p.kind === 'clear') return null;
        return {
          id: latestLiveOverlayEvent.id,
          kind: p.kind,
          payload: p.payload ?? {},
          snapshot: p.snapshot ?? {},
          createdAt: latestLiveOverlayEvent.createdAt,
        };
      })(),
    };
  }

  // ── writes ───────────────────────────────────────────────────

  /** Bound a logo URL — trim, cap length, drop empties. */
  private cleanLogo(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const s = value.trim();
    return s ? s.slice(0, 2048) : null;
  }

  /**
   * Lane-2 P0: verify every foreign-key the operator can set on a Game
   * (`screenGroupId` + three template IDs) belongs to the caller's tenant
   * BEFORE persisting. Without this, a SCHOOL_ADMIN could paste a foreign
   * tenant's ScreenGroup UUID and pin their game's broadcast output to a
   * stranger's screen fleet — or paste a foreign template id to render
   * arbitrary HTML on their own scoreboard. Same shape as the panic-settings
   * ownership fix in tenants.controller.
   *
   * Templates may be tenant-owned OR `isSystem: true` (matches the existing
   * templates.controller convention).
   */
  private async assertOwnedGameRefs(
    tenantId: string,
    refs: {
      screenGroupId?: string | null;
      scoreboardTemplateId?: string | null;
      ribbonTemplateId?: string | null;
      scorebugTemplateId?: string | null;
    },
  ): Promise<void> {
    if (refs.screenGroupId) {
      const sg = await this.prisma.client.screenGroup.findFirst({
        where: { id: refs.screenGroupId, tenantId },
        select: { id: true },
      });
      if (!sg) {
        throw new NotFoundException(
          `Screen group not found in this tenant: ${refs.screenGroupId}`,
        );
      }
    }
    const templateIds = [
      refs.scoreboardTemplateId,
      refs.ribbonTemplateId,
      refs.scorebugTemplateId,
    ].filter((x): x is string => typeof x === 'string' && x.length > 0);
    if (templateIds.length > 0) {
      const owned = await this.prisma.client.template.findMany({
        where: {
          id: { in: templateIds },
          OR: [{ tenantId }, { isSystem: true }],
        },
        select: { id: true },
      });
      const ownedSet = new Set(owned.map((t) => t.id));
      const foreign = templateIds.filter((id) => !ownedSet.has(id));
      if (foreign.length > 0) {
        throw new NotFoundException(
          `Template(s) not found in this tenant: ${foreign.join(', ')}`,
        );
      }
    }
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
    // Lane-2 P0 ownership check — see assertOwnedGameRefs for rationale.
    await this.assertOwnedGameRefs(tenantId, dto);
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
    // Lane-2 P0 ownership check — see assertOwnedGameRefs for rationale.
    await this.assertOwnedGameRefs(tenantId, dto);
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
    const updated = await this.prisma.client.game.update({ where: { id }, data });
    // Lane-8 P1 (re-audit): updateGameDetails bypasses record(), so the
    // board cache wouldn't refresh on team-name/color/logo/template change
    // for up to BOARD_CACHE_TTL_MS. Invalidate explicitly.
    this.invalidateBoardCache(id);
    return updated;
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
      const cleared = await this.prisma.client.game.update({
        where: { id },
        data: { spotlight: {} },
      });
      this.invalidateBoardCache(id); // Lane-8 P1: bypasses record()
      return cleared;
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
    const updated = await this.prisma.client.game.update({
      where: { id },
      data: { spotlight: spotlight as any },
    });
    this.invalidateBoardCache(id); // Lane-8 P1: bypasses record()
    return updated;
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
    actorUserId?: string,
  ) {
    const game = await this.owned(tenantId, id);
    const team = dto.team === 'away' ? 'away' : 'home';
    const delta = Number(dto.delta);
    if (!Number.isFinite(delta) || !Number.isInteger(delta)) {
      throw new BadRequestException('delta must be an integer');
    }
    // Audit-Fix 1: snapshot prev scores BEFORE the mutation as primitives —
    // the auto-celebrate delta must compare pre- vs post-update values,
    // never alias the same mutable row object.
    const prevScores = { homeScore: game.homeScore, awayScore: game.awayScore };
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
      // Undo rail: prev state so the inverse can be synthesized without
      // a DB read at undo time.
      prevHomeScore: prevScores.homeScore,
      prevAwayScore: prevScores.awayScore,
    });
    // Audit-Fix 1: the +7 button (and every other manual quick-button) now
    // fires AUTO celebrations — same path the feed uses. Without this, the
    // operator taps +7 on the dashboard, the score jumps 14→21, and
    // NOTHING animates. Translate (team, delta) into the (homeScore |
    // awayScore) shape maybeAutoCelebrate consumes so the delta arithmetic
    // matches the feed path. Source is attributed in the AuditLog row.
    try {
      const cueDto: { homeScore?: number; awayScore?: number } =
        team === 'home' ? { homeScore: updated.homeScore } : { awayScore: updated.awayScore };
      await this.maybeAutoCelebrate(id, prevScores, updated, cueDto, {
        source: 'manual',
        actorUserId,
      });
    } catch (e) {
      this.logger.debug(`auto-celebrate skipped for game ${id}: ${(e as Error).message}`);
    }
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
    actorUserId?: string,
  ) {
    const game = await this.owned(tenantId, id);
    const clamp = (v: unknown, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : fallback;
    };
    const homeScore = clamp(dto.homeScore, game.homeScore);
    const awayScore = clamp(dto.awayScore, game.awayScore);

    // Audit-Fix 1: snapshot prev scores BEFORE the mutation so a manual
    // set fires the same AUTO celebration path as the feed.
    const prevScores = { homeScore: game.homeScore, awayScore: game.awayScore };

    const updated = await this.prisma.client.game.update({
      where: { id },
      data: { homeScore, awayScore },
    });
    await this.record(id, 'SCORE', { team: 'set', homeScore, awayScore });
    // Audit-Fix 1: manual score sets also fire AUTO celebrations. Only
    // fields actually supplied by the operator are marked as "provided" so
    // a typo-fix that leaves a team untouched doesn't spuriously celebrate.
    try {
      const cueDto: { homeScore?: number; awayScore?: number } = {};
      if (dto.homeScore !== undefined) cueDto.homeScore = homeScore;
      if (dto.awayScore !== undefined) cueDto.awayScore = awayScore;
      await this.maybeAutoCelebrate(id, prevScores, updated, cueDto, {
        source: 'manual',
        actorUserId,
      });
    } catch (e) {
      this.logger.debug(`auto-celebrate skipped for game ${id}: ${(e as Error).message}`);
    }
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

    // Capture prev state BEFORE mutation for the undo rail.
    const prevClockMs = game.clockMs;
    const prevClockRunning = game.clockRunning;

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
    //
    // 2026-05-27 — Shot clock ALSO slaves to the game clock. Only on
    // start/stop transitions (not set/reset/nudge — those edit the
    // game clock alone without touching the possession's shot clock).
    // Both syncs read from `game.stats` and chain: the penalty sync
    // may return a fresh stats object, then the shot-clock sync
    // mutates that same object so the final UPDATE writes ONE merged
    // stats row.
    const data: Record<string, unknown> = {
      clockMs,
      clockRunning,
      clockUpdatedAt: now,
    };
    const clockMutated = action === 'start' || action === 'pause';
    let mergedStats = this.syncPenaltiesToClock(game.stats, clockRunning, now);
    const sourceStats = mergedStats || game.stats;
    // T2-10 / Invariant #6: pass the post-action game clock so the
    // shot clock is clamped to it (e.g. "0:08 left in Q4" case).
    const shotStats = this.syncShotClockToGameClock(
      sourceStats,
      clockMutated,
      clockRunning,
      now,
      clockMs,
    );
    if (shotStats) mergedStats = shotStats;
    // T2-7 — Football play clock slaves to game clock (mirrors shot clock).
    const playStats = this.syncPlayClockToGameClock(
      mergedStats || sourceStats,
      def.key,
      clockMutated,
      clockRunning,
      now,
    );
    if (playStats) mergedStats = playStats;
    if (mergedStats) data.stats = mergedStats as any;

    const updated = await this.prisma.client.game.update({ where: { id }, data });
    await this.record(id, 'CLOCK', {
      action,
      clockMs,
      clockRunning,
      // Undo rail: prev state for inversion.
      prevClockMs,
      prevClockRunning,
    });

    // T2-5: auto-clear live overlay when the clock starts. Penalty /
    // injury overlays should disappear the moment play resumes — writing
    // a clearing LIVE_OVERLAY event here means the board picks it up on
    // the next 750ms poll without the operator needing to tap "Clear".
    // Review overlays are NOT auto-cleared (they are persistent by design
    // and require an explicit clear call).
    if (action === 'start') {
      const latestOverlay = await this.prisma.client.gameEvent.findFirst({
        where: { gameId: id, type: 'LIVE_OVERLAY' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, payload: true },
      });
      const overlayKind = (latestOverlay?.payload as Record<string, unknown> | undefined)?.kind;
      if (overlayKind && overlayKind !== 'clear' && overlayKind !== 'review') {
        // Auto-clear non-persistent overlays — penalty, injury, timeout-banner.
        await this.record(id, 'LIVE_OVERLAY', {
          kind: 'clear',
          auto: true,
          reason: 'clock-start',
        });
      }
    }

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

    // 2026-05-27 — Honor the sport's shot-clock options (lacrosse uses
    // 60/80s, water polo 20/30s). Previously hardcoded to the basketball
    // set, which silently turned the shot clock OFF when an operator
    // picked 60s for lacrosse or 20s for water polo.
    const sportDef = this.sportOf(game.sport);
    const allowedOptions = sportDef.shotClock?.options ?? [0, 24, 30, 35];
    switch (action) {
      case 'configure': {
        // value = shot-clock length in seconds — must be one of the
        // sport's configured options.
        const v = Math.round(Number(dto.value));
        len = allowedOptions.includes(v) ? v : 0;
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
        // value = seconds to reset to (full length, or a partial reset
        // like 14s for basketball offensive rebound). Bounded by the
        // configured length so the clock can't reset beyond `len`.
        const v = Math.round(Number(dto.value));
        const sec = Number.isFinite(v) && v > 0 ? v : len;
        ms = Math.min(sec, len || sec) * 1000;
        // 2026-05-27 — operator bug 51494dff: "when I click the 20 or
        // 30 second time clock reset it auto starts even if the game
        // clock is stopped or paused, that break the rule that time
        // clock and game clock are in sync always".
        //
        // Old behavior: `running = len > 0` — reset ALWAYS auto-started
        // the shot clock if a length was configured, regardless of game
        // state. Wrong for every sport: in basketball / water polo /
        // lacrosse / hockey, the shot clock is supposed to start when
        // the BALL goes live (= game clock starts), not when the ref
        // resets the value. Resetting during a dead ball + auto-running
        // sent the bug-filer's water polo clock counting down while
        // the period clock sat at the timeout.
        //
        // New behavior: shot clock auto-runs after reset ONLY when the
        // game clock is currently running. If game clock is paused,
        // the shot clock parks at the new value and waits — it'll
        // start when the operator starts the game clock (a separate
        // wiring change in /clock 'start' could also kick this if we
        // want auto-sync on start, but that's a Phase 2 lift). Honors
        // Greg's "in sync always" rule.
        running = game.clockRunning && len > 0;
        break;
      }
      default:
        throw new BadRequestException('action must be configure | start | stop | reset');
    }

    // T2-10 / Invariant #6: clamp shot clock to the live game clock so
    // it can never read higher than the remaining game time.
    const liveGameClockMs = this.liveClockMs(game);
    if (liveGameClockMs >= 0) {
      ms = Math.min(ms, liveGameClockMs);
    }

    const shotClock = { len, ms, at: new Date().toISOString(), running };
    const updated = await this.prisma.client.game.update({
      where: { id },
      data: { stats: { ...stats, shotClock } as any },
    });
    this.invalidateBoardCache(id); // Lane-8 P1: bypasses record()
    return updated;
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
    const updated = await this.prisma.client.game.update({
      where: { id },
      data: { stats: { ...stats, playClock } as any },
    });
    this.invalidateBoardCache(id); // Lane-8 P1: bypasses record()
    return updated;
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
  /**
   * 2026-05-27 — Slave the shot clock to the game clock.
   * Operator: "when i stop and start the time clock it should auto
   * stop the clock shot and they need to be exact, the clock is so
   * important it needs to be instant because every second matters in
   * sports games".
   *
   * Same pattern as syncPenaltiesToClock. Returns a stats patch (or
   * null when no shot clock is configured), called from clockAction()
   * inside the same DB transaction so the two clocks share a single
   * anchor timestamp — zero drift between them.
   *
   * Behavior:
   *   - Game.start → shot clock runs at its current value (resuming).
   *   - Game.stop  → shot clock freezes at its current value.
   *   - set / reset / fine-nudge don't touch the shot clock — those
   *     are operator-precise edits to the game clock alone (a 1-sec
   *     correction on the game clock shouldn't burn a possession's
   *     shot clock).
   *   - When the shot clock isn't configured (len === 0 / off), this
   *     no-ops cleanly.
   *
   * `clockMutated` is true only for start/stop transitions; false for
   * set/reset where the running state didn't flip. Callers pass that
   * in so this helper doesn't have to second-guess the action.
   */
  private syncShotClockToGameClock(
    rawStats: unknown,
    clockMutated: boolean,
    running: boolean,
    now: Date,
    /**
     * T2-10 / Invariant #6: the live game-clock remaining at the instant
     * of this sync. When provided, the shot clock is clamped to this value
     * so it can never read higher than the game clock (e.g. "0:08 left in
     * Q4 but shot clock still showing 0:24"). Pass undefined to skip the
     * clamp (callers that don't have the game-clock value handy).
     */
    gameClockMs?: number,
  ): Record<string, unknown> | null {
    if (!clockMutated) return null;
    if (!rawStats || typeof rawStats !== 'object') return null;
    const stats = { ...(rawStats as Record<string, unknown>) };
    const prev = (stats.shotClock && typeof stats.shotClock === 'object')
      ? (stats.shotClock as Record<string, unknown>)
      : null;
    if (!prev) return null;
    const len = Number(prev.len) || 0;
    if (len <= 0) return null; // shot clock OFF — nothing to slave
    // Project current live ms from the prior anchor (same math as
    // setShotClock + the UI projection in RunShotClockMini).
    let ms = Math.max(0, Number(prev.ms) || 0);
    const prevRunning = !!prev.running;
    if (prevRunning) {
      const at = new Date(String(prev.at || '')).getTime();
      if (Number.isFinite(at)) {
        ms = Math.max(0, ms - (now.getTime() - at));
      }
    }
    // T2-10 / Invariant #6: clamp shot clock to game clock remaining.
    if (gameClockMs !== undefined && gameClockMs >= 0) {
      ms = Math.min(ms, gameClockMs);
    }
    // Re-anchor: same `at` as the game clock's write so projections
    // on either clock from this point forward share a single source
    // of truth.
    stats.shotClock = {
      len,
      ms,
      at: now.toISOString(),
      running,
    };
    return stats;
  }

  /**
   * T2-7 — Football play clock slaved to the game clock.
   *
   * Mirror of syncShotClockToGameClock but for the football 40/25-second
   * play clock. Only fires when:
   *   1. clockMutated is true (start/pause transitions — NOT set/reset).
   *   2. The sport is FOOTBALL (def.key === 'football').
   *   3. stats.playClock is present (backwards-compat: games without a
   *      configured play clock are a no-op).
   *
   * Behavior:
   *   - 'pause' (clockMutated, running=false): freeze play clock at its
   *     current live value. The ref's whistle stops both clocks together.
   *   - 'start' (clockMutated, running=true): if armed (running was already
   *     true or ms > 0), re-anchor at the current live value and mark
   *     running. If the play clock was already at 0, auto-resets to 40s
   *     (a snap without a prior reset — defensive, not the normal path).
   *   - After callTimeout the play clock is pre-set to 25s and NOT running;
   *     the next game-clock start will start it from there (armed = ms > 0).
   *
   * `sportKey` is passed in rather than re-loading the sport def so this
   * helper stays pure (no async, no DB) and shares the caller's def lookup.
   */
  private syncPlayClockToGameClock(
    rawStats: unknown,
    sportKey: string,
    clockMutated: boolean,
    running: boolean,
    now: Date,
  ): Record<string, unknown> | null {
    if (!clockMutated) return null;
    // Only football has a play clock.
    if (sportKey !== 'football') return null;
    if (!rawStats || typeof rawStats !== 'object') return null;
    const stats = { ...(rawStats as Record<string, unknown>) };
    const prev = (stats.playClock && typeof stats.playClock === 'object')
      ? (stats.playClock as Record<string, unknown>)
      : null;
    if (!prev) return null; // no play clock configured → no-op
    // Project current live ms from the prior anchor (same math as setPlayClock).
    let ms = Math.max(0, Number(prev.ms) || 0);
    const prevRunning = !!prev.running;
    if (prevRunning) {
      const at = new Date(String(prev.at || '')).getTime();
      if (Number.isFinite(at)) {
        ms = Math.max(0, ms - (now.getTime() - at));
      }
    }
    if (!running) {
      // Game clock paused → freeze play clock at current live value.
      stats.playClock = { ms, at: now.toISOString(), running: false };
    } else {
      // Game clock started → re-anchor and run.
      // If clock has already expired, reset to 40s (the standard fresh-snap
      // duration). This guards against the operator forgetting to reset.
      if (ms <= 0) ms = 40_000;
      stats.playClock = { ms, at: now.toISOString(), running: true };
    }
    return stats;
  }

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
    // CTS-sourced penalties (T2-1) have a different shape — slot/playerJersey/
    // secondsRemaining — and carry their own running state from the CTS
    // console. Preserve them as-is; only operator-shaped penalties are
    // re-anchored to the game clock.
    const ctsRows: Record<string, unknown>[] = [];
    const operatorRows: Record<string, unknown>[] = [];
    for (const p of stats.penalties as unknown[]) {
      if (!p || typeof p !== 'object') continue;
      const row = p as Record<string, unknown>;
      if (row.source === 'cts') ctsRows.push(row);
      else operatorRows.push(row);
    }
    const reAnchored = operatorRows
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
    stats.penalties = [...reAnchored, ...ctsRows];
    return stats;
  }

  /**
   * T2-10: Apply per-sport segment-reset rules to the stats blob.
   *
   * Returns an object with only the STAT keys that changed (so the
   * caller can merge just those into Game.stats and write individual
   * STAT GameEvents for the undo rail), plus a `shotClockReset`
   * boolean so the caller can do the shotClock anchor update
   * separately (it needs `def` + `now`).
   *
   * @param def       The sport definition (carries segmentReset).
   * @param rawStats  Current Game.stats (JSON blob, may be null).
   * @param newSegment The segment index we're advancing TO (1-based).
   */
  private computeSegmentResets(
    def: import('@cms/api-types').SportDefinition,
    rawStats: unknown,
    newSegment: number,
  ): { statDeltas: Record<string, unknown>; shotClockReset: boolean } {
    const rules = def.segmentReset;
    const statDeltas: Record<string, unknown> = {};
    let shotClockReset = false;
    if (!rules) return { statDeltas, shotClockReset };

    const stats: Record<string, unknown> =
      rawStats && typeof rawStats === 'object'
        ? (rawStats as Record<string, unknown>)
        : {};

    // Foul resets — every segment boundary.
    if (rules.homeFouls && (stats.homeFouls ?? 0) !== 0) {
      statDeltas.homeFouls = 0;
    }
    if (rules.awayFouls && (stats.awayFouls ?? 0) !== 0) {
      statDeltas.awayFouls = 0;
    }

    // Timeout resets — 'segment' = always; 'half' = only at the halfway
    // boundary (after segment count/2 in a 4-quarter sport that's after Q2).
    const halfPoint = Math.floor(def.segment.count / 2);
    const atHalf = newSegment === halfPoint + 1; // advancing INTO the second half
    const maxTimeouts = (key: 'homeTimeouts' | 'awayTimeouts'): number => {
      const field = def.stats.find((f) => f.key === key);
      return field?.max ?? 3;
    };

    if (rules.homeTimeouts === 'segment') {
      const fullVal = maxTimeouts('homeTimeouts');
      if ((stats.homeTimeouts ?? fullVal) !== fullVal) statDeltas.homeTimeouts = fullVal;
    } else if (rules.homeTimeouts === 'half' && atHalf) {
      const fullVal = maxTimeouts('homeTimeouts');
      if ((stats.homeTimeouts ?? fullVal) !== fullVal) statDeltas.homeTimeouts = fullVal;
    }

    if (rules.awayTimeouts === 'segment') {
      const fullVal = maxTimeouts('awayTimeouts');
      if ((stats.awayTimeouts ?? fullVal) !== fullVal) statDeltas.awayTimeouts = fullVal;
    } else if (rules.awayTimeouts === 'half' && atHalf) {
      const fullVal = maxTimeouts('awayTimeouts');
      if ((stats.awayTimeouts ?? fullVal) !== fullVal) statDeltas.awayTimeouts = fullVal;
    }

    // Shot clock reset flag — the caller handles the actual anchor update
    // because it needs `def.shotClock.full` and a timestamp.
    if (rules.shotClock && def.shotClock) {
      shotClockReset = true;
    }

    return { statDeltas, shotClockReset };
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

    // Capture prev state for undo rail before any mutation.
    const prevSegment = game.segment;
    const prevClockMs = game.clockMs;

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
    const now = new Date();
    const data: Record<string, unknown> = { segment };
    if (def.clock.type !== 'none') {
      data.clockMs = this.segmentStartMs(def);
      data.clockRunning = false;
      data.clockUpdatedAt = now;
    }

    // T2-10: apply per-sport segment-reset rules AND T2-7's football
    // play-clock reset in one merged stats write. Both are
    // complementary: T2-10 handles homeFouls/awayFouls/timeouts/shot
    // clock per SportDefinition; T2-7 specifically resets the football
    // play clock to 40s on quarter advance.
    const { statDeltas, shotClockReset } = this.computeSegmentResets(
      def,
      game.stats,
      segment,
    );
    let mergedStats: Record<string, unknown> =
      game.stats && typeof game.stats === 'object'
        ? { ...(game.stats as Record<string, unknown>) }
        : {};
    if (Object.keys(statDeltas).length > 0) {
      mergedStats = { ...mergedStats, ...statDeltas };
    }
    if (shotClockReset && def.shotClock) {
      const fullMs = def.shotClock.full * 1000;
      // Clamp shot clock to the (just-reset) game clock — both start at
      // their segment-start values, so this is a no-op in normal play but
      // keeps the invariant clean (Invariant #6 from the clock state doc).
      const gameClockMs = data.clockMs !== undefined
        ? Number(data.clockMs)
        : this.segmentStartMs(def);
      const clampedMs = Math.min(fullMs, gameClockMs);
      const prevShotClock =
        mergedStats.shotClock && typeof mergedStats.shotClock === 'object'
          ? (mergedStats.shotClock as Record<string, unknown>)
          : {};
      const len = Number(prevShotClock.len) || 0;
      if (len > 0) {
        // Only reset if a shot clock length is configured.
        mergedStats.shotClock = {
          len,
          ms: clampedMs,
          at: now.toISOString(),
          running: false,
        };
      }
    }
    // T2-7: football play-clock reset to 40s on quarter advance.
    if (def.key === 'football' && mergedStats.playClock) {
      mergedStats.playClock = { ms: 40_000, at: now.toISOString(), running: false };
    }
    if (Object.keys(mergedStats).length > 0) {
      data.stats = mergedStats as any;
    }

    const updated = await this.prisma.client.game.update({ where: { id }, data });
    await this.record(id, 'SEGMENT', {
      segment,
      // Undo rail: prev segment + prev clock so the inverse can restore both.
      prevSegment,
      prevClockMs,
    });

    // T2-10: write individual STAT GameEvents for each reset field so the
    // undo rail can target them independently.
    for (const [key, newVal] of Object.entries(statDeltas)) {
      const oldVal =
        game.stats && typeof game.stats === 'object'
          ? (game.stats as Record<string, unknown>)[key] ?? null
          : null;
      await this.record(id, 'STAT', {
        stats: { [key]: newVal },
        oldValues: { [key]: oldVal },
        source: 'segment-reset',
        segment,
      });
    }
    if (shotClockReset && def.shotClock) {
      await this.record(id, 'STAT', {
        stats: { shotClock: mergedStats.shotClock },
        source: 'segment-reset',
        segment,
      });
    }

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
      // T2-7 — Football: any clock expiry stops the game clock → reset
      // the play clock to 40s and freeze it. The syncPlayClockToGameClock
      // helper handles this but autoAdvanceExpiredClocks writes the game
      // row directly (no clockAction call), so we build the stats patch here.
      const playClockPatch = ((): Record<string, unknown> | null => {
        if (def.key !== 'football') return null;
        const s = game.stats && typeof game.stats === 'object'
          ? (game.stats as Record<string, unknown>)
          : {};
        if (!s.playClock) return null;
        return { ...s, playClock: { ms: 40_000, at: now.toISOString(), running: false } };
      })();

      if (game.segment >= def.segment.count) {
        // Final regulation segment ended — stop the clock and let the
        // operator decide overtime / final. Never auto-force OT.
        const finalData: Record<string, unknown> = {
          clockRunning: false,
          clockMs: def.clock.type === 'countdown' ? 0 : segMs,
          clockUpdatedAt: now,
        };
        if (playClockPatch) finalData.stats = playClockPatch as any;
        await this.prisma.client.game.update({
          where: { id: game.id },
          data: finalData,
        });
        await this.record(game.id, 'CLOCK', { action: 'expired', clockRunning: false });
        // T1-5: Horn cue at every clock expiry — fires on both the final
        // regulation segment (clock stops, operator calls FINAL) and
        // mid-game segment boundaries (auto-advance path below).
        await this.record(game.id, 'CUE', {
          key: 'horn',
          label: 'Horn',
          emoji: '📯',
          target: 'ALL',
          auto: true,
          source: 'clock-expired',
          segmentLabel: this.segmentLabelOf(def, game.segment),
        });
      } else {
        // Roll to the next segment with a fresh, stopped clock.
        const segment = game.segment + 1;
        const segmentClockMs = this.segmentStartMs(def);
        const autoData: Record<string, unknown> = {
          segment,
          clockMs: segmentClockMs,
          clockRunning: false,
          clockUpdatedAt: now,
        };

        // T2-10: apply per-sport segment-reset rules on auto-advance too.
        const { statDeltas: autoStatDeltas, shotClockReset: autoShotReset } =
          this.computeSegmentResets(def, game.stats, segment);
        let autoStats: Record<string, unknown> =
          game.stats && typeof game.stats === 'object'
            ? { ...(game.stats as Record<string, unknown>) }
            : {};
        if (Object.keys(autoStatDeltas).length > 0) {
          autoStats = { ...autoStats, ...autoStatDeltas };
        }
        if (autoShotReset && def.shotClock) {
          const fullMs = def.shotClock.full * 1000;
          const clampedMs = Math.min(fullMs, segmentClockMs);
          const prevSC =
            autoStats.shotClock && typeof autoStats.shotClock === 'object'
              ? (autoStats.shotClock as Record<string, unknown>)
              : {};
          const len = Number(prevSC.len) || 0;
          if (len > 0) {
            autoStats.shotClock = {
              len,
              ms: clampedMs,
              at: now.toISOString(),
              running: false,
            };
          }
        }
        // T2-7: football play-clock reset on auto-advance.
        if (playClockPatch && typeof playClockPatch === 'object') {
          autoStats = { ...autoStats, ...(playClockPatch as Record<string, unknown>) };
        }
        if (Object.keys(autoStats).length > 0) {
          autoData.stats = autoStats as any;
        }

        await this.prisma.client.game.update({
          where: { id: game.id },
          data: autoData,
        });
        await this.record(game.id, 'SEGMENT', { segment, auto: true });
        await this.record(game.id, 'CLOCK', { action: 'auto-advance', clockRunning: false });

        // T2-10: individual STAT events for each reset (undo rail).
        for (const [key, newVal] of Object.entries(autoStatDeltas)) {
          const oldVal =
            game.stats && typeof game.stats === 'object'
              ? (game.stats as Record<string, unknown>)[key] ?? null
              : null;
          await this.record(game.id, 'STAT', {
            stats: { [key]: newVal },
            oldValues: { [key]: oldVal },
            source: 'segment-reset',
            segment,
            auto: true,
          });
        }
        if (autoShotReset && def.shotClock) {
          await this.record(game.id, 'STAT', {
            stats: { shotClock: autoStats.shotClock },
            source: 'segment-reset',
            segment,
            auto: true,
          });
        }

        // T1-5: Horn cue for end-of-period. Carries the OLD segment label
        // ("Q1 END", "PERIOD 2 END") so the overlay reads correctly — the
        // segment row has already advanced to `segment` above.
        await this.record(game.id, 'CUE', {
          key: 'horn',
          label: 'Horn',
          emoji: '📯',
          target: 'ALL',
          auto: true,
          source: 'clock-auto-advance',
          segmentLabel: this.segmentLabelOf(def, game.segment),
        });
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
    // 2026-05-27 — Pure-config keys that live on Game.stats JSON but
    // aren't sport stats (no +/- chips on the scoreboard tile). Each
    // is operator-set in Setup mode. Add new ones here as game-level
    // settings expand; resist the urge to add per-sport state (those
    // belong in def.stats so the type system can constrain them).
    const META_KEYS = new Set([
      'celebrationPack',
    ]);
    const current = (game.stats as Record<string, unknown>) || {};
    // Snapshot the old values for every key being mutated — used by the
    // undo rail to write `oldValue` into the STAT GameEvent payload.
    const oldValues: Record<string, unknown> = {};
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(dto.stats)) {
      if (!allowed.has(key) && !META_KEYS.has(key)) continue;
      // Bound the value: strings capped at 200 chars, numbers/booleans
      // pass, anything else (object/array) dropped — so a stat edit
      // can't bloat the game's stats JSON column.
      if (typeof value === 'string') {
        oldValues[key] = current[key] ?? null;
        next[key] = value.slice(0, 200);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        oldValues[key] = current[key] ?? null;
        next[key] = value;
      }
    }

    // Sport rules: the baseball/softball count cascades automatically.
    // T2-10: capture pre-cascade state to detect strikeout / walk events
    // so we can fire their celebration CUEs (both were dead code before).
    const preStrikes = typeof next.strikes === 'number' ? next.strikes : 0;
    const preBalls = typeof next.balls === 'number' ? next.balls : 0;
    const preOuts = typeof next.outs === 'number' ? next.outs : 0;
    const isBaseballSport = game.sport === 'baseball' || game.sport === 'softball';
    const segmentDelta = isBaseballSport ? this.applyBaseballCount(next) : 0;
    // Detect what event(s) the cascade produced.
    const postStrikes = typeof next.strikes === 'number' ? next.strikes : 0;
    const postOuts = typeof next.outs === 'number' ? next.outs : 0;
    const wasStrikeout = isBaseballSport && preStrikes >= 3 && postStrikes === 0 && postOuts > preOuts;
    const wasWalk = isBaseballSport && preBalls >= 4 && postStrikes === 0;

    const data: Record<string, unknown> = { stats: next as any };
    if (segmentDelta) {
      const max = def.segment.overtime ? def.segment.count + 10 : def.segment.count;
      data.segment = Math.min(max, game.segment + segmentDelta);
    }

    const updated = await this.prisma.client.game.update({ where: { id }, data });
    // Include oldValues alongside newValues so the undo rail can restore.
    await this.record(id, 'STAT', { stats: next, oldValues });
    if (segmentDelta) await this.record(id, 'SEGMENT', { segment: data.segment });

    // T2-10: fire celebration CUEs for strikeout. Walk is informational
    // but the sport def has no 'walk' celebration, so only fire strikeout.
    // `wasWalk` is detected here for future extension — it's intentionally
    // not wired to a CUE since the baseball def has no walk celebration.
    void wasWalk; // suppress unused warning
    if (wasStrikeout) {
      const strikeoutCue = def.celebrations.find((c) => c.key === 'strikeout');
      if (strikeoutCue) {
        await this.record(id, 'CUE', {
          key: strikeoutCue.key,
          label: strikeoutCue.label,
          emoji: strikeoutCue.emoji,
          target: 'ALL',
          audioUrl: null,
          sponsorName: null,
          sponsorLogoUrl: null,
          auto: true,
          source: 'rule',
          snapshot: this.cueSnapshot(updated),
        });
      }
    }

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

    // T2-10: fire the 'setWin' celebration CUE — it was dead code before
    // because applySetWin wrote a SEGMENT/STATUS event but never a CUE.
    // The sport def for both volleyball and pickleball carries this celebration.
    const setWinCue = def.celebrations.find((c) => c.key === 'setWin');
    if (setWinCue) {
      await this.record(game.id, 'CUE', {
        key: setWinCue.key,
        label: setWinCue.label,
        emoji: setWinCue.emoji,
        target: 'ALL',
        audioUrl: null,
        sponsorName: null,
        sponsorLogoUrl: null,
        auto: true,
        team: winner,
        source: 'rule',
        snapshot: this.cueSnapshot(updated),
      });
    }

    return updated;
  }

  /**
   * Atomic state push from an external score source — a console tap-off
   * box or a league-feed adapter. Any subset of fields may be provided;
   * only the fields present in the dto are written. Clock fields are
   * re-anchored (clockUpdatedAt = now) whenever clockMs or clockRunning
   * is supplied, exactly as the 'set' clock action does. A GameEvent
   * row of type 'INGEST' is appended for the audit trail; the public
   * board's 750ms poll + invalidated cache then picks it up within a
   * perceived sub-second. (Audit-Fix 2: there is no pub/sub fan-out —
   * see record() and the class-level note.)
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

    // Segment — clamp to >= 1, and apply the same side effects setSegment
    // uses: reset the game clock to the segment start and stop it.
    // Without this, an integration reporting "period 2" leaves the clock
    // wherever the operator left it — a count-up soccer clock would jump
    // forward by the entire halftime gap, and a countdown football clock
    // would carry the Q1 time into Q2.
    if (dto.segment !== undefined) {
      const v = Math.max(1, Math.round(Number(dto.segment)));
      if (Number.isFinite(v) && v !== game.segment) {
        data.segment = v;
        applied.segment = v;
        // Mirror setSegment: reset + stop the clock when segment advances.
        const def = this.sportOf(game.sport);
        if (def.clock.type !== 'none') {
          data.clockMs = this.segmentStartMs(def);
          data.clockRunning = false;
          data.clockUpdatedAt = new Date();
        }
      } else if (Number.isFinite(v)) {
        // Same segment — still record it in applied so INGEST log is correct.
        data.segment = v;
        applied.segment = v;
      }
    }

    // Clock — re-anchor clockUpdatedAt = now whenever either clock field
    // is provided, exactly mirroring what the 'set' clock action does.
    // Additionally, when clockRunning flips (start/stop transition), run
    // the same helper chain clockAction uses: freeze penalty-box timers and
    // slave the shot clock — so "all the same rules apply if we are doing
    // it or the integration is doing it" (Greg's rule, research doc §3).
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

      // Sync helper chain — only on a running-state TRANSITION so that a
      // bare clockMs 'set' doesn't accidentally flip penalty and shot-clock
      // running states (same guard clockAction uses for 'set'/'reset').
      const runningFlipped =
        dto.clockRunning !== undefined && dto.clockRunning !== game.clockRunning;
      if (runningFlipped) {
        const running = Boolean(dto.clockRunning);
        let mergedStats = this.syncPenaltiesToClock(game.stats, running, now);
        const sourceStats = mergedStats ?? game.stats;
        // T2-10: pass the incoming game clock for clamping (Invariant #6).
        const ingestClockMs = typeof dto.clockMs === 'number' ? dto.clockMs : game.clockMs;
        const shotStats = this.syncShotClockToGameClock(sourceStats, true, running, now, ingestClockMs);
        if (shotStats) mergedStats = shotStats;
        if (mergedStats) data.stats = mergedStats as any;
      }
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
        await this.maybeAutoCelebrate(id, prevScores, updated, dto, { source: 'feed' });
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
    opts: { source?: 'manual' | 'feed'; actorUserId?: string } = {},
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

    // Audit-Fix 1: AuditLog attribution — 'feed' (machine ingest) or
    // 'manual' (dashboard quick-buttons / typo-fix). SUPER_ADMIN forensic
    // review can answer "which sponsor takeover fired off which path".
    const source: 'manual' | 'feed' = opts.source === 'manual' ? 'manual' : 'feed';
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
        source,
        snapshot,
      });
      // Lane-8 P1: AUTO cues also get an immutable AuditLog row (forensics).
      // Audit-Fix 1: manual quick-button auto-fires now record `userId` so
      // the actor is named; feed auto-fires have no user — machine-to-machine.
      try {
        await this.prisma.client.auditLog.create({
          data: {
            tenantId: next.tenantId,
            userId: opts.actorUserId || null,
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
              source,
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

    // T1-5: Status-transition cinematics — fire a synthetic CUE event so
    // every surface (board, ribbon, scorebug) can play a visual/audio cue
    // instead of silently swapping the scene on the next poll.
    if (status === 'HALFTIME') {
      await this.record(id, 'CUE', {
        key: 'status:halftime',
        label: 'Halftime',
        emoji: '🏟️',
        target: 'ALL',
        auto: true,
        source: 'status-transition',
        snapshot: this.cueSnapshot(updated as Parameters<typeof this.cueSnapshot>[0]),
      });
    } else if (status === 'FINAL') {
      // Determine winner from the freshly-updated row for accurate
      // snapshot — homeScore / awayScore on `updated` are live.
      const up = updated as { homeScore: number; awayScore: number } & typeof updated;
      const cueKey =
        up.homeScore > up.awayScore
          ? 'status:final-home'
          : up.awayScore > up.homeScore
            ? 'status:final-away'
            : 'status:final-tie';
      await this.record(id, 'CUE', {
        key: cueKey,
        label: 'Final',
        emoji: '🏆',
        target: 'ALL',
        auto: true,
        source: 'status-transition',
        snapshot: this.cueSnapshot(updated as Parameters<typeof this.cueSnapshot>[0]),
      });
    }

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
      // 2026-05-27 — Player attribution for the celebration. Operator:
      // "shouldn't my cues tie back to a player? so it says like Goal
      // and has the name of the player that got the goal and number".
      // Most common path: ribbon's RunInlineCuesBar reads the currently
      // -spotlit player and attaches them here when firing GOAL (or
      // any celebration). Cinematic reads these off the cue and shows
      // "SCORED BY #12 SMITH" on its lower-third.
      scorerName?: string;
      scorerNumber?: string;
      scorerPhotoUrl?: string;
      scorerId?: string;
      /**
       * T2-6 — When true, the ribbon renders a tight 2.5s text-crawl
       * strip instead of the full 4500ms cinematic. Scoreboard is
       * unaffected. Automatically set when the operator fires from the
       * inline cue bar's "Ribbon" chip.
       */
      ribbonStrip?: boolean;
    },
    actorUserId?: string,
  ) {
    const game = await this.owned(tenantId, id);
    const target = this.cleanCueTarget(dto.target);
    const ribbonStrip = target === 'RIBBON' || dto.ribbonStrip === true ? true : undefined;

    // Sanitize the three new optional co-branding / audio fields.
    const audioUrl = this.cleanText(dto.audioUrl, 2048);
    const sponsorName = this.cleanText(dto.sponsorName, 120);
    const sponsorLogoUrl = this.cleanText(dto.sponsorLogoUrl, 2048);
    const team = dto.team === 'home' || dto.team === 'away' ? dto.team : null;
    // Scorer attribution — clipped to display-safe lengths.
    const scorerName = this.cleanText(dto.scorerName, 80);
    const scorerNumber = this.cleanText(dto.scorerNumber, 8);
    const scorerPhotoUrl = this.cleanText(dto.scorerPhotoUrl, 2048);
    const scorerId = this.cleanText(dto.scorerId, 64);

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
        // T2-6: ribbon-strip mode — tight 2.5s crawl instead of 4500ms takeover.
        ...(ribbonStrip ? { ribbonStrip: true } : {}),
        audioUrl,
        sponsorName,
        sponsorLogoUrl,
        team,
        scorerName,
        scorerNumber,
        scorerPhotoUrl,
        scorerId,
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
      // T2-6: ribbon-strip mode — tight 2.5s crawl instead of 4500ms takeover.
      ...(ribbonStrip ? { ribbonStrip: true } : {}),
      audioUrl,
      sponsorName,
      sponsorLogoUrl,
      team,
      scorerName,
      scorerNumber,
      scorerPhotoUrl,
      scorerId,
      snapshot: this.cueSnapshot(game),
    });
    await writeAudit(event.id, cue.key, cue.label);
    return { fired: true, cue, target, eventId: event.id };
  }

  /**
   * T2-4: Fire the pre-game starting-lineup choreography.
   *
   * Fetches the roster for `team` ('home' | 'away'), assembles the
   * lineup array, and writes a CUE GameEvent with key 'pregame-intro'.
   * The board page's existing cue-pump picks it up on the next 750ms
   * poll and routes it to `CuelPregameIntroWidget` for a 30-second
   * per-player cinematic takeover.
   *
   * `durationMs` is the per-player slot length (default 3500 ms).
   * `skippable` is surfaced in the cue payload so the board can offer
   * an escape hatch via an operator keypress (not used yet — forwarded
   * for future use).
   */
  async firePregameIntro(
    tenantId: string,
    gameId: string,
    dto: {
      team?: 'home' | 'away';
      audioUrl?: string;
      slotMs?: number;
      skippable?: boolean;
    },
    actorUserId?: string,
  ) {
    const game = await this.owned(tenantId, gameId);
    const team: 'home' | 'away' = dto.team === 'away' ? 'away' : 'home';
    const slotMs = Math.max(1000, Math.min(10_000, Number(dto.slotMs ?? 3500) || 3500));
    const audioUrl = this.cleanText(dto.audioUrl, 2048);
    const skippable = dto.skippable !== false;

    // Fetch the roster — home or away, in display order.
    const players = await this.prisma.client.rosterPlayer.findMany({
      where: { gameId, team },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    // Shape each player to the minimal payload the widget needs — avoid
    // sending the full DB row over the GameEvent feed (stays under Redis
    // message-size limits even for 20-player rosters).
    const lineup = players.map((p) => ({
      id: p.id,
      name: p.name,
      number: p.number ?? '',
      position: p.position ?? '',
      photoUrl: p.photoUrl ?? '',
      stats: (p.stats && typeof p.stats === 'object' ? p.stats : {}) as Record<string, string>,
    }));

    const teamColor =
      team === 'home'
        ? (game.homeColor ?? null)
        : (game.awayColor ?? null);
    const teamName = team === 'home' ? game.homeTeam : game.awayTeam;

    // Total runtime: slotMs × number of players, capped at 60 s so a
    // huge bench never permanently blocks the board.
    const totalMs = Math.min(60_000, slotMs * Math.max(1, lineup.length));

    const event = await this.record(gameId, 'CUE', {
      key: 'pregame-intro',
      label: `${teamName} Starting Lineup`,
      emoji: '🎤',
      target: 'BOARD',        // scoreboard takeover only; ribbon keeps rotating
      durationMs: totalMs,
      audioUrl,
      skippable,
      team,
      teamColor,
      teamName,
      lineup,
      slotMs,
      snapshot: this.cueSnapshot(game as Parameters<typeof this.cueSnapshot>[0]),
    });

    // Immutable AuditLog so game-presentation forensics can answer
    // "who started the lineup intro and when."
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: actorUserId ?? null,
          action: 'SPORTS_PREGAME_INTRO_FIRED',
          targetType: 'Game',
          targetId: gameId,
          details: JSON.stringify({
            eventId: event.id,
            team,
            playerCount: lineup.length,
            totalMs,
            hasAudio: !!audioUrl,
          }),
        },
      });
    } catch {
      // Best-effort — never let an audit failure block the cue.
    }

    return {
      fired: true,
      team,
      playerCount: lineup.length,
      totalMs,
      eventId: event.id,
    };
  }

  /**
   * Call a timeout for a team — the one coupled event Daktronics All
   * Sport has a dedicated TIMEOUT key for, and VenueOS had no atomic
   * equivalent. Calling this endpoint:
   *   1. Refuses with 422 if the team is already at 0 timeouts
   *      (floor-at-zero — you can't go negative).
   *   2. Decrements home/awayTimeouts in Game.stats (floor 0).
   *   3. Pauses the game clock (cascades shot-clock / penalty sync
   *      via the existing clockAction pause path).
   *   4. For football: resets the play clock to 25s and stops it.
   *   5. Appends a TIMEOUT GameEvent for the audit trail.
   *   6. Fires a 'timeout' CUE so surfaces render a "TIMEOUT —
   *      EASTSIDE 2 LEFT" overlay (target: ALL).
   *   7. Writes an immutable AuditLog row.
   *
   * Works for any sport whose SportDefinition carries homeTimeouts /
   * awayTimeouts stat fields (basketball, football, water polo, and
   * any future sport that adds them). Sports without those fields
   * still get the clock-pause + CUE (the decrement is a no-op for a
   * stat key that doesn't exist).
   */
  async callTimeout(
    tenantId: string,
    gameId: string,
    dto: { team?: string; type?: string },
    actorUserId?: string,
  ) {
    const team: 'home' | 'away' = dto.team === 'away' ? 'away' : 'home';
    const timeoutType = dto.type === 'short' ? 'short' : 'full';
    const statKey = team === 'home' ? 'homeTimeouts' : 'awayTimeouts';

    // Load the game (tenant-scoped, or 404).
    const game = await this.owned(tenantId, gameId);
    const def = this.sportOf(game.sport);

    const currentStats: Record<string, unknown> =
      game.stats && typeof game.stats === 'object'
        ? { ...(game.stats as Record<string, unknown>) }
        : {};

    const prevRemaining = Number(currentStats[statKey]);
    if (Number.isFinite(prevRemaining) && prevRemaining <= 0) {
      const label = def.stats.find((s) => s.key === statKey)?.label ?? statKey;
      throw new BadRequestException(
        `BUG_NO_TIMEOUTS_LEFT: ${team} team has no timeouts remaining (${label} = 0)`,
      );
    }
    const newRemaining = Math.max(0, prevRemaining - 1);
    currentStats[statKey] = newRemaining;

    // Football: reset the play clock to 25s + stop it on a timeout.
    if (def.key === 'football') {
      const pc: Record<string, unknown> =
        currentStats.playClock && typeof currentStats.playClock === 'object'
          ? { ...(currentStats.playClock as Record<string, unknown>) }
          : {};
      pc.ms = 25_000;
      pc.running = false;
      if (!pc.at) pc.at = new Date().toISOString();
      currentStats.playClock = pc;
    }

    // Pause the game clock (this also syncs the shot clock + penalty
    // box via the existing clockAction pause path).
    await this.clockAction(tenantId, gameId, { action: 'pause' });

    // Write the decremented timeout count (+ football play-clock reset).
    await this.prisma.client.game.update({
      where: { id: gameId },
      data: { stats: currentStats as any },
    });
    this.invalidateBoardCache(gameId);

    // TIMEOUT GameEvent — the append-only audit trail.
    await this.record(gameId, 'TIMEOUT', {
      team,
      type: timeoutType,
      prevTimeoutsRemaining: prevRemaining,
      newTimeoutsRemaining: newRemaining,
    });

    // CUE — drives the "TIMEOUT — EASTSIDE 2 LEFT" overlay on every
    // surface (scoreboard, ribbon, broadcast scorebug).
    const teamName = team === 'home' ? game.homeTeam : game.awayTeam;
    await this.record(gameId, 'CUE', {
      key: 'timeout',
      label: `Timeout — ${teamName} (${newRemaining} left)`,
      emoji: '⏱️',
      target: 'ALL',
      audioUrl: null,
      sponsorName: null,
      sponsorLogoUrl: null,
      team,
      custom: false,
      snapshot: this.cueSnapshot(game),
    });

    // Immutable AuditLog row.
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: actorUserId || null,
          action: 'SPORTS_TIMEOUT_CALLED',
          targetType: 'Game',
          targetId: gameId,
          details: JSON.stringify({
            team,
            type: timeoutType,
            prevTimeoutsRemaining: prevRemaining,
            newTimeoutsRemaining: newRemaining,
          }),
        },
      });
    } catch { /* best-effort */ }

    return {
      success: true,
      team,
      type: timeoutType,
      timeoutsRemaining: newRemaining,
    };
  }

  // ── live-game text overlay (T2-5) ─────────────────────────────

  /**
   * Fire a live-game text overlay on the scoreboard (and optionally
   * ribbon / broadcast scorebug).  Four overlay kinds:
   *
   *   • penalty   — lower-third "HOLDING #44 — 10 YDS". Auto-clears
   *                 on next clock start (3s default duration).
   *   • review    — persistent "OFFICIAL REVIEW" banner. Stays until
   *                 a separate /live-overlay/clear call.
   *   • injury    — "INJURY TIMEOUT". Auto-clears on clock start.
   *   • timeout-banner — "AWAY TIMEOUT — 2 LEFT" fly-in pill.
   *
   * The overlay is written as a LIVE_OVERLAY GameEvent. The board /
   * ribbon / scorebug poll the `liveOverlay` field on the board
   * response (latest LIVE_OVERLAY event wins, resolved in getBoard).
   * On next clock `start`, clockAction() writes a clearing event
   * automatically so the operator doesn't have to remember to clear.
   */
  async fireLiveOverlay(
    tenantId: string,
    id: string,
    dto: {
      kind: string;
      payload?: Record<string, unknown>;
    },
    actorUserId?: string,
  ) {
    const game = await this.owned(tenantId, id);

    const allowedKinds = ['penalty', 'review', 'injury', 'timeout-banner'] as const;
    type OverlayKind = (typeof allowedKinds)[number];
    const kind = allowedKinds.includes(dto.kind as OverlayKind)
      ? (dto.kind as OverlayKind)
      : null;
    if (!kind) {
      throw new BadRequestException(
        `kind must be one of: ${allowedKinds.join(', ')}`,
      );
    }

    // Sanitize payload fields per kind so arbitrary strings can't
    // bloat the event row. All text capped at broadcast-safe lengths.
    let cleanPayload: Record<string, unknown> = {};
    const raw = dto.payload && typeof dto.payload === 'object' ? dto.payload : {};

    if (kind === 'penalty') {
      const team = raw.team === 'away' ? 'away' : 'home';
      const jersey = this.cleanText(raw.jersey, 12) ?? '';
      const infraction = this.cleanText(raw.infraction, 80) ?? '';
      const yards = Number.isFinite(Number(raw.yards)) ? Number(raw.yards) : null;
      cleanPayload = { team, jersey, infraction, yards };
    } else if (kind === 'review') {
      const description =
        this.cleanText(raw.description, 120) ?? 'OFFICIAL REVIEW — RULING ON FIELD STANDS';
      cleanPayload = { description };
    } else if (kind === 'injury') {
      const team = raw.team === 'away' ? 'away' : 'home';
      const jersey = this.cleanText(raw.jersey, 12) ?? '';
      const type = this.cleanText(raw.type, 60) ?? '';
      cleanPayload = { team, jersey, type };
    } else if (kind === 'timeout-banner') {
      const team = raw.team === 'away' ? 'away' : 'home';
      const remaining = Number.isFinite(Number(raw.remaining)) ? Number(raw.remaining) : null;
      cleanPayload = { team, remaining };
    }

    const event = await this.record(id, 'LIVE_OVERLAY', {
      kind,
      payload: cleanPayload,
      snapshot: this.cueSnapshot(game),
    });

    // Audit trail — who triggered what overlay.
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: actorUserId || null,
          action: 'SPORTS_LIVE_OVERLAY_FIRED',
          targetType: 'Game',
          targetId: id,
          details: JSON.stringify({ kind, payload: cleanPayload, eventId: event.id }),
        },
      });
    } catch { /* best-effort */ }

    return { fired: true, kind, eventId: event.id };
  }

  /**
   * Clear the active live-game text overlay. Writes a LIVE_OVERLAY
   * event with `kind: 'clear'`; the board resolves the latest event
   * so this immediately wins over any prior overlay.
   */
  async clearLiveOverlay(tenantId: string, id: string, actorUserId?: string) {
    await this.owned(tenantId, id);
    const event = await this.record(id, 'LIVE_OVERLAY', { kind: 'clear' });
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: actorUserId || null,
          action: 'SPORTS_LIVE_OVERLAY_CLEARED',
          targetType: 'Game',
          targetId: id,
          details: JSON.stringify({ eventId: event.id }),
        },
      });
    } catch { /* best-effort */ }
    return { cleared: true, eventId: event.id };
  }

  /**
   * T2-8: Set possession to 'home' or 'away' as a first-class column.
   *
   * Replaces the free-text `stats.possession` approach that required the
   * operator to type 'home'/'away' into a generic stat field.  This writes
   * to `Game.possession` (the new dedicated column) so the operator UI can
   * offer a single tap-to-flip chip and display surfaces can read a typed
   * value instead of an arbitrary string.
   *
   * Atomically:
   *  1. Updates `Game.possession`
   *  2. Writes a `POSSESSION` GameEvent with { team, prevPossession }
   *  3. Writes an AuditLog row
   *
   * Sports that don't have a possession concept (baseball, volleyball, etc.)
   * can still call this endpoint — the UI controls gate it by sport, but the
   * service itself doesn't restrict by sport so future sports with possession
   * tracking work automatically.
   */
  async setPossession(
    tenantId: string,
    gameId: string,
    dto: { team?: string },
    actorUserId?: string,
  ) {
    const team: 'home' | 'away' = dto.team === 'away' ? 'away' : 'home';

    const game = await this.owned(tenantId, gameId);
    const prevPossession = (game as any).possession as string | null | undefined;

    // Write the new possession to Game.possession (the typed column).
    await this.prisma.client.game.update({
      where: { id: gameId },
      data: { possession: team } as any,
    });
    this.invalidateBoardCache(gameId);

    // Append-only POSSESSION event — forensic trail, same pattern as TIMEOUT.
    await this.record(gameId, 'POSSESSION', {
      team,
      prevPossession: prevPossession ?? null,
    });

    // Immutable AuditLog row.
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: actorUserId || null,
          action: 'SPORTS_POSSESSION_SET',
          targetType: 'Game',
          targetId: gameId,
          details: JSON.stringify({
            team,
            prevPossession: prevPossession ?? null,
            sport: game.sport,
          }),
        },
      });
    } catch { /* best-effort */ }

    return { success: true, possession: team };
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

  /**
   * Sprint 13 — CTS celebration audit log.
   *
   * The CTS celebration orchestrator on the kiosk player POSTs to
   * /api/v1/sports/board/:id/cts-cue-fired each time it fires a cue,
   * so the GameEvent table captures a forensic record of every
   * celebration that played (cueId, team, source, live score at fire
   * time). Drives the sponsor proof-of-play report — "during this
   * game, the GOLAZO cue fired 4 times in front of the Pool Supply
   * sponsor banner".
   *
   * Best-effort: failure here NEVER blocks the kiosk (which already
   * rendered the cinematic). The endpoint that calls this catches and
   * discards thrown errors.
   */
  async recordCueFired(
    id: string,
    dto: {
      cueId: string;
      team: 'home' | 'away' | 'horn';
      source: 'auto' | 'preview' | 'manual';
      score?: string;
    },
  ): Promise<void> {
    // Confirm the game exists (cheap select) so we don't write orphan
    // GameEvent rows pointing at deleted / non-existent games.
    const game = await this.prisma.client.game.findUnique({
      where: { id },
      select: { id: true, homeScore: true, awayScore: true },
    });
    if (!game) return;
    await this.prisma.client.gameEvent.create({
      data: {
        gameId: id,
        type: 'CTS_CUE',
        payload: {
          cueId: dto.cueId,
          team: dto.team,
          source: dto.source,
          score: dto.score || `${game.homeScore}-${game.awayScore}`,
          t: new Date().toISOString(),
        },
      },
    });
  }

  // ── CTS snapshot ingest ──────────────────────────────────────
  //
  // CtsBridge POSTs the latest parsed snapshot at ~5 Hz when a CTS
  // console is streaming. We write it under `Game.stats.cts` as a
  // self-contained block — NO overwrite of the persistent `homeScore`,
  // `awayScore`, `clockMs`, `clockRunning`, `segment` columns.
  //
  // That separation is load-bearing. Those columns stay as the OPERATOR
  // INPUT layer — when CTS goes dark mid-game (cable yank, console
  // power-cycle, parity hiccup) the operator can take over manually and
  // not be silently stomped 200 ms later when CTS reconnects. The
  // public surfaces (board / ribbon / scorebug) apply the CTS overlay
  // at render time via `applyCtsOverlay` in apps/web/src/lib/cts-merge.ts:
  // fresh heartbeat → CTS wins, stale → operator inputs win. One central
  // helper, identical math everywhere.
  //
  // Forensic audit: every accepted snapshot writes an AuditLog row at
  // INFO frequency would flood the table (5 Hz × multi-hour games ≈
  // 100k rows / game), so we sample — log only on the FIRST snapshot
  // after a fresh-window gap, on every score change, on every segment
  // change, on horn, and on every clockRunning flip. That captures
  // the forensically interesting transitions without log-spam.

  /** Coerce + sanitize one inbound CTS snapshot for write into stats.cts.
   *
   * T2-1: extended to accept per-side shot clocks, exclusions, and
   * timeouts remaining.  All new fields are optional — an older bridge
   * that only sends the original 7 fields still works unchanged.
   */
  private cleanCtsSnapshot(raw: Record<string, unknown>): {
    clockMs?: number;
    clockRunning?: boolean;
    segment?: number;
    homeScore?: number;
    awayScore?: number;
    shotClock?: { ms: number; running: boolean; len?: number; at?: string };
    /** T2-1 — per-side shot clocks. */
    homeShotClock?: { ms: number; running: boolean; raw?: string; at?: string };
    awayShotClock?: { ms: number; running: boolean; raw?: string; at?: string };
    /** T2-1 — active exclusions per team (3-slot, nullable entries). */
    homeExclusions?: ({ playerJersey: number; secondsRemaining: number } | null)[];
    awayExclusions?: ({ playerJersey: number; secondsRemaining: number } | null)[];
    /** T2-1 — timeouts remaining per team. */
    homeTimeoutsRemaining?: number;
    awayTimeoutsRemaining?: number;
    horn?: boolean;
    raw?: string;
  } {
    const out: ReturnType<SportsService['cleanCtsSnapshot']> = {};
    const num = (v: unknown): number | undefined => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
      return v;
    };
    const nonNegInt = (v: unknown): number | undefined => {
      const n = num(v);
      if (n === undefined) return undefined;
      return Math.max(0, Math.round(n));
    };
    if (raw.clockMs !== undefined) {
      const v = nonNegInt(raw.clockMs);
      if (v !== undefined) out.clockMs = v;
    }
    if (raw.clockRunning !== undefined) {
      out.clockRunning = !!raw.clockRunning;
    }
    if (raw.segment !== undefined) {
      const v = nonNegInt(raw.segment);
      if (v !== undefined && v >= 1) out.segment = v;
    }
    if (raw.homeScore !== undefined) {
      const v = nonNegInt(raw.homeScore);
      if (v !== undefined) out.homeScore = v;
    }
    if (raw.awayScore !== undefined) {
      const v = nonNegInt(raw.awayScore);
      if (v !== undefined) out.awayScore = v;
    }
    if (raw.horn !== undefined) out.horn = !!raw.horn;
    if (typeof raw.raw === 'string') out.raw = raw.raw.slice(0, 96);
    if (raw.shotClock && typeof raw.shotClock === 'object') {
      const sc = raw.shotClock as Record<string, unknown>;
      const ms = nonNegInt(sc.ms);
      if (ms !== undefined) {
        const cleaned: { ms: number; running: boolean; len?: number; at?: string } = {
          ms,
          running: !!sc.running,
        };
        const len = nonNegInt(sc.len);
        if (len !== undefined && len > 0) cleaned.len = len;
        if (typeof sc.at === 'string') cleaned.at = sc.at;
        out.shotClock = cleaned;
      }
    }

    // T2-1: per-side shot clocks (bridge v1.1+; ignored by older bridges).
    const cleanShotClockField = (
      field: unknown,
    ): { ms: number; running: boolean; raw?: string; at?: string } | undefined => {
      if (!field || typeof field !== 'object') return undefined;
      const sc = field as Record<string, unknown>;
      const ms = nonNegInt(sc.ms);
      if (ms === undefined) return undefined;
      const result: { ms: number; running: boolean; raw?: string; at?: string } = {
        ms,
        running: !!sc.running,
      };
      if (typeof sc.raw === 'string') result.raw = sc.raw.slice(0, 8);
      if (typeof sc.at === 'string') result.at = sc.at;
      return result;
    };
    const homeSc = cleanShotClockField(raw.homeShotClock);
    if (homeSc !== undefined) out.homeShotClock = homeSc;
    const awaySc = cleanShotClockField(raw.awayShotClock);
    if (awaySc !== undefined) out.awayShotClock = awaySc;

    // T2-1: exclusions — 3-slot array, each slot is an object or null.
    const cleanExclusionArray = (
      field: unknown,
    ): ({ playerJersey: number; secondsRemaining: number } | null)[] | undefined => {
      if (!Array.isArray(field)) return undefined;
      const slots = field.slice(0, 3).map((slot) => {
        if (!slot || typeof slot !== 'object') return null;
        const s = slot as Record<string, unknown>;
        const jersey = nonNegInt(s.playerJersey);
        const secs = nonNegInt(s.secondsRemaining);
        if (jersey === undefined && secs === undefined) return null;
        return {
          playerJersey: jersey ?? 0,
          secondsRemaining: secs ?? 0,
        };
      });
      // Pad to 3 slots.
      while (slots.length < 3) slots.push(null);
      return slots as ({ playerJersey: number; secondsRemaining: number } | null)[];
    };
    const homeExcl = cleanExclusionArray(raw.homeExclusions);
    if (homeExcl !== undefined) out.homeExclusions = homeExcl;
    const awayExcl = cleanExclusionArray(raw.awayExclusions);
    if (awayExcl !== undefined) out.awayExclusions = awayExcl;

    // T2-1: timeouts remaining.
    if (raw.homeTimeoutsRemaining !== undefined) {
      const v = nonNegInt(raw.homeTimeoutsRemaining);
      if (v !== undefined) out.homeTimeoutsRemaining = v;
    }
    if (raw.awayTimeoutsRemaining !== undefined) {
      const v = nonNegInt(raw.awayTimeoutsRemaining);
      if (v !== undefined) out.awayTimeoutsRemaining = v;
    }

    return out;
  }

  /**
   * Ingest a CTS bridge snapshot. Writes under `Game.stats.cts`; does
   * NOT touch the persistent operator-input columns. Returns the
   * post-write game row so the bridge can confirm the write succeeded.
   *
   * `tenantId` is null when the caller authenticated via the public
   * feed token (no user context); audit rows in that case carry no
   * `userId`.
   */
  async ingestCtsSnapshot(
    gameId: string,
    snapshot: Record<string, unknown>,
    auth: { tenantId?: string | null; actorUserId?: string | null; source?: string },
  ): Promise<{ ok: true; accepted: boolean; reason?: string }> {
    // Tenant-scope the load when an authenticated user is calling. The
    // public feed-token path resolves the game without a tenant filter
    // (the token itself proves game ownership).
    const game = auth.tenantId
      ? await this.prisma.client.game.findFirst({
          where: { id: gameId, tenantId: auth.tenantId },
        })
      : await this.prisma.client.game.findUnique({ where: { id: gameId } });
    if (!game) {
      throw new NotFoundException('Game not found');
    }

    const cleaned = this.cleanCtsSnapshot(snapshot);
    // Sanity bail — if every field is missing the snapshot is junk and
    // we silently drop it (don't bump lastUpdateAt; otherwise a stream
    // of empty snapshots would mask a real CTS outage).
    const hasAnyData =
      cleaned.clockMs !== undefined ||
      cleaned.clockRunning !== undefined ||
      cleaned.segment !== undefined ||
      cleaned.homeScore !== undefined ||
      cleaned.awayScore !== undefined ||
      cleaned.shotClock !== undefined ||
      cleaned.horn !== undefined ||
      // T2-1: new fields count as "has data" so they alone can update the
      // stats block without requiring a clock or score to be present.
      cleaned.homeShotClock !== undefined ||
      cleaned.awayShotClock !== undefined ||
      cleaned.homeExclusions !== undefined ||
      cleaned.awayExclusions !== undefined ||
      cleaned.homeTimeoutsRemaining !== undefined ||
      cleaned.awayTimeoutsRemaining !== undefined;
    if (!hasAnyData) {
      return { ok: true, accepted: false, reason: 'empty snapshot' };
    }

    const prevStats: Record<string, unknown> =
      game.stats && typeof game.stats === 'object'
        ? { ...(game.stats as Record<string, unknown>) }
        : {};
    const prevCts: Record<string, unknown> =
      prevStats.cts && typeof prevStats.cts === 'object'
        ? (prevStats.cts as Record<string, unknown>)
        : {};

    const nowIso = new Date().toISOString();
    const nextCts: Record<string, unknown> = {
      ...prevCts,
      ...cleaned,
      lastUpdateAt: nowIso,
    };

    // What changed forensically? Score / segment / clockRunning / horn
    // are the audit-worthy transitions; clockMs ticks are not.
    const lastAuditAt =
      typeof prevCts.lastAuditAt === 'string' ? Date.parse(prevCts.lastAuditAt) : 0;
    const reconnect =
      !Number.isFinite(Date.parse(String(prevCts.lastUpdateAt))) ||
      Date.now() - Date.parse(String(prevCts.lastUpdateAt)) > 5000;
    const scoreChanged =
      (cleaned.homeScore !== undefined && cleaned.homeScore !== prevCts.homeScore) ||
      (cleaned.awayScore !== undefined && cleaned.awayScore !== prevCts.awayScore);
    const segmentChanged =
      cleaned.segment !== undefined && cleaned.segment !== prevCts.segment;
    const clockRunChanged =
      cleaned.clockRunning !== undefined && cleaned.clockRunning !== prevCts.clockRunning;
    const horn = cleaned.horn === true && !prevCts.horn;
    // Audit cap: at most one audit row per 1s of forensically uninteresting
    // updates (clock-only ticks). Score / segment / horn / reconnect always
    // audit immediately.
    const wantsAudit =
      reconnect || scoreChanged || segmentChanged || clockRunChanged || horn ||
      Date.now() - (Number.isFinite(lastAuditAt) ? lastAuditAt : 0) > 60_000;
    if (wantsAudit) {
      nextCts.lastAuditAt = nowIso;
    }

    // "All the same rules apply if we are doing it or the integration is
    // doing it." (Greg's rule) — fire the same side-effect chain the
    // operator-path helpers run, scoped to what actually changed.
    //
    // NOTE: ingestCtsSnapshot deliberately writes ONLY to stats.cts (the
    // overlay namespace), never to the authoritative operator columns
    // (clockMs, clockRunning, segment, homeScore, awayScore). That design
    // is intentional — it allows operators to take over when CTS fails and
    // prevents the CTS 5 Hz tick from clobbering a manual correction.
    // The side effects below (GameEvents, celebrations, sync helpers) fire
    // against the OPERATOR columns (game.*) so the helpers read the real
    // game state, not the in-flight CTS snapshot. This is correct: the
    // penalty box and shot clock are anchored to the operator clock columns,
    // and syncing them to the CTS-reported running state keeps them aligned.

    // Prev scores come from OPERATOR columns, not from stats.cts, so the
    // delta math is consistent with adjustScore/setScore.
    const prevScores = { homeScore: game.homeScore, awayScore: game.awayScore };
    const now = new Date();

    // Build the merged stats write so we do a single DB update.
    // Clock-running transition: slave the penalty box and shot clock —
    // same helper chain clockAction uses, same "clockMutated = true" flag.
    let mergedStatsForWrite: Record<string, unknown> = { ...prevStats, cts: nextCts };

    // T2-1: merge CTS exclusions into stats.penalties (top-level, source:'cts')
    // so the existing penalty-box render path can consume them alongside
    // operator-entered penalties.  We replace only the 'cts'-sourced slots;
    // operator-entered penalties (source != 'cts') are preserved.
    if (cleaned.homeExclusions !== undefined || cleaned.awayExclusions !== undefined) {
      const prevPenalties = Array.isArray(mergedStatsForWrite.penalties)
        ? (mergedStatsForWrite.penalties as unknown[]).filter(
            (p) => p && typeof p === 'object' && (p as Record<string, unknown>).source !== 'cts',
          )
        : [];
      const ctsPenalties: unknown[] = [];
      if (cleaned.homeExclusions) {
        cleaned.homeExclusions.forEach((slot, i) => {
          if (slot && (slot.playerJersey > 0 || slot.secondsRemaining > 0)) {
            ctsPenalties.push({
              source: 'cts',
              team: 'home',
              slot: i,
              playerJersey: slot.playerJersey,
              secondsRemaining: slot.secondsRemaining,
            });
          }
        });
      }
      if (cleaned.awayExclusions) {
        cleaned.awayExclusions.forEach((slot, i) => {
          if (slot && (slot.playerJersey > 0 || slot.secondsRemaining > 0)) {
            ctsPenalties.push({
              source: 'cts',
              team: 'away',
              slot: i,
              playerJersey: slot.playerJersey,
              secondsRemaining: slot.secondsRemaining,
            });
          }
        });
      }
      mergedStatsForWrite = {
        ...mergedStatsForWrite,
        penalties: [...prevPenalties, ...ctsPenalties],
        cts: nextCts,
      };
    }

    // T2-1: merge CTS timeouts into stats.homeTimeouts / awayTimeouts.
    // Only overwrites when CTS is the source so operator adjustments
    // are not stomped when these fields are absent from the snapshot.
    if (cleaned.homeTimeoutsRemaining !== undefined) {
      mergedStatsForWrite = {
        ...mergedStatsForWrite,
        homeTimeouts: cleaned.homeTimeoutsRemaining,
        cts: nextCts,
      };
    }
    if (cleaned.awayTimeoutsRemaining !== undefined) {
      mergedStatsForWrite = {
        ...mergedStatsForWrite,
        awayTimeouts: cleaned.awayTimeoutsRemaining,
        cts: nextCts,
      };
    }

    if (clockRunChanged && cleaned.clockRunning !== undefined) {
      const running = cleaned.clockRunning;
      let synced = this.syncPenaltiesToClock(mergedStatsForWrite, running, now);
      const base = synced ?? mergedStatsForWrite;
      // T2-10: pass the CTS-reported game clock for clamping (Invariant #6).
      const ctsGameClockMs = cleaned.clockMs !== undefined ? Number(cleaned.clockMs) : undefined;
      const shotSynced = this.syncShotClockToGameClock(base, true, running, now, ctsGameClockMs);
      if (shotSynced) synced = shotSynced;
      if (synced) mergedStatsForWrite = { ...mergedStatsForWrite, ...synced, cts: nextCts };
    }

    await this.prisma.client.game.update({
      where: { id: gameId },
      data: { stats: mergedStatsForWrite as any },
    });
    // Invalidate the board cache so the next /board/:id poll sees this
    // snapshot instantly. Without this the TTL would mask up to 1s of
    // CTS data — fine in steady state but jarring at boot.
    this.invalidateBoardCache(gameId);

    // Score GameEvent + AUTO celebration — same paper trail as adjustScore.
    // Only fires when the CTS-reported score differs from the prior CTS
    // value (scoreChanged guard above), so a 5 Hz re-send of the same score
    // doesn't produce duplicate SCORE events.
    if (scoreChanged) {
      // Build a synthetic "next" game row that reflects the CTS scores for
      // maybeAutoCelebrate — it only reads .homeScore, .awayScore, .sport
      // and .tenantId, so we don't need a full DB refetch.
      const syntheticNext = {
        ...game,
        homeScore: cleaned.homeScore !== undefined ? cleaned.homeScore : game.homeScore,
        awayScore: cleaned.awayScore !== undefined ? cleaned.awayScore : game.awayScore,
      };
      try {
        await this.record(gameId, 'SCORE', {
          team: 'cts',
          homeScore: syntheticNext.homeScore,
          awayScore: syntheticNext.awayScore,
          source: 'cts',
        });
      } catch { /* best-effort */ }
      try {
        await this.maybeAutoCelebrate(
          gameId,
          prevScores,
          syntheticNext,
          { homeScore: syntheticNext.homeScore, awayScore: syntheticNext.awayScore },
          { source: 'feed' },
        );
      } catch (e) {
        this.logger.debug(`cts auto-celebrate skipped for game ${gameId}: ${(e as Error).message}`);
      }
    }

    // Segment GameEvent — same paper trail as setSegment.
    if (segmentChanged && cleaned.segment !== undefined) {
      try {
        await this.record(gameId, 'SEGMENT', { segment: cleaned.segment, source: 'cts' });
      } catch { /* best-effort */ }
    }

    if (wantsAudit) {
      try {
        await this.prisma.client.auditLog.create({
          data: {
            tenantId: game.tenantId,
            userId: auth.actorUserId || null,
            action: 'CTS_SNAPSHOT_INGEST',
            targetType: 'Game',
            targetId: gameId,
            details: JSON.stringify({
              source: auth.source || 'cts',
              reconnect,
              scoreChanged,
              segmentChanged,
              clockRunChanged,
              horn,
              snapshot: cleaned,
            }),
          },
        });
      } catch {
        // Audit best-effort — never let a logging failure block the
        // snapshot write. The next snapshot will retry if anything
        // material happens.
      }
    }

    return { ok: true, accepted: true };
  }

  // ── Undo rail ─────────────────────────────────────────────────

  /**
   * Return the most-recent N game events in reverse-chronological
   * order — consumed by the operator's RecentEventsRail component.
   * Non-undoable types (CUE, PENALTY, INGEST, AUTO_CELEBRATE,
   * RIBBON, RIBBON_PRESETS, RIBBON_SPEED, RIBBON_SLIDES,
   * RIBBON_SCORE, STATUS) are included in the log but marked
   * `undoable: false` so the UI can dim the row.
   */
  async getEvents(tenantId: string, gameId: string, limit = 25) {
    await this.owned(tenantId, gameId);
    const raw = await this.prisma.client.gameEvent.findMany({
      where: { gameId },
      // Deterministic order for the undo rail. createdAt alone is NOT enough:
      // several events fired in the same millisecond (a SCORE + its auto CLOCK,
      // a rapid tap) tie on createdAt, and the DB is then free to return them
      // in arbitrary order — so events[0] ("most recent", what one-tap undo
      // acts on) could be the wrong one between requests. The id tiebreak makes
      // the sequence stable. (GameEvent.id is a random uuid, so this isn't
      // chronological within a tie — but same-ms events are effectively
      // simultaneous; what matters is that the order is DETERMINISTIC.)
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(50, Math.max(1, limit)),
    });
    const UNDOABLE_TYPES = new Set(['SCORE', 'CLOCK', 'SEGMENT', 'STAT']);
    const NON_UNDOABLE_TYPES = new Set([
      'CUE', 'PENALTY', 'INGEST', 'AUTO_CELEBRATE',
      'RIBBON', 'RIBBON_PRESETS', 'RIBBON_SPEED', 'RIBBON_SLIDES',
      'RIBBON_SCORE', 'STATUS',
    ]);
    return raw.map((ev) => {
      const payload = (ev.payload as Record<string, unknown>) ?? {};
      const isUndo = Boolean(payload.undoOf);
      const undoable =
        UNDOABLE_TYPES.has(ev.type) &&
        !payload.auto &&           // auto-advance system events are non-undoable
        !isUndo;                   // undos themselves are non-undoable
      let nonUndoableReason: string | undefined;
      if (!undoable) {
        if (payload.auto) nonUndoableReason = 'system';
        else if (isUndo) nonUndoableReason = 'undo';
        else if (NON_UNDOABLE_TYPES.has(ev.type)) nonUndoableReason = 'type';
      }
      return {
        id: ev.id,
        type: ev.type,
        payload,
        undoable,
        nonUndoableReason,
        createdAt: ev.createdAt,
      };
    });
  }

  /**
   * Synthesize the inverse of a GameEvent and apply it via the
   * same existing PATCH paths — so the undo is itself auditable
   * and applies all the same validation / board-cache invalidation.
   *
   * Returns 422 BUG_NOT_UNDOABLE for:
   *   - CUE events (cinematic already aired)
   *   - system auto-advance events
   *   - events that are themselves undos
   *   - unknown types
   */
  async undoEvent(tenantId: string, gameId: string, eventId: string) {
    await this.owned(tenantId, gameId);
    const ev = await this.prisma.client.gameEvent.findFirst({
      where: { id: eventId, gameId },
    });
    if (!ev) throw new NotFoundException('Event not found');

    const payload = (ev.payload as Record<string, unknown>) ?? {};

    // Guard: auto-advance, undo-of-undo, or non-undoable types.
    if (payload.auto) {
      throw new UnprocessableEntityException({
        code: 'BUG_NOT_UNDOABLE',
        reason: 'System auto-advance events cannot be undone',
      });
    }
    if (payload.undoOf) {
      throw new UnprocessableEntityException({
        code: 'BUG_NOT_UNDOABLE',
        reason: 'Undo events cannot themselves be undone',
      });
    }
    if (ev.type === 'CUE') {
      throw new UnprocessableEntityException({
        code: 'BUG_NOT_UNDOABLE',
        reason: 'Cue events cannot be undone (cinematic already aired)',
      });
    }

    switch (ev.type) {
      case 'SCORE': {
        const team = String(payload.team || 'home');
        const delta = Number(payload.delta);
        if (team === 'set' || !Number.isFinite(delta)) {
          // setScore events: restore via prev snapshots if captured.
          const prevHome = Number(payload.prevHomeScore);
          const prevAway = Number(payload.prevAwayScore);
          if (!Number.isFinite(prevHome) || !Number.isFinite(prevAway)) {
            throw new UnprocessableEntityException({
              code: 'BUG_NOT_UNDOABLE',
              reason: 'Score event lacks prev-state for undo (pre-dates undo rail)',
            });
          }
          await this.setScore(tenantId, gameId, { homeScore: prevHome, awayScore: prevAway });
        } else {
          await this.adjustScore(tenantId, gameId, { team, delta: -delta });
        }
        break;
      }
      case 'CLOCK': {
        const prevClockMs = Number(payload.prevClockMs);
        const prevClockRunning = Boolean(payload.prevClockRunning);
        if (!Number.isFinite(prevClockMs)) {
          throw new UnprocessableEntityException({
            code: 'BUG_NOT_UNDOABLE',
            reason: 'Clock event lacks prev-state for undo (pre-dates undo rail)',
          });
        }
        // Re-anchor clock to the prev snapshot.
        await this.clockAction(tenantId, gameId, { action: 'set', ms: prevClockMs });
        if (prevClockRunning) {
          await this.clockAction(tenantId, gameId, { action: 'start' });
        }
        break;
      }
      case 'SEGMENT': {
        const prevSegment = Number(payload.prevSegment);
        const prevClockMsVal = Number(payload.prevClockMs);
        if (!Number.isFinite(prevSegment) || !Number.isFinite(prevClockMsVal)) {
          throw new UnprocessableEntityException({
            code: 'BUG_NOT_UNDOABLE',
            reason: 'Segment event lacks prev-state for undo (pre-dates undo rail)',
          });
        }
        // Restore segment (which resets clock to segment-start), then
        // explicitly set the clock back to the captured prev value.
        await this.setSegment(tenantId, gameId, { segment: prevSegment });
        await this.clockAction(tenantId, gameId, { action: 'set', ms: prevClockMsVal });
        break;
      }
      case 'STAT': {
        const oldValues = payload.oldValues as Record<string, unknown> | undefined;
        if (!oldValues || typeof oldValues !== 'object') {
          throw new UnprocessableEntityException({
            code: 'BUG_NOT_UNDOABLE',
            reason: 'Stat event lacks oldValues for undo (pre-dates undo rail)',
          });
        }
        await this.updateStats(tenantId, gameId, {
          stats: oldValues as Record<string, unknown>,
        });
        break;
      }
      default:
        throw new UnprocessableEntityException({
          code: 'BUG_NOT_UNDOABLE',
          reason: `Event type "${ev.type}" is not undoable`,
        });
    }

    // Record the inverse as a new GameEvent with undoOf reference so the
    // undo itself appears in the rail (and is auditable).
    await this.record(gameId, `UNDO_${ev.type}`, {
      undoOf: eventId,
      originalType: ev.type,
    });

    return { ok: true, undoOf: eventId, originalType: ev.type };
  }
}
