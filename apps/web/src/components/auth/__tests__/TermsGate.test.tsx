/**
 * TermsGate — the End User License Agreement, accepted on the ACCOUNT
 * (2026-10-24, launch QA S2). The cases are the ways a person reaches the
 * dashboard:
 *   - already accepted (the session says so) → never asked, nothing fetched;
 *   - ticked the box on the sign-in form a moment ago → recorded quietly as
 *     `sign-in`, never asked twice;
 *   - a cached session that does not know → the server's own answer decides;
 *   - nothing on file (an invited teammate, a second person on a shared
 *     browser, everyone the day this ships) → asked once, recorded as `prompt`;
 *   - an emergency alert is active → the prompt steps aside so the alert's
 *     all-clear is never behind it.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
jest.mock('@/lib/api-url', () => ({ API_URL: 'http://api.test/api/v1' }));
jest.mock('@/lib/client-logger', () => ({ clog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/brand', () => ({ getClientBrand: () => ({ name: 'VenueOS' }) }));
jest.mock('@/lib/csrf', () => ({ ensureCsrfToken: jest.fn().mockResolvedValue('csrf') }));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));

import { TermsGate } from '../TermsGate';
import { useAppStore } from '@/lib/store';
import { EULA_VERSION, parkServerTermsAcceptance, TERMS_SERVER_PENDING_KEY } from '@/lib/eula-acceptance';

const fetchMock = jest.fn();

function seed(user: Record<string, unknown>, opts: { emergency?: boolean } = {}) {
  act(() => {
    useAppStore.setState({
      token: 'tok',
      user: { id: 'u1', email: 'pat@school.example', role: 'CONTRIBUTOR', tenantId: 't1', ...user } as never,
      isEmergencyActive: !!opts.emergency,
    });
  });
}

function route(handlers: Record<string, (init: any) => { ok: boolean; status?: number; body: unknown }>) {
  fetchMock.mockImplementation(async (url: string, init: any) => {
    const key = Object.keys(handlers).find((k) => String(url).endsWith(k));
    if (!key) throw new Error(`unexpected fetch ${url}`);
    const out = handlers[key](init);
    return { ok: out.ok, status: out.status ?? (out.ok ? 200 : 400), json: async () => out.body };
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  (global as any).fetch = fetchMock;
  sessionStorage.clear();
});

it('already accepted (the session says so): renders nothing and fetches nothing', async () => {
  seed({ termsAcceptedVersion: EULA_VERSION });
  await act(async () => { render(<TermsGate />); });
  expect(screen.queryByTestId('terms-gate')).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('ticked on the sign-in form: recorded quietly as "sign-in", never asked twice', async () => {
  seed({ termsAcceptedVersion: null });
  parkServerTermsAcceptance('u1');
  route({
    '/users/me/terms': (init) => {
      expect(JSON.parse(init.body)).toEqual({ version: EULA_VERSION, method: 'sign-in' });
      return { ok: true, body: { version: EULA_VERSION, acceptedAt: '2026-10-24T10:00:00Z', recorded: true } };
    },
  });
  await act(async () => { render(<TermsGate />); });
  await waitFor(() => expect((useAppStore.getState().user as any).termsAcceptedVersion).toBe(EULA_VERSION));
  expect(screen.queryByTestId('terms-gate')).toBeNull();
  expect(sessionStorage.getItem(TERMS_SERVER_PENDING_KEY)).toBeNull();
});

it('a tick parked for ANOTHER account is not used — this person is asked', async () => {
  seed({ termsAcceptedVersion: null });
  parkServerTermsAcceptance('someone-else');
  await act(async () => { render(<TermsGate />); });
  expect(await screen.findByTestId('terms-gate')).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('a cached session that does not know asks the server — accepted there means never asked', async () => {
  seed({});
  route({ '/users/me': () => ({ ok: true, body: { termsAcceptedVersion: EULA_VERSION, termsCurrentVersion: EULA_VERSION } }) });
  await act(async () => { render(<TermsGate />); });
  await waitFor(() => expect((useAppStore.getState().user as any).termsAcceptedVersion).toBe(EULA_VERSION));
  expect(screen.queryByTestId('terms-gate')).toBeNull();
});

it('a cached session that does not know, on a server that has nothing on file: asked', async () => {
  seed({});
  route({ '/users/me': () => ({ ok: true, body: { termsAcceptedVersion: null, termsCurrentVersion: EULA_VERSION } }) });
  await act(async () => { render(<TermsGate />); });
  expect(await screen.findByTestId('terms-gate')).toBeInTheDocument();
  expect((useAppStore.getState().user as any).termsAcceptedVersion).toBeNull();
});

// NEVER A LOCKOUT — the web and the API deploy separately.
it('an API that does not keep the record yet (no termsCurrentVersion) is never asked — no prompt over the dashboard', async () => {
  seed({});
  route({ '/users/me': () => ({ ok: true, body: { id: 'u1', email: 'pat@school.example' } }) });
  await act(async () => { render(<TermsGate />); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId('terms-gate')).toBeNull();
});

it('a server showing a DIFFERENT version is not asked with ours (it would refuse it)', async () => {
  seed({});
  route({ '/users/me': () => ({ ok: true, body: { termsAcceptedVersion: null, termsCurrentVersion: '2.0' } }) });
  await act(async () => { render(<TermsGate />); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId('terms-gate')).toBeNull();
});

it('an unreadable answer stays silent — it asks on a later visit, never locks the dashboard', async () => {
  seed({});
  fetchMock.mockRejectedValue(new Error('offline'));
  await act(async () => { render(<TermsGate />); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(screen.queryByTestId('terms-gate')).toBeNull();
});

it('a parked tick on an API without the route (404) stays silent too', async () => {
  seed({});
  parkServerTermsAcceptance('u1');
  route({ '/users/me/terms': () => ({ ok: false, status: 404, body: { message: 'Cannot POST' } }) });
  await act(async () => { render(<TermsGate />); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId('terms-gate')).toBeNull();
});

it('nothing on file: asked once — the box is required, then "Accept and continue" records it as "prompt"', async () => {
  seed({ termsAcceptedVersion: null });
  let posted: any = null;
  route({
    '/users/me/terms': (init) => {
      posted = JSON.parse(init.body);
      return { ok: true, body: { version: EULA_VERSION, acceptedAt: '2026-10-24T10:00:00Z', recorded: true } };
    },
  });
  await act(async () => { render(<TermsGate />); });
  const gate = await screen.findByTestId('terms-gate');
  expect(gate).toHaveAttribute('role', 'dialog');
  expect(screen.getByRole('heading', { name: 'Before you continue' })).toBeInTheDocument();
  expect(screen.getByText(`Version ${EULA_VERSION}`)).toBeInTheDocument();
  // Focus is parked on the checkbox — the one thing to do.
  expect(screen.getByTestId('terms-gate-checkbox')).toBe(document.activeElement);

  // Not ticked: refused, nothing sent.
  await act(async () => { fireEvent.click(screen.getByTestId('terms-gate-accept')); });
  expect(screen.getByRole('alert')).toHaveTextContent('You must accept the End User License Agreement to continue.');
  expect(posted).toBeNull();

  fireEvent.click(screen.getByTestId('terms-gate-checkbox'));
  await act(async () => { fireEvent.click(screen.getByTestId('terms-gate-accept')); });
  expect(posted).toEqual({ version: EULA_VERSION, method: 'prompt' });
  await waitFor(() => expect(screen.queryByTestId('terms-gate')).toBeNull());
  expect((useAppStore.getState().user as any).termsAcceptedVersion).toBe(EULA_VERSION);
});

it('a failed save keeps the prompt up and says so', async () => {
  seed({ termsAcceptedVersion: null });
  route({ '/users/me/terms': () => ({ ok: false, status: 503, body: { code: 'X' } }) });
  await act(async () => { render(<TermsGate />); });
  await screen.findByTestId('terms-gate');
  fireEvent.click(screen.getByTestId('terms-gate-checkbox'));
  await act(async () => { fireEvent.click(screen.getByTestId('terms-gate-accept')); });
  expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t save that.');
  expect(screen.getByTestId('terms-gate')).toBeInTheDocument();
});

it('EMERGENCY FIRST: while an alert is active the prompt steps aside, and returns after the all-clear', async () => {
  seed({ termsAcceptedVersion: null }, { emergency: true });
  await act(async () => { render(<TermsGate />); });
  expect(screen.queryByTestId('terms-gate')).toBeNull();
  act(() => { useAppStore.setState({ isEmergencyActive: false }); });
  expect(await screen.findByTestId('terms-gate')).toBeInTheDocument();
});
