import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => apiFetch('/stats/overview'),
    refetchInterval: 30000, // Auto-refresh every 30s for live dashboard feel
  });
}

export function useRecentActivity() {
  return useQuery({
    queryKey: ['dashboard', 'activity'],
    queryFn: () => apiFetch('/audit/recent'),
    refetchInterval: 15000, // More frequent for audit trail
  });
}
