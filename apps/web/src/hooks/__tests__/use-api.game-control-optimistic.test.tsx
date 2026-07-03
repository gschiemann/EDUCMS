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

  it('rolls back to the pre-tap snapshot when the PATCH fails', async () => {
    // A caller-controlled promise (rather than an already-rejecting one) so
    // the test can observe the optimistic write BEFORE triggering the
    // failure — an already-settled mockRejectedValue resolves its .catch
    // microtask before waitFor's first poll tick, so the "optimistic value
    // landed" assertion below would otherwise race the rollback and flake.
    let reject!: (e: unknown) => void;
    apiFetch.mockReturnValue(new Promise((_res, rej) => { reject = rej; }));
    const { qc, getCtl } = mountGameControl(baseGame({ homeScore: 5 }));

    getCtl().score.mutate({ team: 'home', delta: 1 });
    // Optimistic value lands first…
    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).homeScore).toBe(6);
    });
    // …then rolls back once the mutation rejects.
    reject(new Error('network down'));
    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).homeScore).toBe(5);
    });
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

  it('rolls back the clock on a failed PATCH', async () => {
    // Caller-controlled promise — see the score rollback test's comment for
    // why an already-rejecting mock would race the optimistic assertion.
    let reject!: (e: unknown) => void;
    apiFetch.mockReturnValue(new Promise((_res, rej) => { reject = rej; }));
    const { qc, getCtl } = mountGameControl(baseGame({ clockRunning: false }));

    getCtl().clock.mutate({ action: 'start' });
    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).clockRunning).toBe(true);
    });
    reject(new Error('network down'));
    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).clockRunning).toBe(false);
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

  it('rolls back the segment on a failed PATCH', async () => {
    // Caller-controlled promise — see the score rollback test's comment for
    // why an already-rejecting mock would race the optimistic assertion.
    let reject!: (e: unknown) => void;
    apiFetch.mockReturnValue(new Promise((_res, rej) => { reject = rej; }));
    const { qc, getCtl } = mountGameControl(baseGame({ segment: 2 }));

    getCtl().segment.mutate({ delta: 1 });
    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).segment).toBe(3);
    });
    reject(new Error('network down'));
    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).segment).toBe(2);
    });
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

  it('rolls back the stats merge on a failed PATCH', async () => {
    // Caller-controlled promise — see the score rollback test's comment for
    // why an already-rejecting mock would race the optimistic assertion.
    let reject!: (e: unknown) => void;
    apiFetch.mockReturnValue(new Promise((_res, rej) => { reject = rej; }));
    const { qc, getCtl } = mountGameControl(baseGame({ stats: { homeFouls: 2 } }));

    getCtl().stats.mutate({ stats: { homeFouls: 3 } });
    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).stats.homeFouls).toBe(3);
    });
    reject(new Error('network down'));
    await waitFor(() => {
      expect((qc.getQueryData(GAME_KEY) as any).stats.homeFouls).toBe(2);
    });
  });
});
