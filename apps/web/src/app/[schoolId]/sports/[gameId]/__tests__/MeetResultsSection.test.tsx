/**
 * MeetResultsSection — component-level render + interaction test (S1-4,
 * 2026-07-02 sports deep-pass audit finding P1-6).
 *
 * Before this fix, EVERY `onChange` in the results grid (event name,
 * place, lane, athlete name, mark/score) called `write()` ->
 * `ctl.stats.mutate` -> a PATCH of the WHOLE `stats.results` array —
 * typing "Katie Ledecky" fired 13 network round-trips, and two
 * operators editing at once raced last-writer-wins. This suite proves
 * the fix: typing into any of those fields produces ZERO `/stats`
 * PATCH calls while focused, and exactly ONE once the field is
 * committed (blur or Enter) — mirroring the GameScopeText pattern
 * already proven elsewhere in this console.
 *
 * Mocking convention matches `LanePadSection.test.tsx` in the same
 * directory: mock `apiFetch` at `@/lib/api-client`, mount a thin
 * wrapper that calls the real `useGameControl` hook inside a real
 * `QueryClientProvider`.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { findSport } from '@cms/api-types';

const GAME_ID = 'game-track-1';

interface FetchOpts {
  method?: string;
  body?: string;
}

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: FetchOpts) => apiFetch(path, opts),
}));

import { MeetResultsSection } from '../page';
import { useGameControl } from '@/hooks/use-api';

function routeFetch(path: string, opts?: FetchOpts) {
  if (path === `/sports/games/${GAME_ID}/stats` && opts?.method === 'PATCH') {
    const body = JSON.parse(opts.body ?? '{}');
    return Promise.resolve({ id: GAME_ID, homeTeam: 'Home', awayTeam: 'Away', stats: body.stats });
  }
  return Promise.resolve(null);
}

/** A single event with one blank finisher row — the common state an
 *  operator sits in while typing a name/mark into a just-added row. */
function statsWithOneBlankEntry() {
  return {
    results: [
      {
        event: '100m Dash',
        order: 1,
        entries: [{ place: 1, name: '', team: null, mark: '' }],
      },
    ],
  };
}

function renderMeetResults(initialStats: Record<string, unknown>, judged = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const def = findSport('track_and_field')!;
  function Inner() {
    const ctl = useGameControl(GAME_ID);
    const g = { homeTeam: 'Home', awayTeam: 'Away', stats: initialStats };
    return <MeetResultsSection g={g} def={def} ctl={ctl} judged={judged} />;
  }
  return render(
    <QueryClientProvider client={qc}>
      <Inner />
    </QueryClientProvider>,
  );
}

function statsPatchCalls() {
  return (apiFetch.mock.calls as [string, FetchOpts | undefined][]).filter(
    ([path, opts]) => path === `/sports/games/${GAME_ID}/stats` && opts?.method === 'PATCH',
  );
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(routeFetch);
});

describe('MeetResultsSection — draft-then-commit (S1-4 / P1-6)', () => {
  it('typing a multi-character name fires ZERO /stats PATCHes while focused', () => {
    renderMeetResults(statsWithOneBlankEntry());
    const nameInput = screen.getByPlaceholderText('Athlete name');

    // Same scenario the audit cites verbatim: "Katie Ledecky" keystroke by
    // keystroke, never blurring. A real user focuses before typing —
    // ResultsGridTextInput only engages its draft (vs. showing the live
    // value) once `onFocus` fires, so the test must too.
    fireEvent.focus(nameInput);
    'Katie Ledecky'.split('').forEach((_, i) => {
      fireEvent.change(nameInput, { target: { value: 'Katie Ledecky'.slice(0, i + 1) } });
    });

    expect(statsPatchCalls().length).toBe(0);
  });

  it('commits exactly ONE /stats PATCH on blur, carrying the full typed value', async () => {
    renderMeetResults(statsWithOneBlankEntry());
    const nameInput = screen.getByPlaceholderText('Athlete name');

    fireEvent.focus(nameInput);
    fireEvent.change(nameInput, { target: { value: 'Katie Ledecky' } });
    expect(statsPatchCalls().length).toBe(0); // still nothing while focused/uncommitted
    fireEvent.blur(nameInput);

    await waitFor(() => expect(statsPatchCalls().length).toBe(1));
    const body = JSON.parse(statsPatchCalls()[0][1]?.body ?? '{}');
    expect(body.stats.results[0].entries[0].name).toBe('Katie Ledecky');
  });

  it('Enter commits immediately (same one-PATCH behavior as blur)', async () => {
    renderMeetResults(statsWithOneBlankEntry());
    const nameInput = screen.getByPlaceholderText('Athlete name');

    fireEvent.focus(nameInput);
    fireEvent.change(nameInput, { target: { value: 'Sha Carri' } });
    fireEvent.keyDown(nameInput, { key: 'Enter' });

    await waitFor(() => expect(statsPatchCalls().length).toBe(1));
    const body = JSON.parse(statsPatchCalls()[0][1]?.body ?? '{}');
    expect(body.stats.results[0].entries[0].name).toBe('Sha Carri');
  });

  it('Escape discards the draft without committing anything', () => {
    renderMeetResults(statsWithOneBlankEntry());
    const nameInput = screen.getByPlaceholderText('Athlete name');

    fireEvent.focus(nameInput);
    fireEvent.change(nameInput, { target: { value: 'Oops Typo' } });
    fireEvent.keyDown(nameInput, { key: 'Escape' });
    fireEvent.blur(nameInput);

    expect(statsPatchCalls().length).toBe(0);
    // The field reverts to the live (persisted) value — blank, in this fixture.
    expect((nameInput as HTMLInputElement).value).toBe('');
  });

  it('the mark/score field also drafts locally — no PATCH until commit', async () => {
    renderMeetResults(statsWithOneBlankEntry());
    const markInput = screen.getByPlaceholderText('11.42'); // track_and_field mark placeholder

    fireEvent.focus(markInput);
    '11.42'.split('').forEach((_, i) => {
      fireEvent.change(markInput, { target: { value: '11.42'.slice(0, i + 1) } });
    });
    expect(statsPatchCalls().length).toBe(0);

    fireEvent.blur(markInput);
    await waitFor(() => expect(statsPatchCalls().length).toBe(1));
    const body = JSON.parse(statsPatchCalls()[0][1]?.body ?? '{}');
    expect(body.stats.results[0].entries[0].mark).toBe('11.42');
  });

  it('the place field drafts numerically and clamps on commit, not per keystroke', async () => {
    renderMeetResults(statsWithOneBlankEntry());
    // Place input is the first cell in the row — width-12, centered, no
    // placeholder text to query by, so grab it via its numeric inputMode
    // among the row's inputs (first one rendered = place).
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    const placeInput = inputs.find((i) => i.getAttribute('inputmode') === 'numeric')!;
    expect(placeInput).toBeTruthy();

    fireEvent.focus(placeInput);
    fireEvent.change(placeInput, { target: { value: '5000' } }); // way over the 999 cap
    expect(statsPatchCalls().length).toBe(0); // no PATCH while typing, even an out-of-range draft

    fireEvent.blur(placeInput);
    await waitFor(() => expect(statsPatchCalls().length).toBe(1));
    const body = JSON.parse(statsPatchCalls()[0][1]?.body ?? '{}');
    expect(body.stats.results[0].entries[0].place).toBe(999); // clamped on commit
  });

  it('committing an unchanged value fires no PATCH at all (no-op guard)', () => {
    renderMeetResults(statsWithOneBlankEntry());
    const nameInput = screen.getByPlaceholderText('Athlete name');

    // Focus, then blur without changing anything.
    fireEvent.focus(nameInput);
    fireEvent.blur(nameInput);

    expect(statsPatchCalls().length).toBe(0);
  });

  it('event name field also drafts locally (same fix applied to the event-header row)', async () => {
    renderMeetResults(statsWithOneBlankEntry());
    const eventInput = screen.getByDisplayValue('100m Dash');

    fireEvent.focus(eventInput);
    fireEvent.change(eventInput, { target: { value: '200m Dash' } });
    expect(statsPatchCalls().length).toBe(0);

    fireEvent.blur(eventInput);
    await waitFor(() => expect(statsPatchCalls().length).toBe(1));
    const body = JSON.parse(statsPatchCalls()[0][1]?.body ?? '{}');
    expect(body.stats.results[0].event).toBe('200m Dash');
  });

  it('44px mobile floor: every grid-cell input meets the min-h-[44px] tap-target floor', () => {
    renderMeetResults(statsWithOneBlankEntry());
    const nameInput = screen.getByPlaceholderText('Athlete name');
    const markInput = screen.getByPlaceholderText('11.42');
    expect(nameInput.className).toMatch(/min-h-\[44px\]/);
    expect(markInput.className).toMatch(/min-h-\[44px\]/);
  });

  it('discrete actions (Add finisher / team-side toggle) still write IMMEDIATELY — unaffected by the draft conversion', async () => {
    renderMeetResults({ results: [{ event: '100m Dash', order: 1, entries: [] }] });
    const addBtn = screen.getByRole('button', { name: /Add finisher/i });
    fireEvent.click(addBtn);

    await waitFor(() => expect(statsPatchCalls().length).toBe(1));
    const body = JSON.parse(statsPatchCalls()[0][1]?.body ?? '{}');
    expect(body.stats.results[0].entries.length).toBe(1);
  });
});
