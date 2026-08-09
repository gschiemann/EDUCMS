/**
 * Trust-wave D (2026-08-06) — proactive silent token refresh in apiFetch.
 *
 * The defect: a scorekeeper's 1h JWT died mid-game and the 401 handler
 * bounced them to /login in the third quarter. apiFetch now checks the
 * stored token's `exp` after every SUCCESSFUL authed response and, inside
 * the last 15 minutes, silently trades it at POST /auth/refresh.
 *
 * Pinned properties:
 *   - near-expiry triggers exactly ONE background refresh, and the fresh
 *     token is swapped in via the store's setter (atomic, rememberMe-aware);
 *   - concurrent successes dedup onto one in-flight refresh;
 *   - a token with >15min left, an unauthenticated request, and an
 *     already-expired token all schedule NOTHING (zero behavior change);
 *   - a REFUSED refresh is silent — no logout, no token swap, no loop (the
 *     existing 401 session-expired path stays the only teardown).
 */

const mockState: {
  token: string | null;
  setToken: jest.Mock;
  logout: jest.Mock;
} = {
  token: null,
  setToken: jest.fn((t: string) => { mockState.token = t; }),
  logout: jest.fn(() => { mockState.token = null; }),
};

jest.mock('@/store/ui-store', () => ({
  useUIStore: { getState: () => mockState },
}));
jest.mock('../csrf', () => ({
  ensureCsrfToken: jest.fn(async () => 'csrf-tok'),
  invalidateCsrfToken: jest.fn(),
}));
jest.mock('../api-url', () => ({
  API_URL: 'http://api.test/api/v1',
  warnIfMisconfigured: jest.fn(),
}));
jest.mock('../client-logger', () => ({
  clog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../auth-events', () => ({
  emitAuthEvent: jest.fn(),
  subscribeAuthEvents: jest.fn(() => () => {}),
}));

import {
  apiFetch,
  __resetSessionLogoutFired,
  __resetTokenRefreshState,
} from '../api-client';
import { emitAuthEvent } from '../auth-events';

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Structurally-valid unsigned JWT — the client only base64-parses `exp`. */
function jwtWithExp(expSec: number): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'u1', exp: expSec })}.sig`;
}

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
    clone() { return this; },
  } as any;
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** Let the fire-and-forget refresh chain settle (csrf → fetch → json → swap). */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

const fetchMock = jest.fn();

function refreshCalls(): any[][] {
  return fetchMock.mock.calls.filter((c) => String(c[0]).includes('/auth/refresh'));
}

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).fetch = fetchMock;
  mockState.token = null;
  __resetSessionLogoutFired();
  __resetTokenRefreshState();
});

describe('apiFetch — proactive silent refresh', () => {
  it('near-expiry (<15min left) authed success fires ONE refresh and swaps the token', async () => {
    const oldTok = jwtWithExp(nowSec() + 5 * 60);
    mockState.token = oldTok;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/auth/refresh')) {
        return jsonRes(200, { access_token: 'new-token' });
      }
      return jsonRes(200, { ok: true });
    });

    await expect(apiFetch('/screens')).resolves.toEqual({ ok: true });
    await flush();

    const calls = refreshCalls();
    expect(calls).toHaveLength(1);
    // POSTs with the still-valid token + the usual mutation headers.
    expect(calls[0][1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({
        Authorization: `Bearer ${oldTok}`,
        'X-CSRF-Token': 'csrf-tok',
      }),
    });
    expect(mockState.setToken).toHaveBeenCalledWith('new-token');
    expect(mockState.token).toBe('new-token');
    expect(mockState.logout).not.toHaveBeenCalled();
  });

  it('dedups: a second success while a refresh is in flight schedules nothing', async () => {
    mockState.token = jwtWithExp(nowSec() + 5 * 60);
    let resolveRefresh: ((v: any) => void) | undefined;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/auth/refresh')) {
        return new Promise((r) => { resolveRefresh = r; }); // hang until told
      }
      return jsonRes(200, { ok: true });
    });

    await apiFetch('/a');
    await flush(); // first refresh scheduled + hanging
    await apiFetch('/b');
    await flush(); // must NOT schedule a second

    expect(refreshCalls()).toHaveLength(1);

    resolveRefresh!(jsonRes(200, { access_token: 'fresh' }));
    await flush();
    expect(mockState.token).toBe('fresh');

    // In-flight slot cleared — a LATER near-expiry success may refresh again.
    mockState.token = jwtWithExp(nowSec() + 5 * 60);
    await apiFetch('/c');
    await flush();
    expect(refreshCalls()).toHaveLength(2);
  });

  it('does nothing when the token has more than 15 minutes left', async () => {
    mockState.token = jwtWithExp(nowSec() + 60 * 60);
    fetchMock.mockImplementation(async () => jsonRes(200, { ok: true }));

    await apiFetch('/screens');
    await flush();

    expect(refreshCalls()).toHaveLength(0);
    expect(mockState.setToken).not.toHaveBeenCalled();
  });

  it('does nothing for unauthenticated requests', async () => {
    mockState.token = null;
    fetchMock.mockImplementation(async () => jsonRes(200, { ok: true }));

    await apiFetch('/public/status');
    await flush();

    expect(refreshCalls()).toHaveLength(0);
  });

  it('does nothing for an already-expired token (the 401 path owns that)', async () => {
    mockState.token = jwtWithExp(nowSec() - 10);
    fetchMock.mockImplementation(async () => jsonRes(200, { ok: true }));

    await apiFetch('/screens');
    await flush();

    expect(refreshCalls()).toHaveLength(0);
  });

  it('a REFUSED refresh is silent: no logout, no swap, no session-expired event, no loop', async () => {
    const oldTok = jwtWithExp(nowSec() + 5 * 60);
    mockState.token = oldTok;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/auth/refresh')) {
        return jsonRes(401, { code: 'AUTH_REFRESH_WINDOW_EXCEEDED' });
      }
      return jsonRes(200, { ok: true });
    });

    await apiFetch('/screens');
    await flush();

    expect(refreshCalls()).toHaveLength(1); // tried once, never retried
    expect(mockState.setToken).not.toHaveBeenCalled();
    expect(mockState.logout).not.toHaveBeenCalled();
    expect(emitAuthEvent).not.toHaveBeenCalled();
    expect(mockState.token).toBe(oldTok);
  });

  it('a 401-refused token is never re-asked on later responses; a NEW token refreshes again', async () => {
    const refusedTok = jwtWithExp(nowSec() + 5 * 60);
    mockState.token = refusedTok;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/auth/refresh')) {
        return jsonRes(401, { code: 'AUTH_REFRESH_WINDOW_EXCEEDED' });
      }
      return jsonRes(200, { ok: true });
    });

    await apiFetch('/a');
    await flush();
    // The server said no for THIS token — every subsequent success in the
    // session's tail must NOT re-ask (that would be a refresh per response
    // for the token's whole final stretch).
    await apiFetch('/b');
    await flush();
    await apiFetch('/c');
    await flush();
    expect(refreshCalls()).toHaveLength(1);

    // A different token (fresh login) is a new question — allowed. (+6min so
    // the encoded payload differs from the refused token — same exp second
    // would mint a byte-identical JWT and correctly hit the refusal memory.)
    mockState.token = jwtWithExp(nowSec() + 6 * 60);
    await apiFetch('/d');
    await flush();
    expect(refreshCalls()).toHaveLength(2);
  });

  it('a 5xx refresh failure stays retryable on a later response (only 401/403 stand down)', async () => {
    mockState.token = jwtWithExp(nowSec() + 5 * 60);
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/auth/refresh')) {
        return jsonRes(503, { message: 'restarting' });
      }
      return jsonRes(200, { ok: true });
    });

    await apiFetch('/a');
    await flush();
    await apiFetch('/b');
    await flush();

    // Transient server trouble — the client may try again next response.
    expect(refreshCalls()).toHaveLength(2);
    expect(mockState.setToken).not.toHaveBeenCalled();
  });

  it('a CODE-LESS 401 (guard Redis-fail-closed) stays retryable — only explicit policy codes stand down', async () => {
    // JwtAuthGuard throws UnauthorizedException('Auth check unavailable;
    // please retry') when its Redis revocation check fails closed — a 401
    // with no `code` field. One Redis blip must not permanently disable
    // silent refresh for a still-valid token (refuter P2, 2026-08-09).
    mockState.token = jwtWithExp(nowSec() + 5 * 60);
    let redisDown = true;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/auth/refresh')) {
        if (redisDown) return jsonRes(401, { message: 'Auth check unavailable; please retry' });
        return jsonRes(200, { access_token: jwtWithExp(nowSec() + 60 * 60) });
      }
      return jsonRes(200, { ok: true });
    });

    await apiFetch('/a'); // near-expiry → refresh attempt #1 hits the blip
    await flush();
    expect(refreshCalls()).toHaveLength(1);
    expect(mockState.setToken).not.toHaveBeenCalled();

    redisDown = false;
    await apiFetch('/b'); // token NOT memoized — attempt #2 fires and lands
    await flush();
    expect(refreshCalls()).toHaveLength(2);
    expect(mockState.setToken).toHaveBeenCalledTimes(1);
    expect(mockState.logout).not.toHaveBeenCalled();
  });
});
