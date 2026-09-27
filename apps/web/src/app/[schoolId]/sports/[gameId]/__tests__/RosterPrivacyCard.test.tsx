/**
 * K-12 launch audit F38 — the roster panel's "What public screens show about
 * players" card. The API enforces the policy on the public board payload
 * (apps/api/src/sports/roster-privacy.spec.ts); this proves the operator can
 * actually set it: it loads the current setting and each change PATCHes the
 * whole policy the API expects.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

import { RosterPrivacyCard } from '../RosterPrivacyCard';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RosterPrivacyCard gameId="g1" />
    </QueryClientProvider>,
  );
}

const ALL_ON = { names: 'full', numbers: true, photos: true, positions: true, stats: true };

beforeEach(() => {
  apiFetch.mockReset();
});

it('loads the game\'s current setting', async () => {
  apiFetch.mockResolvedValueOnce({ ...ALL_ON, names: 'last', photos: false });
  mount();
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'Names' }) as HTMLSelectElement).value).toBe('last'));
  expect(screen.getByRole('checkbox', { name: 'Photos' })).not.toBeChecked();
  expect(screen.getByText('Public screens show less than the roster')).toBeInTheDocument();
  expect(apiFetch).toHaveBeenCalledWith('/sports/games/g1/roster-privacy');
});

it('hiding photos PATCHes the full policy', async () => {
  apiFetch.mockResolvedValueOnce(ALL_ON);
  mount();
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Photos' })).toBeChecked());
  apiFetch.mockResolvedValueOnce({ ...ALL_ON, photos: false });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Photos' }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
  const [path, opts] = apiFetch.mock.calls[1];
  expect(path).toBe('/sports/games/g1/roster-privacy');
  expect(opts.method).toBe('PATCH');
  expect(JSON.parse(opts.body)).toEqual({ ...ALL_ON, photos: false });
});

it('names can be hidden entirely', async () => {
  apiFetch.mockResolvedValueOnce(ALL_ON);
  mount();
  await waitFor(() => expect(screen.getByText('Showing everything on the roster')).toBeInTheDocument());
  apiFetch.mockResolvedValueOnce({ ...ALL_ON, names: 'hidden' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Names' }), { target: { value: 'hidden' } });
  await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toMatchObject({ names: 'hidden' });
});

it('points staff at the district\'s FERPA directory-information policy', async () => {
  apiFetch.mockResolvedValueOnce(ALL_ON);
  mount();
  expect(screen.getByRole('link', { name: 'Our FERPA commitments' })).toHaveAttribute('href', '/ferpa');
});
