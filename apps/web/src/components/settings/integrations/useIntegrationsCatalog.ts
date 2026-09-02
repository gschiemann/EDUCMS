"use client";

/**
 * Data source for the Integrations catalog (§7.7).
 *
 * Six independent reads. Each one is allowed to fail on its own: a
 * failed read makes its rows `unknown` (§11) instead of poisoning the
 * whole page or — worse — defaulting to an optimistic "available".
 *
 * The Clever roster endpoints are a live example of why that matters:
 * `CleverModule` is not imported by any Nest module today, so
 * `/integrations/clever/status` 404s and the row correctly reads
 * `Unknown` rather than offering a Connect button that cannot work.
 */
import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import {
  buildCatalog,
  type AdNetworkLike,
  type AiKeyStatusLike,
  type CleverStatusLike,
  type ConnectionRowLike,
  type IntegrationCatalogEntry,
  type PosProviderLike,
  type StreamProviderLike,
} from './catalog';

const RETRY = 0;

export interface IntegrationsCatalogResult {
  entries: IntegrationCatalogEntry[];
  loading: boolean;
  /** true when at least one status source could not be read. */
  degradedSources: boolean;
  refetchAll: () => void;
}

export function useIntegrationsCatalog(): IntegrationsCatalogResult {
  const results = useQueries({
    queries: [
      {
        queryKey: ['integrations-catalog', 'streaming-providers'],
        queryFn: () => apiFetch<StreamProviderLike[]>('/streaming/providers'),
        retry: RETRY,
      },
      {
        queryKey: ['integrations-catalog', 'streaming-connections'],
        queryFn: () => apiFetch<ConnectionRowLike[]>('/streaming/connections'),
        retry: RETRY,
      },
      {
        queryKey: ['integrations-catalog', 'pos-providers'],
        queryFn: () => apiFetch<PosProviderLike[]>('/pos/providers'),
        retry: RETRY,
      },
      {
        queryKey: ['integrations-catalog', 'pos-connections'],
        queryFn: () => apiFetch<ConnectionRowLike[]>('/pos/connections'),
        retry: RETRY,
      },
      {
        queryKey: ['integrations-catalog', 'ads-networks'],
        queryFn: () => apiFetch<AdNetworkLike[]>('/ads/networks'),
        retry: RETRY,
      },
      {
        queryKey: ['integrations-catalog', 'ads-connections'],
        queryFn: () => apiFetch<ConnectionRowLike[]>('/ads/connections'),
        retry: RETRY,
      },
      {
        queryKey: ['integrations-catalog', 'ai-key'],
        queryFn: () => apiFetch<AiKeyStatusLike>('/ai/key'),
        retry: RETRY,
      },
      {
        queryKey: ['integrations-catalog', 'branding-me'],
        queryFn: () => apiFetch<{ brandVoice?: string | null }>('/branding/me'),
        retry: RETRY,
      },
      {
        queryKey: ['integrations-catalog', 'clever-status'],
        queryFn: () => apiFetch<CleverStatusLike>('/integrations/clever/status'),
        retry: RETRY,
      },
    ],
  });

  const [
    streamProviders,
    streamConnections,
    posProviders,
    posConnections,
    adNetworks,
    adConnections,
    aiKey,
    branding,
    clever,
  ] = results;

  const loading = results.some((r) => r.isLoading);
  const degradedSources = results.some((r) => r.isError);

  const entries = useMemo(
    () =>
      buildCatalog({
        streamingProviders: streamProviders.data ?? undefined,
        streamingConnections: streamConnections.data ?? undefined,
        streamingReachable: streamConnections.isSuccess,
        posProviders: posProviders.data ?? undefined,
        posConnections: posConnections.data ?? undefined,
        posReachable: posConnections.isSuccess,
        adNetworks: adNetworks.data ?? undefined,
        adConnections: adConnections.data ?? undefined,
        adsReachable: adConnections.isSuccess,
        aiKey: aiKey.isSuccess ? aiKey.data : null,
        brandVoice: branding.data?.brandVoice ?? null,
        brandingReachable: branding.isSuccess,
        clever: clever.isSuccess ? clever.data : null,
      }),
    [
      streamProviders.data,
      streamConnections.data,
      streamConnections.isSuccess,
      posProviders.data,
      posConnections.data,
      posConnections.isSuccess,
      adNetworks.data,
      adConnections.data,
      adConnections.isSuccess,
      aiKey.data,
      aiKey.isSuccess,
      branding.data,
      branding.isSuccess,
      clever.data,
      clever.isSuccess,
    ],
  );

  const refetchAll = () => {
    results.forEach((r) => {
      void r.refetch();
    });
  };

  return { entries, loading, degradedSources, refetchAll };
}
