/**
 * Settings → Locations (§7.3).
 *
 * The behaviours extracted from DistrictSchoolsCard that must not regress:
 * the DISTRICT_ADMIN gate (a SCHOOL_ADMIN fires no children request), the
 * empty-children state that tells the truth about the primary account, and
 * the two-tap archive from the 2026-08-30 launch fixes.
 */
import { screen, fireEvent, waitFor } from '@testing-library/react';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: any) => apiFetch(path, opts),
}));

let role = 'DISTRICT_ADMIN';
const uiState = () => ({ user: { role, tenantVertical: 'K12' } });
jest.mock('@/store/ui-store', () => ({
  useUIStore: Object.assign((sel: any) => sel(uiState()), {
    getState: () => uiState(),
    setState: () => {},
  }),
}));

jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'springfield' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/springfield/settings/locations',
}));

import { renderInShell } from './testHarness';
import { SettingsLocationsPage } from '../LocationsPage';

const TENANT = { id: 't1', name: 'Springfield District', address: '742 Evergreen Terrace', vertical: 'K12' };

function routes(children: any[] = []) {
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/tenants') return TENANT;
    if (path === '/tenants/children') return { districtId: 't1', children };
    return { success: true };
  });
}

beforeEach(() => {
  role = 'DISTRICT_ADMIN';
  apiFetch.mockReset();
});

it('a SCHOOL_ADMIN gets the permission page and fires no children request', async () => {
  role = 'SCHOOL_ADMIN';
  routes();
  renderInShell(<SettingsLocationsPage />);
  expect(await screen.findByText(/don’t have access to Locations/)).toBeInTheDocument();
  expect(apiFetch.mock.calls.map((c) => c[0])).not.toContain('/tenants/children');
});

it('names the primary account as a location when there are no children', async () => {
  routes([]);
  renderInShell(<SettingsLocationsPage />);
  expect(await screen.findByText('Springfield District')).toBeInTheDocument();
  expect(screen.getByText('Primary')).toBeInTheDocument();
  expect(
    screen.getByText('No other locations yet. Everything runs under the primary account.'),
  ).toBeInTheDocument();
  // Archiving is explained rather than implied.
  expect(screen.getByText(/Removing a location archives it/)).toBeInTheDocument();
});

it('removes a child only on the SECOND tap, through the archive endpoint', async () => {
  routes([
    { id: 'c1', name: 'Lincoln High', slug: 'lincoln-high', createdAt: '2026-01-01T00:00:00.000Z', _count: { screens: 4, users: 2 } },
  ]);
  renderInShell(<SettingsLocationsPage />);

  const remove = await screen.findByRole('button', { name: 'Remove Lincoln High' });
  fireEvent.click(remove);
  // Armed, not archived.
  expect(apiFetch.mock.calls.filter((c) => String(c[0]).includes('/archive'))).toHaveLength(0);
  expect(await screen.findByText('Remove?')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Remove Lincoln High' }));
  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith('/tenants/c1/archive', expect.objectContaining({ method: 'POST' })),
  );
});

it('creates a child through POST /tenants/children with a silently derived slug', async () => {
  routes([]);
  renderInShell(<SettingsLocationsPage />);

  fireEvent.click(await screen.findByRole('button', { name: /Add a location/ }));
  fireEvent.change(await screen.findByLabelText('Location name'), { target: { value: 'Lincoln High' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create location' }));

  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith('/tenants/children', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Lincoln High', slug: 'lincoln-high' }),
    })),
  );
});
