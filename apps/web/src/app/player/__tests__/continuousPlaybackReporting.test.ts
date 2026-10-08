jest.mock('../nativeBridge', () => ({ nativeHas: jest.fn(() => true), nativeCall: jest.fn().mockResolvedValue('queued') }));

function load() {
  jest.resetModules();
  return { ...require('../continuousRecovery'), ...require('../nativeBridge') } as typeof import('../continuousRecovery') & typeof import('../nativeBridge');
}
const line = '[Player] stalled playback sample ' + JSON.stringify({ ms: 60000, f: 1500, d: 800, w: 300,
  waitMs: 59000, aheadMs: 19000, minAheadMs: 17000, waitAheadMs: [17000, 20000],
  opMaxMs: [12, 8, 3], decodeMs: [700, 40, 90], quota: 0 });
beforeEach(() => { jest.useFakeTimers({ now: 100000 }); });
afterEach(() => { jest.restoreAllMocks(); jest.clearAllTimers(); jest.useRealTimers(); });

test('progressive warnings are capped at three per document with a minute shared across mounts and a delayed upload', () => {
  const { reportContinuousPlaybackSample: report, nativeCall } = load();
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  report(null); expect(warn).not.toHaveBeenCalled();
  report(line); report(line);
  expect(warn).toHaveBeenCalledTimes(1); expect(nativeCall).not.toHaveBeenCalled();
  jest.advanceTimersByTime(999); expect(nativeCall).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1); expect(nativeCall).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(58999); report(line); expect(warn).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1); report(line); report(line);
  jest.advanceTimersByTime(60000); report(line);
  jest.advanceTimersByTime(60000); report(line);
  expect(warn).toHaveBeenCalledTimes(3); expect(nativeCall).toHaveBeenCalledTimes(3);
  expect(warn.mock.calls.every(([text]) => text.length <= 450 && !/https?:|token|url/i.test(text))).toBe(true);
});

test('fallback and progressive samples share the upload cooldown without suppressing recovery warnings', () => {
  const { reportContinuousPlaybackSample: report, reportContinuousFailure, nativeCall } = load();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  reportContinuousFailure('clock-stalled', document.createElement('video'));
  report(line);
  jest.advanceTimersByTime(1000);
  expect(nativeCall).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(59000); report(line);
  jest.advanceTimersByTime(1000); expect(nativeCall).toHaveBeenCalledTimes(2);
});

test('content strings, unknown keys, oversized lines and bridge failure cannot produce unsafe diagnostics', () => {
  const { reportContinuousPlaybackSample: report, nativeHas } = load();
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  report(line.replace('19000', '"https://private.invalid/?token=secret"'));
  report(line.replace('"quota"', '"content"'));
  report(line + ' '.repeat(451));
  expect(warn).not.toHaveBeenCalled();
  (nativeHas as jest.Mock).mockImplementation(() => { throw new Error('bridge unavailable'); });
  expect(() => report(line)).not.toThrow();
  expect(warn).toHaveBeenCalledTimes(1);
});
