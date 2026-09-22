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

// ── Per-tenant MFA enforcement (2026-09-11) ────────────────────────────────
// Greg: "i want people to have the options but for my riot accounts, leave it
// turned on, we will keep that security so just new customers."
//
// These run the REAL hook, so they also prove the dashboard resolves the
// posture through the SAME shared `effectiveMfaEnforced` the API gate uses.
it('shows the organization as ENFORCING when the tenant says so, and offers to make it optional', async () => {
  mockApi([JUNIOR], { '/tenants': { id: 't1', mfaEnforced: true, mfaEnforcedEffective: true } });
  renderEditor();
  expect(await screen.findByText('Two-factor required')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Make two-factor optional' })).toBeEnabled();
});

it('shows OPTIONAL for a tenant that never stated a preference (the new-customer default)', async () => {
  // A brand-new tenant's column is NULL. The shared resolver answers
  // "optional", which is the whole operator decision.
  mockApi([JUNIOR], { '/tenants': { id: 't1', mfaEnforced: null, mfaEnforcedEffective: false } });
  renderEditor();
  expect(await screen.findByText('Two-factor optional')).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Require two-factor' })).toBeEnabled(),
  );
});

it('never claims "optional" before the answer has arrived', async () => {
  // `enforced` is false while the tenant query is in flight. Painting that as
  // a posture would tell an operator their organization is not enforcing a
  // second factor when we have not yet asked.
  apiFetch.mockImplementation(
    (path: string) =>
      path === '/tenants' ? new Promise(() => {}) : Promise.resolve(path === '/users' ? [JUNIOR] : {}),
  );
  renderEditor();
  await screen.findByText('jr@x.edu');
  expect(screen.queryByText('Two-factor optional')).toBeNull();
  expect(screen.getByRole('button', { name: 'Require two-factor' })).toBeDisabled();
});

it('resolves LOCALLY when an older API build omits the derived field', async () => {
  mockApi([JUNIOR], { '/tenants': { id: 't1', mfaEnforced: true } });
  renderEditor();
  expect(await screen.findByText('Two-factor required')).toBeInTheDocument();
});

it('PUTs the new posture and never shows success optimistically', async () => {
  mockApi([JUNIOR], { '/tenants': { id: 't1', mfaEnforced: false, mfaEnforcedEffective: false } });
  renderEditor();
  const btn = await screen.findByRole('button', { name: 'Require two-factor' });
  await waitFor(() => expect(btn).toBeEnabled());
  fireEvent.click(btn);
  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith(
      '/tenants/me/mfa-enforced',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ enabled: true }) }),
    ),
  );
});

it('says plainly that nobody is signed out', async () => {
  mockApi([JUNIOR], { '/tenants': { id: 't1', mfaEnforced: true, mfaEnforcedEffective: true } });
  renderEditor();
  expect(
    await screen.findByText(/does not sign anyone out.*next sign-in/i),
  ).toBeInTheDocument();
});

it('a SCHOOL_ADMIN can READ the setting but cannot flip it', async () => {
  // The write is DISTRICT_ADMIN+ (server-enforced): a SCHOOL_ADMIN is inside
  // the set of accounts the policy covers, so they must not repeal it. The
  // control renders DISABLED rather than as a button that 403s.
  caller = { id: 'me', role: 'SCHOOL_ADMIN', tenantVertical: 'K12' };
  mockApi([JUNIOR], { '/tenants': { id: 't1', mfaEnforced: true, mfaEnforcedEffective: true } });
  renderEditor();
  expect(await screen.findByText('Two-factor required')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Make two-factor optional' })).toBeDisabled();
  expect(
    screen.getAllByText('Only a district administrator can change this for the whole organization.').length,
  ).toBeGreaterThan(0);
});

// ── Reset two-factor sign-in (2026-09-21) ─────────────────────────────────
//
// The lockout lever that did not exist: `mfaTotp*: null` had one writer in the
// product and it acted on the CALLER, so an admin who lost their phone and had
// spent their backup codes was locked out for good.
//
// These run the REAL `useResetUserMfa` against the mocked `apiFetch`, so they
// also prove the URL, the method and the body the server actually receives.

const TOTP_ONLY = { ...JUNIOR, id: 'totp', email: 'totp@x.edu', mfaEnrolled: true, mfaMethods: ['totp'] };
const PASSKEY_ONLY = { ...JUNIOR, id: 'pk', email: 'pk@x.edu', mfaEnrolled: true, mfaMethods: ['passkey'] };
const BOTH = { ...JUNIOR, id: 'both', email: 'both@x.edu', mfaEnrolled: true, mfaMethods: ['totp', 'passkey'] };

/** Open the reset panel on a row and return the row element. */
async function openResetPanel(email: string): Promise<HTMLElement> {
  await screen.findByText(email);
  const row = rowFor(email);
  fireEvent.click(within(row).getByRole('button', { name: 'Reset 2FA' }));
  return row;
}

it('names the second factors a person actually holds, not a bare "2FA"', async () => {
  // A passkey-only account used to read as "not set up" here — the wrong
  // thing to show an admin who is deciding what to reset.
  mockApi([TOTP_ONLY, PASSKEY_ONLY, BOTH, JUNIOR]);
  renderEditor();
  await screen.findByText('totp@x.edu');

  expect(within(rowFor('totp@x.edu')).getByText('Authenticator app')).toBeInTheDocument();
  expect(within(rowFor('pk@x.edu')).getByText('Passkey')).toBeInTheDocument();
  expect(within(rowFor('both@x.edu')).getByText('Authenticator app + passkey')).toBeInTheDocument();
  expect(within(rowFor('jr@x.edu')).getByText('Not set up')).toBeInTheDocument();
});

it('falls back to the old boolean when an older API build omits mfaMethods', async () => {
  // `mfaMethods` is optional on the wire. Reading its absence as "no methods"
  // would hide the reset action from exactly the enrolled user an admin is
  // trying to help.
  mockApi([{ ...JUNIOR, mfaEnrolled: true }]);
  renderEditor();
  const row = await screen.findByText('jr@x.edu').then(() => rowFor('jr@x.edu'));
  expect(within(row).getByText('Authenticator app')).toBeInTheDocument();
  expect(within(row).getByRole('button', { name: 'Reset 2FA' })).toBeInTheDocument();
});

it('offers the reset only on a row with a factor to remove, and never on a peer or on self', async () => {
  mockApi([ME, PEER, JUNIOR, TOTP_ONLY]);
  renderEditor();
  await screen.findByText('totp@x.edu');

  // Nothing to reset → no action (the server would do nothing).
  expect(within(rowFor('jr@x.edu')).queryByRole('button', { name: 'Reset 2FA' })).toBeNull();
  expect(within(rowFor('jr@x.edu')).getAllByRole('button').length).toBe(3);

  // Enrolled AND manageable → the fourth action appears.
  expect(within(rowFor('totp@x.edu')).getAllByRole('button').length).toBe(4);

  // A PEER is enrolled but not manageable; so is the caller's own row (ME is
  // mfaEnrolled). Neither may be reset from here — the server would refuse.
  expect(within(rowFor('peer@x.edu')).queryByRole('button')).toBeNull();
  expect(within(rowFor('me@x.edu')).queryByRole('button')).toBeNull();
});

it('spells out the blast radius, and what does NOT change, before asking for a password', async () => {
  mockApi([TOTP_ONLY]);
  renderEditor();
  await openResetPanel('totp@x.edu');

  expect(screen.getByText('Reset two-factor sign-in for totp@x.edu?')).toBeInTheDocument();
  expect(
    screen.getByText(
      'This removes their authenticator app and any passkeys and signs them out everywhere. Their password does not change. They will set two-factor up again the next time they sign in.',
    ),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Reason (optional)')).toBeInTheDocument();
  // The admin's OWN password, and it is masked.
  const pw = screen.getByLabelText('Your password');
  expect(pw).toHaveAttribute('type', 'password');
  expect(screen.getByText('Yours, not theirs — it confirms this is really you.')).toBeInTheDocument();
  // Nothing can be submitted until a password is typed.
  expect(screen.getByRole('button', { name: 'Reset two-factor sign-in' })).toBeDisabled();
});

it('POSTs the admin password and the reason, then confirms and refetches the list', async () => {
  let listCalls = 0;
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/users') { listCalls++; return [TOTP_ONLY]; }
    if (path === '/tenants/me/content-approval') return { enabled: false };
    if (path === '/users/totp/mfa/reset') return { ok: true, hadTotp: true, passkeysRemoved: 0, sessionsRevoked: true };
    return {};
  });
  renderEditor();
  await openResetPanel('totp@x.edu');
  await waitFor(() => expect(listCalls).toBeGreaterThan(0));
  const before = listCalls;

  fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'Lost phone' } });
  fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'my-own-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset two-factor sign-in' }));

  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith(
      '/users/totp/mfa/reset',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ password: 'my-own-password', reason: 'Lost phone' }),
      }),
    ),
  );

  // A plain confirmation, and the panel closes.
  await screen.findByText(
    'Two-factor sign-in was reset for totp@x.edu. They have been signed out everywhere.',
  );
  expect(screen.queryByLabelText('Your password')).toBeNull();
  // The list is refetched, so the row's status cannot stay stale.
  await waitFor(() => expect(listCalls).toBeGreaterThan(before));
});

it('a WRONG password keeps the panel open with the message, and resets nothing', async () => {
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/users') return [TOTP_ONLY];
    if (path === '/tenants/me/content-approval') return { enabled: false };
    if (path === '/users/totp/mfa/reset') {
      // The exact shape api-client.ts attaches to a non-2xx response.
      throw Object.assign(new Error('Password is incorrect.'), {
        status: 403,
        code: 'USER_MFA_RESET_BAD_PASSWORD',
      });
    }
    return {};
  });
  renderEditor();
  await openResetPanel('totp@x.edu');

  fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'wrong' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset two-factor sign-in' }));

  expect(await screen.findByRole('alert')).toHaveTextContent("That password isn't right.");
  // STILL OPEN — a typo is corrected in place, not by re-finding the row. And
  // the success banner never appeared.
  expect(screen.getByLabelText('Your password')).toBeInTheDocument();
  expect(screen.queryByText(/was reset for/)).toBeNull();
});

it('translates the other refusals by CODE, never by message text', async () => {
  type ApiError = Error & { status?: number; code?: string };
  let failure: ApiError | null = null;
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/users') return [TOTP_ONLY];
    if (path === '/tenants/me/content-approval') return { enabled: false };
    if (path === '/users/totp/mfa/reset') throw failure;
    return {};
  });

  const cases: Array<[ApiError, RegExp]> = [
    [Object.assign(new Error('x'), { status: 409, code: 'PASSWORD_REQUIRED' }), /identity provider/i],
    [Object.assign(new Error('x'), { status: 404, code: 'USER_NOT_FOUND' }), /no longer available/i],
    [Object.assign(new Error('x'), { status: 429 }), /Too many attempts/i],
  ];

  for (const [err, expected] of cases) {
    failure = err;
    const view = renderEditor();
    await openResetPanel('totp@x.edu');
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset two-factor sign-in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    view.unmount();
  }
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
