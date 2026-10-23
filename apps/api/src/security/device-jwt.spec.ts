/**
 * Device-JWT verification against the DEVICE_JWT_SECRET ring (2026-10-22).
 *
 *   (a) previous unset  ⇒ one verify, same error as before
 *   (b) a token minted on the OLD key verifies while the old key is _PREVIOUS
 *   (c) nothing here mints — mint sites read `.primary` (pinned in the
 *       consumer specs); here: the primary's error is the one surfaced
 *   (d) a token from an unrelated key is refused, window or not
 */
import * as jwt from 'jsonwebtoken';
import { verifyDeviceJwt } from './device-jwt';

const NEW_KEY = 'device_jwt_new_key_0123456789abcdef0123456789abcdef';
const OLD_KEY = 'device_jwt_old_key_0123456789abcdef0123456789abcdef';
const UNRELATED = 'device_jwt_unrelated_0123456789abcdef0123456789abc';
const OPTS = { algorithms: ['HS256' as const] };

describe('verifyDeviceJwt', () => {
  const saved = {
    primary: process.env.DEVICE_JWT_SECRET,
    previous: process.env.DEVICE_JWT_SECRET_PREVIOUS,
    nodeEnv: process.env.NODE_ENV,
  };
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.DEVICE_JWT_SECRET = NEW_KEY;
    delete process.env.DEVICE_JWT_SECRET_PREVIOUS;
  });
  afterAll(() => {
    for (const [k, v] of [
      ['DEVICE_JWT_SECRET', saved.primary],
      ['DEVICE_JWT_SECRET_PREVIOUS', saved.previous],
      ['NODE_ENV', saved.nodeEnv],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const sign = (key: string, extra: Record<string, unknown> = {}) =>
    jwt.sign({ sub: 'screen-1', kind: 'device', ...extra }, key, { expiresIn: '1h' });

  it('(a) previous unset: a primary-signed token verifies; an old-key token is refused with the ordinary error', () => {
    expect(verifyDeviceJwt<any>(sign(NEW_KEY), OPTS).sub).toBe('screen-1');
    expect(() => verifyDeviceJwt(sign(OLD_KEY), OPTS)).toThrow('invalid signature');
  });

  it('(b) during a window: a token minted on the OLD key verifies', () => {
    process.env.DEVICE_JWT_SECRET_PREVIOUS = OLD_KEY;
    expect(verifyDeviceJwt<any>(sign(OLD_KEY), OPTS).sub).toBe('screen-1');
    expect(verifyDeviceJwt<any>(sign(NEW_KEY), OPTS).sub).toBe('screen-1');
  });

  it('(c) the PRIMARY error is surfaced when both keys refuse (an expired primary token says expired)', () => {
    process.env.DEVICE_JWT_SECRET_PREVIOUS = OLD_KEY;
    const expired = jwt.sign({ sub: 'screen-1', kind: 'device' }, NEW_KEY, { expiresIn: -10 });
    expect(() => verifyDeviceJwt(expired, OPTS)).toThrow('jwt expired');
  });

  it('(d) a token from an unrelated key is refused, with and without a window', () => {
    expect(() => verifyDeviceJwt(sign(UNRELATED), OPTS)).toThrow('invalid signature');
    process.env.DEVICE_JWT_SECRET_PREVIOUS = OLD_KEY;
    expect(() => verifyDeviceJwt(sign(UNRELATED), OPTS)).toThrow('invalid signature');
  });

  it('a window never widens the algorithm allowlist', () => {
    process.env.DEVICE_JWT_SECRET_PREVIOUS = OLD_KEY;
    const hs512 = jwt.sign({ sub: 'screen-1', kind: 'device' }, OLD_KEY, { algorithm: 'HS512' });
    expect(() => verifyDeviceJwt(hs512, OPTS)).toThrow(/invalid algorithm/);
  });
});
