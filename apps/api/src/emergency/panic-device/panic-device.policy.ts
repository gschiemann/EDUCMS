/**
 * Panic phones (2026-11-14) — THE RULES, as pure functions.
 *
 * The owner, 2026-11-10: "the emergency saved mobile button should have some
 * different rules as well, last thing we need is a login holding back an
 * emergency trigger for a teacher". A person who may send an emergency signs
 * in once on their phone and keeps it ready; the phone then holds a
 * long-lived credential that can do EXACTLY two things:
 *
 *   1. send an emergency that person may send (`POST …/panic-device/trigger`,
 *      which runs the emergency controller's own `triggerEmergency`), and
 *   2. read what the panic page shows (`status`, `targets`, `active`).
 *
 * It can never send an all-clear ("raise, never release" — ending an alert
 * stays behind a full sign-in), never reach the dashboard, never change
 * anything else. That boundary is structural, not a list of refusals: the
 * credential is an opaque string that only `PanicDeviceController` reads,
 * it is not a JWT (every other route's `JwtAuthGuard` rejects it), and that
 * controller has no route that reaches anything but the trigger and the
 * reads. `panic-device.scope.spec.ts` pins all three.
 *
 * Every decision about WHO may use it is made here, against the LIVE user
 * row at every presentation — nothing about authority is stored with the
 * credential.
 */
import { createHash, randomBytes } from 'crypto';

/** The roles that carry emergency authority inherently — `@RequireRoles` on `POST /emergency/trigger`. */
export const PANIC_AUTHORITY_ROLES: ReadonlySet<string> = new Set(['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']);

/**
 * May this person send an emergency? Exactly the trigger route's own rule:
 * `@RequireRoles(SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN)` widened by
 * `@AllowPanicBypass` (rbac.guard.ts) to any non-RESTRICTED_VIEWER holding
 * `canTriggerPanic`. Fails closed: the flag must be exactly `true`.
 */
export function hasPanicAuthority(user: { role?: string | null; canTriggerPanic?: boolean | null } | null | undefined): boolean {
  if (!user) return false;
  const role = String(user.role ?? '');
  if (PANIC_AUTHORITY_ROLES.has(role)) return true;
  return user.canTriggerPanic === true && role !== 'RESTRICTED_VIEWER';
}

// ── The credential ─────────────────────────────────────────────────────────

/** Versioned prefix, so a future format can be told apart and a stray JWT never matches. */
export const PANIC_CREDENTIAL_PREFIX = 'pd1.';
/** 32 bytes = 256 bits: not guessable, so presentation needs no lockout to be safe. */
const SECRET_BYTES = 32;
/** `pd1.` + base64url(32 bytes) — exactly 43 characters of secret. */
const CREDENTIAL_SHAPE = /^pd1\.[A-Za-z0-9_-]{43}$/;

export function mintPanicCredential(): string {
  return `${PANIC_CREDENTIAL_PREFIX}${randomBytes(SECRET_BYTES).toString('base64url')}`;
}

/** Shape check only — never an authorization decision. */
export function isPanicCredentialShape(value: unknown): value is string {
  return typeof value === 'string' && CREDENTIAL_SHAPE.test(value);
}

/** What the table stores: sha256 hex. A database dump never holds a live credential. */
export function hashPanicCredential(credential: string): string {
  return createHash('sha256').update(credential).digest('hex');
}

// ── Who may use it, now ────────────────────────────────────────────────────

export type PanicRefusal =
  /** No row for this credential (never issued, or purged). */
  | 'unknown'
  /** The row was turned off (admin, the phone itself, or an earlier ineligible use). */
  | 'revoked'
  /** The account is disabled, suspended, invited-but-not-set-up or removed. */
  | 'account-inactive'
  /** The account no longer holds emergency authority (role or flag). */
  | 'no-authority'
  /** The account now belongs to another organisation. */
  | 'tenant-changed'
  /** The organisation was archived. */
  | 'tenant-archived'
  /** VenueOS platform staff never hold a panic phone (see `enrollmentRefusal`). */
  | 'platform-staff';

export interface LiveUser {
  id: string;
  tenantId: string;
  role: string | null;
  status?: string | null;
  deletedAt?: Date | string | null;
  canTriggerPanic?: boolean | null;
}

export interface LiveTenant {
  id: string;
  archivedAt?: Date | string | null;
}

/**
 * Is this person, as the database says right now, still someone this phone
 * may send for? Any refusal here is permanent for the device: the caller
 * revokes the row, so re-enabling the account never silently brings an old
 * phone back — it takes a fresh sign-in on the phone.
 */
export function eligibilityRefusal(
  device: { tenantId: string },
  user: LiveUser | null,
  tenant: LiveTenant | null,
): Exclude<PanicRefusal, 'unknown' | 'revoked'> | null {
  if (!user || user.deletedAt) return 'account-inactive';
  if ((user.status ?? 'ACTIVE') !== 'ACTIVE') return 'account-inactive';
  if (user.role === 'SUPER_ADMIN') return 'platform-staff';
  if (user.tenantId !== device.tenantId) return 'tenant-changed';
  if (!tenant || tenant.archivedAt) return 'tenant-archived';
  if (!hasPanicAuthority(user)) return 'no-authority';
  return null;
}

export type EnrollmentRefusal =
  | Exclude<PanicRefusal, 'unknown' | 'revoked' | 'tenant-changed'>
  /** The session is a switched workspace — its tenant is not the person's own. */
  | 'switched-workspace'
  /** The person last entered their credentials too long ago (see ENROLL_FRESH_LOGIN_SEC). */
  | 'stale-login'
  /** The account owes a second factor under SEC-008 (mfa-policy.ts). */
  | 'mfa-required'
  /** Too many phones already ready for this person. */
  | 'too-many-devices';

/**
 * Minting a credential that does not expire is a credential CREATION, so it
 * asks for a recent sign-in — not merely a live session. A session restored
 * from a 30-day remembered cookie, or a tab left open on a shared computer,
 * cannot be turned into a forever credential without the password (and the
 * second factor, where the account has one) entered in the last 15 minutes.
 * `origIat` is the token's own record of that moment (auth.service.ts).
 */
export const ENROLL_FRESH_LOGIN_SEC = 15 * 60;

/** A person keeps at most this many phones ready at once. */
export const MAX_ACTIVE_DEVICES_PER_USER = 5;

export function enrollmentRefusal(input: {
  user: LiveUser | null;
  tenant: LiveTenant | null;
  /** The tenant the presented session is scoped to (`req.user.tenantId`). */
  sessionTenantId: string | null | undefined;
  /** The session token's `origIat` (falls back to `iat`), epoch seconds. */
  credentialCheckedAtSec: number | null | undefined;
  nowSec: number;
  mfaBlocking: boolean;
  activeDeviceCount: number;
}): EnrollmentRefusal | null {
  const { user, tenant } = input;
  if (!user || user.deletedAt || (user.status ?? 'ACTIVE') !== 'ACTIVE') return 'account-inactive';
  // VenueOS staff reach customers only under a support grant, case by case;
  // a credential that never expires is the opposite of that. Owners who want
  // to try it use an account in an internal test organisation.
  if (user.role === 'SUPER_ADMIN') return 'platform-staff';
  if (!input.sessionTenantId || input.sessionTenantId !== user.tenantId) return 'switched-workspace';
  if (!tenant || tenant.archivedAt) return 'tenant-archived';
  if (!hasPanicAuthority(user)) return 'no-authority';
  if (input.mfaBlocking) return 'mfa-required';
  const checkedAt = input.credentialCheckedAtSec;
  if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt)) return 'stale-login';
  if (input.nowSec - checkedAt > ENROLL_FRESH_LOGIN_SEC) return 'stale-login';
  if (input.activeDeviceCount >= MAX_ACTIVE_DEVICES_PER_USER) return 'too-many-devices';
  return null;
}

// ── The kill switch ────────────────────────────────────────────────────────

/**
 * `PANIC_DEVICE_DISABLED` — SUBTRACTIVE. Unset (or any value but the three
 * below) = the feature is available. Set = every panic credential is
 * refused and enrolment is refused; the credentials are KEPT (not revoked),
 * so unsetting it brings every phone back; the panic page falls back to the
 * remembered session and then sign-in. Read on every request, so it takes
 * effect without a restart where the platform reloads the environment.
 */
export function panicDevicesDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = String(env.PANIC_DEVICE_DISABLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

// ── What the person and their admin see ────────────────────────────────────

/**
 * "iPhone · Safari" — from the enrolling user agent. Never the raw string
 * (it is long, and it is a fingerprint), and never more than 60 characters.
 */
export function deviceLabelFromUserAgent(ua: string | null | undefined): string {
  const s = String(ua ?? '');
  const device = /iPhone/.test(s)
    ? 'iPhone'
    : /iPad/.test(s)
      ? 'iPad'
      : /Android/.test(s)
        ? /Mobile/.test(s) ? 'Android phone' : 'Android tablet'
        : /Macintosh|Mac OS X/.test(s)
          ? 'Mac'
          : /Windows/.test(s)
            ? 'Windows PC'
            : /CrOS/.test(s)
              ? 'Chromebook'
              : /Linux/.test(s)
                ? 'Linux'
                : 'Device';
  const browser = /EdgA?\//.test(s)
    ? 'Edge'
    : /SamsungBrowser\//.test(s)
      ? 'Samsung Internet'
      : /(CriOS|Chrome)\//.test(s)
        ? 'Chrome'
        : /(FxiOS|Firefox)\//.test(s)
          ? 'Firefox'
          : /Safari\//.test(s)
            ? 'Safari'
            : null;
  return (browser ? `${device} · ${browser}` : device).slice(0, 60);
}

// ── The trigger's own audit row ────────────────────────────────────────────

/**
 * Extra fields for the emergency controller's TRIGGER_EMERGENCY /
 * TRIGGER_EMERGENCY_DRILL rows when the alert was sent with a panic phone —
 * which phone, and the address the web origin saw. Empty for every other
 * caller, so a session-sent row is byte-for-byte what it was.
 */
export function panicDeviceAuditFields(
  user: unknown,
): { via: 'panic-device'; panicDeviceId: string; panicDeviceIp: string | null } | Record<string, never> {
  const u = user as { kind?: unknown; panicDeviceId?: unknown; panicDeviceIp?: unknown } | null | undefined;
  if (!u || u.kind !== 'panic-device' || typeof u.panicDeviceId !== 'string') return {};
  return {
    via: 'panic-device',
    panicDeviceId: u.panicDeviceId,
    panicDeviceIp: typeof u.panicDeviceIp === 'string' ? u.panicDeviceIp : null,
  };
}

// ── Rate limits (per minute) ───────────────────────────────────────────────

/**
 * Two keys per request, both must pass:
 *
 *   per DEVICE — the credential's own row id, after it authenticated. A phone
 *   polls `active` every 5 s while the page is open (12/min) and opens
 *   `status` once per launch; a looping or stolen phone is bounded here.
 *
 *   per CLIENT ADDRESS — the phone's real address as the web origin saw it
 *   (forwarded by the BFF, trusted only behind SESSION_BFF_SECRET). Sized for
 *   a SCHOOL behind one NAT address during an incident, when every teacher's
 *   panic page is open at once: it bounds a flood of junk credentials from
 *   one address without ever being reachable by a building's real use.
 *
 * Never keyed on the address the API itself sees: every request arrives from
 * the web origin's servers, so that key would be ONE bucket for every school —
 * one abuser could spend it and silence every panic phone in the fleet. That
 * is why the controller skips the global per-IP throttle.
 */
export const PANIC_RATE_LIMITS = {
  status: { device: 30, client: 600 },
  active: { device: 30, client: 1200 },
  targets: { device: 20, client: 600 },
  trigger: { device: 10, client: 120 },
  revoke: { device: 10, client: 120 },
  enroll: { user: 10, client: 60 },
} as const;
export type PanicRoute = keyof typeof PANIC_RATE_LIMITS;
