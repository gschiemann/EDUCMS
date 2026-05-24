import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { requireSecret } from '../security/required-secret';

/**
 * At-rest encryption helpers for SSO secrets (x509 certs, OIDC client secrets).
 *
 * Uses AES-256-GCM with a per-record random IV. The encryption key is derived
 * from SSO_ENCRYPTION_KEY (hex string, 32 bytes / 64 hex chars recommended).
 *
 * SECURITY (2026-05-23 launch audit P0): previously this file fell back to
 *   createHash('sha256').update('dev_only_sso_encryption_key_CHANGE_ME')
 * when the env var was unset — silently, in any environment including
 * production. The repo is PUBLIC on GitHub, so that fallback hash is
 * universally-known. A deploy that forgot to set SSO_ENCRYPTION_KEY
 * encrypted every tenant's SAML x509 cert + OIDC client_secret with a
 * public key, making "at-rest encryption" theater.
 *
 * Same anti-pattern that wave-1's `requireSecret` helper was specifically
 * built to eliminate (see apps/api/src/security/required-secret.ts).
 * `streaming/creds-cipher.ts` and `ai/ai-key-cipher.ts` both fail-closed
 * in prod; SSO now follows the same pattern. In dev/test the helper
 * still emits a fallback so local tooling keeps working; production
 * refuses to boot.
 *
 * Ciphertext format (base64): iv(12) | authTag(16) | ciphertext(rest)
 */

export function getSsoKey(): Buffer {
  // requireSecret() throws in production when missing/too-short; returns
  // the dev-only fallback string in dev/test after emitting a loud warning.
  // Same `dev_only_..._CHANGE_ME` sentinel as the prior code, but now never
  // reachable in NODE_ENV=production.
  const raw = requireSecret('SSO_ENCRYPTION_KEY', {
    devFallback: 'dev_only_sso_encryption_key_CHANGE_ME',
    minLength: 16,
  });
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
