import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import { RedisService } from './redis.service';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

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

  constructor(private readonly redisService: RedisService) {
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
      if (token.startsWith('dev_')) {
        // TEMPORARY BETA BYPASS: dev_ tokens for beta test phase
        const parts = token.split('_');
        decoded = { deviceId: parts[1], tenantId: parts.slice(2).join('_') };
      } else {
        const jwtSecret = process.env.DEVICE_JWT_SECRET || 'dev_secret';
        decoded = jwt.verify(token, jwtSecret) as any;
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
      ).catch(() => {});
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
    }).catch(() => {});
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
        this.send(ctx.socket, message.type, message.payload, crypto.randomUUID());
        sent++;
      }
    }
    this.logger.log(`[WS] broadcastToScope(${type}:${id}, ${message.type}) → sent to ${sent}/${total} clients`);
  }

  // ─── Send a typed message to a single client ───
  private send(client: WebSocket, type: string, payload: any, idempotencyKey?: string) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type,
        payload,
        idempotencyKey: idempotencyKey || crypto.randomUUID(),
        timestamp: Math.floor(Date.now() / 1000)
      }));
    }
  }
}
