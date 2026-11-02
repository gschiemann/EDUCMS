/**
 * Minimal, dependency-free readers for the three formats a GTFS departures
 * board needs: a ZIP archive (static GTFS), CSV (stops.txt / routes.txt) and
 * the GTFS-realtime protobuf (FeedMessage → TripUpdate). Each reads only what
 * the board shows and refuses anything outside fixed size bounds.
 */
import { inflateRawSync } from 'zlib';

// ── ZIP (central directory; stored or deflate) ────────────────────────────

const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

/** Extract the named entries (case-insensitive basename match) from a ZIP. */
export function readZipEntries(
  zip: Buffer,
  wanted: string[],
): Record<string, Buffer> {
  const want = new Set(wanted.map((w) => w.toLowerCase()));
  // End of central directory: signature 0x06054b50 within the last 64 KiB + 22.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip archive');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out: Record<string, Buffer> = {};
  for (let n = 0; n < count && p + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50)
      throw new Error('Corrupt zip directory');
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    const base = name.split('/').pop()!.toLowerCase();
    if (!want.has(base) || out[base]) continue;
    if (size > MAX_ENTRY_BYTES) throw new Error('Zip entry too large');
    if (zip.readUInt32LE(localOffset) !== 0x04034b50)
      throw new Error('Corrupt zip entry');
    const start =
      localOffset +
      30 +
      zip.readUInt16LE(localOffset + 26) +
      zip.readUInt16LE(localOffset + 28);
    const raw = zip.subarray(start, start + compSize);
    if (method === 0) out[base] = Buffer.from(raw);
    else if (method === 8)
      out[base] = inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
    else throw new Error('Unsupported zip compression');
  }
  return out;
}

// ── CSV (RFC 4180, header row) ────────────────────────────────────────────

export function parseCsv(
  text: string,
  maxRows = 200000,
): Record<string, string>[] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      if (rows.length > maxRows) break;
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const head = (rows.shift() || []).map((h) => h.trim());
  return rows.map((r) =>
    Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])),
  );
}

// ── GTFS-realtime protobuf (TripUpdates only) ─────────────────────────────

class Reader {
  pos = 0;
  constructor(
    readonly buf: Buffer,
    readonly end = buf.length,
  ) {}
  varint(): number {
    let result = 0;
    let shift = 0;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new Error('Truncated varint');
      const b = this.buf[this.pos++];
      // Above 2^53 precision is lost; GTFS-RT times and ids fit comfortably.
      result += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) return result;
      shift += 7;
    }
    throw new Error('Bad varint');
  }
  /** int32 field: negative values are 10-byte varints; keep the low 32 bits. */
  int32(): number {
    let low = 0;
    for (let i = 0, shift = 0; i < 10; i++, shift += 7) {
      if (this.pos >= this.end) throw new Error('Truncated varint');
      const b = this.buf[this.pos++];
      if (shift < 32) low |= (b & 0x7f) << shift;
      if (b < 0x80) return low | 0;
    }
    throw new Error('Bad varint');
  }
  sub(): Reader {
    const len = this.varint();
    if (this.pos + len > this.end) throw new Error('Truncated message');
    const r = new Reader(this.buf, this.pos + len);
    r.pos = this.pos;
    this.pos += len;
    return r;
  }
  str(): string {
    const r = this.sub();
    return this.buf.toString('utf8', r.pos, r.end);
  }
  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) {
      // Read the length FIRST: `this.pos += this.varint()` would add to the
      // pre-read position and lose the length bytes.
      const len = this.varint();
      this.pos += len;
    } else if (wire === 5) this.pos += 4;
    else throw new Error('Unsupported wire type');
    if (this.pos > this.end) throw new Error('Truncated field');
  }
  *fields(): Generator<[number, number]> {
    while (this.pos < this.end) {
      const key = this.varint();
      yield [Math.floor(key / 8), key & 7];
    }
  }
}

export interface StopTimeUpdate {
  stopId: string;
  /** Unix seconds; departure preferred, else arrival. 0 when unknown. */
  time: number;
  delay: number | null;
  skipped: boolean;
}
export interface TripUpdate {
  tripId: string;
  routeId: string;
  directionId: number | null;
  canceled: boolean;
  stops: StopTimeUpdate[];
}

function stopTimeEvent(r: Reader): { delay: number | null; time: number } {
  let delay: number | null = null;
  let time = 0;
  for (const [f, w] of r.fields()) {
    if (f === 1 && w === 0) delay = r.int32();
    else if (f === 2 && w === 0) time = r.varint();
    else r.skip(w);
  }
  return { delay, time };
}

export function parseTripUpdates(buf: Buffer): {
  timestamp: number;
  trips: TripUpdate[];
} {
  const r = new Reader(buf);
  let timestamp = 0;
  const trips: TripUpdate[] = [];
  for (const [f, w] of r.fields()) {
    if (f === 1 && w === 2) {
      const h = r.sub();
      for (const [hf, hw] of h.fields())
        if (hf === 3 && hw === 0) timestamp = h.varint();
        else h.skip(hw);
    } else if (f === 2 && w === 2) {
      const e = r.sub();
      for (const [ef, ew] of e.fields()) {
        if (ef !== 3 || ew !== 2) {
          e.skip(ew);
          continue;
        }
        const t = e.sub();
        const trip: TripUpdate = {
          tripId: '',
          routeId: '',
          directionId: null,
          canceled: false,
          stops: [],
        };
        for (const [tf, tw] of t.fields()) {
          if (tf === 1 && tw === 2) {
            const d = t.sub();
            for (const [df, dw] of d.fields()) {
              if (df === 1 && dw === 2) trip.tripId = d.str();
              else if (df === 5 && dw === 2) trip.routeId = d.str();
              else if (df === 6 && dw === 0) trip.directionId = d.varint();
              else if (df === 4 && dw === 0)
                trip.canceled = d.varint() === 3; // CANCELED
              else d.skip(dw);
            }
          } else if (tf === 2 && tw === 2) {
            const s = t.sub();
            const u: StopTimeUpdate = {
              stopId: '',
              time: 0,
              delay: null,
              skipped: false,
            };
            let arr: { delay: number | null; time: number } | null = null;
            let dep: { delay: number | null; time: number } | null = null;
            for (const [sf, sw] of s.fields()) {
              if (sf === 4 && sw === 2) u.stopId = s.str();
              else if (sf === 2 && sw === 2) arr = stopTimeEvent(s.sub());
              else if (sf === 3 && sw === 2) dep = stopTimeEvent(s.sub());
              else if (sf === 5 && sw === 0)
                u.skipped = s.varint() === 1; // SKIPPED
              else s.skip(sw);
            }
            const ev = dep && dep.time ? dep : arr;
            u.time = ev?.time || 0;
            u.delay = ev?.delay ?? dep?.delay ?? arr?.delay ?? null;
            if (u.stopId) trip.stops.push(u);
          } else t.skip(tw);
        }
        trips.push(trip);
        if (trips.length > 20000) throw new Error('Too many trips');
      }
    } else r.skip(w);
  }
  return { timestamp, trips };
}
