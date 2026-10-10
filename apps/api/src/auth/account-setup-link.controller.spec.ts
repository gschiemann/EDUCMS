/**
 * ONE-TIME ACCOUNT SETUP LINKS — the public half (2026-10-10).
 *
 *   - the link is looked up by sha256(token) only;
 *   - it works ONCE: the redemption is one conditional write, so two
 *     simultaneous clicks produce exactly one session;
 *   - expired / replaced / used links are refused with their own codes;
 *   - preview changes nothing (a mail scanner that opens the page cannot spend it);
 *   - the session it mints is the setup-gated one (`mustSetupCredentials`),
 *     via the real AuthService.login path; every use is audited.
 */
import { AccountSetupLinkController } from './account-setup-link.controller';
import { generateSetupLinkToken, hashSetupLinkToken, setupLinkState, setupLinkUrl } from './account-setup-link';

function harness(over: { link?: Record<string, any>; user?: Record<string, any> | null } = {}) {
  const token = generateSetupLinkToken();
  const link: any = {
    id: 'l1',
    tenantId: 'tulsa',
    userId: 'u1',
    tokenHash: hashSetupLinkToken(token),
    usedAt: null,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 3600_000),
    ...(over.link ?? {}),
  };
  const user =
    over.user === null
      ? null
      : {
          id: 'u1',
          email: 'riot-tulsa@riotcolor.com',
          role: 'SCHOOL_ADMIN',
          tenantId: 'tulsa',
          canTriggerPanic: false,
          firstName: null,
          lastName: null,
          status: 'ACTIVE',
          deletedAt: null,
          mustSetupCredentials: true,
          mfaRequired: false,
          mfaTotpVerifiedAt: null,
          mfaBackupCodes: null,
          tenant: { archivedAt: null, name: 'RIOT Tulsa' },
          _count: { passkeys: 0 },
          ...(over.user ?? {}),
        };
  const audits: any[] = [];
  const findUnique = jest.fn(async ({ where }: any) => (where.tokenHash === link.tokenHash ? { ...link } : null));
  const updateMany = jest.fn(async ({ where, data }: any) => {
    // Compare-and-set, synchronously — the way Postgres serialises the row.
    if (where.id !== link.id || link.usedAt || link.revokedAt || link.expiresAt <= where.expiresAt.gt) return { count: 0 };
    Object.assign(link, data);
    return { count: 1 };
  });
  const prisma: any = {
    client: {
      accountSetupLink: { findUnique, updateMany },
      user: { findFirst: jest.fn(async () => (user ? { ...user } : null)) },
      auditLog: { create: jest.fn(async ({ data }: any) => audits.push(data)) },
    },
  };
  const auth: any = {
    login: jest.fn(async (u: any) => ({
      access_token: 'setup.session',
      user: { id: u.id, mustSetupCredentials: !!u.mustSetupCredentials },
    })),
  };
  const req: any = { headers: { 'user-agent': 'jest' }, ip: '198.51.100.4' };
  return { controller: new AccountSetupLinkController(prisma, auth), token, link, audits, auth, findUnique, req };
}

describe('POST /auth/setup-link/preview', () => {
  it('names the account and changes nothing', async () => {
    const h = harness();
    await expect(h.controller.preview({ token: h.token })).resolves.toEqual({
      email: 'riot-tulsa@riotcolor.com',
      firstName: null,
      organization: 'RIOT Tulsa',
      expiresAt: h.link.expiresAt.toISOString(),
    });
    expect(h.link.usedAt).toBeNull();
    // Looked up by hash, never by the raw token.
    expect(h.findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashSetupLinkToken(h.token) } });
  });

  it('a malformed or unknown token is SETUP_LINK_INVALID', async () => {
    const h = harness();
    await expect(h.controller.preview({ token: 'short' })).rejects.toMatchObject({ response: { code: 'SETUP_LINK_INVALID' } });
    await expect(h.controller.preview({ token: generateSetupLinkToken() })).rejects.toMatchObject({ response: { code: 'SETUP_LINK_INVALID' } });
    expect(h.findUnique).toHaveBeenCalledTimes(1); // the malformed one never reached the database
  });
});

describe('POST /auth/setup-link/redeem', () => {
  it('signs the person in to first-login setup through the real login path, and audits it', async () => {
    const h = harness();
    const out: any = await h.controller.redeem({ token: h.token }, h.req);
    expect(out).toEqual({ access_token: 'setup.session', user: { id: 'u1', mustSetupCredentials: true } });
    expect(h.auth.login).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1', mustSetupCredentials: true }), false);
    expect(h.link.usedAt).toBeInstanceOf(Date);
    expect(h.audits.find((a) => a.action === 'ACCOUNT_SETUP_LINK_USED')).toMatchObject({ userId: 'u1', tenantId: 'tulsa' });
    expect(JSON.stringify(h.audits)).not.toContain(h.token);
  });

  it('SINGLE USE: a second click is SETUP_LINK_USED, and two simultaneous clicks make ONE session', async () => {
    const h = harness();
    const both = await Promise.allSettled([h.controller.redeem({ token: h.token }, h.req), h.controller.redeem({ token: h.token }, h.req)]);
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(h.auth.login).toHaveBeenCalledTimes(1);
    await expect(h.controller.redeem({ token: h.token }, h.req)).rejects.toMatchObject({ response: { code: 'SETUP_LINK_USED' } });
  });

  it('EXPIRY: an expired link is refused and never spent', async () => {
    const h = harness({ link: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(h.controller.redeem({ token: h.token }, h.req)).rejects.toMatchObject({ response: { code: 'SETUP_LINK_EXPIRED' } });
    expect(h.link.usedAt).toBeNull();
    expect(h.auth.login).not.toHaveBeenCalled();
  });

  it('a link replaced by a newer one is refused', async () => {
    const h = harness({ link: { revokedAt: new Date() } });
    await expect(h.controller.redeem({ token: h.token }, h.req)).rejects.toMatchObject({ response: { code: 'SETUP_LINK_REPLACED' } });
  });

  it('an account that is disabled, deleted, archived or already set up gets no session', async () => {
    for (const user of [{ status: 'DISABLED' }, { deletedAt: new Date() }, { tenant: { archivedAt: new Date() } }, { mustSetupCredentials: false }]) {
      const h = harness({ user });
      await expect(h.controller.redeem({ token: h.token }, h.req)).rejects.toBeTruthy();
      expect(h.auth.login).not.toHaveBeenCalled();
      expect(h.audits.some((a) => a.action === 'ACCOUNT_SETUP_LINK_REFUSED')).toBe(true);
    }
  });
});

describe('account-setup-link helpers', () => {
  it('the URL is on the dashboard origin and carries the token', () => {
    expect(setupLinkUrl('abc', { PUBLIC_WEB_URL: 'https://app.venueos.test/' } as any)).toBe('https://app.venueos.test/setup-account/abc');
    expect(setupLinkUrl('abc', { ALLOWED_ORIGINS: 'https://a.test, https://b.test' } as any)).toBe('https://a.test/setup-account/abc');
    expect(setupLinkUrl('abc', {} as any)).toBe('/setup-account/abc');
  });

  it('link state', () => {
    const later = new Date(Date.now() + 1000);
    expect(setupLinkState(null)).toBe('none');
    expect(setupLinkState({ usedAt: new Date(), revokedAt: null, expiresAt: later })).toBe('used');
    expect(setupLinkState({ usedAt: null, revokedAt: null, expiresAt: later })).toBe('active');
    expect(setupLinkState({ usedAt: null, revokedAt: null, expiresAt: new Date(0) })).toBe('expired');
  });
});
