/**
 * Tests for the Colorado Time Systems (CTS) protocol decoder.
 *
 * Each test feeds a known byte sequence (composed via the mock's
 * `encodePacket`) and asserts the parser surfaces the right
 * accumulated state. We test:
 *
 *   1. Cold-boot game-state burst (clock, period, both scores).
 *   2. Mid-quarter clock + score tick (deltas only emit when state
 *      actually changes).
 *   3. Goal scored — single HOME_SCORE packet bumps homeScore.
 *   4. Exclusion fired then cleared — array compaction works.
 *   5. End of quarter — horn + period advance.
 *
 * Test API uses Jest (matches the rest of the repo). The repo doesn't
 * have vitest installed — Jest's `describe/it/expect` API is
 * identical for our needs and avoids a lockfile churn.
 */

import {
  CTS_MODULE,
  CtsFullSnapshot,
  CtsParser,
  MockCtsFeed,
  encodePacket,
  clockToDigits,
} from '../index';

function makeParserAndFeed() {
  const parser = new CtsParser();
  const feed = new MockCtsFeed((bytes) => parser.feed(bytes));
  const updates: CtsFullSnapshot[] = [];
  parser.onUpdate((s) => updates.push({ ...s }));
  return { parser, feed, updates };
}

describe('CtsParser — water polo protocol', () => {
  it('1. game start: clock + period + zero scores burst arrives, every field decodes', () => {
    const { parser, feed, updates } = makeParserAndFeed();
    feed.pushInitialState({
      clock: '8:00',
      period: 2,
      homeScore: 3,
      awayScore: 1,
      homeTimeouts: 1,
      awayTimeouts: 2,
    });
    // Flush so the LAST packet (away timeouts) gets committed
    // without needing a follow-up address byte.
    parser.flush();

    const state = parser.getState();
    expect(state.clock).toBe('8:00');
    expect(state.period).toBe(2);
    expect(state.homeScore).toBe(3);
    expect(state.awayScore).toBe(1);
    expect(state.homeTimeoutsRemaining).toBe(1);
    expect(state.awayTimeoutsRemaining).toBe(2);
    expect(state.horn).toBe(false);
    // 5 modules differ from defaults; awayTimeouts=2 matches the
    // default (2) so no change event for that one. Order doesn't
    // matter — just verify the count.
    expect(updates.length).toBe(5);
  });

  it('2. mid-quarter clock + score ticks emit only when value changes', () => {
    const { parser, feed, updates } = makeParserAndFeed();
    feed.pushInitialState({ clock: '8:00', period: 1 });
    parser.flush();
    const baseline = updates.length;

    // Re-send the SAME clock — should NOT emit a duplicate update.
    feed.pushModule(CTS_MODULE.GAME_CLOCK, clockToDigits('8:00'));
    parser.flush();
    expect(updates.length).toBe(baseline);

    // Send a new clock value — emits one update.
    feed.pushModule(CTS_MODULE.GAME_CLOCK, clockToDigits('7:42'));
    parser.flush();
    expect(updates.length).toBe(baseline + 1);
    const last = updates[updates.length - 1];
    expect(last).toBeDefined();
    expect(last?.clock).toBe('7:42');
  });

  it('3. home goal scored: home score module bumps 0 → 1', () => {
    const { parser, feed, updates } = makeParserAndFeed();
    feed.pushInitialState({ homeScore: 0 });
    parser.flush();
    updates.length = 0;

    feed.pushModule(CTS_MODULE.HOME_SCORE, [' ', '1']);
    parser.flush();

    expect(updates.length).toBe(1);
    expect(updates[0]?.homeScore).toBe(1);
    expect(updates[0]?.awayScore).toBe(0);
  });

  it('4. exclusion fires then clears: slot array stays compact', () => {
    const { parser, feed, updates } = makeParserAndFeed();
    // Fire exclusion: jersey #7, 20s remaining
    feed.pushModule(CTS_MODULE.AWAY_EXCL_1, [' ', '7', '0', '2', '0']);
    parser.flush();
    let last = parser.getState();
    expect(last.awayExclusions.length).toBe(1);
    expect(last.awayExclusions[0]).toEqual({ playerJersey: 7, secondsRemaining: 20 });

    // Tick down: 20 → 15
    feed.pushModule(CTS_MODULE.AWAY_EXCL_1, [' ', '7', '0', '1', '5']);
    parser.flush();
    last = parser.getState();
    expect(last.awayExclusions[0]?.secondsRemaining).toBe(15);

    // Clear (all zeros) — slot empties, array goes back to length 0
    feed.pushModule(CTS_MODULE.AWAY_EXCL_1, ['0', '0', '0', '0', '0']);
    parser.flush();
    last = parser.getState();
    expect(last.awayExclusions.length).toBe(0);

    // Verify we got the right number of state-change events:
    // fire, tick, clear → 3 changes total.
    expect(updates.length).toBe(3);
  });

  it('5. end of quarter: horn + period advance both surface', () => {
    const { parser, feed, updates } = makeParserAndFeed();
    // Start Q1 with the clock running down (not 8:00 — we need the
    // clock-reset event to be a real change, distinct from the
    // parser's empty default).
    feed.pushModule(CTS_MODULE.GAME_CLOCK, clockToDigits('0:05'));
    parser.flush();
    updates.length = 0;

    // Horn fires
    feed.pushModule(CTS_MODULE.HORN, ['1']);
    parser.flush();
    // Period advances default 1 → 2
    feed.pushModule(CTS_MODULE.PERIOD, ['2']);
    parser.flush();
    // Clock resets to start of next quarter (0:05 → 8:00)
    feed.pushModule(CTS_MODULE.GAME_CLOCK, clockToDigits('8:00'));
    parser.flush();
    // Horn auto-clears
    feed.pushModule(CTS_MODULE.HORN, [' ']);
    parser.flush();

    // 4 state changes — horn-on, period, clock-reset, horn-off
    expect(updates.length).toBe(4);
    const last = parser.getState();
    expect(last.period).toBe(2);
    expect(last.clock).toBe('8:00');
    expect(last.horn).toBe(false);
  });
});

describe('CtsParser — protocol edge cases', () => {
  it('address byte mid-packet immediately closes the prior packet', () => {
    const { parser, feed } = makeParserAndFeed();
    // Open GAME_CLOCK with just 3 of the expected 5 bytes,
    // then hit it with HOME_SCORE address.
    const clockHalf = encodePacket(CTS_MODULE.GAME_CLOCK, ['7', ' ', '5']);
    const homeFull = encodePacket(CTS_MODULE.HOME_SCORE, [' ', '3']);
    feed.pushBytes(new Uint8Array([...clockHalf, ...homeFull]));
    parser.flush();

    // Clock got the 3 bytes it had; home score got its full burst.
    const s = parser.getState();
    expect(s.homeScore).toBe(3);
    // The half-packet should still produce a non-default clock —
    // the parser doesn't require all 5 bytes to commit. It just
    // formats whatever digits it got.
    expect(s.clock).not.toBe('0:00');
  });

  it('data bytes before any address byte are silently dropped', () => {
    const { parser, feed, updates } = makeParserAndFeed();
    // 4 garbage data bytes, no address byte.
    feed.pushBytes(new Uint8Array([0x01, 0x02, 0x03, 0x04]));
    parser.flush();
    expect(updates.length).toBe(0);
  });

  it('horn module emits exactly one update on the rising and one on the falling edge', () => {
    const { parser, feed, updates } = makeParserAndFeed();
    // Rising edge
    feed.pushModule(CTS_MODULE.HORN, ['1']);
    parser.flush();
    // Same state — no event
    feed.pushModule(CTS_MODULE.HORN, ['1']);
    parser.flush();
    // Falling edge
    feed.pushModule(CTS_MODULE.HORN, [' ']);
    parser.flush();
    expect(updates.length).toBe(2);
    expect(updates[0]?.horn).toBe(true);
    expect(updates[1]?.horn).toBe(false);
  });
});

describe('CtsParser — reset', () => {
  it('reset() restores defaults but keeps listeners attached', () => {
    const { parser, feed, updates } = makeParserAndFeed();
    feed.pushInitialState({ homeScore: 5, awayScore: 3 });
    parser.flush();
    const before = updates.length;

    parser.reset();
    expect(parser.getState().homeScore).toBe(0);
    expect(parser.getState().awayScore).toBe(0);

    // Listener still attached: a new packet should still fire.
    feed.pushModule(CTS_MODULE.HOME_SCORE, [' ', '1']);
    parser.flush();
    expect(updates.length).toBe(before + 1);
  });
});
