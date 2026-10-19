'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { BusinessProfitResponse, ProviderUsageResponse } from '@/lib/business-profit';

export const businessProfitKey = ['super-business'] as const;
export const providerUsageKey = ['super-business-provider-usage'] as const;

export interface SavePlatformCostBody {
  provider: string;
  service: string;
  planName?: string | null;
  monthlyCostCents: number;
  budgetCents?: number | null;
  nextBillAt?: string | null;
  notes?: string | null;
  active?: boolean;
}

export function useBusinessProfit(enabled = true) {
  return useQuery({
    queryKey: businessProfitKey,
    queryFn: () => apiFetch<BusinessProfitResponse>('/super/business'),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useProviderUsage(enabled = true) {
  return useQuery({
    queryKey: providerUsageKey,
    queryFn: () => apiFetch<ProviderUsageResponse>('/super/business/provider-usage'),
    enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useSavePlatformCost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SavePlatformCostBody) => apiFetch('/super/business/costs', {
      method: 'POST', body: JSON.stringify(body),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: businessProfitKey }),
  });
}

export function useUpdatePlatformCost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<SavePlatformCostBody> & { id: string; active?: boolean }) => apiFetch(`/super/business/costs/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: businessProfitKey }),
  });
}
