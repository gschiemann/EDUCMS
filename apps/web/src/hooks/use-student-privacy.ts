'use client';

/**
 * Student information on public screens — the dashboard's data hooks (K-12
 * sports launch, lane B3, 2026-09-27). The API enforces the policy on every
 * public output (apps/api/src/sports/student-privacy.ts); these hooks read and
 * record the school's decision. No timers, no polling: settings are read on
 * mount (60 s fresh) and refreshed by the mutations that change them.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StudentPrivacyAction, StudentPrivacyCategory, StudentPrivacySettings } from '@cms/api-types';
import { apiFetch } from '@/lib/api-client';

export const STUDENT_PRIVACY_KEY = ['sports', 'student-privacy'] as const;

export function useStudentPrivacy(opts: { enabled?: boolean } = {}) {
  return useQuery<StudentPrivacySettings>({
    queryKey: STUDENT_PRIVACY_KEY,
    queryFn: () => apiFetch<StudentPrivacySettings>('/sports/student-privacy'),
    staleTime: 60_000,
    enabled: opts.enabled ?? true,
  });
}

/** Confirm / revoke / hide / un-hide names or photos at this location. */
export function useSetStudentPrivacy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { category: StudentPrivacyCategory; action: StudentPrivacyAction; version?: string }) =>
      apiFetch<StudentPrivacySettings>(`/sports/student-privacy/${v.category}`, {
        method: 'PUT',
        body: JSON.stringify({ action: v.action, version: v.version }),
      }),
    onSuccess: (settings) => qc.setQueryData(STUDENT_PRIVACY_KEY, settings),
  });
}

/** A non-K-12 location says whether its athletes include minors. */
export function useSetServesMinors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (servesMinors: boolean) =>
      apiFetch<StudentPrivacySettings>('/sports/student-privacy/serves-minors', {
        method: 'PUT',
        body: JSON.stringify({ servesMinors }),
      }),
    onSuccess: (settings) => qc.setQueryData(STUDENT_PRIVACY_KEY, settings),
  });
}

export interface StudentFlagsResult {
  playerId: string;
  directoryOptOut: boolean;
  photoRelease: boolean;
  linked: boolean;
}

/** One roster student's "Directory opt-out" / "Photo release on file". */
export function useSetStudentFlags(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { playerId: string; directoryOptOut?: boolean; photoRelease?: boolean }) =>
      apiFetch<StudentFlagsResult>(`/sports/games/${gameId}/roster/${v.playerId}/privacy`, {
        method: 'PATCH',
        body: JSON.stringify({ directoryOptOut: v.directoryOptOut, photoRelease: v.photoRelease }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sports-roster', gameId] }),
  });
}
