/**
 * K12-F36 — the console's automatic-celebration settings card: it loads the
 * game's settings and every change POSTs just that change (the API keeps the
 * rest and applies it on every replica at once).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { AutoCelebrateSettings } from '../AutoCelebrateSettings';

const FOOTBALL = {
  enabled: true,
  off: [] as string[],
  cooldownSec: 0,
  cooldownOptions: [0, 10, 30, 60],
  available: [
    { key: 'touchdown', label: 'Touchdown', emoji: '🏈', points: [6, 7, 8] },
    { key: 'fieldGoal', label: 'Field Goal', emoji: '🏈', points: [3] },
  ],
};

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AutoCelebrateSettings gameId="g1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => apiFetch.mockReset());

it('shows the sport’s automatic cues with their points, and the cooldown', async () => {
  apiFetch.mockResolvedValueOnce(FOOTBALL);
  mount();
  await waitFor(() => expect(screen.getByText('Touchdown')).toBeInTheDocument());
  expect(screen.getByText('6 / 7 / 8 points')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /Celebrate scoring plays automatically/ })).toBeChecked();
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('0');
  expect(apiFetch).toHaveBeenCalledWith('/sports/games/g1/auto-celebrate');
});

it('switching a cue off POSTs the new quiet list; the cooldown POSTs its own change', async () => {
  apiFetch.mockResolvedValueOnce(FOOTBALL);
  mount();
  await waitFor(() => expect(screen.getByText('Field Goal')).toBeInTheDocument());
  apiFetch.mockResolvedValueOnce({ ...FOOTBALL, off: ['fieldGoal'] });
  fireEvent.click(screen.getByRole('checkbox', { name: /Field Goal/ }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
  expect(apiFetch.mock.calls[1][0]).toBe('/sports/games/g1/auto-celebrate');
  expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual({ off: ['fieldGoal'] });
  await waitFor(() => expect(screen.getByRole('checkbox', { name: /Field Goal/ })).not.toBeChecked());

  apiFetch.mockResolvedValueOnce({ ...FOOTBALL, off: ['fieldGoal'], cooldownSec: 30 });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '30' } });
  await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3));
  expect(JSON.parse(apiFetch.mock.calls[2][1].body)).toEqual({ cooldownSec: 30 });
});

it('a sport with no automatic cue says so instead of offering switches', async () => {
  apiFetch.mockResolvedValueOnce({ ...FOOTBALL, available: [] });
  mount();
  await waitFor(() => expect(screen.getByText(/No scoring play in this sport celebrates by itself/)).toBeInTheDocument());
  expect(screen.queryByRole('checkbox')).toBeNull();
});

it('an API from before the settings existed (`{ enabled }` only) renders nothing instead of crashing Setup', async () => {
  apiFetch.mockResolvedValueOnce({ enabled: true });
  const { container } = mount();
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/sports/games/g1/auto-celebrate'));
  await new Promise((r) => setTimeout(r, 50));
  expect(container).toBeEmptyDOMElement();
});
