/**
 * console-share — pure helpers behind the scorekeeper pad (/console/[token])
 * and the operator's ShareConsoleLink card (Phase-2 Domain SHARE).
 */
import {
  consoleTokenGameId,
  consoleShareUrl,
  padIncrements,
  projectClockMs,
  fmtPadClock,
  parsePadClock,
  type PadClockAnchor,
} from '../console-share';

const GAME = 'a3d1b2c4-5678-4abc-9def-000000000001';
const MAC = '0123456789abcdef0123456789abcdef';

describe('consoleTokenGameId — client-side shape parse', () => {
  it('extracts the embedded gameId from a console-shaped token', () => {
    expect(consoleTokenGameId(`${GAME}.0.1754000000.86400.${MAC}`)).toBe(GAME);
  });

  it('rejects everything not console-shaped', () => {
    expect(consoleTokenGameId(null)).toBeNull();
    expect(consoleTokenGameId(undefined)).toBeNull();
    expect(consoleTokenGameId('')).toBeNull();
    expect(consoleTokenGameId('deadbeefdeadbeefdeadbeefdeadbeef')).toBeNull(); // bare feed shape
    expect(consoleTokenGameId(`0.1754000000.86400.${MAC}`)).toBeNull(); // 4-part feed shape
    expect(consoleTokenGameId(`${GAME}.x.1.2.${MAC}`)).toBeNull(); // non-numeric ver
    expect(consoleTokenGameId(`${GAME}.0.1.2.${MAC.slice(0, 31)}`)).toBeNull(); // short mac
    expect(consoleTokenGameId(`bad:id.0.1.2.${MAC}`)).toBeNull(); // charset
  });
});

describe('consoleShareUrl', () => {
  it('builds the pad URL from an origin + token', () => {
    expect(consoleShareUrl('https://app.venueos.example', 'tok')).toBe(
      'https://app.venueos.example/console/tok',
    );
  });
  it('tolerates a trailing slash on the origin', () => {
    expect(consoleShareUrl('https://app.venueos.example/', 'tok')).toBe(
      'https://app.venueos.example/console/tok',
    );
  });
});

describe('padIncrements — sport-aware quick buttons', () => {
  it('passes a sport’s published increments through (basketball)', () => {
    expect(padIncrements({ score: { increments: [1, 2, 3] } })).toEqual([1, 2, 3]);
  });

  it('an EMPTY published set stays empty — judged sports hide the pad, same as the console', () => {
    expect(padIncrements({ score: { increments: [] } })).toEqual([]);
  });

  it('drops junk values but keeps the valid ones', () => {
    expect(padIncrements({ score: { increments: [1, NaN, -2, 6] as number[] } })).toEqual([1, 6]);
  });

  it('an unresolvable sport definition falls back to a lone +1', () => {
    expect(padIncrements(undefined)).toEqual([1]);
    expect(padIncrements(null)).toEqual([1]);
    expect(padIncrements({})).toEqual([1]);
  });
});

describe('projectClockMs — the board-parity anchor projection', () => {
  const base: PadClockAnchor = {
    clockMs: 480_000, // 8:00
    clockRunning: true,
    clockUpdatedAt: new Date(1_754_000_000_000).toISOString(),
    serverTime: 1_754_000_000_000, // server clock at receive
    receivedAt: 1_754_000_000_000, // local clock at receive (zero skew)
  };

  it('a stopped clock returns the stored reading untouched', () => {
    expect(
      projectClockMs({ ...base, clockRunning: false }, 'countdown', base.receivedAt + 60_000),
    ).toBe(480_000);
  });

  it("a 'none' clock sport returns the stored reading untouched", () => {
    expect(projectClockMs(base, 'none', base.receivedAt + 60_000)).toBe(480_000);
  });

  it('countdown: 5s later reads 5s less', () => {
    expect(projectClockMs(base, 'countdown', base.receivedAt + 5_000)).toBe(475_000);
  });

  it('countdown clamps at zero (never negative on screen)', () => {
    expect(projectClockMs(base, 'countdown', base.receivedAt + 999_000)).toBe(0);
  });

  it('countup: 5s later reads 5s more', () => {
    expect(projectClockMs(base, 'countup', base.receivedAt + 5_000)).toBe(485_000);
  });

  it('corrects for client-server skew (local clock 2s behind server)', () => {
    // Server said 1_754_000_000_000 (== the anchor write instant) at the
    // moment our local clock read 1_753_999_998_000 → skew +2s. Without
    // the skew term, "local now − anchorAt" would claim 1s of elapsed
    // time when truly 3s local have passed; WITH it, local+skew lands in
    // the server's clock domain and 3s local later projects exactly 3s
    // off the anchor.
    const skewed: PadClockAnchor = { ...base, receivedAt: base.serverTime - 2_000 };
    expect(projectClockMs(skewed, 'countdown', skewed.receivedAt + 3_000)).toBe(477_000);
  });

  it('an unparseable anchor timestamp falls back to the stored reading', () => {
    expect(
      projectClockMs({ ...base, clockUpdatedAt: null }, 'countdown', base.receivedAt + 5_000),
    ).toBe(480_000);
    expect(
      projectClockMs({ ...base, clockUpdatedAt: 'not-a-date' }, 'countdown', base.receivedAt + 5_000),
    ).toBe(480_000);
  });
});

describe('fmtPadClock — CEIL semantics (console-reference parity)', () => {
  it('renders m:ss', () => {
    expect(fmtPadClock(480_000)).toBe('8:00');
    expect(fmtPadClock(61_000)).toBe('1:01');
  });

  it('a countdown at 0.4s reads 0:01 — NEVER 0:00 with time left', () => {
    expect(fmtPadClock(400)).toBe('0:01');
    expect(fmtPadClock(1)).toBe('0:01');
  });

  it('0:00 only at true zero; negatives clamp', () => {
    expect(fmtPadClock(0)).toBe('0:00');
    expect(fmtPadClock(-500)).toBe('0:00');
  });

  it('59.9s reads 1:00 (ceil), not 0:59', () => {
    expect(fmtPadClock(59_900)).toBe('1:00');
  });
});

describe('parsePadClock — the "set clock" input', () => {
  it('parses m:ss to milliseconds', () => {
    expect(parsePadClock('8:00')).toBe(480_000);
    expect(parsePadClock('0:45')).toBe(45_000);
    expect(parsePadClock(' 12:30 ')).toBe(750_000);
  });
  it('rejects malformed input', () => {
    expect(parsePadClock('')).toBeNull();
    expect(parsePadClock('8')).toBeNull();
    expect(parsePadClock('8:60')).toBeNull();
    expect(parsePadClock('a:bc')).toBeNull();
  });
});
