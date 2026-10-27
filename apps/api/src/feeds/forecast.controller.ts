import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ForecastService } from './forecast.service';

// Like RSS: read-only kiosk-visible data, no tenant credentials or privileged writes.
@Controller('api/v1/feeds')
export class ForecastController {
  constructor(private readonly forecast: ForecastService) {}
  @Get('forecast')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async get(@Query('location') location?: string, @Query('units') units?: string) {
    if (typeof location !== 'string' || !location.trim() || location.length > 120 || (units !== undefined && units !== 'metric' && units !== 'imperial')) throw new BadRequestException('Enter a U.S. city, ZIP code or coordinates.');
    return this.forecast.get(location, units === 'metric');
  }
}
