/**
 * CTS SWIMMING scoreboard-serial protocol tests (2026-07-01 swim/dive
 * DEPTH pass — docs/research/2026-06-30-swim-dive-scoreboards/
 * 00-REPORT.md part A7).
 *
 * This decoder targets a DIFFERENT wire format from the water-polo tests
 * in parser.test.ts / real-wire.test.ts (packed binary, module-addressed,
 * fixed payload length per module, no high-bit-set address convention).
 * There is no physical console to capture against yet, so these tests
 * exercise the decoder against the DOCUMENTED byte map (report A7 / the
 * cited marcoscorner.walther-family.org protocol writeup) using our own
 * encode helpers — the same "encode → feed → decode round-trip" strategy
 * MockCtsFeed uses for the water-polo decoder, which is how this whole
 * package proves correctness without hardware.
 */

import {
  SwimTimingParser,
  parseCtsSwimPackets,
  decodeLanePacket,
  decodeSplitPacket,
  decodeEventHeatPacket,
  decodeTeamScorePacket,
  decodeTimeBytes,
  laneModule,
  encodeLanePacket,
  encodeSplitPacket,
  encodeEventHeatPacket,
  encodeTeamScorePacket,
  concatPackets,
  type SwimTimingSnapshot,
} from '../swim-timing';

describe('laneModule', () => {
  it('maps lanes 1-10 to module addresses 0x01-0x0A', () => {
    for (let lane = 1; lane <= 10; lane++) {
      expect(laneModule(lane)).toBe(lane);
    }
  });

  it('maps lane 11 to 0x17 and lane 12 to 0x18 (report A7)', () => {
    expect(laneModule(11)).toBe(0x17);
    expect(laneModule(12)).toBe(0x18);
  });

  it('throws for an out-of-range lane', () => {
    expect(() => laneModule(0)).toThrow(RangeError);
    expect(() => laneModule(13)).toThrow(RangeError);
  });
});

describe('decodeTimeBytes', () => {
  it('decodes a normal time', () => {
    expect(decodeTimeBytes(1, 2, 34)).toEqual({ minutes: 1, seconds: 2, hundredths: 34, blank: false });
  });

  it('treats 0xFF in any field as blank (report A7 convention)', () => {
    expect(decodeTimeBytes(0xff, 0, 0)).toMatchObject({ blank: true });
    expect(decodeTimeBytes(0, 0xff, 0)).toMatchObject({ blank: true });
    expect(decodeTimeBytes(0, 0, 0xff)).toMatchObject({ blank: true });
  });

  it('zeroes out the numeric fields when blank so nothing downstream reads 255', () => {
    const d = decodeTimeBytes(0xff, 0xff, 0xff);
    expect(d).toEqual({ minutes: 0, seconds: 0, hundredths: 0, blank: true });
  });
});

describe('decodeLanePacket / encodeLanePacket round-trip', () => {
  it('decodes a sub-minute lane time with a place', () => {
    // Lane 3, place 1, 0 min, 52 sec, 18 hundredths → "52.18"
    const packet = encodeLanePacket(3, { place: 1, minutes: 0, seconds: 52, hundredths: 18 });
    const { packets } = parseCtsSwimPackets(packet);
    expect(packets).toHaveLength(1);
    const decoded = decodeLanePacket(3, packets[0].payload);
    expect(decoded).toEqual({
      lane: 3,
      place: 1,
      minutes: 0,
      seconds: 52,
      hundredths: 18,
      display: '52.18',
      blank: false,
    });
  });

  it('decodes a minutes-carrying time with M:SS.hh formatting', () => {
    // 1500m free lane: 15 min 22.05 sec.
    const packet = encodeLanePacket(4, { place: 0, minutes: 15, seconds: 22, hundredths: 5 });
    const { packets } = parseCtsSwimPackets(packet);
    const decoded = decodeLanePacket(4, packets[0].payload);
    expect(decoded.display).toBe('15:22.05');
    // place 0 = unplaced/still racing, NOT blank.
    expect(decoded.place).toBe(0);
    expect(decoded.blank).toBe(false);
  });

  it('renders an idle/no-swimmer lane as blank, not 255', () => {
    const packet = encodeLanePacket(8, { blank: true });
    const { packets } = parseCtsSwimPackets(packet);
    const decoded = decodeLanePacket(8, packets[0].payload);
    expect(decoded.blank).toBe(true);
    expect(decoded.display).toBe('');
    expect(decoded.minutes).toBe(0);
    expect(decoded.seconds).toBe(0);
    expect(decoded.hundredths).toBe(0);
  });

  it('treats a place byte of 0xFF or > 12 as unplaced (0)', () => {
    const raw = Uint8Array.from([0x05, 5, 0xff, 0, 45, 10]); // module 0x05, lane5, place=0xFF
    const { packets } = parseCtsSwimPackets(raw);
    const decoded = decodeLanePacket(5, packets[0].payload);
    expect(decoded.place).toBe(0);
  });

  it('decodes lanes 11 and 12 via their wrapped module addresses (0x17/0x18)', () => {
    const p11 = encodeLanePacket(11, { place: 2, minutes: 0, seconds: 48, hundredths: 90 });
    const p12 = encodeLanePacket(12, { place: 3, minutes: 0, seconds: 49, hundredths: 12 });
    expect(p11[0]).toBe(0x17);
    expect(p12[0]).toBe(0x18);
    const { packets } = parseCtsSwimPackets(concatPackets(p11, p12));
    expect(packets).toHaveLength(2);
    expect(decodeLanePacket(11, packets[0].payload).display).toBe('48.90');
    expect(decodeLanePacket(12, packets[1].payload).display).toBe('49.12');
  });
});

describe('decodeSplitPacket / encodeSplitPacket round-trip', () => {
  it('decodes a split-time packet for channel 0 (module 0x19)', () => {
    const packet = encodeSplitPacket(0, 3, { minutes: 0, seconds: 25, hundredths: 40 });
    expect(packet[0]).toBe(0x19);
    const { packets } = parseCtsSwimPackets(packet);
    const decoded = decodeSplitPacket(0, packets[0].payload);
    expect(decoded).toEqual({ channel: 0, minutes: 0, seconds: 25, hundredths: 40, display: '25.40', blank: false });
  });

  it('decodes all 6 split channels (modules 0x19-0x1E, report A7)', () => {
    const pkts = [0, 1, 2, 3, 4, 5].map((ch) => encodeSplitPacket(ch, 1, { seconds: 20 + ch, hundredths: 0 }));
    for (let i = 0; i < 6; i++) {
      expect(pkts[i][0]).toBe(0x19 + i);
    }
    const { packets } = parseCtsSwimPackets(concatPackets(...pkts));
    expect(packets).toHaveLength(6);
    packets.forEach((pkt, i) => {
      const decoded = decodeSplitPacket(i, pkt.payload);
      expect(decoded.seconds).toBe(20 + i);
    });
  });

  it('rejects an out-of-range split channel at encode time', () => {
    expect(() => encodeSplitPacket(6, 1, {})).toThrow(RangeError);
    expect(() => encodeSplitPacket(-1, 1, {})).toThrow(RangeError);
  });
});

describe('decodeEventHeatPacket / encodeEventHeatPacket round-trip (module 0x0C)', () => {
  it('decodes a 2-digit event number and heat', () => {
    const packet = encodeEventHeatPacket(12, 3);
    expect(packet[0]).toBe(0x0c);
    const { packets } = parseCtsSwimPackets(packet);
    expect(decodeEventHeatPacket(packets[0].payload)).toEqual({ eventNumber: 12, heat: 3 });
  });

  it('decodes a 3-digit event number packed as hi*100+lo', () => {
    // Event 247 → hi=2, lo=47.
    const packet = encodeEventHeatPacket(247, 9);
    const { packets } = parseCtsSwimPackets(packet);
    expect(decodeEventHeatPacket(packets[0].payload)).toEqual({ eventNumber: 247, heat: 9 });
  });

  it('clamps event numbers above 999 at encode time (3-digit wire limit)', () => {
    const packet = encodeEventHeatPacket(1500, 1);
    const { packets } = parseCtsSwimPackets(packet);
    expect(decodeEventHeatPacket(packets[0].payload).eventNumber).toBe(999);
  });
});

describe('decodeTeamScorePacket / encodeTeamScorePacket round-trip (module 0x0D)', () => {
  it('decodes a dual-meet running score', () => {
    const packet = encodeTeamScorePacket(88, 76);
    expect(packet[0]).toBe(0x0d);
    const { packets } = parseCtsSwimPackets(packet);
    expect(decodeTeamScorePacket(packets[0].payload)).toEqual({ homeScore: 88, awayScore: 76 });
  });

  it('decodes 3-digit championship-meet team totals', () => {
    const packet = encodeTeamScorePacket(412, 398);
    const { packets } = parseCtsSwimPackets(packet);
    expect(decodeTeamScorePacket(packets[0].payload)).toEqual({ homeScore: 412, awayScore: 398 });
  });
});

describe('parseCtsSwimPackets — stream framing', () => {
  it('extracts multiple packets from one concatenated stream (a full heat burst)', () => {
    const stream = concatPackets(
      encodeEventHeatPacket(12, 3),
      encodeLanePacket(1, { place: 0, seconds: 55, hundredths: 42 }),
      encodeLanePacket(2, { place: 2, seconds: 52, hundredths: 18 }),
      encodeLanePacket(3, { place: 1, seconds: 51, hundredths: 90 }),
    );
    const { packets, remainder } = parseCtsSwimPackets(stream);
    expect(packets).toHaveLength(4);
    expect(remainder).toHaveLength(0);
    expect(packets[0].module).toBe(0x0c);
    expect(packets[1].module).toBe(0x01);
    expect(packets[2].module).toBe(0x02);
    expect(packets[3].module).toBe(0x03);
  });

  it('leaves an incomplete trailing packet in the remainder (mid-chunk boundary)', () => {
    const full = encodeLanePacket(1, { seconds: 30, hundredths: 0 });
    // Feed only the module byte + 2 of 5 payload bytes.
    const partial = full.slice(0, 3);
    const { packets, remainder } = parseCtsSwimPackets(partial);
    expect(packets).toHaveLength(0);
    expect(remainder).toEqual(Array.from(partial));
  });

  it('resyncs past an unknown module address (report A7: 0x0B pool-records, 0x16 time-of-day) without stalling', () => {
    // 0x0B (pool records) and 0x16 (time-of-day) are documented modules
    // with no entry in PAYLOAD_LEN (unhandled length) — the framer must
    // skip past them one byte at a time rather than stall. Use noise
    // bytes ALL outside every known module address range (0x01-0x0D,
    // 0x17-0x18, 0x19-0x1E) so none of them is misread as a fresh packet
    // start once resync begins.
    const stream = concatPackets(
      Uint8Array.from([0x0b, 0x40, 0x41, 0x42, 0x43, 0x16, 0x44, 0x45]), // arbitrary noise, unknown addresses
      encodeLanePacket(2, { seconds: 55, hundredths: 42 }),
    );
    const { packets } = parseCtsSwimPackets(stream);
    // The lane packet downstream of the noise still decodes — resync
    // advanced past the unknown bytes one at a time until it found 0x02.
    const lanePkt = packets.find((p) => p.module === 0x02);
    expect(lanePkt).toBeDefined();
    expect(decodeLanePacket(2, lanePkt!.payload).display).toBe('55.42');
  });

  it('never throws on a stream of pure noise', () => {
    const noise = Uint8Array.from(Array.from({ length: 50 }, (_, i) => (i * 37) % 256));
    expect(() => parseCtsSwimPackets(noise)).not.toThrow();
  });
});

describe('SwimTimingParser — stateful accumulation', () => {
  function makeParser() {
    const parser = new SwimTimingParser();
    const updates: SwimTimingSnapshot[] = [];
    parser.onUpdate((s) => updates.push(s));
    return { parser, updates };
  }

  it('starts with an empty snapshot', () => {
    const { parser } = makeParser();
    const state = parser.getState();
    expect(state.lanes).toEqual({});
    expect(state.splits).toEqual({});
    expect(state.eventHeat).toBeNull();
    expect(state.teamScore).toBeNull();
    expect(state.receivedAt).toBe(0);
  });

  it('accumulates lane state across separate feed() calls (byte-at-a-time serial simulation)', () => {
    const { parser, updates } = makeParser();
    const packet = encodeLanePacket(4, { place: 1, seconds: 51, hundredths: 90 });
    // Feed one byte at a time — the real serial-port ReadableStream shape.
    for (const b of packet) parser.feed([b]);
    const state = parser.getState();
    expect(state.lanes[4]).toMatchObject({ lane: 4, place: 1, display: '51.90' });
    expect(updates.length).toBeGreaterThan(0);
    expect(state.receivedAt).toBeGreaterThan(0);
  });

  it('does not emit an update when a packet repeats the same values', () => {
    const { parser, updates } = makeParser();
    const packet = encodeLanePacket(1, { place: 0, seconds: 30, hundredths: 0 });
    parser.feed(packet);
    const countAfterFirst = updates.length;
    parser.feed(packet); // identical retransmit — idle modules do this
    expect(updates.length).toBe(countAfterFirst);
  });

  it('tracks a full heat: event/heat header + 8 lanes + splits + team score', () => {
    const { parser } = makeParser();
    const stream = concatPackets(
      encodeEventHeatPacket(12, 3),
      encodeLanePacket(1, { place: 0, seconds: 55, hundredths: 42 }),
      encodeLanePacket(2, { place: 2, seconds: 52, hundredths: 18 }),
      encodeLanePacket(3, { place: 1, seconds: 51, hundredths: 90 }),
      encodeLanePacket(4, { blank: true }),
      encodeSplitPacket(0, 3, { seconds: 25, hundredths: 40 }),
      encodeTeamScorePacket(88, 76),
    );
    parser.feed(stream);
    const state = parser.getState();
    expect(state.eventHeat).toEqual({ eventNumber: 12, heat: 3 });
    expect(state.lanes[1].display).toBe('55.42');
    expect(state.lanes[2].place).toBe(2);
    expect(state.lanes[3].place).toBe(1);
    expect(state.lanes[4].blank).toBe(true);
    expect(state.splits[0].display).toBe('25.40');
    expect(state.teamScore).toEqual({ homeScore: 88, awayScore: 76 });
  });

  it('a DQ / non-numeric outcome is representable as a blank lane with no place (no fabricated time)', () => {
    // The scoreboard-serial protocol has no dedicated "DQ" bit — a
    // disqualified lane simply never gets a valid finish time. The
    // normalizer layer (SwimTimingFeed) is responsible for turning
    // "blank + heat over" into a DQ mark; the parser's job stops at
    // "this lane never posted a valid time," which this proves.
    const { parser } = makeParser();
    parser.feed(encodeLanePacket(7, { blank: true }));
    const state = parser.getState();
    expect(state.lanes[7]).toMatchObject({ place: 0, blank: true, display: '' });
  });

  it('reset() clears all accumulated state', () => {
    const { parser } = makeParser();
    parser.feed(encodeLanePacket(1, { seconds: 30, hundredths: 0 }));
    expect(Object.keys(parser.getState().lanes)).toHaveLength(1);
    parser.reset();
    expect(parser.getState().lanes).toEqual({});
  });

  it('getState() returns a defensive copy (mutating it does not affect the parser)', () => {
    const { parser } = makeParser();
    parser.feed(encodeLanePacket(1, { seconds: 30, hundredths: 0 }));
    const snap = parser.getState();
    delete (snap.lanes as any)[1];
    expect(parser.getState().lanes[1]).toBeDefined();
  });

  it('a listener that throws does not crash the parser or block other listeners', () => {
    const { parser } = makeParser();
    let secondCalled = false;
    parser.onUpdate(() => {
      throw new Error('boom');
    });
    parser.onUpdate(() => {
      secondCalled = true;
    });
    expect(() => parser.feed(encodeLanePacket(1, { seconds: 30, hundredths: 0 }))).not.toThrow();
    expect(secondCalled).toBe(true);
  });

  it('unsubscribing via the onUpdate() return value stops further callbacks', () => {
    const { parser } = makeParser();
    let calls = 0;
    const unsub = parser.onUpdate(() => { calls++; });
    parser.feed(encodeLanePacket(1, { seconds: 30, hundredths: 0 }));
    unsub();
    parser.feed(encodeLanePacket(1, { seconds: 31, hundredths: 0 }));
    expect(calls).toBe(1);
  });
});
