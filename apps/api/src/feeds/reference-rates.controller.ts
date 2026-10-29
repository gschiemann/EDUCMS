import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ReferenceRatesService } from './reference-rates.service';
@Controller('api/v1/feeds')
export class ReferenceRatesController {
  constructor(private readonly rates: ReferenceRatesService) {}
  @Get('reference-rates')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  get(@Query('base') base?: string) {
    if (
      base !== undefined &&
      (typeof base !== 'string' || !/^[A-Z]{3}$/.test(base))
    )
      throw new BadRequestException('Choose a three-letter currency code.');
    return this.rates.get(base || 'USD');
  }
}
