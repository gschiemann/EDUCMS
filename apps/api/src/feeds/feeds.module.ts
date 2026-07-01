import { Module } from '@nestjs/common';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';
import { FeedsRateLimiter } from './feeds-rate-limiter';

// RedisService is provided by the @Global() RealtimeModule (see
// realtime.module.ts) — no need to import it here, matching how other
// feature modules (e.g. auth.module.ts) consume it for free.
@Module({
  controllers: [FeedsController],
  providers: [FeedsService, FeedsRateLimiter],
})
export class FeedsModule {}
