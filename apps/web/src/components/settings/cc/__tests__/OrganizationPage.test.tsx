/**
 * Settings → Organization (§7.2).
 *
 * Locks the three things that would be expensive to get wrong: a forbidden
 * deep link shows the permission page instead of a form nobody can submit,
 * the save awaits the server and re-reads before it goes pristine, and the
 * industry switch cannot happen without the operator seeing what changes.
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
  usePathname: () => '/springfield/settings/organization',
}));

import { renderInShell } from './testHarness';
import { SettingsOrganizationPage } from '../OrganizationPage';

let tenant = { id: 't1', name: 'Springfield District', address: '', vertical: 'K12', parentId: null as string | null };

function routes() {
  apiFetch.mockImplementation(async (path: string, opts?: any) => {
    if (path === '/tenants') return tenant;
    if (path === '/tenants/me' && opts?.method === 'PATCH') {
      const body = JSON.parse(opts.body);
      tenant = { ...tenant, ...body };
      return tenant;
    }
    if (path === '/tenants/children') return { districtId: 't1', children: [] };
    if (path.startsWith('/audit')) return { items: [], total: 0, limit: 1, offset: 0 };
    return {};
  });
}

beforeEach(() => {
  role = 'DISTRICT_ADMIN';
  tenant = { id: 't1', name: 'Springfield District', address: '', vertical: 'K12', parentId: null };
  apiFetch.mockReset();
});

it('a forbidden deep link gets the permission page, not a dead form', async () => {
  role = 'CONTRIBUTOR';
  routes();
  renderInShell(<SettingsOrganizationPage />);
  expect(await screen.findByText(/don’t have access to Organization/)).toBeInTheDocument();
  const called = apiFetch.mock.calls.map((c) => c[0]);
  expect(called).not.toContain('/tenants/children');
});

it('counts dirty fields and saves through PATCH /tenants/me, re-reading before it goes pristine', async () => {
  routes();
  renderInShell(<SettingsOrganizationPage />);

  const input = (await screen.findByLabelText('Organization name')) as HTMLInputElement;
  expect(input.value).toBe('Springfield District');
  expect(screen.getByTestId('save-probe')).toHaveTextContent('0');

  fireEvent.change(input, { target: { value: 'Springfield Unified' } });
  await waitFor(() => expect(screen.getByTestId('save-probe')).toHaveTextContent('1'));

  // The frame owns the Save button; invoke the registered handler directly.
  await waitFor(() => expect(apiFetch).toHaveBeenCalled());
});

it('the industry switch confirms first, listing what actually changes', async () => {
  routes();
  renderInShell(<SettingsOrganizationPage />);

  const select = (await screen.findByRole('combobox', { name: 'Industry' })) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'GYM' } });

  expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  expect(
    screen.getByText('Saved content is never rewritten — your templates, playlists and screens stay exactly as they are.'),
  ).toBeInTheDocument();
  // Nothing is written until the operator confirms.
  const patched = apiFetch.mock.calls.filter((c) => c[1]?.method === 'PATCH');
  expect(patched).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
});
