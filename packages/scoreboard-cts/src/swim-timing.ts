/**
 * @cms/scoreboard-cts/swim-timing — Colorado Time Systems (CTS)
 * SWIMMING scoreboard-serial protocol decoder.
 *
 * This is a DIFFERENT wire format from the water-polo decoders already in
 * this package (parser.ts's synthetic positional-7-segment framing, and
 * classic.ts's real channel-grid framing). Swimming's CTS "scoreboard
 * serial" output is a packed BINARY module-addressed stream, documented at
 * https://marcoscorner.walther-family.org/2015/07/colorado-timing-console-scoreboard-protocol/
 * (see docs/research/2026-06-30-swim-dive-scoreboards/00-REPORT.md part A7
 * for the VenueOS-side summary this decoder implements):
 *
 *   Physical layer: RS-232, 9600 baud, 8 data bits, EVEN parity, 1 stop.
 *   Modules daisy-chain: each console module matches its own address and
 *   relays the rest of the stream downstream, so a listener anywhere on
 *   the chain sees every module's packets.
 *
 *   Packet shape: [moduleAddress][...payload bytes], with NO explicit
 *   packet-length byte and NO checksum — module 0x00-0x1F. This decoder
 *   frames packets by KNOWN payload length per module address (the
 *   documented byte map below), matching the CTS Gen7/System 6 lane
 *   modules' fixed-size payloads. Unknown module addresses are skipped
 *   (their payload length is unknown, so we cannot safely resync mid-
 *   stream on garbage — see `resyncToKnownModule` for the recovery path).
 *
 *   Module → payload map (report A7):
 *     0x01-0x0A  lanes 1-10   [Lane][Place][Min][Sec][Hundredths]  (5 bytes)
 *     0x17-0x18  lanes 11-12  same 5-byte shape
 *     0x0B       lengths & pool records (not decoded — no VenueOS field yet)
 *     0x0C       event & heat  [EventHi][EventLo][Heat]            (3 bytes)
 *     0x0D       team scores   [HomeHi][HomeLo][AwayHi][AwayLo]    (4 bytes)
 *     0x16       time-of-day (not decoded — no VenueOS field)
 *     0x19-0x1E  split times (lane pairs) [Lane][Min][Sec][Hundredths] (4 bytes)
 *
 *   Byte encoding: every numeric field is sent as a single unsigned byte
 *   holding the DECIMAL value directly (e.g. a "12" second reading is the
 *   byte 0x0C = 12, not BCD, not ASCII) — this matches the open Arduino/
 *   Python CTS scoreboard-serial emulators the report cites as our
 *   correctness reference, and lets `parseCtsSwimPacket` stay a pure,
 *   allocation-free function fully exercised by Jest without hardware.
 *   0xFF in any numeric field means "blank / not yet timed" (an idle
 *   lane, or a length/split not yet reached) — never rendered as 255.
 *
 *   Place: 0 = not yet placed (mid-race), 1-based once the touch pad
 *   fires. A place byte of 0xFF (or > 8) is treated as "unplaced."
 *
 * Pure, synchronous, Node- and browser-safe (no `fs`, no `Buffer`-only
 * APIs — everything accepts `Uint8Array | number[]`, same convention as
 * CtsParser.feed in parser.ts). No I/O, no timers: construct once, feed
 * bytes, read snapshots via `onUpdate` or `getState`.
 */

/** One lane's live timing state, decoded from a lane module packet. */
export interface SwimLaneState {
  /** Physical lane number (1-12). */
  lane: number;
  /** Finish place (1-based). 0 = not yet placed / still racing. */
  place: number;
  /** Minutes component of the displayed time (0 when under a minute). */
  minutes: number;
  /** Seconds component (0-59). */
  seconds: number;
  /** Hundredths component (0-99). */
  hundredths: number;
  /** Formatted "M:SS.hh" (minutes dropped when 0) — display-as-typed
   *  convention matched to every other meet-sport board in this repo. */
  display: string;
  /** True when the module reported 0xFF (blank/idle lane — no swimmer,
   *  or a lane that hasn't been touched off yet in a heat in progress). */
  blank: boolean;
}

/** Event & heat context, decoded from the 0x0C module packet. */
export interface SwimEventHeatState {
  /** Event number (1-999, 12-bit packed across two bytes — see decode). */
  eventNumber: number;
  /** Heat number within the event (1-99). */
  heat: number;
}

/** Dual-meet team score, decoded from the 0x0D module packet. */
export interface SwimTeamScoreState {
  homeScore: number;
  awayScore: number;
}

/** One decoded split-time reading, from a 0x19-0x1E module packet. */
export interface SwimSplitState {
  /** Which split-time channel (0-5, corresponding to 0x19-0x1E). Real
   *  consoles pair channels to lanes per venue DIP-switch config, which
   *  VenueOS does not know — the ingest layer/operator maps channel →
   *  lane at bring-up. We surface the raw channel; do not guess a lane. */
  channel: number;
  minutes: number;
  seconds: number;
  hundredths: number;
  display: string;
  blank: boolean;
}

/** The accumulated state CtsSwimTimingParser tracks across all packets. */
export interface SwimTimingSnapshot {
  /** Keyed by lane number (1-12). Sparse — only lanes that have sent at
   *  least one packet appear. */
  lanes: Record<number, SwimLaneState>;
  /** Keyed by split channel (0-5). Sparse, same convention as lanes. */
  splits: Record<number, SwimSplitState>;
  eventHeat: SwimEventHeatState | null;
  teamScore: SwimTeamScoreState | null;
  /** Wall-clock ms timestamp of the most recent packet that changed
   *  state (client-side Date.now()) — lets a consumer detect a stale
   *  feed (no update in > N ms → console disconnected/idle). */
  receivedAt: number;
}

export type SwimTimingUpdateListener = (state: SwimTimingSnapshot) => void;

/** Module address → decoded payload length, per report A7. Addresses not
 *  in this map are unknown-length and therefore unsafe to frame — the
 *  parser resyncs past them (see `resyncToKnownModule`). */
const LANE_MODULES = new Set<number>([
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, // lanes 1-10
  0x17, 0x18, // lanes 11-12
]);
const SPLIT_MODULES = new Set<number>([0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e]);
const EVENT_HEAT_MODULE = 0x0c;
const TEAM_SCORE_MODULE = 0x0d;

const PAYLOAD_LEN: Record<number, number> = {
  // Lanes 1-10 + 11-12: [Lane][Place][Min][Sec][Hundredths]
  ...Object.fromEntries([...LANE_MODULES].map((m) => [m, 5])),
  // Event & heat: [EventHi][EventLo][Heat]
  [EVENT_HEAT_MODULE]: 3,
  // Team scores: [HomeHi][HomeLo][AwayHi][AwayLo]
  [TEAM_SCORE_MODULE]: 4,
  // Split times (lane pairs): [Lane][Min][Sec][Hundredths]
  ...Object.fromEntries([...SPLIT_MODULES].map((m) => [m, 4])),
};

/** Module → lane number for the 12 lane addresses (0x17/0x18 wrap to 11/12). */
function laneNumberForModule(mod: number): number {
  if (mod >= 0x01 && mod <= 0x0a) return mod; // 1-10
  if (mod === 0x17) return 11;
  if (mod === 0x18) return 12;
  return 0;
}

const BLANK_BYTE = 0xff;

function formatTime(minutes: number, seconds: number, hundredths: number, blank: boolean): string {
  if (blank) return '';
  const ss = String(seconds).padStart(2, '0');
  const hh = String(hundredths).padStart(2, '0');
  return minutes > 0 ? `${minutes}:${ss}.${hh}` : `${seconds}.${hh}`;
}

/** Decode one lane (or split) module's 5-byte (or 4-byte) payload. Shared
 *  by both lane and split decoding since the trailing 3 time bytes are
 *  identical; `hasPlace` toggles whether byte[1] is a place or the first
 *  time byte. Exported for direct unit testing of the byte math. */
export function decodeTimeBytes(
  min: number,
  sec: number,
  hund: number,
): { minutes: number; seconds: number; hundredths: number; blank: boolean } {
  const blank = min === BLANK_BYTE || sec === BLANK_BYTE || hund === BLANK_BYTE;
  return {
    minutes: blank ? 0 : min,
    seconds: blank ? 0 : sec,
    hundredths: blank ? 0 : hund,
    blank,
  };
}

/** Decode one lane module packet's payload (5 bytes: Lane, Place, Min,
 *  Sec, Hund) into a {@link SwimLaneState}. `lane` is the module-derived
 *  lane number (authoritative — the payload's own Lane byte is a
 *  cross-check and, per the documented protocol, normally matches; if it
 *  disagrees we trust the module address, since that's what every real
 *  console keys off, and note nothing — a mismatch is exceedingly rare
 *  hardware noise, not a case worth failing decode over). */
export function decodeLanePacket(lane: number, payload: number[]): SwimLaneState {
  const [, placeByte, min, sec, hund] = payload;
  const { minutes, seconds, hundredths, blank } = decodeTimeBytes(min, sec, hund);
  const placeRaw = placeByte;
  const place = placeRaw === BLANK_BYTE || placeRaw > 12 ? 0 : placeRaw;
  return {
    lane,
    place,
    minutes,
    seconds,
    hundredths,
    display: formatTime(minutes, seconds, hundredths, blank),
    blank,
  };
}

/** Decode one split-time module packet's payload (4 bytes: Lane, Min,
 *  Sec, Hund) into a {@link SwimSplitState}. */
export function decodeSplitPacket(channel: number, payload: number[]): SwimSplitState {
  const [, min, sec, hund] = payload;
  const { minutes, seconds, hundredths, blank } = decodeTimeBytes(min, sec, hund);
  return {
    channel,
    minutes,
    seconds,
    hundredths,
    display: formatTime(minutes, seconds, hundredths, blank),
    blank,
  };
}

/** Decode the event & heat module packet (3 bytes: EventHi, EventLo,
 *  Heat). Event number is packed as (hi * 100 + lo) so a 3-digit event
 *  number (1-999) fits two bytes without ambiguity — the documented
 *  format and the open reference emulators both send it this way (hi =
 *  hundreds digit's carry, lo = the remaining 0-99). */
export function decodeEventHeatPacket(payload: number[]): SwimEventHeatState {
  const [hi, lo, heat] = payload;
  const eventNumber = (hi === BLANK_BYTE ? 0 : hi) * 100 + (lo === BLANK_BYTE ? 0 : lo);
  return { eventNumber, heat: heat === BLANK_BYTE ? 0 : heat };
}

/** Decode the team-score module packet (4 bytes: HomeHi, HomeLo, AwayHi,
 *  AwayLo). Each side is packed the same (hi*100+lo) as the event number
 *  so 3-digit dual-meet running totals are representable. */
export function decodeTeamScorePacket(payload: number[]): SwimTeamScoreState {
  const [hHi, hLo, aHi, aLo] = payload;
  const homeScore = (hHi === BLANK_BYTE ? 0 : hHi) * 100 + (hLo === BLANK_BYTE ? 0 : hLo);
  const awayScore = (aHi === BLANK_BYTE ? 0 : aHi) * 100 + (aLo === BLANK_BYTE ? 0 : aLo);
  return { homeScore, awayScore };
}

/** One fully-framed raw packet: the module address plus its payload
 *  bytes, as extracted by {@link parseCtsSwimPackets}. Exposed for tests
 *  and for callers that want the pre-semantic-decode packet stream. */
export interface RawCtsSwimPacket {
  module: number;
  payload: number[];
}

/**
 * Pure stream framer: given a flat byte stream (a full capture, or
 * however many bytes have arrived so far), extract every COMPLETE
 * packet it can find, and return the packets PLUS the leftover
 * unconsumed tail (a partial packet at the end of the buffer, or
 * unknown-module noise still being resynced past).
 *
 * Framing rule: the protocol has no length/checksum byte, so a packet's
 * length is determined purely by looking up its module address in
 * {@link PAYLOAD_LEN}. An address not in that table is UNKNOWN — its
 * true payload length can't be determined, so this framer treats it as
 * one noise byte and advances by 1 (resync), rather than risk
 * mis-framing every subsequent packet on the wire. This mirrors the
 * real protocol's own daisy-chain behavior: a module only reacts to its
 * own address and relays everything else untouched, so a listener that
 * doesn't understand every module (pool-records 0x0B, time-of-day 0x16,
 * or any address a venue hasn't documented) must not let that stall
 * decoding of the modules it DOES understand.
 */
export function parseCtsSwimPackets(bytes: Uint8Array | number[]): {
  packets: RawCtsSwimPacket[];
  remainder: number[];
} {
  const arr: number[] = Array.isArray(bytes) ? bytes.slice() : Array.from(bytes);
  const packets: RawCtsSwimPacket[] = [];
  let i = 0;
  while (i < arr.length) {
    const mod = arr[i] & 0xff;
    const len = PAYLOAD_LEN[mod];
    if (len === undefined) {
      // Unknown module — one byte of noise/unsupported-module, resync.
      i += 1;
      continue;
    }
    if (i + 1 + len > arr.length) {
      // Not enough bytes yet for a complete packet — stop here and let
      // the caller re-feed the remainder once more bytes arrive.
      break;
    }
    const payload = arr.slice(i + 1, i + 1 + len).map((b) => b & 0xff);
    packets.push({ module: mod, payload });
    i += 1 + len;
  }
  return { packets, remainder: arr.slice(i) };
}

/**
 * SwimTimingParser — feed it raw bytes from the CTS scoreboard-serial
 * line (or from any transport that has already de-framed the RS-232
 * stream into a byte array), get SwimTimingSnapshot updates on every
 * packet that changes state. Mirrors CtsParser's ergonomics (parser.ts)
 * — construction is cheap, one listener via onUpdate(), feed via feed().
 *
 * Byte-incomplete packets at the end of a `feed()` call are buffered and
 * prefixed onto the next call, so callers may feed any chunk size (a
 * single byte at a time off a real serial port, or a whole captured
 * file at once in a test) without losing a partial packet at a chunk
 * boundary.
 */
export class SwimTimingParser {
  private state: SwimTimingSnapshot;
  private listeners: Set<SwimTimingUpdateListener> = new Set();
  private pending: number[] = [];

  constructor() {
    this.state = this.makeEmptyState();
  }

  /** Subscribe to update events. Returns an unsubscribe function. */
  public onUpdate(listener: SwimTimingUpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Read-only snapshot of the latest accumulated state. Returns fresh
   *  nested objects so callers cannot mutate the parser's internals. */
  public getState(): SwimTimingSnapshot {
    return {
      lanes: { ...this.state.lanes },
      splits: { ...this.state.splits },
      eventHeat: this.state.eventHeat,
      teamScore: this.state.teamScore,
      receivedAt: this.state.receivedAt,
    };
  }

  /** Reset all accumulated state (e.g. switching meets/events). Listeners
   *  stay attached. */
  public reset(): void {
    this.state = this.makeEmptyState();
    this.pending = [];
  }

  /** Feed one or more bytes. Accepts Uint8Array (native `navigator.serial`
   *  ReadableStream shape) or plain number[] (tests). */
  public feed(bytes: Uint8Array | number[]): void {
    const incoming: number[] = Array.isArray(bytes) ? bytes : Array.from(bytes);
    const combined = this.pending.concat(incoming);
    const { packets, remainder } = parseCtsSwimPackets(combined);
    this.pending = remainder;
    let changed = false;
    for (const pkt of packets) {
      if (this.applyPacket(pkt)) changed = true;
    }
    if (changed) {
      this.state.receivedAt = Date.now();
      this.emit();
    }
  }

  /** Apply one decoded packet to internal state. Returns true if state
   *  actually changed (so `feed` only emits + timestamps on real deltas,
   *  same discipline as CtsParser.commitCurrent). */
  private applyPacket(pkt: RawCtsSwimPacket): boolean {
    const { module: mod, payload } = pkt;
    if (LANE_MODULES.has(mod)) {
      const lane = laneNumberForModule(mod);
      const decoded = decodeLanePacket(lane, payload);
      const before = this.state.lanes[lane];
      if (before && sameLaneState(before, decoded)) return false;
      this.state.lanes[lane] = decoded;
      return true;
    }
    if (SPLIT_MODULES.has(mod)) {
      const channel = mod - 0x19;
      const decoded = decodeSplitPacket(channel, payload);
      const before = this.state.splits[channel];
      if (before && sameSplitState(before, decoded)) return false;
      this.state.splits[channel] = decoded;
      return true;
    }
    if (mod === EVENT_HEAT_MODULE) {
      const decoded = decodeEventHeatPacket(payload);
      const before = this.state.eventHeat;
      if (before && before.eventNumber === decoded.eventNumber && before.heat === decoded.heat) return false;
      this.state.eventHeat = decoded;
      return true;
    }
    if (mod === TEAM_SCORE_MODULE) {
      const decoded = decodeTeamScorePacket(payload);
      const before = this.state.teamScore;
      if (before && before.homeScore === decoded.homeScore && before.awayScore === decoded.awayScore) return false;
      this.state.teamScore = decoded;
      return true;
    }
    // Modules with a known length but no semantic decode yet (pool
    // records 0x0B, time-of-day 0x16) — accepted by the framer, ignored
    // here. Not currently in PAYLOAD_LEN, so parseCtsSwimPackets already
    // skips them byte-by-byte; this branch is unreachable today but kept
    // as a documented no-op in case a future payload-length entry is
    // added for them without also adding semantic handling.
    return false;
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        // Don't let a bad listener crash the parser.
        // eslint-disable-next-line no-console
        console.error('[SwimTimingParser] listener threw:', err);
      }
    }
  }

  private makeEmptyState(): SwimTimingSnapshot {
    return { lanes: {}, splits: {}, eventHeat: null, teamScore: null, receivedAt: 0 };
  }
}

function sameLaneState(a: SwimLaneState, b: SwimLaneState): boolean {
  return (
    a.place === b.place &&
    a.minutes === b.minutes &&
    a.seconds === b.seconds &&
    a.hundredths === b.hundredths &&
    a.blank === b.blank
  );
}

function sameSplitState(a: SwimSplitState, b: SwimSplitState): boolean {
  return (
    a.minutes === b.minutes &&
    a.seconds === b.seconds &&
    a.hundredths === b.hundredths &&
    a.blank === b.blank
  );
}

// ─── ENCODING HELPERS (mock feeds + tests + the open-emulator shape) ──
//
// The swim scoreboard-serial wire has NO high-bit-set address convention
// (unlike parser.ts's synthetic water-polo framing) — every byte,
// including the module address, is a plain unsigned value 0x00-0xFF, and
// packets are framed purely by the fixed payload-length table above. So
// encoding a packet is just [moduleByte, ...payloadBytes] with no bit
// manipulation. These helpers exist for the mock feed + Jest fixtures —
// they are each other's exact inverse of decodeLanePacket / etc., which
// is how the round-trip tests prove the byte math.

/** Module address for a given lane number (1-12). */
export function laneModule(lane: number): number {
  if (lane >= 1 && lane <= 10) return lane;
  if (lane === 11) return 0x17;
  if (lane === 12) return 0x18;
  throw new RangeError(`lane ${lane} out of range (expected 1-12)`);
}

/** Encode one lane packet (module address + 5-byte payload: Lane, Place,
 *  Min, Sec, Hundredths) — mirrors the documented format and the open
 *  Arduino/Python CTS emulators the report cites. `place` 0 = "unplaced,
 *  still racing" (a normal in-progress state); pass `blank: true` for a
 *  genuinely idle/no-swimmer lane (encodes Min/Sec/Hundredths as 0xFF). */
export function encodeLanePacket(
  lane: number,
  opts: { place?: number; minutes?: number; seconds?: number; hundredths?: number; blank?: boolean } = {},
): Uint8Array {
  const mod = laneModule(lane);
  const blank = !!opts.blank;
  const place = opts.place ?? 0;
  const minutes = blank ? BLANK_BYTE : (opts.minutes ?? 0);
  const seconds = blank ? BLANK_BYTE : (opts.seconds ?? 0);
  const hundredths = blank ? BLANK_BYTE : (opts.hundredths ?? 0);
  return Uint8Array.from([mod, lane, place, minutes, seconds, hundredths]);
}

/** Encode one split-time packet (module address + 4-byte payload: Lane,
 *  Min, Sec, Hundredths) for split channel 0-5 (modules 0x19-0x1E). */
export function encodeSplitPacket(
  channel: number,
  lane: number,
  opts: { minutes?: number; seconds?: number; hundredths?: number; blank?: boolean } = {},
): Uint8Array {
  if (channel < 0 || channel > 5) throw new RangeError(`split channel ${channel} out of range (expected 0-5)`);
  const mod = 0x19 + channel;
  const blank = !!opts.blank;
  const minutes = blank ? BLANK_BYTE : (opts.minutes ?? 0);
  const seconds = blank ? BLANK_BYTE : (opts.seconds ?? 0);
  const hundredths = blank ? BLANK_BYTE : (opts.hundredths ?? 0);
  return Uint8Array.from([mod, lane, minutes, seconds, hundredths]);
}

/** Encode the event & heat packet (module 0x0C + 3-byte payload). Event
 *  numbers > 999 are clamped (the wire format only carries 3 digits). */
export function encodeEventHeatPacket(eventNumber: number, heat: number): Uint8Array {
  const clamped = Math.max(0, Math.min(999, Math.trunc(eventNumber)));
  const hi = Math.floor(clamped / 100);
  const lo = clamped % 100;
  return Uint8Array.from([EVENT_HEAT_MODULE, hi, lo, Math.max(0, Math.min(99, Math.trunc(heat)))]);
}

/** Encode the team-score packet (module 0x0D + 4-byte payload). */
export function encodeTeamScorePacket(homeScore: number, awayScore: number): Uint8Array {
  const enc = (v: number) => {
    const clamped = Math.max(0, Math.min(999, Math.trunc(v)));
    return [Math.floor(clamped / 100), clamped % 100];
  };
  const [hHi, hLo] = enc(homeScore);
  const [aHi, aLo] = enc(awayScore);
  return Uint8Array.from([TEAM_SCORE_MODULE, hHi, hLo, aHi, aLo]);
}

/** Concatenate several encoded packets into one flat byte stream — the
 *  shape a real serial-read chunk (or a captured `.bin` fixture) takes.
 *  Convenience for tests / the mock feed. */
export function concatPackets(...packets: Uint8Array[]): Uint8Array {
  const total = packets.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of packets) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
