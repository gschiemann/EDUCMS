/**
 * FIRST SIGN-IN ORDER (2026-10-10) — the sign-in page resumes the required
 * two-step setup that first-login setup handed it, without asking for the
 * password again, and only once.
 */
import { render, screen, waitFor } from '@testing-library/react';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: push }),
  useSearchParams: () => new URLSearchParams('reason=setup-two-step'),
}));
jest.mock('@/lib/client-logger', () => ({ clog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('qrcode', () => ({
  __esModule: true,
  toDataURL: jest.fn(() => Promise.resolve('data:image/png;base64,QR')),
  default: { toDataURL: jest.fn(() => Promise.resolve('data:image/png;base64,QR')) },
}));

import LoginPage from '../page';
import { API_URL } from '@/lib/api-url';
import { SETUP_TWO_STEP_HANDOFF_KEY, stashSetupTwoStep } from '@/lib/setup-two-step-handoff';

function mockFetch() {
  const calls: Array<{ url: string; body: any }> = [];
  (global as any).fetch = jest.fn((url: string, init: any) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    const body = String(url).endsWith('/auth/mfa/required/enroll')
      ? { secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP', label: 'dana@riot.test' }
      : {};
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  });
  return calls;
}

beforeEach(() => {
  push.mockReset();
  sessionStorage.clear();
});

it('opens the required two-step setup straight from the hand-off — no password asked', async () => {
  const calls = mockFetch();
  stashSetupTwoStep('dana@riot.test', { mfaRequired: true, mfaEnrollmentRequired: true, mfaMethods: [], mfaToken: 'after-setup-token' });
  render(<LoginPage />);
  await waitFor(() => expect(calls.some((c) => c.url === `${API_URL}/auth/mfa/required/enroll`)).toBe(true));
  expect(calls.find((c) => c.url === `${API_URL}/auth/mfa/required/enroll`)!.body).toEqual({ mfaToken: 'after-setup-token' });
  expect(await screen.findByText('Set up two-factor')).toBeInTheDocument();
  expect(screen.queryByLabelText('Password')).toBeNull();
  // Taken once: a reload does not replay it.
  expect(sessionStorage.getItem(SETUP_TWO_STEP_HANDOFF_KEY)).toBeNull();
});

it('a stale hand-off is ignored — the normal sign-in form shows', async () => {
  mockFetch();
  stashSetupTwoStep('dana@riot.test', { mfaRequired: true, mfaEnrollmentRequired: true, mfaToken: 'old' }, Date.now() - 10 * 60_000);
  render(<LoginPage />);
  expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  expect(screen.queryByText('Set up two-factor')).toBeNull();
});
