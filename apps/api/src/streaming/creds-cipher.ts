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
 */
import * as crypto from 'crypto';

const KEY_LEN = 32;            // AES-256
const IV_LEN = 12;             // GCM standard
const TAG_LEN = 16;

function getMasterKey(): Buffer {
  const hex = process.env.DEVICE_SECRET_KEY || '';
  if (!hex || hex.length < 64) {
    // 64 hex chars = 32 bytes = AES-256. Anything shorter = unsafe.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DEVICE_SECRET_KEY missing or too short for streaming credential encryption (need 64 hex chars).');
    }
    // Dev fallback — pad with zeros so unit tests don't crash. Never
    // reach this in any prod path.
    return Buffer.from((hex + '0'.repeat(64)).slice(0, 64), 'hex');
  }
  return Buffer.from(hex.slice(0, 64), 'hex');
}

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

export interface SealedCredentials {
  encryptedCreds: string;    // base64
  encryptedDataKey: string;  // base64
}

export function sealCredentials(plain: Record<string, unknown>): SealedCredentials {
  const master = getMasterKey();
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
  const master = getMasterKey();
  const wrappedDataKey = Buffer.from(sealed.encryptedDataKey, 'base64');
  const dataKey = decryptWithKey(master, wrappedDataKey);
  const wrappedCreds = Buffer.from(sealed.encryptedCreds, 'base64');
  const json = decryptWithKey(dataKey, wrappedCreds);
  try {
    return JSON.parse(json.toString('utf8'));
  } catch {
    return {};
  }
}
