/**
 * QA 2026-10-23 — the OAuth landing pages.
 *
 * Before: GET /me (no such route → 404) with a localStorage token nothing
 * writes, so a SUCCESSFUL connection showed "HTTP 404" and no way back; and
 * an Instagram connection was told its "POS catalog" was syncing and sent to
 * POS settings. These tests pin the workspace coming from the session, the
 * social return path, and the guard that keeps a stored path inside the
 * workspace (never an open redirect).
 */
import * as React from 'react';
import { render, screen, act } from '@testing-library/react';

const replace = jest.fn();
let provider = 'clover';
let search = new URLSearchParams('status=ok');
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useParams: () => ({ provider }),
  useSearchParams: () => search,
}));
const store = { activeTenant: 'riot-cleveland' as string | null };
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: typeof store) => unknown) => sel(store),
}));

import ConnectDonePage from '../[provider]/done/page';
import SquareDonePage from '../square/done/page';
import { rememberConnectReturn, readConnectReturn } from '@/lib/connect-return';

beforeEach(() => {
  jest.useFakeTimers();
  replace.mockClear();
  sessionStorage.clear();
  store.activeTenant = 'riot-cleveland';
  provider = 'clover';
  search = new URLSearchParams('status=ok');
});
afterEach(() => jest.useRealTimers());

it('a POS connection returns to POS settings of the signed-in workspace', () => {
  render(<ConnectDonePage />);
  expect(screen.getByRole('heading', { name: 'Clover connected' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Back to POS settings/ })).toHaveAttribute('href', '/riot-cleveland/settings/pos?connected=clover');
  act(() => { jest.advanceTimersByTime(1600); });
  expect(replace).toHaveBeenCalledWith('/riot-cleveland/settings/pos?connected=clover');
});

it('Square lands back in POS settings too (no /me call, no "HTTP 404")', () => {
  const fetchSpy = jest.fn();
  global.fetch = fetchSpy as unknown as typeof fetch;
  render(<SquareDonePage />);
  act(() => { jest.advanceTimersByTime(1600); });
  expect(replace).toHaveBeenCalledWith('/riot-cleveland/settings/pos?connected=square');
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('an Instagram connection goes back to the page that started it, not POS settings', () => {
  provider = 'instagram';
  rememberConnectReturn('/riot-cleveland/templates/builder/abc?panel=apps');
  render(<ConnectDonePage />);
  expect(screen.getByRole('heading', { name: 'Instagram connected' })).toBeInTheDocument();
  expect(screen.queryByText(/catalog/i)).not.toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(1600); });
  expect(replace).toHaveBeenCalledWith('/riot-cleveland/templates/builder/abc?panel=apps');
  expect(sessionStorage.getItem('venueos.connectReturn')).toBeNull();
});

it('signed out in this tab: a sign-in link, never an error code', () => {
  store.activeTenant = null;
  render(<ConnectDonePage />);
  expect(screen.getByRole('link', { name: /Sign in/ })).toHaveAttribute('href', '/login');
  expect(screen.queryByText(/HTTP/)).not.toBeInTheDocument();
});

it('a stored return path outside the workspace is ignored', () => {
  for (const bad of ['https://evil.example/x', '//evil.example/x', '/other-tenant/templates', '/riot-cleveland\\..\\x']) {
    rememberConnectReturn(bad);
    expect(readConnectReturn('riot-cleveland')).toBeNull();
  }
  rememberConnectReturn('/riot-cleveland/templates');
  expect(readConnectReturn('riot-cleveland')).toBe('/riot-cleveland/templates');
});
