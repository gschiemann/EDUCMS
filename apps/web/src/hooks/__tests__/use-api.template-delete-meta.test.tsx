/**
 * useDeleteTemplate — the gallery answers every failure itself, so it opts out
 * of the global red error toast. Without that, the EXPECTED 409 TEMPLATE_IN_USE
 * (which opens the impact dialog) also fired "This layout is assigned to 2
 * playlists…" as an error toast, as if the delete had broken (2026-09-28).
 * Other callers (the builder) keep the default.
 */
import * as React from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn().mockResolvedValue({ deleted: true }) }));

import { useDeleteTemplate } from '../use-api';

async function metaOf(opts?: { suppressGlobalError?: boolean }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useDeleteTemplate(opts), { wrapper });
  await act(async () => { await result.current.mutateAsync('t1'); });
  return qc.getMutationCache().getAll()[0].options.meta;
}

describe('useDeleteTemplate — global error toast', () => {
  it('opts out when the caller says it answers every failure itself', async () => {
    expect(await metaOf({ suppressGlobalError: true })).toEqual({ suppressGlobalError: true });
  });
  it('keeps the default toast for every other caller', async () => {
    expect(await metaOf()).toBeUndefined();
  });
});
