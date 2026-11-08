/**
 * Scheduled restart (2026-11-08) — one opt-in policy per screen group.
 * API: apps/api/src/scheduled-reboot/scheduled-reboot.controller.ts.
 * Point-in-time reads only: no polling, no refetch on focus.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api-client';

export type RestartCadence = 'DAILY' | 'WEEKLY';

export interface RestartPolicy {
  id: string;
  cadence: RestartCadence;
  dayOfWeek: number | null;
  time: string;
  isActive: boolean;
  updatedAt?: string;
}

export interface RestartRun {
  status: string;
  reason: string | null;
  scheduledFor: string;
  dispatchedAt: string | null;
  returnedAt: string | null;
  restartProven: boolean;
}

export interface RestartScreen {
  id: string;
  name: string;
  hardwareClass: string | null;
  canRestart: boolean;
  restartedRecently: boolean;
  lastRun: RestartRun | null;
}

export interface GroupRestartState {
  disabled: boolean;
  policy: RestartPolicy | null;
  screens: RestartScreen[];
}

export interface RestartPolicyInput {
  cadence: RestartCadence;
  dayOfWeek?: number | null;
  time: string;
  isActive?: boolean;
}

const key = (groupId: string | null) => ['scheduled-restart', groupId] as const;

export function useGroupScheduledRestart(groupId: string | null) {
  return useQuery<GroupRestartState>({
    queryKey: key(groupId),
    queryFn: () => apiFetch(`/scheduled-reboots/groups/${encodeURIComponent(groupId!)}`),
    enabled: !!groupId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useSetGroupScheduledRestart(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RestartPolicyInput) =>
      apiFetch(`/scheduled-reboots/groups/${encodeURIComponent(groupId)}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSettled: () => qc.invalidateQueries({ queryKey: key(groupId) }),
  });
}

export function useClearGroupScheduledRestart(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch(`/scheduled-reboots/groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' }),
    onSettled: () => qc.invalidateQueries({ queryKey: key(groupId) }),
  });
}

/** 22:00–04:59 — the API refuses anything else. */
export function isAllowedRestartTime(time: string): boolean {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) return false;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes >= 22 * 60 || minutes < 5 * 60;
}
