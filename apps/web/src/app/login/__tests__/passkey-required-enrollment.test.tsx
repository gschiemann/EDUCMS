/**
 * FORCED MFA ENROLLMENT — setting the required factor up with a PASSKEY.
 *
 * MFA becomes mandatory for privileged roles on 2026-10-04, and the only way
 * a blocked account could satisfy it was to install an authenticator app.
 * That is exactly the thing the operator asked to stop making people do, and
 * 41 non-technical location managers are about to meet it.
 *
 * Three properties this file exists to hold:
 *
 *   1. NOTHING IS STARTED UNTIL THE OPERATOR PICKS. `/required/enroll` mints
 *      a real TOTP secret on the server; firing it on arrival would write
 *      provisional authenticator state onto every account whose owner then
 *      taps "use a passkey". The "no call before the click" assertions are
 *      the load-bearing ones.
 *   2. THE CODES ARE SHOWN ONCE, on the SAME screen the authenticator path
 *      uses — a passkey-only account has never seen a backup code, so
 *      redirecting past them throws away its only recovery path.
 *   3. A BROWSER THAT CANNOT DO WEBAUTHN SEES TODAY'S STEP, with no dead
 *      button. This step is one the operator cannot navigate away from, so a
 *      disabled control here is a lockout wearing a UI.
 *
 * `@simplewebauthn/browser` is mocked (jsdom has no authenticator) and the
 * page talks to the API through the global `fetch`, so the URLs and bodies
 * below are the real contract, asserted rather than assumed.
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

// The TOTP branch lazy-imports `qrcode`; jsdom has no canvas.
jest.mock('qrcode', () => ({
  __esModule: true,
  toDataURL: jest.fn(() => Promise.resolve('data:image/png;base64,QR')),
  default: { toDataURL: jest.fn(() => Promise.resolve('data:image/png;base64,QR')) },
}));

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
// NOT mocked — the page's real label helper, so the assertion below is about
// the contract rather than about a double agreeing with itself.
import { guessDeviceLabel } from '@/lib/passkeys';

type Reply = { ok?: boolean; status?: number; body?: any };

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

/** What /auth/login answers for an account the policy is blocking. */
const ENROLL_REQUIRED: Reply = {
  body: { mfaRequired: true, mfaEnrollmentRequired: true, mfaToken: 'partial-token' },
};
const ENROLL_SECRET: Reply = {
  body: {
    secret: 'JBSWY3DPEHPK3PXP',
    otpauthUrl: 'otpauth://totp/VenueOS:manager@venue.example?secret=JBSWY3DPEHPK3PXP',
    label: 'manager@venue.example',
  },
};
const CREATE_OPTIONS = { challenge: 'Y2hhbGw', rp: { id: 'venueos.app', name: 'VenueOS' } };
const CREDENTIAL = { id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: {} };
/** The envelope /auth/mfa/required/passkey/verify returns — session + codes. */
const SESSION_WITH_CODES: Reply = {
  body: {
    access_token: 'real-session-token',
    user: { id: 'u1', email: 'manager@venue.example', role: 'SCHOOL_ADMIN', tenantSlug: 'venue' },
    backupCodes: ['AAAA-1111', 'BBBB-2222', 'CCCC-3333'],
  },
};

async function signIn() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'manager@venue.example' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i }));
  });
}

const enrollCalls = (calls: Array<{ url: string }>) =>
  calls.filter((c) => c.url.endsWith('/auth/mfa/required/enroll'));

beforeEach(() => {
  push.mockReset();
  adoptRememberedSession.mockReset();
  adoptRememberedSession.mockResolvedValue(true);
  browserSupportsWebAuthn.mockReset();
  browserSupportsWebAuthn.mockReturnValue(true);
  startRegistration.mockReset();
  startAuthentication.mockReset();
  useUIStore.setState({ token: null, user: null });
  try { localStorage.setItem('edu_cms_eula_accepted_v1.0', 'yes'); } catch { /* ignore */ }
});

// ───────────────────────────────────────────────────────────────────────
// THE CHOICE
// ───────────────────────────────────────────────────────────────────────
describe('the operator is offered a passkey first', () => {
  it('shows the choice and starts NOTHING until they pick', async () => {
    const calls = mockFetchByPath({
      '/auth/login': ENROLL_REQUIRED,
      '/auth/mfa/required/enroll': ENROLL_SECRET,
    });

    await act(async () => { render(<LoginPage />); });
    await signIn();

    // Both options, in the right order of emphasis.
    const passkeyBtn = await screen.findByRole('button', {
      name: /Use Face ID, Touch ID or a security key/i,
    });
    expect(screen.getByRole('button', { name: /Use an authenticator app instead/i })).toBeInTheDocument();
    // The one-line reason the operator should care.
    expect(screen.getByText(/can't be phished/i)).toBeInTheDocument();

    // THE LOAD-BEARING ASSERTION. Minting a TOTP secret is a server-side
    // write; doing it for someone who is about to choose a passkey parks
    // provisional authenticator state on their account for nothing.
    expect(enrollCalls(calls)).toHaveLength(0);
    // …and therefore none of the authenticator step is on screen.
    expect(screen.queryByText('JBSWY3DPEHPK3PXP')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Authentication code')).not.toBeInTheDocument();

    // Focus is PARKED on the step's primary control — this step replaces the
    // whole card, so a keyboard operator otherwise lands nowhere.
    expect(document.activeElement).toBe(passkeyBtn);
  });

  it('only asks the server for a secret once the authenticator app is chosen', async () => {
    const calls = mockFetchByPath({
      '/auth/login': ENROLL_REQUIRED,
      '/auth/mfa/required/enroll': ENROLL_SECRET,
    });

    await act(async () => { render(<LoginPage />); });
    await signIn();
    await screen.findByRole('button', { name: /Use Face ID, Touch ID or a security key/i });
    expect(enrollCalls(calls)).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Use an authenticator app instead/i }));
    });

    // Now — and only now — the secret is minted, with the partial token.
    await waitFor(() => { expect(enrollCalls(calls)).toHaveLength(1); });
    expect(enrollCalls(calls)[0]).toMatchObject({ url: `${API_URL}/auth/mfa/required/enroll` });
    expect(calls.find((c) => c.url.endsWith('/auth/mfa/required/enroll'))!.body)
      .toEqual({ mfaToken: 'partial-token' });

    // …and today's step renders, unchanged: QR key + code field + finish.
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(screen.getByLabelText(/Authentication code|Auth code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Finish sign-in/i })).toBeInTheDocument();
    // The choice is gone — one decision, not a permanent toggle.
    expect(screen.queryByRole('button', { name: /Use Face ID/i })).not.toBeInTheDocument();
  });

  it('a browser with no WebAuthn sees TODAY’S step, with no dead button', async () => {
    // This step cannot be navigated away from, so a disabled "use a passkey"
    // control here would be a lockout wearing a UI. It must not render at all.
    browserSupportsWebAuthn.mockReturnValue(false);
    const calls = mockFetchByPath({
      '/auth/login': ENROLL_REQUIRED,
      '/auth/mfa/required/enroll': ENROLL_SECRET,
    });

    await act(async () => { render(<LoginPage />); });
    await signIn();

    // Enrollment starts immediately, exactly as it always has.
    await waitFor(() => { expect(enrollCalls(calls)).toHaveLength(1); });
    expect(await screen.findByText('Set up two-factor')).toBeInTheDocument();
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /Use Face ID/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Use an authenticator app instead/i })).not.toBeInTheDocument();
    expect(startRegistration).not.toHaveBeenCalled();
  });

  it('never auto-invokes the ceremony — Safari needs the tap', async () => {
    mockFetchByPath({
      '/auth/login': ENROLL_REQUIRED,
      '/auth/mfa/required/passkey/options': { body: { options: CREATE_OPTIONS } },
    });
    startRegistration.mockResolvedValue(CREDENTIAL);

    await act(async () => { render(<LoginPage />); });
    await signIn();
    await screen.findByRole('button', { name: /Use Face ID/i });

    // The user activation from the password submit is long spent by now, and
    // WebKit would reject the call outright.
    expect(startRegistration).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────
// THE PASSKEY PATH
// ───────────────────────────────────────────────────────────────────────
describe('setting the factor up with a passkey', () => {
  it('walks options → ceremony → verify → backup codes → session', async () => {
    const calls = mockFetchByPath({
      '/auth/login': ENROLL_REQUIRED,
      '/auth/mfa/required/passkey/options': { body: { options: CREATE_OPTIONS } },
      '/auth/mfa/required/passkey/verify': SESSION_WITH_CODES,
    });
    startRegistration.mockResolvedValue(CREDENTIAL);

    await act(async () => { render(<LoginPage />); });
    await signIn();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Use Face ID/i }));
    });

    // THE EXACT CONTRACT.
    const opt = calls.find((c) => c.url.endsWith('/auth/mfa/required/passkey/options'))!;
    expect(opt.url).toBe(`${API_URL}/auth/mfa/required/passkey/options`);
    expect(opt.body).toEqual({ mfaToken: 'partial-token' });
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: CREATE_OPTIONS });
    const verify = calls.find((c) => c.url.endsWith('/auth/mfa/required/passkey/verify'))!;
    expect(verify.url).toBe(`${API_URL}/auth/mfa/required/passkey/verify`);
    expect(verify.body).toEqual({
      mfaToken: 'partial-token',
      response: CREDENTIAL,
      label: guessDeviceLabel(),
    });

    // The codes are shown BEFORE we sign anyone in — this account has never
    // seen one, and they are shown exactly once.
    expect(await screen.findByText('AAAA-1111')).toBeInTheDocument();
    expect(screen.getByText('CCCC-3333')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(useUIStore.getState().token).toBeNull();

    // …and the same "I've saved them" hand-off the authenticator path uses.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /I've saved them/i }));
    });
    await waitFor(() => { expect(push).toHaveBeenCalledWith('/venue/dashboard'); });
    expect(useUIStore.getState().token).toBe('real-session-token');
  });

  it('never asks for a TOTP secret on the passkey path', async () => {
    const calls = mockFetchByPath({
      '/auth/login': ENROLL_REQUIRED,
      '/auth/mfa/required/enroll': ENROLL_SECRET,
      '/auth/mfa/required/passkey/options': { body: { options: CREATE_OPTIONS } },
      '/auth/mfa/required/passkey/verify': SESSION_WITH_CODES,
    });
    startRegistration.mockResolvedValue(CREDENTIAL);

    await act(async () => { render(<LoginPage />); });
    await signIn();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Use Face ID/i }));
    });
    await screen.findByText('AAAA-1111');

    // Start to finish, the authenticator endpoint was never touched.
    expect(enrollCalls(calls)).toHaveLength(0);
  });

  it('a CANCELLED sheet is quiet and leaves both options open', async () => {
    // Dismissing Face ID is a DECISION, not a failure. A red banner here
    // teaches operators to ignore the area real problems use.
    const { container } = await act(async () => {
      mockFetchByPath({
        '/auth/login': ENROLL_REQUIRED,
        '/auth/mfa/required/passkey/options': { body: { options: CREATE_OPTIONS } },
      });
      return render(<LoginPage />);
    }) as any;
    const cancelled = new Error('The operation either timed out or was not allowed.');
    cancelled.name = 'NotAllowedError';
    startRegistration.mockRejectedValue(cancelled);

    await signIn();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Use Face ID/i }));
    });

    await waitFor(() => { expect(startRegistration).toHaveBeenCalled(); });
    expect(container.querySelector('.bg-rose-50')).toBeNull();
    // Still on the choice, still holding the partial token.
    expect(screen.getByRole('button', { name: /Use Face ID/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Use an authenticator app instead/i })).toBeInTheDocument();
    expect(useUIStore.getState().token).toBeNull();
  });

  it('a refusal explains itself and does NOT push the operator at their password', async () => {
    mockFetchByPath({
      '/auth/login': ENROLL_REQUIRED,
      '/auth/mfa/required/passkey/options': { body: { options: CREATE_OPTIONS } },
      '/auth/mfa/required/passkey/verify': {
        ok: false, status: 401, body: { code: 'PASSKEY_VERIFICATION_FAILED' },
      },
    });
    startRegistration.mockResolvedValue(CREDENTIAL);

    await act(async () => { render(<LoginPage />); });
    await signIn();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Use Face ID/i }));
    });

    expect(await screen.findByText(/couldn't be set up/i)).toBeInTheDocument();
    // "sign in with your password" is the SIGN-IN copy and is wrong advice
    // mid-setup: the password is how they got here.
    expect(screen.queryByText(/sign in with your password/i)).not.toBeInTheDocument();
    // The authenticator app is still right there as the way forward.
    expect(screen.getByRole('button', { name: /Use an authenticator app instead/i })).toBeInTheDocument();
  });

  it('an account that already has a factor is told so, verbatim from the server', async () => {
    // `MFA_ALREADY_ENABLED` is the gate refusing a takeover. Its message is
    // specific and actionable, so it is surfaced rather than flattened.
    mockFetchByPath({
      '/auth/login': ENROLL_REQUIRED,
      '/auth/mfa/required/passkey/options': {
        ok: false,
        status: 400,
        body: {
          code: 'MFA_ALREADY_ENABLED',
          message: 'This account already has a passkey. Complete sign-in with your passkey.',
        },
      },
    });

    await act(async () => { render(<LoginPage />); });
    await signIn();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Use Face ID/i }));
    });

    expect(await screen.findByText(/already has a passkey/i)).toBeInTheDocument();
    expect(startRegistration).not.toHaveBeenCalled();
  });

  it('an expired partial token sends the operator back to the password form', async () => {
    mockFetchByPath({
      '/auth/login': ENROLL_REQUIRED,
      '/auth/mfa/required/passkey/options': {
        ok: false, status: 401, body: { code: 'MFA_TOKEN_INVALID' },
      },
    });

    await act(async () => { render(<LoginPage />); });
    await signIn();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Use Face ID/i }));
    });

    // Back to the front door with an explanation — never a dead end.
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByText(/timed out/i)).toBeInTheDocument();
  });

  it('Back leaves the step without having touched the account', async () => {
    const calls = mockFetchByPath({
      '/auth/login': ENROLL_REQUIRED,
      '/auth/mfa/required/enroll': ENROLL_SECRET,
    });

    await act(async () => { render(<LoginPage />); });
    await signIn();
    await screen.findByRole('button', { name: /Use Face ID/i });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Back$/i }));
    });

    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(enrollCalls(calls)).toHaveLength(0);
    expect(startRegistration).not.toHaveBeenCalled();
  });
});
