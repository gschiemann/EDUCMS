/**
 * Selecting a zone must NOT change its stacking order (2026-09-13 audit).
 *
 * BuilderZone used to hoist the selected zone to zIndex 1000. Select a
 * full-screen zone — the placeholder every new template starts from, once
 * filled — and every widget on top of it disappeared until you deselected.
 * The ring + handles now come from SelectionChrome, a top-layer overlay.
 *
 * Mutation check: restore `zIndex: selected ? 1000 : zone.zIndex` in
 * BuilderZone and the first test fails; delete the handles from
 * SelectionChrome and the second fails.
 */
import { render } from '@testing-library/react';
import type { Zone } from '../types';

jest.mock('next/dynamic', () => () => function WidgetPreviewStub() { return <div data-widget-content="stub" />; });
jest.mock('@/components/ui/app-dialog', () => ({ appAlert: jest.fn() }));

import { BuilderZone } from '../BuilderZone';
import { SelectionChrome, HANDLES } from '../SelectionChrome';

const zone = (over: Partial<Zone> = {}): Zone => ({
  id: 'z1', templateId: 't', name: 'Background', widgetType: 'IMAGE',
  x: 0, y: 0, width: 100, height: 100, zIndex: 0, defaultConfig: {}, ...over,
} as Zone);

const noop = () => {};

describe('selection keeps the zone in its own stacking order', () => {
  it('a SELECTED full-screen zone stays at its own zIndex (not 1000)', () => {
    const { container } = render(
      <BuilderZone zone={zone({ zIndex: 0 })} selected previewMode={false} onPointerDown={noop} onResizePointerDown={noop} onSelect={noop} />,
    );
    const el = container.querySelector('[data-zone-id="z1"]') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.style.zIndex).toBe('0');
  });

  it('an unselected zone with a higher zIndex keeps it', () => {
    const { container } = render(
      <BuilderZone zone={zone({ id: 'z2', zIndex: 7 })} selected={false} previewMode={false} onPointerDown={noop} onResizePointerDown={noop} onSelect={noop} />,
    );
    expect((container.querySelector('[data-zone-id="z2"]') as HTMLElement).style.zIndex).toBe('7');
  });
});

describe('SelectionChrome — the ring and handles ride above every zone', () => {
  it('draws eight resize handles for a plain zone, above the zones, without stealing clicks from them', () => {
    const onResize = jest.fn();
    const { container, getByLabelText } = render(<SelectionChrome zone={zone({ zIndex: 0 })} onResizePointerDown={onResize} />);
    const box = container.querySelector('[data-selection-chrome="z1"]') as HTMLElement;
    expect(box.style.zIndex).toBe('1000');
    expect(box.style.pointerEvents).toBe('none');
    expect(container.querySelectorAll('button[aria-label^="Resize "]')).toHaveLength(HANDLES.length);
    const east = getByLabelText('Resize e') as HTMLElement;
    expect(east.style.pointerEvents).toBe('auto');
  });

  it('a locked zone gets the ring but no handles', () => {
    const { container } = render(<SelectionChrome zone={zone({ locked: true } as Partial<Zone>)} onResizePointerDown={noop} />);
    expect(container.querySelector('[data-selection-chrome="z1"]')).not.toBeNull();
    expect(container.querySelectorAll('button[aria-label^="Resize "]')).toHaveLength(0);
  });

  it('a full-canvas EXTERNAL_HTML board gets no chrome at all (its own field list edits it)', () => {
    const { container } = render(<SelectionChrome zone={zone({ widgetType: 'EXTERNAL_HTML' })} onResizePointerDown={noop} />);
    expect(container.querySelector('[data-selection-chrome]')).toBeNull();
  });

  it('rotates with the zone', () => {
    const { container } = render(<SelectionChrome zone={zone({ defaultConfig: { _zoneRotation: 15 } })} onResizePointerDown={noop} />);
    expect((container.querySelector('[data-selection-chrome="z1"]') as HTMLElement).style.transform).toBe('rotate(15deg)');
  });
});
