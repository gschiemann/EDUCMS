import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AirportConditionsService } from './airport-conditions.service';
import { TransitArrivalsService } from './transit-arrivals.service';
@Controller('api/v1/feeds')
export class TravelConditionsController {
  constructor(
    private readonly airports: AirportConditionsService,
    private readonly transit: TransitArrivalsService,
  ) {}
  @Get('airport-conditions')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  airport(@Query('airport') airport?: string) {
    if (
      airport !== undefined &&
      (typeof airport !== 'string' ||
        !/^[A-Za-z0-9]{0,4}$/.test(airport) ||
        airport.length === 1 ||
        airport.length === 2)
    )
      throw new BadRequestException(
        'Enter a three- or four-character airport code, or leave blank for all notices.',
      );
    return this.airports.get((airport || '').toUpperCase());
  }
  @Get('transit-stations')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  stations() {
    return this.transit.stations();
  }
  @Get('transit-arrivals')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  arrivals(@Query('station') station?: string) {
    if (
      typeof station !== 'string' ||
      !/^place-[A-Za-z0-9-]{2,50}$/.test(station)
    )
      throw new BadRequestException('Choose an MBTA station.');
    return this.transit.get(station);
  }
}
