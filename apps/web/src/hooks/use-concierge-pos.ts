'use client';

/**
 * The Concierge's POS card data (2026-09-22) — GET /templates/concierge/pos-context:
 * this location's (and its organisation's) POS connections, each menu's sections
 * with bindable item counts, what each POS keeps live, and which POS the
 * operator could connect.
 *
 * NO POLLING (mobile-perf standard). The operator connects a POS in ANOTHER tab
 * (the provider's OAuth page, or Settings → POS for Toast) and comes back to the
 * chat — so this one query opts in to refetch-on-window-focus, which is exactly
 * "refresh when they return". The global default stays off.
 */
import { useQuery } from '@tanstack/react-query';
import type { ConciergePosContext } from '@cms/api-types';
import { apiFetch } from '@/lib/api-client';

export const CONCIERGE_POS_CONTEXT_KEY = ['concierge-pos-context'] as const;

export function useConciergePosContext(enabled: boolean) {
  return useQuery<ConciergePosContext>({
    queryKey: CONCIERGE_POS_CONTEXT_KEY,
    queryFn: () => apiFetch<ConciergePosContext>('/templates/concierge/pos-context'),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

/**
 * Start a provider's OAuth in a NEW tab, so the chat in this one survives. The
 * tab is opened synchronously on the tap (a popup blocker allows that), then
 * pointed at the authorize URL once the API mints it. Resolves false when the
 * tab could not be opened or the URL could not be minted (the caller then falls
 * back to Settings → POS).
 */
export async function openPosOAuthInNewTab(providerId: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const tab = window.open('', '_blank');
  if (!tab) return false;
  try {
    const r = await apiFetch<{ url: string }>(`/pos/oauth/${encodeURIComponent(providerId)}/authorize`);
    if (!r?.url || !/^https:\/\//i.test(r.url)) throw new Error('no authorize url');
    try { tab.opener = null; } catch { /* cross-origin later — fine */ }
    tab.location.href = r.url;
    return true;
  } catch {
    try { tab.close(); } catch { /* already closed */ }
    return false;
  }
}
