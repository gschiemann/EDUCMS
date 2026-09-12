/**
 * M0-7 (2026-09-12) — "Lock" was a session-only suggestion.
 *
 * Two halves to the bug; this file covers the IN-SESSION half.
 *
 * `useBuilderStore.removeSelected` filtered on `selectedIds` alone and
 * `updateZones` applied its patch to every id it was handed — neither read
 * `zone.locked` at all. So the operator's own acceptance case —
 * "lock a zone, marquee-select-all, press Delete" — deleted the locked zone
 * along with everything else, and a multi-selection drag / group resize /
 * arrow-key nudge / Align / Distribute all dragged it around too.
 *
 * The rule these tests pin down: a LOCKED zone cannot be MOVED, RESIZED or
 * DELETED. It is still selectable (so its properties are readable and its
 * Unlock control is reachable), still receives CONTENT edits applied to a
 * selection (brand-apply, paste-style, chat-to-edit, POS auto-map — all of
 * which patch `defaultConfig`), and a patch that clears `locked` itself is
 * never blocked.
 */
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

describe('M0-7 — removeSelected respects the lock', () => {
  it('THE ACCEPTANCE CASE: select-all + Delete removes the unlocked zones and the locked one survives', () => {
    const locked = makeZone({ id: 'pinned', name: 'Sponsor strip', locked: true });
    const a = makeZone({ id: 'a', x: 40 });
    const b = makeZone({ id: 'b', x: 70 });
    initStore([locked, a, b], ['pinned', 'a', 'b']); // marquee-select-all

    useBuilderStore.getState().removeSelected();

    const ids = useBuilderStore.getState().zones.map((z) => z.id);
    expect(ids).toEqual(['pinned']);
  });

  it('leaves the surviving locked zone SELECTED, so the operator can see what refused to go (and reach Unlock)', () => {
    const locked = makeZone({ id: 'pinned', locked: true });
    const a = makeZone({ id: 'a', x: 40 });
    initStore([locked, a], ['pinned', 'a']);

    useBuilderStore.getState().removeSelected();

    expect(useBuilderStore.getState().selectedIds).toEqual(['pinned']);
  });

  it('an all-unlocked delete still clears the selection exactly as before (no behaviour change)', () => {
    const a = makeZone({ id: 'a' });
    const b = makeZone({ id: 'b', x: 40 });
    initStore([a, b], ['a', 'b']);

    useBuilderStore.getState().removeSelected();

    expect(useBuilderStore.getState().zones).toEqual([]);
    expect(useBuilderStore.getState().selectedIds).toEqual([]);
  });

  it('deleting a selection that is ENTIRELY locked is a true no-op — nothing removed, no undo step, not dirty', () => {
    const locked = makeZone({ id: 'pinned', locked: true });
    initStore([locked], ['pinned']);
    const pastBefore = useBuilderStore.getState().past.length;

    useBuilderStore.getState().removeSelected();

    const s = useBuilderStore.getState();
    expect(s.zones.map((z) => z.id)).toEqual(['pinned']);
    expect(s.past.length).toBe(pastBefore); // a Delete that deletes nothing must not cost an undo
    expect(s.isDirty).toBe(false);
    expect(s.selectedIds).toEqual(['pinned']);
  });

  it('⌘D on a locked zone gives an UNLOCKED copy — a brand-new zone that refuses to move is a trap', () => {
    const locked = makeZone({ id: 'pinned', locked: true });
    initStore([locked], ['pinned']);

    const newId = useBuilderStore.getState().duplicateZone('pinned')!;

    const copy = useBuilderStore.getState().zones.find((z) => z.id === newId)!;
    expect(copy.locked).toBe(false);
    // …and it really is movable.
    useBuilderStore.getState().updateZones([newId], (z) => ({ x: z.x + 10 }));
    expect(useBuilderStore.getState().zones.find((z) => z.id === newId)!.x).toBe(22);
    // The source is untouched and still locked.
    expect(useBuilderStore.getState().zones.find((z) => z.id === 'pinned')!.locked).toBe(true);
  });

  it('unlocking then deleting works — the lock is a gate, not a life sentence', () => {
    const locked = makeZone({ id: 'pinned', locked: true });
    initStore([locked], ['pinned']);

    useBuilderStore.getState().toggleLock('pinned');
    useBuilderStore.getState().removeSelected();

    expect(useBuilderStore.getState().zones).toEqual([]);
  });
});

describe('M0-7 — updateZones respects the lock for GEOMETRY only', () => {
  it('a bulk drag-move (x/y) moves the unlocked zones and leaves the locked one exactly where it was', () => {
    const locked = makeZone({ id: 'pinned', x: 10, y: 10, locked: true });
    const a = makeZone({ id: 'a', x: 40, y: 20 });
    initStore([locked, a], ['pinned', 'a']);

    // Exactly the patch BuilderCanvas's move branch produces.
    useBuilderStore.getState().updateZones(['pinned', 'a'], (z) => ({ x: z.x + 15, y: z.y + 5 }));

    const s = useBuilderStore.getState();
    const p = s.zones.find((z) => z.id === 'pinned')!;
    const m = s.zones.find((z) => z.id === 'a')!;
    expect({ x: p.x, y: p.y }).toEqual({ x: 10, y: 10 });
    expect({ x: m.x, y: m.y }).toEqual({ x: 55, y: 25 });
  });

  it('a group resize (x/y/width/height) leaves every geometry field of the locked zone untouched', () => {
    const locked = makeZone({ id: 'pinned', x: 10, y: 10, width: 20, height: 10, locked: true });
    const a = makeZone({ id: 'a', x: 40, y: 20, width: 20, height: 10 });
    initStore([locked, a], ['pinned', 'a']);

    useBuilderStore.getState().updateZones(['pinned', 'a'], (z) => ({
      x: z.x * 2, y: z.y * 2, width: z.width * 2, height: z.height * 2,
    }));

    const p = useBuilderStore.getState().zones.find((z) => z.id === 'pinned')!;
    expect({ x: p.x, y: p.y, width: p.width, height: p.height })
      .toEqual({ x: 10, y: 10, width: 20, height: 10 });
    // The unlocked sibling scales, then clampZone pulls x back to
    // 100 - width = 60 (pre-existing behaviour, unchanged by M0-7).
    const m = useBuilderStore.getState().zones.find((z) => z.id === 'a')!;
    expect({ x: m.x, y: m.y, width: m.width, height: m.height })
      .toEqual({ x: 60, y: 40, width: 40, height: 20 });
  });

  it('an Align / Distribute patch (a single geometry key) is refused for the locked zone', () => {
    const locked = makeZone({ id: 'pinned', x: 10, locked: true });
    const a = makeZone({ id: 'a', x: 40 });
    initStore([locked, a], ['pinned', 'a']);

    // MultiAlignButtons "Left": updateZones(ids, () => ({ x: leftMost }), true)
    useBuilderStore.getState().updateZones(['pinned', 'a'], () => ({ x: 0 }), true);

    expect(useBuilderStore.getState().zones.find((z) => z.id === 'pinned')!.x).toBe(10);
    expect(useBuilderStore.getState().zones.find((z) => z.id === 'a')!.x).toBe(0);
  });

  it('a CONTENT patch still lands on a locked zone — a lock must not leave one widget off-brand', () => {
    const locked = makeZone({ id: 'pinned', locked: true, defaultConfig: { content: 'Hi' } });
    initStore([locked], ['pinned']);

    // The shape BrandKitPanel / paste-style / chat-to-edit all use.
    useBuilderStore.getState().updateZones(['pinned'], (z) => ({
      defaultConfig: { ...(z.defaultConfig || {}), color: 'var(--brand-primary)' },
    }), true);

    const p = useBuilderStore.getState().zones.find((z) => z.id === 'pinned')!;
    expect(p.defaultConfig).toEqual({ content: 'Hi', color: 'var(--brand-primary)' });
    expect(p.locked).toBe(true); // still locked afterwards
  });

  it('a mixed patch applies the content half and drops only the geometry half', () => {
    const locked = makeZone({ id: 'pinned', x: 10, locked: true, defaultConfig: {} });
    initStore([locked], ['pinned']);

    useBuilderStore.getState().updateZones(['pinned'], () => ({
      x: 99,
      defaultConfig: { content: 'new' },
    }), true);

    const p = useBuilderStore.getState().zones.find((z) => z.id === 'pinned')!;
    expect(p.x).toBe(10);
    expect(p.defaultConfig).toEqual({ content: 'new' });
  });

  it('a patch that CLEARS the lock is never blocked by the lock itself', () => {
    const locked = makeZone({ id: 'pinned', locked: true });
    initStore([locked], ['pinned']);

    useBuilderStore.getState().updateZones(['pinned'], () => ({ locked: false }), true);

    expect(useBuilderStore.getState().zones.find((z) => z.id === 'pinned')!.locked).toBe(false);
  });

  it('a geometry-only bulk edit on an all-locked selection does not dirty the template or burn an undo step', () => {
    const locked = makeZone({ id: 'pinned', locked: true });
    initStore([locked], ['pinned']);
    const pastBefore = useBuilderStore.getState().past.length;

    // The arrow-key nudge path in BuilderShell.
    useBuilderStore.getState().updateZones(['pinned'], (z) => ({ x: z.x + 1, y: z.y }));

    const s = useBuilderStore.getState();
    expect(s.isDirty).toBe(false);
    expect(s.past.length).toBe(pastBefore);
  });

  it('an UNLOCKED zone is completely unaffected — same clamping, same dirty flag as before', () => {
    const a = makeZone({ id: 'a', x: 10, y: 10, width: 20, height: 10 });
    initStore([a], ['a']);

    useBuilderStore.getState().updateZones(['a'], () => ({ x: 200 }), true); // over-wide: clamps

    const s = useBuilderStore.getState();
    expect(s.zones[0].x).toBe(80); // clampZone: 100 - width
    expect(s.isDirty).toBe(true);
    expect(s.past.length).toBe(1);
  });
});
