/**
 * Bring forward / Send back must change the REAL stacking order (Codex T03,
 * 2026-09-13). `moveLayer('up')` used to be `zIndex + 1`: bringing a zone at 1
 * forward past one at 2 produced two zones at 2, and DOM order decided who
 * painted on top. Mutation check: restore `curr + 1` and the first test fails.
 */
import { useBuilderStore } from '../useBuilderStore';
import type { Zone } from '../types';

const z = (id: string, zIndex: number): Zone => ({ id, name: id, widgetType: 'TEXT', x: 0, y: 0, width: 10, height: 10, zIndex, sortOrder: 0, defaultConfig: {} } as Zone);
const order = () => useBuilderStore.getState().zones.slice().sort((a, b) => a.zIndex - b.zIndex).map((q) => q.id);
const zi = (id: string) => useBuilderStore.getState().zones.find((q) => q.id === id)!.zIndex;

beforeEach(() => {
  useBuilderStore.getState().init({
    id: 't', isSystem: false, zones: [z('a', 1), z('b', 2), z('c', 3)],
    meta: { name: 'T', description: '', screenWidth: 1920, screenHeight: 1080, bgColor: '', bgGradient: '', bgImage: '' },
    isTouchEnabled: false, idleResetMs: 60000, scenes: [],
  });
});

describe('moveLayer reorders against the real neighbour', () => {
  it('bring forward puts A strictly above B (no shared zIndex), C stays on top', () => {
    useBuilderStore.getState().moveLayer('a', 'up');
    expect(order()).toEqual(['b', 'a', 'c']);
    expect(zi('a')).toBeGreaterThan(zi('b'));
    expect(new Set(useBuilderStore.getState().zones.map((q) => q.zIndex)).size).toBe(3);
  });
  it('send back is the inverse; top / bottom jump to the ends', () => {
    useBuilderStore.getState().moveLayer('c', 'down');
    expect(order()).toEqual(['a', 'c', 'b']);
    useBuilderStore.getState().moveLayer('a', 'top');
    expect(order()).toEqual(['c', 'b', 'a']);
    useBuilderStore.getState().moveLayer('a', 'bottom');
    expect(order()).toEqual(['a', 'c', 'b']);
  });
  it('a move that changes nothing pushes no history and does not dirty', () => {
    const before = useBuilderStore.getState().past.length;
    useBuilderStore.getState().moveLayer('c', 'up');   // already on top
    expect(useBuilderStore.getState().past.length).toBe(before);
    expect(useBuilderStore.getState().isDirty).toBe(false);
  });
  it('one move = one undo step', () => {
    useBuilderStore.getState().moveLayer('a', 'up');
    useBuilderStore.getState().undo();
    expect(order()).toEqual(['a', 'b', 'c']);
  });
});
