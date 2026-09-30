import { PlaylistVideoHandoff, type PlaylistVideoSource } from '../playlistVideoHandoff';

const source = (id: string, muted = true): PlaylistVideoSource => ({ id, src: `https://media.invalid/${id}.mp4`, muted });
function deck() {
  const video = document.createElement('video');
  let frames = 0;
  let serial = 0;
  const pending = new Map<number, VideoFrameRequestCallback>();
  const state = { paused: true, ended: false, error: null as MediaError | null, duration: 2.5, readyState: 4, videoWidth: 1920, seeking: false };
  Object.entries(state).forEach(([name]) => Object.defineProperty(video, name, { get: () => state[name as keyof typeof state] }));
  const play = jest.fn(() => { state.paused = false; return Promise.resolve(); });
  const pause = jest.fn(() => { state.paused = true; });
  const load = jest.fn(() => { state.ended = false; state.error = null; video.currentTime = 0; });
  video.play = play;
  video.pause = pause;
  video.load = load;
  video.getVideoPlaybackQuality = () => ({ totalVideoFrames: frames, droppedVideoFrames: 0, corruptedVideoFrames: 0, creationTime: 0 });
  video.requestVideoFrameCallback = cb => { pending.set(++serial, cb); return serial; };
  video.cancelVideoFrameCallback = id => { pending.delete(id); };
  const frame = () => {
    frames++;
    video.currentTime += 1 / 30;
    const calls = [...pending.values()];
    pending.clear();
    calls.forEach(cb => cb(Date.now(), { mediaTime: video.currentTime } as VideoFrameCallbackMetadata));
  };
  const end = () => { state.ended = true; state.paused = true; video.dispatchEvent(new Event('ended')); };
  const error = () => { state.error = {} as MediaError; video.dispatchEvent(new Event('error')); };
  return { video, state, play, pause, frame, end, error, pending };
}
function setup() {
  const a = deck();
  const b = deck();
  const cb = { present: jest.fn(), ended: jest.fn(), error: jest.fn(), fallback: jest.fn() };
  const engine = new PlaylistVideoHandoff([a.video, b.video], {
    now: () => Date.now(), setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: id => window.clearTimeout(id),
  }, cb);
  return { a, b, cb, engine };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

it('keeps the outgoing picture opaque until the incoming deck presents a decoded frame', () => {
  const { a, b, cb, engine } = setup();
  engine.update(source('A'), source('B'));
  expect(cb.present).not.toHaveBeenCalled();
  a.frame();
  expect(a.video.style.zIndex).toBe('1');
  engine.update(source('B'), source('C'));
  expect(a.video.getAttribute('src')).toContain('/A.mp4');
  expect(a.video.style.zIndex).toBe('1');
  expect(b.video.style.zIndex).toBe('0');
  expect(a.video.style.opacity).toBe('1');
  b.frame();
  expect(b.video.style.zIndex).toBe('1');
  expect(a.video.style.zIndex).toBe('0');
  expect(a.video.getAttribute('src')).toContain('/C.mp4');
  expect(cb.present.mock.calls.map(call => call[1].id)).toEqual(['A', 'B']);
  engine.destroy();
});

it('warms near the boundary, parks the first frame, avoids a second seek, and keeps hidden audio muted', () => {
  const { a, b, engine } = setup();
  engine.update(source('A', false), source('B', false));
  expect(a.video.muted).toBe(true);
  a.frame();
  expect(a.video.muted).toBe(false);
  a.video.currentTime = 1;
  engine.tick();
  expect(b.play).not.toHaveBeenCalled();
  a.video.currentTime = 2.3;
  engine.tick();
  expect(b.play).toHaveBeenCalledTimes(1);
  expect(b.video.muted).toBe(true);
  b.frame();
  expect(b.state.paused).toBe(true);
  const parkedAt = b.video.currentTime;
  engine.update(source('B', false), source('C'));
  expect(b.video.currentTime).toBe(parkedAt);
  expect(b.video.muted).toBe(true);
  b.frame();
  expect(b.video.muted).toBe(false);
  expect(a.video.muted).toBe(true);
  expect(a.state.paused).toBe(true);
  engine.destroy();
});

it('reuses exactly two surfaces through three different files and a wrap', () => {
  const { a, b, cb, engine } = setup();
  engine.update(source('A'), source('B')); a.frame();
  engine.update(source('B'), source('C')); b.frame();
  engine.update(source('C'), source('A')); a.frame();
  engine.update(source('A'), source('B')); b.frame();
  expect(cb.present.mock.calls.map(call => call[1].id)).toEqual(['A', 'B', 'C', 'A']);
  expect(new Set(cb.present.mock.calls.map(call => call[0])).size).toBe(2);
  expect(a.video.style.transition).toBe('none');
  expect(b.video.style.transition).toBe('none');
  engine.destroy();
});

it('keeps the picture playing muted when browser audio autoplay is rejected and retries only on a gesture or audio change', async () => {
  const { a, cb, engine } = setup();
  engine.update(source('A', false), source('B'));
  a.play.mockRejectedValueOnce(new Error('audio autoplay denied'));
  a.frame();
  await Promise.resolve();
  await Promise.resolve();
  expect(a.video.muted).toBe(true);
  expect(a.state.paused).toBe(false);
  expect(cb.error).not.toHaveBeenCalled();
  const calls = a.play.mock.calls.length;
  engine.update(source('A', false), source('B'));
  expect(a.play).toHaveBeenCalledTimes(calls);
  engine.enableRequestedAudio();
  expect(a.video.muted).toBe(false);
  expect(a.play).toHaveBeenCalledTimes(calls + 1);
  engine.destroy();
});

it('advances only once for the active file ending; standby ended events do not advance', () => {
  const { a, b, cb, engine } = setup();
  engine.update(source('A'), source('B')); a.frame();
  b.end();
  expect(cb.ended).not.toHaveBeenCalled();
  a.end(); a.end();
  expect(cb.ended.mock.calls).toEqual([['A']]);
  engine.destroy();
});

it('bounds a missing incoming frame, reports failure once, and rejects late callbacks', () => {
  const { a, b, cb, engine } = setup();
  engine.update(source('A'), source('B')); a.frame();
  engine.update(source('B'), source('C'));
  const late = [...b.pending.values()][0];
  jest.advanceTimersByTime(8001); engine.tick(); engine.tick();
  expect(cb.error.mock.calls).toEqual([['B']]);
  late(Date.now(), {} as VideoFrameCallbackMetadata);
  expect(b.video.style.zIndex).toBe('0');
  expect(a.video.style.zIndex).toBe('1');
  engine.destroy();
});

it('releases a failing standby and continues the playlist using one decoder', () => {
  const { a, b, cb, engine } = setup();
  engine.update(source('A'), source('B')); a.frame();
  b.error();
  expect(a.state.paused).toBe(false);
  expect(a.video.style.zIndex).toBe('1');
  expect(b.video.getAttribute('src')).toBeNull();
  expect(cb.error).not.toHaveBeenCalled();
  expect(cb.fallback.mock.calls).toEqual([['standby-error']]);
  engine.update(source('B'), source('C')); a.frame();
  expect(cb.present.mock.calls.at(-1)?.[1].id).toBe('B');
  expect(b.video.getAttribute('src')).toBeNull();
  engine.destroy();
});

it('abandons a stalled preroll without stopping the outgoing file', () => {
  const { a, b, cb, engine } = setup();
  engine.update(source('A'), source('B')); a.frame();
  a.video.currentTime = 2.3; engine.tick();
  jest.advanceTimersByTime(3000);
  expect(cb.fallback.mock.calls).toEqual([['standby-timeout']]);
  expect(a.state.paused).toBe(false);
  expect(b.video.getAttribute('src')).toBeNull();
  engine.destroy();
});

it('ignores an old play rejection after the desired file changes', async () => {
  const { a, b, cb, engine } = setup();
  let reject!: (error: Error) => void;
  a.play.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
  engine.update(source('A'), source('B'));
  engine.update(source('C'), source('B'));
  reject(new Error('old source interrupted'));
  await Promise.resolve();
  expect(cb.error).not.toHaveBeenCalled();
  b.frame(); a.frame();
  expect(cb.present.mock.calls.at(-1)?.[1].id).toBe('C');
  engine.destroy();
});

it('requires frame progress on browsers without rVFC, and releases timers and sources on destroy', () => {
  const { a, b, cb, engine } = setup();
  Object.defineProperty(a.video, 'requestVideoFrameCallback', { value: undefined });
  engine.update(source('A'), source('B'));
  jest.advanceTimersByTime(90);
  expect(cb.present).not.toHaveBeenCalled();
  a.frame(); jest.advanceTimersByTime(30);
  expect(cb.present).toHaveBeenCalledTimes(1);
  engine.destroy();
  expect(a.video.getAttribute('src')).toBeNull();
  expect(b.video.getAttribute('src')).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
});
