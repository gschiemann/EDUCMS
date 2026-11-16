import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Req,
  Res,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { SsoService } from './sso.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { SsoConfigSchema } from './sso.types';
import type { SsoConfigDto } from './sso.types';
import { assertSupportReach } from '../support-access/support-access.context';
import { publicApiBase } from '../security/public-api-base';

/**
 * SSO endpoints — SAML + OIDC scaffold.
 *
 * Admin-config routes are mounted under /api/v1/tenants/:tenantSlug/sso and
 * require DISTRICT_ADMIN / SUPER_ADMIN.
 *
 * Login/callback routes are mounted under /api/v1/auth/sso/:tenantSlug/... and
 * are PUBLIC (they are the entry point for unauthenticated SSO login).
 */
/**
 * The browser half of the OIDC state binding (mirrors the Clever connect flow,
 * `integrations/clever/clever.controller.ts`).
 *
 * `/oidc/login` is a top-level navigation to this API, so the cookie is set in
 * a first-party context, and the IdP's redirect back to `/oidc/callback` is a
 * top-level GET, which carries a `Lax` cookie. HttpOnly so no page script can
 * read it; `Secure` in production; `Path`-scoped to the SSO routes so no other
 * API call carries it. It holds only a random nonce, worthless without the
 * matching single-use server record.
 */
export const OIDC_BROWSER_COOKIE = 'venueos_sso_oidc';
const OIDC_BROWSER_COOKIE_PATH = '/api/v1/auth/sso';

function oidcBrowserCookieOptions(): { httpOnly: true; secure: boolean; sameSite: 'lax'; path: string } {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: OIDC_BROWSER_COOKIE_PATH,
  };
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** What the server keeps for one pending OIDC sign-in, keyed by its `state`. */
interface StashedOidcState {
  nonce: string;
  tenantSlug: string;
  /** The nonce handed to the starting browser as a cookie. */
  browserNonce: string;
}

const VerifyDomainSchema = z
  .object({
    manual: z.boolean().optional(),
    reason: z.string().max(500).optional(),
  })
  .strict();

@Controller()
export class SsoController {
  constructor(
    private readonly sso: SsoService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // OIDC login state (state/nonce/tenant) is stashed between the login
  // redirect and the callback. Launch-readiness S9: express-session uses the
  // default in-memory MemoryStore, so on a multi-replica deploy the callback
  // can land on a DIFFERENT replica than the login redirect and find an empty
  // session → the OIDC state check fails and login breaks intermittently. We
  // mirror the state into Redis keyed by the (unguessable, IdP-echoed) state
  // value so any replica can complete the flow. The session write stays as a
  // same-replica / Redis-down fallback, so nothing regresses single-replica.
  private static readonly OIDC_STATE_TTL_SEC = 600; // 10 min — one login round-trip
  private oidcStateKey(state: string): string {
    return `sso:oidc:state:${state}`;
  }

  private async stashOidcState(state: string, payload: StashedOidcState): Promise<void> {
    const pub = this.redis.publisher;
    if (!pub || !state) return; // fail-open: session fallback still covers single-replica
    try {
      await pub.set(
        this.oidcStateKey(state),
        JSON.stringify({
          nonce: payload.nonce,
          tenantSlug: payload.tenantSlug,
          browserNonce: payload.browserNonce,
        }),
        'EX',
        SsoController.OIDC_STATE_TTL_SEC,
      );
    } catch {
      /* best-effort — session fallback remains */
    }
  }

  /** Read + delete (single-use) the Redis-stashed OIDC state, or null. */
  private async takeOidcState(state: string | undefined): Promise<Partial<StashedOidcState> | null> {
    const pub = this.redis.publisher;
    if (!pub || !state) return null;
    try {
      const raw = await pub.get(this.oidcStateKey(state));
      if (!raw) return null;
      await pub.del(this.oidcStateKey(state)); // single-use — prevent replay
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.nonce === 'string') return parsed;
      return null;
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------
  // Public helper — what domains are SSO-configured? (used by login page)
  // -----------------------------------------------------------------
  @Get('api/v1/auth/sso/:tenantSlug/config-public')
  async getPublicConfig(@Param('tenantSlug') tenantSlug: string) {
    const { config } = await this.sso.getConfigByTenantSlug(tenantSlug);
    if (!config || !config.enabled) {
      return { enabled: false };
    }
    return {
      enabled: true,
      provider: config.provider,
      tenantSlug,
    };
  }

  // -----------------------------------------------------------------
  // SAML
  // -----------------------------------------------------------------
  @Get('api/v1/auth/sso/:tenantSlug/saml/login')
  async samlLogin(
    @Param('tenantSlug') tenantSlug: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const baseUrl = this.baseUrl(req);
    const url = await this.sso.buildSamlLoginUrl(tenantSlug, baseUrl);
    return res.redirect(302, url);
  }

  @Post('api/v1/auth/sso/:tenantSlug/saml/callback')
  async samlCallback(
    @Param('tenantSlug') tenantSlug: string,
    @Body() body: { SAMLResponse?: string; RelayState?: string },
    @Res() res: Response,
  ) {
    if (!body?.SAMLResponse) throw new BadRequestException({ code: 'SSO_SAML_RESPONSE_REQUIRED', message: 'Missing SAMLResponse' });
    const profile = await this.sso.validateSamlCallback(tenantSlug, body.SAMLResponse);
    const minted = await this.sso.completeSsoLogin(tenantSlug, 'SAML', profile);
    return this.redirectWithToken(res, minted);
  }

  // -----------------------------------------------------------------
  // OIDC
  // -----------------------------------------------------------------
  @Get('api/v1/auth/sso/:tenantSlug/oidc/login')
  // V-3 (2026-10-11): public route that triggers an outbound discovery fetch.
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async oidcLogin(
    @Param('tenantSlug') tenantSlug: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const baseUrl = this.baseUrl(req);
    const { url, state, nonce } = await this.sso.buildOidcLoginUrl(tenantSlug, baseUrl);
    // The state is bound to THIS browser: a random nonce goes to it as a
    // short-lived cookie and is stored with the state, and the callback is
    // accepted only from a browser that presents it.
    const browserNonce = randomBytes(16).toString('base64url');
    // Persist state+nonce for the callback. Redis keyed by state (multi-replica
    // safe, S9) PLUS the session cookie (same-replica / Redis-down fallback).
    await this.stashOidcState(state, { nonce, tenantSlug, browserNonce });
    const session = (req as any).session;
    if (session) {
      session.ssoOidcState = state;
      session.ssoOidcNonce = nonce;
      session.ssoTenantSlug = tenantSlug;
      session.ssoOidcBrowserNonce = browserNonce;
    }
    res.cookie(OIDC_BROWSER_COOKIE, browserNonce, {
      ...oidcBrowserCookieOptions(),
      maxAge: SsoController.OIDC_STATE_TTL_SEC * 1000,
    });
    return res.redirect(302, url);
  }

  @Get('api/v1/auth/sso/:tenantSlug/oidc/callback')
  async oidcCallback(
    @Param('tenantSlug') tenantSlug: string,
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const baseUrl = this.baseUrl(req);
    const session = (req as any).session ?? {};
    // The handshake is over either way — never leave a usable nonce behind.
    const browserNonce = this.oidcBrowserNonce(req);
    res.clearCookie(OIDC_BROWSER_COOKIE, oidcBrowserCookieOptions());
    // Prefer the Redis-stashed state (works even if the callback lands on a
    // different replica than the login redirect); fall back to the session
    // cookie. The `expected.state` we compare against is always the state we
    // issued at login — for the Redis path that is the query state we just
    // matched a stored record for; for the session path it is the cookie copy.
    const stashed = await this.takeOidcState(query.state);
    let expected: { state?: string; nonce?: string };
    if (stashed) {
      // The record must belong to this tenant and to this browser.
      const boundToBrowser =
        typeof stashed.browserNonce === 'string' &&
        !!stashed.browserNonce &&
        !!browserNonce &&
        constantTimeEquals(browserNonce, stashed.browserNonce);
      if (stashed.tenantSlug !== tenantSlug || !boundToBrowser) {
        this.clearOidcSession(session);
        throw new UnauthorizedException(
          'This sign-in was started in a different browser or for a different organization. Please restart sign-in.',
        );
      }
      expected = { state: query.state, nonce: stashed.nonce };
    } else {
      // The session copy is this browser's own; it must name this tenant.
      if (session.ssoOidcState && session.ssoTenantSlug !== tenantSlug) {
        this.clearOidcSession(session);
        throw new UnauthorizedException(
          'This sign-in was started for a different organization. Please restart sign-in.',
        );
      }
      expected = { state: session.ssoOidcState, nonce: session.ssoOidcNonce };
    }
    const profile = await this.sso.validateOidcCallback(tenantSlug, query, baseUrl, expected);
    const minted = await this.sso.completeSsoLogin(tenantSlug, 'OIDC', profile);
    // Clean up the session copy (Redis copy is single-use, already deleted).
    this.clearOidcSession(session);
    return this.redirectWithToken(res, minted);
  }

  /**
   * The nonce this browser carries, from the cookie, or — when the cookie was
   * blocked — from the express-session copy, a binding of the same strength
   * (both are server-issued to the starting browser). Absent both: null.
   */
  private oidcBrowserNonce(req: Request): string | null {
    const cookies = (req as Request & { cookies?: Record<string, unknown> }).cookies;
    const fromCookie = cookies?.[OIDC_BROWSER_COOKIE];
    if (typeof fromCookie === 'string' && fromCookie) return fromCookie;
    const fromSession = (req as any).session?.ssoOidcBrowserNonce;
    return typeof fromSession === 'string' && fromSession ? fromSession : null;
  }

  private clearOidcSession(session: Record<string, unknown> | undefined): void {
    if (!session) return;
    delete session.ssoOidcState;
    delete session.ssoOidcNonce;
    delete session.ssoTenantSlug;
    delete session.ssoOidcBrowserNonce;
  }

  // -----------------------------------------------------------------
  // SP metadata (for IdP setup)
  // -----------------------------------------------------------------
  @Get('api/v1/auth/sso/:tenantSlug/metadata')
  async metadata(
    @Param('tenantSlug') tenantSlug: string,
    @Req() req: Request,
  ) {
    const tenant = await this.prisma.client.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) throw new NotFoundException({ code: 'SSO_TENANT_NOT_FOUND', message: `Tenant "${tenantSlug}" not found` });
    const baseUrl = this.baseUrl(req);
    return this.sso.buildServiceProviderMetadata(tenantSlug, baseUrl);
  }

  // -----------------------------------------------------------------
  // Admin config (DISTRICT_ADMIN / SUPER_ADMIN)
  // -----------------------------------------------------------------
  @Get('api/v1/tenants/:tenantSlug/sso')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('SUPER_ADMIN', 'DISTRICT_ADMIN')
  async getConfig(@Param('tenantSlug') tenantSlug: string, @Req() req: Request) {
    await this.assertTenantAccess(tenantSlug, req);
    const { tenant, config } = await this.sso.getConfigByTenantSlug(tenantSlug);
    const baseUrl = this.baseUrl(req);
    const spMeta = this.sso.buildServiceProviderMetadata(tenantSlug, baseUrl);
    return {
      tenantId: tenant.id,
      tenantSlug,
      config: this.sso.toSafeConfig(config),
      sp: spMeta,
    };
  }

  @Post('api/v1/tenants/:tenantSlug/sso')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('SUPER_ADMIN', 'DISTRICT_ADMIN')
  async upsertConfig(
    @Param('tenantSlug') tenantSlug: string,
    // ACC-01 (2026-08-01): this was a BARE `@Body() dto: SsoConfigDto` — a
    // compile-time-only shape with NO runtime validation, so the endpoint
    // accepted arbitrary JSON and `defaultRole` reached the DB verbatim
    // ({"defaultRole":"SUPER_ADMIN"} was stored, then handed to user.create).
    // The schema's role enum excludes SUPER_ADMIN entirely, so the escalation
    // payload is now rejected at the edge; SsoService re-checks it against the
    // caller's own rank (defence in depth — the pipe is not the only gate).
    // Same pattern every onboarding route already used.
    @Body(new ZodValidationPipe(SsoConfigSchema)) dto: SsoConfigDto,
    @Req() req: Request,
  ) {
    await this.assertTenantAccess(tenantSlug, req);
    const { tenant } = await this.sso.getConfigByTenantSlug(tenantSlug);
    // Pass through the acting user id so the audit log row carries the
    // forensic attribution (2026-05-23 launch audit P1 #2).
    const actorUserId = (req as any)?.user?.userId ?? (req as any)?.user?.id ?? null;
    // Pass through the acting role so the service can gate arming SAML
    // (provider:'SAML' + enabled:true) behind SUPER_ADMIN — CVE-2025-54419
    // interim control (Audit 04-comms-auth F-1). DISTRICT_ADMIN may still
    // store SAML settings but cannot enable them.
    const actorRole = (req as any)?.user?.role ?? null;
    const cfg = await this.sso.upsertConfig(tenant.id, dto, actorUserId, actorRole);
    return this.sso.toSafeConfig(cfg);
  }

  /**
   * V-2 (2026-10-11) — verify the claimed email domain. Body `{}` checks DNS
   * for `venueos-verification=<token>`; `{ manual: true, reason }` is the
   * SUPER_ADMIN override (enforced + audited in the service).
   */
  @Post('api/v1/tenants/:tenantSlug/sso/domain/verify')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('SUPER_ADMIN', 'DISTRICT_ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async verifyDomain(
    @Param('tenantSlug') tenantSlug: string,
    @Body(new ZodValidationPipe(VerifyDomainSchema)) body: z.infer<typeof VerifyDomainSchema>,
    @Req() req: Request,
  ) {
    await this.assertTenantAccess(tenantSlug, req);
    const { tenant } = await this.sso.getConfigByTenantSlug(tenantSlug);
    const actorUserId = (req as any)?.user?.userId ?? (req as any)?.user?.id ?? null;
    const actorRole = (req as any)?.user?.role ?? null;
    return this.sso.verifyDomain(tenant.id, { manual: !!body?.manual, reason: body?.reason ?? null }, actorUserId, actorRole);
  }

  @Post('api/v1/tenants/:tenantSlug/sso/test')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('SUPER_ADMIN', 'DISTRICT_ADMIN')
  async testConfig(
    @Param('tenantSlug') tenantSlug: string,
    @Req() req: Request,
  ) {
    await this.assertTenantAccess(tenantSlug, req);
    return this.sso.testConnection(tenantSlug);
  }

  // -----------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------

  /**
   * Tenant-scope gate for SSO admin routes.
   *
   * `RbacGuard` only validates the role and the `params.districtId` /
   * `params.schoolId` style scope. The SSO admin routes are mounted as
   * `/tenants/:tenantSlug/sso`, where `tenantSlug` is a free-form string
   * the caller can substitute. Without this gate, a DISTRICT_ADMIN of
   * tenant A could POST to tenant B's `/sso` endpoint and silently take
   * over tenant B's login flow with their own SAML/OIDC IdP.
   *
   * Allowed:
   *   - SUPER_ADMIN: any tenant
   *   - target tenant === caller's tenant
   *   - caller is DISTRICT_ADMIN AND target tenant is a direct child of
   *     the caller's tenant (district -> school)
   * Otherwise: 403.
   */
  private async assertTenantAccess(tenantSlug: string, req: Request) {
    const target = await this.prisma.client.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true, parentId: true },
    });
    if (!target) {
      throw new NotFoundException({ code: 'SSO_TENANT_NOT_FOUND', message: `Tenant "${tenantSlug}" not found` });
    }

    const user = (req as any).user as
      | { role?: string; tenantId?: string }
      | undefined;
    if (!user) {
      throw new ForbiddenException({ code: 'SSO_NO_USER_IDENTITY', message: 'No user identity found in request' });
    }

    if (user.role === 'SUPER_ADMIN') {
      await assertSupportReach(user, target.id); // SUPPORT ACCESS (2026-10-11)
      return target;
    }
    if (user.tenantId && target.id === user.tenantId) {
      return target;
    }
    if (
      user.role === 'DISTRICT_ADMIN' &&
      user.tenantId &&
      target.parentId === user.tenantId
    ) {
      return target;
    }

    throw new ForbiddenException({
      code: 'SSO_TENANT_OUT_OF_SCOPE',
      message: 'Access denied. Cannot manage SSO config for a tenant outside your scope.',
    });
  }

  private baseUrl(req: Request): string {
    // H-5 (2026-10-11): never the Host header in production.
    return publicApiBase(req);
  }

  private redirectWithToken(
    res: Response,
    minted: { access_token: string; user: { tenantSlug: string } },
  ) {
    // Web app picks up the token from the hash and stores it in its auth store.
    // Hash is never sent to the server, reducing leak risk through logs/referers.
    const webUrl = process.env.WEB_PUBLIC_URL || 'http://localhost:3000';
    const target = `${webUrl}/login/sso-complete#token=${encodeURIComponent(
      minted.access_token,
    )}&tenant=${encodeURIComponent(minted.user.tenantSlug)}`;
    return res.redirect(302, target);
  }
}
