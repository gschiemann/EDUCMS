/**
 * Single sign-on landing page — the EULA tick becomes the record HERE
 * (2026-10-04).
 *
 * A first-time browser ticks the EULA on the sign-in page and leaves for its
 * organization's identity provider. The sign-in only finishes on this page,
 * so this is where the acceptance is recorded — the same "only on a finished
 * sign-in" rule the password path has always followed. A landing with nothing
 * parked records nothing: signing in is not accepting.
 */
import { render, waitFor, act, screen } from '@testing-library/react';

const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: jest.fn() }),
}));
jest.mock('@/lib/client-logger', () => ({
  clog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import SsoCompletePage from '../page';
import { useUIStore } from '@/store/ui-store';

const EULA_KEY = 'edu_cms_eula_accepted_v1.0';
const EULA_PENDING_KEY = 'venueos_eula_pending_v1.0';
const USER = { id: 'u1', email: 'teacher@northfield.example', role: 'CONTRIBUTOR', tenantId: 't1', tenantSlug: 'northfield' };

function meAnswers(ok: boolean) {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(() =>
    Promise.resolve({ ok, status: ok ? 200 : 401, json: () => Promise.resolve(ok ? USER : {}) }),
  );
}

beforeEach(() => {
  replace.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  useUIStore.setState({ token: null, user: null });
  window.location.hash = '';
});

it('a parked tick is recorded once the session exists — by the address that actually signed in', async () => {
  sessionStorage.setItem(EULA_PENDING_KEY, '2026-10-04T12:00:00.000Z');
  window.location.hash = '#token=header.payload.sig&tenant=northfield';
  meAnswers(true);

  await act(async () => { render(<SsoCompletePage />); });

  await waitFor(() => { expect(replace).toHaveBeenCalledWith('/northfield/dashboard'); });
  expect(useUIStore.getState().token).toBe('header.payload.sig');
  expect(localStorage.getItem(EULA_KEY)).toBe('yes');
  expect(localStorage.getItem(`${EULA_KEY}_at`)).toBe('2026-10-04T12:00:00.000Z');
  expect(localStorage.getItem(`${EULA_KEY}_by`)).toBe('teacher@northfield.example');
  expect(sessionStorage.getItem(EULA_PENDING_KEY)).toBeNull();
});

it('nothing parked → nothing recorded (a returning browser, or a sign-in started elsewhere)', async () => {
  window.location.hash = '#token=header.payload.sig&tenant=northfield';
  meAnswers(true);

  await act(async () => { render(<SsoCompletePage />); });

  await waitFor(() => { expect(replace).toHaveBeenCalledWith('/northfield/dashboard'); });
  expect(localStorage.getItem(EULA_KEY)).toBeNull();
});

it('a landing with NO token is a failed sign-in: the parked tick records nothing', async () => {
  sessionStorage.setItem(EULA_PENDING_KEY, '2026-10-04T12:00:00.000Z');
  meAnswers(true);

  await act(async () => { render(<SsoCompletePage />); });

  expect(await screen.findByText('SSO sign-in failed')).toBeInTheDocument();
  expect(replace).not.toHaveBeenCalled();
  expect(localStorage.getItem(EULA_KEY)).toBeNull();
  expect(useUIStore.getState().token).toBeNull();
});
