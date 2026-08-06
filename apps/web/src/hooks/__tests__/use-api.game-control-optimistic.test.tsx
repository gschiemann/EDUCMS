/**
 * useGameControl — optimistic score/clock/segment/stats (S1-1, 2026-07-02
 * sports deep-pass audit finding P0-1). `apps/web/src/hooks/use-api.ts`
 * (score/clock/segment/stats mutations) had NO `onMutate` while ~20
 * screens-hooks in the same file do — every +1 tap waited a full RTT
 * before the scoreboard moved. This suite proves the fix end-to-end
 * against the REAL React Query cache: `.mutate()` must update
 * `['sports-game', gameId]` SYNCHRONOUSLY (before the mocked network
 * call resolves), and a failed PATCH must roll the cache back to the
 * pre-tap snapshot — never leaving a phantom optimistic value on screen.
 *
 * Mocking convention matches `LanePadSection.test.tsx` in the same
 * console directory: mock `apiFetch` at `@/lib/api-client`, mount a thin
 * wrapper that calls the real `useGameControl` hook inside a real
 * `QueryClientProvider`, and assert against `qc.getQueryData`.
 */
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const GAME_ID = 'game-optimistic-1';
const GAME_KEY = ['sports-game', GAME_ID];

interface FetchOpts {
  method?: string;
  body?: string;
}

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: FetchOpts) => apiFetch(path, opts),
}));

import { useGameControl } from '../use-api';
import { getGameOpQueue, __resetGameOpQueues } from '@/lib/game-op-queue';

/** Baseline cached game — a live football game, clock stopped at 12:00
 *  in segment 1, 0-0. Every test seeds this into the cache before
 *  mounting so `onMutate`'s `qc.getQueryData` has a real snapshot. */
function baseGame(overrides: Record<string, unknown> = {}) {
  return {
    id: GAME_ID,
    sport: 'football',
    homeTeam: 'Home',
    awayTeam: 'Away',
    homeScore: 0,
    awayScore: 0,
    segment: 1,
    clockMs: 12 * 60_000,
    clockRunning: false,
    clockUpdatedAt: new Date('2026-07-02T00:00:00.000Z').toISOString(),
    stats: {},
    ...overrides,
  };
}

/** Renders a component that mounts the real hook and exposes both the
 *  QueryClient (for cache assertions) and the live `ctl` object (for
 *  firing mutations) to the caller via out-params — avoids re-inventing
 *  renderHook (not used anywhere else in this codebase; LanePadSection's
 *  test wraps a component instead, so this mirrors that convention). */
function mountGameControl(initial: ReturnType<typeof baseGame>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(GAME_KEY, initial);
  let ctl!: ReturnType<typeof useGameControl>;
  function Inner() {
    ctl = useGameControl(GAME_ID);
    return null;
  }
  render(
    <QueryClientProvider client={qc}>
      <Inner />
    </QueryClientProvider>,
  );
  return { qc, getCtl: () => ctl };
}

beforeEach(() => {
  apiFetch.mockReset();
  // Every mount of useGameControl now touches the shared per-game op queue
  // (Trust wave Domain C); reset the registry + storage so queue state can't
  // bleed across tests.
  __resetGameOpQueues();
  window.sessionStorage.clear();
});

describe('useGameControl — score optimistic update + rollback', () => {
  it('applies a +1 delta to the cache SYNCHRONOUSLY, before the PATCH resolves', async () => {
    // Never-resolving promise — proves the cache already moved BEFORE
    // any network response could possibly have arrived.
    apiFetch.mockReturnValue(new Promise(() => {}));
    const { qc, getCtl } = mountGameControl(baseGame({ homeScore: 3 }));

    getCtl().score.mutate({ team: 'home', delta: 1 });

    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).homeScore).toBe(4);
    });
  });

  it('clamps a delta at zero, mirroring the server clamp', async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    const { qc, getCtl } = mountGameControl(baseGame({ awayScore: 0 }));

    getCtl().score.mutate({ team: 'away', delta: -1 });

    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).awayScore).toBe(0);
    });
  });

  it('an absolute set (no delta) writes homeScore/awayScore directly', async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    const { qc, getCtl } = mountGameControl(baseGame({ homeScore: 10, awayScore: 7 }));

    getCtl().score.mutate({ homeScore: 14 });

    await waitFor(() => {
      const g = qc.getQueryData(GAME_KEY) as any;
      expect(g.homeScore).toBe(14);
      expect(g.awayScore).toBe(7); // untouched field left alone
    });
  });

  it('refetches server truth on a failed PATCH — never force-restores a stale pre-tap snapshot', async () => {
    // 2026-07-03 overnight-review P0: the old onError restored ctx.prev (the
    // pre-tap snapshot). With no per-game serialization that clobbered a
    // CONCURRENTLY-confirmed later score back to a stale value — a live board
    // score visibly DECREASING after a good tap (see the concurrent-race test
    // below). On failure we now invalidate (refetch truth) instead.
    let reject!: (e: unknown) => void;
    apiFetch.mockReturnValue(new Promise((_res, rej) => { reject = rej; }));
    const { qc, getCtl } = mountGameControl(baseGame({ homeScore: 5 }));
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    getCtl().score.mutate({ team: 'home', delta: 1 });
    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).homeScore).toBe(6); // optimistic lands
    });
    reject(new Error('network down'));
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: GAME_KEY }));
    });
    // The stale pre-tap value (5) is NOT force-written back over the cache.
    expect((qc.getQueryData(GAME_KEY) as any).homeScore).not.toBe(5);
  });

  it('concurrent-race regression: a failed tap does NOT clobber a later confirmed score', async () => {
    // The bug: tap-1 issued, then tap-2 issued + SUCCEEDS (writeBack writes the
    // server-confirmed score), then tap-1 FAILS. The old rollback restored
    // tap-1's ctx.prev (pre-both), reverting the board to a stale value.
    let rejectA!: (e: unknown) => void;
    // tap-1: a caller-controlled promise we reject LAST.
    // tap-2: resolves immediately with the server's confirmed score (8).
    apiFetch
      .mockReturnValueOnce(new Promise((_res, rej) => { rejectA = rej; })) // score A
      .mockResolvedValueOnce({ ...baseGame({ homeScore: 8 }) });            // score B
    const { qc, getCtl } = mountGameControl(baseGame({ homeScore: 6 }));

    getCtl().score.mutate({ team: 'home', delta: 1 }); // A (optimistic 7)
    getCtl().score.mutate({ team: 'home', delta: 1 }); // B (optimistic 8, then writeBack 8)
    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).homeScore).toBe(8); // B's confirmed truth
    });
    rejectA(new Error('network down')); // A fails AFTER B confirmed
    // With the fix, A's onError invalidates (no restore) → cache stays at 8.
    // With the old bug it would have been force-restored to 6.
    await new Promise((r) => setTimeout(r, 0));
    expect((qc.getQueryData(GAME_KEY) as any).homeScore).toBe(8);
  });

  it('writeBack reconciles the cache with the server response on success', async () => {
    apiFetch.mockResolvedValue({ ...baseGame({ homeScore: 21 }) });
    const { qc, getCtl } = mountGameControl(baseGame({ homeScore: 3 }));

    getCtl().score.mutate({ team: 'home', delta: 1 });

    await waitFor(() => {
      // The server's authoritative value (21) wins over the naive
      // optimistic guess (4) — writeBack still runs on success.
      expect((qc.getQueryData(GAME_KEY) as any).homeScore).toBe(21);
    });
  });
});

describe('useGameControl — clock optimistic update + rollback', () => {
  it('start: flips clockRunning true immediately, before the PATCH resolves', async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    const { qc, getCtl } = mountGameControl(baseGame({ clockRunning: false }));

    getCtl().clock.mutate({ action: 'start' });

    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).clockRunning).toBe(true);
    });
  });

  it('pause: freezes at the live-projected reading (countdown ticks down while running)', async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    const anchor = new Date('2026-07-02T00:00:00.000Z');
    // Freeze ONLY `Date` (both `Date.now()` and `new Date()` read the fake
    // clock) — `setTimeout` stays REAL so `waitFor`'s internal polling
    // still runs. `jest.spyOn(Date, 'now')` alone doesn't cover this
    // component's `new Date()` calls in this jsdom setup.
    jest.useFakeTimers({
      doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'nextTick'],
    });
    jest.setSystemTime(new Date(anchor.getTime() + 5_000)); // +5s
    try {
      const { qc, getCtl } = mountGameControl(
        baseGame({ clockMs: 12 * 60_000, clockRunning: true, clockUpdatedAt: anchor.toISOString() }),
      );
      getCtl().clock.mutate({ action: 'pause' });
      await waitFor(() => {
        const g = qc.getQueryData(GAME_KEY) as any;
        expect(g.clockRunning).toBe(false);
        // Countdown clock: 12:00 minus 5s elapsed = 11:55 (715000ms).
        expect(g.clockMs).toBe(12 * 60_000 - 5_000);
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('set: writes the given ms directly', async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    const { qc, getCtl } = mountGameControl(baseGame());

    getCtl().clock.mutate({ action: 'set', ms: 90_000 });

    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).clockMs).toBe(90_000);
    });
  });

  it('reset: countdown sport resets to its configured segment length', async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    const { qc, getCtl } = mountGameControl(baseGame({ sport: 'football', clockMs: 42_000 }));

    getCtl().clock.mutate({ action: 'reset' });

    await waitFor(() => {
      const g = qc.getQueryData(GAME_KEY) as any;
      expect(g.clockMs).toBe(12 * 60_000); // football quarter length
      expect(g.clockRunning).toBe(false);
    });
  });

  it('reset: count-up sport (soccer) resets to zero', async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    const { qc, getCtl } = mountGameControl(baseGame({ sport: 'soccer', clockMs: 500_000 }));

    getCtl().clock.mutate({ action: 'reset' });

    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).clockMs).toBe(0);
    });
  });

  it('refetches server truth on a failed PATCH — no stale clock restore', async () => {
    let reject!: (e: unknown) => void;
    apiFetch.mockReturnValue(new Promise((_res, rej) => { reject = rej; }));
    const { qc, getCtl } = mountGameControl(baseGame({ clockRunning: false }));
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    getCtl().clock.mutate({ action: 'start' });
    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).clockRunning).toBe(true);
    });
    reject(new Error('network down'));
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: GAME_KEY }));
    });
  });
});

describe('useGameControl — segment optimistic update + rollback', () => {
  it('delta advances the cached segment immediately', async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    const { qc, getCtl } = mountGameControl(baseGame({ segment: 1 }));

    getCtl().segment.mutate({ delta: 1 });

    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).segment).toBe(2);
    });
  });

  it('clamps segment within [1, count] for the sport', async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    // Football: 4 quarters, overtime allowed (+10 headroom) — a huge
    // negative delta still floors at 1, never goes negative/zero.
    const { qc, getCtl } = mountGameControl(baseGame({ sport: 'football', segment: 1 }));

    getCtl().segment.mutate({ delta: -99 });

    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).segment).toBe(1);
    });
  });

  it('refetches server truth on a failed PATCH — no stale segment restore', async () => {
    let reject!: (e: unknown) => void;
    apiFetch.mockReturnValue(new Promise((_res, rej) => { reject = rej; }));
    const { qc, getCtl } = mountGameControl(baseGame({ segment: 2 }));
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    getCtl().segment.mutate({ delta: 1 });
    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).segment).toBe(3);
    });
    reject(new Error('network down'));
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: GAME_KEY }));
    });
    expect((qc.getQueryData(GAME_KEY) as any).segment).not.toBe(2);
  });
});

describe('useGameControl — stats optimistic update + rollback', () => {
  it('shallow-merges the stats patch into the cache immediately', async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    const { qc, getCtl } = mountGameControl(baseGame({ stats: { homeFouls: 2, currentEvent: '100 Free' } }));

    getCtl().stats.mutate({ stats: { homeFouls: 3 } });

    await waitFor(() => {
      const g = qc.getQueryData(GAME_KEY) as any;
      // The touched key updates…
      expect(g.stats.homeFouls).toBe(3);
      // …while an untouched key survives the merge (PATCH is a merge,
      // not a replace — matches updateStats' server-side behavior).
      expect(g.stats.currentEvent).toBe('100 Free');
    });
  });

  it('refetches server truth on a failed PATCH — no stale stats restore', async () => {
    let reject!: (e: unknown) => void;
    apiFetch.mockReturnValue(new Promise((_res, rej) => { reject = rej; }));
    const { qc, getCtl } = mountGameControl(baseGame({ stats: { homeFouls: 2 } }));
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    getCtl().stats.mutate({ stats: { homeFouls: 3 } });
    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).stats.homeFouls).toBe(3);
    });
    reject(new Error('network down'));
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: GAME_KEY }));
    });
    expect((qc.getQueryData(GAME_KEY) as any).stats.homeFouls).not.toBe(2);
  });
});

describe('useGameControl — offline queue vs server-rejection (Trust wave Domain C)', () => {
  it('a network-failed write ENQUEUES the op and KEEPS the optimistic cache (honest, not rolled back)', async () => {
    // fetch's own network TypeError — the request provably got no response,
    // so the tap WILL be applied on reconnect. Keeping the optimistic value
    // is what makes the console honest (the ConnectionBanner shows it queued)
    // instead of snapping the score back and silently losing the tap.
    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const { qc, getCtl } = mountGameControl(baseGame({ homeScore: 5 }));

    getCtl().score.mutate({ team: 'home', delta: 1 });

    await waitFor(() => {
      expect(getGameOpQueue(GAME_ID).size()).toBe(1);
    });
    expect(getGameOpQueue(GAME_ID).peekAll()[0]).toMatchObject({
      kind: 'score',
      payload: { team: 'home', delta: 1 },
    });
    // Optimistic 6 (5 + 1) is NOT rolled back — the queue makes it truthful.
    expect((qc.getQueryData(GAME_KEY) as any).homeScore).toBe(6);
  });

  it('a 4xx server rejection does NOT enqueue — it invalidates (refetch truth) and flags REJECTED', async () => {
    // A response with an HTTP status means the server DID process (or reject)
    // the write; re-queuing it could double-count, so we refetch truth and
    // surface the rejection instead.
    apiFetch.mockRejectedValue(Object.assign(new Error('Unprocessable'), { status: 422 }));
    const { qc, getCtl } = mountGameControl(baseGame({ homeScore: 5 }));
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    getCtl().score.mutate({ team: 'home', delta: 1 });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: GAME_KEY }));
    });
    expect(getGameOpQueue(GAME_ID).size()).toBe(0); // never queued
    // Rejection is recorded so the banner can show its dismissible REJECTED state.
    expect(getGameOpQueue(GAME_ID).getSnapshot().lastRejectionAt).not.toBeNull();
  });
});
