import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request as ExpressReq } from 'express';
import { SCORE_SOURCES, consoleDecoderFor } from '@cms/api-types';
import { CONSOLE_PROFILES, type ConsoleProfileId } from '@cms/scoreboard-cts';
import type { Prisma } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { checkIngestLimit } from '../security/ingest-rate-limit';
import { verifyDeviceForScreen } from '../screens/device-auth';
import { SportsService } from './sports.service';
import { boundedForAudit } from './game-command';
import {
  SCOREBOARD_CONSOLE_PROFILE_IDS,
  type ConsoleLinkReport,
  type ConsolePreview,
  type ScoreboardConsoleBinding,
  cleanLinkReport,
  hasScoreboardData,
  nextPreview,
  readScoreboardConsoleBinding,
  readScreenConsoleProfile,
  sportDisplayName,
} from './scoreboard-console';

/** How long a preview / a link report stays readable after the last packet. */
const EPHEMERAL_TTL_SECONDS = 120;
/** At most one preview / link write per key per second (the box posts at up to 5 Hz). */
const EPHEMERAL_MIN_INTERVAL_MS = 1_000;
/** A binding read is cached this long per screen (the box posts at up to 5 Hz). */
const BINDING_CACHE_MS = 3_000;
/** Device ingest ceiling: 5 Hz snapshots + a heartbeat, with headroom. */
const INGEST_MAX_PER_WINDOW = 60;
const INGEST_WINDOW_MS = 10_000;

type Json = Record<string, unknown>;
/** The transaction client `$transaction(fn)` hands its callback. */
type Tx = Prisma.TransactionClient;

/**
 * Per-game preview and per-screen link health: short-lived, shared across
 * replicas through Redis. With no Redis connection this replica keeps its own
 * copy — the degraded single-replica behaviour every leased worker has.
 */
class ConsoleEphemeralStore {
  private readonly memory = new Map<
    string,
    { value: string; expiresAt: number }
  >();
  private readonly lastWrite = new Map<string, number>();

  constructor(private readonly redis: RedisService) {}

  private shared(): boolean {
    const r = this.redis as unknown as { isConnected?: () => boolean };
    return typeof r?.isConnected === 'function' && r.isConnected() === true;
  }

  /** Is a write to `key` due (at most one per EPHEMERAL_MIN_INTERVAL_MS)? */
  due(key: string, now: number): boolean {
    return now - (this.lastWrite.get(key) ?? 0) >= EPHEMERAL_MIN_INTERVAL_MS;
  }

  async put(
    key: string,
    value: unknown,
    now: number,
    force = false,
  ): Promise<void> {
    if (!force && !this.due(key, now)) return;
    this.lastWrite.set(key, now);
    const json = JSON.stringify(value);
    if (this.shared()) {
      await this.redis.setString(key, json, EPHEMERAL_TTL_SECONDS);
      return;
    }
    this.memory.set(key, {
      value: json,
      expiresAt: now + EPHEMERAL_TTL_SECONDS * 1000,
    });
    if (this.memory.size > 2_000) {
      for (const [k, v] of this.memory)
        if (v.expiresAt <= now) this.memory.delete(k);
    }
  }

  async get<T>(key: string, now: number): Promise<T | null> {
    let raw: string | null = null;
    if (this.shared()) {
      raw = await this.redis.getString(key);
    } else {
      const hit = this.memory.get(key);
      raw = hit && hit.expiresAt > now ? hit.value : null;
    }
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async del(key: string): Promise<void> {
    this.lastWrite.delete(key);
    this.memory.delete(key);
    if (this.shared()) await this.redis.delKey(key);
  }
}

const previewKey = (gameId: string) => `venueos:sb-console:preview:${gameId}`;
const linkKey = (screenId: string) => `venueos:sb-console:link:${screenId}`;

/** What the game console's setup card reads. */
export interface ScoreboardConsoleView {
  gameId: string;
  sport: string;
  sportName: string;
  final: boolean;
  /** Does any console model decode this sport? */
  supported: boolean;
  models: Array<{
    id: string;
    label: string;
    source: string;
    supported: boolean;
    supportedSportNames: string[];
  }>;
  screens: Array<{
    id: string;
    name: string;
    online: boolean;
    consoleProfile: string | null;
    /** This screen already reads a console for ANOTHER game. */
    otherGame: { id: string; label: string } | null;
  }>;
  binding: null | {
    screenId: string;
    screenName: string;
    screenOnline: boolean;
    consoleProfile: string | null;
    modelLabel: string | null;
    decoderSport: string | null;
    supportedSportNames: string[];
    boundAt: string;
    confirmedAt: string | null;
  };
  preview: ConsolePreview | null;
  link: ConsoleLinkReport | null;
  /** Server clock, so the card judges ages on the same clock the stamps use. */
  serverTime: number;
}

/**
 * K12-F32 — bind a scoreboard console to a game, preview what it sends,
 * confirm it, and take its snapshots from the box's DEVICE credential. See
 * scoreboard-console.ts for the design and the finding it closes.
 */
@Injectable()
export class ScoreboardConsoleService {
  private readonly logger = new Logger(ScoreboardConsoleService.name);
  private readonly ephemeral: ConsoleEphemeralStore;
  private readonly bindingCache = new Map<
    string,
    {
      at: number;
      tenantId: string;
      binding: ScoreboardConsoleBinding | null;
      profile: string | null;
      game: { id: string; sport: string } | null;
    }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sports: SportsService,
    private readonly signer: WebsocketSignerService,
  ) {
    this.ephemeral = new ConsoleEphemeralStore(redis);
  }

  private now(): number {
    return this.sports.serverTimeMs();
  }

  private async ownedGame(tenantId: string, gameId: string) {
    const game = await this.prisma.client.game.findFirst({
      where: { id: gameId, tenantId },
      select: {
        id: true,
        tenantId: true,
        sport: true,
        status: true,
        homeTeam: true,
        awayTeam: true,
      },
    });
    if (!game) throw new NotFoundException('Game not found');
    return game;
  }

  private async tenantScreens(tenantId: string) {
    return this.prisma.client.screen.findMany({
      where: { tenantId },
      select: { id: true, name: true, status: true, config: true },
      orderBy: { name: 'asc' },
    });
  }

  private audit(
    tx: Tx,
    tenantId: string,
    userId: string | null,
    action: string,
    gameId: string,
    details: Json,
  ) {
    return tx.auditLog.create({
      data: {
        tenantId,
        userId,
        action,
        targetType: 'Game',
        targetId: gameId,
        details: JSON.stringify(
          boundedForAudit({ ...details, actor: { type: 'user', ref: userId } }),
        ),
      },
    });
  }

  /** Nudge only the boxes whose configuration changed. */
  private async nudge(screenIds: string[]): Promise<void> {
    for (const id of new Set(screenIds)) {
      try {
        await this.redis.publish(
          `device:${id}`,
          this.signer.signMessage('SYNC', { source: 'scoreboard_console' }),
        );
      } catch {
        // Best effort — the manifest poll converges within its window.
      }
    }
  }

  private writeBinding(
    config: unknown,
    binding: ScoreboardConsoleBinding | null,
    consoleProfile?: string,
  ): Json {
    const next: Json =
      config && typeof config === 'object' && !Array.isArray(config)
        ? { ...(config as Json) }
        : {};
    if (binding) next.scoreboardConsole = { ...binding };
    else delete next.scoreboardConsole;
    if (consoleProfile) next.consoleProfile = consoleProfile;
    return next;
  }

  // ─── The operator's setup card ──────────────────────────────────────────

  async view(tenantId: string, gameId: string): Promise<ScoreboardConsoleView> {
    const game = await this.ownedGame(tenantId, gameId);
    const now = this.now();
    const screens = await this.tenantScreens(tenantId);
    const bindings = screens.map((s) => ({
      s,
      b: readScoreboardConsoleBinding(s.config),
    }));
    const otherIds = [
      ...new Set(
        bindings
          .filter((x) => x.b && x.b.gameId !== gameId)
          .map((x) => x.b!.gameId),
      ),
    ];
    const others = otherIds.length
      ? await this.prisma.client.game.findMany({
          where: { id: { in: otherIds }, tenantId },
          select: { id: true, homeTeam: true, awayTeam: true },
        })
      : [];
    const labelOf = new Map(
      others.map((g) => [g.id, `${g.homeTeam} vs ${g.awayTeam}`]),
    );

    const models = SCORE_SOURCES.filter(
      (s) => s.kind === 'experimental-hardware',
    ).flatMap((src) =>
      (src.consoleProfiles ?? []).map((id) => {
        const supportedSports = Object.keys(src.decoderSports ?? {});
        return {
          id,
          label: CONSOLE_PROFILES[id as ConsoleProfileId]?.label ?? id,
          source: src.name,
          supported: consoleDecoderFor(id, game.sport).ok,
          supportedSportNames: supportedSports.map(sportDisplayName),
        };
      }),
    );

    const mine = bindings.find((x) => x.b?.gameId === gameId) ?? null;
    let binding: ScoreboardConsoleView['binding'] = null;
    let link: ConsoleLinkReport | null = null;
    if (mine && mine.b) {
      const profile = readScreenConsoleProfile(mine.s.config);
      const verdict = consoleDecoderFor(profile, game.sport);
      const model = models.find((m) => m.id === profile) ?? null;
      binding = {
        screenId: mine.s.id,
        screenName: mine.s.name,
        screenOnline: mine.s.status === 'ONLINE',
        consoleProfile: profile,
        modelLabel: model?.label ?? null,
        decoderSport: verdict.ok ? verdict.decoderSport : null,
        supportedSportNames: model?.supportedSportNames ?? [],
        boundAt: mine.b.boundAt,
        confirmedAt: mine.b.confirmedAt,
      };
      link = await this.ephemeral.get<ConsoleLinkReport>(
        linkKey(mine.s.id),
        now,
      );
    }
    const preview = binding
      ? await this.ephemeral.get<ConsolePreview>(previewKey(gameId), now)
      : null;

    return {
      gameId,
      sport: game.sport,
      sportName: sportDisplayName(game.sport),
      final: game.status === 'FINAL',
      supported: models.some((m) => m.supported),
      models,
      screens: bindings.map(({ s, b }) => ({
        id: s.id,
        name: s.name,
        online: s.status === 'ONLINE',
        consoleProfile: readScreenConsoleProfile(s.config),
        otherGame:
          b && b.gameId !== gameId
            ? { id: b.gameId, label: labelOf.get(b.gameId) ?? '' }
            : null,
      })),
      binding,
      // A preview from a box that is no longer the bound one is not shown.
      preview:
        preview && binding && preview.screenId === binding.screenId
          ? preview
          : null,
      link,
      serverTime: now,
    };
  }

  /**
   * Bind `screenId` (the box wired to the console) to this game, with the
   * console model the operator picked. Refuses a model that cannot read the
   * game's sport — there is no default sport any more. One box per game: a
   * box previously bound here is released in the same transaction.
   */
  async bind(
    tenantId: string,
    gameId: string,
    body: { screenId?: unknown; consoleProfile?: unknown },
    userId: string | null,
  ): Promise<ScoreboardConsoleView> {
    const game = await this.ownedGame(tenantId, gameId);
    if (game.status === 'FINAL') {
      throw new ConflictException({
        code: 'SCOREBOARD_CONSOLE_GAME_FINAL',
        message: 'This game is final. Reopen it before connecting a console.',
      });
    }
    const consoleProfile =
      typeof body?.consoleProfile === 'string' ? body.consoleProfile : '';
    if (!SCOREBOARD_CONSOLE_PROFILE_IDS.includes(consoleProfile)) {
      throw new BadRequestException({
        code: 'CONSOLE_UNKNOWN',
        message: 'Unknown console model.',
      });
    }
    const verdict = consoleDecoderFor(consoleProfile, game.sport);
    if (!verdict.ok) {
      throw new ConflictException({
        code: 'CONSOLE_SPORT_UNSUPPORTED',
        message: `This console cannot read ${sportDisplayName(game.sport)}.`,
        supportedSports: verdict.supportedSports,
      });
    }
    const screenId = typeof body?.screenId === 'string' ? body.screenId : '';
    const screens = await this.tenantScreens(tenantId);
    const target = screens.find((s) => s.id === screenId);
    if (!target) throw new NotFoundException('Screen not found');

    const previousOnTarget = readScoreboardConsoleBinding(target.config);
    const released = screens.filter(
      (s) =>
        s.id !== target.id &&
        readScoreboardConsoleBinding(s.config)?.gameId === gameId,
    );
    const binding: ScoreboardConsoleBinding = {
      gameId,
      sport: game.sport,
      boundAt: new Date(this.now()).toISOString(),
      boundBy: userId,
      confirmedAt: null,
      confirmedBy: null,
    };

    await this.prisma.client.$transaction(async (tx: Tx) => {
      for (const s of released) {
        await tx.screen.update({
          where: { id: s.id, tenantId },
          data: {
            config: this.writeBinding(s.config, null) as Prisma.InputJsonValue,
          },
        });
      }
      await tx.screen.update({
        where: { id: target.id, tenantId },
        data: {
          config: this.writeBinding(
            target.config,
            binding,
            consoleProfile,
          ) as Prisma.InputJsonValue,
        },
      });
      await this.audit(
        tx,
        tenantId,
        userId,
        'SPORTS_SCOREBOARD_CONSOLE_BOUND',
        gameId,
        {
          screenId: target.id,
          screenName: target.name,
          consoleProfile,
          decoder: verdict.decoder,
          decoderSport: verdict.decoderSport,
          sport: game.sport,
          releasedScreens: released.map((s) => s.id),
          previousGameId:
            previousOnTarget && previousOnTarget.gameId !== gameId
              ? previousOnTarget.gameId
              : null,
        },
      );
    });
    this.bindingCache.clear();
    await this.ephemeral.del(previewKey(gameId));
    if (previousOnTarget && previousOnTarget.gameId !== gameId) {
      await this.ephemeral.del(previewKey(previousOnTarget.gameId));
    }
    await this.nudge([target.id, ...released.map((s) => s.id)]);
    return this.view(tenantId, gameId);
  }

  /**
   * The operator compared the preview with the physical scoreboard: from now
   * on the box's snapshots drive the game. Refused until a preview exists —
   * there is nothing to confirm before the console has said anything.
   */
  async confirm(
    tenantId: string,
    gameId: string,
    userId: string | null,
  ): Promise<ScoreboardConsoleView> {
    const game = await this.ownedGame(tenantId, gameId);
    const screens = await this.tenantScreens(tenantId);
    const target = screens.find(
      (s) => readScoreboardConsoleBinding(s.config)?.gameId === gameId,
    );
    const binding = target ? readScoreboardConsoleBinding(target.config) : null;
    if (!target || !binding) {
      throw new ConflictException({
        code: 'SCOREBOARD_CONSOLE_NOT_BOUND',
        message: 'No screen reads a console for this game.',
      });
    }
    const profile = readScreenConsoleProfile(target.config);
    const verdict = consoleDecoderFor(profile, game.sport);
    if (!verdict.ok) {
      throw new ConflictException({
        code: 'CONSOLE_SPORT_UNSUPPORTED',
        message: `The console model on ${target.name} cannot read ${sportDisplayName(game.sport)}.`,
        supportedSports: verdict.supportedSports,
      });
    }
    const now = this.now();
    const preview = await this.ephemeral.get<ConsolePreview>(
      previewKey(gameId),
      now,
    );
    if (
      !preview ||
      preview.screenId !== target.id ||
      preview.decoderSport !== verdict.decoderSport
    ) {
      throw new ConflictException({
        code: 'SCOREBOARD_CONSOLE_NO_PREVIEW',
        message: 'Nothing has arrived from the console yet.',
      });
    }
    const confirmed: ScoreboardConsoleBinding = {
      ...binding,
      confirmedAt: new Date(now).toISOString(),
      confirmedBy: userId,
    };
    await this.prisma.client.$transaction(async (tx: Tx) => {
      await tx.screen.update({
        where: { id: target.id, tenantId },
        data: {
          config: this.writeBinding(
            target.config,
            confirmed,
          ) as Prisma.InputJsonValue,
        },
      });
      // The values the operator saw when they confirmed — the forensic answer
      // to "who said the console was reading this game correctly, and when".
      await this.audit(
        tx,
        tenantId,
        userId,
        'SPORTS_SCOREBOARD_CONSOLE_CONFIRMED',
        gameId,
        {
          screenId: target.id,
          consoleProfile: profile,
          decoderSport: verdict.decoderSport,
          preview,
        },
      );
    });
    this.bindingCache.clear();
    await this.nudge([target.id]);
    return this.view(tenantId, gameId);
  }

  /** Stop reading the console for this game. */
  async unbind(
    tenantId: string,
    gameId: string,
    userId: string | null,
  ): Promise<ScoreboardConsoleView> {
    await this.ownedGame(tenantId, gameId);
    const screens = await this.tenantScreens(tenantId);
    const bound = screens.filter(
      (s) => readScoreboardConsoleBinding(s.config)?.gameId === gameId,
    );
    if (bound.length > 0) {
      await this.prisma.client.$transaction(async (tx: Tx) => {
        for (const s of bound) {
          await tx.screen.update({
            where: { id: s.id, tenantId },
            data: {
              config: this.writeBinding(
                s.config,
                null,
              ) as Prisma.InputJsonValue,
            },
          });
        }
        await this.audit(
          tx,
          tenantId,
          userId,
          'SPORTS_SCOREBOARD_CONSOLE_UNBOUND',
          gameId,
          {
            screens: bound.map((s) => s.id),
          },
        );
      });
      this.bindingCache.clear();
      await this.nudge(bound.map((s) => s.id));
    }
    await this.ephemeral.del(previewKey(gameId));
    return this.view(tenantId, gameId);
  }

  // ─── The box ─────────────────────────────────────────────────────────────

  private async bindingFor(screenId: string, tenantId: string, now: number) {
    const hit = this.bindingCache.get(screenId);
    if (hit && hit.tenantId === tenantId && now - hit.at < BINDING_CACHE_MS)
      return hit;
    // ten-ok: `tenantId` is the LIVE tenant verifyDeviceForScreen just proved
    // for this device credential — the read is scoped to it.
    const screen = await this.prisma.client.screen.findFirst({
      where: { id: screenId, tenantId },
      select: { config: true },
    });
    const binding = screen ? readScoreboardConsoleBinding(screen.config) : null;
    // The bound game, in the SAME tenant — a screen re-paired elsewhere, or a
    // deleted game, reads as gone.
    const game = binding
      ? await this.prisma.client.game.findFirst({
          where: { id: binding.gameId, tenantId },
          select: { id: true, sport: true },
        })
      : null;
    const entry = {
      at: now,
      tenantId,
      binding,
      profile: screen ? readScreenConsoleProfile(screen.config) : null,
      game,
    };
    this.bindingCache.set(screenId, entry);
    if (this.bindingCache.size > 500) {
      for (const [k, v] of this.bindingCache)
        if (now - v.at > BINDING_CACHE_MS) this.bindingCache.delete(k);
    }
    return entry;
  }

  /**
   * `POST /api/v1/sports/scoreboard-console/:screenId/snapshot` — the bound
   * box's snapshots and link heartbeats, authenticated by its DEVICE
   * credential (never a token in a URL). Every packet is checked against the
   * live binding and the game's sport: an unconfirmed binding is a PREVIEW
   * (held, never written to the game); a snapshot decoded with any table but
   * the one for the game's sport is refused.
   */
  async ingest(
    screenId: string,
    body: Json,
    req: ExpressReq,
  ): Promise<{
    ok: true;
    accepted: boolean;
    preview?: boolean;
    reason?: string;
  }> {
    const { limited } = await checkIngestLimit(
      this.redis.publisher,
      `sb-console:${screenId}`,
      INGEST_MAX_PER_WINDOW,
      INGEST_WINDOW_MS,
    );
    if (limited) {
      throw new HttpException(
        {
          code: 'SCOREBOARD_CONSOLE_RATE_LIMITED',
          message: 'Console snapshot rate limit exceeded',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const auth = await verifyDeviceForScreen(
      { prisma: this.prisma, redis: this.redis },
      req,
      screenId,
      {
        allowUnpaired: false,
      },
    );
    if (!auth.ok || !auth.tenantId) {
      throw new UnauthorizedException({
        code: 'SCREEN_DEVICE_AUTH_REQUIRED',
        message: `Device auth required (${auth.ok ? 'screen_unpaired' : auth.reason})`,
      });
    }
    const tenantId = auth.tenantId;
    const now = this.now();
    const b =
      body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const { binding, profile, game } = await this.bindingFor(
      screenId,
      tenantId,
      now,
    );
    if (!binding) {
      throw new ConflictException({
        code: 'CONSOLE_NOT_BOUND',
        message: 'This screen does not read a console for any game.',
      });
    }
    if (!game) {
      throw new ConflictException({
        code: 'CONSOLE_GAME_GONE',
        message: 'The game this console was set up for is gone.',
      });
    }
    const verdict = consoleDecoderFor(profile, game.sport);
    if (!verdict.ok) {
      throw new ConflictException({
        code: 'CONSOLE_SPORT_UNSUPPORTED',
        message: `This console cannot read ${sportDisplayName(game.sport)}.`,
        supportedSports: verdict.supportedSports,
      });
    }
    if (
      b.decoder !== verdict.decoder ||
      b.decoderSport !== verdict.decoderSport
    ) {
      throw new ConflictException({
        code: 'CONSOLE_DECODER_MISMATCH',
        message:
          'The box decoded this console with a different table than the game needs.',
        expected: {
          decoder: verdict.decoder,
          decoderSport: verdict.decoderSport,
        },
      });
    }

    await this.ephemeral.put(
      linkKey(screenId),
      cleanLinkReport(b.link, new Date(now).toISOString()),
      now,
    );
    if (!hasScoreboardData(b))
      return { ok: true, accepted: false, reason: 'heartbeat' };

    if (!binding.confirmedAt) {
      // Held for the operator to compare — never written to the game.
      const key = previewKey(game.id);
      if (this.ephemeral.due(key, now)) {
        const prev = await this.ephemeral.get<ConsolePreview>(key, now);
        const preview = nextPreview(prev, b, {
          receivedAt: new Date(now).toISOString(),
          screenId,
          decoderSport: verdict.decoderSport,
        });
        await this.ephemeral.put(key, preview, now, true);
      }
      return {
        ok: true,
        accepted: false,
        preview: true,
        reason: 'awaiting confirmation',
      };
    }

    return this.sports.ingestCtsSnapshot(game.id, b, {
      tenantId,
      source: 'console-device',
    });
  }
}
