'use client';

/**
 * Customer-approved support access (2026-10-11) — data hooks for both sides.
 * No polling anywhere (mobile-perf standard): the state is read on mount,
 * re-read when the tab regains focus (a decision made on another device
 * should show when the operator comes back), and after each mutation.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { SupportAccessState, SupportGrant } from '@/lib/support-access';

export const supportAccessKeys = {
  mine: ['support-access', 'mine'] as const,
  org: (id: string) => ['super', 'customers', 'support-access', id] as const,
};

// ─── Customer side ──────────────────────────────────────────────────────────

export function useMySupportAccess(enabled = true) {
  return useQuery<SupportAccessState>({
    queryKey: supportAccessKeys.mine,
    queryFn: () => apiFetch<SupportAccessState>('/support-access'),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
    enabled,
  });
}

function useMineMutation<TBody>(run: (body: TBody) => Promise<SupportGrant>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => qc.invalidateQueries({ queryKey: supportAccessKeys.mine }),
  });
}

export function useInviteSupport() {
  return useMineMutation((body: { durationMinutes: number; note?: string; scopeTenantIds?: string[] }) =>
    apiFetch<SupportGrant>('/support-access/invite', { method: 'POST', body: JSON.stringify(body) }),
  );
}

export function useDecideSupport() {
  return useMineMutation((body: { grantId: string; approve: boolean; durationMinutes?: number | null; note?: string }) =>
    apiFetch<SupportGrant>(`/support-access/${body.grantId}/${body.approve ? 'approve' : 'deny'}`, {
      method: 'POST',
      body: JSON.stringify({ durationMinutes: body.durationMinutes ?? undefined, note: body.note }),
    }),
  );
}

export function useEndSupport() {
  return useMineMutation((body: { grantId: string; note?: string }) =>
    apiFetch<SupportGrant>(`/support-access/${body.grantId}/revoke`, { method: 'POST', body: JSON.stringify({ note: body.note }) }),
  );
}

// ─── VenueOS (owner console) side ───────────────────────────────────────────

export function useOrgSupportAccess(orgId: string | undefined, enabled = true) {
  return useQuery<SupportAccessState>({
    queryKey: supportAccessKeys.org(orgId ?? ''),
    queryFn: () => apiFetch<SupportAccessState>(`/super/customers/${orgId}/support-access`),
    enabled: !!orgId && enabled,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

function useOrgMutation<TBody>(orgId: string, run: (body: TBody) => Promise<SupportGrant>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: supportAccessKeys.org(orgId) });
      qc.invalidateQueries({ queryKey: ['tenants', 'accessible'] });
    },
  });
}

export function useRequestSupportAccess(orgId: string) {
  return useOrgMutation(orgId, (body: { reason: string; durationMinutes: number; scopeTenantIds?: string[] }) =>
    apiFetch<SupportGrant>(`/super/customers/${orgId}/support-access/request`, { method: 'POST', body: JSON.stringify(body) }),
  );
}

export function useEndOurSupportAccess(orgId: string) {
  return useOrgMutation(orgId, (body: { grantId: string; note?: string }) =>
    apiFetch<SupportGrant>(`/super/customers/${orgId}/support-access/${body.grantId}/revoke`, { method: 'POST', body: JSON.stringify({ note: body.note }) }),
  );
}

export function useBreakGlass(orgId: string) {
  return useOrgMutation(orgId, (body: { reason: string }) =>
    apiFetch<SupportGrant>(`/super/customers/${orgId}/support-access/break-glass`, { method: 'POST', body: JSON.stringify(body) }),
  );
}
