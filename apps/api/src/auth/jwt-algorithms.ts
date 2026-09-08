import type { Algorithm } from 'jsonwebtoken';

/**
 * SEC-010 follow-on (2026-09-05) — the algorithm allowlist for USER tokens.
 *
 * Every token this API signs for a human session is HS256 (a shared string
 * secret, `JWT_SECRET`). Verification must say so explicitly rather than
 * trusting the `alg` header the token itself carries.
 *
 * Is it exploitable today? No — jsonwebtoken 9.x refuses `alg: none`
 * outright, and refuses to verify an `RS*`/`ES*` signature against a string
 * secret, so the classic confusion attacks are already dead. This is defence
 * in depth, and it exists for two concrete reasons:
 *
 *   1. PARITY. SEC-001 pinned exactly this on the device leg
 *      (`DEVICE_JWT_ALGORITHMS`, screens/device-auth.ts) after finding the
 *      realtime admission path verifying with no allowlist. The user-session
 *      leg has no business being the looser of the two — a reader comparing
 *      them should not have to reason about which library version protects
 *      which call.
 *   2. FUTURE-PROOFING. The library's protection is a property of passing a
 *      STRING secret. The day someone swaps that for a `KeyObject`, or moves
 *      to asymmetric signing, the implicit protection evaporates silently.
 *      The allowlist does not.
 *
 * Keep in sync with `AuthModule`'s `JwtModule.register` (HS256 by default)
 * and `mfa-challenge-token.ts`.
 */
export const USER_JWT_ALGORITHMS: Algorithm[] = ['HS256'];
