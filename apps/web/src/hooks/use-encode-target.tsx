/**
 * The size target a video is graded against: the LARGEST panel in this
 * tenant's fleet (2026-09-24 — Greg: "these are all 4k screens so why would
 * we recommend 1080? dont we want the max out of them?").
 *
 * `EncodeTargetProvider` (mounted once in the school layout) asks the API for
 * `GET /screens/panel-target` — sixty bytes, cached five minutes, NO polling
 * interval (the mobile-perf standard: a library page must not start polling
 * the fleet). Every badge and card reads it through `useEncodeTarget()`; with
 * no provider (tests, the player) the default 1920 × 1080 / panel-unknown
 * target applies, which says nothing about "soft" files.
 */
'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_ENCODE_TARGET, type VideoEncodeTarget } from '@cms/api-types';
import { apiFetch } from '@/lib/api-client';

/** Exported for tests and for surfaces that already hold a target. */
export const EncodeTargetContext = createContext<VideoEncodeTarget>(DEFAULT_ENCODE_TARGET);

export const ENCODE_TARGET_QUERY_KEY = ['screens', 'panel-target'] as const;

function normalize(raw: unknown): VideoEncodeTarget {
  const r = raw as Partial<VideoEncodeTarget> | null | undefined;
  const w = typeof r?.panelWidth === 'number' && r.panelWidth > 0 ? Math.floor(r.panelWidth) : null;
  const h = typeof r?.panelHeight === 'number' && r.panelHeight > 0 ? Math.floor(r.panelHeight) : null;
  if (w === null || h === null || r?.panelKnown !== true) return DEFAULT_ENCODE_TARGET;
  return { panelWidth: Math.max(w, h), panelHeight: Math.min(w, h), panelKnown: true };
}

export function EncodeTargetProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery({
    queryKey: ENCODE_TARGET_QUERY_KEY,
    queryFn: () => apiFetch('/screens/panel-target'),
    staleTime: 5 * 60_000,
  });
  const value = useMemo(() => normalize(data), [data]);
  return <EncodeTargetContext.Provider value={value}>{children}</EncodeTargetContext.Provider>;
}

export function useEncodeTarget(): VideoEncodeTarget {
  return useContext(EncodeTargetContext);
}
