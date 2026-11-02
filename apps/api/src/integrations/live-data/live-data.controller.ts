/**
 * LiveDataController — the only way the traffic / flights / scores / markets
 * widgets reach their providers.
 *
 *   GET /api/v1/integrations/live-data/status                 → per family { enabled, source, missing }
 *   GET /api/v1/integrations/live-data/traffic?location=&radiusKm=
 *   GET /api/v1/integrations/live-data/flights?airport=&direction=
 *   GET /api/v1/integrations/live-data/scores?league=
 *   GET /api/v1/integrations/live-data/leagues
 *   GET /api/v1/integrations/live-data/stocks?symbols=
 *   GET /api/v1/integrations/live-data/crypto?coins=&currency=
 *
 * AUTH: same model as Google Reviews, for the same reason — every miss
 * spends money on OUR key, so nothing here is anonymous. `JwtAuthGuard`
 * accepts an operator session (builder) and a paired screen's device JWT
 * (the wall). Per-IP throttles sit on top of the per-tenant and per-provider
 * hourly walls in `live-data-cache.ts`.
 *
 * DORMANT: a family with no key answers 200 `{ enabled:false }` on every
 * route — never a 5xx, so "no key yet" can never look like an outage.
 * PROVIDER ERRORS: a 502 with a fixed sentence; the vendor's body and the
 * request URL (TomTom's carries the key) never leave this module.
 */

import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { LiveDataUpstreamError } from './live-data-http';
import { liveDataStatus } from './live-data-providers';
import { LiveDataService, SCORE_LEAGUES } from './live-data.service';

@Controller('api/v1/integrations/live-data')
@UseGuards(JwtAuthGuard)
export class LiveDataController {
  constructor(private readonly live: LiveDataService) {}

  @Get('status')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  status() {
    return { families: liveDataStatus() };
  }

  @Get('leagues')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  leagues() {
    return { leagues: SCORE_LEAGUES };
  }

  @Get('traffic')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  traffic(
    @Request() req: any,
    @Query('location') location?: string,
    @Query('radiusKm') radiusKm?: string,
  ) {
    return this.run(() =>
      this.live.traffic(
        String(location || ''),
        Number(radiusKm) || 25,
        tenantOf(req),
      ),
    );
  }

  @Get('flights')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  flights(
    @Request() req: any,
    @Query('airport') airport?: string,
    @Query('direction') direction?: string,
  ) {
    return this.run(() =>
      this.live.flights(
        String(airport || ''),
        direction === 'arrivals' ? 'arrivals' : 'departures',
        tenantOf(req),
      ),
    );
  }

  @Get('scores')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  scores(@Request() req: any, @Query('league') league?: string) {
    return this.run(() =>
      this.live.scores(String(league || ''), tenantOf(req)),
    );
  }

  @Get('stocks')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  stocks(@Request() req: any, @Query('symbols') symbols?: string) {
    return this.run(() =>
      this.live.stocks(String(symbols || ''), tenantOf(req)),
    );
  }

  @Get('crypto')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  crypto(
    @Request() req: any,
    @Query('coins') coins?: string,
    @Query('currency') currency?: string,
  ) {
    return this.run(() =>
      this.live.crypto(
        String(coins || ''),
        String(currency || 'usd'),
        tenantOf(req),
      ),
    );
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof HttpException) throw err;
      if (err instanceof LiveDataUpstreamError) {
        throw new HttpException(
          { code: `LIVE_DATA_${err.code}`, message: err.message },
          HttpStatus.BAD_GATEWAY,
        );
      }
      throw new HttpException(
        {
          code: 'LIVE_DATA_FAILED',
          message: 'Could not load live data right now.',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}

function tenantOf(req: any): string {
  return String(req?.user?.tenantId || '');
}
