/**
 * Live-data integrations — parsers, dormant behaviour, caching, spend walls
 * and key hygiene.
 *
 * Fixture provenance (every one is a vendor's own response, trimmed):
 *   aerodatabox-fids-auh.json   real AeroDataBox FIDS response for AUH
 *                               (direct gateway, withLeg=false), six rows
 *   thesportsdb-livescore.json  the livescore example in TheSportsDB's
 *                               published v2 OpenAPI spec
 *   thesportsdb-schedule.json   TheSportsDB's published example file
 *                               /api/v2/examples/next_10_events_in_league.json
 *   twelvedata-quote.json       the /quote example in Twelve Data's docs
 *   coingecko-markets.json      the /coins/markets example in CoinGecko's
 *                               docs (+ two rows exercising the skip rules)
 *   tomtom-incident-details.json the Incident Details v5 example in TomTom's
 *                               docs, with the misplaced keys moved back
 *                               into `properties` (the published sample is
 *                               not valid JSON), plus a jam and a bad row
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { HttpException, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { __clearLiveDataCache } from './live-data-cache';
import {
  __setLiveDataTransport,
  LiveDataUpstreamError,
  providerGetJson,
} from './live-data-http';
import {
  parseAeroDataBoxFids,
  parseCoinGeckoMarkets,
  parseSportsDbEvents,
  parseTomTomIncidents,
  parseTwelveDataQuotes,
} from './live-data-parsers';
import {
  LIVE_DATA_FAMILIES,
  LIVE_DATA_PROVIDERS,
  liveDataStatus,
} from './live-data-providers';
import { LiveDataController } from './live-data.controller';
import { LiveDataService } from './live-data.service';

const fx = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'));
const KEYS = {
  TOMTOM_API_KEY: 'tt-test-key-0000',
  AERODATABOX_API_KEY: 'adb-test-key-0000',
  THESPORTSDB_API_KEY: 'tsdb-test-key-0000',
  TWELVE_DATA_API_KEY: 'td-test-key-0000',
  COINGECKO_API_KEY: 'CG-test-key-0000',
};

interface Call {
  url: string;
  headers: Record<string, string>;
}
let calls: Call[] = [];

function serve(routes: [RegExp, unknown, number?][]) {
  __setLiveDataTransport(async (url, init) => {
    calls.push({ url, headers: init.headers });
    const hit = routes.find(([re]) => re.test(url));
    const status = hit ? (hit[2] ?? 200) : 404;
    const body = hit ? JSON.stringify(hit[1]) : '{}';
    return { status, text: async () => body, headers: { get: () => null } };
  });
}

function makeService() {
  const redis = { publisher: null } as never;
  const geocoder = {
    coordinates: jest.fn(async () => [52.3726, 4.8906, true]),
  } as never;
  return new LiveDataService(redis, geocoder);
}

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  calls = [];
  __clearLiveDataCache();
  for (const k of [...Object.keys(KEYS), 'COINGECKO_API_PLAN'])
    saved[k] = process.env[k];
  for (const k of Object.keys(KEYS)) delete process.env[k];
});
afterEach(() => {
  __setLiveDataTransport(null);
  for (const [k, v] of Object.entries(saved))
    v === undefined ? delete process.env[k] : (process.env[k] = v);
});
const enableAll = () => Object.assign(process.env, KEYS);

// ── parsers ────────────────────────────────────────────────────────────────

describe('parsers (vendor fixtures)', () => {
  it('TomTom: categories, delay minutes, first coordinate, skips id-less rows', () => {
    const rows = parseTomTomIncidents(fx('tomtom-incident-details.json'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      type: 'Road closed',
      road: 'Paleisstraat',
      area: 'Paleisstraat → Rosmarijnsteeg',
      delayMin: null,
      severity: 'closure',
      lat: 52.3725919469,
      lon: 4.8905266414,
    });
    expect(rows[1]).toMatchObject({
      type: 'Traffic jam',
      road: 'A10',
      delayMin: 12,
      severity: 'major',
    });
  });

  it('AeroDataBox: airport-local HH:MM, destination from movement.airport, status words', () => {
    const rows = parseAeroDataBoxFids(
      fx('aerodatabox-fids-auh.json'),
      'departures',
    );
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => /^\d\d:\d\d$/.test(r.time))).toBe(true);
    expect(new Set(rows.map((r) => r.status))).toEqual(
      new Set(['DEPARTED', 'CANCELLED']),
    );
    const doha = rows.find((r) => r.placeCode === 'DOH')!;
    expect(doha).toMatchObject({
      flight: 'QR 1045',
      airline: 'Qatar',
      time: '12:20',
      revised: '',
      terminal: 'A',
      status: 'CANCELLED',
    });
    // sorted by scheduled UTC
    expect(rows.map((r) => r.scheduledUtc)).toEqual(
      [...rows.map((r) => r.scheduledUtc)].sort(),
    );
  });

  it('AeroDataBox: codeshares and cargo never become extra rows', () => {
    const base = fx('aerodatabox-fids-auh.json').departures[0];
    const rows = parseAeroDataBoxFids(
      {
        departures: [
          base,
          { ...base, number: 'XX 1', codeshareStatus: 'IsCodeshared' },
          { ...base, number: 'XX 2', isCargo: true },
        ],
      },
      'departures',
    );
    expect(rows.map((r) => r.flight)).toEqual([base.number]);
  });

  it('TheSportsDB: live rows keep period + clock; schedule rows are finals with scores', () => {
    const live = parseSportsDbEvents(
      fx('thesportsdb-livescore.json'),
      'livescore',
    );
    expect(live[0]).toMatchObject({
      state: 'live',
      period: '2H',
      clock: '85',
      home: { name: 'Botev Plovdiv', score: 0 },
      away: { name: 'CSKA Sofia', score: 4 },
    });
    const prev = parseSportsDbEvents(
      fx('thesportsdb-schedule.json'),
      'schedule',
    );
    expect(prev[0]).toMatchObject({
      state: 'final',
      home: { name: 'Wolves', score: 1 },
      away: { name: 'Brentford', score: 1 },
      startsAt: '2025-05-25T15:00:00Z',
      venue: 'Molineux Stadium',
    });
    const forced = parseSportsDbEvents(
      fx('thesportsdb-schedule.json'),
      'schedule',
      'upcoming',
    );
    expect(forced[0].home.score).toBeNull();
  });

  it('TheSportsDB: never carries team badge artwork (licence: no third-party artwork rights)', () => {
    const rows = parseSportsDbEvents(
      fx('thesportsdb-livescore.json'),
      'livescore',
    );
    expect(JSON.stringify(rows)).not.toContain('badge');
  });

  it('Twelve Data: string numbers become numbers; single and batch shapes; error rows dropped', () => {
    const one = parseTwelveDataQuotes(fx('twelvedata-quote.json'));
    expect(one).toEqual([
      {
        symbol: 'AAPL',
        name: 'Apple Inc',
        price: 148.85001,
        change: -0.23999,
        pct: -0.16097,
        currency: 'USD',
        marketOpen: false,
        asOf: '2021-09-16T06:00:00.000Z',
      },
    ]);
    const batch = parseTwelveDataQuotes({
      AAPL: fx('twelvedata-quote.json'),
      NOPE: { code: 400, message: 'x', status: 'error' },
    });
    expect(batch.map((q) => q.symbol)).toEqual(['AAPL']);
  });

  it('CoinGecko: rows without a price are skipped; symbols upper-cased', () => {
    const rows = parseCoinGeckoMarkets(fx('coingecko-markets.json'));
    expect(rows.map((r) => r.symbol)).toEqual(['BTC', 'ETH']);
    expect(rows[0]).toMatchObject({
      id: 'bitcoin',
      price: 77671,
      pct24h: -0.95302,
      rank: 1,
    });
  });
});

// ── dormant ────────────────────────────────────────────────────────────────

describe('dormant until a key exists', () => {
  it('status names the missing variable per family and nothing is enabled', () => {
    const s = liveDataStatus();
    for (const f of LIVE_DATA_FAMILIES) {
      expect(s[f]).toEqual({
        enabled: false,
        source: LIVE_DATA_PROVIDERS[f].source,
        missing: [LIVE_DATA_PROVIDERS[f].env],
      });
    }
  });

  it('every data method answers { enabled:false } and makes no request', async () => {
    serve([]);
    const svc = makeService();
    await expect(svc.traffic('Amsterdam', 25, 't1')).resolves.toEqual({
      enabled: false,
    });
    await expect(svc.flights('SFO', 'departures', 't1')).resolves.toEqual({
      enabled: false,
    });
    await expect(svc.scores('4391', 't1')).resolves.toEqual({ enabled: false });
    await expect(svc.stocks('AAPL', 't1')).resolves.toEqual({ enabled: false });
    await expect(svc.crypto('bitcoin', 'usd', 't1')).resolves.toEqual({
      enabled: false,
    });
    expect(calls).toHaveLength(0);
  });

  it('status flips per family as its key is set', () => {
    process.env.TWELVE_DATA_API_KEY = KEYS.TWELVE_DATA_API_KEY;
    const s = liveDataStatus();
    expect(s.stocks).toEqual({
      enabled: true,
      source: 'Twelve Data',
      missing: [],
    });
    expect(s.traffic.enabled).toBe(false);
  });

  it('a key never appears in the status answer', () => {
    enableAll();
    const text = JSON.stringify(liveDataStatus());
    for (const v of Object.values(KEYS)) expect(text).not.toContain(v);
  });
});

// ── live behaviour ─────────────────────────────────────────────────────────

describe('enabled', () => {
  beforeEach(enableAll);

  it('flights: one upstream call per airport per TTL, key in the header only', async () => {
    serve([
      [
        /api\.aerodatabox\.com\/flights\/airports\/iata\/AUH\?/,
        fx('aerodatabox-fids-auh.json'),
      ],
    ]);
    const svc = makeService();
    const a = await svc.flights('auh', 'departures', 't1');
    const b = await svc.flights('AUH', 'departures', 't2');
    expect(calls).toHaveLength(1);
    expect(calls[0].headers['X-Api-Key']).toBe(KEYS.AERODATABOX_API_KEY);
    expect(calls[0].url).not.toContain(KEYS.AERODATABOX_API_KEY);
    expect(a.enabled && a.cached).toBe(false);
    expect(b.enabled && b.cached).toBe(true);
    if (a.enabled) expect(a.source).toBe('AeroDataBox');
  });

  it('flights: rejects anything but a three-letter code before any request', async () => {
    serve([]);
    const svc = makeService();
    for (const bad of ['SF', 'SFO/../x', 'KSFO', ''])
      await expect(svc.flights(bad, 'departures', 't')).rejects.toBeInstanceOf(
        HttpException,
      );
    expect(calls).toHaveLength(0);
  });

  it('traffic: TomTom key rides only in the query (vendor requirement) and a cell is shared', async () => {
    serve([
      [
        /api\.tomtom\.com\/traffic\/services\/5\/incidentDetails\?bbox=/,
        fx('tomtom-incident-details.json'),
      ],
    ]);
    const svc = makeService();
    const r = await svc.traffic('Amsterdam', 25, 't1');
    await svc.traffic('52.37,4.89', 25, 't2');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('timeValidityFilter=present');
    expect(r.enabled && r.items.map((i) => i.type)).toEqual([
      'Traffic jam',
      'Road closed',
    ]);
    expect(JSON.stringify(r)).not.toContain(KEYS.TOMTOM_API_KEY);
  });

  it('traffic: an upstream failure never echoes the URL (which carries the key)', async () => {
    __setLiveDataTransport(async (url) => {
      throw new Error(`connect ECONNREFUSED ${url}`);
    });
    const svc = makeService();
    const err = await svc.traffic('Amsterdam', 25, 't1').catch((e) => e);
    expect(err).toBeInstanceOf(LiveDataUpstreamError);
    expect(String(err.message)).not.toContain(KEYS.TOMTOM_API_KEY);
  });

  it('scores: live first, then finals, league must be on the allow-list', async () => {
    serve([
      [/\/api\/v2\/json\/livescore\/4328$/, fx('thesportsdb-livescore.json')],
      [/\/schedule\/previous\/league\/4328$/, { schedule: [] }],
      [/\/schedule\/next\/league\/4328$/, { schedule: [] }],
    ]);
    const svc = makeService();
    const r = await svc.scores('4328', 't1');
    expect(r.enabled && r.items.map((g) => g.state)).toEqual(['live', 'live']);
    expect(
      calls.every((c) => c.headers['X-API-KEY'] === KEYS.THESPORTSDB_API_KEY),
    ).toBe(true);
    await expect(svc.scores('9999', 't1')).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('stocks: one cache entry per symbol; Authorization: apikey header', async () => {
    serve([
      [
        /api\.twelvedata\.com\/quote\?symbol=AAPL$/,
        fx('twelvedata-quote.json'),
      ],
    ]);
    const svc = makeService();
    const r = await svc.stocks('aapl, AAPL', 't1');
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.Authorization).toBe(
      `apikey ${KEYS.TWELVE_DATA_API_KEY}`,
    );
    expect(r.enabled && r.items[0].price).toBe(148.85001);
    await expect(svc.stocks('AAPL; DROP', 't1')).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('crypto: one top-250 call serves every coin list; pro host + pro header by default', async () => {
    serve([
      [
        /^https:\/\/pro-api\.coingecko\.com\/api\/v3\/coins\/markets\?vs_currency=usd/,
        fx('coingecko-markets.json'),
      ],
    ]);
    const svc = makeService();
    const a = await svc.crypto('bitcoin', 'usd', 't1');
    const b = await svc.crypto('ETH,bitcoin', 'usd', 't1');
    expect(calls).toHaveLength(1);
    expect(calls[0].headers['x-cg-pro-api-key']).toBe(KEYS.COINGECKO_API_KEY);
    expect(a.enabled && a.items.map((c) => c.id)).toEqual(['bitcoin']);
    expect(b.enabled && b.items.map((c) => c.id)).toEqual([
      'ethereum',
      'bitcoin',
    ]);
  });

  it('crypto: COINGECKO_API_PLAN=demo uses the demo host and header', async () => {
    process.env.COINGECKO_API_PLAN = 'demo';
    serve([
      [
        /^https:\/\/api\.coingecko\.com\/api\/v3\/coins\/markets/,
        fx('coingecko-markets.json'),
      ],
    ]);
    await makeService().crypto('bitcoin', 'usd', 't1');
    expect(calls[0].headers['x-cg-demo-api-key']).toBe(KEYS.COINGECKO_API_KEY);
  });

  it('the cluster-wide provider ceiling holds even with no Redis (it bounds money)', async () => {
    process.env.LIVE_DATA_PROVIDER_HOURLY_CAP = '1';
    try {
      serve([
        [/quote\?symbol=AAPL$/, fx('twelvedata-quote.json')],
        [/quote\?symbol=MSFT$/, fx('twelvedata-quote.json')],
      ]);
      const svc = makeService();
      await svc.stocks('AAPL', 'tenantA');
      await svc.stocks('AAPL', 'tenantB'); // warm cache: free, not charged
      await expect(svc.stocks('MSFT', 'tenantB')).rejects.toMatchObject({
        status: 429,
      });
      expect(calls).toHaveLength(1);
    } finally {
      delete process.env.LIVE_DATA_PROVIDER_HOURLY_CAP;
    }
  });

  it('the per-tenant hourly cap is charged on misses only (Redis sliding window)', async () => {
    process.env.LIVE_DATA_TENANT_HOURLY_CAP = '1';
    const z = new Map<string, number[]>();
    const kv = new Map<string, string>();
    const publisher = {
      zremrangebyscore: async (k: string, _min: number, max: number) => (
        z.set(
          k,
          (z.get(k) || []).filter((t) => t > max),
        ),
        0
      ),
      zcard: async (k: string) => (z.get(k) || []).length,
      zadd: async (k: string, score: number) => (
        z.set(k, [...(z.get(k) || []), score]),
        1
      ),
      pexpire: async () => 1,
      get: async (k: string) => kv.get(k) ?? null,
      set: async (k: string, v: string) => (kv.set(k, v), 'OK'),
    };
    try {
      serve([
        [/symbol=AAPL$/, fx('twelvedata-quote.json')],
        [/symbol=MSFT$/, fx('twelvedata-quote.json')],
      ]);
      const svc = new LiveDataService(
        { publisher } as never,
        { coordinates: async () => [0, 0, true] } as never,
      );
      await svc.stocks('AAPL', 'tenantA');
      await svc.stocks('AAPL', 'tenantA'); // warm: free
      await expect(svc.stocks('MSFT', 'tenantA')).rejects.toMatchObject({
        status: 429,
      });
      await expect(svc.stocks('MSFT', 'tenantB')).resolves.toMatchObject({
        enabled: true,
      });
      expect(calls).toHaveLength(2);
    } finally {
      delete process.env.LIVE_DATA_TENANT_HOURLY_CAP;
    }
  });

  it('a host outside the provider table is refused', async () => {
    await expect(
      providerGetJson('stocks', '/quote', {}, 'evil.example'),
    ).rejects.toBeInstanceOf(LiveDataUpstreamError);
  });

  it('vendor 401/429 bodies are never forwarded', async () => {
    serve([
      [/twelvedata/, { message: `bad key ${KEYS.TWELVE_DATA_API_KEY}` }, 401],
    ]);
    const err = await providerGetJson('stocks', '/quote?symbol=AAPL').catch(
      (e) => e,
    );
    expect(err).toMatchObject({ code: 'REJECTED' });
    expect(err.message).not.toContain(KEYS.TWELVE_DATA_API_KEY);
  });
});

// ── wire contract ──────────────────────────────────────────────────────────

describe('LiveDataController', () => {
  it('is guarded (every miss spends money on our key)', () => {
    const guards = Reflect.getMetadata('__guards__', LiveDataController) || [];
    expect(guards).toContain(JwtAuthGuard);
    expect(UseGuards).toBeDefined();
  });

  it('dormant routes are 200 { enabled:false }, provider errors are 502 with a fixed sentence', async () => {
    const svc = makeService();
    const ctl = new LiveDataController(svc);
    await expect(
      ctl.flights({ user: { tenantId: 't' } }, 'SFO'),
    ).resolves.toEqual({ enabled: false });
    expect(ctl.status().families.flights.enabled).toBe(false);
    enableAll();
    __setLiveDataTransport(async () => ({
      status: 500,
      text: async () => 'upstream exploded',
      headers: { get: () => null },
    }));
    const err = await ctl
      .flights({ user: { tenantId: 't' } }, 'SFO')
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(502);
    expect(JSON.stringify(err.getResponse())).not.toContain('exploded');
  });
});
