import { act, fireEvent, render, waitFor } from '@testing-library/react';
import '../../../../test-mocks/pointer-event-polyfill';

/**
 * What a mocked ScaledTemplateThumbnail cannot show: that, with the REAL one,
 * the saved poster is genuinely still on the page — as the very same element —
 * while the live frame comes up on top of it, and after the hover ends. (Only
 * the widget catalog is stubbed; see frozen-gallery-thumbnail.test.tsx for why.)
 */
jest.mock('@/components/widgets/WidgetRenderer', () => ({
  WidgetPreview: (props: { freeze?: boolean }) => <iframe data-testid="live-frame" data-freeze={String(!!props.freeze)} title="board" />,
}));

import { TemplateContentThumb, TEMPLATE_HOVER_INTENT_MS } from '../TemplateContentThumb';

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: unknown }).ResizeObserver = (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

const posterBoard = {
  id: 'board',
  screenWidth: 1920,
  screenHeight: 1080,
  zones: [{ id: 'z1', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, defaultConfig: { url: '/templates/hs/front-desk-welcome.html' } }],
};
// An operator-customised board has no pristine poster to show: at rest it is a
// frozen live frame instead.
const customisedBoard = {
  ...posterBoard,
  zones: [{ ...posterBoard.zones[0], defaultConfig: { url: '/templates/hs/front-desk-welcome.html', brand: { primary: '#3515e8' } } }],
};

const surface = (container: HTMLElement) => container.querySelector('[data-template-preview]') as HTMLElement;
const hoverFor = async (container: HTMLElement) => {
  fireEvent.pointerEnter(surface(container), { pointerType: 'mouse' });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, TEMPLATE_HOVER_INTENT_MS + 50)); });
};

it('keeps the saved poster on the page, untouched, under the live frame — and after the hover', async () => {
  const { container } = render(<TemplateContentThumb template={posterBoard} name="Front desk" />);

  const poster = container.querySelector('[data-tpl-poster] img') as HTMLImageElement;
  expect(poster).toBeTruthy();
  expect(poster.getAttribute('src')).toMatch(/\/templates\/_thumbs\/hs\/front-desk-welcome\.png/);
  expect(container.querySelector('iframe')).toBeNull(); // at rest: a picture, no document

  await hoverFor(container);
  const frame = await waitFor(() => {
    const found = container.querySelector('[data-template-live] [data-testid="live-frame"]');
    if (!found) throw new Error('the live frame has not mounted yet');
    return found;
  });
  expect(frame).toHaveAttribute('data-freeze', 'false');
  // The saved artwork: the SAME <img>, still in its own thumbnail, outside the live layer.
  expect(container.querySelector('[data-tpl-poster] img')).toBe(poster);
  expect(poster.closest('[data-template-live]')).toBeNull();

  fireEvent.pointerLeave(surface(container));
  expect(container.querySelector('[data-template-live]')).toBeNull();
  expect(container.querySelector('[data-testid="live-frame"]')).toBeNull();
  expect(container.querySelector('[data-tpl-poster] img')).toBe(poster);
});

it('a customised board (no poster to show) keeps its frozen frame in place while the live one loads on top', async () => {
  const { container } = render(<TemplateContentThumb template={customisedBoard} name="Front desk" />);
  const frozen = await waitFor(() => {
    const found = container.querySelector('[data-testid="live-frame"]');
    if (!found) throw new Error('the frozen frame has not mounted yet');
    return found;
  });
  expect(frozen).toHaveAttribute('data-freeze', 'true');

  await hoverFor(container);
  const live = await waitFor(() => {
    const found = container.querySelector('[data-template-live] [data-testid="live-frame"]');
    if (!found) throw new Error('the live frame has not mounted yet');
    return found;
  });
  expect(live).toHaveAttribute('data-freeze', 'false');
  // The frozen frame was not reloaded or replaced to make way for it.
  const frames = Array.from(container.querySelectorAll('[data-testid="live-frame"]'));
  expect(frames).toHaveLength(2);
  expect(frames[0]).toBe(frozen);

  fireEvent.pointerLeave(surface(container));
  expect(Array.from(container.querySelectorAll('[data-testid="live-frame"]'))).toEqual([frozen]);
});
