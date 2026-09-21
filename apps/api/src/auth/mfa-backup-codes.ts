/**
 * THE ONE PLACE BACKUP CODES ARE MINTED AND STORED.
 *
 * Extracted (2026-09-21) from `mfa.controller.ts`, which had the same nine
 * lines written out four times. That was survivable while TOTP enrollment was
 * the only issuer; passkeys add a fifth caller — a user whose FIRST second
 * factor is a passkey has never been through TOTP enrollment and therefore
 * has no recovery codes at all, which turns a lost phone into a lockout.
 *
 * A second copy of this shape is how the format drifts: `mfa/challenge`
 * verifies a presented code against `{ hash }` entries with the platform
 * Argon2id parameters, and an issuer that used different parameters, a
 * different key name, or a different code alphabet would mint codes that
 * silently never verify. So there is exactly one issuer, here.
 *
 * What is NOT here: consumption. `MfaController.challenge` owns that, because
 * consuming a code is a single-use write that has to be sequenced against the
 * rate limiter and the audit row.
 */

import * as argon2 from 'argon2';

import { cryptoPlatformConfig } from './crypto.config';
import { generateBackupCodes } from './totp';

/** How many codes an issue mints. Ten is the shipped number; do not change it
 *  without also changing the "save these 10 codes" copy on both clients. */
export const BACKUP_CODE_COUNT = 10;

/**
 * Re-export of `cryptoPlatformConfig` with `raw` pinned to the string branch.
 * argon2's TS types use a discriminated union on `raw`; the loosely-typed
 * Options bag fails overload resolution. This narrows to the "return string"
 * overload. Identical params (m=64MB / t=3 / p=4).
 */
const ARGON_HASH_OPTS = {
  type: cryptoPlatformConfig.type,
  memoryCost: cryptoPlatformConfig.memoryCost,
  timeCost: cryptoPlatformConfig.timeCost,
  parallelism: cryptoPlatformConfig.parallelism,
} as const;

/** One entry of the `User.mfaBackupCodes` JSON array. */
export interface StoredBackupCode {
  /** Argon2id hash of the plaintext code. The plaintext is never stored. */
  hash: string;
  createdAt: string;
}

export interface IssuedBackupCodes {
  /** SHOW ONCE. The only time these exist in plaintext anywhere. */
  plain: string[];
  /** Write this to `User.mfaBackupCodes`. */
  stored: StoredBackupCode[];
}

/**
 * Mint a fresh set. Every previously-issued code is invalidated by the caller
 * writing `stored` over the column wholesale — there is no merge, and there
 * must not be one: "regenerate" has always meant "the old ones stop working".
 */
export async function issueBackupCodes(
  count = BACKUP_CODE_COUNT,
): Promise<IssuedBackupCodes> {
  const plain = generateBackupCodes(count);
  const stored: StoredBackupCode[] = [];
  for (const code of plain) {
    stored.push({
      hash: await argon2.hash(code, ARGON_HASH_OPTS),
      createdAt: new Date().toISOString(),
    });
  }
  return { plain, stored };
}

/**
 * Does this account already hold usable recovery codes?
 *
 * Null, a non-array (a corrupted column), and an empty array all mean NO — a
 * user who has spent every code is exactly as locked out as one who never had
 * any, so the passkey path re-issues for both.
 */
export function hasBackupCodes(raw: unknown): boolean {
  return Array.isArray(raw) && raw.length > 0;
}
