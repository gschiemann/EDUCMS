import {
  MFA_EMAIL_CODE_MAX_ATTEMPTS,
  emailCodeHashesMatch,
  hashEmailCode,
} from './mfa-email-code';

/**
 * ONE ATOMIC ATTEMPT AT AN EMAILED 6-DIGIT CODE (2026-10-10 review fix).
 *
 * THE BUG. `consumeSetupEmailCode` read `attempts`, compared the code, and on a
 * miss incremented the counter in a SEPARATE write. N guesses fired in parallel
 * all read `attempts = 0`, all passed the `< 5` check, and all got compared —
 * so the 5-try cap held only for a client polite enough to guess one at a time.
 *
 * THE RULE, shared by every code that is proven against an `mfa_email_codes`
 * row keyed by a deterministic `challengeHash` (first-login setup, an admin
 * changing someone's email):
 *
 *   1. CLAIM an attempt with ONE conditional write —
 *      `updateMany where { id, usedAt: null, expiresAt > now, attempts < MAX }`
 *      — and require `count === 1`. Postgres serialises the row update, so at
 *      most MAX claims can ever succeed between them, however many race.
 *   2. Only a claimed attempt is compared. A correct code on the sixth try is
 *      refused, exactly as before.
 *   3. The code is NOT spent here. The caller spends it with `spendEmailCode`
 *      INSIDE the same transaction as the change it authorises, so "code
 *      spent, change not made" and "change made, code still live" are both
 *      impossible.
 *
 * Never throws for a bad code; it answers with a reason the caller maps to its
 * own error codes. A database error propagates (fail closed).
 */
export type EmailCodeCheck =
  | { ok: true; rowId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'locked' };

/** The slice of a Prisma client (or transaction) this needs. Narrow on purpose for testability. */
export interface EmailCodeStore {
  mfaEmailCode: {
    findUnique(args: any): Promise<any>;
    updateMany(args: any): Promise<{ count: number }>;
  };
}

export async function claimEmailCodeAttempt(
  store: EmailCodeStore,
  input: {
    challengeHash: string;
    /** The row must belong to this account. */
    userId: string;
    /** Already normalised to 6 digits by the caller. */
    code: string;
    secret: string;
    now?: Date;
  },
): Promise<EmailCodeCheck> {
  const now = input.now ?? new Date();
  // ten-ok: the challenge hash binds the verified principal's own id (or, for an
  // admin email change, the target the caller was just authorised to act on)
  const row = await store.mfaEmailCode.findUnique({ where: { challengeHash: input.challengeHash } });
  if (!row || row.userId !== input.userId || row.usedAt) return { ok: false, reason: 'invalid' };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  if (row.attempts >= MFA_EMAIL_CODE_MAX_ATTEMPTS) return { ok: false, reason: 'locked' };

  // ten-ok: the row was resolved a line above for this account
  const claimed = await store.mfaEmailCode.updateMany({
    where: {
      id: row.id,
      usedAt: null,
      expiresAt: { gt: now },
      attempts: { lt: MFA_EMAIL_CODE_MAX_ATTEMPTS },
    },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) {
    // Another request took the last attempt, spent the code, or it expired
    // in between. The cap is what we can be sure of only when the read
    // already put us at the edge; otherwise the code is simply no longer
    // usable.
    return {
      ok: false,
      reason: row.attempts + 1 >= MFA_EMAIL_CODE_MAX_ATTEMPTS ? 'locked' : 'invalid',
    };
  }

  const matches = emailCodeHashesMatch(
    hashEmailCode(input.secret, input.challengeHash, input.code),
    row.codeHash,
  );
  if (!matches) return { ok: false, reason: 'invalid' };
  return { ok: true, rowId: row.id };
}

/**
 * Spend a claimed, matching code. Call it inside the transaction that makes the
 * change; `false` means another request spent it first and the caller must
 * abort (throwing inside the transaction rolls the change back).
 */
export async function spendEmailCode(
  tx: { mfaEmailCode: { updateMany(args: any): Promise<{ count: number }> } },
  rowId: string,
  now: Date = new Date(),
): Promise<boolean> {
  // ten-ok: the row id came from claimEmailCodeAttempt for this account
  const spent = await tx.mfaEmailCode.updateMany({
    where: { id: rowId, usedAt: null },
    data: { usedAt: now },
  });
  return spent.count === 1;
}
