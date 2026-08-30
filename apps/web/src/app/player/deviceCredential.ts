/**
 * Device-credential lifecycle — pure decision logic (2026-08-30 player
 * reliability program, W1-1/W1-3).
 *
 * THE PRODUCTION FAILURE THIS EXISTS TO END. The web player treated
 * registration as a boot-time action, not a credential lifecycle: it stored
 * whatever token `POST /screens/register` returned and never looked at it
 * again. A paired 180-day token that expired (or was clobbered by a stale
 * native `?token=` injection — see trustGuards.ts) re-registered into a
 * 1-hour unproven token with `requiresRePair: true`, which the player
 * IGNORED. One hour later every manifest fetch 401'd forever: the 401
 * handler assumed "a token will be re-minted next call" but nothing ever
 * re-registered, and it *decremented* the failure counter, so the ≥10-failure
 * native-reload escape hatch was mathematically unreachable. Screens sat
 * `idle:connecting` for DAYS while their native heartbeat kept them "ONLINE"
 * (G43: 37 h content-dead; fleet: 409 SCREEN_TOKEN_DOWNGRADED / 7 days).
 *
 * The server side is already sound and needs no new endpoint:
 *   - a VALID proven token re-registered before expiry → fresh 180 d token +
 *     credential-epoch rotation + SCREEN_TOKEN_RENEWED audit row;
 *   - an unproven token (`unproven: true` claim, DEVAUTH-01) can NEVER
 *     upgrade itself — it re-registers into another 1 h unproven token with
 *     `requiresRePair: true` (audited as SCREEN_TOKEN_DOWNGRADED).
 * So the entire fix is client discipline: renew PROACTIVELY while the token
 * is still valid, treat `requiresRePair` as a real persisted state, and on a
 * device-token 401 run ONE controlled re-register instead of looping.
 *
 * Everything here is pure (no React, no fetch, no storage) so it unit-tests
 * without mounting the 10.9k-line player page.
 */

export interface DecodedDeviceToken {
  /** JWT `exp`, in MILLISECONDS since epoch (converted from seconds). */
  expMs: number | null;
  /** JWT `iat`, in MILLISECONDS since epoch, when present. */
  iatMs: number | null;
  /** DEVAUTH-01 marker: this credential was minted without proof of possession. */
  unproven: boolean;
  /** Credential epoch claim (`ep`), for diagnostics only. */
  epoch: number | null;
  /** `sub` — the screenId this token is bound to. */
  screenId: string | null;
}

/**
 * Decode a device JWT's payload WITHOUT verifying the signature (the player
 * has no secret and needs none — it only reads its own token's metadata to
 * schedule renewal; the server re-verifies everything on every request).
 * Returns null for non-JWTs (legacy `dev_<screen>_<tenant>` tokens, junk).
 */
export function decodeDeviceToken(token: string | null | undefined): DecodedDeviceToken | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    // base64url → base64 with padding. atob is available in every target
    // (browsers + Android System WebView back to Chromium 83).
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8'),
    );
    if (!payload || typeof payload !== 'object') return null;
    return {
      expMs: typeof payload.exp === 'number' ? payload.exp * 1000 : null,
      iatMs: typeof payload.iat === 'number' ? payload.iat * 1000 : null,
      unproven: payload.unproven === true,
      epoch: typeof payload.ep === 'number' ? payload.ep : null,
      screenId: typeof payload.sub === 'string' ? payload.sub : null,
    };
  } catch {
    return null;
  }
}

export interface RenewalDecision {
  renew: boolean;
  reason:
    | 'no-token'          // nothing to renew — registration flow owns this
    | 'not-a-jwt'         // dev_ token or junk — lifecycle not applicable
    | 'no-exp'            // malformed claim set — leave it to the server
    | 'expired'           // too late for a clean renewal, but re-register
                          // anyway: the server answers with a 1 h token that
                          // keeps last-known-good content alive + flags re-pair
    | 'inside-window'     // remaining validity below the renewal threshold
    | 'healthy';          // plenty of validity left — do nothing
  remainingMs: number | null;
}

/** Renew proven (180 d) tokens when under 14 days remain — dozens of retry
 * windows before expiry even for a kiosk with patchy connectivity. */
export const PROVEN_RENEW_UNDER_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Decide whether the player should proactively re-register RIGHT NOW to
 * rotate its credential. Threshold: 1/4 of the token's original lifetime
 * (when `iat` is present), capped at 14 days — for the real fleet that means
 * 180 d tokens renew with 14 d to spare and 1 h unproven tokens renew with
 * ~15 min to spare (keeping content alive on a repair-required screen
 * instead of letting it die at the top of the hour).
 */
export function renewalDecision(nowMs: number, token: string | null | undefined): RenewalDecision {
  if (!token) return { renew: false, reason: 'no-token', remainingMs: null };
  const decoded = decodeDeviceToken(token);
  if (!decoded) return { renew: false, reason: 'not-a-jwt', remainingMs: null };
  if (decoded.expMs === null) return { renew: false, reason: 'no-exp', remainingMs: null };
  const remainingMs = decoded.expMs - nowMs;
  if (remainingMs <= 0) return { renew: true, reason: 'expired', remainingMs };
  const lifetimeMs = decoded.iatMs !== null ? decoded.expMs - decoded.iatMs : null;
  const threshold = lifetimeMs !== null && lifetimeMs > 0
    ? Math.min(PROVEN_RENEW_UNDER_MS, lifetimeMs / 4)
    : PROVEN_RENEW_UNDER_MS;
  if (remainingMs < threshold) return { renew: true, reason: 'inside-window', remainingMs };
  return { renew: false, reason: 'healthy', remainingMs };
}

/**
 * Minimum spacing between credential-recovery attempts (the 401 path and the
 * proactive path share it). One controlled attempt, then breathe: a broken
 * server must produce a visible failure state, not a register storm.
 */
export const RECOVERY_ATTEMPT_COOLDOWN_MS = 60_000;

/**
 * Gate for attempting a re-register. Pure so the cooldown math is testable:
 * pass the timestamp of the previous attempt (0 = never).
 */
export function mayAttemptRecovery(nowMs: number, lastAttemptAtMs: number): boolean {
  return nowMs - lastAttemptAtMs >= RECOVERY_ATTEMPT_COOLDOWN_MS;
}
