/**
 * Water-polo protocol tests — REAL classic wire (2026-06-12 cutover).
 *
 * These were the legacy CtsParser tests; they now run the production
 * pipeline: MockCtsFeed (emits REAL classic framing on the F872 channel
 * layout) → CtsWireParser('classic') → ChannelGrid → extractWaterPolo.
 * Same scenarios as before — cold-boot burst, change-only emission, goal,
 * exclusion lifecycle, period transition, reset — but on the framing a
 * real console actually speaks (validated vs real captures in
 * real-wire.test.ts).
 *
 * Honesty notes baked into the expectations:
 *   - Horn has NO channel on the real classic wire (the old "HORN module"
 *     was an invention of the synthetic framing). The mock drops horn
 *     pushes; horn coverage lives in the Gen7 tests (header horn bit).
 *   - The F872 default treats the three eject lines' team side as
 *     venue-configured ('unknown' → surfaced on the home list until the
 *     bring-up capture confirms; see grid.ts).
 */

import {
  CTS_MODULE,
  CtsFullSnapshot,
  CtsParser,
  CtsWireParser,
  MockCtsFeed,
  encodePacket,
  clockToDigits,
} from '../index';

function makeParserAndFeed() {
  const parser = new CtsWireParser({ wire: 'classic' });
  const feed = new MockCtsFeed((bytes) => parser.feed(bytes));
  const updates: CtsFullSnapshot[] = [];
  parser.onUpdate((s) => updates.push({ ...s }));
  return { parser, feed, updates };
}

describe('CtsWireParser (classic) — water polo protocol', () => {
  it('1. game start: clock + period + scores + timeouts burst decodes every field', () => {
    const { parser, feed, updates } = makeParserAndFeed();
    feed.pushInitialState({
      clock: '8:00',
      period: 2,
      homeScore: 3,
      awayScore: 1,
      homeTimeouts: 1,
      awayTimeouts: 2,
    });

    const state = parser.getState();
    expect(state.clock).toBe('8:00');
    expect(state.period).toBe(2);
    expect(state.homeScore).toBe(3);
    expect(state.awayScore).toBe(1);
    expect(state.homeTimeoutsRemaining).toBe(1);
    expect(state.awayTimeoutsRemaining).toBe(2);
    expect(state.horn).toBe(false);
    // 6 pushes, each changing state vs the zeroed defaults → 6 updates.
    expect(updates.length).toBe(6);
  });

  it('2. idle re-send of the same clock does NOT emit; a new value emits once', () => {
    const { parser, feed, updates } = makeParserAndFeed();
    feed.pushInitialState({ clock: '8:00', period: 1 });
    const baseline = updates.length;

    feed.pushModule(CTS_MODULE.GAME_CLOCK, clockToDigits('8:00'));
    expect(updates.length).toBe(baseline);

    feed.pushModule(CTS_MODULE.GAME_CLOCK, clockToDigits('7:42'));
    expect(updates.length).toBe(baseline + 1);
    expect(updates[updates.length - 1]?.clock).toBe('7:42');
    // Cadence surface for the bridge's clockRunning derivation moved.
    expect(parser.getLastClockPacketAt()).toBeGreaterThan(0);
  });

  it('3. home goal: score line bumps 0 → 1 without touching away', () => {
    const { parser, feed, updates } = makeParserAndFeed();
    feed.pushInitialState({ homeScore: 0, awayScore: 0 });
    updates.length = 0;

    feed.pushModule(CTS_MODULE.HOME_SCORE, [' ', '1']);

    expect(updates.length).toBe(1);
    expect(updates[0]?.homeScore).toBe(1);
    expect(updates[0]?.awayScore).toBe(0);
  });

  it('4. exclusion fires, ticks, clears — line stays compact', () => {
    const { parser, feed, updates } = makeParserAndFeed();
    // Jersey #7, 20s on eject line A (F872 ch4; side venue-configured —
    // default map surfaces unknown-side ejects on the home list).
    feed.pushModule(CTS_MODULE.AWAY_EXCL_1, [' ', '7', '0', '2', '0']);
    let s = parser.getState();
    expect(s.homeExclusions).toEqual([{ playerJersey: 7, secondsRemaining: 20 }]);

    feed.pushModule(CTS_MODULE.AWAY_EXCL_1, [' ', '7', '0', '1', '5']);
    s = parser.getState();
    expect(s.homeExclusions[0]?.secondsRemaining).toBe(15);

    feed.pushModule(CTS_MODULE.AWAY_EXCL_1, ['0', '0', '0', '0', '0']);
    s = parser.getState();
    expect(s.homeExclusions.length).toBe(0);

    expect(updates.length).toBe(3); // fire, tick, clear
  });

  it('5. end of quarter: period advance + clock reset surface (horn is N/A on classic wire)', () => {
    const { parser, feed, updates } = makeParserAndFeed();
    feed.pushModule(CTS_MODULE.GAME_CLOCK, clockToDigits('0:05'));
    updates.length = 0;

    feed.pushModule(CTS_MODULE.HORN, ['1']); // dropped — no classic horn channel
    feed.pushModule(CTS_MODULE.PERIOD, ['2']);
    feed.pushModule(CTS_MODULE.GAME_CLOCK, clockToDigits('8:00'));
    feed.pushModule(CTS_MODULE.HORN, [' ']); // dropped

    expect(updates.length).toBe(2); // period, clock-reset — horn pushes are no-ops
    const last = parser.getState();
    expect(last.period).toBe(2);
    expect(last.clock).toBe('8:00');
    expect(last.horn).toBe(false);
  });
});

describe('CtsWireParser (classic) — wire edge cases', () => {
  it('partial line write + another channel write both land (positions are explicit)', () => {
    const { parser, feed } = makeParserAndFeed();
    feed.pushModule(CTS_MODULE.GAME_CLOCK, clockToDigits('7:05'));
    feed.pushModule(CTS_MODULE.HOME_SCORE, [' ', '3']);
    const s = parser.getState();
    expect(s.homeScore).toBe(3);
    expect(s.clock).toBe('7:05');
  });

  it('data bytes before any control byte are silently dropped', () => {
    const { parser, feed, updates } = makeParserAndFeed();
    feed.pushBytes(new Uint8Array([0x01, 0x02, 0x03, 0x04]));
    expect(updates.length).toBe(0);
    expect(parser.getState().homeScore).toBe(0);
  });
});

describe('CtsWireParser — reset', () => {
  it('reset() restores defaults but keeps listeners attached', () => {
    const { parser, feed, updates } = makeParserAndFeed();
    feed.pushInitialState({ homeScore: 5, awayScore: 3 });
    const before = updates.length;

    parser.reset();
    expect(parser.getState().homeScore).toBe(0);
    expect(parser.getState().awayScore).toBe(0);

    feed.pushModule(CTS_MODULE.HOME_SCORE, [' ', '1']);
    expect(updates.length).toBe(before + 1);
    expect(parser.getState().homeScore).toBe(1);
  });
});

describe('legacy CtsParser (deprecated) — kept decodable until deletion', () => {
  it('still decodes its own synthetic framing fed directly', () => {
    const parser = new CtsParser();
    parser.feed(encodePacket(0x02, [' ', '4'])); // old HOME_SCORE module
    parser.flush();
    expect(parser.getState().homeScore).toBe(4);
  });
});
