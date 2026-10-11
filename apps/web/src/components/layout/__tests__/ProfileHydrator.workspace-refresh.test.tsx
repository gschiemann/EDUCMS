/**
 * Muse beta DEV-005 / S-01: a workspace config change made in one session must
 * reach every other open session without a logout — on focus / visibility
 * return / navigation, at most once per 60 s, and never while hidden.
 */
import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({ apiFetch: (p: string) => apiFetch(p) }));

let pathname = '/springfield/dashboard';
jest.mock('next/navigation', () => ({ usePathname: () => pathname }));

import { useAppStore } from '@/lib/store';
import { ProfileHydrator } from '../ProfileHydrator';
import { WORKSPACE_RECHECK_MIN_MS, shouldRecheckWorkspace, workspaceConfigChanged } from '@/lib/workspace-config-refresh';

let now = 1_000_000;
let me: Record<string, unknown>;
let visibility: DocumentVisibilityState = 'visible';

beforeAll(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

beforeEach(() => {
  now = 1_000_000;
  visibility = 'visible';
  pathname = '/springfield/dashboard';
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  window.sessionStorage.clear();
  apiFetch.mockReset();
  me = { id: 'u1', tenantVertical: 'K12', tenantSlug: 'springfield', workspaceConfigVersion: 'v1' };
  apiFetch.mockImplementation(async () => me);
  useAppStore.setState({ user: { id: 'u1', tenantVertical: 'K12', tenantSlug: 'springfield' } as any });
});

afterEach(() => jest.restoreAllMocks());

function mount() {
  const qc = new QueryClient();
  const invalidate = jest.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <ProfileHydrator />
    </QueryClientProvider>,
  );
  return { ...utils, qc, invalidate };
}

const meCalls = () => apiFetch.mock.calls.filter((c) => c[0] === '/users/me').length;

it('pure gate: hidden or too soon or in flight never re-checks', () => {
  expect(shouldRecheckWorkspace({ now: 100_000, lastCheckedAt: 0, visible: false, inFlight: false })).toBe(false);
  expect(shouldRecheckWorkspace({ now: 59_999, lastCheckedAt: 0, visible: true, inFlight: false })).toBe(false);
  expect(shouldRecheckWorkspace({ now: 60_000, lastCheckedAt: 0, visible: true, inFlight: true })).toBe(false);
  expect(shouldRecheckWorkspace({ now: WORKSPACE_RECHECK_MIN_MS, lastCheckedAt: 0, visible: true, inFlight: false })).toBe(true);
  expect(workspaceConfigChanged(null, 'v1')).toBe(false);
  expect(workspaceConfigChanged('v1', 'v1')).toBe(false);
  expect(workspaceConfigChanged('v1', 'v2')).toBe(true);
});

it('a focus within 60 s does not re-fetch; after 60 s it does and picks up the new industry', async () => {
  const { invalidate } = mount();
  await waitFor(() => expect(meCalls()).toBe(1));

  now += 30_000;
  act(() => { window.dispatchEvent(new Event('focus')); });
  expect(meCalls()).toBe(1);

  // Another session switched the industry.
  me = { ...me, tenantVertical: 'GYM', workspaceConfigVersion: 'v2' };
  now += 31_000;
  act(() => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(meCalls()).toBe(2));
  await waitFor(() => expect((useAppStore.getState().user as any).tenantVertical).toBe('GYM'));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tenant'] });
});

it('never re-checks while the page is hidden; checks on visibility return', async () => {
  mount();
  await waitFor(() => expect(meCalls()).toBe(1));

  now += 120_000;
  visibility = 'hidden';
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  act(() => { window.dispatchEvent(new Event('focus')); });
  expect(meCalls()).toBe(1);

  visibility = 'visible';
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await waitFor(() => expect(meCalls()).toBe(2));
});

it('navigation re-checks at the same bounded rate, and an unchanged version invalidates nothing', async () => {
  const { rerender, qc, invalidate } = mount();
  await waitFor(() => expect(meCalls()).toBe(1));

  now += 61_000;
  pathname = '/springfield/screens';
  rerender(
    <QueryClientProvider client={qc}>
      <ProfileHydrator />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(meCalls()).toBe(2));
  expect(invalidate).not.toHaveBeenCalled();
});

it('a config-version change alone (module toggled, same industry) re-reads the tenant query', async () => {
  const { invalidate } = mount();
  await waitFor(() => expect(meCalls()).toBe(1));
  me = { ...me, workspaceConfigVersion: 'v9' };
  now += 61_000;
  act(() => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tenant'] }));
});
