import { Controller, Get, Query, Req, Res, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { SseService } from './sse.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from './redis.service';
import { requireSecret } from '../security/required-secret';

/**
 * SSE realtime endpoint — Sprint 11 Phase B.
 *
 * GET /api/v1/realtime/sse?token=<deviceJwt>
 *
 * Auth: same device JWT the kiosk uses for the WebSocket /realtime
 * handshake. We resolve it to (tenantId, screenId) and subscribe the
 * SSE stream to those scopes.
 *
 * Why a query-string token (and not Authorization header): the browser
 * `EventSource` API does NOT accept custom headers — by design, to
 * keep the SSE wire format trivially proxy-cacheable. Token-in-query
 * is the standard pattern for SSE auth (used by Vercel + Cloudflare
 * + Stripe's own SSE endpoints). The kiosk's token is single-use-
 * scoped to a screen anyway; query exposure is no broader than the
 * WS protocol's own `?token=` pattern.
 *
 * Output: text/event-stream with `event:` lines for each broadcast
 * message. Client maps these to `addEventListener('SYNC', ...)` etc.
 */
@Controller('api/v1/realtime')
export class SseController {
  private readonly logger = new Logger(SseController.name);

  constructor(
    private readonly sse: SseService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('sse')
  async sseStream(
    @Query('token') token: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Validate the device JWT before opening the stream so we don't
    // accept anonymous subscribers. Same secret as the WS auth path.
    let tenantId: string | null = null;
    let deviceId: string | null = null;
    if (!token) {
      res.status(401).json({ error: 'token required' });
      return;
    }
    try {
      const secret = requireSecret('DEVICE_JWT_SECRET');
      const payload = jwt.verify(token, secret) as any;
      // Device JWT shape: { kind: 'device', sub: screenId, ... }
      if (payload?.kind !== 'device' || !payload?.sub) {
        throw new Error('not a device token');
      }
      // Lane-1 P1 (final audit): check the JWT revocation set so a revoked
      // device token can't keep streaming. Fail-closed on Redis error —
      // same posture as jwt-auth.guard.ts.
      if (process.env.NODE_ENV === 'production') {
        try {
          if (await this.redis.sismember('jwt_revoked_list', token)) {
            throw new Error('token revoked');
          }
        } catch (e) {
          if ((e as Error)?.message === 'token revoked') throw e;
          throw new Error('revocation check unavailable');
        }
      }
      deviceId = payload.sub;
      // Look up the tenant from the screen — kiosk JWT alone doesn't
      // include it. (Tenants can rotate; the screen → tenant mapping
      // is the source of truth.)
      const screen = await this.prisma.client.screen.findUnique({
        where: { id: deviceId! },
        select: { tenantId: true },
      });
      if (!screen?.tenantId) {
        res.status(404).json({ error: 'screen not found / unpaired' });
        return;
      }
      tenantId = screen.tenantId;
    } catch (e) {
      this.logger.warn(`[SSE] auth failed: ${(e as Error)?.message}`);
      res.status(401).json({ error: 'invalid token' });
      return;
    }

    // SSE response headers. `text/event-stream` is the trigger; the
    // remaining fields keep proxies + browsers from buffering or
    // closing the long-lived connection.
    //
    //   Cache-Control: prevents any intermediary from caching the
    //     stream (would be catastrophic — clients would receive a
    //     prior tenant's events).
    //   Connection: keep-alive — explicit, required by some HTTP/1.1
    //     proxies that downgrade from HTTP/2.
    //   X-Accel-Buffering: off — disables nginx proxy_buffering when
    //     the server sits behind nginx (which it doesn't on Railway,
    //     but cheap insurance for self-hosters).
    //   Access-Control-Allow-Origin: same wildcard as the Express
    //     CORS layer uses; SSE inherits CORS like any cross-origin
    //     fetch, so for kiosks loading from a different origin this
    //     has to be permissive.
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.flushHeaders();

    // Hand off to the SSE service. It tracks the client, fires keepalives,
    // and writes broadcast events when Redis fan-out arrives.
    this.sse.register({ tenantId, deviceId, res });

    // Don't return — let the stream stay open until the client
    // disconnects. The `close` event in SseService.register handles
    // cleanup.
  }
}
