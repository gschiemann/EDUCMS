/**
 * Muse beta S-04 / DEV-028: editable team abbreviations with a collision
 * warning, saved once on blur (never per keystroke).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({ apiFetch: (p: string, o?: unknown) => apiFetch(p, o) }));

import { TeamAbbrevFields } from '../TeamAbbrevFields';
import { GameStateProvider } from '@/components/widgets/sports/GameStateContext';
import { TeamAbbrWidget } from '@/components/widgets/sports/SportElementWidgets';

function mount(game: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TeamAbbrevFields gameId="g1" game={game} />
    </QueryClientProvider>,
  );
}

beforeEach(() => apiFetch.mockReset().mockResolvedValue({ id: 'g1' }));

it('suggests distinct abbreviations for the beta names that both read MUS', () => {
  mount({ homeTeam: 'Muse Sports Test Home', awayTeam: 'Muse Sports Test Away' });
  expect(screen.getByLabelText('Muse Sports Test Home')).toHaveAttribute('placeholder', 'MSTH');
  expect(screen.getByLabelText('Muse Sports Test Away')).toHaveAttribute('placeholder', 'MSTA');
  expect(screen.queryByTestId('team-abbrev-collision')).toBeNull();
});

it('warns when the two sides would read the same, and saves once on blur', async () => {
  mount({ homeTeam: 'Lions', awayTeam: 'Tigers' });
  const away = screen.getByLabelText('Tigers');
  fireEvent.change(away, { target: { value: 'l' } });
  fireEvent.change(away, { target: { value: 'li' } });
  fireEvent.change(away, { target: { value: 'lio' } });
  expect(screen.getByTestId('team-abbrev-collision')).toHaveTextContent('Both teams would show LIO');
  expect(apiFetch).not.toHaveBeenCalled();
  fireEvent.blur(away);
  await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
  expect(apiFetch).toHaveBeenCalledWith('/sports/games/g1', expect.objectContaining({
    method: 'PATCH', body: JSON.stringify({ awayAbbrev: 'LIO' }),
  }));
});

it('refuses an invalid value inline and sends nothing', () => {
  mount({ homeTeam: 'Lions', awayTeam: 'Tigers' });
  const home = screen.getByLabelText('Lions');
  fireEvent.change(home, { target: { value: 'A-B' } });
  fireEvent.blur(home);
  expect(screen.getByText('Use 1 to 5 letters or digits.')).toBeInTheDocument();
  expect(apiFetch).not.toHaveBeenCalled();
});

it('the team-abbr widget on a live board shows the served abbreviation, not the first three letters', () => {
  const realFetch = (global as any).fetch;
  (global as any).fetch = jest.fn(() => new Promise(() => undefined));
  const snap = {
    id: 'g1', sport: 'basketball', status: 'LIVE', segment: 1,
    homeTeam: 'Muse Sports Test Home', awayTeam: 'Muse Sports Test Away', homeScore: 0, awayScore: 0,
    homeColor: null, awayColor: null, homeLogoUrl: null, awayLogoUrl: null,
    homeAbbrev: 'MSTH', awayAbbrev: 'MSTA',
    clockMs: 0, clockRunning: false, clockUpdatedAt: new Date().toISOString(), stats: {}, serverTime: Date.now(),
  };
  const { container } = render(
    <GameStateProvider gameId="g1" initial={snap as any}>
      <TeamAbbrWidget config={{ team: 'away' } as any} />
    </GameStateProvider>,
  );
  expect(container.textContent).toContain('MSTA');
  expect(container.textContent).not.toContain('MUS');
  (global as any).fetch = realFetch;
});
