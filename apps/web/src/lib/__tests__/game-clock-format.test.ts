/**
 * Phase-2 Domain CLOCK — formatter parity spec.
 *
 * `formatGameClock` is THE game-clock formatter for all three sports
 * surfaces (console, board, ribbon). The parity contract: MM:SS output
 * is byte-for-byte the operator console's pre-extraction CEIL math
 * (operator bug 046d73aa — a countdown at 0.4s reads "0:01" until true
 * zero, never "0:00" with time left), and tenths mode below 60s keeps
 * the board/ribbon truncation behavior (floor seconds, floor tenths).
 */
import { formatGameClock } from '../game-clock-format';

/** The console's OLD local fmtClock, verbatim — the reference the
 *  shared formatter must never drift from in MM:SS mode. */
function consoleReferenceFmtClock(ms: number): string {
  const safe = Math.max(0, ms);
  const totalSec = Math.ceil(safe / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

describe('formatGameClock — MM:SS (broadcast ceil) mode', () => {
  it('60_000ms is exactly 1:00', () => {
    expect(formatGameClock(60_000)).toBe('1:00');
  });

  it('59_900ms rounds UP to 1:00 (never 0:59 with 59.9s left)', () => {
    expect(formatGameClock(59_900)).toBe('1:00');
  });

  it('1_000ms is exactly 0:01', () => {
    expect(formatGameClock(1_000)).toBe('0:01');
  });

  it('400ms reads 0:01 — 0:00 only ever means expired', () => {
    expect(formatGameClock(400)).toBe('0:01');
  });

  it('0ms is 0:00 (true zero)', () => {
    expect(formatGameClock(0)).toBe('0:00');
  });

  it('negative input clamps to 0:00', () => {
    expect(formatGameClock(-1)).toBe('0:00');
    expect(formatGameClock(-5_000)).toBe('0:00');
  });
});

describe('formatGameClock — tenths mode (final minute of a countdown)', () => {
  it('59_940ms truncates to 59.9 (floor seconds, floor tenths)', () => {
    expect(formatGameClock(59_940, true)).toBe('59.9');
  });

  it('60_100ms stays in the MM:SS ceil branch — 1:01 (more than a minute remains)', () => {
    // Old floor-based board/ribbon showed "1:00" here; the console
    // reference (and now every surface) reads 1:01 until true 1:00.
    expect(formatGameClock(60_100, true)).toBe('1:01');
  });

  it('60_000ms exactly falls through to MM:SS — 1:00', () => {
    expect(formatGameClock(60_000, true)).toBe('1:00');
  });

  it('sub-second values keep tenths truncation: 400ms reads 0.4', () => {
    expect(formatGameClock(400, true)).toBe('0.4');
  });

  it('1_000ms reads 1.0', () => {
    expect(formatGameClock(1_000, true)).toBe('1.0');
  });

  it('59_900ms reads 59.9', () => {
    expect(formatGameClock(59_900, true)).toBe('59.9');
  });

  it('0 and negative clamp to 0.0', () => {
    expect(formatGameClock(0, true)).toBe('0.0');
    expect(formatGameClock(-250, true)).toBe('0.0');
  });

  it('999ms of a tenth truncate, never round up: 59_999 reads 59.9', () => {
    expect(formatGameClock(59_999, true)).toBe('59.9');
  });
});

describe('formatGameClock — console-reference parity table (MM:SS mode)', () => {
  // Sweep the edges that separated the three old formatters: segment
  // boundaries, sub-second remainders, exact seconds, minute rollovers,
  // and long football/soccer values.
  const CASES: Array<[number, string]> = [
    [0, '0:00'],
    [1, '0:01'],
    [400, '0:01'],
    [999, '0:01'],
    [1_000, '0:01'],
    [1_001, '0:02'],
    [59_000, '0:59'],
    [59_900, '1:00'],
    [59_999, '1:00'],
    [60_000, '1:00'],
    [60_001, '1:01'],
    [60_100, '1:01'],
    [61_000, '1:01'],
    [119_500, '2:00'],
    [600_000, '10:00'],
    [720_000, '12:00'],
    [2_700_000, '45:00'],
    [2_700_400, '45:01'],
  ];

  it.each(CASES)('%ims → %s (matches the console reference byte-for-byte)', (ms, expected) => {
    expect(formatGameClock(ms)).toBe(expected);
    expect(consoleReferenceFmtClock(ms)).toBe(expected);
  });

  it('never diverges from the console reference across a dense 0–5min sweep', () => {
    // 7ms stride is coprime with 1000 so it lands on awkward remainders.
    for (let ms = 0; ms <= 300_000; ms += 7) {
      expect(formatGameClock(ms)).toBe(consoleReferenceFmtClock(ms));
    }
  });
});
