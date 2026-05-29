/**
 * @cms/scoreboard-cts/daktronics/mock — synthetic All Sport 5000 RTD
 * feed for dev + tests.
 *
 * The encoder is the exact inverse of the parser: it builds a properly
 * framed, checksum-valid RTD "positioned text" packet that writes a
 * given ASCII payload at a given 1-based item offset. Tests synthesize
 * packets straight from the documented offset table (offsets.ts) and
 * assert the parser decodes them back — so a wrong offset OR a framing
 * bug fails the test, not silently passes.
 *
 * Also provides a higher-level `encodeField()` that takes a sport +
 * field name and right/left-justifies the value into the field width
 * automatically (the All Sport pads numeric fields with leading spaces
 * to the fixed width), and a `MockDaktronicsFeed` that pushes encoded
 * packets through any consumer (parser.feed, a sink, the bridge).
 */

import { RTD, RTD_FIELD_PREFIX } from './types';
import {
  DAKTRONICS_OFFSETS,
  type FieldDef,
  type Justify,
} from './offsets';
import type { DaktronicsSport } from './types';

/** The 8-byte HEADER the All Sport prefixes. Value beyond the prefix is
 *  not interpreted by the parser; we use a representative constant. */
const HEADER = '00210000';

/** ASCII string → number[] of char codes. */
function ascii(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
  return out;
}

/**
 * Encode ONE positioned-text RTD packet: writes `text` at 1-based item
 * position `item`. Returns the full frame bytes including SYN…ETB and a
 * valid 2-hex-digit modulo-256 checksum.
 *
 * Frame: SYN HEADER SOH CONTROL STX TEXT EOT SUM ETB
 * where CONTROL = "00421" + 5-digit zero-padded item.
 */
export function encodeRtdPacket(item: number, text: string): Uint8Array {
  const control = RTD_FIELD_PREFIX + String(item).padStart(5, '0');
  // Bytes the checksum is computed over: everything after SYN up to and
  // including EOT.
  const body: number[] = [
    ...ascii(HEADER),
    RTD.SOH,
    ...ascii(control),
    RTD.STX,
    ...ascii(text),
    RTD.EOT,
  ];
  let sum = 0;
  for (const b of body) sum = (sum + b) & 0xff;
  const sumHex = sum.toString(16).toUpperCase().padStart(2, '0');
  return new Uint8Array([RTD.SYN, ...body, ...ascii(sumHex), RTD.ETB]);
}

/**
 * Pad/justify a value into a fixed field width the way the All Sport
 * does: right-justified numeric fields get LEADING spaces; left-
 * justified text fields get TRAILING spaces. Truncates if too long.
 */
export function justifyField(value: string, length: number, justify: Justify): string {
  let v = value;
  if (v.length > length) v = v.slice(0, length);
  if (justify === 'R') return v.padStart(length, ' ');
  if (justify === 'L') return v.padEnd(length, ' ');
  return v.padEnd(length, ' '); // 'N' — pad to width, no semantic trim
}

/**
 * Encode a packet for a named field of a sport, auto-justifying `value`
 * into the field's documented width and writing at its documented
 * offset. This is what tests use so they never hand-compute offsets.
 *
 * @param sport which offset table
 * @param field a key of that sport's field map (e.g. 'homeScore', 'down')
 * @param value the raw value (number or string)
 */
export function encodeField(
  sport: DaktronicsSport,
  field: string,
  value: string | number,
): Uint8Array {
  const map = DAKTRONICS_OFFSETS[sport] as unknown as Record<string, FieldDef>;
  const def = map[field];
  if (!def) {
    throw new Error(`encodeField: unknown field "${field}" for sport "${sport}"`);
  }
  const text = justifyField(String(value), def.length, def.justify);
  return encodeRtdPacket(def.offset, text);
}

/**
 * MockDaktronicsFeed — push synthetic RTD packets through any consumer.
 * Mirror of MockCtsFeed: the consumer is just `consumer(bytes)` so
 * callers can pass `parser.feed`, a test sink, or the bridge's bytes
 * path.
 */
export class MockDaktronicsFeed {
  constructor(private readonly consumer: (bytes: Uint8Array) => void) {}

  /** Send raw bytes through the consumer. */
  pushBytes(bytes: Uint8Array): void {
    this.consumer(bytes);
  }

  /** Encode + send one positioned-text packet by raw item offset. */
  pushPacket(item: number, text: string): void {
    this.consumer(encodeRtdPacket(item, text));
  }

  /** Encode + send one named field (auto-justified) for a sport. */
  pushField(sport: DaktronicsSport, field: string, value: string | number): void {
    this.consumer(encodeField(sport, field, value));
  }

  /**
   * Compose a full-state burst for a sport: writes the common
   * scoreboard fields (clock, period, scores, timeouts) plus any extra
   * (field → value) pairs the caller passes. Each is its own packet —
   * exactly how the console transmits (one positioned write per item).
   */
  pushInitialState(
    sport: DaktronicsSport,
    opts: {
      clock?: string;
      period?: number;
      homeScore?: number;
      awayScore?: number;
      homeTimeouts?: number;
      awayTimeouts?: number;
      extra?: Record<string, string | number>;
    } = {},
  ): void {
    const {
      clock = '12:00',
      period = 1,
      homeScore = 0,
      awayScore = 0,
      homeTimeouts = 3,
      awayTimeouts = 3,
      extra = {},
    } = opts;
    this.pushField(sport, 'mainClock', clock);
    this.pushField(sport, 'period', period);
    this.pushField(sport, 'homeScore', homeScore);
    this.pushField(sport, 'guestScore', awayScore);
    this.pushField(sport, 'homeTimeoutsTotal', homeTimeouts);
    this.pushField(sport, 'guestTimeoutsTotal', awayTimeouts);
    for (const [k, v] of Object.entries(extra)) {
      this.pushField(sport, k, v);
    }
  }
}
