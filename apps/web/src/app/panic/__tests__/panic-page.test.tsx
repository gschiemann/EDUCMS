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
let onPanic: (action: string, init: any) => any;
const res = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function routeFetch() {
  (global as any).fetch = jest.fn(async (input: any, init?: any) => {
    const url = String(input);
    if (url === '/api/session/refresh') return onRefresh();
    if (url.startsWith('/api/panic/')) return onPanic(url.slice('/api/panic/'.length), init);
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
  document.cookie = 'venueos_pm=; Max-Age=0; Path=/';
  onPanic = () => res(401, { ok: false, reason: 'no-cookie' });
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

describe('2026-11-14 — panic phones on the page', () => {
  const DEVICE_STATUS = { device: { id: 'pd-1', label: 'iPhone · Safari' }, user: TEACHER };

  it('a ready phone is used FIRST on a cold start; the alert goes through /api/panic/trigger, never the session action', async () => {
    document.cookie = 'venueos_pm=1; Path=/';
    const panicCalls: Array<{ action: string; body: any }> = [];
    onPanic = (action, init) => {
      panicCalls.push({ action, body: init?.body ? JSON.parse(init.body) : null });
      if (action === 'status') return res(200, DEVICE_STATUS);
      if (action === 'trigger') return res(200, { success: true, overrideId: 'ovr_pd' });
      if (action === 'active') return res(200, { alerts: panicCalls.some((c) => c.action === 'trigger') ? [LIVE_TENANT_ALERT] : [] });
      if (action === 'targets') return res(200, TARGETS);
      return res(404, {});
    };
    const refresh = jest.fn(() => res(200, {}));
    onRefresh = refresh;
    render(<MobilePanicPage />);
    await flush();
    expect(screen.getByTestId('panic-phone-ready')).toHaveTextContent('iPhone · Safari');
    expect(refresh).not.toHaveBeenCalled();

    await hold(lockdown());
    await flush(10);
    expect(broadcastEmergency).not.toHaveBeenCalled();
    expect(panicCalls.find((c) => c.action === 'trigger')?.body).toEqual({ type: 'lockdown' });
    expect(screen.getByText(/Broadcasted/i)).toBeInTheDocument();
  });

  it('a signed-in person with authority is offered "Keep this phone ready"; one tap enrols with the page’s own session', async () => {
    act(() => {
      useUIStore.setState({ token: 'fresh.jwt', user: TEACHER as never });
    });
    let enrollAuth: string | null = null;
    onPanic = (action, init) => {
      if (action === 'enroll') {
        enrollAuth = init?.headers?.Authorization ?? null;
        document.cookie = 'venueos_pm=1; Path=/';
        return res(200, { enrolled: true, device: { id: 'pd-2', label: 'iPhone · Safari' } });
      }
      return res(401, { ok: false, reason: 'no-cookie' });
    };
    render(<MobilePanicPage />);
    await flush();
    expect(screen.getByTestId('panic-keep-ready')).toHaveTextContent(/Keep this phone ready for emergencies/);
    await act(async () => {
      fireEvent.click(screen.getByTestId('panic-keep-ready-button'));
    });
    await flush();
    expect(enrollAuth).toBe('Bearer fresh.jwt');
    expect(screen.queryByTestId('panic-keep-ready')).toBeNull();
  });

  it('an old sign-in is sent through a FRESH sign-in before a phone can be kept ready', async () => {
    act(() => {
      useUIStore.setState({ token: 'old.jwt', user: TEACHER as never });
    });
    onPanic = (action) => (action === 'enroll' ? res(403, { enrolled: false, reason: 'stale-login' }) : res(401, { reason: 'no-cookie' }));
    render(<MobilePanicPage />);
    await flush();
    await act(async () => {
      fireEvent.click(screen.getByTestId('panic-keep-ready-button'));
    });
    await flush();
    fireEvent.click(screen.getByText('Sign in'));
    expect(push).toHaveBeenCalledWith('/login?redirect=/panic&reason=panic-enroll');
  });
});

// EMG-01 (2026-11-21) — the tenant-wide alert carries an id. Ending it from
// /panic sends that id; if another operator replaced the alert in the
// meantime the server refuses (409 ALERT_CHANGED) and clears NOTHING, and the
// page must say so, re-read the list, and leave the newer alert to its own hold.
describe('6 — ending an alert that was replaced meanwhile', () => {
  const tenantAlert = (alertId: string, type: string) => ({ ...LIVE_TENANT_ALERT, alertId, type });
  it('sends the listed id, says a newer alert is active, and shows it for review', async () => {
    const defaultActive = fetchActiveAlerts.getMockImplementation();
    let serverHolds: 'hold' | 'lockdown' = 'hold';
    (fetchActiveAlerts as jest.Mock).mockImplementation(async () => [
      serverHolds === 'hold' ? tenantAlert('ovr_hold', 'HOLD') : tenantAlert('ovr_lockdown', 'LOCKDOWN'),
    ]);
    allClearEmergency.mockImplementation(async () => {
      serverHolds = 'lockdown';
      return { success: false, error: 'All clear failed: 409', code: 'ALERT_CHANGED', currentAlertType: 'LOCKDOWN' };
    });
    try {
      act(() => {
        useUIStore.setState({ token: 'tab.jwt', user: TEACHER as never });
      });
      render(<MobilePanicPage />);
      await flush();
      expect(screen.getByTestId('panic-active-alerts')).toHaveTextContent(/Hold/);

      fireEvent.click(screen.getByTestId('panic-active-alerts'));
      const end = screen.getByTestId('panic-hold-to-end');
      fireEvent.keyDown(end, { key: ' ' });
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });
      await flush(10);

      expect(allClearEmergency).toHaveBeenCalledTimes(1);
      expect(allClearEmergency.mock.calls[0][0]).toMatchObject({ overrideId: 'ovr_hold', scopeType: 'tenant', scopeId: 't1', token: 'tab.jwt' });
      const sheet = screen.getByTestId('panic-alerts-sheet');
      expect(sheet).toHaveTextContent('All-clear was NOT sent — the alert is still on screens.');
      expect(sheet).toHaveTextContent('A newer alert is now active (Lockdown), so nothing was cleared.');
      // The list was re-read: the Lockdown is what the sheet now offers to end.
      expect(screen.getByTestId('panic-active-alerts')).toHaveTextContent(/Lockdown/);
      expect(sheet).toHaveTextContent(/Lockdown/);
    } finally {
      if (defaultActive) fetchActiveAlerts.mockImplementation(defaultActive);
      allClearEmergency.mockReset();
    }
  });

  // Review round 1 — a 409 without the type (an API older than the filter
  // fix, a proxy that stripped the body) still names the newer alert, from
  // the list the page just re-read.
  it('names the newer alert from the re-read list when the 409 carries no type', async () => {
    const defaultActive = fetchActiveAlerts.getMockImplementation();
    let serverHolds: 'hold' | 'lockdown' = 'hold';
    (fetchActiveAlerts as jest.Mock).mockImplementation(async () => [
      serverHolds === 'hold' ? tenantAlert('ovr_hold', 'HOLD') : tenantAlert('ovr_lockdown', 'LOCKDOWN'),
    ]);
    allClearEmergency.mockImplementation(async () => {
      serverHolds = 'lockdown';
      return { success: false, error: 'All clear failed: 409', code: 'ALERT_CHANGED' };
    });
    try {
      act(() => {
        useUIStore.setState({ token: 'tab.jwt', user: TEACHER as never });
      });
      render(<MobilePanicPage />);
      await flush();
      fireEvent.click(screen.getByTestId('panic-active-alerts'));
      const end = screen.getByTestId('panic-hold-to-end');
      fireEvent.keyDown(end, { key: ' ' });
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });
      await flush(10);
      expect(screen.getByTestId('panic-alerts-sheet')).toHaveTextContent('A newer alert is now active (Lockdown), so nothing was cleared.');
    } finally {
      if (defaultActive) fetchActiveAlerts.mockImplementation(defaultActive);
      allClearEmergency.mockReset();
    }
  });

  // Review round 2 — the re-read after the 409 FAILS. The sheet must not keep
  // offering the replaced alert (every hold would get another 409): it shows
  // the alert the 409 named, and the next hold ends that one by its id.
  it('a 409 whose list re-read fails does not loop: the next hold ends the alert the 409 named', async () => {
    const defaultActive = fetchActiveAlerts.getMockImplementation();
    let listDown = false;
    (fetchActiveAlerts as jest.Mock).mockImplementation(async () => {
      if (listDown) throw new Error('/emergency/active failed: 503');
      return [tenantAlert('ovr_hold', 'HOLD')];
    });
    allClearEmergency
      .mockImplementationOnce(async () => {
        listDown = true;
        return {
          success: false,
          error: 'All clear failed: 409',
          code: 'ALERT_CHANGED',
          currentAlertType: 'LOCKDOWN',
          currentAlert: { alertId: 'ovr_lockdown', scopeId: 't1', type: 'LOCKDOWN', isDrill: false },
        };
      })
      .mockImplementation(async () => ({ success: true }));
    try {
      act(() => {
        useUIStore.setState({ token: 'tab.jwt', user: TEACHER as never });
      });
      render(<MobilePanicPage />);
      await flush();
      fireEvent.click(screen.getByTestId('panic-active-alerts'));
      const holdToEnd = async () => {
        fireEvent.keyDown(screen.getByTestId('panic-hold-to-end'), { key: ' ' });
        await act(async () => {
          jest.advanceTimersByTime(3000);
        });
        await flush(10);
      };
      await holdToEnd();
      expect(allClearEmergency.mock.calls[0][0]).toMatchObject({ overrideId: 'ovr_hold', scopeType: 'tenant', scopeId: 't1' });
      const sheet = screen.getByTestId('panic-alerts-sheet');
      expect(sheet).toHaveTextContent('A newer alert is now active (Lockdown), so nothing was cleared.');
      // The re-read failed, but the sheet now offers the Lockdown, not the Hold.
      expect(sheet).toHaveTextContent(/Lockdown/);
      expect(screen.getByTestId('panic-active-alerts')).toHaveTextContent(/Lockdown/);

      await holdToEnd();
      expect(allClearEmergency).toHaveBeenCalledTimes(2);
      expect(allClearEmergency.mock.calls[1][0]).toMatchObject({ overrideId: 'ovr_lockdown', scopeType: 'tenant', scopeId: 't1' });
      expect(allClearEmergency.mock.calls[1][0]).not.toHaveProperty('isDrill');
    } finally {
      if (defaultActive) fetchActiveAlerts.mockImplementation(defaultActive);
      allClearEmergency.mockReset();
    }
  });

  // Review round 3 — the id an entry names, and the aim after a 409, are
  // computed from the SAME tenant the request is sent under. After a 401 the
  // resend may run under a restored session of another tenant; the fallback
  // id this page remembers belongs to the tenant it was sent from, so the
  // resend must not carry it, and the bookkeeping follows what was sent.
  // (This pins the rule; before round 3 the request already followed it and
  // only the 409 bookkeeping read the first session's tenant.)
  it('a resend after a 401 names what the restored session’s tenant names, never the first session’s fallback id', async () => {
    act(() => {
      useUIStore.setState({ token: 'tab.jwt', user: TEACHER as never });
    });
    broadcastEmergency.mockResolvedValue({ success: true, overrideId: 'ovr_mine' });
    onRefresh = () => refreshed('other.jwt', { ...TEACHER, id: 'u-other', email: 'other@lincoln.test', tenantId: 't2' });
    allClearEmergency
      .mockResolvedValueOnce({ success: false, error: 'All clear failed: 401' })
      .mockResolvedValue({ success: true });
    render(<MobilePanicPage />);
    await flush();
    // This page sends the All-screens alert (it remembers its id), and the
    // server lists it without one (an alert from before alert identity).
    await hold(lockdown());
    await flush(10);
    fireEvent.click(screen.getByTestId('panic-back-to-panel'));
    await flush(10);
    fireEvent.click(screen.getByTestId('panic-active-alerts'));
    fireEvent.keyDown(screen.getByTestId('panic-hold-to-end'), { key: ' ' });
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    await flush(10);

    expect(allClearEmergency).toHaveBeenCalledTimes(2);
    expect(allClearEmergency.mock.calls[0][0]).toMatchObject({ token: 'tab.jwt', scopeId: 't1', overrideId: 'ovr_mine' });
    expect(allClearEmergency.mock.calls[1][0]).toMatchObject({ token: 'other.jwt', scopeId: 't1' });
    expect(allClearEmergency.mock.calls[1][0].overrideId).toBeUndefined();
  });
});


// 2026-11-23 — on a short screen the six trigger buttons own the space. The
// 2026-11-16 train put the panic-phone row ABOVE the `flex-1 min-h-0` grid,
// so its height came off the buttons (65 px at 390 × 664, under the 88 px
// floor emergency-targeting.spec.ts holds them to). Under 800 px tall the row
// now follows the grid; 800 px and taller is unchanged. jsdom has no layout,
// so this pins the DOM order; the geometry is the e2e spec's.
describe('7 — short screens: the panic-phone row follows the buttons', () => {
  const SHORT = '(max-height: 799px)';
  const DEVICE_STATUS = { device: { id: 'pd-1', label: 'iPhone · Safari' }, user: TEACHER };
  let shortMatches: boolean;
  let listeners: Array<() => void>;
  // jsdom has no matchMedia (the hook then reads false, today's layout).
  const realMatchMedia: unknown = window.matchMedia;
  const setMatchMedia = (value: unknown) =>
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value });

  beforeEach(() => {
    shortMatches = false;
    listeners = [];
    setMatchMedia(
      jest.fn(
        (query: string) =>
          ({
            get matches() {
              return query === SHORT && shortMatches;
            },
            media: query,
            onchange: null,
            addEventListener: (_: string, fn: () => void) => listeners.push(fn),
            removeEventListener: (_: string, fn: () => void) => {
              listeners = listeners.filter((l) => l !== fn);
            },
            addListener: (fn: () => void) => listeners.push(fn),
            removeListener: (fn: () => void) => {
              listeners = listeners.filter((l) => l !== fn);
            },
            dispatchEvent: () => true,
          }) as unknown as MediaQueryList,
      ),
    );
  });

  afterEach(() => {
    setMatchMedia(realMatchMedia);
  });

  const triggerButtons = () => screen.getAllByRole('button', { name: /^Trigger .* emergency/ });
  const follows = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  /** A signed-in admin without a ready phone: the keep-ready card shows. */
  async function renderSignedIn() {
    act(() => {
      useUIStore.setState({ token: 'fresh.jwt', user: TEACHER as never });
    });
    render(<MobilePanicPage />);
    await flush();
    expect(triggerButtons()).toHaveLength(6);
    return screen.getByTestId('panic-keep-ready');
  }

  it('matching (max-height: 799px): the keep-ready card comes AFTER all six buttons, inside the below-grid row', async () => {
    shortMatches = true;
    const card = await renderSignedIn();
    for (const b of triggerButtons()) expect(follows(b, card)).toBe(true);
    expect(screen.getByTestId('panic-phone-row-below')).toContainElement(card);
    // Same card, same copy, same handlers.
    expect(card).toHaveTextContent(/Keep this phone ready for emergencies/);
    expect(screen.getByTestId('panic-keep-ready-button')).toBeEnabled();
    // The root scrolls so the card is reachable.
    expect(card.closest('.fixed')?.className).toContain('overflow-y-auto');
  });

  it('not matching: today’s order — the card comes BEFORE the buttons, no below-grid row, no scrolling root', async () => {
    shortMatches = false;
    const card = await renderSignedIn();
    for (const b of triggerButtons()) expect(follows(card, b)).toBe(true);
    expect(screen.queryByTestId('panic-phone-row-below')).toBeNull();
    expect(card.closest('.fixed')?.className).not.toContain('overflow-y-auto');
  });

  it('no below-grid row is rendered when no panic-phone row shows (the card dismissed)', async () => {
    shortMatches = true;
    await renderSignedIn();
    expect(screen.getByTestId('panic-phone-row-below')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Not now/i }));
    expect(screen.queryByTestId('panic-keep-ready')).toBeNull();
    expect(screen.queryByTestId('panic-phone-row-below')).toBeNull();
    expect(triggerButtons()).toHaveLength(6);
  });

  it('a set-up phone on a short screen: the ready line follows the buttons, with its Turn off control', async () => {
    shortMatches = true;
    document.cookie = 'venueos_pm=1; Path=/';
    onPanic = (action) => {
      if (action === 'status') return res(200, DEVICE_STATUS);
      if (action === 'active') return res(200, { alerts: [] });
      if (action === 'targets') return res(200, TARGETS);
      return res(404, {});
    };
    render(<MobilePanicPage />);
    await flush();
    const line = screen.getByTestId('panic-phone-ready');
    expect(line).toHaveTextContent('iPhone · Safari');
    for (const b of triggerButtons()) expect(follows(b, line)).toBe(true);
    expect(screen.getByTestId('panic-phone-row-below')).toContainElement(screen.getByTestId('panic-phone-turn-off'));
  });

  it('crossing 800 px mid-hold moves the card but never remounts a trigger button: an early release still cancels', async () => {
    shortMatches = false;
    const card = await renderSignedIn();
    const before = triggerButtons();
    expect(follows(card, before[0])).toBe(true);

    // Start a hold, then the screen gets shorter (a rotation) one second in.
    const pressed = lockdown();
    fireEvent.keyDown(pressed, { key: ' ' });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    shortMatches = true;
    act(() => {
      for (const l of listeners) l();
    });
    const after = triggerButtons();
    after.forEach((b, i) => expect(b).toBe(before[i]));
    const moved = screen.getByTestId('panic-keep-ready');
    for (const b of after) expect(follows(b, moved)).toBe(true);

    // Released before 3 s on the SAME element: nothing is sent.
    fireEvent.keyUp(pressed, { key: ' ' });
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    await flush();
    expect(broadcastEmergency).not.toHaveBeenCalled();
    expect(screen.queryByText(/Broadcasted/i)).toBeNull();
  });
});
