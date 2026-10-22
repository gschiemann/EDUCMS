import { signalDisplayEmergencyHold } from './emergencyHold';
/**
 * NATIVE-FIRST — this page document's controller of its face's native
 * session (design `docs/design/NATIVE-FIRST-ONE-STORE.md` §3.5 / §4).
 *
 * ONE per page document: it owns the document's lease id, the last facts the
 * app reported on `sharedVideoState`, the 500 ms poll while a session matters
 * (each poll also renews the lease on the app side), and the three v4 senders
 * (`intend` / `release` / `sync` on `sharedVideoPrepare` — no new bridge
 * method). Everything decides elsewhere (decideFaceEngine, reconcileFace);
 * this only talks to the app, single-flight and bounded:
 *   • a `sharedVideoState` read that never answers resolves null after 2 s
 *     and never replaces the last facts (unknown ≠ idle);
 *   • the poll runs only while something holds interest (`hold()`), never
 *     on a browser player and never off the player page;
 *   • nothing is sent unless the app advertised protocolMax ≥ 4.
 * No React, no DOM; timers and the clock are injectable for the tests.
 */
import {
  NATIVE_FIRST_POLL_MS,
  NATIVE_FIRST_PROTOCOL,
  NATIVE_FIRST_REPLY_TIMEOUT_MS,
  nativeIntendMessage,
  nativePresenting,
  nativeReleaseMessage,
  nativeSyncMessage,
  newNativeLeaseId,
  readNativeFirstFacts,
  type NativeFirstFacts,
  type NativeIntentIdentity,
  type NativeStart,
} from './nativeFirst';
import { NativeTransientEnds } from './nativeEndReasons';

export interface NativeFirstBridge {
  has(method: string): boolean;
  fire(method: string, arg: string): boolean;
  state(): Promise<unknown>;
}
export interface NativeFirstTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
const realTimers: NativeFirstTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** The same message within this window is not sent twice (StrictMode double effects, re-renders). */
export const NATIVE_FIRST_RESEND_MS = 1_000;

export class NativeFirstFace {
  private leaseId: string;
  private leaseRenewals = 0;
  /** This document's lease id (fresh per document; renewed only after the app refused a retired one). */
  get lease(): string {
    return this.leaseId;
  }
  /** The page's settle rule for this document (§3.4) — a reload starts clean. */
  readonly ends = new NativeTransientEnds();
  private current: NativeFirstFacts | null = null;
  private inflight: Promise<NativeFirstFacts | null> | null = null;
  private timer: unknown = null;
  private holders = 0;
  private listeners = new Set<(facts: NativeFirstFacts | null) => void>();
  private lastSent = '';
  private lastSentAt = -Infinity;
  private lastSync = '';
  private readonly timers: NativeFirstTimers;
  private readonly now: () => number;

  constructor(
    private readonly bridge: NativeFirstBridge,
    opts: { lease?: string; timers?: NativeFirstTimers; now?: () => number } = {},
  ) {
    this.leaseId = opts.lease ?? newNativeLeaseId();
    this.timers = opts.timers ?? realTimers;
    this.now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  /** The last facts the app reported (null until the first usable reply). */
  get facts(): NativeFirstFacts | null {
    return this.current;
  }

  /**
   * The app refused this document's lease as RETIRED (stream B: "a retired
   * lease is refused for good"): mint a new one. Bounded — at most 3 per
   * document, so a misbehaving app can never make the page spin.
   */
  renewLease(): boolean {
    if (this.leaseRenewals >= 3) return false;
    this.leaseRenewals++;
    this.leaseId = newNativeLeaseId();
    this.lastSent = '';
    return true;
  }

  /** The app speaks v4 AND the method to say it exists. */
  supportsV4(): boolean {
    return (this.current?.protocolMax ?? 0) >= NATIVE_FIRST_PROTOCOL && this.bridge.has('sharedVideoPrepare');
  }

  /** Native presents regular content on this face right now (by the last facts). */
  presenting(): boolean {
    return nativePresenting(this.current);
  }

  subscribe(fn: (facts: NativeFirstFacts | null) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** One bounded, single-flight read. A null answer never replaces the last facts. */
  read(): Promise<NativeFirstFacts | null> {
    if (this.inflight) return this.inflight;
    if (!this.bridge.has('sharedVideoState')) return Promise.resolve(null);
    const reply = new Promise<NativeFirstFacts | null>((resolve) => {
      let settled = false;
      const t = this.timers.set(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, NATIVE_FIRST_REPLY_TIMEOUT_MS);
      Promise.resolve()
        .then(() => this.bridge.state())
        .then(
          (raw) => {
            if (settled) return;
            settled = true;
            this.timers.clear(t);
            resolve(readNativeFirstFacts(raw));
          },
          () => {
            if (settled) return;
            settled = true;
            this.timers.clear(t);
            resolve(null);
          },
        );
    });
    this.inflight = reply.then((facts) => {
      this.inflight = null;
      if (facts) {
        const wasHeld = this.current?.intent?.suspended === 'hold';
        this.current = facts;
        // Native watch can win the race against the page. Observe the EDGE:
        // the saved intent stays suspended until a fresh intend after clear.
        // Re-reading it must never re-raise a server-cleared hold.
        if (!wasHeld && facts.intent?.suspended === 'hold') signalDisplayEmergencyHold(true);
        this.listeners.forEach((fn) => {
          try { fn(facts); } catch { /* a listener never breaks the poll */ }
        });
      }
      return facts;
    });
    return this.inflight;
  }

  /** Poll every 500 ms while the returned release has not been called (§4.1: a session matters). */
  hold(): () => void {
    this.holders++;
    if (this.timer === null) this.tick();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holders = Math.max(0, this.holders - 1);
      if (this.holders === 0 && this.timer !== null) {
        this.timers.clear(this.timer);
        this.timer = null;
      }
    };
  }

  private tick(): void {
    this.timer = this.timers.set(() => {
      this.timer = null;
      if (this.holders === 0) return;
      void this.read().finally(() => {
        if (this.holders > 0 && this.timer === null) this.tick();
      });
    }, this.timer === null && this.current === null ? 0 : NATIVE_FIRST_POLL_MS);
  }

  private send(message: string | null): boolean {
    if (!message || !this.supportsV4()) return false;
    const t = this.now();
    if (message === this.lastSent && t - this.lastSentAt < NATIVE_FIRST_RESEND_MS) return true;
    let ok = false;
    try { ok = this.bridge.fire('sharedVideoPrepare', message); } catch { ok = false; }
    if (ok) {
      this.lastSent = message;
      this.lastSentAt = t;
    }
    return ok;
  }

  /** This face's solo intent (replaces the previous one). Identity only. */
  intend(identity: NativeIntentIdentity, start: NativeStart): boolean {
    return this.send(nativeIntendMessage(identity, start, this.lease));
  }

  /** No solo native content on this face; the page's web content is painted beneath. */
  release(at: NativeStart): boolean {
    return this.send(nativeReleaseMessage(this.lease, at));
  }

  /** A nudge after a manifest / emergency-set apply; sent once per distinct (tag, set hash). */
  sync(manifestTag: string, emergencySetHash?: string | null): boolean {
    const message = nativeSyncMessage(manifestTag, emergencySetHash);
    if (!message || message === this.lastSync || !this.supportsV4()) return false;
    let ok = false;
    try { ok = this.bridge.fire('sharedVideoPrepare', message); } catch { ok = false; }
    if (ok) this.lastSync = message;
    return ok;
  }
}

/**
 * The once-per-change "what native-first decided" signature the PAGE re-renders
 * on: the 500 ms poll must not re-render a 15k-line page twice a second, only
 * when a fact a decision reads has changed.
 */
export function nativeFirstDecisionSignature(f: NativeFirstFacts | null): string {
  if (!f) return '';
  const s = f.session;
  return [
    f.protocolMax, f.nativeSolo ? 1 : 0, f.nativeFirst ? 1 : 0,
    f.store ? `${f.store.mode}:${f.store.generation}:${f.store.ready.join(',')}` : '-',
    s ? `${s.state}:${s.sha256}:${s.revision}` : 'idle',
    f.intent ? `${f.intent.sha256}:${f.intent.revision}:${f.intent.suspended ?? ''}` : '-',
  ].join('|');
}
