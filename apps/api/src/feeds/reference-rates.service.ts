import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { safeFetch } from '../branding/safe-fetch';
import { RedisService } from '../realtime/redis.service';
import { FeedsRateLimiter } from './feeds-rate-limiter';
import { getCachedFeed, setCachedFeed } from './feeds-cache';
interface ReferenceTable {
  date: string;
  rates: Record<string, number>;
  fetchedAt: string;
}
export function parseReferenceRates(
  xml: string,
  now = Date.now(),
): ReferenceTable {
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
  }).parse(xml);
  const daily = parsed?.['gesmes:Envelope']?.Cube?.Cube;
  const date = daily?.time;
  const at = Date.parse(date + 'T00:00:00Z');
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(at) ||
    at > now ||
    at < now - 7 * 86400000
  )
    throw new Error('No current reference rates');
  const rates: Record<string, number> = { EUR: 1 };
  for (const row of Array.isArray(daily.Cube) ? daily.Cube : [daily.Cube]) {
    if (
      /^[A-Z]{3}$/.test(row?.currency) &&
      Number.isFinite(Number(row?.rate)) &&
      Number(row.rate) > 0
    )
      rates[row.currency] = Number(row.rate);
  }
  if (!rates.USD || Object.keys(rates).length < 3)
    throw new Error('Invalid reference rates');
  return { date, rates, fetchedAt: new Date(now).toISOString() };
}
@Injectable()
export class ReferenceRatesService {
  private pending?: Promise<ReferenceTable>;
  constructor(
    private readonly redis: RedisService,
    private readonly limiter: FeedsRateLimiter,
  ) {}
  private async table(): Promise<ReferenceTable> {
    const cached = await getCachedFeed(
      this.redis.publisher,
      'rss',
      'ecb-reference-v1',
    );
    if (cached) {
      try {
        const row = JSON.parse(cached) as ReferenceTable;
        if (Date.parse(row.date + 'T00:00:00Z') >= Date.now() - 7 * 86400000)
          return row;
      } catch {
        /* refresh invalid cache */
      }
    }
    if (!this.pending)
      this.pending = (async () => {
        this.limiter.check('www.ecb.europa.eu');
        const result = await safeFetch(
          'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
          {
            timeoutMs: 8000,
            maxBytes: 65536,
            accept: 'application/xml',
            userAgent: 'VenueOS/1.0 (https://venue-os.app; reference rates)',
          },
        );
        if (result.status !== 200)
          throw new Error('Reference source unavailable');
        const row = parseReferenceRates(result.body.toString('utf8'));
        await setCachedFeed(
          this.redis.publisher,
          'rss',
          'ecb-reference-v1',
          JSON.stringify(row),
          3600,
        );
        return row;
      })().finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  async get(base: string) {
    let table: ReferenceTable;
    try {
      table = await this.table();
    } catch {
      throw new ServiceUnavailableException(
        'Reference rates temporarily unavailable.',
      );
    }
    if (!table.rates[base])
      throw new BadRequestException('Choose a currency supported by the ECB.');
    return {
      base,
      date: table.date,
      fetchedAt: table.fetchedAt,
      source: 'European Central Bank',
      rates: Object.entries(table.rates)
        .filter(([code]) => code !== base)
        .map(([code, rate]) => ({ code, rate: rate / table.rates[base] })),
    };
  }
}
