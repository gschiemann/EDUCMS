import { AuthController } from './auth.controller';
import { requireSecret } from '../security/required-secret';
import { hashEmailCode, MFA_EMAIL_CODE_MAX_ATTEMPTS } from './mfa-email-code';
import { setupEmailChallengeHash } from './setup-email-verification';

const PLACEHOLDER = 'riot-houston@riotcolor.com';
const NEW_EMAIL = 'manager@riotcolor.com';
const secret = () => requireSecret('JWT_SECRET', { devFallback: 'dev_only_jwt_secret_CHANGE_ME' });
const CODE = '123456';

const DB_USER = {
  id: 'u1',
  email: PLACEHOLDER,
  role: 'SCHOOL_ADMIN',
  tenantId: 'tenant-houston',
  canTriggerPanic: false,
  firstName: null,
  lastName: null,
  passwordHash: '$argon2id$starter-hash',
  mustSetupCredentials: true,
};

const makeReq = (user: any = { userId: 'u1', id: 'u1' }): any => ({
  ip: '203.0.113.9',
  headers: { 'user-agent': 'jest-agent/1.0' },
  user,
});

function goodRow(over: Record<string, unknown> = {}) {
  const challengeHash = setupEmailChallengeHash('u1', NEW_EMAIL);
  return {
    id: 'row1',
    userId: 'u1',
    challengeHash,
    codeHash: hashEmailCode(secret(), challengeHash, CODE),
    attempts: 0,
    usedAt: null,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    ...over,
  };
}

function setup(
  opts: {
    deliverable?: boolean;
    dbUser?: Partial<typeof DB_USER>;
    emailTaken?: boolean;
    recentSends?: number;
    networkSends?: number;
    sendStatus?: 'SENT' | 'FAILED';
    row?: any | null;
  } = {},
) {
  const dbUser = { ...DB_USER, ...(opts.dbUser ?? {}) };
  const mfa = {
    findMany: jest.fn(async () =>
      Array.from({ length: opts.recentSends ?? 0 }, (_, i) => ({ createdAt: new Date(Date.now() - i * 1000) })),
    ),
    count: jest.fn(async () => opts.networkSends ?? 0),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    create: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(async () => (opts.row === undefined ? null : opts.row)),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const userUpdate = jest.fn().mockResolvedValue({});
  const auditCreate = jest.fn().mockResolvedValue({});
  const prisma = {
    client: {
      mfaEmailCode: mfa,
      auditLog: { create: auditCreate },
      tenant: { findUnique: jest.fn().mockResolvedValue({ slug: 'riot-houston', vertical: 'CORPORATE', name: 'RIOT Houston' }) },
      user: {
        findUnique: jest.fn(async ({ where }: any) => (where?.id ? dbUser : opts.emailTaken ? { id: 'someone-else' } : null)),
        update: userUpdate,
      },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    },
  };
  const authService = {
    hashPassword: jest.fn().mockResolvedValue('$argon2id$new'),
    verifyPassword: jest.fn().mockResolvedValue(false),
    signSessionToken: jest.fn().mockReturnValue('fresh.jwt'),
  };
  const redis = { markUserTokensInvalid: jest.fn().mockResolvedValue(undefined) };
  const sent: Array<{ to: string; code: string }> = [];
  const emailService = {
    isConfigured: () => true,
    isDeliverableToArbitraryRecipients: () => opts.deliverable ?? true,
    sendSetupEmailCode: jest.fn(async (p: { to: string; code: string }) => {
      sent.push(p);
      return opts.sendStatus ?? 'SENT';
    }),
  };
  const controller = new AuthController(authService as any, redis as any, prisma as any, emailService as any);
  return { controller, mfa, userUpdate, auditCreate, emailService, sent };
}

const send = (c: AuthController, email = NEW_EMAIL, req = makeReq()) =>
  c.sendSetupEmailCode({ email } as any, req);
const finish = (c: AuthController, emailCode?: string, email = NEW_EMAIL) =>
  c.completeSetup({ email, password: 'a-real-password-1', ...(emailCode !== undefined ? { emailCode } : {}) } as any, makeReq());

const OLD_ENV = process.env.SETUP_EMAIL_VERIFICATION;
afterEach(() => {
  if (OLD_ENV === undefined) delete process.env.SETUP_EMAIL_VERIFICATION;
  else process.env.SETUP_EMAIL_VERIFICATION = OLD_ENV;
});

describe('POST /auth/complete-setup/email-code', () => {
  it('says "not required" — and sends nothing — when mail cannot reach arbitrary inboxes', async () => {
    const { controller, emailService, mfa } = setup({ deliverable: false });
    await expect(send(controller)).resolves.toEqual({ required: false });
    expect(emailService.sendSetupEmailCode).not.toHaveBeenCalled();
    expect(mfa.create).not.toHaveBeenCalled();
  });

  it('emails a code to the NEW address, bound to (account, address), and never returns it', async () => {
    const { controller, mfa, sent, auditCreate } = setup();
    const out = await send(controller);
    expect(out).toEqual({ required: true, sent: true, expiresInSeconds: 600 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(NEW_EMAIL); // not the placeholder
    expect(sent[0].code).toMatch(/^\d{6}$/);

    const challengeHash = setupEmailChallengeHash('u1', NEW_EMAIL);
    const data = (mfa.create.mock.calls[0][0] as any).data;
    expect(data.userId).toBe('u1');
    expect(data.challengeHash).toBe(challengeHash);
    expect(data.codeHash).toBe(hashEmailCode(secret(), challengeHash, sent[0].code));
    expect(JSON.stringify(out)).not.toContain(sent[0].code);
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(sent[0].code);
    expect(auditCreate.mock.calls[0][0].data.action).toBe('USER_SETUP_EMAIL_CODE_SENT');
  });

  it('a second code for the same address replaces the first', async () => {
    const { controller, mfa } = setup();
    await send(controller);
    expect(mfa.deleteMany).toHaveBeenCalledWith({ where: { challengeHash: setupEmailChallengeHash('u1', NEW_EMAIL) } });
  });

  it('SETUP_EMAIL_VERIFICATION=required sends even on the shared sender; =off never does', async () => {
    process.env.SETUP_EMAIL_VERIFICATION = 'required';
    const on = setup({ deliverable: false });
    await expect(send(on.controller)).resolves.toMatchObject({ required: true });
    process.env.SETUP_EMAIL_VERIFICATION = 'off';
    const off = setup({ deliverable: true });
    await expect(send(off.controller)).resolves.toEqual({ required: false });
  });

  it('refuses the placeholder address and an address another account holds', async () => {
    await expect(send(setup().controller, PLACEHOLDER)).rejects.toMatchObject({ response: { code: 'SETUP_EMAIL_UNCHANGED' } });
    await expect(send(setup({ emailTaken: true }).controller)).rejects.toMatchObject({ response: { code: 'SETUP_EMAIL_IN_USE' } });
  });

  it('is rate limited per account and per network', async () => {
    await expect(send(setup({ recentSends: 6 }).controller)).rejects.toMatchObject({ response: { code: 'SETUP_EMAIL_CODE_TOO_MANY' } });
    await expect(send(setup({ networkSends: 30 }).controller)).rejects.toMatchObject({ response: { code: 'SETUP_EMAIL_CODE_TOO_MANY' } });
  });

  it('a provider failure is a 503 and leaves no usable row behind', async () => {
    const { controller, mfa } = setup({ sendStatus: 'FAILED' });
    await expect(send(controller)).rejects.toMatchObject({ response: { code: 'SETUP_EMAIL_CODE_NOT_SENT' } });
    expect(mfa.deleteMany).toHaveBeenCalledTimes(2); // replace-old, then remove-on-failure
  });

  it('is for an account in setup state only, and never for a machine identity', async () => {
    await expect(send(setup({ dbUser: { mustSetupCredentials: false } }).controller)).rejects.toMatchObject({ response: { code: 'SETUP_NOT_REQUIRED' } });
    await expect(send(setup().controller, NEW_EMAIL, makeReq({ id: 'dev', kind: 'device' }))).rejects.toMatchObject({ response: { code: 'AUTH_SETUP_NOT_APPLICABLE' } });
  });
});

describe('POST /auth/complete-setup — with the emailed code required', () => {
  it('refuses to finish without a code, and writes nothing', async () => {
    const { controller, userUpdate } = setup({ row: goodRow() });
    await expect(finish(controller)).rejects.toMatchObject({ response: { code: 'SETUP_EMAIL_CODE_REQUIRED' } });
    await expect(finish(controller, 'abc')).rejects.toMatchObject({ response: { code: 'SETUP_EMAIL_CODE_REQUIRED' } });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('a wrong code is counted and refused', async () => {
    const { controller, mfa, userUpdate } = setup({ row: goodRow() });
    await expect(finish(controller, '000000')).rejects.toMatchObject({ response: { code: 'SETUP_EMAIL_CODE_INVALID' } });
    expect(mfa.update).toHaveBeenCalledWith({ where: { id: 'row1' }, data: { attempts: { increment: 1 } } });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('the right code finishes setup and is spent exactly once', async () => {
    const { controller, mfa, userUpdate } = setup({ row: goodRow() });
    const out: any = await finish(controller, '123 456'); // spaces are tolerated
    expect(out.success).toBe(true);
    expect(userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: NEW_EMAIL, mustSetupCredentials: false }) }));
    expect(mfa.updateMany).toHaveBeenCalledWith({ where: { id: 'row1', usedAt: null }, data: { usedAt: expect.any(Date) } });
  });

  it('a spent code, an expired code and a locked code all refuse — even the right digits', async () => {
    await expect(finish(setup({ row: goodRow({ usedAt: new Date() }) }).controller, CODE)).rejects.toMatchObject({ response: { code: 'SETUP_EMAIL_CODE_INVALID' } });
    await expect(finish(setup({ row: goodRow({ expiresAt: new Date(Date.now() - 1000) }) }).controller, CODE)).rejects.toMatchObject({ response: { code: 'SETUP_EMAIL_CODE_EXPIRED' } });
    const locked = setup({ row: goodRow({ attempts: MFA_EMAIL_CODE_MAX_ATTEMPTS }) });
    await expect(finish(locked.controller, CODE)).rejects.toMatchObject({ response: { code: 'SETUP_EMAIL_CODE_LOCKED' } });
    expect(locked.userUpdate).not.toHaveBeenCalled();
  });

  it('a code emailed to one address cannot finish setup with another', async () => {
    // No row exists for (account, other address).
    const { controller, userUpdate } = setup({ row: null });
    await expect(finish(controller, CODE, 'other@riotcolor.com')).rejects.toMatchObject({ response: { code: 'SETUP_EMAIL_CODE_INVALID' } });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('a row that belongs to another account is not honoured', async () => {
    const { controller } = setup({ row: goodRow({ userId: 'someone-else' }) });
    await expect(finish(controller, CODE)).rejects.toMatchObject({ response: { code: 'SETUP_EMAIL_CODE_INVALID' } });
  });

  it('needs no code when verification is off for this deploy — setup works exactly as before', async () => {
    const { controller, userUpdate } = setup({ deliverable: false });
    await expect(finish(controller)).resolves.toMatchObject({ success: true });
    expect(userUpdate).toHaveBeenCalled();
  });
});
