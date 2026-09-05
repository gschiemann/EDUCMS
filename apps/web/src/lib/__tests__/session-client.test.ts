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
