import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '../../../../test-mocks/pointer-event-polyfill';
import { PlaylistPreviewThumb } from '../PlaylistPreviewThumb';
import { TEMPLATE_HOVER_INTENT_MS } from '@/components/templates/TemplateContentThumb';

/**
 * What the playlist library's thumbnails (PlaylistPreviewThumb) do — pinned
 * against what origin/master did, because the hover-preview work moved logic
 * out of this file and the owner's rule is that the grid's slow rotation stays
 * EXACTLY what it was: 7 s a frame, a 900 ms cross-fade, at rest.
 *
 * The video poster / hover-to-play path has its own suite
 * (PlaylistPreviewThumb.poster.test.tsx); this one covers the rest.
 */

// The template branch: each instance reports how it was asked to render.
jest.mock('@/components/templates/ScaledTemplateThumbnail', () => ({
  ScaledTemplateThumbnail: ({ freeze, flush, maxHeight }: { freeze?: boolean; flush?: boolean; maxHeight?: number }) => (
    <span data-testid="board" data-frozen={String(!!freeze)} data-flush={String(!!flush)} data-max={String(maxHeight)} />
  ),
}));

const img = (id: string) => ({ id, originalName: `${id}.png`, fileUrl: `https://cdn.example.com/${id}.png`, mimeType: 'image/png' });
const site = (id: string, url: string) => ({ id, originalName: id, fileUrl: url, mimeType: 'text/html' });
const playlistOf = (assets: Array<Record<string, unknown>>) => ({
  id: 'p', name: 'Library playlist', items: assets.map((a, i) => ({ id: `i${i}`, assetId: a.id, asset: a, sequenceOrder: i, durationMs: 10_000 })),
});

// ── a controllable IntersectionObserver (the slideshow's own gate) ──────────
class FakeObserver {
  static all: FakeObserver[] = [];
  disconnected = false;
  constructor(private cb: IntersectionObserverCallback) { FakeObserver.all.push(this); }
  observe() {}
  unobserve() {}
  disconnect() { this.disconnected = true; }
  report(isIntersecting: boolean, ratio: number) {
    this.cb([{ isIntersecting, intersectionRatio: ratio } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}
const realObserver = global.IntersectionObserver;

function reducedMotion(on: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: on && query.includes('prefers-reduced-motion'), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
}

beforeEach(() => { jest.useFakeTimers(); FakeObserver.all = []; });
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  global.IntersectionObserver = realObserver;
  // @ts-expect-error — only defined by the reduced-motion cases
  delete window.matchMedia;
});

/** The slideshow's frames: absolutely-positioned wrappers, one per picture, opacity 1 on the one on show. */
const frames = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('div.absolute.top-0.right-0.bottom-0.left-0')).filter((d) => d.style.transition.includes('opacity'));
const onShow = (container: HTMLElement) => frames(container).findIndex((f) => f.style.opacity === '1');
const tick = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

describe('the image playlist slideshow — the one preview that moves at rest', () => {
  const three = playlistOf([img('a'), img('b'), img('c')]);

  it.each(['tile', 'list'] as const)('%s: rotates by itself every 7 s, cross-fading over 900 ms, with nothing hovered', (size) => {
    const { container } = render(<PlaylistPreviewThumb playlist={three} size={size} />);
    expect(frames(container)).toHaveLength(3);
    for (const frame of frames(container)) expect(frame.style.transition).toBe('opacity 900ms ease-in-out');
    expect(onShow(container)).toBe(0);

    tick(6999);
    expect(onShow(container)).toBe(0);
    tick(1);
    expect(onShow(container)).toBe(1);
    tick(7000);
    expect(onShow(container)).toBe(2);
    tick(7000);
    expect(onShow(container)).toBe(0); // and round again
  });

  it('is exactly one interval, started with no hover', () => {
    render(<PlaylistPreviewThumb playlist={three} />);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('a hover changes nothing about it — no second system, no pause, no speed-up', () => {
    const { container } = render(<PlaylistPreviewThumb playlist={three} />);
    const first = frames(container)[0];
    fireEvent.pointerEnter(first, { pointerType: 'mouse' });
    tick(7000);
    expect(onShow(container)).toBe(1);
    expect(container.querySelector('[data-image-sequence]')).toBeNull();
    expect(frames(container)).toHaveLength(3);
    fireEvent.pointerLeave(first);
    expect(onShow(container)).toBe(1);
  });

  it('shows only five frames and says how many more there are', () => {
    const seven = playlistOf(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(img));
    const { container } = render(<PlaylistPreviewThumb playlist={seven} />);
    expect(frames(container)).toHaveLength(5);
    expect(container.textContent).toContain('+2');
    expect(container.querySelectorAll('img')).toHaveLength(5);
  });

  it('five or fewer: no "+N"', () => {
    const { container } = render(<PlaylistPreviewThumb playlist={playlistOf(['a', 'b', 'c', 'd', 'e'].map(img))} />);
    expect(container.textContent).not.toContain('+');
  });

  it('under prefers-reduced-motion it does not rotate at all', () => {
    reducedMotion(true);
    const { container } = render(<PlaylistPreviewThumb playlist={three} />);
    expect(jest.getTimerCount()).toBe(0);
    tick(60_000);
    expect(onShow(container)).toBe(0);
  });

  it('pauses when scrolled out of view (under a quarter visible) and resumes when it is back', () => {
    global.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
    const { container } = render(<PlaylistPreviewThumb playlist={three} />);
    expect(jest.getTimerCount()).toBe(0); // not running until it is seen
    act(() => FakeObserver.all[0].report(true, 0.6));
    expect(jest.getTimerCount()).toBe(1);
    tick(7000);
    expect(onShow(container)).toBe(1);
    act(() => FakeObserver.all[0].report(true, 0.2)); // under 25 %
    expect(jest.getTimerCount()).toBe(0);
    tick(60_000);
    expect(onShow(container)).toBe(1);
    act(() => FakeObserver.all[0].report(true, 1));
    tick(7000);
    expect(onShow(container)).toBe(2);
  });

  it('unmounting leaves no timer or observer behind', () => {
    global.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
    const { unmount } = render(<PlaylistPreviewThumb playlist={three} />);
    act(() => FakeObserver.all[0].report(true, 1));
    expect(jest.getTimerCount()).toBe(1);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
    expect(FakeObserver.all[0].disconnected).toBe(true);
  });

  it('a single image is a plain frame: nothing rotates', () => {
    const { container } = render(<PlaylistPreviewThumb playlist={playlistOf([img('a')])} />);
    expect(frames(container)).toHaveLength(0);
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('img')!.className).toContain('object-contain');
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('a template playlist', () => {
  const template = { id: 't1', screenWidth: 1920, screenHeight: 1080, zones: [{ widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, defaultConfig: { url: '/templates/example.html' } }] };
  const templatePlaylist = { id: 'p', name: 'Welcome board', template, items: [] };
  const shell = (container: HTMLElement) => container.firstChild as HTMLElement;

  it('tile: the saved artwork at 180 px in the same framed card, in a uniform 16:9 box — as before', () => {
    const { container } = render(<PlaylistPreviewThumb playlist={templatePlaylist} size="tile" />);
    const board = screen.getByTestId('board');
    expect(board).toHaveAttribute('data-frozen', 'true');
    expect(board).toHaveAttribute('data-max', '180');
    expect(board).toHaveAttribute('data-flush', 'false'); // the bordered, rounded card it always drew
    expect(shell(container).style.aspectRatio).toBe('16 / 9');
  });

  it('list: the saved artwork at 40 px in the 56×40 strip — as before', () => {
    const { container } = render(<PlaylistPreviewThumb playlist={templatePlaylist} size="list" />);
    const board = screen.getByTestId('board');
    expect(board).toHaveAttribute('data-max', '40');
    expect(board).toHaveAttribute('data-flush', 'false');
    expect(shell(container).style.aspectRatio).toBe('');
    expect(shell(container).className).toContain('w-14');
    expect(shell(container).className).toContain('h-10');
  });

  it('is named, and does nothing at rest', () => {
    const { container } = render(<PlaylistPreviewThumb playlist={templatePlaylist} size="tile" />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Saved template preview of Welcome board');
    expect(screen.getAllByTestId('board')).toHaveLength(1);
    expect(container.querySelector('[data-template-live]')).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['tile', 'list'] as const)('%s: an intentional mouse hover runs the template live on top; leaving removes it; a tap does nothing', (size) => {
    const { container } = render(<PlaylistPreviewThumb playlist={templatePlaylist} size={size} />);
    const surface = container.querySelector('[data-template-preview]')!;
    fireEvent.pointerEnter(surface, { pointerType: 'touch' });
    act(() => { jest.advanceTimersByTime(TEMPLATE_HOVER_INTENT_MS); });
    expect(container.querySelector('[data-template-live]')).toBeNull();

    fireEvent.pointerEnter(surface, { pointerType: 'mouse' });
    act(() => { jest.advanceTimersByTime(TEMPLATE_HOVER_INTENT_MS); });
    const boards = screen.getAllByTestId('board');
    expect(boards).toHaveLength(2);
    expect(boards[1]).toHaveAttribute('data-frozen', 'false');
    expect(boards[1]).toHaveAttribute('data-max', size === 'tile' ? '180' : '40'); // same fit as the artwork underneath

    fireEvent.pointerLeave(surface);
    expect(screen.getAllByTestId('board')).toHaveLength(1);
  });

  it('a template that is only in the gallery lookup still draws', () => {
    const { container } = render(
      <PlaylistPreviewThumb
        playlist={{ id: 'p', name: 'Looked up', template: { id: 't9' }, items: [] }}
        templateLookup={{ t9: { zones: template.zones, screenWidth: 1920, screenHeight: 1080 } }}
        size="tile"
      />,
    );
    expect(screen.getByTestId('board')).toHaveAttribute('data-max', '180');
    expect(container.querySelector('svg.lucide-layout-template')).toBeNull();
  });

  it('a template with nothing to draw from falls back to the labelled icon tile', () => {
    const { container } = render(<PlaylistPreviewThumb playlist={{ id: 'p', name: 'Unknown', template: { id: 'gone' }, items: [] }} size="tile" />);
    expect(screen.queryByTestId('board')).toBeNull();
    expect(container.querySelector('svg.lucide-layout-template')).toBeTruthy();
    expect(container.textContent).toContain('Template');
  });
});

describe('a website playlist', () => {
  const shot = (url: string) => `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=640&h=360`;

  it.each(['tile', 'list'] as const)('%s: the screenshot of the first site, with the "+N" for the rest', (size) => {
    const { container } = render(<PlaylistPreviewThumb playlist={playlistOf([site('a', 'https://www.example.test'), site('b', 'https://two.example.test'), site('c', 'https://three.example.test')])} size={size} />);
    const picture = container.querySelector('img')!;
    expect(picture).toHaveAttribute('src', shot('https://www.example.test')); // the stored string, as before
    expect(picture.className).toContain('object-contain');
    expect(container.textContent).toContain('+2');
  });

  it('retries a screenshot that is still being taken exactly as it always did: 3 times, 1.5 s / 3 s / 4.5 s apart', () => {
    const { container } = render(<PlaylistPreviewThumb playlist={playlistOf([site('a', 'https://www.example.test')])} />);
    const src = () => container.querySelector('img')?.getAttribute('src') ?? '';
    for (const [n, delay] of [[1, 1500], [2, 3000], [3, 4500]] as const) {
      fireEvent.error(container.querySelector('img')!);
      tick(delay - 1);
      expect(src()).not.toContain(`retry=${n}`);
      tick(1);
      expect(src()).toContain(`retry=${n}`);
    }
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull(); // spent: the labelled globe, not a broken image
    expect(screen.getByRole('img')).toHaveAccessibleName('Website preview of a unavailable');
  });

  it('a private-network or credentialed address is never sent: the globe tile', () => {
    for (const url of ['http://192.168.0.10/', 'https://user:secret@example.test/', 'http://localhost:3000']) {
      const { container, unmount } = render(<PlaylistPreviewThumb playlist={playlistOf([site('a', url)])} />);
      expect(container.querySelector('img')).toBeNull();
      expect(container.innerHTML).not.toContain('secret');
      unmount();
    }
  });

  it('a website cell inside a mixed 2×2 grid is the same screenshot', () => {
    const { container } = render(<PlaylistPreviewThumb playlist={playlistOf([img('a'), site('b', 'https://www.example.test')])} />);
    const srcs = Array.from(container.querySelectorAll('img')).map((i) => i.getAttribute('src'));
    expect(srcs).toContain(shot('https://www.example.test'));
    expect(srcs.some((s) => (s ?? '').includes('/a.png'))).toBe(true);
  });
});
