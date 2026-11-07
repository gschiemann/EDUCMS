import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AirQualityService } from './air-quality.service';
@Controller('api/v1/feeds')
export class AirQualityController {
  constructor(private readonly air: AirQualityService) {}
  @Get('air-quality')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  get(@Query('location') location?: string) {
    if (
      typeof location !== 'string' ||
      location.trim().length < 2 ||
      location.length > 100 ||
      !/^[-\p{L}\p{N} .,'°]+$/u.test(location)
    )
      throw new BadRequestException('Enter a U.S. city, ZIP or coordinates.');
    return this.air.get(location.trim());
  }
}
