import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
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
  @WebSocketServer()
  server: Server;

  private clients: Map<WebSocket, ClientContext> = new Map();

  constructor(private readonly redisService: RedisService) {
    this.redisService.setGateway(this);
  }

  handleConnection(client: WebSocket) {
    const connectionId = crypto.randomUUID();
    const authTimeout = setTimeout(() => {
      const ctx = this.clients.get(client);
      if (ctx && !ctx.isAuthenticated) {
        client.close(4001, 'Auth Timeout');
      }
    }, 5000);

    this.clients.set(client, {
      connectionId,
      isAuthenticated: false,
      socket: client,
      authTimeout,
    });
  }

  handleDisconnect(client: WebSocket) {
    const ctx = this.clients.get(client);
    if (ctx && ctx.authTimeout) {
      clearTimeout(ctx.authTimeout);
    }
    this.clients.delete(client);
  }

  @SubscribeMessage('HELLO')
  async handleHello(
    @MessageBody() payload: any,
    @ConnectedSocket() client: WebSocket,
  ) {
    const ctx = this.clients.get(client);
    if (!ctx) return;

    try {
      const { token, stateHash, idempotencyKey } = payload;
      if (!token) throw new Error('Missing token');

      // Verify JWT token
      const jwtSecret = process.env.DEVICE_JWT_SECRET || 'dev_secret';
      const decoded = jwt.verify(token, jwtSecret) as any;

      // Extract context from decoded token
      ctx.deviceId = decoded.deviceId;
      ctx.tenantId = decoded.tenantId;
      ctx.groupId = decoded.groupId;
      ctx.isAuthenticated = true;

      if (ctx.authTimeout) {
        clearTimeout(ctx.authTimeout);
        ctx.authTimeout = undefined;
      }

      // Check state hash if provided (dummy validation logic for now)
      // Real logic would query postgres/redis for current state hash
      const isStateValid = true; // Replace with real check

      if (!isStateValid) {
        this.send(client, 'STATE_RESYNC_REQUIRED', {
          reason: 'HASH_MISMATCH',
          expectedHash: 'unknown',
        }, idempotencyKey);
      } else {
        this.send(client, 'AUTH_OK', {
          deviceId: ctx.deviceId,
          expiresAt: decoded.exp,
        }, idempotencyKey);
        
        // Register in redis for metrics or fast lookups if needed
        if (ctx.deviceId && this.redisService.publisher) {
          await this.redisService.publisher.sadd(`tenant:${ctx.tenantId}:devices`, ctx.deviceId);
          if (ctx.groupId) {
            await this.redisService.publisher.sadd(`group:${ctx.groupId}:devices`, ctx.deviceId);
          }
        }
      }

    } catch (e) {
      this.send(client, 'AUTH_FAIL', {
        code: 401,
        reason: 'INVALID_TOKEN'
      });
      client.close(4001, 'Unauthorized');
    }
  }

  @SubscribeMessage('HEARTBEAT')
  handleHeartbeat(
    @MessageBody() payload: any,
    @ConnectedSocket() client: WebSocket,
  ) {
    const ctx = this.clients.get(client);
    if (!ctx || !ctx.isAuthenticated) return;

    // Save metrics or update last seen timestamp
    const deviceId = ctx.deviceId;
    
    // Fire and forget update to Redis
    // To limit redis ops, this could be batched.
    if (deviceId && this.redisService.publisher) {
      this.redisService.publisher.hset(`device:${deviceId}:status`, 
        'lastSeen', Date.now(),
        'metrics', JSON.stringify(payload.metrics || {})
      ).catch(console.error);
    }
  }

  @SubscribeMessage('ACK')
  handleAck(
    @MessageBody() payload: any,
    @ConnectedSocket() client: WebSocket,
  ) {
    const ctx = this.clients.get(client);
    if (!ctx || !ctx.isAuthenticated) return;

    // Publish ACT to redis so other microservices can record compliance
    this.redisService.publish('metrics:ack', {
      deviceId: ctx.deviceId,
      tenantId: ctx.tenantId,
      eventId: payload.receivedEventId,
      status: payload.status,
      timestamp: Date.now()
    }).catch(console.error);
  }

  public broadcastToScope(type: string, id: string, message: any) {
    // type is 'tenant' | 'group' | 'device'
    for (const [, ctx] of this.clients.entries()) {
      if (!ctx.isAuthenticated) continue;

      let match = false;
      if (type === 'tenant' && ctx.tenantId === id) match = true;
      if (type === 'group' && ctx.groupId === id) match = true;
      if (type === 'device' && ctx.deviceId === id) match = true;

      if (match) {
        this.send(ctx.socket, message.type, message.payload, crypto.randomUUID());
      }
    }
  }

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
