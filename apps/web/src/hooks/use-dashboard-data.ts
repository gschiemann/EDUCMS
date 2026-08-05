import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

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
