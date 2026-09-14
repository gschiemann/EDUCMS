/**
 * Codex T01 + T04 (2026-09-13).
 *  - select(…, { source: 'panel' }) records where the selection came from, so
 *    BuilderShell can keep the operator in Layers / Review instead of jumping
 *    to Properties.
 *  - setScenes keeps an explicit Shared view (null) across a refetch and
 *    re-homes zones whose scene was deleted to the default scene.
 */
import { useBuilderStore } from '../useBuilderStore';
import type { Zone } from '../types';

const z = (id: string, sceneId: string | null = null): Zone => ({ id, name: id, widgetType: 'TEXT', x: 0, y: 0, width: 10, height: 10, zIndex: 1, sortOrder: 0, defaultConfig: {}, sceneId } as Zone);
const scene = (id: string, isDefault = false) => ({ id, templateId: 't', name: id, isDefault, sortOrder: 0 } as unknown as Parameters<ReturnType<typeof useBuilderStore.getState>['setScenes']>[0][number]);

beforeEach(() => {
  useBuilderStore.getState().init({
    id: 't', isSystem: false, zones: [z('shared'), z('a', 's1'), z('b', 's2')],
    meta: { name: 'T', description: '', screenWidth: 1920, screenHeight: 1080, bgColor: '', bgGradient: '', bgImage: '' },
    isTouchEnabled: false, idleResetMs: 60000, scenes: [scene('s1', true), scene('s2')],
  });
});

describe('selection source', () => {
  it('defaults to canvas and records panel selections', () => {
    useBuilderStore.getState().select(['a']);
    expect(useBuilderStore.getState().selectionSource).toBe('canvas');
    useBuilderStore.getState().select(['b'], false, { source: 'panel' });
    expect(useBuilderStore.getState().selectedIds).toEqual(['b']);
    expect(useBuilderStore.getState().selectionSource).toBe('panel');
    useBuilderStore.getState().select(['a']);
    expect(useBuilderStore.getState().selectionSource).toBe('canvas');
  });
});

describe('setScenes', () => {
  it('keeps the explicit Shared view (null) across a refetch', () => {
    useBuilderStore.getState().setActiveSceneId(null);
    useBuilderStore.getState().setScenes([scene('s1', true), scene('s2')]);
    expect(useBuilderStore.getState().activeSceneId).toBeNull();
  });
  it('falls back to the default only when the ACTIVE scene is gone', () => {
    useBuilderStore.getState().setActiveSceneId('s2');
    useBuilderStore.getState().setScenes([scene('s1', true)]);
    expect(useBuilderStore.getState().activeSceneId).toBe('s1');
  });
  it('re-homes zones of a deleted scene to the default scene (dirty, no history)', () => {
    const past = useBuilderStore.getState().past.length;
    useBuilderStore.getState().setScenes([scene('s1', true)]);
    const st = useBuilderStore.getState();
    expect(st.zones.find((q) => q.id === 'b')!.sceneId).toBe('s1');
    expect(st.zones.find((q) => q.id === 'shared')!.sceneId).toBeNull();
    expect(st.isDirty).toBe(true);
    expect(st.past.length).toBe(past);
  });
  it('an ordinary refetch with nothing deleted changes nothing and stays clean', () => {
    useBuilderStore.getState().setScenes([scene('s1', true), scene('s2')]);
    expect(useBuilderStore.getState().isDirty).toBe(false);
  });
});
