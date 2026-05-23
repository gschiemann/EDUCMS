import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import { RedisService } from './redis.service';
import { PrismaService } from '../prisma/prisma.service';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import * as Sentry from '@sentry/nestjs';
import { requireSecret } from '../security/required-secret';

interface ClientContext {
  connectionId: string;
  deviceId?: string;
  tenantId?: string;
  groupId?: string;
  isAuthenticated: boolean;
  socket: WebSocket;
  authTimeout?: NodeJS.Timeout;
}

@WebSocketGateway({ path: '/realtime' })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  private clients: Map<WebSocket, ClientContext> = new Map();

  constructor(
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {
    this.redisService.setGateway(this);
  }

  handleConnection(client: WebSocket) {
    const connectionId = crypto.randomUUID();
    this.logger.log(`[WS] New connection: ${connectionId}`);

    const authTimeout = setTimeout(() => {
      const ctx = this.clients.get(client);
      if (ctx && !ctx.isAuthenticated) {
        this.logger.warn(`[WS] Auth timeout for ${connectionId} — closing`);
        client.close(4001, 'Auth Timeout');
      }
    }, 10000); // 10 seconds — generous for slow mobile connections

    this.clients.set(client, {
      connectionId,
      isAuthenticated: false,
      socket: client,
      authTimeout,
    });

    // ─── RAW MESSAGE HANDLER ───
    // NestJS @SubscribeMessage decorators are unreliable with the native ws adapter.
    // Handle messages directly on the socket for guaranteed routing.
    client.on('message', (raw: Buffer | string) => {
      try {
        const text = typeof raw === 'string' ? raw : raw.toString();
        const msg = JSON.parse(text);
        const event = msg.event || msg.type;
        const data = msg.data || msg.payload || {};

        switch (event) {
          case 'HELLO':
            this.processHello(client, data);
            break;
          case 'HEARTBEAT':
            this.processHeartbeat(client, data);
            break;
          case 'ACK':
            this.processAck(client, data);
            break;
          default:
            this.logger.debug(`[WS] Unknown event: ${event}`);
        }
      } catch (e) {
        this.logger.error(`[WS] Failed to parse message: ${e}`);
      }
    });
  }

  handleDisconnect(client: WebSocket) {
    const ctx = this.clients.get(client);
    if (ctx) {
      if (ctx.authTimeout) clearTimeout(ctx.authTimeout);
      this.logger.log(`[WS] Disconnected: ${ctx.connectionId} (device=${ctx.deviceId}, tenant=${ctx.tenantId})`);
    }
    this.clients.delete(client);
  }

  // ─── HELLO: Authenticate the device ───
  private async processHello(client: WebSocket, payload: any) {
    const ctx = this.clients.get(client);
    if (!ctx) return;

    try {
      const token = payload.token;
      if (!token) throw new Error('Missing token');

      let decoded: any;
      // SECURITY (sec-fix wave1 #1): unauthenticated `dev_` token branch
      // used to accept ANY client claiming to be a device without JWT
      // verification. In production this is NEVER allowed. In dev it's
      // off by default and must be opted into via DEV_WS_ALLOW=true —
      // and even then we log a loud warning every time it's used.
      const isProd = process.env.NODE_ENV === 'production';
      const devWsAllow = process.env.DEV_WS_ALLOW === 'true';
      if (token.startsWith('dev_') && !isProd && devWsAllow) {
        this.logger.warn(
          `[WS][SECURITY] DEV_WS_ALLOW is enabled — accepting unsigned dev_ token for ${ctx.connectionId}. This path MUST be disabled in production.`,
        );
        const parts = token.split('_');
        decoded = { deviceId: parts[1], tenantId: parts.slice(2).join('_') };
      } else {
        const jwtSecret = requireSecret('DEVICE_JWT_SECRET', {
          devFallback: 'dev_only_device_jwt_secret_CHANGE_ME',
        });
        decoded = jwt.verify(token, jwtSecret) as any;
        // SECURITY (Lane-1 final-audit P1): JWT revocation check. Same
        // fail-closed posture as jwt-auth.guard.ts:57-71 — production rejects
        // tokens in jwt_revoked_list; transient Redis blip → reject too
        // (a revoked token outrunning Redis recovery is the bigger risk).
        if (process.env.NODE_ENV === 'production') {
          try {
            if (await this.redisService.sismember('jwt_revoked_list', token)) {
              throw new Error('Token revoked');
            }
          } catch (e) {
            if ((e as Error)?.message === 'Token revoked') throw e;
            throw new Error('Revocation check unavailable');
          }
        }
        // SECURITY (Lane-1 re-audit P1): verify the screen still exists +
        // its tenant binding hasn't been swapped since the JWT was minted.
        // Closes the "unpair a screen → its WS keeps streaming for 365d"
        // window. SSE already does this at sse.controller.ts:62-69; WS now
        // mirrors. One DB hit on connect; negligible (auth is one-time).
        const screenId = decoded?.deviceId || decoded?.sub;
        if (!screenId) throw new Error('Device JWT missing deviceId/sub');
        const screen = await this.prisma.client.screen.findUnique({
          where: { id: screenId },
          select: { id: true, tenantId: true },
        });
        if (!screen) {
          throw new Error('Screen not found / unpaired');
        }
        if (decoded?.tenantId && decoded.tenantId !== screen.tenantId) {
          // Tenant rebound since JWT mint — force re-auth.
          throw new Error('Screen tenant changed');
        }
        // Trust the DB tenant binding over the JWT claim.
        decoded.tenantId = screen.tenantId;
      }

      ctx.deviceId = decoded.deviceId;
      ctx.tenantId = decoded.tenantId;
      ctx.groupId = decoded.groupId;
      ctx.isAuthenticated = true;

      if (ctx.authTimeout) {
        clearTimeout(ctx.authTimeout);
        ctx.authTimeout = undefined;
      }

      this.logger.log(`[WS] Authenticated: ${ctx.connectionId} → device=${ctx.deviceId}, tenant=${ctx.tenantId}`);

      this.send(client, 'AUTH_OK', {
        deviceId: ctx.deviceId,
        expiresAt: decoded.exp,
        // Ship server-time so the player can compute a local-clock
        // offset. Android signage devices frequently boot with no
        // NTP sync and drift minutes from wall-clock; without this
        // the player's Math.abs(Date.now() - msg.timestamp) > 30s
        // staleness gate would drop every emergency event on a
        // wrong-clock kiosk. Player applies the offset before
        // comparing.
        serverTime: Date.now(),
      });

      // Register in redis for metrics
      if (ctx.deviceId && this.redisService.publisher) {
        try {
          await this.redisService.publisher.sadd(`tenant:${ctx.tenantId}:devices`, ctx.deviceId);
          if (ctx.groupId) {
            await this.redisService.publisher.sadd(`group:${ctx.groupId}:devices`, ctx.deviceId);
          }
        } catch { /* redis optional */ }
      }
    } catch (e) {
      this.logger.warn(`[WS] Auth failed for ${ctx.connectionId}: ${e}`);
      this.send(client, 'AUTH_FAIL', { code: 401, reason: 'INVALID_TOKEN' });
      client.close(4001, 'Unauthorized');
    }
  }

  // ─── HEARTBEAT ───
  private processHeartbeat(client: WebSocket, payload: any) {
    const ctx = this.clients.get(client);
    if (!ctx || !ctx.isAuthenticated) return;

    if (ctx.deviceId && this.redisService.publisher) {
      this.redisService.publisher.hset(`device:${ctx.deviceId}:status`,
        'lastSeen', Date.now(),
        'metrics', JSON.stringify(payload.metrics || {})
      ).catch((err: Error) => {
        Sentry.withScope((s) => {
          s.setTag('realtime.publish', `device:${ctx.deviceId}:status`);
          Sentry.captureException(err);
        });
        this.logger.warn(`realtime publish failed: ${err?.message ?? err}`);
      });
    }
  }

  // ─── ACK ───
  private processAck(client: WebSocket, payload: any) {
    const ctx = this.clients.get(client);
    if (!ctx || !ctx.isAuthenticated) return;

    this.redisService.publish('metrics:ack', {
      deviceId: ctx.deviceId,
      tenantId: ctx.tenantId,
      eventId: payload.receivedEventId,
      status: payload.status,
      timestamp: Date.now()
    }).catch((err: Error) => {
      Sentry.withScope((s) => {
        s.setTag('realtime.publish', 'metrics:ack');
        Sentry.captureException(err);
      });
      this.logger.warn(`realtime publish failed: ${err?.message ?? err}`);
    });
  }

  // ─── Broadcast to all clients matching a scope ───
  public broadcastToScope(type: string, id: string, message: any) {
    let sent = 0;
    let total = 0;
    for (const [, ctx] of this.clients.entries()) {
      total++;
      if (!ctx.isAuthenticated) continue;

      let match = false;
      if (type === 'tenant' && ctx.tenantId === id) match = true;
      if (type === 'group' && ctx.groupId === id) match = true;
      if (type === 'device' && ctx.deviceId === id) match = true;

      if (match) {
        // Preserve signature + eventId from the signed envelope so players
        // can verify message authenticity. Previously these were silently
        // dropped — P0 life-safety bug, see audit fix #6.
        this.send(
          ctx.socket,
          message.type,
          message.payload,
          crypto.randomUUID(),
          message.signature,
          message.eventId,
        );
        sent++;
      }
    }
    this.logger.log(`[WS] broadcastToScope(${type}:${id}, ${message.type}) → sent to ${sent}/${total} clients`);
  }

  // ─── Send a typed message to a single client ───
  // signature and eventId are optional — present for signed emergency
  // envelopes, absent for internal control messages (AUTH_OK, etc.).
  private send(
    client: WebSocket,
    type: string,
    payload: any,
    idempotencyKey?: string,
    signature?: string,
    eventId?: string,
  ) {
    if (client.readyState === WebSocket.OPEN) {
      const frame: Record<string, unknown> = {
        type,
        payload,
        idempotencyKey: idempotencyKey || crypto.randomUUID(),
        timestamp: Math.floor(Date.now() / 1000),
      };
      // Include signing fields only when present so unsigned control
      // messages (AUTH_OK, HEARTBEAT_ACK, etc.) are not affected.
      if (signature !== undefined) frame.signature = signature;
      if (eventId !== undefined) frame.eventId = eventId;
      client.send(JSON.stringify(frame));
    }
  }
}
