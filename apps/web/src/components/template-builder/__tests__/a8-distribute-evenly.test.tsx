/**
 * A8 regression spec (Wave A — "Crush Canva", 2026-07-02).
 *
 * Pre-fix, MultiAlignButtons offered Left/CenterX/Right/Top/CenterY/
 * Bottom only — evenly spacing sponsor logos or menu rows was manual
 * math. Post-fix, Distribute H / Distribute V (enabled at 3+ selected)
 * equalize the gaps between neighbors, anchoring the outermost zones —
 * and the align/distribute row renders DIRECTLY in the multi-select
 * panel (not inside any collapsed section).
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PropertiesPanel, distributeEvenly } from '../PropertiesPanel';
import { useBuilderStore } from '../useBuilderStore';
import type { Zone } from '../types';

// Test-noise silencer: the builder UI mounts the AI affordances
// (ChatToEditBox / MultiZoneChatEdit / …), each of which probes GET
// /ai/key through apiFetch() on mount. In jsdom that probe can only
// fail — spamming console.error from the api-client logger — and its
// .then(setState) lands AFTER the test's act() scope, firing "not
// wrapped in act(...)" warnings. This suite does not test the AI
// affordances, so keep the probe permanently pending.
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

function makeZone(over: Partial<Zone>): Zone {
  return {
    id: 'z',
    name: 'Zone',
    widgetType: 'TEXT',
    x: 0, y: 0, width: 10, height: 10,
    zIndex: 1,
    sortOrder: 0,
    defaultConfig: {},
    ...over,
  };
}

function mountWithZones(zones: Zone[], selectedIds: string[]) {
  useBuilderStore.getState().init({
    id: 't1',
    isSystem: false,
    zones,
    meta: { name: 'T', description: '', screenWidth: 1920, screenHeight: 1080, bgColor: '', bgGradient: '', bgImage: '' },
    isTouchEnabled: false,
    idleResetMs: 60000,
    scenes: [],
  });
  useBuilderStore.setState({ selectedIds, previewMode: false });
  return render(<PropertiesPanel />);
}

function zoneById(id: string): Zone {
  return useBuilderStore.getState().zones.find((z) => z.id === id)!;
}

describe('A8 — distributeEvenly math', () => {
  it('equalizes gaps, anchoring the outermost zones', () => {
    // a: 0–10, b: 12–22, c: 40–50 → span 0–50, sizes 30, gaps become
    // (50 - 30) / 2 = 10 each → a stays 0, b → 20, c stays 40.
    const sel = [
      { id: 'a', x: 0, y: 0, width: 10, height: 10 },
      { id: 'b', x: 12, y: 0, width: 10, height: 10 },
      { id: 'c', x: 40, y: 0, width: 10, height: 10 },
    ];
    const map = distributeEvenly(sel, 'h');
    expect(map).toEqual({ a: 0, b: 20, c: 40 });
  });

  it('works vertically and with mixed sizes', () => {
    // a: 10–20 (h10), b: 25–45 (h20), c: 70–80 (h10) → span 10–80 = 70,
    // sizes 40 → gap (70-40)/2 = 15 → a 10, b 35, c 70.
    const sel = [
      { id: 'a', x: 0, y: 10, width: 10, height: 10 },
      { id: 'b', x: 0, y: 25, width: 10, height: 20 },
      { id: 'c', x: 0, y: 70, width: 10, height: 10 },
    ];
    const map = distributeEvenly(sel, 'v');
    expect(map).toEqual({ a: 10, b: 35, c: 70 });
  });

  it('returns an empty map below 3 zones (nothing to distribute)', () => {
    const sel = [
      { id: 'a', x: 0, y: 0, width: 10, height: 10 },
      { id: 'b', x: 40, y: 0, width: 10, height: 10 },
    ];
    expect(distributeEvenly(sel, 'h')).toEqual({});
  });
});

describe('A8 — Distribute buttons in the multi-select panel', () => {
  it('renders the align + distribute row directly (no collapsed section to open) with 3 zones selected', () => {
    mountWithZones(
      [makeZone({ id: 'a', x: 0 }), makeZone({ id: 'b', x: 12 }), makeZone({ id: 'c', x: 40 })],
      ['a', 'b', 'c'],
    );

    // Buttons are reachable IMMEDIATELY — no CollapsibleSection toggle
    // stands between the operator and align/distribute.
    const h = screen.getByRole('button', { name: /distribute h/i }) as HTMLButtonElement;
    const v = screen.getByRole('button', { name: /distribute v/i }) as HTMLButtonElement;
    expect(h.disabled).toBe(false);
    expect(v.disabled).toBe(false);
    expect(screen.getByRole('button', { name: /^left$/i })).toBeTruthy();
  });

  it('clicking Distribute H equalizes the horizontal gaps via the store', () => {
    mountWithZones(
      [makeZone({ id: 'a', x: 0 }), makeZone({ id: 'b', x: 12 }), makeZone({ id: 'c', x: 40 })],
      ['a', 'b', 'c'],
    );

    fireEvent.click(screen.getByRole('button', { name: /distribute h/i }));

    expect(zoneById('a').x).toBeCloseTo(0, 5);
    expect(zoneById('b').x).toBeCloseTo(20, 5);
    expect(zoneById('c').x).toBeCloseTo(40, 5);
    // One undoable step. (act(): the store set re-renders the mounted
    // PropertiesPanel.)
    expect(useBuilderStore.getState().past.length).toBe(1);
    act(() => useBuilderStore.getState().undo());
    expect(zoneById('b').x).toBe(12);
  });

  it('Distribute is disabled with only 2 zones selected', () => {
    mountWithZones(
      [makeZone({ id: 'a', x: 0 }), makeZone({ id: 'b', x: 40 })],
      ['a', 'b'],
    );

    const h = screen.getByRole('button', { name: /distribute h/i }) as HTMLButtonElement;
    expect(h.disabled).toBe(true);
  });
});
