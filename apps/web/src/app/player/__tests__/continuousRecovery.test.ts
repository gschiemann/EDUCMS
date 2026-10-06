import { retainVideoFrame, releaseVideoFrame, reportContinuousFailure } from '../continuousRecovery';
import { nativeHas, nativeCall } from '../nativeBridge';

jest.mock('../nativeBridge', () => ({ nativeHas: jest.fn(), nativeCall: jest.fn() }));

afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('a 4K recovery retains source pixels, tolerates a tainted canvas and frees memory', () => {
  const video = document.createElement('video');
  Object.defineProperties(video, { readyState: { value: 4 }, videoWidth: { value: 3840 }, videoHeight: { value: 2160 } });
  const canvas = document.createElement('canvas');
  const drawImage = jest.fn();
  jest.spyOn(canvas, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  expect(retainVideoFrame(video, canvas)).toBe(true);
  expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 3840, 2160);
  expect([canvas.width, canvas.height, canvas.style.display]).toEqual([3840, 2160, 'block']);
  // The display-only path never reads pixels or exports a tainted frame.
  releaseVideoFrame(canvas);
  expect([canvas.width, canvas.height, canvas.style.display]).toEqual([0, 0, 'none']);
});

test('a canvas failure or oversized frame cannot break playback or allocate an 8K copy', () => {
  const video = document.createElement('video');
  Object.defineProperties(video, { readyState: { value: 4 }, videoWidth: { value: 3840, configurable: true }, videoHeight: { value: 2160 } });
  const canvas = document.createElement('canvas');
  const context = jest.spyOn(canvas, 'getContext').mockImplementation(() => { throw new Error('no graphics memory'); });
  expect(retainVideoFrame(video, canvas)).toBe(false);
  expect(canvas.width).toBe(0);
  Object.defineProperty(video, 'videoWidth', { value: 7680 });
  context.mockClear();
  expect(retainVideoFrame(video, canvas)).toBe(false);
  expect(context).not.toHaveBeenCalled();
});

test('failure capture includes buffer/pump state and uploads once across repeated mounts', () => {
  jest.useFakeTimers({ now: 100_000 });
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  (nativeHas as jest.Mock).mockReturnValue(true);
  (nativeCall as jest.Mock).mockResolvedValue('queued');
  const video = document.createElement('video');
  video.src = 'https://private.example/video?token=secret';
  Object.defineProperty(video, 'buffered', { value: { length: 1, start: () => 0, end: () => 20 } });
  reportContinuousFailure('clock-stalled', video, { phase: 'read', cycle: 3 });
  reportContinuousFailure('clock-stalled', video);
  jest.advanceTimersByTime(1000);
  expect(nativeCall).toHaveBeenCalledTimes(1);
  expect(nativeCall).toHaveBeenCalledWith('uploadDiagnostics');
  expect(warn.mock.calls[0][0]).toContain('"buffered":[[0,20]]');
  expect(warn.mock.calls[0][0]).toContain('"phase":"read"');
  expect(warn.mock.calls[0][0]).not.toContain('private.example');
  expect(warn.mock.calls[0][0]).not.toContain('secret');
  jest.advanceTimersByTime(60_000);
  reportContinuousFailure('blocked', video);
  jest.advanceTimersByTime(1000);
  expect(nativeCall).toHaveBeenCalledTimes(1);
});
