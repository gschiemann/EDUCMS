import {
  SERVO_HARD_SEEK_MS,
  SERVO_MAX_SEEKS_PER_WINDOW,
  createVideoServoState,
  servoDecide,
  servoSeekLanded,
  type ServoAction,
} from '../videoServo';

/**
 * A simulated synced screen: the shared timeline advances 1 ms per ms; the video
 * plays at `playRate` × its playbackRate; a seek takes `seekLatency()` ms and the
 * video then resumes FROM THE SEEK TARGET (what a hardware decoder does). The servo
 * ticks every 250 ms, exactly like page.tsx.
 */
function simulate(opts: {
  durationMs: number;
  seekLatency: () => number;
  playRate?: number;
  decide: (now: number, err: number, target: number, seeking: boolean) => ServoAction;
  onLanded?: (now: number) => void;
  startOffsetMs?: number;
}) {
  const { durationMs, seekLatency, playRate = 1 } = opts;
  let media = opts.startOffsetMs ?? 0;
  let rate = 1;
  let seekUntil: number | null = null;
  let seekTo = 0;
  let seeks = 0;
  let framesShown = 0;
  let lastErr = 0;
  for (let now = 0; now <= durationMs; now += 50) {
    if (seekUntil !== null && now >= seekUntil) {
      media = seekTo;
      seekUntil = null;
      opts.onLanded?.(now);
    }
    if (seekUntil === null) {
      media += 50 * rate * playRate;
      framesShown += 1;
    }
    if (now % 250 === 0) {
      const target = now; // timeline position (file longer than the test)
      const err = target - media;
      lastErr = err;
      const a = opts.decide(now, err, target, seekUntil !== null);
      if (a.kind === 'seek') {
        seeks += 1;
        seekTo = a.toMs;
        seekUntil = now + seekLatency();
        rate = 1;
      } else if (a.kind === 'rate') {
        rate = a.rate;
      }
    }
  }
  return { seeks, framesShown, lastErr };
}

/** The servo as it was before 2026-09-29: seek whenever |err| > 400, static 80 ms lead, blind to `seeking`. */
const oldDecide = (_now: number, err: number, target: number): ServoAction => {
  if (Math.abs(err) > 400) return { kind: 'seek', toMs: target + 80 };
  if (Math.abs(err) > 12) return { kind: 'rate', rate: 1 + Math.max(-0.04, Math.min(0.04, err / 2000)) };
  return { kind: 'rate', rate: 1 };
};

function newServo() {
  const s = createVideoServoState();
  return {
    s,
    decide: (now: number, err: number, target: number, seeking: boolean) =>
      servoDecide(s, { nowMs: now, errMs: err, targetMs: target, fileDurMs: null, seeking }),
    onLanded: (now: number) => servoSeekLanded(s, now),
  };
}

describe('videoServo', () => {
  it('NEGATIVE CONTROL: the old servo on a slow-seeking box (1.5 s) seeks forever and shows almost nothing', () => {
    const r = simulate({ durationMs: 60_000, seekLatency: () => 1_500, decide: oldDecide, startOffsetMs: -5_000 });
    expect(r.seeks).toBeGreaterThan(20);
    expect(Math.abs(r.lastErr)).toBeGreaterThan(SERVO_HARD_SEEK_MS);
  });

  it('a slow-seeking box (1.5 s) converges: the lead is measured, two seeks, then smooth playback in phase', () => {
    const { decide, onLanded, s } = newServo();
    const r = simulate({ durationMs: 60_000, seekLatency: () => 1_500, decide, onLanded, startOffsetMs: -5_000 });
    expect(r.seeks).toBeLessThanOrEqual(3);
    expect(Math.abs(r.lastErr)).toBeLessThan(SERVO_HARD_SEEK_MS);
    expect(s.leadMs).toBeGreaterThan(1_000);
    expect(r.framesShown).toBeGreaterThan(1_000); // of 1,200 possible 50 ms steps
  });

  it('a fast box (60 ms seeks) aligns with one seek and stays in the deadband', () => {
    const { decide, onLanded } = newServo();
    const r = simulate({ durationMs: 30_000, seekLatency: () => 60, decide, onLanded, startOffsetMs: -3_000 });
    expect(r.seeks).toBe(1);
    expect(Math.abs(r.lastErr)).toBeLessThan(50);
  });

  it('a box whose seek time swings wildly stops hard-seeking and keeps playing (rate chase only)', () => {
    const { decide, onLanded, s } = newServo();
    const lat = [300, 3_000, 500, 2_800, 400, 3_000, 600, 2_900];
    let i = 0;
    const r = simulate({ durationMs: 5 * 60_000, seekLatency: () => lat[i++ % lat.length], decide, onLanded, startOffsetMs: -6_000 });
    expect(r.seeks).toBeLessThanOrEqual(SERVO_MAX_SEEKS_PER_WINDOW);
    expect(r.framesShown).toBeGreaterThan(5_500); // of 6,000 — the picture keeps moving
    void s;
  });

  it('seeks that can never land in time (6 s, past the 3 s lead cap) are given up after three: rate chase only', () => {
    const { decide, onLanded, s } = newServo();
    const r = simulate({ durationMs: 5 * 60_000, seekLatency: () => 6_000, decide, onLanded, startOffsetMs: -8_000 });
    expect(r.seeks).toBe(3);
    expect(s.hardSeekBlockedUntilMs).toBeGreaterThan(0);
    expect(r.framesShown).toBeGreaterThan(5_500);
  });

  it('a box that plays slower than real time does not trade its picture for endless seeks', () => {
    const { decide, onLanded } = newServo();
    const r = simulate({ durationMs: 5 * 60_000, seekLatency: () => 200, playRate: 0.85, decide, onLanded });
    expect(r.seeks).toBeLessThanOrEqual(SERVO_MAX_SEEKS_PER_WINDOW);
  });

  it('never acts while a seek is in flight — not even a rate change (the slide\'s own activation seek included)', () => {
    const s = createVideoServoState();
    expect(servoDecide(s, { nowMs: 0, errMs: 5_000, targetMs: 5_000, fileDurMs: null, seeking: true })).toEqual({ kind: 'hold' });
    expect(s.seekTimesMs).toEqual([]);
  });

  it('aims around the loop for a file shorter than the slot, and measures a missed `seeked` coarsely', () => {
    const s = createVideoServoState();
    const a = servoDecide(s, { nowMs: 0, errMs: 2_000, targetMs: 9_990, fileDurMs: 10_000, seeking: false });
    expect(a).toEqual({ kind: 'seek', toMs: 70 }); // 9,990 + 80 wraps to 70
    servoDecide(s, { nowMs: 1_000, errMs: 5, targetMs: 1_000, fileDurMs: 10_000, seeking: false });
    expect(s.leadMs).toBe(1_000);
    expect(s.seekIssuedAtMs).toBeNull();
  });
});
