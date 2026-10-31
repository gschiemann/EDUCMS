import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentWeatherService } from './current-weather.service';
@Controller('api/v1/feeds')
export class CurrentWeatherController {
  constructor(private readonly weather: CurrentWeatherService) {}
  @Get('current-weather')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  get(@Query('location') location?: string, @Query('units') units?: string) {
    if (
      typeof location !== 'string' ||
      location.trim().length < 2 ||
      location.length > 100 ||
      !/^[-\p{L}\p{N} .,'°]+$/u.test(location)
    )
      throw new BadRequestException('Enter a city, ZIP code or coordinates.');
    if (units !== undefined && !['imperial', 'metric'].includes(units))
      throw new BadRequestException('Choose imperial or metric units.');
    return this.weather.get(location.trim(), units === 'metric');
  }
}
