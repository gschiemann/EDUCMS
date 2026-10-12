/**
 * People & access — "Locations & screens" (2026-10-11, user scoping).
 *
 * Mocked at `apiFetch` so the REAL hooks run with their REAL URLs and bodies:
 * GET /users/:id/access seeds the panel, PUT /users/:id/access saves it.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: unknown) => apiFetch(path, opts),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: jest.fn() }));

let caller = { id: 'me', role: 'DISTRICT_ADMIN', tenantVertical: 'RETAIL' };
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ user: caller }),
}));

import { PeopleAccessEditor } from '../PeopleAccessEditor';

const base = { firstName: null, lastName: null, mfaRequired: false, mfaEnrolled: false, status: 'ACTIVE', canTriggerPanic: false };
const MANAGER = { ...base, id: 'mgr', email: 'regional@riot.test', role: 'SCHOOL_ADMIN', extraLocationCount: 2, screenLimited: false };
const LOBBY = { ...base, id: 'lob', email: 'lobby@riot.test', role: 'CONTRIBUTOR', extraLocationCount: 0, screenLimited: true };
const ORG_ADMIN = { ...base, id: 'oa', email: 'owner@riot.test', role: 'DISTRICT_ADMIN' };
const OLD_API = { ...base, id: 'old', email: 'old@riot.test', role: 'CONTRIBUTOR' };

const ACCESS = {
  user: { id: 'lob', email: 'lobby@riot.test', role: 'CONTRIBUTOR', homeTenantId: 'loc-a' },
  scopable: true,
  canEditLocations: true,
  locations: [
    { id: 'loc-a', name: 'Cleveland', isHome: true, granted: true, scopeEditable: true },
    { id: 'loc-b', name: 'Akron', isHome: false, granted: false, scopeEditable: true },
  ],
  screenScopes: { 'loc-a': { screenIds: [], screenGroupIds: ['grp-lobby'] } },
  options: {
    'loc-a': {
      screens: [
        { id: 'scr-1', name: 'Lobby left', screenGroupId: 'grp-lobby' },
        { id: 'scr-2', name: 'Gym wall', screenGroupId: null },
      ],
      groups: [{ id: 'grp-lobby', name: 'Lobby' }],
    },
  },
};

function mockApi(users: unknown[], access: unknown = ACCESS) {
  apiFetch.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (path === '/users') return users;
    if (path === '/tenants/me/content-approval') return { enabled: false };
    if (/^\/users\/[^/]+\/access$/.test(path) && (!opts?.method || opts.method === 'GET')) return access;
    if (/^\/users\/[^/]+\/access$/.test(path) && opts?.method === 'PUT') return { success: true, changed: true };
    return {};
  });
}

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PeopleAccessEditor ssoManageable={false} ssoHref="/t1/settings/people/sso" securityHref="/t1/settings/security" />
    </QueryClientProvider>,
  );
}

function rowFor(email: string): HTMLElement {
  const li = screen.getAllByText(email)[0].closest('li');
  if (!li) throw new Error(`no row for ${email}`);
  return li as HTMLElement;
}

type Opts = { method?: string; body?: string } | undefined;
const isPut = (o: unknown) => (o as Opts)?.method === 'PUT';
const putBody = () => JSON.parse(String((apiFetch.mock.calls.find(([, o]) => isPut(o))![1] as Opts)?.body));

beforeEach(() => {
  caller = { id: 'me', role: 'DISTRICT_ADMIN', tenantVertical: 'RETAIL' };
  apiFetch.mockReset();
});

it('shows "+N locations" / "Limited to screens" pills from the list counts, nothing for an older API', async () => {
  mockApi([MANAGER, LOBBY, OLD_API]);
  renderEditor();
  await screen.findAllByText('regional@riot.test');
  expect(within(rowFor('regional@riot.test')).getByText('+2 locations')).toBeInTheDocument();
  expect(within(rowFor('lobby@riot.test')).getByText('Limited to screens')).toBeInTheDocument();
  expect(within(rowFor('old@riot.test')).queryByText(/locations|Limited to screens/)).toBeNull();
});

it('offers "Locations & screens" only for location roles I manage — never an org admin', async () => {
  mockApi([MANAGER, LOBBY, ORG_ADMIN]);
  renderEditor();
  await screen.findAllByText('lobby@riot.test');
  expect(within(rowFor('lobby@riot.test')).getByRole('button', { name: /Locations & screens/ })).toBeInTheDocument();
  expect(within(rowFor('regional@riot.test')).getByRole('button', { name: /Locations & screens/ })).toBeInTheDocument();
  expect(within(rowFor('owner@riot.test')).queryByRole('button', { name: /Locations & screens/ })).toBeNull();
});

it('org admin: loads the person\'s access, adds a location, limits screens, and PUTs exactly that', async () => {
  mockApi([LOBBY]);
  renderEditor();
  fireEvent.click(await screen.findByRole('button', { name: /Locations & screens/ }));
  expect(await screen.findByText('Locations & screens for lobby@riot.test')).toBeInTheDocument();
  expect(apiFetch).toHaveBeenCalledWith('/users/lob/access', undefined);

  // Home is always on and cannot be unticked.
  const home = screen.getByRole('checkbox', { name: /Cleveland/ });
  expect(home).toBeChecked();
  expect(home).toBeDisabled();
  // Seeded from the server: limited to the Lobby group.
  expect(screen.getByRole('checkbox', { name: 'Lobby' })).toBeChecked();
  expect(screen.getByText(/Emergency alerts are never limited/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('checkbox', { name: /Akron/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Gym wall' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save access' }));

  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/users/lob/access', expect.objectContaining({ method: 'PUT' })));
  expect(putBody()).toEqual({
    locationIds: ['loc-b'],
    screenScopes: { 'loc-a': { screenIds: ['scr-2'], screenGroupIds: ['grp-lobby'] } },
  });
  expect(await screen.findByRole('status')).toHaveTextContent('Access saved for lobby@riot.test.');
});

it('unticking every screen sends "no limit" (null) for that location', async () => {
  mockApi([LOBBY]);
  renderEditor();
  fireEvent.click(await screen.findByRole('button', { name: /Locations & screens/ }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Lobby' }));
  expect(screen.getByText(/Every screen/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save access' }));
  await waitFor(() => expect(apiFetch.mock.calls.some(([, o]) => isPut(o))).toBe(true));
  expect(putBody().screenScopes).toEqual({ 'loc-a': null });
});

it('location admin: locations are read-only and explained; screen limits still editable', async () => {
  caller = { id: 'me', role: 'SCHOOL_ADMIN', tenantVertical: 'RETAIL' };
  mockApi([LOBBY], { ...ACCESS, canEditLocations: false, locations: [ACCESS.locations[0]] });
  renderEditor();
  fireEvent.click(await screen.findByRole('button', { name: /Locations & screens/ }));
  expect(await screen.findByText(/Only an organization admin can change which locations/)).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /Akron/ })).toBeNull();
  expect(screen.getByRole('checkbox', { name: 'Gym wall' })).toBeEnabled();
});

it('an unscopable person (the server says so) gets the explanation and no save button', async () => {
  mockApi([LOBBY], { ...ACCESS, scopable: false });
  renderEditor();
  fireEvent.click(await screen.findByRole('button', { name: /Locations & screens/ }));
  expect(await screen.findByText(/Organization admins already reach every location/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save access' })).toBeNull();
});

it('a refused save shows the server\'s words as an alert', async () => {
  mockApi([LOBBY]);
  apiFetch.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (path === '/users') return [LOBBY];
    if (path === '/users/lob/access' && opts?.method === 'PUT') throw new Error('Only an organization admin can change which locations a person can use.');
    if (path === '/users/lob/access') return ACCESS;
    return {};
  });
  renderEditor();
  fireEvent.click(await screen.findByRole('button', { name: /Locations & screens/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save access' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Only an organization admin');
});

it('says the screen-limit rule once and folds screenless locations into one line (2026-10-12)', async () => {
  const access = {
    ...ACCESS,
    locations: [
      ...ACCESS.locations,
      { id: 'loc-c', name: 'Chicago', isHome: false, granted: true, scopeEditable: true },
      { id: 'loc-d', name: 'Cincinnati', isHome: false, granted: true, scopeEditable: true },
    ],
    options: {
      ...ACCESS.options,
      'loc-c': { screens: [], groups: [] },
      'loc-d': { screens: [], groups: [] },
    },
  };
  mockApi([LOBBY], access);
  renderEditor();
  fireEvent.click(await screen.findByRole('button', { name: /Locations & screens/ }));
  await screen.findByText('Locations & screens for lobby@riot.test');
  // The rule appears exactly once, not under every location.
  expect(screen.getAllByText(/Emergency alerts are never limited/)).toHaveLength(1);
  expect(screen.getByText('No screens yet: Chicago, Cincinnati')).toBeInTheDocument();
  // Only Cleveland (which has screens) gets a picker.
  expect(screen.queryByText(/Screens in Chicago/)).toBeNull();
  expect(screen.getByText(/Screens in Cleveland/)).toBeInTheDocument();
});
