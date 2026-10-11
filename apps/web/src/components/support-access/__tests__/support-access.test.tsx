/**
 * Customer-approved support access (2026-10-11) — both sides rendered for
 * real over a fake API. Proves: the banner is silent when VenueOS has no
 * access and never shown to a SUPER_ADMIN; "End now" goes through the
 * confirm dialog and hits the revoke route; a customer admin can approve a
 * request for a SHORTER time or deny it; a viewer sees the state but no
 * actions; the invite form sends duration + scope; the console card sends a
 * request and keeps break-glass behind its own reason prompt; no polling.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SupportAccessState, SupportGrant } from '@/lib/support-access';
import { approvableDurations, grantTone, minutesLeft } from '@/lib/support-access';

const calls: Array<{ path: string; method: string; body?: any }> = [];
let role = 'DISTRICT_ADMIN';
let mine: SupportAccessState;
let org: SupportAccessState;

const grant = (over: Partial<SupportGrant> = {}): SupportGrant => ({
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 'org',
  kind: 'REQUEST',
  status: 'ACTIVE',
  active: true,
  reason: 'Looping video',
  note: null,
  scopeTenantIds: [],
  requestedDurationMinutes: 1440,
  requestedByEmail: 'greg@venueos.test',
  decidedByEmail: 'owner@acme.test',
  revokedByEmail: null,
  createdAt: '2026-10-11T10:00:00Z',
  decidedAt: '2026-10-11T10:05:00Z',
  startsAt: '2026-10-11T10:05:00Z',
  expiresAt: '2026-10-12T10:05:00Z',
  revokedAt: null,
  ...over,
});
const empty = (): SupportAccessState => ({ tenantId: 'org', active: null, pending: [], history: [], locations: [{ id: 'loc-1', name: 'North', slug: 'north' }, { id: 'loc-2', name: 'South', slug: 'south' }], canDecide: true });

const apiFetch = jest.fn(async (path: string, opts: any = {}) => {
  calls.push({ path, method: opts.method ?? 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
  if (path === '/support-access') return mine;
  if (path === '/super/customers/org/support-access') return org;
  return grant();
});
jest.mock('@/lib/api-client', () => ({ apiFetch: (p: string, o?: any) => apiFetch(p, o) }));
jest.mock('@/lib/store', () => ({ useAppStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u', role, tenantId: 'org' }, activeTenant: 'acme' }) }));
const appConfirm = jest.fn(async (_o?: any) => true);
const appPrompt = jest.fn(async (_o?: any) => 'Lockdown stuck on 40 screens');
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: (o: any) => appConfirm(o), appPrompt: (o: any) => appPrompt(o) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));

import { SupportAccessBanner } from '../SupportAccessBanner';
import { SupportAccessSettings } from '../SupportAccessSettings';
import { SupportAccessCard } from '@/components/super/customers/SupportAccessCard';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  calls.length = 0;
  role = 'DISTRICT_ADMIN';
  mine = empty();
  org = { ...empty(), canDecide: undefined, reach: null, internal: false };
  appConfirm.mockClear();
  appPrompt.mockClear();
});
afterEach(cleanup);

describe('pure helpers', () => {
  it('approvableDurations never offers longer than requested, and always offers "as requested"', () => {
    expect(approvableDurations(1440).map((d) => d.minutes)).toEqual([60, 1440]);
    expect(approvableDurations(60).map((d) => d.minutes)).toEqual([60]);
    expect(approvableDurations(90).map((d) => [d.minutes, d.key])).toEqual([[60, 'oneHour'], [90, 'asRequested']]);
    expect(approvableDurations(null).map((d) => d.minutes)).toEqual([60, 1440, 10080]);
  });
  it('minutesLeft and grantTone', () => {
    expect(minutesLeft(grant(), new Date('2026-10-12T09:05:00Z'))).toBe(60);
    expect(minutesLeft(grant({ expiresAt: null }))).toBe(0);
    expect(grantTone(grant())).toBe('active');
    expect(grantTone(grant({ active: false, status: 'REQUESTED' }))).toBe('pending');
    expect(grantTone(grant({ active: false, status: 'REVOKED' }))).toBe('ended');
  });
});

describe('SupportAccessBanner (customer chrome)', () => {
  it('renders nothing when VenueOS has no access, and never for a SUPER_ADMIN', async () => {
    const { container } = wrap(<SupportAccessBanner />);
    await waitFor(() => expect(calls.some((c) => c.path === '/support-access')).toBe(true));
    expect(container.querySelector('[data-testid="support-access-banner"]')).toBeNull();
    calls.length = 0;
    role = 'SUPER_ADMIN';
    mine = { ...empty(), active: grant() };
    const r2 = wrap(<SupportAccessBanner />);
    await act(async () => { await Promise.resolve(); });
    expect(r2.container.querySelector('[data-testid="support-access-banner"]')).toBeNull();
    expect(calls.some((c) => c.path === '/support-access')).toBe(false);
  });

  it('shows "until …" with End now for an admin, confirms, and POSTs the revoke; a viewer gets no button', async () => {
    mine = { ...empty(), active: grant() };
    wrap(<SupportAccessBanner />);
    const banner = await screen.findByTestId('support-access-banner');
    expect(banner.textContent).toMatch(/VenueOS support has access/);
    fireEvent.click(within(banner).getByRole('button', { name: /End now/ }));
    await waitFor(() => expect(appConfirm).toHaveBeenCalled());
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === `/support-access/${grant().id}/revoke`)).toBe(true));
    cleanup();
    mine = { ...empty(), active: grant(), canDecide: false };
    wrap(<SupportAccessBanner />);
    const b2 = await screen.findByTestId('support-access-banner');
    expect(within(b2).queryByRole('button', { name: /End now/ })).toBeNull();
    expect(within(b2).getByRole('link')).toHaveAttribute('href', '/acme/settings/support-access');
  });

  it('a pending request shows "is asking" with a Review link; break-glass reads as emergency; no polling is configured', async () => {
    mine = { ...empty(), pending: [grant({ status: 'REQUESTED', active: false })] };
    wrap(<SupportAccessBanner />);
    const b = await screen.findByTestId('support-access-banner');
    expect(b.textContent).toMatch(/is asking for support access/);
    expect(within(b).getByRole('link').textContent).toMatch(/Review/);
    cleanup();
    mine = { ...empty(), active: grant({ kind: 'BREAK_GLASS' }) };
    wrap(<SupportAccessBanner />);
    expect((await screen.findByTestId('support-access-banner')).textContent).toMatch(/emergency support access/);
    const src = require('fs').readFileSync(require.resolve('@/hooks/use-support-access'), 'utf8');
    expect(src).not.toMatch(/refetchInterval/);
  });
});

describe('SupportAccessSettings (customer Settings page)', () => {
  it('an admin approves a request for a SHORTER time (the select never offers longer) and the API gets the minutes', async () => {
    mine = { ...empty(), pending: [grant({ status: 'REQUESTED', active: false, requestedDurationMinutes: 1440 })] };
    wrap(<SupportAccessSettings />);
    const card = await screen.findByTestId('support-access-pending');
    const select = within(card).getByRole('combobox') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['60', '1440']);
    fireEvent.change(select, { target: { value: '60' } });
    fireEvent.click(within(card).getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toEqual({ path: `/support-access/${grant().id}/approve`, method: 'POST', body: { durationMinutes: 60 } }));
  });

  it('deny sends the note; a viewer sees the request but no buttons', async () => {
    mine = { ...empty(), pending: [grant({ status: 'REQUESTED', active: false })] };
    wrap(<SupportAccessSettings />);
    const card = await screen.findByTestId('support-access-pending');
    fireEvent.change(within(card).getByRole('textbox'), { target: { value: 'not now' } });
    fireEvent.click(within(card).getByRole('button', { name: /Deny/ }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toEqual({ path: `/support-access/${grant().id}/deny`, method: 'POST', body: { note: 'not now' } }));
    cleanup();
    calls.length = 0;
    mine = { ...empty(), pending: [grant({ status: 'REQUESTED', active: false })], canDecide: false };
    wrap(<SupportAccessSettings />);
    const c2 = await screen.findByTestId('support-access-pending');
    expect(within(c2).queryByRole('button')).toBeNull();
    expect(c2.textContent).toMatch(/administrator of your organization/);
  });

  it('"Give VenueOS support access" sends duration, note and a location scope; it is hidden while access is active', async () => {
    wrap(<SupportAccessSettings />);
    const form = await screen.findByTestId('support-access-invite');
    fireEvent.change(screen.getByTestId('invite-duration'), { target: { value: '10080' } });
    fireEvent.click(within(form).getByLabelText(/Specific locations/));
    fireEvent.click(within(form).getByLabelText('South'));
    fireEvent.change(within(form).getByPlaceholderText(/What should VenueOS look at/), { target: { value: 'menu board' } });
    fireEvent.click(within(form).getByRole('button', { name: /Give access/ }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toEqual({ path: '/support-access/invite', method: 'POST', body: { durationMinutes: 10080, note: 'menu board', scopeTenantIds: ['loc-2'] } }));
    cleanup();
    mine = { ...empty(), active: grant() };
    wrap(<SupportAccessSettings />);
    await screen.findByTestId('support-access-active');
    expect(screen.queryByTestId('support-access-invite')).toBeNull();
  });

  it('the active card names the locations in scope and ends through the confirm dialog', async () => {
    mine = { ...empty(), active: grant({ scopeTenantIds: ['loc-1'] }) };
    wrap(<SupportAccessSettings />);
    const card = await screen.findByTestId('support-access-active');
    expect(card.textContent).toMatch(/North/);
    expect(card.textContent).not.toMatch(/Whole organization/);
    fireEvent.click(within(card).getByRole('button', { name: /End now/ }));
    await waitFor(() => expect(calls.some((c) => c.path === `/support-access/${grant().id}/revoke`)).toBe(true));
    expect(appConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('SupportAccessCard (customer console)', () => {
  it('with no access: sends a request with reason, duration and scope; a reason is required', async () => {
    wrap(<SupportAccessCard orgId="org" orgName="Acme" />);
    const form = await screen.findByTestId('console-support-request');
    fireEvent.click(within(form).getByRole('button', { name: /Send request/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/reason is required/);
    fireEvent.change(within(form).getByPlaceholderText(/Looping video/), { target: { value: 'Check the lobby playlist' } });
    fireEvent.change(within(form).getByRole('combobox'), { target: { value: '1440' } });
    fireEvent.click(within(form).getByLabelText(/Specific locations/));
    fireEvent.click(within(form).getByLabelText('North'));
    fireEvent.click(within(form).getByRole('button', { name: /Send request/ }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toEqual({ path: '/super/customers/org/support-access/request', method: 'POST', body: { reason: 'Check the lobby playlist', durationMinutes: 1440, scopeTenantIds: ['loc-1'] } }));
  });

  it('break-glass is its own explicit action: a reason prompt first, then POST; cancelling the prompt sends nothing', async () => {
    wrap(<SupportAccessCard orgId="org" orgName="Acme" />);
    const btn = await screen.findByTestId('console-break-glass');
    appPrompt.mockResolvedValueOnce('');
    fireEvent.click(btn);
    await waitFor(() => expect(appPrompt).toHaveBeenCalledTimes(1));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toEqual({ path: '/super/customers/org/support-access/break-glass', method: 'POST', body: { reason: 'Lockdown stuck on 40 screens' } }));
  });

  it('shows the active grant with "End our access", a pending request with "Withdraw", and the internal shortcut', async () => {
    org = { ...org, active: grant() };
    wrap(<SupportAccessCard orgId="org" orgName="Acme" />);
    const card = await screen.findByTestId('console-support-access');
    expect(card.textContent).toMatch(/Access granted until/);
    fireEvent.click(within(card).getByRole('button', { name: /End our access/ }));
    await waitFor(() => expect(calls.some((c) => c.path === `/super/customers/org/support-access/${grant().id}/revoke`)).toBe(true));
    cleanup();
    org = { ...org, active: null, pending: [grant({ status: 'REQUESTED', active: false })] };
    wrap(<SupportAccessCard orgId="org" orgName="Acme" />);
    expect((await screen.findByTestId('console-support-access')).textContent).toMatch(/waiting for the customer/);
    expect(screen.getByRole('button', { name: /Withdraw request/ })).toBeInTheDocument();
    expect(screen.queryByTestId('console-break-glass')).toBeNull();
    cleanup();
    org = { ...org, pending: [], internal: true, reach: 'internal' };
    wrap(<SupportAccessCard orgId="org" orgName="Acme" />);
    expect((await screen.findByTestId('console-support-access')).textContent).toMatch(/Internal organization/);
    expect(screen.queryByTestId('console-support-request')).toBeNull();
  });
});
