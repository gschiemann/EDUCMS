import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

/**
 * `enabled` — the audit feed is admin-only server-side (`/audit/recent`
 * requires SUPER/DISTRICT/SCHOOL admin). An Editor or viewer used to fire it
 * anyway: a 403 + three console errors on every dashboard load and every
 * 60 s poll (QA 2026-10-23). Callers pass the same admin gate.
 */
export function useRecentActivity(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['dashboard', 'activity'],
    queryFn: () => apiFetch('/audit/recent'),
    enabled: opts.enabled ?? true,
    // 60s — was 15s which meant the dashboard hit /audit 4× per minute.
    // Audit trail naturally lags real events by ~10s anyway (write +
    // index latency), so a 60s poll preserves "feels live" while
    // cutting API calls 4×. Operator: "no extra api calls."
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
