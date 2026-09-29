/**
 * The two-deck loop engine against a SIMULATED media pipeline: a virtual clock,
 * fake elements that load, seek, resume, present frames and wrap like `<video>`
 * does (with a configurable resume latency and native-wrap hitch), and the
 * engine driving them exactly as the component would.
 *
 * What is proved here is the engine's LOGIC — when it resumes the standby, that
 * it reveals only on a presented frame, that every failure ends on the native
 * loop, that it learns the device's resume latency. What is NOT proved is that a
 * real 4K Android decoder behaves like the model: that is what the boundary
 * telemetry and the physical-screen acceptance test are for.
 */
import { LoopDeckEngine, type DeckLike, type LoopCallbacks, type LoopEnv, type RvfcMeta } from '../loopDecks';
import type { BoundaryEvent } from '../loopBoundary';

// ── a discrete-event world ─────────────────────────────────────────────
class World {
  t = 0;
  private seq = 0;
  private q: Array<{ at: number; seq: number; fn: () => void; id: number; live: boolean }> = [];
  private nextId = 1;
  after(ms: number, fn: () => void): number {
    const id = this.nextId++;
    this.q.push({ at: this.t + Math.max(0, ms), seq: this.seq++, fn, id, live: true });
    return id;
  }
  cancel(id: number) {
    const e = this.q.find((x) => x.id === id);
    if (e) e.live = false;
  }
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const live = this.q.filter((e) => e.live && e.at <= end);
      if (live.length === 0) break;
      live.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const e = live[0];
      e.live = false;
      this.t = e.at;
      e.fn();
    }
    this.t = end;
  }
}

interface DeckCfg {
  durationS: number;
  fps: number;
  loadMs: number;
  playLatencyMs: number;
  seekMs: number;
  /** A native wrap freezes the picture this long (the hitch we are fixing). */
  wrapHitchMs: number;
  /** The element never finishes loading. */
  neverLoads?: boolean;
  /** Fires `error` when loaded. */
  errorOnLoad?: boolean;
  /** play() never presents a frame. */
  playStalls?: boolean;
  /** play() rejects. */
  playRejects?: boolean;
}

class FakeDeck implements DeckLike {
  private _t = 0;
  duration: number;
  paused = true;
  readyState = 0;
  ended = false;
  error: unknown = null;
  loop = false;
  muted = false;
  src = '';
  presented = 0;
  wraps = 0;
  private listeners = new Map<string, Array<(e?: unknown) => void>>();
  private rvfc = new Map<number, (n: number, m: RvfcMeta) => void>();
  private rvfcId = 1;
  private gen = 0;
  constructor(private w: World, private cfg: DeckCfg) {
    this.duration = cfg.durationS;
  }
  get currentTime() {
    return this._t;
  }
  /** An ASSIGNMENT is a seek (the pipeline advances `_t` itself). */
  set currentTime(v: number) {
    this._t = v;
    const g = this.gen;
    this.readyState = 1;
    this.w.after(this.cfg.seekMs, () => {
      if (g !== this.gen) return;
      this.readyState = 2;
      this.emit('seeked');
      if (this.paused) this.w.after(16, () => this.paused && this.present());
    });
  }
  private emit(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn({ type });
  }
  addEventListener(type: string, fn: (e?: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: (e?: unknown) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  requestVideoFrameCallback(cb: (n: number, m: RvfcMeta) => void) {
    const id = this.rvfcId++;
    this.rvfc.set(id, cb);
    return id;
  }
  cancelVideoFrameCallback(id: number) {
    this.rvfc.delete(id);
  }
  /** How many frame callbacks are registered on this element right now. */
  get pendingRvfc() {
    return this.rvfc.size;
  }
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
  private present() {
    this.presented += 1;
    const meta: RvfcMeta = { mediaTime: this._t, expectedDisplayTime: this.w.t, presentedFrames: this.presented };
    const cbs = [...this.rvfc.entries()];
    this.rvfc.clear();
    for (const [, cb] of cbs) cb(this.w.t, meta);
  }
  load() {
    this.gen++;
    const g = this.gen;
    this.readyState = 0;
    this.paused = true;
    this._t = 0;
    this.ended = false;
    if (this.cfg.neverLoads) return;
    this.w.after(this.cfg.loadMs, () => {
      if (g !== this.gen || !this.src) return;
      if (this.cfg.errorOnLoad) {
        this.error = { code: 4 };
        this.emit('error');
        return;
      }
      this.readyState = 2;
      this.emit('loadeddata');
      this.w.after(16, () => g === this.gen && this.paused && this.present()); // the parked first frame
    });
  }
  play() {
    if (this.cfg.playRejects) return Promise.reject(new Error('NotAllowedError'));
    this.paused = false;
    this.ended = false;
    const g = this.gen;
    if (this.cfg.playStalls) return Promise.resolve();
    this.w.after(this.cfg.playLatencyMs, () => g === this.gen && !this.paused && this.tick(g));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  /** Start presenting frames now (used to put deck 0 "already playing"). */
  startPlaying() {
    this.paused = false;
    this.readyState = 2;
    this.tick(this.gen);
  }
  private tick(g: number) {
    if (g !== this.gen || this.paused) return;
    if (this._t >= this.duration - 1e-9) {
      // The last frame has finished displaying: this is the end.
      if (this.loop) {
        this.wraps += 1;
        this._t = 0;
        // the native wrap: a seek + decoder restart — the picture freezes
        this.w.after(this.cfg.wrapHitchMs, () => this.tick(g));
        return;
      }
      this._t = this.duration;
      this.ended = true;
      this.paused = true;
      this.emit('ended');
      return;
    }
    this.present();
    this._t += 1 / this.cfg.fps;
    this.w.after(1000 / this.cfg.fps, () => this.tick(g));
  }
}

// ── the harness ────────────────────────────────────────────────────────
function rig(cfg0: Partial<DeckCfg> = {}, cfg1: Partial<DeckCfg> = {}, opts: ConstructorParameters<typeof LoopDeckEngine>[4] = {}, storedLead: number | null = null) {
  const w = new World();
  const base: DeckCfg = { durationS: 3, fps: 30, loadMs: 60, playLatencyMs: 90, seekMs: 40, wrapHitchMs: 320 };
  const d0 = new FakeDeck(w, { ...base, ...cfg0 });
  const d1 = new FakeDeck(w, { ...base, ...cfg1 });
  // Deck 0 is already playing (the component starts it).
  d0.src = 'clip.mp4';
  d0.startPlaying();
  const saved: number[] = [];
  const events: BoundaryEvent[] = [];
  const reveals: Array<[number, number]> = [];
  const fallbacks: Array<[string, boolean]> = [];
  const env: LoopEnv = {
    now: () => w.t,
    setTimeout: (fn, ms) => w.after(ms, fn),
    clearTimeout: (id) => w.cancel(id),
    loadLeadMs: () => storedLead,
    saveLeadMs: (ms) => saved.push(ms),
  };
  const cb: LoopCallbacks = {
    onReveal: (n, p) => reveals.push([n, p]),
    onBoundary: (e) => events.push(e),
    onFallback: (r, perm) => fallbacks.push([r, perm]),
  };
  const engine = new LoopDeckEngine([d0, d1], 'clip.mp4', env, cb, opts);
  engine.start();
  return { w, d0, d1, engine, saved, events, reveals, fallbacks };
}

describe('LoopDeckEngine', () => {
  it('hands the picture over BEFORE the end, lap after lap, with the active deck looping as its safety net', () => {
    const r = rig();
    r.w.advance(14_000); // ~4 laps of a 3 s clip
    expect(r.reveals.length).toBeGreaterThanOrEqual(3);
    // Roles alternate.
    expect(r.reveals.slice(0, 3).map(([n]) => n)).toEqual([1, 0, 1]);
    // No native wrap ever happened on the deck that was on glass: the hand-off got there first.
    expect(r.d0.wraps + r.d1.wraps).toBe(0);
    // The active deck always keeps the native loop; the finished one does not wrap on its own.
    const active = r.engine.activeIndex === 0 ? r.d0 : r.d1;
    const other = r.engine.activeIndex === 0 ? r.d1 : r.d0;
    expect(active.loop).toBe(true);
    expect(other.loop).toBe(false);
    expect(r.fallbacks).toEqual([]);
  });

  it('never leaves a stale frame-watch chain behind: after every hand-off the new active element has exactly one', () => {
    const r = rig();
    for (let lap = 0; lap < 5; lap++) {
      r.w.advance(3_100);
      const active = r.engine.activeIndex === 0 ? r.d0 : r.d1;
      const other = r.engine.activeIndex === 0 ? r.d1 : r.d0;
      expect(active.pendingRvfc).toBe(1);
      expect(other.pendingRvfc).toBeLessThanOrEqual(1); // at most its own parking callback
    }
  });

  it('measures the seam: after the first laps the hold and the skipped content are within about a frame', () => {
    const r = rig();
    r.w.advance(20_000);
    expect(r.events.length).toBeGreaterThanOrEqual(5);
    const settled = r.events.slice(2); // the lead has had two hand-offs to learn the device
    for (const e of settled) {
      expect(e.backend).toBe('twodeck');
      expect(e.holdMs).toBeLessThan(45);
      expect(e.skipMs).toBeLessThan(75);
    }
  });

  it('learns a slow device: a 250 ms resume latency starts as a hold and converges', () => {
    const r = rig({ playLatencyMs: 250 }, { playLatencyMs: 250 });
    r.w.advance(30_000);
    expect(r.events[0].holdMs).toBeGreaterThan(100); // the first guess (120 ms) was too short
    const last = r.events[r.events.length - 1];
    expect(last.holdMs).toBeLessThan(45); // …and it converged
    expect(r.engine.currentLeadMs).toBeGreaterThan(200);
    expect(r.saved.length).toBe(r.events.length); // and it remembers it for the next session
  });

  it('the FIRST measured latency replaces the guess outright — the second lap is already right', () => {
    const r = rig({ playLatencyMs: 40 }, { playLatencyMs: 40 }); // a fast device; the default guess is 120 ms
    r.w.advance(12_000);
    expect(r.events[0].skipMs).toBeGreaterThan(60); // lap 1 started too early (the guess)
    expect(r.events[1].skipMs).toBeLessThan(45); // lap 2 has the measurement
    expect(r.events[1].holdMs).toBeLessThan(45);
  });

  it('starts from a stored lead, so a known device is right from the first lap', () => {
    const r = rig({ playLatencyMs: 250 }, { playLatencyMs: 250 }, {}, 250);
    r.w.advance(8_000);
    expect(r.events[0].holdMs).toBeLessThan(45);
  });

  it('a standby that errors while loading gives up at once: native loop, standby released, no hand-off', () => {
    const r = rig({}, { errorOnLoad: true });
    r.w.advance(20_000);
    expect(r.fallbacks).toEqual([['standby-error', true]]);
    expect(r.engine.mode).toBe('native');
    expect(r.reveals).toEqual([]);
    expect(r.d1.src).toBe(''); // released, not merely paused
    expect(r.d0.loop).toBe(true);
    expect(r.d0.wraps).toBeGreaterThan(0); // the native loop is what runs now
  });

  it('giving up re-asserts the native loop on the active deck even if something had cleared it', () => {
    const r = rig({}, { errorOnLoad: true });
    r.d0.loop = false; // as if another effect had touched it
    r.w.advance(1_000);
    expect(r.engine.mode).toBe('native');
    expect(r.d0.loop).toBe(true);
  });

  it('a standby that never parks is abandoned after the deadline, not waited on forever', () => {
    const r = rig({}, { neverLoads: true }, { standbyReadyMs: 5_000 });
    r.w.advance(4_900);
    expect(r.fallbacks).toEqual([]);
    r.w.advance(200);
    expect(r.fallbacks).toEqual([['standby-not-ready', true]]);
  });

  it('a hand-off whose first frame never comes is abandoned; a second failure gives up for good', () => {
    const r = rig({}, { playStalls: true }, { handoffTimeoutMs: 800 });
    r.w.advance(25_000);
    expect(r.reveals).toEqual([]); // it NEVER reveals a frame it has not seen
    expect(r.fallbacks).toEqual([['handoff-timeout', true]]);
    expect(r.engine.mode).toBe('native');
    expect(r.d0.wraps).toBeGreaterThan(0);
  });

  it('a play() the browser rejects is a failed hand-off, not an unhandled rejection', async () => {
    const r = rig({}, { playRejects: true });
    r.w.advance(25_000);
    await Promise.resolve();
    expect(r.reveals).toEqual([]);
    expect(r.fallbacks[0][0]).toMatch(/play-rejected|handoff-timeout/);
  });

  it('does not give a struggling decoder a second job: an active element that cannot keep up is left alone', () => {
    const r = rig({ fps: 8 }, {}); // the picture is already arriving at 8 fps
    r.w.advance(20_000);
    expect(r.fallbacks).toEqual([['not-keeping-up', false]]); // a state, not a verdict on the device: no block
    expect(r.reveals).toEqual([]);
    expect(r.engine.mode).toBe('native');
    expect(r.d1.src).toBe(''); // the standby was released, not left holding a decoder
    expect(r.d0.loop).toBe(true);
  });

  it('a slow but healthy clip (15 fps) is not mistaken for a struggling decoder', () => {
    const r = rig({ fps: 15 }, { fps: 15 });
    r.w.advance(40_000);
    expect(r.fallbacks).toEqual([]);
    expect(r.reveals.length).toBeGreaterThanOrEqual(3);
  });

  it('undoes a hand-off whose new element presents far fewer frames — the picture goes BACK to the healthy one', () => {
    // Deck 1 is the "second decoder that turned out to be software": 6 fps against deck 0's 30.
    const r = rig({}, { fps: 6 });
    r.w.advance(15_000);
    expect(r.reveals[0]).toEqual([1, 0]); // it did hand off to deck 1…
    expect(r.reveals[1]).toEqual([0, 1]); // …noticed within a few seconds, and handed back
    expect(r.fallbacks).toEqual([['degraded-playback', true]]); // and blocks the device
    expect(r.engine.mode).toBe('native');
    expect(r.engine.activeIndex).toBe(0);
    expect(r.d0.paused).toBe(false); // the healthy element is playing again
    expect(r.d0.loop).toBe(true);
    expect(r.d1.src).toBe(''); // the bad decoder is released
    const presentedThen = r.d0.presented;
    r.w.advance(1_000);
    expect(r.d0.presented).toBeGreaterThan(presentedThen); // and frames are actually flowing
  });

  it('a healthy hand-off is left alone (the rate check does not fire on 30 fps)', () => {
    const r = rig();
    r.w.advance(30_000);
    expect(r.fallbacks).toEqual([]);
    expect(r.reveals.length).toBeGreaterThanOrEqual(8);
  });

  it('a clip too short to prepare for is never handed off — it just loops', () => {
    const r = rig({ durationS: 1.2 }, { durationS: 1.2 });
    r.w.advance(10_000);
    expect(r.reveals).toEqual([]);
    expect(r.fallbacks).toEqual([]);
    expect(r.d0.wraps).toBeGreaterThan(3);
  });

  it('destroy() stops everything and leaves the active element as a native loop would have it', () => {
    const r = rig();
    r.w.advance(3_000);
    const before = r.reveals.length;
    r.engine.destroy();
    const active = r.engine.activeIndex === 0 ? r.d0 : r.d1;
    r.w.advance(20_000);
    expect(r.reveals.length).toBe(before);
    expect(r.events.length).toBe(before);
    expect(active.loop).toBe(true);
    expect(r.engine.mode).toBe('native');
    r.engine.destroy(); // idempotent
  });

  it('never resumes the standby before it is parked', () => {
    const r = rig({ durationS: 3 }, { loadMs: 30_000 }, { standbyReadyMs: 60_000 });
    r.w.advance(9_000);
    expect(r.d1.paused).toBe(true);
    expect(r.reveals).toEqual([]);
  });
});
