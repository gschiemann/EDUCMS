/**
 * Launch security re-audit 2026-10-11:
 *   V-2 — an SSO email-domain claim routes / auto-provisions only once
 *         verified (DNS TXT or an audited SUPER_ADMIN override), and a domain
 *         is verified by at most one tenant.
 *   V-3 — OIDC discovery is SSRF-safe, its failure is a 502 (never a redirect
 *         to the typed address), and its error text is generic.
 */
import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { SsoService } from './sso.service';
import { SsoController } from './sso.controller';
import { assertSafeOidcUrl, discoverOidcIssuer } from './oidc-discovery';
import { domainHasVerificationRecord, normalizeEmailDomain, txtRecordFor } from './sso-domain-verification';

const TENANT = { id: 'tenant-1', slug: 'acme' };

function makeService(cfg: any, opts: { verifiedElsewhere?: boolean } = {}) {
  const state: any = { cfg: cfg ? { ...cfg } : null, audits: [] as any[] };
  const client: any = {
    tenant: {
      findUnique: jest.fn(async ({ where }: any) =>
        where?.slug === TENANT.slug || where?.id === TENANT.id ? { ...TENANT, archivedAt: null } : null,
      ),
    },
    tenantSSOConfig: {
      findUnique: jest.fn(async () => (state.cfg ? { ...state.cfg } : null)),
      findFirst: jest.fn(async () => (opts.verifiedElsewhere ? { id: 'other' } : null)),
      update: jest.fn(async ({ data }: any) => {
        state.cfg = { ...state.cfg, ...data };
        return state.cfg;
      }),
      upsert: jest.fn(async ({ create, update }: any) => {
        state.cfg = state.cfg ? { ...state.cfg, ...update } : { ...create };
        return state.cfg;
      }),
    },
    user: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 'u-new', status: 'ACTIVE', ...data })),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        state.audits.push(data);
        return {};
      }),
    },
  };
  client.$transaction = jest.fn(async (cb: any) => cb(client));
  const svc = new SsoService({ client } as any, { sign: () => 'jwt' } as any);
  return { svc, state, client };
}

describe('V-2 — domain verification', () => {
  it('normalizes a domain and refuses anything that is not a plain DNS domain', () => {
    expect(normalizeEmailDomain('@Acme.EDU')).toBe('acme.edu');
    expect(normalizeEmailDomain('acme.edu/x')).toBeNull();
    expect(normalizeEmailDomain('a b.com')).toBeNull();
  });

  it('saving a domain stores it UNVERIFIED with a fresh token', async () => {
    const { svc, state } = makeService(null);
    await svc.upsertConfig(TENANT.id, { provider: 'OIDC', enabled: false, allowedEmailDomain: 'Acme.edu' }, 'u1', 'DISTRICT_ADMIN');
    expect(state.cfg.allowedEmailDomain).toBe('acme.edu');
    expect(state.cfg.domainVerifiedAt).toBeNull();
    expect(state.cfg.domainVerificationToken).toMatch(/^[0-9a-f]{32}$/);
  });

  it('changing the domain clears a previous verification', async () => {
    const { svc, state } = makeService({ tenantId: TENANT.id, allowedEmailDomain: 'acme.edu', domainVerifiedAt: new Date(), domainVerificationMethod: 'dns', domainVerificationToken: 'a'.repeat(32) });
    await svc.upsertConfig(TENANT.id, { provider: 'OIDC', enabled: false, allowedEmailDomain: 'other.edu' }, 'u1', 'DISTRICT_ADMIN');
    expect(state.cfg.domainVerifiedAt).toBeNull();
    expect(state.cfg.domainVerificationToken).not.toBe('a'.repeat(32));
  });

  it('a domain another tenant has verified cannot be claimed (409)', async () => {
    const { svc } = makeService(null, { verifiedElsewhere: true });
    await expect(
      svc.upsertConfig(TENANT.id, { provider: 'OIDC', enabled: false, allowedEmailDomain: 'acme.edu' }, 'u1', 'DISTRICT_ADMIN'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('DNS verify succeeds only with the exact TXT record, and is audited', async () => {
    const token = 'b'.repeat(32);
    const { svc, state } = makeService({ tenantId: TENANT.id, allowedEmailDomain: 'acme.edu', domainVerificationToken: token, domainVerifiedAt: null });
    const miss = await svc.verifyDomain(TENANT.id, {}, 'u1', 'DISTRICT_ADMIN', async () => [['venueos-verification=wrong']]);
    expect(miss.verified).toBe(false);
    expect(state.audits.some((a: any) => a.action === 'SSO_DOMAIN_VERIFY_FAILED')).toBe(true);

    const hit = await svc.verifyDomain(TENANT.id, {}, 'u1', 'DISTRICT_ADMIN', async () => [['v=spf1 -all'], [txtRecordFor(token)]]);
    expect(hit.verified).toBe(true);
    expect(hit.method).toBe('dns');
    expect(state.cfg.domainVerifiedAt).toBeInstanceOf(Date);
    expect(state.audits.some((a: any) => a.action === 'SSO_DOMAIN_VERIFIED')).toBe(true);
  });

  it('a second verify of a domain already verified elsewhere is 409', async () => {
    const token = 'c'.repeat(32);
    const { svc } = makeService({ tenantId: TENANT.id, allowedEmailDomain: 'acme.edu', domainVerificationToken: token, domainVerifiedAt: null }, { verifiedElsewhere: true });
    await expect(
      svc.verifyDomain(TENANT.id, {}, 'u1', 'DISTRICT_ADMIN', async () => [[txtRecordFor(token)]]),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('manual verify: refused for a DISTRICT_ADMIN, allowed + audited with reason for a SUPER_ADMIN', async () => {
    const { svc, state } = makeService({ tenantId: TENANT.id, allowedEmailDomain: 'acme.edu', domainVerificationToken: 'd'.repeat(32), domainVerifiedAt: null });
    await expect(svc.verifyDomain(TENANT.id, { manual: true, reason: 'called IT' }, 'u1', 'DISTRICT_ADMIN')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.verifyDomain(TENANT.id, { manual: true, reason: '' }, 'sa', 'SUPER_ADMIN')).rejects.toBeInstanceOf(BadRequestException);
    const ok = await svc.verifyDomain(TENANT.id, { manual: true, reason: 'Confirmed with district IT by phone' }, 'sa', 'SUPER_ADMIN');
    expect(ok.method).toBe('manual');
    const row = state.audits.find((a: any) => a.action === 'SSO_DOMAIN_MANUALLY_VERIFIED');
    expect(row).toBeTruthy();
    expect(JSON.parse(row.details).reason).toContain('district IT');
  });

  it('auto-provision is refused for an UNVERIFIED domain', async () => {
    const { svc, client } = makeService({ tenantId: TENANT.id, autoProvision: true, allowedEmailDomain: 'acme.edu', domainVerifiedAt: null, defaultRole: 'CONTRIBUTOR' });
    await expect(svc.resolveOrProvisionUser(TENANT.id, { email: 'new@acme.edu' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(client.user.create).not.toHaveBeenCalled();
  });

  it('auto-provision is refused when no domain is claimed at all (any address)', async () => {
    const { svc, client } = makeService({ tenantId: TENANT.id, autoProvision: true, allowedEmailDomain: null, defaultRole: 'CONTRIBUTOR' });
    await expect(svc.resolveOrProvisionUser(TENANT.id, { email: 'ceo@someone-else.com' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(client.user.create).not.toHaveBeenCalled();
  });

  it('domainHasVerificationRecord joins chunked TXT records and treats lookup errors as "not verified"', async () => {
    const token = 'e'.repeat(32);
    const want = txtRecordFor(token);
    expect(await domainHasVerificationRecord('acme.edu', token, async () => [[want.slice(0, 10), want.slice(10)]])).toBe(true);
    expect(await domainHasVerificationRecord('acme.edu', token, async () => { throw new Error('ENOTFOUND'); })).toBe(false);
  });
});

describe('V-3 — OIDC discovery', () => {
  it.each([
    'http://127.0.0.1:6379',
    'https://10.0.0.1',
    'https://[::1]',
    'https://renderer.railway.internal',
    'http://idp.example.com',
    'https://idp.example.com:8443',
    'https://localhost',
  ])('saving issuer %s is a 400', async (issuer) => {
    const { svc } = makeService(null);
    await expect(
      svc.upsertConfig(TENANT.id, { provider: 'OIDC', enabled: false, oidcIssuer: issuer }, 'u1', 'DISTRICT_ADMIN'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts an ordinary public https issuer', () => {
    expect(assertSafeOidcUrl('https://accounts.google.com').hostname).toBe('accounts.google.com');
  });

  it('refuses a discovery document whose endpoints point at a private address', async () => {
    const fetchFn: any = async () => ({
      status: 200,
      body: Buffer.from(JSON.stringify({
        issuer: 'https://idp.example.com',
        authorization_endpoint: 'https://idp.example.com/auth',
        token_endpoint: 'https://169.254.169.254/latest/meta-data',
      })),
    });
    await expect(discoverOidcIssuer('https://idp.example.com', fetchFn)).rejects.toThrow();
  });

  it('a failing issuer on oidc/login is a 502 with no Location header', async () => {
    const { svc } = makeService({
      tenantId: TENANT.id,
      provider: 'OIDC',
      enabled: true,
      oidcIssuer: 'https://idp.invalid-tld-for-test.example',
      oidcClientId: 'cid',
    });
    jest.spyOn(svc as any, 'buildServiceProviderMetadata').mockReturnValue({ oidcRedirectUri: 'https://api.test/cb' });
    const redis: any = { publisher: null };
    const controller = new SsoController(svc, {} as any, redis);
    const res: any = { redirect: jest.fn() };
    const req: any = { protocol: 'https', headers: { host: 'api.test' } };
    // Force discovery to fail without the network.
    const disc = require('./oidc-discovery');
    const spy = jest.spyOn(disc, 'discoverOidcIssuer').mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:443'));
    await expect(controller.oidcLogin(TENANT.slug, req, res)).rejects.toBeInstanceOf(BadGatewayException);
    expect(res.redirect).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('testConnection never echoes the underlying error', async () => {
    const { svc } = makeService({ tenantId: TENANT.id, provider: 'OIDC', oidcIssuer: 'https://idp.example.com', oidcClientId: 'c', oidcClientSecret: 'x' });
    const disc = require('./oidc-discovery');
    const spy = jest.spyOn(disc, 'discoverOidcIssuer').mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:6379'));
    const out = await svc.testConnection(TENANT.slug);
    expect(out.ok).toBe(false);
    expect(out.message).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|6379/);
    spy.mockRestore();
  });
});
