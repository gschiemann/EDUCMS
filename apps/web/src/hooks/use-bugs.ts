/**
 * Bug-reporter React Query hooks.
 *
 * Backend lives at:
 *   POST   /api/v1/bugs              — submit a new bug
 *   GET    /api/v1/bugs              — SUPER_ADMIN list
 *   GET    /api/v1/bugs/:id          — SUPER_ADMIN detail (poll while ANALYZING)
 *   POST   /api/v1/bugs/:id/approve  — approve + open PR
 *   POST   /api/v1/bugs/:id/reject   — reject with reason
 *   POST   /api/v1/bugs/:id/iterate  — ask the AI to rethink with notes
 *
 * Every payload / response type lives in `@cms/api-types` (bugs.ts).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApproveBugRequest,
  ApproveBugResponse,
  BugDetail,
  BugListItem,
  BugStatus,
  CreateBugRequest,
  CreateBugResponse,
  IterateBugRequest,
  RejectBugRequest,
} from '@cms/api-types';
import { apiFetch } from '@/lib/api-client';

export interface BugListFilters {
  /** Optional status filter (single value). Omitted = all statuses. */
  status?: BugStatus;
}

const LIST_KEY = (filters: BugListFilters) => ['super-bugs', filters.status || 'ALL'] as const;
const DETAIL_KEY = (id: string) => ['super-bugs', 'detail', id] as const;

/** POST /api/v1/bugs — submit a new bug from the floating button. */
export function useCreateBug() {
  const qc = useQueryClient();
  return useMutation<CreateBugResponse, Error, CreateBugRequest>({
    mutationFn: (body) =>
      apiFetch<CreateBugResponse>('/bugs', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      // Any open /super/bugs list should pick up the new row.
      qc.invalidateQueries({ queryKey: ['super-bugs'] });
    },
  });
}

/** GET /api/v1/bugs — SUPER_ADMIN list with optional status filter.
 *  Auto-refreshes every 15s while NEW or ANALYZING rows are present so
 *  the operator sees AI analysis land without manual refresh. */
export function useBugList(filters: BugListFilters = {}) {
  return useQuery<BugListItem[]>({
    queryKey: LIST_KEY(filters),
    queryFn: () => {
      const qs = new URLSearchParams();
      if (filters.status) qs.set('status', filters.status);
      const suffix = qs.toString();
      return apiFetch<BugListItem[]>(`/bugs${suffix ? `?${suffix}` : ''}`);
    },
    staleTime: 5_000,
    refetchInterval: (query) => {
      const list = query.state.data;
      if (!Array.isArray(list)) return false;
      const pending = list.some((b) => b.status === 'NEW' || b.status === 'ANALYZING');
      return pending ? 15_000 : false;
    },
    refetchOnWindowFocus: true,
  });
}

/** GET /api/v1/bugs/:id — SUPER_ADMIN detail view.
 *  Polls every 5s while status is ANALYZING. */
export function useBugDetail(id: string | undefined) {
  return useQuery<BugDetail>({
    queryKey: id ? DETAIL_KEY(id) : ['super-bugs', 'detail', '_disabled'],
    queryFn: () => apiFetch<BugDetail>(`/bugs/${id}`),
    enabled: !!id,
    staleTime: 5_000,
    refetchInterval: (query) => {
      const bug = query.state.data;
      if (!bug) return false;
      // Keep polling until the AI analyzer finishes (PROPOSED) or the
      // bug terminates. NEW / ANALYZING / APPROVED still benefit from
      // updates (APPROVED can promote to SHIPPED once the PR merges).
      if (bug.status === 'NEW' || bug.status === 'ANALYZING') return 5_000;
      if (bug.status === 'APPROVED') return 10_000;
      return false;
    },
  });
}

/** POST /api/v1/bugs/:id/approve — operator approves the AI's diff. */
export function useApproveBug(id: string | undefined) {
  const qc = useQueryClient();
  return useMutation<ApproveBugResponse, Error, ApproveBugRequest>({
    mutationFn: (body) => {
      if (!id) throw new Error('missing bug id');
      return apiFetch<ApproveBugResponse>(`/bugs/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      if (id) qc.invalidateQueries({ queryKey: DETAIL_KEY(id) });
      qc.invalidateQueries({ queryKey: ['super-bugs'] });
    },
  });
}

/** POST /api/v1/bugs/:id/reject — admin rejects with reason. */
export function useRejectBug(id: string | undefined) {
  const qc = useQueryClient();
  return useMutation<{ bugId: string; status: BugStatus }, Error, RejectBugRequest>({
    mutationFn: (body) => {
      if (!id) throw new Error('missing bug id');
      return apiFetch<{ bugId: string; status: BugStatus }>(`/bugs/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      if (id) qc.invalidateQueries({ queryKey: DETAIL_KEY(id) });
      qc.invalidateQueries({ queryKey: ['super-bugs'] });
    },
  });
}

/** POST /api/v1/bugs/:id/iterate — ask the AI for a fresh analysis with
 *  operator notes ("the fix should also handle X"). */
export function useIterateBug(id: string | undefined) {
  const qc = useQueryClient();
  return useMutation<{ bugId: string; status: BugStatus }, Error, IterateBugRequest>({
    mutationFn: (body) => {
      if (!id) throw new Error('missing bug id');
      return apiFetch<{ bugId: string; status: BugStatus }>(`/bugs/${id}/iterate`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      if (id) qc.invalidateQueries({ queryKey: DETAIL_KEY(id) });
      qc.invalidateQueries({ queryKey: ['super-bugs'] });
    },
  });
}
