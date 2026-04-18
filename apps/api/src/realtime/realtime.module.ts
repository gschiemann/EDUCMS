import { Global, Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RedisService } from './redis.service';

// @Global so RedisService is available everywhere JwtAuthGuard is used
// (the guard depends on RedisService for distributed token revocation
// checks). Otherwise every feature module that gates an endpoint would
// have to import RealtimeModule explicitly — easy to forget and produces
// confusing "UnknownDependenciesException" at boot.
@Global()
@Module({
  providers: [RealtimeGateway, RedisService],
  exports: [RealtimeGateway, RedisService],
})
export class RealtimeModule {}
