/**
 * FIRST SIGN-IN ORDER (2026-10-10): claim the account FIRST, then two-step.
 *
 * Before: an account still on its provisioning credentials
 * (`mustSetupCredentials`) whose role requires a second factor was held at
 * `/auth/login` by the enrollment step, so the passkey / authenticator was
 * registered — and emailed codes were sent — under the STARTER address
 * (`riot-tulsa@riotcolor.com`, a mailbox nobody owns). Only afterwards was the
 * person asked for their own email.
 *
 * After:
 *   1. `/auth/login` gives such an account a session STAMPED `msc: true` —
 *      which JwtAuthGuard confines to the setup routes (pinned by
 *      jwt-auth.guard.setup-gate.spec.ts) — instead of the enrollment step;
 *   2. `/auth/complete-setup` then returns the enrollment envelope, NOT a
 *      session, whenever the policy is blocking for the now-claimed account;
 *   3. an account that already HOLDS a factor is still challenged first.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthController } from './auth.controller';
import { SETUP_REQUIRED_ALLOWED_ROUTES } from './jwt-auth.guard';

const ENFORCING_TENANT = { slug: 'riot-tulsa', vertical: 'CORPORATE', name: 'RIOT Tulsa', mfaEnforced: true };

async function makeService(userRow: any, passkeys = 0) {
  const sign = jest.fn((payload: any) => `jwt:${JSON.stringify(payload)}`);
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: JwtService, useValue: { sign } },
      {
        provide: PrismaService,
        useValue: {
          client: {
            user: { findUnique: jest.fn().mockResolvedValue(userRow) },
            tenant: { findUnique: jest.fn().mockResolvedValue(ENFORCING_TENANT) },
            passkey: { count: jest.fn().mockResolvedValue(passkeys) },
          },
        },
      },
    ],
  }).compile();
  return { service: module.get(AuthService), sign };
}

const BRANCH = {
  id: 'u-tulsa',
  email: 'riot-tulsa@riotcolor.com',
  role: 'SCHOOL_ADMIN',
  tenantId: 't-tulsa',
  canTriggerPanic: false,
  mfaRequired: false,
  mfaTotpVerifiedAt: null,
};

describe('AuthService.login — an account in setup state claims its email BEFORE two-step', () => {
  it('a privileged account still on its starter credentials gets a SETUP-GATED session, not the enrollment step', async () => {
    const { service, sign } = await makeService(null);
    const res: any = await service.login({ ...BRANCH, mustSetupCredentials: true });
    expect(res.mfaEnrollmentRequired).toBeUndefined();
    expect(typeof res.access_token).toBe('string');
    expect(res.user.mustSetupCredentials).toBe(true);
    // The token carries msc:true — the guard's only input on the hot path.
    expect(sign.mock.calls[0][0]).toEqual(expect.objectContaining({ sub: 'u-tulsa', msc: true }));
  });

  it('the same account AFTER setup is held for enrollment exactly as before', async () => {
    const { service } = await makeService(null);
    const res: any = await service.login({ ...BRANCH, mustSetupCredentials: false });
    expect(res.access_token).toBeUndefined();
    expect(res.mfaEnrollmentRequired).toBe(true);
  });

  it('an account in setup state that already HOLDS a factor is still challenged (never a bypass)', async () => {
    const { service } = await makeService(null);
    const res: any = await service.login({
      ...BRANCH,
      mustSetupCredentials: true,
      mfaTotpVerifiedAt: new Date('2026-10-01'),
    });
    expect(res.mfaRequired).toBe(true);
    expect(res.access_token).toBeUndefined();
  });

  it('the setup-gated session reaches nothing but the setup routes', () => {
    // Pinned in full by jwt-auth.guard.setup-gate.spec.ts; restated here
    // because this ordering change leans on it being exactly this short.
    expect(SETUP_REQUIRED_ALLOWED_ROUTES.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'GET /api/v1/users/me',
      'POST /api/v1/auth/complete-setup',
      'POST /api/v1/auth/complete-setup/email-code',
      'POST /api/v1/auth/logout',
    ]);
  });
});

describe('AuthService.requiredEnrollmentEnvelope — what complete-setup hands back', () => {
  const row = (over: Record<string, unknown> = {}) => ({ ...BRANCH, _count: { passkeys: 0 }, ...over });

  it('blocking policy → the enrollment envelope with a challenge token', async () => {
    const { service } = await makeService(row());
    const env = await service.requiredEnrollmentEnvelope('u-tulsa');
    expect(env).toEqual({
      mfaRequired: true,
      mfaEnrollmentRequired: true,
      mfaMethods: [],
      mfaToken: expect.any(String),
    });
  });

  it('no factor owed (a CONTRIBUTOR) → null, and a normal session is issued', async () => {
    const { service } = await makeService(row({ role: 'CONTRIBUTOR' }));
    await expect(service.requiredEnrollmentEnvelope('u-tulsa')).resolves.toBeNull();
  });

  it('already enrolled (a passkey) → null', async () => {
    const { service } = await makeService(row({ _count: { passkeys: 1 } }));
    await expect(service.requiredEnrollmentEnvelope('u-tulsa')).resolves.toBeNull();
  });
});

describe('POST /auth/complete-setup — the two-step setup comes next, with no session in between', () => {
  function controllerWith(envelope: any, opts: { throws?: boolean } = {}) {
    const prisma: any = {
      client: {
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        tenant: { findUnique: jest.fn().mockResolvedValue(ENFORCING_TENANT) },
        user: {
          findUnique: jest.fn(async ({ where }: any) =>
            where?.id ? { ...BRANCH, firstName: null, lastName: null, passwordHash: 'h', mustSetupCredentials: true } : null,
          ),
          update: jest.fn().mockResolvedValue({}),
        },
        $transaction: jest.fn(async (fn: any) => fn(prisma.client)),
      },
    };
    const authService = {
      hashPassword: jest.fn().mockResolvedValue('new-hash'),
      verifyPassword: jest.fn().mockResolvedValue(false),
      signSessionToken: jest.fn().mockReturnValue('session.jwt'),
      requiredEnrollmentEnvelope: opts.throws
        ? jest.fn().mockRejectedValue(new Error('db blip'))
        : jest.fn().mockResolvedValue(envelope),
    };
    const redis = { markUserTokensInvalid: jest.fn().mockResolvedValue(undefined) };
    const controller = new AuthController(authService as any, redis as any, prisma as any);
    return { controller, authService, redis, prisma };
  }
  const req: any = { headers: { 'user-agent': 'jest' }, user: { id: 'u-tulsa', userId: 'u-tulsa' } };
  const body: any = { email: 'dana@riotcolor.com', password: 'a-real-password-1' };
  const ENVELOPE = { mfaRequired: true, mfaEnrollmentRequired: true, mfaMethods: [], mfaToken: 'challenge.jwt' };

  it('policy blocking → envelope, NO access token, every session revoked, audit says two-step is next', async () => {
    const { controller, authService, redis, prisma } = controllerWith(ENVELOPE);
    const res: any = await controller.completeSetup(body, req);
    expect(res).toEqual({ success: true, sessionsRevoked: true, email: 'dana@riotcolor.com', ...ENVELOPE });
    expect(res.access_token).toBeUndefined();
    expect(authService.signSessionToken).not.toHaveBeenCalled();
    expect(redis.markUserTokensInvalid).toHaveBeenCalledWith('u-tulsa', expect.any(Number));
    // The new address is saved BEFORE the factor is registered under it.
    expect(prisma.client.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'dana@riotcolor.com', mustSetupCredentials: false }) }),
    );
    const details = JSON.parse(prisma.client.auditLog.create.mock.calls[0][0].data.details);
    expect(details.twoStepSetupNext).toBe(true);
  });

  it('nothing owed → the session, exactly as before', async () => {
    const { controller } = controllerWith(null);
    const res: any = await controller.completeSetup(body, req);
    expect(res.access_token).toBe('session.jwt');
    expect(res.mfaRequired).toBeUndefined();
  });

  it('the policy cannot be read → fail closed: no session, sign in again', async () => {
    const { controller, authService } = controllerWith(null, { throws: true });
    const res: any = await controller.completeSetup(body, req);
    expect(res).toEqual({ success: true, sessionsRevoked: true, email: 'dana@riotcolor.com', signInAgain: true });
    expect(authService.signSessionToken).not.toHaveBeenCalled();
  });
});
