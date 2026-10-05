/**
 * "YOUR PASSKEY MAY BE ON ANOTHER DEVICE" — the second step's states, RTL
 * proof (2026-10-05).
 *
 * Owner (SUPER_ADMIN): his only passkey was made on his Mac. On his iPhone
 * the second step asked for it, iOS showed its cross-device QR code (useless
 * on the phone itself), and nothing else on the page said what would work.
 *
 *   password → { mfaRequired, mfaMethods:['passkey'], mfaFallbacks:[…] }
 *     → "Use your passkey" → the sheet closes with nothing (NotAllowedError)
 *     → "Your passkey may be on another device. Sign in another way on this one:"
 *       + the ways this ACCOUNT has: authenticator code / backup code / email
 *     → "Email me a code" → POST /auth/mfa/challenge/email/send { mfaToken }
 *     → the code → POST /auth/mfa/challenge/email { challenge, code }
 *     → signed in → "Add a passkey for this iPhone" → create() in the tap.
 *
 * Every API call is the global `fetch` (mocked by URL); `@simplewebauthn/
 * browser` is mocked because jsdom has no authenticator.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const push = jest.fn();
const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(''),
}));

const clogInfo = jest.fn();
jest.mock('@/lib/client-logger', () => ({
  clog: { info: (...a: unknown[]) => clogInfo(...a), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/session-client', () => ({
  adoptRememberedSession: () => Promise.resolve(true),
  hasRememberMarker: () => false,
  refreshRememberedSession: () => Promise.resolve(false),
}));

const startAuthentication = jest.fn();
const startRegistration = jest.fn();
jest.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => true,
  browserSupportsWebAuthnAutofill: () => Promise.resolve(false),
  startAuthentication: (...a: unknown[]) => startAuthentication(...a),
  startRegistration: (...a: unknown[]) => startRegistration(...a),
  platformAuthenticatorIsAvailable: () => Promise.resolve(true),
  WebAuthnAbortService: { cancelCeremony: () => undefined },
}));

import LoginPage from '../page';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';
import { __resetPasskeyOfferMemoryForTests } from '@/lib/passkey-offer';

type Reply = { ok?: boolean; status?: number; body?: unknown };
type Call = { url: string; body: Record<string, unknown> | undefined };

/** Route replies by URL suffix, longest match first; a route may be a queue. */
function mockFetchByPath(routes: Record<string, Reply | Reply[]>): Call[] {
  const calls: Call[] = [];
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
  (global as unknown as { fetch: unknown }).fetch = jest.fn((url: string, init?: RequestInit) => {
    if (!String(url).endsWith('/auth/sign-in-options')) {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    }
    const key = keys.find((k) => String(url).endsWith(k));
    const route = key ? routes[key] : undefined;
    const r: Reply = Array.isArray(route) ? (route.length > 1 ? route.shift()! : route[0]) : route ?? { ok: false, status: 404, body: {} };
    return Promise.resolve({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: () => Promise.resolve(r.body ?? {}),
    });
  });
  return calls;
}

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const GRANT = 'Gr4nt_' + 'x'.repeat(35) + '-9';
const USER = { id: 'u1', email: 'owner@venueos.example', role: 'SUPER_ADMIN', tenantSlug: 'hq', tenantId: 't1' };
const SESSION_WITH_GRANT = { access_token: 'tok-email', user: USER, passkeyEnrollment: { grant: GRANT, expiresAt: '2026-10-05T12:10:00Z' } };
const CHALLENGE = 'C'.repeat(43);
const GET_OPTIONS = { challenge: 'Y2hhbGw', rpId: 'venue-os.app' };
const CREATE_OPTIONS = { challenge: 'Y3JlYXRl', rp: { id: 'venue-os.app', name: 'VenueOS' }, user: { id: 'dXNlcg', name: 'a', displayName: 'A' } };

function domError(name: string): Error {
  const e = new Error(`${name} raised`);
  e.name = name;
  return e;
}

/** The owner's account: one passkey (elsewhere), backup codes, mail configured. */
const OWNER_LOGIN = {
  mfaRequired: true,
  mfaToken: 'mfa-1',
  mfaMethods: ['passkey'],
  mfaFallbacks: ['backup', 'email'],
};

async function toSecondStep(loginBody: unknown = OWNER_LOGIN) {
  await act(async () => { render(<LoginPage />); });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@venueos.example' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Continue$/i })); });
  fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i })); });
  void loginBody;
}

/** "Use your passkey" → the iPhone finds none (the QR sheet dismissed). */
async function passkeyMisses() {
  startAuthentication.mockRejectedValue(domError('NotAllowedError'));
  await act(async () => {
    fireEvent.click(await screen.findByRole('button', { name: /Use your passkey/i }));
  });
  await screen.findByTestId('passkey-elsewhere-note');
}

let realUA: PropertyDescriptor | undefined;
beforeAll(() => {
  realUA = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');
  Object.defineProperty(window.navigator, 'userAgent', { value: IPHONE_UA, configurable: true });
});
afterAll(() => {
  if (realUA) Object.defineProperty(window.navigator, 'userAgent', realUA);
});

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  clogInfo.mockReset();
  startAuthentication.mockReset();
  startRegistration.mockReset();
  useUIStore.setState({ token: null, user: null });
  __resetPasskeyOfferMemoryForTests();
  localStorage.clear();
  sessionStorage.clear();
  try { localStorage.setItem('edu_cms_eula_accepted_v1.0', 'yes'); } catch { /* ignore */ }
});

// ───────────────────────────────────────────────────────────────────────
describe('the passkey step is never a dead end', () => {
  it('"Use another way" is visible from the start, before any attempt', async () => {
    mockFetchByPath({ '/auth/login': { body: OWNER_LOGIN } });
    await toSecondStep();
    expect(await screen.findByRole('button', { name: /Use your passkey/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Use another way$/i })).toBeInTheDocument();
    // The step says what it wants — not "enter the code from your authenticator app".
    expect(screen.getByText('Use your passkey to finish signing in.')).toBeInTheDocument();
    // Pressing it replaces the link with the list — and focus follows to the first way.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Use another way$/i })); });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Use a backup code' }));
  });

  it('a sheet that closes with nothing says "may be on another device" and lists THIS account\'s ways — calm, not red', async () => {
    mockFetchByPath({
      '/auth/login': { body: { ...OWNER_LOGIN, mfaMethods: ['passkey', 'totp'] } },
      '/auth/mfa/challenge/passkey/options': { body: { options: GET_OPTIONS } },
    });
    const { container } = render(<div />);
    void container;
    await toSecondStep();
    await passkeyMisses();

    const ways = screen.getByTestId('mfa-other-ways');
    const labels = Array.from(ways.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Enter a code from your authenticator app', 'Use a backup code', 'Email me a code']);
    // The first way holds focus — a keyboard / VoiceOver user lands on what to do next.
    expect(document.activeElement).toBe(ways.querySelector('button'));
    expect(document.querySelector('.bg-rose-50')).toBeNull();
    expect(screen.getByRole('button', { name: /Try your passkey again/i })).toBeInTheDocument();
  });

  it('records WHY in the client log — error name, page host, account has passkeys — and nothing personal', async () => {
    mockFetchByPath({
      '/auth/login': { body: OWNER_LOGIN },
      '/auth/mfa/challenge/passkey/options': { body: { options: GET_OPTIONS } },
    });
    await toSecondStep();
    await passkeyMisses();
    const call = clogInfo.mock.calls.find((c) => c[1] === 'Passkey ceremony ended without a credential');
    expect(call).toBeDefined();
    expect(call![2]).toEqual({
      stage: 'mfa',
      errorName: 'NotAllowedError',
      reason: 'cancelled',
      host: window.location.host,
      accountHasPasskeys: true,
    });
    expect(JSON.stringify(call![2])).not.toContain('owner@venueos.example');
  });

  it('without an emailed code (mail off / fresh reset): the ways it has, plus where the passkey DOES work', async () => {
    mockFetchByPath({
      '/auth/login': { body: { ...OWNER_LOGIN, mfaFallbacks: ['backup'] } },
      '/auth/mfa/challenge/passkey/options': { body: { options: GET_OPTIONS } },
    });
    await toSecondStep();
    await passkeyMisses();
    expect(screen.queryByRole('button', { name: /Email me a code/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Use a backup code/i })).toBeInTheDocument();
    expect(screen.getByTestId('other-way-device-hint')).toHaveTextContent(
      'Or sign in on the device that has your passkey, then add this device in Settings → My security.',
    );
  });

  it('with NO other way at all, it says plainly to use the device that has the passkey', async () => {
    mockFetchByPath({
      '/auth/login': { body: { ...OWNER_LOGIN, mfaFallbacks: [] } },
      '/auth/mfa/challenge/passkey/options': { body: { options: GET_OPTIONS } },
    });
    await toSecondStep();
    await passkeyMisses();
    expect(screen.getByTestId('mfa-other-ways').querySelectorAll('button')).toHaveLength(0);
    expect(screen.getByTestId('other-way-device-hint')).toHaveTextContent(
      'Sign in on the device that has your passkey. Then add a passkey for this device in Settings → My security.',
    );
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('the emailed code — then a passkey for THIS device', () => {
  it('owner\'s path end to end: code by email → signed in → "Add a passkey for this iPhone" → create() inside the tap', async () => {
    const calls = mockFetchByPath({
      '/auth/login': { body: OWNER_LOGIN },
      '/auth/mfa/challenge/passkey/options': { body: { options: GET_OPTIONS } },
      '/auth/mfa/challenge/email/send': { body: { challenge: CHALLENGE, expiresAt: '2026-10-05T12:10:00Z' } },
      '/auth/mfa/challenge/email': { body: SESSION_WITH_GRANT },
      '/auth/passkeys/register/options': { body: { options: CREATE_OPTIONS } },
      '/auth/passkeys/register/verify': { body: { passkey: { id: 'pk-2', label: 'iPhone' } } },
    });
    await toSecondStep();
    await passkeyMisses();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Email me a code/i })); });
    const send = calls.find((c) => c.url === `${API_URL}/auth/mfa/challenge/email/send`);
    expect(send?.body).toEqual({ mfaToken: 'mfa-1' });

    // The code form: says where it went, iOS can fill it from Mail.
    expect(await screen.findByText('We emailed a 6-digit code to owner@venueos.example.')).toBeInTheDocument();
    const input = screen.getByLabelText('Code from the email');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: '482913' } });
    startRegistration.mockResolvedValue({ id: 'cred-iphone', rawId: 'cred-iphone', type: 'public-key', response: {} });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Verify & sign in/i })); });
    const verify = calls.find((c) => c.url === `${API_URL}/auth/mfa/challenge/email`);
    expect(verify?.body).toEqual({ challenge: CHALLENGE, code: '482913' });
    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-email'); });

    // The offer, for THIS device, by name.
    expect(await screen.findByRole('heading', { name: 'Sign in with Face ID or Touch ID next time?' })).toBeInTheDocument();
    expect(screen.getByText('Use Face ID or Touch ID instead of your password and code.')).toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Add a passkey for this iPhone' });
    // Safari: create() must run INSIDE the tap — synchronously, nothing awaited first.
    fireEvent.click(add);
    expect(startRegistration).toHaveBeenCalledTimes(1);
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: CREATE_OPTIONS });
    expect(await screen.findByRole('heading', { name: 'Passkey saved' })).toBeInTheDocument();
    const reg = calls.find((c) => c.url === `${API_URL}/auth/passkeys/register/verify`);
    expect(reg?.body?.label).toBe('iPhone');
  });

  it('a wrong code says how many tries are left, and stays on the code', async () => {
    mockFetchByPath({
      '/auth/login': { body: OWNER_LOGIN },
      '/auth/mfa/challenge/passkey/options': { body: { options: GET_OPTIONS } },
      '/auth/mfa/challenge/email/send': { body: { challenge: CHALLENGE } },
      '/auth/mfa/challenge/email': { ok: false, status: 401, body: { code: 'MFA_EMAIL_CODE_INVALID', attemptsLeft: 4 } },
    });
    await toSecondStep();
    await passkeyMisses();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Email me a code/i })); });
    fireEvent.change(await screen.findByLabelText('Code from the email'), { target: { value: '000000' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Verify & sign in/i })); });
    expect(await screen.findByText("That code doesn't match. 4 tries left.")).toBeInTheDocument();
    expect(screen.getByLabelText('Code from the email')).toBeInTheDocument();
    expect(useUIStore.getState().token).toBeNull();
  });

  it('an expired code says "send a new code", and "Send a new code" does — the newest one is named', async () => {
    const calls = mockFetchByPath({
      '/auth/login': { body: OWNER_LOGIN },
      '/auth/mfa/challenge/passkey/options': { body: { options: GET_OPTIONS } },
      '/auth/mfa/challenge/email/send': [
        { body: { challenge: CHALLENGE } },
        { body: { challenge: 'D'.repeat(43) } },
      ],
      '/auth/mfa/challenge/email': { ok: false, status: 401, body: { code: 'MFA_EMAIL_CODE_EXPIRED' } },
    });
    await toSecondStep();
    await passkeyMisses();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Email me a code/i })); });
    fireEvent.change(await screen.findByLabelText('Code from the email'), { target: { value: '123456' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Verify & sign in/i })); });
    expect(await screen.findByText('This code has expired or was already used. Send a new code.')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Send a new code/i })); });
    expect(await screen.findByText('We sent a new code to owner@venueos.example. Use the newest one.')).toBeInTheDocument();
    expect(calls.filter((c) => c.url.endsWith('/auth/mfa/challenge/email/send'))).toHaveLength(2);
  });

  it('a refused send is the catalog sentence (here: a fresh password reset), and the list stays', async () => {
    mockFetchByPath({
      '/auth/login': { body: OWNER_LOGIN },
      '/auth/mfa/challenge/passkey/options': { body: { options: GET_OPTIONS } },
      '/auth/mfa/challenge/email/send': { ok: false, status: 409, body: { code: 'MFA_EMAIL_CODE_AFTER_RESET', message: 'english' } },
    });
    await toSecondStep();
    await passkeyMisses();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Email me a code/i })); });
    expect(
      await screen.findByText(/Your password was reset recently, so a code by email isn't available for a few days/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('mfa-other-ways')).toBeInTheDocument();
  });

  it('a timed-out sign-in goes back to the password, as every other second-step door does', async () => {
    mockFetchByPath({
      '/auth/login': { body: OWNER_LOGIN },
      '/auth/mfa/challenge/email/send': { ok: false, status: 401, body: { code: 'MFA_TOKEN_INVALID' } },
    });
    await toSecondStep();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /^Use another way$/i })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Email me a code/i })); });
    expect(await screen.findByText(/sign-in attempt timed out/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('an authenticator-only account gets "Email me a code instead" under its code form — only when the API lists it', async () => {
    mockFetchByPath({
      '/auth/login': { body: { mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['totp'], mfaFallbacks: ['backup', 'email'] } },
      '/auth/mfa/challenge/email/send': { body: { challenge: CHALLENGE } },
    });
    await toSecondStep();
    expect(await screen.findByLabelText('Authentication code')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Email me a code instead/i })); });
    expect(await screen.findByLabelText('Code from the email')).toBeInTheDocument();
  });
});
