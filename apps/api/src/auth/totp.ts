/**
 * RFC 6238 TOTP — Time-based One-Time Password.
 *
 * Implemented from scratch on Node's built-in `crypto` rather than
 * pulling in `otplib` / `speakeasy` / `notp`:
 *   - Zero new deps. Otplib has 3 transitive deps; speakeasy is
 *     unmaintained (last release 2017); notp is even older. Our
 *     surface is tiny (generate secret + verify code), so a
 *     ~50-line built-in is the smallest-footprint choice.
 *   - License: this file is the same license as the rest of the
 *     repo (UNLICENSED / private). Built-in crypto is MIT-friendly.
 *
 * The algorithm:
 *   1. Secret is a random 20-byte buffer (160 bits, RFC 4226 §4 R6).
 *      Encoded as base32 for the otpauth URL so Authenticator apps
 *      can scan it.
 *   2. Counter = floor(unixTimeSeconds / 30) — i.e. a fresh code
 *      every 30 seconds, the de-facto default.
 *   3. HMAC-SHA1(secret, counter-as-8-byte-big-endian).
 *   4. Dynamic truncation per RFC 4226 §5.3 → 6-digit code.
 *   5. Verify allows ±1 step (30s skew either side) to handle
 *      clock drift on the user's phone.
 */
import * as crypto from 'crypto';

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // accept code from previous/next step (±30s)
const SECRET_BYTES = 20; // RFC 4226 §4 R6 — 160 bits

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encode a Buffer to RFC 4648 base32 (no padding — most Authenticator
 * apps tolerate either form, but unpadded is what `otpauth://` URLs
 * conventionally use). Forward-compatible if a vendor adds padding.
 */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

/**
 * Decode RFC 4648 base32 → Buffer. Tolerates lower-case input and
 * optional `=` padding. Throws on invalid characters.
 */
export function base32Decode(s: string): Buffer {
  const cleaned = s.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx < 0) {
      throw new Error('Invalid base32 character');
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * Generate a fresh random TOTP secret (raw bytes + base32 form). The
 * caller should store the base32 form encrypted at rest.
 */
export function generateTotpSecret(): { secretBase32: string; secretBuffer: Buffer } {
  const buf = crypto.randomBytes(SECRET_BYTES);
  return { secretBase32: base32Encode(buf), secretBuffer: buf };
}

/**
 * Compute the 6-digit TOTP code for a given counter value (steps of
 * 30 seconds since unix epoch).
 */
function hotp(secret: Buffer, counter: number): string {
  // Counter as 8-byte big-endian.
  const counterBuf = Buffer.alloc(8);
  // Node only supports 32-bit safe writes via writeUInt32BE; high
  // 32 bits stay zero (current epoch fits comfortably under 2^32 for
  // the next few centuries at 30s steps).
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter & 0xffffffff, 4);

  const hmac = crypto.createHmac('sha1', secret).update(counterBuf).digest();
  // Dynamic truncation per RFC 4226 §5.3.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const code = binary % Math.pow(10, TOTP_DIGITS);
  return code.toString().padStart(TOTP_DIGITS, '0');
}

/**
 * Verify a 6-digit code against a base32-encoded secret. Accepts the
 * current ±1 step (a ±30s window) to absorb minor clock drift on the
 * user's device. Uses timing-safe comparison so a slow-fast attacker
 * can't extract the code digit-by-digit.
 *
 * `nowMs` defaults to `Date.now()` but is overridable for tests.
 */
export function verifyTotpCode(
  secretBase32: string,
  code: string,
  nowMs: number = Date.now(),
): boolean {
  if (!code || typeof code !== 'string') return false;
  // Strip whitespace and validate shape — 6 digits exactly. Anything
  // else, fail fast (some Authenticator apps render with a space in
  // the middle, e.g. "123 456" — be tolerant of that).
  const cleaned = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;

  let secret: Buffer;
  try {
    secret = base32Decode(secretBase32);
  } catch {
    return false;
  }

  const step = Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
  for (let drift = -TOTP_WINDOW; drift <= TOTP_WINDOW; drift++) {
    const candidate = hotp(secret, step + drift);
    // Timing-safe comparison — both are fixed-length ASCII so this
    // is safe to call directly.
    const a = Buffer.from(candidate, 'ascii');
    const b = Buffer.from(cleaned, 'ascii');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return true;
    }
  }
  return false;
}

/**
 * Build the `otpauth://totp/...` URL the client renders as a QR code.
 * Standard format documented at:
 *   https://github.com/google/google-authenticator/wiki/Key-Uri-Format
 *
 * `issuer` is the org name shown in Authenticator (e.g. "VenueOS").
 * `accountLabel` is the user-facing identifier (typically email).
 */
export function buildOtpauthUrl(
  secretBase32: string,
  issuer: string,
  accountLabel: string,
): string {
  const encIssuer = encodeURIComponent(issuer);
  const encAccount = encodeURIComponent(accountLabel);
  const label = `${encIssuer}:${encAccount}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Generate `count` random backup codes. Each is 8 base32 characters
 * (40 bits of entropy — Google's "Authenticator backup" uses the same
 * shape). Returned in plaintext for ONE-TIME display to the user;
 * callers should hash before storing.
 */
export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(5); // 40 bits → 8 base32 chars
    codes.push(base32Encode(bytes).slice(0, 8));
  }
  return codes;
}

export const TotpInternals = {
  hotp,
  TOTP_PERIOD_SECONDS,
  TOTP_DIGITS,
  TOTP_WINDOW,
};
