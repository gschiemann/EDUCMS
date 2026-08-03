/**
 * ACC-01 — the EDGE layer of the SSO privilege-escalation fix.
 *
 * `POST /api/v1/tenants/:tenantSlug/sso` took a BARE `@Body() dto:
 * SsoConfigDto` — a compile-time-only interface with NO validation pipe. The
 * runtime therefore accepted arbitrary JSON, and `defaultRole` was written to
 * the DB verbatim: `{"defaultRole":"SUPER_ADMIN"}` was stored and later handed
 * straight to `user.create({ role: config.defaultRole })`.
 *
 * The schema below is layer 2 of 5 (pipe → caller-rank policy → tenant ceiling
 * → arm gate → provisioning-site clamp). It is NOT the only gate — the service
 * re-checks against the caller's own rank — but it is the one that stops the
 * escalation payload at the door.
 */
import { SsoConfigSchema, SSO_ASSIGNABLE_DEFAULT_ROLES } from './sso.types';
import { TENANT_ASSIGNABLE_ROLES } from '../auth/role-assignment';

const base = {
  provider: 'OIDC' as const,
  enabled: true,
  oidcIssuer: 'https://idp.example.com',
  oidcClientId: 'client-abc',
  oidcClientSecret: 'very-secret',
};

describe('SsoConfigSchema (ACC-01)', () => {
  it('REJECTS the escalation payload defaultRole:SUPER_ADMIN', () => {
    const res = SsoConfigSchema.safeParse({ ...base, defaultRole: 'SUPER_ADMIN' });
    expect(res.success).toBe(false);
  });

  it('REJECTS an unknown role string', () => {
    expect(SsoConfigSchema.safeParse({ ...base, defaultRole: 'ROOT' }).success).toBe(false);
    expect(SsoConfigSchema.safeParse({ ...base, defaultRole: '' }).success).toBe(false);
  });

  it('ACCEPTS every legitimate auto-provisioning role', () => {
    for (const role of SSO_ASSIGNABLE_DEFAULT_ROLES) {
      expect(SsoConfigSchema.safeParse({ ...base, defaultRole: role }).success).toBe(true);
    }
  });

  it('keeps the SSO ceiling identical to the shared tenant-scoped ceiling', () => {
    // Drift here is exactly how ACC-01 happened: one surface (API keys) had
    // the rule, another (SSO) did not.
    expect([...SSO_ASSIGNABLE_DEFAULT_ROLES]).toEqual([...TENANT_ASSIGNABLE_ROLES]);
    expect(SSO_ASSIGNABLE_DEFAULT_ROLES).not.toContain('SUPER_ADMIN');
  });

  it('rejects an invalid provider and unknown keys (.strict)', () => {
    expect(SsoConfigSchema.safeParse({ ...base, provider: 'BOGUS' }).success).toBe(false);
    expect(SsoConfigSchema.safeParse({ ...base, isAdmin: true }).success).toBe(false);
  });

  it('caps secret/cert lengths so a huge body cannot reach the AES seal', () => {
    expect(
      SsoConfigSchema.safeParse({ ...base, oidcClientSecret: 'x'.repeat(4097) }).success,
    ).toBe(false);
    expect(
      SsoConfigSchema.safeParse({ provider: 'SAML', x509Cert: 'x'.repeat(32_769) }).success,
    ).toBe(false);
  });

  it('accepts a normal config (no regression for real operators)', () => {
    const res = SsoConfigSchema.safeParse({
      ...base,
      defaultRole: 'CONTRIBUTOR',
      allowedEmailDomain: 'acme.edu',
      autoProvision: true,
    });
    expect(res.success).toBe(true);
  });

  it('keeps the pre-Zod contract that an omitted `enabled` means off', () => {
    const res = SsoConfigSchema.safeParse({ provider: 'OIDC' });
    expect(res.success).toBe(true);
    expect((res as any).data.enabled).toBeUndefined(); // service coerces via !!dto.enabled
  });

  it('allows null for the optional string fields (clearing a value)', () => {
    const res = SsoConfigSchema.safeParse({
      provider: 'SAML',
      enabled: false,
      metadataUrl: null,
      entityId: null,
      acsUrl: null,
      x509Cert: null,
    });
    expect(res.success).toBe(true);
  });
});
