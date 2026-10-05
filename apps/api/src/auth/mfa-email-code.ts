/**
 * THE EMAILED SIGN-IN CODE — the pure half (2026-10-05).
 *
 * Owner (SUPER_ADMIN), after his only passkey — made on his Mac — could not be
 * used on his iPhone: iOS showed its cross-device QR code, which is for
 * signing in on a COMPUTER by scanning with a phone, so on the phone it was a
 * dead end. *"I should be able to add the passkey right from the mobile
 * device, the idea is to make this workflow super user friendly."*
 *
 * So the second step gains one more way through on THIS device: a 6-digit code
 * mailed to the account. Then the post-sign-in offer adds a passkey for this
 * device, and next time it is one tap. The controller is
 * `mfa-email-code.controller.ts`; everything here is a plain decision or a
 * plain transform, so it is covered by table tests.
 *
 * ── WHAT THE CODE IS, AND WHAT IT IS NOT ──────────────────────────────────
 *   • A SECOND step only. A code can be requested only by presenting the
 *     partial `mfaToken` that `/auth/login` mints AFTER a correct password
 *     (and only for an account that holds a second factor — TOTP or a
 *     passkey). It is never a password replacement and never a way around
 *     forced enrollment.
 *   • 10 minutes, single use, at most 5 attempts — and the newest code is the
 *     only live one (sending a new code expires the older ones).
 *   • Nothing usable is stored. The page holds an opaque 32-byte handle; the
 *     row keeps its SHA-256. The code is kept as an HMAC keyed by a server
 *     secret, so a database read yields neither the handle nor a guessable
 *     hash (a bare SHA-256 of six digits falls to a million guesses).
 *   • Every send, success and failure is in the AuditLog, and a success mails
 *     "New sign-in to your VenueOS account on <device>".
 *
 * ── THE ONE INTERLOCK ADDED BEYOND THE BRIEF ──────────────────────────────
 * A password RESET proves only that someone can read the mailbox. Without a
 * guard, "read the mailbox" would be enough for the WHOLE account: reset the
 * password by email, then pass the second step by email. So the emailed code
 * is not offered for {@link MFA_EMAIL_CODE_RESET_COOLDOWN_MS} after a
 * completed password reset — the passkey, the authenticator app or a backup
 * code still work. The person who really owns the account is not stuck: the
 * normal case (knows the password, passkey on another device) never touches
 * this, and the rare double failure has the same recovery as before.
 */

import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'crypto';

/** How long a code may be typed in. Also the row's `expiresAt`. */
export const MFA_EMAIL_CODE_TTL_MS = 10 * 60_000;

/** Wrong guesses a single code survives. The fifth miss kills it. */
export const MFA_EMAIL_CODE_MAX_ATTEMPTS = 5;

/** Per ACCOUNT: at most this many codes sent per window. */
export const MFA_EMAIL_CODE_SENDS_PER_ACCOUNT = 3;
export const MFA_EMAIL_CODE_ACCOUNT_WINDOW_MS = 15 * 60_000;

/** Per IP: at most this many codes sent per window (any accounts). */
export const MFA_EMAIL_CODE_SENDS_PER_IP = 10;
export const MFA_EMAIL_CODE_IP_WINDOW_MS = 60 * 60_000;

/** No emailed code for this long after a completed password reset. */
export const MFA_EMAIL_CODE_RESET_COOLDOWN_MS = 7 * 24 * 60 * 60_000;

const CODE_DIGITS = 6;
const CHALLENGE_BYTES = 32;
/** 32 bytes of base64url, unpadded, is exactly 43 characters. */
const CHALLENGE_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const HMAC_CONTEXT = 'venueos/mfa-email-code/v1';

/**
 * Can this deploy actually deliver a code?
 *
 * Production: only when outbound mail is configured (`RESEND_API_KEY`, the
 * same test as `EmailService.isConfigured()`). Without it the emailed code is
 * never offered and the page says to sign in on the device that has the
 * passkey — offering a code that can never arrive would be a new dead end.
 *
 * Outside production the email service's own zero-config stub "sends" by
 * writing the message to the API log, so a developer can read the code there.
 */
export function emailCodeDeliveryConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.RESEND_API_KEY) return true;
  return env.NODE_ENV !== 'production';
}

/**
 * Is the emailed code a way through for THIS account right now?
 *
 * `holdsFactor` — the account has a verified authenticator app or a passkey.
 * An account with neither is in forced enrollment (or needs no second step at
 * all), and a mailed code must never stand in for enrolling.
 */
export type EmailCodeEligibility =
  | 'ok'
  | 'email-not-configured'
  | 'no-factor'
  | 'recent-password-reset';

export function emailCodeEligibility(input: {
  deliveryConfigured: boolean;
  holdsFactor: boolean;
  lastPasswordResetAt: Date | null | undefined;
  now?: number;
}): EmailCodeEligibility {
  if (!input.deliveryConfigured) return 'email-not-configured';
  if (!input.holdsFactor) return 'no-factor';
  const resetAt = input.lastPasswordResetAt?.getTime?.();
  const now = input.now ?? Date.now();
  if (
    typeof resetAt === 'number' &&
    Number.isFinite(resetAt) &&
    now - resetAt < MFA_EMAIL_CODE_RESET_COOLDOWN_MS
  ) {
    return 'recent-password-reset';
  }
  return 'ok';
}

/**
 * When this account last COMPLETED a password reset (the interlock input), or
 * null. Throws on a database error — callers decide which way to fail.
 */
export async function lastPasswordResetAt(
  client: {
    passwordResetToken: {
      findFirst: (args: {
        where: { userId: string; usedAt: { not: null } };
        orderBy: { usedAt: 'desc' };
        select: { usedAt: true };
      }) => Promise<{ usedAt: Date | null } | null>;
    };
  },
  userId: string | null | undefined,
): Promise<Date | null> {
  if (typeof userId !== 'string' || !userId) return null;
  // ten-ok: identity SELF-lookup — userId is the principal of the verified partial mfaToken / the session being minted
  const row = await client.passwordResetToken.findFirst({
    where: { userId, usedAt: { not: null } },
    orderBy: { usedAt: 'desc' },
    select: { usedAt: true },
  });
  return row?.usedAt ?? null;
}

/** Six digits, uniformly random, leading zeros kept. */
export function generateEmailCode(): string {
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
}

/** The opaque handle the page holds between "send" and "verify". */
export function generateEmailCodeChallenge(): string {
  return randomBytes(CHALLENGE_BYTES).toString('base64url');
}

/** Exactly the shape we mint — anything else never reaches the database. */
export function isEmailCodeChallengeShape(value: unknown): value is string {
  return typeof value === 'string' && CHALLENGE_SHAPE.test(value);
}

/** What the row stores for a handle. */
export function hashEmailCodeChallenge(challenge: string): string {
  return createHash('sha256').update(challenge).digest('hex');
}

/**
 * What the row stores for a code: HMAC-SHA256 under a key DERIVED from the
 * server secret (domain-separated, so this MAC can never collide with any
 * other use of that secret), over the row's challenge hash plus the code. The
 * challenge hash binds a code to its own row.
 */
export function hashEmailCode(
  serverSecret: string,
  challengeHash: string,
  code: string,
): string {
  const key = createHmac('sha256', serverSecret).update(HMAC_CONTEXT).digest();
  return createHmac('sha256', key)
    .update(`${challengeHash}:${code}`)
    .digest('hex');
}

/** Constant-time comparison of two hex MACs. */
export function emailCodeHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * What the person typed → six digits, or null. Spaces and dashes are
 * forgiven ("123 456", "123-456" — mail clients and people both do that);
 * anything else is not a code.
 */
export function normalizeEmailCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(cleaned) ? cleaned : null;
}

/** sha256 of the client IP — the per-IP limit without keeping the address. */
export function hashClientIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`venueos-ip:${ip}`).digest('hex');
}

/**
 * A plain device name for "New sign-in … on <device>", from the User-Agent.
 *
 * Same order as the web's `guessDeviceLabel` (an iPhone's UA contains "like
 * Mac OS X", so the Apple mobile checks come first). It names the KIND of
 * device and nothing more — the UA itself never goes into the mail.
 */
export function deviceNameFromUserAgent(ua: string | null | undefined): string {
  const s = ua || '';
  if (/iPhone/i.test(s)) return 'an iPhone';
  if (/iPad/i.test(s)) return 'an iPad';
  if (/Android/i.test(s)) return 'an Android phone';
  if (/Macintosh|Mac OS X/i.test(s)) return 'a Mac';
  if (/Windows/i.test(s)) return 'a Windows PC';
  if (/CrOS/i.test(s)) return 'a Chromebook';
  if (/Linux/i.test(s)) return 'a Linux computer';
  return 'a web browser';
}
