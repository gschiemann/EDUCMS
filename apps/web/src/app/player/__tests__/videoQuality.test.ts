/**
 * The player's playback sample: read from the element, reported as a DELTA
 * per stretch of playback, at most one per telemetry tick — dropped frames,
 * and (from an element that can be listened to) the pauses it made to buffer.
 */
import { VideoQualityTracker, VIDEO_QUALITY_MIN_FRAMES, readVideoQuality } from '../videoQuality';

type Listener = (ev: { type: string }) => void;

function fakeVideo(
  init: { total?: number; dropped?: number; legacy?: boolean; w?: number; h?: number; events?: boolean } = {},
) {
  const state = { total: init.total ?? 0, dropped: init.dropped ?? 0 };
  const el: Record<string, unknown> = { videoWidth: init.w ?? 1920, videoHeight: init.h ?? 1080 };
  if (init.legacy) {
    Object.defineProperty(el, 'webkitDecodedFrameCount', { get: () => state.total });
    Object.defineProperty(el, 'webkitDroppedFrameCount', { get: () => state.dropped });
  } else {
    el.getVideoPlaybackQuality = () => ({ totalVideoFrames: state.total, droppedVideoFrames: state.dropped });
  }
  // A minimal EventTarget — only when asked, so the frame-only cases above
  // keep an element that cannot be listened to.
  const listeners = new Map<string, Set<Listener>>();
  if (init.events) {
    el.addEventListener = (type: string, fn: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    };
    el.removeEventListener = (type: string, fn: Listener) => {
      listeners.get(type)?.delete(fn);
    };
    el.dispatchEvent = (ev: { type: string }) => {
      for (const fn of Array.from(listeners.get(ev.type) ?? [])) fn(ev);
      return true;
    };
  }
  return {
    el: el as unknown as import('../videoQuality').VideoQualitySource,
    play(frames: number, dropped = 0) {
      state.total += frames;
      state.dropped += dropped;
    },
    /** The element fires these media events, in order. */
    fire(...types: string[]) {
      for (const type of types) (el.dispatchEvent as (ev: { type: string }) => boolean)({ type });
    },
    listenerCount: () => Array.from(listeners.values()).reduce((n, set) => n + set.size, 0),
  };
}

/** A tracker on an injected wall clock, and one element it can listen to. */
function rig() {
  let wall = 0;
  const t = new VideoQualityTracker(() => wall);
  const v = fakeVideo({ events: true });
  return {
    t,
    v,
    /** At wall-clock `ms`, the element fires `types` in order. */
    at(ms: number, ...types: string[]) {
      wall = ms;
      v.fire(...types);
    },
  };
}

describe('readVideoQuality', () => {
  it('prefers getVideoPlaybackQuality and falls back to the WebKit counters', () => {
    expect(readVideoQuality(fakeVideo({ total: 100, dropped: 3 }).el)).toEqual({ totalFrames: 100, droppedFrames: 3 });
    expect(readVideoQuality(fakeVideo({ total: 50, dropped: 1, legacy: true }).el)).toEqual({ totalFrames: 50, droppedFrames: 1 });
    expect(readVideoQuality({} as never)).toBeNull();
    expect(readVideoQuality(null)).toBeNull();
  });

  it('never reports more dropped than decoded', () => {
    expect(readVideoQuality(fakeVideo({ total: 10, dropped: 40 }).el)).toEqual({ totalFrames: 10, droppedFrames: 10 });
  });
});

describe('VideoQualityTracker', () => {
  const SRC = 'https://cdn/x/Pro%20Series.mp4';

  it('says nothing until enough frames have played', () => {
    const t = new VideoQualityTracker();
    const v = fakeVideo();
    t.attach(v.el, SRC, 1_000);
    v.play(VIDEO_QUALITY_MIN_FRAMES - 1);
    expect(t.take(31_000)).toBeNull();
    v.play(1);
    expect(t.take(61_000)).toEqual({
      url: SRC,
      totalFrames: VIDEO_QUALITY_MIN_FRAMES,
      droppedFrames: 0,
      elapsedMs: 60_000,
      width: 1920,
      height: 1080,
    });
  });

  it('reports the DELTA per stretch — a looping clip reports each tick on its own', () => {
    const t = new VideoQualityTracker();
    const v = fakeVideo({ total: 5_000, dropped: 400 }); // lifetime totals from before we looked
    t.attach(v.el, SRC, 0);
    v.play(1_800, 12);
    expect(t.take(60_000)).toMatchObject({ totalFrames: 1_800, droppedFrames: 12, elapsedMs: 60_000 });
    v.play(1_800, 300);
    expect(t.take(120_000)).toMatchObject({ totalFrames: 1_800, droppedFrames: 300, elapsedMs: 60_000 });
    // Nothing new since the last re-base.
    expect(t.take(121_000)).toBeNull();
  });

  it('a clip that ended or was replaced leaves ONE final sample, handed out once', () => {
    const t = new VideoQualityTracker();
    const a = fakeVideo();
    t.attach(a.el, SRC, 0);
    a.play(900, 45);
    t.detach(a.el, 30_000);
    expect(t.hasPending).toBe(true);
    const b = fakeVideo();
    t.attach(b.el, 'https://cdn/x/next.mp4', 30_000);
    b.play(10);
    expect(t.take(40_000)).toEqual({ url: SRC, totalFrames: 900, droppedFrames: 45, elapsedMs: 30_000, width: 1920, height: 1080 });
    expect(t.take(41_000)).toBeNull();
  });

  it('attaching a new element finishes the old one; detaching a stranger is ignored', () => {
    const t = new VideoQualityTracker();
    const a = fakeVideo();
    const stranger = fakeVideo();
    t.attach(a.el, SRC, 0);
    a.play(400, 2);
    t.detach(stranger.el, 5_000);
    expect(t.hasPending).toBe(false);
    const b = fakeVideo();
    t.attach(b.el, 'https://cdn/x/b.mp4', 10_000);
    expect(t.take(10_001)).toMatchObject({ url: SRC, totalFrames: 400, droppedFrames: 2 });
  });

  it('a short clip (under the floor) leaves no sample, and a reset counter is never negative', () => {
    const t = new VideoQualityTracker();
    const a = fakeVideo();
    t.attach(a.el, SRC, 0);
    a.play(20);
    t.detach(a.el, 1_000);
    expect(t.hasPending).toBe(false);
    const b = fakeVideo({ total: 1_000, dropped: 10 });
    t.attach(b.el, SRC, 0);
    b.play(-900, -10); // element reloaded — counters went backwards
    expect(t.take(60_000)).toBeNull();
  });

  it('an element with no counters at all is simply not tracked', () => {
    const t = new VideoQualityTracker();
    t.attach({} as never, SRC, 0);
    expect(t.take(60_000)).toBeNull();
    t.detach({} as never, 1);
    expect(t.hasPending).toBe(false);
  });
});

describe('VideoQualityTracker — rebuffer pauses', () => {
  const SRC = 'https://cdn/x/Pro%20Series.mp4';

  it('counts a pause mid-clip, from `waiting` to the `playing` that resumes it, on the wall clock', () => {
    const { t, v, at } = rig();
    t.attach(v.el, SRC, 0);
    at(100, 'play', 'playing'); // first frame
    v.play(600);
    at(20_000, 'waiting'); // ran out of data mid-clip
    at(22_500, 'playing'); // bytes arrived
    v.play(1_200);
    expect(t.take(60_000)).toEqual({
      url: SRC,
      totalFrames: 1_800,
      droppedFrames: 0,
      elapsedMs: 60_000,
      width: 1920,
      height: 1080,
      stalls: 1,
      stalledMs: 2_500,
    });
  });

  it('the initial load is NOT a pause: the first `waiting` before the first `playing` is time-to-first-frame', () => {
    const { t, v, at } = rig();
    t.attach(v.el, SRC, 0);
    // A cold start (readyState HAVE_NOTHING, so activation's reset to 0 is
    // not even a seek): play() fires `waiting` until the first frame. A slow
    // START, not a stop mid-clip — and a pause before that frame changes nothing.
    at(0, 'play', 'waiting');
    at(2_000, 'pause');
    at(2_100, 'play', 'waiting');
    at(4_000, 'playing');
    v.play(1_800);
    expect(t.take(60_000)).toMatchObject({ stalls: 0, stalledMs: 0 });
  });

  it('a seek is NOT a pause — a native loop and the sync servo both seek, and Chromium fires `waiting` on each', () => {
    const { t, v, at } = rig();
    t.attach(v.el, SRC, 0);
    // Activation on a buffered element: its reset to 0 is a seek, then play().
    at(0, 'seeking', 'play', 'waiting');
    at(40, 'seeked', 'playing');
    v.play(1_800);
    // A 10 s solo clip looping for a minute: six seeks back to 0.
    for (let loop = 1; loop <= 6; loop++) at(loop * 10_000, 'seeking', 'waiting', 'seeked', 'playing');
    // The element's own flag counts too, when the `seeking` event was not seen.
    v.el.seeking = true;
    at(61_000, 'waiting');
    v.el.seeking = false;
    at(61_040, 'playing');
    expect(t.take(62_000)).toMatchObject({ stalls: 0, stalledMs: 0 });
  });

  it('a pause that runs through a seek (the servo chasing a starved clip) is still ONE pause, timed to the end', () => {
    const { t, v, at } = rig();
    t.attach(v.el, SRC, 0);
    at(0, 'playing');
    v.play(1_800);
    at(10_000, 'waiting');
    at(10_500, 'waiting'); // repeated while already stopped
    at(11_000, 'seeking', 'waiting', 'seeked');
    at(13_000, 'playing');
    expect(t.take(60_000)).toMatchObject({ stalls: 1, stalledMs: 3_000 });
  });

  it('`pause` and `ended` close a pause as well', () => {
    const { t, v, at } = rig();
    t.attach(v.el, SRC, 0);
    at(0, 'playing');
    v.play(1_800);
    at(10_000, 'waiting');
    at(12_000, 'pause');
    at(20_000, 'play', 'playing');
    at(30_000, 'waiting');
    at(31_000, 'pause', 'ended');
    expect(t.take(60_000)).toMatchObject({ stalls: 2, stalledMs: 3_000 });
  });

  it('DELTA semantics: a pause open at a report is counted in it and carries into the next stretch; counts restart per re-base', () => {
    const { t, v, at } = rig();
    t.attach(v.el, SRC, 0);
    at(0, 'playing');
    v.play(1_500);
    at(50_000, 'waiting');
    expect(t.take(60_000)).toMatchObject({ totalFrames: 1_500, stalls: 1, stalledMs: 10_000 });
    at(65_000, 'playing');
    v.play(1_500);
    // Never "paused 0 times (5 s)": the episode is counted on this side too.
    expect(t.take(120_000)).toMatchObject({ totalFrames: 1_500, stalls: 1, stalledMs: 5_000 });
    v.play(1_800);
    // A clean stretch still carries both keys — "counted, none".
    expect(t.take(180_000)).toMatchObject({ totalFrames: 1_800, stalls: 0, stalledMs: 0 });
  });

  it('pauses wait for a report exactly like frames — nothing is said under the frame floor, and nothing is lost', () => {
    const { t, v, at } = rig();
    t.attach(v.el, SRC, 0);
    at(0, 'playing');
    v.play(100);
    at(10_000, 'waiting');
    at(12_000, 'playing');
    expect(t.take(30_000)).toBeNull();
    v.play(100);
    expect(t.take(60_000)).toMatchObject({ totalFrames: 200, stalls: 1, stalledMs: 2_000 });
  });

  it('detach counts a pause still open, takes every listener off, and later events change nothing', () => {
    const { t, v, at } = rig();
    t.attach(v.el, SRC, 0);
    expect(v.listenerCount()).toBe(6);
    at(0, 'playing');
    v.play(900);
    at(25_000, 'waiting');
    t.detach(v.el, 30_000);
    expect(v.listenerCount()).toBe(0);
    at(31_000, 'playing', 'waiting');
    expect(t.take(40_000)).toMatchObject({ totalFrames: 900, stalls: 1, stalledMs: 5_000 });
    expect(t.take(41_000)).toBeNull();
  });

  it('attaching the next element finishes the last one — its open pause counted, its listeners off', () => {
    let wall = 0;
    const t = new VideoQualityTracker(() => wall);
    const a = fakeVideo({ events: true });
    const b = fakeVideo({ events: true });
    t.attach(a.el, SRC, 0);
    a.fire('playing');
    a.play(900);
    wall = 20_000;
    a.fire('waiting');
    t.attach(b.el, 'https://cdn/x/next.mp4', 30_000);
    expect(a.listenerCount()).toBe(0);
    expect(b.listenerCount()).toBe(6);
    expect(t.take(30_001)).toMatchObject({ url: SRC, totalFrames: 900, stalls: 1, stalledMs: 10_000 });
  });

  it('a stall already under way at attach is ignored, and re-attaching the same element never doubles the listeners', () => {
    const { t, v, at } = rig();
    at(0, 'playing');
    at(1_000, 'waiting'); // before attach — nobody listening
    t.attach(v.el, SRC, 5_000);
    at(8_000, 'playing');
    v.play(1_800);
    expect(t.take(60_000)).toMatchObject({ stalls: 0, stalledMs: 0 });
    at(70_000, 'waiting');
    t.attach(v.el, SRC, 75_000); // a fresh stretch: the open pause belonged to the old one
    expect(v.listenerCount()).toBe(6);
    at(76_000, 'playing');
    v.play(1_800);
    expect(t.take(120_000)).toMatchObject({ stalls: 0, stalledMs: 0 });
  });

  it('a clock stepped backwards mid-pause never makes negative time', () => {
    const { t, v, at } = rig();
    t.attach(v.el, SRC, 0);
    at(0, 'playing');
    v.play(1_800);
    at(30_000, 'waiting');
    at(29_000, 'playing'); // NTP stepped the wall clock back
    expect(t.take(60_000)).toMatchObject({ stalls: 1, stalledMs: 0 });
  });

  it('an element that cannot be listened to reports frames only — the stall keys are absent, never 0', () => {
    const t = new VideoQualityTracker(() => 0);
    const v = fakeVideo();
    t.attach(v.el, SRC, 0);
    v.play(1_800);
    const report = t.take(60_000);
    expect(report).not.toBeNull();
    expect(report).not.toHaveProperty('stalls');
    expect(report).not.toHaveProperty('stalledMs');
    // …and an element with no frame counters is not listened to at all.
    const addEventListener = jest.fn();
    t.attach({ addEventListener, removeEventListener: jest.fn() }, SRC, 0);
    expect(addEventListener).not.toHaveBeenCalled();
  });
});
