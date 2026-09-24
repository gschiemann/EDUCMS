/**
 * The player's dropped-frame sample: read from the element, reported as a
 * DELTA per stretch of playback, at most one per telemetry tick.
 */
import { VideoQualityTracker, VIDEO_QUALITY_MIN_FRAMES, readVideoQuality } from '../videoQuality';

function fakeVideo(init: { total?: number; dropped?: number; legacy?: boolean; w?: number; h?: number } = {}) {
  const state = { total: init.total ?? 0, dropped: init.dropped ?? 0 };
  const el: Record<string, unknown> = { videoWidth: init.w ?? 1920, videoHeight: init.h ?? 1080 };
  if (init.legacy) {
    Object.defineProperty(el, 'webkitDecodedFrameCount', { get: () => state.total });
    Object.defineProperty(el, 'webkitDroppedFrameCount', { get: () => state.dropped });
  } else {
    el.getVideoPlaybackQuality = () => ({ totalVideoFrames: state.total, droppedVideoFrames: state.dropped });
  }
  return {
    el: el as unknown as import('../videoQuality').VideoQualitySource,
    play(frames: number, dropped = 0) {
      state.total += frames;
      state.dropped += dropped;
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
