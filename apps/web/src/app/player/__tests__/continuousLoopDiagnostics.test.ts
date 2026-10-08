import { startContinuousLoop } from '../continuousLoop';
import { readLoopFragment, type LoopPackage } from '../continuousLoopPackage';
import { CONTINUOUS_LOOP_REVISION } from '../continuousLoopRevision';
jest.mock('../continuousLoopPackage', () => ({ ...jest.requireActual('../continuousLoopPackage'), readLoopFragment: jest.fn() }));

test('the real pump measures cache, append and prune without counting initial buffering as starvation', async () => {
  jest.useFakeTimers();
  let operationClock = 0; let end = 0; let currentTime = 0;
  jest.spyOn(performance, 'now').mockImplementation(() => operationClock);
  const ranges = { length: 1, start: () => 0, end: () => end };
  class Buffer extends EventTarget {
    mode = ''; timestampOffset = 0; buffered = ranges;
    appendBuffer(bytes: ArrayBuffer) {
      operationClock += 11;
      if (bytes.byteLength > 1) end += 2;
      setTimeout(() => this.dispatchEvent(new Event('updateend')), 0);
    }
    remove() { operationClock += 13; setTimeout(() => this.dispatchEvent(new Event('updateend')), 0); }
  }
  class Source extends EventTarget {
    readyState = 'open'; duration = 0;
    constructor() { super(); setTimeout(() => this.dispatchEvent(new Event('sourceopen')), 0); }
    addSourceBuffer() { return new Buffer(); }
  }
  const originals = Object.fromEntries(['MediaSource', 'caches'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const urlOriginals = Object.fromEntries(['createObjectURL', 'revokeObjectURL'].map(k => [k, Object.getOwnPropertyDescriptor(URL, k)]));
  Object.defineProperty(globalThis, 'MediaSource', { configurable: true, value: Source });
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { open: jest.fn().mockResolvedValue({}) } });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:test' });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
  const video = document.createElement('video');
  Object.defineProperty(video, 'currentTime', { get: () => currentTime });
  jest.spyOn(video, 'play').mockResolvedValue();
  jest.spyOn(video, 'pause').mockImplementation(() => undefined);
  jest.spyOn(video, 'load').mockImplementation(() => undefined);
  (readLoopFragment as jest.Mock).mockImplementation(async (_cache, fragment) => {
    operationClock += 7; return new ArrayBuffer(fragment.endTicks === 0 ? 1 : 2);
  });
  const init = { key: 'init', bytes: 1, sha256: 'a'.repeat(64), endTicks: 0 };
  const p: LoopPackage = { version: CONTINUOUS_LOOP_REVISION, sourceHash: 'a'.repeat(64), mime: 'video/mp4',
    timescale: 30, durationTicks: 3000, firstPts: 0, init,
    fragments: Array.from({ length: 50 }, (_, i) => ({ ...init, key: `${i}`, bytes: 2, endTicks: (i + 1) * 60 })),
    keyframeTicks: Array.from({ length: 50 }, (_, i) => i * 60) };
  const engine = startContinuousLoop(video, p, new AbortController().signal);
  const finished = engine.running.catch(error => error);
  try {
    await jest.advanceTimersByTimeAsync(100);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(engine.snapshot().diagnostics).toMatchObject({ aheadMs: 20000, minAheadMs: 20000,
      latency: { read: { count: 11, totalMs: 77, maxMs: 7 }, append: { count: 11, totalMs: 121, maxMs: 11 }, prune: { count: 0 } } });
    currentTime = 12;
    await jest.advanceTimersByTimeAsync(100);
    expect(engine.snapshot().diagnostics).toMatchObject({ aheadMs: 20000, minAheadMs: 8000,
      latency: { prune: { count: 1, totalMs: 13, maxMs: 13 } } });
    expect(video.play).toHaveBeenCalledTimes(1);
  } finally {
    engine.dispose(); await finished;
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
    for (const [key, descriptor] of Object.entries(urlOriginals)) {
      if (descriptor) Object.defineProperty(URL, key, descriptor); else Reflect.deleteProperty(URL, key);
    }
    jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks();
  }
});
