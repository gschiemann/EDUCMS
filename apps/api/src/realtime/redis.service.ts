import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { RealtimeGateway } from './realtime.gateway';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  public readonly publisher: Redis;
  public readonly subscriber: Redis;
  private gateway: RealtimeGateway;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.publisher = new Redis(redisUrl);
    this.subscriber = new Redis(redisUrl);
  }

  setGateway(gateway: RealtimeGateway) {
    this.gateway = gateway;
  }

  async onModuleInit() {
    this.subscriber.on('message', this.handleRedisMessage.bind(this));
    // Subscribe to wildcard tenant and group channels for overrides
    // using pattern subscription for fanout
    await this.subscriber.psubscribe('tenant:*', 'group:*', 'device:*');
    
    // Listen to standard psubscribe events
    this.subscriber.on('pmessage', (pattern, channel, message) => {
      this.handleRedisMessage(channel, message);
    });
  }

  async onModuleDestroy() {
    await this.publisher.quit();
    await this.subscriber.quit();
  }

  private handleRedisMessage(channel: string, message: string) {
    if (!this.gateway) return;

    try {
      const parsed = JSON.parse(message);
      // Determine targets from channel (e.g. tenant:123, group:456)
      
      const channelParts = channel.split(':');
      if (channelParts.length < 2) return;

      const [type, id] = channelParts;
      this.gateway.broadcastToScope(type, id, parsed);

    } catch (e) {
      console.error(`Failed to parse redis message on channel ${channel}:`, e);
    }
  }

  async publish(channel: string, payload: any) {
    await this.publisher.publish(channel, JSON.stringify(payload));
  }
}
