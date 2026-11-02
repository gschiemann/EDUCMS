/**
 * Live-data integrations — the paid data families a signage screen shows
 * (traffic, flights, scores, markets). One table, read by the status route,
 * the data routes and the web picker (through `/status`), so "is this family
 * on?" has exactly one answer.
 *
 * ── DORMANT UNTIL A KEY EXISTS ───────────────────────────────────────────
 * Same contract as Google Reviews and the Meta apps: an unset key is a normal
 * deploy, not an outage. `/status` answers `{ enabled:false, missing:[ENV] }`,
 * every data route answers 200 `{ enabled:false }`, and the builder's picker
 * keeps the family's widgets hidden. Nothing throws, nothing is fetched.
 *
 * ── KEYS ARE SERVER-ONLY ─────────────────────────────────────────────────
 * Only `providerKey()` reads these variables. A key never appears in a
 * response, an error body, a log line or a cache key. Four of the five
 * vendors take the key in a header; TomTom takes it ONLY as a query
 * parameter, so `live-data-http.ts` never lets a URL reach a log or an error.
 */

export type LiveDataFamily =
  | 'traffic'
  | 'flights'
  | 'scores'
  | 'stocks'
  | 'crypto';

export interface LiveDataProvider {
  family: LiveDataFamily;
  /** Shown on the screen as the data credit (a licence term for most). */
  source: string;
  sourceUrl: string;
  env: string;
  /** Vendor host the key may be sent to — and nowhere else. */
  host: string;
}

export const LIVE_DATA_PROVIDERS: Record<LiveDataFamily, LiveDataProvider> = {
  traffic: {
    family: 'traffic',
    source: 'TomTom',
    sourceUrl: 'https://www.tomtom.com/products/traffic-apis/',
    env: 'TOMTOM_API_KEY',
    host: 'api.tomtom.com',
  },
  flights: {
    family: 'flights',
    source: 'AeroDataBox',
    sourceUrl: 'https://aerodatabox.com/',
    env: 'AERODATABOX_API_KEY',
    host: 'api.aerodatabox.com',
  },
  scores: {
    family: 'scores',
    // TheSportsDB terms: paid use "must mention us as the source of the data".
    source: 'TheSportsDB',
    sourceUrl: 'https://www.thesportsdb.com/',
    env: 'THESPORTSDB_API_KEY',
    host: 'www.thesportsdb.com',
  },
  stocks: {
    family: 'stocks',
    source: 'Twelve Data',
    sourceUrl: 'https://twelvedata.com/',
    env: 'TWELVE_DATA_API_KEY',
    host: 'api.twelvedata.com',
  },
  crypto: {
    family: 'crypto',
    // CoinGecko commercial plans: "Data provided by CoinGecko", prominently.
    source: 'CoinGecko',
    sourceUrl: 'https://www.coingecko.com/en/api',
    env: 'COINGECKO_API_KEY',
    host: 'pro-api.coingecko.com',
  },
};

export const LIVE_DATA_FAMILIES = Object.keys(
  LIVE_DATA_PROVIDERS,
) as LiveDataFamily[];

/** The key for a family, or null when the family is dormant. */
export function providerKey(family: LiveDataFamily): string | null {
  // Literal reads (not process.env[name]) so the env schema's scanner sees each one.
  const raw =
    family === 'traffic'
      ? process.env.TOMTOM_API_KEY
      : family === 'flights'
        ? process.env.AERODATABOX_API_KEY
        : family === 'scores'
          ? process.env.THESPORTSDB_API_KEY
          : family === 'stocks'
            ? process.env.TWELVE_DATA_API_KEY
            : process.env.COINGECKO_API_KEY;
  const key = typeof raw === 'string' ? raw.trim() : '';
  return key.length >= 8 ? key : null;
}

/**
 * CoinGecko serves its paid plans from `pro-api` with `x-cg-pro-api-key` and
 * its free Demo plan from `api` with `x-cg-demo-api-key`. Paid is the default
 * because only the paid plans carry a commercial licence (pricing page,
 * 2026-11-01); `COINGECKO_API_PLAN=demo` exists for evaluation only.
 */
export function coingeckoPlan(): 'pro' | 'demo' {
  return (process.env.COINGECKO_API_PLAN || '').trim().toLowerCase() === 'demo'
    ? 'demo'
    : 'pro';
}

export interface FamilyStatus {
  enabled: boolean;
  source: string;
  missing: string[];
}

export function liveDataStatus(): Record<LiveDataFamily, FamilyStatus> {
  const out = {} as Record<LiveDataFamily, FamilyStatus>;
  for (const family of LIVE_DATA_FAMILIES) {
    const p = LIVE_DATA_PROVIDERS[family];
    const enabled = providerKey(family) !== null;
    out[family] = {
      enabled,
      source: p.source,
      missing: enabled ? [] : [p.env],
    };
  }
  return out;
}

/**
 * Upstream calls per provider per hour, cluster-wide. The bill's hard stop:
 * a runaway, a bug or a scripted loop across many tenants can never buy more
 * than this. Default 2,000/h (≈1.44M/month), above every estimate in the
 * cost table, so it is invisible in normal operation.
 */
export function providerHourlyCeiling(): number {
  const n = parseInt(process.env.LIVE_DATA_PROVIDER_HOURLY_CAP || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 2000;
}

/** Upstream (cache-miss) calls one tenant may cause per family per hour. */
export function tenantHourlyCap(): number {
  const n = parseInt(process.env.LIVE_DATA_TENANT_HOURLY_CAP || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 120;
}
