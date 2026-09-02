/**
 * People & access editor (Settings Command Center §7.8, 2026-09-02).
 *
 * Mocked at `apiFetch` rather than at the hooks, so the REAL use-api hooks
 * run with their REAL URLs and bodies — that is what proves the invite
 * fallback reads the server's `emailDelivered:false` and that the rank
 * mirror decides which row controls exist.
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

let caller = { id: 'me', role: 'DISTRICT_ADMIN', tenantVertical: 'K12' };
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ user: caller }),
}));

import { PeopleAccessEditor } from '../PeopleAccessEditor';

const ME = { id: 'me', email: 'me@x.edu', role: 'DISTRICT_ADMIN', firstName: 'Dee', lastName: 'Admin', mfaRequired: true, mfaEnrolled: true, status: 'ACTIVE' };
const PEER = { id: 'peer', email: 'peer@x.edu', role: 'DISTRICT_ADMIN', firstName: null, lastName: null, mfaRequired: false, mfaEnrolled: false, status: 'ACTIVE' };
const JUNIOR = { id: 'jr', email: 'jr@x.edu', role: 'CONTRIBUTOR', firstName: 'Jo', lastName: 'Junior', mfaRequired: false, mfaEnrolled: false, status: 'ACTIVE' };
const INVITED = { id: 'inv', email: 'new@x.edu', role: 'CONTRIBUTOR', firstName: null, lastName: null, mfaRequired: false, mfaEnrolled: false, status: 'INVITED' };

function mockApi(users: unknown[], overrides: Record<string, unknown> = {}) {
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/users') return users;
    if (path === '/tenants/me/content-approval') return { enabled: false };
    if (path in overrides) return overrides[path];
    return {};
  });
}

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PeopleAccessEditor ssoManageable ssoHref="/t1/settings/people/sso" securityHref="/t1/settings/security" />
    </QueryClientProvider>,
  );
}

/** The <li> that holds a given member's row. */
function rowFor(email: string): HTMLElement {
  const cell = screen.getAllByText(email)[0];
  const li = cell.closest('li');
  if (!li) throw new Error(`no row for ${email}`);
  return li as HTMLElement;
}

beforeEach(() => {
  caller = { id: 'me', role: 'DISTRICT_ADMIN', tenantVertical: 'K12' };
  apiFetch.mockReset();
});

it('hides every lifecycle control on a PEER row and on the caller’s own row', async () => {
  mockApi([ME, PEER, JUNIOR]);
  renderEditor();
  await screen.findByText('jr@x.edu');

  // A DISTRICT_ADMIN may not act on another DISTRICT_ADMIN (canAssignRole says
  // no) — the server would 403, so no button is rendered at all.
  const peer = rowFor('peer@x.edu');
  expect(within(peer).queryByRole('button')).toBeNull();
  expect(within(peer).getByRole('combobox')).toBeDisabled();

  // Nor on themselves: self-delete / self-demotion stay blocked.
  const self = rowFor('me@x.edu');
  expect(within(self).queryByRole('button')).toBeNull();
  expect(within(self).getByRole('combobox')).toBeDisabled();

  // A junior row keeps all three actions and an editable role.
  const junior = rowFor('jr@x.edu');
  expect(within(junior).getByRole('combobox')).toBeEnabled();
  expect(within(junior).getAllByRole('button').length).toBe(3);
});

it('never offers SUPER_ADMIN in the invite role picker', async () => {
  mockApi([JUNIOR]);
  renderEditor();
  fireEvent.click(screen.getByRole('button', { name: /invite user/i }));
  const select = await screen.findByLabelText('Role');
  const values = Array.from(select.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
  expect(values).not.toContain('SUPER_ADMIN');
  expect(values).toContain('CONTRIBUTOR');
});

it('shows the copyable accept link when the API reports email was not delivered', async () => {
  mockApi([JUNIOR]);
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/users') return [JUNIOR];
    if (path === '/tenants/me/content-approval') return { enabled: false };
    if (path === '/invites') return { emailDelivered: false, acceptUrl: 'https://app.example/accept/tok123' };
    return {};
  });
  renderEditor();

  fireEvent.click(screen.getByRole('button', { name: /invite user/i }));
  fireEvent.click(await screen.findByRole('button', { name: /email invite link/i }));
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'new@x.edu' } });
  fireEvent.click(screen.getByRole('button', { name: /send invitation/i }));

  const field = await screen.findByLabelText('Invitation accept link');
  expect(field).toHaveValue('https://app.example/accept/tok123');
  expect(screen.getByText(/Outbound email is not configured/i)).toBeInTheDocument();
});

it('reports a real invite as sent, with no copy-link fallback', async () => {
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/users') return [JUNIOR];
    if (path === '/tenants/me/content-approval') return { enabled: false };
    if (path === '/invites') return { emailDelivered: true, acceptUrl: 'https://app.example/accept/tok123' };
    return {};
  });
  renderEditor();

  fireEvent.click(screen.getByRole('button', { name: /invite user/i }));
  fireEvent.click(await screen.findByRole('button', { name: /email invite link/i }));
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'new@x.edu' } });
  fireEvent.click(screen.getByRole('button', { name: /send invitation/i }));

  await screen.findByText('Invitation sent to new@x.edu.');
  expect(screen.queryByLabelText('Invitation accept link')).toBeNull();
});

it('gives every row a labelled cell for each column, so <768px reads as a card and not a table', async () => {
  mockApi([JUNIOR]);
  renderEditor();
  await screen.findByText('jr@x.edu');
  const row = rowFor('jr@x.edu');
  // No <table> anywhere: the labels ARE the small-screen header.
  expect(document.querySelector('table')).toBeNull();
  ['Person', 'Role', 'Access', 'Actions'].forEach((label) => {
    expect(within(row).getAllByText(label).length).toBeGreaterThan(0);
  });
});

it('filters by search text and by account status', async () => {
  mockApi([JUNIOR, INVITED]);
  renderEditor();
  await screen.findByText('jr@x.edu');

  fireEvent.change(screen.getByLabelText('Search team members'), { target: { value: 'new@' } });
  await waitFor(() => expect(screen.queryByText('jr@x.edu')).toBeNull());
  expect(screen.getAllByText('new@x.edu').length).toBeGreaterThan(0);

  fireEvent.change(screen.getByLabelText('Search team members'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Filter by account status'), { target: { value: 'DISABLED' } });
  await screen.findByText('No team member matches those filters.');
});

it('lists an INVITED account under Pending invitations and says what the API cannot tell us', async () => {
  mockApi([JUNIOR, INVITED]);
  renderEditor();
  await screen.findByText('jr@x.edu');
  const heading = screen.getByRole('heading', { name: 'Pending invitations' });
  const section = heading.closest('section') as HTMLElement;
  expect(within(section).getAllByText('new@x.edu').length).toBeGreaterThan(0);
  expect(within(section).getByText(/no expiry, resend or revoke endpoint/i)).toBeInTheDocument();
});

it('states the MFA policy count and points personal enrollment at My security', async () => {
  mockApi([ME, JUNIOR]);
  renderEditor();
  expect(await screen.findByText('1 of 2 accounts are required to use two-factor authentication.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'My security' })).toHaveAttribute('href', '/t1/settings/security');
});

it('hides the SSO subsection from a caller who cannot read the SSO config', async () => {
  mockApi([JUNIOR]);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PeopleAccessEditor ssoManageable={false} ssoHref="/t1/settings/people/sso" securityHref="/t1/settings/security" />
    </QueryClientProvider>,
  );
  await screen.findByText('jr@x.edu');
  expect(screen.queryByRole('link', { name: 'Manage SSO' })).toBeNull();
});
