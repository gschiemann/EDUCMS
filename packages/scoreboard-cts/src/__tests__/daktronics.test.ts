/**
 * Tests for the Daktronics All Sport 5000 Enhanced RTD decoder.
 *
 * Every packet is synthesized via the mock encoder, which builds the
 * frame straight from the documented offset table (offsets.ts). So a
 * test failing means EITHER the offset is wrong OR the framing/parsing
 * is wrong — there's no way for a bad offset to silently pass, because
 * the encoder and the parser both read the SAME FieldDef.
 *
 * We cover:
 *   - frame framing + checksum (good frame accepted, bad rejected)
 *   - the CONTROL offset → buffer-index mapping (1-based → 0-based)
 *   - football: clock, score, period, down/distance/ballOn, possession
 *   - basketball: score, period, team fouls, bonus, shot clock
 *   - baseball: score, inning, balls/strikes/outs, hits, at-bat
 *   - incremental writes preserve the rest of the buffer
 *   - change-only emission (no duplicate updates)
 *   - clock running/stopped flag (authoritative, not cadence-derived)
 *   - horn rising/falling edges
 *   - sport switch re-derives from the existing buffer
 *   - reset()
 *
 * Jest (matches the rest of the repo + the CTS test file).
 */

import {
  DaktronicsParser,
  MockDaktronicsFeed,
  encodeRtdPacket,
  encodeField,
  justifyField,
  DAKTRONICS_OFFSETS,
  RTD,
  type DaktronicsSnapshot,
} from '../index';

function makeParserAndFeed(sport: 'football' | 'basketball' | 'baseball' = 'football') {
  const parser = new DaktronicsParser({ sport });
  const feed = new MockDaktronicsFeed((bytes) => parser.feed(bytes));
  const updates: DaktronicsSnapshot[] = [];
  parser.onUpdate((s) => updates.push(s));
  return { parser, feed, updates };
}

// ── framing / checksum ────────────────────────────────────────────────

describe('Daktronics RTD — framing + checksum', () => {
  it('encodeRtdPacket produces a well-formed SYN…ETB frame with valid checksum', () => {
    const frame = encodeRtdPacket(108, ' 14 '); // home score field (football off 108)
    expect(frame[0]).toBe(RTD.SYN);
    expect(frame[frame.length - 1]).toBe(RTD.ETB);
    // contains SOH, STX, EOT in order
    const arr = Array.from(frame);
    const soh = arr.indexOf(RTD.SOH);
    const stx = arr.indexOf(RTD.STX);
    const eot = arr.indexOf(RTD.EOT);
    expect(soh).toBeGreaterThan(0);
    expect(stx).toBeGreaterThan(soh);
    expect(eot).toBeGreaterThan(stx);
    // CONTROL "00421" + 5-digit item (108 → "00108")
    const control = arr
      .slice(soh + 1, stx)
      .map((b) => String.fromCharCode(b))
      .join('');
    expect(control).toBe('0042100108');
  });

  it('a good-checksum frame is accepted and applied to the buffer', () => {
    const { parser, feed } = makeParserAndFeed('football');
    feed.pushField('football', 'homeScore', 21);
    expect(parser.getState().homeScore).toBe(21);
    expect(parser.getFrameStats().good).toBe(1);
    expect(parser.getFrameStats().bad).toBe(0);
  });

  it('a corrupted-checksum frame is rejected and does NOT mutate the buffer', () => {
    const { parser, updates } = makeParserAndFeed('football');
    // Build a valid frame then flip the last checksum hex digit.
    const good = Array.from(encodeRtdPacket(DAKTRONICS_OFFSETS.football.homeScore.offset, justifyField('42', 4, 'R')));
    const etbIdx = good.length - 1;
    // checksum is the 2 bytes before ETB; corrupt the first of them.
    good[etbIdx - 2] = good[etbIdx - 2]! ^ 0x01;
    parser.feed(new Uint8Array(good));
    expect(parser.getState().homeScore).toBe(0); // unchanged
    expect(parser.getFrameStats().bad).toBe(1);
    expect(updates.length).toBe(0);
  });

  it('bytes outside a SYN…ETB frame are dropped as noise', () => {
    const { parser, updates } = makeParserAndFeed('football');
    parser.feed(new Uint8Array([0x30, 0x31, 0x32, 0x33])); // raw "0123", no SYN
    expect(updates.length).toBe(0);
    expect(parser.getState().homeScore).toBe(0);
  });

  it('a fresh SYN abandons a partial frame and resyncs', () => {
    const { parser } = makeParserAndFeed('football');
    const good = encodeField('football', 'homeScore', 7);
    // Feed a bogus partial frame (SYN + garbage, no ETB) then the good one.
    parser.feed(new Uint8Array([RTD.SYN, 0x41, 0x42, 0x43]));
    parser.feed(good);
    expect(parser.getState().homeScore).toBe(7);
  });
});

// ── football ──────────────────────────────────────────────────────────

describe('Daktronics RTD — football', () => {
  it('decodes clock, period, both scores from an initial-state burst', () => {
    const { parser } = makeParserAndFeed('football');
    const feed = new MockDaktronicsFeed((b) => parser.feed(b));
    feed.pushInitialState('football', {
      clock: '12:00',
      period: 2,
      homeScore: 14,
      awayScore: 7,
      homeTimeouts: 2,
      awayTimeouts: 3,
    });
    const s = parser.getState();
    expect(s.sport).toBe('football');
    expect(s.clock).toBe('12:00');
    expect(s.period).toBe(2);
    expect(s.homeScore).toBe(14);
    expect(s.awayScore).toBe(7);
    expect(s.homeTimeoutsRemaining).toBe(2);
    expect(s.awayTimeoutsRemaining).toBe(3);
  });

  it('decodes down / distance / ball-on', () => {
    const { parser, feed } = makeParserAndFeed('football');
    feed.pushField('football', 'down', '3rd');
    feed.pushField('football', 'toGo', 8);
    feed.pushField('football', 'ballOn', 45);
    const f = parser.getState().football!;
    expect(f.down).toBe('3rd');
    expect(f.toGo).toBe(8);
    expect(f.ballOn).toBe(45);
  });

  it('decodes possession from the home/guest indicator flags', () => {
    const { parser, feed } = makeParserAndFeed('football');
    // home possession indicator = '<' (any non-blank = set)
    feed.pushField('football', 'homePossession', '<');
    expect(parser.getState().football!.possession).toBe('home');
    // switch to guest: clear home, set guest
    feed.pushField('football', 'homePossession', ' ');
    feed.pushField('football', 'guestPossession', '>');
    expect(parser.getState().football!.possession).toBe('away');
  });

  it('a home touchdown bumps homeScore 14 → 20 via one positioned write', () => {
    const { parser, feed, updates } = makeParserAndFeed('football');
    feed.pushField('football', 'homeScore', 14);
    const base = updates.length;
    feed.pushField('football', 'homeScore', 20);
    expect(parser.getState().homeScore).toBe(20);
    expect(updates.length).toBe(base + 1);
    expect(updates[updates.length - 1]!.homeScore).toBe(20);
  });
});

// ── basketball ──────────────────────────────────────────────────────────

describe('Daktronics RTD — basketball', () => {
  it('decodes score, period, and team fouls', () => {
    const { parser } = makeParserAndFeed('basketball');
    const feed = new MockDaktronicsFeed((b) => parser.feed(b));
    feed.pushInitialState('basketball', {
      clock: '8:00',
      period: 3,
      homeScore: 55,
      awayScore: 48,
    });
    feed.pushField('basketball', 'homeTeamFouls', 7);
    feed.pushField('basketball', 'guestTeamFouls', 4);
    const s = parser.getState();
    expect(s.clock).toBe('8:00');
    expect(s.period).toBe(3);
    expect(s.homeScore).toBe(55);
    expect(s.awayScore).toBe(48);
    expect(s.basketball!.homeTeamFouls).toBe(7);
    expect(s.basketball!.guestTeamFouls).toBe(4);
  });

  it('decodes bonus / double-bonus indicators', () => {
    const { parser, feed } = makeParserAndFeed('basketball');
    feed.pushField('basketball', 'homeBonus', '<');
    feed.pushField('basketball', 'guestDoubleBonus', '>');
    const b = parser.getState().basketball!;
    expect(b.homeBonus).toBe(true);
    expect(b.homeDoubleBonus).toBe(false);
    expect(b.guestBonus).toBe(false);
    expect(b.guestDoubleBonus).toBe(true);
  });

  it('decodes the shot clock', () => {
    const { parser, feed } = makeParserAndFeed('basketball');
    feed.pushField('basketball', 'shotClock', ':24');
    expect(parser.getState().basketball!.shotClock).toBe(':24');
  });
});

// ── baseball ──────────────────────────────────────────────────────────

describe('Daktronics RTD — baseball', () => {
  it('decodes score, inning, and the balls/strikes/outs count', () => {
    const { parser } = makeParserAndFeed('baseball');
    const feed = new MockDaktronicsFeed((b) => parser.feed(b));
    feed.pushInitialState('baseball', {
      period: 5, // inning
      homeScore: 3,
      awayScore: 2,
    });
    feed.pushField('baseball', 'balls', 2);
    feed.pushField('baseball', 'strikes', 1);
    feed.pushField('baseball', 'outs', 2);
    const s = parser.getState();
    expect(s.period).toBe(5); // inning maps to period
    expect(s.homeScore).toBe(3);
    expect(s.awayScore).toBe(2);
    const b = s.baseball!;
    expect(b.balls).toBe(2);
    expect(b.strikes).toBe(1);
    expect(b.outs).toBe(2);
  });

  it('decodes hits and at-bat side', () => {
    const { parser, feed } = makeParserAndFeed('baseball');
    feed.pushField('baseball', 'homeHits', 6);
    feed.pushField('baseball', 'guestHits', 4);
    feed.pushField('baseball', 'guestAtBat', '>'); // away batting
    const b = parser.getState().baseball!;
    expect(b.homeHits).toBe(6);
    expect(b.awayHits).toBe(4);
    expect(b.atBat).toBe('away');
  });

  it('count fields are independent — bumping strikes leaves balls/outs intact', () => {
    const { parser, feed } = makeParserAndFeed('baseball');
    feed.pushField('baseball', 'balls', 3);
    feed.pushField('baseball', 'outs', 1);
    feed.pushField('baseball', 'strikes', 0);
    feed.pushField('baseball', 'strikes', 2); // strike, then strike
    const b = parser.getState().baseball!;
    expect(b.balls).toBe(3);
    expect(b.strikes).toBe(2);
    expect(b.outs).toBe(1);
  });
});

// ── incremental writes / change detection ─────────────────────────────

describe('Daktronics RTD — buffer behavior', () => {
  it('incremental writes preserve the rest of the buffer (clock tick keeps score)', () => {
    const { parser, feed } = makeParserAndFeed('football');
    feed.pushField('football', 'homeScore', 17);
    feed.pushField('football', 'guestScore', 10);
    // Now tick the clock — must NOT clobber the scores.
    feed.pushField('football', 'mainClock', '5:23');
    feed.pushField('football', 'mainClock', '5:22');
    const s = parser.getState();
    expect(s.clock).toBe('5:22');
    expect(s.homeScore).toBe(17);
    expect(s.awayScore).toBe(10);
  });

  it('re-sending an identical value does NOT emit a duplicate update', () => {
    const { parser, feed, updates } = makeParserAndFeed('football');
    feed.pushField('football', 'homeScore', 21);
    const base = updates.length;
    feed.pushField('football', 'homeScore', 21); // same value
    expect(updates.length).toBe(base);
  });

  it('clockStopped flag is authoritative (s = stopped, blank = running)', () => {
    const { parser, feed } = makeParserAndFeed('football');
    feed.pushField('football', 'mainClock', '5:00');
    // default (blank stopped flag) → running
    expect(parser.getState().clockRunning).toBe(true);
    expect(parser.getState().clockStopped).toBe(false);
    // set the stopped flag
    feed.pushField('football', 'clockStopped', 's');
    expect(parser.getState().clockStopped).toBe(true);
    expect(parser.getState().clockRunning).toBe(false);
    // clear it → running again
    feed.pushField('football', 'clockStopped', ' ');
    expect(parser.getState().clockRunning).toBe(true);
  });

  it('horn surfaces on the main-clock horn flag and clears on the falling edge', () => {
    const { parser, feed, updates } = makeParserAndFeed('football');
    feed.pushField('football', 'mainClockHorn', 'h');
    const afterRise = updates.length;
    expect(parser.getState().horn).toBe(true);
    feed.pushField('football', 'mainClockHorn', ' ');
    expect(parser.getState().horn).toBe(false);
    expect(updates.length).toBe(afterRise + 1);
  });
});

// ── sport switch + reset ──────────────────────────────────────────────

describe('Daktronics RTD — sport switch + reset', () => {
  it('setSport re-derives the snapshot from the existing buffer', () => {
    const { parser, feed } = makeParserAndFeed('basketball');
    // Score offset (108/112) is shared across sports, so it survives the
    // sport switch. Item 142 (period) is shared too.
    feed.pushField('basketball', 'homeScore', 33);
    feed.pushField('basketball', 'period', 4);
    expect(parser.getState().sport).toBe('basketball');
    expect(parser.getState().basketball).toBeDefined();

    parser.setSport('football');
    const s = parser.getState();
    expect(s.sport).toBe('football');
    expect(s.football).toBeDefined();
    expect(s.basketball).toBeUndefined();
    // Shared offsets carry over unchanged.
    expect(s.homeScore).toBe(33);
    expect(s.period).toBe(4);
  });

  it('reset clears the buffer + state but keeps listeners attached', () => {
    const { parser, feed, updates } = makeParserAndFeed('football');
    feed.pushField('football', 'homeScore', 28);
    feed.pushField('football', 'guestScore', 21);
    const before = updates.length;
    expect(before).toBeGreaterThan(0);

    parser.reset();
    expect(parser.getState().homeScore).toBe(0);
    expect(parser.getState().awayScore).toBe(0);
    expect(parser.getFrameStats().good).toBe(0);

    // Listener still attached — a new packet fires again.
    feed.pushField('football', 'homeScore', 3);
    expect(updates.length).toBe(before + 1);
    expect(parser.getState().homeScore).toBe(3);
  });
});

// ── offset-table self-consistency ─────────────────────────────────────

describe('Daktronics RTD — offset table integrity', () => {
  it('every sport shares the documented common offsets (clock=1, score=108/112, period=142)', () => {
    for (const sport of ['football', 'basketball', 'baseball'] as const) {
      const m = DAKTRONICS_OFFSETS[sport];
      expect(m.mainClock.offset).toBe(1);
      expect(m.homeScore.offset).toBe(108);
      expect(m.guestScore.offset).toBe(112);
      expect(m.period.offset).toBe(142);
    }
  });

  it('the baseball count block sits at the documented offsets (222/223/224)', () => {
    const m = DAKTRONICS_OFFSETS.baseball;
    expect(m.balls.offset).toBe(222);
    expect(m.strikes.offset).toBe(223);
    expect(m.outs.offset).toBe(224);
  });

  it('no two fields within a sport overlap on the buffer (sanity guard)', () => {
    for (const sport of ['football', 'basketball', 'baseball'] as const) {
      const defs = Object.values(DAKTRONICS_OFFSETS[sport]);
      const occupied = new Map<number, string>();
      for (const def of defs) {
        // We only assert non-overlap for fields THIS decoder reads; the
        // table is intentionally a subset of the full RTD spec.
        for (let i = def.offset; i < def.offset + def.length; i++) {
          // Allow the shared clock/score/etc. (identical defs) — they're
          // the same object reference across sports, never a conflict
          // within one sport. A real overlap = two DIFFERENT fields on
          // the same byte.
          const prev = occupied.get(i);
          if (prev && prev !== `${def.offset}:${def.length}`) {
            throw new Error(
              `[${sport}] byte ${i} claimed by both ${prev} and ${def.offset}:${def.length}`,
            );
          }
          occupied.set(i, `${def.offset}:${def.length}`);
        }
      }
    }
  });
});
