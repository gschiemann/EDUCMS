import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { NewsService, type NewsScope } from './news.service';

// Same read-only kiosk-visible model as RSS/forecast. No tenant data or writes.
@Controller('api/v1/feeds')
export class NewsController {
  constructor(private readonly news: NewsService) {}
  @Get('news')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  get(
    @Query('scope') scope?: string,
    @Query('location') location?: string,
    @Query('sources') sources?: string,
  ) {
    if (
      typeof scope !== 'string' ||
      !['local', 'national', 'world'].includes(scope)
    )
      throw new BadRequestException(
        'Choose local, national or world coverage.',
      );
    if (
      location !== undefined &&
      (typeof location !== 'string' ||
        (location.trim() !== '' &&
          !/^[\p{L}\p{N} .,'-]{2,80}$/u.test(location.trim())))
    )
      throw new BadRequestException('Enter a U.S. ZIP code or city.');
    if (scope === 'local' && !location?.trim())
      throw new BadRequestException('Local news needs a ZIP code or city.');
    if (
      sources !== undefined &&
      (typeof sources !== 'string' ||
        sources.length > 240 ||
        !/^[a-z0-9.,-]*$/.test(sources))
    )
      throw new BadRequestException('Invalid source selection.');
    const domains = Array.from(
      new Set((sources || '').split(',').filter(Boolean)),
    ).sort();
    if (
      domains.length > 8 ||
      domains.some((d) => !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(d))
    )
      throw new BadRequestException('Choose up to eight publisher domains.');
    return this.news.get(scope as NewsScope, location?.trim() || '', domains);
  }
}
