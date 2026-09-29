/**
 * loopDecks — a SEAMLESS solo-video repeat with two `<video>` elements.
 *
 * The problem (2026-09-29, video-loop audit F1, RIOT Cleveland's 4K screen): a
 * solo video repeats with the browser's own `loop`, which is a SEEK back to 0. On
 * an Android WebView the decoder restarts and the picture can hold for hundreds
 * of ms at the seam. `loop` is a hint about repeating, not a promise of
 * continuous frames.
 *
 * The approach (the report's measured alternative to a continuous MSE backend;
 * §6.2 "parked first frame"): keep a SECOND element prepared — same file, paused
 * at frame 0 with that frame decoded — while the first one plays. Just before the
 * first reaches its end, resume the second; when its first frame has actually
 * been presented, put it on top. The seek and the decoder restart happen while
 * the picture on glass is still the first element playing normally. Then the
 * roles swap and the finished element is re-parked for the next lap.
 *
 * What makes this safe to ship on a fleet whose hardware nobody has qualified:
 *   - The active element ALWAYS keeps `loop = true`. If the hand-off never
 *     happens, or is abandoned, the browser loops it natively — exactly today's
 *     behaviour. Every failure path below ends there; none ends on a black screen.
 *   - Two decoders at once is the risk on a weak box. Any error on the standby, a
 *     standby that is not parked in time, or a hand-off that shows no frame in
 *     time gives up (`onFallback`), releases the standby (src removed, `load()`)
 *     and leaves the active element looping natively.
 *   - It never invents content: the hand-off measures what it did — HOLD (the
 *     picture waited past one frame period) and SKIP (the ending or the opening
 *     was trimmed) — and reports it, so a hand-off that is not better than the
 *     native loop shows up in the numbers instead of being assumed away.
 *   - Evidence is `requestVideoFrameCallback` timing: a frame reached the
 *     compositor. Not a camera on the panel.
 *
 * Deliberately NOT here: audio. Two elements cannot hand audio over without a
 * gap, so the caller only uses this for MUTED video (report §5.6 — sound is its
 * own workstream). Frame-locked sync, emergency content and `.mov` sources stay
 * on the native path (`loopEligibility.ts`).
 *
 * The engine is DOM-free — it drives objects shaped like `<video>` (`DeckLike`)
 * through an injected clock — so its timing logic is unit-tested against a
 * simulated media pipeline, and only the thin component touches real elements.
 */
import type { BoundaryEvent } from './loopBoundary';
import { DEFAULT_FRAME_PERIOD_MS, FramePeriodEstimator } from './loopBoundary';

/** The parts of `<video>` the engine drives. A real element satisfies it. */
export interface DeckLike {
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly readyState: number;
  readonly ended: boolean;
  readonly error: unknown;
  loop: boolean;
  muted: boolean;
  src: string;
  play(): Promise<void> | void;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, fn: (ev?: unknown) => void): void;
  removeEventListener(type: string, fn: (ev?: unknown) => void): void;
  requestVideoFrameCallback(cb: (now: number, meta: RvfcMeta) => void): number;
  cancelVideoFrameCallback(id: number): void;
}

export interface RvfcMeta {
  mediaTime: number;
  expectedDisplayTime: number;
  presentedFrames?: number;
}

export interface LoopEnv {
  /** A monotonic ms clock in the SAME timebase as rVFC `expectedDisplayTime` (`performance.now()`). */
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  /** The measured resume latency, persisted between sessions (ms), or null. */
  loadLeadMs(): number | null;
  saveLeadMs(ms: number): void;
}

export interface LoopCallbacks {
  /** Put `next` on top. Called from the rVFC callback that saw its first frame. */
  onReveal(next: 0 | 1, previous: 0 | 1): void;
  onBoundary(ev: BoundaryEvent): void;
  /** The two-deck path gave up. `permanent` = do not try again on this device for a while. */
  onFallback(reason: string, permanent: boolean): void;
  log?(msg: string): void;
}

export interface LoopOptions {
  /** How long the standby may take to park (metadata + first frame). */
  standbyReadyMs?: number;
  /** How long after `play()` the standby may take to present its first frame. */
  handoffTimeoutMs?: number;
  /** Consecutive abandoned hand-offs before giving up for good. */
  maxHandoffFailures?: number;
  /** A clip shorter than this is not worth arming (there is no time to prepare). */
  minDurationS?: number;
  /** First guess at the resume latency, before one is measured (ms). */
  defaultLeadMs?: number;
  /**
   * Do not arm when the active element's frames arrive slower than this
   * (ms/frame): a decoder already struggling must not be given a second job.
   * 100 ms (10 fps), deliberately loose — a 24 fps clip on a 60 Hz panel is
   * presented 3 vsyncs, 2 vsyncs, 3, 2 (50 / 33 ms), so the measured median can
   * sit right at 50 ms on a perfectly healthy decoder.
   */
  maxArmPeriodMs?: number;
  /** After a hand-off, the new element must present at least this fraction of the pre-hand-off frame rate. */
  minRateAfterSwap?: number;
  /** How long after a hand-off to measure that rate (ms), after a settling gap. */
  rateWindowMs?: number;
}

export const LOOP_DEFAULTS: Required<LoopOptions> = {
  standbyReadyMs: 20_000,
  handoffTimeoutMs: 1_500,
  maxHandoffFailures: 2,
  minDurationS: 2,
  defaultLeadMs: 120,
  maxArmPeriodMs: 100,
  minRateAfterSwap: 0.6,
  rateWindowMs: 2_000,
};

type State =
  | 'idle'
  | 'preparing' // standby loading / parking
  | 'armed' // standby parked; watching the active element's end
  | 'handoff' // standby resumed; waiting for its first presented frame
  | 'native'; // gave up — the active element loops natively

const HAVE_CURRENT_DATA = 2;

export class LoopDeckEngine {
  private state: State = 'idle';
  private active: 0 | 1 = 0;
  private readonly period = new FramePeriodEstimator();
  private opts: Required<LoopOptions>;
  private leadMs: number;
  /** True once the lead is a MEASUREMENT (this session's or a stored one), not the first guess. */
  private leadMeasured: boolean;
  private failures = 0;
  /** The frame period measured on the OLD element just before a hand-off. */
  private baselinePeriodMs = DEFAULT_FRAME_PERIOD_MS;
  /** Post-hand-off frame-rate check on the NEW element (null when not measuring). */
  private rateWatch: { settleAt: number; t0: number | null; f0: number | null } | null = null;
  private destroyed = false;

  // active-deck tracking — a frame callback belongs to the ELEMENT that made it
  // (ids are per element), and each chain carries a generation so a stale one can
  // never keep running after the active element changes.
  private activeRvfc: { deck: 0 | 1; id: number } | null = null;
  private watchGen = 0;
  private lastActive: RvfcMeta | null = null;
  private fireTimer: number | null = null;

  // standby tracking
  private standbyParked = false;
  private standbyRvfc: { deck: 0 | 1; id: number } | null = null;
  private readyTimer: number | null = null;
  private handoffTimer: number | null = null;
  private playCalledAt = 0;
  private listeners: Array<() => void> = [];

  constructor(
    private readonly decks: [DeckLike, DeckLike],
    private readonly src: string,
    private readonly env: LoopEnv,
    private readonly cb: LoopCallbacks,
    options: LoopOptions = {},
  ) {
    this.opts = { ...LOOP_DEFAULTS, ...options };
    const stored = env.loadLeadMs();
    this.leadMs = clampLead(stored ?? this.opts.defaultLeadMs);
    this.leadMeasured = stored !== null;
  }

  /** The state, for tests and diagnostics. */
  get mode(): State {
    return this.state;
  }
  get activeIndex(): 0 | 1 {
    return this.active;
  }
  get currentLeadMs(): number {
    return this.leadMs;
  }

  /**
   * Begin. The active deck (0) must already be playing this source. `loop`
   * stays TRUE on it for as long as the engine lives.
   */
  start(): void {
    if (this.state !== 'idle' || this.destroyed) return;
    const a = this.decks[this.active];
    a.loop = true;
    this.watchActive();
    this.prepareStandby();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearTimers();
    this.cancelRvfcs();
    for (const off of this.listeners.splice(0)) off();
    // Leave the ACTIVE element exactly as a native loop would have it.
    try {
      this.decks[this.active].loop = true;
    } catch { /* element gone */ }
    this.releaseStandby();
    this.state = 'native';
  }

  // ─── standby preparation ────────────────────────────────────────────────

  private standby(): DeckLike {
    return this.decks[this.active === 0 ? 1 : 0];
  }

  /**
   * The standby's state, for a give-up reason that has to explain itself from a
   * dashboard row: `rs` readyState, `p` paused, `t` media time in ms. The first
   * run on real hardware answers "did the browser ever decode the parked frame?"
   * from this and nothing else (a paused element some WebViews never fill).
   */
  private standbyDetail(): string {
    const s = this.standby();
    try {
      return `rs${s.readyState}p${s.paused ? 1 : 0}t${Math.round((Number(s.currentTime) || 0) * 1000)}`;
    } catch {
      return 'gone';
    }
  }

  private prepareStandby(reuseLoaded = false): void {
    if (this.destroyed || this.state === 'native') return;
    this.state = 'preparing';
    this.standbyParked = false;
    const s = this.standby();
    const hasError = () => !!s.error;
    try {
      s.loop = false;
      s.muted = true;
      if (!reuseLoaded) {
        s.src = this.src;
        s.load();
      } else {
        // Re-parking the element that just finished: back to the first frame.
        s.pause();
        s.currentTime = 0;
      }
    } catch (e) {
      this.giveUp('standby-setup-failed', true);
      return;
    }

    const onErr = () => this.giveUp('standby-error', true);
    const onData = () => this.maybePark();
    s.addEventListener('error', onErr);
    s.addEventListener('loadeddata', onData);
    s.addEventListener('seeked', onData);
    this.listeners.push(() => {
      s.removeEventListener('error', onErr);
      s.removeEventListener('loadeddata', onData);
      s.removeEventListener('seeked', onData);
    });

    this.readyTimer = this.env.setTimeout(() => {
      this.readyTimer = null;
      if (!this.standbyParked) this.giveUp(`standby-not-ready:${this.standbyDetail()}`, true);
    }, this.opts.standbyReadyMs);

    if (hasError()) {
      this.giveUp('standby-error', true);
      return;
    }
    // Already has its first frame (a re-park that seeked instantly, or a cache hit).
    if (s.readyState >= HAVE_CURRENT_DATA && Math.abs(s.currentTime) < 0.05) this.maybePark();
  }

  /** The standby has data at ~0: wait for its frame to be PRESENTED, then park it. */
  private maybePark(): void {
    if (this.destroyed || this.state !== 'preparing' || this.standbyParked) return;
    const s = this.standby();
    if (s.readyState < HAVE_CURRENT_DATA) return;
    if (Math.abs(s.currentTime) > 0.1) return; // not at the start yet (a seek still in flight)
    if (this.standbyRvfc !== null) return;
    const sIdx: 0 | 1 = this.active === 0 ? 1 : 0;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      this.standbyRvfc = null;
      if (this.destroyed || this.state !== 'preparing') return;
      try {
        s.pause(); // parked: first frame decoded, waiting
      } catch { /* noop */ }
      this.standbyParked = true;
      if (this.readyTimer !== null) {
        this.env.clearTimeout(this.readyTimer);
        this.readyTimer = null;
      }
      this.state = 'armed';
      this.cb.log?.('standby parked');
    };
    // A paused element presents its first frame once; if the browser never
    // fires the callback for a paused element, do not wait forever for it.
    this.standbyRvfc = { deck: sIdx, id: s.requestVideoFrameCallback(() => done()) };
    this.env.setTimeout(done, 400);
  }

  private releaseStandby(): void {
    const s = this.standby();
    try {
      s.pause();
      s.removeAttribute('src');
      s.load(); // a released decoder, not a paused one
    } catch { /* noop */ }
  }

  // ─── watching the active element ────────────────────────────────────────

  private watchActive(): void {
    const idx = this.active;
    const a = this.decks[idx];
    const gen = ++this.watchGen;
    const onFrame = (_now: number, meta: RvfcMeta) => {
      if (gen !== this.watchGen || this.destroyed) return; // a stale chain ends here
      this.activeRvfc = null;
      this.period.push({
        mediaTime: meta.mediaTime,
        expectedDisplayTime: meta.expectedDisplayTime,
        presentedFrames: meta.presentedFrames,
      });
      this.lastActive = meta;
      this.checkRateAfterSwap(meta);
      this.considerHandoff(meta);
      if (gen === this.watchGen && !this.destroyed && this.state !== 'native') {
        this.activeRvfc = { deck: idx, id: a.requestVideoFrameCallback(onFrame) };
      }
    };
    this.activeRvfc = { deck: idx, id: a.requestVideoFrameCallback(onFrame) };
  }

  private periodMs(): number {
    return this.period.periodMs() || DEFAULT_FRAME_PERIOD_MS;
  }

  /** Called on every presented frame of the active element. */
  private considerHandoff(meta: RvfcMeta): void {
    if (this.state !== 'armed') return;
    const a = this.decks[this.active];
    const dur = a.duration;
    if (!Number.isFinite(dur) || dur < this.opts.minDurationS) return;
    // A decoder that is already not keeping up (a big file on a weak box) must not
    // be given a second job: two would be worse than one. Not the device's fault
    // forever — the file or the moment may be — so this does not block the path.
    if (this.periodMs() > this.opts.maxArmPeriodMs) {
      this.giveUp('not-keeping-up', false);
      return;
    }
    // When the last frame will have finished displaying — the instant a
    // seamless repeat would show frame 0 again.
    const tSeamless = meta.expectedDisplayTime + (dur - meta.mediaTime) * 1000;
    // Aim half a frame EARLY: landing on the mark exactly races the element's own
    // end (the native wrap would start at the same instant the hand-off reveals).
    // Early costs at most half a frame of the old element's last frame — invisible —
    // while late is a hold.
    const untilFire = tSeamless - (this.leadMs + this.periodMs() / 2) - this.env.now();
    if (untilFire <= 0) {
      this.fireHandoff();
    } else if (untilFire < this.periodMs() * 1.5 && this.fireTimer === null) {
      // Inside the last frame's window: a timer lands nearer the mark than the
      // next per-frame callback would.
      this.fireTimer = this.env.setTimeout(() => {
        this.fireTimer = null;
        this.fireHandoff();
      }, untilFire);
    }
  }

  // ─── the hand-off ───────────────────────────────────────────────────────

  private fireHandoff(): void {
    if (this.state !== 'armed' || this.destroyed) return;
    const s = this.standby();
    this.state = 'handoff';
    this.playCalledAt = this.env.now();
    const beforeA = this.lastActive;
    let settled = false;
    const finish = (meta: RvfcMeta) => {
      if (settled) return;
      settled = true;
      this.standbyRvfc = null;
      if (this.handoffTimer !== null) {
        this.env.clearTimeout(this.handoffTimer);
        this.handoffTimer = null;
      }
      this.reveal(meta, beforeA);
    };
    try {
      const p = s.play();
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => this.abandonHandoff('play-rejected'));
      }
    } catch {
      this.abandonHandoff('play-threw');
      return;
    }
    const sIdx: 0 | 1 = this.active === 0 ? 1 : 0;
    this.standbyRvfc = {
      deck: sIdx,
      id: s.requestVideoFrameCallback((_n, meta) => {
        // The first frame PRESENTED after play() — not the parked frame (its
        // media time is still ~0 and the element was paused, so this callback is
        // only ever for a frame produced by resuming).
        finish(meta);
      }),
    };
    this.handoffTimer = this.env.setTimeout(() => {
      this.handoffTimer = null;
      if (!settled) {
        settled = true;
        this.abandonHandoff(`handoff-timeout:${this.standbyDetail()}`);
      }
    }, this.opts.handoffTimeoutMs);
  }

  private reveal(bMeta: RvfcMeta, aLast: RvfcMeta | null): void {
    if (this.destroyed || this.state !== 'handoff') return;
    const previous = this.active;
    const next: 0 | 1 = previous === 0 ? 1 : 0;
    const a = this.decks[previous];
    const b = this.decks[next];
    const latency = Math.max(0, bMeta.expectedDisplayTime - this.playCalledAt);

    // What the hand-off actually did at the seam, from the two elements' own
    // frame timing.
    let hold = 0;
    let skip = 0;
    if (aLast && Number.isFinite(a.duration)) {
      const tSeamless = aLast.expectedDisplayTime + (a.duration - aLast.mediaTime) * 1000;
      const late = bMeta.expectedDisplayTime - tSeamless;
      hold = Math.max(0, late);
      skip = Math.max(0, -late) + Math.max(0, bMeta.mediaTime) * 1000;
    }

    this.baselinePeriodMs = this.periodMs();
    // Roles swap. `loop` moves with them: the new active element keeps the
    // native-loop safety net; the old one must not wrap on its own.
    this.active = next;
    b.loop = true;
    a.loop = false;
    this.cb.onReveal(next, previous);
    this.cb.onBoundary({ holdMs: hold, skipMs: skip, backend: 'twodeck' });
    this.failures = 0;

    // Learn this device's resume latency and remember it. The first
    // measurement REPLACES the guess outright (each lap gives one sample, and a
    // guess that is off by 100 ms would otherwise take several laps to shed);
    // after that a bounded average, so one late frame cannot swing it.
    if (Number.isFinite(latency) && latency <= 2000) {
      this.leadMs = clampLead(this.leadMeasured ? this.leadMs * 0.5 + latency * 0.5 : latency);
      this.leadMeasured = true;
      this.env.saveLeadMs(this.leadMs);
    }

    // The new element must keep up. A second decoder that turned out to be
    // software (or starved) presents a fraction of the rate; a hand-off to it is
    // worse than the native seam, so it is measured and undone (see degrade()).
    this.rateWatch = { settleAt: this.env.now() + 500, t0: null, f0: null };

    // Move the frame-watch to the new active element, drop the old, re-park it.
    this.cancelActiveRvfc();
    this.lastActive = bMeta;
    this.period.breakSequence();
    this.watchActive();
    try {
      a.pause();
    } catch { /* noop */ }
    for (const off of this.listeners.splice(0)) off();
    this.prepareStandby(true);
  }

  private abandonHandoff(reason: string): void {
    if (this.destroyed || this.state !== 'handoff') return;
    this.failures += 1;
    this.cb.log?.(`hand-off abandoned: ${reason} (${this.failures})`);
    try {
      this.standby().pause();
      this.standby().currentTime = 0;
    } catch { /* noop */ }
    this.cancelStandbyRvfc();
    if (this.failures >= this.opts.maxHandoffFailures) {
      this.giveUp(reason, true);
      return;
    }
    // One more try next lap: re-park and re-arm. The active element kept its
    // native loop, so the picture is fine meanwhile.
    for (const off of this.listeners.splice(0)) off();
    this.prepareStandby(true);
  }

  // ─── did the hand-off leave the picture worse? ──────────────────────────

  private checkRateAfterSwap(meta: RvfcMeta): void {
    const w = this.rateWatch;
    if (!w || this.destroyed || this.state === 'native') return;
    const now = this.env.now();
    if (now < w.settleAt || meta.presentedFrames === undefined) return;
    if (w.t0 === null || w.f0 === null) {
      w.t0 = now;
      w.f0 = meta.presentedFrames;
      return;
    }
    const dt = now - w.t0;
    if (dt < this.opts.rateWindowMs) return;
    this.rateWatch = null; // one verdict per hand-off
    const fps = ((meta.presentedFrames - w.f0) * 1000) / dt;
    const base = 1000 / this.baselinePeriodMs;
    if (Number.isFinite(fps) && Number.isFinite(base) && fps < base * this.opts.minRateAfterSwap) {
      this.degrade(`degraded-playback`);
    }
  }

  /**
   * The element the hand-off gave the glass to is presenting far fewer frames
   * than the one before it did: the second decoder is not a real one. Undo it —
   * hand the picture BACK to the element that had the hardware decoder, release
   * the bad one, and stay on the native loop. The device is blocked, because the
   * next lap would only do it again.
   */
  private degrade(reason: string): void {
    if (this.destroyed || this.state === 'native') return;
    const bad = this.active;
    const good: 0 | 1 = bad === 0 ? 1 : 0;
    const g = this.decks[good];
    const b = this.decks[bad];
    this.clearTimers();
    this.cancelStandbyRvfc();
    this.cancelActiveRvfc();
    for (const off of this.listeners.splice(0)) off();
    try {
      g.loop = true;
      g.muted = true;
      g.currentTime = 0; // it was re-parked here after the hand-off
      const p = g.play();
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => { /* the stall watchdog owns it */ });
    } catch { /* noop */ }
    this.active = good;
    this.cb.onReveal(good, bad);
    try {
      b.pause();
      b.removeAttribute('src');
      b.load(); // release the bad decoder
    } catch { /* noop */ }
    this.state = 'native';
    this.rateWatch = null;
    this.cb.log?.(`two-deck undone: ${reason}`);
    this.cb.onFallback(reason, true);
  }

  // ─── giving up ──────────────────────────────────────────────────────────

  private giveUp(reason: string, permanent: boolean): void {
    if (this.destroyed || this.state === 'native') return;
    this.clearTimers();
    this.cancelStandbyRvfc();
    for (const off of this.listeners.splice(0)) off();
    this.releaseStandby();
    try {
      this.decks[this.active].loop = true; // the native loop takes over
    } catch { /* noop */ }
    this.state = 'native';
    this.cb.log?.(`two-deck gave up: ${reason}`);
    this.cb.onFallback(reason, permanent);
    // The active element's frame watch is no longer needed for hand-offs.
    this.cancelActiveRvfc();
  }

  // ─── plumbing ───────────────────────────────────────────────────────────

  private clearTimers(): void {
    for (const k of ['readyTimer', 'handoffTimer', 'fireTimer'] as const) {
      const id = this[k];
      if (id !== null) {
        this.env.clearTimeout(id);
        this[k] = null;
      }
    }
  }

  private cancelActiveRvfc(): void {
    this.watchGen += 1; // ends the running chain even if its callback is already queued
    if (this.activeRvfc !== null) {
      try {
        this.decks[this.activeRvfc.deck].cancelVideoFrameCallback(this.activeRvfc.id);
      } catch { /* noop */ }
      this.activeRvfc = null;
    }
  }

  private cancelStandbyRvfc(): void {
    if (this.standbyRvfc !== null) {
      try {
        this.decks[this.standbyRvfc.deck].cancelVideoFrameCallback(this.standbyRvfc.id);
      } catch { /* noop */ }
      this.standbyRvfc = null;
    }
  }

  private cancelRvfcs(): void {
    this.cancelActiveRvfc();
    this.cancelStandbyRvfc();
  }
}

/** Keep the learned lead inside a believable band. */
function clampLead(ms: number): number {
  if (!Number.isFinite(ms)) return LOOP_DEFAULTS.defaultLeadMs;
  return Math.max(20, Math.min(600, ms));
}
