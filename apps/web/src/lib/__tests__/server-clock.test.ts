/**
 * server-clock (K12-F17) — the browser's estimate of SERVER time. Both time
 * bases are injected, so every case is exact: no real clock, no sleeps.
 */
import { createServerClock } from '../server-clock';

/** A controllable device: a monotonic base and a (possibly wrong) wall clock. */
function device(opts: { wallAheadMs?: number } = {}) {
  let local = 5_000; // performance.now() — ms since the page loaded
  let real = Date.parse('2026-09-27T18:00:00.000Z'); // true (server) time
  let wallSkew = opts.wallAheadMs ?? 0; // how wrong the device's wall clock is
  let paused = false; // performance.now() stops while the device sleeps
  return {
    localNow: () => local,
    wallNow: () => real + wallSkew,
    server: () => real,
    advance(ms: number) {
      real += ms;
      if (!paused) local += ms;
    },
    sleep(ms: number) {
      paused = true;
      this.advance(ms);
      paused = false;
    },
    stepWall(ms: number) {
      wallSkew += ms;
    },
  };
}

describe('serverClock', () => {
  it('before any sample it is the device clock', () => {
    const d = device({ wallAheadMs: 120_000 });
    const clock = createServerClock(d);
    expect(clock.hasSample()).toBe(false);
    expect(clock.now()).toBe(d.wallNow());
  });

  it('a device clock two minutes fast still reads server time after one sample', () => {
    const d = device({ wallAheadMs: 120_000 });
    const clock = createServerClock(d);
    const sent = d.localNow();
    d.advance(40); // 20 ms each way
    clock.sample(d.server() - 20, sent, d.localNow());
    expect(clock.now()).toBe(d.server());
    d.advance(10_000);
    expect(clock.now()).toBe(d.server());
    expect(clock.status()).toMatchObject({ hasSample: true, rttMs: 40 });
  });

  it('the lowest-round-trip sample wins', () => {
    const d = device();
    const clock = createServerClock(d);
    // A slow, asymmetric response: the server read happened 50 ms into a
    // 600 ms round trip, so its midpoint estimate is 250 ms off.
    let sent = d.localNow();
    d.advance(50);
    const slowReading = d.server();
    d.advance(550);
    clock.sample(slowReading, sent, d.localNow());
    // A fast one: 10 ms round trip, symmetric.
    sent = d.localNow();
    d.advance(5);
    const fastReading = d.server();
    d.advance(5);
    clock.sample(fastReading, sent, d.localNow());
    expect(clock.now()).toBe(d.server());
    expect(clock.status().rttMs).toBe(10);
  });

  it('a timed sample beats one with no measured round trip', () => {
    const d = device();
    const clock = createServerClock(d);
    clock.sample(d.server() + 900); // untimed, and off by 900 ms
    const sent = d.localNow();
    d.advance(20);
    clock.sample(d.server() - 10, sent, d.localNow());
    expect(clock.now()).toBe(d.server());
  });

  it('never runs backwards by less than a second; a real correction applies at once', () => {
    const d = device();
    const clock = createServerClock(d);
    let sent = d.localNow();
    d.advance(200);
    clock.sample(d.server() - 100 + 60, sent, d.localNow()); // estimate 60 ms ahead
    const first = clock.now();
    expect(first).toBe(d.server() + 60);
    sent = d.localNow();
    d.advance(10);
    clock.sample(d.server() - 5, sent, d.localNow()); // exact, better
    // The exact estimate is 50 ms behind what was already shown: hold.
    expect(clock.now()).toBe(first);
    d.advance(60);
    expect(clock.now()).toBe(d.server());
    // A correction of more than a second is not held.
    sent = d.localNow();
    d.advance(2);
    clock.sample(d.server() - 1 - 3_000, sent, d.localNow());
    expect(clock.now()).toBe(d.server() - 3_000);
  });

  it('a sleeping phone (monotonic base paused) comes back on server time, not minutes out', () => {
    const d = device({ wallAheadMs: 120_000 });
    const clock = createServerClock(d);
    const sent = d.localNow();
    d.advance(20);
    clock.sample(d.server() - 10, sent, d.localNow());
    d.sleep(10 * 60_000);
    // No fresh sample yet: the wall clock carries the estimate.
    expect(clock.now()).toBe(d.server());
    // The first sample after waking starts a fresh window.
    const s2 = d.localNow();
    d.advance(30);
    clock.sample(d.server() - 15, s2, d.localNow());
    expect(clock.now()).toBe(d.server());
    expect(clock.status().samples).toBe(1);
  });

  it('an NTP step of the wall clock is absorbed by the next sample', () => {
    const d = device();
    const clock = createServerClock(d);
    let sent = d.localNow();
    d.advance(20);
    clock.sample(d.server() - 10, sent, d.localNow());
    d.stepWall(5_000);
    d.advance(700);
    sent = d.localNow();
    d.advance(20);
    clock.sample(d.server() - 10, sent, d.localNow());
    expect(clock.now()).toBe(d.server());
  });

  it('K12-F40: hold() stops time where it stood until release()', () => {
    const d = device();
    const clock = createServerClock(d);
    const sent = d.localNow();
    d.advance(20);
    clock.sample(d.server() - 10, sent, d.localNow());
    d.advance(500);
    const heldAt = d.server();
    clock.hold();
    expect(clock.isHeld()).toBe(true);
    d.advance(9_000);
    expect(clock.now()).toBe(heldAt);
    clock.hold(); // a second hold does not move the instant
    d.advance(1_000);
    expect(clock.now()).toBe(heldAt);
    // A measurement still reads the real time while the display is held.
    expect(clock.unheldNow()).toBe(d.server());
    clock.release();
    expect(clock.now()).toBe(d.server());
  });

  it('ignores garbage samples and resets cleanly', () => {
    const d = device();
    const clock = createServerClock(d);
    clock.sample(Number.NaN);
    clock.sample(-5);
    clock.sample(d.server(), 10, 5); // received before sent
    expect(clock.status().samples).toBe(1); // the last one counted as untimed
    clock.reset();
    expect(clock.hasSample()).toBe(false);
  });
});
