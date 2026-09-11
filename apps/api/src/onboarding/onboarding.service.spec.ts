import { Test, TestingModule } from '@nestjs/testing';
import { OnboardingService, hashToken, PASSWORD_RESET_TTL_MS } from './onboarding.service';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { SampleDataService } from '../sample-data/sample-data.service';
import { StarterBoardService } from './starter-board.service';
import { RedisService } from '../realtime/redis.service';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { SSO_PROVISIONED_NO_PASSWORD_HASH } from '../auth/sso-provisioned-account';

type Row = Record<string, any>;

function createInMemoryPrisma() {
  const tenants: Row[] = [];
  const users: Row[] = [];
  const auditLogs: Row[] = [];
  const resets: Row[] = [];
  const invites: Row[] = [];
  const emailLogs: Row[] = [];

  const client: any = {
    tenant: {
      findUnique: async ({ where }: any) =>
        tenants.find((t) => (where.id && t.id === where.id) || (where.slug && t.slug === where.slug)) || null,
      create: async ({ data }: any) => {
        const row = { id: `tenant-${tenants.length + 1}`, createdAt: new Date(), ...data };
        tenants.push(row);
        return row;
      },
    },
    user: {
      findUnique: async ({ where }: any) =>
        users.find(
          (u) =>
            (where.id && u.id === where.id) || (where.email && u.email === where.email),
        ) || null,
      create: async ({ data }: any) => {
        const row = { id: `user-${users.length + 1}`, createdAt: new Date(), status: 'ACTIVE', canTriggerPanic: false, ...data };
        users.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = users.find((u) => u.id === where.id);
        if (!row) throw new Error('User not found');
        Object.assign(row, data);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const row = { id: `audit-${auditLogs.length + 1}`, createdAt: new Date(), ...data };
        auditLogs.push(row);
        return row;
      },
    },
    passwordResetToken: {
      create: async ({ data }: any) => {
        const row = { id: `reset-${resets.length + 1}`, createdAt: new Date(), usedAt: null, ...data };
        resets.push(row);
        return row;
      },
      findUnique: async ({ where, include }: any) => {
        const row = resets.find((r) => r.tokenHash === where.tokenHash);
        if (!row) return null;
        if (include?.user) {
          return { ...row, user: users.find((u) => u.id === row.userId) };
        }
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = resets.find((r) => r.id === where.id);
        if (!row) throw new Error('Reset not found');
        Object.assign(row, data);
        return row;
      },
    },
    userInvite: {
      create: async ({ data }: any) => {
        const row = { id: `invite-${invites.length + 1}`, createdAt: new Date(), acceptedAt: null, ...data };
        invites.push(row);
        return row;
      },
      findUnique: async ({ where, include }: any) => {
        const row = invites.find((i) => i.tokenHash === where.tokenHash);
        if (!row) return null;
        const out: any = { ...row };
        if (include?.user) out.user = users.find((u) => u.id === row.userId);
        if (include?.tenant) {
          const t = tenants.find((t) => t.id === row.tenantId);
          out.tenant = t ? { name: t.name, slug: t.slug } : null;
        }
        return out;
      },
      update: async ({ where, data }: any) => {
        const row = invites.find((i) => i.id === where.id);
        if (!row) throw new Error('Invite not found');
        Object.assign(row, data);
        return row;
      },
    },
    emailLog: {
      create: async ({ data }: any) => {
        const row = { id: `email-${emailLogs.length + 1}`, createdAt: new Date(), ...data };
        emailLogs.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = emailLogs.find((e) => e.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      },
    },
    $transaction: async (cb: any) => cb(client),
  };

  return { client, state: { tenants, users, resets, invites, auditLogs, emailLogs } };
}

describe('OnboardingService', () => {
  let service: OnboardingService;
  let emailService: EmailService;
  let prisma: PrismaService;
  let state: ReturnType<typeof createInMemoryPrisma>['state'];
  let redisMock: { markUserTokensInvalid: jest.Mock };
  let starterBoardMock: jest.Mock;

  beforeEach(async () => {
    const mem = createInMemoryPrisma();
    state = mem.state;
    redisMock = { markUserTokensInvalid: jest.fn().mockResolvedValue(undefined) };
    starterBoardMock = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        EmailService,
        AuthService,
        { provide: PrismaService, useValue: { client: mem.client } },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('signed.jwt') } },
        // OnboardingService.signup() fire-and-forgets sampleData.seedForNewTenant
        // (void, not awaited). A jest.fn() mock satisfies DI without affecting
        // any signup assertions. (Was missing → "can't resolve SampleDataService
        // at index [3]" failed the whole suite — added 2026-05-30.)
        { provide: SampleDataService, useValue: { seedForNewTenant: jest.fn().mockResolvedValue(undefined) } },
        // VERT-001 (2026-08-24): signup also fire-and-forgets the starter-board
        // seed (one branded template + "My first playlist"). Same deal — a
        // jest.fn() satisfies DI; the seeder's own behavior is covered
        // end-to-end in starter-board.service.spec.ts.
        { provide: StarterBoardService, useValue: { seedForNewTenant: starterBoardMock } },
        // ACC-02 (2026-08-01): completePasswordReset now revokes every live
        // session for the account (markUserTokensInvalid stamps the per-user
        // invalid-before epoch JwtAuthGuard already enforces).
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();

    service = module.get(OnboardingService);
    emailService = module.get(EmailService);
    prisma = module.get(PrismaService);
  });

  describe('signup', () => {
    it('creates a tenant + DISTRICT_ADMIN and returns an auth token (happy path)', async () => {
      const result = await service.signup({
        districtName: 'Springfield Unified',
        slug: 'springfield',
        adminEmail: 'super@springfield.edu',
        password: 'correct-horse-battery',
      });

      expect(result.access_token).toBe('signed.jwt');
      expect(result.user.email).toBe('super@springfield.edu');
      expect(state.tenants).toHaveLength(1);
      expect(state.tenants[0].slug).toBe('springfield');
      expect(state.users).toHaveLength(1);
      expect(state.users[0].role).toBe('DISTRICT_ADMIN');
      expect(state.auditLogs.some((a) => a.action === 'TENANT_SIGNUP')).toBe(true);
      expect(state.emailLogs.some((e) => e.kind === 'WELCOME')).toBe(true);
      // VERT-001 — the new tenant's first board is seeded from the signup path,
      // with the tenant id / admin id / vertical / display name it needs to
      // name the board. Fire-and-forget, so this asserts the CALL, not an await.
      expect(starterBoardMock).toHaveBeenCalledWith(
        state.tenants[0].id,
        state.users[0].id,
        'K12',
        'Springfield Unified',
      );
    });

    it('rejects duplicate slug with 409', async () => {
      await service.signup({
        districtName: 'Springfield',
        slug: 'springfield',
        adminEmail: 'a@a.com',
        password: 'password123',
      });
      await expect(
        service.signup({
          districtName: 'Other',
          slug: 'springfield',
          adminEmail: 'b@b.com',
          password: 'password123',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a weak password', async () => {
      await expect(
        service.signup({
          districtName: 'X',
          slug: 'x',
          adminEmail: 'x@y.com',
          password: 'short',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('password reset', () => {
    it('round-trips: request -> complete with new password', async () => {
      await service.signup({
        districtName: 'Acme',
        slug: 'acme',
        adminEmail: 'admin@acme.edu',
        password: 'original-password-1',
      });

      const result = await service.requestPasswordReset('admin@acme.edu');
      expect(result.ok).toBe(true);
      expect(state.resets).toHaveLength(1);

      // Reverse the hash by recreating the token path: we need the plaintext.
      // Test-trick: pull it from the email body since the service generated it.
      const email = state.emailLogs.find((e) => e.kind === 'PASSWORD_RESET');
      expect(email).toBeDefined();
      const match = email!.body.match(/reset-password\/([^\s]+)/);
      expect(match).toBeTruthy();
      const token = decodeURIComponent(match![1]);
      expect(hashToken(token)).toEqual(state.resets[0].tokenHash);

      await service.completePasswordReset({ token, newPassword: 'brand-new-password-2' });
      expect(state.resets[0].usedAt).toBeInstanceOf(Date);
    });

    // ── ACC-02 (2026-08-01) ────────────────────────────────────────────────
    // A password reset must be a CONTAINMENT action. Before this fix it only
    // rotated `passwordHash`: an attacker holding a stolen JWT (up to 30 days
    // on a rememberMe token) kept full access after the victim did the one
    // thing every security guide tells them to do.
    describe('ACC-02 — reset revokes existing sessions', () => {
      async function seedAndReset(newPassword: string) {
        await service.signup({
          districtName: 'Acme',
          slug: 'acme-revoke',
          adminEmail: 'revoke@acme.edu',
          password: 'original-password-1',
        });
        await service.requestPasswordReset('revoke@acme.edu');
        const email = state.emailLogs.find((e) => e.kind === 'PASSWORD_RESET');
        const token = decodeURIComponent(email!.body.match(/reset-password\/([^\s]+)/)![1]);
        const userId = state.users.find((u: any) => u.email === 'revoke@acme.edu')!.id;
        const res = await service.completePasswordReset({ token, newPassword });
        return { res, userId };
      }

      it('stamps the per-user invalid-before marker so live JWTs stop working', async () => {
        const { res, userId } = await seedAndReset('brand-new-password-2');
        expect(redisMock.markUserTokensInvalid).toHaveBeenCalledWith(userId);
        expect(res.sessionsRevoked).toBe(true);
      });

      it('still completes the reset (and reports it) when the revocation store is down', async () => {
        // The password is already committed at that point — failing the whole
        // request would leave the user unable to reset at all. We report the
        // partial outcome instead of silently claiming clean containment.
        redisMock.markUserTokensInvalid.mockRejectedValueOnce(new Error('redis down'));
        const { res } = await seedAndReset('brand-new-password-3');
        expect(res.ok).toBe(true);
        expect(res.sessionsRevoked).toBe(false);
        expect(state.resets[0].usedAt).toBeInstanceOf(Date);
      });

      it('does NOT revoke when the reset fails (no token consumed, no side effect)', async () => {
        await expect(
          service.completePasswordReset({ token: 'not-a-real-token', newPassword: 'abcdefgh1' }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(redisMock.markUserTokensInvalid).not.toHaveBeenCalled();
      });
    });

    it('rejects an expired reset token', async () => {
      await service.signup({
        districtName: 'Acme',
        slug: 'acme2',
        adminEmail: 'x@acme.edu',
        password: 'original-password',
      });
      await service.requestPasswordReset('x@acme.edu');
      // Force-expire the token in place.
      state.resets[0].expiresAt = new Date(Date.now() - 1_000);
      const email = state.emailLogs.find((e) => e.kind === 'PASSWORD_RESET')!;
      const token = decodeURIComponent(email.body.match(/reset-password\/([^\s]+)/)![1]);

      await expect(
        service.completePasswordReset({ token, newPassword: 'a-new-password' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('silently accepts requests for unknown emails (no enumeration)', async () => {
      const result = await service.requestPasswordReset('nobody@nowhere.com');
      expect(result.ok).toBe(true);
      expect(state.resets).toHaveLength(0);
    });

    it('ttl is one hour', () => {
      expect(PASSWORD_RESET_TTL_MS).toBe(60 * 60 * 1000);
    });
  });

  describe('invite accept', () => {
    it('accepts an invite and activates the user', async () => {
      // Seed an admin/tenant.
      const signup = await service.signup({
        districtName: 'Acme',
        slug: 'acme3',
        adminEmail: 'admin@acme.edu',
        password: 'admin-password',
      });

      await service.createInvite({
        inviterId: signup.user.id,
        tenantId: signup.user.tenantId,
        email: 'new-teacher@acme.edu',
        role: 'CONTRIBUTOR',
      });

      expect(state.invites).toHaveLength(1);
      expect(state.users.find((u) => u.email === 'new-teacher@acme.edu')?.status).toBe('INVITED');

      const inviteEmail = state.emailLogs.find((e) => e.kind === 'INVITE')!;
      const token = decodeURIComponent(inviteEmail.body.match(/accept-invite\/([^\s]+)/)![1]);

      const result = await service.acceptInvite({ token, password: 'chosen-password-123' });
      expect(result.access_token).toBe('signed.jwt');
      expect(state.users.find((u) => u.email === 'new-teacher@acme.edu')?.status).toBe('ACTIVE');
      expect(state.invites[0].acceptedAt).toBeInstanceOf(Date);
      expect(state.auditLogs.some((a) => a.action === 'INVITE_ACCEPTED')).toBe(true);
    });

    // ── FAIL-OPEN #6 (recon 2026-09-11) ────────────────────────────────
    // acceptInvite used to pass `skipPolicyGate: true`, which mints a session
    // WITHOUT evaluating the MFA policy. Signup can defend that — a tenant one
    // second old cannot have switched enforcement on. This path cannot: it
    // joins an account to an EXISTING organization, so an admin invited into a
    // tenant that requires two-factor got a full hour of unenforced session
    // handed to them by the act of joining.
    describe('per-tenant MFA enforcement (fail-open #6)', () => {
      /**
       * @param role SCHOOL_ADMIN is the most privileged role a DISTRICT_ADMIN
       *   may invite (the rank table refuses a peer), and it IS in
       *   MFA_REQUIRED_ROLES — so it is the real shape of "an admin joining an
       *   existing organization".
       */
      async function inviteAndAccept(label: string, role: string) {
        const signup = await service.signup({
          districtName: 'Acme', slug: `acme-mfa-${label}`,
          adminEmail: `admin-${label}@acme.edu`, password: 'admin-password',
        });
        const email = `invitee-${label}@acme.edu`;
        await service.createInvite({
          inviterId: signup.user.id,
          tenantId: signup.user.tenantId,
          email,
          role: role as any,
        });
        const mail = state.emailLogs.filter((e) => e.kind === 'INVITE').slice(-1)[0]!;
        const token = decodeURIComponent(mail.body.match(/accept-invite\/([^\s]+)/)![1]);
        return {
          email,
          tenantId: signup.user.tenantId,
          accept: () => service.acceptInvite({ token, password: 'chosen-password-123' }),
        };
      }

      it('an invited ADMIN joining an ENFORCING tenant gets NO policy-free session', async () => {
        const { tenantId, accept } = await inviteAndAccept('enforcing', 'SCHOOL_ADMIN');
        state.tenants.find((t: any) => t.id === tenantId)!.mfaEnforced = true;

        const res: any = await accept();
        expect(res.access_token).toBeUndefined();
        expect(res.mfaEnrollmentRequired).toBe(true);
        expect(typeof res.mfaToken).toBe('string');
      });

      it('…and the invite still SUCCEEDED — the account is ACTIVE with its own password', async () => {
        // The recovery path, walked: the user signs in at /login with the
        // password they just chose and completes forced enrollment there.
        // The accept-invite page routes them to it.
        const { tenantId, email, accept } = await inviteAndAccept('recovery', 'SCHOOL_ADMIN');
        state.tenants.find((t: any) => t.id === tenantId)!.mfaEnforced = true;
        await accept();
        expect(state.users.find((u) => u.email === email)?.status).toBe('ACTIVE');
        expect(state.auditLogs.some((a) => a.action === 'INVITE_ACCEPTED')).toBe(true);
      });

      it('an invited ADMIN joining an OPTED-OUT tenant gets the normal session', async () => {
        const { tenantId, accept } = await inviteAndAccept('optional', 'SCHOOL_ADMIN');
        state.tenants.find((t: any) => t.id === tenantId)!.mfaEnforced = false;
        const res: any = await accept();
        expect(res.access_token).toBe('signed.jwt');
      });

      it('a CONTRIBUTOR invite is unaffected even in an enforcing tenant (no collateral damage)', async () => {
        const { tenantId, accept } = await inviteAndAccept('contributor', 'CONTRIBUTOR');
        state.tenants.find((t: any) => t.id === tenantId)!.mfaEnforced = true;
        const res: any = await accept();
        expect(res.access_token).toBe('signed.jwt');
      });
    });
  });

  // ─── email-fix #2 (2026-07-03) ────────────────────────────────────
  //
  // Overnight audit finding: sendWelcome runs AFTER the Tenant +
  // DISTRICT_ADMIN User are already committed. An unset RESEND_API_KEY
  // (or a flaky Resend call) makes EmailService throw in production
  // (EmailService's own fail-closed #dispatch behavior — intentional,
  // NOT touched by this fix). Signup must succeed regardless of what
  // the welcome-email side-effect does, otherwise the applicant is
  // stranded with an account that exists but a 500 response (a retry
  // hits "account already exists").
  describe('signup succeeds even when the welcome email fails (email-fix #2)', () => {
    it('returns the normal auth token + creates the tenant/user when sendWelcome throws', async () => {
      jest.spyOn(emailService, 'sendWelcome').mockRejectedValueOnce(new Error('RESEND_API_KEY not set'));

      const result = await service.signup({
        districtName: 'Riverside Unified',
        slug: 'riverside',
        adminEmail: 'admin@riverside.edu',
        password: 'correct-horse-battery',
      });

      expect(result.access_token).toBe('signed.jwt');
      expect(result.user.email).toBe('admin@riverside.edu');
      expect(state.tenants.some((t) => t.slug === 'riverside')).toBe(true);
      expect(state.users.some((u) => u.email === 'admin@riverside.edu')).toBe(true);
    });
  });

  // ─── email-fix #5 (2026-07-03) ────────────────────────────────────
  //
  // Overnight audit finding: sendPasswordReset ran unguarded. The
  // no-enumeration contract requires requestPasswordReset to ALWAYS
  // return {ok:true, emailConfigured} regardless of downstream email
  // behavior -- a Resend hiccup or unset RESEND_API_KEY must not 500
  // this endpoint (which would also leak "this email exists" via the
  // different error path, on top of just being broken).
  describe('password-reset request returns {ok:true} even when the send fails (email-fix #5)', () => {
    it('keeps the no-enumeration contract intact when sendPasswordReset throws', async () => {
      await service.signup({
        districtName: 'Acme',
        slug: 'acme-pwreset',
        adminEmail: 'reset-me@acme.edu',
        password: 'original-password-1',
      });

      jest.spyOn(emailService, 'sendPasswordReset').mockRejectedValueOnce(new Error('Resend 500'));

      const result = await service.requestPasswordReset('reset-me@acme.edu');
      expect(result).toEqual({ ok: true, emailConfigured: expect.any(Boolean) });
      // The token row is still durable even though the send failed.
      expect(state.resets).toHaveLength(1);
    });
  });

  // ─── CLV-03 (2026-09-02) ──────────────────────────────────────────
  //
  // The Clever roster sync creates local accounts with a placeholder
  // `passwordHash` and a comment claiming it "blocks password login". It does
  // block LOGIN (argon2 rejects a non-PHC string) — but it never blocked the
  // public password-reset request, so the holder of that mailbox could simply
  // SET a password. That turns a connected roster feed into a way to mint a
  // standing DISTRICT_ADMIN credential at an address the district controls.
  describe('CLV-03 — an SSO-provisioned account cannot be given a password by reset', () => {
    it('mints NO reset token for a clever-sso-no-password account, and still returns {ok:true}', async () => {
      await service.signup({
        districtName: 'Acme',
        slug: 'acme-clever',
        adminEmail: 'admin@acme-clever.edu',
        password: 'original-password-1',
      });
      // Exactly what CleverService.syncTenant writes for a roster user.
      state.users.push({
        id: 'user-clever-1',
        tenantId: state.tenants[0].id,
        email: 'roster@acme-clever.edu',
        passwordHash: SSO_PROVISIONED_NO_PASSWORD_HASH,
        role: 'DISTRICT_ADMIN',
      });
      const sendSpy = jest.spyOn(emailService, 'sendPasswordReset');

      const result = await service.requestPasswordReset('roster@acme-clever.edu');

      // Same shape as every other branch — no enumeration signal.
      expect(result).toEqual({ ok: true, emailConfigured: expect.any(Boolean) });
      expect(state.resets).toHaveLength(0);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('still mints a reset token for a NORMAL password account (the guard is narrow)', async () => {
      await service.signup({
        districtName: 'Acme',
        slug: 'acme-normal',
        adminEmail: 'normal@acme-normal.edu',
        password: 'original-password-1',
      });
      const result = await service.requestPasswordReset('normal@acme-normal.edu');
      expect(result).toEqual({ ok: true, emailConfigured: expect.any(Boolean) });
      expect(state.resets).toHaveLength(1);
    });
  });

  // ─── email-fix #1 + #3 (2026-07-03) ───────────────────────────────
  //
  // Overnight audit finding: createInvite returned
  // `emailDelivered: !!process.env.EMAIL_PROVIDER` -- EMAIL_PROVIDER is
  // an orphan env var referenced nowhere else in the repo, so this flag
  // was ALWAYS false and the invite UI always showed "email isn't
  // configured, copy the link" even when Resend WAS wired up
  // (email-fix #1). Separately, sendUserInvite ran unguarded AFTER the
  // UserInvite + placeholder User were already committed -- a throw
  // there used to 500 the whole request even though the invite row
  // existed, with no way for the admin to recover the link
  // (email-fix #3). Both fixes land in the same block: emailDelivered
  // is now `emailSent && emailService.isConfigured()`.
  describe('invite email side-effects (email-fix #1 + #3)', () => {
    it('returns the copy-link shape (emailDelivered:false + acceptUrl) when sendUserInvite throws, instead of throwing', async () => {
      const signup = await service.signup({
        districtName: 'Acme',
        slug: 'acme-invite-fail',
        adminEmail: 'admin@acme-invite-fail.edu',
        password: 'admin-password',
      });

      jest.spyOn(emailService, 'sendUserInvite').mockRejectedValueOnce(new Error('Resend 500'));

      const result = await service.createInvite({
        inviterId: signup.user.id,
        tenantId: signup.user.tenantId,
        email: 'new-teacher@acme-invite-fail.edu',
        role: 'CONTRIBUTOR',
      });

      // Must NOT throw -- must return the same success shape the happy
      // path uses, with emailDelivered:false so the frontend
      // (settings/page.tsx) renders the copy-the-link fallback UX
      // instead of "Could not send invitation."
      expect(result.emailDelivered).toBe(false);
      expect(result.acceptUrl).toMatch(/\/accept-invite\//);
      // The invite + placeholder user are still durable even though
      // the send failed.
      expect(state.invites).toHaveLength(1);
      expect(state.users.some((u) => u.email === 'new-teacher@acme-invite-fail.edu')).toBe(true);
    });

    it('emailDelivered reflects isConfigured() AND-ed with send success, not the dead EMAIL_PROVIDER env var', async () => {
      const signup = await service.signup({
        districtName: 'Acme',
        slug: 'acme-configured',
        adminEmail: 'admin@acme-configured.edu',
        password: 'admin-password',
      });

      // Simulate "email IS configured" regardless of what env vars are
      // set in the test runner -- isConfigured() is the correct gate,
      // NOT process.env.EMAIL_PROVIDER (referenced nowhere else in the
      // repo and always falsy).
      jest.spyOn(emailService, 'isConfigured').mockReturnValueOnce(true);

      const result = await service.createInvite({
        inviterId: signup.user.id,
        tenantId: signup.user.tenantId,
        email: 'configured-invitee@acme-configured.edu',
        role: 'CONTRIBUTOR',
      });

      expect(result.emailDelivered).toBe(true);

      // And the inverse: isConfigured() false -> emailDelivered false,
      // even though the send itself succeeds (dev-mode log-only dispatch
      // never throws).
      jest.spyOn(emailService, 'isConfigured').mockReturnValueOnce(false);
      const result2 = await service.createInvite({
        inviterId: signup.user.id,
        tenantId: signup.user.tenantId,
        email: 'unconfigured-invitee@acme-configured.edu',
        role: 'CONTRIBUTOR',
      });
      expect(result2.emailDelivered).toBe(false);
    });
  });

  // ─── ACC-09 (2026-08-03) — cross-tenant account hijack ────────────
  //
  // `createUserDirect` / `createInvite` look users up by GLOBAL email and
  // used to reject only when the row was already ACTIVE. A PENDING/INVITED
  // user belonging to ANOTHER tenant fell through: direct-create rewrote
  // their `tenantId` to the caller's tenant (with a caller-chosen password),
  // and invite-create bound a fresh token to the foreign row. `acceptInvite`
  // never checked that the invite's tenant matched the user's, so redeeming
  // the link landed the real invitee inside the attacker's tenant.
  //
  // Self-signup mints a DISTRICT_ADMIN + tenant with no email verification,
  // so the attacking account is free. These tests pin the fix from BOTH
  // ends: refuse to bind a foreign row, and refuse to redeem a mismatched
  // invite.
  describe('ACC-09 — never re-tenant an existing user', () => {
    /** Tenant A (the victim) with one PENDING invitee, plus tenant B (the attacker). */
    async function twoTenantsWithPendingInvitee() {
      const victimAdmin = await service.signup({
        districtName: 'Victim District',
        slug: 'victim',
        adminEmail: 'admin@victim.edu',
        password: 'victim-admin-password',
      });
      await service.createInvite({
        inviterId: victimAdmin.user.id,
        tenantId: victimAdmin.user.tenantId,
        email: 'pending@victim.edu',
        role: 'SCHOOL_ADMIN',
      });
      const attackerAdmin = await service.signup({
        districtName: 'Attacker District',
        slug: 'attacker',
        adminEmail: 'admin@attacker.evil',
        password: 'attacker-admin-password',
      });
      const pending = state.users.find((u) => u.email === 'pending@victim.edu')!;
      expect(pending.status).toBe('INVITED');
      expect(pending.tenantId).toBe(victimAdmin.user.tenantId);
      return { victimAdmin, attackerAdmin, pending };
    }

    it('createUserDirect REFUSES an INVITED user who belongs to another tenant (and leaves their row untouched)', async () => {
      const { victimAdmin, attackerAdmin, pending } = await twoTenantsWithPendingInvitee();
      const originalHash = pending.passwordHash;

      await expect(
        service.createUserDirect({
          inviterId: attackerAdmin.user.id,
          tenantId: attackerAdmin.user.tenantId,
          email: 'pending@victim.edu',
          role: 'CONTRIBUTOR',
          password: 'attacker-chosen-password',
        }),
      ).rejects.toThrow(ConflictException);

      const after = state.users.find((u) => u.email === 'pending@victim.edu')!;
      expect(after.tenantId).toBe(victimAdmin.user.tenantId);
      expect(after.status).toBe('INVITED');
      expect(after.passwordHash).toBe(originalHash);
      expect(state.auditLogs.some((a) => a.action === 'USER_CREATED_DIRECT')).toBe(false);
    });

    it('createInvite REFUSES to bind a fresh invite token to a foreign-tenant user', async () => {
      const { attackerAdmin } = await twoTenantsWithPendingInvitee();
      const invitesBefore = state.invites.length;

      await expect(
        service.createInvite({
          inviterId: attackerAdmin.user.id,
          tenantId: attackerAdmin.user.tenantId,
          email: 'pending@victim.edu',
          role: 'CONTRIBUTOR',
        }),
      ).rejects.toThrow(ConflictException);

      expect(state.invites).toHaveLength(invitesBefore);
    });

    it('createUserDirect refuses to seize a same-tenant PENDING row that OUTRANKS the caller', async () => {
      const districtAdmin = await service.signup({
        districtName: 'Rank District',
        slug: 'rank',
        adminEmail: 'admin@rank.edu',
        password: 'district-admin-password',
      });
      // A pending SCHOOL_ADMIN in this same tenant…
      await service.createInvite({
        inviterId: districtAdmin.user.id,
        tenantId: districtAdmin.user.tenantId,
        email: 'pending-principal@rank.edu',
        role: 'SCHOOL_ADMIN',
      });
      // …created directly by a SCHOOL_ADMIN peer must be refused.
      const peer = await service.createUserDirect({
        inviterId: districtAdmin.user.id,
        tenantId: districtAdmin.user.tenantId,
        email: 'peer@rank.edu',
        role: 'SCHOOL_ADMIN',
        password: 'peer-password-123',
      });

      await expect(
        service.createUserDirect({
          inviterId: peer.id,
          tenantId: districtAdmin.user.tenantId,
          email: 'pending-principal@rank.edu',
          role: 'CONTRIBUTOR',
          password: 'seized-password-123',
        }),
      ).rejects.toThrow();

      expect(state.users.find((u) => u.email === 'pending-principal@rank.edu')!.status).toBe('INVITED');
    });

    it('acceptInvite REJECTS a token whose invite tenant does not match the user tenant', async () => {
      const { attackerAdmin, pending } = await twoTenantsWithPendingInvitee();

      // Simulate an invite minted before this fix (or by any future path that
      // skips createInvite): attacker's tenant, victim's user row.
      const token = 'forged-cross-tenant-token';
      state.invites.push({
        id: 'invite-forged',
        tenantId: attackerAdmin.user.tenantId,
        email: pending.email,
        role: 'CONTRIBUTOR',
        tokenHash: hashToken(token),
        invitedById: attackerAdmin.user.id,
        userId: pending.id,
        expiresAt: new Date(Date.now() + 60_000),
        acceptedAt: null,
      });

      await expect(
        service.acceptInvite({ token, password: 'attacker-chosen-password' }),
      ).rejects.toThrow(BadRequestException);

      const after = state.users.find((u) => u.id === pending.id)!;
      expect(after.status).toBe('INVITED');
      expect(after.tenantId).not.toBe(attackerAdmin.user.tenantId);
    });

    it('the LEGITIMATE invite flow still works end to end (invite → accept → session in the RIGHT tenant)', async () => {
      const admin = await service.signup({
        districtName: 'Happy District',
        slug: 'happy',
        adminEmail: 'admin@happy.edu',
        password: 'admin-password-happy',
      });

      await service.createInvite({
        inviterId: admin.user.id,
        tenantId: admin.user.tenantId,
        email: 'teacher@happy.edu',
        role: 'CONTRIBUTOR',
      });

      const inviteEmail = [...state.emailLogs].reverse().find(
        (e) => e.kind === 'INVITE' && e.toEmail === 'teacher@happy.edu',
      )!;
      const token = decodeURIComponent(inviteEmail.body.match(/accept-invite\/([^\s]+)/)![1]);

      const result = await service.acceptInvite({ token, password: 'teacher-password-1' });
      expect(result.access_token).toBe('signed.jwt');

      const teacher = state.users.find((u) => u.email === 'teacher@happy.edu')!;
      expect(teacher.status).toBe('ACTIVE');
      expect(teacher.tenantId).toBe(admin.user.tenantId);
    });

    it('a leftover invite token cannot UN-DISABLE an account the operator just cut off', async () => {
      const admin = await service.signup({
        districtName: 'Fired District',
        slug: 'fired',
        adminEmail: 'admin@fired.edu',
        password: 'admin-password-fired',
      });
      await service.createInvite({
        inviterId: admin.user.id,
        tenantId: admin.user.tenantId,
        email: 'leaver@fired.edu',
        role: 'CONTRIBUTOR',
      });
      const inviteEmail = [...state.emailLogs].reverse().find(
        (e) => e.kind === 'INVITE' && e.toEmail === 'leaver@fired.edu',
      )!;
      const token = decodeURIComponent(inviteEmail.body.match(/accept-invite\/([^\s]+)/)![1]);

      // The admin sets their password directly (invite email never arrived),
      // then later disables the account — the ORIGINAL token is still unused.
      await service.createUserDirect({
        inviterId: admin.user.id,
        tenantId: admin.user.tenantId,
        email: 'leaver@fired.edu',
        role: 'CONTRIBUTOR',
        password: 'handed-over-password',
      });
      const row = state.users.find((u) => u.email === 'leaver@fired.edu')!;
      row.status = 'DISABLED';

      await expect(
        service.acceptInvite({ token, password: 'back-in-please-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(state.users.find((u) => u.email === 'leaver@fired.edu')!.status).toBe('DISABLED');
    });

    it('the SAME-tenant admin-sets-password recovery path still works on a PENDING row', async () => {
      const admin = await service.signup({
        districtName: 'Recovery District',
        slug: 'recovery',
        adminEmail: 'admin@recovery.edu',
        password: 'admin-password-recov',
      });
      await service.createInvite({
        inviterId: admin.user.id,
        tenantId: admin.user.tenantId,
        email: 'stuck@recovery.edu',
        role: 'CONTRIBUTOR',
      });

      const created = await service.createUserDirect({
        inviterId: admin.user.id,
        tenantId: admin.user.tenantId,
        email: 'stuck@recovery.edu',
        role: 'CONTRIBUTOR',
        password: 'admin-set-password-1',
      });

      expect(created.status).toBe('ACTIVE');
      const row = state.users.find((u) => u.email === 'stuck@recovery.edu')!;
      expect(row.tenantId).toBe(admin.user.tenantId);
    });
  });
});
