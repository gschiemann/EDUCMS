/**
 * QA 2026-10-23 — accept-invite moved onto the /login card and the en/es/zh
 * catalogue, and names the role the way the People page does ("Editor", not
 * the raw "CONTRIBUTOR"). Behaviour pinned: client checks, success signs in
 * and lands on the workspace, an org that requires 2FA goes to /login.
 */
import * as React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

const push = jest.fn();
const login = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/components/layout/LanguageMenu', () => ({ LanguageSwitcherInline: () => null }));
jest.mock('@/lib/api-url', () => ({ API_URL: 'http://api.test/api/v1' }));
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: { login: typeof login }) => unknown) => sel({ login }),
}));

import AcceptInvitePage from '../[token]/page';

function settled<T>(value: T): Promise<T> {
  const p = Promise.resolve(value) as Promise<T> & { status?: string; value?: T };
  p.status = 'fulfilled'; p.value = value;
  return p;
}
const res = (ok: boolean, body: unknown) => Promise.resolve({ ok, json: () => Promise.resolve(body) }) as unknown as Promise<Response>;
const PREVIEW = { email: 'pat@example.com', role: 'CONTRIBUTOR', tenantName: 'Lincoln High', expiresAt: '2030-01-01' };

beforeEach(() => { push.mockClear(); login.mockClear(); });

async function open(accept: unknown, acceptOk = true) {
  global.fetch = jest.fn((url: string) => (String(url).endsWith('/accept') ? res(acceptOk, accept) : res(true, PREVIEW))) as unknown as typeof fetch;
  await act(async () => { render(<AcceptInvitePage params={settled({ token: 'tok' })} />); });
}

function fill(a: string, b: string) {
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: a } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: b } });
}

it('shows the workspace and the role by its product name', async () => {
  await open({});
  expect(screen.getByRole('heading', { name: 'Accept your invitation' })).toBeInTheDocument();
  expect(screen.getByText('Lincoln High')).toBeInTheDocument();
  expect(screen.getByText('Editor')).toBeInTheDocument();
  expect(screen.queryByText('CONTRIBUTOR')).not.toBeInTheDocument();
});

it('refuses a mismatch before calling the server', async () => {
  await open({});
  fill('Abcdefgh1!', 'Different1!');
  fireEvent.click(screen.getByRole('button', { name: 'Join workspace' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match.');
  expect((global.fetch as jest.Mock).mock.calls.filter((c) => String(c[0]).endsWith('/accept'))).toHaveLength(0);
});

it('a successful accept signs in and lands on the workspace', async () => {
  await open({ access_token: 'jwt', user: { tenantSlug: 'lincoln-high' } });
  fill('Abcdefgh1!', 'Abcdefgh1!');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Join workspace' })); });
  expect(login).toHaveBeenCalledWith('jwt', { tenantSlug: 'lincoln-high' });
  expect(push).toHaveBeenCalledWith('/lincoln-high/dashboard');
});

it('an organization that requires 2FA continues at /login', async () => {
  await open({ mfaRequired: true });
  fill('Abcdefgh1!', 'Abcdefgh1!');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Join workspace' })); });
  expect(push).toHaveBeenCalledWith('/login?reason=invite-mfa');
});
