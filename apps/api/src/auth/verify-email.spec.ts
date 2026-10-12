/**
 * SELF-SIGNUP EMAIL VERIFICATION (2026-10-11, launch security re-audit).
 *
 *  - JwtAuthGuard: a token minted while the email is unproven (`evv: false`)
 *    reaches only verify-email / logout / me; everything else (SSO config, POS
 *    connect, invites, emergency) is a 403 EMAIL_VERIFICATION_REQUIRED.
 *    `evv: true` and claim-less tokens cost NO database read.
 *  - The gate lifts the moment the row says verified (cached lookup), even on
 *    the old token.
 *  - VerifyEmailController: send → confirm with the emailed code flips the
 *    row, spends the code, audits, and returns a token stamped `evv: true`;
 *    a wrong code changes nothing.
 */
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard, EMAIL_VERIFICATION_ALLOWED_ROUTES } from './jwt-auth.guard';
import { VerifyEmailController, verifyEmailChallengeHash } from './verify-email.controller';
import { emailVerifiedClaim } from './auth.service';

const TEST_SECRET = 'dev_only_jwt_secret_CHANGE_ME';

function ctxFor(token: string, method: string, url: string) {
  const request: any = { headers: { authorization: `Bearer ${token}` }, method, originalUrl: url, url, user: undefined };
  return { switchToHttp: () => ({ getRequest: () => request }) } as any;
}
const redis = () => ({ sismember: jest.fn(async () => false), getTokenInvalidBefore: jest.fn(async () => null) });

describe('JwtAuthGuard — self-signup email verification gate', () => {
  const jwt = new JwtService({ secret: TEST_SECRET });
  const prev = process.env.JWT_SECRET;
  beforeAll(() => { process.env.JWT_SECRET = TEST_SECRET; });
  afterAll(() => { if (prev === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prev; });

  function guardWith(pending: boolean) {
    const findUnique = jest.fn(async () => ({ emailVerificationPending: pending, mustSetupCredentials: false }));
    const prisma = { client: { user: { findUnique }, tenant: { findUnique: jest.fn(async () => null) } } };
    return { guard: new JwtAuthGuard(jwt, redis() as any, undefined, prisma as any), findUnique };
  }
  const pendingToken = () => jwt.sign({ sub: 'u1', role: 'DISTRICT_ADMIN', tenantId: 't1', msc: false, evv: false });

  it.each([
    ['POST', '/api/v1/tenants/acme/sso'],
    ['GET', '/api/v1/pos/oauth/shopify-pos/authorize'],
    ['POST', '/api/v1/invites'],
    ['POST', '/api/v1/api-keys'],
    ['GET', '/api/v1/screens'],
    ['POST', '/api/v1/emergency/trigger'],
    ['PUT', '/api/v1/users/me'],
  ])('refuses %s %s while pending', async (method, url) => {
    const { guard } = guardWith(true);
    await expect(guard.canActivate(ctxFor(pendingToken(), method, url))).rejects.toMatchObject({
      response: { code: 'EMAIL_VERIFICATION_REQUIRED' },
    });
  });

  it.each(EMAIL_VERIFICATION_ALLOWED_ROUTES.map((r) => [r.method, r.path]))('allows %s %s while pending', async (method, url) => {
    const { guard } = guardWith(true);
    await expect(guard.canActivate(ctxFor(pendingToken(), method, url))).resolves.toBe(true);
  });

  it('the old `evv:false` token is let through once the row says verified', async () => {
    const { guard } = guardWith(false);
    await expect(guard.canActivate(ctxFor(pendingToken(), 'GET', '/api/v1/screens'))).resolves.toBe(true);
  });

  it('verified and claim-less tokens cost no database read', async () => {
    const { guard, findUnique } = guardWith(true);
    await guard.canActivate(ctxFor(jwt.sign({ sub: 'u1', role: 'DISTRICT_ADMIN', tenantId: 't1', msc: false, evv: true }), 'GET', '/api/v1/screens'));
    await guard.canActivate(ctxFor(jwt.sign({ sub: 'u1', role: 'DISTRICT_ADMIN', tenantId: 't1', msc: false }), 'GET', '/api/v1/screens'));
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('emailVerifiedClaim stamps only from a row that carries the column', () => {
    expect(emailVerifiedClaim({ emailVerificationPending: true })).toEqual({ evv: false });
    expect(emailVerifiedClaim({ emailVerificationPending: false })).toEqual({ evv: true });
    expect(emailVerifiedClaim({})).toEqual({});
  });
});

describe('VerifyEmailController', () => {
  function setup(pending = true) {
    const state: any = { user: { id: 'u1', email: 'owner@taco.test', tenantId: 't1', role: 'DISTRICT_ADMIN', canTriggerPanic: false, mustSetupCredentials: false, emailVerificationPending: pending }, codes: [] as any[], audits: [] as any[] };
    const client: any = {
      user: {
        findUnique: jest.fn(async () => ({ ...state.user })),
        update: jest.fn(async ({ data }: any) => { Object.assign(state.user, data); return state.user; }),
      },
      mfaEmailCode: {
        count: jest.fn(async () => state.codes.length),
        deleteMany: jest.fn(async ({ where }: any) => { state.codes = state.codes.filter((c: any) => c.challengeHash !== where.challengeHash); return { count: 1 }; }),
        create: jest.fn(async ({ data }: any) => { const row = { id: `c${state.codes.length + 1}`, attempts: 0, usedAt: null, ...data }; state.codes.push(row); return row; }),
        findUnique: jest.fn(async ({ where }: any) => state.codes.find((c: any) => c.challengeHash === where.challengeHash) ?? null),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const row = state.codes.find((c: any) => c.id === where.id && !c.usedAt);
          if (!row) return { count: 0 };
          if (data.attempts) row.attempts += 1;
          if (data.usedAt) row.usedAt = data.usedAt;
          return { count: 1 };
        }),
      },
      auditLog: { create: jest.fn(async ({ data }: any) => { state.audits.push(data); return {}; }) },
    };
    client.$transaction = jest.fn(async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(client)));
    let lastCode = '';
    const email = { sendSetupEmailCode: jest.fn(async ({ code }: any) => { lastCode = code; return 'SENT'; }) };
    const auth = { signSessionToken: jest.fn((u: any) => `token:${emailVerifiedClaim(u).evv}`) };
    const controller = new VerifyEmailController({ client } as any, auth as any, email as any);
    const req: any = { user: { id: 'u1' }, headers: {}, ip: '203.0.113.1' };
    return { controller, state, req, code: () => lastCode, email };
  }

  it('send emails a code to the signup address; confirm flips the row and returns a verified token', async () => {
    const t = setup();
    await t.controller.send(t.req);
    expect(t.email.sendSetupEmailCode).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@taco.test' }));
    expect(t.state.codes[0].challengeHash).toBe(verifyEmailChallengeHash('u1', 'owner@taco.test'));
    const out = await t.controller.confirm({ code: t.code() }, t.req);
    expect(out).toEqual({ verified: true, access_token: 'token:true' });
    expect(t.state.user.emailVerificationPending).toBe(false);
    expect(t.state.codes[0].usedAt).toBeTruthy();
    expect(t.state.audits.some((a: any) => a.action === 'USER_EMAIL_VERIFIED')).toBe(true);
    expect(JSON.stringify(t.state.audits)).not.toContain(t.code());
  });

  it('a wrong code changes nothing', async () => {
    const t = setup();
    await t.controller.send(t.req);
    const wrong = t.code() === '000000' ? '111111' : '000000';
    await expect(t.controller.confirm({ code: wrong }, t.req)).rejects.toBeInstanceOf(BadRequestException);
    expect(t.state.user.emailVerificationPending).toBe(true);
  });

  it('an already-verified account is refused (no general email-proof oracle)', async () => {
    const t = setup(false);
    await expect(t.controller.send(t.req)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
