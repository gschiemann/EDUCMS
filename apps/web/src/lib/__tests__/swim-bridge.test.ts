/**
 * swim-bridge pure-glue tests (Inputs-wave SWIM, 2026-08-10).
 *
 * Fixtures are BYTE-ACCURATE: built with `@cms/scoreboard-cts`'s own
 * encoders (each the exact inverse of its decoder — that round-trip is
 * proven in the package's own suite), then run through the REAL
 * `parseCtsSwimPackets` / `SwimTimingParser`. Only the glue under test
 * lives in this repo's web app; the decoder is exercised as a black box.
 *
 * (Static import of `@cms/scoreboard-cts` is fine HERE — tests are never
 * bundled. The dashboard bundle rule applies to `src/lib/swim-bridge.ts`
 * itself, which is why that module takes the package's functions by
 * injection and these tests are the ones that wire the real ones in.)
 */

import {
  SwimTimingParser,
  parseCtsSwimPackets,
  laneModule,
  encodeLanePacket,
  encodeSplitPacket,
  encodeEventHeatPacket,
  encodeTeamScorePacket,
  concatPackets,
  type SwimTimingSnapshot,
} from '@cms/scoreboard-cts';

import {
  CONSISTENT_SNAPSHOTS_REQUIRED,
  LaneByteFilter,
  SnapshotConsistencyGate,
  SwimPostScheduler,
  SWIM_POST_MAX_INTERVAL_MS,
  SWIM_POST_MIN_INTERVAL_MS,
  buildModuleLaneMap,
  isPlausibleSnapshot,
  nextPostInterval,
  resolveBaudRate,
  summarizeSnapshot,
} from '../swim-bridge';

function emptySnapshot(): SwimTimingSnapshot {
  return { lanes: {}, splits: {}, eventHeat: null, teamScore: null, receivedAt: 0 };
}

/** Decode a byte stream through the real parser and return the final state. */
function decode(bytes: Uint8Array | number[]): SwimTimingSnapshot {
  const parser = new SwimTimingParser();
  parser.feed(bytes);
  return parser.getState();
}

describe('nextPostInterval — 429 backoff calculator', () => {
  it('doubles on 429 up to the 2s ceiling', () => {
    let ms = SWIM_POST_MIN_INTERVAL_MS; // 250
    ms = nextPostInterval(ms, { ok: false, rateLimited: true });
    expect(ms).toBe(500);
    ms = nextPostInterval(ms, { ok: false, rateLimited: true });
    expect(ms).toBe(1000);
    ms = nextPostInterval(ms, { ok: false, rateLimited: true });
    expect(ms).toBe(2000);
    ms = nextPostInterval(ms, { ok: false, rateLimited: true });
    expect(ms).toBe(SWIM_POST_MAX_INTERVAL_MS); // capped
  });

  it('decays back toward the 250ms floor on success', () => {
    let ms = SWIM_POST_MAX_INTERVAL_MS; // 2000
    ms = nextPostInterval(ms, { ok: true });
    expect(ms).toBe(1000);
    ms = nextPostInterval(ms, { ok: true });
    expect(ms).toBe(500);
    ms = nextPostInterval(ms, { ok: true });
    expect(ms).toBe(250);
    ms = nextPostInterval(ms, { ok: true });
    expect(ms).toBe(SWIM_POST_MIN_INTERVAL_MS); // floored
  });

  it('leaves the interval unchanged on a network error (not a pacing signal)', () => {
    expect(nextPostInterval(500, { ok: false })).toBe(500);
  });
});

describe('SwimPostScheduler — latest-wins throttle', () => {
  it('releases the first snapshot immediately', () => {
    const s = new SwimPostScheduler<string>();
    s.offer('a');
    expect(s.msUntilDue(1000)).toBe(0);
    expect(s.takeIfDue(1000)).toBe('a');
    expect(s.hasPending).toBe(false);
  });

  it('keeps only the newest pending snapshot (latest wins)', () => {
    const s = new SwimPostScheduler<string>();
    s.offer('a');
    s.offer('b');
    s.offer('c');
    expect(s.takeIfDue(0)).toBe('c');
    expect(s.takeIfDue(10_000)).toBeNull(); // nothing left — a/b dropped
  });

  it('enforces ≥250ms between takes (the 40/10s = 4Hz server budget)', () => {
    const s = new SwimPostScheduler<string>();
    s.offer('a');
    expect(s.takeIfDue(0)).toBe('a');
    s.offer('b');
    expect(s.takeIfDue(100)).toBeNull(); // 100ms elapsed — not due
    expect(s.msUntilDue(100)).toBe(150);
    expect(s.takeIfDue(250)).toBe('b'); // exactly at the boundary
  });

  it('doubles the spacing after a 429 and decays back after successes', () => {
    const s = new SwimPostScheduler<string>();
    s.offer('a');
    const a = s.takeIfDue(0)!;
    s.onResult(a, { ok: false, rateLimited: true });
    expect(s.intervalMs).toBe(500);
    // The failed snapshot was re-queued; not due again until t=500.
    expect(s.takeIfDue(300)).toBeNull();
    expect(s.takeIfDue(500)).toBe('a');
    s.onResult('a', { ok: true });
    expect(s.intervalMs).toBe(250); // decayed straight back to the floor
  });

  it('re-queues a failed snapshot only when nothing newer superseded it', () => {
    const s = new SwimPostScheduler<string>();
    s.offer('a');
    const a = s.takeIfDue(0)!;
    s.offer('b'); // newer state arrived while the POST was in flight
    s.onResult(a, { ok: false }); // network error on 'a'
    expect(s.takeIfDue(1000)).toBe('b'); // newer wins; 'a' is NOT resurrected
    // …but with no newer snapshot, the failed one IS retried (the last
    // state of a race must survive a transient blip).
    const b = 'b';
    s.onResult(b, { ok: false });
    expect(s.hasPending).toBe(true);
    expect(s.takeIfDue(10_000)).toBe('b');
  });
});

describe('isPlausibleSnapshot', () => {
  it('accepts a realistic decoded heat', () => {
    const snap = decode(
      concatPackets(
        encodeEventHeatPacket(12, 3),
        encodeLanePacket(1, { place: 1, minutes: 1, seconds: 52, hundredths: 31 }),
        encodeLanePacket(4, { blank: true }),
        encodeSplitPacket(0, 3, { seconds: 25, hundredths: 40 }),
        encodeTeamScorePacket(88, 76),
      ),
    );
    expect(isPlausibleSnapshot(snap)).toBe(true);
  });

  it('rejects out-of-range time fields (the mis-framed-decode signature)', () => {
    // A real console never sends seconds > 59; a mis-framed join does.
    const snap = decode(encodeLanePacket(3, { seconds: 200 }));
    expect(snap.lanes[3].seconds).toBe(200); // the decoder itself is permissive…
    expect(isPlausibleSnapshot(snap)).toBe(false); // …the gate is not
  });

  it('rejects out-of-range hundredths and event numbers on handcrafted state', () => {
    const bad1 = emptySnapshot();
    bad1.lanes[2] = {
      lane: 2, place: 0, minutes: 0, seconds: 30, hundredths: 250, display: '', blank: false,
    };
    expect(isPlausibleSnapshot(bad1)).toBe(false);

    const bad2 = emptySnapshot();
    bad2.eventHeat = { eventNumber: 5000, heat: 1 };
    expect(isPlausibleSnapshot(bad2)).toBe(false);

    const ok = emptySnapshot();
    ok.eventHeat = { eventNumber: 999, heat: 99 };
    expect(isPlausibleSnapshot(ok)).toBe(true);
  });
});

describe('SnapshotConsistencyGate — 2-consecutive rule before the first POST', () => {
  const good = () => decode(encodeLanePacket(1, { place: 1, seconds: 51, hundredths: 90 }));
  const bad = () => decode(encodeLanePacket(3, { seconds: 200 }));

  it('holds the first snapshot, opens on the second consistent one, then stays open', () => {
    const gate = new SnapshotConsistencyGate();
    expect(CONSISTENT_SNAPSHOTS_REQUIRED).toBe(2);
    expect(gate.offer(good())).toBe('waiting'); // 1/2 — no POST yet
    expect(gate.open).toBe(false);
    expect(gate.offer(good())).toBe('open'); // 2/2 — first POST allowed
    expect(gate.open).toBe(true);
    // Once open, even an implausible snapshot no longer closes it (the
    // server sanitizer owns post-open noise; resetting would blank the board).
    expect(gate.offer(bad())).toBe('open');
  });

  it('resets the streak on an implausible decode and reports the reject', () => {
    const gate = new SnapshotConsistencyGate();
    expect(gate.offer(good())).toBe('waiting');
    expect(gate.offer(bad())).toBe('reject'); // caller must parser.reset()
    expect(gate.rejectedCount).toBe(1);
    expect(gate.progress).toBe(0); // streak restarted
    expect(gate.offer(good())).toBe('waiting');
    expect(gate.offer(good())).toBe('open');
  });
});

describe('buildModuleLaneMap', () => {
  it('inverts the package laneModule mapping including the 11/12 wrap', () => {
    const map = buildModuleLaneMap(laneModule);
    expect(map.get(0x01)).toBe(1);
    expect(map.get(0x0a)).toBe(10);
    expect(map.get(0x17)).toBe(11);
    expect(map.get(0x18)).toBe(12);
    expect(map.size).toBe(12);
    expect(map.has(0x0c)).toBe(false); // event/heat is not a lane module
  });
});

describe('LaneByteFilter — payload[0] vs module-address cross-check', () => {
  const makeFilter = () => new LaneByteFilter(parseCtsSwimPackets, buildModuleLaneMap(laneModule));

  it('passes a clean stream through byte-identically', () => {
    const filter = makeFilter();
    const stream = concatPackets(
      encodeEventHeatPacket(12, 3),
      encodeLanePacket(2, { place: 2, seconds: 52, hundredths: 18 }),
      encodeSplitPacket(1, 4, { seconds: 26, hundredths: 11 }),
      encodeTeamScorePacket(10, 7),
    );
    expect(filter.filter(stream)).toEqual(Array.from(stream));
    expect(filter.droppedCount).toBe(0);
  });

  it('drops a lane packet whose payload lane byte contradicts its module address', () => {
    const filter = makeFilter();
    const corrupted = Uint8Array.from(encodeLanePacket(5, { place: 1, seconds: 30, hundredths: 5 }));
    corrupted[1] = 9; // payload[0]: claims lane 9 inside the lane-5 module packet
    const clean = encodeLanePacket(2, { place: 2, seconds: 31, hundredths: 44 });
    const out = filter.filter(concatPackets(corrupted, clean));
    expect(out).toEqual(Array.from(clean)); // only the clean packet survives
    expect(filter.droppedCount).toBe(1);
    // And the parser fed from the filter never sees lane 5.
    const parser = new SwimTimingParser();
    parser.feed(out);
    expect(parser.getState().lanes[5]).toBeUndefined();
    expect(parser.getState().lanes[2]?.display).toBe('31.44');
  });

  it('does NOT validate split packets (channel↔lane pairing is venue DIP-switch config)', () => {
    const filter = makeFilter();
    // Split channel 0 carrying lane byte 7 — unverifiable, must pass through.
    const split = encodeSplitPacket(0, 7, { seconds: 27, hundredths: 3 });
    expect(filter.filter(split)).toEqual(Array.from(split));
    expect(filter.droppedCount).toBe(0);
  });

  it('buffers a partial packet across chunk boundaries like the parser would', () => {
    const filter = makeFilter();
    const packet = Array.from(encodeLanePacket(4, { place: 1, seconds: 51, hundredths: 90 }));
    const first = filter.filter(packet.slice(0, 3)); // mid-packet split
    expect(first).toEqual([]); // incomplete — held, not emitted
    const rest = filter.filter(packet.slice(3));
    expect(rest).toEqual(packet); // whole packet emitted once complete
  });
});

describe('end-to-end glue: encoders → filter → parser → gate → scheduler', () => {
  it('first POST happens only after 2 consistent snapshots and carries full state', () => {
    const filter = new LaneByteFilter(parseCtsSwimPackets, buildModuleLaneMap(laneModule));
    const parser = new SwimTimingParser();
    const gate = new SnapshotConsistencyGate();
    const scheduler = new SwimPostScheduler<SwimTimingSnapshot>();

    parser.onUpdate((snap) => {
      if (gate.offer(snap) === 'open') scheduler.offer(snap);
    });

    // Snapshot #1 — event header. Plausible, but only 1/2: nothing queued.
    parser.feed(filter.filter(encodeEventHeatPacket(7, 2)));
    expect(scheduler.hasPending).toBe(false);

    // Snapshot #2 — a lane touch. Gate opens; snapshot queued.
    parser.feed(filter.filter(encodeLanePacket(3, { place: 1, seconds: 51, hundredths: 90 })));
    expect(scheduler.hasPending).toBe(true);

    const posted = scheduler.takeIfDue(0)!;
    expect(posted.eventHeat).toEqual({ eventNumber: 7, heat: 2 });
    expect(posted.lanes[3].display).toBe('51.90');
  });
});

describe('resolveBaudRate — ?baud= override', () => {
  it('defaults to 9600 and honors a numeric override', () => {
    expect(resolveBaudRate(undefined)).toBe(9600);
    expect(resolveBaudRate('')).toBe(9600);
    expect(resolveBaudRate('?foo=1')).toBe(9600);
    expect(resolveBaudRate('?baud=19200')).toBe(19200);
  });

  it('falls back on garbage values', () => {
    expect(resolveBaudRate('?baud=fast')).toBe(9600);
    expect(resolveBaudRate('?baud=-1')).toBe(9600);
    expect(resolveBaudRate('?baud=0')).toBe(9600);
  });
});

describe('summarizeSnapshot', () => {
  it('summarizes event/heat + lane count + score', () => {
    const snap = decode(
      concatPackets(
        encodeEventHeatPacket(12, 3),
        encodeLanePacket(1, { seconds: 55, hundredths: 42 }),
        encodeLanePacket(2, { seconds: 52, hundredths: 18 }),
        encodeTeamScorePacket(88, 76),
      ),
    );
    expect(summarizeSnapshot(snap)).toBe('Event 12 — Heat 3 · 2 lanes · 88–76');
  });

  it('degrades gracefully before any event/heat packet', () => {
    expect(summarizeSnapshot(emptySnapshot())).toBe('No event/heat yet · 0 lanes');
  });
});
