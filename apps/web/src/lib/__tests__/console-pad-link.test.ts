/**
 * K12-F16 — the scorekeeper pad may only claim what its evidence proves.
 * Audit evidence: 11 s of failed board reads and the pad still read "LIVE".
 */
import {
  PAD_OFFLINE_STALE_AFTER_MS,
  PAD_STALE_AFTER_MS,
  PAD_MAX_REJECTED,
  classifyPadFailure,
  initialPadLink,
  padChip,
  padControlsEnabled,
  padLinkReducer,
  padSecondsSinceGood,
  pushRejected,
  type PadLinkEvent,
  type PadLinkState,
} from '../console-pad-link';

const T0 = 1_790_000_000_000;

function run(events: PadLinkEvent[], start = initialPadLink(T0)): PadLinkState {
  return events.reduce(padLinkReducer, start);
}

describe('padLinkReducer — connection truth', () => {
  it('starts connecting: no LIVE, no controls', () => {
    const s = initialPadLink(T0);
    expect(s.phase).toBe('connecting');
    expect(padControlsEnabled(s)).toBe(false);
    expect(padChip(s, 'LIVE')).toBe('connecting');
  });

  it('the first good read makes it live — LIVE only when the GAME is live too', () => {
    const s = run([{ type: 'good', at: T0 + 500 }]);
    expect(s.phase).toBe('live');
    expect(padControlsEnabled(s)).toBe(true);
    expect(padChip(s, 'LIVE')).toBe('live-game');
    expect(padChip(s, 'HALFTIME')).toBe('game-status');
  });

  it('THE AUDIT CASE: 11 s of failed reads after a good one → lost, never LIVE, controls paused', () => {
    let s = run([{ type: 'good', at: T0 }]);
    for (let t = 1000; t <= 11_000; t += 1000) s = padLinkReducer(s, { type: 'tick', at: T0 + t });
    expect(s.phase).toBe('lost');
    expect(padChip(s, 'LIVE')).toBe('lost');
    expect(padControlsEnabled(s)).toBe(false);
    expect(s.mustConfirm).toBe(true);
    expect(padSecondsSinceGood(s, T0 + 11_000)).toBe(11);
  });

  it('stays live right up to the threshold, lost one tick past it', () => {
    const s = run([{ type: 'good', at: T0 }, { type: 'tick', at: T0 + PAD_STALE_AFTER_MS }]);
    expect(s.phase).toBe('live');
    const s2 = padLinkReducer(s, { type: 'tick', at: T0 + PAD_STALE_AFTER_MS + 1 });
    expect(s2.phase).toBe('lost');
  });

  it('a browser-reported offline shortens the threshold to 2 s (board parity)', () => {
    const s = run([
      { type: 'good', at: T0 },
      { type: 'tick', at: T0 + PAD_OFFLINE_STALE_AFTER_MS + 1, browserOffline: true },
    ]);
    expect(s.phase).toBe('lost');
  });

  it('the loss is PERSISTENT — ticks never clear it; only a good read does', () => {
    let s = run([{ type: 'good', at: T0 }, { type: 'tick', at: T0 + 9000 }]);
    for (let t = 10_000; t < 120_000; t += 1000) s = padLinkReducer(s, { type: 'tick', at: T0 + t });
    expect(s.phase).toBe('lost');
  });

  it('recovery is EXPLICIT: fresh reads after a loss → resync (controls still paused) → confirm → live', () => {
    let s = run([{ type: 'good', at: T0 }, { type: 'tick', at: T0 + 9000 }]);
    s = padLinkReducer(s, { type: 'good', at: T0 + 20_000 });
    expect(s.phase).toBe('resync');
    expect(padControlsEnabled(s)).toBe(false);
    expect(padChip(s, 'LIVE')).toBe('resync');
    // More good reads do not skip the confirmation.
    s = padLinkReducer(s, { type: 'good', at: T0 + 20_750 });
    expect(s.phase).toBe('resync');
    s = padLinkReducer(s, { type: 'confirm', at: T0 + 21_000 });
    expect(s.phase).toBe('live');
    expect(s.mustConfirm).toBe(false);
    expect(padControlsEnabled(s)).toBe(true);
  });

  it('reads stalling again during resync → lost again', () => {
    let s = run([
      { type: 'good', at: T0 },
      { type: 'tick', at: T0 + 9000 },
      { type: 'good', at: T0 + 10_000 },
    ]);
    expect(s.phase).toBe('resync');
    s = padLinkReducer(s, { type: 'tick', at: T0 + 10_000 + PAD_STALE_AFTER_MS + 1 });
    expect(s.phase).toBe('lost');
  });

  it('confirm outside resync is a no-op (it cannot force a lost pad live)', () => {
    const lost = run([{ type: 'good', at: T0 }, { type: 'tick', at: T0 + 9000 }]);
    expect(padLinkReducer(lost, { type: 'confirm', at: T0 + 9500 }).phase).toBe('lost');
  });

  it('never reaching the board at all → lost, but the first picture then needs no confirm', () => {
    let s = run([{ type: 'tick', at: T0 + PAD_STALE_AFTER_MS + 1 }]);
    expect(s.phase).toBe('lost');
    expect(s.mustConfirm).toBe(false);
    s = padLinkReducer(s, { type: 'good', at: T0 + 30_000 });
    expect(s.phase).toBe('live');
  });

  it('backgrounding is not a loss: paused → connecting → live on the first fresh read, no confirm', () => {
    let s = run([{ type: 'good', at: T0 }, { type: 'hidden', at: T0 + 1000 }]);
    expect(s.phase).toBe('paused');
    expect(padControlsEnabled(s)).toBe(false);
    // Ten minutes in a pocket: ticks do nothing while paused.
    s = padLinkReducer(s, { type: 'tick', at: T0 + 600_000 });
    expect(s.phase).toBe('paused');
    s = padLinkReducer(s, { type: 'visible', at: T0 + 600_000 });
    expect(s.phase).toBe('connecting');
    expect(padChip(s, 'LIVE')).toBe('connecting'); // not LIVE on a 10-minute-old picture
    s = padLinkReducer(s, { type: 'tick', at: T0 + 601_000 });
    expect(s.phase).toBe('connecting'); // the wait is measured from return, not from the last read
    s = padLinkReducer(s, { type: 'good', at: T0 + 601_000 });
    expect(s.phase).toBe('live');
  });

  it('back from background but the board is unreachable → lost, and the old picture needs a confirm', () => {
    let s = run([
      { type: 'good', at: T0 },
      { type: 'hidden', at: T0 + 1000 },
      { type: 'visible', at: T0 + 60_000 },
      { type: 'tick', at: T0 + 60_000 + PAD_STALE_AFTER_MS + 1 },
    ]);
    expect(s.phase).toBe('lost');
    expect(s.mustConfirm).toBe(true);
    s = padLinkReducer(s, { type: 'good', at: T0 + 90_000 });
    expect(s.phase).toBe('resync');
  });

  it('hiding the tab never clears a loss', () => {
    let s = run([{ type: 'good', at: T0 }, { type: 'tick', at: T0 + 9000 }, { type: 'hidden', at: T0 + 9500 }]);
    s = padLinkReducer(s, { type: 'visible', at: T0 + 30_000 });
    expect(s.phase).toBe('lost');
    expect(s.mustConfirm).toBe(true);
  });

  it('a straggler read landing while hidden is ignored', () => {
    const s = run([{ type: 'good', at: T0 }, { type: 'hidden', at: T0 + 100 }, { type: 'good', at: T0 + 200 }]);
    expect(s.phase).toBe('paused');
    expect(s.lastGoodAt).toBe(T0);
  });
});

describe('classifyPadFailure / pushRejected — pending and rejected taps', () => {
  it('names why a tap did not land', () => {
    expect(classifyPadFailure(null)).toBe('offline');
    expect(classifyPadFailure(403)).toBe('not-permitted');
    expect(classifyPadFailure(429)).toBe('rate-limited');
    expect(classifyPadFailure(400)).toBe('refused');
    expect(classifyPadFailure(409)).toBe('refused');
    expect(classifyPadFailure(500)).toBe('server');
    expect(classifyPadFailure(503)).toBe('server');
  });

  it('keeps the newest few rejections, newest first', () => {
    let list: ReturnType<typeof pushRejected> = [];
    for (let i = 1; i <= 5; i += 1) {
      list = pushRejected(list, { id: i, label: `tap ${i}`, failure: 'offline', at: T0 + i });
    }
    expect(list).toHaveLength(PAD_MAX_REJECTED);
    expect(list.map((r) => r.id)).toEqual([5, 4, 3]);
  });
});
