import { Global, Module, OnModuleInit } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RedisService } from './redis.service';
import { SseService } from './sse.service';
import { SseController } from './sse.controller';
import { PrismaModule } from '../prisma/prisma.module';

// @Global so RedisService is available everywhere JwtAuthGuard is used
// (the guard depends on RedisService for distributed token revocation
// checks). Otherwise every feature module that gates an endpoint would
// have to import RealtimeModule explicitly — easy to forget and produces
// confusing "UnknownDependenciesException" at boot.
@Global()
@Module({
  imports: [PrismaModule],
  providers: [RealtimeGateway, RedisService, SseService],
  controllers: [SseController],
  exports: [RealtimeGateway, RedisService, SseService],
})
export class RealtimeModule implements OnModuleInit {
  constructor(
    private readonly redis: RedisService,
    private readonly sse: SseService,
  ) {}

  // Sprint 11 Phase B — wire SSE service into Redis fan-out at boot
  // so pmessages from `tenant:*` / `device:*` channels reach BOTH the
  // WS gateway AND every connected EventSource client.
  onModuleInit() {
    this.redis.setSseService(this.sse);
  }
}
