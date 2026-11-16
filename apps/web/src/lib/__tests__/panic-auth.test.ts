/**
 * /panic's credential rules (2026-11-14), framework-free.
 *
 * The defect: the emergency home-screen app redirected to /login on a missing
 * token or a 401 without trying the remembered-session restore. Each case
 * below is one rule from `panic-auth.ts`; the page-level proof that the page
 * obeys them is `app/panic/__tests__/panic-page.test.tsx`.
 */
import { createPanicAuth, failedStatusOf, type PanicAuthDeps, type PanicAuthState } from '../panic-auth';
import type { RefreshAttempt } from '../session-client';

const ME = { id: 'u1', email: 'teacher@school.test', role: 'CONTRIBUTOR', tenantId: 't1', canTriggerPanic: true };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(over: Partial<PanicAuthDeps> & { token?: string | null; user?: any } = {}) {
  const states: PanicAuthState[] = [];
  const adopted: Array<{ token: string; user: any }> = [];
  const deps: PanicAuthDeps = {
    readSession: () => ({ token: over.token ?? null, user: over.user ?? null }),
    adoptSession: (token, user) => adopted.push({ token, user }),
    verify: over.verify ?? (async () => ({ ok: true, status: 200, json: async () => ME })),
    refresh: over.refresh ?? (async (): Promise<RefreshAttempt> => ({ result: null, outcome: 'refused' })),
    onChange: (s) => states.push(s),
    ...(over.hasDeviceMarker ? { hasDeviceMarker: over.hasDeviceMarker } : {}),
    ...(over.deviceStatus ? { deviceStatus: over.deviceStatus } : {}),
    ...(over.setTimer ? { setTimer: over.setTimer } : {}),
    ...(over.clearTimer ? { clearTimer: over.clearTimer } : {}),
  };
  return { auth: createPanicAuth(deps), states, adopted, deps };
}

const restored = (token = 'restored.jwt'): RefreshAttempt => ({
  result: { access_token: token, user: ME },
  outcome: 'refreshed',
});

describe('cold start — the remembered session is tried BEFORE sign-in', () => {
  it('no token in the tab: restores from the cookie and never says "sign in"', async () => {
    const refresh = jest.fn(async () => restored());
    const { auth, states, adopted } = harness({ refresh });
    const end = await auth.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(end).toMatchObject({ status: 'ready', checked: true, credential: { kind: 'session', token: 'restored.jwt' } });
    expect(states.map((s) => s.status)).toEqual(['resolving', 'ready']);
    expect(states.some((s) => s.status === 'signin')).toBe(false);
    // Into the store, as a REMEMBERED session, so the rest of the app has it.
    expect(adopted).toEqual([{ token: 'restored.jwt', user: ME }]);
  });

  it('asks even with no remember marker visible — the marker has disagreed with the cookie jar before', async () => {
    // Nothing about markers in the inputs at all: the only evidence of a
    // remembered session is the refresh route's answer.
    const refresh = jest.fn(async () => restored());
    const { auth } = harness({ refresh });
    await auth.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('sign-in ONLY when the browser has no remembered session (refused: no cookie / the API said no)', async () => {
    const { auth, states } = harness({ refresh: async () => ({ result: null, outcome: 'refused' }) });
    expect(await auth.resolve()).toEqual({ status: 'signin' });
    expect(states.map((s) => s.status)).toEqual(['resolving', 'signin']);
  });

  it('offline is "unreachable", never "sign in" — no signal is not "you were signed out"', async () => {
    const { auth } = harness({ refresh: async () => ({ result: null, outcome: 'unavailable' }) });
    expect(await auth.resolve()).toEqual({ status: 'unreachable' });
    const { auth: thrown } = harness({ refresh: async () => { throw new TypeError('offline'); } });
    expect(await thrown.resolve()).toEqual({ status: 'unreachable' });
  });

  it('a tab session that checks out is used as-is, with the LIVE user from /users/me', async () => {
    const refresh = jest.fn(async () => restored());
    const { auth } = harness({
      token: 'tab.jwt',
      user: { ...ME, canTriggerPanic: false },
      refresh,
      verify: async () => ({ ok: true, status: 200, json: async () => ({ ...ME, canTriggerPanic: true }) }),
    });
    const end = await auth.resolve();
    expect(end).toMatchObject({ status: 'ready', checked: true, credential: { token: 'tab.jwt', user: { canTriggerPanic: true } } });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('a 401 — restore, never a redirect', () => {
  it('the tab token is dead: the remembered session is restored', async () => {
    const refresh = jest.fn(async () => restored('second.jwt'));
    const { auth } = harness({
      token: 'expired.jwt',
      user: ME,
      refresh,
      verify: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    });
    const end = await auth.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(end).toMatchObject({ status: 'ready', credential: { token: 'second.jwt' } });
  });

  it('dead token AND no remembered session: then, and only then, sign-in', async () => {
    const { auth } = harness({
      token: 'expired.jwt',
      user: ME,
      verify: async () => ({ ok: false, status: 401, json: async () => ({}) }),
      refresh: async () => ({ result: null, outcome: 'refused' }),
    });
    expect(await auth.resolve()).toEqual({ status: 'signin' });
  });

  it('a 5xx or a network failure keeps the held session (unchecked) — never strand it mid-emergency', async () => {
    const five = harness({ token: 'tab.jwt', user: ME, verify: async () => ({ ok: false, status: 502, json: async () => ({}) }) });
    expect(await five.auth.resolve()).toMatchObject({ status: 'ready', checked: false, credential: { token: 'tab.jwt' } });
    const net = harness({ token: 'tab.jwt', user: ME, verify: async () => { throw new TypeError('offline'); } });
    expect(await net.auth.resolve()).toMatchObject({ status: 'ready', checked: false, credential: { token: 'tab.jwt' } });
  });

  it('recover() after a 401 on a real request: one restore, shared by concurrent callers', async () => {
    const gate = deferred<RefreshAttempt>();
    const refresh = jest.fn(() => gate.promise);
    const { auth } = harness({ token: 'tab.jwt', user: ME, refresh });
    await auth.resolve();
    const a = auth.recover();
    const b = auth.recover();
    gate.resolve(restored('third.jwt'));
    expect((await a)?.token).toBe('third.jwt');
    expect((await b)?.token).toBe('third.jwt');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(auth.state).toMatchObject({ status: 'ready', credential: { token: 'third.jwt' } });
  });

  it('recover() with nothing to restore retires the dead credential (never offered again)', async () => {
    const { auth } = harness({ token: 'tab.jwt', user: ME, refresh: async () => ({ result: null, outcome: 'refused' }) });
    await auth.resolve();
    expect(await auth.recover()).toBeNull();
    expect(auth.state).toEqual({ status: 'signin' });
  });
});

describe('a press while the check is still running', () => {
  it('waits for it, then hands over the credential — the press is never dropped', async () => {
    const gate = deferred<RefreshAttempt>();
    const { auth } = harness({ refresh: () => gate.promise });
    void auth.resolve();
    const press = auth.credentialForPress(6000);
    let settled = false;
    void press.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    gate.resolve(restored('late.jwt'));
    expect(await press).toEqual({ credential: expect.objectContaining({ token: 'late.jwt' }) });
  });

  it('is BOUNDED: a check that never answers gives "timeout", and nothing is invented', async () => {
    jest.useFakeTimers();
    try {
      const { auth } = harness({ refresh: () => new Promise<RefreshAttempt>(() => undefined) });
      void auth.resolve();
      const press = auth.credentialForPress(6000);
      jest.advanceTimersByTime(5999);
      await Promise.resolve();
      jest.advanceTimersByTime(1);
      expect(await press).toEqual({ credential: null, reason: 'timeout' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('unreachable at open: a press makes one fresh attempt (the signal may be back)', async () => {
    const refresh = jest
      .fn<Promise<RefreshAttempt>, []>()
      .mockResolvedValueOnce({ result: null, outcome: 'unavailable' })
      .mockResolvedValueOnce(restored('back.jwt'));
    const { auth } = harness({ refresh });
    expect(await auth.resolve()).toEqual({ status: 'unreachable' });
    expect(await auth.credentialForPress(6000)).toEqual({ credential: expect.objectContaining({ token: 'back.jwt' }) });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('no remembered session: the press gets "signin" at once — no network, no wait', async () => {
    const refresh = jest.fn(async (): Promise<RefreshAttempt> => ({ result: null, outcome: 'refused' }));
    const { auth } = harness({ refresh });
    await auth.resolve();
    expect(await auth.credentialForPress(6000)).toEqual({ credential: null, reason: 'signin' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('a session that reaches the store from elsewhere', () => {
  it('is adopted after the pass ended empty-handed (another component restored it)', async () => {
    const { auth } = harness({ refresh: async () => ({ result: null, outcome: 'unavailable' }) });
    await auth.resolve();
    auth.noteSession('store.jwt', ME as any);
    expect(auth.state).toMatchObject({ status: 'ready', checked: false, credential: { token: 'store.jwt' } });
  });

  it('is ignored while a pass is in flight (the pass reads the store itself)', async () => {
    const gate = deferred<RefreshAttempt>();
    const { auth } = harness({ refresh: () => gate.promise });
    void auth.resolve();
    auth.noteSession('store.jwt', ME as any);
    expect(auth.state).toEqual({ status: 'resolving' });
    gate.resolve(restored('pass.jwt'));
    await auth.resolve();
    expect(auth.state).toMatchObject({ credential: { token: 'pass.jwt' } });
  });
});

describe('2026-11-14 — cold-start order: panic phone → remembered session → sign-in', () => {
  const DEVICE = { device: { id: 'pd-1', label: 'iPhone · Safari' }, user: ME };

  it('a ready phone is the credential, and the cookie restore is never spent', async () => {
    const refresh = jest.fn(async () => restored());
    const { auth } = harness({ refresh, hasDeviceMarker: () => true, deviceStatus: async () => ({ ok: true, body: DEVICE }) } as any);
    expect(await auth.resolve()).toMatchObject({ status: 'ready', credential: { kind: 'device', token: null, deviceId: 'pd-1' } });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a phone the server turned off falls back to the remembered session', async () => {
    const { auth } = harness({
      refresh: async () => restored('cookie.jwt'),
      hasDeviceMarker: () => true,
      deviceStatus: async () => ({ ok: false, outcome: 'refused' }),
    } as any);
    expect(await auth.resolve()).toMatchObject({ status: 'ready', credential: { kind: 'session', token: 'cookie.jwt' } });
  });

  it('refused phone AND no remembered session: sign-in', async () => {
    const { auth } = harness({ hasDeviceMarker: () => true, deviceStatus: async () => ({ ok: false, outcome: 'refused' }) } as any);
    expect(await auth.resolve()).toEqual({ status: 'signin' });
  });

  it('a phone that could not be CHECKED (offline / switched off) with no session is "unreachable", never sign-in', async () => {
    const { auth } = harness({ hasDeviceMarker: () => true, deviceStatus: async () => ({ ok: false, outcome: 'unavailable' }) } as any);
    expect(await auth.resolve()).toEqual({ status: 'unreachable' });
  });

  it('a tab that already holds a dashboard session uses it (it can also end an alert)', async () => {
    const deviceStatus = jest.fn();
    const { auth } = harness({ token: 'tab.jwt', user: ME, hasDeviceMarker: () => true, deviceStatus } as any);
    expect(await auth.resolve()).toMatchObject({ credential: { kind: 'session', token: 'tab.jwt' } });
    expect(deviceStatus).not.toHaveBeenCalled();
  });
});

describe('failedStatusOf — the status inside a server-action error', () => {
  it.each([
    ['Emergency broadcast failed: 401 — Unauthorized', 401],
    ['Emergency broadcast failed: 403', 403],
    ['All clear failed: 500', 500],
    ['/emergency/active failed: 401', 401],
    ['Network error reaching the server (fetch): offline', null],
    [undefined, null],
  ])('%s → %s', (input, expected) => {
    expect(failedStatusOf(input)).toBe(expected);
  });
});
