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
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
});
