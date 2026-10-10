/**
 * People & access — change someone's email, one-time setup links, and the
 * setup-links CSV (2026-10-10). Mocked at `apiFetch`, so the REAL hooks run
 * with their REAL URLs and bodies.
 */
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: unknown) => apiFetch(path, opts),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
const caller = { id: 'me', role: 'DISTRICT_ADMIN', tenantVertical: 'CORPORATE' };
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ user: caller }),
}));

import { PeopleAccessEditor } from '../PeopleAccessEditor';

const ME = { id: 'me', email: 'ops@riot.test', role: 'DISTRICT_ADMIN', firstName: 'Ops', lastName: null, mfaRequired: true, mfaEnrolled: true, status: 'ACTIVE' };
const MANAGER = { id: 'mgr', email: 'dana@riot.test', role: 'SCHOOL_ADMIN', firstName: 'Dana', lastName: null, mfaRequired: false, mfaEnrolled: false, status: 'ACTIVE' };
const STARTER = { id: 'starter', email: 'riot-tulsa@riotcolor.com', role: 'SCHOOL_ADMIN', firstName: null, lastName: null, mfaRequired: false, mfaEnrolled: false, status: 'ACTIVE', mustSetupCredentials: true };
const PENDING = {
  accounts: [
    { id: 'starter', email: 'riot-tulsa@riotcolor.com', role: 'SCHOOL_ADMIN', status: 'ACTIVE', firstName: null, lastName: null, tenantId: 'tulsa', tenantName: 'RIOT Tulsa', hasTwoStep: false, link: 'none', linkExpiresAt: null },
  ],
};

function mockApi(overrides: Record<string, (opts: any) => unknown> = {}) {
  apiFetch.mockImplementation(async (path: string, opts?: any) => {
    if (path in overrides) return overrides[path](opts);
    if (path === '/users') return [ME, MANAGER, STARTER];
    if (path === '/users/setup-links') return PENDING;
    if (path === '/tenants/me/content-approval') return { enabled: false };
    return {};
  });
}

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PeopleAccessEditor ssoManageable ssoHref="/t/settings/people/sso" securityHref="/t/settings/security" />
    </QueryClientProvider>,
  );
}

const ROW_MGR = 'dana@riot.test';
const ROW_STARTER = 'riot-tulsa@riotcolor.com';
const rowFor = (email: string) => screen.getAllByText(email)[0].closest('li') as HTMLElement;
const body = (opts: any) => JSON.parse(opts?.body ?? '{}');

beforeEach(() => apiFetch.mockReset());

describe('Change email', () => {
  it('is offered on a manageable member — not on yourself, and not on an account still on starter credentials', async () => {
    mockApi();
    renderEditor();
    await screen.findByText('dana@riot.test');
    expect(within(rowFor('dana@riot.test')).getByRole('button', { name: /change email/i })).toBeInTheDocument();
    expect(within(rowFor('ops@riot.test')).queryByRole('button', { name: /change email/i })).toBeNull();
    expect(within(rowFor('riot-tulsa@riotcolor.com')).queryByRole('button', { name: /change email/i })).toBeNull();
  });

  it('verification OFF: one submit applies it and says it was not verified', async () => {
    mockApi({
      '/users/mgr/email/code': () => ({ required: false }),
      '/users/mgr/email': (opts) => ({ ok: true, email: body(opts).email, verified: false, sessionsRevoked: true }),
    });
    renderEditor();
    await screen.findByText('dana@riot.test');
    fireEvent.click(within(rowFor('dana@riot.test')).getByRole('button', { name: /change email/i }));
    fireEvent.change(within(rowFor(ROW_MGR)).getByLabelText('New email'), { target: { value: 'Dana.R@riot.test' } });
    fireEvent.change(within(rowFor(ROW_MGR)).getByLabelText('Your password'), { target: { value: 'my-own-pw' } });
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^change email$/i }).find((b) => b.getAttribute('type') === 'submit')!); });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/users/mgr/email', expect.objectContaining({ method: 'PUT' })));
    const put = apiFetch.mock.calls.find((c) => c[0] === '/users/mgr/email')!;
    expect(body(put[1])).toEqual({ email: 'dana.r@riot.test', password: 'my-own-pw' });
    expect(await screen.findByText(/not verified/i)).toBeInTheDocument();
  });

  it('verification ON: sends a code to the new address, then applies with it', async () => {
    mockApi({
      '/users/mgr/email/code': () => ({ required: true, sent: true }),
      '/users/mgr/email': (opts) => ({ ok: true, email: body(opts).email, verified: true, sessionsRevoked: true }),
    });
    renderEditor();
    await screen.findByText('dana@riot.test');
    fireEvent.click(within(rowFor('dana@riot.test')).getByRole('button', { name: /change email/i }));
    fireEvent.change(within(rowFor(ROW_MGR)).getByLabelText('New email'), { target: { value: 'dana.r@riot.test' } });
    fireEvent.change(within(rowFor(ROW_MGR)).getByLabelText('Your password'), { target: { value: 'my-own-pw' } });
    const submit = () => screen.getAllByRole('button', { name: /^change email$/i }).find((b) => b.getAttribute('type') === 'submit')!;
    await act(async () => { fireEvent.click(submit()); });
    expect(await screen.findByText(/We emailed a 6-digit code to dana.r@riot.test/)).toBeInTheDocument();
    expect(apiFetch.mock.calls.some((c) => c[0] === '/users/mgr/email')).toBe(false);
    fireEvent.change(screen.getByLabelText('Code from the email'), { target: { value: '424 242' } });
    await act(async () => { fireEvent.click(submit()); });
    const put = apiFetch.mock.calls.find((c) => c[0] === '/users/mgr/email')!;
    expect(body(put[1])).toEqual({ email: 'dana.r@riot.test', password: 'my-own-pw', code: '424242' });
    expect(await screen.findByText(/is now the sign-in email\. They have been signed out everywhere/)).toBeInTheDocument();
  });

  it('a wrong password is explained in place and the panel stays open', async () => {
    mockApi({
      '/users/mgr/email/code': () => { throw Object.assign(new Error('Password is incorrect.'), { code: 'ACCOUNT_ADMIN_BAD_PASSWORD', status: 403 }); },
    });
    renderEditor();
    await screen.findByText('dana@riot.test');
    fireEvent.click(within(rowFor('dana@riot.test')).getByRole('button', { name: /change email/i }));
    fireEvent.change(within(rowFor(ROW_MGR)).getByLabelText('New email'), { target: { value: 'dana.r@riot.test' } });
    fireEvent.change(within(rowFor(ROW_MGR)).getByLabelText('Your password'), { target: { value: 'typo' } });
    const submit = screen.getAllByRole('button', { name: /^change email$/i }).find((b) => b.getAttribute('type') === 'submit')!;
    await act(async () => { fireEvent.click(submit); });
    expect(await screen.findByText('Your password is incorrect.')).toBeInTheDocument();
    expect(screen.getByLabelText('New email')).toBeInTheDocument();
  });
});

describe('Setup links', () => {
  it('makes a one-time link for an account still on starter credentials and shows it to copy', async () => {
    mockApi({
      '/users/starter/setup-link': () => ({ ok: true, userId: 'starter', email: 'riot-tulsa@riotcolor.com', url: 'https://app.test/setup-account/TOKEN', expiresAt: '2026-10-17T00:00:00.000Z' }),
    });
    renderEditor();
    await screen.findAllByText('riot-tulsa@riotcolor.com');
    expect(within(rowFor('dana@riot.test')).queryByRole('button', { name: /setup link/i })).toBeNull();
    fireEvent.click(within(rowFor('riot-tulsa@riotcolor.com')).getByRole('button', { name: /setup link/i }));
    fireEvent.change(within(rowFor(ROW_STARTER)).getByLabelText('Your password'), { target: { value: 'my-own-pw' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /make link/i })); });
    expect(body(apiFetch.mock.calls.find((c) => c[0] === '/users/starter/setup-link')![1])).toEqual({ password: 'my-own-pw' });
    expect(await screen.findByDisplayValue('https://app.test/setup-account/TOKEN')).toBeInTheDocument();
  });

  it('lists accounts that still owe their first sign-in and downloads a CSV of fresh links', async () => {
    const created: string[] = [];
    (global as any).URL.createObjectURL = jest.fn((b: Blob) => { created.push('blob'); return 'blob:x'; });
    (global as any).URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    mockApi({
      '/users/setup-links/bulk': () => ({
        links: [{ userId: 'starter', email: 'riot-tulsa@riotcolor.com', firstName: null, lastName: null, location: 'RIOT Tulsa', role: 'SCHOOL_ADMIN', url: 'https://app.test/setup-account/T1', expiresAt: '2026-10-17T00:00:00.000Z' }],
        skipped: [],
      }),
    });
    renderEditor();
    expect(await screen.findByText('First sign-in links')).toBeInTheDocument();
    expect(screen.getByText('1 account still needs its first sign-in.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your password', { selector: '#people-bulk-password' }), { target: { value: 'my-own-pw' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /download links/i })); });
    expect(body(apiFetch.mock.calls.find((c) => c[0] === '/users/setup-links/bulk')![1])).toEqual({ password: 'my-own-pw' });
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(created).toHaveLength(1);
    expect(await screen.findByText('Downloaded 1 link.')).toBeInTheDocument();
    click.mockRestore();
  });
});
