import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { SsoService } from './sso.service';
import { PrismaService } from '../prisma/prisma.service';
import { UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { encryptSecret, decryptSecret } from './sso.crypto';

describe('SsoService', () => {
  let service: SsoService;
  let prismaMock: any;
  let jwtMock: any;

  const tenant = { id: 'tenant-1', slug: 'acme-district' };

  beforeEach(async () => {
    prismaMock = {
      client: {
        tenant: {
          findUnique: jest.fn(async ({ where }: any) => {
            if (where?.slug === tenant.slug || where?.id === tenant.id) return tenant;
            return null;
          }),
        },
        tenantSSOConfig: {
          findUnique: jest.fn(),
          upsert: jest.fn(async ({ create, update, where }) => ({
            id: 'sso-1',
            tenantId: where.tenantId,
            ...create,
            ...update,
          })),
          delete: jest.fn(),
        },
        user: {
          findUnique: jest.fn(),
          create: jest.fn(async ({ data }: any) => ({ id: 'user-new', ...data })),
        },
        auditLog: {
          create: jest.fn().mockResolvedValue({}),
        },
      },
    };

    jwtMock = { sign: jest.fn().mockReturnValue('signed.jwt.token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SsoService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: JwtService, useValue: jwtMock },
      ],
    }).compile();

    service = module.get(SsoService);
  });

  describe('encryption round-trip', () => {
    it('encrypts and decrypts secrets reversibly', () => {
      const plain = 'super-secret-client-secret';
      const enc = encryptSecret(plain);
      expect(enc).not.toBeNull();
      expect(enc).not.toContain(plain);
      expect(decryptSecret(enc)).toBe(plain);
    });

    it('returns null for empty inputs', () => {
      expect(encryptSecret('')).toBeNull();
      expect(encryptSecret(null)).toBeNull();
      expect(decryptSecret(null)).toBeNull();
    });

    it('returns null for corrupted ciphertext', () => {
      expect(decryptSecret('not-real-ciphertext')).toBeNull();
    });
  });

  describe('getConfigByTenantSlug', () => {
    it('throws NotFoundException for unknown tenant', async () => {
      prismaMock.client.tenant.findUnique.mockResolvedValueOnce(null);
      await expect(service.getConfigByTenantSlug('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns tenant + config when present', async () => {
      prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValueOnce({ id: 'c1', provider: 'SAML' });
      const res = await service.getConfigByTenantSlug(tenant.slug);
      expect(res.tenant.id).toBe(tenant.id);
      expect(res.config.provider).toBe('SAML');
    });
  });

  describe('upsertConfig', () => {
    it('rejects invalid provider', async () => {
      await expect(
        service.upsertConfig(tenant.id, { provider: 'BOGUS' as any, enabled: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('encrypts oidcClientSecret before persisting', async () => {
      await service.upsertConfig(tenant.id, {
        provider: 'OIDC',
        enabled: true,
        oidcIssuer: 'https://idp.example.com',
        oidcClientId: 'client-abc',
        oidcClientSecret: 'very-secret',
      });
      const upsertArgs = prismaMock.client.tenantSSOConfig.upsert.mock.calls[0][0];
      expect(upsertArgs.create.oidcClientSecret).toBeTruthy();
      expect(upsertArgs.create.oidcClientSecret).not.toBe('very-secret');
      expect(decryptSecret(upsertArgs.create.oidcClientSecret)).toBe('very-secret');
    });

    it('encrypts x509Cert before persisting', async () => {
      await service.upsertConfig(tenant.id, {
        provider: 'SAML',
        enabled: true,
        x509Cert: '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----',
      });
      const args = prismaMock.client.tenantSSOConfig.upsert.mock.calls[0][0];
      expect(args.create.x509Cert).toBeTruthy();
      expect(args.create.x509Cert).not.toContain('BEGIN CERTIFICATE');
    });
  });

  describe('toSafeConfig', () => {
    it('strips secret values and replaces with boolean flags', () => {
      const safe = service.toSafeConfig({
        id: 'c1',
        tenantId: tenant.id,
        provider: 'OIDC',
        enabled: true,
        x509Cert: 'encrypted-blob',
        oidcClientSecret: 'encrypted-blob',
      });
      expect(safe).not.toHaveProperty('x509Cert');
      expect(safe).not.toHaveProperty('oidcClientSecret');
      expect(safe!.hasX509Cert).toBe(true);
      expect(safe!.hasOidcClientSecret).toBe(true);
    });
  });

  describe('buildServiceProviderMetadata', () => {
    it('produces entityId/acsUrl/oidcRedirectUri with the tenant slug embedded', () => {
      const meta = service.buildServiceProviderMetadata('foo', 'https://api.example.com');
      expect(meta.entityId).toContain('/auth/sso/foo/metadata');
      expect(meta.acsUrl).toContain('/auth/sso/foo/saml/callback');
      expect(meta.oidcRedirectUri).toContain('/auth/sso/foo/oidc/callback');
    });
  });

  describe('resolveOrProvisionUser', () => {
    it('returns existing user when email matches tenant', async () => {
      prismaMock.client.user.findUnique.mockResolvedValueOnce({
        id: 'user-existing',
        email: 'jane@acme.edu',
        tenantId: tenant.id,
        role: 'SCHOOL_ADMIN',
      });
      prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValueOnce({
        autoProvision: false,
        defaultRole: 'RESTRICTED_VIEWER',
      });
      const u = await service.resolveOrProvisionUser(tenant.id, { email: 'jane@acme.edu' });
      expect(u.id).toBe('user-existing');
      expect(prismaMock.client.user.create).not.toHaveBeenCalled();
    });

    it('rejects login when user exists under a different tenant', async () => {
      prismaMock.client.user.findUnique.mockResolvedValueOnce({
        id: 'u2',
        email: 'jane@other.edu',
        tenantId: 'tenant-other',
        role: 'CONTRIBUTOR',
      });
      prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValueOnce({
        autoProvision: true,
        defaultRole: 'CONTRIBUTOR',
      });
      await expect(
        service.resolveOrProvisionUser(tenant.id, { email: 'jane@other.edu' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuses to provision when auto-provision is disabled', async () => {
      prismaMock.client.user.findUnique.mockResolvedValueOnce(null);
      prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValueOnce({
        autoProvision: false,
      });
      await expect(
        service.resolveOrProvisionUser(tenant.id, { email: 'new@acme.edu' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('enforces allowedEmailDomain when auto-provisioning', async () => {
      prismaMock.client.user.findUnique.mockResolvedValueOnce(null);
      prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValueOnce({
        autoProvision: true,
        allowedEmailDomain: 'acme.edu',
        defaultRole: 'CONTRIBUTOR',
      });
      await expect(
        service.resolveOrProvisionUser(tenant.id, { email: 'ne@evil.com' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('auto-provisions user with configured defaultRole when domain matches', async () => {
      prismaMock.client.user.findUnique.mockResolvedValueOnce(null);
      prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValueOnce({
        autoProvision: true,
        allowedEmailDomain: 'acme.edu',
        defaultRole: 'CONTRIBUTOR',
      });
      const u = await service.resolveOrProvisionUser(tenant.id, { email: 'new@acme.edu' });
      expect(prismaMock.client.user.create).toHaveBeenCalled();
      const createArgs = prismaMock.client.user.create.mock.calls[0][0];
      expect(createArgs.data.role).toBe('CONTRIBUTOR');
      expect(createArgs.data.tenantId).toBe(tenant.id);
      expect(createArgs.data.passwordHash).toMatch(/^sso:/);
      expect(u.email).toBe('new@acme.edu');
    });
  });

  describe('mintJwtForUser', () => {
    it('signs a JWT with the same payload shape as AuthService.login', async () => {
      const minted = await service.mintJwtForUser({
        id: 'u1',
        email: 'a@b.com',
        tenantId: tenant.id,
        role: 'SCHOOL_ADMIN',
      });
      expect(jwtMock.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'u1',
          email: 'a@b.com',
          tenantId: tenant.id,
          role: 'SCHOOL_ADMIN',
          canTriggerPanic: false,
        }),
      );
      expect(minted.access_token).toBe('signed.jwt.token');
      expect(minted.user.tenantSlug).toBe(tenant.slug);
    });
  });

  describe('completeSsoLogin', () => {
    it('mints a token and writes an audit log on success', async () => {
      prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValue({
        provider: 'OIDC',
        autoProvision: true,
        allowedEmailDomain: 'acme.edu',
        defaultRole: 'CONTRIBUTOR',
      });
      prismaMock.client.user.findUnique.mockResolvedValue(null);

      const res = await service.completeSsoLogin(tenant.slug, 'OIDC', { email: 'x@acme.edu' });

      expect(res.access_token).toBe('signed.jwt.token');
      expect(prismaMock.client.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'SSO_LOGIN', userId: 'user-new' }),
        }),
      );
    });

    it('rejects when the configured provider does not match the callback', async () => {
      prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValue({ provider: 'SAML' });
      await expect(
        service.completeSsoLogin(tenant.slug, 'OIDC', { email: 'x@acme.edu' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('testConnection', () => {
    it('flags incomplete SAML config', async () => {
      prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValueOnce({
        provider: 'SAML',
        metadataUrl: null,
        x509Cert: null,
      });
      const r = await service.testConnection(tenant.slug);
      expect(r.ok).toBe(false);
    });

    it('flags incomplete OIDC config', async () => {
      prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValueOnce({
        provider: 'OIDC',
        oidcIssuer: null,
        oidcClientId: null,
        oidcClientSecret: null,
      });
      const r = await service.testConnection(tenant.slug);
      expect(r.ok).toBe(false);
    });
  });
});
