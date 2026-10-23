/**
 * AI key cipher — single-string envelope encryption for BYOK API keys.
 *
 * Why a separate file from streaming/creds-cipher.ts:
 *   - That helper takes a JSON object and emits two columns
 *     (encryptedCreds + encryptedDataKey).
 *   - For an AI API key the plaintext is one short string, and we
 *     want one column on tenants. Same envelope scheme, packed into
 *     a single base64 blob.
 *
 * Format (base64 of):
 *   [DK_IV (12)] [DK_TAG (16)] [DK_CT (32)] [V_IV (12)] [V_TAG (16)] [V_CT (variable)]
 *   ↑ outer envelope: per-row data key wrapped with master  ↑ inner: api key wrapped with data key
 *
 * Master key = process.env.DEVICE_SECRET_KEY (64 hex chars / 32 bytes).
 * Same secret used for device tokens + streaming creds — no new env
 * var to manage. If we ever rotate to KMS we rewrite this file, not
 * the call sites.
 *
 * 2026-10-22 — ROTATION WINDOW (`security/key-ring.ts`): seal always wraps
 * with the PRIMARY; open tries the primary, then `DEVICE_SECRET_KEY_PREVIOUS`
 * when set. Format unchanged. `rewrapAiKeyToPrimary` re-wraps only the outer
 * 60-byte data-key envelope and never decrypts the API key itself.
 *
 * NEVER call sealAiKey() with anything other than the operator's own
 * input from the BYOK form. The plaintext should never leave this
 * file's scope after seal — store the base64 result and discard.
 */
import * as crypto from 'crypto';
import { masterKeyCandidates, masterKeysFor } from '../security/key-ring';

const KEY_LEN = 32; // AES-256 data key
const IV_LEN = 12;  // GCM standard
const TAG_LEN = 16;
// Outer envelope = IV(12) + TAG(16) + CT(KEY_LEN=32) = 60 bytes
const OUTER_LEN = IV_LEN + TAG_LEN + KEY_LEN;

const MASTER_KEY_PURPOSE = 'AI key encryption';

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

/** Primary first, then previous; the primary's error is the one rethrown. */
function unwrapDataKey(wrappedDataKey: Buffer): { dataKey: Buffer; keyIndex: number } {
  const keys = masterKeyCandidates(masterKeysFor(MASTER_KEY_PURPOSE));
  let primaryError: unknown;
  for (let i = 0; i < keys.length; i++) {
    try {
      return { dataKey: decryptBytes(keys[i], wrappedDataKey), keyIndex: i };
    } catch (e) {
      if (i === 0) primaryError = e;
    }
  }
  throw primaryError;
}

/**
 * Envelope-encrypt the operator's AI provider API key. Returns a
 * single base64 string suitable for storing in `tenants.ai_key_encrypted`.
 */
export function sealAiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 8) {
    throw new Error('API key too short to be valid.');
  }
  const master = masterKeysFor(MASTER_KEY_PURPOSE).primary;
  const dataKey = crypto.randomBytes(KEY_LEN);
  // wrappedDataKey: [IV(12) | TAG(16) | CT(32)] = 60 bytes total
  const wrappedDataKey = encryptBytes(master, dataKey);
  const wrappedKey = encryptBytes(dataKey, Buffer.from(apiKey, 'utf8'));
  return Buffer.concat([wrappedDataKey, wrappedKey]).toString('base64');
}

/**
 * Reverse of sealAiKey. Throws if the blob is malformed or the
 * master key has changed (catastrophic — every BYOK key would need
 * to be re-entered by every tenant). A rotation done through the key
 * ring is NOT that case: the previous key still opens it until the
 * re-wrap job has moved the row.
 */
export function openAiKey(sealed: string): string {
  const blob = Buffer.from(sealed, 'base64');
  if (blob.length < OUTER_LEN + IV_LEN + TAG_LEN) {
    throw new Error('Sealed AI key too short / corrupted.');
  }
  const wrappedDataKey = blob.subarray(0, OUTER_LEN);
  const { dataKey } = unwrapDataKey(wrappedDataKey);
  const wrappedKey = blob.subarray(OUTER_LEN);
  const plain = decryptBytes(dataKey, wrappedKey);
  return plain.toString('utf8');
}

export type AiKeyRewrapResult =
  | { status: 'current' }
  | { status: 'rewrapped'; sealed: string }
  | { status: 'unreadable' };

/**
 * Move one sealed AI key onto the PRIMARY master key. Re-wraps the outer
 * 60-byte data-key envelope only; the inner API-key ciphertext is copied
 * byte for byte and never decrypted. Idempotent (`current` on the primary).
 */
export function rewrapAiKeyToPrimary(sealed: string): AiKeyRewrapResult {
  const blob = Buffer.from(sealed, 'base64');
  if (blob.length < OUTER_LEN + IV_LEN + TAG_LEN) return { status: 'unreadable' };
  let unwrapped: { dataKey: Buffer; keyIndex: number };
  try {
    unwrapped = unwrapDataKey(blob.subarray(0, OUTER_LEN));
  } catch {
    return { status: 'unreadable' };
  }
  if (unwrapped.keyIndex === 0) return { status: 'current' };
  const keys = masterKeysFor(MASTER_KEY_PURPOSE);
  const rewrapped = encryptBytes(keys.primary, unwrapped.dataKey);
  return {
    status: 'rewrapped',
    sealed: Buffer.concat([rewrapped, blob.subarray(OUTER_LEN)]).toString('base64'),
  };
}

/**
 * Mask an API key for safe display in the UI. Anthropic keys are
 * `sk-ant-api03-...` (long); OpenAI are `sk-...`. Show first 6 + last 4,
 * dot-mask the middle.
 */
export function maskAiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 12) return '••••••••';
  return `${apiKey.slice(0, 6)}••••••••${apiKey.slice(-4)}`;
}
