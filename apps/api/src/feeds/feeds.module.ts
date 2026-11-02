import { RoadIncidentsService } from './road-incidents.service';
import { ParkingReportsController } from './parking-reports.controller';
import { ParkingReportsService } from './parking-reports.service';
import { TravelConditionsController } from './travel-conditions.controller';
import { AirportConditionsService } from './airport-conditions.service';
import { TransitArrivalsService } from './transit-arrivals.service';
import { PublicSourceCache } from './public-source-cache';
import { AirQualityService } from './air-quality.service';
import { AirQualityController } from './air-quality.controller';
import { CurrentWeatherController } from './current-weather.controller';
import { CurrentWeatherService } from './current-weather.service';
import { ReferenceRatesController } from './reference-rates.controller';
import { ReferenceRatesService } from './reference-rates.service';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';
import { ForecastController } from './forecast.controller';
import { ForecastService } from './forecast.service';
import { Module } from '@nestjs/common';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';
import { FeedsRateLimiter } from './feeds-rate-limiter';

// RedisService is provided by the @Global() RealtimeModule (see
// realtime.module.ts) — no need to import it here, matching how other
// feature modules (e.g. auth.module.ts) consume it for free.
@Module({
  controllers: [
    ParkingReportsController,
    TravelConditionsController,
    AirQualityController,
    FeedsController,
    ForecastController,
    NewsController,
    ReferenceRatesController,
    CurrentWeatherController,
  ],
  providers: [
    RoadIncidentsService,
    ParkingReportsService,
    AirportConditionsService,
    TransitArrivalsService,
    PublicSourceCache,
    AirQualityService,
    FeedsService,
    FeedsRateLimiter,
    ForecastService,
    NewsService,
    ReferenceRatesService,
    CurrentWeatherService,
  ],
})
export class FeedsModule {}
