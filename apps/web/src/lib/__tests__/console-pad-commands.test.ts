/**
 * K12-F16 — the volunteer pad's command rules on the A1 engine: what is
 * queued, what Undo may reach, and what a refused tap says.
 */
import {
  PAD_MAX_REJECTED,
  classifyPadFailure,
  nextLastAction,
  padQueueKey,
  padQueueKind,
  padQueuedPath,
  pushRejected,
  type PadStep,
} from '../console-pad-commands';

const step = (kind: PadStep['kind']): PadStep => ({ kind, path: `/${kind}`, method: 'PATCH', body: {} });
const PREV = { commandId: 'cmd-prev-00000001', label: '+2 Home' };

describe('the offline queue holds exactly the operator queue kinds', () => {
  it('score / clock / period / stats queue under their own kind and path; nothing else does', () => {
    expect(padQueueKind('score')).toBe('score');
    expect(padQueueKind('clock')).toBe('clock');
    expect(padQueueKind('segment')).toBe('segment');
    expect(padQueueKind('stats')).toBe('stats');
    for (const k of ['timeout', 'cue', 'possession', 'penalties', 'shotClock', 'playClock'] as const) {
      expect(padQueueKind(k)).toBeNull();
    }
    expect(padQueuedPath('score')).toBe('/score');
    expect(padQueuedPath('clock')).toBe('/clock');
    expect(padQueuedPath('segment')).toBe('/segment');
    expect(padQueuedPath('stats')).toBe('/stats');
  });

  it('one namespace per link and tab — never the operator console queue', () => {
    const a = padQueueKey('game-1', 'game-1.0.1.2.' + 'a'.repeat(32));
    const b = padQueueKey('game-1', 'game-1.0.1.2.' + 'b'.repeat(32));
    expect(a).toMatch(/^pad:game-1:[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
    expect(a).not.toBe('game-1');
    expect(padQueueKey('game-1', 'x')).toBe(padQueueKey('game-1', 'x'));
  });
});

describe('what Undo may reach — the link latest action, as the server holds it', () => {
  it('a direct success of an undoable action becomes the last action', () => {
    for (const k of ['score', 'clock', 'segment', 'stats', 'timeout', 'possession', 'penalties'] as const) {
      expect(nextLastAction(null, 'ok', step(k), 'cmd-new-000001', 'x', false)).toEqual({
        commandId: 'cmd-new-000001',
        label: 'x',
      });
    }
  });

  it('a shot / play clock tap is now the link latest but cannot be undone: nothing to offer', () => {
    expect(nextLastAction(PREV, 'ok', step('shotClock'), 'cmd-new-000001', 'x', false)).toBeNull();
    expect(nextLastAction(PREV, 'ok', step('playClock'), 'cmd-new-000001', 'x', false)).toBeNull();
  });

  it('a cue carries no receipt, so the previous action stays undoable', () => {
    expect(nextLastAction(PREV, 'ok', step('cue'), 'cmd-new-000001', 'Dunk', false)).toBe(PREV);
  });

  it('a two-step action (the half-inning) is not offered — the server could reverse only half of it', () => {
    expect(nextLastAction(PREV, 'ok', step('segment'), 'cmd-new-000001', 'Next inning', true)).toBeNull();
  });

  it('a queued tap or one with no answer makes the server latest unknowable: nothing to offer', () => {
    expect(nextLastAction(PREV, 'queued', step('score'), 'cmd-new-000001', 'x', false)).toBeNull();
    expect(nextLastAction(PREV, 'unknown', step('timeout'), 'cmd-new-000001', 'x', false)).toBeNull();
  });

  it('a refused tap recorded nothing, so the previous action stays undoable', () => {
    expect(nextLastAction(PREV, 'refused', step('score'), 'cmd-new-000001', 'x', false)).toBe(PREV);
  });
});

describe('classifyPadFailure / pushRejected — a refused tap says why', () => {
  it('names why a tap did not land, by status and the API code', () => {
    expect(classifyPadFailure(null)).toBe('offline');
    expect(classifyPadFailure(403, 'SPORTS_CONSOLE_SCOPE')).toBe('not-permitted');
    expect(classifyPadFailure(429)).toBe('rate-limited');
    expect(classifyPadFailure(409, 'GAME_FINAL')).toBe('final');
    expect(classifyPadFailure(409, 'CONSOLE_UNDO_NOT_LATEST')).toBe('undo-not-latest');
    expect(classifyPadFailure(409, 'UNDO_CONFLICT')).toBe('undo-conflict');
    expect(classifyPadFailure(404, 'CONSOLE_UNDO_NOT_FOUND')).toBe('undo-gone');
    expect(classifyPadFailure(422, 'BUG_NOT_UNDOABLE')).toBe('undo-impossible');
    expect(classifyPadFailure(400, 'SPORTS_CONSOLE_STAT_REJECTED')).toBe('refused');
    expect(classifyPadFailure(409, 'GAME_BUSY')).toBe('refused');
    expect(classifyPadFailure(500)).toBe('server');
    expect(classifyPadFailure(503)).toBe('server');
  });

  it('keeps the newest few rejections, newest first', () => {
    let list: ReturnType<typeof pushRejected> = [];
    for (let i = 1; i <= PAD_MAX_REJECTED + 2; i += 1) {
      list = pushRejected(list, { id: i, label: `t${i}`, failure: 'offline', at: i });
    }
    expect(list.map((r) => r.id)).toEqual([5, 4, 3]);
  });
});
