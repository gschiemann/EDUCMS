/**
 * Device-JWT verification against the `DEVICE_JWT_SECRET` key ring.
 *
 * One function for the four verifiers (`decodeDeviceBearer`,
 * `admitDeviceCredential`, `verifiedDeviceSubject`, and the guard's device
 * leg) so the rotation window behaves identically on every transport.
 *
 * Order: PRIMARY first, then PREVIOUS. When both refuse, the PRIMARY's error
 * is the one thrown — so with no previous configured the call is one
 * `jwt.verify` with the same error text as before, and during a window an
 * expired primary-signed token still reads `jwt expired`, not the previous
 * key's `invalid signature`.
 *
 * Minting never comes through here: every mint reads `.primary` directly.
 */
import * as jwt from 'jsonwebtoken';
import { deviceJwtSecretRing } from './key-ring';

export function verifyDeviceJwt<T = jwt.JwtPayload>(
  token: string,
  options: jwt.VerifyOptions & { algorithms: jwt.Algorithm[] },
): T {
  const ring = deviceJwtSecretRing();
  try {
    return jwt.verify(token, ring.primary, options) as T;
  } catch (primaryError) {
    if (ring.previous === undefined) throw primaryError;
    try {
      return jwt.verify(token, ring.previous, options) as T;
    } catch {
      throw primaryError;
    }
  }
}
