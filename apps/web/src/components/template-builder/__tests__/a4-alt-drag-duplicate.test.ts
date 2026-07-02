/**
 * A4 regression spec (Wave A — "Crush Canva", 2026-07-02).
 *
 * Pre-fix, altKey was never read anywhere in the canvas drag path —
 * alt-dragging a zone just moved it. Post-fix, onZonePointerDown routes
 * alt-drags through altDragDuplicate(): every selected zone is
 * duplicated via the store's existing duplicateZone, each copy is reset
 * to its source's EXACT position (no +2/+2 jump at drag start), the
 * copies become the selection, and the whole gesture is ONE undo step
 * (single beginTransaction; the drag's pointerup ends it).
 */
import { altDragDuplicate } from '../BuilderCanvas';
import { useBuilderStore } from '../useBuilderStore';
import type { Zone } from '../types';

function makeZone(over: Partial<Zone>): Zone {
  return {
    id: 'z',
    name: 'Zone',
    widgetType: 'TEXT',
    x: 10, y: 10, width: 20, height: 10,
    zIndex: 1,
    sortOrder: 0,
    defaultConfig: { content: 'Hi' },
    ...over,
  };
}

function initStore(zones: Zone[], selectedIds: string[]) {
  useBuilderStore.getState().init({
    id: 't1',
    isSystem: false,
    zones,
    meta: { name: 'T', description: '', screenWidth: 1920, screenHeight: 1080, bgColor: '', bgGradient: '', bgImage: '' },
    isTouchEnabled: false,
    idleResetMs: 60000,
    scenes: [],
  });
  useBuilderStore.setState({ selectedIds });
}

describe('A4 — alt/option-drag duplicates', () => {
  it('duplicates a single zone at its EXACT source position and selects the copy', () => {
    const a = makeZone({ id: 'a', name: 'Logo', x: 25, y: 40 });
    initStore([a], ['a']);

    const newIds = altDragDuplicate(['a']);
    useBuilderStore.getState().endTransaction(); // simulate drag pointerup

    expect(newIds.length).toBe(1);
    const state = useBuilderStore.getState();
    expect(state.zones.length).toBe(2);

    const copy = state.zones.find((z) => z.id === newIds[0])!;
    // Copy starts 1:1 under the cursor — exact source position, not the
    // Cmd-D +2/+2 offset.
    expect(copy.x).toBe(25);
    expect(copy.y).toBe(40);
    expect(copy.name).toBe('Logo copy');

    // The original stays untouched.
    const orig = state.zones.find((z) => z.id === 'a')!;
    expect(orig.x).toBe(25);
    expect(orig.y).toBe(40);

    // Selection moved to the copy (the thing the operator is dragging).
    expect(state.selectedIds).toEqual(newIds);
  });

  it('duplicates the WHOLE multi-selection, preserving each source position', () => {
    const a = makeZone({ id: 'a', x: 10, y: 10 });
    const b = makeZone({ id: 'b', x: 50, y: 30 });
    const c = makeZone({ id: 'c', x: 70, y: 60 });
    initStore([a, b, c], ['a', 'b']);

    const newIds = altDragDuplicate(['a', 'b']);
    useBuilderStore.getState().endTransaction();

    expect(newIds.length).toBe(2);
    const state = useBuilderStore.getState();
    expect(state.zones.length).toBe(5); // 3 originals + 2 copies

    const copyA = state.zones.find((z) => z.id === newIds[0])!;
    const copyB = state.zones.find((z) => z.id === newIds[1])!;
    expect({ x: copyA.x, y: copyA.y }).toEqual({ x: 10, y: 10 });
    expect({ x: copyB.x, y: copyB.y }).toEqual({ x: 50, y: 30 });

    // Both copies (and only them) are the new selection.
    expect([...state.selectedIds].sort()).toEqual([...newIds].sort());
  });

  it('is ONE undo step — a single undo removes every copy at once', () => {
    const a = makeZone({ id: 'a', x: 10, y: 10 });
    const b = makeZone({ id: 'b', x: 50, y: 30 });
    initStore([a, b], ['a', 'b']);

    altDragDuplicate(['a', 'b']);
    useBuilderStore.getState().endTransaction();

    // Exactly one history entry for the whole gesture (2 duplicateZone
    // calls + the position-reset updateZones all coalesced into the one
    // beginTransaction snapshot).
    expect(useBuilderStore.getState().past.length).toBe(1);

    useBuilderStore.getState().undo();
    const state = useBuilderStore.getState();
    expect(state.zones.length).toBe(2);
    expect(state.zones.map((z) => z.id).sort()).toEqual(['a', 'b']);
  });

  it('skips locked zones; returns [] when everything is locked', () => {
    const a = makeZone({ id: 'a', locked: true });
    initStore([a], ['a']);

    const newIds = altDragDuplicate(['a']);
    expect(newIds).toEqual([]);
    expect(useBuilderStore.getState().zones.length).toBe(1);
    // No transaction opened for a no-op gesture.
    expect(useBuilderStore.getState().past.length).toBe(0);
    expect(useBuilderStore.getState().activeTransaction).toBe(false);
  });

  it('Cmd-D style duplicateZone outside a transaction still pushes its own snapshot (unchanged behavior)', () => {
    const a = makeZone({ id: 'a' });
    initStore([a], ['a']);

    useBuilderStore.getState().duplicateZone('a');
    expect(useBuilderStore.getState().past.length).toBe(1);
    // And keeps the +2/+2 offset for the non-drag duplicate affordance.
    const copy = useBuilderStore.getState().zones[1];
    expect(copy.x).toBe(12);
    expect(copy.y).toBe(12);
  });
});
