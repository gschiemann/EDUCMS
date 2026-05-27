/**
 * MFA TOTP secret cipher — envelope encryption for stored TOTP secrets.
 *
 * Same shape as `ai/ai-key-cipher.ts`: a per-row 32-byte data key is
 * wrapped with the platform master key (DEVICE_SECRET_KEY) using
 * AES-256-GCM, and the TOTP secret bytes are wrapped with the data key.
 * One base64 string in, one base64 string out — fits the existing
 * `User.mfaTotpSecret String?` column with no schema change.
 *
 * Why a separate file from ai-key-cipher.ts:
 *   - Different domain (auth, not AI), so we don't pull the AI module
 *     into the auth module's dependency graph for a single helper.
 *   - The plaintext we wrap here is a TOTP secret (≤32 bytes
 *     base32-decoded) rather than an API key string; the format
 *     looks identical from the outside but the semantics + audit
 *     surface differ.
 *
 * The master key is DEVICE_SECRET_KEY — the same value the AI key
 * cipher and the streaming creds cipher use. The boot-time secret
 * check (`apps/api/src/security/required-secret.ts`) refuses to start
 * the API in production without it, so by the time this file is
 * called we are guaranteed to have 32 bytes of high-entropy material.
 */
import * as crypto from 'crypto';

const KEY_LEN = 32; // AES-256 data key
const IV_LEN = 12; // GCM standard
const TAG_LEN = 16;

function getMasterKey(): Buffer {
  const hex = process.env.DEVICE_SECRET_KEY || '';
  if (!hex || hex.length < 64) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'DEVICE_SECRET_KEY missing or too short for MFA secret encryption (need 64 hex chars).',
      );
    }
    return Buffer.from((hex + '0'.repeat(64)).slice(0, 64), 'hex');
  }
  return Buffer.from(hex.slice(0, 64), 'hex');
}

function encryptBytes(key: Buffer, plaintext: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

function decryptBytes(key: Buffer, blob: Buffer): Buffer {
  if (blob.length < IV_LEN + TAG_LEN) throw new Error('Encrypted blob too short.');
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/**
 * Envelope-encrypt a base32 TOTP secret. The base32 form is what the
 * QR code carries to the user's Authenticator app, and what we feed
 * back into `verifyTotpCode` — keeping the wire form means the
 * verifier doesn't need to know about base32 internals.
 */
export function sealMfaSecret(secretBase32: string): string {
  if (!secretBase32 || secretBase32.length < 8) {
    throw new Error('MFA secret too short to be valid.');
  }
  const master = getMasterKey();
  const dataKey = crypto.randomBytes(KEY_LEN);
  const wrappedDataKey = encryptBytes(master, dataKey);
  const wrappedSecret = encryptBytes(dataKey, Buffer.from(secretBase32, 'utf8'));
  return Buffer.concat([wrappedDataKey, wrappedSecret]).toString('base64');
}

/**
 * Reverse of sealMfaSecret. Throws if the blob is corrupted or the
 * master key has rotated (a deliberate operational decision — if
 * DEVICE_SECRET_KEY ever rotates, every MFA secret must be re-enrolled).
 */
export function openMfaSecret(sealed: string): string {
  const master = getMasterKey();
  const blob = Buffer.from(sealed, 'base64');
  const OUTER_LEN = IV_LEN + TAG_LEN + KEY_LEN;
  if (blob.length < OUTER_LEN + IV_LEN + TAG_LEN) {
    throw new Error('Sealed MFA secret too short / corrupted.');
  }
  const wrappedDataKey = blob.subarray(0, OUTER_LEN);
  const dataKey = decryptBytes(master, wrappedDataKey);
  const wrappedSecret = blob.subarray(OUTER_LEN);
  const plain = decryptBytes(dataKey, wrappedSecret);
  return plain.toString('utf8');
}
