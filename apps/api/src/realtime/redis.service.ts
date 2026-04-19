import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public publisher: Redis | null = null;
  public subscriber: Redis | null = null;
  private gateway: any;
  private connected = false;

  constructor() {
    // Skip Redis entirely when explicitly disabled OR when no URL is set in production.
    // Railway deploys without a Redis plugin should boot cleanly and fall through
    // to HTTP-polling realtime — we do NOT want a missing REDIS_URL to crash the API.
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl || process.env.REDIS_DISABLED === 'true') {
      this.logger.warn(
        `Redis disabled (REDIS_URL ${redisUrl ? 'present but REDIS_DISABLED=true' : 'not set'}) — running with HTTP-polling realtime fallback`,
      );
      return;
    }

    try {
      const baseOpts = {
        maxRetriesPerRequest: 3,
        connectTimeout: 5000,
        enableOfflineQueue: false,
        lazyConnect: true,
        retryStrategy: (times: number) => {
          if (times > 3) {
            this.logger.warn('Redis unavailable — running without realtime features');
            return null; // Stop retrying
          }
          return Math.min(times * 200, 2000);
        },
        reconnectOnError: () => false,
      };
      this.publisher = new Redis(redisUrl, baseOpts);
      this.subscriber = new Redis(redisUrl, baseOpts);

      // Swallow error events — ioredis emits 'error' on every reconnect attempt,
      // and an unhandled 'error' event crashes the Node process.
      this.publisher.on('error', (err) => {
        this.logger.debug(`Redis publisher error (non-fatal): ${err.message}`);
      });
      this.subscriber.on('error', (err) => {
        this.logger.debug(`Redis subscriber error (non-fatal): ${err.message}`);
      });
    } catch (e) {
      this.logger.warn('Redis client creation failed — running without realtime features');
      this.publisher = null;
      this.subscriber = null;
    }
  }

  setGateway(gateway: any) {
    this.gateway = gateway;
  }

  async onModuleInit() {
    if (!this.publisher || !this.subscriber) return;

    // Absolute wall-clock cap on Redis bring-up. Boot must never hang
    // on Redis — we'd rather ship realtime over HTTP polling than
    // fail Railway's healthcheck window because ioredis is retrying.
    const hardCap = new Promise<void>((resolve) => setTimeout(resolve, 7000));

    const bringUp = (async () => {
      try {
        await this.publisher!.connect();
        await this.subscriber!.connect();
        this.connected = true;
        this.logger.log('Redis connected successfully');

        this.subscriber!.on('message', this.handleRedisMessage.bind(this));
        await this.subscriber!.psubscribe('tenant:*', 'group:*', 'device:*');

        this.subscriber!.on('pmessage', (_pattern, channel, message) => {
          this.handleRedisMessage(channel, message);
        });
      } catch (e) {
        this.logger.warn('Redis connection failed — running without realtime features');
        this.connected = false;
      }
    })();

    await Promise.race([bringUp, hardCap]);
    if (!this.connected) {
      this.logger.warn('Redis did not come up within 7s — proceeding with HTTP-polling fallback');
    }
  }

  async onModuleDestroy() {
    try {
      if (this.publisher) await this.publisher.quit();
      if (this.subscriber) await this.subscriber.quit();
    } catch { /* ignore cleanup errors */ }
  }

  private handleRedisMessage(channel: string, message: string) {
    if (!this.gateway) return;
    try {
      const parsed = JSON.parse(message);
      const channelParts = channel.split(':');
      if (channelParts.length < 2) return;
      const [type, id] = channelParts;
      this.gateway.broadcastToScope(type, id, parsed);
    } catch (e) {
      this.logger.error(`Failed to parse redis message on channel ${channel}:`, e);
    }
  }

  async publish(channel: string, payload: any) {
    if (this.connected && this.publisher) {
      await this.publisher.publish(channel, JSON.stringify(payload));
    } else {
      // Fallback: If Redis is unavailable (local dev), pipe directly to the resident websocket gateway
      if (this.gateway) {
        this.logger.debug(`[Mock Redis] Publishing to channel ${channel}`);
        this.handleRedisMessage(channel, JSON.stringify(payload));
      }
    }
  }

  /**
   * Check if a value is a member of a Redis set.
   * Used by JwtAuthGuard for token revocation checking.
   * Returns false if Redis is unavailable (fail-open for dev).
   */
  async sismember(key: string, member: string): Promise<boolean> {
    if (!this.connected || !this.publisher) {
      this.logger.warn('Redis unavailable — token revocation check skipped (fail-open)');
      return false;
    }
    try {
      const result = await this.publisher.sismember(key, member);
      return result === 1;
    } catch {
      return false;
    }
  }
}
