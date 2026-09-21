/**
 * Passkeys at the login page — RTL proof (2026-09-21).
 *
 * Two entry points, both proved against the FROZEN contract:
 *
 *   SECOND FACTOR   /auth/login → { mfaRequired, mfaToken, mfaMethods }
 *                   → POST /auth/mfa/challenge/passkey/options { mfaToken }
 *                   → navigator.credentials.get()
 *                   → POST /auth/mfa/challenge/passkey { mfaToken, response }
 *                   → the same success payload /auth/mfa/challenge returns.
 *
 *   PASSWORDLESS    POST /auth/passkeys/login/options {}
 *                   → navigator.credentials.get()
 *                   → POST /auth/passkeys/login/verify { challengeId, response, rememberMe }
 *                   → the same payload a successful /auth/login returns —
 *                     WHICH CAN STILL BE ANOTHER STEP.
 *
 * The page talks to the API via the global `fetch` (not apiFetch), so we mock
 * `fetch` and assert exact URLs + bodies. `@simplewebauthn/browser` is mocked
 * because jsdom has no authenticator.
 *
 * The load-bearing test in this file is the LAST describe block: an account
 * with no passkey must see the challenge step that shipped before this wave,
 * unchanged.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(''),
}));

jest.mock('@/lib/client-logger', () => ({
  clog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// "Keep me logged in" trades the access token for an HttpOnly cookie on the
// web origin. That is a real network call on a route jsdom cannot serve, and
// it is not what this suite is about.
// Declared with no implementation so the wrapper below can forward whatever
// arguments the page passes — a `jest.fn(() => …)` is typed at arity 0 and
// tsc rejects the spread.
const adoptRememberedSession = jest.fn();
jest.mock('@/lib/session-client', () => ({
  adoptRememberedSession: (...a: any[]) => adoptRememberedSession(...a),
  hasRememberMarker: () => false,
  refreshRememberedSession: () => Promise.resolve(false),
}));

const browserSupportsWebAuthn = jest.fn();
const startAuthentication = jest.fn();
const startRegistration = jest.fn();
jest.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: (...a: any[]) => browserSupportsWebAuthn(...a),
  startAuthentication: (...a: any[]) => startAuthentication(...a),
  startRegistration: (...a: any[]) => startRegistration(...a),
}));

import LoginPage from '../page';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';

type Reply = { ok?: boolean; status?: number; body?: any };

/** Route replies by exact URL suffix. */
function mockFetchByPath(routes: Record<string, Reply>) {
  const calls: Array<{ url: string; body: any }> = [];
  (global as any).fetch = jest.fn((url: string, init: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
    const key = Object.keys(routes).find((k) => String(url).endsWith(k));
    const r: Reply = key ? routes[key] : { ok: false, status: 404, body: {} };
    return Promise.resolve({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: () => Promise.resolve(r.body ?? {}),
    });
  });
  return calls;
}

const SESSION = {
  access_token: 'tok-passkey',
  user: { id: 'u1', email: 'admin@school.edu', role: 'SCHOOL_ADMIN', tenantSlug: 'lincoln', tenantId: 't1' },
};
const ASSERTION = { id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: {} };
const GET_OPTIONS = { challenge: 'Y2hhbGw', rpId: 'venueos.app' };

async function signInWithPassword() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@school.edu' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i }));
  });
}

/** The white card the whole step renders inside. */
function card(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.rounded-2xl');
  if (!el) throw new Error('login card not found');
  return el as HTMLElement;
}

beforeEach(() => {
  push.mockReset();
  adoptRememberedSession.mockReset();
  adoptRememberedSession.mockResolvedValue(true);
  browserSupportsWebAuthn.mockReset();
  browserSupportsWebAuthn.mockReturnValue(true);
  startAuthentication.mockReset();
  useUIStore.setState({ token: null, user: null });
  try { localStorage.setItem('edu_cms_eula_accepted_v1.0', 'yes'); } catch { /* ignore */ }
});

// ───────────────────────────────────────────────────────────────────────
// SECOND FACTOR
// ───────────────────────────────────────────────────────────────────────
describe('MFA step — passkey as the second factor', () => {
  it("['totp','passkey'] makes the passkey PRIMARY and puts the code behind a link", async () => {
    mockFetchByPath({
      '/auth/login': { body: { mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['totp', 'passkey'] } },
    });

    await act(async () => { render(<LoginPage />); });
    await signInWithPassword();

    // Primary control.
    const passkeyBtn = await screen.findByRole('button', { name: /Use your passkey/i });
    expect(passkeyBtn).toBeInTheDocument();
    // …and it holds focus, because it is the step's primary control.
    expect(document.activeElement).toBe(passkeyBtn);

    // The code form is NOT on screen yet — only the way to it.
    expect(screen.queryByLabelText('Authentication code')).not.toBeInTheDocument();
    const link = screen.getByRole('button', { name: /Use a 6-digit code instead/i });

    // We have NOT signed in.
    expect(useUIStore.getState().token).toBeNull();

    // The link reveals today's form, unchanged.
    await act(async () => { fireEvent.click(link); });
    expect(screen.getByLabelText('Authentication code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Verify & sign in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Use a backup code/i })).toBeInTheDocument();
  });

  it("['passkey'] offers NO code link, but a backup code is still reachable", async () => {
    mockFetchByPath({
      '/auth/login': { body: { mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['passkey'] } },
    });

    await act(async () => { render(<LoginPage />); });
    await signInWithPassword();

    await screen.findByRole('button', { name: /Use your passkey/i });
    expect(screen.queryByRole('button', { name: /Use a 6-digit code instead/i })).not.toBeInTheDocument();

    // A passkey-only user's fallback IS a backup code — if that is not
    // reachable, losing the device is a lockout.
    const backup = screen.getByRole('button', { name: /Use a backup code/i });
    await act(async () => { fireEvent.click(backup); });
    expect(screen.getByLabelText('Backup code')).toBeInTheDocument();
    // …and from that form there is no authenticator app to switch to. The
    // toggle used to be offered here and led to a code box that can only
    // answer MFA_TOTP_NOT_ENABLED (lead's end-to-end run, 2026-09-21).
    expect(screen.queryByRole('button', { name: /Use authenticator code/i })).not.toBeInTheDocument();
  });

  it("['totp','passkey']: the backup-code form still offers the authenticator-code toggle", async () => {
    mockFetchByPath({
      '/auth/login': { body: { mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['totp', 'passkey'] } },
    });
    await act(async () => { render(<LoginPage />); });
    await signInWithPassword();
    await screen.findByRole('button', { name: /Use your passkey/i });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Use a backup code/i })); });
    expect(screen.getByRole('button', { name: /Use authenticator code/i })).toBeInTheDocument();
  });

  it('never auto-invokes the ceremony — Safari needs the tap', async () => {
    mockFetchByPath({
      '/auth/login': { body: { mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['passkey'] } },
      '/auth/mfa/challenge/passkey/options': { body: { options: GET_OPTIONS } },
    });
    startAuthentication.mockResolvedValue(ASSERTION);

    await act(async () => { render(<LoginPage />); });
    await signInWithPassword();
    await screen.findByRole('button', { name: /Use your passkey/i });

    // Arriving on the step must not touch the authenticator: the user
    // activation from the password submit has already expired, and WebKit
    // would reject the call anyway.
    expect(startAuthentication).not.toHaveBeenCalled();
  });

  it('completes the sign-in with the SAME payload /auth/mfa/challenge returns', async () => {
    const calls = mockFetchByPath({
      '/auth/login': { body: { mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['totp', 'passkey'] } },
      '/auth/mfa/challenge/passkey/options': { body: { options: GET_OPTIONS } },
      '/auth/mfa/challenge/passkey': { body: SESSION },
    });
    startAuthentication.mockResolvedValue(ASSERTION);

    await act(async () => { render(<LoginPage />); });
    await signInWithPassword();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Use your passkey/i }));
    });

    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-passkey'); });
    expect(push).toHaveBeenCalledWith('/lincoln/dashboard');

    // The exact contract.
    expect(calls[1].url).toBe(`${API_URL}/auth/mfa/challenge/passkey/options`);
    expect(calls[1].body).toEqual({ mfaToken: 'mfa-1' });
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: GET_OPTIONS });
    expect(calls[2].url).toBe(`${API_URL}/auth/mfa/challenge/passkey`);
    expect(calls[2].body).toEqual({ mfaToken: 'mfa-1', response: ASSERTION });
  });

  it('a 401 says the passkey was not accepted and leaves the step usable', async () => {
    mockFetchByPath({
      '/auth/login': { body: { mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['totp', 'passkey'] } },
      '/auth/mfa/challenge/passkey/options': { body: { options: GET_OPTIONS } },
      '/auth/mfa/challenge/passkey': { ok: false, status: 401, body: { code: 'PASSKEY_VERIFICATION_FAILED' } },
    });
    startAuthentication.mockResolvedValue(ASSERTION);

    await act(async () => { render(<LoginPage />); });
    await signInWithPassword();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Use your passkey/i }));
    });

    expect(await screen.findByText(/That passkey wasn't accepted/i)).toBeInTheDocument();
    expect(useUIStore.getState().token).toBeNull();
    expect(screen.getByRole('button', { name: /Use your passkey/i })).toBeInTheDocument();
  });

  it('a CANCELLED sheet is quiet — no red banner', async () => {
    mockFetchByPath({
      '/auth/login': { body: { mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['passkey'] } },
      '/auth/mfa/challenge/passkey/options': { body: { options: GET_OPTIONS } },
    });
    const cancelled = new Error('The operation either timed out or was not allowed.');
    cancelled.name = 'NotAllowedError';
    startAuthentication.mockRejectedValue(cancelled);

    await act(async () => { render(<LoginPage />); });
    await signInWithPassword();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Use your passkey/i }));
    });

    await waitFor(() => { expect(startAuthentication).toHaveBeenCalled(); });
    expect(screen.queryByText(/wasn't accepted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Too many attempts/i)).not.toBeInTheDocument();
    // Back on the button, still holding the partial token.
    expect(screen.getByRole('button', { name: /Use your passkey/i })).toBeInTheDocument();
  });

  it('an expired mfaToken sends the operator back to the password form', async () => {
    mockFetchByPath({
      '/auth/login': { body: { mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['passkey'] } },
      '/auth/mfa/challenge/passkey/options': { ok: false, status: 401, body: { code: 'MFA_TOKEN_INVALID' } },
    });

    await act(async () => { render(<LoginPage />); });
    await signInWithPassword();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Use your passkey/i }));
    });

    expect(await screen.findByText(/sign-in attempt timed out/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('a browser without WebAuthn never sees the passkey button, even when the account has one', async () => {
    browserSupportsWebAuthn.mockReturnValue(false);
    mockFetchByPath({
      '/auth/login': { body: { mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['totp', 'passkey'] } },
    });

    await act(async () => { render(<LoginPage />); });
    await signInWithPassword();

    expect(await screen.findByLabelText('Authentication code')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Use your passkey/i })).not.toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────
// PASSWORDLESS
// ───────────────────────────────────────────────────────────────────────
describe('Sign-in form — passwordless passkey', () => {
  it('signs in with no email and no password, honouring "Keep me signed in"', async () => {
    const calls = mockFetchByPath({
      '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-9' } },
      '/auth/passkeys/login/verify': { body: SESSION },
    });
    startAuthentication.mockResolvedValue(ASSERTION);

    await act(async () => { render(<LoginPage />); });
    fireEvent.click(screen.getByRole('checkbox', { name: /Keep me signed in/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/i }));
    });

    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-passkey'); });
    expect(push).toHaveBeenCalledWith('/lincoln/dashboard');

    expect(calls[0].url).toBe(`${API_URL}/auth/passkeys/login/options`);
    expect(calls[0].body).toEqual({});
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: GET_OPTIONS });
    expect(calls[1].url).toBe(`${API_URL}/auth/passkeys/login/verify`);
    expect(calls[1].body).toEqual({ challengeId: 'ch-9', response: ASSERTION, rememberMe: true });
    // "Keep me signed in" really did reach the durable-session exchange.
    expect(adoptRememberedSession).toHaveBeenCalledWith('tok-passkey');
  });

  it('sends rememberMe: false when the box is left alone', async () => {
    const calls = mockFetchByPath({
      '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-9' } },
      '/auth/passkeys/login/verify': { body: SESSION },
    });
    startAuthentication.mockResolvedValue(ASSERTION);

    await act(async () => { render(<LoginPage />); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/i }));
    });

    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-passkey'); });
    expect(calls[1].body.rememberMe).toBe(false);
    expect(adoptRememberedSession).not.toHaveBeenCalled();
  });

  it('is gated by the EULA checkbox exactly like Sign in', async () => {
    // No prior acceptance → the box starts unchecked.
    try { localStorage.removeItem('edu_cms_eula_accepted_v1.0'); } catch { /* ignore */ }
    const calls = mockFetchByPath({
      '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-9' } },
      '/auth/passkeys/login/verify': { body: SESSION },
    });
    startAuthentication.mockResolvedValue(ASSERTION);

    await act(async () => { render(<LoginPage />); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/i }));
    });

    // The SAME message the password path gives, and nothing left the browser.
    expect(await screen.findByText(/must accept the End User License Agreement/i)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    expect(startAuthentication).not.toHaveBeenCalled();

    // Accepting it opens the path — a second way in, not a way around.
    fireEvent.click(screen.getByRole('checkbox', { name: /End User License Agreement/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/i }));
    });
    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-passkey'); });
  });

  it('a verify that is NOT a session takes the same branch the password path does', async () => {
    // The contract says so explicitly: this response can legitimately still
    // be another step. Assuming "verified, therefore signed in" is how a
    // policy-gated account ends up half-way in with no way forward.
    mockFetchByPath({
      '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-9' } },
      '/auth/passkeys/login/verify': { body: { mfaRequired: true, mfaToken: 'mfa-2', mfaMethods: ['totp'] } },
    });
    startAuthentication.mockResolvedValue(ASSERTION);

    await act(async () => { render(<LoginPage />); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/i }));
    });

    // Same second step as a password login, NOT a session.
    expect(await screen.findByText('Two-factor verification')).toBeInTheDocument();
    expect(screen.getByLabelText('Authentication code')).toBeInTheDocument();
    expect(useUIStore.getState().token).toBeNull();
  });

  it('a forced-enrollment verify reaches the enrollment step, not a dead end', async () => {
    mockFetchByPath({
      '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-9' } },
      '/auth/passkeys/login/verify': {
        body: { mfaRequired: true, mfaEnrollmentRequired: true, mfaToken: 'mfa-3' },
      },
      '/auth/mfa/required/enroll': {
        body: { secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/VenueOS:a@b.c?secret=X', label: 'a@b.c' },
      },
    });
    startAuthentication.mockResolvedValue(ASSERTION);

    await act(async () => { render(<LoginPage />); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/i }));
    });

    expect(await screen.findByText('Set up two-factor')).toBeInTheDocument();
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(useUIStore.getState().token).toBeNull();
  });

  it('a 401 tells the operator to try again or use their password', async () => {
    mockFetchByPath({
      '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-9' } },
      '/auth/passkeys/login/verify': { ok: false, status: 401, body: { code: 'PASSKEY_VERIFICATION_FAILED' } },
    });
    startAuthentication.mockResolvedValue(ASSERTION);

    await act(async () => { render(<LoginPage />); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/i }));
    });

    expect(
      await screen.findByText(/That passkey wasn't accepted\. Try again or sign in with your password\./i),
    ).toBeInTheDocument();
    expect(useUIStore.getState().token).toBeNull();
  });

  it('a 429 surfaces the rate limiter — its own message when it sends one', async () => {
    mockFetchByPath({
      '/auth/passkeys/login/options': {
        ok: false,
        status: 429,
        body: { message: 'Too many sign-in attempts. Try again in 5 minutes.' },
      },
    });

    await act(async () => { render(<LoginPage />); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/i }));
    });

    expect(await screen.findByText(/Try again in 5 minutes/i)).toBeInTheDocument();
    expect(startAuthentication).not.toHaveBeenCalled();
  });

  it('a 429 with no message still says something useful', async () => {
    mockFetchByPath({
      '/auth/passkeys/login/options': { ok: false, status: 429, body: {} },
    });

    await act(async () => { render(<LoginPage />); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/i }));
    });

    expect(await screen.findByText(/Too many attempts\. Wait a minute and try again\./i)).toBeInTheDocument();
  });

  it('a CANCELLED sheet is quiet', async () => {
    mockFetchByPath({
      '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-9' } },
    });
    const cancelled = new Error('cancelled');
    cancelled.name = 'NotAllowedError';
    startAuthentication.mockRejectedValue(cancelled);

    const { container } = await act(async () => render(<LoginPage />)) as any;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/i }));
    });

    await waitFor(() => { expect(startAuthentication).toHaveBeenCalled(); });
    expect(container.querySelector('.bg-rose-50')).toBeNull();
    expect(screen.getByRole('button', { name: /Sign in with a passkey/i })).toBeInTheDocument();
  });

  it('is hidden entirely on a browser that cannot do WebAuthn', async () => {
    browserSupportsWebAuthn.mockReturnValue(false);
    mockFetchByPath({});

    await act(async () => { render(<LoginPage />); });

    expect(screen.queryByRole('button', { name: /Sign in with a passkey/i })).not.toBeInTheDocument();
    // The password path is untouched.
    expect(screen.getByRole('button', { name: /^Sign in$/i })).toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────
// THE REGRESSION GUARD
// ───────────────────────────────────────────────────────────────────────
describe('MFA step — an account with NO passkey is untouched', () => {
  /** Render the challenge step for a given /auth/login body, return its HTML. */
  async function challengeHtml(loginBody: any): Promise<string> {
    mockFetchByPath({ '/auth/login': { body: loginBody } });
    const { container, unmount } = render(<LoginPage />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@school.edu' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
      fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i }));
    });
    await screen.findByLabelText('Authentication code');
    const html = card(container).innerHTML;
    unmount();
    return html;
  }

  it('mfaMethods ABSENT renders the TOTP step and nothing else', async () => {
    // WebAuthn is available in this browser — so if the step changed shape,
    // it changed because of the wave, not because of the environment.
    mockFetchByPath({ '/auth/login': { body: { mfaRequired: true, mfaToken: 'mfa-1' } } });
    const { container } = render(<LoginPage />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@school.edu' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
      fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i }));
    });

    expect(await screen.findByText('Two-factor verification')).toBeInTheDocument();
    // Every control today's step has.
    expect(screen.getByLabelText('Authentication code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Verify & sign in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Back$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Use a backup code/i })).toBeInTheDocument();
    // …and NOTHING the wave added.
    expect(screen.queryByRole('button', { name: /Use your passkey/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Use a 6-digit code instead/i })).not.toBeInTheDocument();

    // STRUCTURAL: the card's only child is the <form> itself. This is what
    // catches a wrapper element sneaking in around the old markup — the
    // cheapest way this step could silently change shape.
    const el = card(container);
    expect(el.children).toHaveLength(1);
    expect(el.firstElementChild?.tagName).toBe('FORM');
  });

  it('every "no passkey here" path renders byte-identical markup', async () => {
    // Three independent reasons the passkey arm can be off. If any one of
    // them produced a different DOM, the TOTP-only step would have drifted.
    const absent = await challengeHtml({ mfaRequired: true, mfaToken: 'mfa-1' });
    const explicitTotpOnly = await challengeHtml({ mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['totp'] });
    const emptyArray = await challengeHtml({ mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: [] });

    expect(explicitTotpOnly).toBe(absent);
    expect(emptyArray).toBe(absent);

    // And the same again when the ACCOUNT has a passkey but the BROWSER
    // cannot use one — the operator must still get a step that works.
    browserSupportsWebAuthn.mockReturnValue(false);
    const unsupportedBrowser = await challengeHtml({
      mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['totp', 'passkey'],
    });
    expect(unsupportedBrowser).toBe(absent);

    expect(absent).not.toContain('Use your passkey');
  });

  it('the plain no-MFA password login is unchanged', async () => {
    mockFetchByPath({ '/auth/login': { body: SESSION } });

    await act(async () => { render(<LoginPage />); });
    await signInWithPassword();

    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-passkey'); });
    expect(push).toHaveBeenCalledWith('/lincoln/dashboard');
    expect(screen.queryByText('Two-factor verification')).not.toBeInTheDocument();
  });
});
