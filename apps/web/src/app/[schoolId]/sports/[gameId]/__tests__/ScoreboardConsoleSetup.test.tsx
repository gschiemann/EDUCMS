/**
 * K12-F32 — Set up game → Scoreboard console: pick a model that decodes the
 * sport and the screen wired to the console, see what it sends, confirm —
 * no kiosk URL, no feed token, and a sport with no decoder says so.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ScoreboardConsoleView } from '@/hooks/use-api';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { ScoreboardConsoleSetup } from '../ScoreboardConsoleSetup';

const MODELS = [
  { id: 'cts-gen6', label: 'Colorado Time Systems (Gen 6 / System 6)', source: 'Colorado Time Systems console', supported: false, supportedSportNames: ['Water Polo'] },
  { id: 'daktronics-allsport', label: 'Daktronics All Sport 5000', source: 'Daktronics All Sport', supported: true, supportedSportNames: ['Football', 'Basketball', 'Baseball', 'Softball'] },
];

function view(over: Partial<ScoreboardConsoleView> = {}): ScoreboardConsoleView {
  return {
    gameId: 'g1',
    sport: 'basketball',
    sportName: 'Basketball',
    final: false,
    supported: true,
    models: MODELS,
    screens: [
      { id: 'box-1', name: 'Gym box', online: true, consoleProfile: null, otherGame: null },
      { id: 'box-2', name: 'Field box', online: false, consoleProfile: null, otherGame: { id: 'g9', label: 'Hawks vs Owls' } },
    ],
    binding: null,
    preview: null,
    link: null,
    serverTime: Date.now(),
    ...over,
  };
}

const bound = (over: Partial<NonNullable<ScoreboardConsoleView['binding']>> = {}) => ({
  screenId: 'box-1',
  screenName: 'Gym box',
  screenOnline: true,
  consoleProfile: 'daktronics-allsport',
  modelLabel: 'Daktronics All Sport 5000',
  decoderSport: 'basketball',
  supportedSportNames: ['Football', 'Basketball', 'Baseball', 'Softball'],
  boundAt: new Date(Date.now() - 30_000).toISOString(),
  confirmedAt: null,
  ...over,
});

function mount(stats: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ScoreboardConsoleSetup gameId="g1" stats={stats} />
    </QueryClientProvider>,
  );
}

beforeEach(() => apiFetch.mockReset());

it('a sport no console decodes says so — no model picker, no default sport', async () => {
  apiFetch.mockResolvedValueOnce(view({ sport: 'volleyball', sportName: 'Volleyball', supported: false, models: MODELS.map((m) => ({ ...m, supported: false })) }));
  mount();
  expect(await screen.findByTestId('scoreboard-console-unsupported')).toHaveTextContent(
    'No scoreboard console decodes Volleyball yet.',
  );
  expect(screen.queryByTestId('scoreboard-console-model')).not.toBeInTheDocument();
});

it('offers only the models that read the sport, names the screens honestly, and connects with no URL', async () => {
  apiFetch.mockResolvedValueOnce(view());
  mount();
  const modelSelect = (await screen.findByTestId('scoreboard-console-model')) as HTMLSelectElement;
  const offered = Array.from(modelSelect.options).map((o) => o.value).filter(Boolean);
  expect(offered).toEqual(['daktronics-allsport']);
  expect(modelSelect).toHaveTextContent('Daktronics All Sport 5000 — reads Football, Basketball, Baseball, Softball only');
  const screenSelect = screen.getByTestId('scoreboard-console-screen');
  expect(screenSelect).toHaveTextContent('Field box — reads the console for Hawks vs Owls');

  expect(screen.getByTestId('scoreboard-console-connect')).toBeDisabled();
  fireEvent.change(modelSelect, { target: { value: 'daktronics-allsport' } });
  fireEvent.change(screenSelect, { target: { value: 'box-1' } });
  apiFetch.mockResolvedValueOnce(view({ binding: bound() }));
  fireEvent.click(screen.getByTestId('scoreboard-console-connect'));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
  expect(apiFetch.mock.calls[1][0]).toBe('/sports/games/g1/scoreboard-console');
  expect(apiFetch.mock.calls[1][1].method).toBe('POST');
  expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual({ screenId: 'box-1', consoleProfile: 'daktronics-allsport' });
  expect(await screen.findByTestId('scoreboard-console-state')).toHaveTextContent(
    'Waiting for Gym box to start reading the console',
  );
});

it('shows what the console sends, and confirming POSTs the confirmation', async () => {
  apiFetch.mockResolvedValueOnce(
    view({
      binding: bound(),
      link: { reportedAt: new Date().toISOString(), status: 'connected', bytes: 2048, goodFrames: 9, badFrames: 0, native: true },
      preview: {
        receivedAt: new Date().toISOString(),
        screenId: 'box-1',
        decoderSport: 'basketball',
        clockMs: 435_000,
        clockRunning: true,
        segment: 2,
        homeScore: 45,
        awayScore: 38,
      },
    }),
  );
  mount();
  const preview = await screen.findByTestId('scoreboard-console-preview');
  expect(preview).toHaveTextContent('7:15');
  expect(preview).toHaveTextContent('45');
  expect(preview).toHaveTextContent('38');
  expect(screen.getByTestId('scoreboard-console-state')).toHaveAttribute('data-state', 'preview');

  apiFetch.mockResolvedValueOnce(view({ binding: bound({ confirmedAt: new Date().toISOString() }) }));
  fireEvent.click(screen.getByTestId('scoreboard-console-confirm'));
  await waitFor(() => expect(apiFetch.mock.calls.some((c) => c[0] === '/sports/games/g1/scoreboard-console/confirm')).toBe(true));
  // Confirmed, and the game record has nothing from the console yet: it says so.
  expect(await screen.findByText(/The console has not sent anything since you confirmed it/)).toBeInTheDocument();
});

it('after confirmation the game record decides: live while the console is fresh', async () => {
  apiFetch.mockResolvedValueOnce(view({ binding: bound({ confirmedAt: new Date().toISOString() }) }));
  mount({ cts: { lastUpdateAt: new Date(Date.now() - 1_000).toISOString() } });
  expect(await screen.findByTestId('scoreboard-console-state')).toHaveAttribute('data-state', 'live');
  expect(screen.getByTestId('scoreboard-console-state')).toHaveTextContent('Live from the console');
});

it('a refused bind shows the server’s reason; Disconnect deletes the binding', async () => {
  apiFetch.mockResolvedValueOnce(view());
  mount();
  fireEvent.change(await screen.findByTestId('scoreboard-console-model'), { target: { value: 'daktronics-allsport' } });
  fireEvent.change(screen.getByTestId('scoreboard-console-screen'), { target: { value: 'box-1' } });
  apiFetch.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'CONSOLE_SPORT_UNSUPPORTED' }));
  fireEvent.click(screen.getByTestId('scoreboard-console-connect'));
  expect(await screen.findByRole('alert')).toHaveTextContent('That console cannot read Basketball.');
});

it('Disconnect sends DELETE', async () => {
  apiFetch.mockResolvedValueOnce(view({ binding: bound() }));
  mount();
  apiFetch.mockResolvedValueOnce(view());
  fireEvent.click(await screen.findByTestId('scoreboard-console-disconnect'));
  await waitFor(() =>
    expect(apiFetch.mock.calls.some((c) => c[0] === '/sports/games/g1/scoreboard-console' && c[1]?.method === 'DELETE')).toBe(true),
  );
  expect(await screen.findByTestId('scoreboard-console-model')).toBeInTheDocument();
});
