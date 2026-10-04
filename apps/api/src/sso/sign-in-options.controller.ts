import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { EmailString } from '@cms/api-types';
import { PrismaService } from '../prisma/prisma.service';
import { ZodValidationPipe } from '../security/zod-validation.pipe';

/**
 * SIGN-IN OPTIONS (2026-10-04) — the lookup behind the identifier-first
 * sign-in page.
 *
 * The page asks for the email FIRST and then shows only what applies. The one
 * thing that can differ between two people is whether their organization
 * signs in through its own identity provider, and that is a property of the
 * email's DOMAIN, never of an account.
 *
 * ── THIS IS NOT AN ACCOUNT ORACLE, AND MUST NEVER BECOME ONE ───────────────
 *
 *  • The handler never reads the `users` table. The local part of the address
 *    is discarded before anything touches the database, so a known and an
 *    unknown address at the same domain run the SAME single query and get the
 *    SAME bytes back — there is no branch for timing to reveal.
 *  • It never answers "this account exists", "has a passkey", "has two-factor"
 *    or "must set up credentials". Those are answered only AFTER a credential
 *    proves out, by /auth/login.
 *  • Do not add a field that depends on the user row. If a future need looks
 *    like one, it belongs in the /auth/login response.
 *
 * What it does disclose: that an organization has single sign-on configured
 * for a domain, and that organization's slug + provider. The slug-keyed
 * `GET /auth/sso/:tenantSlug/config-public` already discloses enabled +
 * provider; the domain → slug mapping is what home-realm discovery is.
 *
 * ── A DOMAIN CLAIM IS NOT VERIFIED ─────────────────────────────────────────
 * `allowedEmailDomain` is whatever an admin typed. So this answer only ROUTES;
 * it never authenticates and never removes the password form:
 *  • `password` is always `true` (the schema has no "SSO only" switch);
 *  • when MORE THAN ONE enabled config claims the domain the answer is "no
 *    single sign-on" — an ambiguous claim must not pick a winner;
 *  • an archived organization's config is ignored;
 *  • the SSO callback itself still refuses an account that belongs to another
 *    tenant (`SsoService.resolveOrProvisionUser`).
 *
 * Public, per-IP throttled, no audit row (it reveals nothing about an account,
 * and a row per "Continue" would be a write amplifier) and nothing is logged —
 * the address never leaves this function.
 *
 * ── WHY 20/MIN AND NOT /auth/login's 10 ────────────────────────────────────
 * Every sign-in spends one lookup BEFORE its login attempt, and a mistyped
 * address or "Change" spends another without any login at all. At the same
 * number as the login cap, a building behind one address would run out of
 * lookups before it ran out of logins. A throttled lookup is not an error —
 * the page falls back to the password form — but for a single-sign-on
 * organization that fallback is the WRONG form, so the lookup gets twice the
 * login cap. It is one small read that says nothing about any account; the
 * brute-force wall is, and stays, the 10/min on /auth/login itself. The key
 * is the client IP from `ClientIpThrottlerGuard` (`security/client-ip.ts`),
 * like every other `@Throttle` in the app.
 */
export const SignInOptionsSchema = z.object({ email: EmailString }).strict();
type SignInOptionsInput = z.infer<typeof SignInOptionsSchema>;

export type SignInSsoProvider = 'oidc' | 'saml';

export interface SignInOptions {
  /** Password sign-in is available. Always true today. */
  password: true;
  /** Single sign-on configured for the email's domain, or null. */
  sso: {
    tenantSlug: string;
    provider: SignInSsoProvider;
    /** A name people recognise ("Google", "Microsoft", "Okta") when the issuer is a well-known one. */
    label: string | null;
  } | null;
}

/** Well-known identity providers, matched on a dot boundary of the issuer host. */
const KNOWN_ISSUERS: Array<{ host: string; label: string }> = [
  { host: 'accounts.google.com', label: 'Google' },
  { host: 'login.microsoftonline.com', label: 'Microsoft' },
  { host: 'sts.windows.net', label: 'Microsoft' },
  { host: 'okta.com', label: 'Okta' },
  { host: 'oktapreview.com', label: 'Okta' },
  { host: 'onelogin.com', label: 'OneLogin' },
  { host: 'auth0.com', label: 'Auth0' },
  { host: 'clever.com', label: 'Clever' },
  { host: 'classlink.com', label: 'ClassLink' },
];

export function providerLabelFor(issuer: string | null | undefined): string | null {
  if (!issuer) return null;
  let host: string;
  try {
    host = new URL(issuer).hostname.toLowerCase();
  } catch {
    return null;
  }
  const hit = KNOWN_ISSUERS.find((k) => host === k.host || host.endsWith(`.${k.host}`));
  return hit ? hit.label : null;
}

@Controller('api/v1/auth')
export class SignInOptionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('sign-in-options')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async signInOptions(
    @Body(new ZodValidationPipe(SignInOptionsSchema)) body: SignInOptionsInput,
  ): Promise<SignInOptions> {
    // `EmailString` has already trimmed and lowercased (the same rule login
    // uses since 2026-09-29). Only the DOMAIN goes any further.
    const domain = body.email.slice(body.email.lastIndexOf('@') + 1);

    // One query, the same one for every address. `take: 2` — all we need to
    // know is "exactly one".
    const claims = await this.prisma.client.tenantSSOConfig.findMany({
      where: {
        enabled: true,
        allowedEmailDomain: { equals: domain, mode: 'insensitive' },
        tenant: { archivedAt: null },
      },
      select: {
        provider: true,
        oidcIssuer: true,
        tenant: { select: { slug: true } },
      },
      take: 2,
    });
    if (claims.length !== 1) return { password: true, sso: null };

    const [claim] = claims;
    const provider = String(claim.provider).toLowerCase();
    if (provider !== 'oidc' && provider !== 'saml') return { password: true, sso: null };
    return {
      password: true,
      sso: {
        tenantSlug: claim.tenant.slug,
        provider,
        label: provider === 'oidc' ? providerLabelFor(claim.oidcIssuer) : null,
      },
    };
  }
}
