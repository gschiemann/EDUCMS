import { Test, TestingModule } from '@nestjs/testing';
import { OnboardingService, hashToken, PASSWORD_RESET_TTL_MS } from './onboarding.service';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, ConflictException } from '@nestjs/common';

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

  beforeEach(async () => {
    const mem = createInMemoryPrisma();
    state = mem.state;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        EmailService,
        AuthService,
        { provide: PrismaService, useValue: { client: mem.client } },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('signed.jwt') } },
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
  });
});
