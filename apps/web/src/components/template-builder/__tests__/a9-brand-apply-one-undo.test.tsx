/**
 * A9 regression spec (Wave A — "Crush Canva", 2026-07-02).
 *
 * Pre-fix, applyBrandToAllZones called updateZones with NO commit arg
 * (no snapshot pushed, redo stack cleared anyway) and the trailing
 * setMeta snapshotted the ALREADY-recolored zones — so Cmd-Z after
 * "Apply brand across template" reverted only the background while the
 * widget recolor stuck, and a second Cmd-Z jumped past unrelated
 * earlier work. Post-fix the whole apply is wrapped in ONE
 * beginTransaction/endTransaction: a single Cmd-Z restores the exact
 * prior look (zones AND background together).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { BrandKitPanel } from '../BrandKitPanel';
import { useBuilderStore } from '../useBuilderStore';
import type { Zone } from '../types';

const MOCK_KIT = {
  logoUrl: null,
  palette: {
    primary: '#112233',
    accent: '#445566',
    ink: '#0f172a',
    surface: '#f8fafc',
  },
  fontHeading: 'Inter',
  fontBody: 'Inter',
  displayName: 'Test Brand',
};

jest.mock('@/hooks/use-api', () => ({
  useTemplate: () => ({ data: { id: 't1', brandKit: MOCK_KIT }, isLoading: false }),
  useAdoptTemplateBrandKit: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useClearTemplateBrandKit: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
}));

jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: jest.fn().mockResolvedValue(false),
  appAlert: jest.fn().mockResolvedValue(undefined),
}));

function makeZone(over: Partial<Zone>): Zone {
  return {
    id: 'z',
    name: 'Zone',
    widgetType: 'TEXT',
    x: 10, y: 10, width: 20, height: 10,
    zIndex: 1,
    sortOrder: 0,
    defaultConfig: {},
    ...over,
  };
}

function initStore(zones: Zone[]) {
  useBuilderStore.getState().init({
    id: 't1',
    isSystem: false,
    zones,
    meta: { name: 'T', description: '', screenWidth: 1920, screenHeight: 1080, bgColor: '', bgGradient: '', bgImage: '' },
    isTouchEnabled: false,
    idleResetMs: 60000,
    scenes: [],
  });
  useBuilderStore.setState({ selectedIds: [], previewMode: false });
}

function zoneById(id: string): Zone {
  return useBuilderStore.getState().zones.find((z) => z.id === id)!;
}

describe('A9 — brand-apply is ONE undoable history step', () => {
  it('apply mutates zones + background but pushes exactly ONE history snapshot', () => {
    initStore([
      makeZone({ id: 'ticker', widgetType: 'TICKER', defaultConfig: { messages: ['hi'] } }),
      makeZone({ id: 'text', widgetType: 'TEXT', x: 50, defaultConfig: { content: 'Hello' } }),
    ]);
    render(<BrandKitPanel />);

    fireEvent.click(screen.getByRole('button', { name: /apply brand across template/i }));

    const st = useBuilderStore.getState();
    // The apply really happened…
    expect((zoneById('ticker').defaultConfig as any).bgColor).toBe('#112233');
    expect((zoneById('text').defaultConfig as any).fontFamily).toBe('Inter');
    expect(st.meta.bgGradient).toContain('#112233');
    // …as exactly one history entry, with the transaction closed.
    expect(st.past.length).toBe(1);
    expect(st.activeTransaction).toBe(false);
  });

  it('a single undo restores BOTH the widget recolor and the background', () => {
    initStore([
      makeZone({ id: 'ticker', widgetType: 'TICKER', defaultConfig: { messages: ['hi'] } }),
    ]);
    render(<BrandKitPanel />);

    fireEvent.click(screen.getByRole('button', { name: /apply brand across template/i }));
    expect((zoneById('ticker').defaultConfig as any).bgColor).toBe('#112233');
    expect(useBuilderStore.getState().meta.bgGradient).not.toBe('');

    useBuilderStore.getState().undo();

    // Pre-fix drift: undo restored ONLY the background while the widget
    // recolor stuck. Post-fix everything reverts together.
    expect((zoneById('ticker').defaultConfig as any).bgColor).toBeUndefined();
    expect(useBuilderStore.getState().meta.bgGradient).toBe('');
  });

  it('redo re-applies the whole brand step in one go', () => {
    initStore([
      makeZone({ id: 'ticker', widgetType: 'TICKER', defaultConfig: { messages: ['hi'] } }),
    ]);
    render(<BrandKitPanel />);

    fireEvent.click(screen.getByRole('button', { name: /apply brand across template/i }));
    useBuilderStore.getState().undo();
    expect((zoneById('ticker').defaultConfig as any).bgColor).toBeUndefined();

    useBuilderStore.getState().redo();
    expect((zoneById('ticker').defaultConfig as any).bgColor).toBe('#112233');
    expect(useBuilderStore.getState().meta.bgGradient).toContain('#112233');
  });

  it('prior history survives — undo twice walks brand-apply then the earlier edit', () => {
    initStore([
      makeZone({ id: 'text', widgetType: 'TEXT', defaultConfig: { content: 'Hello' } }),
    ]);
    // An earlier, unrelated committed edit.
    useBuilderStore.getState().updateZone('text', { x: 30 }, true);
    expect(useBuilderStore.getState().past.length).toBe(1);

    render(<BrandKitPanel />);
    fireEvent.click(screen.getByRole('button', { name: /apply brand across template/i }));
    expect(useBuilderStore.getState().past.length).toBe(2);

    useBuilderStore.getState().undo(); // undoes brand-apply
    expect((zoneById('text').defaultConfig as any).fontFamily).toBeUndefined();
    expect(zoneById('text').x).toBe(30);

    useBuilderStore.getState().undo(); // undoes the x edit
    expect(zoneById('text').x).toBe(10);
  });
});
