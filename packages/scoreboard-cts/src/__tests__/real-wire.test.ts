/**
 * Real-wire validation for the 2026-06-11 decode-layer rebuild.
 *
 * The load-bearing test here is the FIXTURE one: meet.bin / blank.bin /
 * totalBlank.bin are REAL legacy-CTS console captures (from the
 * MIT-licensed fabriziobertocci/coloradoScoreboard repo). The pre-06-11
 * parser could not decode a single byte of them — proving it had only
 * ever spoken to our own emulator. ClassicCtsDecoder must produce a
 * coherent display image from them.
 *
 * Gen7 has no public capture yet (the WTTC bring-up capture will be the
 * first) — its tests are scramble↔descramble round-trips + framing
 * acceptance/rejection, which pin the algorithm to the reference.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { ClassicCtsDecoder, encodeClassicLine } from '../classic';
import {
  encodeGen7ModulePacket,
  freshScramblerState,
  Gen7Parser,
  remapByte,
  scrambleByte,
} from '../gen7';
import {
  createGrid,
  extractWaterPolo,
  emptySnapshot,
  F872_WATER_POLO_MAP,
  gridLine,
  gridText,
  resolveWaterPoloMap,
} from '../grid';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));

describe('ClassicCtsDecoder vs REAL console captures', () => {
  it('decodes meet.bin into a coherent display image (digits + colons, low warnings)', () => {
    const dec = new ClassicCtsDecoder();
    const bytes = fixture('meet.bin');
    dec.feed(bytes);

    // A real capture must address several channels...
    expect(dec.grid.size).toBeGreaterThanOrEqual(4);
    // ...and what lands in the cells must be display characters (digits /
    // colon / blank), because the nibble^63 decode only produces those.
    let cells = 0;
    let plausible = 0;
    for (const [, line] of dec.grid) {
      for (const c of line.chars) {
        cells++;
        if (c === ' ' || c === ':' || (c >= '0' && c <= '9') || c === '<' || c === ';' || c === '=' || c === '>' || c === '?') plausible++;
      }
    }
    expect(cells).toBeGreaterThan(0);
    expect(plausible / cells).toBeGreaterThan(0.95);
    // Real stream should not be mostly invalid-channel noise.
    expect(dec.warningCount).toBeLessThan(bytes.length * 0.02);
  });

  it('reads swim run-time digits off channel 0 of meet.bin (reference semantics)', () => {
    const dec = new ClassicCtsDecoder();
    dec.feed(fixture('meet.bin'));
    // Reference: channel 0 carries the running time as "  MMssd?" — after a
    // full meet capture the line must contain at least one digit.
    const ch0 = gridText(dec.grid, 0);
    expect(ch0.length).toBeGreaterThan(0);
    expect(/[0-9]/.test(ch0)).toBe(true);
  });

  it('blank captures decode with channels mostly blank', () => {
    const dec = new ClassicCtsDecoder();
    dec.feed(fixture('totalBlank.bin'));
    let digits = 0;
    let cells = 0;
    for (const [, line] of dec.grid) {
      for (const c of line.chars) {
        cells++;
        if (c >= '0' && c <= '9') digits++;
      }
    }
    expect(cells).toBeGreaterThan(0);
    // A blanked board may still tick a clock channel — but the image
    // should be overwhelmingly blank vs the meet capture.
    expect(digits / cells).toBeLessThan(0.3);
  });

  it('encodeClassicLine round-trips through the decoder (emulator = real wire)', () => {
    const dec = new ClassicCtsDecoder();
    dec.feed(encodeClassicLine(1, '12:34.56'));
    dec.feed(encodeClassicLine(5, '07 03   '));
    expect(gridText(dec.grid, 1)).toBe('12:34 56'); // '.' never rides the classic wire (board renders implied dots)
    expect(gridText(dec.grid, 5, 0, 2)).toBe('07');
    expect(gridText(dec.grid, 5, 2, 2)).toBe(' 0');
  });
});

describe('Gen7 scrambler', () => {
  it('scrambleByte ↔ remapByte round-trips arbitrary frames', () => {
    for (const addr of [0x80, 0x83, 0x9f, 0xb2, 0xff]) {
      const plain = [addr, 12, 0x05, 0x31, 0x06, 0x32, 0x1c, 0x40, 0x7f, 0x00, 0x19, 0x55, 0x21, 0x66];
      const enc = freshScramblerState();
      const wire = plain.map((p) => scrambleByte(p, enc));
      const dec = freshScramblerState();
      const back = wire.map((w) => remapByte(w, dec));
      expect(back).toEqual(plain);
    }
  });

  it('keystream differs between odd/even address seeds (rotate direction)', () => {
    const a = freshScramblerState();
    const b = freshScramblerState();
    scrambleByte(0x82, a);
    scrambleByte(0x83, b);
    const seqA = [10, 20, 30].map((v) => scrambleByte(v, a));
    const seqB = [10, 20, 30].map((v) => scrambleByte(v, b));
    expect(seqA).not.toEqual(seqB);
  });
});

describe('Gen7Parser framing + grid', () => {
  it('accepts a well-formed scrambled module packet and lands digits in the grid', () => {
    const p = new Gen7Parser();
    // Module 5 (score line): "07" home + "03" away per F872 positions.
    const pkt = encodeGen7ModulePacket(5, [
      { pos: 0, char: '0' },
      { pos: 1, char: '7' },
      { pos: 2, char: '0' },
      { pos: 3, char: '3' },
    ]);
    p.feed(pkt, 1000);
    expect(p.packetsAccepted).toBe(1);
    expect(p.packetsRejected).toBe(0);
    expect(gridText(p.grid, 5, 0, 4)).toBe('0703');
    const snap = p.getSnapshot();
    expect(snap.homeScore).toBe(7);
    expect(snap.awayScore).toBe(3);
  });

  it('rejects a corrupted packet (checksum) without touching the grid', () => {
    const p = new Gen7Parser();
    const pkt = encodeGen7ModulePacket(5, [{ pos: 0, char: '9' }]);
    pkt[pkt.length - 1] ^= 0x05; // corrupt the checksum byte on the wire
    p.feed(pkt, 1000);
    expect(p.packetsAccepted).toBe(0);
    expect(p.packetsRejected).toBe(1);
    expect(p.grid.get(5)).toBeUndefined();
  });

  it('decodes clock + period + shot via the F872 map end-to-end', () => {
    const p = new Gen7Parser();
    const clock = encodeGen7ModulePacket(1, '7:32  '.split('').map((c, i) => ({ pos: i, char: c })));
    const perShot = encodeGen7ModulePacket(2, [
      { pos: 0, char: '3' }, // period 3
      { pos: 1, char: '2' },
      { pos: 2, char: '4' }, // shot ":24"
    ]);
    p.feed(clock, 1000);
    p.feed(perShot, 1500);
    const snap = p.getSnapshot();
    expect(snap.clock).toContain('7:32');
    expect(snap.period).toBe(3);
    expect(snap.homeShotClock.ms).toBe(24_000);
    expect(snap.awayShotClock.ms).toBe(24_000);
  });

  it('flags the horn from the module-header horn bit', () => {
    const p = new Gen7Parser();
    const pkt = encodeGen7ModulePacket(5, [{ pos: 0, char: '1' }]);
    // Set the horn bit on the (descrambled) module header inside the
    // payload by re-encoding with a horn-carrying header.
    const horns = encodeGen7ModulePacket(5, [{ pos: 0, char: '2' }], { horn: true });
    p.feed(pkt, 1000);
    expect(p.getSnapshot().horn).toBe(false);
    p.feed(horns, 2000);
    expect(p.getSnapshot().horn).toBe(true);
  });

  it('a universal-flagged module mirrors module 0 shared digits (clock)', () => {
    const p = new Gen7Parser();
    // Reference semantics (ctsScoreboardasync.js GetTime): a module flagged
    // universal (header bit 0x40) carries no digits of its own — its display
    // mirrors module 0's shared digits. Flag the F872 clock channel (1)
    // universal, put the clock in module 0, and confirm the extractor reads
    // through to module 0 instead of clock-channel 1's empty line.
    const univ1 = encodeGen7ModulePacket(1, [], { universal: true });
    const mod0 = encodeGen7ModulePacket(
      0,
      '7:32  '.split('').map((c, i) => ({ pos: i, char: c })),
    );
    p.feed(univ1, 1000); // module 1 flagged universal (no digits, no extract)
    p.feed(mod0, 1100); // shared digits land in module 0 → ch1 reads through
    expect(p.getSnapshot().clock).toContain('7:32');
  });
});


describe('extractWaterPolo (F872 map)', () => {
  it('parses ejects from channels 4/3/11 and survives idle lines', () => {
    const grid = createGrid();
    const e1 = gridLine(grid, 4, 8);
    ['0', '7', '0', '1', '5'].forEach((c, i) => (e1.chars[i] = c)); // cap 7, 15s
    const e2 = gridLine(grid, 3, 8);
    ['1', '1', '0', '0', '8'].forEach((c, i) => (e2.chars[i] = c)); // cap 11, 8s
    const snap = extractWaterPolo(grid, F872_WATER_POLO_MAP, emptySnapshot(), false, 1000);
    // Default map keeps unknown-side ejects on the home list, in order.
    expect(snap.homeExclusions).toEqual([
      { playerJersey: 7, secondsRemaining: 15 },
      { playerJersey: 11, secondsRemaining: 8 },
    ]);
    expect(snap.awayExclusions).toEqual([]);
  });

  it('venue override rebinds sides + channels (Define-Module reality)', () => {
    const grid = createGrid();
    const l = gridLine(grid, 20, 8);
    ['0', '5', '0', '2', '0'].forEach((c, i) => (l.chars[i] = c));
    const map = resolveWaterPoloMap({
      ejects: [{ channel: 20, side: 'away', capStart: 0, capCount: 2, timeStart: 2, timeCount: 3 }],
    });
    const snap = extractWaterPolo(grid, map, emptySnapshot(), false, 1000);
    expect(snap.awayExclusions).toEqual([{ playerJersey: 5, secondsRemaining: 20 }]);
    expect(snap.homeExclusions).toEqual([]);
  });

  it('falls back to the packed combo line for score when ch5 is idle', () => {
    const grid = createGrid();
    const packed = gridLine(grid, 7, 8);
    ['1', '2', ' ', ' ', ' ', ' ', '0', '9'].forEach((c, i) => (packed.chars[i] = c));
    const snap = extractWaterPolo(grid, F872_WATER_POLO_MAP, emptySnapshot(), false, 1000);
    expect(snap.homeScore).toBe(12);
    expect(snap.awayScore).toBe(9);
  });

  it('packed line reads away as the LAST numeric group, with the clock in the middle', () => {
    // "HH 88:88 AA" — home · clock · away. The exact away cell offset
    // varies by firmware; tokenizing the line and taking the last numeric
    // group reads the away score regardless. (A hardcoded awayStart=6 here
    // would read the clock's seconds digits, not the away score.)
    const grid = createGrid();
    const packed = gridLine(grid, 7, 12);
    '05 0730 03'.split('').forEach((c, i) => (packed.chars[i] = c)); // home 5, clk 07:30, away 3
    const snap = extractWaterPolo(grid, F872_WATER_POLO_MAP, emptySnapshot(), false, 1000);
    expect(snap.homeScore).toBe(5);
    expect(snap.awayScore).toBe(3);
  });

  it('persists last-known values for idle channels (no flicker to zero)', () => {
    const grid = createGrid();
    const score = gridLine(grid, 5, 8);
    ['0', '4', '0', '2'].forEach((c, i) => (score.chars[i] = c));
    const first = extractWaterPolo(grid, F872_WATER_POLO_MAP, emptySnapshot(), false, 1000);
    expect(first.homeScore).toBe(4);
    // New grid where only the clock channel transmits.
    const grid2 = createGrid();
    const clk = gridLine(grid2, 1, 8);
    '6:5 '.split('').forEach((c, i) => (clk.chars[i] = c));
    const second = extractWaterPolo(grid2, F872_WATER_POLO_MAP, first, false, 2000);
    expect(second.homeScore).toBe(4);
    expect(second.awayScore).toBe(2);
    expect(second.clock).toContain('6:5');
  });
});
