/**
 * useAssetStorageUsage (2026-09-24) — the media library's "Storage: 2.3 GB of
 * 50 GB" line. Mobile-perf standard: ONE request when it is allowed to ask,
 * none at all when it is not (the endpoint is admin-only), never a poll, and a
 * refusal is an answer (no retries). The endpoint shape is cut from
 * AssetsController.storageUsage → StorageQuotaService.usage.
 */
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string) => apiFetch(path),
}));

import { useAssetStorageUsage, type AssetStorageUsage } from '../use-api';

const GiB = 1024 * 1024 * 1024;
/** What GET /assets/storage answers for an organisation with 10 paired screens and 2.3 GB stored. */
const USAGE: AssetStorageUsage = {
  usedBytes: Math.round(2.3 * GiB),
  includedBytes: 50 * GiB,
  screens: 10,
  percent: 5,
  warn: false,
};

function mount(enabled: boolean) {
  const qc = new QueryClient();
  let result!: ReturnType<typeof useAssetStorageUsage>;
  function Inner() {
    result = useAssetStorageUsage(enabled);
    return null;
  }
  render(
    <QueryClientProvider client={qc}>
      <Inner />
    </QueryClientProvider>,
  );
  return { qc, get result() { return result; } };
}

beforeEach(() => apiFetch.mockReset());

describe('useAssetStorageUsage', () => {
  it('asks GET /assets/storage exactly once and never polls', async () => {
    apiFetch.mockResolvedValue(USAGE);
    const h = mount(true);
    await waitFor(() => expect(h.result.data).toEqual(USAGE));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith('/assets/storage');
    // No refetchInterval on the query — the number moves with the ['assets']
    // invalidation an upload or a delete already issues, not with a timer.
    const q = h.qc.getQueryCache().find({ queryKey: ['assets', 'storage'] });
    // (an observer option, so it is not on the cache's QueryOptions type — read it loosely)
    expect((q?.options as { refetchInterval?: unknown } | undefined)?.refetchInterval).toBeUndefined();
    await new Promise((r) => setTimeout(r, 30));
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('makes NO request when the page says the caller may not ask (a CONTRIBUTOR would get 403)', async () => {
    apiFetch.mockResolvedValue(USAGE);
    const h = mount(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(apiFetch).not.toHaveBeenCalled();
    expect(h.result.data).toBeUndefined();
  });

  it('a 403 is an answer: one request, isError, no data, no retry', async () => {
    const refused: any = new Error('Forbidden');
    refused.status = 403;
    apiFetch.mockRejectedValue(refused);
    const h = mount(true);
    await waitFor(() => expect(h.result.isError).toBe(true));
    expect(h.result.data).toBeUndefined();
    await new Promise((r) => setTimeout(r, 30));
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('sits under the ["assets"] key an upload or a delete invalidates', async () => {
    apiFetch.mockResolvedValue(USAGE);
    const h = mount(true);
    await waitFor(() => expect(h.result.data).toEqual(USAGE));
    apiFetch.mockResolvedValue({ ...USAGE, usedBytes: 3 * GiB });
    await h.qc.invalidateQueries({ queryKey: ['assets'] });
    await waitFor(() => expect(h.result.data?.usedBytes).toBe(3 * GiB));
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
