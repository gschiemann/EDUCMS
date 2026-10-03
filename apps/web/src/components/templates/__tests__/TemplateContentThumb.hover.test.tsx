import { act, fireEvent, render, screen } from '@testing-library/react';
import '../../../../test-mocks/pointer-event-polyfill';
import { TemplateContentThumb, TEMPLATE_HOVER_INTENT_MS } from '../TemplateContentThumb';

/**
 * A template's saved artwork at rest; on an intentional hover, the template
 * itself, live — as a SEPARATE layer over the artwork, so there is never a
 * blank frame to flash to and leaving has nothing to reload.
 */

// A light stand-in for the real thumbnail: each instance says how it was asked
// to render, so the layering and the fit are observable.
jest.mock('../ScaledTemplateThumbnail', () => ({
  ScaledTemplateThumbnail: ({ freeze, flush, maxHeight }: { freeze?: boolean; flush?: boolean; maxHeight?: number }) => (
    <span data-testid="board" data-frozen={String(!!freeze)} data-flush={String(!!flush)} data-max={String(maxHeight)} />
  ),
}));

const template = { id: 'board', screenWidth: 1920, screenHeight: 1080, zones: [{ widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, defaultConfig: { url: '/templates/example.html' } }] };

const previousObserver = global.ResizeObserver;
beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver; });
afterAll(() => { global.ResizeObserver = previousObserver; });
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

const boards = () => screen.getAllByTestId('board');
const live = (root: Element) => root.querySelector('[data-template-live]');
const rest = (container: HTMLElement) => container.querySelector('[data-template-preview]') as HTMLElement;
const rest0 = (root: Element) => root.querySelector('[data-template-preview]') as HTMLElement;
const enter = (el: Element, pointerType = 'mouse') => fireEvent.pointerEnter(el, { pointerType });
const settle = () => act(() => { jest.advanceTimersByTime(TEMPLATE_HOVER_INTENT_MS); });

describe('at rest', () => {
  it('is only the saved artwork — one frozen render, no live layer, no timer', () => {
    const { container } = render(<TemplateContentThumb template={template} name="Welcome" />);
    expect(boards()).toHaveLength(1);
    expect(boards()[0]).toHaveAttribute('data-frozen', 'true');
    expect(rest(container)).toHaveAttribute('data-template-preview', 'rest');
    expect(live(container)).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('is named, from the catalog, as the saved preview of the template', () => {
    render(<TemplateContentThumb template={template} name="Welcome" />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Saved template preview of Welcome');
  });

  it('is named even without a name', () => {
    render(<TemplateContentThumb template={template} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Saved template preview');
  });
});

describe('a mouse hover', () => {
  it('mounts the live template as a second layer ON TOP of the untouched saved artwork', () => {
    const { container } = render(<TemplateContentThumb template={template} />);
    const artwork = boards()[0];
    enter(rest(container));
    settle();
    expect(rest(container)).toHaveAttribute('data-template-preview', 'live');
    expect(boards()).toHaveLength(2);
    // The saved artwork is the SAME element, still frozen: nothing replaced it.
    expect(boards()[0]).toBe(artwork);
    expect(boards()[0]).toHaveAttribute('data-frozen', 'true');
    // The live one is unfrozen, after it in the document (so on top), and can
    // never take the pointer (or the hover would end the moment it appeared).
    const layer = live(container) as HTMLElement;
    expect(layer.className).toContain('pointer-events-none');
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.querySelector('[data-testid="board"]')).toHaveAttribute('data-frozen', 'false');
    expect(artwork.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('leaving removes the live layer; the saved artwork was never touched, so there is nothing to reload', () => {
    const { container } = render(<TemplateContentThumb template={template} />);
    const artwork = boards()[0];
    enter(rest(container));
    settle();
    fireEvent.pointerLeave(rest(container));
    expect(live(container)).toBeNull();
    expect(boards()).toHaveLength(1);
    expect(boards()[0]).toBe(artwork);
    expect(rest(container)).toHaveAttribute('data-template-preview', 'rest');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('starts only after the pointer has rested; a cursor crossing the row mounts nothing', () => {
    const { container } = render(<TemplateContentThumb template={template} />);
    enter(rest(container));
    act(() => { jest.advanceTimersByTime(TEMPLATE_HOVER_INTENT_MS - 1); });
    expect(live(container)).toBeNull();
    fireEvent.pointerLeave(rest(container));
    act(() => { jest.advanceTimersByTime(5000); });
    expect(live(container)).toBeNull();
    expect(boards()).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a pen counts; a finger never does', () => {
    const { container } = render(<TemplateContentThumb template={template} />);
    enter(rest(container), 'touch');
    settle();
    expect(live(container)).toBeNull();
    enter(rest(container), 'pen');
    settle();
    expect(live(container)).not.toBeNull();
  });

  it('stops when the tab is hidden', () => {
    const { container } = render(<TemplateContentThumb template={template} />);
    enter(rest(container));
    settle();
    expect(live(container)).not.toBeNull();
    jest.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(live(container)).toBeNull();
    expect(boards()).toHaveLength(1);
  });

  it('unmounting while hovered leaves nothing running', () => {
    const { container, unmount } = render(<TemplateContentThumb template={template} />);
    enter(rest(container));
    settle();
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('a list with dozens of thumbnails', () => {
  it('has at most ONE live render at a time, wherever the cursor goes', () => {
    const { container } = render(<>{Array.from({ length: 40 }, (_, i) => <div key={i} data-row={i}><TemplateContentThumb template={template} name={`Board ${i}`} /></div>)}</>);
    const liveRows = () => Array.from(container.querySelectorAll('[data-row]')).filter((row) => live(row)).map((row) => Number(row.getAttribute('data-row')));
    expect(container.querySelectorAll('[data-testid="board"]')).toHaveLength(40); // at rest: 40 saved artworks, 0 live

    for (const row of [3, 9, 9, 22, 3, 39]) {
      enter(rest0(container.querySelector(`[data-row="${row}"]`)!));
      settle();
      expect(liveRows()).toEqual([row]);
      expect(container.querySelectorAll('[data-testid="board"]')).toHaveLength(41);
    }
  });

  it('a lost pointerleave on one row cannot leave two running', () => {
    const { container } = render(<>{[0, 1].map((i) => <div key={i} data-row={i}><TemplateContentThumb template={template} /></div>)}</>);
    const row = (i: number) => container.querySelector(`[data-row="${i}"]`)!;
    enter(rest0(row(0)));
    settle();
    enter(rest0(row(1))); // no pointerleave was ever delivered for row 0
    settle();
    expect(live(row(0))).toBeNull();
    expect(live(row(1))).not.toBeNull();
  });
});

describe('how the artwork is fitted', () => {
  it('by default: edge to edge (no frame of its own), fitted to the space it is placed in', () => {
    render(<TemplateContentThumb template={template} />);
    expect(boards()[0]).toHaveAttribute('data-flush', 'true');
    expect(boards()[0]).toHaveAttribute('data-max', '100'); // the measured frame (jsdom measures none)
  });

  it('a surface with its own look keeps it: a fixed height, framed — at rest AND in the live layer', () => {
    const { container } = render(<TemplateContentThumb template={template} maxHeight={180} framed />);
    expect(boards()[0]).toHaveAttribute('data-flush', 'false');
    expect(boards()[0]).toHaveAttribute('data-max', '180');
    enter(rest(container));
    settle();
    for (const board of boards()) {
      expect(board).toHaveAttribute('data-flush', 'false');
      expect(board).toHaveAttribute('data-max', '180');
    }
  });

  it('a fixed height needs no resize observer at all', () => {
    const observe = jest.fn();
    global.ResizeObserver = class { observe = observe; unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    try {
      render(<TemplateContentThumb template={template} maxHeight={40} />);
      expect(observe).not.toHaveBeenCalled();
    } finally {
      global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    }
  });
});
