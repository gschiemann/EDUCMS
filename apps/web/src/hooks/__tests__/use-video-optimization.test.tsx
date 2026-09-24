/**
 * useVideoOptimizationStatus (2026-09-23) — the media library's transcode poll.
 * Mobile-perf standard: it must not poll at all when nothing is optimizing, it
 * asks only for the ids still in flight, and when one finishes it refetches the
 * asset list ONCE (the tile needs the new URL and size), never in a loop.
 * The endpoint shape is cut from AssetsController.optimizationStatus →
 * VideoTranscodeService.statusForAssets.
 */
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string) => apiFetch(path),
}));

import {
  useVideoOptimizationStatus,
  optimizationOf,
  savedPercent,
  isOptimizing,
  type VideoOptimization,
} from '../use-video-optimization';

const job = (status: string, over: Record<string, unknown> = {}) => ({
  status,
  reason: null,
  progress: null,
  sourceBytes: 1_000_000_000,
  outputBytes: null,
  finishedAt: null,
  ...over,
});

function mount(assets: any[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = jest.spyOn(qc, 'invalidateQueries');
  let live!: Map<string, VideoOptimization>;
  function Inner() {
    live = useVideoOptimizationStatus(assets);
    return null;
  }
  const view = render(
    <QueryClientProvider client={qc}>
      <Inner />
    </QueryClientProvider>,
  );
  return { getLive: () => live, invalidate, view };
}

beforeEach(() => apiFetch.mockReset());

describe('useVideoOptimizationStatus', () => {
  it('does NOT poll when nothing is optimizing (no request at all)', async () => {
    mount([
      { id: 'a', transcodeJob: job('done', { outputBytes: 200_000_000 }) },
      { id: 'b', transcodeJob: null },
      { id: 'c' },
    ]);
    await new Promise((r) => setTimeout(r, 20));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('asks only for the ids still queued/running', async () => {
    apiFetch.mockResolvedValue({ items: [{ assetId: 'a', ...job('running', { progress: 40 }) }] });
    const { getLive } = mount([
      { id: 'b', transcodeJob: job('queued') },
      { id: 'a', transcodeJob: job('running', { progress: 10 }) },
      { id: 'z', transcodeJob: job('done') },
    ]);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(apiFetch.mock.calls[0][0]).toBe(`/assets/optimization?ids=${encodeURIComponent('a,b')}`);
    await waitFor(() => expect(getLive().get('a')?.progress).toBe(40));
  });

  it('a job that finishes refetches the asset list ONCE', async () => {
    apiFetch.mockResolvedValue({ items: [{ assetId: 'a', ...job('done', { outputBytes: 220_000_000 }) }] });
    const { invalidate } = mount([{ id: 'a', transcodeJob: job('running') }]);
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['assets'] }));
    await new Promise((r) => setTimeout(r, 20));
    expect(invalidate.mock.calls.filter(([arg]) => JSON.stringify(arg) === JSON.stringify({ queryKey: ['assets'] }))).toHaveLength(1);
  });
});

describe('pure helpers', () => {
  it('optimizationOf prefers the live poll over the list row, and tolerates junk', () => {
    const live = new Map<string, VideoOptimization>([['a', { ...job('running', { progress: 90 }) } as VideoOptimization]]);
    expect(optimizationOf({ id: 'a', transcodeJob: job('queued') }, live)?.progress).toBe(90);
    expect(optimizationOf({ id: 'a', transcodeJob: job('queued') })?.status).toBe('queued');
    expect(optimizationOf({ id: 'a', transcodeJob: { status: 42 } })).toBeNull();
    expect(optimizationOf(null)).toBeNull();
  });
  it('savedPercent only for a swap that actually saved', () => {
    expect(savedPercent({ ...job('done', { outputBytes: 220_000_000 }) } as VideoOptimization)).toBe(78);
    expect(savedPercent({ ...job('skipped', { outputBytes: 1_200_000_000 }) } as VideoOptimization)).toBeNull();
    expect(savedPercent(null)).toBeNull();
    expect(isOptimizing({ ...job('queued') } as VideoOptimization)).toBe(true);
    expect(isOptimizing({ ...job('failed') } as VideoOptimization)).toBe(false);
  });
});
