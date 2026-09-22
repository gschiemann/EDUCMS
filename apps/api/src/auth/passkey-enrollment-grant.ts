/**
 * THE POST-SIGN-IN PASSKEY OFFER — ITS SINGLE-USE GRANT (2026-09-22).
 *
 * Operator (SUPER_ADMIN, authenticator app + backup codes, zero passkeys):
 * *"when i try to login with a passkey to my main account it says i dont have
 * one saved. shouldnt it walk me thru getting one?"*
 *
 * The walk-through is one screen shown right after a sign-in completes —
 * "Sign in faster next time · Set up passkey · Not now". Adding a passkey
 * normally re-asks for the account PASSWORD (`PasskeyController.
 * registerOptions`), because a registered passkey is a permanent, independent
 * way in and a session token alone must not be able to mint one. Asking for
 * the password again seconds after the user typed it is the friction this
 * removes: the sign-in itself leaves behind a grant that stands in for that
 * re-auth, ONCE.
 *
 * ── WHAT A GRANT IS ───────────────────────────────────────────────────────
 *   • 32 CSPRNG bytes, base64url. OPAQUE — not a JWT — so no JWT-verifying
 *     door (JwtAuthGuard, the partial-`mfaToken` doors) can take it for a
 *     credential, and nothing but `redeemPasskeyEnrollmentGrant` reads it.
 *   • Stored under `challengeKey('enroll-grant', `${userId}:${sha256(grant)}`)`.
 *     The raw value never sits in Redis, and the KEY is bound to the user: a
 *     different principal presenting it looks up a key that does not exist,
 *     so it can neither use nor burn the owner's grant.
 *   • TEN MINUTES, enforced by the store's own TTL and re-checked against the
 *     record's `issuedAt`.
 *   • SINGLE-USE, spent through the same atomic read-and-delete the WebAuthn
 *     challenges use (`redisTakeOnce` / the delete-first memory store), so
 *     two concurrent redemptions cannot both succeed.
 *
 * ── WHO CAN MINT ONE ──────────────────────────────────────────────────────
 * Exactly TWO call sites of `withPasskeyEnrollmentOffer`, pinned by
 * `passkey-enrollment-grant.spec.ts`:
 *   • `AuthController.login`    — the password proved out and NO second
 *                                  factor is owed (a full session came back);
 *   • `MfaController.challenge` — the password AND an authenticator code or
 *                                  backup code proved out.
 * Never a token refresh, never the durable-session refresh, never a tenant
 * switch, never a passkey sign-in (that account already holds one), never
 * forced enrollment, never signup / invite. A stolen session token therefore
 * cannot produce a grant — only a real sign-in can — and it is only minted
 * for an account with NO passkey that is not held behind the first-login
 * credential-setup gate.
 *
 * ── WHAT IT AUTHORIZES ────────────────────────────────────────────────────
 * ONE thing: `POST /auth/passkeys/register/options` for the SAME account,
 * presented together with a valid session for that account (the route is
 * JwtAuthGuard-protected; the grant key embeds the user id). That route is the
 * only reader of this namespace. A refused grant is 403, never 401 — apiFetch
 * signs the operator out on any 401. The ceremony it opens is the ordinary
 * `reg:` ceremony, verified exactly as the Settings flow verifies it.
 *
 * ── WHY THIS IS NOT A WEAKER DOOR THAN THE PASSWORD ───────────────────────
 * The grant is delivered in the same response, to the same page, that a
 * moment earlier held the password in a form field: anything able to read the
 * grant there could have read the password as it was typed. It cannot be
 * obtained from any later page. The web client keeps it in memory only (never
 * storage) and redeems it the moment it decides to show the offer, so its
 * useful life in the page is a single request, not ten minutes.
 */

import { createHash, randomBytes } from 'crypto';

import {
  challengeKey,
  isUsableChallengeRedis,
  MemoryOneShotStore,
  redisTakeOnce,
  type WebAuthnChallengeRedis,
} from './webauthn-challenge-store';

/** Ten minutes: long enough to answer one prompt, short enough to be nothing
 *  worth stealing. The web client redeems it within one request anyway. */
export const PASSKEY_ENROLLMENT_GRANT_TTL_MS = 10 * 60_000;

/** A mint that cannot reach the store in this long gives up — the offer is a
 *  convenience and must never slow a sign-in down. */
const MINT_TIMEOUT_MS = 1_500;

/** Clock slack for a record minted on one replica and redeemed on another. */
const CLOCK_SKEW_MS = 60_000;

const GRANT_BYTES = 32;
/** 32 bytes of base64url, unpadded, is exactly 43 characters. */
const GRANT_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const PURPOSE = 'passkey-enrollment';

/** What the login response carries when the offer is on. */
export interface PasskeyEnrollmentGrant {
  /** The opaque, single-use secret. Show nothing of it anywhere; send it once. */
  grant: string;
  /** ISO-8601. Informational — the store's TTL is the authority. */
  expiresAt: string;
}

interface GrantRecord {
  purpose: typeof PURPOSE;
  userId: string;
  issuedAt: number;
}

/** The memory backend for a Redis-less deploy. Same caveat as the challenge
 *  store's: single-use holds within the pod that minted it. */
const memoryGrants = new MemoryOneShotStore<GrantRecord>();

function grantKey(userId: string, grant: string): string {
  const digest = createHash('sha256').update(grant).digest('hex');
  return challengeKey('enroll-grant', `${userId}:${digest}`);
}

function parseGrantRecord(raw: string | null): GrantRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GrantRecord>;
    if (
      !parsed ||
      parsed.purpose !== PURPOSE ||
      typeof parsed.userId !== 'string' ||
      !parsed.userId ||
      typeof parsed.issuedAt !== 'number'
    ) {
      return null;
    }
    return {
      purpose: PURPOSE,
      userId: parsed.userId,
      issuedAt: parsed.issuedAt,
    };
  } catch {
    return null;
  }
}

/** Resolve (or reject) within `ms`, and never leave the timer running. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('enrollment grant store timed out')),
      ms,
    );
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * The Redis handle every caller hands this module: the same `publisher` the
 * challenge store is given (`PasskeyController.challengeRedis`), or `null`
 * when this deploy has no Redis.
 */
export function grantRedisFrom(
  redisService: { publisher?: unknown } | null | undefined,
): WebAuthnChallengeRedis | null {
  return (
    (redisService?.publisher as WebAuthnChallengeRedis | undefined) ?? null
  );
}

/**
 * Mint a grant for `userId`. `null` when it could not be stored — the caller
 * then simply makes no offer. Never throws: this rides the sign-in hot path.
 */
export async function mintPasskeyEnrollmentGrant(
  redis: WebAuthnChallengeRedis | null | undefined,
  userId: string,
): Promise<PasskeyEnrollmentGrant | null> {
  if (typeof userId !== 'string' || !userId) return null;
  const grant = randomBytes(GRANT_BYTES).toString('base64url');
  const issuedAt = Date.now();
  const record: GrantRecord = { purpose: PURPOSE, userId, issuedAt };
  const key = grantKey(userId, grant);
  try {
    if (isUsableChallengeRedis(redis)) {
      await withTimeout(
        redis.set(
          key,
          JSON.stringify(record),
          'PX',
          PASSKEY_ENROLLMENT_GRANT_TTL_MS,
        ),
        MINT_TIMEOUT_MS,
      );
    } else {
      await memoryGrants.put(key, record, PASSKEY_ENROLLMENT_GRANT_TTL_MS);
    }
  } catch {
    return null;
  }
  return {
    grant,
    expiresAt: new Date(
      issuedAt + PASSKEY_ENROLLMENT_GRANT_TTL_MS,
    ).toISOString(),
  };
}

/**
 * Spend a grant. `true` exactly once, for the user it was minted for, inside
 * its ten minutes. Everything else — a foreign user, a second presentation, an
 * expired or malformed grant, a Redis error — is `false`, and the caller
 * refuses with one generic 403.
 *
 * The ONLY reader of the `enroll-grant` namespace; pinned to its one caller,
 * `PasskeyController.registerOptions`, by `passkey-enrollment-grant.spec.ts`.
 */
export async function redeemPasskeyEnrollmentGrant(
  redis: WebAuthnChallengeRedis | null | undefined,
  userId: string,
  grant: unknown,
): Promise<boolean> {
  if (typeof userId !== 'string' || !userId) return false;
  if (typeof grant !== 'string' || !GRANT_SHAPE.test(grant)) return false;
  const key = grantKey(userId, grant);

  let record: GrantRecord | null;
  try {
    record = isUsableChallengeRedis(redis)
      ? parseGrantRecord(await redisTakeOnce(redis, key))
      : await memoryGrants.take(key);
  } catch {
    return false;
  }
  if (!record) return false;
  // Belt and braces: the key already binds the user and the store already
  // enforces the TTL, but a record is only honoured when its own contents say
  // so too.
  if (record.purpose !== PURPOSE || record.userId !== userId) return false;
  const age = Date.now() - record.issuedAt;
  if (
    age < -CLOCK_SKEW_MS ||
    age > PASSKEY_ENROLLMENT_GRANT_TTL_MS + CLOCK_SKEW_MS
  ) {
    return false;
  }
  return true;
}

/**
 * Who a finished sign-in belongs to, as far as the offer needs to know — the
 * user ROW each mint site already loaded (`validateUser`'s result, or the
 * MFA challenge's select), passed as-is rather than re-spelled field by field.
 */
export interface PasskeyOfferSubject {
  id: string;
  /**
   * The first-login credential-setup gate. A session held behind it can reach
   * only the setup / logout / me routes (JwtAuthGuard answers 403
   * SETUP_REQUIRED everywhere else), and the setup screen owns what comes
   * next. Anything but a literal `false` means no offer.
   */
  mustSetupCredentials?: boolean | null;
  /**
   * `_count.passkeys` — passkeys the account holds RIGHT NOW. Anything but a
   * literal `0`, including "not loaded", means no offer: an offer made to an
   * account that already has a passkey is noise, and one made on a guess is
   * worse.
   */
  _count?: { passkeys?: number | null } | null;
}

/**
 * Attach the passkey offer to a FINISHED sign-in, or hand the response back
 * untouched.
 *
 * Called from exactly two places — see the header — and only ever adds one
 * field, `passkeyEnrollment`, additive to the login envelope: a client that
 * does not know it ignores it and behaves exactly as before.
 */
export async function withPasskeyEnrollmentOffer<T>(
  response: T,
  subject: PasskeyOfferSubject,
  redis: WebAuthnChallengeRedis | null | undefined,
): Promise<T | (T & { passkeyEnrollment: PasskeyEnrollmentGrant })> {
  const envelope = response as unknown as
    | { access_token?: unknown; mfaRequired?: unknown }
    | null
    | undefined;
  // A FULL session only. An `mfaRequired` envelope is a sign-in that has not
  // finished, and has no access token to go with the grant anyway.
  if (
    !envelope ||
    typeof envelope.access_token !== 'string' ||
    !envelope.access_token
  ) {
    return response;
  }
  if (envelope.mfaRequired) return response;
  if (!subject || typeof subject.id !== 'string' || !subject.id)
    return response;
  if (subject._count?.passkeys !== 0) return response;
  if (subject.mustSetupCredentials !== false) return response;

  const passkeyEnrollment = await mintPasskeyEnrollmentGrant(redis, subject.id);
  if (!passkeyEnrollment) return response;
  return { ...(response as object), passkeyEnrollment } as T & {
    passkeyEnrollment: PasskeyEnrollmentGrant;
  };
}

/** Test seam: forget every grant held by the memory backend. */
export function __resetPasskeyEnrollmentGrantsForTests(): void {
  memoryGrants.clear();
}
