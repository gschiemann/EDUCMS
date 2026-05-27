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
