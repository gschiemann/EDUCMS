/**
 * console-share — pure helpers behind the scorekeeper pad (/console/[token])
 * and the operator's ShareConsoleLink card (Phase-2 Domain SHARE).
 *
 * The pad's clocks moved to the shared contract in @cms/api-types (K12-F17 /
 * F40): the projections, the formatter and the exact-time parser are pinned
 * by packages/api-types/src/sports-clock.spec.ts, not duplicated here.
 */
import { consoleTokenGameId, consoleShareUrl, padIncrements } from '../console-share';

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

describe('link scopes (K12-F34 + K12-F16) — never in the token text', () => {
  it('a scoped link has the same five-part shape as every other link', () => {
    // The scope is bound into the MAC server-side; the text never names it.
    expect(consoleTokenGameId(`${GAME}.0.1754000000.86400.${MAC}`)).toBe(GAME);
  });

  it('a token that names a scope or role as text (the retired 6-part prototype) is not console-shaped', () => {
    for (const word of ['table', 'timer', 'scorer', 'admin']) {
      expect(consoleTokenGameId(`${GAME}.0.1754000000.86400.${word}.${MAC}`)).toBeNull();
    }
    expect(consoleTokenGameId(`${GAME}.0.1754000000.86400.timer.extra.${MAC}`)).toBeNull();
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
