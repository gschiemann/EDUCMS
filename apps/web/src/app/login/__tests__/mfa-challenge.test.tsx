/**
 * Login MFA challenge step — RTL proof (2026-05-28).
 *
 * Proves the frontend for the already-built MFA backend
 * (apps/api/src/auth/mfa.controller.ts + auth.service.ts:141-146):
 *
 *   (a) When POST /auth/login responds { mfaRequired: true, mfaToken },
 *       the page renders the 6-digit TOTP challenge step (NOT a silent
 *       no-op — the latent break the audit flagged at login/page.tsx),
 *       and completing it with a valid code POSTs to /auth/mfa/challenge
 *       with the mfaToken, then finishes login with the returned
 *       access_token (router.push to the user's dashboard).
 *   (c) The normal (no-MFA) path is unchanged: { access_token, user }
 *       logs straight in.
 *
 * The login page talks to the API via the global `fetch` (NOT apiFetch),
 * so we mock `fetch` here and assert the exact URLs + bodies. This is
 * what proves the real contract is matched, not assumed.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(''),
}));

// Quiet the client logger.
jest.mock('@/lib/client-logger', () => ({
  clog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import LoginPage from '../page';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';

function mockFetchSequence(handlers: Array<(url: string, init: any) => any>) {
  let call = 0;
  (global as any).fetch = jest.fn((url: string, init: any) => {
    const h = handlers[Math.min(call, handlers.length - 1)];
    call += 1;
    const r = h(url, init);
    return Promise.resolve({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: () => Promise.resolve(r.body ?? {}),
    });
  });
}

async function fillCredentialsAndSubmit() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@school.edu' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
  // EULA is pre-checked from a prior localStorage write in beforeEach.
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i }));
  });
}

describe('LoginPage — MFA challenge step', () => {
  beforeEach(() => {
    push.mockReset();
    // Reset the store + EULA so the Sign-in button isn't gated.
    useUIStore.setState({ token: null, user: null });
    try {
      localStorage.setItem('edu_cms_eula_accepted_v1.0', 'yes');
    } catch { /* ignore */ }
  });

  it('(c) no-MFA login still works unchanged — logs in and redirects', async () => {
    mockFetchSequence([
      // POST /auth/login → full session, no MFA.
      () => ({
        ok: true,
        body: {
          access_token: 'tok-plain',
          user: { id: 'u1', email: 'admin@school.edu', role: 'SCHOOL_ADMIN', tenantSlug: 'lincoln', tenantId: 't1' },
        },
      }),
    ]);

    await act(async () => { render(<LoginPage />); });
    await fillCredentialsAndSubmit();

    await waitFor(() => {
      expect(useUIStore.getState().token).toBe('tok-plain');
    });
    expect(push).toHaveBeenCalledWith('/lincoln/dashboard');
    // The MFA step must NOT appear on the no-MFA path.
    expect(screen.queryByText('Two-factor verification')).not.toBeInTheDocument();
  });

  it('(a) renders the TOTP challenge on { mfaRequired: true } and completes on a valid code', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    mockFetchSequence([
      // 1) POST /auth/login → MFA required (password was correct).
      (url, init) => {
        calls.push({ url, init });
        return { ok: true, body: { mfaRequired: true, mfaToken: 'mfa-token-xyz' } };
      },
      // 2) POST /auth/mfa/challenge → full session.
      (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          body: {
            access_token: 'tok-after-mfa',
            user: { id: 'u1', email: 'admin@school.edu', role: 'SCHOOL_ADMIN', tenantSlug: 'lincoln', tenantId: 't1' },
          },
        };
      },
    ]);

    await act(async () => { render(<LoginPage />); });
    await fillCredentialsAndSubmit();

    // The challenge step renders — this is the fix for the latent
    // silent-no-op at login/page.tsx (audit row).
    expect(await screen.findByText('Two-factor verification')).toBeInTheDocument();
    // We have NOT logged in yet — only the partial token is held.
    expect(useUIStore.getState().token).toBeNull();

    // Enter the 6-digit code and verify.
    fireEvent.change(screen.getByLabelText('Authentication code'), { target: { value: '123456' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Verify & sign in/i }));
    });

    await waitFor(() => {
      expect(useUIStore.getState().token).toBe('tok-after-mfa');
    });

    // Assert the real contract: login first, then challenge with the
    // mfaToken + code.
    expect(calls[0].url).toBe(`${API_URL}/auth/login`);
    expect(calls[1].url).toBe(`${API_URL}/auth/mfa/challenge`);
    const challengeBody = JSON.parse(calls[1].init.body);
    expect(challengeBody).toEqual({ mfaToken: 'mfa-token-xyz', code: '123456' });

    expect(push).toHaveBeenCalledWith('/lincoln/dashboard');
  });

  it('(a2) backup-code fallback POSTs { mfaToken, backupCode } to the challenge endpoint', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    mockFetchSequence([
      (url, init) => {
        calls.push({ url, init });
        return { ok: true, body: { mfaRequired: true, mfaToken: 'mfa-token-xyz' } };
      },
      (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          body: {
            access_token: 'tok-after-backup',
            user: { id: 'u1', email: 'admin@school.edu', role: 'SCHOOL_ADMIN', tenantSlug: 'lincoln', tenantId: 't1' },
          },
        };
      },
    ]);

    await act(async () => { render(<LoginPage />); });
    await fillCredentialsAndSubmit();

    await screen.findByText('Two-factor verification');
    // Switch to backup-code mode.
    fireEvent.click(screen.getByRole('button', { name: /Use a backup code/i }));
    fireEvent.change(screen.getByLabelText('Backup code'), { target: { value: 'ABCD-1234' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Verify & sign in/i }));
    });

    await waitFor(() => {
      expect(useUIStore.getState().token).toBe('tok-after-backup');
    });
    const body = JSON.parse(calls[1].init.body);
    expect(body).toEqual({ mfaToken: 'mfa-token-xyz', backupCode: 'ABCD-1234' });
  });
});
