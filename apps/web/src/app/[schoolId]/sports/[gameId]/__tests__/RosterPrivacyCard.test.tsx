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
// K-12 launch, lane B3: the card also reads the SCHOOL's student-privacy
// policy. It is answered here, off to the side, so `apiFetch` keeps counting
// only the per-game setting's calls these tests are about.
let schoolPolicy: unknown = { applies: false, names: { allowed: true }, photos: { allowed: true } };
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...args: unknown[]) =>
    args[0] === '/sports/student-privacy' ? Promise.resolve(schoolPolicy) : apiFetch(...args),
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
  schoolPolicy = { applies: false, names: { allowed: true }, photos: { allowed: true } };
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

// Found on the real stack (Playwright uncheck() saw the box not move): the
// switch has to move the moment it is clicked, not a tick later when the
// query cache catches up.
it('a switch moves immediately, before the save answers', async () => {
  apiFetch.mockResolvedValueOnce(ALL_ON);
  mount();
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Photos' })).toBeChecked());
  apiFetch.mockReturnValueOnce(new Promise(() => undefined)); // the PATCH never answers
  fireEvent.click(screen.getByRole('checkbox', { name: 'Photos' }));
  expect(screen.getByRole('checkbox', { name: 'Photos' })).not.toBeChecked();
});

it('a failed save puts the switch back to what is really saved and says so', async () => {
  apiFetch.mockResolvedValueOnce(ALL_ON);
  mount();
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Photos' })).toBeChecked());
  apiFetch.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Photos' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not save — try again'));
  expect(screen.getByRole('checkbox', { name: 'Photos' })).toBeChecked();
});

it('points staff at the district\'s FERPA directory-information policy', async () => {
  apiFetch.mockResolvedValueOnce(ALL_ON);
  mount();
  expect(screen.getByRole('link', { name: 'Our FERPA commitments' })).toHaveAttribute('href', '/ferpa');
});

// K-12 launch, lane B3 — the per-game switches can only hide MORE than the
// school's own policy; when the school's policy is the stricter one, the card
// says so instead of implying "Full name" would show a name.
it("says when the school's policy hides students — the switches can only hide more", async () => {
  schoolPolicy = { applies: true, names: { allowed: false }, photos: { allowed: false } };
  apiFetch.mockResolvedValueOnce(ALL_ON);
  mount();
  await waitFor(() =>
    expect(screen.getByTestId('roster-privacy-school-note')).toHaveTextContent(
      "Your school's policy hides students' names and photos on public screens. These switches can only hide more.",
    ),
  );
});

it('says nothing extra at a venue the policy does not apply to', async () => {
  apiFetch.mockResolvedValueOnce(ALL_ON);
  mount();
  await waitFor(() => expect(screen.getByText('Showing everything on the roster')).toBeInTheDocument());
  expect(screen.queryByTestId('roster-privacy-school-note')).toBeNull();
});
