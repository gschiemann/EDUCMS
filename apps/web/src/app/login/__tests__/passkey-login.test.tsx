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
import { createHash } from 'crypto';
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
  // 2026-09-22 — a device WITH a built-in authenticator, so the no-passkey
  // hint below may promise the walk-through.
  platformAuthenticatorIsAvailable: () => Promise.resolve(true),
  WebAuthnAbortService: { cancelCeremony: () => undefined },
}));

import LoginPage from '../page';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';

type Reply = { ok?: boolean; status?: number; body?: any };

/** Route replies by exact URL suffix. */
function mockFetchByPath(routes: Record<string, Reply>) {
  const calls: Array<{ url: string; body: any }> = [];
  (global as any).fetch = jest.fn((url: string, init: any) => {
    // The identifier-first domain lookup (2026-10-04) has its own suite
    // (sign-in-steps.test.tsx). It answers 404 here → password form, and is
    // kept out of `calls` so the contracts below stay index-exact.
    if (!String(url).endsWith('/auth/sign-in-options')) calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
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
/** The account's WebAuthn user handle — sha256(user id), as the API mints it. */
const USER_HANDLE = createHash('sha256').update('u1').digest('base64url');
const ASSERTION = { id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: { userHandle: USER_HANDLE } };
const GET_OPTIONS = { challenge: 'Y2hhbGw', rpId: 'venueos.app' };

async function signInWithPassword() {
  // Identifier-first (2026-10-04): the email, Continue, then the password.
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@school.edu' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/i }));
  });
  fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
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
  try {
    localStorage.setItem('edu_cms_eula_accepted_v1.0', 'yes');
    // The remembered "Keep me signed in" choice must not leak between tests.
    localStorage.removeItem('venueos_keep_signed_in.v1');
  } catch { /* ignore */ }
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

    // The code form is NOT on screen yet — only the way to it: ONE link,
    // "Use another way", always visible (2026-10-05).
    expect(screen.queryByLabelText('Authentication code')).not.toBeInTheDocument();
    const link = screen.getByRole('button', { name: /^Use another way$/i });

    // We have NOT signed in.
    expect(useUIStore.getState().token).toBeNull();

    // The link lists the ways; the authenticator one reveals today's form, unchanged.
    await act(async () => { fireEvent.click(link); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Enter a code from your authenticator app/i }));
    });
    expect(screen.getByLabelText('Authentication code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Verify & sign in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Use a backup code/i })).toBeInTheDocument();
    // …and the list is one tap away again.
    expect(screen.getByRole('button', { name: /^Use another way$/i })).toBeInTheDocument();
  });

  it("['passkey'] offers NO authenticator code, but a backup code is still reachable", async () => {
    mockFetchByPath({
      '/auth/login': { body: { mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['passkey'] } },
    });

    await act(async () => { render(<LoginPage />); });
    await signInWithPassword();

    await screen.findByRole('button', { name: /Use your passkey/i });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Use another way$/i })); });
    expect(screen.queryByRole('button', { name: /authenticator app/i })).not.toBeInTheDocument();

    // A passkey-only user's fallback IS a backup code — if that is not
    // reachable, losing the device is a lockout. (An API that predates
    // `mfaFallbacks` — this response — keeps offering it, as shipped.)
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
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Use another way$/i })); });
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

    // The exact contract. (Step 1's "Sign in with a passkey" link prefetches
    // its own options, so the second-factor calls are found by URL.)
    const after = calls.slice(calls.findIndex((c) => c.url.endsWith('/auth/login')) + 1);
    expect(after.map((c) => c.url)).toEqual([
      `${API_URL}/auth/mfa/challenge/passkey/options`,
      `${API_URL}/auth/mfa/challenge/passkey`,
    ]);
    expect(after[0].body).toEqual({ mfaToken: 'mfa-1' });
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: GET_OPTIONS });
    expect(after[1].body).toEqual({ mfaToken: 'mfa-1', response: ASSERTION });
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
    // Still holding the partial token, the passkey one tap away…
    expect(screen.getByRole('button', { name: /Try your passkey again/i })).toBeInTheDocument();
    // …but NOT a dead end (2026-10-05): the calm sentence and the ways that
    // work on this device, opened by themselves.
    expect(screen.getByTestId('passkey-elsewhere-note')).toHaveTextContent(
      'Your passkey may be on another device. Sign in another way on this one:',
    );
    expect(screen.getByTestId('mfa-other-ways')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Use a backup code/i })).toBeInTheDocument();
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
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByTestId('sign-in-email')).toHaveTextContent('admin@school.edu');
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

    // Step 1 has no checkbox (identifier-first, 2026-10-04): a passkey
    // sign-in follows the choice ITS ACCOUNT last made on this browser.
    localStorage.setItem('venueos_keep_signed_in.v1', JSON.stringify([USER_HANDLE]));
    await act(async () => { render(<LoginPage />); });
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

  it('sends rememberMe: false when this account never chose to stay signed in here', async () => {
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

  it('is gated by the EULA exactly like Sign in — no passkey way in until this browser has accepted', async () => {
    // No prior acceptance. Step 1 has no checkbox to tick, so the passkey
    // link is not offered at all: a second way in must not be a way around
    // the agreement. The password step is where it is accepted.
    try { localStorage.removeItem('edu_cms_eula_accepted_v1.0'); } catch { /* ignore */ }
    const calls = mockFetchByPath({
      '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-9' } },
      '/auth/passkeys/login/verify': { body: SESSION },
    });
    startAuthentication.mockResolvedValue(ASSERTION);

    await act(async () => { render(<LoginPage />); });
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByRole('button', { name: /Sign in with a passkey/i })).not.toBeInTheDocument();
    // …and nothing left the browser.
    expect(calls).toHaveLength(0);
    expect(startAuthentication).not.toHaveBeenCalled();
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
    expect(useUIStore.getState().token).toBeNull();

    // UPDATED 2026-09-21 (forced-enrollment passkey wave). This used to assert
    // the TOTP secret was already on screen, because the step minted one the
    // instant it opened. It no longer does — on a WebAuthn-capable browser the
    // step now opens on a CHOICE, and minting a secret for an operator who is
    // about to pick a passkey would write provisional authenticator state onto
    // their account for nothing. The property this test is about is unchanged
    // and still asserted: the verify reaches a real enrollment step, and that
    // step can still produce the authenticator secret.
    expect(screen.getByRole('button', { name: /Use Face ID/i })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Use an authenticator app instead/i }));
    });
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

  it('a CANCELLED sheet is quiet — no red banner — but not silent: a calm next step', async () => {
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
    // The intent this test always had: a dismissed sheet is a decision, never
    // painted as a failure.
    expect(container.querySelector('.bg-rose-50')).toBeNull();
    expect(screen.getByRole('button', { name: /Sign in with a passkey/i })).toBeInTheDocument();
    // 2026-09-22 — …but "no passkey on this device" arrives as this SAME
    // error (the operator's report: Safari says none is saved, then nothing
    // happened). Quiet is no longer silent: the page says what to do next.
    const hint = await screen.findByTestId('passkey-none-hint');
    // 2026-10-05 — and it names the likeliest story on a phone: the passkey is
    // on ANOTHER device. The way on is the email + password on this page.
    expect(hint).toHaveTextContent('Your passkey may be on another device. Sign in another way on this one:');
    expect(hint).toHaveTextContent("After you sign in, we'll help you set up your fingerprint, face or screen lock on this device.");
    expect(hint.className).not.toMatch(/rose/);
  });

  it('is hidden entirely on a browser that cannot do WebAuthn', async () => {
    browserSupportsWebAuthn.mockReturnValue(false);
    mockFetchByPath({});

    await act(async () => { render(<LoginPage />); });

    expect(screen.queryByRole('button', { name: /Sign in with a passkey/i })).not.toBeInTheDocument();
    // The way in is untouched: the email, then Continue.
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Continue$/i })).toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────
// SAFARI USER GESTURE — options fetched BEFORE the tap (2026-10-11)
// ───────────────────────────────────────────────────────────────────────
// Owner, Safari on a Mac: "Use your passkey" periodically opened nothing.
// Safari runs navigator.credentials.get() only inside the tap's transient
// user activation; the old handler awaited the options request first, so a
// slow request spent the activation. The proof here is SYNCHRONOUS: right
// after the click event returns — before any promise could have settled —
// the ceremony has already been called, and no new request was made.
describe('passkey buttons start the ceremony inside the tap', () => {
  /** Like mockFetchByPath, but a route may answer a SEQUENCE (last one repeats). */
  function mockFetchSeq(routes: Record<string, Reply | Reply[]>) {
    const calls: Array<{ url: string; body: Record<string, unknown> | undefined }> = [];
    const served: Record<string, number> = {};
    (globalThis as unknown as { fetch: unknown }).fetch = jest.fn((url: string, init?: RequestInit) => {
      if (!String(url).endsWith('/auth/sign-in-options')) calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      // Longest match first, so a route can never be shadowed by a shorter one.
      const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => String(url).endsWith(k));
      let r: Reply = { ok: false, status: 404, body: {} };
      if (key) {
        const v = routes[key];
        if (Array.isArray(v)) {
          const i = served[key] ?? 0;
          served[key] = i + 1;
          r = v[Math.min(i, v.length - 1)];
        } else r = v;
      }
      return Promise.resolve({ ok: r.ok ?? true, status: r.status ?? 200, json: () => Promise.resolve(r.body ?? {}) });
    });
    return calls;
  }
  const mfaOptionCalls = (calls: Array<{ url: string }>) =>
    calls.filter((c) => c.url.endsWith('/auth/mfa/challenge/passkey/options'));
  const notAllowed = () => {
    const e = new Error('The operation either timed out or was not allowed.');
    e.name = 'NotAllowedError';
    return e;
  };
  afterEach(() => { jest.restoreAllMocks(); });

  it('second factor: prefetched options → the tap calls get() synchronously, with no fetch first', async () => {
    const calls = mockFetchSeq({
      '/auth/login': { body: { mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['passkey'] } },
      '/auth/mfa/challenge/passkey/options': { body: { options: GET_OPTIONS } },
      '/auth/mfa/challenge/passkey': { body: SESSION },
    });
    startAuthentication.mockResolvedValue(ASSERTION);
    await act(async () => { render(<LoginPage />); });
    await signInWithPassword();
    const btn = await screen.findByRole('button', { name: /Use your passkey/i });
    // Fetched when the step came on screen — and no ceremony yet.
    await waitFor(() => { expect(mfaOptionCalls(calls)).toHaveLength(1); });
    expect(startAuthentication).not.toHaveBeenCalled();
    const before = calls.length;

    act(() => { fireEvent.click(btn); });
    // SYNCHRONOUS: inside the click, before anything could be awaited.
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: GET_OPTIONS });
    expect(calls.length).toBe(before);

    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-passkey'); });
    // Signed in: nothing re-fetched.
    expect(mfaOptionCalls(calls)).toHaveLength(1);
  });

  it('options are one-time: after a cancel they are fetched AGAIN, so the next tap is synchronous too', async () => {
    const OPT2 = { challenge: 'c2Vjb25k', rpId: 'venueos.app' };
    const calls = mockFetchSeq({
      '/auth/login': { body: { mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['passkey'] } },
      '/auth/mfa/challenge/passkey/options': [{ body: { options: GET_OPTIONS } }, { body: { options: OPT2 } }],
      '/auth/mfa/challenge/passkey': { body: SESSION },
    });
    startAuthentication.mockRejectedValueOnce(notAllowed()).mockResolvedValueOnce(ASSERTION);
    await act(async () => { render(<LoginPage />); });
    await signInWithPassword();
    const btn = await screen.findByRole('button', { name: /Use your passkey/i });
    await waitFor(() => { expect(mfaOptionCalls(calls)).toHaveLength(1); });

    await act(async () => { fireEvent.click(btn); });
    // A cancel on the PREFETCHED path keeps today's calm handling.
    expect(await screen.findByTestId('passkey-elsewhere-note')).toBeInTheDocument();
    expect(screen.queryByText(/Tap the passkey button again/i)).not.toBeInTheDocument();
    // Re-fetched once the ceremony settled (never while it was open).
    await waitFor(() => { expect(mfaOptionCalls(calls)).toHaveLength(2); });

    const before = calls.length;
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Try your passkey again/i })); });
    expect(startAuthentication).toHaveBeenCalledTimes(2);
    expect(startAuthentication).toHaveBeenLastCalledWith({ optionsJSON: OPT2 });
    expect(calls.length).toBe(before);
    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-passkey'); });
  });

  it('STALE options (older than 4 min) are never used: the tap fetches fresh ones first', async () => {
    const OPT2 = { challenge: 'ZnJlc2g', rpId: 'venueos.app' };
    const calls = mockFetchSeq({
      '/auth/login': { body: { mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['passkey'] } },
      '/auth/mfa/challenge/passkey/options': [{ body: { options: GET_OPTIONS } }, { body: { options: OPT2 } }],
      '/auth/mfa/challenge/passkey': { body: SESSION },
    });
    startAuthentication.mockResolvedValue(ASSERTION);
    await act(async () => { render(<LoginPage />); });
    await signInWithPassword();
    const btn = await screen.findByRole('button', { name: /Use your passkey/i });
    await waitFor(() => { expect(mfaOptionCalls(calls)).toHaveLength(1); });

    // Five minutes on the step (the server's challenge has expired).
    const real = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => real + 5 * 60_000);

    act(() => { fireEvent.click(btn); });
    expect(startAuthentication).not.toHaveBeenCalled(); // NOT the expired challenge
    await waitFor(() => { expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: OPT2 }); });
    expect(mfaOptionCalls(calls)).toHaveLength(2);
    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-passkey'); });
  });

  it('coming back to the tab with stale options refreshes them on demand (no timer)', async () => {
    const calls = mockFetchSeq({
      '/auth/login': { body: { mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['passkey'] } },
      '/auth/mfa/challenge/passkey/options': { body: { options: GET_OPTIONS } },
    });
    await act(async () => { render(<LoginPage />); });
    await signInWithPassword();
    await screen.findByRole('button', { name: /Use your passkey/i });
    await waitFor(() => { expect(mfaOptionCalls(calls)).toHaveLength(1); });
    // Fresh: focus changes nothing.
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(mfaOptionCalls(calls)).toHaveLength(1);
    // Stale: focus re-fetches.
    const real = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => real + 5 * 60_000);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(mfaOptionCalls(calls)).toHaveLength(2);
  });

  it('no prefetched options + Safari refuses at once → "tap again", and the next tap goes straight to the device', async () => {
    const calls = mockFetchSeq({
      '/auth/login': { body: { mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['passkey'] } },
      // The prefetch fails (a blip); the tap's own fetch and the re-prefetch succeed.
      '/auth/mfa/challenge/passkey/options': [
        { ok: false, status: 503, body: {} },
        { body: { options: GET_OPTIONS } },
      ],
      '/auth/mfa/challenge/passkey': { body: SESSION },
    });
    startAuthentication.mockRejectedValueOnce(notAllowed()).mockResolvedValueOnce(ASSERTION);
    await act(async () => { render(<LoginPage />); });
    await signInWithPassword();
    const btn = await screen.findByRole('button', { name: /Use your passkey/i });
    await waitFor(() => { expect(mfaOptionCalls(calls)).toHaveLength(1); });

    // Fallback path: fetch, THEN get() — which "Safari" refuses immediately.
    await act(async () => { fireEvent.click(btn); });
    expect(await screen.findByText(/Tap the passkey button again/i)).toBeInTheDocument();
    // Not treated as "your passkey is on another device".
    expect(screen.queryByTestId('passkey-elsewhere-note')).not.toBeInTheDocument();
    await waitFor(() => { expect(mfaOptionCalls(calls)).toHaveLength(3); });

    const before = calls.length;
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Use your passkey/i })); });
    expect(startAuthentication).toHaveBeenCalledTimes(2);
    expect(calls.length).toBe(before);
    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-passkey'); });
  });

  it('passwordless link: prefetched → the tap calls get() synchronously', async () => {
    const calls = mockFetchSeq({
      '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-9' } },
      '/auth/passkeys/login/verify': { body: SESSION },
    });
    startAuthentication.mockResolvedValue(ASSERTION);
    await act(async () => { render(<LoginPage />); });
    const link = await screen.findByRole('button', { name: /Sign in with a passkey/i });
    await waitFor(() => { expect(calls).toHaveLength(1); });

    act(() => { fireEvent.click(link); });
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: GET_OPTIONS });
    expect(calls).toHaveLength(1);

    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-passkey'); });
    expect(calls[1].body).toEqual({ challengeId: 'ch-9', response: ASSERTION, rememberMe: false });
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
    await signInWithPassword();
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
    await signInWithPassword();

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
