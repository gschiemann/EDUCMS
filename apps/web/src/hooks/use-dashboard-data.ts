import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ActivityItem } from '@cms/api-types';
import { apiFetch } from '@/lib/api-client';
import type { ScreenAttentionPayload } from '@/lib/activity/screenAttention';

/**
 * `enabled` — the audit feed is admin-only server-side (`/audit/recent`
 * requires SUPER/DISTRICT/SCHOOL admin). An Editor or viewer used to fire it
 * anyway: a 403 + three console errors on every dashboard load and every
 * 60 s poll (QA 2026-10-23). Callers pass the same admin gate.
 *
 * 2026-10-24 — the answer is customer activity only (the API's allowlist,
 * written by a person), each row with its names resolved — see
 * `@/lib/activity/activityFeed` for how it becomes a sentence.
 */
export function useRecentActivity(opts: { enabled?: boolean } = {}) {
  return useQuery<ActivityItem[]>({
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

/**
 * 2026-10-24 — which offline screens are a real outage (`down`), off on
 * purpose (`resting`: on/off schedule, remote power-off, standby, restarting)
 * or old news (`dormant`: 30+ days silent, never connected, a test screen).
 *
 * Asked only when something is offline, and again whenever the SET of offline
 * screens changes (`offlineKey` rides the query key) — so a screen that just
 * dropped is judged at once, and a steady fleet costs one read a minute while
 * the page is visible (no background polling — the mobile-perf standard).
 */
export function useScreenAttention(offlineKey: string, opts: { enabled?: boolean } = {}) {
  return useQuery<ScreenAttentionPayload>({
    queryKey: ['dashboard', 'screen-attention', offlineKey],
    queryFn: () => apiFetch('/screens/attention'),
    enabled: (opts.enabled ?? true) && offlineKey.length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    // Keep the last verdict while a new key loads, so a second screen dropping
    // does not flash the first one back into the red card.
    placeholderData: keepPreviousData,
  });
}
