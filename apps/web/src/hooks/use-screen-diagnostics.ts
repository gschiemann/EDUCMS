/**
 * Screen diagnostics hooks (2026-11-08) — `GET/POST /screens/:id/diagnostics`
 * and the logs download URL. Own file so the shared `use-api.ts` is untouched.
 *
 * Mobile-perf standard: fetched only while the drawer section is mounted and
 * enabled; it polls (every 3 s, visible tab only — never in the background)
 * ONLY while a request is pending or running on the screen, and stops the
 * moment it settles.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

export type DiagCheckStatus = 'pass' | 'warn' | 'fail' | 'unknown';
export type DiagViewStatus = 'pending' | 'running' | 'complete' | 'failed' | 'expired';

export interface DiagCheck {
  id: string;
  group: 'device' | 'network' | 'player';
  status: DiagCheckStatus;
  values: Record<string, string | number | boolean>;
}

export interface DiagRequestView {
  id: string;
  kind: 'SELF_TEST' | 'LOGS';
  status: DiagViewStatus;
  createdAt: string;
  completedAt: string | null;
  verdict: 'pass' | 'warn' | 'fail' | null;
  checks: DiagCheck[];
  minutes?: number | null;
  logBytes?: number | null;
  logAvailable?: boolean;
  logPurged?: boolean;
  failureReason?: string | null;
  answered?: { native: boolean; page: boolean };
}

export interface DiagStorage {
  warning: 'almost-full' | 'critical' | null;
  native: { freeBytes: number; totalBytes: number; writeOk: boolean | null; at: string } | null;
  page: { origin: { usage: number; quota: number } | null; emergency: { readable: boolean; entries: number | null } | null; at: string } | null;
}

export interface DiagnosticsView {
  enabled: boolean;
  canRequestLogs: boolean;
  retentionDays: number;
  storage: DiagStorage | null;
  selfTest: DiagRequestView | null;
  logs: DiagRequestView[];
}

const open = (r: DiagRequestView | null | undefined) => !!r && (r.status === 'pending' || r.status === 'running');

export function diagnosticsBusy(v: DiagnosticsView | undefined): boolean {
  return !!v && (open(v.selfTest) || v.logs.some(open));
}

export function useScreenDiagnostics(screenId: string | null, enabled: boolean) {
  return useQuery<DiagnosticsView>({
    queryKey: ['screens', 'diagnostics', screenId],
    queryFn: () => apiFetch(`/screens/${screenId}/diagnostics`),
    enabled: !!screenId && enabled,
    staleTime: 30_000,
    refetchInterval: (q) => (diagnosticsBusy(q.state.data as DiagnosticsView | undefined) ? 3_000 : false),
  });
}

export function useRequestDiagnostics(screenId: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { suppressGlobalError: true },
    mutationFn: (body: { kind: 'SELF_TEST' | 'LOGS'; minutes?: number }) =>
      apiFetch<DiagRequestView>(`/screens/${screenId}/diagnostics`, { method: 'POST', body: JSON.stringify(body) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['screens', 'diagnostics', screenId] }),
  });
}

export function fetchLogsUrl(screenId: string, requestId: string) {
  return apiFetch<{ url: string; expiresInSeconds: number }>(`/screens/${screenId}/diagnostics/${requestId}/logs-url`);
}
