/**
 * A6 regression spec (Wave A — "Crush Canva", 2026-07-02).
 *
 * Pre-fix there was no onContextMenu handler anywhere in the
 * template-builder directory — right-click showed the browser's default
 * menu. CanvasContextMenu re-exposes the already-shipped store actions
 * (duplicate / copy / paste / delete / layer order / lock / copy style)
 * at the cursor via a delegated window `contextmenu` listener keyed off
 * the canvas's existing data-template-canvas / data-zone-id attributes.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasContextMenu } from '../CanvasContextMenu';
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
    defaultConfig: { content: 'Hi', color: '#ff0000', fontSize: 32 },
    ...over,
  };
}

function initStore(zones: Zone[], selectedIds: string[] = []) {
  useBuilderStore.getState().init({
    id: 't1',
    isSystem: false,
    zones,
    meta: { name: 'T', description: '', screenWidth: 1920, screenHeight: 1080, bgColor: '', bgGradient: '', bgImage: '' },
    isTouchEnabled: false,
    idleResetMs: 60000,
    scenes: [],
  });
  // init() doesn't reset previewMode and the zustand store is
  // module-global across tests — reset it explicitly so a previous
  // test's previewMode:true can't leak into the next one.
  useBuilderStore.setState({ selectedIds, previewMode: false });
}

/** Renders the menu component plus a stub canvas DOM (the real canvas
 *  markup's load-bearing attributes) to right-click on. */
function mountWithCanvas(zones: Zone[], selectedIds: string[] = [], menuProps: Partial<React.ComponentProps<typeof CanvasContextMenu>> = {}) {
  initStore(zones, selectedIds);
  return render(
    <div>
      <div data-template-canvas="true" data-testid="canvas">
        {zones.map((z) => (
          <div key={z.id} data-zone-id={z.id} data-testid={`zone-${z.id}`} />
        ))}
      </div>
      <CanvasContextMenu clipboard={null} onCopy={() => {}} onPaste={() => {}} {...menuProps} />
    </div>,
  );
}

describe('A6 — right-click context menu', () => {
  it('opens on zone right-click, selects the zone, and shows the zone actions', () => {
    mountWithCanvas([makeZone({ id: 'a' })]);

    fireEvent.contextMenu(screen.getByTestId('zone-a'), { clientX: 40, clientY: 40 });

    expect(screen.getByRole('menu')).toBeTruthy();
    expect(useBuilderStore.getState().selectedIds).toEqual(['a']);
    expect(screen.getByRole('menuitem', { name: /duplicate/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /bring to front/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^lock$/i })).toBeTruthy();
  });

  it('right-click on empty canvas shows only Paste (disabled with an empty clipboard)', () => {
    mountWithCanvas([makeZone({ id: 'a' })]);

    fireEvent.contextMenu(screen.getByTestId('canvas'), { clientX: 40, clientY: 40 });

    const paste = screen.getByRole('menuitem', { name: /paste/i }) as HTMLButtonElement;
    expect(paste.disabled).toBe(true);
    expect(screen.queryByRole('menuitem', { name: /duplicate/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /delete/i })).toBeNull();
  });

  it('does not hijack right-click OUTSIDE the canvas', () => {
    const { container } = mountWithCanvas([makeZone({ id: 'a' })]);
    const outside = document.createElement('div');
    container.appendChild(outside);

    fireEvent.contextMenu(outside, { clientX: 40, clientY: 40 });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Duplicate duplicates every selected zone via the store', () => {
    mountWithCanvas([makeZone({ id: 'a' }), makeZone({ id: 'b', x: 50 })], ['a', 'b']);

    fireEvent.contextMenu(screen.getByTestId('zone-a'), { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole('menuitem', { name: /duplicate/i }));

    expect(useBuilderStore.getState().zones.length).toBe(4);
    // Menu closes after the action.
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Delete removes the selection', () => {
    mountWithCanvas([makeZone({ id: 'a' })], ['a']);

    fireEvent.contextMenu(screen.getByTestId('zone-a'), { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }));

    expect(useBuilderStore.getState().zones.length).toBe(0);
  });

  it('layer actions write zIndex through the store moveLayer', () => {
    mountWithCanvas([makeZone({ id: 'a', zIndex: 1 }), makeZone({ id: 'b', zIndex: 2, x: 60 })], ['a']);

    fireEvent.contextMenu(screen.getByTestId('zone-a'), { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole('menuitem', { name: /bring to front/i }));

    const a = useBuilderStore.getState().zones.find((z) => z.id === 'a')!;
    expect(a.zIndex).toBe(3); // max(1,2) + 1
  });

  it('Lock toggles zone.locked and the reopened menu offers Unlock', () => {
    mountWithCanvas([makeZone({ id: 'a' })], ['a']);

    fireEvent.contextMenu(screen.getByTestId('zone-a'), { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole('menuitem', { name: /^lock$/i }));
    expect(useBuilderStore.getState().zones[0].locked).toBe(true);

    fireEvent.contextMenu(screen.getByTestId('zone-a'), { clientX: 40, clientY: 40 });
    expect(screen.getByRole('menuitem', { name: /unlock/i })).toBeTruthy();
  });

  it('Copy style → Paste style transfers style keys (not content) to the target zone', () => {
    const src = makeZone({ id: 'a', defaultConfig: { content: 'SRC', color: '#ff0000', fontSize: 64, bold: true } });
    const dst = makeZone({ id: 'b', x: 60, defaultConfig: { content: 'DST', color: '#0000ff' } });
    mountWithCanvas([src, dst], ['a']);

    fireEvent.contextMenu(screen.getByTestId('zone-a'), { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole('menuitem', { name: /copy style/i }));

    // Right-click the destination zone → it becomes the selection.
    fireEvent.contextMenu(screen.getByTestId('zone-b'), { clientX: 60, clientY: 60 });
    fireEvent.click(screen.getByRole('menuitem', { name: /paste style/i }));

    const b = useBuilderStore.getState().zones.find((z) => z.id === 'b')!;
    const cfg = b.defaultConfig as Record<string, unknown>;
    expect(cfg.color).toBe('#ff0000');
    expect(cfg.fontSize).toBe(64);
    expect(cfg.bold).toBe(true);
    // Content is NOT style — stays the destination's own.
    expect(cfg.content).toBe('DST');
  });

  it('Escape and click-away both close the menu', () => {
    mountWithCanvas([makeZone({ id: 'a' })]);

    fireEvent.contextMenu(screen.getByTestId('zone-a'), { clientX: 40, clientY: 40 });
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.contextMenu(screen.getByTestId('zone-a'), { clientX: 40, clientY: 40 });
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('stays closed in preview mode', () => {
    mountWithCanvas([makeZone({ id: 'a' })]);
    useBuilderStore.setState({ previewMode: true });

    fireEvent.contextMenu(screen.getByTestId('zone-a'), { clientX: 40, clientY: 40 });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Paste calls the shell-provided onPaste (shared ⌘V clipboard path)', () => {
    const onPaste = jest.fn();
    mountWithCanvas([makeZone({ id: 'a' })], ['a'], {
      clipboard: [makeZone({ id: 'clip' })],
      onPaste,
    });

    fireEvent.contextMenu(screen.getByTestId('zone-a'), { clientX: 40, clientY: 40 });
    // Zone menus carry BOTH "Paste ⌘V" and "Paste style" — target the
    // clipboard one by its shortcut-hint accessible name.
    fireEvent.click(screen.getByRole('menuitem', { name: /paste ⌘v/i }));
    expect(onPaste).toHaveBeenCalledTimes(1);
  });
});
