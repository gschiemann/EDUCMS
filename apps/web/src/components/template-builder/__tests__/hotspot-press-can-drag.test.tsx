/**
 * A press on an IDLE hotspot must be able to start a zone drag (template-maker
 * audit, 2026-09-13). BuilderZone used to return early on any press inside a
 * `[data-field]` / `[data-field-jump]`, so a widget whose whole body is a
 * hotspot (ticker, calendar, rich text, list boards — 100% on the drag-surface
 * sweep) could never be moved with the mouse. Only a field that is ACTIVELY
 * being edited (contenteditable) stays edit-only, so selecting text never moves
 * the zone.
 *
 * Mutation check: restore the unconditional early return and test 1 fails.
 */
import { render, fireEvent } from '@testing-library/react';
import type { Zone } from '../types';

jest.mock('next/dynamic', () => () => function WidgetPreviewStub() {
  return (
    <div data-widget-content="stub">
      <span data-field="title" id="hot">Headline</span>
      <span data-field-jump="events" id="jump">Events</span>
    </div>
  );
});
jest.mock('@/components/ui/app-dialog', () => ({ appAlert: jest.fn() }));

import { BuilderZone } from '../BuilderZone';

const zone = (): Zone => ({
  id: 'z1', templateId: 't', name: 'Calendar', widgetType: 'CALENDAR',
  x: 10, y: 10, width: 40, height: 30, zIndex: 1, defaultConfig: {},
} as unknown as Zone);

// jsdom has no PointerEvent; the handlers only read clientX/clientY + modifier keys.
beforeAll(() => { const w = window as unknown as { PointerEvent?: typeof MouseEvent }; w.PointerEvent = w.PointerEvent || MouseEvent; });

function mount() {
  const onPointerDown = jest.fn();
  const utils = render(
    <BuilderZone zone={zone()} selected={false} previewMode={false} onPointerDown={onPointerDown} onResizePointerDown={() => {}} onSelect={() => {}} onConfigChange={() => {}} />,
  );
  return { ...utils, onPointerDown };
}

describe('pressing a hotspot', () => {
  it('press on an IDLE [data-field-jump] + travel > 4px starts a move drag', () => {
    const { container, onPointerDown } = mount();
    const jump = container.querySelector('#jump') as HTMLElement;
    fireEvent.pointerDown(jump, { clientX: 100, clientY: 100, button: 0 });
    expect(onPointerDown).not.toHaveBeenCalled();                         // threshold not crossed yet
    fireEvent.pointerMove(window, { clientX: 112, clientY: 100 });
    expect(onPointerDown).toHaveBeenCalledTimes(1);
    expect(onPointerDown.mock.calls[0][1]).toBe('z1');
    expect(onPointerDown.mock.calls[0][2]).toBe('move');
    fireEvent.pointerUp(window);
  });

  it('press on an IDLE [data-field] behaves the same', () => {
    const { container, onPointerDown } = mount();
    fireEvent.pointerDown(container.querySelector('#hot') as HTMLElement, { clientX: 50, clientY: 50, button: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 60 });
    expect(onPointerDown).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(window);
  });

  it('press inside a field that is BEING EDITED never drags (text selection wins)', () => {
    const { container, onPointerDown } = mount();
    const hot = container.querySelector('#hot') as HTMLElement;
    hot.setAttribute('contenteditable', 'true');
    Object.defineProperty(hot, 'isContentEditable', { value: true });  // jsdom does not derive it
    fireEvent.pointerDown(hot, { clientX: 50, clientY: 50, button: 0 });
    fireEvent.pointerMove(window, { clientX: 90, clientY: 90 });
    expect(onPointerDown).not.toHaveBeenCalled();
    fireEvent.pointerUp(window);
  });

  it('a clean click (no travel) on a hotspot does not drag', () => {
    const { container, onPointerDown } = mount();
    const jump = container.querySelector('#jump') as HTMLElement;
    fireEvent.pointerDown(jump, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(window);
    fireEvent.click(jump);
    expect(onPointerDown).not.toHaveBeenCalled();
  });
});
