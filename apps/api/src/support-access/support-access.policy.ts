/**
 * CUSTOMER-APPROVED SUPPORT ACCESS (2026-10-11) — the pure rules.
 *
 * Nothing here touches Prisma, Nest or the wall clock unless a `now` is passed
 * in. The service and the interceptor call these; the spec pins every shape.
 *
 * VOCABULARY
 *   organisation  a ROOT tenant (parentId IS NULL). A grant always lives on the
 *                 root; a location (child) is reachable through its root's grant.
 *   grant         one SupportAccessGrant row. ACTIVE + not expired = VenueOS may
 *                 reach the organisation (or the listed locations) right now.
 *   reach         "may THIS super admin touch THIS tenant's data right now?" —
 *                 yes for an internal organisation, yes for the super admin's own
 *                 home tenant, otherwise only under an active covering grant.
 */

export const GRANT_KINDS = ['REQUEST', 'INVITE', 'BREAK_GLASS'] as const;
export type GrantKind = (typeof GRANT_KINDS)[number];

export const GRANT_STATUSES = ['REQUESTED', 'ACTIVE', 'DENIED', 'REVOKED', 'EXPIRED'] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];

/** The durations the UI offers. Anything in [MIN, MAX] is accepted from the API. */
export const DURATION_PRESETS_MINUTES = [60, 24 * 60, 7 * 24 * 60] as const;
export const MIN_DURATION_MINUTES = 15;
export const MAX_DURATION_MINUTES = 30 * 24 * 60; // 30 days
/** Break-glass is an incident path, never a working session: one hour, hard. */
export const BREAK_GLASS_MAX_MINUTES = 60;
export const MAX_REASON_LENGTH = 1_000;
export const MAX_SCOPE_TENANTS = 200;

/** The error code every refusal carries; the dashboard branches on it. */
export const SUPPORT_ACCESS_REQUIRED = 'SUPPORT_ACCESS_REQUIRED';

export interface GrantLike {
  id: string;
  tenantId: string;
  kind: string;
  status: string;
  scopeTenantIds?: string[] | null;
  startsAt?: Date | string | null;
  expiresAt?: Date | string | null;
}

const toMs = (v: Date | string | null | undefined): number | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
};

/** ACTIVE, started, and not yet expired at `now`. A grant with no expiry is never active. */
export function grantIsActive(grant: GrantLike | null | undefined, now: Date): boolean {
  if (!grant || grant.status !== 'ACTIVE') return false;
  const exp = toMs(grant.expiresAt);
  if (exp === null || exp <= now.getTime()) return false;
  const start = toMs(grant.startsAt);
  if (start !== null && start > now.getTime()) return false;
  return true;
}

/** An ACTIVE row whose expiry has passed: the service stamps it EXPIRED (with an audit row). */
export function grantHasLapsed(grant: GrantLike | null | undefined, now: Date): boolean {
  if (!grant || grant.status !== 'ACTIVE') return false;
  const exp = toMs(grant.expiresAt);
  return exp === null || exp <= now.getTime();
}

/**
 * Does an active grant on organisation `grant.tenantId` cover `tenantId`?
 * `rootId` is the organisation `tenantId` belongs to. Whole-org grant (empty
 * scope) covers every tenant in the organisation; a scoped grant covers ONLY
 * the listed tenants — not the root, not a sibling location.
 */
export function grantCoversTenant(grant: GrantLike, tenantId: string, rootId: string): boolean {
  if (grant.tenantId !== rootId) return false;
  const scope = grant.scopeTenantIds ?? [];
  if (scope.length === 0) return true;
  return scope.includes(tenantId);
}

/**
 * The duration an approval actually grants: the customer may SHORTEN what was
 * requested, never lengthen it. Null/undefined = exactly what was requested.
 */
export function approvedDurationMinutes(requested: number, chosen: number | null | undefined): number {
  const base = clampDuration(requested);
  if (chosen === null || chosen === undefined) return base;
  return Math.min(base, clampDuration(chosen));
}

export function clampDuration(minutes: number): number {
  if (!Number.isFinite(minutes)) return MIN_DURATION_MINUTES;
  return Math.min(MAX_DURATION_MINUTES, Math.max(MIN_DURATION_MINUTES, Math.round(minutes)));
}

export function expiryFor(startsAt: Date, minutes: number): Date {
  return new Date(startsAt.getTime() + minutes * 60_000);
}

// ─── Input validation ──────────────────────────────────────────────────────

export class SupportAccessInputError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function parseDurationMinutes(v: unknown, field = 'durationMinutes'): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < MIN_DURATION_MINUTES || n > MAX_DURATION_MINUTES) {
    throw new SupportAccessInputError(
      'SUPPORT_ACCESS_DURATION_INVALID',
      `${field} must be between ${MIN_DURATION_MINUTES} minutes and ${MAX_DURATION_MINUTES / 1440} days.`,
    );
  }
  return Math.round(n);
}

export function parseOptionalDurationMinutes(v: unknown, field = 'durationMinutes'): number | null {
  if (v === null || v === undefined || v === '') return null;
  return parseDurationMinutes(v, field);
}

export function parseReason(v: unknown, opts: { required: boolean; field?: string }): string | null {
  const s = str(v);
  if (!s) {
    if (opts.required) {
      throw new SupportAccessInputError('SUPPORT_ACCESS_REASON_REQUIRED', `${opts.field ?? 'reason'} is required.`);
    }
    return null;
  }
  if (s.length > MAX_REASON_LENGTH) {
    throw new SupportAccessInputError(
      'SUPPORT_ACCESS_REASON_TOO_LONG',
      `${opts.field ?? 'reason'} must be ${MAX_REASON_LENGTH} characters or fewer.`,
    );
  }
  return s;
}

/** Scope ids as sent by the client: strings, de-duplicated, bounded. Validity against the org is the service's job. */
export function parseScopeTenantIds(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new SupportAccessInputError('SUPPORT_ACCESS_SCOPE_INVALID', 'scopeTenantIds must be a list.');
  const out: string[] = [];
  for (const item of v) {
    const s = str(item);
    if (!s) throw new SupportAccessInputError('SUPPORT_ACCESS_SCOPE_INVALID', 'scopeTenantIds must be a list of ids.');
    if (!out.includes(s)) out.push(s);
  }
  if (out.length > MAX_SCOPE_TENANTS) {
    throw new SupportAccessInputError('SUPPORT_ACCESS_SCOPE_INVALID', `scopeTenantIds may list at most ${MAX_SCOPE_TENANTS} locations.`);
  }
  return out;
}

// ─── Which routes a SUPER_ADMIN may use WITHOUT a grant ────────────────────
//
// The gate sits in front of every tenant-data route. These are the routes that
// show NO customer content (or only the console's account / billing metadata),
// plus the routes a signed-in person needs to exist at all (auth, who-am-i,
// health, CSRF, the switcher itself — which runs its own grant check).
const EXEMPT_PREFIXES = [
  '/api/v1/auth',
  '/api/v1/health',
  '/api/v1/security/csrf',
  '/api/v1/super', // the customer console + platform ops pages (metadata only)
  '/api/v1/support-access',
  '/api/v1/license', // the console's billing metadata and the plan the UI shows
  '/api/v1/billing', // Stripe checkout/portal/invoices — account metadata, never content
  '/api/v1/player-ota', // fleet APK catalogue — platform, not customer content
  '/api/v1/bugs', // the Bug Reporter is VenueOS's own support intake (decision for Greg)
  '/api/v1/geocode', // address lookups, no tenant data
  '/api/v1/ai/catalog', // model catalogue (platform)
];
// Deliberately NOT exempt: /tenants/me, /branding/me, /notifications — each
// reads the ACTIVE tenant's own rows (name, palette, inbox). A super admin whose
// session is still stamped with a customer tenant after a grant ended gets 403
// on them, and the dashboard sends them back to the console (api-client.ts).
const EXEMPT_EXACT = ['/api/v1/users/me', '/api/v1/tenants/accessible', '/api/v1/tenants/switch'];

export function isSupportAccessExemptPath(path: string): boolean {
  const p = (path || '').split('?')[0].replace(/\/+$/, '') || '/';
  if (EXEMPT_EXACT.includes(p)) return true;
  return EXEMPT_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/** Methods the interceptor records as an action taken under the grant. */
export function isMutatingMethod(method: string | undefined): boolean {
  const m = String(method || 'GET').toUpperCase();
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
}

/** What the customer's banner and lists show. */
export function summarizeGrant(grant: GrantLike & Record<string, any>, now: Date) {
  return {
    id: grant.id,
    tenantId: grant.tenantId,
    kind: grant.kind,
    status: grant.status,
    active: grantIsActive(grant, now),
    reason: grant.reason ?? null,
    note: grant.note ?? null,
    scopeTenantIds: grant.scopeTenantIds ?? [],
    requestedDurationMinutes: grant.requestedDurationMinutes ?? null,
    requestedByEmail: grant.requestedByEmail ?? null,
    decidedByEmail: grant.decidedByEmail ?? null,
    revokedByEmail: grant.revokedByEmail ?? null,
    createdAt: grant.createdAt ?? null,
    decidedAt: grant.decidedAt ?? null,
    startsAt: grant.startsAt ?? null,
    expiresAt: grant.expiresAt ?? null,
    revokedAt: grant.revokedAt ?? null,
  };
}
