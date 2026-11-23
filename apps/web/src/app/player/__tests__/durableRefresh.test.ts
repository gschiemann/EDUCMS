/**
 * FLT-09 (2026-11-21) — the manifest-delivered REFRESH_WEB waits for an alert
 * to leave the glass, is not acknowledged while it waits, and runs after.
 * The rest of the cases pin the steps that moved here unchanged from
 * `page.tsx` (value-identity ack, refuse on unreliable storage, preview tabs,
 * never-interrupt admission).
 */
import {
  DURABLE_REFRESH_ALERT_RECHECK_MS,
  LS_REFRESH_ACK,
  refreshWaitsForAlert,
  runDurableRefresh,
  type DurableRefreshDeps,
} from '../durableRefresh';
import type { RefreshAdmission, RefreshOrigin } from '../refreshAdmission';

const REQ = 1_792_000_123_456;

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
  };
}

function harness(over: Partial<DurableRefreshDeps> & { alert?: boolean; admitWith?: RefreshAdmission } = {}) {
  const store = memoryStorage();
  const reloads: number[] = [];
  const scheduled: Array<() => void> = [];
  const delays: number[] = [];
  const origins: RefreshOrigin[] = [];
  let alert = over.alert ?? false;
  const deps: DurableRefreshDeps = {
    isPreview: () => false,
    storage: () => store,
    admit: (origin) => { origins.push(origin); return over.admitWith ?? { action: 'reload' }; },
    alertOnGlass: () => alert,
    reload: () => { reloads.push(Date.now()); },
    schedule: (fn, ms) => { scheduled.push(fn); delays.push(ms); },
    ...over,
  };
  return {
    deps, store, reloads, scheduled, delays, origins,
    setAlert: (on: boolean) => { alert = on; },
    flush: () => { while (scheduled.length) scheduled.shift()!(); },
    /** Run only the timers due now (a re-armed one waits for the next step). */
    step: () => { const due = scheduled.splice(0, scheduled.length); due.forEach((fn) => fn()); },
  };
}

describe('an alert on the glass defers the durable refresh', () => {
  it('while an alert is up: no ack written, no reload scheduled — the command stays pending', () => {
    const h = harness({ alert: true });
    expect(runDurableRefresh({ refreshRequestedAt: REQ, refreshRequestedBy: 'system' }, h.deps)).toBe('deferred');
    expect(h.store.getItem(LS_REFRESH_ACK)).toBeNull();
    expect(h.scheduled).toHaveLength(0);
    expect(h.origins).toHaveLength(0); // admission is not even asked
  });

  it('every live manifest during the alert defers again; the first one after it runs the command once', () => {
    const h = harness({ alert: true });
    const manifest = { refreshRequestedAt: REQ, refreshRequestedBy: 'operator' };
    expect(runDurableRefresh(manifest, h.deps)).toBe('deferred');
    expect(runDurableRefresh(manifest, h.deps)).toBe('deferred');
    h.setAlert(false);
    expect(runDurableRefresh(manifest, h.deps)).toBe('reload');
    expect(h.store.getItem(LS_REFRESH_ACK)).toBe(String(REQ));
    h.flush();
    expect(h.reloads).toHaveLength(1);
    // Value identity: the same command never runs twice.
    expect(runDurableRefresh(manifest, h.deps)).toBe('none');
  });

  it('after the alert a SYSTEM refresh on a provably healthy screen is still declined (and consumed) as before', () => {
    const h = harness({ alert: true, admitWith: { action: 'decline', reason: 'healthy-playing' } });
    const manifest = { refreshRequestedAt: REQ, refreshRequestedBy: 'system' };
    expect(runDurableRefresh(manifest, h.deps)).toBe('deferred');
    h.setAlert(false);
    expect(runDurableRefresh(manifest, h.deps)).toBe('declined');
    expect(h.store.getItem(LS_REFRESH_ACK)).toBe(String(REQ));
    expect(h.scheduled).toHaveLength(0);
  });

  it('an alert that reaches the glass inside the 250 ms before the reload holds the reload until it ends', () => {
    const h = harness();
    expect(runDurableRefresh({ refreshRequestedAt: REQ, refreshRequestedBy: 'operator' }, h.deps)).toBe('reload');
    expect(h.delays).toEqual([250]);
    h.setAlert(true); // a pushed SOS lands before the timer fires
    h.step();
    expect(h.reloads).toHaveLength(0);
    expect(h.delays.slice(1)).toEqual([DURABLE_REFRESH_ALERT_RECHECK_MS]);
    h.step(); // still up 30 s later: still waiting, re-armed again
    expect(h.reloads).toHaveLength(0);
    h.setAlert(false);
    h.step();
    expect(h.reloads).toHaveLength(1);
    expect(h.scheduled).toHaveLength(0);
  });

  it('an already-acknowledged command is not "deferred" (nothing to wait for)', () => {
    const h = harness({ alert: true });
    h.store.setItem(LS_REFRESH_ACK, String(REQ));
    expect(runDurableRefresh({ refreshRequestedAt: REQ }, h.deps)).toBe('none');
  });
});

describe('refreshWaitsForAlert — any alert, in any form', () => {
  const none = { manifestAlert: false, pushedMessage: false, polledMessage: false, pendingOverride: false };
  it('nothing on the glass → no wait', () => {
    expect(refreshWaitsForAlert(none)).toBe(false);
  });
  it.each([
    ['a manifest alert', { manifestAlert: true }],
    ['a pushed SOS / broadcast / media alert (a banner too)', { pushedMessage: true }],
    ["a message shown by the overlay's own poll (a push-dead screen)", { polledMessage: true }],
    ['a signed OVERRIDE awaiting its manifest confirm', { pendingOverride: true }],
  ])('%s → wait', (_name, on) => {
    expect(refreshWaitsForAlert({ ...none, ...on })).toBe(true);
  });
});

describe('the steps that moved unchanged', () => {
  it('no command → nothing', () => {
    const h = harness();
    expect(runDurableRefresh({}, h.deps)).toBe('none');
    expect(runDurableRefresh(null, h.deps)).toBe('none');
    expect(runDurableRefresh({ refreshRequestedAt: 'soon' }, h.deps)).toBe('none');
    expect(runDurableRefresh({ refreshRequestedAt: Number.NaN }, h.deps)).toBe('none');
  });

  it('a preview tab never consumes the screen command', () => {
    const h = harness({ isPreview: () => true });
    expect(runDurableRefresh({ refreshRequestedAt: REQ }, h.deps)).toBe('none');
    expect(h.store.getItem(LS_REFRESH_ACK)).toBeNull();
  });

  it('unreadable storage refuses (no ack, no reload)', () => {
    const h = harness({ storage: () => { throw new Error('SecurityError'); } });
    expect(runDurableRefresh({ refreshRequestedAt: REQ }, h.deps)).toBe('refused');
    expect(h.scheduled).toHaveLength(0);
  });

  it('a store that accepts the write but does not keep it refuses (it could loop)', () => {
    const forgetful = { getItem: () => null, setItem: () => {} };
    const h = harness({ storage: () => forgetful });
    expect(runDurableRefresh({ refreshRequestedAt: REQ }, h.deps)).toBe('refused');
    expect(h.scheduled).toHaveLength(0);
  });

  it('the ack is written BEFORE the reload is scheduled, and the reload is the strongest one', () => {
    const order: string[] = [];
    const store = memoryStorage();
    const h = harness({
      storage: () => ({ getItem: store.getItem, setItem: (k, v) => { order.push('ack'); store.setItem(k, v); } }),
      reload: () => { order.push('reload'); },
    });
    expect(runDurableRefresh({ refreshRequestedAt: REQ }, h.deps)).toBe('reload');
    h.flush();
    expect(order).toEqual(['ack', 'reload']);
  });

  it("the origin comes from the manifest: only an explicit 'system' is the system's", () => {
    const h = harness();
    runDurableRefresh({ refreshRequestedAt: REQ, refreshRequestedBy: 'system' }, h.deps);
    runDurableRefresh({ refreshRequestedAt: REQ + 1 }, h.deps);
    expect(h.origins).toEqual(['system', 'operator']);
  });
});
