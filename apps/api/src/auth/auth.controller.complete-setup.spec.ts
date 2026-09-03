/**
 * POST /auth/complete-setup — FIRST-LOGIN CREDENTIAL SETUP (2026-09-03).
 *
 * A multi-location operator provisions one account per site with a PLACEHOLDER
 * email (`riot-jacksonville@riotcolor.com`) and a per-location starter
 * password, because whoever will run that location is not known yet. This is
 * the one door out of that state, and these tests pin its contract:
 *
 *   1. it rotates BOTH credentials and clears the flag in ONE write — an
 *      account can never end up with a real email and a live setup gate;
 *   2. it REVOKES every other live session, so the shared starter credential
 *      cannot outlive the handover;
 *   3. it writes the forensic row that answers "who took ownership of the
 *      Jacksonville account, and when" (§16);
 *   4. it is NOT a general email-change route — an account without the live
 *      flag is refused, checked against the DATABASE ROW, never the token;
 *   5. neither provisioning credential may survive: the placeholder email and
 *      the starter password are each refused explicitly;
 *   6. a duplicate email is a clean 409, both on the pre-check and on the
 *      unique-constraint race, never a raw Prisma error;
 *   7. the password floor is the platform's existing one, not a second rule.
 */
import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthController, CompleteSetupSchema } from './auth.controller';
import { ZodValidationPipe } from '../security/zod-validation.pipe';

const PLACEHOLDER_EMAIL = 'riot-jacksonville@riotcolor.com';

const DB_USER = {
  id: 'u1',
  email: PLACEHOLDER_EMAIL,
  role: 'SCHOOL_ADMIN',
  tenantId: 'tenant-riot-jax',
  canTriggerPanic: false,
  firstName: null,
  lastName: null,
  passwordHash: '$argon2id$starter-hash',
  mustSetupCredentials: true,
};

const BODY = { email: 'dana@riotcolor.com', password: 'a-real-password-1' };

function makeReq(user: any = { userId: 'u1', id: 'u1' }): any {
  return {
    ip: '203.0.113.9',
    headers: { 'user-agent': 'jest-agent/1.0' },
    user,
  };
}

function setup(
  opts: {
    dbUser?: Partial<typeof DB_USER> | null;
    /** Another account already owns the requested address. */
    emailTakenBy?: string | null;
    /** The submitted password matches the stored starter hash. */
    passwordUnchanged?: boolean;
    /** The update loses a race and hits the unique constraint. */
    updateConflicts?: boolean;
    /** The update fails for a reason that is NOT a unique-constraint clash. */
    updateThrows?: Error;
    revokeThrows?: boolean;
  } = {},
) {
  const row = opts.dbUser === null ? null : { ...DB_USER, ...(opts.dbUser ?? {}) };

  const auditCreate = jest.fn().mockResolvedValue({});
  const userUpdate = jest.fn(async () => {
    if (opts.updateThrows) throw opts.updateThrows;
    if (opts.updateConflicts) {
      const e: any = new Error('Unique constraint failed on the fields: (`email`)');
      e.code = 'P2002';
      throw e;
    }
    return {};
  });
  const userFindUnique = jest.fn(async ({ where }: any) => {
    if (where?.id) return row;
    // Called with `{ where: { email } }` — the duplicate pre-check.
    return opts.emailTakenBy ? { id: opts.emailTakenBy } : null;
  });
  const markUserTokensInvalid = jest.fn(async () => {
    if (opts.revokeThrows) throw new Error('redis down');
  });
  const signSessionToken = jest.fn().mockReturnValue('fresh.jwt.token');

  const authService = {
    hashPassword: jest.fn().mockResolvedValue('$argon2id$new-hash'),
    verifyPassword: jest.fn().mockResolvedValue(!!opts.passwordUnchanged),
    signSessionToken,
    validateUser: jest.fn(),
    tenantIdForEmail: jest.fn(),
    login: jest.fn(),
  };
  const redisService = { publisher: null, markUserTokensInvalid };
  const prisma = {
    client: {
      auditLog: { create: auditCreate },
      tenant: { findUnique: jest.fn().mockResolvedValue({ slug: 'riot-jax', vertical: 'RETAIL', name: 'Riot Jacksonville' }), upsert: jest.fn() },
      user: { findUnique: userFindUnique, update: userUpdate },
    },
  };
  const controller = new AuthController(authService as any, redisService as any, prisma as any);
  return { controller, authService, auditCreate, userUpdate, markUserTokensInvalid, signSessionToken };
}

describe('AuthController.completeSetup', () => {
  describe('the happy path', () => {
    it('rotates the email + password and clears the flag in ONE write', async () => {
      const { controller, authService, userUpdate } = setup();

      const res: any = await controller.completeSetup(BODY as any, makeReq());

      expect(authService.hashPassword).toHaveBeenCalledWith(BODY.password);
      expect(userUpdate).toHaveBeenCalledTimes(1);
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: {
          email: 'dana@riotcolor.com',
          passwordHash: '$argon2id$new-hash',
          mustSetupCredentials: false,
        },
      });
      expect(res.success).toBe(true);
    });

    it('normalizes the email to lowercase, trimmed', async () => {
      const { controller, userUpdate } = setup();
      await controller.completeSetup({ email: '  Dana@RiotColor.com  ', password: BODY.password } as any, makeReq());
      expect(userUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'dana@riotcolor.com' }) }),
      );
    });

    it('revokes every other live session and returns a replacement token past the cut', async () => {
      const { controller, markUserTokensInvalid, signSessionToken } = setup();

      const res: any = await controller.completeSetup(BODY as any, makeReq());

      expect(markUserTokensInvalid).toHaveBeenCalledWith('u1', expect.any(Number));
      const revokeEpoch = markUserTokensInvalid.mock.calls[0][1] as unknown as number;
      // The replacement token is pinned to `revokeEpoch + 1` — the first `iat`
      // that survives the revocation, so every OTHER token is strictly older.
      expect(signSessionToken).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'u1', email: 'dana@riotcolor.com', mustSetupCredentials: false }),
        { iatSeconds: revokeEpoch + 1 },
      );
      expect(res.access_token).toBe('fresh.jwt.token');
      expect(res.sessionsRevoked).toBe(true);
    });

    it('writes the forensic row naming both addresses (§16)', async () => {
      const { controller, auditCreate } = setup();

      await controller.completeSetup(BODY as any, makeReq());

      expect(auditCreate).toHaveBeenCalledTimes(1);
      const row = auditCreate.mock.calls[0][0].data;
      expect(row).toMatchObject({
        tenantId: 'tenant-riot-jax',
        userId: 'u1',
        action: 'USER_CREDENTIAL_SETUP_COMPLETED',
        targetType: 'User',
        targetId: 'u1',
      });
      const details = JSON.parse(row.details);
      expect(details).toMatchObject({
        previousEmail: PLACEHOLDER_EMAIL,
        newEmail: 'dana@riotcolor.com',
        sessionsRevoked: true,
      });
      expect(details.ip).toBeTruthy();
    });

    it('returns the login-shaped user with the flag cleared, so the client can swap its session', async () => {
      const { controller } = setup();
      const res: any = await controller.completeSetup(BODY as any, makeReq());
      expect(res.user).toEqual({
        id: 'u1',
        email: 'dana@riotcolor.com',
        role: 'SCHOOL_ADMIN',
        firstName: null,
        lastName: null,
        tenantId: 'tenant-riot-jax',
        tenantSlug: 'riot-jax',
        tenantName: 'Riot Jacksonville',
        tenantVertical: 'RETAIL',
        canTriggerPanic: false,
        mustSetupCredentials: false,
      });
    });

    it('still succeeds — and says so honestly — when session revocation fails', async () => {
      const { controller, userUpdate } = setup({ revokeThrows: true });
      const res: any = await controller.completeSetup(BODY as any, makeReq());
      // The credentials ARE rotated; the partial outcome is surfaced, not hidden.
      expect(userUpdate).toHaveBeenCalled();
      expect(res.success).toBe(true);
      expect(res.sessionsRevoked).toBe(false);
    });
  });

  describe('this is NOT a general email-change route', () => {
    it('refuses an account whose LIVE row is not in setup state', async () => {
      const { controller, userUpdate } = setup({ dbUser: { mustSetupCredentials: false } });

      await expect(controller.completeSetup(BODY as any, makeReq())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(controller.completeSetup(BODY as any, makeReq())).rejects.toMatchObject({
        response: { code: 'SETUP_NOT_REQUIRED' },
      });
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('refuses a machine identity', async () => {
      const { controller } = setup();
      for (const actor of [
        { userId: null, id: null, kind: 'api-key' },
        { userId: 'screen-1', id: 'screen-1', kind: 'device' },
        {},
      ]) {
        await expect(controller.completeSetup(BODY as any, makeReq(actor))).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
      }
    });

    it('refuses when the row is gone', async () => {
      const { controller } = setup({ dbUser: null });
      await expect(controller.completeSetup(BODY as any, makeReq())).rejects.toMatchObject({
        response: { code: 'AUTH_USER_NOT_FOUND' },
      });
    });
  });

  describe('neither provisioning credential may survive', () => {
    it('refuses keeping the placeholder email', async () => {
      const { controller, userUpdate } = setup();
      await expect(
        controller.completeSetup({ email: PLACEHOLDER_EMAIL, password: BODY.password } as any, makeReq()),
      ).rejects.toMatchObject({ response: { code: 'SETUP_EMAIL_UNCHANGED' } });
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('refuses keeping the placeholder email regardless of case/whitespace', async () => {
      const { controller } = setup();
      await expect(
        controller.completeSetup(
          { email: '  Riot-Jacksonville@RiotColor.com ', password: BODY.password } as any,
          makeReq(),
        ),
      ).rejects.toMatchObject({ response: { code: 'SETUP_EMAIL_UNCHANGED' } });
    });

    it('refuses keeping the starter password', async () => {
      const { controller, authService, userUpdate } = setup({ passwordUnchanged: true });
      await expect(controller.completeSetup(BODY as any, makeReq())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(authService.verifyPassword).toHaveBeenCalledWith('$argon2id$starter-hash', BODY.password);
      expect(userUpdate).not.toHaveBeenCalled();
    });
  });

  describe('a duplicate email is a clean 409, never a Prisma error', () => {
    it('409s on the pre-check', async () => {
      const { controller, userUpdate } = setup({ emailTakenBy: 'someone-else' });
      await expect(controller.completeSetup(BODY as any, makeReq())).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(controller.completeSetup(BODY as any, makeReq())).rejects.toMatchObject({
        response: { code: 'SETUP_EMAIL_IN_USE' },
      });
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('409s when the address is claimed between the check and the write (P2002)', async () => {
      const { controller } = setup({ updateConflicts: true });
      await expect(controller.completeSetup(BODY as any, makeReq())).rejects.toMatchObject({
        response: { code: 'SETUP_EMAIL_IN_USE' },
      });
    });

    it('rethrows a non-P2002 database error rather than mislabelling it', async () => {
      const { controller } = setup({ updateThrows: new Error('connection reset') });
      await expect(controller.completeSetup(BODY as any, makeReq())).rejects.toThrow('connection reset');
    });
  });

  describe('the password floor is the platform policy, not a second rule', () => {
    const pipe = new ZodValidationPipe(CompleteSetupSchema);
    const meta = {} as any;

    it('rejects a password under 8 characters', () => {
      expect(() => pipe.transform({ email: 'a@b.co', password: 'short7!' }, meta)).toThrow(
        BadRequestException,
      );
    });

    it('rejects an over-long password (the argon2 DoS bound)', () => {
      expect(() => pipe.transform({ email: 'a@b.co', password: 'x'.repeat(201) }, meta)).toThrow(
        BadRequestException,
      );
    });

    it('accepts exactly 8 characters', () => {
      expect(pipe.transform({ email: 'a@b.co', password: '12345678' }, meta)).toEqual({
        email: 'a@b.co',
        password: '12345678',
      });
    });

    it('rejects a malformed email', () => {
      expect(() => pipe.transform({ email: 'not-an-email', password: BODY.password }, meta)).toThrow(
        BadRequestException,
      );
    });

    it('rejects unknown fields (strict) — no smuggling role or tenantId', () => {
      expect(() =>
        pipe.transform({ ...BODY, role: 'SUPER_ADMIN' } as any, meta),
      ).toThrow(BadRequestException);
    });
  });
});
