/**
 * What the boot surfaces know about this screen's network (2026-10-26, on site).
 *
 * The owner, with the Wi-Fi removed from a panel: "when i launch the app, the
 * splash screen doesnt tell me the network is disconnected at all until i
 * click into the network page on the display". The splash's Wi-Fi chip was a
 * hard-coded "Online", and "Connecting to your CMS…" spun forever.
 *
 * Three states, three different facts — never one standing in for another
 * (player rule 5):
 *
 *   • offline     — the device has no link: `navigator.onLine === false`, or the
 *                   `offline` event. The OS knows that, so we say it at once.
 *   • unreachable — the device has a link, but VenueOS does not answer.
 *                   `navigator.onLine` cannot tell (venue Wi-Fi with no uplink,
 *                   a dead router, DNS), so this takes a bounded probe of the
 *                   API — and TWO failed probes in a row, so one lost packet
 *                   never puts a card on the glass.
 *   • online      — VenueOS answered: our probe, or any control-plane request
 *                   the player made. ANY HTTP status proves the path; a 500 is
 *                   the server's problem, not this network's.
 *   …and `checking` while none of that is known (server render, first look).
 *
 * WHEN IT LOOKS. Only while a boot surface is on the glass (the caller holds
 * `demand()`), never on content. Evidence first: the boot surfaces make
 * control-plane requests anyway (register, the pairing poll, the manifest) and
 * their answers settle the question for free, so a healthy screen sends no
 * probe at all. A probe runs only on doubt — nobody answered within a short
 * grace, a request failed before any answer, or the link changed — and while
 * VenueOS stays unreachable it backs off (2 s to confirm, then 5 → 10 → 20 →
 * 30 s). It stops the moment the surface goes away.
 *
 * PURE: the reducer and the schedule are plain functions, and the monitor gets
 * its link reading, timers and probe as arguments, so every shape is tested
 * without a DOM (`__tests__/networkStatus.test.ts`). The browser glue is
 * `useNetworkStatus.ts`.
 */

export type NetworkStatus = 'checking' | 'offline' | 'unreachable' | 'online';

/** What the API path is known to do. `failed` is CONFIRMED (see CONFIRM_FAILURES). */
export type Reach = 'unknown' | 'ok' | 'failed';

export interface NetworkState {
  /** `navigator.onLine` as last observed; null until the client has looked. */
  linkUp: boolean | null;
  reach: Reach;
  /** Consecutive failed probes since the last answer or link change. */
  failures: number;
  /** A reason to look now rather than on the schedule. */
  urgent: boolean;
}

export const INITIAL_NETWORK_STATE: NetworkState = Object.freeze({
  linkUp: null,
  reach: 'unknown',
  failures: 0,
  urgent: false,
}) as NetworkState;

/** Failed probes in a row before "can't reach VenueOS" is said. */
export const CONFIRM_FAILURES = 2;

/** How long the first look waits for the player's own requests to answer. */
export const FIRST_LOOK_GRACE_MS = 2_500;

/** Delay before the next probe after N failures in a row: 2 s to confirm, then 5 → 10 → 20 → 30 s. */
export const PROBE_RETRY_MS: readonly number[] = [2_000, 5_000, 10_000, 20_000, 30_000];

/** The probe's own deadline. `AbortSignal.timeout` is Chromium 103+, so the glue arms a timer. */
export const PROBE_TIMEOUT_MS = 5_000;

const SLOWEST_MS = PROBE_RETRY_MS[PROBE_RETRY_MS.length - 1];

export function probeRetryDelayMs(failures: number): number {
  const i = Math.min(PROBE_RETRY_MS.length - 1, Math.max(0, Math.floor(failures) - 1));
  return PROBE_RETRY_MS[i];
}

export function networkStatusOf(s: NetworkState): NetworkStatus {
  // An answer from VenueOS outranks every flag.
  if (s.reach === 'ok') return 'online';
  if (s.linkUp === null) return 'checking';
  if (s.linkUp === false) return 'offline';
  if (s.reach === 'failed') return 'unreachable';
  return 'checking';
}

export type NetworkEvent =
  /** First look (or a resume) at `navigator.onLine`. */
  | { type: 'observe'; linkUp: boolean }
  /** The `online` / `offline` event. */
  | { type: 'link'; linkUp: boolean }
  /** Our bounded probe settled. */
  | { type: 'probe'; ok: boolean }
  /** A control-plane request got an HTTP answer (any status). */
  | { type: 'answer' }
  /** A control-plane request failed before any answer (transport class). */
  | { type: 'unanswered' };

function changedLink(linkUp: boolean): NetworkState {
  // A different link: whatever was proved about the old one says nothing here.
  return { linkUp, reach: 'unknown', failures: 0, urgent: true };
}

export function reduceNetwork(s: NetworkState, e: NetworkEvent): NetworkState {
  switch (e.type) {
    case 'observe':
      // The first look keeps any answer that already arrived; a resume after
      // the link changed unseen is a link change.
      if (s.linkUp === null) return { ...s, linkUp: e.linkUp };
      return s.linkUp === e.linkUp ? s : changedLink(e.linkUp);
    case 'link':
      return s.linkUp === e.linkUp ? s : changedLink(e.linkUp);
    case 'probe': {
      if (e.ok) return { linkUp: s.linkUp, reach: 'ok', failures: 0, urgent: false };
      const failures = s.failures + 1;
      return { ...s, failures, urgent: false, reach: failures >= CONFIRM_FAILURES ? 'failed' : s.reach };
    }
    case 'answer':
      // The OS says offline and VenueOS just answered: two facts disagree.
      // Look now and believe the probe, never one signal over the other.
      if (s.linkUp === false) return s.urgent ? s : { ...s, urgent: true };
      if (s.reach === 'ok' && s.failures === 0 && !s.urgent) return s;
      return { ...s, reach: 'ok', failures: 0, urgent: false };
    case 'unanswered':
      // One request that never got an answer is a reason to look, not a
      // verdict. Already confirmed down: the backoff is already looking.
      if (s.reach === 'failed' || s.urgent) return s;
      return { ...s, urgent: true };
    default:
      return s;
  }
}

/**
 * When the next probe should start, in ms from now, or null for none.
 * `null` while VenueOS has answered is what keeps a healthy screen silent.
 */
export function nextProbeDelayMs(s: NetworkState): number | null {
  if (s.linkUp === null) return null; // not watching yet
  if (s.urgent) return 0;
  if (s.failures > 0) return probeRetryDelayMs(s.failures);
  if (s.reach === 'ok') return s.linkUp ? null : SLOWEST_MS; // keep checking an OS that disagrees
  return FIRST_LOOK_GRACE_MS;
}

export interface NetworkMonitorDeps {
  /** `navigator.onLine`; true when the engine cannot say. */
  readLink(): boolean;
  /** Subscribe to link changes; returns the unsubscribe. */
  watchLink(onChange: (linkUp: boolean) => void): () => void;
  /** ONE bounded probe: true on any HTTP answer. Must honour `signal`. */
  probe(signal: AbortSignal | undefined): Promise<boolean>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface NetworkMonitor {
  getStatus(): NetworkStatus;
  getState(): NetworkState;
  subscribe(listener: () => void): () => void;
  /** A boot surface is on the glass. Returns its release (idempotent). */
  demand(): () => void;
  /** A control-plane request got an HTTP answer. */
  noteAnswer(): void;
  /** A control-plane request failed before any answer. */
  noteNoAnswer(): void;
  /** Diagnostics: is anything being watched right now. */
  watching(): boolean;
}

export function createNetworkMonitor(deps: NetworkMonitorDeps): NetworkMonitor {
  let state: NetworkState = INITIAL_NETWORK_STATE;
  let status: NetworkStatus = networkStatusOf(state);
  let demands = 0;
  let timer: unknown = null;
  // Results of a probe started before newer evidence are stale: `epoch` moves
  // on every answer, link change and stop, and a probe keeps the one it began in.
  let epoch = 0;
  let inFlight: { ctl: AbortController | null; epoch: number } | null = null;
  let unwatch: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    listeners.forEach((l) => {
      try { l(); } catch { /* a listener never breaks the monitor */ }
    });
  };

  const clearTimer = () => {
    if (timer === null) return;
    try { deps.clearTimer(timer); } catch { /* already gone */ }
    timer = null;
  };

  const cancelProbe = () => {
    if (!inFlight) return;
    try { inFlight.ctl?.abort(); } catch { /* already settled */ }
    inFlight = null;
  };

  // The timer is "the next probe for the CURRENT state". It is re-armed only
  // when the state changes (or a probe settles / is cancelled): re-arming on
  // every unchanged event would let a stream of failing requests push the
  // backoff probe further away for ever.
  const schedule = () => {
    clearTimer();
    if (demands === 0 || inFlight) return;
    const delay = nextProbeDelayMs(state);
    if (delay === null) return;
    timer = deps.setTimer(() => {
      timer = null;
      runProbe();
    }, delay);
  };

  /** Apply an event; re-arms the schedule and returns true only when the state changed. */
  const apply = (e: NetworkEvent): boolean => {
    const next = reduceNetwork(state, e);
    if (next === state) return false;
    state = next;
    const nextStatus = networkStatusOf(state);
    if (nextStatus !== status) {
      status = nextStatus;
      notify();
    }
    schedule();
    return true;
  };

  function runProbe() {
    if (demands === 0 || inFlight) return;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const mine = { ctl, epoch };
    inFlight = mine;
    let pending: Promise<boolean>;
    try {
      pending = Promise.resolve(deps.probe(ctl ? ctl.signal : undefined));
    } catch {
      pending = Promise.resolve(false);
    }
    pending
      .then((ok) => ok === true, () => false)
      .then((ok) => {
        if (inFlight !== mine) return; // stopped or replaced meanwhile
        inFlight = null;
        // Newer evidence arrived while this probe was out: its result is stale.
        if (mine.epoch !== epoch || !apply({ type: 'probe', ok })) schedule();
      });
  }

  const onLink = (linkUp: boolean) => {
    if (state.linkUp === linkUp) return; // a repeated event changes nothing
    epoch += 1;
    cancelProbe();
    apply({ type: 'link', linkUp });
  };

  const readLink = (): boolean => {
    try { return deps.readLink() !== false; } catch { return true; }
  };

  const start = () => {
    try { unwatch = deps.watchLink(onLink); } catch { unwatch = null; }
    // A resume onto an unchanged state still needs its schedule armed.
    if (!apply({ type: 'observe', linkUp: readLink() })) schedule();
  };

  const stop = () => {
    clearTimer();
    if (unwatch) {
      try { unwatch(); } catch { /* already detached */ }
      unwatch = null;
    }
    epoch += 1;
    cancelProbe();
  };

  return {
    getStatus: () => status,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    demand() {
      demands += 1;
      if (demands === 1) start();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        demands -= 1;
        if (demands === 0) stop();
      };
    },
    noteAnswer() {
      epoch += 1;
      const cancelled = !!inFlight;
      cancelProbe();
      // A cancelled probe never settles, so it cannot re-arm the schedule itself.
      if (!apply({ type: 'answer' }) && cancelled) schedule();
    },
    noteNoAnswer() {
      apply({ type: 'unanswered' });
    },
    watching: () => demands > 0,
  };
}
