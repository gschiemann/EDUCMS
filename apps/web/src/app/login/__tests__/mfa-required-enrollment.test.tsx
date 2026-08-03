/**
 * ACC-03 forced-MFA enrollment at login — RTL proof (2026-08-03).
 *
 * THE BUG THIS PREVENTS. `User.mfaRequired` is enforced in
 * `AuthService.login`: a user carrying the policy who has not enrolled gets NO
 * session, only a partial `mfaToken`, flagged `mfaEnrollmentRequired`. The
 * login page had no branch for that flag — it fell into the "enter your
 * 6-digit code" step for an authenticator the user has never set up. There is
 * no code to enter, and Settings → Security is unreachable because it needs
 * the very session the policy is withholding. Setting the flag was therefore
 * a LOCKOUT with no path forward.
 *
 * These tests pin the way out: enroll → verify → backup codes → session.
 *
 * The page talks to the API via the global `fetch` (not apiFetch), so we mock
 * `fetch` and assert exact URLs + bodies — that is what proves the real
 * contract is matched rather than assumed.
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

// The page lazy-imports `qrcode` only on this step; jsdom has no canvas.
jest.mock('qrcode', () => ({
  __esModule: true,
  toDataURL: jest.fn(() => Promise.resolve('data:image/png;base64,QR')),
  default: { toDataURL: jest.fn(() => Promise.resolve('data:image/png;base64,QR')) },
}));

import LoginPage from '../page';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';

type Reply = { ok?: boolean; status?: number; body?: any };

/** Route replies by URL suffix so ordering of the lazy QR import can't matter. */
function mockFetchByPath(routes: Record<string, Reply>) {
  const calls: Array<{ url: string; body: any }> = [];
  (global as any).fetch = jest.fn((url: string, init: any) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
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

async function signIn() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'teacher@school.edu' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i }));
  });
}

const ENROLL_REQUIRED_LOGIN: Reply = {
  body: { mfaRequired: true, mfaEnrollmentRequired: true, mfaToken: 'partial-token' },
};
const ENROLL_SECRET: Reply = {
  body: {
    secret: 'JBSWY3DPEHPK3PXP',
    otpauthUrl: 'otpauth://totp/VenueOS:teacher@school.edu?secret=JBSWY3DPEHPK3PXP',
    label: 'teacher@school.edu',
  },
};
const SESSION: Reply = {
  body: {
    access_token: 'real-session-token',
    user: { id: 'u1', email: 'teacher@school.edu', role: 'CONTRIBUTOR', tenantSlug: 'school' },
    backupCodes: ['AAAA-1111', 'BBBB-2222'],
  },
};

describe('LoginPage — ACC-03 forced-MFA enrollment', () => {
  beforeEach(() => {
    push.mockReset();
    useUIStore.setState({ token: null, user: null });
    try { localStorage.setItem('edu_cms_eula_accepted_v1.0', 'yes'); } catch { /* ignore */ }
  });

  it('renders the SETUP step (not the code prompt) when mfaEnrollmentRequired is set', async () => {
    const calls = mockFetchByPath({
      '/auth/login': ENROLL_REQUIRED_LOGIN,
      '/auth/mfa/required/enroll': ENROLL_SECRET,
    });
    render(<LoginPage />);
    await signIn();

    // It must ask the enrollment endpoint, authorized by the partial token.
    await waitFor(() => {
      expect(calls.some((c) => c.url === `${API_URL}/auth/mfa/required/enroll`)).toBe(true);
    });
    expect(
      calls.find((c) => c.url === `${API_URL}/auth/mfa/required/enroll`)!.body,
    ).toEqual({ mfaToken: 'partial-token' });

    // And it must show a way to SET UP the factor, with the manual key for
    // anyone who can't scan.
    expect(await screen.findByText('Set up two-factor')).toBeInTheDocument();
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
  });

  it('completes the held-back login through /required/verify', async () => {
    mockFetchByPath({
      '/auth/login': ENROLL_REQUIRED_LOGIN,
      '/auth/mfa/required/enroll': ENROLL_SECRET,
      '/auth/mfa/required/verify': SESSION,
    });
    render(<LoginPage />);
    await signIn();
    await screen.findByText('JBSWY3DPEHPK3PXP');

    fireEvent.change(screen.getByLabelText(/Authentication code|Auth code/i), {
      target: { value: '123456' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Finish sign-in/i }));
    });

    // Backup codes are shown ONCE — redirecting straight past them would
    // silently throw away the user's only recovery path.
    expect(await screen.findByText('AAAA-1111')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /I've saved them/i }));
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/school/dashboard'));
    expect(useUIStore.getState().token).toBe('real-session-token');
  });

  it('sends the operator back to the password step when the partial token expires', async () => {
    mockFetchByPath({
      '/auth/login': ENROLL_REQUIRED_LOGIN,
      '/auth/mfa/required/enroll': ENROLL_SECRET,
      '/auth/mfa/required/verify': {
        ok: false,
        status: 401,
        body: { code: 'MFA_TOKEN_INVALID', message: 'expired' },
      },
    });
    render(<LoginPage />);
    await signIn();
    await screen.findByText('JBSWY3DPEHPK3PXP');

    fireEvent.change(screen.getByLabelText(/Authentication code|Auth code/i), {
      target: { value: '123456' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Finish sign-in/i }));
    });

    // Back to the front door with an explanation — never a dead end.
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByText(/timed out/i)).toBeInTheDocument();
  });

  it('still shows the plain code prompt for an ALREADY-enrolled user', async () => {
    // The enrollment branch must not swallow the ordinary MFA challenge.
    const calls = mockFetchByPath({
      '/auth/login': { body: { mfaRequired: true, mfaToken: 'partial-token' } },
    });
    render(<LoginPage />);
    await signIn();

    expect(await screen.findByRole('button', { name: /Verify (and|&) sign in/i })).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/required/enroll'))).toBe(false);
  });
});
