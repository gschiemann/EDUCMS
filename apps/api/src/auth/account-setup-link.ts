import { createHash, randomBytes } from 'node:crypto';

/**
 * ONE-TIME ACCOUNT SETUP LINKS (2026-10-10).
 *
 * WHY. The provisioned location accounts (RIOT: 41) were handed starter
 * passwords derived from public postal codes. Anyone who has read the
 * locations page can guess them. An administrator now hands each person a
 * single-use, expiring link instead:
 *
 *   - generating one RETIRES the starter password (an unknown random hash
 *     replaces it), revokes any older unused link for the account and ends
 *     every live session — so the guessable credential is dead the moment a
 *     link exists;
 *   - redeeming it (one conditional write, so exactly once) signs the person
 *     in to first-login setup: their own email (+ emailed code) and password
 *     first, then the required two-step setup;
 *   - only sha256(token) is stored. The token is 256 bits of randomness, shown
 *     once to the administrator who generated it, never logged or audited.
 */

/** A link lives a week — long enough to reach a branch manager, short enough to go stale. */
export const SETUP_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** `/setup-account/<token>` on the dashboard origin. */
export const SETUP_LINK_PATH = '/setup-account/';

/** 32 random bytes, base64url — 43 characters. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{40,64}$/;

export function generateSetupLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isSetupLinkTokenShape(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_SHAPE.test(value);
}

export function hashSetupLinkToken(token: string): string {
  return createHash('sha256').update(`venueos-setup-link|${token}`).digest('hex');
}

/**
 * The absolute link an administrator copies. Same base the invite link uses
 * (`OnboardingService.createInvite`), so both land on the same dashboard
 * origin; relative when no base is configured (dev), which the dashboard
 * resolves against its own origin.
 */
export function setupLinkUrl(token: string, env: NodeJS.ProcessEnv = process.env): string {
  const base =
    env.PUBLIC_WEB_URL || env.NEXT_PUBLIC_WEB_URL || env.ALLOWED_ORIGINS?.split(',')[0]?.trim() || '';
  const path = `${SETUP_LINK_PATH}${token}`;
  return base ? `${base.replace(/\/$/, '')}${path}` : path;
}

export type SetupLinkState = 'none' | 'active' | 'used' | 'expired';

/** The state the People page shows for an account's NEWEST link. */
export function setupLinkState(
  link: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date } | null | undefined,
  now: Date = new Date(),
): SetupLinkState {
  if (!link) return 'none';
  if (link.usedAt) return 'used';
  if (link.revokedAt) return 'none';
  return link.expiresAt.getTime() > now.getTime() ? 'active' : 'expired';
}
