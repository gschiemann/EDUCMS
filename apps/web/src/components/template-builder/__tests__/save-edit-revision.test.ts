/**
 * Codex T10 (2026-09-13) — the store half of save hardening. Every dirtying
 * change advances editRev; markClean(rev) refuses to clear the flag when edits
 * landed after `rev`. Mutation check: make markClean ignore `rev` and test 3 fails.
 */
import { useBuilderStore } from '../useBuilderStore';
import type { Zone } from '../types';

const z = (id: string): Zone => ({ id, name: id, widgetType: 'TEXT', x: 0, y: 0, width: 10, height: 10, zIndex: 1, sortOrder: 0, defaultConfig: {} } as Zone);
beforeEach(() => {
  useBuilderStore.getState().init({ id: 't', isSystem: false, zones: [z('a'), z('b')], meta: { name: 'T', description: '', screenWidth: 1920, screenHeight: 1080, bgColor: '', bgGradient: '', bgImage: '' }, isTouchEnabled: false, idleResetMs: 60000, scenes: [] });
});
const rev = () => useBuilderStore.getState().editRev;

describe('editRev', () => {
  it('advances on every dirtying change, not on selection', () => {
    const r0 = rev();
    useBuilderStore.getState().select(['a']);
    expect(rev()).toBe(r0);
    useBuilderStore.getState().updateZone('a', { x: 5 }, true);
    expect(rev()).toBe(r0 + 1);
    useBuilderStore.getState().moveLayer('a', 'up');
    expect(rev()).toBe(r0 + 2);
    useBuilderStore.getState().undo();
    expect(rev()).toBeGreaterThan(r0 + 2);   // undo dirties too
  });
  it('markClean() with no rev still clears (legacy callers)', () => {
    useBuilderStore.getState().updateZone('a', { x: 5 }, true);
    useBuilderStore.getState().markClean();
    expect(useBuilderStore.getState().isDirty).toBe(false);
  });
  it('markClean(rev) keeps the template dirty when an edit landed after the save started', () => {
    useBuilderStore.getState().updateZone('a', { x: 5 }, true);
    const atSaveStart = rev();
    useBuilderStore.getState().updateZone('b', { x: 7 }, true);   // edit during the in-flight save
    useBuilderStore.getState().markClean(atSaveStart);
    expect(useBuilderStore.getState().isDirty).toBe(true);
    useBuilderStore.getState().markClean(rev());
    expect(useBuilderStore.getState().isDirty).toBe(false);
  });
});
