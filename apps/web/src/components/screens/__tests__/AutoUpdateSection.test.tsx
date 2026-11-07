/**
 * Automatic Player updates, per screen + fleet (2026-10-11): opt-in switch
 * (Organization / On / Off), and the server's own verdict — silent vs needs a
 * tap on site vs not reported — never a guess. Real components over a fake API.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let info: any = null;
let fleet: any = null;
const calls: Array<{ path: string; init?: any }> = [];
const apiFetch = jest.fn(async (path: string, init?: any) => {
  calls.push({ path, init });
  if (path === '/screens/scr-1/auto-update' && init?.method === 'PUT') {
    const mode = JSON.parse(init.body).mode;
    info = { ...info, override: mode, enabled: mode === 'on' ? true : mode === 'off' ? false : info.orgEnabled, enabledSource: mode === 'inherit' ? 'org' : 'screen' };
    return info;
  }
  if (path === '/screens/scr-1/auto-update') return info;
  if (path === '/tenants/me/auto-update-readiness') return fleet;
  throw new Error(`fake API: unexpected ${path}`);
});
jest.mock('@/lib/api-client', () => ({ apiFetch: (path: string, init?: any) => apiFetch(path, init) }));

import { AutoUpdateSection } from '../AutoUpdateSection';
import { AutoUpdateReadinessList } from '../../settings/player/AutoUpdateReadinessList';

const WINDOW = { start: '03:00', end: '04:00', timezone: 'America/Chicago', hoursSource: 'default', zoneSource: 'org' };
const base = {
  screenId: 'scr-1', name: 'Lobby', override: 'inherit', enabled: false, enabledSource: 'org',
  readiness: 'silent', readinessReason: 'armed', window: WINDOW, willAutoUpdate: false,
  inventoryReportedAt: null, orgEnabled: false, orgWindow: { start: null, end: null, timezone: 'America/Chicago' },
  defaultWindow: { start: '03:00', end: '04:00' },
};

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}
afterEach(() => { cleanup(); calls.length = 0; });

it('defaults to the organization setting with no explanatory paragraphs', async () => {
  info = { ...base };
  wrap(<AutoUpdateSection screenId="scr-1" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Automatic app updates: Organization' })).not.toBeDisabled());
  expect(screen.queryByText(/Following the organization/)).toBeNull();
  expect(screen.queryByText(/only updates when someone/)).toBeNull();
  expect(screen.queryByText(/Off-hours only/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Automatic app updates: Organization' })).toHaveAttribute('aria-pressed', 'true');
});

it('an admin turns it ON for this one screen', async () => {
  info = { ...base };
  wrap(<AutoUpdateSection screenId="scr-1" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Automatic app updates: On' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Automatic app updates: On' }));
  await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT' && JSON.parse(c.init.body).mode === 'on')).toBe(true));
  expect(screen.queryByText(/whatever the organization setting/)).toBeNull();
  expect(screen.queryByText(/Updates itself between/)).toBeNull();
});

it('a screen that would show the Install prompt says so, and is never promised an automatic update', async () => {
  info = { ...base, enabled: true, orgEnabled: true, readiness: 'needs-tap', readinessReason: 'installed-by-another-app' };
  wrap(<AutoUpdateSection screenId="scr-1" />);
  // 2026-10-26 — most panels are wall-mounted with a remote and no touch screen:
  // the action and the place, remote first, never "needs a tap".
  const line = await screen.findByText(/Needs someone at the screen/);
  expect(line).toHaveTextContent('Needs someone at the screen to install updates');
  expect(line).not.toHaveTextContent(/needs a tap|tap Install/i);
  expect(screen.queryByText(/Updates itself between/)).toBeNull();
});

it('read-only roles see the state but cannot change it', async () => {
  info = { ...base };
  wrap(<AutoUpdateSection screenId="scr-1" readOnly />);
  await waitFor(() => expect(calls.length).toBeGreaterThan(0));
  expect(screen.getByRole('button', { name: 'Automatic app updates: On' })).toBeDisabled();
});

it('fleet list counts silent / needs someone at the screen / not reported', async () => {
  fleet = {
    orgEnabled: true, orgWindow: {}, defaultWindow: { start: '03:00', end: '04:00' },
    screens: [
      { ...base, screenId: 'a', name: 'A', enabled: true, readiness: 'silent' },
      { ...base, screenId: 'b', name: 'B', enabled: true, readiness: 'needs-tap', readinessReason: 'android-too-old' },
      { ...base, screenId: 'c', name: 'C', enabled: false, enabledSource: 'screen', readiness: 'unknown', readinessReason: 'no-report', window: null },
    ],
  };
  wrap(<AutoUpdateReadinessList />);
  const list = await screen.findByTestId('auto-update-readiness');
  expect(list).toHaveTextContent('1 screen installs silently');
  expect(list).toHaveTextContent('1 screen needs someone on site');
  expect(list).toHaveTextContent('Needs someone at the screen');
  expect(list).not.toHaveTextContent(/needs a tap/i);
  expect(list).toHaveTextContent('1 screen has not reported');
  expect(list).toHaveTextContent('(set on the screen)');
  expect(list).toHaveTextContent('No timezone known');
});
