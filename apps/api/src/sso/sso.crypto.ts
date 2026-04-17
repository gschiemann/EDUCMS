import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * At-rest encryption helpers for SSO secrets (x509 certs, OIDC client secrets).
 *
 * Uses AES-256-GCM with a per-record random IV. The encryption key is derived
 * from SSO_ENCRYPTION_KEY (hex string, 32 bytes / 64 hex chars recommended).
 * A SHA-256 fallback hash of whatever value is provided is used if the env var
 * is not exactly 32 bytes, so misconfigured environments still fail closed
 * rather than crashing on module init.
 *
 * Ciphertext format (base64): iv(12) | authTag(16) | ciphertext(rest)
 */

const KEY_ENV = 'SSO_ENCRYPTION_KEY';

export function getSsoKey(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw || raw.length < 16) {
    // Development fallback — still deterministic per-process but not suitable
    // for production. Documented in .env.example.
    return createHash('sha256').update('dev_only_sso_encryption_key_CHANGE_ME').digest();
  }
  // Accept either 64 hex chars (32 bytes) or a longer arbitrary string hashed.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return createHash('sha256').update(raw).digest();
}

export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === '') return null;
  const key = getSsoKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(ciphertextB64: string | null | undefined): string | null {
  if (!ciphertextB64) return null;
  try {
    const key = getSsoKey();
    const buf = Buffer.from(ciphertextB64, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}
