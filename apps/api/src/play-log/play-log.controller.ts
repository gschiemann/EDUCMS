import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request as ExpressReq } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { verifyDeviceForScreen } from '../screens/device-auth';
import {
  PLAY_LOG_MAX_BODY_BYTES,
  PLAY_LOG_STOP_RETRY_MS,
  PlayLogAcceptFloor,
  playLogBatchSchema,
  playLogDisabled,
  toPlayLogRows,
} from './play-log.policy';

export interface PlayLogIngestResponse {
  accepted: number;
  rejected: number;
  /** Rows newly written; a retried batch reports 0 here and is still a success. */
  stored: number;
  /** Kill switch on: discard the queue and stand down for `retryAfterMs`. */
  stop?: true;
  retryAfterMs?: number;
}

/**
 * POST /api/v1/screens/:id/play-log — the device play log's ingest
 * (2026-11-09, player stability gap 7). Policy in `play-log.policy.ts`.
 *
 * Gates, cheapest first; nothing touches the database until all have passed:
 *   0. Kill switch (`PLAY_LOG_DISABLED=1`): 200 `{ stop: true }`, zero work —
 *      the player drops its queue and stands down for six hours.
 *   1. Content-Length > 64 KB → 413 (main.ts also mounts a 64 KB parser on
 *      this path, so an oversized body is refused before it is parsed).
 *   2. Strict zod parse: unknown keys refused, every id / number bounded. The
 *      body has NO screen or tenant field and cannot have one.
 *   3. Device auth through the shared verifier (`sub` = path id, revocation,
 *      REVOKED, epoch; unproven and unpaired credentials refused). The
 *      tenant is the credential's LIVE screen row's, never the body's.
 *   4. Per-screen accept floor: one batch per 20 s per screen → 429.
 *   5. `createMany({ skipDuplicates })` on the (screen, startedAt, item)
 *      primary key: a retried batch never double-counts.
 *
 * Telemetry, not content: `PlayLogEntry` is not in MANIFEST_FED_MODELS, so a
 * write here never busts the manifest hot cache (pinned by the spec).
 * Emergency path: untouched — this route is never on it, and the player
 * never uploads while an alert is on glass.
 */
@Controller('api/v1/screens')
export class PlayLogController {
  private readonly logger = new Logger('PlayLog');
  private readonly floor = new PlayLogAcceptFloor();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /** IP-keyed net only (a venue shares one NAT address); the per-screen
   *  floor inside bounds a device. */
  @Post(':id/play-log')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  async ingest(
    @Param('id') id: string,
    @Req() req: ExpressReq,
    @Body() rawBody: unknown,
  ): Promise<PlayLogIngestResponse> {
    if (playLogDisabled()) {
      return { accepted: 0, rejected: 0, stored: 0, stop: true, retryAfterMs: PLAY_LOG_STOP_RETRY_MS };
    }

    const declared = Number(req?.headers?.['content-length'] ?? NaN);
    if (Number.isFinite(declared) && declared > PLAY_LOG_MAX_BODY_BYTES) {
      throw new HttpException(
        { code: 'PLAY_LOG_BODY_TOO_LARGE', message: 'Play log body exceeds 64 KB' },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    const parsed = playLogBatchSchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      throw new HttpException(
        { code: 'PLAY_LOG_BODY_INVALID', message: 'Body failed validation' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const auth = await verifyDeviceForScreen(
      { prisma: this.prisma, redis: this.redisService },
      req,
      id,
      // Stated, not defaulted (SEC-001 inventory): a play needs a tenant to
      // belong to, so an unpaired screen is refused; unproven stays refused.
      { allowUnpaired: false },
    );
    if (!auth.ok || !auth.tenantId) {
      throw new HttpException(
        {
          code: 'SCREEN_DEVICE_AUTH_REQUIRED',
          message: `Device auth required (${auth.ok ? 'screen_unpaired' : auth.reason})`,
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    // The CREDENTIAL's screen id and the live row's tenant — never the path
    // param, never the body.
    const screenId = auth.sub;
    const tenantId = auth.tenantId;

    const nowMs = Date.now();
    if (!this.floor.accept(screenId, nowMs)) {
      throw new HttpException(
        { code: 'PLAY_LOG_TOO_FREQUENT', message: 'One play-log batch per 20 s per screen' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const { rows, rejected } = toPlayLogRows(parsed.data.entries, { screenId, tenantId }, nowMs);
    if (rows.length === 0) return { accepted: 0, rejected, stored: 0 };

    try {
      const res = await this.prisma.client.playLogEntry.createMany({
        data: rows,
        skipDuplicates: true,
      });
      return { accepted: rows.length, rejected, stored: res.count };
    } catch (e) {
      // 503 so the player KEEPS the batch and retries on its slow cadence.
      this.logger.warn(
        `play-log write failed screen=${screenId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      throw new HttpException(
        { code: 'PLAY_LOG_UNAVAILABLE', message: 'Play log temporarily unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
