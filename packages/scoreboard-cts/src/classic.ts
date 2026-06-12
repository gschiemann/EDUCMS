/**
 * REAL legacy CTS RS-232 ("classic") wire decode.
 *
 * 2026-06-11 first-customer hardening. The pre-existing CtsParser in
 * parser.ts decodes a synthetic framing (`0x80 | module`, positional
 * 7-seg bytes) that only our own emulator ever produced — real System 6
 * / Gen 6 consoles transmit the format below (validated against the
 * MIT-licensed fabriziobertocci/coloradoScoreboard decoder and its real
 * console captures, which decode cleanly with this implementation —
 * see __tests__/classic-real.test.ts).
 *
 * Wire format (9600 baud, 8 data bits, EVEN parity, 1 stop):
 *   Control byte (bit7 set):
 *     bit 0      0 → following data bytes are display READOUT,
 *                1 → format/intensity bytes (ignored)
 *     bits 5..1  channel number, INVERTED:  ch = ((b >> 1) & 0x1f) ^ 0x1f
 *     b > 0xBE   "blank this channel line" command
 *   Data byte (bit7 clear), while in readout mode:
 *     bits 7..4  character position within the line (0..7)
 *     bits 3..0  character value, encoded as  ASCII = nibble ^ 63
 *                (so digits '9'..'0' are nibbles 6..15, ':' is 5),
 *                nibble 0 → blank
 *
 * Attribution: framing semantics derived from
 * https://github.com/fabriziobertocci/coloradoScoreboard (MIT) and
 * https://marcoscorner.walther-family.org/2015/07/colorado-timing-console-scoreboard-protocol/
 */

import { ChannelGrid, createGrid, gridLine } from './grid';

export const CLASSIC_SERIAL = {
  baudRate: 9600,
  dataBits: 8 as const,
  stopBits: 1 as const,
  parity: 'even' as const,
};

export interface ClassicDecoderEvents {
  /** Fired after every byte that mutated the grid. Throttle upstream. */
  onGridChange?: (grid: ChannelGrid) => void;
  /** Fired when a control byte addressed an out-of-range channel. */
  onWarning?: (msg: string) => void;
}

export class ClassicCtsDecoder {
  readonly grid: ChannelGrid = createGrid();
  private readout = false;
  private channel = 0;
  private warnings = 0;
  private mutatedSinceEmit = false;

  constructor(private readonly events: ClassicDecoderEvents = {}) {}

  get warningCount(): number {
    return this.warnings;
  }

  feed(bytes: Uint8Array | number[]): void {
    for (let i = 0; i < bytes.length; i++) this.feedByte((bytes as any)[i] & 0xff);
    if (this.mutatedSinceEmit) {
      this.mutatedSinceEmit = false;
      this.events.onGridChange?.(this.grid);
    }
  }

  feedByte(b: number): void {
    if (b > 0x7f) {
      // Control byte.
      this.readout = (b & 1) === 0;
      this.channel = ((b >> 1) & 0x1f) ^ 0x1f;
      if (this.channel > 31) {
        this.warnings++;
        this.events.onWarning?.(`invalid channel ${this.channel} (byte 0x${b.toString(16)})`);
        return;
      }
      if (b > 0xbe) {
        // Blank-line command.
        const line = gridLine(this.grid, this.channel, 8);
        for (let i = 0; i < line.chars.length; i++) {
          line.chars[i] = ' ';
          line.decPoints[i] = false;
        }
        this.mutatedSinceEmit = true;
      }
      return;
    }
    // Data byte.
    if (!this.readout) return; // format byte — ignored
    const pos = (b & 0xf0) >> 4;
    if (pos >= 8) {
      this.warnings++;
      this.events.onWarning?.(`segment position ${pos} out of range (byte 0x${b.toString(16)})`);
      return;
    }
    const nibble = b & 0x0f;
    const line = gridLine(this.grid, this.channel, 8);
    const ch = nibble === 0 && this.channel > 0 ? ' ' : String.fromCharCode(nibble ^ 63);
    // Change-only mutation tracking — a console re-sending the same display
    // image (idle refresh) must not churn extract/emit downstream.
    if (line.chars[pos] !== ch) {
      line.chars[pos] = ch;
      this.mutatedSinceEmit = true;
    }
  }
}

/**
 * Encode one channel line in REAL classic framing — used by the emulator
 * / simulator so the practice stream is byte-identical to a real console.
 * Characters outside the encodable set ('0'-'9', ':', space) become blanks.
 * `startPos` writes the text at an absolute cell offset within the line —
 * needed for packed channels (e.g. F872 score line: home at 0, away at 2).
 */
export function encodeClassicLine(channel: number, text: string, startPos = 0): Uint8Array {
  const ch = channel & 0x1f;
  const control = 0x80 | (((ch ^ 0x1f) & 0x1f) << 1); // bit0=0 → readout
  const out: number[] = [control];
  const max = Math.min(text.length, 8 - Math.max(0, startPos));
  for (let pos = 0; pos < max; pos++) {
    const c = text[pos];
    let nibble: number;
    if (c === ' ') nibble = 0;
    else {
      nibble = (c.charCodeAt(0) ^ 63) & 0x0f;
      // Verify round-trip: chars whose code^63 exceeds a nibble can't be
      // carried on this wire — blank them rather than corrupt the line.
      if (String.fromCharCode((nibble ^ 63) & 0x7f) !== c) nibble = 0;
    }
    out.push((((startPos + pos) & 0x07) << 4) | nibble);
  }
  return Uint8Array.from(out);
}
