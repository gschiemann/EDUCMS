/**
 * Media-stall detection (2026-08-30 deep audit, D-2). Encodes the 1.1.6
 * audit's acceptance criterion: "a deliberately stalled video becomes
 * MEDIA_STALLED even while document rAF continues."
 */
import {
  createMediaStallDetector,
  MEDIA_STALL_AFTER_MS,
  setActiveMediaStalled,
  isActiveMediaStalled,
} from '../mediaStallWatchdog';

const playing = (t: number) => ({ currentTimeMs: t, paused: false, ended: false, seeking: false });

describe('createMediaStallDetector', () => {
  it('THE AUDIT CASE: frozen currentTime while playing → stalled exactly once', () => {
    const d = createMediaStallDetector();
    let now = 1_000_000;
    expect(d.sample(now, playing(5_000))).toBe('ok');
    now += 5_000;
    expect(d.sample(now, playing(5_000))).toBe('ok'); // frozen, but under threshold
    now += MEDIA_STALL_AFTER_MS;
    expect(d.sample(now, playing(5_000))).toBe('stalled'); // fires once
    expect(d.isStalled()).toBe(true);
    now += 5_000;
    expect(d.sample(now, playing(5_000))).toBe('idle'); // no repeat spam
  });

  it('progress resolves the episode and re-arms detection', () => {
    const d = createMediaStallDetector();
    let now = 0;
    d.sample(now, playing(1_000));
    now += MEDIA_STALL_AFTER_MS + 1_000;
    expect(d.sample(now, playing(1_000))).toBe('stalled');
    now += 3_000;
    expect(d.sample(now, playing(1_500))).toBe('ok'); // recovered
    expect(d.isStalled()).toBe(false);
    now += MEDIA_STALL_AFTER_MS + 1_000;
    expect(d.sample(now, playing(1_500))).toBe('stalled'); // second episode fires again
  });

  it('normal playback never alarms', () => {
    const d = createMediaStallDetector();
    for (let i = 0; i < 20; i++) {
      expect(d.sample(i * 4_000, playing(i * 4_000))).toBe('ok');
    }
  });

  it('paused / ended / seeking are intentional — never stalled, and they clear an episode', () => {
    const d = createMediaStallDetector();
    let now = 0;
    d.sample(now, playing(2_000));
    now += MEDIA_STALL_AFTER_MS + 1;
    expect(d.sample(now, playing(2_000))).toBe('stalled');
    expect(d.sample(now + 1_000, { currentTimeMs: 2_000, paused: true, ended: false, seeking: false })).toBe('idle');
    expect(d.isStalled()).toBe(false);
    // A long pause then resume never counts pause-time as stall-time:
    expect(d.sample(now + 60_000, playing(2_000))).toBe('ok');
    expect(d.sample(now + 60_000 + MEDIA_STALL_AFTER_MS - 1_000, playing(2_000))).toBe('ok');
  });

  it('a looping video whose currentTime wraps BACKWARDS still counts as progress', () => {
    const d = createMediaStallDetector();
    d.sample(0, playing(9_800));
    expect(d.sample(4_000, playing(200))).toBe('ok'); // wrap
    expect(d.isStalled()).toBe(false);
  });

  it('seeking samples do not poison the reference (servo seeks)', () => {
    const d = createMediaStallDetector();
    d.sample(0, playing(1_000));
    d.sample(1_000, { currentTimeMs: 1_000, paused: false, ended: false, seeking: true });
    expect(d.sample(2_000, playing(5_000))).toBe('ok');
  });
});

describe('page-level stall flag', () => {
  it('round-trips for the proof-signature consumer', () => {
    setActiveMediaStalled(false);
    expect(isActiveMediaStalled()).toBe(false);
    setActiveMediaStalled(true);
    expect(isActiveMediaStalled()).toBe(true);
    setActiveMediaStalled(false);
  });
});
