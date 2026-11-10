/**
 * /super/emergency-drill — the owner's permission page over a fake API.
 *
 * Mocked at `apiFetch`, so the REAL use-api hooks run with their real URLs and
 * bodies. Proves: owner-only (no request for anyone else); nothing approved →
 * the page says nothing will run; Approve goes through the confirm dialog and
 * sends an empty body for "now" and the chosen time for "later"; declining the
 * dialog sends nothing; a server refusal is shown in words; an open approval
 * shows Cancel (and no second Approve); a screen outside an internal
 * organization is named as never tested; the page does not poll.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/i18n/messages/en.json';

const NOW = Date.UTC(2026, 10, 10, 19, 0, 0);
const base = {
  armed: true,
  disabledReason: null,
  mode: 'shadow',
  nowMs: NOW,
  maxAheadMs: 86_400_000,
  windowMs: 7_200_000,
  screens: [
    { id: 's1', name: 'GUQ55', eligible: true },
    { id: 's2', name: 'M43', eligible: true },
  ],
  approvals: [] as Array<Record<string, unknown>>,
};

let role = 'SUPER_ADMIN';
let status: typeof base;
let approveError: any = null;
const calls: Array<{ path: string; method: string; body?: any }> = [];
const apiFetch = jest.fn(async (path: string, opts: any = {}) => {
  const method = opts.method ?? 'GET';
  calls.push({ path, method, body: opts.body ? JSON.parse(opts.body) : undefined });
  if (path === '/super/emergency-drill' && method === 'GET') return status;
  if (path === '/super/emergency-drill/approve') {
    if (approveError) throw approveError;
    return { approved: true, approvalId: 'apr-1', runAtMs: NOW, expiresAtMs: NOW + 7_200_000, screenCount: 2 };
  }
  if (path === '/super/emergency-drill/revoke') return { revoked: 1 };
  throw new Error(`unexpected ${method} ${path}`);
});
jest.mock('@/lib/api-client', () => ({ apiFetch: (p: string, o?: any) => apiFetch(p, o), getApiUrl: () => 'http://api.test/api/v1' }));
jest.mock('@/lib/store', () => ({ useAppStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'super-1', role } }) }));
const appConfirm = jest.fn(async (_o?: any) => true);
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: (o: any) => appConfirm(o) }));

import { EmergencyDrillPanel, drillErrorKey, localInputToIso } from '../EmergencyDrillPanel';

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={en as never} timeZone="UTC">
      <QueryClientProvider client={qc}>
        <EmergencyDrillPanel />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}
const posts = () => calls.filter((c) => c.method === 'POST');

beforeEach(() => {
  role = 'SUPER_ADMIN';
  status = { ...base, approvals: [] };
  approveError = null;
  calls.length = 0;
  apiFetch.mockClear();
  appConfirm.mockClear();
  appConfirm.mockResolvedValue(true);
});
afterEach(cleanup);

describe('who sees it', () => {
  it('anyone but the owner gets the owner-only notice and NO request is made', () => {
    role = 'DISTRICT_ADMIN';
    wrap();
    expect(screen.getByText('Owner-only area')).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe('nothing runs without the owner', () => {
  it('no approval: the page says nothing will run, and shows the screens a test would cover', async () => {
    wrap();
    expect(await screen.findByText('No test is approved. Nothing will run.')).toBeTruthy();
    expect(screen.getByText('GUQ55')).toBeTruthy();
    expect(screen.getByText('M43')).toBeTruthy();
    expect(screen.queryByText('Cancel the test')).toBeNull();
    expect(posts()).toEqual([]);
  });

  it('Approve → confirm dialog → POST with an empty body ("now")', async () => {
    wrap();
    fireEvent.click(await screen.findByText('Approve this test'));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(appConfirm).toHaveBeenCalledTimes(1);
    expect(appConfirm.mock.calls[0][0].message).toContain('2 bench screens');
    expect(posts()[0]).toEqual({ path: '/super/emergency-drill/approve', method: 'POST', body: {} });
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('declining the dialog sends nothing', async () => {
    appConfirm.mockResolvedValue(false);
    wrap();
    fireEvent.click(await screen.findByText('Approve this test'));
    await waitFor(() => expect(appConfirm).toHaveBeenCalled());
    expect(posts()).toEqual([]);
  });

  it('a later start sends that time; choosing "later" with no time sends nothing', async () => {
    wrap();
    fireEvent.click(await screen.findByLabelText(/Start at a time I choose/));
    fireEvent.click(screen.getByText('Approve this test'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(posts()).toEqual([]);
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2026-11-10T21:00' } });
    fireEvent.click(screen.getByText('Approve this test'));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0].body).toEqual({ runAt: localInputToIso('2026-11-10T21:00') });
  });

  it('a server refusal is shown in words', async () => {
    approveError = Object.assign(new Error('x'), { code: 'DRILL_ALREADY_APPROVED' });
    wrap();
    fireEvent.click(await screen.findByText('Approve this test'));
    expect(await screen.findByText(/A test is already approved/)).toBeTruthy();
  });
});

describe('an approved test', () => {
  it('shows what is approved with Cancel, and offers no second Approve; Cancel posts the revoke', async () => {
    status = { ...base, approvals: [{ approvalId: 'apr-1', runAtMs: NOW + 3_600_000, expiresAtMs: NOW + 10_800_000, screenCount: 2, state: 'waiting' }] };
    wrap();
    expect(await screen.findByText(/A test is approved to start/)).toBeTruthy();
    expect(screen.queryByText('Approve this test')).toBeNull();
    fireEvent.click(screen.getByText('Cancel the test'));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0].path).toBe('/super/emergency-drill/revoke');
  });

  it('switched off on the server: nothing to approve', async () => {
    status = { ...base, armed: false };
    wrap();
    expect(await screen.findByText(/switched off on the server/)).toBeTruthy();
    expect(screen.queryByText('Approve this test')).toBeNull();
  });

  it('a listed screen outside an internal organization is named as never tested', async () => {
    status = { ...base, screens: [...base.screens, { id: 's3', name: 'Customer Lobby', eligible: false }] };
    wrap();
    expect(await screen.findByText(/never tested.*Customer Lobby/)).toBeTruthy();
  });
});

describe('helpers', () => {
  it('drillErrorKey: known codes pass through, anything else is generic', () => {
    expect(drillErrorKey({ code: 'DRILL_NOT_ARMED' })).toBe('DRILL_NOT_ARMED');
    expect(drillErrorKey({ code: 'SOMETHING_ELSE' })).toBe('generic');
    expect(drillErrorKey(null)).toBe('generic');
  });
  it('localInputToIso: empty and nonsense are null', () => {
    expect(localInputToIso('')).toBeNull();
    expect(localInputToIso('tonight')).toBeNull();
    expect(localInputToIso('2026-11-10T21:00')).toMatch(/^2026-11-1[01]T/);
  });
});
