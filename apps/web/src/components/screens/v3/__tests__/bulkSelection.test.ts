import { groupResults, pruneTo, reasonKey, requestFor, setMany, stateFor, toggleMany, toggleOne, BULK_KINDS } from '../bulkSelection';
import en from '../../../../i18n/messages/en.json';

describe('bulk selection — pure rules', () => {
  it('a header / group box goes none → all → none over exactly the ids it covers', () => {
    let sel = new Set<string>(['other']);
    const ids = ['a', 'b', 'c'];
    expect(stateFor(sel, ids)).toBe('none');
    sel = toggleMany(sel, ids);
    expect([...sel].sort()).toEqual(['a', 'b', 'c', 'other']);
    expect(stateFor(sel, ids)).toBe('all');
    sel = toggleMany(sel, ids);
    expect([...sel]).toEqual(['other']); // ids outside the box keep their state
  });

  it('from "some" a box selects the rest (never clears a partial selection)', () => {
    const sel = toggleMany(new Set(['a']), ['a', 'b']);
    expect([...sel].sort()).toEqual(['a', 'b']);
    expect(stateFor(new Set(['a']), ['a', 'b'])).toBe('some');
  });

  it('toggleOne / setMany / pruneTo', () => {
    expect([...toggleOne(new Set(['a']), 'a')]).toEqual([]);
    expect([...toggleOne(new Set(), 'a')]).toEqual(['a']);
    expect([...setMany(new Set(['a', 'b']), ['b'], false)]).toEqual(['a']);
    const same = new Set(['a']);
    expect(pruneTo(same, ['a', 'b'])).toBe(same); // unchanged → same object (no re-render)
    expect([...pruneTo(new Set(['a', 'gone']), ['a'])]).toEqual(['a']);
  });

  it('every kind becomes the right API request', () => {
    expect(requestFor('resync', ['s'])).toEqual({ action: 'resync', screenIds: ['s'] });
    expect(requestFor('update', ['s'])).toEqual({ action: 'update', screenIds: ['s'] });
    expect(requestFor('power-off', ['s'])).toEqual({ action: 'power', state: 'off', screenIds: ['s'] });
    expect(requestFor('power-on', ['s'])).toEqual({ action: 'power', state: 'on', screenIds: ['s'] });
    expect(requestFor('auto-inherit', ['s'])).toEqual({ action: 'auto-update', mode: 'inherit', screenIds: ['s'] });
    expect(BULK_KINDS).toHaveLength(7);
  });

  it('every API reason code has copy in the catalog', () => {
    const codes = ['not-found', 'out-of-scope', 'already-current', 'no-player-app', 'unchanged', 'unsupported', 'emergency-hold', 'not-delivered', 'no-live-connection', 'error'];
    for (const c of codes) {
      const key = reasonKey(c)!;
      const leaf = key.split('.').reduce<any>((n, p) => n?.[p], en);
      expect([c, typeof leaf]).toEqual([c, 'string']);
    }
    expect(reasonKey('made-up')).toBeNull();
  });

  it('groups results and counts skips per reason and install prompts', () => {
    const g = groupResults([
      { screenId: 'a', name: 'A', outcome: 'sent', installPrompt: true },
      { screenId: 'b', name: 'B', outcome: 'sent', installPrompt: false },
      { screenId: 'c', name: 'C', outcome: 'skipped', reason: 'already-current' },
      { screenId: 'd', name: 'D', outcome: 'skipped', reason: 'already-current' },
      { screenId: 'e', name: 'E', outcome: 'failed', reason: 'no-live-connection' },
    ]);
    expect(g.sent).toHaveLength(2);
    expect(g.failed.map((r) => r.screenId)).toEqual(['e']);
    expect(g.skippedByReason).toEqual([{ reason: 'already-current', count: 2 }]);
    expect(g.installPrompts).toBe(1);
  });
});
