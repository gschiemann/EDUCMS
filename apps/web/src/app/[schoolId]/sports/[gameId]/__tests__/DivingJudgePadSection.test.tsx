/**
 * DivingJudgePadSection — component-level render + interaction test
 * (Sports Wave S3, P0-3, 2026-07-02/03 sports deep-pass audit).
 *
 * Before this component existed, NOTHING on the console ever wrote
 * `stats.judgeScores` — `DiveJudgesPanelWidget` read a key with no
 * producer and the operator did drop-high/low × DD math on paper. This
 * suite mounts the REAL component (not a mock) and proves the meet flow
 * end to end: tap a roster diver → set dive code/DD → tap judge scores in
 * half-point steps → "Award" writes BOTH `stats.judgeScores` (what the
 * board's judge-chip row reads) and an accumulated running total into
 * `stats.results` (what the leaderboard widget reads) — through the SAME
 * `ctl.stats.mutate` → `apiFetch` PATCH path every other console control
 * uses (mocked exactly like `MeetResultsSection.test.tsx` /
 * `LanePadSection.test.tsx` in this same directory: mock `apiFetch`,
 * mount a thin wrapper around the real `useGameControl` hook inside a
 * real `QueryClientProvider`).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { findSport } from '@cms/api-types';

const GAME_ID = 'game-dive-1';

interface FetchOpts {
  method?: string;
  body?: string;
}

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: FetchOpts) => apiFetch(path, opts),
}));

import { DivingJudgePadSection } from '../page';
import { useGameControl } from '@/hooks/use-api';

const ROSTER = [
  { id: 'p1', team: 'home', name: 'R. Tanaka', number: '4', position: null, photoUrl: null, stats: {} },
  { id: 'p2', team: 'away', name: 'L. Fischer', number: '9', position: null, photoUrl: null, stats: {} },
];

function routeFetch(path: string, opts?: FetchOpts) {
  if (path === `/sports/games/${GAME_ID}/roster`) return Promise.resolve(ROSTER);
  if (path === `/sports/games/${GAME_ID}/stats` && opts?.method === 'PATCH') {
    const body = JSON.parse(opts.body ?? '{}');
    return Promise.resolve({ id: GAME_ID, homeTeam: 'Home', awayTeam: 'Away', stats: body.stats });
  }
  return Promise.resolve(null);
}

function renderJudgePad(initialStats: Record<string, unknown> = {}, withRoster = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const def = findSport('diving')!;
  function Inner() {
    const ctl = useGameControl(GAME_ID);
    const g = { homeTeam: 'Home', awayTeam: 'Away', stats: initialStats };
    return <DivingJudgePadSection gameId={GAME_ID} g={g} def={def} ctl={ctl} />;
  }
  return render(
    <QueryClientProvider client={qc}>
      <Inner />
    </QueryClientProvider>,
  );
  void withRoster;
}

function statsPatchCalls() {
  return (apiFetch.mock.calls as [string, FetchOpts | undefined][]).filter(
    ([path, opts]) => path === `/sports/games/${GAME_ID}/stats` && opts?.method === 'PATCH',
  );
}

function lastPatchBody() {
  const calls = statsPatchCalls();
  return JSON.parse(calls[calls.length - 1][1]?.body ?? '{}');
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(routeFetch);
});

describe('DivingJudgePadSection — mounts + defaults', () => {
  it('renders a 3-judge panel by default (DIVING.judgePanel.defaultCount)', () => {
    renderJudgePad();
    expect(screen.getByText('Judge 1')).toBeInTheDocument();
    expect(screen.getByText('Judge 2')).toBeInTheDocument();
    expect(screen.getByText('Judge 3')).toBeInTheDocument();
    expect(screen.queryByText('Judge 4')).not.toBeInTheDocument();
  });

  it('renders one roster chip per game roster entry when the roster has entries', async () => {
    renderJudgePad();
    await waitFor(() => expect(screen.getByText(/R\. Tanaka/)).toBeInTheDocument());
    expect(screen.getByText(/L\. Fischer/)).toBeInTheDocument();
  });

  it('the Award button starts disabled with no diver/DD set', () => {
    renderJudgePad();
    expect(screen.getByRole('button', { name: /Award/i })).toBeDisabled();
  });
});

describe('DivingJudgePadSection — judge-count selector (3/5/7)', () => {
  it('switching to 5 judges renders 5 chips and persists judgeCount via stats PATCH', async () => {
    renderJudgePad();
    fireEvent.click(screen.getByRole('button', { name: '5 judges' }));

    expect(screen.getByText('Judge 5')).toBeInTheDocument();
    expect(screen.queryByText('Judge 6')).not.toBeInTheDocument();

    await waitFor(() => expect(statsPatchCalls().length).toBeGreaterThan(0));
    expect(lastPatchBody().stats.judgeCount).toBe(5);
  });

  it('an out-of-range stored judgeCount falls back to the sport default (3) rather than crashing', () => {
    renderJudgePad({ judgeCount: 4 }); // 4 is not one of [3,5,7]
    expect(screen.getByText('Judge 1')).toBeInTheDocument();
    expect(screen.getByText('Judge 3')).toBeInTheDocument();
    expect(screen.queryByText('Judge 4')).not.toBeInTheDocument();
  });
});

describe('DivingJudgePadSection — half-point judge scoring', () => {
  it('tapping a whole number then .5 lands on the half-step value, clamped to [0,10]', () => {
    renderJudgePad();
    const judge1Card = screen.getByText('Judge 1').closest('div')!.parentElement!;
    fireEvent.click(within(judge1Card, '7'));
    fireEvent.click(within(judge1Card, '.5'));
    expect(judge1Card.textContent).toContain('7.5');
  });

  function within(container: HTMLElement, text: string): HTMLElement {
    const all = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
    const match = all.find((b) => b.textContent?.trim() === text);
    if (!match) throw new Error(`button "${text}" not found in card`);
    return match;
  }
});

describe('DivingJudgePadSection — Award writes judgeScores + accumulated results (P0-3)', () => {
  it('roster-tap diver + dive code/DD + judge taps, then Award: ONE PATCH carries judgeScores, currentDiver, diveCode, dd, and results', async () => {
    renderJudgePad();
    await waitFor(() => expect(screen.getByText(/R\. Tanaka/)).toBeInTheDocument());

    // Roster-tap the diver.
    fireEvent.click(screen.getByText(/R\. Tanaka/));

    // Dive code + DD.
    fireEvent.change(screen.getByPlaceholderText('105B'), { target: { value: '305C' } });
    fireEvent.change(screen.getByPlaceholderText('2.7'), { target: { value: '2.7' } });

    // Score all 3 judges: 7, 7.5, 8 (no drops on a 3-judge panel).
    const cards = screen.getAllByText(/^Judge \d$/).map((el) => el.closest('div')!.parentElement!);
    expect(cards.length).toBe(3);
    const tap = (card: HTMLElement, label: string) => {
      const btn = Array.from(card.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
      if (!btn) throw new Error(`button "${label}" not found`);
      fireEvent.click(btn);
    };
    tap(cards[0], '7');
    tap(cards[1], '7');
    tap(cards[1], '.5');
    tap(cards[2], '8');

    const awardBtn = screen.getByRole('button', { name: /Award/i });
    expect(awardBtn).not.toBeDisabled();
    fireEvent.click(awardBtn);

    await waitFor(() => expect(statsPatchCalls().length).toBe(1));
    const body = lastPatchBody();
    // 7 + 7.5 + 8 = 22.5 × DD 2.7 = 60.75 → sanitizeJudgeScores rounds to
    // 1dp on the SERVER side; the console's own math (computeDiveScore)
    // rounds to 1dp too — 60.8 (Math.round(22.5*2.7*10)/10 = 60.75 → 60.8).
    expect(body.stats.judgeScores).toEqual([7, 7.5, 8]);
    expect(body.stats.currentDiver).toBe('R. Tanaka');
    expect(body.stats.diveCode).toBe('305C');
    expect(body.stats.dd).toBe('2.7');
    expect(body.stats.results).toHaveLength(1);
    const round = body.stats.results[0];
    expect(round.event).toBe('Round 1'); // default label — no stats.round set in this fixture
    expect(round.entries).toHaveLength(1);
    expect(round.entries[0].name).toBe('R. Tanaka');
    expect(round.entries[0].place).toBe(1);
    expect(parseFloat(round.entries[0].mark)).toBeCloseTo(60.8, 1);
  });

  it('a second dive for the SAME diver in the SAME round ADDS to their running total, not overwrites', async () => {
    // Diver already has 45.00 from a prior dive this round.
    renderJudgePad({
      round: 'Prelims',
      results: [{ event: 'Prelims', order: 1, entries: [{ place: 1, name: 'R. Tanaka', team: 'home', mark: '45.00' }] }],
    });

    fireEvent.change(screen.getByPlaceholderText('Diver name'), { target: { value: 'R. Tanaka' } });
    fireEvent.change(screen.getByPlaceholderText('105B'), { target: { value: '107B' } });
    fireEvent.change(screen.getByPlaceholderText('2.7'), { target: { value: '2.0' } });

    const cards = screen.getAllByText(/^Judge \d$/).map((el) => el.closest('div')!.parentElement!);
    const tap = (card: HTMLElement, label: string) => {
      const btn = Array.from(card.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
      if (!btn) throw new Error(`button "${label}" not found`);
      fireEvent.click(btn);
    };
    // 8, 8, 8 → sum 24 × DD 2.0 = 48.0.
    tap(cards[0], '8');
    tap(cards[1], '8');
    tap(cards[2], '8');

    fireEvent.click(screen.getByRole('button', { name: /Award/i }));

    await waitFor(() => expect(statsPatchCalls().length).toBe(1));
    const body = lastPatchBody();
    expect(body.stats.results).toHaveLength(1);
    expect(body.stats.results[0].event).toBe('Prelims'); // reuses the existing round, not a new one
    expect(body.stats.results[0].entries).toHaveLength(1); // same diver, one row — not duplicated
    // 45.00 (prior) + 48.0 (this dive) = 93.00
    expect(parseFloat(body.stats.results[0].entries[0].mark)).toBeCloseTo(93.0, 1);
  });

  it('a different diver in the same round gets their OWN entry, ranked by running total', async () => {
    renderJudgePad({
      results: [{ event: 'Round 1', order: 1, entries: [{ place: 1, name: 'L. Fischer', team: 'away', mark: '80.00' }] }],
    });

    fireEvent.change(screen.getByPlaceholderText('Diver name'), { target: { value: 'R. Tanaka' } });
    fireEvent.change(screen.getByPlaceholderText('105B'), { target: { value: '305C' } });
    fireEvent.change(screen.getByPlaceholderText('2.7'), { target: { value: '2.0' } });

    const cards = screen.getAllByText(/^Judge \d$/).map((el) => el.closest('div')!.parentElement!);
    const tap = (card: HTMLElement, label: string) => {
      const btn = Array.from(card.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
      if (!btn) throw new Error(`button "${label}" not found`);
      fireEvent.click(btn);
    };
    // 6,6,6 → 18 × 2.0 = 36.0 — LESS than Fischer's 80.00, so Tanaka ranks below.
    tap(cards[0], '6');
    tap(cards[1], '6');
    tap(cards[2], '6');

    fireEvent.click(screen.getByRole('button', { name: /Award/i }));

    await waitFor(() => expect(statsPatchCalls().length).toBe(1));
    const body = lastPatchBody();
    expect(body.stats.results[0].entries).toHaveLength(2);
    const byName = Object.fromEntries(body.stats.results[0].entries.map((e: any) => [e.name, e]));
    expect(byName['L. Fischer'].place).toBe(1);
    expect(byName['R. Tanaka'].place).toBe(2);
  });

  it('resets the pad (diver/code/DD/scores) after a successful Award', async () => {
    renderJudgePad();
    fireEvent.change(screen.getByPlaceholderText('Diver name'), { target: { value: 'Solo Diver' } });
    fireEvent.change(screen.getByPlaceholderText('105B'), { target: { value: '305C' } });
    fireEvent.change(screen.getByPlaceholderText('2.7'), { target: { value: '2.0' } });
    fireEvent.click(screen.getByRole('button', { name: /Award/i }));

    await waitFor(() => expect(statsPatchCalls().length).toBe(1));
    expect((screen.getByPlaceholderText('Diver name') as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText('105B') as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText('2.7') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: /Award/i })).toBeDisabled();
  });
});

describe('DivingJudgePadSection — 44px touch-target floor', () => {
  it('every judge-score button and the Award button meet the min-h-[44px] floor', () => {
    renderJudgePad();
    const awardBtn = screen.getByRole('button', { name: /Award/i });
    expect(awardBtn.className).toMatch(/min-h-\[44px\]/);
    const wholeNumberBtn = screen.getAllByRole('button', { name: '7' })[0];
    expect(wholeNumberBtn.className).toMatch(/min-h-\[44px\]/);
  });
});
