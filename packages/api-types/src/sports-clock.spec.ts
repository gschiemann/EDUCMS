/**
 * The shared sports clock contract (K12-F05 / F08 / F17). Pure functions —
 * every time is passed in, so there is no clock to fake.
 */
import { SPORT_DEFINITIONS } from './sports';
import {
  clockAnchorMs,
  clockShowsTenths,
  formatClockReading,
  formatSportClock,
  gameClockExpiryMs,
  isGameClockExpired,
  isPeriodClockOver,
  isUntimedSegment,
  parseClockEntry,
  projectCountdownMs,
  projectGameClockMs,
  shotClockMode,
} from './sports-clock';

const T0 = Date.parse('2026-09-27T12:00:00.000Z');
const basketball = SPORT_DEFINITIONS.basketball;
const football = SPORT_DEFINITIONS.football;
const soccer = SPORT_DEFINITIONS.soccer;
const baseball = SPORT_DEFINITIONS.baseball;
const lacrosse = SPORT_DEFINITIONS.lacrosse;

describe('projectGameClockMs', () => {
  const at = new Date(T0).toISOString();

  it('a running countdown loses exactly the elapsed server time', () => {
    expect(projectGameClockMs({ clockMs: 60_000, clockRunning: true, clockUpdatedAt: at }, 'countdown', T0 + 10_300)).toBe(49_700);
  });

  it('a running countdown never reads below zero', () => {
    expect(projectGameClockMs({ clockMs: 5_000, clockRunning: true, clockUpdatedAt: at }, 'countdown', T0 + 60_000)).toBe(0);
  });

  it('a running count-up gains the elapsed time', () => {
    expect(projectGameClockMs({ clockMs: 60_000, clockRunning: true, clockUpdatedAt: at }, 'countup', T0 + 2_500)).toBe(62_500);
  });

  it('a stopped clock reads its stored value whatever the time', () => {
    expect(projectGameClockMs({ clockMs: 42_000, clockRunning: false, clockUpdatedAt: at }, 'countdown', T0 + 99_000)).toBe(42_000);
  });

  it('an anchor stamped in the future holds the reading instead of winding the clock back', () => {
    expect(projectGameClockMs({ clockMs: 42_000, clockRunning: true, clockUpdatedAt: at }, 'countup', T0 - 5_000)).toBe(42_000);
    expect(projectGameClockMs({ clockMs: 42_000, clockRunning: true, clockUpdatedAt: at }, 'countdown', T0 - 5_000)).toBe(42_000);
  });

  it('a clockless sport and an unreadable anchor read the stored value', () => {
    expect(projectGameClockMs({ clockMs: 7, clockRunning: true, clockUpdatedAt: at }, 'none', T0 + 1_000)).toBe(7);
    expect(projectGameClockMs({ clockMs: 9_000, clockRunning: true, clockUpdatedAt: 'garbage' }, 'countdown', T0)).toBe(9_000);
    expect(projectGameClockMs({ clockMs: 9_000, clockRunning: true, clockUpdatedAt: null }, 'countdown', T0)).toBe(9_000);
  });

  it('accepts a Date, epoch ms or ISO anchor alike', () => {
    for (const anchor of [at, T0, new Date(T0)]) {
      expect(projectGameClockMs({ clockMs: 10_000, clockRunning: true, clockUpdatedAt: anchor }, 'countdown', T0 + 1_000)).toBe(9_000);
    }
    expect(clockAnchorMs(undefined)).toBeNaN();
  });
});

describe('projectCountdownMs (shot / play / penalty clocks)', () => {
  it('projects a running entry and freezes a stopped one', () => {
    const at = new Date(T0).toISOString();
    expect(projectCountdownMs({ ms: 35_000, at, running: true }, T0 + 4_000)).toBe(31_000);
    expect(projectCountdownMs({ ms: 35_000, at, running: false }, T0 + 4_000)).toBe(35_000);
    expect(projectCountdownMs({ ms: 3_000, at, running: true }, T0 + 4_000)).toBe(0);
    expect(projectCountdownMs(null, T0)).toBe(0);
  });
});

describe('expiry (K12-F08)', () => {
  it('a countdown expires at 0:00', () => {
    expect(gameClockExpiryMs(basketball)).toBe(0);
    expect(isGameClockExpired(basketball, {}, 0)).toBe(true);
    expect(isGameClockExpired(basketball, {}, 100)).toBe(false);
  });

  it('a count-up expires at the segment length plus the added minutes', () => {
    expect(gameClockExpiryMs(soccer, {})).toBe(40 * 60_000);
    expect(gameClockExpiryMs(soccer, { addedTime: 3 })).toBe(43 * 60_000);
    expect(isGameClockExpired(soccer, { addedTime: 3 }, 41 * 60_000)).toBe(false);
    expect(isGameClockExpired(soccer, { addedTime: 3 }, 43 * 60_000)).toBe(true);
  });

  it('a clockless sport never expires', () => {
    expect(gameClockExpiryMs(baseball)).toBeNull();
    expect(isGameClockExpired(baseball, {}, 0)).toBe(false);
  });

  it('holds: a LIVE game stopped at its expiry reading is "period over"; running, other statuses and untimed OT are not', () => {
    const over = { status: 'LIVE', clockRunning: false, clockMs: 0, segment: 1, stats: {} };
    expect(isPeriodClockOver(basketball, over)).toBe(true);
    expect(isPeriodClockOver(basketball, { ...over, clockRunning: true })).toBe(false);
    expect(isPeriodClockOver(basketball, { ...over, clockMs: 300 })).toBe(false);
    expect(isPeriodClockOver(basketball, { ...over, status: 'HALFTIME' })).toBe(false);
    // Football OT is untimed — its zeroed clock is not "the period ran out".
    expect(isUntimedSegment(football, 5)).toBe(true);
    expect(isUntimedSegment(football, 4)).toBe(false);
    expect(isPeriodClockOver(football, { ...over, segment: 5 })).toBe(false);
    expect(isPeriodClockOver(football, { ...over, segment: 4 })).toBe(true);
  });
});

describe('display (K12-F17)', () => {
  it('only tenths-capable countdowns show tenths, and only in the final minute', () => {
    expect(clockShowsTenths(basketball, 59_999)).toBe(true);
    expect(clockShowsTenths(basketball, 60_000)).toBe(false);
    expect(clockShowsTenths(football, 30_000)).toBe(false);
    expect(clockShowsTenths(lacrosse, 30_000)).toBe(false);
    expect(clockShowsTenths(soccer, 12_300)).toBe(false); // count-up: 0:13, never 12.3
    expect(clockShowsTenths(undefined, 1_000)).toBe(false);
  });

  it('formats MM:SS rounding up and tenths rounding down', () => {
    expect(formatClockReading(400)).toBe('0:01');
    expect(formatClockReading(0)).toBe('0:00');
    expect(formatClockReading(59_900)).toBe('1:00');
    expect(formatClockReading(59_940, true)).toBe('59.9');
    expect(formatClockReading(300, true)).toBe('0.3');
    expect(formatClockReading(60_100, true)).toBe('1:01');
    expect(formatClockReading(-5, true)).toBe('0.0');
    expect(formatClockReading(Number.NaN)).toBe('0:00');
  });

  it('formatSportClock applies the sport policy', () => {
    expect(formatSportClock(basketball, 4_300)).toBe('4.3');
    expect(formatSportClock(football, 4_300)).toBe('0:05');
    expect(formatSportClock(soccer, 12_300)).toBe('0:13');
    expect(formatSportClock(basketball, 480_000)).toBe('8:00');
  });
});

describe('parseClockEntry (K12-F17)', () => {
  it.each([
    ['7:42', 462_000],
    ['12:00', 720_000],
    ['0:00', 0],
    ['7:4', 424_000],
    ['0:04.3', 4_300],
    ['7:42.5', 462_500],
    [':45', 45_000],
    [':04.3', 4_300],
    ['0.3', 300],
    ['4.3', 4_300],
    ['59.9', 59_900],
    ['  1:05 ', 65_000],
  ])('%s → %d ms', (text, ms) => {
    expect(parseClockEntry(text)).toBe(ms);
  });

  it.each(['45', '', '1:60', '1:05.35', '75.3', 'abc', '1:2:3', '-0:05', '.3'])(
    'refuses the ambiguous or malformed "%s"',
    (text) => {
      expect(parseClockEntry(text)).toBeNull();
    },
  );

  it('refuses non-strings', () => {
    expect(parseClockEntry(45 as unknown)).toBeNull();
    expect(parseClockEntry(null)).toBeNull();
  });
});

describe('shotClockMode (K12-F05)', () => {
  it('distinguishes never-configured, switched OFF and on', () => {
    expect(shotClockMode(undefined)).toBe('unset');
    expect(shotClockMode({})).toBe('unset');
    expect(shotClockMode({ shotClock: null })).toBe('unset');
    expect(shotClockMode({ shotClock: { len: 0, ms: 0, running: false } })).toBe('off');
    expect(shotClockMode({ shotClock: { len: 0, off: true } })).toBe('off');
    expect(shotClockMode({ shotClock: { len: 35, ms: 35_000 } })).toBe('on');
  });
});
