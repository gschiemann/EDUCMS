/**
 * Screen PIN for an ON-DEVICE unpair (2026-11-09, player stability gap 6).
 *
 * THE THREAT. Somebody standing at a screen with a USB keyboard opens the
 * player's on-screen menu and chooses "Unpair". The player's unpair is
 * SERVER-FIRST (`apps/web/src/app/player/page.tsx`, `handleUnpair` →
 * `POST /api/v1/screens/unpair/:fp`, then the native unpair), and that server
 * call clears the screen's tenant, deletes its schedules and rotates its
 * credential: the screen is off the emergency alert channel.
 *
 * THE FIX, AT THE RIGHT LAYER. A tenant may set an optional 4-8 digit PIN.
 * When one is set, the DEVICE-initiated unpair route refuses unless the
 * request carries it; the server verifies it against a slow salted hash and
 * rate-limits wrong guesses per screen. The native `OperatorPinGate.kt` stays
 * detached on purpose: it sat behind the server call (it stopped nothing) and
 * failed closed with no way to set a PIN (it bricked "Exit to device home").
 *
 * WHAT IS NEVER GATED:
 *   - the dashboard's own unpair / remove (`DELETE /screens/:id`, an
 *     authenticated admin) — the recovery path when a PIN is forgotten;
 *   - server-driven flows: TENANT_CHANGED, a re-pair, a credential revoke;
 *   - "Exit to device home" on the player (see the report: without device
 *     owner the hardware Home key leaves the app anyway, so gating it adds no
 *     security and could strand a technician on an offline screen).
 *
 * SUBTRACTIVE. No row in `tenant_screen_pins` = no PIN = today's behaviour on
 * every path, byte for byte (the manifest key is ABSENT, the route answers as
 * before). Clearing the PIN in the dashboard is the kill switch.
 *
 * NEVER returned, logged or audited: the PIN or its hash.
 */
import * as argon2 from 'argon2';
import { HttpException, HttpStatus } from '@nestjs/common';
import { cryptoPlatformConfig } from '../auth/crypto.config';
import { verifyReauthPassword } from '../auth/password-reauth';

export const SCREEN_PIN_MIN_DIGITS = 4;
export const SCREEN_PIN_MAX_DIGITS = 8;

/** Codes the player tells apart (`apps/web/src/app/player/unpairPin.ts` mirrors them). */
export const SCREEN_UNPAIR_PIN_REQUIRED = 'SCREEN_UNPAIR_PIN_REQUIRED';
export const SCREEN_UNPAIR_PIN_WRONG = 'SCREEN_UNPAIR_PIN_WRONG';
export const SCREEN_UNPAIR_PIN_LOCKED = 'SCREEN_UNPAIR_PIN_LOCKED';

/** The PIN as typed, or null when it is not 4-8 ASCII digits. Nothing is trimmed into validity except surrounding whitespace. */
export function normalizeScreenPin(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const pin = input.trim();
  const re = new RegExp(`^[0-9]{${SCREEN_PIN_MIN_DIGITS},${SCREEN_PIN_MAX_DIGITS}}$`);
  return re.test(pin) ? pin : null;
}

/** Argon2id with the ONE platform parameter set (`cryptoPlatformConfig`), salted per hash. */
export function hashScreenPin(pin: string): Promise<string> {
  return argon2.hash(pin, {
    type: cryptoPlatformConfig.type,
    memoryCost: cryptoPlatformConfig.memoryCost,
    timeCost: cryptoPlatformConfig.timeCost,
    parallelism: cryptoPlatformConfig.parallelism,
  });
}

/** Fails CLOSED (absent / malformed hash, argon2 throwing → false). Same verifier as the password step-up. */
export function verifyScreenPin(hash: string | null | undefined, candidate: string): Promise<boolean> {
  return verifyReauthPassword(hash, candidate);
}

// ── Per-screen attempt limiter ────────────────────────────────────────────
//
// Wrong guesses per SCREEN (not per IP: the attacker is at one screen and the
// route already has a 5/min per-caller @Throttle). Five wrong guesses start a
// lock; each consecutive lock doubles, from 15 minutes to a 24-hour cap, and a
// correct PIN resets it. A correct PIN DURING a lock is refused too (that is
// the point). Roughly 35 guesses the first day and ~5 a day after it, against
// 10,000 four-digit PINs.
//
// IN PROCESS, deliberately. The API is one replica (leader-leased workers),
// and memory cannot fail open the way a Redis-down path would. A restart or a
// deploy forgets the counters — at most five fresh guesses per deploy — which
// the report records as a known limit. Bounded: idle entries are dropped and
// the map never holds more than MAX_ENTRIES screens.

export const SCREEN_PIN_ATTEMPTS_PER_LOCK = 5;
export const SCREEN_PIN_FIRST_LOCK_MS = 15 * 60_000;
export const SCREEN_PIN_MAX_LOCK_MS = 24 * 60 * 60_000;
/** At most one "refused" audit row per screen per this window (lock starts always audit). */
export const SCREEN_PIN_AUDIT_WINDOW_MS = 15 * 60_000;
const IDLE_FORGET_MS = 48 * 60 * 60_000;
const MAX_ENTRIES = 10_000;

interface AttemptState {
  failures: number;
  locks: number;
  lockedUntil: number;
  lastAuditAt: number;
  touchedAt: number;
}

export type PinAttemptVerdict =
  | { readonly kind: 'allowed'; readonly attemptsLeft: number }
  | { readonly kind: 'locked'; readonly retryAfterMs: number };

export class ScreenPinAttemptLimiter {
  private readonly entries = new Map<string, AttemptState>();
  constructor(private readonly now: () => number = Date.now) {}

  private get(screenId: string): AttemptState {
    const t = this.now();
    let s = this.entries.get(screenId);
    if (s && t - s.touchedAt > IDLE_FORGET_MS && s.lockedUntil <= t) {
      this.entries.delete(screenId);
      s = undefined;
    }
    if (!s) {
      if (this.entries.size >= MAX_ENTRIES) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
      s = { failures: 0, locks: 0, lockedUntil: 0, lastAuditAt: 0, touchedAt: t };
      this.entries.set(screenId, s);
    }
    return s;
  }

  /** Before verifying anything: is this screen locked out? */
  check(screenId: string): PinAttemptVerdict {
    const s = this.entries.get(screenId);
    const t = this.now();
    if (s && s.lockedUntil > t) return { kind: 'locked', retryAfterMs: s.lockedUntil - t };
    return { kind: 'allowed', attemptsLeft: SCREEN_PIN_ATTEMPTS_PER_LOCK - (s?.failures ?? 0) };
  }

  /** One wrong PIN. Returns whether this failure started a lock, and how long. */
  recordFailure(screenId: string): { locked: boolean; lockMs: number; attemptsLeft: number } {
    const s = this.get(screenId);
    s.touchedAt = this.now();
    s.failures += 1;
    if (s.failures >= SCREEN_PIN_ATTEMPTS_PER_LOCK) {
      const lockMs = Math.min(SCREEN_PIN_MAX_LOCK_MS, SCREEN_PIN_FIRST_LOCK_MS * 2 ** s.locks);
      s.locks += 1;
      s.failures = 0;
      s.lockedUntil = this.now() + lockMs;
      return { locked: true, lockMs, attemptsLeft: 0 };
    }
    return { locked: false, lockMs: 0, attemptsLeft: SCREEN_PIN_ATTEMPTS_PER_LOCK - s.failures };
  }

  recordSuccess(screenId: string): void {
    this.entries.delete(screenId);
  }

  /** Rate-limits the "refused" audit row so the append-only table cannot be flooded. */
  shouldAuditRefusal(screenId: string): boolean {
    const s = this.get(screenId);
    const t = this.now();
    if (t - s.lastAuditAt < SCREEN_PIN_AUDIT_WINDOW_MS) return false;
    s.lastAuditAt = t;
    return true;
  }

  /** Test seam. */
  reset(): void {
    this.entries.clear();
  }
}

/** The process-wide limiter the unpair route uses. */
export const screenPinAttempts = new ScreenPinAttemptLimiter();

export function pinRequiredRefusal(): HttpException {
  return new HttpException(
    { code: SCREEN_UNPAIR_PIN_REQUIRED, message: 'This screen needs its PIN to be unpaired here. An admin can unpair it from the dashboard.' },
    HttpStatus.FORBIDDEN,
  );
}

export function pinWrongRefusal(attemptsLeft: number): HttpException {
  return new HttpException(
    { code: SCREEN_UNPAIR_PIN_WRONG, message: 'Wrong PIN.', attemptsLeft: Math.max(0, attemptsLeft) },
    HttpStatus.FORBIDDEN,
  );
}

export function pinLockedRefusal(retryAfterMs: number): HttpException {
  return new HttpException(
    {
      code: SCREEN_UNPAIR_PIN_LOCKED,
      message: 'Too many wrong PINs. Try again later, or unpair this screen from the dashboard.',
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/** The manifest's static flag. Key ABSENT when no PIN, so an unset tenant's payload (and ETag) is unchanged. */
export function manifestUnpairPin(tenant: { screenPinSetAt?: Date | string | null } | null | undefined): { unpairPinRequired?: true } {
  return tenant?.screenPinSetAt ? { unpairPinRequired: true } : {};
}

interface PinPrisma {
  client: {
    tenantScreenPin: { findUnique(args: any): Promise<{ pinHash: string } | null> };
    auditLog: { create(args: any): Promise<unknown> };
  };
}

/**
 * The PIN gate on the device-initiated unpair. Call it AFTER device auth and
 * BEFORE any write. Resolves when the unpair may proceed; throws the refusal
 * otherwise. A screen with no tenant, or whose tenant has no PIN, passes
 * without a single extra branch taken beyond one indexed read.
 */
export async function enforceDeviceUnpairPin(
  prisma: PinPrisma,
  screen: { id: string; tenantId: string | null },
  presented: unknown,
  meta: { ip?: string | null },
  limiter: ScreenPinAttemptLimiter = screenPinAttempts,
): Promise<void> {
  if (!screen.tenantId) return;
  const row = await prisma.client.tenantScreenPin.findUnique({
    // ten-ok: keyed by the screen's own tenant (the authenticated device's row).
    where: { tenantId: screen.tenantId },
    select: { pinHash: true },
  });
  if (!row) return;

  const audit = (action: string, details: Record<string, unknown>) =>
    prisma.client.auditLog
      .create({
        data: {
          tenantId: screen.tenantId,
          userId: null,
          action,
          targetType: 'Screen',
          targetId: screen.id,
          details: JSON.stringify({ ...details, ip: meta.ip ?? null }),
        },
      })
      .catch(() => { /* an audit hiccup never turns a refusal into an unpair */ });

  const gate = limiter.check(screen.id);
  if (gate.kind === 'locked') {
    if (limiter.shouldAuditRefusal(screen.id)) await audit('SCREEN_UNPAIR_PIN_REFUSED', { reason: 'locked' });
    throw pinLockedRefusal(gate.retryAfterMs);
  }

  const pin = normalizeScreenPin(presented);
  if (presented === undefined || presented === null || presented === '') {
    if (limiter.shouldAuditRefusal(screen.id)) await audit('SCREEN_UNPAIR_PIN_REFUSED', { reason: 'missing' });
    throw pinRequiredRefusal();
  }
  if (pin && (await verifyScreenPin(row.pinHash, pin))) {
    limiter.recordSuccess(screen.id);
    return;
  }
  const failure = limiter.recordFailure(screen.id);
  if (failure.locked) {
    await audit('SCREEN_UNPAIR_PIN_LOCKED', { lockMinutes: Math.round(failure.lockMs / 60_000) });
    throw pinLockedRefusal(failure.lockMs);
  }
  if (limiter.shouldAuditRefusal(screen.id)) await audit('SCREEN_UNPAIR_PIN_REFUSED', { reason: 'wrong' });
  throw pinWrongRefusal(failure.attemptsLeft);
}
