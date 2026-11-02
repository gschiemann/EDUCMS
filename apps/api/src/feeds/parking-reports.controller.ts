import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RoadIncidentsService } from './road-incidents.service';
import { ParkingReportsService } from './parking-reports.service';
@Controller('api/v1/feeds')
export class ParkingReportsController {
  constructor(
    private readonly parking: ParkingReportsService,
    private readonly roads: RoadIncidentsService,
  ) {}
  @Get('road-incidents')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  road(@Query('location') location?: string) {
    if (
      typeof location !== 'string' ||
      location.trim().length < 2 ||
      location.length > 100 ||
      !/^[-\p{L}\p{N} .,'°]+$/u.test(location)
    )
      throw new BadRequestException(
        'Enter a California city, ZIP or coordinates.',
      );
    return this.roads.get(location.trim());
  }
  @Get('parking-reports')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  get(@Query('location') location?: string) {
    if (
      typeof location !== 'string' ||
      location.trim().length < 2 ||
      location.length > 100 ||
      !/^[-\p{L}\p{N} .,'°]+$/u.test(location)
    )
      throw new BadRequestException(
        'Enter a Los Angeles city location, ZIP or coordinates.',
      );
    return this.parking.get(location.trim());
  }
}
