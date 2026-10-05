/**
 * The short-lived JWT minted between successful password verification
 * and successful MFA challenge. Lives in its own file so both
 * AuthService (issues) and MfaController (verifies) can import the
 * shared constants without a circular dep.
 *
 * Structure of the token payload:
 *   {
 *     sub: userId,
 *     purpose: 'mfa_challenge',
 *     rememberMe: boolean,   // passed back from /auth/login so the
 *                            //   finalized session honors the
 *                            //   user's "stay signed in" choice
 *     iat, exp                // standard JWT claims
 *   }
 *
 * The `purpose` claim is the critical guard — a normal user JWT
 * lacks it, so an attacker can't trade an existing session token
 * for an MFA-bypass mid-flight.
 */

import type { JwtService } from '@nestjs/jwt';
import { requireSecret } from '../security/required-secret';
import { USER_JWT_ALGORITHMS } from './jwt-algorithms';

export const MFA_CHALLENGE_PURPOSE = 'mfa_challenge';
export const MFA_CHALLENGE_TTL = '5m';

export function issueMfaChallengeToken(
  jwt: JwtService,
  userId: string,
  rememberMe: boolean | undefined,
): string {
  return jwt.sign(
    { sub: userId, purpose: MFA_CHALLENGE_PURPOSE, rememberMe: !!rememberMe },
    { expiresIn: MFA_CHALLENGE_TTL },
  );
}

/**
 * Verify a partial `mfaToken` and return its subject, or `null` for ANY
 * failure (bad signature, expired, wrong algorithm, a normal session token
 * that lacks the `purpose` claim). The same checks `MfaController.challenge`
 * and `PasskeyController.userIdFromMfaToken` run inline; the emailed-code
 * controller (2026-10-05) is the first caller of this shared copy.
 */
export async function verifyMfaChallengeToken(
  jwt: JwtService,
  token: string,
): Promise<{ userId: string; rememberMe: boolean } | null> {
  let payload: { sub?: unknown; purpose?: unknown; rememberMe?: unknown };
  try {
    payload = await jwt.verifyAsync(token, {
      secret: requireSecret('JWT_SECRET', {
        devFallback: 'dev_only_jwt_secret_CHANGE_ME',
      }),
      // Pinned, same as the session guard — see jwt-algorithms.ts.
      algorithms: USER_JWT_ALGORITHMS,
    });
  } catch {
    return null;
  }
  // The `purpose` claim is the critical guard: a normal session JWT lacks it,
  // so a stolen access token cannot be traded for a second-factor pass.
  if (payload?.purpose !== MFA_CHALLENGE_PURPOSE) return null;
  if (typeof payload.sub !== 'string' || !payload.sub) return null;
  return { userId: payload.sub, rememberMe: payload.rememberMe === true };
}
