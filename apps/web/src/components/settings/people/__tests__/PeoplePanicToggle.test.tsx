/**
 * People & access — "Emergency alerts" switch (2026-10-11, Greg's decision).
 *
 * The first web caller of PUT /users/:id/can-trigger-panic. Mocked at
 * `apiFetch` so the REAL hook runs with its REAL URL and body; the confirm
 * dialog is mocked so the test can answer it.
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
const appConfirm = jest.fn();
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: (opts: unknown) => appConfirm(opts),
}));

let caller = { id: 'me', role: 'SCHOOL_ADMIN', tenantVertical: 'K12' };
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ user: caller }),
}));

import { PeopleAccessEditor } from '../PeopleAccessEditor';

const base = { firstName: null, lastName: null, mfaRequired: false, mfaEnrolled: false, status: 'ACTIVE' };
const ME = { ...base, id: 'me', email: 'me@x.edu', role: 'SCHOOL_ADMIN', canTriggerPanic: false };
const PEER = { ...base, id: 'peer', email: 'peer@x.edu', role: 'SCHOOL_ADMIN', canTriggerPanic: false };
const EDITOR = { ...base, id: 'ed', email: 'frontdesk@x.edu', role: 'CONTRIBUTOR', canTriggerPanic: false };
const DELEGATED = { ...base, id: 'del', email: 'security@x.edu', role: 'CONTRIBUTOR', canTriggerPanic: true };
const VIEWER = { ...base, id: 'vw', email: 'viewer@x.edu', role: 'RESTRICTED_VIEWER', canTriggerPanic: false };
const OLD_API = { ...base, id: 'old', email: 'old@x.edu', role: 'CONTRIBUTOR' }; // no canTriggerPanic field

function mockApi(users: unknown[]) {
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/users') return users;
    if (path === '/tenants/me/content-approval') return { enabled: false };
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

beforeEach(() => {
  caller = { id: 'me', role: 'SCHOOL_ADMIN', tenantVertical: 'K12' };
  apiFetch.mockReset();
  appConfirm.mockReset();
});

it('shows the switch only on Editors I manage — never on myself, a peer admin, a viewer, or an older API', async () => {
  mockApi([ME, PEER, EDITOR, DELEGATED, VIEWER, OLD_API]);
  renderEditor();
  await screen.findAllByText('frontdesk@x.edu');
  expect(within(rowFor('frontdesk@x.edu')).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  expect(within(rowFor('security@x.edu')).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  for (const email of ['me@x.edu', 'peer@x.edu', 'viewer@x.edu', 'old@x.edu']) {
    expect(within(rowFor(email)).queryByRole('switch')).toBeNull();
  }
});

it('turning it ON asks first, in plain words, then PUTs the capability', async () => {
  mockApi([EDITOR]);
  appConfirm.mockResolvedValue(true);
  renderEditor();
  fireEvent.click(await screen.findByRole('switch'));
  await waitFor(() => expect(appConfirm).toHaveBeenCalledTimes(1));
  const opts = appConfirm.mock.calls[0][0];
  expect(opts.title).toBe('Let frontdesk@x.edu trigger emergency alerts?');
  expect(opts.message).toMatch(/lockdown, evacuation or weather alert/);
  expect(opts.confirmLabel).toBe('Yes, allow alerts');
  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith('/users/ed/can-trigger-panic', {
      method: 'PUT',
      body: JSON.stringify({ canTriggerPanic: true }),
    }),
  );
});

it('cancelling the confirmation changes nothing', async () => {
  mockApi([EDITOR]);
  appConfirm.mockResolvedValue(false);
  renderEditor();
  fireEvent.click(await screen.findByRole('switch'));
  await waitFor(() => expect(appConfirm).toHaveBeenCalled());
  expect(apiFetch.mock.calls.some(([p]) => String(p).includes('can-trigger-panic'))).toBe(false);
});

it('turning it OFF says they will be signed out, then PUTs false', async () => {
  mockApi([DELEGATED]);
  appConfirm.mockResolvedValue(true);
  renderEditor();
  fireEvent.click(await screen.findByRole('switch'));
  await waitFor(() => expect(appConfirm).toHaveBeenCalled());
  expect(appConfirm.mock.calls[0][0].message).toMatch(/signed out/);
  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith('/users/del/can-trigger-panic', {
      method: 'PUT',
      body: JSON.stringify({ canTriggerPanic: false }),
    }),
  );
});
