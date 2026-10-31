/**
 * The splash's network status (2026-10-26): navigator state + probe results +
 * the control plane's own answers → offline / unreachable / online, including
 * the backoff and the stop. Owner, on site with the Wi-Fi removed: "the splash
 * screen doesnt tell me the network is disconnected at all".
 */
import {
  CONFIRM_FAILURES,
  createNetworkMonitor,
  FIRST_LOOK_GRACE_MS,
  INITIAL_NETWORK_STATE,
  nextProbeDelayMs,
  networkStatusOf,
  PROBE_RETRY_MS,
  probeRetryDelayMs,
  reduceNetwork,
  type NetworkMonitorDeps,
  type NetworkState,
} from '../networkStatus';

const st = (over: Partial<NetworkState>): NetworkState => ({ ...INITIAL_NETWORK_STATE, ...over });

describe('networkStatusOf — the three facts, never one standing in for another', () => {
  it.each<[string, string, Partial<NetworkState>]>([
    ['nothing observed yet (server render, first pass)', 'checking', {}],
    ['no link', 'offline', { linkUp: false }],
    ['no link, probes failing', 'offline', { linkUp: false, reach: 'failed', failures: 4 }],
    ['a link, nothing proved yet', 'checking', { linkUp: true }],
    ['a link, VenueOS confirmed unreachable', 'unreachable', { linkUp: true, reach: 'failed', failures: 2 }],
    ['a link and an answer', 'online', { linkUp: true, reach: 'ok' }],
    ['an answer outranks a disagreeing OS flag', 'online', { linkUp: false, reach: 'ok' }],
    ['an answer before the first look', 'online', { linkUp: null, reach: 'ok' }],
  ])('%s → %s', (_name, expected, over) => {
    expect(networkStatusOf(st(over))).toBe(expected);
  });
});

describe('reduceNetwork', () => {
  it('one failed probe is never a verdict; the second confirms it', () => {
    let s = reduceNetwork(st({ linkUp: true }), { type: 'probe', ok: false });
    expect(s.failures).toBe(1);
    expect(networkStatusOf(s)).toBe('checking');
    s = reduceNetwork(s, { type: 'probe', ok: false });
    expect(CONFIRM_FAILURES).toBe(2);
    expect(networkStatusOf(s)).toBe('unreachable');
  });

  it('a screen that was online keeps saying so while it re-checks', () => {
    let s = reduceNetwork(st({ linkUp: true, reach: 'ok' }), { type: 'unanswered' });
    expect(s.urgent).toBe(true);
    expect(networkStatusOf(s)).toBe('online');
    s = reduceNetwork(s, { type: 'probe', ok: false });
    expect(networkStatusOf(s)).toBe('online');
    s = reduceNetwork(s, { type: 'probe', ok: false });
    expect(networkStatusOf(s)).toBe('unreachable');
  });

  it('any HTTP answer from VenueOS settles it at once', () => {
    const s = reduceNetwork(st({ linkUp: true, reach: 'failed', failures: 5 }), { type: 'answer' });
    expect(s).toEqual({ linkUp: true, reach: 'ok', failures: 0, urgent: false });
  });

  it('an answer while the OS says offline is a reason to look, not to believe either side', () => {
    const s = reduceNetwork(st({ linkUp: false }), { type: 'answer' });
    expect(s.urgent).toBe(true);
    expect(networkStatusOf(s)).toBe('offline');
  });

  it('an unanswered request when already confirmed down changes nothing (the backoff is looking)', () => {
    const down = st({ linkUp: true, reach: 'failed', failures: 3 });
    expect(reduceNetwork(down, { type: 'unanswered' })).toBe(down);
  });

  it('a link change forgets what was proved and looks now; a repeated event is a no-op', () => {
    const ok = st({ linkUp: true, reach: 'ok' });
    const off = reduceNetwork(ok, { type: 'link', linkUp: false });
    expect(off).toEqual({ linkUp: false, reach: 'unknown', failures: 0, urgent: true });
    expect(networkStatusOf(off)).toBe('offline');
    expect(reduceNetwork(off, { type: 'link', linkUp: false })).toBe(off);
    const back = reduceNetwork(off, { type: 'link', linkUp: true });
    expect(networkStatusOf(back)).toBe('checking');
    expect(back.urgent).toBe(true);
  });

  it('the first look keeps an answer that already arrived', () => {
    const answered = reduceNetwork(INITIAL_NETWORK_STATE, { type: 'answer' });
    const looked = reduceNetwork(answered, { type: 'observe', linkUp: true });
    expect(networkStatusOf(looked)).toBe('online');
  });
});

describe('nextProbeDelayMs — evidence first, then 2 s to confirm, then 5 → 30 s', () => {
  it('does not look before the first observation', () => {
    expect(nextProbeDelayMs(INITIAL_NETWORK_STATE)).toBeNull();
  });
  it('the first look waits a short grace for the player’s own requests', () => {
    expect(nextProbeDelayMs(st({ linkUp: true }))).toBe(FIRST_LOOK_GRACE_MS);
  });
  it('a reason to look is looked at now', () => {
    expect(nextProbeDelayMs(st({ linkUp: true, urgent: true }))).toBe(0);
  });
  it('backs off and caps', () => {
    expect([1, 2, 3, 4, 5, 6, 40].map(probeRetryDelayMs)).toEqual([2_000, 5_000, 10_000, 20_000, 30_000, 30_000, 30_000]);
    expect(PROBE_RETRY_MS[PROBE_RETRY_MS.length - 1]).toBe(30_000);
    expect(nextProbeDelayMs(st({ linkUp: true, reach: 'failed', failures: 3 }))).toBe(10_000);
  });
  it('a screen VenueOS answered is idle — no probe at all', () => {
    expect(nextProbeDelayMs(st({ linkUp: true, reach: 'ok' }))).toBeNull();
  });
  it('keeps checking slowly when the OS disagrees with an answer', () => {
    expect(nextProbeDelayMs(st({ linkUp: false, reach: 'ok' }))).toBe(30_000);
  });
});

/** A monitor on fake timers with a controllable link and probe. */
function harness(initialLink = true) {
  let link = initialLink;
  let onLink: ((up: boolean) => void) | null = null;
  const probes: Array<{ resolve: (ok: boolean) => void; signal?: AbortSignal; at: number }> = [];
  const deps: NetworkMonitorDeps = {
    readLink: () => link,
    watchLink: (cb) => {
      onLink = cb;
      return () => { onLink = null; };
    },
    probe: (signal) => new Promise<boolean>((resolve) => { probes.push({ resolve, signal, at: Date.now() }); }),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const monitor = createNetworkMonitor(deps);
  const statuses: string[] = [];
  monitor.subscribe(() => statuses.push(monitor.getStatus()));
  return {
    monitor,
    probes,
    statuses,
    setLink(up: boolean) {
      link = up;
      onLink?.(up);
    },
    watchingLink: () => onLink !== null,
    /** Settle the newest probe and let the monitor react. */
    async settle(ok: boolean) {
      const p = probes[probes.length - 1];
      p.resolve(ok);
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('createNetworkMonitor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('a healthy screen sends NO probe: the player’s own answer settles it', async () => {
    const h = harness(true);
    const release = h.monitor.demand();
    expect(h.monitor.getStatus()).toBe('checking');
    h.monitor.noteAnswer();
    expect(h.monitor.getStatus()).toBe('online');
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.probes).toHaveLength(0);
    release();
  });

  it('no answer within the grace → one probe; it answers → online, then idle', async () => {
    const h = harness(true);
    h.monitor.demand();
    await jest.advanceTimersByTimeAsync(FIRST_LOOK_GRACE_MS - 1);
    expect(h.probes).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(h.probes).toHaveLength(1);
    await h.settle(true);
    expect(h.monitor.getStatus()).toBe('online');
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.probes).toHaveLength(1);
  });

  it('offline from the first look: says so at once, before any probe', () => {
    const h = harness(false);
    h.monitor.demand();
    expect(h.monitor.getStatus()).toBe('offline');
    expect(h.probes).toHaveLength(0);
  });

  it('link up but VenueOS silent: an unanswered request → probe now → 2 s → confirmed unreachable, then 5 → 10 → 20 → 30 → 30 s', async () => {
    const h = harness(true);
    h.monitor.demand();
    h.monitor.noteNoAnswer(); // register failed before any answer
    await jest.advanceTimersByTimeAsync(0);
    expect(h.probes).toHaveLength(1);
    await h.settle(false);
    expect(h.monitor.getStatus()).toBe('checking'); // one failure is not a verdict
    await jest.advanceTimersByTimeAsync(2_000);
    expect(h.probes).toHaveLength(2);
    await h.settle(false);
    expect(h.monitor.getStatus()).toBe('unreachable');
    const gaps: number[] = [];
    for (let i = 0; i < 5; i++) {
      const before = h.probes.length;
      const t0 = Date.now();
      while (h.probes.length === before) await jest.advanceTimersByTimeAsync(1_000);
      gaps.push(Date.now() - t0);
      await h.settle(false);
    }
    expect(gaps).toEqual([5_000, 10_000, 20_000, 30_000, 30_000]);
    expect(h.monitor.getStatus()).toBe('unreachable');
  });

  it('a stream of failing requests never pushes the backoff probe further away', async () => {
    const h = harness(true);
    h.monitor.demand();
    h.monitor.noteNoAnswer();
    await jest.advanceTimersByTimeAsync(0);
    await h.settle(false);
    await jest.advanceTimersByTimeAsync(2_000);
    await h.settle(false); // confirmed: next probe due in 5 s
    for (let i = 0; i < 4; i++) {
      await jest.advanceTimersByTimeAsync(1_000);
      h.monitor.noteNoAnswer();
    }
    await jest.advanceTimersByTimeAsync(1_000);
    expect(h.probes).toHaveLength(3);
  });

  it('recovers by itself: an answer from the control plane clears unreachable at once', async () => {
    const h = harness(true);
    h.monitor.demand();
    h.monitor.noteNoAnswer();
    await jest.advanceTimersByTimeAsync(0);
    await h.settle(false);
    await jest.advanceTimersByTimeAsync(2_000);
    await h.settle(false);
    expect(h.monitor.getStatus()).toBe('unreachable');
    h.monitor.noteAnswer();
    expect(h.monitor.getStatus()).toBe('online');
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(h.probes).toHaveLength(2); // idle again
  });

  it('recovers by itself: the backoff probe finds VenueOS again', async () => {
    const h = harness(true);
    h.monitor.demand();
    h.monitor.noteNoAnswer();
    await jest.advanceTimersByTimeAsync(0);
    await h.settle(false);
    await jest.advanceTimersByTimeAsync(2_000);
    await h.settle(false);
    await jest.advanceTimersByTimeAsync(5_000);
    await h.settle(true);
    expect(h.monitor.getStatus()).toBe('online');
  });

  it('wifi pulled: offline at once; wifi back: the card clears at once and one probe confirms', async () => {
    const h = harness(true);
    h.monitor.demand();
    h.monitor.noteAnswer();
    expect(h.monitor.getStatus()).toBe('online');
    h.setLink(false);
    expect(h.monitor.getStatus()).toBe('offline');
    await jest.advanceTimersByTimeAsync(0);
    await h.settle(false); // fails instantly on a dead link
    expect(h.monitor.getStatus()).toBe('offline');
    h.setLink(true);
    expect(h.monitor.getStatus()).toBe('checking'); // no card: the spinner copy is back
    await jest.advanceTimersByTimeAsync(0);
    await h.settle(true);
    expect(h.monitor.getStatus()).toBe('online');
    expect(h.statuses).toEqual(['online', 'offline', 'checking', 'online']);
  });

  it('a probe that started before newer evidence is ignored', async () => {
    const h = harness(true);
    h.monitor.demand();
    await jest.advanceTimersByTimeAsync(FIRST_LOOK_GRACE_MS);
    expect(h.probes).toHaveLength(1);
    const aborted = h.probes[0].signal;
    h.monitor.noteAnswer(); // the register answered while the probe was out
    expect(aborted?.aborted).toBe(true);
    h.probes[0].resolve(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.monitor.getStatus()).toBe('online');
    expect(h.monitor.getState().failures).toBe(0);
  });

  it('a repeated link event never strands the schedule', async () => {
    const h = harness(true);
    h.monitor.demand();
    h.setLink(false);
    await jest.advanceTimersByTimeAsync(0);
    expect(h.probes).toHaveLength(1);
    h.setLink(false); // the same event again, while the probe is out
    await h.settle(false);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(h.probes).toHaveLength(2);
  });

  it('STOPS the moment the surface goes away: timers cleared, probe aborted, link unwatched', async () => {
    const h = harness(true);
    const release = h.monitor.demand();
    h.monitor.noteNoAnswer();
    await jest.advanceTimersByTimeAsync(0);
    expect(h.probes).toHaveLength(1);
    expect(h.watchingLink()).toBe(true);
    release();
    expect(h.probes[0].signal?.aborted).toBe(true);
    expect(h.watchingLink()).toBe(false);
    expect(h.monitor.watching()).toBe(false);
    await h.settle(false); // the aborted probe's answer is dropped
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.probes).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
    release(); // idempotent
    expect(h.monitor.watching()).toBe(false);
  });

  it('evidence while nothing watches updates the state but never starts a timer', async () => {
    const h = harness(true);
    h.monitor.noteNoAnswer();
    h.monitor.noteAnswer();
    expect(h.monitor.getStatus()).toBe('online');
    expect(jest.getTimerCount()).toBe(0);
    expect(h.probes).toHaveLength(0);
  });

  it('a surface that comes back after a doubt looks at once; one with nothing to doubt stays idle', async () => {
    const h = harness(true);
    let release = h.monitor.demand();
    h.monitor.noteAnswer();
    release();
    // Content played; a manifest poll failed before any answer meanwhile.
    h.monitor.noteNoAnswer();
    release = h.monitor.demand();
    await jest.advanceTimersByTimeAsync(0);
    expect(h.probes).toHaveLength(1);
    await h.settle(true);
    release();
    h.monitor.demand();
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.probes).toHaveLength(1);
  });

  it('a resume after the link changed unseen reads the new link', () => {
    const h = harness(true);
    const release = h.monitor.demand();
    h.monitor.noteAnswer();
    release();
    h.setLink(false); // nobody listening: the event is missed
    h.monitor.demand();
    expect(h.monitor.getStatus()).toBe('offline');
  });

  it('a probe that throws counts as a failed probe, never as a crash', async () => {
    const deps: NetworkMonitorDeps = {
      readLink: () => true,
      watchLink: () => () => {},
      probe: () => { throw new Error('boom'); },
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    };
    const m = createNetworkMonitor(deps);
    m.demand();
    m.noteNoAnswer();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(m.getStatus()).toBe('unreachable');
  });
});
