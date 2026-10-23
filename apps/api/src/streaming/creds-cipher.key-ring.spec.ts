/**
 * creds-cipher during a DEVICE_SECRET_KEY rotation window (2026-10-22).
 *   (a) previous unset: an old-key envelope fails exactly as before
 *   (b) it opens while the old key is _PREVIOUS
 *   (c) seal always wraps with the PRIMARY; re-wrap moves a row onto it
 *   (d) an envelope under an unrelated key is refused, window or not
 */
import { openCredentials, rewrapDataKeyToPrimary, sealCredentials } from './creds-cipher';

const NEW_HEX = '11'.repeat(32);
const OLD_HEX = '22'.repeat(32);
const UNRELATED_HEX = '33'.repeat(32);
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

const PLAIN = { accessToken: 'tok_123', refreshToken: 'r_456' };

describe('creds-cipher + key ring', () => {
  it('(a) previous unset: a row sealed under the old key does not open (unchanged failure)', () => {
    const sealedOld = withKeys(OLD_HEX, undefined, () => sealCredentials(PLAIN));
    withKeys(NEW_HEX, undefined, () => {
      expect(openCredentials(withKeys(NEW_HEX, undefined, () => sealCredentials(PLAIN)))).toEqual(PLAIN);
      expect(() => openCredentials(sealedOld)).toThrow(/unable to authenticate|Unsupported state/);
    });
  });

  it('(b) during the window an old-key row opens; new rows open too', () => {
    const sealedOld = withKeys(OLD_HEX, undefined, () => sealCredentials(PLAIN));
    withKeys(NEW_HEX, OLD_HEX, () => {
      expect(openCredentials(sealedOld)).toEqual(PLAIN);
      expect(openCredentials(sealCredentials(PLAIN))).toEqual(PLAIN);
    });
  });

  it('(c) seal during the window wraps with the PRIMARY: it still opens once the window closes, never with the previous alone', () => {
    const sealedInWindow = withKeys(NEW_HEX, OLD_HEX, () => sealCredentials(PLAIN));
    withKeys(NEW_HEX, undefined, () => expect(openCredentials(sealedInWindow)).toEqual(PLAIN));
    withKeys(OLD_HEX, undefined, () => expect(() => openCredentials(sealedInWindow)).toThrow());
  });

  it('(c) rewrapDataKeyToPrimary: old-key row → rewrapped (encryptedCreds untouched); primary row → current; idempotent', () => {
    const sealedOld = withKeys(OLD_HEX, undefined, () => sealCredentials(PLAIN));
    withKeys(NEW_HEX, OLD_HEX, () => {
      const r = rewrapDataKeyToPrimary(sealedOld.encryptedDataKey);
      expect(r.status).toBe('rewrapped');
      if (r.status !== 'rewrapped') return;
      expect(r.encryptedDataKey).not.toBe(sealedOld.encryptedDataKey);
      const moved = { encryptedCreds: sealedOld.encryptedCreds, encryptedDataKey: r.encryptedDataKey };
      expect(openCredentials(moved)).toEqual(PLAIN);
      // Second pass: nothing to do.
      expect(rewrapDataKeyToPrimary(r.encryptedDataKey)).toEqual({ status: 'current' });
      // And the moved row opens with the primary ALONE.
      withKeys(NEW_HEX, undefined, () => expect(openCredentials(moved)).toEqual(PLAIN));
    });
  });

  it('(d) an envelope under an unrelated key is refused (open throws; rewrap says unreadable), window or not', () => {
    const sealedUnrelated = withKeys(UNRELATED_HEX, undefined, () => sealCredentials(PLAIN));
    withKeys(NEW_HEX, undefined, () => {
      expect(() => openCredentials(sealedUnrelated)).toThrow();
      expect(rewrapDataKeyToPrimary(sealedUnrelated.encryptedDataKey)).toEqual({ status: 'unreadable' });
    });
    withKeys(NEW_HEX, OLD_HEX, () => {
      expect(() => openCredentials(sealedUnrelated)).toThrow();
      expect(rewrapDataKeyToPrimary(sealedUnrelated.encryptedDataKey)).toEqual({ status: 'unreadable' });
    });
  });

  it('rewrap with no window open answers current for a primary row (safe no-op)', () => {
    withKeys(NEW_HEX, undefined, () => {
      const s = sealCredentials(PLAIN);
      expect(rewrapDataKeyToPrimary(s.encryptedDataKey)).toEqual({ status: 'current' });
    });
  });
});
