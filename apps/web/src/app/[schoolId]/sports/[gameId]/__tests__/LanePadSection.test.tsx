/**
 * LanePadSection — component-level render + interaction test (task #271).
 *
 * CLAUDE.md rule #9 (verify the render tree): the pure-logic tests in
 * lane-pad.test.ts prove the math; this suite proves the REACT component
 * actually mounts for lane sports, wires the roster join, computes place
 * live as the operator types, and writes through the SAME
 * `ctl.stats.mutate` path (mocked at `apiFetch`, exactly like
 * SponsorPanel.test.tsx) that every other console control uses — no new
 * endpoint.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { findSport } from '@cms/api-types';

const GAME_ID = 'game-swim-1';

interface FetchOpts {
  method?: string;
  body?: string;
}

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: FetchOpts) => apiFetch(path, opts),
}));

import { LanePadSection, isLaneMeetSport } from '../LanePadSection';
import { useGameControl } from '@/hooks/use-api';

const ROSTER = [
  { id: 'p1', team: 'home', name: 'A. Smith', number: '12', position: null, photoUrl: null, stats: { lane: 2 } },
  { id: 'p2', team: 'away', name: 'B. Jones', number: '7', position: null, photoUrl: null, stats: { lane: 4 } },
  { id: 'p3', team: 'home', name: 'C. NoLane', number: '9', position: null, photoUrl: null, stats: {} },
];

function routeFetch(path: string, opts?: FetchOpts) {
  if (path === `/sports/games/${GAME_ID}/roster`) return Promise.resolve(ROSTER);
  if (path === `/sports/games/${GAME_ID}/stats` && opts?.method === 'PATCH') {
    const body = JSON.parse(opts.body ?? '{}');
    return Promise.resolve({ id: GAME_ID, homeTeam: 'Home', awayTeam: 'Away', stats: body.stats });
  }
  return Promise.resolve(null);
}

// A thin wrapper providing the QueryClient BEFORE the hook mounts (useGameControl
// needs a client in context) — matches the SponsorPanel test's structure.
function renderLanePad(initialStats: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const def = findSport('swimming')!;
  function Inner() {
    const ctl = useGameControl(GAME_ID);
    const g = { homeTeam: 'Home', awayTeam: 'Away', stats: initialStats };
    return <LanePadSection gameId={GAME_ID} g={g} def={def} ctl={ctl} />;
  }
  return render(
    <QueryClientProvider client={qc}>
      <Inner />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(routeFetch);
});

describe('isLaneMeetSport', () => {
  it('true for swimming, swimming_diving, track_and_field', () => {
    expect(isLaneMeetSport('swimming')).toBe(true);
    expect(isLaneMeetSport('swimming_diving')).toBe(true);
    expect(isLaneMeetSport('track_and_field')).toBe(true);
  });
  it('false for diving and other meet sports (no lane concept, or judged)', () => {
    expect(isLaneMeetSport('diving')).toBe(false);
    expect(isLaneMeetSport('golf')).toBe(false);
    expect(isLaneMeetSport('cross_country')).toBe(false);
    expect(isLaneMeetSport('gymnastics')).toBe(false);
    expect(isLaneMeetSport('football')).toBe(false);
  });
});

describe('LanePadSection', () => {
  it('renders a default 8-lane grid', () => {
    renderLanePad();
    // Lane badges 1..8 rendered as their own text nodes.
    for (let lane = 1; lane <= 8; lane++) {
      expect(screen.getAllByText(String(lane)).length).toBeGreaterThan(0);
    }
  });

  it('auto-fills roster names into their assigned lanes once loaded', async () => {
    renderLanePad();
    await waitFor(() => {
      expect(screen.getByDisplayValue('A. Smith')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('B. Jones')).toBeInTheDocument();
    // C. NoLane has no lane assignment — never fabricated onto a lane.
    expect(screen.queryByDisplayValue('C. NoLane')).not.toBeInTheDocument();
  });

  it('typing a time computes place live (fastest = 1) without a save', async () => {
    renderLanePad();
    await waitFor(() => expect(screen.getByDisplayValue('A. Smith')).toBeInTheDocument());

    const marks = screen.getAllByPlaceholderText('1:52.31');
    // Lane 2 (A. Smith) and lane 4 (B. Jones) are the roster-filled rows —
    // find them by row position: lane badges render "1".."8" in order, so
    // marks[1] = lane 2's input, marks[3] = lane 4's.
    fireEvent.change(marks[1], { target: { value: '1:00.00' } });
    fireEvent.change(marks[3], { target: { value: '0:55.00' } });

    await waitFor(() => {
      const placeInputs = screen.getAllByTitle('Auto-computed from fastest time — type to override');
      // Lane 4 (idx 3) is faster → place 1; lane 2 (idx 1) → place 2.
      expect((placeInputs[3] as HTMLInputElement).value).toBe('1');
      expect((placeInputs[1] as HTMLInputElement).value).toBe('2');
    });
  });

  it('DQ chip excludes the lane from auto-place and shows DQ status', async () => {
    renderLanePad();
    await waitFor(() => expect(screen.getByDisplayValue('A. Smith')).toBeInTheDocument());

    const marks = screen.getAllByPlaceholderText('1:52.31');
    fireEvent.change(marks[1], { target: { value: '55.00' } });

    const dqButtons = screen.getAllByText('DQ');
    // Toggle DQ on lane 2 (index 1 among the 8 DQ buttons, one per row).
    fireEvent.click(dqButtons[1]);

    await waitFor(() => {
      const placeInputs = screen.getAllByTitle('Auto-computed from fastest time — type to override');
      expect((placeInputs[1] as HTMLInputElement).value).toBe('');
    });
    // The mark input for that lane is now disabled (DQ owns the status).
    expect((marks[1] as HTMLInputElement).disabled).toBe(true);
  });

  it('Next heat saves stats.results via the existing PATCH /stats mutation and resets the grid', async () => {
    renderLanePad({ currentEvent: '12', heat: '3' });
    await waitFor(() => expect(screen.getByDisplayValue('A. Smith')).toBeInTheDocument());

    const marks = screen.getAllByPlaceholderText('1:52.31');
    fireEvent.change(marks[1], { target: { value: '58.00' } });

    const nextHeatBtn = screen.getByRole('button', { name: /Next heat/i });
    fireEvent.click(nextHeatBtn);

    await waitFor(() => {
      const statsCalls = (apiFetch.mock.calls as [string, FetchOpts | undefined][]).filter(
        ([path, opts]) => path === `/sports/games/${GAME_ID}/stats` && opts?.method === 'PATCH',
      );
      expect(statsCalls.length).toBeGreaterThan(0);
      const lastOpts = statsCalls[statsCalls.length - 1][1];
      const lastBody = JSON.parse(lastOpts?.body ?? '{}');
      expect(Array.isArray(lastBody.stats.results)).toBe(true);
      const saved = lastBody.stats.results[lastBody.stats.results.length - 1];
      expect(saved.event).toBe('12 — HEAT 3');
      expect(
        saved.entries.some((e: { name: string; mark: string }) => e.name === 'A. Smith' && e.mark === '58.00'),
      ).toBe(true);
    });

    // Grid resets — the just-saved name should no longer be sitting in the
    // (now blank, re-filled-from-roster) mark field.
    await waitFor(() => {
      const freshMarks = screen.getAllByPlaceholderText('1:52.31');
      expect((freshMarks[1] as HTMLInputElement).value).toBe('');
    });
  });

  it('Next heat is a no-op (disabled) when the grid has no entries at all', () => {
    renderLanePad();
    const nextHeatBtn = screen.getByRole('button', { name: /Next heat/i });
    expect(nextHeatBtn).toBeDisabled();
  });

  // ── S1-2 (P1-4): debounced provisional mid-heat publish ─────────────
  describe('provisional mid-heat publish (S1-2 / P1-4)', () => {
    it('publishes the in-progress grid to stats.results ~800ms after the last edit, WITHOUT tapping Next heat', async () => {
      renderLanePad({ currentEvent: '12', heat: '3' });
      await waitFor(() => expect(screen.getByDisplayValue('A. Smith')).toBeInTheDocument());

      const callsBefore = apiFetch.mock.calls.length;
      const marks = screen.getAllByPlaceholderText('1:52.31');
      fireEvent.change(marks[1], { target: { value: '58.00' } }); // lane 2, A. Smith

      // Never clicked "Next heat" — the provisional publish is the ONLY
      // thing that can produce this PATCH.
      await waitFor(
        () => {
          const statsCalls = (apiFetch.mock.calls as [string, FetchOpts | undefined][])
            .slice(callsBefore)
            .filter(([path, opts]) => path === `/sports/games/${GAME_ID}/stats` && opts?.method === 'PATCH');
          expect(statsCalls.length).toBeGreaterThan(0);
          const lastBody = JSON.parse(statsCalls[statsCalls.length - 1][1]?.body ?? '{}');
          expect(Array.isArray(lastBody.stats.results)).toBe(true);
          const published = lastBody.stats.results[lastBody.stats.results.length - 1];
          // Same event label `nextHeat()` would use — so the FINAL save
          // later supersedes this provisional row in place (mergeHeatResult
          // dedupes by exact event match).
          expect(published.event).toBe('12 — HEAT 3');
          expect(
            published.entries.some(
              (e: { name: string; mark: string }) => e.name === 'A. Smith' && e.mark === '58.00',
            ),
          ).toBe(true);
        },
        { timeout: 2000 },
      );

      // The grid itself is untouched by a provisional publish (unlike Next
      // heat, which clears it) — the operator keeps typing the same heat.
      expect((marks[1] as HTMLInputElement).value).toBe('58.00');
    });

    it('does not publish a provisional row for a still-blank grid (no fabricated finishers)', async () => {
      // Override the module-level roster mock with an EMPTY roster for this
      // one test — the shared ROSTER fixture auto-fills lanes 2/4, which is
      // itself real content (a name with no mark still passes buildHeatResult's
      // filter), so it isn't a genuinely blank grid. A truly untouched grid
      // (no roster, no typing) is the actual "nothing to publish" case.
      apiFetch.mockImplementation((path: string, opts?: FetchOpts) => {
        if (path === `/sports/games/${GAME_ID}/roster`) return Promise.resolve([]);
        return routeFetch(path, opts);
      });
      renderLanePad();
      // Let the roster query resolve (to an empty array) before timing the window.
      await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(`/sports/games/${GAME_ID}/roster`, undefined));
      const callsAtMount = apiFetch.mock.calls.length;

      // Wait past the debounce window without typing anything new. Wrapped
      // in act() — React Query's background notifyManager can flush a
      // batched update during this real-time window with no waitFor
      // actively polling to catch it inside act() for us.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1000));
      });

      const statsCalls = (apiFetch.mock.calls as [string, FetchOpts | undefined][])
        .slice(callsAtMount)
        .filter(([path, opts]) => path === `/sports/games/${GAME_ID}/stats` && opts?.method === 'PATCH');
      expect(statsCalls.length).toBe(0);
    });

    it('Next heat cancels a pending provisional publish so it never lands on the freshly-reset grid', async () => {
      // Empty roster for this test — the fresh grid `nextHeat()` re-seeds
      // has nothing to auto-fill, so NO legitimate new provisional publish
      // should fire for the next heat either. That isolates the assertion
      // to exactly the property under test: a timer armed against the
      // PRE-save heat must not survive the reset and fire stale content.
      apiFetch.mockImplementation((path: string, opts?: FetchOpts) => {
        if (path === `/sports/games/${GAME_ID}/roster`) return Promise.resolve([]);
        return routeFetch(path, opts);
      });
      renderLanePad({ currentEvent: '12', heat: '3' });
      await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(`/sports/games/${GAME_ID}/roster`, undefined));

      const marks = screen.getAllByPlaceholderText('1:52.31');
      fireEvent.change(marks[1], { target: { value: '58.00' } });
      // Fire Next heat IMMEDIATELY — well inside the 800ms debounce window,
      // so a naive implementation would have a stale provisional timer
      // still armed against the just-cleared heat.
      fireEvent.click(screen.getByRole('button', { name: /Next heat/i }));

      await waitFor(() => {
        const saveCalls = (apiFetch.mock.calls as [string, FetchOpts | undefined][]).filter(
          ([path, opts]) => path === `/sports/games/${GAME_ID}/stats` && opts?.method === 'PATCH',
        );
        expect(saveCalls.length).toBeGreaterThan(0);
      });
      const callsRightAfterSave = apiFetch.mock.calls.length;

      // Wait past where the cancelled debounce WOULD have fired had it not
      // been cancelled — no additional /stats PATCH should appear.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1000));
      });
      const laterCalls = apiFetch.mock.calls.slice(callsRightAfterSave);
      expect(laterCalls.filter(([path]) => path === `/sports/games/${GAME_ID}/stats`).length).toBe(0);
    });
  });

  // ── #292 (2026-07-02 overnight adversarial review, P1) ───────────────
  // Provisional-vs-finalize PATCH race: a debounced provisional publish and
  // `nextHeat()`'s finalize save are two independent PATCHes against the
  // SAME whole-array-replace endpoint. If the provisional's request is
  // in flight when `nextHeat()` fires and resolves LATE (after the
  // finalize's own PATCH would otherwise have already gone out), the
  // finalized heat's marks/DQ must NOT be overwritten by the stale
  // provisional snapshot. `drainProvisional()` (awaiting the captured
  // `mutateAsync` promise before ever building the finalize PATCH) is the
  // fix under test here.
  describe('provisional-vs-finalize PATCH race (#292)', () => {
    it('Next heat awaits an in-flight provisional PATCH before sending the finalize PATCH, so the finalized heat is the LAST write and survives', async () => {
      // Defer the provisional's own PATCH resolution under our control —
      // every other route (roster, any other /stats PATCH) resolves
      // immediately as usual.
      let resolveProvisional: ((v: unknown) => void) | null = null;
      let provisionalPatchSeen = false;
      apiFetch.mockImplementation((path: string, opts?: FetchOpts) => {
        if (path === `/sports/games/${GAME_ID}/stats` && opts?.method === 'PATCH') {
          const body = JSON.parse(opts.body ?? '{}');
          // The FIRST /stats PATCH the debounce fires is the provisional —
          // hold it open until the test explicitly resolves it below,
          // simulating a slow/late-arriving network response.
          if (!provisionalPatchSeen) {
            provisionalPatchSeen = true;
            return new Promise((resolve) => {
              resolveProvisional = () =>
                resolve({ id: GAME_ID, homeTeam: 'Home', awayTeam: 'Away', stats: body.stats });
            });
          }
          return Promise.resolve({ id: GAME_ID, homeTeam: 'Home', awayTeam: 'Away', stats: body.stats });
        }
        return routeFetch(path, opts);
      });

      renderLanePad({ currentEvent: '12', heat: '3' });
      await waitFor(() => expect(screen.getByDisplayValue('A. Smith')).toBeInTheDocument());

      // Type lane 2's mark and let the 800ms debounce fire the provisional
      // PATCH — it will hang, per the mock above, until we resolve it.
      const marks = screen.getAllByPlaceholderText('1:52.31');
      fireEvent.change(marks[1], { target: { value: '58.00' } });
      await waitFor(() => expect(provisionalPatchSeen).toBe(true), { timeout: 2000 });

      // Now change lane 2's mark AGAIN (the operator correcting a split)
      // and immediately tap "Next heat" — WHILE the provisional PATCH
      // above is still unresolved. A pre-#292-fix implementation would
      // fire the finalize PATCH immediately; this fix must await the
      // provisional first.
      fireEvent.change(marks[1], { target: { value: '57.50' } });
      fireEvent.click(screen.getByRole('button', { name: /Next heat/i }));

      // Give the click handler's synchronous portion (up to the await)
      // a tick, then assert NO finalize PATCH has gone out yet — it must
      // be blocked on the still-unresolved provisional promise.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const callsBeforeResolve = apiFetch.mock.calls.filter(
        ([path, opts]: [string, FetchOpts?]) =>
          path === `/sports/games/${GAME_ID}/stats` && opts?.method === 'PATCH',
      ).length;
      expect(callsBeforeResolve).toBe(1); // only the provisional so far — finalize is blocked

      // NOW let the provisional resolve late.
      expect(resolveProvisional).not.toBeNull();
      await act(async () => {
        resolveProvisional!(undefined);
        await Promise.resolve();
      });

      // The finalize PATCH must land AFTER the provisional resolved, and
      // its results must be the LAST write the endpoint saw — the
      // finalized heat's mark (57.50) must survive, not be clobbered by
      // the provisional's earlier (58.00) snapshot.
      await waitFor(() => {
        const statsCalls = (apiFetch.mock.calls as [string, FetchOpts | undefined][]).filter(
          ([path, opts]) => path === `/sports/games/${GAME_ID}/stats` && opts?.method === 'PATCH',
        );
        expect(statsCalls.length).toBe(2); // provisional, then finalize — no third stray write
        const finalizeBody = JSON.parse(statsCalls[1][1]?.body ?? '{}');
        expect(Array.isArray(finalizeBody.stats.results)).toBe(true);
        const saved =
          finalizeBody.stats.results[finalizeBody.stats.results.length - 1];
        expect(saved.event).toBe('12 — HEAT 3');
        // The corrected mark (57.50), not the stale provisional (58.00).
        expect(
          saved.entries.some(
            (e: { name: string; mark: string }) => e.name === 'A. Smith' && e.mark === '57.50',
          ),
        ).toBe(true);
        expect(
          saved.entries.some(
            (e: { name: string; mark: string }) => e.name === 'A. Smith' && e.mark === '58.00',
          ),
        ).toBe(false);
      });
    });
  });

  // ── S1-3 (P1-5): Undo restores the typed rows, not just stats.results ──
  describe('Undo restores the typed grid (S1-3 / P1-5)', () => {
    it('restores the exact rows that were just saved, not a blank re-rolled grid', async () => {
      renderLanePad({ currentEvent: '12', heat: '3' });
      await waitFor(() => expect(screen.getByDisplayValue('A. Smith')).toBeInTheDocument());

      const marks = screen.getAllByPlaceholderText('1:52.31');
      fireEvent.change(marks[1], { target: { value: '58.00' } }); // lane 2 (A. Smith)
      fireEvent.change(marks[3], { target: { value: '55.00' } }); // lane 4 (B. Jones)

      fireEvent.click(screen.getByRole('button', { name: /Next heat/i }));

      // Grid resets after the save.
      await waitFor(() => {
        const freshMarks = screen.getAllByPlaceholderText('1:52.31');
        expect((freshMarks[1] as HTMLInputElement).value).toBe('');
      });

      const undoBtn = screen.getByRole('button', { name: /Undo/i });
      fireEvent.click(undoBtn);

      // The typed times are back — this is the bug fix: pre-S1-3, Undo only
      // reverted stats.results and left the grid blank, forcing the
      // operator to retype the whole heat by hand.
      await waitFor(() => {
        const restoredMarks = screen.getAllByPlaceholderText('1:52.31');
        expect((restoredMarks[1] as HTMLInputElement).value).toBe('58.00');
        expect((restoredMarks[3] as HTMLInputElement).value).toBe('55.00');
      });
      // Names round-trip too — the FULL row snapshot, not just marks.
      expect(screen.getByDisplayValue('A. Smith')).toBeInTheDocument();
      expect(screen.getByDisplayValue('B. Jones')).toBeInTheDocument();
    });

    it('also reverts the persisted stats.results back to the pre-save snapshot', async () => {
      renderLanePad({ currentEvent: '12', heat: '3' });
      await waitFor(() => expect(screen.getByDisplayValue('A. Smith')).toBeInTheDocument());

      const marks = screen.getAllByPlaceholderText('1:52.31');
      fireEvent.change(marks[1], { target: { value: '58.00' } });
      fireEvent.click(screen.getByRole('button', { name: /Next heat/i }));
      await waitFor(() => screen.getByRole('button', { name: /Undo/i }));

      fireEvent.click(screen.getByRole('button', { name: /Undo/i }));

      await waitFor(() => {
        const statsCalls = (apiFetch.mock.calls as [string, FetchOpts | undefined][]).filter(
          ([path, opts]) => path === `/sports/games/${GAME_ID}/stats` && opts?.method === 'PATCH',
        );
        const lastBody = JSON.parse(statsCalls[statsCalls.length - 1][1]?.body ?? '{}');
        // Pre-save snapshot was an empty results array (no heats recorded
        // yet in this test's initial stats) — Undo must restore exactly that.
        expect(lastBody.stats.results).toEqual([]);
      });
    });
  });
});
