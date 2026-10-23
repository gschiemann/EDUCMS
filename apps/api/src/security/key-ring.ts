/**
 * Key ring — zero-downtime rotation for the two device-side secrets.
 *
 * 2026-10-22 (Railway env leak of 2026-10-21): `DEVICE_JWT_SECRET` and
 * `DEVICE_SECRET_KEY` had to be rotated WITHOUT taking the screen fleet
 * offline. A straight swap of either one is an outage:
 *
 *   • `DEVICE_JWT_SECRET` signs every screen's 1-hour device JWT. Swap it and
 *     every screen 401s on its next request until it is physically re-paired.
 *   • `DEVICE_SECRET_KEY` is the HMAC key for the realtime fan-out gate (the
 *     emergency path), stream tickets, sports/beacon/render capabilities, OTA
 *     tags and the legacy `X-Device-Auth` header — AND the master key that
 *     wraps every stored credential (streaming / POS / ads / social
 *     connections, BYOK AI keys, MFA TOTP secrets, kiosk Wi-Fi passphrases).
 *     Swap it and every one of those rows becomes unreadable at once.
 *
 * The ring makes a rotation a WINDOW instead of a cliff. Each secret may carry
 * an optional `<NAME>_PREVIOUS` companion:
 *
 *   MINT / SIGN / ENCRYPT  → always the PRIMARY (`<NAME>`).
 *   VERIFY / DECRYPT       → the primary first, then the previous.
 *
 * So: set the new value as `<NAME>` and the old one as `<NAME>_PREVIOUS`,
 * deploy, let screens renew onto the primary (≤ 1 h) and run the re-wrap job
 * for stored ciphertext, then delete `<NAME>_PREVIOUS` and deploy again. The
 * runbook is `docs/SECRET-ROTATION.md`.
 *
 * INVARIANT — with `<NAME>_PREVIOUS` unset, every consumer behaves byte for
 * byte as it did before this module existed: one key, same bytes, same errors.
 *
 * Boot rules (same posture as `required-secret.ts`): the primary is required in
 * production; the previous is optional, but when it IS set it must meet the
 * same length rule and must differ from the primary — a previous that equals
 * the primary means the rotation never happened and the leaked value is still
 * live, so the boot refuses with a message that says exactly that.
 */
import { requireSecret } from './required-secret';

export interface KeyRing {
  /** The key every new token / signature / ciphertext is made with. */
  readonly primary: string;
  /** The retiring key — accepted on verify / decrypt only. Absent outside a rotation window. */
  readonly previous?: string;
}

/** `<NAME>_PREVIOUS` — the companion env var that opens a rotation window. */
export function previousSecretName(name: string): string {
  return `${name}_PREVIOUS`;
}

/**
 * The retiring value, or `undefined` when no rotation window is open.
 *
 * Validation lives in `assertKeyRingsAtBoot` (throws at boot). At READ time a
 * previous that would have failed boot validation is treated as unset rather
 * than honoured, so a value that slipped past boot (tests, a `SKIP_*` boot)
 * can never widen verification with a short or duplicate key.
 */
function readPrevious(name: string, primary: string, minLength: number): string | undefined {
  const raw = process.env[previousSecretName(name)];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length < minLength) return undefined;
  if (raw === primary) return undefined;
  return raw;
}

/**
 * Build the ring for one secret. The primary goes through `requireSecret`
 * (throws in production when missing / short, dev fallback + warning
 * otherwise) exactly as every call site did before.
 */
export function secretKeyRing(
  name: string,
  opts: { devFallback: string; minLength?: number },
): KeyRing {
  const minLength = opts.minLength ?? 16;
  const primary = requireSecret(name, { devFallback: opts.devFallback, minLength });
  const previous = readPrevious(name, primary, minLength);
  return previous === undefined ? { primary } : { primary, previous };
}

/** `[primary, previous?]` — the verify order. Always at least one entry. */
export function keyRingCandidates(ring: KeyRing): string[] {
  return ring.previous === undefined ? [ring.primary] : [ring.primary, ring.previous];
}

// ── The two device secrets ────────────────────────────────────────────────────
//
// The dev fallbacks are the SAME literals the call sites used before the ring
// existed (so a dev / test environment that never set the var keeps signing
// and verifying with the value it always did).

export const DEVICE_JWT_SECRET_NAME = 'DEVICE_JWT_SECRET';
export const DEVICE_SECRET_KEY_NAME = 'DEVICE_SECRET_KEY';

const DEVICE_JWT_DEV_FALLBACK = 'dev_only_device_jwt_secret_CHANGE_ME';
const DEVICE_SECRET_DEV_FALLBACK = 'dev_only_device_secret_CHANGE_ME';

/** Signs / verifies device (screen) JWTs. */
export function deviceJwtSecretRing(): KeyRing {
  return secretKeyRing(DEVICE_JWT_SECRET_NAME, { devFallback: DEVICE_JWT_DEV_FALLBACK });
}

/**
 * HMAC key for realtime fan-out / tickets / capabilities, and the master key
 * for stored-credential envelopes.
 *
 * @param devFallback Some call sites historically used their own dev literal
 *   (`dev_only_beacon_secret_CHANGE_ME`, …). Passing it keeps that site's
 *   dev/test bytes identical; production never reaches a fallback.
 */
export function deviceSecretKeyRing(devFallback: string = DEVICE_SECRET_DEV_FALLBACK): KeyRing {
  return secretKeyRing(DEVICE_SECRET_KEY_NAME, { devFallback });
}

/** `[primary, previous?]` for `DEVICE_SECRET_KEY` — the verify order. */
export function deviceSecretKeyCandidates(devFallback?: string): string[] {
  return keyRingCandidates(deviceSecretKeyRing(devFallback));
}

/**
 * Read the ring from an explicit env object (for the two OTA helpers that take
 * `env` as a parameter and never used `requireSecret`). Same previous rules;
 * an unset primary yields an EMPTY ring, which those helpers already treat as
 * "no secret configured".
 */
export function deviceSecretKeyCandidatesFromEnv(env: NodeJS.ProcessEnv): string[] {
  const primary = (env[DEVICE_SECRET_KEY_NAME] || '').trim();
  if (!primary) return [];
  const prevRaw = env[previousSecretName(DEVICE_SECRET_KEY_NAME)];
  const previous = typeof prevRaw === 'string' ? prevRaw.trim() : '';
  if (!previous || previous.length < 16 || previous === primary) return [primary];
  return [primary, previous];
}

// ── Master-key derivation for the envelope ciphers ────────────────────────────
//
// `streaming/creds-cipher.ts`, `ai/ai-key-cipher.ts` and
// `auth/mfa-secret-cipher.ts` each carried an identical `getMasterKey()`: the
// first 64 hex chars of DEVICE_SECRET_KEY as 32 raw bytes, a production throw
// under 64 chars, and a zero-padded dev fallback. That derivation is preserved
// here BYTE FOR BYTE (same slice, same padding) and extended with the previous
// key, so a blob wrapped under the old value still opens during the window.

export interface MasterKeys {
  /** Wraps every NEW data key. */
  readonly primary: Buffer;
  /** Unwraps data keys wrapped before the rotation. Absent outside a window. */
  readonly previous?: Buffer;
}

function deriveMasterKey(hex: string, varName: string, purpose: string): Buffer {
  if (!hex || hex.length < 64) {
    // 64 hex chars = 32 bytes = AES-256. Anything shorter = unsafe.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`${varName} missing or too short for ${purpose} (need 64 hex chars).`);
    }
    // Dev fallback — pad with zeros so unit tests don't crash. Never reached
    // in any prod path (the boot-time secret check refuses to start without it).
    return Buffer.from((hex + '0'.repeat(64)).slice(0, 64), 'hex');
  }
  return Buffer.from(hex.slice(0, 64), 'hex');
}

/**
 * The AES-256-GCM master key(s) for the stored-credential envelopes.
 *
 * `purpose` only names the cipher in the production error message, exactly as
 * the three per-file copies did ("streaming credential encryption", …).
 */
export function masterKeysFor(purpose: string): MasterKeys {
  const primaryHex = process.env[DEVICE_SECRET_KEY_NAME] || '';
  const primary = deriveMasterKey(primaryHex, DEVICE_SECRET_KEY_NAME, purpose);

  const prevName = previousSecretName(DEVICE_SECRET_KEY_NAME);
  const prevRaw = process.env[prevName];
  const prevHex = typeof prevRaw === 'string' ? prevRaw : '';
  if (!prevHex.trim() || prevHex.trim().length < 16 || prevHex === primaryHex) {
    return { primary };
  }
  const previous = deriveMasterKey(prevHex, prevName, purpose);
  // A previous that derives to the SAME bytes (e.g. identical first 64 hex
  // chars) adds nothing and would only double the work of every failed open.
  if (previous.equals(primary)) return { primary };
  return { primary, previous };
}

/** `[primary, previous?]` — the unwrap order. */
export function masterKeyCandidates(keys: MasterKeys): Buffer[] {
  return keys.previous === undefined ? [keys.primary] : [keys.primary, keys.previous];
}

// ── Boot validation ───────────────────────────────────────────────────────────

export const ROTATABLE_SECRETS: ReadonlyArray<{ name: string; minLength: number }> = [
  { name: DEVICE_JWT_SECRET_NAME, minLength: 16 },
  { name: DEVICE_SECRET_KEY_NAME, minLength: 16 },
];

/**
 * Validate every `<NAME>_PREVIOUS` at BOOT, right after
 * `assertRequiredSecretsAtBoot()`.
 *
 * Unset / empty previous ⇒ nothing to check (no rotation window). Set ⇒ it
 * must meet the primary's length rule and must DIFFER from the primary. Both
 * failures throw in EVERY environment: unlike a missing primary (which has a
 * dev fallback), a malformed previous is a configuration mistake that cannot
 * mean anything else, and silently ignoring it in dev is how it reaches prod.
 *
 * Returns the names of the secrets that currently have a rotation window open,
 * so the boot log can say so.
 */
export function assertKeyRingsAtBoot(env: NodeJS.ProcessEnv = process.env): string[] {
  const open: string[] = [];
  for (const { name, minLength } of ROTATABLE_SECRETS) {
    const prevName = previousSecretName(name);
    const prevRaw = env[prevName];
    if (typeof prevRaw !== 'string' || prevRaw.trim().length === 0) continue;

    if (prevRaw.trim().length < minLength) {
      throw new Error(
        `[security] refusing to start: env var ${prevName} is set but too short (<${minLength} chars). ` +
          `It must be the FULL value ${name} had before the rotation, or be deleted once the rotation window is closed.`,
      );
    }
    const primary = env[name];
    if (typeof primary === 'string' && primary === prevRaw) {
      throw new Error(
        `[security] refusing to start: ${prevName} is identical to ${name}. ` +
          `A rotation sets the NEW value as ${name} and the OLD value as ${prevName}; ` +
          `identical values mean the secret was not rotated. See docs/SECRET-ROTATION.md.`,
      );
    }
    open.push(name);
  }
  return open;
}
