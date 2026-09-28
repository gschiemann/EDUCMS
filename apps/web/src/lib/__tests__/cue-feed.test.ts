/**
 * The shared cue-feed admission (board, ribbon, scorebug) — the rules the
 * three surfaces used to carry three copies of, plus K12-F36's withdrawals
 * and the named cue that replaces an automatic one.
 */
import { admitCues, newCueFeedState, SAME_MOMENT_MS } from '../cue-feed';

const playsHere = (target?: string) => target !== 'RIBBON';
const cue = (id: string, key: string, extra: Record<string, unknown> = {}) => ({ id, key, target: 'ALL', ...extra });

describe('admitCues', () => {
  it('records the first poll as history and plays what arrives after', () => {
    const st = newCueFeedState();
    expect(admitCues(st, { cues: [cue('a', 'goal')] }, { first: true, playsHere, now: 0 }).queue).toEqual([]);
    const next = admitCues(st, { cues: [cue('a', 'goal'), cue('b', 'save')] }, { first: false, playsHere, now: 1000 });
    expect(next.queue.map((c) => c.id)).toEqual(['b']);
  });

  it('skips another surface’s cue and plays each cue once', () => {
    const st = newCueFeedState();
    admitCues(st, {}, { first: true, playsHere, now: 0 });
    const r = admitCues(st, { cues: [cue('a', 'goal', { target: 'RIBBON' }), cue('b', 'goal')] }, { first: false, playsHere, now: 1 });
    expect(r.queue.map((c) => c.id)).toEqual(['b']);
    expect(admitCues(st, { cues: [cue('b', 'goal')] }, { first: false, playsHere, now: 2 }).queue).toEqual([]);
  });

  it('coalesces the automatic + named duplicate of one moment (6 s, team wildcard)', () => {
    const st = newCueFeedState();
    admitCues(st, {}, { first: true, playsHere, now: 0 });
    const r = admitCues(
      st,
      { cues: [cue('a', 'goal', { team: 'home' }), cue('b', 'goal', { team: null })] },
      { first: false, playsHere, now: 10_000 },
    );
    expect(r.queue.map((c) => c.id)).toEqual(['a']);
    // Past the window it is a new moment.
    const later = admitCues(st, { cues: [cue('c', 'goal', { team: 'home' })] }, { first: false, playsHere, now: 10_000 + SAME_MOMENT_MS });
    expect(later.queue.map((c) => c.id)).toEqual(['c']);
  });

  it('K12-F36: a named cue that REPLACES the automatic one always plays; the automatic one is withdrawn', () => {
    const st = newCueFeedState();
    admitCues(st, {}, { first: true, playsHere, now: 0 });
    admitCues(st, { cues: [cue('auto', 'goal', { team: 'home' })] }, { first: false, playsHere, now: 1000 });
    const r = admitCues(
      st,
      {
        cues: [cue('auto', 'goal', { team: 'home' }), cue('named', 'goal', { team: 'home', replaces: 'auto' })],
        cueCancels: [{ id: 'x1', cancels: 'auto' }],
      },
      { first: false, playsHere, now: 2500 },
    );
    expect(r.cancelled).toEqual(['auto']);
    expect(r.queue.map((c) => c.id)).toEqual(['named']);
  });

  it('K12-F36: a cue withdrawn in the poll it arrives in is never queued; a withdrawal is reported once', () => {
    const st = newCueFeedState();
    admitCues(st, {}, { first: true, playsHere, now: 0 });
    const payload = { cues: [cue('three', 'threePointer')], cueCancels: [{ id: 'x1', cancels: 'three' }] };
    const r = admitCues(st, payload, { first: false, playsHere, now: 1000 });
    expect(r.queue).toEqual([]);
    expect(r.cancelled).toEqual(['three']);
    expect(admitCues(st, payload, { first: false, playsHere, now: 1750 }).cancelled).toEqual([]);
  });
});
