/**
 * GoogleReviewsModule — the real Google Reviews integration that replaced the
 * `comingSoon` stub in the web Apps registry.
 *
 * RedisService is provided by the @Global() RealtimeModule (see
 * realtime.module.ts), so it does not need importing here — same as
 * FeedsModule, which consumes it the same way for its response cache.
 */
import { Module } from '@nestjs/common';

import { GoogleReviewsController } from './google-reviews.controller';
import { GoogleReviewsService } from './google-reviews.service';

@Module({
  controllers: [GoogleReviewsController],
  providers: [GoogleReviewsService],
  exports: [GoogleReviewsService],
})
export class GoogleReviewsModule {}
