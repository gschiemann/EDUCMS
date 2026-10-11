/**
 * Muse beta DEV-020 (2026-10-07): moving or deleting a file left the folder
 * counts stale — only `['assets']` was invalidated, never `['asset-folders']`.
 */
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({ apiFetch: (p: string, o?: unknown) => apiFetch(p, o) }));

import { useDeleteAsset, useMoveAsset, useAddWebUrl } from '../use-api';

function mountHooks() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const spy = jest.spyOn(qc, 'invalidateQueries');
  const out: { move?: ReturnType<typeof useMoveAsset>; del?: ReturnType<typeof useDeleteAsset>; url?: ReturnType<typeof useAddWebUrl> } = {};
  function Inner() {
    out.move = useMoveAsset();
    out.del = useDeleteAsset();
    out.url = useAddWebUrl();
    return null;
  }
  render(<QueryClientProvider client={qc}><Inner /></QueryClientProvider>);
  return { spy, out };
}

const folderInvalidated = (spy: jest.SpyInstance) =>
  spy.mock.calls.some((c) => JSON.stringify(c[0]) === JSON.stringify({ queryKey: ['asset-folders'] }));

beforeEach(() => apiFetch.mockReset().mockResolvedValue({}));

it('moving a file re-reads the folder counts', async () => {
  const { spy, out } = mountHooks();
  out.move!.mutate({ id: 'a1', folderId: 'f2' });
  await waitFor(() => expect(folderInvalidated(spy)).toBe(true));
});

it('deleting a file re-reads the folder counts', async () => {
  const { spy, out } = mountHooks();
  out.del!.mutate('a1' as any);
  await waitFor(() => expect(folderInvalidated(spy)).toBe(true));
});

it('adding a web link into a folder re-reads the folder counts', async () => {
  const { spy, out } = mountHooks();
  out.url!.mutate({ url: 'https://example.com', folderId: 'f1' });
  await waitFor(() => expect(folderInvalidated(spy)).toBe(true));
});
