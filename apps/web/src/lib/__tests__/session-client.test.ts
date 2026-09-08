/**
 * SEC-010 (2026-09-05) — browser half of the durable session.
 *
 * The two properties that keep this from becoming an incident:
 *
 *   1. SINGLE-FLIGHT. A dashboard load fires a dozen queries at once; when
 *      the hour-old access token has expired they all 401 together. Without
 *      the single-flight, each would spend the refresh cookie — and the
 *      server correctly grades a second spend as a REPLAY and revokes the
 *      whole family. Twelve parallel 401s must produce exactly ONE refresh.
 *   2. NO TIMER. CLAUDE.md's mobile-perf standard is binding: a backgrounded
 *      phone must not run pollers. Refresh happens on demand, or not at all.
 */
import {
  __resetSessionRefreshState,
  adoptRememberedSession,
  endRememberedSession,
  hasRememberMarker,
  refreshRememberedSession,
  REMEMBER_MARKER_KEY,
  setRememberMarker,
} from '../session-client';

const realFetch = global.fetch;

function mockFetch(impl: (url: string, init: any) => any) {
  const fn = jest.fn(async (url: any, init: any) => impl(String(url), init));
  (global as any).fetch = fn;
  return fn;
}

beforeEach(() => {
  __resetSessionRefreshState();
  window.localStorage.clear();
});
afterAll(() => {
  (global as any).fetch = realFetch;
});

function jsonRes(body: any, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('session-client — no timers', () => {
  it('the module source contains no interval/timeout scheduling', () => {
    // A guard, not a formality: an "it feels snappier if we pre-refresh
    // every 10 minutes" patch is exactly the change the mobile-perf standard
    // exists to stop, and it would be invisible in review.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'session-client.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/setInterval|setTimeout\s*\(/);
  });
});

describe('refreshRememberedSession — single-flight', () => {
  it('twelve simultaneous callers spend the cookie exactly once', async () => {
    const fetchMock = mockFetch(() =>
      jsonRes({ refreshed: true, access_token: 'fresh.jwt', user: { id: 'u1' } }),
    );
    const results = await Promise.all(
      Array.from({ length: 12 }, () => refreshRememberedSession()),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r?.access_token === 'fresh.jwt')).toBe(true);
  });

  it('sends the custom header the BFF requires, same-origin, and no bearer', async () => {
    const fetchMock = mockFetch(() => jsonRes({ refreshed: true, access_token: 't', user: null }));
    await refreshRememberedSession();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/session/refresh'); // relative → this origin only
    expect(init.credentials).toBe('same-origin');
    expect(init.headers['x-venueos-session']).toBe('1');
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('a 401 clears the remember marker so the next cold start skips the round trip', async () => {
    setRememberMarker(true);
    mockFetch(() => jsonRes({ refreshed: false }, 401));
    const res = await refreshRememberedSession();
    expect(res).toBeNull();
    expect(hasRememberMarker()).toBe(false);
  });

  it('a NETWORK failure keeps the marker — retryable, not a sign-out', async () => {
    setRememberMarker(true);
    mockFetch(() => {
      throw new TypeError('offline');
    });
    expect(await refreshRememberedSession()).toBeNull();
    expect(hasRememberMarker()).toBe(true);
  });

  it('a 503 (API could not reach its revocation store) keeps the marker too', async () => {
    setRememberMarker(true);
    mockFetch(() => jsonRes({ refreshed: false, reason: 'retry' }, 503));
    expect(await refreshRememberedSession()).toBeNull();
    expect(hasRememberMarker()).toBe(true);
  });

  it('a later caller starts a NEW flight once the first has settled', async () => {
    const fetchMock = mockFetch(() => jsonRes({ refreshed: true, access_token: 'a', user: null }));
    await refreshRememberedSession();
    await new Promise((r) => queueMicrotask(() => r(null)));
    await refreshRememberedSession();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/**
 * The single-flight above is per-TAB. The cookie is per-BROWSER. Two tabs
 * that 401 in the same second both present the SAME refresh token, the
 * server correctly grades the second as a replay, and it revokes the family
 * — the operator is signed out everywhere and a false
 * AUTH_SESSION_REFRESH_REUSE row lands in the audit log. Two dashboard
 * windows side by side are BOTH `visible`, so both run their React Query
 * intervals, so both 401 together the first time the hour-old access token
 * lapses: this is an ordinary Tuesday, not an edge case.
 *
 * Web Locks scopes to (origin × browser profile) — exactly the scope of the
 * cookie jar — so it is the right primitive. jsdom has no `navigator.locks`,
 * which is itself the fall-through case the first test pins.
 */
describe('refreshRememberedSession — cross-tab serialisation', () => {
  const realLocks = (navigator as any).locks;
  afterEach(() => {
    if (realLocks === undefined) delete (navigator as any).locks;
    else (navigator as any).locks = realLocks;
  });

  it('runs unlocked when the browser has no Web Locks (never a wedge)', async () => {
    delete (navigator as any).locks;
    const fetchMock = mockFetch(() => jsonRes({ refreshed: true, access_token: 'a', user: null }));
    expect((await refreshRememberedSession())?.access_token).toBe('a');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serialises two TABS through one exclusive lock — no overlapping spend', async () => {
    // A minimal, faithful Web Locks: exclusive, FIFO, one holder at a time.
    // Both "tabs" share it, the way two real tabs share the browser's.
    let chain: Promise<unknown> = Promise.resolve();
    let concurrent = 0;
    let maxConcurrent = 0;
    (navigator as any).locks = {
      request: (_name: string, _opts: any, cb: () => Promise<any>) => {
        const run = chain.then(async () => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          try {
            return await cb();
          } finally {
            concurrent -= 1;
          }
        });
        chain = run.catch(() => undefined);
        return run;
      },
    };

    // Each "tab" gets its own single-flight state, so only the lock can
    // separate them — exactly the situation two real tabs are in.
    const order: string[] = [];
    const fetchMock = mockFetch(async () => {
      order.push('start');
      await new Promise((r) => queueMicrotask(() => r(null)));
      order.push('end');
      return jsonRes({ refreshed: true, access_token: 'a', user: null });
    });

    const tabA = refreshRememberedSession();
    __resetSessionRefreshState();
    const tabB = refreshRememberedSession();
    await Promise.all([tabA, tabB]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(maxConcurrent).toBe(1);
    // Strictly interleaved would be start,start,end,end — serialised is not.
    expect(order).toEqual(['start', 'end', 'start', 'end']);
  });

  it('falls through to a direct refresh when the lock wait is ABORTED', async () => {
    // A holder tab frozen by the OS must never be able to strand a session.
    (navigator as any).locks = {
      request: async () => {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      },
    };
    const fetchMock = mockFetch(() => jsonRes({ refreshed: true, access_token: 'a', user: null }));
    expect((await refreshRememberedSession())?.access_token).toBe('a');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-run the body when the body itself threw inside the lock', async () => {
    // The whole point of the lock is one spend per acquisition. Treating a
    // body error as an acquisition failure would double-spend the cookie —
    // which is precisely the replay the server revokes families over.
    let calls = 0;
    (navigator as any).locks = {
      request: async (_n: string, _o: any, cb: () => Promise<any>) => cb(),
    };
    mockFetch(() => {
      calls += 1;
      // Not a network error the body catches — a hard throw past it.
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw Object.assign(new Error('boom'), { name: 'HardFailure' });
    });
    // The body swallows fetch errors by design, so this asserts the shape
    // that matters: exactly one fetch, whatever the outcome.
    await refreshRememberedSession();
    expect(calls).toBe(1);
  });
});

describe('adoptRememberedSession', () => {
  it('sets the marker only when the server actually issued a cookie', async () => {
    mockFetch(() => jsonRes({ adopted: true }));
    expect(await adoptRememberedSession('access.jwt')).toBe(true);
    expect(hasRememberMarker()).toBe(true);

    window.localStorage.clear();
    mockFetch(() => jsonRes({ adopted: false }));
    expect(await adoptRememberedSession('access.jwt')).toBe(false);
    expect(hasRememberMarker()).toBe(false);
  });

  it('never throws — a failed adopt must not fail the login', async () => {
    mockFetch(() => {
      throw new TypeError('offline');
    });
    await expect(adoptRememberedSession('access.jwt')).resolves.toBe(false);
  });
});

describe('endRememberedSession', () => {
  it('clears the marker BEFORE the network call, so logout is never blocked by it', async () => {
    setRememberMarker(true);
    let markerAtCallTime: string | null = 'unset';
    mockFetch(() => {
      markerAtCallTime = window.localStorage.getItem(REMEMBER_MARKER_KEY);
      return jsonRes({ ended: true });
    });
    await endRememberedSession();
    expect(markerAtCallTime).toBeNull();
    expect(hasRememberMarker()).toBe(false);
  });
});
