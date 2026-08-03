import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { SsoService } from './sso.service';
import { PrismaService } from '../prisma/prisma.service';
import { UnauthorizedException, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { encryptSecret, decryptSecret } from './sso.crypto';

describe('SsoService', () => {
  let service: SsoService;
  let prismaMock: any;
  let jwtMock: any;

  const tenant = { id: 'tenant-1', slug: 'acme-district' };

  beforeEach(async () => {
    prismaMock = {
      client: {
        // upsertConfig / deleteConfig (added 2026-05-23) wrap the upsert +
        // audit-log write in an interactive `$transaction(async (tx) => …)`
        // so a failed audit rolls back the SSO state change. The mock runs
        // the callback with the same mock client as `tx`, so the existing
        // tenantSSOConfig.upsert / auditLog.create mocks below are exercised
        // exactly as in production.
        $transaction: jest.fn(async (cb: any) => cb(prismaMock.client)),
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
      // config is non-null here — this test seeds a SAML config via the
      // findUnique mock above. Non-null assertion keeps strict-null tsc happy.
      expect(res.config!.provider).toBe('SAML');
    });
  });

  // Audit 34-supplychain P0-1 stopgap (CVE-2025-54419): the unauthenticated
  // SAML callback must reject unless an ENABLED SAML config exists. Before
  // the fix it only checked provider==='SAML', leaving the vulnerable
  // passport-saml validatePostResponse reachable for any tenant with a SAML
  // config row that was never turned on.
  describe('validateSamlCallback — enabled-config gate', () => {
    it('rejects when no SSO config exists', async () => {
      prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.validateSamlCallback(tenant.slug, 'base64SAMLResponse'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the SAML config exists but is DISABLED (enabled=false)', async () => {
      prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValueOnce({
        id: 'c1',
        provider: 'SAML',
        enabled: false,
        x509Cert: null,
      });
      // Must throw BEFORE ever calling passport-saml's validatePostResponse.
      await expect(
        service.validateSamlCallback(tenant.slug, 'base64SAMLResponse'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the configured provider is OIDC, not SAML', async () => {
      prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValueOnce({
        id: 'c1',
        provider: 'OIDC',
        enabled: true,
      });
      await expect(
        service.validateSamlCallback(tenant.slug, 'base64SAMLResponse'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('upsertConfig', () => {
    it('rejects invalid provider', async () => {
      await expect(
        service.upsertConfig(tenant.id, { provider: 'BOGUS' as any, enabled: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('encrypts oidcClientSecret before persisting', async () => {
      await service.upsertConfig(
        tenant.id,
        {
          provider: 'OIDC',
          enabled: true,
          oidcIssuer: 'https://idp.example.com',
          oidcClientId: 'client-abc',
          oidcClientSecret: 'very-secret',
        },
        'district-admin-id',
        // ACC-01: arming a login path now requires an identified actor for
        // BOTH providers (it already did for SAML — see the x509 test below).
        // This test exercises the persist+encrypt path, so it must pass the gate.
        'DISTRICT_ADMIN',
      );
      const upsertArgs = prismaMock.client.tenantSSOConfig.upsert.mock.calls[0][0];
      expect(upsertArgs.create.oidcClientSecret).toBeTruthy();
      expect(upsertArgs.create.oidcClientSecret).not.toBe('very-secret');
      expect(decryptSecret(upsertArgs.create.oidcClientSecret)).toBe('very-secret');
    });

    it('encrypts x509Cert before persisting', async () => {
      await service.upsertConfig(
        tenant.id,
        {
          provider: 'SAML',
          enabled: true,
          x509Cert: '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----',
        },
        'super-admin-id',
        // SUPER_ADMIN required to ARM SAML (F-1 / CVE-2025-54419 interim
        // control). This test exercises the persist+encrypt path, so it
        // must pass the gate.
        'SUPER_ADMIN',
      );
      const args = prismaMock.client.tenantSSOConfig.upsert.mock.calls[0][0];
      expect(args.create.x509Cert).toBeTruthy();
      expect(args.create.x509Cert).not.toContain('BEGIN CERTIFICATE');
    });

    it('blocks a DISTRICT_ADMIN from arming SAML (enabled:true) — F-1 / CVE-2025-54419', async () => {
      await expect(
        service.upsertConfig(
          tenant.id,
          { provider: 'SAML', enabled: true },
          'district-admin-id',
          'DISTRICT_ADMIN',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // No config row was written — fail-closed.
      expect(prismaMock.client.tenantSSOConfig.upsert).not.toHaveBeenCalled();
      // The denied arm attempt is forensically logged.
      const auditCalls = prismaMock.client.auditLog.create.mock.calls;
      expect(
        auditCalls.some(
          (c: any[]) => c[0]?.data?.action === 'SSO_SAML_ENABLE_DENIED',
        ),
      ).toBe(true);
    });

    it('lets a DISTRICT_ADMIN store SAML config while DISABLED', async () => {
      await service.upsertConfig(
        tenant.id,
        {
          provider: 'SAML',
          enabled: false,
          x509Cert: '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----',
        },
        'district-admin-id',
        'DISTRICT_ADMIN',
      );
      expect(prismaMock.client.tenantSSOConfig.upsert).toHaveBeenCalled();
    });

    it('lets a DISTRICT_ADMIN arm OIDC (provider:OIDC unaffected by the SAML gate)', async () => {
      await service.upsertConfig(
        tenant.id,
        {
          provider: 'OIDC',
          enabled: true,
          oidcIssuer: 'https://idp.example.com',
          oidcClientId: 'client-abc',
          oidcClientSecret: 'very-secret',
        },
        'district-admin-id',
        'DISTRICT_ADMIN',
      );
      expect(prismaMock.client.tenantSSOConfig.upsert).toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // ACC-01 (CRITICAL, 2026-08-01) — PRIVILEGE ESCALATION TO SUPER_ADMIN
  //
  // The full attack chain this suite closes:
  //   1. POST /api/v1/signup                → self-serve DISTRICT_ADMIN,
  //                                           ACTIVE, no approval/verification
  //   2. POST /tenants/<own-slug>/sso       → { provider:'OIDC', enabled:true,
  //                                             autoProvision:true,
  //                                             defaultRole:'SUPER_ADMIN',
  //                                             oidcIssuer:<attacker IdP> }
  //                                           — stored VERBATIM (no validation
  //                                             pipe, no role policy)
  //   3. log in through the attacker's IdP  → user.create({ role:'SUPER_ADMIN' })
  //                                           then a SUPER_ADMIN JWT
  //   → RbacGuard passes everything, requireTenantId() returns null (no tenant
  //     filter at all), and POST /emergency/trigger works against ANY scope.
  //
  // Root cause: `assertCallerCanAssignRole` was imported by exactly two files
  // (users.controller, onboarding.service). The SSO module never called it.
  // ══════════════════════════════════════════════════════════════════════
  describe('ACC-01 — SSO defaultRole cannot escalate privilege', () => {
    const attackerConfig = (defaultRole: string) => ({
      provider: 'OIDC' as const,
      enabled: true,
      autoProvision: true,
      oidcIssuer: 'https://idp.attacker.example',
      oidcClientId: 'client-abc',
      oidcClientSecret: 'very-secret',
      defaultRole: defaultRole as any,
    });

    it('REJECTS a DISTRICT_ADMIN setting defaultRole:SUPER_ADMIN', async () => {
      await expect(
        service.upsertConfig(
          tenant.id,
          attackerConfig('SUPER_ADMIN'),
          'attacker-user-id',
          'DISTRICT_ADMIN',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // Fail CLOSED — nothing written, so no partial/poisoned row survives.
      expect(prismaMock.client.tenantSSOConfig.upsert).not.toHaveBeenCalled();
      // ...and the attempt is in the immutable trail.
      expect(
        prismaMock.client.auditLog.create.mock.calls.some(
          (c: any[]) => c[0]?.data?.action === 'SSO_DEFAULT_ROLE_DENIED',
        ),
      ).toBe(true);
    });

    it('REJECTS even a SUPER_ADMIN setting defaultRole:SUPER_ADMIN (tenant-scoped ceiling)', async () => {
      // SUPER_ADMIN is a platform-owner role; no tenant-scoped surface may
      // grant it, no matter who asks. Mirrors ApiKeysService.ALLOWED_ROLES.
      await expect(
        service.upsertConfig(
          tenant.id,
          attackerConfig('SUPER_ADMIN'),
          'super-admin-id',
          'SUPER_ADMIN',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.client.tenantSSOConfig.upsert).not.toHaveBeenCalled();
    });

    it('REJECTS a DISTRICT_ADMIN granting its own rank (DISTRICT_ADMIN)', async () => {
      // Rank rule: a caller may only assign STRICTLY BELOW itself.
      await expect(
        service.upsertConfig(
          tenant.id,
          attackerConfig('DISTRICT_ADMIN'),
          'attacker-user-id',
          'DISTRICT_ADMIN',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('REJECTS an unidentified caller (fails closed)', async () => {
      await expect(
        service.upsertConfig(tenant.id, attackerConfig('CONTRIBUTOR'), null, null),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ALLOWS the legitimate defaults — RESTRICTED_VIEWER and CONTRIBUTOR', async () => {
      for (const role of ['RESTRICTED_VIEWER', 'CONTRIBUTOR']) {
        prismaMock.client.tenantSSOConfig.upsert.mockClear();
        await service.upsertConfig(
          tenant.id,
          attackerConfig(role),
          'district-admin-id',
          'DISTRICT_ADMIN',
        );
        const args = prismaMock.client.tenantSSOConfig.upsert.mock.calls[0][0];
        expect(args.create.defaultRole).toBe(role);
      }
    });

    it('ALLOWS a DISTRICT_ADMIN granting SCHOOL_ADMIN (one rank below)', async () => {
      await service.upsertConfig(
        tenant.id,
        attackerConfig('SCHOOL_ADMIN'),
        'district-admin-id',
        'DISTRICT_ADMIN',
      );
      expect(prismaMock.client.tenantSSOConfig.upsert).toHaveBeenCalled();
    });

    it('defaults to RESTRICTED_VIEWER when no defaultRole is supplied', async () => {
      await service.upsertConfig(
        tenant.id,
        {
          provider: 'OIDC',
          enabled: true,
          oidcIssuer: 'https://idp.example.com',
          oidcClientId: 'client-abc',
          oidcClientSecret: 'very-secret',
        },
        'district-admin-id',
        'DISTRICT_ADMIN',
      );
      const args = prismaMock.client.tenantSSOConfig.upsert.mock.calls[0][0];
      expect(args.create.defaultRole).toBe('RESTRICTED_VIEWER');
    });
  });

  // ACC-01 layer 4 — arming an OIDC login path is now an explicit, audited
  // authorization step, exactly as arming SAML already was. The ASYMMETRY was
  // the bug: OIDC had no arm check at all.
  describe('ACC-01 — arming an OIDC login path', () => {
    const complete = {
      provider: 'OIDC' as const,
      enabled: true,
      oidcIssuer: 'https://idp.example.com',
      oidcClientId: 'client-abc',
      oidcClientSecret: 'very-secret',
    };

    it('REJECTS a role that may not own a tenant login path (SCHOOL_ADMIN)', async () => {
      await expect(
        service.upsertConfig(tenant.id, complete, 'school-admin-id', 'SCHOOL_ADMIN'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.client.tenantSSOConfig.upsert).not.toHaveBeenCalled();
      expect(
        prismaMock.client.auditLog.create.mock.calls.some(
          (c: any[]) => c[0]?.data?.action === 'SSO_OIDC_ENABLE_DENIED',
        ),
      ).toBe(true);
    });

    it('REFUSES to arm an INCOMPLETE OIDC config (no silent stub login)', async () => {
      // buildOidcLoginUrl falls through its catch to a non-functional stub
      // authorize URL when discovery fails — a login that LOOKS armed and is
      // not. Refuse at the arm step instead.
      await expect(
        service.upsertConfig(
          tenant.id,
          { provider: 'OIDC', enabled: true, oidcIssuer: 'https://idp.example.com' },
          'district-admin-id',
          'DISTRICT_ADMIN',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.client.tenantSSOConfig.upsert).not.toHaveBeenCalled();
    });

    it('ALLOWS arming when the secret was stored on an EARLIER save', async () => {
      // The DTO omits oidcClientSecret to mean "leave it alone"; the gate must
      // consult the stored row rather than demand a re-paste of the secret.
      prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValueOnce({
        oidcClientSecret: 'already-encrypted-blob',
      });
      await service.upsertConfig(
        tenant.id,
        {
          provider: 'OIDC',
          enabled: true,
          oidcIssuer: 'https://idp.example.com',
          oidcClientId: 'client-abc',
        },
        'district-admin-id',
        'DISTRICT_ADMIN',
      );
      expect(prismaMock.client.tenantSSOConfig.upsert).toHaveBeenCalled();
    });

    it('records an SSO_OIDC_ENABLE_ALLOWED forensic row on a successful arm', async () => {
      await service.upsertConfig(tenant.id, complete, 'district-admin-id', 'DISTRICT_ADMIN');
      expect(
        prismaMock.client.auditLog.create.mock.calls.some(
          (c: any[]) => c[0]?.data?.action === 'SSO_OIDC_ENABLE_ALLOWED',
        ),
      ).toBe(true);
    });

    it('lets a DISTRICT_ADMIN STORE an OIDC config while disabled (no arm gate)', async () => {
      await service.upsertConfig(
        tenant.id,
        { provider: 'OIDC', enabled: false, oidcIssuer: 'https://idp.example.com' },
        'district-admin-id',
        'DISTRICT_ADMIN',
      );
      expect(prismaMock.client.tenantSSOConfig.upsert).toHaveBeenCalled();
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

    // ── ACC-01, defence in depth at the PROVISIONING site ─────────────────
    // The write-side gate is the primary control, but this is the line that
    // actually mints privilege and must be safe alone: a row poisoned BEFORE
    // the fix shipped, restored from an old backup, or written by a direct
    // SQL/Prisma-Studio edit must still not be able to create a platform-owner.
    describe('ACC-01 — a PRE-POISONED config row cannot provision a SUPER_ADMIN', () => {
      it('clamps a stored defaultRole of SUPER_ADMIN down to RESTRICTED_VIEWER', async () => {
        prismaMock.client.user.findUnique.mockResolvedValueOnce(null);
        prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValueOnce({
          autoProvision: true,
          allowedEmailDomain: 'acme.edu',
          defaultRole: 'SUPER_ADMIN', // poisoned at rest
        });

        await service.resolveOrProvisionUser(tenant.id, { email: 'attacker@acme.edu' });

        const createArgs = prismaMock.client.user.create.mock.calls[0][0];
        expect(createArgs.data.role).toBe('RESTRICTED_VIEWER');
        expect(createArgs.data.role).not.toBe('SUPER_ADMIN');
        // The clamp is loud — an operator must be able to find the poisoned row.
        expect(
          prismaMock.client.auditLog.create.mock.calls.some(
            (c: any[]) => c[0]?.data?.action === 'SSO_DEFAULT_ROLE_CLAMPED',
          ),
        ).toBe(true);
      });

      it('clamps any junk/unknown stored role too', async () => {
        prismaMock.client.user.findUnique.mockResolvedValueOnce(null);
        prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValueOnce({
          autoProvision: true,
          defaultRole: 'ROOT',
        });
        await service.resolveOrProvisionUser(tenant.id, { email: 'x@acme.edu' });
        expect(prismaMock.client.user.create.mock.calls[0][0].data.role).toBe(
          'RESTRICTED_VIEWER',
        );
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // ACC-04 — turning SSO OFF must turn SSO LOGIN off.
  // `buildOidcLoginUrl` required `enabled`, but the two paths that actually
  // MINT a session (validateOidcCallback, completeSsoLogin) checked only the
  // provider — so disabling OIDC in the dashboard left the IdP round-trip
  // fully live against the callback URL.
  // ══════════════════════════════════════════════════════════════════════
  describe('ACC-04 — disabling OIDC disables OIDC login', () => {
    it('validateOidcCallback rejects when the config is DISABLED', async () => {
      prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValueOnce({
        provider: 'OIDC',
        enabled: false,
        oidcIssuer: 'https://idp.example.com',
      });
      await expect(
        service.validateOidcCallback(
          tenant.slug,
          { code: 'abc', state: 's' },
          'https://api.example.com',
          { state: 's', nonce: 'n' },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('completeSsoLogin rejects when the config is DISABLED', async () => {
      prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValue({
        provider: 'OIDC',
        enabled: false,
        autoProvision: true,
        defaultRole: 'CONTRIBUTOR',
      });
      await expect(
        service.completeSsoLogin(tenant.slug, 'OIDC', { email: 'x@acme.edu' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      // No user was provisioned and no token minted.
      expect(prismaMock.client.user.create).not.toHaveBeenCalled();
      expect(jwtMock.sign).not.toHaveBeenCalled();
    });
  });

  // ACC-05 — an archived (retired) tenant must not be able to mint a session
  // by ANY route. The password path is covered in auth.service.spec.
  describe('ACC-05 — archived tenants cannot log in via SSO', () => {
    it('rejects completeSsoLogin when the tenant is archived', async () => {
      prismaMock.client.tenant.findUnique.mockResolvedValue({
        ...tenant,
        archivedAt: new Date(),
      });
      prismaMock.client.tenantSSOConfig.findUnique.mockResolvedValue({
        provider: 'OIDC',
        enabled: true,
        autoProvision: true,
        defaultRole: 'CONTRIBUTOR',
      });
      await expect(
        service.completeSsoLogin(tenant.slug, 'OIDC', { email: 'x@acme.edu' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(jwtMock.sign).not.toHaveBeenCalled();
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
        // ACC-04: `enabled` is now required on the login-completion path too
        // (it used to be checked only when BUILDING the login URL).
        enabled: true,
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
