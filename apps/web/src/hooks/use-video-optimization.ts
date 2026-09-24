'use client';

/**
 * Signage-transcode state for the media library (2026-09-23).
 *
 * After a video upload the API queues a transcode (storage/video-transcode on
 * the API). The asset list carries each asset's job as `transcodeJob`; this
 * hook polls the SMALL `GET /assets/optimization?ids=` endpoint for the ones
 * still queued/running — and only then, only while the tab is visible
 * (`refetchIntervalInBackground` stays false: mobile-perf standard) — and the
 * moment one finishes it refetches the asset list once, so the tile picks up
 * the new URL and size. Nothing polls when nothing is optimizing.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

export type OptimizationStatus = 'queued' | 'running' | 'done' | 'skipped' | 'failed';

export interface VideoOptimization {
  status: OptimizationStatus;
  reason: string | null;
  progress: number | null;
  sourceBytes: number | null;
  outputBytes: number | null;
  finishedAt: string | null;
}

export const OPTIMIZATION_POLL_MS = 10_000;

export const isOptimizing = (o: VideoOptimization | null | undefined): boolean =>
  !!o && (o.status === 'queued' || o.status === 'running');

/** The slice of an asset-list row this hook reads. */
export interface AssetWithTranscode {
  id?: string;
  transcodeJob?: Partial<Record<keyof VideoOptimization, unknown>> | null;
}

/** The list row's job, overridden by a fresher poll answer when there is one. */
export function optimizationOf(
  asset: AssetWithTranscode | null | undefined,
  live?: Map<string, VideoOptimization>,
): VideoOptimization | null {
  const fromLive = asset?.id ? live?.get(asset.id) : undefined;
  if (fromLive) return fromLive;
  const j = asset?.transcodeJob;
  if (!j || typeof j !== 'object' || typeof j.status !== 'string') return null;
  return {
    status: j.status as OptimizationStatus,
    reason: typeof j.reason === 'string' ? j.reason : null,
    progress: typeof j.progress === 'number' ? j.progress : null,
    sourceBytes: typeof j.sourceBytes === 'number' ? j.sourceBytes : null,
    outputBytes: typeof j.outputBytes === 'number' ? j.outputBytes : null,
    finishedAt: typeof j.finishedAt === 'string' ? j.finishedAt : null,
  };
}

/** % saved by a swap, or null. */
export function savedPercent(o: VideoOptimization | null): number | null {
  if (!o || o.status !== 'done' || !o.sourceBytes || !o.outputBytes || o.outputBytes >= o.sourceBytes) return null;
  return Math.round((1 - o.outputBytes / o.sourceBytes) * 100);
}

/**
 * Poll the optimization state of `assets` that are still optimizing. Returns
 * the freshest state per asset id.
 */
export function useVideoOptimizationStatus(assets: AssetWithTranscode[]): Map<string, VideoOptimization> {
  const qc = useQueryClient();
  const activeIds = useMemo(
    () =>
      (assets || [])
        .filter((a) => isOptimizing(optimizationOf(a)))
        .map((a) => String(a.id))
        .sort(),
    [assets],
  );
  const key = activeIds.join(',');
  const query = useQuery({
    queryKey: ['asset-optimization', key],
    queryFn: () =>
      apiFetch<{ items: Array<VideoOptimization & { assetId: string }> }>(
        `/assets/optimization?ids=${encodeURIComponent(key)}`,
      ),
    enabled: activeIds.length > 0,
    staleTime: 0,
    // Only while something is still optimizing; never in a background tab.
    refetchInterval: activeIds.length > 0 ? OPTIMIZATION_POLL_MS : false,
    refetchOnWindowFocus: activeIds.length > 0,
    retry: false,
  });

  const live = useMemo(() => {
    const m = new Map<string, VideoOptimization>();
    for (const it of query.data?.items ?? []) {
      if (it?.assetId) m.set(it.assetId, it);
    }
    return m;
  }, [query.data]);

  // A job that just finished changes the asset itself (URL, size, dimensions):
  // refetch the list ONCE per finished id.
  const refreshed = useRef(new Set<string>());
  useEffect(() => {
    let finished = false;
    for (const [id, o] of live) {
      if (!isOptimizing(o) && !refreshed.current.has(id)) {
        refreshed.current.add(id);
        finished = true;
      }
    }
    if (finished) void qc.invalidateQueries({ queryKey: ['assets'] });
  }, [live, qc]);

  return live;
}
