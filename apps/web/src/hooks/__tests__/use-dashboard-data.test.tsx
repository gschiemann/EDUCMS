/**
 * QA 2026-10-23: `/audit/recent` is admin-only, but the dashboard fetched it
 * for every role — an Editor's dashboard logged a 403 and three console
 * errors on each load and each 60 s poll. The hook now takes the same admin
 * gate the page already computes.
 */
import * as React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn(async () => []);
jest.mock('@/lib/api-client', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...(a as [])) }));

import { useRecentActivity } from '../use-dashboard-data';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => apiFetch.mockClear());

it('does not ask for the audit feed when the viewer is not an admin', async () => {
  renderHook(() => useRecentActivity({ enabled: false }), { wrapper });
  await new Promise((r) => setTimeout(r, 20));
  expect(apiFetch).not.toHaveBeenCalled();
});

it('an admin still gets it', async () => {
  renderHook(() => useRecentActivity({ enabled: true }), { wrapper });
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/audit/recent'));
});
