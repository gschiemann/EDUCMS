import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => apiFetch('/stats/overview'),
    // 60s — stats counters change on a human cadence (assets uploaded,
    // playlists scheduled). 30s was 2× the actual signal change rate
    // and contributed to API thrash in the audit complaint.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useRecentActivity() {
  return useQuery({
    queryKey: ['dashboard', 'activity'],
    queryFn: () => apiFetch('/audit/recent'),
    // 60s — was 15s which meant the dashboard hit /audit 4× per minute.
    // Audit trail naturally lags real events by ~10s anyway (write +
    // index latency), so a 60s poll preserves "feels live" while
    // cutting API calls 4×. Operator: "no extra api calls."
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
