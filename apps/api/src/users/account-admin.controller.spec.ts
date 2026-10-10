/**
 * ACCOUNT ADMINISTRATION (2026-10-10) — change someone's sign-in email, and
 * one-time setup links. What these tests pin:
 *
 *  CHANGE EMAIL
 *   - the actor's password step-up runs FIRST; a wrong one is 403 (never 401)
 *     and audited;
 *   - SUPER_ADMIN reaches anyone; an org admin reaches its own org and its
 *     locations only — ANOTHER ORG'S USER IS 404 and nothing changes;
 *   - uniqueness is a clean 409; invited / not-yet-set-up accounts refused;
 *   - with verification ON the change needs the 6-digit code emailed to the
 *     NEW address, the attempt is claimed atomically, the code is spent in the
 *     same transaction as the write; with it OFF the change applies directly
 *     and says `verified: false`;
 *   - the audit row names before/after/actor; both session stores are ended;
 *     the OLD address is told.
 *
 *  SETUP LINKS
 *   - only a hash is stored, never the token; the starter password is dead the
 *     moment a link exists; older links are revoked; sessions end; audited;
 *   - accounts that finished setup, hold a factor, or are out of scope refused;
 *   - the bulk export issues one per pending account in the org subtree.
 */
import { ConflictException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AppRole } from '@cms/database';
import { AccountAdminController } from './account-admin.controller';
import { cryptoPlatformConfig } from '../auth/crypto.config';
import { hashEmailCode, MFA_EMAIL_CODE_MAX_ATTEMPTS } from '../auth/mfa-email-code';
import { adminEmailChangeChallengeHash } from '../auth/setup-email-verification';
import { requireSecret } from '../security/required-secret';
import { hashSetupLinkToken } from '../auth/account-setup-link';

const PW = 'actor-password-123';
let ACTOR_HASH = '';
let STARTER_HASH = '';
beforeAll(async () => {
  const cheap = { type: cryptoPlatformConfig.type, memoryCost: 1024, timeCost: 1, parallelism: 1 };
  ACTOR_HASH = await argon2.hash(PW, cheap);
  STARTER_HASH = await argon2.hash('riot@74103', cheap);
}, 30_000);

const secret = () => requireSecret('JWT_SECRET', { devFallback: 'dev_only_jwt_secret_CHANGE_ME' });

type Row = Record<string, any>;
const TENANTS: Record<string, { id: string; parentId: string | null; name: string }> = {
  corp: { id: 'corp', parentId: null, name: 'RIOT Corporate' },
  tulsa: { id: 'tulsa', parentId: 'corp', name: 'RIOT Tulsa' },
  houston: { id: 'houston', parentId: 'corp', name: 'RIOT Houston' },
  other: { id: 'other', parentId: null, name: 'Other Co' },
  otherBranch: { id: 'otherBranch', parentId: 'other', name: 'Other Branch' },
};

function matches(row: Row, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (typeof v === 'object' && v && 'in' in (v as any)) {
      if (!(v as any).in.includes(row[k])) return false;
    } else if (typeof v === 'object' && v && 'gt' in (v as any)) {
      if (!(row[k] > (v as any).gt)) return false;
    } else if (typeof v === 'object' && v && 'lt' in (v as any)) {
      if (!(row[k] < (v as any).lt)) return false;
    } else if (typeof v === 'object' && v && 'gte' in (v as any)) {
      if (!(row[k] >= (v as any).gte)) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}

function harness(opts: { users: Row[]; deliverable?: boolean; codes?: Row[] }) {
  const users = opts.users;
  const links: Row[] = [];
  const codes: Row[] = opts.codes ?? [];
  const audits: Row[] = [];
  const sent: Row[] = [];
  const project = (u: Row) => ({
    ...u,
    tenant: { name: TENANTS[u.tenantId]?.name },
    _count: { passkeys: u.passkeys ?? 0 },
    setupLinks: links
      .filter((l) => l.userId === u.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 1),
  });
  const userStore = {
    findFirst: jest.fn(async ({ where }: any) => {
      const r = users.find((u) => matches(u, where));
      return r ? project(r) : null;
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      const r = users.find((u) => matches(u, where));
      return r ? project(r) : null;
    }),
    findMany: jest.fn(async ({ where }: any) => users.filter((u) => matches(u, where)).map(project)),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = users.filter((u) => matches(u, where));
      hit.forEach((u) => Object.assign(u, data));
      return { count: hit.length };
    }),
  };
  const linkStore = {
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = links.filter((l) => matches(l, where));
      hit.forEach((l) => Object.assign(l, data));
      return { count: hit.length };
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `l${links.length + 1}`, usedAt: null, revokedAt: null, createdAt: Date.now() + links.length, ...data };
      links.push(row);
      return row;
    }),
  };
  const codeStore = {
    count: jest.fn(async ({ where }: any) => codes.filter((c) => c.userId === where.userId).length),
    deleteMany: jest.fn(async ({ where }: any) => {
      for (let i = codes.length - 1; i >= 0; i--) if (codes[i].challengeHash === where.challengeHash) codes.splice(i, 1);
      return { count: 1 };
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `c${codes.length + 1}`, attempts: 0, usedAt: null, createdAt: new Date(), ...data };
      codes.push(row);
      return row;
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      const r = codes.find((c) => c.challengeHash === where.challengeHash);
      return r ? { ...r } : null;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const r = codes.find((c) => c.id === where.id);
      if (!r || r.usedAt) return { count: 0 };
      if (data.attempts) {
        if (r.attempts >= where.attempts.lt || r.expiresAt <= where.expiresAt.gt) return { count: 0 };
        r.attempts += 1;
        return { count: 1 };
      }
      r.usedAt = data.usedAt;
      return { count: 1 };
    }),
  };
  const auditStore = { create: jest.fn(async ({ data }: any) => { audits.push(data); return data; }) };
  const tx = { user: userStore, accountSetupLink: linkStore, auditLog: auditStore, mfaEmailCode: codeStore };
  const prisma: any = {
    client: {
      user: userStore,
      accountSetupLink: linkStore,
      mfaEmailCode: codeStore,
      auditLog: auditStore,
      tenant: {
        findUnique: jest.fn(async ({ where }: any) => TENANTS[where.id] ?? null),
        findMany: jest.fn(async ({ where }: any) => Object.values(TENANTS).filter((t) => t.parentId === where.parentId)),
      },
      $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg))),
    },
  };
  const redis: any = { markUserTokensInvalid: jest.fn(async () => undefined) };
  const sessions: any = { revokeAllForUser: jest.fn(async () => undefined) };
  const email: any = {
    isConfigured: () => true,
    isDeliverableToArbitraryRecipients: () => opts.deliverable ?? true,
    sendEmailChangeCode: jest.fn(async (p: Row) => { sent.push(p); return 'SENT'; }),
    sendEmailChangedNotice: jest.fn(async () => 'SENT'),
  };
  const auth: any = { hashPassword: jest.fn(async () => '$argon2id$retired-random') };
  const controller = new AccountAdminController(prisma, redis, sessions, email, auth);
  return { controller, users, links, codes, audits, sent, redis, sessions, email };
}

const superAdmin = (): Row => ({ id: 'sa', email: 'greg@venueos.test', role: AppRole.SUPER_ADMIN, tenantId: 'platform', status: 'ACTIVE', deletedAt: null, passwordHash: ACTOR_HASH, mustSetupCredentials: false });
const corpAdmin = (): Row => ({ id: 'corp-admin', email: 'ops@riot.test', role: AppRole.DISTRICT_ADMIN, tenantId: 'corp', status: 'ACTIVE', deletedAt: null, passwordHash: ACTOR_HASH, firstName: 'Ops', lastName: 'Lead', mustSetupCredentials: false });
const branchManager = (over: Row = {}): Row => ({ id: 'tulsa-mgr', email: 'dana@riot.test', role: AppRole.SCHOOL_ADMIN, tenantId: 'tulsa', status: 'ACTIVE', deletedAt: null, passwordHash: 'x', mustSetupCredentials: false, ...over });
const otherOrgUser = (): Row => ({ id: 'stranger', email: 'eve@other.test', role: AppRole.SCHOOL_ADMIN, tenantId: 'otherBranch', status: 'ACTIVE', deletedAt: null, passwordHash: 'x', mustSetupCredentials: false });
const starter = (id: string, tenantId: string, over: Row = {}): Row => ({ id, email: `riot-${tenantId}@riotcolor.com`, role: AppRole.SCHOOL_ADMIN, tenantId, status: 'ACTIVE', deletedAt: null, passwordHash: STARTER_HASH, mustSetupCredentials: true, mfaTotpVerifiedAt: null, ...over });

const reqAs = (actor: Row): any => ({ user: { id: actor.id, role: actor.role, tenantId: actor.tenantId }, headers: {}, ip: '203.0.113.5' });

describe('PUT /users/:id/email — change someone\'s sign-in email', () => {
  it('verification OFF: an org admin changes a location manager\'s email directly, audited, sessions ended, old address told', async () => {
    const actor = corpAdmin();
    const h = harness({ users: [actor, branchManager()], deliverable: false });
    const out = await h.controller.changeEmail(reqAs(actor), 'tulsa-mgr', { email: ' Dana.R@Riot.test ', password: PW });
    expect(out).toEqual({ ok: true, email: 'dana.r@riot.test', verified: false, sessionsRevoked: true });
    expect(h.users[1].email).toBe('dana.r@riot.test');
    const row = h.audits.find((a) => a.action === 'USER_EMAIL_CHANGED')!;
    expect(row.userId).toBe('corp-admin');
    expect(row.targetId).toBe('tulsa-mgr');
    expect(row.tenantId).toBe('tulsa');
    expect(JSON.parse(row.details)).toEqual(expect.objectContaining({ previousEmail: 'dana@riot.test', newEmail: 'dana.r@riot.test', verifiedByCode: false, byRole: 'DISTRICT_ADMIN' }));
    expect(h.redis.markUserTokensInvalid).toHaveBeenCalledWith('tulsa-mgr');
    expect(h.sessions.revokeAllForUser).toHaveBeenCalledWith('tulsa-mgr', 'email-changed-by-admin');
    expect(h.email.sendEmailChangedNotice).toHaveBeenCalledWith({ to: 'dana@riot.test', actorName: 'Ops Lead' });
  });

  it('an org admin CANNOT change another organisation\'s user — 404, nothing written, refusal audited', async () => {
    const actor = corpAdmin();
    const h = harness({ users: [actor, otherOrgUser()], deliverable: false });
    await expect(h.controller.changeEmail(reqAs(actor), 'stranger', { email: 'mine@riot.test', password: PW }))
      .rejects.toMatchObject({ status: 404 });
    expect(h.users[1].email).toBe('eve@other.test');
    expect(h.audits.some((a) => a.action === 'USER_EMAIL_CHANGE_DENIED')).toBe(true);
    expect(h.redis.markUserTokensInvalid).not.toHaveBeenCalled();
  });

  it('SUPER_ADMIN can change anyone\'s, in any organisation', async () => {
    const actor = superAdmin();
    const h = harness({ users: [actor, otherOrgUser()], deliverable: false });
    await expect(h.controller.changeEmail(reqAs(actor), 'stranger', { email: 'eve2@other.test', password: PW })).resolves.toMatchObject({ ok: true });
    expect(h.users[1].email).toBe('eve2@other.test');
  });

  it('a peer or superior is refused (rank), and so is the caller themself', async () => {
    const actor = corpAdmin();
    const peer = { ...corpAdmin(), id: 'corp-admin-2', email: 'ops2@riot.test' };
    const h = harness({ users: [actor, peer], deliverable: false });
    await expect(h.controller.changeEmail(reqAs(actor), 'corp-admin-2', { email: 'x@riot.test', password: PW })).rejects.toBeTruthy();
    await expect(h.controller.changeEmail(reqAs(actor), 'corp-admin', { email: 'x@riot.test', password: PW })).rejects.toMatchObject({ response: { code: 'USER_CANNOT_ACT_ON_SELF' } });
    expect(peer.email).toBe('ops2@riot.test');
  });

  it('a wrong step-up password is 403 — never 401 — and audited, before the target is even looked at', async () => {
    const actor = corpAdmin();
    const h = harness({ users: [actor, otherOrgUser()], deliverable: false });
    await expect(h.controller.changeEmail(reqAs(actor), 'stranger', { email: 'x@riot.test', password: 'nope' }))
      .rejects.toMatchObject({ status: 403, response: { code: 'ACCOUNT_ADMIN_BAD_PASSWORD' } });
    expect(JSON.parse(h.audits[0].details).reason).toBe('bad_password');
  });

  it('an address another account holds is a clean 409', async () => {
    const actor = corpAdmin();
    const h = harness({ users: [actor, branchManager(), branchManager({ id: 'houston-mgr', email: 'taken@riot.test', tenantId: 'houston' })], deliverable: false });
    await expect(h.controller.changeEmail(reqAs(actor), 'tulsa-mgr', { email: 'taken@riot.test', password: PW }))
      .rejects.toMatchObject({ response: { code: 'USER_EMAIL_IN_USE' } });
  });

  it('refuses an invited account and an account still on its starter credentials', async () => {
    const actor = corpAdmin();
    const h = harness({ users: [actor, branchManager({ status: 'INVITED' }), starter('s1', 'houston')], deliverable: false });
    await expect(h.controller.changeEmail(reqAs(actor), 'tulsa-mgr', { email: 'n@riot.test', password: PW })).rejects.toMatchObject({ response: { code: 'USER_EMAIL_CHANGE_INVITED' } });
    await expect(h.controller.changeEmail(reqAs(actor), 's1', { email: 'n@riot.test', password: PW })).rejects.toMatchObject({ response: { code: 'USER_EMAIL_CHANGE_SETUP_PENDING' } });
  });

  describe('verification ON (a verified sending domain)', () => {
    it('step 1 emails a code to the NEW address (never returned); step 2 without it writes nothing', async () => {
      const actor = corpAdmin();
      const h = harness({ users: [actor, branchManager()] });
      const s1 = await h.controller.sendEmailChangeCode(reqAs(actor), 'tulsa-mgr', { email: 'dana.r@riot.test', password: PW });
      expect(s1).toEqual({ required: true, sent: true, expiresInSeconds: 600 });
      expect(h.sent[0].to).toBe('dana.r@riot.test');
      expect(JSON.stringify(s1)).not.toContain(h.sent[0].code);
      expect(JSON.stringify(h.audits)).not.toContain(h.sent[0].code);
      await expect(h.controller.changeEmail(reqAs(actor), 'tulsa-mgr', { email: 'dana.r@riot.test', password: PW }))
        .rejects.toMatchObject({ response: { code: 'USER_EMAIL_CODE_REQUIRED' } });
      expect(h.users[1].email).toBe('dana@riot.test');
    });

    it('the right code applies the change, spends the code, and says verified', async () => {
      const actor = corpAdmin();
      const h = harness({ users: [actor, branchManager()] });
      await h.controller.sendEmailChangeCode(reqAs(actor), 'tulsa-mgr', { email: 'dana.r@riot.test', password: PW });
      const code = h.sent[0].code;
      const out = await h.controller.changeEmail(reqAs(actor), 'tulsa-mgr', { email: 'dana.r@riot.test', password: PW, code });
      expect(out).toMatchObject({ ok: true, verified: true });
      expect(h.codes[0].usedAt).toBeInstanceOf(Date);
      // Spent: the same code cannot be used again.
      h.users[1].email = 'dana@riot.test';
      await expect(h.controller.changeEmail(reqAs(actor), 'tulsa-mgr', { email: 'dana.r@riot.test', password: PW, code }))
        .rejects.toMatchObject({ response: { code: 'USER_EMAIL_CODE_INVALID' } });
    });

    it('a code proven for one address cannot apply another', async () => {
      const actor = corpAdmin();
      const h = harness({ users: [actor, branchManager()] });
      await h.controller.sendEmailChangeCode(reqAs(actor), 'tulsa-mgr', { email: 'dana.r@riot.test', password: PW });
      await expect(h.controller.changeEmail(reqAs(actor), 'tulsa-mgr', { email: 'attacker@evil.test', password: PW, code: h.sent[0].code }))
        .rejects.toMatchObject({ response: { code: 'USER_EMAIL_CODE_INVALID' } });
      expect(h.users[1].email).toBe('dana@riot.test');
    });

    it('parallel wrong guesses cannot exceed the attempt cap', async () => {
      const actor = corpAdmin();
      const challengeHash = adminEmailChangeChallengeHash('tulsa-mgr', 'dana.r@riot.test');
      const codes = [{ id: 'c1', userId: 'tulsa-mgr', challengeHash, codeHash: hashEmailCode(secret(), challengeHash, '424242'), attempts: 0, usedAt: null, expiresAt: new Date(Date.now() + 60_000) }];
      const h = harness({ users: [actor, branchManager()], codes });
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () => h.controller.changeEmail(reqAs(actor), 'tulsa-mgr', { email: 'dana.r@riot.test', password: PW, code: '000000' })),
      );
      expect(results.every((r) => r.status === 'rejected')).toBe(true);
      expect(codes[0].attempts).toBe(MFA_EMAIL_CODE_MAX_ATTEMPTS);
      await expect(h.controller.changeEmail(reqAs(actor), 'tulsa-mgr', { email: 'dana.r@riot.test', password: PW, code: '424242' }))
        .rejects.toMatchObject({ response: { code: 'USER_EMAIL_CODE_LOCKED' } });
      expect(h.users[1].email).toBe('dana@riot.test');
    });
  });
});

describe('POST /users/:id/setup-link — one-time setup links', () => {
  it('stores ONLY a hash, retires the starter password, ends sessions, audits — and the URL carries the token', async () => {
    const actor = corpAdmin();
    const acct = starter('s-tulsa', 'tulsa');
    const h = harness({ users: [actor, acct] });
    const out: any = await h.controller.createSetupLink(reqAs(actor), 's-tulsa', { password: PW });
    const token = out.url.split('/setup-account/')[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(h.links).toHaveLength(1);
    expect(h.links[0].tokenHash).toBe(hashSetupLinkToken(token));
    expect(JSON.stringify(h.links[0])).not.toContain(token);
    expect(JSON.stringify(h.audits)).not.toContain(token);
    expect(new Date(out.expiresAt).getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 3600_000);
    // The starter password (riot@<zip>) no longer verifies.
    expect(acct.passwordHash).toBe('$argon2id$retired-random');
    expect(await argon2.verify(acct.passwordHash, 'riot@74103').catch(() => false)).toBe(false);
    expect(h.redis.markUserTokensInvalid).toHaveBeenCalledWith('s-tulsa');
    expect(h.sessions.revokeAllForUser).toHaveBeenCalledWith('s-tulsa', 'setup-link-issued');
    expect(h.audits.find((a) => a.action === 'ACCOUNT_SETUP_LINK_CREATED')).toMatchObject({ userId: 'corp-admin', targetId: 's-tulsa', tenantId: 'tulsa' });
  });

  it('regenerating revokes the older link', async () => {
    const actor = corpAdmin();
    const h = harness({ users: [actor, starter('s-tulsa', 'tulsa')] });
    await h.controller.createSetupLink(reqAs(actor), 's-tulsa', { password: PW });
    const second: any = await h.controller.createSetupLink(reqAs(actor), 's-tulsa', { password: PW });
    expect(second.replacedLinks).toBe(1);
    expect(h.links[0].revokedAt).toBeInstanceOf(Date);
    expect(h.links[1].revokedAt).toBeNull();
  });

  it('refuses an account that already finished setup, one with two-step, and one in another organisation', async () => {
    const actor = corpAdmin();
    const h = harness({ users: [actor, branchManager(), starter('s-2fa', 'houston', { mfaTotpVerifiedAt: new Date() }), { ...starter('s-other', 'otherBranch') }] });
    await expect(h.controller.createSetupLink(reqAs(actor), 'tulsa-mgr', { password: PW })).rejects.toBeInstanceOf(ConflictException);
    await expect(h.controller.createSetupLink(reqAs(actor), 's-2fa', { password: PW })).rejects.toMatchObject({ response: { code: 'SETUP_LINK_HAS_FACTOR' } });
    await expect(h.controller.createSetupLink(reqAs(actor), 's-other', { password: PW })).rejects.toMatchObject({ status: 404 });
    expect(h.links).toHaveLength(0);
  });

  it('a location admin cannot issue a link for their organisation\'s corporate account (rank)', async () => {
    const corp = starter('s-corp', 'corp', { role: AppRole.DISTRICT_ADMIN });
    const branchAdmin = { ...branchManager(), passwordHash: ACTOR_HASH };
    const h = harness({ users: [branchAdmin, corp] });
    await expect(h.controller.createSetupLink(reqAs(branchAdmin), 's-corp', { password: PW })).rejects.toMatchObject({ status: 404 });
    expect(corp.passwordHash).toBe(STARTER_HASH);
  });
});

describe('setup links — list and bulk CSV export for an organisation', () => {
  it('lists every pending account in the org and its locations, and bulk issues one link each', async () => {
    const actor = corpAdmin();
    const h = harness({
      users: [actor, starter('s-tulsa', 'tulsa'), starter('s-houston', 'houston'), branchManager(), starter('s-other', 'otherBranch'), starter('s-2fa', 'houston', { email: 'x@riot.test', passkeys: 1 })],
    });
    const list = await h.controller.listSetupLinks(reqAs(actor));
    expect(list.accounts.map((a: any) => a.id).sort()).toEqual(['s-2fa', 's-houston', 's-tulsa']);
    expect(list.accounts.find((a: any) => a.id === 's-tulsa')).toMatchObject({ tenantName: 'RIOT Tulsa', link: 'none', hasTwoStep: false });

    const out = await h.controller.bulkSetupLinks(reqAs(actor), { password: PW });
    expect(out.links.map((l: any) => l.userId).sort()).toEqual(['s-houston', 's-tulsa']);
    expect(out.links[0]).toEqual(expect.objectContaining({ url: expect.stringContaining('/setup-account/'), location: expect.any(String) }));
    expect(h.links).toHaveLength(2);
    expect(h.audits.some((a) => a.action === 'ACCOUNT_SETUP_LINKS_EXPORTED')).toBe(true);

    const after = await h.controller.listSetupLinks(reqAs(actor));
    expect(after.accounts.find((a: any) => a.id === 's-tulsa').link).toBe('active');
  });

  it('bulk needs the password step-up', async () => {
    const actor = corpAdmin();
    const h = harness({ users: [actor, starter('s-tulsa', 'tulsa')] });
    await expect(h.controller.bulkSetupLinks(reqAs(actor), { password: 'wrong' })).rejects.toMatchObject({ status: 403 });
    expect(h.links).toHaveLength(0);
  });
});
