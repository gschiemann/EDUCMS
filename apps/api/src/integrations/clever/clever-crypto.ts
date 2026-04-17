/**
 * Symmetric encryption for Clever access tokens stored in Postgres.
 *
 * Uses AES-256-GCM with a key derived from CLEVER_ENCRYPTION_KEY (hex or utf8).
 * The key must be at least 32 bytes after decoding; if shorter, it is expanded
 * via SHA-256 so env footguns don't crash production.
 *
 * Ciphertext format: base64( iv(12) || authTag(16) || encrypted )
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALG = 'aes-256-gcm';

function deriveKey(): Buffer {
  const raw = process.env.CLEVER_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('CLEVER_ENCRYPTION_KEY not configured');
  }
  // Try hex first (preferred: 64 hex chars = 32 bytes), fall back to utf8 + SHA-256.
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === 64) {
    return Buffer.from(raw, 'hex');
  }
  return createHash('sha256').update(raw, 'utf8').digest();
}

export function encryptToken(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptToken(payload: string): string {
  const key = deriveKey();
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}
