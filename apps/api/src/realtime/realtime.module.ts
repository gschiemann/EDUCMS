import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RedisService } from './redis.service';

@Module({
  providers: [RealtimeGateway, RedisService],
  exports: [RealtimeGateway, RedisService],
})
export class RealtimeModule {}
