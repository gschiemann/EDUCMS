/**
 * mfa-secret-cipher during a DEVICE_SECRET_KEY rotation window (2026-10-22).
 * Same four-way contract as creds-cipher.key-ring.spec.ts.
 */
import { openMfaSecret, rewrapMfaSecretToPrimary, sealMfaSecret } from './mfa-secret-cipher';

const NEW_HEX = '77'.repeat(32);
const OLD_HEX = '88'.repeat(32);
const UNRELATED_HEX = '99'.repeat(32);
const VARS = ['NODE_ENV', 'DEVICE_SECRET_KEY', 'DEVICE_SECRET_KEY_PREVIOUS'] as const;
const saved: Record<string, string | undefined> = {};

function withKeys<T>(primary: string, previous: string | undefined, fn: () => T): T {
  process.env.DEVICE_SECRET_KEY = primary;
  if (previous === undefined) delete process.env.DEVICE_SECRET_KEY_PREVIOUS;
  else process.env.DEVICE_SECRET_KEY_PREVIOUS = previous;
  return fn();
}

beforeAll(() => {
  for (const k of VARS) saved[k] = process.env[k];
  process.env.NODE_ENV = 'test';
});
afterAll(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

describe('mfa-secret-cipher + key ring', () => {
  it('(a) previous unset: an old-key secret does not open; a primary one does', () => {
    const old = withKeys(OLD_HEX, undefined, () => sealMfaSecret(TOTP));
    withKeys(NEW_HEX, undefined, () => {
      expect(openMfaSecret(sealMfaSecret(TOTP))).toBe(TOTP);
      expect(() => openMfaSecret(old)).toThrow();
    });
  });

  it('(b) during the window an old-key secret opens (no forced re-enrolment)', () => {
    const old = withKeys(OLD_HEX, undefined, () => sealMfaSecret(TOTP));
    withKeys(NEW_HEX, OLD_HEX, () => expect(openMfaSecret(old)).toBe(TOTP));
  });

  it('(c) seal in the window uses the PRIMARY; rewrap moves an old secret onto it without decrypting it; idempotent', () => {
    const inWindow = withKeys(NEW_HEX, OLD_HEX, () => sealMfaSecret(TOTP));
    withKeys(NEW_HEX, undefined, () => expect(openMfaSecret(inWindow)).toBe(TOTP));
    withKeys(OLD_HEX, undefined, () => expect(() => openMfaSecret(inWindow)).toThrow());

    const old = withKeys(OLD_HEX, undefined, () => sealMfaSecret(TOTP));
    withKeys(NEW_HEX, OLD_HEX, () => {
      const r = rewrapMfaSecretToPrimary(old);
      expect(r.status).toBe('rewrapped');
      if (r.status !== 'rewrapped') return;
      expect(Buffer.from(r.sealed, 'base64').subarray(60)).toEqual(Buffer.from(old, 'base64').subarray(60));
      expect(openMfaSecret(r.sealed)).toBe(TOTP);
      expect(rewrapMfaSecretToPrimary(r.sealed)).toEqual({ status: 'current' });
      withKeys(NEW_HEX, undefined, () => expect(openMfaSecret(r.sealed)).toBe(TOTP));
    });
  });

  it('(d) a secret under an unrelated key is refused / unreadable, window or not', () => {
    const unrelated = withKeys(UNRELATED_HEX, undefined, () => sealMfaSecret(TOTP));
    withKeys(NEW_HEX, undefined, () => {
      expect(() => openMfaSecret(unrelated)).toThrow();
      expect(rewrapMfaSecretToPrimary(unrelated)).toEqual({ status: 'unreadable' });
    });
    withKeys(NEW_HEX, OLD_HEX, () => {
      expect(() => openMfaSecret(unrelated)).toThrow();
      expect(rewrapMfaSecretToPrimary(unrelated)).toEqual({ status: 'unreadable' });
    });
  });
});
