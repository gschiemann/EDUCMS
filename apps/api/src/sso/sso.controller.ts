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
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SsoService } from './sso.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import type { SsoConfigDto } from './sso.types';

/**
 * SSO endpoints — SAML + OIDC scaffold.
 *
 * Admin-config routes are mounted under /api/v1/tenants/:tenantSlug/sso and
 * require DISTRICT_ADMIN / SUPER_ADMIN.
 *
 * Login/callback routes are mounted under /api/v1/auth/sso/:tenantSlug/... and
 * are PUBLIC (they are the entry point for unauthenticated SSO login).
 */
@Controller()
export class SsoController {
  constructor(
    private readonly sso: SsoService,
    private readonly prisma: PrismaService,
  ) {}

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
    if (!body?.SAMLResponse) throw new BadRequestException('Missing SAMLResponse');
    const profile = await this.sso.validateSamlCallback(tenantSlug, body.SAMLResponse);
    const minted = await this.sso.completeSsoLogin(tenantSlug, 'SAML', profile);
    return this.redirectWithToken(res, minted);
  }

  // -----------------------------------------------------------------
  // OIDC
  // -----------------------------------------------------------------
  @Get('api/v1/auth/sso/:tenantSlug/oidc/login')
  async oidcLogin(
    @Param('tenantSlug') tenantSlug: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const baseUrl = this.baseUrl(req);
    const { url, state, nonce } = await this.sso.buildOidcLoginUrl(tenantSlug, baseUrl);
    // State + nonce persisted in a short-lived session cookie so the callback
    // can verify them. (express-session is already configured in main.ts.)
    const session = (req as any).session;
    if (session) {
      session.ssoOidcState = state;
      session.ssoOidcNonce = nonce;
      session.ssoTenantSlug = tenantSlug;
    }
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
    const expected = { state: session.ssoOidcState, nonce: session.ssoOidcNonce };
    const profile = await this.sso.validateOidcCallback(tenantSlug, query, baseUrl, expected);
    const minted = await this.sso.completeSsoLogin(tenantSlug, 'OIDC', profile);
    // Clean up
    if (session) {
      delete session.ssoOidcState;
      delete session.ssoOidcNonce;
      delete session.ssoTenantSlug;
    }
    return this.redirectWithToken(res, minted);
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
    if (!tenant) throw new NotFoundException(`Tenant "${tenantSlug}" not found`);
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
    @Body() dto: SsoConfigDto,
  ) {
    const { tenant } = await this.sso.getConfigByTenantSlug(tenantSlug);
    const cfg = await this.sso.upsertConfig(tenant.id, dto);
    return this.sso.toSafeConfig(cfg);
  }

  @Post('api/v1/tenants/:tenantSlug/sso/test')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('SUPER_ADMIN', 'DISTRICT_ADMIN')
  async testConfig(@Param('tenantSlug') tenantSlug: string) {
    return this.sso.testConnection(tenantSlug);
  }

  // -----------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------
  private baseUrl(req: Request): string {
    const envUrl = process.env.PUBLIC_API_BASE_URL;
    if (envUrl) return envUrl.replace(/\/$/, '');
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
    return `${proto}://${host}`;
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
