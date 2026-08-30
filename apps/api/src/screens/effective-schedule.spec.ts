/**
 * Deterministic schedule ordering (2026-08-30 player reliability program).
 * Encodes the audit's P0-3 acceptance criteria at the pure-logic layer.
 */
import { orderSchedulesForManifest, schedulePin } from './effective-schedule';

const d = (iso: string) => new Date(iso);

describe('orderSchedulesForManifest', () => {
  it('THE 1.1.6 STALE-CONTENT PATH: a new screen-pinned media publish outranks an old group template', () => {
    const groupTemplate = {
      id: 'aaa', screenGroupId: 'g1', screenId: null, priority: 0,
      mode: 'replace', startTime: d('2026-05-01T00:00:00Z'),
    };
    const screenMedia = {
      id: 'bbb', screenId: 's1', screenGroupId: null, priority: 0,
      mode: 'replace', startTime: d('2026-08-28T10:44:31Z'),
    };
    const out = orderSchedulesForManifest([groupTemplate, screenMedia]);
    expect(out[0].id).toBe('bbb');
    expect(schedulePin(out[0])).toBe('screen');
  });

  it('direct override removed → the group schedule is simply the next winner (clean fallback)', () => {
    const group = { id: 'aaa', screenGroupId: 'g1', screenId: null, priority: 0, mode: 'replace', startTime: d('2026-05-01T00:00:00Z') };
    expect(orderSchedulesForManifest([group])[0].id).toBe('aaa');
  });

  it('priority beats start-time within the same pin level', () => {
    const older = { id: 'a', screenId: 's1', priority: 5, mode: 'replace', startTime: d('2026-01-01T00:00:00Z') };
    const newer = { id: 'b', screenId: 's1', priority: 0, mode: 'replace', startTime: d('2026-08-01T00:00:00Z') };
    expect(orderSchedulesForManifest([newer, older])[0].id).toBe('a');
  });

  it('same pin + priority → newest startTime wins; full tie → stable id order regardless of input order', () => {
    const a = { id: 'a', screenId: 's1', priority: 0, mode: 'replace', startTime: d('2026-08-01T00:00:00Z') };
    const b = { id: 'b', screenId: 's1', priority: 0, mode: 'replace', startTime: d('2026-08-02T00:00:00Z') };
    expect(orderSchedulesForManifest([a, b])[0].id).toBe('b');
    expect(orderSchedulesForManifest([b, a])[0].id).toBe('b');

    const t1 = { id: 'x', screenId: 's1', priority: 0, mode: 'replace', startTime: d('2026-08-01T00:00:00Z') };
    const t2 = { id: 'y', screenId: 's1', priority: 0, mode: 'replace', startTime: d('2026-08-01T00:00:00Z') };
    expect(orderSchedulesForManifest([t2, t1]).map(s => s.id)).toEqual(['x', 'y']);
    expect(orderSchedulesForManifest([t1, t2]).map(s => s.id)).toEqual(['x', 'y']);
  });

  it('append rows sort after every replace row and keep precedence among themselves', () => {
    const append1 = { id: 'p1', screenGroupId: 'g1', priority: 9, mode: 'append', startTime: d('2026-08-01T00:00:00Z') };
    const append2 = { id: 'p2', screenId: 's1', priority: 0, mode: 'append', startTime: d('2026-08-01T00:00:00Z') };
    const replace = { id: 'r1', screenGroupId: 'g1', priority: 0, mode: 'replace', startTime: d('2026-01-01T00:00:00Z') };
    const out = orderSchedulesForManifest([append1, append2, replace]);
    expect(out[0].id).toBe('r1');
    // among appends: screen-pin first
    expect(out.slice(1).map(s => s.id)).toEqual(['p2', 'p1']);
  });

  it('missing mode is treated as replace (legacy rows)', () => {
    const legacy = { id: 'l1', screenId: 's1', startTime: d('2026-08-01T00:00:00Z') } as any;
    const append = { id: 'p1', screenId: 's1', mode: 'append', startTime: d('2026-08-02T00:00:00Z') };
    expect(orderSchedulesForManifest([append, legacy])[0].id).toBe('l1');
  });

  it('does not mutate its input', () => {
    const rows = [
      { id: 'b', screenId: 's1', mode: 'replace', startTime: d('2026-08-02T00:00:00Z') },
      { id: 'a', screenGroupId: 'g1', mode: 'replace', startTime: d('2026-08-01T00:00:00Z') },
    ];
    const snapshot = rows.map(r => r.id);
    orderSchedulesForManifest(rows);
    expect(rows.map(r => r.id)).toEqual(snapshot);
  });
});
