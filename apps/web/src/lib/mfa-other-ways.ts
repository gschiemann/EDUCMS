/**
 * "SIGN IN ANOTHER WAY ON THIS DEVICE" — the pure half (2026-10-05).
 *
 * Owner (SUPER_ADMIN): his only passkey was made on his Mac. On his iPhone the
 * second sign-in step asked for it, iOS could not find it there and showed its
 * cross-device QR code — which is for signing in on a COMPUTER by scanning
 * with a phone, so on the phone it is useless. Nothing on the page said what
 * else would work. *"I should be able to add the passkey right from the
 * mobile device, the idea is to make this workflow super user friendly."*
 *
 * The second step now always has "Use another way", and the moment the passkey
 * sheet closes without a credential it opens by itself under "Your passkey may
 * be on another device. Sign in another way on this one:". What is in that
 * list — decided HERE, from what the API said about this account — is:
 *
 *   'totp'   — the account has an authenticator app (`mfaMethods`);
 *   'backup' — the account has unused backup codes (`mfaFallbacks`);
 *   'email'  — a 6-digit code can be mailed to the account (`mfaFallbacks`;
 *              the API leaves it out when mail is not configured, and for a
 *              few days after a password reset).
 *
 * An API from before 2026-10-05 sends no `mfaFallbacks` at all. The only safe
 * reading of that is what already shipped: a backup code is always offered,
 * and no emailed code (an old API has no route for one).
 */

export type OtherWay = 'totp' | 'backup' | 'email';

/** `mfaFallbacks` off a login response: a clean list, or `null` = "not said". */
export function readMfaFallbacks(data: unknown): string[] | null {
  const raw = (data as { mfaFallbacks?: unknown } | null | undefined)?.mfaFallbacks;
  if (!Array.isArray(raw)) return null;
  return raw.filter((v): v is string => v === 'backup' || v === 'email');
}

/** The other ways through this second step, in the order they are offered. */
export function otherWaysFor(
  methods: readonly string[],
  fallbacks: readonly string[] | null,
): OtherWay[] {
  const out: OtherWay[] = [];
  if (methods.includes('totp')) out.push('totp');
  if (fallbacks === null || fallbacks.includes('backup')) out.push('backup');
  if (fallbacks !== null && fallbacks.includes('email')) out.push('email');
  return out;
}

/** The `auth.*` key for a refused SEND of an emailed code. */
export function emailCodeSendErrorKey(status: number, code: unknown): string {
  if (code === 'MFA_EMAIL_CODE_AFTER_RESET') return 'emailCodeAfterReset';
  if (code === 'MFA_EMAIL_CODE_UNAVAILABLE') return 'emailCodeUnavailable';
  if (code === 'MFA_EMAIL_CODE_TOO_MANY' || status === 429) return 'emailCodeTooMany';
  return 'emailCodeSendFailed';
}

/**
 * The `auth.*` key (and its values) for a refused VERIFY. The server's
 * `message` is English; the page always speaks the catalog.
 */
export function emailCodeVerifyError(
  status: number,
  body: { code?: unknown; attemptsLeft?: unknown } | null | undefined,
): { key: string; values?: Record<string, number> } {
  switch (body?.code) {
    case 'MFA_EMAIL_CODE_INVALID': {
      const left = typeof body.attemptsLeft === 'number' && body.attemptsLeft >= 0 ? body.attemptsLeft : null;
      return left === null ? { key: 'mfaCodeMismatch' } : { key: 'emailCodeWrong', values: { count: left } };
    }
    case 'MFA_EMAIL_CODE_EXPIRED':
      return { key: 'emailCodeExpired' };
    case 'MFA_EMAIL_CODE_LOCKED':
      return { key: 'emailCodeLocked' };
    case 'MFA_EMAIL_CODE_FORMAT':
      return { key: 'emailCodeEnter' };
    default:
      break;
  }
  if (status === 429) return { key: 'passkeyTooMany' };
  return { key: 'mfaCodeMismatch' };
}
