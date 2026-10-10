/**
 * REVIEW FINDING (2026-10-10 Codex review, 02-api-dashboard-auth P1-1).
 *
 * 9e0e016c made `useTenantSwitch` keep the remember marker across a workspace
 * switch (`login(token, user, hasRememberMarker())`). Before it, a switch
 * cleared the marker, so the switched token's 1-hour expiry ended in a clean
 * logout. Now the 401 path trades the HttpOnly cookie for a fresh token — and
 * `/api/session/refresh` mints for the user's HOME tenant (session.controller
 * uses `u.tenantId`), so the operator silently lands back in the home tenant
 * while the URL, cached React Query data and their intent are still the
 * switched location. The replayed request (and every write after it) runs
 * against the HOME tenant.
 *
 * Fix: the refreshed session is re-switched to the active tenant (or the
 * session ends). The contract these tests pin: a refresh must never silently move the
 * session to a different tenant than the one the page is operating in.
 */
const mockState: any = {
  token: 'expired-switched-token',
  user: { id: 'operator', tenantId: 'child', tenantSlug: 'child' },
  setToken: jest.fn((t: string) => { mockState.token = t; }),
  setUser: jest.fn((u: any) => { mockState.user = u; }),
  logout: jest.fn(() => { mockState.token = null; }),
};

jest.mock('@/store/ui-store', () => ({ useUIStore: { getState: () => mockState } }));
jest.mock('../csrf', () => ({ ensureCsrfToken: jest.fn(async () => 'csrf-tok'), invalidateCsrfToken: jest.fn() }));
jest.mock('../api-url', () => ({ API_URL: 'http://api.test/api/v1', warnIfMisconfigured: jest.fn() }));
jest.mock('../client-logger', () => ({ clog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../auth-events', () => ({ emitAuthEvent: jest.fn(), subscribeAuthEvents: jest.fn(() => () => {}) }));

import { apiFetch } from '../api-client';

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body, clone() { return this; } } as any;
}

// The re-scope single-flight entry is released on the next macrotask.
beforeEach(() => new Promise((r) => setTimeout(r, 0)));

function setup(switchStatus: number) {
  window.localStorage.setItem('edu_cms_remember', '1');
  mockState.token = 'expired-switched-token';
  mockState.user = { id: 'operator', tenantId: 'child', tenantSlug: 'child' };
  const calls: Array<{ url: string; auth: string }> = [];
  (global as any).fetch = jest.fn(async (url: string, init: any) => {
    if (String(url) === '/api/session/refresh') {
      return jsonRes(200, { access_token: 'home-token', user: { id: 'operator', tenantId: 'home', tenantSlug: 'home' } });
    }
    const auth = init?.headers?.Authorization ?? init?.headers?.authorization ?? '';
    calls.push({ url: String(url), auth });
    if (String(url).endsWith('/tenants/switch')) {
      return switchStatus === 200
        ? jsonRes(200, { access_token: 'child-token', user: { id: 'operator', tenantId: 'child', tenantSlug: 'child' } })
        : jsonRes(switchStatus, {});
    }
    return auth.includes('child-token') ? jsonRes(200, { ok: true }) : jsonRes(401, {});
  });
  return calls;
}

it('re-scopes a refreshed session to the active location before replaying', async () => {
  const calls = setup(200);
  await apiFetch('/playlists', { method: 'POST', body: '{}', _noRetry: true } as any);
  const writes = calls.filter((c) => c.url.endsWith('/playlists'));
  expect(writes.some((c) => c.auth.includes('home-token'))).toBe(false);
  expect(writes[writes.length - 1].auth).toContain('child-token');
  expect(mockState.user.tenantId).toBe('child');
});

it('ends the session instead of replaying as the home tenant when the re-switch is refused', async () => {
  const calls = setup(403);
  await apiFetch('/playlists', { method: 'POST', body: '{}', _noRetry: true } as any).catch(() => undefined);
  expect(calls.filter((c) => c.url.endsWith('/playlists')).some((c) => c.auth.includes('home-token'))).toBe(false);
  expect(mockState.user.tenantId).toBe('child');
  expect(mockState.logout).toHaveBeenCalled();
});
