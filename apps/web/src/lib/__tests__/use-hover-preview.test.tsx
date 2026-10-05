import React, { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '../../../test-mocks/pointer-event-polyfill';
import { useHoverPreview, type HoverPreviewOptions } from '../use-hover-preview';

/**
 * The shared rules for every hover preview: mouse/pen only, one at a time,
 * stops on leave / hidden tab / scrolled away, and nothing exists at rest.
 */

// ── a controllable IntersectionObserver ─────────────────────────────────────
class FakeObserver {
  static all: FakeObserver[] = [];
  disconnected = false;
  observed: Element[] = [];
  constructor(private cb: IntersectionObserverCallback) { FakeObserver.all.push(this); }
  observe(el: Element) { this.observed.push(el); }
  unobserve() {}
  disconnect() { this.disconnected = true; }
  report(isIntersecting: boolean) {
    this.cb([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

const realObserver = global.IntersectionObserver;
beforeEach(() => {
  FakeObserver.all = [];
  global.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
  jest.useFakeTimers();
});
afterEach(() => {
  global.IntersectionObserver = realObserver;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function Harness({ id, ...options }: { id: string } & HoverPreviewOptions) {
  const ref = useRef<HTMLSpanElement>(null);
  const active = useHoverPreview(ref, options);
  return <span ref={ref} data-testid={id} data-active={String(active)} />;
}
const el = (id: string) => screen.getByTestId(id);
const isActive = (id: string) => el(id).getAttribute('data-active') === 'true';
const enter = (id: string, pointerType = 'mouse') => fireEvent.pointerEnter(el(id), { pointerType });
const leave = (id: string) => fireEvent.pointerLeave(el(id));

describe('nothing exists at rest', () => {
  it('has no timer, no observer and no document listener until a hover begins', () => {
    const add = jest.spyOn(document, 'addEventListener');
    render(<><Harness id="a" /><Harness id="b" intentMs={250} /></>);
    expect(jest.getTimerCount()).toBe(0);
    expect(FakeObserver.all).toHaveLength(0);
    expect(add.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(0);
  });

  it('puts everything back when the hover ends', () => {
    const remove = jest.spyOn(document, 'removeEventListener');
    render(<Harness id="a" />);
    enter('a');
    expect(isActive('a')).toBe(true);
    expect(FakeObserver.all).toHaveLength(1);
    leave('a');
    expect(isActive('a')).toBe(false);
    expect(FakeObserver.all[0].disconnected).toBe(true);
    expect(remove.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('mouse or pen only', () => {
  it.each(['mouse', 'pen'])('%s starts and stops a preview', (pointerType) => {
    render(<Harness id="a" />);
    enter('a', pointerType);
    expect(isActive('a')).toBe(true);
    leave('a');
    expect(isActive('a')).toBe(false);
  });

  it('a touch never starts one — and costs no observer either', () => {
    render(<Harness id="a" />);
    enter('a', 'touch');
    expect(isActive('a')).toBe(false);
    expect(FakeObserver.all).toHaveLength(0);
  });
});

describe('it stops', () => {
  it('when the tab is hidden, and does not start while hidden', () => {
    render(<Harness id="a" />);
    enter('a');
    expect(isActive('a')).toBe(true);
    const hidden = jest.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(isActive('a')).toBe(false);

    leave('a');
    enter('a');
    expect(isActive('a')).toBe(false); // a hidden tab never starts one
    hidden.mockReturnValue(false);
  });

  it('when the thumbnail scrolls out of view under a parked cursor, and starts again on the next hover', () => {
    render(<Harness id="a" />);
    enter('a');
    act(() => FakeObserver.all[0].report(true));
    expect(isActive('a')).toBe(true);
    act(() => FakeObserver.all[0].report(false));
    expect(isActive('a')).toBe(false);
    expect(FakeObserver.all[0].disconnected).toBe(true);
    leave('a');
    enter('a');
    expect(isActive('a')).toBe(true);
  });

  it('when the pointer is cancelled', () => {
    render(<Harness id="a" />);
    enter('a', 'pen');
    fireEvent.pointerCancel(el('a'));
    expect(isActive('a')).toBe(false);
  });
});

describe('one at a time, page-wide', () => {
  it('starting a second thumbnail stops the first, even if its leave was never delivered', () => {
    render(<><Harness id="a" /><Harness id="b" /></>);
    enter('a');
    expect(isActive('a')).toBe(true);
    enter('b'); // no pointerleave on `a` — the lost-event case
    expect(isActive('a')).toBe(false);
    expect(isActive('b')).toBe(true);
    // A late leave from the old one must not stop the new one.
    leave('a');
    expect(isActive('b')).toBe(true);
    leave('b');
    expect(isActive('b')).toBe(false);
  });

  it('forty thumbnails never have more than one running', () => {
    render(<>{Array.from({ length: 40 }, (_, i) => <Harness key={i} id={`t${i}`} />)}</>);
    for (const i of [3, 17, 17, 29, 3, 38]) {
      enter(`t${i}`);
      const running = Array.from({ length: 40 }, (_, n) => n).filter((n) => isActive(`t${n}`));
      expect(running).toEqual([i]);
    }
  });

  it('an unmounted thumbnail gives up its place', () => {
    const { rerender } = render(<><Harness id="a" /><Harness id="b" /></>);
    enter('a');
    rerender(<Harness id="b" />);
    enter('b');
    expect(isActive('b')).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    expect(FakeObserver.all.filter((o) => !o.disconnected)).toHaveLength(1);
  });
});

describe('hover intent', () => {
  it('starts only after the pointer has rested, and a pass-through starts nothing', () => {
    render(<Harness id="a" intentMs={250} />);
    enter('a');
    expect(isActive('a')).toBe(false);
    act(() => { jest.advanceTimersByTime(249); });
    expect(isActive('a')).toBe(false);
    act(() => { jest.advanceTimersByTime(1); });
    expect(isActive('a')).toBe(true);

    leave('a');
    enter('a');
    leave('a'); // crossing the row on the way to a button
    act(() => { jest.advanceTimersByTime(1000); });
    expect(isActive('a')).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
    expect(FakeObserver.all).toHaveLength(1); // only the real hover ever built an observer
  });

  it('a second enter during the wait does not stack a second timer', () => {
    render(<Harness id="a" intentMs={250} />);
    enter('a');
    enter('a');
    expect(jest.getTimerCount()).toBe(1);
  });

  // The playlist library's slideshow tells "pointing at it" from "crossing it" with
  // `intentMs` alone (a crossing must change nothing — not even its slow clock), so
  // these three are what its quick walk stands on.
  it('a touch never even starts the wait — no timer, no state, nothing to cancel', () => {
    render(<Harness id="a" intentMs={350} />);
    enter('a', 'touch');
    expect(jest.getTimerCount()).toBe(0);
    act(() => { jest.advanceTimersByTime(5000); });
    expect(isActive('a')).toBe(false);
    expect(FakeObserver.all).toHaveLength(0);
  });

  it('every new entry restarts the wait: three near-misses never add up to a hover', () => {
    const calls: boolean[] = [];
    render(<Harness id="a" intentMs={350} onChange={(on) => calls.push(on)} />);
    for (let pass = 0; pass < 3; pass++) {
      enter('a');
      act(() => { jest.advanceTimersByTime(349); });
      leave('a');
    }
    expect(isActive('a')).toBe(false);
    expect(calls).toEqual([]); // not one start, not one stop: a crossing is invisible to its consumer
    expect(jest.getTimerCount()).toBe(0);
    enter('a');
    act(() => { jest.advanceTimersByTime(350); });
    expect(isActive('a')).toBe(true);
  });

  it('a tab that goes hidden during the wait never starts the preview', () => {
    render(<Harness id="a" intentMs={350} />);
    enter('a');
    const hidden = jest.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => { jest.advanceTimersByTime(350); });
    expect(isActive('a')).toBe(false);
    expect(FakeObserver.all).toHaveLength(0);
    hidden.mockReturnValue(false);
  });
});

describe('onChange', () => {
  it('reports each start and stop exactly once, in order', () => {
    const calls: boolean[] = [];
    render(<Harness id="a" onChange={(on) => calls.push(on)} />);
    enter('a');
    enter('a');
    leave('a');
    leave('a');
    enter('a');
    leave('a');
    expect(calls).toEqual([true, false, true, false]);
  });

  it('uses the latest callback without re-subscribing', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(<Harness id="a" onChange={first} />);
    rerender(<Harness id="a" onChange={second} />);
    enter('a');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(true);
  });
});

it('works under React StrictMode (effects run, are torn down and run again): one start, one stop, nothing left over', () => {
  const calls: boolean[] = [];
  render(<React.StrictMode><Harness id="a" intentMs={100} onChange={(on) => calls.push(on)} /></React.StrictMode>);
  enter('a');
  act(() => { jest.advanceTimersByTime(100); });
  expect(isActive('a')).toBe(true);
  leave('a');
  expect(isActive('a')).toBe(false);
  expect(calls).toEqual([true, false]);
  expect(jest.getTimerCount()).toBe(0);
  expect(FakeObserver.all.every((o) => o.disconnected)).toBe(true);
});

it('unmounting a hovered thumbnail leaves no timer, observer or listener behind', () => {
  const { unmount } = render(<Harness id="a" intentMs={100} />);
  enter('a');
  act(() => { jest.advanceTimersByTime(100); });
  expect(isActive('a')).toBe(true);
  const remove = jest.spyOn(document, 'removeEventListener');
  unmount();
  expect(FakeObserver.all[0].disconnected).toBe(true);
  expect(remove.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(1);
  expect(jest.getTimerCount()).toBe(0);
});
