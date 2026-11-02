/**
 * LiveDataService — server-side readers for the paid data families.
 *
 * Every public method returns `{ enabled:false }` (and spends nothing) when
 * its key is unset. Every operator-chosen value (airport, league, symbol,
 * coin, location) is validated against a strict pattern or an allow-list
 * BEFORE it reaches a path or a cache key, so a caller can neither probe the
 * vendor's other endpoints nor mint unbounded cache keys.
 *
 * Refresh intervals (the TTLs below) are the cost model — see the PR's cost
 * table. Changing one changes the bill.
 */

import { BadRequestException, Injectable } from '@nestjs/common';

import { RedisService } from '../../realtime/redis.service';
import { ForecastService } from '../../feeds/forecast.service';
import { airDistanceKm } from '../../feeds/air-quality.service';
import { cachedLiveRead } from './live-data-cache';
import { LiveDataUpstreamError, providerGetJson } from './live-data-http';
import {
  parseAeroDataBoxFids,
  parseCoinGeckoMarkets,
  parseSportsDbEvents,
  parseTomTomIncidents,
  parseTwelveDataQuotes,
  type CoinRow,
  type FlightBoardRow,
  type QuoteRow,
  type ScoreRow,
  type TrafficItem,
} from './live-data-parsers';
import {
  coingeckoPlan,
  LIVE_DATA_PROVIDERS,
  providerKey,
  type LiveDataFamily,
} from './live-data-providers';

export const TTL = {
  /** TomTom incidents per ~20 km grid cell. */
  traffic: 300,
  /** AeroDataBox FIDS per airport. */
  flights: 300,
  /** TheSportsDB livescore per league (their paid plans refresh every 2 min). */
  scoresLive: 120,
  /** Previous/next schedule per league. */
  scoresSchedule: 1800,
  /** Twelve Data quote per symbol while its market is open … */
  quoteOpen: 60,
  /** … and while it is closed (the price cannot move). */
  quoteClosed: 900,
  /** CoinGecko top-250 board per currency. */
  crypto: 120,
} as const;

/**
 * Leagues the scores board offers. A fixed list on purpose: it bounds the
 * upstream bill (≤ 13 leagues × 3 calls per TTL, whatever the fleet size) and
 * every id was checked against TheSportsDB's own league lookup (2026-11-01).
 */
export const SCORE_LEAGUES: { id: string; name: string; sport: string }[] = [
  { id: '4391', name: 'NFL', sport: 'American Football' },
  { id: '4479', name: 'NCAA Division I Football', sport: 'American Football' },
  { id: '4387', name: 'NBA', sport: 'Basketball' },
  { id: '4516', name: 'WNBA', sport: 'Basketball' },
  { id: '4607', name: 'NCAA Division I Basketball (Men)', sport: 'Basketball' },
  { id: '4424', name: 'MLB', sport: 'Baseball' },
  { id: '4380', name: 'NHL', sport: 'Ice Hockey' },
  { id: '4346', name: 'MLS', sport: 'Soccer' },
  { id: '4328', name: 'English Premier League', sport: 'Soccer' },
  { id: '4480', name: 'UEFA Champions League', sport: 'Soccer' },
  { id: '4335', name: 'Spanish La Liga', sport: 'Soccer' },
  { id: '4331', name: 'German Bundesliga', sport: 'Soccer' },
  { id: '4332', name: 'Italian Serie A', sport: 'Soccer' },
];

export const CRYPTO_CURRENCIES = ['usd', 'eur', 'gbp', 'cad'] as const;

const AIRPORT_RE = /^[A-Z]{3}$/;
const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;
const COIN_RE = /^[a-z0-9-]{1,40}$/;

export interface Dormant {
  enabled: false;
}
export interface Live<T> {
  enabled: true;
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  cached: boolean;
  items: T[];
}
export type Answer<T, Extra = object> = Dormant | (Live<T> & Extra);

function credit(family: LiveDataFamily) {
  return {
    source: LIVE_DATA_PROVIDERS[family].source,
    sourceUrl: LIVE_DATA_PROVIDERS[family].sourceUrl,
  };
}

@Injectable()
export class LiveDataService {
  constructor(
    private readonly redis: RedisService,
    private readonly geocoder: ForecastService,
  ) {}

  // ── Traffic ───────────────────────────────────────────────────────────
  async traffic(
    location: string,
    radiusKm: number,
    tenantId: string,
  ): Promise<
    Answer<TrafficItem & { distanceKm: number }, { location: string }>
  > {
    const key = providerKey('traffic');
    if (!key) return { enabled: false };
    const place = (location || '').trim().slice(0, 120);
    if (place.length < 2) throw new BadRequestException('Choose a location.');
    const radius = Math.max(5, Math.min(50, Math.round(radiusKm || 25)));
    let lat: number, lon: number;
    try {
      [lat, lon] = await this.geocoder.coordinates(place, false);
    } catch {
      throw new BadRequestException(
        'We could not find that location. Try a city, ZIP code or coordinates.',
      );
    }
    // Share one fetch per ~20 km cell: everyone in a metro reads the same answer.
    const cellLat = Math.round(lat * 5) / 5;
    const cellLon = Math.round(lon * 5) / 5;
    const dLat = 0.3;
    const dLon = 0.3 / Math.max(0.2, Math.cos((cellLat * Math.PI) / 180));
    // ≤ 67 km × 67 km ≈ 4,500 km², inside TomTom's 10,000 km² bbox ceiling.
    const bbox = [
      cellLon - dLon,
      cellLat - dLat,
      cellLon + dLon,
      cellLat + dLat,
    ]
      .map((n) => n.toFixed(4))
      .join(',');
    const fields =
      '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,length,delay,roadNumbers}}}';
    const read = await cachedLiveRead(
      this.redis,
      'traffic',
      `${cellLat},${cellLon}`,
      TTL.traffic,
      tenantId,
      async () =>
        parseTomTomIncidents(
          await providerGetJson(
            'traffic',
            `/traffic/services/5/incidentDetails?bbox=${bbox}&fields=${encodeURIComponent(fields)}&language=en-US&timeValidityFilter=present&key=${encodeURIComponent(key)}`,
          ),
        ),
    );
    const items = read.value
      .map((i) => ({
        ...i,
        distanceKm: Math.round(airDistanceKm(lat, lon, i.lat, i.lon)),
      }))
      .filter((i) => i.distanceKm <= radius)
      .sort(
        (a, b) =>
          (b.delayMin ?? 0) - (a.delayMin ?? 0) || a.distanceKm - b.distanceKm,
      )
      .slice(0, 30);
    return {
      enabled: true,
      ...credit('traffic'),
      fetchedAt: read.fetchedAt,
      cached: read.cached,
      location: place,
      items,
    };
  }

  // ── Flights ───────────────────────────────────────────────────────────
  async flights(
    airport: string,
    direction: 'departures' | 'arrivals',
    tenantId: string,
  ): Promise<Answer<FlightBoardRow, { airport: string; direction: string }>> {
    const key = providerKey('flights');
    if (!key) return { enabled: false };
    const code = (airport || '').trim().toUpperCase();
    if (!AIRPORT_RE.test(code))
      throw new BadRequestException(
        'Enter a three-letter airport code, such as SFO.',
      );
    const dir = direction === 'arrivals' ? 'arrivals' : 'departures';
    const read = await cachedLiveRead(
      this.redis,
      'flights',
      `${code}:${dir}`,
      TTL.flights,
      tenantId,
      async () =>
        parseAeroDataBoxFids(
          await providerGetJson(
            'flights',
            `/flights/airports/iata/${code}?offsetMinutes=-30&durationMinutes=360&direction=${dir === 'arrivals' ? 'Arrival' : 'Departure'}&withLeg=false&withCancelled=true&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false`,
            { 'X-Api-Key': key },
          ),
          dir,
        ),
    );
    const now = Date.now();
    // A departed / arrived row leaves the board 20 minutes after its time.
    const items = read.value
      .filter((r) => {
        const t = Date.parse(r.scheduledUtc.replace(' ', 'T'));
        if (!Number.isFinite(t)) return true;
        return !(
          ['DEPARTED', 'ARRIVED'].includes(r.status) && t < now - 20 * 60000
        );
      })
      .slice(0, 20);
    return {
      enabled: true,
      ...credit('flights'),
      fetchedAt: read.fetchedAt,
      cached: read.cached,
      airport: code,
      direction: dir,
      items,
    };
  }

  // ── Scores ────────────────────────────────────────────────────────────
  async scores(
    leagueId: string,
    tenantId: string,
  ): Promise<Answer<ScoreRow, { league: string }>> {
    const key = providerKey('scores');
    if (!key) return { enabled: false };
    const league = SCORE_LEAGUES.find(
      (l) => l.id === String(leagueId || '').trim(),
    );
    if (!league) throw new BadRequestException('Choose a league.');
    const headers = { 'X-API-KEY': key };
    const get = (
      kind: string,
      path: string,
      ttl: number,
      list: 'livescore' | 'schedule',
      forced?: ScoreRow['state'],
    ) =>
      cachedLiveRead(
        this.redis,
        'scores',
        `${league.id}:${kind}`,
        ttl,
        tenantId,
        async () =>
          parseSportsDbEvents(
            await providerGetJson('scores', `/api/v2/json${path}`, headers),
            list,
            forced,
          ),
      );
    const [live, prev, next] = await Promise.all([
      get('live', `/livescore/${league.id}`, TTL.scoresLive, 'livescore'),
      get(
        'previous',
        `/schedule/previous/league/${league.id}`,
        TTL.scoresSchedule,
        'schedule',
      ),
      get(
        'next',
        `/schedule/next/league/${league.id}`,
        TTL.scoresSchedule,
        'schedule',
        'upcoming',
      ),
    ]);
    const liveIds = new Set(live.value.map((g) => g.id));
    const now = Date.now();
    // Finals from the last 36 hours, newest first; anything later than now is
    // not a final, whatever its row says.
    const finals = prev.value
      .filter((g) => !liveIds.has(g.id) && g.state === 'final')
      .filter((g) => {
        const t = Date.parse(g.startsAt);
        return Number.isFinite(t) && t <= now && t > now - 36 * 3600_000;
      })
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
    const upcoming = next.value
      .filter(
        (g) =>
          !liveIds.has(g.id) && Date.parse(g.startsAt) > now - 3 * 3600_000,
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const items = [...live.value, ...finals, ...upcoming].slice(0, 12);
    const fetchedAt = [live, prev, next].map((r) => r.fetchedAt).sort()[0];
    return {
      enabled: true,
      ...credit('scores'),
      fetchedAt,
      cached: live.cached && prev.cached && next.cached,
      league: league.name,
      items,
    };
  }

  // ── Stocks ────────────────────────────────────────────────────────────
  async stocks(symbols: string, tenantId: string): Promise<Answer<QuoteRow>> {
    const key = providerKey('stocks');
    if (!key) return { enabled: false };
    const list = Array.from(
      new Set(
        String(symbols || '')
          .toUpperCase()
          .split(/[\s,]+/)
          .filter(Boolean),
      ),
    ).slice(0, 8);
    if (!list.length || !list.every((s) => SYMBOL_RE.test(s))) {
      throw new BadRequestException(
        'Enter up to 8 ticker symbols, such as AAPL, MSFT.',
      );
    }
    // One cache entry per SYMBOL: Twelve Data bills per symbol either way, and
    // per-symbol entries are shared by every board that shows that symbol.
    let firstError: unknown = null;
    const reads = await Promise.all(
      list.map((s) =>
        cachedLiveRead<QuoteRow[]>(
          this.redis,
          'stocks',
          s,
          TTL.quoteOpen,
          tenantId,
          async () =>
            parseTwelveDataQuotes(
              await providerGetJson(
                'stocks',
                `/quote?symbol=${encodeURIComponent(s)}`,
                { Authorization: `apikey ${key}` },
              ),
            ),
          (rows) => (rows[0]?.marketOpen ? TTL.quoteOpen : TTL.quoteClosed),
        ).catch((err) => {
          firstError ??= err;
          return null;
        }),
      ),
    );
    const ok = reads.filter((r): r is NonNullable<typeof r> => r !== null);
    // A board shows the symbols it can; only when none load is it an error —
    // and then the real one (a spend cap stays a 429, not a fake outage).
    if (!ok.length)
      throw firstError ?? new LiveDataUpstreamError('UNAVAILABLE');
    return {
      enabled: true,
      ...credit('stocks'),
      fetchedAt: ok.map((r) => r.fetchedAt).sort()[0],
      cached: ok.every((r) => r.cached),
      items: ok.flatMap((r) => r.value),
    };
  }

  // ── Crypto ────────────────────────────────────────────────────────────
  async crypto(
    coins: string,
    currency: string,
    tenantId: string,
  ): Promise<Answer<CoinRow, { currency: string }>> {
    const key = providerKey('crypto');
    if (!key) return { enabled: false };
    const cur = (CRYPTO_CURRENCIES as readonly string[]).includes(
      (currency || 'usd').toLowerCase(),
    )
      ? (currency || 'usd').toLowerCase()
      : 'usd';
    const wanted = Array.from(
      new Set(
        String(coins || 'bitcoin,ethereum,solana')
          .toLowerCase()
          .split(/[\s,]+/)
          .filter(Boolean),
      ),
    ).slice(0, 8);
    if (!wanted.every((c) => COIN_RE.test(c)))
      throw new BadRequestException(
        'Enter coin names or symbols, such as bitcoin, ETH.',
      );
    const pro = coingeckoPlan() === 'pro';
    // ONE call per currency for the top 250 coins serves every board on the
    // fleet: 720 calls/day per currency, whatever the number of screens.
    const read = await cachedLiveRead(
      this.redis,
      'crypto',
      `top250:${cur}`,
      TTL.crypto,
      tenantId,
      async () =>
        parseCoinGeckoMarkets(
          await providerGetJson(
            'crypto',
            `/api/v3/coins/markets?vs_currency=${cur}&order=market_cap_desc&per_page=250&page=1&sparkline=false`,
            pro ? { 'x-cg-pro-api-key': key } : { 'x-cg-demo-api-key': key },
            pro ? undefined : 'api.coingecko.com',
          ),
        ),
    );
    const items = wanted
      .map(
        (w) =>
          read.value.find((c) => c.id === w) ||
          read.value.find((c) => c.symbol.toLowerCase() === w),
      )
      .filter((c): c is CoinRow => !!c);
    return {
      enabled: true,
      ...credit('crypto'),
      fetchedAt: read.fetchedAt,
      cached: read.cached,
      currency: cur,
      items,
    };
  }
}
