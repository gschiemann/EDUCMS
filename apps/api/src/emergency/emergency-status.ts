/**
 * Is a `Tenant.emergencyStatus` value an ACTIVE alert?
 *
 * `emergencyStatus` holds the SEVERITY of the active alert (CRITICAL / HIGH /
 * MEDIUM …) and `'INACTIVE'` when calm — that is the schema default and what
 * all-clear writes. It never holds the incident type; that is
 * `Tenant.emergencyType`.
 *
 * 2026-09-21: the super-admin tenant rollup decided "active" by comparing
 * against `'NONE'` and `'CLEARED'` — two values nothing in this system has ever
 * written — so every calm tenant (`'INACTIVE'`) was reported as in emergency.
 * Same family as the per-screen content key in the manifest, found the same
 * day: a reader guessing at an enum instead of reading what the producer
 * writes. One predicate, so the next reader has something to import.
 *
 * The calm list is a SUPERSET on purpose (`NORMAL`, `NONE`, `CLEARED`, empty):
 * a value that read as calm anywhere before must not start reading as active.
 */
export const CALM_EMERGENCY_STATUSES: readonly string[] = [
  '',
  'INACTIVE',
  'NORMAL',
  'NONE',
  'CLEARED',
];

export function isEmergencyStatusActive(
  status: string | null | undefined,
): boolean {
  if (!status) return false;
  return !CALM_EMERGENCY_STATUSES.includes(String(status).trim().toUpperCase());
}
