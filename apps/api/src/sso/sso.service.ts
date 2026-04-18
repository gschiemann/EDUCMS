import { Injectable, Logger, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AppRole } from '@cms/database';
import { SsoConfigDto, SsoCallbackProfile, SsoProvider } from './sso.types';
import { encryptSecret, decryptSecret } from './sso.crypto';

/**
 * SSO Service — SAML 2.0 + OIDC scaffold.
 *
 * This module is deliberately minimal and defensive:
 * - Real SAML validation is delegated to `passport-saml` (SAML.validatePostResponse).
 * - Real OIDC flow uses `openid-client` Issuer discovery + code exchange.
 * - Both libraries are loaded via `require()` at call time so unit tests can
 *   mock them cleanly and so the module compiles even if a caller wants to
 *   run without one of the providers installed.
 *
 * On successful callback the service mints the same JWT shape as AuthService
 * (sub, email, tenantId, role, canTriggerPanic) and returns { access_token, user }.
 */

@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // ---------------------------------------------------------------------------
  // Config CRUD
  // ---------------------------------------------------------------------------

  async getConfigByTenantSlug(slug: string) {
    const tenant = await this.prisma.client.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new NotFoundException(`Tenant "${slug}" not found`);
    const cfg = await this.prisma.client.tenantSSOConfig.findUnique({
      where: { tenantId: tenant.id },
    });
    return { tenant, config: cfg };
  }

  /**
   * Returns a "safe" view of the config — encrypted secrets are replaced with
   * a boolean `hasSecret` flag. Never leak plaintext secrets back to the UI.
   */
  toSafeConfig(cfg: any) {
    if (!cfg) return null;
    return {
      id: cfg.id,
      tenantId: cfg.tenantId,
      provider: cfg.provider,
      enabled: cfg.enabled,
      metadataUrl: cfg.metadataUrl,
      entityId: cfg.entityId,
      acsUrl: cfg.acsUrl,
      hasX509Cert: !!cfg.x509Cert,
      oidcIssuer: cfg.oidcIssuer,
      oidcClientId: cfg.oidcClientId,
      hasOidcClientSecret: !!cfg.oidcClientSecret,
      defaultRole: cfg.defaultRole,
      allowedEmailDomain: cfg.allowedEmailDomain,
      autoProvision: cfg.autoProvision,
      createdAt: cfg.createdAt,
      updatedAt: cfg.updatedAt,
    };
  }

  async upsertConfig(tenantId: string, dto: SsoConfigDto) {
    if (dto.provider !== 'SAML' && dto.provider !== 'OIDC') {
      throw new BadRequestException('provider must be SAML or OIDC');
    }
    const data: any = {
      provider: dto.provider,
      enabled: !!dto.enabled,
      metadataUrl: dto.metadataUrl ?? null,
      entityId: dto.entityId ?? null,
      acsUrl: dto.acsUrl ?? null,
      oidcIssuer: dto.oidcIssuer ?? null,
      oidcClientId: dto.oidcClientId ?? null,
      defaultRole: dto.defaultRole ?? 'RESTRICTED_VIEWER',
      allowedEmailDomain: dto.allowedEmailDomain ?? null,
      autoProvision: !!dto.autoProvision,
    };
    // Only re-encrypt secrets when the caller explicitly sends a new value.
    if (dto.x509Cert !== undefined) {
      data.x509Cert = dto.x509Cert ? encryptSecret(dto.x509Cert) : null;
    }
    if (dto.oidcClientSecret !== undefined) {
      data.oidcClientSecret = dto.oidcClientSecret ? encryptSecret(dto.oidcClientSecret) : null;
    }

    return this.prisma.client.tenantSSOConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
  }

  async deleteConfig(tenantId: string) {
    return this.prisma.client.tenantSSOConfig.delete({ where: { tenantId } }).catch(() => null);
  }

  // ---------------------------------------------------------------------------
  // Metadata helpers — SP metadata values for IdP setup
  // ---------------------------------------------------------------------------

  buildServiceProviderMetadata(tenantSlug: string, baseUrl: string) {
    const entityId = `${baseUrl}/api/v1/auth/sso/${tenantSlug}/metadata`;
    const acsUrl = `${baseUrl}/api/v1/auth/sso/${tenantSlug}/saml/callback`;
    const oidcRedirectUri = `${baseUrl}/api/v1/auth/sso/${tenantSlug}/oidc/callback`;
    return { entityId, acsUrl, oidcRedirectUri };
  }

  // ---------------------------------------------------------------------------
  // SAML
  // ---------------------------------------------------------------------------

  /**
   * Build the SAML authorization redirect URL. Uses passport-saml's SAML class
   * if available, otherwise falls back to constructing a minimal AuthnRequest
   * redirect (scaffold behavior — a real deployment needs passport-saml installed).
   */
  async buildSamlLoginUrl(tenantSlug: string, baseUrl: string): Promise<string> {
    const { tenant, config } = await this.getConfigByTenantSlug(tenantSlug);
    if (!config || !config.enabled || config.provider !== 'SAML') {
      throw new BadRequestException('SAML SSO is not enabled for this tenant');
    }
    const { acsUrl, entityId } = this.buildServiceProviderMetadata(tenantSlug, baseUrl);
    const cert = decryptSecret(config.x509Cert) ?? '';
    try {
      // passport-saml v3: `SAML` class
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const passportSaml: any = require('passport-saml');
      const SAMLCtor = passportSaml?.SAML ?? passportSaml?.default?.SAML;
      if (!SAMLCtor) throw new Error('passport-saml SAML class unavailable');
      const saml = new SAMLCtor({
        entryPoint: config.metadataUrl || '',
        issuer: config.entityId || entityId,
        callbackUrl: config.acsUrl || acsUrl,
        cert,
      });
      return await new Promise<string>((resolve, reject) => {
        saml.getAuthorizeUrl({}, {}, (err: any, url: string) =>
          err ? reject(err) : resolve(url),
        );
      });
    } catch (err) {
      this.logger.warn(`passport-saml unavailable or failed (${(err as Error).message}); returning stub URL`);
      // Scaffold fallback — admins will see this URL in the browser and know the lib is missing.
      const params = new URLSearchParams({
        SAMLRequest: 'SCAFFOLD_REQUEST',
        RelayState: tenant.id,
      });
      return `${config.metadataUrl || '#sso-not-configured'}?${params.toString()}`;
    }
  }

  /**
   * Validate a SAMLResponse and extract a profile. Delegates to passport-saml.
   */
  async validateSamlCallback(tenantSlug: string, samlResponseB64: string): Promise<SsoCallbackProfile> {
    const { config } = await this.getConfigByTenantSlug(tenantSlug);
    if (!config || config.provider !== 'SAML') {
      throw new BadRequestException('SAML SSO is not configured');
    }
    const cert = decryptSecret(config.x509Cert) ?? '';
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const passportSaml: any = require('passport-saml');
      const SAMLCtor = passportSaml?.SAML ?? passportSaml?.default?.SAML;
      if (!SAMLCtor) throw new Error('passport-saml SAML class unavailable');
      const saml = new SAMLCtor({
        issuer: config.entityId || '',
        callbackUrl: config.acsUrl || '',
        cert,
      });
      const profile: any = await new Promise((resolve, reject) => {
        saml.validatePostResponse(
          { SAMLResponse: samlResponseB64 },
          (err: any, p: any) => (err ? reject(err) : resolve(p)),
        );
      });
      const email = (profile?.email || profile?.nameID || '').toString().toLowerCase();
      if (!email) throw new UnauthorizedException('SAML response did not contain an email/nameID');
      return {
        email,
        nameId: profile?.nameID,
        displayName: profile?.displayName ?? profile?.cn ?? null,
        raw: profile,
      };
    } catch (err) {
      this.logger.error(`SAML validation failed: ${(err as Error).message}`);
      throw new UnauthorizedException('SAML response validation failed');
    }
  }

  // ---------------------------------------------------------------------------
  // OIDC
  // ---------------------------------------------------------------------------

  async buildOidcLoginUrl(tenantSlug: string, baseUrl: string): Promise<{ url: string; state: string; nonce: string }> {
    const { config } = await this.getConfigByTenantSlug(tenantSlug);
    if (!config || !config.enabled || config.provider !== 'OIDC') {
      throw new BadRequestException('OIDC SSO is not enabled for this tenant');
    }
    const { oidcRedirectUri } = this.buildServiceProviderMetadata(tenantSlug, baseUrl);
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Issuer, generators }: any = require('openid-client');
      const issuer = await Issuer.discover(config.oidcIssuer!);
      const client = new issuer.Client({
        client_id: config.oidcClientId!,
        client_secret: decryptSecret(config.oidcClientSecret) ?? '',
        redirect_uris: [oidcRedirectUri],
        response_types: ['code'],
      });
      const state = generators.state();
      const nonce = generators.nonce();
      const url = client.authorizationUrl({
        scope: 'openid email profile',
        state,
        nonce,
      });
      return { url, state, nonce };
    } catch (err) {
      this.logger.warn(`openid-client unavailable or discovery failed (${(err as Error).message}); returning stub URL`);
      const stub = `${config.oidcIssuer || '#oidc-not-configured'}/authorize?client_id=${encodeURIComponent(config.oidcClientId || '')}&redirect_uri=${encodeURIComponent(oidcRedirectUri)}&response_type=code&scope=openid+email+profile`;
      return { url: stub, state: 'stub', nonce: 'stub' };
    }
  }

  async validateOidcCallback(
    tenantSlug: string,
    params: { code?: string; state?: string; [k: string]: any },
    baseUrl: string,
    expected?: { state?: string; nonce?: string },
  ): Promise<SsoCallbackProfile> {
    const { config } = await this.getConfigByTenantSlug(tenantSlug);
    if (!config || config.provider !== 'OIDC') {
      throw new BadRequestException('OIDC SSO is not configured');
    }
    const { oidcRedirectUri } = this.buildServiceProviderMetadata(tenantSlug, baseUrl);
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Issuer }: any = require('openid-client');
      const issuer = await Issuer.discover(config.oidcIssuer!);
      const client = new issuer.Client({
        client_id: config.oidcClientId!,
        client_secret: decryptSecret(config.oidcClientSecret) ?? '',
        redirect_uris: [oidcRedirectUri],
        response_types: ['code'],
      });
      const tokenSet = await client.callback(oidcRedirectUri, params, {
        state: expected?.state,
        nonce: expected?.nonce,
      });
      const userinfo = await client.userinfo(tokenSet.access_token!);
      const email = (userinfo?.email || '').toString().toLowerCase();
      if (!email) throw new UnauthorizedException('OIDC userinfo did not contain an email');
      return {
        email,
        nameId: (userinfo?.sub as string) ?? undefined,
        displayName: (userinfo?.name as string) ?? null,
        raw: userinfo,
      };
    } catch (err) {
      this.logger.error(`OIDC validation failed: ${(err as Error).message}`);
      throw new UnauthorizedException('OIDC callback validation failed');
    }
  }

  // ---------------------------------------------------------------------------
  // Provision / mint JWT
  // ---------------------------------------------------------------------------

  /**
   * Resolve the local User from an SSO profile. If auto-provisioning is enabled
   * and the email matches the tenant's allowed domain, a new User is created
   * with the configured defaultRole and a random (unusable) password hash.
   */
  async resolveOrProvisionUser(tenantId: string, profile: SsoCallbackProfile) {
    const { config } = await this.getConfigByTenantSlug(
      (await this.prisma.client.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } }))?.slug || '',
    );
    const email = profile.email.toLowerCase();
    let user = await this.prisma.client.user.findUnique({ where: { email } });

    if (!user) {
      if (!config?.autoProvision) {
        throw new UnauthorizedException(
          `No local account exists for ${email}. Ask your admin to enable auto-provisioning or invite you first.`,
        );
      }
      if (config.allowedEmailDomain) {
        const domain = email.split('@')[1] ?? '';
        if (domain.toLowerCase() !== config.allowedEmailDomain.toLowerCase()) {
          throw new UnauthorizedException(
            `Email domain "${domain}" is not allowed for this tenant`,
          );
        }
      }
      user = await this.prisma.client.user.create({
        data: {
          tenantId,
          email,
          // Random unusable password hash — SSO users cannot password-login.
          passwordHash: `sso:${Math.random().toString(36).slice(2)}:${Date.now()}`,
          role: config.defaultRole || 'RESTRICTED_VIEWER',
        },
      });
    } else if (user.tenantId !== tenantId) {
      throw new UnauthorizedException(
        'This email is registered under a different tenant',
      );
    }

    // HIGH-4 audit fix: refuse SSO login for users still in the INVITED
    // state. They must accept their invite and set a password before they
    // can authenticate via any path (regular login already gates this in
    // auth.service.ts after the previous critical-batch fix).
    if ((user as any).status && (user as any).status !== 'ACTIVE') {
      throw new UnauthorizedException(
        'This account is pending activation. Check your invite email to finish signup.',
      );
    }

    return user;
  }

  /**
   * Mint a JWT with the same payload shape as AuthService.login().
   */
  async mintJwtForUser(user: { id: string; email: string; tenantId: string; role: string; canTriggerPanic?: boolean }) {
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: user.tenantId },
      select: { slug: true },
    });
    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      canTriggerPanic: !!user.canTriggerPanic,
    };
    return {
      access_token: this.jwt.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        tenantSlug: tenant?.slug || user.tenantId,
        canTriggerPanic: !!user.canTriggerPanic,
      },
    };
  }

  /**
   * Full callback happy-path: validate provider response, resolve/provision
   * user, mint JWT, audit-log the event.
   */
  async completeSsoLogin(
    tenantSlug: string,
    provider: SsoProvider,
    profile: SsoCallbackProfile,
  ) {
    const { tenant, config } = await this.getConfigByTenantSlug(tenantSlug);
    if (!config || config.provider !== provider) {
      throw new BadRequestException(`${provider} is not configured for this tenant`);
    }
    const user = await this.resolveOrProvisionUser(tenant.id, profile);
    const minted = await this.mintJwtForUser(user);

    // Best-effort audit log — do not fail login if logging fails.
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          action: 'SSO_LOGIN',
          targetType: 'User',
          targetId: user.id,
          details: JSON.stringify({ provider, email: profile.email }),
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to write SSO_LOGIN audit log: ${(err as Error).message}`);
    }

    return minted;
  }

  // ---------------------------------------------------------------------------
  // Test-connection helper
  // ---------------------------------------------------------------------------

  async testConnection(tenantSlug: string): Promise<{ ok: boolean; message: string }> {
    const { config } = await this.getConfigByTenantSlug(tenantSlug);
    if (!config) return { ok: false, message: 'No SSO config set' };
    if (config.provider === 'SAML') {
      if (!config.metadataUrl && !config.x509Cert) {
        return { ok: false, message: 'SAML requires metadataUrl and/or x509Cert' };
      }
      return { ok: true, message: 'SAML config looks complete (not contacting IdP in scaffold mode)' };
    }
    if (config.provider === 'OIDC') {
      if (!config.oidcIssuer || !config.oidcClientId || !config.oidcClientSecret) {
        return { ok: false, message: 'OIDC requires issuer, clientId, and clientSecret' };
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Issuer }: any = require('openid-client');
        await Issuer.discover(config.oidcIssuer);
        return { ok: true, message: `Discovered OIDC issuer ${config.oidcIssuer}` };
      } catch (err) {
        return { ok: false, message: `OIDC discovery failed: ${(err as Error).message}` };
      }
    }
    return { ok: false, message: 'Unknown provider' };
  }

  /** Exposed only for tests/admin tools. */
  _encrypt = encryptSecret;
  _decrypt = decryptSecret;
  _allowedRoles: AppRole[] = [
    'SUPER_ADMIN',
    'DISTRICT_ADMIN',
    'SCHOOL_ADMIN',
    'CONTRIBUTOR',
    'RESTRICTED_VIEWER',
  ];
}
