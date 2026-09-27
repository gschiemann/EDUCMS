/**
 * useSportsLink (K12-F40) — the freshness contract as the surfaces run it:
 * a one-second tick, the page's server clock HELD while stale, visibility.
 */
import { act, renderHook } from '@testing-library/react';
import { noteRevisionShown, useMarkGoodOnServerRead, useSportsLink } from '../use-sports-link';
import { serverClock } from '@/lib/server-clock';

describe('useSportsLink', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-27T18:00:00.000Z'));
    serverClock.reset();
  });
  afterEach(() => {
    jest.useRealTimers();
    serverClock.reset();
  });

  it('goes stale without good reads, holds the page clocks, and recovers on the next read', () => {
    const { result } = renderHook(() => useSportsLink({ holdClocks: true }));
    act(() => result.current.markGood());
    expect(result.current.state.phase).toBe('live');
    expect(serverClock.isHeld()).toBe(false);

    act(() => {
      jest.advanceTimersByTime(9_100);
    });
    expect(result.current.state.phase).toBe('stale');
    expect(serverClock.isHeld()).toBe(true);
    const held = serverClock.now();
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(serverClock.now()).toBe(held); // the clocks stand still while stale

    act(() => result.current.markGood());
    expect(result.current.state.phase).toBe('live');
    expect(serverClock.isHeld()).toBe(false);
  });

  it('a surface that does not hold clocks leaves the page clock alone', () => {
    const { result } = renderHook(() => useSportsLink());
    act(() => {
      jest.advanceTimersByTime(9_100);
    });
    expect(result.current.state.phase).toBe('stale');
    expect(serverClock.isHeld()).toBe(false);
  });

  it('a hidden tab runs no ticker and claims nothing; coming back waits for a fresh read', () => {
    const { result } = renderHook(() => useSportsLink({ trackVisibility: true, holdClocks: true }));
    act(() => result.current.markGood());
    const setVisibility = (v: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    act(() => setVisibility('hidden'));
    expect(result.current.state.phase).toBe('paused');
    act(() => {
      jest.advanceTimersByTime(600_000);
    });
    expect(result.current.state.phase).toBe('paused'); // ten minutes away is not "lost"
    expect(serverClock.isHeld()).toBe(false);
    act(() => setVisibility('visible'));
    expect(result.current.state.phase).toBe('connecting');
    act(() => result.current.markGood());
    expect(result.current.state.phase).toBe('live');
    act(() => setVisibility('visible'));
  });

  it('releases a held clock when the surface unmounts', () => {
    const { result, unmount } = renderHook(() => useSportsLink({ holdClocks: true }));
    act(() => {
      jest.advanceTimersByTime(9_100);
    });
    expect(result.current.state.phase).toBe('stale');
    expect(serverClock.isHeld()).toBe(true);
    unmount();
    expect(serverClock.isHeld()).toBe(false);
  });

  it('a cached surface counts only SERVER reads: an optimistic write (same serverTime) never makes it live', () => {
    const { result, rerender } = renderHook(
      ({ serverTime }: { serverTime: unknown }) => {
        const link = useSportsLink({ holdClocks: true });
        useMarkGoodOnServerRead(link.markGood, serverTime);
        return link;
      },
      { initialProps: { serverTime: 1_000 as unknown } },
    );
    expect(result.current.state.phase).toBe('live'); // the first read
    act(() => {
      jest.advanceTimersByTime(9_100);
    });
    expect(result.current.state.phase).toBe('stale');
    // Offline taps rewrite the cache with the OLD serverTime spread in…
    rerender({ serverTime: 1_000 });
    rerender({ serverTime: 1_000 });
    expect(result.current.state.phase).toBe('stale');
    // …and a command response without one is not a read either.
    rerender({ serverTime: undefined });
    expect(result.current.state.phase).toBe('stale');
    expect(serverClock.isHeld()).toBe(true);
    // The next real poll carries a fresh serverTime.
    rerender({ serverTime: 10_500 });
    expect(result.current.state.phase).toBe('live');
    expect(serverClock.isHeld()).toBe(false);
  });

  it('measures commit-to-visible on the UNHELD clock (the first revision after an outage)', () => {
    delete (window as unknown as { __sportsLink?: unknown }).__sportsLink;
    const T0 = Date.parse('2026-09-27T18:00:00.000Z');
    const { result } = renderHook(() => useSportsLink({ holdClocks: true }));
    noteRevisionShown('board', { revision: 3, updatedAt: new Date(T0).toISOString() });
    act(() => {
      jest.advanceTimersByTime(9_100); // stale: the display clock holds at +9.1 s
    });
    expect(result.current.state.phase).toBe('stale');
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    // Revision 5 was committed at +12 s, during the outage; it is shown now,
    // at +14.1 s, before the good read has released the hold.
    noteRevisionShown('board', { revision: 5, updatedAt: new Date(T0 + 12_000).toISOString() });
    const seen = (window as unknown as { __sportsLink: Record<string, Record<string, number>> }).__sportsLink.board;
    expect(seen.revision).toBe(5);
    expect(seen.lagMs).toBe(2_100); // not 0 — the held clock would say it was never late
    expect(seen.skipped).toBe(1); // revision 4 was never shown
  });
});
