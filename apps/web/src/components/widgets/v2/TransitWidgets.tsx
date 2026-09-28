"use client";
/**
 * VenueOS · Transit / Airport widgets — Departures Board, Flight Status,
 * Transit Departures, Parking Availability.
 *
 * None of these is connected to a flight, transit or parking feed. They
 * render what the template holds; the SFO / Embarcadero sample boards show
 * only in the builder, stamped SAMPLE, and a real screen with nothing entered
 * shows a dash (lane B4, 2026-09-27 — `_shared/live-data-truth.tsx`).
 */
import React from 'react';
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { BaseCfg, WidgetProps } from './_shared/types';
import { useNowTick } from './_shared/useNowTick';
import { configFreshness, formatInZone } from '@/lib/time-truth';
import { LIVE_DATA_SEEDED_LABELS, NothingTyped, SampleStamp, numberOf as num, ownLabel, textOf as text, typedRows, useRealScreen } from './_shared/live-data-truth';

function px(z: number, f: number): number { return Math.max(8, Math.round(z * f)); }

/**
 * W02 (2026-09-12) — this was `nowHM()`, a bare `new Date()` read inline at
 * render. A departures board mounts once when the terminal display boots and
 * then sits there; `withMeasuredHeight` only re-renders it on a resize that
 * never comes. The board's own clock therefore stopped at boot and went on
 * presenting that minute as the current time, next to departure times it was
 * meant to be read against.
 */
function nowHM(now: Date, timeZone?: string | null): string {
  return formatInZone(now, { hour: '2-digit', minute: '2-digit', hour12: false }, timeZone);
}

/* ════════════════ DEPARTURES BOARD ════════════════ */

export interface FlightRow {
  flight: string;
  time: string;
  dest: string;
  gate: string;
  status: string;
  note?: string;
}
export interface DeparturesBoardCfg extends BaseCfg {
  airport?: string;
  flights?: FlightRow[];
  refreshSec?: number;
  mode?: string;
  /** IANA zone for the board clock. Unset = the device clock. */
  timezone?: string;
}

const DEPARTURES_FLIGHTS: FlightRow[] = [
  { flight: 'AA 1421', time: '14:25', dest: "CHICAGO O'HARE", gate: 'A12', status: 'BOARDING', note: 'rows 30+' },
  { flight: 'UA  504', time: '14:30', dest: 'NEW YORK JFK', gate: 'B07', status: 'ON TIME', note: '' },
  { flight: 'DL 1198', time: '14:45', dest: 'ATLANTA', gate: 'C22', status: 'DELAYED', note: 'now 16:10' },
  { flight: 'WN 4001', time: '14:50', dest: 'SEATTLE', gate: 'B14', status: 'ON TIME', note: '' },
  { flight: 'BA   65', time: '15:10', dest: 'LONDON HEATHROW', gate: 'I04', status: 'GATE OPEN', note: 'check in dn' },
  { flight: 'JL    7', time: '15:20', dest: 'TOKYO NARITA', gate: 'I12', status: 'ON TIME', note: '' },
  { flight: 'AS  227', time: '15:35', dest: 'PORTLAND', gate: 'A04', status: 'CANCELLED', note: 'rebooking' },
  { flight: 'F9 2018', time: '15:55', dest: 'DENVER', gate: 'D01', status: 'ON TIME', note: '' },
];

function statusColor(status: string): string {
  if (status === 'BOARDING') return '#ffeb3b';
  if (status === 'DELAYED') return '#ff6b7a';
  if (status === 'CANCELLED') return '#ff3b30';
  return '#e8a01e';
}

/** Departures held in the template — never the sample. */
function flightRows(value: unknown): FlightRow[] {
  return typedRows<Record<string, unknown>>(value, (f) => text(f.flight) !== '' || text(f.dest) !== '')
    .map((f) => ({ flight: text(f.flight), time: text(f.time), dest: text(f.dest), gate: text(f.gate), status: text(f.status).toUpperCase(), note: text(f.note) }));
}

export function DeparturesBoardWidget({ config, live = true, height = 480 }: WidgetProps<DeparturesBoardCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0b0b0b', textColor: '#e8a01e', accentColor: '#ffeb3b', ...c.style });
  const realScreen = useRealScreen();
  const typed = flightRows(c.flights);
  const rows: FlightRow[] = typed.length ? typed : realScreen ? [] : DEPARTURES_FLIGHTS;
  const visible = rows.slice(0, 8);
  const typedAirport = ownLabel(c.airport, LIVE_DATA_SEEDED_LABELS.departuresAirport);
  const airport = typedAirport ?? (realScreen ? '' : LIVE_DATA_SEEDED_LABELS.departuresAirport);
  const demo = !realScreen && (typed.length === 0 || typedAirport === undefined);
  const gridCols = '180px 240px 1.4fr 200px 200px 200px';
  const now = useNowTick(30_000, live);

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0556), display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#e8a01e', fontWeight: 800, fontSize: px(height, 0.0593), letterSpacing: '-0.02em' }}>DEPARTURES</div>
            <div style={{ color: '#e8a01e88', fontSize: px(height, 0.0222), fontWeight: 600, letterSpacing: '0.08em' }}>{airport.toUpperCase()}</div>
          </div>
          <div style={{ color: '#e8a01e', fontWeight: 700, fontSize: px(height, 0.0593) }}>{nowHM(now, c.timezone)}</div>
        </div>
        {visible.length === 0 ? <NothingTyped color="#9a7619" height={height} /> : (
        <div style={{ flex: 1, marginTop: px(height, 0.0278), background: '#000', border: '1px solid #1a1a1a', borderRadius: px(height, 0.013), padding: px(height, 0.0222), color: '#e8a01e' }}>
          <div style={{ display: 'grid', gridTemplateColumns: gridCols, padding: `${px(height, 0.0111)}px 0`, borderBottom: '1px solid #2a2105', color: '#9a7619', fontWeight: 600, fontSize: px(height, 0.0204), letterSpacing: '0.06em' }}>
            <div style={{ marginRight: px(height, 0.0167) }}>FLIGHT</div>
            <div style={{ marginRight: px(height, 0.0167) }}>TIME</div>
            <div style={{ marginRight: px(height, 0.0167) }}>DESTINATION</div>
            <div style={{ marginRight: px(height, 0.0167) }}>GATE</div>
            <div style={{ marginRight: px(height, 0.0167) }}>STATUS</div>
            <div>REMARKS</div>
          </div>
          {visible.map((row, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: gridCols,
                padding: `${px(height, 0.0167)}px 0`,
                borderBottom: i < rows.length - 1 ? '1px solid #1a1305' : 'none',
                fontSize: px(height, 0.0278),
                fontWeight: 700,
              }}
            >
              <div style={{ marginRight: px(height, 0.0167) }}>{row.flight}</div>
              <div style={{ marginRight: px(height, 0.0167) }}>{row.time}</div>
              <div style={{ marginRight: px(height, 0.0167) }}>{row.dest}</div>
              <div style={{ marginRight: px(height, 0.0167) }}>{row.gate}</div>
              <div style={{ marginRight: px(height, 0.0167), color: statusColor(row.status) }}>{row.status}</div>
              <div style={{ color: '#9a7619', fontSize: px(height, 0.0222) }}>{row.note || ''}</div>
            </div>
          ))}
        </div>
        )}
      </div>
      {demo && <SampleStamp height={height} />}
    </div>
  );
}

/* ════════════════ FLIGHT STATUS HERO ════════════════ */

export interface FlightStatusHeroCfg extends BaseCfg {
  flight?: string;
  from?: string;
  fromCity?: string;
  to?: string;
  toCity?: string;
  depTime?: string;
  arrTime?: string;
  status?: string;
  gate?: string;
  terminal?: string;
  board?: string;
  aircraft?: string;
}

function FlightAirport({ code, city, time, height }: { code: string; city: string; time: string; height: number }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ color: '#9aa3b2', fontWeight: 700, fontSize: px(height, 0.0222), letterSpacing: '0.08em' }}>{city.toUpperCase()}</div>
      <div style={{ fontWeight: 800, fontSize: px(height, 0.2222), lineHeight: 1, letterSpacing: '-0.04em' }}>{code}</div>
      <div style={{ fontWeight: 700, fontSize: px(height, 0.0593), color: '#e8a01e', marginTop: px(height, 0.013) }}>{time}</div>
    </div>
  );
}

function FlightKV({ label, val, height }: { label: string; val: string; height: number }) {
  return (
    <div>
      <div style={{ color: '#9aa3b2', fontWeight: 700, fontSize: px(height, 0.0204), letterSpacing: '0.08em' }}>{label.toUpperCase()}</div>
      <div style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.0463) }}>{val}</div>
    </div>
  );
}

/**
 * The flight every dropped Flight Status zone used to be SEEDED with — and the
 * builder's sample. A zone that still holds exactly this was never touched.
 */
const FLIGHT_SAMPLE = {
  flight: 'UA 504', from: 'SFO', fromCity: 'San Francisco', to: 'JFK', toCity: 'New York',
  depTime: '14:30', arrTime: '22:52', status: 'ON TIME', gate: 'B07', board: '13:50',
  terminal: '2', aircraft: 'Boeing 737-900',
} as const;
type FlightField = keyof typeof FLIGHT_SAMPLE;
const FLIGHT_FIELDS = Object.keys(FLIGHT_SAMPLE) as FlightField[];

function isSeededFlight(c: FlightStatusHeroCfg): boolean {
  return FLIGHT_FIELDS.every((k) => c[k] === FLIGHT_SAMPLE[k]);
}

export function FlightStatusHeroWidget({ config, live = true, height = 480 }: WidgetProps<FlightStatusHeroCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#040608', textColor: '#fff', accentColor: '#e8a01e', ...c.style });
  const realScreen = useRealScreen();
  const seeded = isSeededFlight(c);
  const typed = (k: FlightField): string => (seeded ? '' : text(c[k]));
  const anyTyped = FLIGHT_FIELDS.some((k) => typed(k) !== '');
  // No flight feed exists. A real screen shows the fields someone entered and
  // a dash for the rest; the builder fills each empty field with the sample
  // (the value its Properties field displays) and stamps it SAMPLE.
  const demo = !realScreen && FLIGHT_FIELDS.some((k) => typed(k) === '');
  const v = (k: FlightField): string => typed(k) || (realScreen ? '—' : FLIGHT_SAMPLE[k]);
  // "United Airlines" and "5h 22m · 2,576 mi" describe the SAMPLE flight and
  // nothing else — no field sets them, so they never sit beside a typed one.
  const sampleFlight = !realScreen && typed('flight') === '';
  const sampleLeg = !realScreen && (['from', 'to', 'depTime', 'arrTime'] as FlightField[]).every((k) => typed(k) === '');
  const status = typed('status') || (realScreen ? '' : FLIGHT_SAMPLE.status);

  if (realScreen && !anyTyped) {
    return (
      <div style={frameStyle(r)}>
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column' }}>
          <NothingTyped color="#9aa3b2" height={height} />
        </div>
      </div>
    );
  }

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0741), display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <div style={{ fontWeight: 800, fontSize: px(height, 0.0741), letterSpacing: '-0.02em', marginRight: px(height, 0.0222) }}>{v('flight')}</div>
            {sampleFlight && <div style={{ color: '#9aa3b2', fontWeight: 600, fontSize: px(height, 0.0296) }}>United Airlines</div>}
          </div>
          {status && <div style={{ background: '#22c55e', color: '#0b0c0e', padding: `${px(height, 0.013)}px ${px(height, 0.0222)}px`, borderRadius: px(height, 0.0093), fontWeight: 800, fontSize: px(height, 0.0278), letterSpacing: '0.04em' }}>{status}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <FlightAirport code={v('from')} city={typed('fromCity') || (realScreen ? '' : FLIGHT_SAMPLE.fromCity)} time={v('depTime')} height={height} />
          <div style={{ flex: 1, height: 2, background: 'linear-gradient(to right, #9aa3b2, #9aa3b2 50%, transparent 50%)', backgroundSize: '18px 2px', position: 'relative', marginLeft: px(height, 0.037), marginRight: px(height, 0.037) }}>
            <div style={{ position: 'absolute', top: px(height, -0.0463), left: '45%', fontSize: px(height, 0.0741), transform: 'rotate(90deg)' }}>{'✈'}</div>
            {sampleLeg && <div style={{ position: 'absolute', bottom: px(height, -0.0407), left: '40%', color: '#9aa3b2', fontSize: px(height, 0.0222), fontWeight: 600 }}>5h 22m · 2,576 mi</div>}
          </div>
          <FlightAirport code={v('to')} city={typed('toCity') || (realScreen ? '' : FLIGHT_SAMPLE.toCity)} time={v('arrTime')} height={height} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)' }}>
          <div style={{ marginRight: px(height, 0.0278) }}><FlightKV label="Gate" val={v('gate')} height={height} /></div>
          <div style={{ marginRight: px(height, 0.0278) }}><FlightKV label="Boarding" val={v('board')} height={height} /></div>
          <div style={{ marginRight: px(height, 0.0278) }}><FlightKV label="Terminal" val={v('terminal')} height={height} /></div>
          <div><FlightKV label="Aircraft" val={v('aircraft')} height={height} /></div>
        </div>
      </div>
      {demo && <SampleStamp height={height} />}
    </div>
  );
}

/* ════════════════ TRANSIT DEPARTURES ════════════════ */

export interface TransitLine {
  line: string;
  color: string;
  toward: string;
  platform?: string;
  minutes: number[];
}
export interface TransitDeparturesCfg extends BaseCfg {
  station?: string;
  agency?: string;
  lines?: TransitLine[];
  refreshSec?: number;
  /** IANA zone for the board clock. Unset = the device clock. */
  timezone?: string;
}

const TRANSIT_LINES: TransitLine[] = [
  { line: 'N', color: '#0099d4', toward: 'Caltrain via Embarcadero', platform: 'Outbound · Pl. 2', minutes: [2, 11, 22] },
  { line: 'L', color: '#925ba8', toward: 'SF Zoo', platform: 'Outbound · Pl. 2', minutes: [5, 18, 31] },
  { line: 'K', color: '#508a0c', toward: 'Balboa Park', platform: 'Outbound · Pl. 2', minutes: [7, 19, 33] },
  { line: 'J', color: '#dc6a1d', toward: 'Balboa Park via Church', platform: 'Outbound · Pl. 2', minutes: [9, 24, 39] },
  { line: 'BART', color: '#0096dd', toward: 'Pittsburg / Bay Point', platform: 'Eastbound · concourse', minutes: [4, 12, 24] },
  { line: 'M', color: '#008248', toward: 'San Francisco State', platform: 'Outbound · Pl. 2', minutes: [12, 28, 42] },
];

/** Lines held in the template — never the sample. */
function transitRows(value: unknown): TransitLine[] {
  return typedRows<Record<string, unknown>>(value, (l) => text(l.line) !== '' || text(l.toward) !== '')
    .map((l) => ({
      line: text(l.line),
      color: text(l.color) || '#475569',
      toward: text(l.toward),
      platform: text(l.platform),
      minutes: (Array.isArray(l.minutes) ? l.minutes : []).map(num).filter((m): m is number => m !== undefined),
    }));
}

export function TransitDeparturesWidget({ config, live = true, height = 480 }: WidgetProps<TransitDeparturesCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#fff', textColor: '#0b0c0e', accentColor: '#dc2626', ...c.style });
  const realScreen = useRealScreen();
  const typed = transitRows(c.lines);
  const lines: TransitLine[] = typed.length ? typed : realScreen ? [] : TRANSIT_LINES;
  const visible = lines.slice(0, 6);
  const typedStation = ownLabel(c.station, LIVE_DATA_SEEDED_LABELS.transitStation);
  const station = typedStation ?? (realScreen ? '' : LIVE_DATA_SEEDED_LABELS.transitStation);
  const demo = !realScreen && (typed.length === 0 || typedStation === undefined);
  const now = useNowTick(30_000, live);

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0556), display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#74767d', fontWeight: 700, fontSize: px(height, 0.0241), letterSpacing: '0.08em' }}>{station ? `NEXT TRAINS · ${station.toUpperCase()}` : 'NEXT TRAINS'}</div>
            <div style={{ color: '#0b0c0e', fontWeight: 800, fontSize: px(height, 0.0815), letterSpacing: '-0.02em' }}>Departures</div>
          </div>
          <div style={{ color: '#0b0c0e', fontWeight: 700, fontSize: px(height, 0.0444) }}>{nowHM(now, c.timezone)}</div>
        </div>
        {visible.length === 0 ? <NothingTyped color="#74767d" height={height} /> : (
        <div style={{ flex: 1, marginTop: px(height, 0.0278), display: 'flex', flexDirection: 'column' }}>
          {visible.map((l, i) => (
            <div
              key={i}
              style={{
                background: '#fafaf7',
                border: '1px solid #e7e6e1',
                borderRadius: px(height, 0.013),
                padding: `${px(height, 0.0204)}px ${px(height, 0.0259)}px`,
                display: 'grid',
                gridTemplateColumns: '130px 1fr auto',
                alignItems: 'center',
                marginBottom: i === visible.length - 1 ? 0 : px(height, 0.013),
              }}
            >
              <div style={{ background: l.color, color: '#fff', borderRadius: px(height, 0.013), padding: `${px(height, 0.0111)}px 0`, textAlign: 'center', fontWeight: 800, fontSize: px(height, 0.0444), letterSpacing: '0.02em', marginRight: px(height, 0.0222) }}>{l.line}</div>
              <div style={{ marginRight: px(height, 0.0222) }}>
                <div style={{ color: '#0b0c0e', fontWeight: 700, fontSize: px(height, 0.0315) }}>{l.toward}</div>
                <div style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.0204) }}>{l.platform || ''}</div>
              </div>
              <div style={{ display: 'flex' }}>
                {l.minutes.slice(0, 3).map((m, j) => (
                  <div key={j} style={{ minWidth: px(height, 0.0815), textAlign: 'center', marginRight: j === 2 ? 0 : px(height, 0.0222) }}>
                    <div style={{ fontWeight: 800, fontSize: px(height, 0.0519), color: m <= 2 ? '#dc2626' : '#0b0c0e', lineHeight: 1 }}>{m}</div>
                    <div style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.0167) }}>{m <= 0 ? 'now' : 'min'}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        )}
      </div>
      {demo && <SampleStamp height={height} />}
    </div>
  );
}

/* ════════════════ PARKING AVAILABILITY ════════════════ */

export interface ParkingLot {
  name: string;
  note: string;
  total: number;
  avail: number;
  rate: string;
}
export interface ParkingAvailabilityCfg extends BaseCfg {
  facility?: string;
  lots?: ParkingLot[];
  refreshSec?: number;
  /** When these counts were actually last set — ISO string, epoch ms or a
   *  Date. The ONLY thing that earns an "Updated …" line; see below. */
  updatedAt?: string | number | Date;
  /** Legacy alias accepted by importers/seeds. */
  lastUpdated?: string | number | Date;
}

const PARKING_LOTS: ParkingLot[] = [
  { name: 'Hourly Garage', note: 'Floors 1-4', total: 850, avail: 282, rate: '$3/hr · $36/day' },
  { name: 'Daily Lot A', note: 'Long-term', total: 1200, avail: 47, rate: '$22/day · $115/wk' },
  { name: 'Daily Lot B', note: 'Long-term', total: 1500, avail: 612, rate: '$22/day · $115/wk' },
  { name: 'Valet · Curb', note: 'Domestic terminal', total: 80, avail: 8, rate: '$48/day' },
];

/**
 * W02 (2026-09-12) — the header read the STRING CONSTANT "Updated 30s ago".
 * It said that on the first frame after boot and it said it a week later,
 * beside space counts a human had typed once. A driver circling a full
 * garage was being told the "47 open" beside them was half a minute old.
 *
 * The line now appears only when the config carries a real recorded time,
 * and it is relative to a clock that keeps moving — so a stale board reads
 * "Updated 3h ago" and an unstamped one says nothing at all.
 */
/** Lots held in the template — never the sample. A lot needs a capacity. */
function parkingRows(value: unknown): ParkingLot[] {
  return typedRows<Record<string, unknown>>(value, (l) => text(l.name) !== '' && (num(l.total) ?? 0) > 0 && num(l.avail) !== undefined)
    .map((l) => ({ name: text(l.name), note: text(l.note), total: num(l.total) as number, avail: Math.max(0, num(l.avail) as number), rate: text(l.rate) }));
}

export function ParkingAvailabilityWidget({ config, live = true, height = 480 }: WidgetProps<ParkingAvailabilityCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#11161e', textColor: '#fff', accentColor: '#22c55e', ...c.style });
  const realScreen = useRealScreen();
  const typed = parkingRows(c.lots);
  const lots: ParkingLot[] = typed.length ? typed : realScreen ? [] : PARKING_LOTS;
  const visible = lots.slice(0, 4);
  const typedFacility = ownLabel(c.facility, LIVE_DATA_SEEDED_LABELS.parkingFacility);
  const facility = typedFacility ?? (realScreen ? '' : LIVE_DATA_SEEDED_LABELS.parkingFacility);
  const demo = !realScreen && (typed.length === 0 || typedFacility === undefined);
  const now = useNowTick(30_000, live);
  const freshness = configFreshness(c, now);

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0556), display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#74767d', fontSize: px(height, 0.0241), fontWeight: 700, letterSpacing: '0.06em' }}>{facility ? `PARKING · ${facility.toUpperCase()}` : 'PARKING'}</div>
            <div style={{ fontWeight: 800, fontSize: px(height, 0.0815), letterSpacing: '-0.02em' }}>Available spaces</div>
          </div>
          <div style={{ color: '#74767d', fontSize: px(height, 0.0222), fontWeight: 600 }}>{freshness && typed.length ? `Updated ${freshness}` : ''}</div>
        </div>
        {visible.length === 0 ? <NothingTyped color="#74767d" height={height} /> : (
        <div style={{ flex: 1, marginTop: px(height, 0.0278), display: 'grid', gridTemplateColumns: 'repeat(2,1fr)' }}>
          {visible.map((l, i) => {
            const pct = l.avail / l.total;
            const tone = pct > 0.3 ? '#22c55e' : pct > 0.1 ? '#f59e0b' : '#dc2626';
            const col = i % 2;
            return (
              <div
                key={i}
                style={{
                  background: '#11161e',
                  border: '1px solid #1c2230',
                  borderRadius: px(height, 0.0167),
                  padding: `${px(height, 0.0278)}px ${px(height, 0.0333)}px`,
                  position: 'relative',
                  overflow: 'hidden',
                  marginRight: col === 1 ? 0 : px(height, 0.0167),
                  marginBottom: i < 2 ? px(height, 0.0167) : 0,
                }}
              >
                <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: `linear-gradient(180deg, ${tone}15 0%, transparent 80%)` }} />
                <div style={{ position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: px(height, 0.0333) }}>{l.name}</div>
                    <div style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.0204) }}>{l.note}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', marginTop: px(height, 0.0148) }}>
                    <div style={{ color: tone, fontWeight: 800, fontSize: px(height, 0.1481), letterSpacing: '-0.04em', lineHeight: 1, marginRight: px(height, 0.013) }}>{l.avail}</div>
                    <div style={{ color: '#74767d', fontWeight: 700, fontSize: px(height, 0.0315) }}>/ {l.total} open</div>
                  </div>
                  <div style={{ marginTop: px(height, 0.013), height: px(height, 0.013), background: '#1c2230', borderRadius: px(height, 0.0065), overflow: 'hidden' }}>
                    <div style={{ width: `${(l.avail / l.total) * 100}%`, height: '100%', background: tone }} />
                  </div>
                  <div style={{ marginTop: px(height, 0.013), color: '#9aa3b2', fontSize: px(height, 0.0204), fontWeight: 600 }}>{l.rate}</div>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>
      {demo && <SampleStamp height={height} />}
    </div>
  );
}
