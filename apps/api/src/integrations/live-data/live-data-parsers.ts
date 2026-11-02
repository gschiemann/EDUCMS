/**
 * Pure parsers: vendor JSON → the small, display-only shapes the widgets read.
 * Each one drops anything it cannot trust (a row without its key fields is
 * skipped, never invented), clips every string, and caps the row count so a
 * provider change cannot widen what we store or render. Fixtures for every
 * parser live in `__fixtures__/` and are cut from the vendors' own published
 * response examples (see live-data.spec.ts for the provenance of each).
 */

const str = (v: unknown, max = 120): string =>
  typeof v === 'string'
    ? v.trim().slice(0, max)
    : typeof v === 'number'
      ? String(v)
      : '';
const num = (v: unknown): number | null => {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string' && v.trim() !== ''
        ? Number(v)
        : NaN;
  return Number.isFinite(n) ? n : null;
};
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

// ── Traffic · TomTom Incident Details v5 ─────────────────────────────────

/** TomTom iconCategory → plain words (Incident Details docs, 0–14). */
const TOMTOM_CATEGORY: Record<number, string> = {
  0: 'Traffic incident',
  1: 'Collision',
  2: 'Fog',
  3: 'Dangerous conditions',
  4: 'Rain',
  5: 'Ice',
  6: 'Traffic jam',
  7: 'Lane closed',
  8: 'Road closed',
  9: 'Road work',
  10: 'Wind',
  11: 'Flooding',
  14: 'Broken-down vehicle',
};
const MAGNITUDE = ['unknown', 'minor', 'moderate', 'major', 'closure'] as const;

export interface TrafficItem {
  id: string;
  type: string;
  road: string;
  area: string;
  /** Extra travel time in whole minutes vs free flow; null for closures/unknown. */
  delayMin: number | null;
  severity: (typeof MAGNITUDE)[number];
  lat: number;
  lon: number;
}

export function parseTomTomIncidents(body: unknown): TrafficItem[] {
  const out: TrafficItem[] = [];
  for (const inc of arr((body as any)?.incidents)) {
    const p = inc?.properties;
    if (!p) continue;
    const id = str(p.id, 80);
    if (!id) continue;
    const cat = num(p.iconCategory) ?? 0;
    const coords = arr(inc?.geometry?.coordinates);
    // LineString → first point; Point → the pair itself.
    const first = Array.isArray(coords[0]) ? coords[0] : coords;
    const lon = num(first?.[0]);
    const lat = num(first?.[1]);
    if (lat === null || lon === null) continue;
    const roads = arr(p.roadNumbers)
      .map((r) => str(r, 20))
      .filter(Boolean);
    const from = str(p.from, 80);
    const to = str(p.to, 80);
    const delay = num(p.delay);
    const mag = num(p.magnitudeOfDelay) ?? 0;
    const event = str(arr(p.events)[0]?.description, 80);
    out.push({
      id,
      type: TOMTOM_CATEGORY[cat] || event || 'Traffic incident',
      road: roads.length ? roads.join(' / ') : from || to || 'Road',
      area: from && to ? `${from} → ${to}` : from || to,
      delayMin: delay !== null && delay > 0 ? Math.round(delay / 60) : null,
      severity: MAGNITUDE[Math.max(0, Math.min(4, Math.round(mag)))],
      lat,
      lon,
    });
    if (out.length >= 200) break;
  }
  return out;
}

// ── Flights · AeroDataBox FIDS (/flights/airports/iata/{code}) ───────────

const FLIGHT_STATUS: Record<string, string> = {
  Unknown: 'SCHEDULED',
  Expected: 'SCHEDULED',
  CheckIn: 'CHECK-IN',
  Boarding: 'BOARDING',
  GateClosed: 'GATE CLOSED',
  Departed: 'DEPARTED',
  EnRoute: 'DEPARTED',
  Delayed: 'DELAYED',
  Approaching: 'LANDING',
  Arrived: 'ARRIVED',
  Canceled: 'CANCELLED',
  CanceledUncertain: 'CANCELLED',
  Diverted: 'DIVERTED',
};

export interface FlightBoardRow {
  flight: string;
  airline: string;
  /** Airport-local scheduled time, "HH:MM" exactly as the provider states it. */
  time: string;
  /** Airport-local revised time when it differs from the schedule. */
  revised: string;
  /** Destination (departures) or origin (arrivals). */
  place: string;
  placeCode: string;
  gate: string;
  terminal: string;
  status: string;
  /** Scheduled UTC instant, for ordering and for dropping past rows. */
  scheduledUtc: string;
}

/** "2026-11-01 14:25-07:00" → "14:25". Never re-zoned: the board shows airport time. */
function hhmm(local: unknown): string {
  const m = /\b(\d{2}):(\d{2})/.exec(str(local, 40));
  return m ? `${m[1]}:${m[2]}` : '';
}

export function parseAeroDataBoxFids(
  body: unknown,
  direction: 'departures' | 'arrivals',
): FlightBoardRow[] {
  const rows: FlightBoardRow[] = [];
  for (const f of arr((body as any)?.[direction])) {
    const flight = str(f?.number, 16);
    const mv = f?.movement;
    if (!flight || !mv) continue;
    if (f?.isCargo === true) continue;
    // A codeshare is the same aircraft under another number — one row per plane.
    if (f?.codeshareStatus === 'IsCodeshared') continue;
    const time = hhmm(mv.scheduledTime?.local);
    const revised = hhmm(mv.revisedTime?.local);
    rows.push({
      flight,
      airline: str(f?.airline?.name, 60),
      time,
      revised: revised && revised !== time ? revised : '',
      place: str(
        mv.airport?.municipalityName ||
          mv.airport?.shortName ||
          mv.airport?.name,
        60,
      ),
      placeCode: str(mv.airport?.iata, 4),
      gate: str(mv.gate, 8),
      terminal: str(mv.terminal, 8),
      status: FLIGHT_STATUS[str(f?.status, 24)] || 'SCHEDULED',
      scheduledUtc: str(mv.scheduledTime?.utc, 40),
    });
    if (rows.length >= 60) break;
  }
  return rows.sort((a, b) => a.scheduledUtc.localeCompare(b.scheduledUtc));
}

// ── Scores · TheSportsDB v2 (livescore / schedule) ──────────────────────

export interface ScoreRow {
  id: string;
  state: 'live' | 'final' | 'upcoming';
  /** Provider status words for a live game ("2H", "Q3"), else ''. */
  period: string;
  /** Provider progress (minute / clock) for a live game, else ''. */
  clock: string;
  home: { name: string; score: number | null };
  away: { name: string; score: number | null };
  /** UTC start instant (ISO), when known. */
  startsAt: string;
  venue: string;
}

const FINAL_RE =
  /^(ft|aet|pen|aot|ap|final|match finished|game finished|ended|after (extra time|over ?time|penalties))/i;
const NOT_STARTED_RE =
  /^(ns|not started|tbd|scheduled|time to be defined|postponed|cancelled|canceled)$/i;

function utcInstant(e: any): string {
  const ts = str(e?.strTimestamp ?? e?.strTimeStamp, 30);
  if (ts) return /[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts}Z`;
  const d = str(e?.dateEvent, 12);
  const t = str(e?.strTime ?? e?.strEventTime, 10);
  return d ? `${d}T${t || '00:00:00'}Z` : '';
}

export function parseSportsDbEvents(
  body: unknown,
  listKey: 'livescore' | 'schedule',
  forced?: ScoreRow['state'],
): ScoreRow[] {
  const out: ScoreRow[] = [];
  for (const e of arr((body as any)?.[listKey])) {
    const home = str(e?.strHomeTeam, 50);
    const away = str(e?.strAwayTeam, 50);
    const id = str(e?.idEvent, 20);
    if (!home || !away || !id) continue;
    const status = str(e?.strStatus, 30);
    if (/postponed|cancel/i.test(status) || str(e?.strPostponed, 4) === 'yes')
      continue;
    const hs = num(e?.intHomeScore);
    const as = num(e?.intAwayScore);
    let state: ScoreRow['state'] =
      forced ??
      (FINAL_RE.test(status)
        ? 'final'
        : !status || NOT_STARTED_RE.test(status)
          ? 'upcoming'
          : 'live');
    if (state === 'final' && (hs === null || as === null)) state = 'upcoming';
    out.push({
      id,
      state,
      period: state === 'live' ? status : '',
      clock: state === 'live' ? str(e?.strProgress, 12) : '',
      home: { name: home, score: state === 'upcoming' ? null : hs },
      away: { name: away, score: state === 'upcoming' ? null : as },
      startsAt: utcInstant(e),
      venue: str(e?.strVenue, 60),
    });
    if (out.length >= 40) break;
  }
  return out;
}

// ── Stocks · Twelve Data /quote ──────────────────────────────────────────

export interface QuoteRow {
  symbol: string;
  name: string;
  price: number;
  change: number;
  pct: number;
  currency: string;
  marketOpen: boolean;
  /** Provider's own quote time (unix seconds → ISO). */
  asOf: string;
}

function quote(q: any): QuoteRow | null {
  if (!q || q.status === 'error' || q.code) return null;
  const symbol = str(q.symbol, 12).toUpperCase();
  const price = num(q.close);
  if (!symbol || price === null) return null;
  const prev = num(q.previous_close);
  const change = num(q.change) ?? (prev !== null ? price - prev : 0);
  const pct = num(q.percent_change) ?? (prev ? (change / prev) * 100 : 0);
  const ts = num(q.timestamp);
  return {
    symbol,
    name: str(q.name, 60),
    price,
    change,
    pct,
    currency: str(q.currency, 4),
    marketOpen: q.is_market_open === true,
    asOf: ts ? new Date(ts * 1000).toISOString() : '',
  };
}

/** One symbol answers an object; several answer `{ SYM: object }`. */
export function parseTwelveDataQuotes(body: unknown): QuoteRow[] {
  const b = body as any;
  if (!b || typeof b !== 'object') return [];
  if (typeof b.symbol === 'string') {
    const one = quote(b);
    return one ? [one] : [];
  }
  return Object.values(b)
    .map(quote)
    .filter((q): q is QuoteRow => q !== null)
    .slice(0, 20);
}

// ── Crypto · CoinGecko /coins/markets ───────────────────────────────────

export interface CoinRow {
  id: string;
  symbol: string;
  name: string;
  price: number;
  pct24h: number;
  rank: number | null;
  asOf: string;
}

export function parseCoinGeckoMarkets(body: unknown): CoinRow[] {
  const out: CoinRow[] = [];
  for (const c of arr(body)) {
    const id = str(c?.id, 60);
    const price = num(c?.current_price);
    if (!id || price === null) continue;
    out.push({
      id,
      symbol: str(c?.symbol, 12).toUpperCase(),
      name: str(c?.name, 60),
      price,
      pct24h: num(c?.price_change_percentage_24h) ?? 0,
      rank: num(c?.market_cap_rank),
      asOf: str(c?.last_updated, 30),
    });
    if (out.length >= 250) break;
  }
  return out;
}
