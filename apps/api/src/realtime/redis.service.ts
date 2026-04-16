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
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      this.publisher = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) {
            this.logger.warn('Redis unavailable — running without realtime features');
            return null; // Stop retrying
          }
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
      });
      this.subscriber = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
      });
    } catch (e) {
      this.logger.warn('Redis client creation failed — running without realtime features');
    }
  }

  setGateway(gateway: any) {
    this.gateway = gateway;
  }

  async onModuleInit() {
    if (!this.publisher || !this.subscriber) return;

    try {
      await this.publisher.connect();
      await this.subscriber.connect();
      this.connected = true;
      this.logger.log('Redis connected successfully');

      this.subscriber.on('message', this.handleRedisMessage.bind(this));
      await this.subscriber.psubscribe('tenant:*', 'group:*', 'device:*');

      this.subscriber.on('pmessage', (_pattern, channel, message) => {
        this.handleRedisMessage(channel, message);
      });
    } catch (e) {
      this.logger.warn('Redis connection failed — running without realtime features');
      this.connected = false;
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
