/**
 * M0-6 (2026-09-12) — Quick Layouts used to flatten a multi-scene kiosk.
 *
 * `applyLayout` is the "Quick layouts" preset action (VariantPicker →
 * QuickLayoutsSection). It did two destructive things on a template with
 * scenes:
 *
 *   1. `set({ zones: next })` — a BLANKET replace. The store holds every
 *      scene's zones at once (BuilderCanvas only *filters* for display), so
 *      picking a layout while editing Scene 2 deleted Scenes 1 and 3 as well.
 *   2. the zones it created carried NO `sceneId`, which in this model means
 *      "shared — render on EVERY scene". So the replacement content appeared
 *      on every screen of the kiosk at once.
 *
 * Together those are the client half of the same collapse the server-side
 * version restore had. The fix is `layoutReplacementTargets`: replace only
 * the slice being edited, and put the new zones on it.
 *
 * Single-scene / no-scene templates keep the old wipe-everything behaviour
 * verbatim — asserted below, because that is the 99% path and a regression
 * there would be far worse than the bug.
 */
import { useBuilderStore, layoutReplacementTargets } from '../useBuilderStore';
import type { Zone, TemplateScene } from '../types';

const QUADRANTS = [
  { x: 0, y: 0, width: 50, height: 50 },
  { x: 50, y: 0, width: 50, height: 50 },
  { x: 0, y: 50, width: 50, height: 50 },
  { x: 50, y: 50, width: 50, height: 50 },
];

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

function scene(id: string, isDefault = false): TemplateScene {
  return { id, templateId: 't1', name: id, sortOrder: 0, isDefault };
}

function initStore(zones: Zone[], scenes: TemplateScene[], activeSceneId?: string | null) {
  useBuilderStore.getState().init({
    id: 't1',
    isSystem: false,
    zones,
    meta: { name: 'T', description: '', screenWidth: 1920, screenHeight: 1080, bgColor: '', bgGradient: '', bgImage: '' },
    isTouchEnabled: true,
    idleResetMs: 60000,
    scenes,
  });
  // init picks the default scene; a test that wants the "Shared" pseudo-scene
  // (or a non-default scene) says so explicitly.
  if (activeSceneId !== undefined) useBuilderStore.setState({ activeSceneId });
}

const WELCOME = 'scene-welcome';
const DIRECTORY = 'scene-directory';
const MAP = 'scene-map';

describe('M0-6 — applyLayout is scene-aware', () => {
  describe('multi-scene kiosk', () => {
    const kioskScenes = [scene(WELCOME, true), scene(DIRECTORY), scene(MAP)];
    const kioskZones = () => [
      makeZone({ id: 'w1', name: 'Welcome hero', sceneId: WELCOME }),
      makeZone({ id: 'd1', name: 'Directory list', sceneId: DIRECTORY }),
      makeZone({ id: 'd2', name: 'Directory search', sceneId: DIRECTORY }),
      makeZone({ id: 'm1', name: 'Campus map', sceneId: MAP }),
      makeZone({ id: 's1', name: 'District logo', sceneId: null }),
    ];

    it('puts every NEW zone on the scene the operator is editing (never shared-across-all)', () => {
      initStore(kioskZones(), kioskScenes, DIRECTORY);
      useBuilderStore.getState().applyLayout(QUADRANTS, 'IMAGE');

      const created = useBuilderStore.getState().zones.filter((z) => z.name.startsWith('Zone '));
      expect(created).toHaveLength(4);
      expect(created.every((z) => z.sceneId === DIRECTORY)).toBe(true);
    });

    it('does NOT delete the other scenes\' content', () => {
      initStore(kioskZones(), kioskScenes, DIRECTORY);
      useBuilderStore.getState().applyLayout(QUADRANTS, 'IMAGE');

      const names = useBuilderStore.getState().zones.map((z) => z.name);
      expect(names).toContain('Welcome hero'); // scene 1 survives
      expect(names).toContain('Campus map');   // scene 3 survives
      expect(names).toContain('District logo'); // shared furniture survives
      // …and the edited scene really was replaced.
      expect(names).not.toContain('Directory list');
      expect(names).not.toContain('Directory search');
    });

    it('editing the "Shared" pseudo-scene replaces ONLY the shared zones', () => {
      initStore(kioskZones(), kioskScenes, null);
      useBuilderStore.getState().applyLayout(QUADRANTS, 'IMAGE');

      const state = useBuilderStore.getState();
      expect(state.zones.map((z) => z.name)).not.toContain('District logo');
      expect(state.zones.filter((z) => z.sceneId === DIRECTORY)).toHaveLength(2);
      expect(state.zones.filter((z) => z.sceneId === WELCOME)).toHaveLength(1);
      expect(state.zones.filter((z) => z.name.startsWith('Zone ')).every((z) => z.sceneId === null)).toBe(true);
    });

    it('stacks the new zones above anything kept, so a shared logo cannot tie their zIndex', () => {
      initStore(
        [makeZone({ id: 's1', name: 'District logo', sceneId: null, zIndex: 9 }), makeZone({ id: 'd1', sceneId: DIRECTORY })],
        kioskScenes,
        DIRECTORY,
      );
      useBuilderStore.getState().applyLayout(QUADRANTS, 'IMAGE');

      const state = useBuilderStore.getState();
      const created = state.zones.filter((z) => z.name.startsWith('Zone '));
      expect(created.map((z) => z.zIndex)).toEqual([10, 11, 12, 13]);
      // No two zones that render together share a zIndex or a sortOrder.
      const onScreen = state.zones.filter((z) => !z.sceneId || z.sceneId === DIRECTORY);
      expect(new Set(onScreen.map((z) => z.zIndex)).size).toBe(onScreen.length);
      expect(new Set(onScreen.map((z) => z.sortOrder)).size).toBe(onScreen.length);
    });

    it('is ONE undo step that restores every scene exactly as it was', () => {
      initStore(kioskZones(), kioskScenes, DIRECTORY);
      useBuilderStore.getState().applyLayout(QUADRANTS, 'IMAGE');
      useBuilderStore.getState().undo();

      const restored = useBuilderStore.getState().zones;
      expect(restored.map((z) => z.id).sort()).toEqual(['d1', 'd2', 'm1', 's1', 'w1']);
      expect(restored.find((z) => z.id === 'd1')!.sceneId).toBe(DIRECTORY);
      expect(restored.find((z) => z.id === 's1')!.sceneId).toBeNull();
    });
  });

  describe('single-scene / legacy templates — pre-M0-6 behaviour, verbatim', () => {
    it('one scene: every zone is replaced, and the new ones join that scene', () => {
      initStore(
        [makeZone({ id: 'a', sceneId: WELCOME }), makeZone({ id: 'b', sceneId: WELCOME })],
        [scene(WELCOME, true)],
      );
      useBuilderStore.getState().applyLayout(QUADRANTS, 'IMAGE');

      const state = useBuilderStore.getState();
      expect(state.zones).toHaveLength(4);
      expect(state.zones.every((z) => z.sceneId === WELCOME)).toBe(true);
    });

    it('one scene with a stray shared zone: still a full wipe (no orphan is left behind on the canvas)', () => {
      initStore(
        [makeZone({ id: 'a', sceneId: WELCOME }), makeZone({ id: 'orphan', sceneId: null })],
        [scene(WELCOME, true)],
      );
      useBuilderStore.getState().applyLayout(QUADRANTS, 'IMAGE');
      expect(useBuilderStore.getState().zones.map((z) => z.id)).not.toContain('orphan');
    });

    it('no scenes at all (pre-D2 template): every zone is replaced and the new ones stay shared', () => {
      initStore([makeZone({ id: 'a' }), makeZone({ id: 'b' })], []);
      useBuilderStore.getState().applyLayout(QUADRANTS, 'IMAGE');

      const state = useBuilderStore.getState();
      expect(state.zones).toHaveLength(4);
      expect(state.zones.every((z) => z.sceneId === null)).toBe(true);
      expect(state.selectedIds).toEqual([state.zones[0].id]);
      expect(state.isDirty).toBe(true);
    });
  });

  describe('layoutReplacementTargets (the predicate the confirm dialog counts with)', () => {
    const zones = [
      makeZone({ id: 'w1', sceneId: WELCOME }),
      makeZone({ id: 'd1', sceneId: DIRECTORY }),
      makeZone({ id: 's1', sceneId: null }),
    ];

    it('multi-scene: only the active slice', () => {
      expect(layoutReplacementTargets(zones, 3, DIRECTORY).map((z) => z.id)).toEqual(['d1']);
      expect(layoutReplacementTargets(zones, 3, null).map((z) => z.id)).toEqual(['s1']);
    });

    it('one scene or none: everything', () => {
      expect(layoutReplacementTargets(zones, 1, WELCOME)).toHaveLength(3);
      expect(layoutReplacementTargets(zones, 0, null)).toHaveLength(3);
    });
  });
});
