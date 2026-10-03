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

const startContinuousLoop = jest.fn(() => ({ running: new Promise<void>(() => undefined), dispose: jest.fn() }));
let finishPackage: (p: unknown) => void = () => undefined;
const prepareLoopPackage = jest.fn((...args: [src: string, hash: string, signal: AbortSignal]) => { void args; return new Promise(resolve => { finishPackage = resolve; }); });
jest.mock('../continuousLoop', () => ({ startContinuousLoop: (...a: unknown[]) => (startContinuousLoop as jest.Mock)(...a) }));
jest.mock('../continuousLoopPackage', () => ({ prepareLoopPackage: (...a: unknown[]) => (prepareLoopPackage as jest.Mock)(...a) }));

import { ContinuousLoopVideo } from '../ContinuousLoopVideo';

const HASH = 'a'.repeat(64);
const PACKAGE = { durationTicks: 90_000, timescale: 30_000 };
let clock = 0;
let play: jest.SpyInstance;
let load: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  startContinuousLoop.mockClear();
  prepareLoopPackage.mockClear();
  clock = 0;
  play = jest.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  load = jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  // A playing element whose clock the test drives.
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get: () => false });
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { configurable: true, get: () => clock, set: () => undefined });
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
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

it('adopts the one-stream engine when preparation finishes on a healthy element (control)', async () => {
  const { video } = mount();
  await settle();
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
  act(() => { jest.advanceTimersByTime(24_000); });           // episode 1 → fallback + reload
  expect(onError).not.toHaveBeenCalled();
  clock += 1; act(() => { jest.advanceTimersByTime(4_000); }); // progress re-arms the detector
  act(() => { jest.advanceTimersByTime(24_000); });           // episode 2 → the file
  expect(onError).toHaveBeenCalledTimes(1);
});
