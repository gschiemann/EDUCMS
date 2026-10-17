/** One media element, one advancing MSE timeline. Ordinary cycle boundaries
 * never seek, reload, change src, or call endOfStream. Buffers remain bounded.
 */
import { ContinuousPumpDiagnostics } from './continuousDiagnostics';
import { bounded, checkAbort, LOOP_CACHE, readLoopFragment, type LoopPackage } from './continuousLoopPackage';

// A verified cache read is bounded at 15 seconds. Six seconds of headroom
// cannot cover that legal operation on slow/contended Android flash storage.
export const CONTINUOUS_AHEAD_SECONDS = 20;

export function bufferedAhead(now: number, ranges: TimeRanges): number {
  for (let i = 0; i < ranges.length; i++) {
    if (ranges.start(i) <= now && ranges.end(i) > now) return ranges.end(i) - now;
  }
  return 0;
}

export function cycleOffset(cycle: number, p: Pick<LoopPackage, 'durationTicks' | 'firstPts' | 'timescale'>): number {
  const ticks = cycle * p.durationTicks;
  if (!Number.isSafeInteger(cycle) || cycle < 0 || !Number.isSafeInteger(ticks)) throw new Error('timeline-overflow');
  return (ticks - p.firstPts) / p.timescale;
}

/** MSE removal extends to the next random-access point. A fixed now-minus-8
 * cut can therefore remove the playing GOP when keyframes are farther apart.
 * Stop one source tick BEFORE a retained keyframe at/before the history target,
 * so floating-point rounding cannot push removal into the following GOP.
 * https://www.w3.org/TR/media-source-2/#sourcebuffer-coded-frame-removal
 */
export function pruneEnd(nowS: number, p: Pick<LoopPackage, 'durationTicks' | 'timescale' | 'keyframeTicks'>): number {
  if (!Number.isFinite(nowS) || nowS <= 8) return 0;
  const targetTicks = Math.floor((nowS - 8) * p.timescale);
  if (!Number.isSafeInteger(targetTicks)) throw new Error('timeline-overflow');
  const cycle = Math.floor(targetTicks / p.durationTicks);
  const within = targetTicks - cycle * p.durationTicks;
  let lo = 0; let hi = p.keyframeTicks.length;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (p.keyframeTicks[mid] <= within) lo = mid;
    else hi = mid;
  }
  return Math.max(0, cycle * p.durationTicks + p.keyframeTicks[lo] - 1) / p.timescale;
}

// ── WHEN the one stream takes over (2026-10-17, player rock-solid §4B) ────
//
// Attaching the MSE stream sets a new `src`, and the stream starts at the
// clip's first frame. Attached the moment the package was ready, that was a
// jump back to frame 0 in the middle of the clip — on every GUQ at the nightly
// bundle apply and on every operator refresh. So the element keeps playing the
// file with the browser's own loop until that loop wraps (`NativeWrapDetector`
// → `educms-loop-boundary`), and the stream takes over exactly there: its own
// frame 0 lands on the clip's own loop point. The held-frame canvas still
// covers the hand-over. Bounded: no wrap within one full lap plus slack (a
// stalled or paused element never wraps) → attach anyway, as before.

/** Slack beyond one full lap before the stream attaches without a loop point. */
export const ATTACH_BOUNDARY_SLACK_MS = 5_000;
/** The browser-native loop's wrap, dispatched by ContinuousLoopVideo's frame callback. */
export const LOOP_BOUNDARY_EVENT = 'educms-loop-boundary';

/** How long to wait for the clip's own loop point: one full lap plus slack. */
export function attachBoundaryWaitMs(p: Pick<LoopPackage, 'durationTicks' | 'timescale'>): number {
  const lapMs = p.timescale > 0 ? (p.durationTicks / p.timescale) * 1000 : NaN;
  return Number.isFinite(lapMs) && lapMs > 0 ? Math.ceil(lapMs) + ATTACH_BOUNDARY_SLACK_MS : ATTACH_BOUNDARY_SLACK_MS;
}

export interface AttachGate {
  /** The native loop just wrapped (the clip's own loop point). */
  boundary: boolean;
  /** Time since the package became ready and the wait began. */
  waitedMs: number;
  /** `attachBoundaryWaitMs` for this clip. */
  waitMs: number;
  /** The Android hardware engine is about to take this element's glass. */
  nativeHandoffPending: boolean;
}

/**
 * Pure: attach the stream now, or keep waiting? A pending hardware hand-off
 * always wins — it replaces this element at the same loop point, and a stream
 * attached there would leave it no playing frame to hold.
 */
export function continuousAttachDecision(g: AttachGate): 'attach' | 'wait' {
  if (g.nativeHandoffPending) return 'wait';
  if (g.boundary) return 'attach';
  return g.waitedMs >= g.waitMs ? 'attach' : 'wait';
}

/** Is this element inside a hardware-engine wrapper that is handing over (NativeDualVideo)? */
export function nativeHandoffPendingFor(el: { closest?: (selector: string) => unknown } | null | undefined): boolean {
  try { return !!el?.closest?.('[data-native-handoff="pending"]'); } catch { return false; }
}

/**
 * Resolve at the element's next native loop point, or once `waitMs` has gone by
 * without one. While a hardware hand-off is pending it keeps waiting (checked
 * again every slack interval). Rejects with an AbortError on `signal`.
 */
export function waitForLoopBoundary(
  target: EventTarget,
  waitMs: number,
  signal: AbortSignal,
  opts: { nativeHandoffPending?: () => boolean; now?: () => number } = {},
): Promise<'boundary' | 'timeout'> {
  const now = opts.now ?? (() => Date.now());
  const pending = opts.nativeHandoffPending ?? (() => false);
  const startedAt = now();
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      if (timer !== undefined) clearTimeout(timer);
      target.removeEventListener(LOOP_BOUNDARY_EVENT, onBoundary);
      signal.removeEventListener('abort', onAbort);
    };
    const settle = (how: 'boundary' | 'timeout') => { clear(); resolve(how); };
    const gate = (boundary: boolean) => continuousAttachDecision({
      boundary, waitedMs: now() - startedAt, waitMs, nativeHandoffPending: pending(),
    });
    const onBoundary = () => { if (gate(true) === 'attach') settle('boundary'); };
    const arm = (ms: number) => {
      timer = setTimeout(() => {
        if (gate(false) === 'attach') settle('timeout');
        else arm(ATTACH_BOUNDARY_SLACK_MS);
      }, Math.max(0, ms));
    };
    const onAbort = () => { clear(); reject(new DOMException('Cancelled', 'AbortError')); };
    if (signal.aborted) { onAbort(); return; }
    target.addEventListener(LOOP_BOUNDARY_EVENT, onBoundary);
    signal.addEventListener('abort', onAbort, { once: true });
    arm(waitMs);
  });
}

function sourceEvent(target: EventTarget, event: string, signal: AbortSignal, action: () => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { clear(); reject(new Error('mse-operation-timeout')); }, 15_000);
    const clear = () => { clearTimeout(timer); target.removeEventListener(event, done); target.removeEventListener('error', error); signal.removeEventListener('abort', abort); };
    const done = () => { clear(); resolve(); };
    const error = () => { clear(); reject(new Error('mse-operation')); };
    const abort = () => { clear(); reject(new DOMException('Cancelled', 'AbortError')); };
    target.addEventListener(event, done, { once: true });
    target.addEventListener('error', error, { once: true });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try { action(); } catch (e) { clear(); reject(e); }
  });
}

export function startContinuousLoop(video: HTMLVideoElement, p: LoopPackage, parent: AbortSignal, beforeAttach?: () => void) {
  const life = new AbortController();
  const signal = life.signal;
  const abort = () => life.abort();
  parent.addEventListener('abort', abort, { once: true });
  if (parent.aborted) life.abort();
  const source = new MediaSource();
  const url = URL.createObjectURL(source);
  const diagnostics = new ContinuousPumpDiagnostics();
  let sourceBuffer: SourceBuffer | undefined;
  const state = { phase: 'open', cycle: 0, fragment: 0, appendedUntil: 0, aheadTarget: CONTINUOUS_AHEAD_SECONDS, quotaBackoffs: 0 };
  const running = (async () => {
    checkAbort(signal);
    const cache = await caches.open(LOOP_CACHE);
    await sourceEvent(source, 'sourceopen', signal, () => { beforeAttach?.(); video.loop = false; video.src = url; });
    const buffer = source.addSourceBuffer(p.mime);
    sourceBuffer = buffer;
    buffer.mode = 'segments';
    source.duration = Infinity;
    const mutate = (fn: () => void) => sourceEvent(buffer, 'updateend', signal, fn);
    const init = await diagnostics.measure('read', () => readLoopFragment(cache, p.init, signal));
    state.phase = 'init';
    await diagnostics.measure('append', () => mutate(() => buffer.appendBuffer(init)));
    let cycle = 0; let index = 0; let until = 0; let pruned = 0; let started = false;
    while (!signal.aborted) {
      if (video.error || source.readyState !== 'open') throw new Error('mse-playback');
      const now = video.currentTime;
      const ahead = bufferedAhead(now, buffer.buffered);
      diagnostics.observeAhead(ahead);
      if (ahead >= state.aheadTarget) {
        state.phase = 'buffered';
        await bounded(signal, 1000, () => new Promise<void>(r => setTimeout(r, 100)));
        continue;
      }
      const removeTo = pruneEnd(now, p);
      // Refill a starving buffer before doing optional history cleanup.
      if (ahead >= 6 && removeTo - pruned >= 2) {
        state.phase = 'prune';
        await diagnostics.measure('prune', () => mutate(() => buffer.remove(0, removeTo)));
        pruned = removeTo;
      }
      const f = p.fragments[index];
      state.phase = 'read'; state.cycle = cycle; state.fragment = index;
      const bytes = await diagnostics.measure('read', () => readLoopFragment(cache, f, signal));
      const offset = cycleOffset(cycle, p);
      state.phase = 'append';
      try {
        await diagnostics.measure('append', () => mutate(() => { buffer.timestampOffset = offset; buffer.appendBuffer(bytes); }));
      } catch (error) {
        // Android can expose a smaller MSE quota even with a supported codec.
        // Keep the same full-quality stream, start/consume buffered frames and
        // retry this fragment at a smaller horizon. Never skip a source sample.
        const available = bufferedAhead(video.currentTime, buffer.buffered);
        if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError' || available < 2) throw error;
        state.aheadTarget = Math.max(2, Math.min(state.aheadTarget, available - 1));
        state.quotaBackoffs++;
        state.phase = 'buffer-pressure';
        if (!started) {
          await bounded(signal, 15_000, () => video.play());
          started = true; diagnostics.start();
        }
        await bounded(signal, 1000, () => new Promise<void>(r => setTimeout(r, 100)));
        continue;
      }
      until = (cycle * p.durationTicks + f.endTicks) / p.timescale;
      state.appendedUntil = Math.round(until * 1000) / 1000;
      if (++index === p.fragments.length) { index = 0; cycle++; }
      if (!started && bufferedAhead(now, buffer.buffered) >= state.aheadTarget) {
        state.phase = 'play';
        await bounded(signal, 15_000, () => video.play());
        started = true; diagnostics.start();
      }
    }
  })();
  return {
    running,
    snapshot() {
      try { if (sourceBuffer) diagnostics.observeAhead(bufferedAhead(video.currentTime, sourceBuffer.buffered)); }
      catch { /* A detached buffer must not interfere with failure reporting. */ }
      return { ...state, diagnostics: diagnostics.snapshot() };
    },
    dispose() {
      life.abort(); parent.removeEventListener('abort', abort);
      if (video.getAttribute('src') === url) { video.pause(); video.removeAttribute('src'); video.load(); }
      URL.revokeObjectURL(url);
    },
  };
}
