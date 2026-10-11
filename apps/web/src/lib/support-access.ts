/**
 * Customer-approved support access (2026-10-11) — shared shapes + pure helpers
 * for the customer banner / Settings page and the owner console card.
 * Mirrors apps/api/src/support-access/support-access.policy.ts.
 */

export type GrantKind = 'REQUEST' | 'INVITE' | 'BREAK_GLASS';
export type GrantStatus = 'REQUESTED' | 'ACTIVE' | 'DENIED' | 'REVOKED' | 'EXPIRED';
export type ReachBasis = 'internal' | 'home' | 'grant';

export interface SupportGrant {
  id: string;
  tenantId: string;
  kind: GrantKind;
  status: GrantStatus;
  active: boolean;
  reason: string | null;
  note: string | null;
  scopeTenantIds: string[];
  requestedDurationMinutes: number | null;
  requestedByEmail: string | null;
  decidedByEmail: string | null;
  revokedByEmail: string | null;
  createdAt: string | null;
  decidedAt: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface SupportAccessLocation {
  id: string;
  name: string;
  slug: string;
}

export interface SupportAccessState {
  tenantId: string;
  active: SupportGrant | null;
  pending: SupportGrant[];
  history: SupportGrant[];
  locations: SupportAccessLocation[];
  /** Customer side: may this signed-in person approve / deny / invite / end? */
  canDecide?: boolean;
  /** Owner side: VenueOS's current reach, or null when it would need a grant. */
  reach?: ReachBasis | null;
  internal?: boolean;
}

/** The durations the UI offers, in minutes. */
export const DURATION_PRESETS = [
  { minutes: 60, key: 'oneHour' },
  { minutes: 24 * 60, key: 'oneDay' },
  { minutes: 7 * 24 * 60, key: 'sevenDays' },
] as const;

export const BREAK_GLASS_MINUTES = 60;
export const MAX_REASON = 1000;

/** The error code the API answers when VenueOS has no reach. */
export const SUPPORT_ACCESS_REQUIRED = 'SUPPORT_ACCESS_REQUIRED';

/** Minutes left on a grant at `now`; 0 when it is over or has no expiry. */
export function minutesLeft(grant: Pick<SupportGrant, 'expiresAt'> | null | undefined, now: Date = new Date()): number {
  if (!grant?.expiresAt) return 0;
  const t = new Date(grant.expiresAt).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.ceil((t - now.getTime()) / 60_000));
}

/** The shortest duration the customer may approve is never longer than what was asked. */
export function approvableDurations(requestedMinutes: number | null | undefined): Array<{ minutes: number; key: string }> {
  const cap = requestedMinutes ?? Number.POSITIVE_INFINITY;
  const presets: Array<{ minutes: number; key: string }> = DURATION_PRESETS.filter((p) => p.minutes < cap).map((p) => ({ minutes: p.minutes, key: p.key }));
  if (requestedMinutes && !presets.some((p) => p.minutes === requestedMinutes)) presets.push({ minutes: requestedMinutes, key: 'asRequested' });
  return presets;
}

export function formatWhen(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  } catch {
    return d.toISOString();
  }
}

/** A grant's status as a tone for the pill. */
export function grantTone(g: Pick<SupportGrant, 'status' | 'active'>): 'active' | 'pending' | 'ended' {
  if (g.active) return 'active';
  if (g.status === 'REQUESTED') return 'pending';
  return 'ended';
}
