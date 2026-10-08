/**
 * ContinuousLoopVideo — the fallback is final for a mount (2026-10-03 review).
 *
 * The element plays the original file with the native loop WHILE the one-stream
 * package is prepared. Two things went wrong when that native playback stalled
 * during preparation (a weak panel hashing and writing fragments beside a 4K
 * decode is exactly where it stalls):
 *   1. the stall detector reports an episode once, and that one report was spent
 *      on `fallback()` — which does not touch an element that is already on the
 *      original file — so the stalled video was never recovered;
 *   2. preparation carried on, and the finished package started the stream on a
 *      mount that had already recorded the fallback. A later stream failure could
 *      then no longer fall back (the guard was spent) and left a dead source.
 */
import { render, act } from '@testing-library/react';

const startContinuousLoop = jest.fn(() => ({ running: new Promise<void>(() => undefined), snapshot: () => ({ phase: 'buffered' }), dispose: jest.fn() }));
let finishPackage: (p: unknown) => void = () => undefined;
const prepareLoopPackage = jest.fn((...args: [src: string, hash: string, signal: AbortSignal]) => { void args; return new Promise(resolve => { finishPackage = resolve; }); });
jest.mock('../continuousLoop', () => ({ startContinuousLoop: (...a: unknown[]) => (startContinuousLoop as jest.Mock)(...a) }));
jest.mock('../continuousLoopPackage', () => ({ prepareLoopPackage: (...a: unknown[]) => (prepareLoopPackage as jest.Mock)(...a) }));

import { ContinuousLoopVideo } from '../ContinuousLoopVideo';
import { videoQualityTracker } from '../videoQuality';

const HASH = 'a'.repeat(64);
const PACKAGE = { durationTicks: 90_000, timescale: 30_000 };
let clock = 0;
let play: jest.SpyInstance;
let load: jest.SpyInstance;
let frameCallbacks: Array<(now: number, meta: { mediaTime: number; expectedDisplayTime: number; presentedFrames: number }) => void>;

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  startContinuousLoop.mockClear();
  startContinuousLoop.mockImplementation(() => ({ running: new Promise<void>(() => undefined), snapshot: () => ({ phase: 'buffered' }), dispose: jest.fn() }));
  prepareLoopPackage.mockClear();
  clock = 0;
  Object.defineProperties(HTMLVideoElement.prototype, {
    videoWidth: { configurable: true, get: () => 0 },
    videoHeight: { configurable: true, get: () => 0 },
    readyState: { configurable: true, get: () => 0 },
  });
  frameCallbacks = [];
  Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', { configurable: true, value: (fn: typeof frameCallbacks[number]) => { frameCallbacks.push(fn); return frameCallbacks.length; } });
  Object.defineProperty(HTMLVideoElement.prototype, 'cancelVideoFrameCallback', { configurable: true, value: () => undefined });
  play = jest.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  load = jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: jest.fn() } as unknown as CanvasRenderingContext2D);
  // A playing element whose clock the test drives.
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get: () => false });
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { configurable: true, get: () => clock, set: () => undefined });
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>).requestVideoFrameCallback;
  delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>).cancelVideoFrameCallback;
});

/** Let the dynamic imports and the awaits behind them settle. */
async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
}

function mount(onError = jest.fn()) {
  const view = render(
    <ContinuousLoopVideo src="https://media.invalid/clip.mp4" sourceHash={HASH} videoKey="item-1"
      isActive classes="" onError={onError} />,
  );
  return { ...view, onError, video: view.container.querySelector('video') as HTMLVideoElement };
}

async function presentFrame() {
  act(() => { frameCallbacks.shift()!(0, { mediaTime: clock, expectedDisplayTime: Date.now(), presentedFrames: 1 }); });
  await settle();
}

it('keeps frame and stall evidence across frequent playing events after rebuffering', () => {
  let total = 0;
  let dropped = 0;
  Object.defineProperty(HTMLVideoElement.prototype, 'getVideoPlaybackQuality', {
    configurable: true,
    value: () => ({ totalVideoFrames: total, droppedVideoFrames: dropped }),
  });
  const start = Date.now();
  const { video, unmount } = mount();
  video.dispatchEvent(new Event('playing'));
  // Ten short rebuffer episodes. Each stretch alone is below the minimum
  // sample size, while the complete window shows the real playback failure.
  for (let i = 0; i < 10; i++) {
    total += 30; dropped += 15;
    jest.setSystemTime(start + i * 1000 + 700);
    video.dispatchEvent(new Event('waiting'));
    jest.setSystemTime(start + (i + 1) * 1000);
    video.dispatchEvent(new Event('playing'));
  }
  const report = videoQualityTracker.take(Date.now());
  unmount();
  delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>).getVideoPlaybackQuality;
  expect(report).toMatchObject({ totalFrames: 300, droppedFrames: 150, stalls: 10, stalledMs: 3000 });
});

it('adopts the one-stream engine when preparation finishes on a healthy element (control)', async () => {
  const { video } = mount();
  await settle();
  expect(prepareLoopPackage).not.toHaveBeenCalled();
  await presentFrame();
  expect(prepareLoopPackage).toHaveBeenCalledTimes(1);
  // The clock advances every watchdog sample: no stall.
  for (let i = 0; i < 6; i++) { clock += 4; act(() => { jest.advanceTimersByTime(4_000); }); }
  await act(async () => { finishPackage(PACKAGE); await Promise.resolve(); });
  await settle();
  expect(startContinuousLoop).toHaveBeenCalledTimes(1);
  expect(video.dataset.loopBackend).toBe('continuous');
});

it('a stall while preparing recovers the native element, stops preparing, and never starts the stream', async () => {
  const { video, onError } = mount();
  await settle();
  await presentFrame();
  const signal = prepareLoopPackage.mock.calls[0][2];
  expect(signal.aborted).toBe(false);
  const loadsBefore = load.mock.calls.length;
  // The clock never moves: 12 s without progress is one stall episode.
  act(() => { jest.advanceTimersByTime(24_000); });
  expect(video.dataset.loopBackend).toBe('native');
  expect(signal.aborted).toBe(true);                          // preparation was told to stop
  expect(load.mock.calls.length).toBe(loadsBefore + 1);       // the stalled element was restarted once
  expect(play).toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  // The package finishing late must not take over a mount that fell back.
  await act(async () => { finishPackage(PACKAGE); await Promise.resolve(); });
  await settle();
  expect(startContinuousLoop).not.toHaveBeenCalled();
  expect(video.dataset.loopBackend).toBe('native');
});

it('a second stall after the native recovery hands the file to the page as failed, once', async () => {
  const { onError } = mount();
  await settle();
  await presentFrame();
  act(() => { jest.advanceTimersByTime(24_000); });           // episode 1 → fallback + reload
  expect(onError).not.toHaveBeenCalled();
  clock += 1; await presentFrame(); act(() => { jest.advanceTimersByTime(4_000); }); // progress re-arms the detector
  act(() => { jest.advanceTimersByTime(24_000); });           // episode 2 → the file
  expect(onError).toHaveBeenCalledTimes(1);
});

it('retains a 4K frame through adoption until replacement frame output, and frees it on cleanup', async () => {
  const frames: Array<(now: number, meta: { mediaTime: number; expectedDisplayTime: number; presentedFrames: number }) => void> = [];
  Object.defineProperties(HTMLVideoElement.prototype, {
    videoWidth: { configurable: true, get: () => 3840 },
    videoHeight: { configurable: true, get: () => 2160 },
    readyState: { configurable: true, get: () => 4 },
  });
  const drawImage = jest.fn();
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  const request = jest.fn((fn: typeof frames[number]) => { frames.push(fn); return frames.length; });
  Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', { configurable: true, value: request });
  const { video, container, unmount } = mount();
  await settle();
  act(() => { frames.shift()!(0, { mediaTime: 0, expectedDisplayTime: 0, presentedFrames: 1 }); });
  await settle();
  startContinuousLoop.mockImplementation((...args: unknown[]) => {
    (args[3] as () => void)();
    video.src = 'blob:new-pipeline';
    return { running: new Promise<void>(() => undefined), snapshot: () => ({ phase: 'buffered' }), dispose: jest.fn() };
  });
  await act(async () => { finishPackage(PACKAGE); await Promise.resolve(); });
  await settle();
  const canvas = container.querySelector('canvas')!;
  expect(canvas.style.display).toBe('block');
  expect([canvas.width, canvas.height]).toEqual([3840, 2160]);
  // Clock changes / playing events cannot dismiss the retained pixels.
  act(() => { video.dispatchEvent(new Event('playing')); });
  expect(canvas.style.display).toBe('block');
  act(() => { video.dispatchEvent(new Event('loadeddata')); });
  expect(canvas.style.display).toBe('block');
  act(() => { frames.shift()!(1, { mediaTime: 0, expectedDisplayTime: 1, presentedFrames: 1 }); });
  expect([canvas.width, canvas.height, canvas.style.display]).toEqual([0, 0, 'none']);
  canvas.width = 3840; canvas.height = 2160;
  unmount();
  expect(canvas.width).toBe(0);
  delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>).requestVideoFrameCallback;
});

it('a 24-second first-file load never trips the playback watchdog or competes with packaging', async () => {
  const { video, onError } = mount();
  await settle();
  act(() => { video.dispatchEvent(new Event('playing')); jest.advanceTimersByTime(24_000); });
  expect(prepareLoopPackage).not.toHaveBeenCalled();
  expect(startContinuousLoop).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  await presentFrame();
  expect(prepareLoopPackage).toHaveBeenCalledTimes(1);
  await act(async () => { finishPackage(PACKAGE); await Promise.resolve(); });
  await settle();
  expect(startContinuousLoop).toHaveBeenCalledTimes(1);
});

it('a file that never presents its first frame has a finite recovery deadline and escalates once', async () => {
  const { onError } = mount();
  await settle();
  const before = load.mock.calls.length;
  act(() => { jest.advanceTimersByTime(48_000); });
  expect(load.mock.calls.length).toBe(before + 1);
  expect(onError).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(48_000); });
  expect(onError).toHaveBeenCalledTimes(1);
  act(() => { jest.advanceTimersByTime(48_000); });
  expect(onError).toHaveBeenCalledTimes(1);
  expect(prepareLoopPackage).not.toHaveBeenCalled();
});

it('resumes a ready but paused native startup once without reloading or blaming the MSE engine', async () => {
  Object.defineProperty(HTMLVideoElement.prototype, 'readyState', { configurable: true, get: () => 4 });
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get: () => true });
  play.mockRejectedValueOnce(new DOMException('Interrupted initial playback', 'AbortError'));
  const { video, onError } = mount();
  await settle();
  act(() => { jest.advanceTimersByTime(4_000); });
  await settle();
  expect(play).toHaveBeenCalledTimes(2);
  expect(load).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(4_000); });
  expect(play).toHaveBeenCalledTimes(2); // Never an unbounded play retry.
  await presentFrame();
  await act(async () => { finishPackage(PACKAGE); await Promise.resolve(); });
  await settle();
  expect(video.dataset.loopBackend).toBe('continuous');
});

it('a failed initial native open can recover without imposing a 24-hour MSE block', async () => {
  const { video, onError } = mount();
  await settle();
  act(() => { jest.advanceTimersByTime(48_000); });
  expect(load).toHaveBeenCalledTimes(1);
  expect(onError).not.toHaveBeenCalled();
  await presentFrame();
  await act(async () => { finishPackage(PACKAGE); await Promise.resolve(); });
  await settle();
  expect(startContinuousLoop).toHaveBeenCalledTimes(1);
  expect(video.dataset.loopBackend).toBe('continuous');
});


it('the existing watchdog reports progressive failure with real waiting headroom without reloading the stream', async () => {
  let total = 0; let dropped = 0;
  Object.defineProperty(HTMLVideoElement.prototype, 'getVideoPlaybackQuality', {
    configurable: true, value: () => ({ totalVideoFrames: total, droppedVideoFrames: dropped }),
  });
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const { video, unmount, onError } = mount();
  Object.defineProperty(video, 'buffered', { value: { length: 1, start: () => 0, end: () => clock + 18 } });
  await presentFrame();
  const pump = { aheadMs: 19000, minAheadMs: 17000, latency: {
    read: { count: 30, totalMs: 300, maxMs: 12 }, append: { count: 30, totalMs: 180, maxMs: 8 },
    prune: { count: 7, totalMs: 21, maxMs: 3 },
  } };
  startContinuousLoop.mockImplementation(() => ({ running: new Promise<void>(() => undefined),
    snapshot: () => ({ phase: 'buffered', diagnostics: pump, quotaBackoffs: 0 }), dispose: jest.fn() }));
  await act(async () => { finishPackage(PACKAGE); await Promise.resolve(); });
  await settle();
  video.dispatchEvent(new Event('playing'));
  const loadsBefore = load.mock.calls.length;
  const playsBefore = play.mock.calls.length;
  for (let i = 0; i < 15; i++) {
    total += 100; dropped += 55; clock += 4;
    video.dispatchEvent(new Event('waiting'));
    act(() => { jest.advanceTimersByTime(200); });
    video.dispatchEvent(new Event('playing'));
    act(() => { jest.advanceTimersByTime(3800); });
  }
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).toMatch(/^\[Player\] stalled playback sample /);
  expect(warn.mock.calls[0][0]).toContain('"waitAheadMs":[18000,18000]');
  expect(warn.mock.calls[0][0]).toContain('"f":1500,"d":825');
  expect(video.dataset.loopBackend).toBe('continuous');
  expect(load).toHaveBeenCalledTimes(loadsBefore);
  expect(play).toHaveBeenCalledTimes(playsBefore);
  expect(onError).not.toHaveBeenCalled();
  unmount();
  delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>).getVideoPlaybackQuality;
});
