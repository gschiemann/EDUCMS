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

it('bounds an incoming file whose bytes never arrive, reports failure once, and rejects late callbacks', () => {
  const { a, b, cb, engine } = setup();
  engine.update(source('A'), source('B')); a.frame();
  b.state.readyState = 1; // still loading: nothing a freed decoder could help with
  engine.update(source('B'), source('C'));
  const late = [...b.pending.values()][0];
  jest.advanceTimersByTime(8001); engine.tick(); engine.tick();
  expect(cb.error.mock.calls).toEqual([['B']]);
  expect(cb.fallback).not.toHaveBeenCalled();
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

// ── A panel that runs ONE decode session (2026-10-03 review) ────────────────
// Measured 2026-09-29 on Amlogic T982 / Android 11 / WebView 95: a second
// <video> play()ed beside the first sits at readyState 4, t=0 and presents
// nothing. The preroll's own 3 s deadline cannot catch that in a real hand-off —
// the preroll starts ≤ 1.2 s before the end and the advance cancels it — so the
// incoming file used to wait 8 s on a frozen frame and then be marked FAILED,
// with the outgoing decoder never released. That is the device, not the file.
it('frees the outgoing decoder and starts the incoming file alone when it has data but presents nothing beside it', () => {
  const { a, b, cb, engine } = setup();
  engine.update(source('A'), source('B')); a.frame();
  a.video.currentTime = 2.3; engine.tick();          // preroll starts on the standby…
  expect(b.play).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(200); a.end();            // …and the outgoing file ends first
  expect(cb.ended.mock.calls).toEqual([['A']]);
  engine.update(source('B'), source('C'));           // the page advances
  jest.advanceTimersByTime(2_900); engine.tick();
  expect(cb.fallback).not.toHaveBeenCalled();        // inside the two-decoder window: keep waiting
  jest.advanceTimersByTime(200); engine.tick();
  expect(cb.error).not.toHaveBeenCalled();           // B is a good file
  expect(cb.fallback.mock.calls).toEqual([['handoff-timeout']]);
  // Every decoder was released, then B was started on its own.
  const active = engine.activeVideo!;
  expect(active.getAttribute('src')).toContain('/B.mp4');
  const other = active === a.video ? b : a;
  expect(other.video.getAttribute('src')).toBeNull();
  (active === a.video ? a : b).frame();
  expect(cb.present.mock.calls.at(-1)?.[1].id).toBe('B');
  expect(cb.error).not.toHaveBeenCalled();
  // The session stays on one decoder: the next file replaces B in place.
  engine.update(source('C'), source('A'));
  expect(other.video.getAttribute('src')).toBeNull();
  engine.destroy();
});

it('fails a file only after it could not start ALONE either, and reports it once', () => {
  const { a, cb, engine } = setup();
  engine.update(source('A'), source('B')); a.frame();
  a.end();
  engine.update(source('B'), source('C'));
  jest.advanceTimersByTime(3_100); engine.tick();    // beside A: nothing → start alone
  expect(cb.fallback.mock.calls).toEqual([['handoff-timeout']]);
  expect(cb.error).not.toHaveBeenCalled();
  jest.advanceTimersByTime(8_100); engine.tick(); engine.tick();
  expect(cb.error.mock.calls).toEqual([['B']]);      // alone: still nothing → the file
  engine.destroy();
});

it('keeps waiting on a file that is still LOADING beside the outgoing picture (a slow link is not a decoder limit)', () => {
  const { a, b, cb, engine } = setup();
  engine.update(source('A'), source('B')); a.frame();
  b.state.readyState = 1;                            // metadata only: bytes still arriving
  a.end();
  engine.update(source('B'), source('C'));
  jest.advanceTimersByTime(5_000); engine.tick();
  expect(cb.fallback).not.toHaveBeenCalled();
  expect(a.video.getAttribute('src')).toContain('/A.mp4'); // last frame of A stays on glass
  b.state.readyState = 4; b.frame();
  expect(cb.present.mock.calls.at(-1)?.[1].id).toBe('B');
  expect(cb.fallback).not.toHaveBeenCalled();
  engine.destroy();
});

it('retries a decode error on the incoming deck alone before blaming the file; a missing file fails at once', () => {
  const first = setup();
  first.engine.update(source('A'), source('B')); first.a.frame();
  first.a.end();
  first.engine.update(source('B'), source('C'));
  first.b.state.error = { code: 3 } as MediaError;   // MEDIA_ERR_DECODE beside another decoder
  first.b.video.dispatchEvent(new Event('error'));
  expect(first.cb.error).not.toHaveBeenCalled();
  expect(first.cb.fallback.mock.calls).toEqual([['handoff-decode-error']]);
  expect(first.engine.activeVideo!.getAttribute('src')).toContain('/B.mp4');
  first.engine.destroy();

  const second = setup();
  second.engine.update(source('A'), source('B')); second.a.frame();
  second.a.end();
  second.engine.update(source('B'), source('C'));
  second.b.state.error = { code: 4 } as MediaError;  // MEDIA_ERR_SRC_NOT_SUPPORTED: 404 / not a video
  second.b.video.dispatchEvent(new Event('error'));
  expect(second.cb.error.mock.calls).toEqual([['B']]);
  expect(second.cb.fallback).not.toHaveBeenCalled();
  second.engine.destroy();
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
