/**
 * Streaming credential cipher.
 * ────────────────────────────
 *
 * Sprint 8c (2026-05-03). Per-row envelope encryption for streaming
 * provider credentials.
 *
 *   plaintext credentials JSON
 *      └─ encrypted with a per-row data key (AES-256-GCM)
 *           └─ data key wrapped with DEVICE_SECRET_KEY (AES-256-GCM)
 *
 * Why envelope encryption:
 *   • Rotation: re-wrap data keys without re-encrypting credential blobs.
 *   • Audit: each row's data key is unique, so a single leak doesn't
 *     compromise other tenants.
 *   • Compliance: matches the AWS KMS pattern auditors expect.
 *
 * Stored on StreamProviderConnection:
 *   - encryptedCreds   = base64(IV ‖ AES-GCM(dataKey, JSON))
 *   - encryptedDataKey = base64(IV ‖ AES-GCM(masterKey, dataKey))
 *
 * The master key is `process.env.DEVICE_SECRET_KEY` — already the
 * signing key for device tokens. Reusing it avoids forcing operators
 * to manage another secret. If we ever need true KMS rotation we'll
 * rewrite this file, not the call sites.
 *
 * 2026-10-22 — ROTATION WINDOW (`security/key-ring.ts`). The master key is
 * now a ring: `sealCredentials` always wraps with the PRIMARY; `openCredentials`
 * unwraps with the primary and, only when `DEVICE_SECRET_KEY_PREVIOUS` is set,
 * falls back to the previous key on an auth-tag failure. The stored FORMAT is
 * unchanged (no key id is embedded — try-then-fallback is the mechanism).
 * `rewrapDataKeyToPrimary` is the one-shot migration step: it re-wraps ONLY the
 * 60-byte data-key envelope, never touching `encryptedCreds`, so the job that
 * runs it never sees a plaintext credential.
 */
import * as crypto from 'crypto';
import { masterKeyCandidates, masterKeysFor } from '../security/key-ring';

const KEY_LEN = 32;            // AES-256
const IV_LEN = 12;             // GCM standard
const TAG_LEN = 16;

const MASTER_KEY_PURPOSE = 'streaming credential encryption';

function encryptWithKey(key: Buffer, plaintext: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: [IV (12)] [TAG (16)] [CT (variable)]
  return Buffer.concat([iv, tag, ct]);
}

function decryptWithKey(key: Buffer, blob: Buffer): Buffer {
  if (blob.length < IV_LEN + TAG_LEN) throw new Error('Encrypted blob too short.');
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/**
 * Unwrap a per-row data key with the ring: primary first, then previous.
 * The PRIMARY's error is rethrown when every key fails, so with no previous
 * configured the behaviour (and the error) is exactly the single-key one.
 */
function unwrapDataKey(wrappedDataKey: Buffer): { dataKey: Buffer; keyIndex: number } {
  const keys = masterKeyCandidates(masterKeysFor(MASTER_KEY_PURPOSE));
  let primaryError: unknown;
  for (let i = 0; i < keys.length; i++) {
    try {
      return { dataKey: decryptWithKey(keys[i], wrappedDataKey), keyIndex: i };
    } catch (e) {
      if (i === 0) primaryError = e;
    }
  }
  throw primaryError;
}

export interface SealedCredentials {
  encryptedCreds: string;    // base64
  encryptedDataKey: string;  // base64
}

export function sealCredentials(plain: Record<string, unknown>): SealedCredentials {
  const master = masterKeysFor(MASTER_KEY_PURPOSE).primary;
  const dataKey = crypto.randomBytes(KEY_LEN);
  const wrappedDataKey = encryptWithKey(master, dataKey);
  const json = Buffer.from(JSON.stringify(plain), 'utf8');
  const wrappedCreds = encryptWithKey(dataKey, json);
  return {
    encryptedCreds: wrappedCreds.toString('base64'),
    encryptedDataKey: wrappedDataKey.toString('base64'),
  };
}

export function openCredentials(sealed: SealedCredentials): Record<string, unknown> {
  const wrappedDataKey = Buffer.from(sealed.encryptedDataKey, 'base64');
  const { dataKey } = unwrapDataKey(wrappedDataKey);
  const wrappedCreds = Buffer.from(sealed.encryptedCreds, 'base64');
  const json = decryptWithKey(dataKey, wrappedCreds);
  try {
    return JSON.parse(json.toString('utf8'));
  } catch {
    return {};
  }
}

export type RewrapResult =
  /** Already wrapped with the primary — nothing to write. */
  | { status: 'current' }
  /** Was wrapped with the PREVIOUS key; here is the same data key wrapped with the primary. */
  | { status: 'rewrapped'; encryptedDataKey: string }
  /** Neither key opens it (corrupt, or wrapped under a key that is not in the ring). Left alone. */
  | { status: 'unreadable' };

/**
 * Move one row's data-key envelope onto the PRIMARY master key.
 *
 * Touches only `encryptedDataKey`: the data key is unwrapped (with whichever
 * ring key opens it) and re-wrapped with the primary under a fresh IV.
 * `encryptedCreds` — and therefore the credential plaintext — is never read.
 * Idempotent: a row already on the primary answers `current`.
 */
export function rewrapDataKeyToPrimary(encryptedDataKey: string): RewrapResult {
  const keys = masterKeysFor(MASTER_KEY_PURPOSE);
  let unwrapped: { dataKey: Buffer; keyIndex: number };
  try {
    unwrapped = unwrapDataKey(Buffer.from(encryptedDataKey, 'base64'));
  } catch {
    return { status: 'unreadable' };
  }
  if (unwrapped.keyIndex === 0) return { status: 'current' };
  return {
    status: 'rewrapped',
    encryptedDataKey: encryptWithKey(keys.primary, unwrapped.dataKey).toString('base64'),
  };
}
