/** One media element, one advancing MSE timeline. Ordinary cycle boundaries
 * never seek, reload, change src, or call endOfStream. Buffers remain bounded.
 */
import { bounded, checkAbort, LOOP_CACHE, readLoopFragment, type LoopPackage } from './continuousLoopPackage';

export function cycleOffset(cycle: number, p: Pick<LoopPackage, 'durationTicks' | 'firstPts' | 'timescale'>): number {
  const ticks = cycle * p.durationTicks;
  if (!Number.isSafeInteger(cycle) || cycle < 0 || !Number.isSafeInteger(ticks)) throw new Error('timeline-overflow');
  return (ticks - p.firstPts) / p.timescale;
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

export function startContinuousLoop(video: HTMLVideoElement, p: LoopPackage, parent: AbortSignal) {
  const life = new AbortController();
  const signal = life.signal;
  const abort = () => life.abort();
  parent.addEventListener('abort', abort, { once: true });
  if (parent.aborted) life.abort();
  const source = new MediaSource();
  const url = URL.createObjectURL(source);
  const running = (async () => {
    checkAbort(signal);
    const cache = await caches.open(LOOP_CACHE);
    await sourceEvent(source, 'sourceopen', signal, () => { video.loop = false; video.src = url; });
    const buffer = source.addSourceBuffer(p.mime);
    buffer.mode = 'segments';
    source.duration = Infinity;
    const mutate = (fn: () => void) => sourceEvent(buffer, 'updateend', signal, fn);
    const init = await readLoopFragment(cache, p.init, signal);
    await mutate(() => buffer.appendBuffer(init));
    let cycle = 0; let index = 0; let until = 0; let pruned = 0; let started = false;
    while (!signal.aborted) {
      if (video.error || source.readyState !== 'open') throw new Error('mse-playback');
      const now = video.currentTime;
      if (now - 8 >= pruned + 2) {
        const removeTo = now - 8;
        await mutate(() => buffer.remove(0, removeTo));
        pruned = removeTo;
      }
      if (until - now >= 6) {
        await bounded(signal, 1000, () => new Promise<void>(r => setTimeout(r, 100)));
        continue;
      }
      const f = p.fragments[index];
      const bytes = await readLoopFragment(cache, f, signal);
      const offset = cycleOffset(cycle, p);
      await mutate(() => { buffer.timestampOffset = offset; buffer.appendBuffer(bytes); });
      until = (cycle * p.durationTicks + f.endTicks) / p.timescale;
      if (++index === p.fragments.length) { index = 0; cycle++; }
      if (!started && until >= Math.min(2, p.durationTicks / p.timescale)) {
        await bounded(signal, 15_000, () => video.play());
        started = true;
      }
    }
  })();
  return {
    running,
    dispose() {
      life.abort(); parent.removeEventListener('abort', abort);
      if (video.getAttribute('src') === url) { video.pause(); video.removeAttribute('src'); video.load(); }
      URL.revokeObjectURL(url);
    },
  };
}
