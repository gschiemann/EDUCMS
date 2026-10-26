"use client";

/**
 * Data source for the Connections catalog (§7.7; trimmed 2026-10-26).
 *
 * Independent reads, each allowed to fail on its own: a failed read makes
 * its rows `unknown` (§11) instead of poisoning the whole page or — worse —
 * defaulting to an optimistic "available".
 *
 * Settings simplification Phase 1 cut this from nine requests to five (six
 * for a school): the two ad-network reads fed no row (ad networks are not
 * built), the branding read fed only the Brand voice row (a writing style,
 * not a connection — it stays on the AI page), and the Clever roster status
 * is read only where Clever is listed (K-12).
 */
import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api-client';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import {
  buildCatalog,
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
  vertical: string | null;
}

export function useIntegrationsCatalog(): IntegrationsCatalogResult {
  const t = useTranslations('settings.cc.integrations.rows');
  const { vertical } = useTenantCopy();
  const readsClever = !vertical || vertical === 'K12';
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
        queryKey: ['integrations-catalog', 'ai-key'],
        queryFn: () => apiFetch<AiKeyStatusLike>('/ai/key'),
        retry: RETRY,
      },
      {
        queryKey: ['integrations-catalog', 'clever-status'],
        queryFn: () => apiFetch<CleverStatusLike>('/integrations/clever/status'),
        retry: RETRY,
        enabled: readsClever,
      },
    ],
  });

  const [streamProviders, streamConnections, posProviders, posConnections, aiKey, clever] = results;

  const active = readsClever ? results : results.slice(0, 5);
  const loading = active.some((r) => r.isLoading);
  const degradedSources = active.some((r) => r.isError);

  const aiKeyLabel = t('aiKey');
  const cleverLabel = t('clever');
  const entries = useMemo(
    () =>
      buildCatalog({
        streamingProviders: streamProviders.data ?? undefined,
        streamingConnections: streamConnections.data ?? undefined,
        streamingReachable: streamConnections.isSuccess,
        posProviders: posProviders.data ?? undefined,
        posConnections: posConnections.data ?? undefined,
        posReachable: posConnections.isSuccess,
        aiKey: aiKey.isSuccess ? aiKey.data : null,
        clever: clever.isSuccess ? clever.data : null,
        vertical,
        labels: { aiKey: aiKeyLabel, clever: cleverLabel },
      }),
    [
      streamProviders.data,
      streamConnections.data,
      streamConnections.isSuccess,
      posProviders.data,
      posConnections.data,
      posConnections.isSuccess,
      aiKey.data,
      aiKey.isSuccess,
      clever.data,
      clever.isSuccess,
      vertical,
      aiKeyLabel,
      cleverLabel,
    ],
  );

  const refetchAll = () => {
    active.forEach((r) => {
      void r.refetch();
    });
  };

  return { entries, loading, degradedSources, refetchAll, vertical: vertical ?? null };
}
