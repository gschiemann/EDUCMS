/**
 * LiveDataModule — paid data families (traffic, flights, scores, stocks,
 * crypto), each dormant until its key is set. RedisService comes from the
 * @Global() RealtimeModule; ForecastService (the shared, rate-leased geocoder)
 * from FeedsModule.
 */
import { Module } from '@nestjs/common';

import { FeedsModule } from '../../feeds/feeds.module';
import { LiveDataController } from './live-data.controller';
import { LiveDataService } from './live-data.service';

@Module({
  imports: [FeedsModule],
  controllers: [LiveDataController],
  providers: [LiveDataService],
})
export class LiveDataModule {}
