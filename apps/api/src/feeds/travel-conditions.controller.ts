import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AirportConditionsService } from './airport-conditions.service';
import { TransitArrivalsService } from './transit-arrivals.service';
import { GtfsDeparturesService } from './gtfs/gtfs-departures.service';
import { RoadConditionsService } from './road-conditions.service';
@Controller('api/v1/feeds')
export class TravelConditionsController {
  constructor(
    private readonly airports: AirportConditionsService,
    private readonly transit: TransitArrivalsService,
    private readonly gtfs: GtfsDeparturesService,
    private readonly roads: RoadConditionsService,
  ) {}
  /** Free road incidents (CHP, California) + DOT work zones (CC0 WZDx feeds). */
  @Get('road-conditions')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  roadConditions(
    @Query('location') location?: string,
    @Query('radiusKm') radiusKm?: string,
  ) {
    if (
      typeof location !== 'string' ||
      location.trim().length < 2 ||
      location.length > 120
    )
      throw new BadRequestException(
        'Choose a U.S. city, ZIP code or coordinates.',
      );
    return this.roads.get(location.trim(), Number(radiusKm) || 25);
  }
  /** Open GTFS-realtime agencies with reviewed licences. */
  @Get('gtfs-agencies')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  gtfsAgencies() {
    return this.gtfs.agencies();
  }
  @Get('gtfs-stations')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  gtfsStations(@Query('agency') agency?: string, @Query('q') q?: string) {
    return this.gtfs.stations(String(agency || ''), String(q || ''));
  }
  @Get('gtfs-departures')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  gtfsDepartures(
    @Query('agency') agency?: string,
    @Query('station') station?: string,
  ) {
    return this.gtfs.departures(String(agency || ''), String(station || ''));
  }
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
