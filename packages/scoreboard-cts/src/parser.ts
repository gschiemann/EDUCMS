/**
 * @cms/scoreboard-cts/parser — Colorado Time Systems (CTS) System 6 /
 * Gen 6 protocol decoder. Browser-safe.
 *
 * The CTS protocol is a stream-based addressable scoreboard protocol:
 *   - Bytes with bit 7 SET (>127) are ADDRESS bytes. They open a new
 *     packet for one module (0x80..0x9F = modules 0x00..0x1F).
 *   - Bytes with bit 7 CLEAR (<128) are DATA bytes for the CURRENT
 *     module. Each data byte's bits 0-6 are the seven-segment value
 *     for ONE digit position, INVERTED (a set bit = segment OFF).
 *     The byte's index within the packet determines which digit
 *     position it lights — index 0 is leftmost, index N is rightmost
 *     for an N-byte packet. Some modules send fewer digits (e.g.
 *     period is one digit; the score is 2 digits).
 *
 * Edge cases observed in real consoles:
 *   - A new address byte mid-packet immediately CLOSES the prior
 *     packet (using whatever data bytes had accumulated) and OPENS
 *     a new one. No checksum to ride; the next address byte is the
 *     packet boundary.
 *   - Idle modules don't transmit; we keep the last-known value
 *     between updates. UIs should detect "no update in > 5s" as
 *     a console disconnect or paused signal.
 *   - The horn module (0x1F) typically transmits a single non-zero
 *     byte for one cycle when fired. We surface a one-shot boolean.
 *
 * Decoded characters: only the digits 0-9 and BLANK are produced.
 * Anything we can't recognize becomes a space (' ') — better to drop
 * the segment than show garbage on the LED wall.
 */

import {
  CTS_MODULE,
  CtsExclusion,
  CtsFullSnapshot,
  CtsStructuredShotClock,
  CtsUpdateListener,
} from './types';

/**
 * Seven-segment map. Keys are the LOW 7 BITS of a data byte AFTER
 * inverting (i.e. the "active segment" bitmap). Standard layout:
 *
 *      a
 *    f   b
 *      g
 *    e   c
 *      d
 *
 * Bit 0 = a, 1 = b, 2 = c, 3 = d, 4 = e, 5 = f, 6 = g.
 */
const SEG_TO_CHAR: Record<number, string> = {
  0b0111111: '0', // a,b,c,d,e,f
  0b0000110: '1', // b,c
  0b1011011: '2', // a,b,d,e,g
  0b1001111: '3', // a,b,c,d,g
  0b1100110: '4', // b,c,f,g
  0b1101101: '5', // a,c,d,f,g
  0b1111101: '6', // a,c,d,e,f,g
  0b0000111: '7', // a,b,c
  0b1111111: '8', // all
  0b1101111: '9', // a,b,c,d,f,g
  0b0000000: ' ', // blank
};

/**
 * Decode one CTS data byte to its display character. The byte's
 * low 7 bits are the INVERTED segment pattern (bit set = segment OFF
 * on the LED). XOR with 0x7F to get the active pattern, then look up.
 *
 * @internal exposed for unit tests.
 */
export function decodeDataByte(byte: number): string {
  // Some consoles also use bit 7 as a "decimal point lit" flag on
  // data bytes that are otherwise legal. We strip it for char lookup
  // and propagate via the punctuation-aware decoders below.
  const segments = (~byte) & 0x7f;
  const ch = SEG_TO_CHAR[segments];
  return ch !== undefined ? ch : ' ';
}

/**
 * Same as decodeDataByte but also returns whether the colon /
 * decimal segment (bit 7) was lit. CTS uses this for the M:SS clock
 * separator on the game clock module.
 */
export function decodeDataByteWithDp(byte: number): { ch: string; dp: boolean } {
  return { ch: decodeDataByte(byte), dp: (byte & 0x80) !== 0 };
}

/** Parse a string-of-digits like "1234" into an integer. Empty/blank → 0. */
function digitsToInt(s: string): number {
  const trimmed = s.replace(/\D/g, '');
  if (!trimmed.length) return 0;
  const n = parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Format a CTS clock display from its raw decoded digits.
 *
 * The CTS game-clock module typically sends 5 data bytes:
 *   - Position 0..1: minutes (2 digits, leading space if < 10)
 *   - Position 2..3: seconds (2 digits, leading space if < 10)
 *   - Position 4:    tenths (1 digit, present only in the last
 *                    minute when the console drops to ":SS.t" mode)
 *
 * We display ":SS.t" once the minutes digits go blank — same
 * convention as the physical scoreboard.
 */
function formatClock(digits: string[]): string {
  const safe = digits.map((d) => (d === '' ? ' ' : d));
  if (safe.length === 0) return '0:00';

  // 5-byte form: MMSSt (last byte = tenths)
  if (safe.length >= 4) {
    const m1 = safe[0] ?? ' ';
    const m2 = safe[1] ?? ' ';
    const s1 = safe[2] ?? '0';
    const s2 = safe[3] ?? '0';
    const t = safe[4] ?? '';
    const mins = `${m1}${m2}`.trim();
    const secs = `${s1}${s2}`;
    if (mins === '' && t !== '') {
      // Sub-minute mode: ":SS.t"
      return `:${secs}.${t}`;
    }
    if (mins === '') {
      // Sub-minute mode with no tenths reported
      return `:${secs}`;
    }
    // M:SS mode (drop leading zero on minutes for readability)
    return `${parseInt(mins, 10)}:${secs}`;
  }

  // 3-byte form: M:SS (the score / shot clocks reuse this length for
  // their own formats — caller decides). Default to joining and
  // letting the caller post-process.
  return safe.join('').trim();
}

/**
 * Decode an exclusion module's data bytes into one CtsExclusion.
 *
 * Convention (5 data bytes per exclusion slot):
 *   - Position 0..1: 2-digit jersey number (' 7', '14')
 *   - Position 2..4: 3-digit time remaining "MSS" or "0SS" —
 *     water polo exclusions are 20s max, so the leading digit is
 *     usually 0, but the parser handles 1-99 seconds in either
 *     M:SS or SSS form.
 *
 * Some consoles send only 4 bytes (2 jersey + 2 seconds). We handle
 * both forms.
 */
function decodeExclusion(digits: string[]): CtsExclusion | null {
  if (digits.length < 4) return null;
  const jerseyStr = `${digits[0] ?? ' '}${digits[1] ?? ' '}`.trim();
  const jersey = jerseyStr === '' ? 0 : digitsToInt(jerseyStr);
  // Try 3-digit-seconds first (positions 2..4)
  const longTime = `${digits[2] ?? ''}${digits[3] ?? ''}${digits[4] ?? ''}`.trim();
  let seconds = 0;
  if (longTime !== '') {
    seconds = digitsToInt(longTime);
  } else {
    const shortTime = `${digits[2] ?? ''}${digits[3] ?? ''}`.trim();
    seconds = digitsToInt(shortTime);
  }
  // Blank exclusion → drop. Both jersey and time empty means
  // "no exclusion currently active in this slot."
  if (jersey === 0 && seconds === 0) return null;
  return { playerJersey: jersey, secondsRemaining: seconds };
}

/**
 * CtsParser — feed it raw bytes from the serial line, get
 * CtsFullSnapshot updates on each completed module packet.
 *
 * Construction is cheap (no I/O). Bind one listener via onUpdate()
 * and pump bytes via feed(). The parser is fully synchronous; it
 * does not own any timers.
 */
export class CtsParser {
  private state: CtsFullSnapshot;
  private listeners: Set<CtsUpdateListener> = new Set();

  /** Module currently being assembled, or null while waiting for an address byte. */
  private currentModule: number | null = null;
  /** Data bytes accumulated for the current module. */
  private currentBytes: number[] = [];

  // ─── cadence tracking (T2-1) ──────────────────────────────────

  /**
   * Wall-clock timestamps of the last two GAME_CLOCK (0x01) packets.
   * Used to compute the inter-packet interval for cadence-based
   * clockRunning derivation.  Two entries because we need the delta.
   */
  private clockPacketHistory: [number, number] = [0, 0];

  /**
   * Returns the timestamp of the most recent GAME_CLOCK packet, or 0
   * if none seen yet.  Used by CtsBridge to derive clockRunning from
   * packet cadence rather than display-string mutation.
   */
  public getLastClockPacketAt(): number {
    return this.clockPacketHistory[1];
  }

  /**
   * Estimated inter-packet interval for the GAME_CLOCK module in
   * milliseconds.  At sub-minute (tenths mode) the CTS console emits
   * every ~100ms; at whole-second granularity it emits every ~1000ms.
   * Returns 0 when fewer than 2 packets have been seen (no estimate).
   */
  public getClockPacketIntervalMs(): number {
    const [prev, last] = this.clockPacketHistory;
    if (prev === 0 || last === 0 || last <= prev) return 0;
    return last - prev;
  }

  constructor() {
    this.state = this.makeEmptyState();
  }

  /** Subscribe to update events. Returns an unsubscribe function. */
  public onUpdate(listener: CtsUpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Read-only snapshot of the latest accumulated state. */
  public getState(): CtsFullSnapshot {
    return { ...this.state };
  }

  /** Reset all state (e.g. when switching games). Listeners stay attached. */
  public reset(): void {
    this.state = this.makeEmptyState();
    this.currentModule = null;
    this.currentBytes = [];
    this.clockPacketHistory = [0, 0];
  }

  /**
   * Feed one or more bytes into the parser. Address bytes (>127)
   * close any in-progress packet and open a new one. Data bytes
   * (<128) accumulate against the current module.
   *
   * Accepts either Uint8Array (the native shape coming off
   * `navigator.serial` ReadableStream reads) or a plain number[]
   * (used by tests). Node Buffer is a Uint8Array subclass so it's
   * also accepted at runtime without needing @types/node.
   */
  public feed(bytes: Uint8Array | number[]): void {
    const arr: number[] = Array.isArray(bytes) ? bytes : Array.from(bytes);
    for (const raw of arr) {
      const b = raw & 0xff;
      if ((b & 0x80) !== 0) {
        // Address byte. Close current packet (if any) and open new.
        this.commitCurrent();
        this.currentModule = b & 0x7f;
        this.currentBytes = [];
      } else if (this.currentModule !== null) {
        this.currentBytes.push(b);
      }
      // Data byte before any address byte = noise; drop silently.
    }
  }

  /**
   * Force-commit the in-progress packet. Useful on EOF / port close
   * so the last module's bytes don't get dropped. Most callers don't
   * need this — the next address byte commits naturally.
   */
  public flush(): void {
    this.commitCurrent();
  }

  // ─── internals ────────────────────────────────────────────────

  private commitCurrent(): void {
    if (this.currentModule === null || this.currentBytes.length === 0) {
      // Nothing to commit.
      this.currentBytes = [];
      return;
    }
    const mod = this.currentModule;
    const digits = this.currentBytes.map(decodeDataByte);
    let changed = false;

    switch (mod) {
      case CTS_MODULE.GAME_CLOCK: {
        // Track inter-packet cadence for clockRunning derivation (T2-1).
        this.clockPacketHistory = [this.clockPacketHistory[1], Date.now()];
        const clock = formatClock(digits);
        if (clock !== this.state.clock) {
          this.state.clock = clock;
          changed = true;
        }
        break;
      }
      case CTS_MODULE.PERIOD: {
        const p = digitsToInt(digits.join(''));
        if (p !== this.state.period) {
          this.state.period = p;
          changed = true;
        }
        break;
      }
      case CTS_MODULE.HOME_SCORE: {
        const s = digitsToInt(digits.join(''));
        if (s !== this.state.homeScore) {
          this.state.homeScore = s;
          changed = true;
        }
        break;
      }
      case CTS_MODULE.AWAY_SCORE: {
        const s = digitsToInt(digits.join(''));
        if (s !== this.state.awayScore) {
          this.state.awayScore = s;
          changed = true;
        }
        break;
      }
      case CTS_MODULE.HOME_SHOT_CLOCK: {
        // T2-1: promote raw display string to structured object.
        // `running` is approximated here as "non-zero" — the bridge
        // refines this using game-clock cadence before posting to the
        // server, since the shot clock only counts when the game clock
        // counts.
        const scRaw = digits.join('').trim();
        const scMs = digitsToInt(scRaw) * 1000;
        const structured: CtsStructuredShotClock = {
          raw: scRaw,
          ms: scMs,
          running: scMs > 0,
        };
        if (
          scRaw !== this.state.homeShotClock.raw ||
          scMs !== this.state.homeShotClock.ms
        ) {
          this.state.homeShotClock = structured;
          changed = true;
        }
        break;
      }
      case CTS_MODULE.AWAY_SHOT_CLOCK: {
        const scRaw = digits.join('').trim();
        const scMs = digitsToInt(scRaw) * 1000;
        const structured: CtsStructuredShotClock = {
          raw: scRaw,
          ms: scMs,
          running: scMs > 0,
        };
        if (
          scRaw !== this.state.awayShotClock.raw ||
          scMs !== this.state.awayShotClock.ms
        ) {
          this.state.awayShotClock = structured;
          changed = true;
        }
        break;
      }
      case CTS_MODULE.HOME_EXCL_1:
      case CTS_MODULE.HOME_EXCL_2:
      case CTS_MODULE.HOME_EXCL_3: {
        const slot = mod - CTS_MODULE.HOME_EXCL_1;
        if (this.upsertExclusion(this.state.homeExclusions, slot, decodeExclusion(digits))) {
          changed = true;
        }
        break;
      }
      case CTS_MODULE.AWAY_EXCL_1:
      case CTS_MODULE.AWAY_EXCL_2:
      case CTS_MODULE.AWAY_EXCL_3: {
        const slot = mod - CTS_MODULE.AWAY_EXCL_1;
        if (this.upsertExclusion(this.state.awayExclusions, slot, decodeExclusion(digits))) {
          changed = true;
        }
        break;
      }
      case CTS_MODULE.HOME_TIMEOUTS: {
        const n = digitsToInt(digits.join(''));
        if (n !== this.state.homeTimeoutsRemaining) {
          this.state.homeTimeoutsRemaining = n;
          changed = true;
        }
        break;
      }
      case CTS_MODULE.AWAY_TIMEOUTS: {
        const n = digitsToInt(digits.join(''));
        if (n !== this.state.awayTimeoutsRemaining) {
          this.state.awayTimeoutsRemaining = n;
          changed = true;
        }
        break;
      }
      case CTS_MODULE.HORN: {
        // Any non-zero data byte = horn ON for this cycle. The
        // parser surfaces it as a one-shot — UIs should latch on
        // rising edge.
        const anyNonZero = this.currentBytes.some((b) => b !== 0x7f);
        if (anyNonZero !== this.state.horn) {
          this.state.horn = anyNonZero;
          changed = true;
        }
        break;
      }
      default:
        // Unknown module address — ignore. Includes the date/time-of-
        // day aux packets some consoles send on 0x1E.
        break;
    }

    if (changed) {
      this.state.receivedAt = Date.now();
      this.emit();
    }

    this.currentBytes = [];
  }

  /**
   * Insert / replace / clear one exclusion slot. Returns true if the
   * exclusions array changed. We keep the array sparse — null
   * exclusion in a slot means "no exclusion active right now."
   * Listeners see a compacted array (nulls dropped).
   *
   * @internal
   */
  private upsertExclusion(
    arr: CtsExclusion[],
    slot: number,
    exclusion: CtsExclusion | null,
  ): boolean {
    // Compact array up-front; we'll re-compact after the change.
    const current = [...arr];
    // Pad to 3 with null placeholders so slot indexing is stable.
    while (current.length < 3) {
      current.push({ playerJersey: 0, secondsRemaining: 0 });
    }
    const before = JSON.stringify(current[slot] ?? null);
    current[slot] = exclusion ?? { playerJersey: 0, secondsRemaining: 0 };
    const after = JSON.stringify(current[slot]);
    if (before === after) return false;
    // Re-compact (drop empty slots) for the user-visible state.
    const compact = current.filter(
      (e) => e.playerJersey !== 0 || e.secondsRemaining !== 0,
    );
    // Mutate the target array in place so the outer object identity
    // stays the same.
    arr.splice(0, arr.length, ...compact);
    return true;
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        // Don't let a bad listener crash the parser.
        // eslint-disable-next-line no-console
        console.error('[CtsParser] listener threw:', err);
      }
    }
  }

  private makeEmptyState(): CtsFullSnapshot {
    const emptyShotClock = (): import('./types').CtsStructuredShotClock => ({
      raw: '',
      ms: 0,
      running: false,
    });
    return {
      clock: '0:00',
      period: 1,
      homeScore: 0,
      awayScore: 0,
      homeShotClock: emptyShotClock(),
      awayShotClock: emptyShotClock(),
      homeExclusions: [],
      awayExclusions: [],
      homeTimeoutsRemaining: 2,
      awayTimeoutsRemaining: 2,
      horn: false,
      receivedAt: 0,
    };
  }
}

// ─── ENCODING HELPERS (used by the mock + tests) ──────────────────

/**
 * Char → inverted seven-segment data byte. For mock and tests.
 *
 * @internal
 */
export function encodeChar(ch: string): number {
  for (const [pattern, c] of Object.entries(SEG_TO_CHAR)) {
    if (c === ch) {
      const segments = parseInt(pattern, 10);
      return (~segments) & 0x7f;
    }
  }
  // Unknown char → blank byte.
  return 0x7f;
}

/**
 * Encode a complete module packet: one address byte (with bit 7
 * set) followed by N data bytes for the given chars. For mock /
 * test use.
 */
export function encodePacket(module: number, chars: string[]): Uint8Array {
  const addr = 0x80 | (module & 0x7f);
  const out = new Uint8Array(chars.length + 1);
  out[0] = addr;
  for (let i = 0; i < chars.length; i++) {
    out[i + 1] = encodeChar(chars[i] ?? ' ');
  }
  return out;
}
