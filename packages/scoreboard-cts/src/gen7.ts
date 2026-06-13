/**
 * CTS Gen7 / WA-2 (RS-485) decoder — the protocol the customer's WTTC-1
 * Wireless Tabletop Controller emits on its SCBD ports.
 *
 * 2026-06-11 first-customer hardening. Built from the MIT-licensed
 * reference implementation (https://github.com/fabriziobertocci/
 * coloradoScoreboard, src/ctsScoreboardasync.js) — the only known open
 * decoder of this stream. UNVALIDATED against real WTTC bytes until the
 * venue bring-up capture (profile stays `provisional`; the CtsBridge
 * capture mode produces the file that promotes it).
 *
 * Wire format (RS-485 differential, 115200 baud, 8 data bits, NO parity,
 * 1 stop — vs legacy's 9600/8/EVEN/1):
 *
 *  1. SCRAMBLER. Every byte except address bytes is XORed with a
 *     keystream. An address byte (bit7 set) reseeds the stream:
 *     mapper = MAPPINGS[b & 31], isOdd = b % 2. The next byte XORs with
 *     (mapper & 0x7F) and its plain value becomes mapLength; each later
 *     byte XORs with rot(mapper, mapLength·n) & 0x7F where rot is a
 *     32-bit rotate left (even address) or right (odd address).
 *  2. PACKETS (over descrambled bytes): start byte (bit7) → length →
 *     payload[length] → checksum = (start + length + Σpayload) & 0x7F.
 *  3. ENHANCED STREAM (packet payloads): module header byte (bit7;
 *     module = b & 31; 0x40 = "universal" flag, 0x20 = HORN) followed by
 *     digit pairs: [position byte: digit = b & 31, 0x40 = decimal point,
 *     0x20 = segment-mapped] then [value byte: 7-bit char, 0 → blank].
 *     Module 31 is a command channel (start lists / meet titles — not
 *     needed for water polo; consumed and ignored). A nested sub-packet
 *     (header 159 then 17|19 then pool#) carries a SECOND scrambled
 *     payload with its own checksum for multi-pool consoles; pool 0 is
 *     extracted, others ignored.
 *
 * The decoded display image lands in the same ChannelGrid the classic
 * decoder produces (Gen7 "module" numbers == classic channel numbers for
 * scoreboard data), so ONE water-polo extractor serves both transports.
 */

import {
  ChannelGrid,
  createGrid,
  emptySnapshot,
  extractWaterPolo,
  gridLine,
  resolveWaterPoloMap,
  WaterPoloChannelMap,
} from './grid';
import type { CtsFullSnapshot, CtsUpdateListener } from './types';

export const GEN7_SERIAL = {
  baudRate: 115200,
  dataBits: 8 as const,
  stopBits: 1 as const,
  parity: 'none' as const,
};

/** Handshake the reference writes on open — asks the console to stream. */
export const GEN7_INIT_SEQUENCE = Uint8Array.from([0x80, 0x1f, 15, 2]);

// ── Scrambler ────────────────────────────────────────────────────────

const MAPPING_HEX =
  'F37C65B454BD061AC3E2161EEBB26E8EEC95883E5CAB118EF3D7D3ACC6DA3754' +
  '178C9A44414B16BC351AE48C30EA2D3839F009BCBC7F3AE4DECACED82AA0D794' +
  '7A02E6B088BA6B4EA63D2E4463E1780A574169B4D0258F42023E04D0D0D19CF6' +
  'FB0805F6E18DC550B61F577EC4FAEF9C9395C310EF23508067C46C28843F4A36';

function buildMappings(): Uint32Array {
  const m = new Uint32Array(32);
  for (let i = 0; i < 16; i++) {
    m[i * 2 + 1] = parseInt(MAPPING_HEX.substring(i * 8, i * 8 + 8), 16) >>> 0;
  }
  for (let i = 0; i < 16; i++) {
    m[i * 2] = parseInt(MAPPING_HEX.substring(128 + i * 8, 128 + i * 8 + 8), 16) >>> 0;
  }
  return m;
}

export const GEN7_MAPPINGS = buildMappings();

const rotL = (x: number, n: number) => (((x << (n & 31)) | (x >>> (32 - (n & 31)))) >>> 0);
const rotR = (x: number, n: number) => (((x >>> (n & 31)) | (x << (32 - (n & 31)))) >>> 0);

export interface ScramblerState {
  mappingCount: number;
  mapper: number;
  isOdd: boolean;
  mapLength: number;
}

export function freshScramblerState(): ScramblerState {
  return { mappingCount: 0, mapper: 0, isOdd: false, mapLength: 0 };
}

/** Descramble ONE byte, advancing `state`. Address bytes pass through. */
export function remapByte(src: number, state: ScramblerState): number {
  if (src > 127) {
    state.mappingCount = 0;
    state.mapper = GEN7_MAPPINGS[src & 31];
    state.isOdd = src % 2 === 1;
    return src;
  }
  if (state.mappingCount === 0) {
    state.mapLength = (src ^ (state.mapper & 0x7f)) >>> 0;
    state.mappingCount++;
    return state.mapLength & 0xff;
  }
  const key = state.isOdd
    ? rotR(state.mapper, (state.mapLength * state.mappingCount) >>> 0) & 0x7f
    : rotL(state.mapper, (state.mapLength * state.mappingCount) >>> 0) & 0x7f;
  state.mappingCount++;
  return (src ^ key) & 0xff;
}

/** SCRAMBLE one byte — exact inverse of remapByte (XOR keystream is
 *  symmetric). Used by the emulator/tests to synthesize Gen7 streams. */
export function scrambleByte(plain: number, state: ScramblerState): number {
  if (plain > 127) {
    state.mappingCount = 0;
    state.mapper = GEN7_MAPPINGS[plain & 31];
    state.isOdd = plain % 2 === 1;
    return plain;
  }
  if (state.mappingCount === 0) {
    // On the wire the first scrambled byte is plain ^ (mapper & 0x7F);
    // the DEscrambler's recovered value (= plain) becomes mapLength, so
    // the scrambler must derive the keystream from the PLAIN value.
    state.mapLength = plain >>> 0;
    state.mappingCount++;
    return (plain ^ (state.mapper & 0x7f)) & 0xff;
  }
  const key = state.isOdd
    ? rotR(state.mapper, (state.mapLength * state.mappingCount) >>> 0) & 0x7f
    : rotL(state.mapper, (state.mapLength * state.mappingCount) >>> 0) & 0x7f;
  state.mappingCount++;
  return (plain ^ key) & 0xff;
}

// ── Parser ───────────────────────────────────────────────────────────

export interface Gen7ParserOptions {
  /** Venue override merged over the F872 defaults. */
  waterPoloMap?: Partial<WaterPoloChannelMap> | null;
  /** Diagnostics hook (checksum failures etc.). */
  onWarning?: (msg: string) => void;
}

export class Gen7Parser {
  readonly grid: ChannelGrid = createGrid();

  private readonly map: WaterPoloChannelMap;
  private readonly listeners = new Set<CtsUpdateListener>();
  private snapshot: CtsFullSnapshot = emptySnapshot();

  // Descrambler state (instance stream).
  private scram = freshScramblerState();

  // Packet framing state.
  private inPacket = false;
  private waitingOnLength = false;
  private expectedDataCount = 0;
  private dataCount = 0;
  private checksum = 0;
  private buf = new Uint8Array(256);
  private bufLen = 0;

  // Enhanced-stream state.
  private currentModule = 0;
  private currentDigit = 0;
  private dataByte1 = true;
  private inCommand = false;
  private inModuleCommand = false;
  private hornSeen = false;
  private mutated = false;

  /** Packet counters — exposed for the bring-up capture diagnostics. */
  packetsAccepted = 0;
  packetsRejected = 0;

  constructor(private readonly opts: Gen7ParserOptions = {}) {
    this.map = resolveWaterPoloMap(opts.waterPoloMap);
  }

  subscribe(fn: CtsUpdateListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getSnapshot(): CtsFullSnapshot {
    return this.snapshot;
  }

  feed(bytes: Uint8Array | number[], receivedAt: number = Date.now()): void {
    for (let i = 0; i < bytes.length; i++) this.feedByte((bytes as any)[i] & 0xff);
    if (this.mutated) {
      this.mutated = false;
      this.snapshot = extractWaterPolo(this.grid, this.map, this.snapshot, this.hornSeen, receivedAt);
      this.hornSeen = false;
      for (const fn of this.listeners) fn(this.snapshot);
    }
  }

  private feedByte(src: number): void {
    const b = remapByte(src, this.scram);

    if (this.inPacket) {
      if ((b & 0x80) !== 0) {
        // Unexpected new start mid-packet — resync on it.
        this.bufLen = 0;
        this.buf[this.bufLen++] = b;
        this.checksum = b;
        this.inPacket = false;
        this.waitingOnLength = true;
        return;
      }
      this.dataCount++;
      if (this.dataCount > this.expectedDataCount) {
        // This byte is the checksum.
        if ((this.checksum & 0x7f) === b) {
          this.packetsAccepted++;
          this.consumePayload();
        } else {
          this.packetsRejected++;
          this.opts.onWarning?.(
            `gen7 checksum mismatch (calc ${(this.checksum & 0x7f).toString(16)} != ${b.toString(16)})`,
          );
        }
        this.bufLen = 0;
        this.inPacket = false;
        this.waitingOnLength = false;
        return;
      }
      if (this.bufLen < this.buf.length) this.buf[this.bufLen++] = b;
      this.checksum = (this.checksum + b) & 0xff;
      return;
    }

    if (this.waitingOnLength) {
      this.waitingOnLength = false;
      this.inPacket = true;
      this.expectedDataCount = b;
      this.checksum = (this.checksum + b) & 0xff;
      this.dataCount = 0;
      return;
    }

    if ((b & 0x80) !== 0) {
      this.bufLen = 0;
      this.buf[this.bufLen++] = b;
      this.checksum = b & 0xff;
      this.waitingOnLength = true;
    }
    // Bytes outside a packet are line noise — dropped.
  }

  /** Payload = buf[0..bufLen): [start, data...]. Handles the nested
   *  multi-pool sub-packet, then feeds enhanced bytes. */
  private consumePayload(): void {
    let start = 0;
    if (
      this.bufLen >= 4 &&
      this.buf[0] === 159 &&
      (this.buf[1] === 17 || this.buf[1] === 19)
    ) {
      const pool = (this.buf[2] - 1) & 0xff;
      const state = freshScramblerState();
      const inner: number[] = [];
      const first = remapByte((this.buf[3] | 0x80) & 0xff, state);
      inner.push(first);
      let sum = first;
      for (let i = 1; i < this.bufLen - 4; i++) {
        const v = remapByte(this.buf[3 + i], state);
        if (i !== 1) inner.push(v);
        sum = (sum + v) & 0xff;
      }
      const innerChecksum = remapByte(this.buf[this.bufLen - 1], state);
      if ((sum & 0x7f) === innerChecksum) {
        if (pool === 0) for (const v of inner) this.parseEnhancedByte(v);
      } else {
        this.packetsRejected++;
        this.opts.onWarning?.('gen7 nested sub-packet checksum mismatch');
      }
      return;
    }
    for (let i = start; i < this.bufLen; i++) this.parseEnhancedByte(this.buf[i]);
  }

  private parseEnhancedByte(inc: number): void {
    if ((inc & 0x80) === 0x80) {
      // Module header.
      this.currentModule = inc & 31;
      if (this.currentModule === 31) {
        this.inModuleCommand = true; // command channel — consumed, unused
      } else {
        // Per-module header flags (reference ctsScoreboardasync.js ~511):
        // 0x40 = "universal" (this module mirrors module 0's shared digits;
        // readers fall back to module 0 — see grid.ts gridText), 0x20 = HORN.
        const line = gridLine(this.grid, this.currentModule, 31);
        line.univ = (inc & 0x40) === 0x40;
        if ((inc & 0x20) === 0x20) this.hornSeen = true;
        this.dataByte1 = true;
        this.inCommand = false;
        this.inModuleCommand = false;
      }
      return;
    }
    if (this.inModuleCommand) return; // swallow command payload bytes
    if (this.inCommand) return;
    if (this.dataByte1) {
      this.currentDigit = inc & 31;
      if (this.currentDigit === 31) {
        this.inCommand = true;
        return;
      }
      if (this.currentDigit < 31) {
        const line = gridLine(this.grid, this.currentModule, 31);
        line.decPoints[this.currentDigit] = (inc & 0x40) === 0x40;
      }
      this.dataByte1 = false;
      return;
    }
    // Value byte.
    const line = gridLine(this.grid, this.currentModule, 31);
    const v = inc === 0 ? 32 : inc & 0x7f;
    const ch = v === 15 || v === 32 ? ' ' : String.fromCharCode(v);
    if (line.chars[this.currentDigit] !== ch) {
      line.chars[this.currentDigit] = ch;
      this.mutated = true;
    }
    this.dataByte1 = true;
  }
}

// ── Emulator-side encoder (tests + practice mode) ────────────────────

/**
 * Build one scrambled Gen7 packet carrying `module` digit writes.
 *
 * Wire reality (matches the reference decoder's consumption): the packet
 * START byte doubles as the module header — `0x80 | module | flags`
 * (0x40 = universal, 0x20 = horn). Payload bytes are digit pairs only
 * (all < 0x80); a different module means a new packet. The start byte
 * also reseeds the scrambler on both sides (it passes through >127).
 */
export function encodeGen7ModulePacket(
  module: number,
  digits: Array<{ pos: number; char: string; decPoint?: boolean }>,
  flags: { horn?: boolean; universal?: boolean } = {},
): Uint8Array {
  const payload: number[] = [];
  for (const d of digits) {
    payload.push((d.pos & 31) | (d.decPoint ? 0x40 : 0));
    const code = d.char === ' ' ? 0 : d.char.charCodeAt(0) & 0x7f;
    payload.push(code);
  }
  const start = 0x80 | (module & 31) | (flags.universal ? 0x40 : 0) | (flags.horn ? 0x20 : 0);
  const length = payload.length;
  let checksum = (start + length) & 0xff;
  for (const p of payload) checksum = (checksum + p) & 0xff;
  const plainFrame = [start, length, ...payload, checksum & 0x7f];
  const state = freshScramblerState();
  return Uint8Array.from(plainFrame.map((p) => scrambleByte(p, state)));
}
