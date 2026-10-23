/**
 * QA 2026-10-23: an aborted request (the page navigated, a query unmounted)
 * was logged with clog.error — a red "Issue" on every dashboard navigation
 * and noise in every bug report's console capture. It must still REJECT
 * (callers rely on that) but log at debug, never error; a real failure keeps
 * its error line.
 */
jest.mock('@/store/ui-store', () => ({
  useUIStore: { getState: () => ({ token: null, setToken: jest.fn(), logout: jest.fn() }) },
}));
jest.mock('../csrf', () => ({ ensureCsrfToken: jest.fn(async () => 'csrf'), invalidateCsrfToken: jest.fn() }));
jest.mock('../api-url', () => ({ API_URL: 'http://api.test/api/v1', warnIfMisconfigured: jest.fn() }));
const clog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('../client-logger', () => ({ clog }));
jest.mock('../auth-events', () => ({ emitAuthEvent: jest.fn(), subscribeAuthEvents: jest.fn(() => () => {}) }));

import { apiFetch } from '../api-client';

afterEach(() => { jest.clearAllMocks(); });

it('an aborted request rejects without an error log', async () => {
  const abort = new Error('Fetch is aborted');
  abort.name = 'AbortError';
  global.fetch = jest.fn(async () => { throw abort; }) as unknown as typeof fetch;
  await expect(apiFetch('/branding/me')).rejects.toBe(abort);
  expect(clog.error).not.toHaveBeenCalled();
  expect(clog.debug).toHaveBeenCalledWith('api', 'Request aborted', expect.any(Object));
});

it('a real non-network failure still logs an error', async () => {
  global.fetch = jest.fn(async () => { throw new Error('boom'); }) as unknown as typeof fetch;
  await expect(apiFetch('/branding/me')).rejects.toThrow('boom');
  expect(clog.error).toHaveBeenCalledWith('api', 'Request failed (non-network)', expect.any(Object));
});
