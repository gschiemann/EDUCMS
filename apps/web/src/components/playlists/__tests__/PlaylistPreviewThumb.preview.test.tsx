import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '../../../../test-mocks/pointer-event-polyfill';
import { PlaylistPreviewThumb, nextArrivedFrame } from '../PlaylistPreviewThumb';
import { TEMPLATE_HOVER_INTENT_MS } from '@/components/templates/TemplateContentThumb';

/**
 * What the playlist library's thumbnails (PlaylistPreviewThumb) do.
 *
 * AT REST the grid's rotation is EXACTLY what it always was — 7 s a frame, a
 * 900 ms cross-fade — because the owner's 2026-09-16 rule is that many
 * thumbnails moving on a page gave him a headache. Those numbers are literals in
 * the tests below on purpose: a constant changed in the component must not be
 * able to pass its own test.
 *
 * UNDER THE POINTER it is quick (2026-10-04, the owner: "when you hover and
 * preview content ... it should preview faster. its waiting the full 10 sec"):
 * the ONE thumbnail a mouse/pen pointer has rested on (350 ms) steps at once,
 * then holds each picture 1.2 s with a 250 ms fade, and leaving hands it back to
 * the slow rotation on the picture it is showing.
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

/** The slideshow's frames: absolutely-positioned wrappers, one per picture, opacity 1 on the one on show.
 *  Found by their inline opacity — only the slideshow sets one — so a frame is still a frame
 *  whatever transition it carries (900 ms at rest, 250 ms under the pointer, none under reduced motion). */
const frames = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('div.absolute.top-0.right-0.bottom-0.left-0')).filter((d) => d.style.opacity === '0' || d.style.opacity === '1');
const onShow = (container: HTMLElement) => frames(container).findIndex((f) => f.style.opacity === '1');
const tick = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });
/** The slideshow itself: what the frames sit in — the element the pointer lands on. */
const slideshow = (container: HTMLElement) => frames(container)[0].parentElement as HTMLElement;
const pointerOn = (el: Element, pointerType = 'mouse') => fireEvent.pointerEnter(el, { pointerType });
const pointerOff = (el: Element) => fireEvent.pointerLeave(el);
/** Every frame's picture has arrived — what the quick walk needs before it will step to one. */
const picturesArrive = (container: HTMLElement, only?: number[]) => container.querySelectorAll('img').forEach((img, i) => { if (!only || only.includes(i)) fireEvent.load(img); });
/** Every transition the frames carry (one value if they all agree). */
const transitions = (container: HTMLElement) => Array.from(new Set(frames(container).map((f) => f.style.transition)));

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

  it('a hover that has not rested yet changes nothing about it — no second system, no pause, no speed-up', () => {
    const { container } = render(<PlaylistPreviewThumb playlist={three} />);
    const root = slideshow(container);
    pointerOn(root);
    tick(300); // still crossing it, not pointing at it
    expect(container.querySelector('[data-image-sequence]')).toBeNull(); // never a second preview system in the grid
    expect(frames(container)).toHaveLength(3);
    expect(transitions(container)).toEqual(['opacity 900ms ease-in-out']);
    expect(onShow(container)).toBe(0);
    pointerOff(root);
    tick(6699);
    expect(onShow(container)).toBe(0);
    tick(1); // 7 s after the page drew it — the pointer's visit moved nothing
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

describe('the image playlist slideshow — QUICK under a resting pointer', () => {
  const three = playlistOf([img('a'), img('b'), img('c')]);
  const REST = 'opacity 900ms ease-in-out';
  const QUICK = 'opacity 250ms ease-in-out';

  it('steps to the second picture as soon as the pointer has rested 350 ms, cross-fading over 250 ms', () => {
    const { container } = render(<PlaylistPreviewThumb playlist={three} />);
    picturesArrive(container);
    pointerOn(slideshow(container));
    tick(349);
    expect(onShow(container)).toBe(0);
    expect(transitions(container)).toEqual([REST]); // not quick until the pointer has really rested
    tick(1);
    expect(onShow(container)).toBe(1);
    expect(transitions(container)).toEqual([QUICK]);
  });

  it('then holds each picture 1.2 s before the next 250 ms fade — a new picture every 1.45 s, round and round', () => {
    const { container } = render(<PlaylistPreviewThumb playlist={three} />);
    picturesArrive(container);
    pointerOn(slideshow(container));
    tick(350);
    expect(onShow(container)).toBe(1);
    tick(1449);
    expect(onShow(container)).toBe(1);
    tick(1);
    expect(onShow(container)).toBe(2);
    tick(1450);
    expect(onShow(container)).toBe(0);
    tick(1450);
    expect(onShow(container)).toBe(1);
  });

  it('while a pointer rests on it, ONLY the quick walk runs — the slow 7 s interval is not ticking alongside it', () => {
    const { container } = render(<PlaylistPreviewThumb playlist={three} />);
    picturesArrive(container);
    expect(jest.getTimerCount()).toBe(1); // at rest: the slow interval
    pointerOn(slideshow(container));
    tick(350);
    expect(onShow(container)).toBe(1);
    expect(jest.getTimerCount()).toBe(1); // under the pointer: the quick walk's timer, and nothing else
  });

  it('over a long rest, a step lands exactly every 1.45 s — the slow clock adds no steps of its own', () => {
    const { container } = render(<PlaylistPreviewThumb playlist={three} />);
    picturesArrive(container);
    pointerOn(slideshow(container));
    // 50 ms at a time, so React flushes between timers as a browser does (one big advance batches a stray step away).
    const changes: number[] = [];
    let last = onShow(container);
    for (let t = 50; t <= 16_000; t += 50) {
      tick(50);
      const now = onShow(container);
      if (now !== last) { changes.push(t); last = now; }
    }
    expect(changes).toEqual([350, 1800, 3250, 4700, 6150, 7600, 9050, 10_500, 11_950, 13_400, 14_850]);
  });

  it.each(['tile', 'list'] as const)('%s: is the same quick walk', (size) => {
    const { container } = render(<PlaylistPreviewThumb playlist={three} size={size} />);
    picturesArrive(container);
    pointerOn(slideshow(container));
    tick(350);
    expect(onShow(container)).toBe(1);
    expect(transitions(container)).toEqual([QUICK]);
  });

  it('a pen counts as a pointer', () => {
    const { container } = render(<PlaylistPreviewThumb playlist={three} />);
    picturesArrive(container);
    pointerOn(slideshow(container), 'pen');
    tick(350);
    expect(onShow(container)).toBe(1);
  });

  it('says so on itself: rest → quick → rest, and which picture is on show', () => {
    const { container } = render(<PlaylistPreviewThumb playlist={three} />);
    picturesArrive(container);
    const root = slideshow(container);
    expect(root.getAttribute('data-preview-state')).toBe('rest');
    expect(root.getAttribute('data-preview-index')).toBe('0');
    pointerOn(root);
    tick(350);
    expect(root.getAttribute('data-preview-state')).toBe('quick');
    expect(root.getAttribute('data-preview-index')).toBe('1');
    pointerOff(root);
    expect(root.getAttribute('data-preview-state')).toBe('rest');
    expect(root.getAttribute('data-preview-index')).toBe('1'); // it stays on the picture it was showing
  });

  describe('a pointer that is only crossing it', () => {
    it('leaving before 350 ms changes nothing: the slow rotation carries on as if the pointer had never been there', () => {
      const { container } = render(<PlaylistPreviewThumb playlist={three} />);
      picturesArrive(container);
      const root = slideshow(container);
      pointerOn(root);
      tick(300);
      expect(onShow(container)).toBe(0);
      pointerOff(root);
      expect(onShow(container)).toBe(0);
      expect(transitions(container)).toEqual([REST]);
      expect(jest.getTimerCount()).toBe(1); // the one slow interval, exactly as at rest
      tick(6699);
      expect(onShow(container)).toBe(0);
      tick(1);
      expect(onShow(container)).toBe(1); // 7 s from the page drawing it — the visit did not restart the clock
    });

    it('crossing and re-entering restarts the 350 ms rest every time', () => {
      const { container } = render(<PlaylistPreviewThumb playlist={three} />);
      picturesArrive(container);
      const root = slideshow(container);
      for (let pass = 0; pass < 3; pass++) {
        pointerOn(root);
        tick(349);
        pointerOff(root);
      }
      expect(onShow(container)).toBe(0);
      pointerOn(root);
      tick(350);
      expect(onShow(container)).toBe(1);
    });
  });

  describe('leaving it', () => {
    it('mid-hold: stays on the picture it is showing (never back to the first), and the slow 7 s rotation resumes from there', () => {
      const { container } = render(<PlaylistPreviewThumb playlist={three} />);
      picturesArrive(container);
      const root = slideshow(container);
      pointerOn(root);
      tick(350); // separate ticks: a browser flushes React between timers, one big advance does not
      tick(1450);
      expect(onShow(container)).toBe(2);
      pointerOff(root);
      expect(onShow(container)).toBe(2);
      expect(transitions(container)).toEqual([REST]); // back to the slow cross-fade
      expect(jest.getTimerCount()).toBe(1); // only the slow interval; the quick walk is gone
      tick(6999);
      expect(onShow(container)).toBe(2);
      tick(1);
      expect(onShow(container)).toBe(0);
    });

    it('mid-fade: settles on the picture being shown instead of jumping back, and carries on slowly', () => {
      const { container } = render(<PlaylistPreviewThumb playlist={three} />);
      picturesArrive(container);
      const root = slideshow(container);
      pointerOn(root);
      tick(350); // the fade to the second picture has just begun
      expect(onShow(container)).toBe(1);
      tick(100);
      pointerOff(root);
      expect(onShow(container)).toBe(1);
      tick(6999);
      expect(onShow(container)).toBe(1);
      tick(1);
      expect(onShow(container)).toBe(2); // slowly on from where it was, never snapped back to the first
      expect(jest.getTimerCount()).toBe(1);
    });

    it('leaves no quick timer behind: the walk does not keep stepping a thumbnail nobody is pointing at', () => {
      const { container } = render(<PlaylistPreviewThumb playlist={three} />);
      picturesArrive(container);
      const root = slideshow(container);
      pointerOn(root);
      tick(350);
      pointerOff(root);
      const after = onShow(container);
      tick(1450); // far less than the slow 7 s: a surviving quick timer would have stepped
      tick(1450);
      expect(onShow(container)).toBe(after);
    });

    it('when the tab is hidden: quick stops, the slow rotation resumes', () => {
      const { container } = render(<PlaylistPreviewThumb playlist={three} />);
      picturesArrive(container);
      pointerOn(slideshow(container));
      tick(350);
      expect(transitions(container)).toEqual([QUICK]);
      jest.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(transitions(container)).toEqual([REST]);
      expect(jest.getTimerCount()).toBe(1);
    });

    it('unmounting while it is quick leaves no timer behind', () => {
      const { container, unmount } = render(<PlaylistPreviewThumb playlist={three} />);
      picturesArrive(container);
      pointerOn(slideshow(container));
      tick(350 + 700);
      unmount();
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('a finger', () => {
    it('never makes it quick — a tap is not a hover', () => {
      const { container } = render(<PlaylistPreviewThumb playlist={three} />);
      picturesArrive(container);
      const root = slideshow(container);
      pointerOn(root, 'touch');
      tick(5000);
      expect(onShow(container)).toBe(0); // 5 s on: still the slow rotation (7 s), nothing quick
      expect(transitions(container)).toEqual([REST]);
      expect(root.getAttribute('data-preview-state')).toBe('rest');
      expect(jest.getTimerCount()).toBe(1);
      tick(2000);
      expect(onShow(container)).toBe(1); // the slow clock, untouched
    });
  });

  describe('prefers-reduced-motion', () => {
    it('does not rotate at rest (as before), steps on a resting pointer with no fade at all, and goes still again on leaving', () => {
      reducedMotion(true);
      const { container } = render(<PlaylistPreviewThumb playlist={three} />);
      picturesArrive(container);
      expect(jest.getTimerCount()).toBe(0);
      const root = slideshow(container);
      pointerOn(root);
      tick(350);
      expect(onShow(container)).toBe(1);
      expect(transitions(container)).toEqual(['none']); // it steps; it never fades
      tick(1450);
      expect(onShow(container)).toBe(2);
      pointerOff(root);
      expect(onShow(container)).toBe(2);
      expect(jest.getTimerCount()).toBe(0); // no rotation at all, as before
      tick(60_000);
      expect(onShow(container)).toBe(2);
    });
  });

  describe('a picture that has not arrived', () => {
    it('is never stepped to: the walk holds on what is showing, and moves the moment the picture arrives', () => {
      const { container } = render(<PlaylistPreviewThumb playlist={three} />);
      pointerOn(slideshow(container));
      tick(350 + 5000); // a slow network: nothing has arrived
      expect(onShow(container)).toBe(0);
      picturesArrive(container, [1]);
      expect(onShow(container)).toBe(1); // no second hold on top of the wait
      expect(transitions(container)).toEqual([QUICK]);
    });

    it('one still on its way is passed over, not waited for — the walk shows what has arrived, and takes the latecomer in once it has', () => {
      const { container } = render(<PlaylistPreviewThumb playlist={three} />);
      picturesArrive(container, [0, 1]); // c is still on its way
      pointerOn(slideshow(container));
      tick(350);
      expect(onShow(container)).toBe(1);
      tick(1450);
      expect(onShow(container)).toBe(0); // c is never on show while it is still loading
      tick(1450);
      expect(onShow(container)).toBe(1);
      picturesArrive(container, [2]); // c arrives while b is held: the hold is not hurried
      expect(onShow(container)).toBe(1);
      tick(1449);
      expect(onShow(container)).toBe(1);
      tick(1);
      expect(onShow(container)).toBe(2); // and now it is part of the walk
    });

    it('one that never arrives (a broken file) is skipped, not waited for', () => {
      const { container } = render(<PlaylistPreviewThumb playlist={three} />);
      picturesArrive(container, [0, 2]); // b is broken
      pointerOn(slideshow(container));
      tick(350);
      expect(onShow(container)).toBe(2);
      tick(1450);
      expect(onShow(container)).toBe(0);
      tick(1450);
      expect(onShow(container)).toBe(2);
    });

    it('leaving while it waits leaves nothing behind: a picture arriving afterwards moves nothing', () => {
      const { container } = render(<PlaylistPreviewThumb playlist={three} />);
      const root = slideshow(container);
      pointerOn(root);
      tick(350 + 2000); // waiting on a picture
      pointerOff(root);
      picturesArrive(container, [1, 2]);
      expect(onShow(container)).toBe(0);
      expect(jest.getTimerCount()).toBe(1); // the slow interval only
    });
  });

  describe('a long playlist', () => {
    it('loops the same five pictures however long the pointer rests — it never reaches a sixth or seventh', () => {
      const seven = playlistOf(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(img));
      const { container } = render(<PlaylistPreviewThumb playlist={seven} />);
      expect(frames(container)).toHaveLength(5);
      picturesArrive(container);
      pointerOn(slideshow(container));
      tick(350);
      const order = [onShow(container)];
      for (let n = 0; n < 10; n++) { tick(1450); order.push(onShow(container)); }
      expect(order).toEqual([1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1]);
      expect(frames(container)).toHaveLength(5);
      expect(container.textContent).toContain('+2');
    });
  });

  describe('a pointer that lands in the middle of a slow fade', () => {
    it('lets that fade finish before its first quick step, so two fades never cut across each other', () => {
      const { container } = render(<PlaylistPreviewThumb playlist={three} />);
      picturesArrive(container);
      tick(7000); // the slow rotation just began its 900 ms fade to the second picture
      expect(onShow(container)).toBe(1);
      pointerOn(slideshow(container));
      tick(350); // the pointer has rested — but the slow fade has 550 ms left
      expect(onShow(container)).toBe(1);
      tick(549);
      expect(onShow(container)).toBe(1);
      tick(1);
      expect(onShow(container)).toBe(2);
    });
  });

  describe('one preview on the page at a time', () => {
    it('a second slideshow starting stops the first, which goes back to its slow rotation', () => {
      const { container } = render(<><PlaylistPreviewThumb playlist={three} /><PlaylistPreviewThumb playlist={playlistOf([img('x'), img('y'), img('z')])} /></>);
      picturesArrive(container);
      const roots = Array.from(new Set(frames(container).map((f) => f.parentElement as HTMLElement)));
      expect(roots).toHaveLength(2);
      const [first, second] = roots;
      pointerOn(first);
      tick(350);
      expect(first.getAttribute('data-preview-state')).toBe('quick');
      pointerOn(second); // no pointerleave on the first — the lost-event case
      tick(350);
      expect(first.getAttribute('data-preview-state')).toBe('rest');
      expect(second.getAttribute('data-preview-state')).toBe('quick');
    });
  });
});

describe('nextArrivedFrame — what the quick walk steps to', () => {
  const keys = ['a', 'b', 'c', 'd'];
  it('is the next frame that has arrived, walking forward and wrapping round', () => {
    expect(nextArrivedFrame(0, keys, new Set(['a', 'b', 'c', 'd']))).toBe(1);
    expect(nextArrivedFrame(3, keys, new Set(['a', 'b', 'c', 'd']))).toBe(0);
  });
  it('passes over a frame that has not arrived', () => {
    expect(nextArrivedFrame(0, keys, new Set(['a', 'c']))).toBe(2);
    expect(nextArrivedFrame(2, keys, new Set(['a', 'c']))).toBe(0);
    expect(nextArrivedFrame(1, keys, new Set(['a', 'b', 'd']))).toBe(3);
  });
  it('is null when nothing else has — the walk then holds, and never returns the frame already on show', () => {
    expect(nextArrivedFrame(0, keys, new Set(['a']))).toBeNull();
    expect(nextArrivedFrame(0, keys, new Set())).toBeNull();
    expect(nextArrivedFrame(0, ['a'], new Set(['a']))).toBeNull();
  });
});

describe('the other kinds of playlist are not touched by a hover', () => {
  it('a mixed 2×2 grid has no cycling of its own, and a hover starts nothing on it', () => {
    const { container } = render(<PlaylistPreviewThumb playlist={playlistOf([img('a'), img('b'), site('c', 'https://www.example.test')])} />);
    expect(frames(container)).toHaveLength(0);
    const grid = container.firstChild as HTMLElement;
    pointerOn(grid);
    tick(30_000);
    expect(jest.getTimerCount()).toBe(0);
    expect(container.querySelectorAll('img').length).toBeGreaterThan(0);
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
