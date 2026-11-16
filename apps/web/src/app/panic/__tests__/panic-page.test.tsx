/**
 * /panic, rendered (2026-11-14) — the emergency home-screen app must never
 * hold a teacher at a password form while a remembered session could still be
 * restored. The owner, 2026-11-10: "last thing we need is a login holding back
 * an emergency trigger for a teacher".
 *
 * The real page, the real store, the real single-flight refresh client; only
 * the network (`fetch`), the two server actions and the router are doubles.
 * The four cases the change was made for:
 *
 *   1. restore before login — no token in the tab, a remembered session in
 *      the cookie jar: the grid is there from the first frame, the restore
 *      runs, and no route to /login is ever taken;
 *   2. 401 then restore — the tab's token is dead: restored, not redirected;
 *      and a trigger that 401s is restored and re-sent exactly once;
 *   3. a press during the restore — waits for it (bounded) and then sends;
 *      a restore that never answers ends in "NOT broadcast", never a send;
 *   4. no remembered session at all — the panic sign-in screen, which says
 *      what it is for; sign-in only on a tap.
 */
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';

const push = jest.fn();
const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }));

const broadcastEmergency = jest.fn();
const allClearEmergency = jest.fn();
jest.mock('@/actions/trigger-emergency', () => ({
  broadcastEmergency: (...a: unknown[]) => broadcastEmergency(...a),
  allClearEmergency: (...a: unknown[]) => allClearEmergency(...a),
}));

const TARGETS = { tenantId: 't1', tenantName: 'Lincoln High', allScreensCount: 24, groups: [], screens: [] };
// Once an alert has been sent, the server lists it as live (so the page's
// all-clear watch sees it on, exactly as in production).
const LIVE_TENANT_ALERT = {
  alertId: null, scopeType: 'tenant', scopeId: 't1', targetName: 'Lincoln High', tenantId: 't1',
  tenantName: 'Lincoln High', type: 'LOCKDOWN', severity: 'CRITICAL', isDrill: false,
  screenCount: 24, showingCount: null, triggeredAt: null,
};
const fetchActiveAlerts = jest.fn(async () =>
  broadcastEmergency.mock.results.some((r) => r.type === 'return') ? [LIVE_TENANT_ALERT] : [],
);
const fetchEmergencyTargets = jest.fn(async () => TARGETS);
jest.mock('@/lib/emergency-api', () => ({
  fetchActiveAlerts: (...a: unknown[]) => (fetchActiveAlerts as any)(...a),
  fetchEmergencyTargets: (...a: unknown[]) => (fetchEmergencyTargets as any)(...a),
}));

import MobilePanicPage from '../page';
import { useUIStore } from '@/store/ui-store';
import { __resetSessionRefreshState } from '@/lib/session-client';

const TEACHER = {
  id: 'u-teacher',
  email: 'teacher@lincoln.test',
  role: 'CONTRIBUTOR',
  tenantId: 't1',
  tenantSlug: 'lincoln',
  canTriggerPanic: true,
};

type Handler = () => Promise<any> | any;
let onRefresh: Handler;
let onMe: Handler;
const res = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function routeFetch() {
  (global as any).fetch = jest.fn(async (input: any) => {
    const url = String(input);
    if (url === '/api/session/refresh') return onRefresh();
    if (url.endsWith('/users/me')) return onMe();
    throw new Error(`unexpected fetch ${url}`);
  });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const refreshed = (token: string, user = TEACHER) => res(200, { refreshed: true, access_token: token, user });
const lockdown = () => screen.getByRole('button', { name: /Trigger Lockdown emergency/i });

/** Space-bar hold on a trigger button — the same code path as a finger (WCAG 2.1.1). */
async function hold(button: HTMLElement) {
  fireEvent.keyDown(button, { key: ' ' });
  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
}

/** Let pending promise chains run (fake timers do not advance them). */
async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  push.mockReset();
  replace.mockReset();
  broadcastEmergency.mockReset();
  allClearEmergency.mockReset();
  fetchActiveAlerts.mockClear();
  fetchEmergencyTargets.mockClear();
  __resetSessionRefreshState();
  window.sessionStorage.clear();
  window.localStorage.clear();
  document.cookie = 'venueos_rm=; Max-Age=0; Path=/';
  act(() => {
    useUIStore.setState({ token: null, user: null, authRestoring: false });
  });
  onMe = () => res(200, TEACHER);
  onRefresh = () => res(401, { refreshed: false, reason: 'no-cookie' });
  routeFetch();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('1 — cold start: the remembered session is restored before any sign-in', () => {
  it('shows the grid from the first frame, restores from the cookie, and never routes to /login', async () => {
    const gate = deferred<any>();
    onRefresh = () => gate.promise;
    render(<MobilePanicPage />);

    // The panel is there before the restore has answered.
    expect(screen.getByTestId('panic-title')).toBeInTheDocument();
    expect(lockdown()).toBeInTheDocument();
    expect(screen.getByTestId('panic-identity')).toHaveTextContent(/Checking sign-in/i);
    expect(screen.getByTestId('panic-auth-status')).toBeInTheDocument();

    await act(async () => {
      gate.resolve(refreshed('restored.jwt'));
    });
    await flush();

    expect(screen.getByTestId('panic-identity')).toHaveTextContent(TEACHER.email);
    expect(screen.queryByTestId('panic-auth-status')).toBeNull();
    expect(screen.queryByTestId('panic-sign-in')).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    // The restored session lands in the store, remembered.
    expect(useUIStore.getState().token).toBe('restored.jwt');
    expect((global.fetch as jest.Mock).mock.calls.map((c) => String(c[0]))).toEqual(['/api/session/refresh']);
  });

  it('offline is NOT "signed out": the grid stays, with one honest line, and no sign-in screen', async () => {
    onRefresh = () => {
      throw new TypeError('Failed to fetch');
    };
    render(<MobilePanicPage />);
    await flush();
    expect(lockdown()).toBeInTheDocument();
    expect(screen.getByTestId('panic-auth-status')).toHaveTextContent(/Can’t reach VenueOS/);
    expect(screen.queryByTestId('panic-sign-in')).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('2 — a 401 restores; it never redirects', () => {
  it('a dead tab token is replaced by the remembered session, and the alert goes out with the NEW token', async () => {
    act(() => {
      useUIStore.setState({ token: 'expired.jwt', user: TEACHER as never });
    });
    onMe = () => res(401, { message: 'Unauthorized' });
    onRefresh = () => refreshed('second.jwt');
    broadcastEmergency.mockResolvedValue({ success: true, overrideId: 'ovr_1' });

    render(<MobilePanicPage />);
    await flush();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByTestId('panic-identity')).toHaveTextContent(TEACHER.email);

    await hold(lockdown());
    await flush();
    expect(broadcastEmergency).toHaveBeenCalledTimes(1);
    expect(broadcastEmergency.mock.calls[0][0]).toMatchObject({ token: 'second.jwt', schoolId: 't1', type: 'lockdown' });
    expect(screen.getByText(/Broadcasted/i)).toBeInTheDocument();
  });

  it('a trigger that 401s is restored and re-sent EXACTLY once — never twice', async () => {
    act(() => {
      useUIStore.setState({ token: 'tab.jwt', user: TEACHER as never });
    });
    onRefresh = () => refreshed('fresh.jwt');
    broadcastEmergency
      .mockResolvedValueOnce({ success: false, error: 'Emergency broadcast failed: 401 — Unauthorized' })
      .mockResolvedValueOnce({ success: true, overrideId: 'ovr_2' });

    render(<MobilePanicPage />);
    await flush();
    await hold(lockdown());
    await flush(10);

    expect(broadcastEmergency).toHaveBeenCalledTimes(2);
    expect(broadcastEmergency.mock.calls[0][0].token).toBe('tab.jwt');
    expect(broadcastEmergency.mock.calls[1][0].token).toBe('fresh.jwt');
    expect(screen.getByText(/Broadcasted/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('a 401 with nothing to restore is reported NOT sent — and says sign-in, not "no authority"', async () => {
    act(() => {
      useUIStore.setState({ token: 'tab.jwt', user: TEACHER as never });
    });
    onRefresh = () => res(401, { refreshed: false, reason: 'rejected' });
    broadcastEmergency.mockResolvedValue({ success: false, error: 'Emergency broadcast failed: 401 — Unauthorized' });

    render(<MobilePanicPage />);
    await flush();
    await hold(lockdown());
    await flush(10);

    expect(broadcastEmergency).toHaveBeenCalledTimes(1);
    expect(screen.getByText('FAILED')).toBeInTheDocument();
    expect(screen.getAllByText(/This phone isn’t signed in\. NOTIFY SECURITY MANUALLY now — your alert was NOT broadcast/).length).toBeGreaterThan(0);
  });
});

describe('3 — a press while the restore is still running', () => {
  it('waits for the restore, then sends — the press is never dropped', async () => {
    const gate = deferred<any>();
    onRefresh = () => gate.promise;
    broadcastEmergency.mockResolvedValue({ success: true, overrideId: 'ovr_3' });

    render(<MobilePanicPage />);
    await hold(lockdown());
    await flush();
    // Held for 3 s; the restore has not answered: nothing sent yet, nothing claimed.
    expect(broadcastEmergency).not.toHaveBeenCalled();
    expect(screen.queryByText(/Broadcasted/i)).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(2000);
      gate.resolve(refreshed('late.jwt'));
    });
    await flush(10);

    expect(broadcastEmergency).toHaveBeenCalledTimes(1);
    expect(broadcastEmergency.mock.calls[0][0]).toMatchObject({ token: 'late.jwt', schoolId: 't1' });
    // All screens = the restored person's own tenant (the target captured at
    // hold start predated knowing who was signed in).
    expect(screen.getByTestId('panic-sent-summary')).toHaveTextContent(/all/i);
    expect(screen.getByText(/Broadcasted/i)).toBeInTheDocument();
  });

  it('is bounded: a restore that never answers ends in "NOT broadcast", and nothing is sent', async () => {
    onRefresh = () => new Promise(() => undefined);
    render(<MobilePanicPage />);
    await hold(lockdown());
    await act(async () => {
      jest.advanceTimersByTime(6000);
    });
    await flush(10);

    expect(broadcastEmergency).not.toHaveBeenCalled();
    expect(screen.getByText('FAILED')).toBeInTheDocument();
    expect(screen.getAllByText(/could not be checked in time\. NOTIFY SECURITY MANUALLY now — your alert was NOT broadcast/).length).toBeGreaterThan(0);
  });

  it('an account restored WITHOUT authority is shown that — the held alert is not sent', async () => {
    const gate = deferred<any>();
    onRefresh = () => gate.promise;
    render(<MobilePanicPage />);
    await hold(lockdown());
    await act(async () => {
      gate.resolve(refreshed('viewer.jwt', { ...TEACHER, canTriggerPanic: false }));
    });
    await flush(10);
    expect(broadcastEmergency).not.toHaveBeenCalled();
    expect(screen.getByText(/No Trigger Authority/i)).toBeInTheDocument();
  });
});

describe('4 — no remembered session at all: sign-in, made clear it is for the panic button', () => {
  it('shows the panic sign-in screen only after the restore said "none", and routes only on a tap', async () => {
    onRefresh = () => res(401, { refreshed: false, reason: 'no-cookie' });
    render(<MobilePanicPage />);
    await flush();

    expect(screen.getByTestId('panic-sign-in')).toBeInTheDocument();
    expect(screen.getByText('Sign in to use the emergency button')).toBeInTheDocument();
    expect(screen.getByText(/NOTIFY SECURITY MANUALLY\. Then sign in once/)).toBeInTheDocument();
    // Never an automatic redirect.
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('panic-sign-in-button'));
    expect(push).toHaveBeenCalledWith('/login?redirect=/panic&reason=panic');
  });
});
