import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '../../../../test-mocks/pointer-event-polyfill';
import {
  ImageSequenceThumb,
  IMAGE_PREVIEW_FADE_MS,
  IMAGE_PREVIEW_HOLD_MS,
  MAX_PREVIEW_FRAMES,
  initialSequence,
  pickNext,
  sequenceReducer,
  type SequenceEvent,
  type SequenceState,
} from '../ImageSequenceThumb';

/**
 * A playlist's first image at rest; a calm, bounded walk through its images on
 * a real mouse/pen hover. The owner's rules, as tests: nothing moves at rest,
 * 2.5 s a picture with a 300 ms fade (no fade under reduced motion), the whole
 * image, never more than two <img>, a picture that 404s is skipped (never a
 * loop), and leaving resets.
 */

const frame = (id: string) => ({ url: `https://cdn.example.test/${id}.png`, name: id });
const frames = ['a', 'b', 'c'].map(frame);
const NAME = 'Lobby slides';

const root = (container: HTMLElement) => container.querySelector('[data-image-sequence]') as HTMLElement;
const imgs = (container: HTMLElement) => Array.from(container.querySelectorAll('img'));
const standby = (container: HTMLElement) => container.querySelector('img[aria-hidden="true"]') as HTMLImageElement;
const shownIndex = (container: HTMLElement) => Number(root(container).getAttribute('data-preview-index'));
const hover = (container: HTMLElement, pointerType = 'mouse') => fireEvent.pointerEnter(root(container), { pointerType });
const unhover = (container: HTMLElement) => fireEvent.pointerLeave(root(container));
const tick = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });
/** The elements `addEventListener` was called ON (jest types `this` as void). */
const listenedOn = (spy: jest.SpyInstance) => spy.mock.instances as unknown as unknown[];
/** One whole step. The hold and the fade are separate acts on purpose: the fade
 *  timer is scheduled by the render the end of the hold causes, exactly as it is
 *  in a browser, where time passes between the two. */
const step = (container: HTMLElement) => {
  fireEvent.load(standby(container));
  tick(IMAGE_PREVIEW_HOLD_MS);
  tick(IMAGE_PREVIEW_FADE_MS);
};

function reducedMotion(on: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: on && query.includes('prefers-reduced-motion'), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
}

beforeEach(() => { jest.useFakeTimers(); reducedMotion(false); });
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  // @ts-expect-error — the suite defines matchMedia only for itself
  delete window.matchMedia;
});

describe('the owner’s numbers', () => {
  it('holds each picture 2.5 s and cross-fades for 300 ms, over at most 5 pictures', () => {
    expect(IMAGE_PREVIEW_HOLD_MS).toBe(2500);
    expect(IMAGE_PREVIEW_FADE_MS).toBe(300);
    expect(MAX_PREVIEW_FRAMES).toBe(5);
  });
});

describe('at rest', () => {
  it('shows the first picture whole, with no timer and no standby download', () => {
    const { container } = render(<ImageSequenceThumb frames={frames} name={NAME} />);
    expect(imgs(container)).toHaveLength(1);
    expect(imgs(container)[0]).toHaveAttribute('src', frames[0].url);
    expect(imgs(container)[0].className).toContain('object-contain');
    expect(imgs(container)[0].className).not.toContain('object-cover');
    expect(jest.getTimerCount()).toBe(0);
    tick(60_000);
    expect(shownIndex(container)).toBe(0);
  });

  it('is named for the playlist, from the catalog', () => {
    render(<ImageSequenceThumb frames={frames} name={NAME} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Scheduled image preview of Lobby slides');
  });

  it('is named even without a playlist name', () => {
    render(<ImageSequenceThumb frames={frames} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Scheduled image preview');
  });
});

describe('a mouse hover', () => {
  it('waits the full hold, fades for 300 ms, then shows the next picture — never more than two <img>', () => {
    const { container } = render(<ImageSequenceThumb frames={frames} />);
    hover(container);
    expect(imgs(container)).toHaveLength(2); // the one on show + the next, preloaded
    expect(standby(container)).toHaveAttribute('src', frames[1].url);
    expect(standby(container).style.opacity).toBe('0');
    fireEvent.load(standby(container));

    tick(IMAGE_PREVIEW_HOLD_MS - 1);
    expect(shownIndex(container)).toBe(0);
    expect(standby(container).style.opacity).toBe('0'); // still held
    tick(1);
    // The fade begins: the standby comes up over the picture on show.
    expect(standby(container).style.opacity).toBe('1');
    expect(standby(container).style.transition).toBe(`opacity ${IMAGE_PREVIEW_FADE_MS}ms ease-in-out`);
    expect(shownIndex(container)).toBe(0);
    expect(imgs(container)).toHaveLength(2);

    tick(IMAGE_PREVIEW_FADE_MS - 1);
    expect(shownIndex(container)).toBe(0);
    tick(1);
    expect(shownIndex(container)).toBe(1);
    expect(imgs(container)).toHaveLength(2); // b on show, c preloading
    expect(imgs(container)[0]).toHaveAttribute('src', frames[1].url);
    expect(standby(container)).toHaveAttribute('src', frames[2].url);
  });

  it('keeps stepping a, b, c, a… on the same 2.5 s hold', () => {
    const { container } = render(<ImageSequenceThumb frames={frames} />);
    hover(container);
    const seen: number[] = [];
    for (let n = 0; n < 4; n++) {
      step(container);
      seen.push(shownIndex(container));
      expect(imgs(container).length).toBeLessThanOrEqual(2);
    }
    expect(seen).toEqual([1, 2, 0, 1]);
  });

  it('never steps to a picture that has not loaded: the hold ends, it waits, and moves the moment the picture arrives', () => {
    const { container } = render(<ImageSequenceThumb frames={frames} />);
    hover(container);
    tick(IMAGE_PREVIEW_HOLD_MS + 5000); // a slow network: the hold is long over
    expect(shownIndex(container)).toBe(0);
    expect(standby(container).style.opacity).toBe('0');
    fireEvent.load(standby(container));
    expect(standby(container).style.opacity).toBe('1'); // no second hold on top of the wait
    tick(IMAGE_PREVIEW_FADE_MS);
    expect(shownIndex(container)).toBe(1);
  });

  it('ignores a pointer that is a finger', () => {
    const { container } = render(<ImageSequenceThumb frames={frames} />);
    hover(container, 'touch');
    expect(imgs(container)).toHaveLength(1);
    tick(60_000);
    expect(shownIndex(container)).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a pen counts as a hover', () => {
    const { container } = render(<ImageSequenceThumb frames={frames} />);
    hover(container, 'pen');
    expect(imgs(container)).toHaveLength(2);
  });
});

describe('prefers-reduced-motion', () => {
  it('still steps on the same hold, but with no fade at all', () => {
    reducedMotion(true);
    const { container } = render(<ImageSequenceThumb frames={frames} />);
    hover(container);
    fireEvent.load(standby(container));
    tick(IMAGE_PREVIEW_HOLD_MS);
    // Straight to the next picture: no 300 ms in between, and no transition on any element.
    expect(shownIndex(container)).toBe(1);
    for (const img of imgs(container)) expect(img.style.transition === '' || img.style.transition === 'none').toBe(true);
    expect(jest.getTimerCount()).toBe(1); // only the next hold
  });

  it('keeps stepping — a, b, c, a — every 2.5 s, never stalling after the first step', () => {
    reducedMotion(true);
    const { container } = render(<ImageSequenceThumb frames={frames} />);
    hover(container);
    const seen: number[] = [];
    for (let n = 0; n < 4; n++) {
      fireEvent.load(standby(container));
      tick(IMAGE_PREVIEW_HOLD_MS);
      seen.push(shownIndex(container));
    }
    expect(seen).toEqual([1, 2, 0, 1]);
  });
});

describe('leaving', () => {
  it('mid-hold: back to the first picture, one <img>, no timer', () => {
    const { container } = render(<ImageSequenceThumb frames={frames} />);
    hover(container);
    step(container);
    expect(shownIndex(container)).toBe(1);
    unhover(container);
    expect(shownIndex(container)).toBe(0);
    expect(imgs(container)).toHaveLength(1);
    expect(imgs(container)[0]).toHaveAttribute('src', frames[0].url);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('mid-fade: nothing finishes later — the pending fade timer is gone', () => {
    const { container } = render(<ImageSequenceThumb frames={frames} />);
    hover(container);
    fireEvent.load(standby(container));
    tick(IMAGE_PREVIEW_HOLD_MS);
    expect(standby(container).style.opacity).toBe('1');
    unhover(container);
    expect(jest.getTimerCount()).toBe(0);
    tick(10_000);
    expect(shownIndex(container)).toBe(0);
    expect(imgs(container)).toHaveLength(1);
  });

  it('mid-load, then hover again: a clean new run from the first picture', () => {
    const { container } = render(<ImageSequenceThumb frames={frames} />);
    hover(container);
    const firstStandby = standby(container);
    unhover(container); // the standby had not finished loading
    expect(imgs(container)).toHaveLength(1);
    hover(container);
    expect(standby(container)).not.toBe(firstStandby); // a fresh element: no stale load flag
    expect(standby(container)).toHaveAttribute('src', frames[1].url);
    // A late `load` from the element that was removed must change nothing.
    fireEvent.load(firstStandby);
    tick(IMAGE_PREVIEW_HOLD_MS);
    expect(shownIndex(container)).toBe(0);
    expect(standby(container).style.opacity).toBe('0');
    fireEvent.load(standby(container));
    tick(IMAGE_PREVIEW_FADE_MS);
    expect(shownIndex(container)).toBe(1);
  });

  it('after a full hover and leave, the first hover-less state is fully quiet', () => {
    const { container } = render(<ImageSequenceThumb frames={frames} />);
    for (let run = 0; run < 3; run++) {
      hover(container);
      fireEvent.load(standby(container));
      tick(IMAGE_PREVIEW_HOLD_MS);
      unhover(container);
      expect(jest.getTimerCount()).toBe(0);
      expect(imgs(container)).toHaveLength(1);
      expect(shownIndex(container)).toBe(0);
    }
  });
});

describe('it stops on its own, with the pointer still on it', () => {
  class FakeObserver {
    static all: FakeObserver[] = [];
    disconnected = false;
    constructor(private cb: IntersectionObserverCallback) { FakeObserver.all.push(this); }
    observe() {}
    unobserve() {}
    disconnect() { this.disconnected = true; }
    report(isIntersecting: boolean) { this.cb([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
  }

  it('when the tab is hidden: back to the first picture, one <img>, no timer', () => {
    const { container } = render(<ImageSequenceThumb frames={frames} />);
    hover(container);
    step(container);
    expect(shownIndex(container)).toBe(1);
    jest.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(shownIndex(container)).toBe(0);
    expect(imgs(container)).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('when it scrolls out of view under a parked cursor', () => {
    const real = global.IntersectionObserver;
    global.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
    try {
      const { container } = render(<ImageSequenceThumb frames={frames} />);
      hover(container);
      act(() => FakeObserver.all[0].report(true));
      step(container);
      expect(shownIndex(container)).toBe(1);
      act(() => FakeObserver.all[0].report(false));
      expect(shownIndex(container)).toBe(0);
      expect(imgs(container)).toHaveLength(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      global.IntersectionObserver = real;
    }
  });

  it('works under React StrictMode', () => {
    const { container } = render(<React.StrictMode><ImageSequenceThumb frames={frames} /></React.StrictMode>);
    hover(container);
    expect(imgs(container)).toHaveLength(2);
    step(container);
    expect(shownIndex(container)).toBe(1);
    unhover(container);
    expect(shownIndex(container)).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('a picture that will not load', () => {
  it('a standby that 404s is skipped and the next one is taken — and never asked for again', () => {
    const { container } = render(<ImageSequenceThumb frames={frames} />);
    hover(container);
    expect(standby(container)).toHaveAttribute('src', frames[1].url);
    fireEvent.error(standby(container));
    // b is gone for good; c is the standby now.
    expect(standby(container)).toHaveAttribute('src', frames[2].url);
    expect(imgs(container)).toHaveLength(2);

    // Two full laps: b must never come back.
    const srcs = new Set<string>();
    for (let n = 0; n < 6; n++) {
      step(container);
      imgs(container).forEach((img) => srcs.add(img.getAttribute('src') ?? ''));
    }
    expect(srcs.has(frames[1].url)).toBe(false);
    expect(srcs.has(frames[0].url) && srcs.has(frames[2].url)).toBe(true);
  });

  it('a hold that already ended moves on the moment the replacement standby loads', () => {
    const { container } = render(<ImageSequenceThumb frames={frames} />);
    hover(container);
    tick(IMAGE_PREVIEW_HOLD_MS + 1000);
    fireEvent.error(standby(container));
    fireEvent.load(standby(container)); // c
    expect(standby(container).style.opacity).toBe('1');
    tick(IMAGE_PREVIEW_FADE_MS);
    expect(shownIndex(container)).toBe(2);
  });

  it('when every other picture fails it stays on the first — no timer, no loop', () => {
    const { container } = render(<ImageSequenceThumb frames={frames} />);
    hover(container);
    fireEvent.error(standby(container)); // b
    fireEvent.error(standby(container)); // c
    expect(imgs(container)).toHaveLength(1);
    expect(shownIndex(container)).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    tick(60_000);
    expect(shownIndex(container)).toBe(0);
  });

  it('a first picture that fails shows nothing, and hovering still walks on to the next', () => {
    const { container } = render(<ImageSequenceThumb frames={frames} />);
    fireEvent.error(imgs(container)[0]);
    expect(imgs(container)).toHaveLength(0);
    hover(container);
    step(container);
    expect(shownIndex(container)).toBe(1);
    expect(imgs(container).map((i) => i.getAttribute('src'))).not.toContain(frames[0].url);
  });

  it('is not fooled by the app-wide transform fallback: its retry is not a failure, a second error is', () => {
    const { container } = render(<ImageSequenceThumb frames={frames} />);
    hover(container);
    const first = standby(container);
    // asset-image.ts has already pointed the failed render URL back at the original file.
    first.dataset.thumbFallback = '1';
    fireEvent.error(first);
    expect(standby(container)).toBe(first); // still waiting on the retry
    expect(standby(container)).toHaveAttribute('src', frames[1].url);
    fireEvent.error(first); // the original failed too
    expect(standby(container)).toHaveAttribute('src', frames[2].url);
  });
});

describe('one picture, or none: nothing to run', () => {
  it('a single image is a plain still: no listener, no observer, no timer', () => {
    const add = jest.spyOn(HTMLElement.prototype, 'addEventListener');
    const observed = jest.fn();
    const real = global.IntersectionObserver;
    global.IntersectionObserver = class { constructor() { observed(); } observe() {} disconnect() {} unobserve() {} } as unknown as typeof IntersectionObserver;
    try {
      const { container } = render(<ImageSequenceThumb frames={[frames[0]]} name={NAME} />);
      expect(imgs(container)).toHaveLength(1);
      // React's own root listeners are not ours: what matters is that the
      // thumbnail ITSELF gets none.
      const thumb = container.firstChild;
      expect(listenedOn(add).filter((target) => target === thumb)).toHaveLength(0);
      expect(observed).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
      fireEvent.pointerEnter(container.firstChild as Element, { pointerType: 'mouse' });
      expect(imgs(container)).toHaveLength(1);
      expect(screen.getByRole('img')).toHaveAccessibleName('Scheduled image preview of Lobby slides');
    } finally {
      global.IntersectionObserver = real;
    }
  });

  it('several images do take the hover listeners (so the single-image case above is a real difference)', () => {
    const add = jest.spyOn(HTMLElement.prototype, 'addEventListener');
    const { container } = render(<ImageSequenceThumb frames={frames} />);
    const thumb = container.firstChild;
    const own = add.mock.calls.filter((_call, i) => listenedOn(add)[i] === thumb).map(([type]) => type);
    expect(own).toEqual(['pointerenter', 'pointerleave', 'pointercancel']);
  });

  it('a single image is not hidden by the first error when the transform fallback is retrying it; the second error hides it', () => {
    const { container } = render(<ImageSequenceThumb frames={[frames[0]]} />);
    const only = imgs(container)[0];
    only.dataset.thumbFallback = '1'; // asset-image.ts has already pointed it back at the original file
    fireEvent.error(only);
    expect(only.style.visibility).not.toBe('hidden');
    fireEvent.error(only); // the original failed too
    expect(only.style.visibility).toBe('hidden');
  });

  it('no pictures: an empty, still-named tile', () => {
    const { container } = render(<ImageSequenceThumb frames={[]} name={NAME} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('frames without a URL are ignored, so one real image beside a blank is still a plain still', () => {
    const { container } = render(<ImageSequenceThumb frames={[{ url: '' }, frames[0]]} />);
    expect(imgs(container)).toHaveLength(1);
    expect(root(container)).toBeNull(); // not a sequence
  });
});

describe('the set of pictures changing', () => {
  it('while hovered: starts over — first picture, one <img>, no timer from the old run', () => {
    const { container, rerender } = render(<ImageSequenceThumb frames={frames} />);
    hover(container);
    step(container);
    expect(shownIndex(container)).toBe(1);
    rerender(<ImageSequenceThumb frames={['x', 'y'].map(frame)} />);
    expect(shownIndex(container)).toBe(0);
    expect(imgs(container)).toHaveLength(1);
    expect(imgs(container)[0]).toHaveAttribute('src', frame('x').url);
    expect(jest.getTimerCount()).toBe(0);
    tick(60_000);
    expect(shownIndex(container)).toBe(0);
  });

  it('the same pictures in a new array change nothing', () => {
    const { container, rerender } = render(<ImageSequenceThumb frames={frames} />);
    hover(container);
    const first = imgs(container)[0];
    rerender(<ImageSequenceThumb frames={frames.map((f) => ({ ...f }))} />);
    expect(imgs(container)[0]).toBe(first);
    expect(imgs(container)).toHaveLength(2);
  });

  it('shrinking to one picture becomes a plain still', () => {
    const { container, rerender } = render(<ImageSequenceThumb frames={frames} />);
    hover(container);
    rerender(<ImageSequenceThumb frames={[frames[0]]} />);
    expect(root(container)).toBeNull();
    expect(imgs(container)).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('unmounting', () => {
  it.each([
    ['during the hold', IMAGE_PREVIEW_HOLD_MS - 100, false],
    ['during the fade', IMAGE_PREVIEW_HOLD_MS + 100, true],
  ])('%s leaves no timer behind', (_label, ms, loaded) => {
    const { container, unmount } = render(<ImageSequenceThumb frames={frames} />);
    hover(container);
    if (loaded) fireEvent.load(standby(container));
    tick(ms);
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('a long playlist', () => {
  it('walks at most five pictures, and draws nothing over any of them — no count badge on a thumbnail that can be 28 px wide', () => {
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(frame);
    const { container } = render(<ImageSequenceThumb frames={seven} />);
    expect(container.textContent).toBe('');
    hover(container);
    const seen = new Set<string>();
    for (let n = 0; n < 12; n++) {
      step(container);
      imgs(container).forEach((i) => seen.add(i.getAttribute('src') ?? ''));
      expect(container.textContent).toBe('');
    }
    expect(seen.size).toBe(MAX_PREVIEW_FRAMES);
  });
});

// ── the state machine on its own ────────────────────────────────────────────
describe('sequenceReducer', () => {
  const run = (state: SequenceState, ...events: SequenceEvent[]) => events.reduce(sequenceReducer, state);
  const keyOfNext = (state: SequenceState) => state.nextKey as string;

  it('pickNext walks forward, wraps, and skips what failed', () => {
    expect(pickNext(0, 3, [])).toBe(1);
    expect(pickNext(2, 3, [])).toBe(0);
    expect(pickNext(0, 3, [1])).toBe(2);
    expect(pickNext(0, 4, [1, 2])).toBe(3);
    expect(pickNext(0, 3, [1, 2])).toBeNull();
    expect(pickNext(0, 1, [])).toBeNull();
  });

  it('start is idempotent, and a run begins at the first picture with a fresh standby', () => {
    const started = run(initialSequence(3), { type: 'start' });
    expect(started).toMatchObject({ running: true, active: 0, next: 1, nextReady: false, holdDone: false, fading: false });
    expect(sequenceReducer(started, { type: 'start' })).toBe(started);
  });

  it('a hold that ends before the standby is ready only records the hold; the load then steps at once', () => {
    let state = run(initialSequence(3), { type: 'start' }, { type: 'holdElapsed', reduced: false });
    expect(state).toMatchObject({ holdDone: true, fading: false, nextReady: false });
    state = sequenceReducer(state, { type: 'loaded', key: keyOfNext(state), reduced: false });
    expect(state.fading).toBe(true);
  });

  it('a load that arrives before the hold ends is remembered; the hold then steps', () => {
    let state = run(initialSequence(3), { type: 'start' });
    state = sequenceReducer(state, { type: 'loaded', key: keyOfNext(state), reduced: false });
    expect(state).toMatchObject({ nextReady: true, fading: false });
    state = sequenceReducer(state, { type: 'holdElapsed', reduced: false });
    expect(state.fading).toBe(true);
  });

  it('reduced motion steps straight to the next picture — never through a fade', () => {
    let state = run(initialSequence(3), { type: 'start' }, { type: 'holdElapsed', reduced: true });
    state = sequenceReducer(state, { type: 'loaded', key: keyOfNext(state), reduced: true });
    expect(state).toMatchObject({ active: 1, fading: false, next: 2, nextReady: false, holdDone: false });
  });

  it('a stale load (an element that is no longer the standby) changes nothing', () => {
    const state = run(initialSequence(3), { type: 'start' });
    expect(sequenceReducer(state, { type: 'loaded', key: '2.99', reduced: false })).toBe(state);
  });

  it('every standby is a fresh element, so a 2-picture loop can never wait on a `load` that will not fire', () => {
    let state = run(initialSequence(2), { type: 'start' });
    const keys = new Set<string>([state.activeKey, keyOfNext(state)]);
    for (let step = 0; step < 6; step++) {
      state = run(state, { type: 'loaded', key: keyOfNext(state), reduced: true }, { type: 'holdElapsed', reduced: true });
      expect(keys.has(keyOfNext(state))).toBe(false);
      keys.add(keyOfNext(state));
    }
  });

  it('a failed standby is skipped for good — over many laps it never becomes the picture on show', () => {
    let state = run(initialSequence(4), { type: 'start' });
    state = sequenceReducer(state, { type: 'failed', key: keyOfNext(state) }); // picture 1
    expect(state.failed).toEqual([1]);
    const shown: number[] = [];
    for (let step = 0; step < 12; step++) {
      state = run(state, { type: 'loaded', key: keyOfNext(state), reduced: true }, { type: 'holdElapsed', reduced: true });
      shown.push(state.active);
    }
    expect(shown).not.toContain(1);
    expect(new Set(shown)).toEqual(new Set([0, 2, 3]));
  });

  it('when nothing is left it has no standby: no timer wanted, no loop', () => {
    let state = run(initialSequence(3), { type: 'start' });
    state = sequenceReducer(state, { type: 'failed', key: keyOfNext(state) });
    state = sequenceReducer(state, { type: 'failed', key: keyOfNext(state) });
    expect(state.next).toBeNull();
    expect(state.nextKey).toBeNull();
    expect(sequenceReducer(state, { type: 'holdElapsed', reduced: false }).fading).toBe(false);
  });

  it('a failure of the picture on show is remembered but does not disturb the standby', () => {
    const state = run(initialSequence(3), { type: 'start' });
    const after = sequenceReducer(state, { type: 'failed', key: state.activeKey });
    expect(after.failed).toEqual([0]);
    expect(after.next).toBe(state.next);
    expect(after.nextKey).toBe(state.nextKey);
  });

  it('stop returns to the first picture, remembers what failed, and keeps the element when it is already showing', () => {
    const atRest = run(initialSequence(3), { type: 'start' });
    const stopped = sequenceReducer(atRest, { type: 'stop' });
    expect(stopped).toMatchObject({ running: false, active: 0, next: null, activeKey: atRest.activeKey });

    let later = run(atRest, { type: 'failed', key: keyOfNext(atRest) }, { type: 'loaded', key: '2.2', reduced: true });
    later = run(later, { type: 'loaded', key: keyOfNext(later), reduced: true }, { type: 'holdElapsed', reduced: true });
    expect(later.active).toBe(2);
    const reset = sequenceReducer(later, { type: 'stop' });
    expect(reset).toMatchObject({ running: false, active: 0, next: null, fading: false, holdDone: false });
    expect(reset.activeKey).not.toBe(later.activeKey); // a new element for the first picture
    expect(reset.failed).toEqual([1]);
  });

  it('events that mean nothing outside a run are ignored', () => {
    const rest = initialSequence(3);
    expect(sequenceReducer(rest, { type: 'holdElapsed', reduced: false })).toBe(rest);
    expect(sequenceReducer(rest, { type: 'faded' })).toBe(rest);
    expect(sequenceReducer(rest, { type: 'loaded', key: '1.1', reduced: false })).toBe(rest);
  });
});
