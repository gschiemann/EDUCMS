/**
 * THE EMAILED SIGN-IN CODE — the second step when the passkey is on another
 * device (2026-10-05). Owner: "I should be able to add the passkey right from
 * the mobile device, the idea is to make this workflow super user friendly".
 *
 * Walked through the REAL controller with a REAL JwtService (so the partial
 * `mfaToken` is a genuinely signed token with a genuine `purpose` claim), the
 * REAL per-user MFA limiter, and a stateful table double — the flows here are
 * sequences (send, send again, guess five times, wait out the clock), and a
 * fixture that returns one fixed row could not express any of them.
 *
 * What is proven, per the brief: issue, expiry, single use, the 5-attempt
 * limit, the per-account and per-IP send limits, an AuditLog row for every
 * send / success / failure, the "new sign-in" notice, not offered without
 * email, and unusable without the password step. Plus the interlock this
 * change adds: no emailed code for 7 days after a password reset.
 */

import { HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { MfaEmailCodeController } from './mfa-email-code.controller';
import { MfaRateLimiter } from './mfa-rate-limiter';
import { issueMfaChallengeToken } from './mfa-challenge-token';
import {
  MFA_EMAIL_CODE_MAX_ATTEMPTS,
  MFA_EMAIL_CODE_RESET_COOLDOWN_MS,
  MFA_EMAIL_CODE_TTL_MS,
} from './mfa-email-code';
import { __resetPasskeyEnrollmentGrantsForTests } from './passkey-enrollment-grant';

const SECRET = 'mfa-email-code-spec-secret-0123456789abcdef';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

interface Row {
  id: string;
  userId: string;
  challengeHash: string;
  codeHash: string;
  rememberMe: boolean;
  attempts: number;
  ipHash: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

interface FakeUser {
  id: string;
  email: string;
  role: string;
  tenantId: string;
  canTriggerPanic: boolean;
  firstName: string | null;
  lastName: string | null;
  status: string;
  deletedAt: Date | null;
  mustSetupCredentials: boolean;
  mfaTotpVerifiedAt: Date | null;
  tenant: { archivedAt: Date | null };
  passkeys: number;
}

function makeUser(over: Partial<FakeUser> = {}): FakeUser {
  return {
    id: 'owner-1',
    email: 'owner@venueos.example',
    role: 'SUPER_ADMIN',
    tenantId: 'tenant-1',
    canTriggerPanic: true,
    firstName: 'Greg',
    lastName: null,
    status: 'ACTIVE',
    deletedAt: null,
    mustSetupCredentials: false,
    mfaTotpVerifiedAt: null,
    tenant: { archivedAt: null },
    // The owner's case: ONE passkey, and it lives on his Mac.
    passkeys: 1,
    ...over,
  };
}

/** A stateful double of the four tables the controller touches. */
function makePrisma(users: FakeUser[]) {
  const rows: Row[] = [];
  const audits: Array<{
    action: string;
    tenantId: string;
    userId: string;
    details: Record<string, unknown>;
  }> = [];
  const resets: Array<{ userId: string; usedAt: Date | null }> = [];
  let seq = 0;

  const matches = (r: Row, where: any): boolean => {
    if (!where) return true;
    if (where.id !== undefined && r.id !== where.id) return false;
    if (where.userId !== undefined && r.userId !== where.userId) return false;
    if (where.ipHash !== undefined && r.ipHash !== where.ipHash) return false;
    if (where.usedAt === null && r.usedAt !== null) return false;
    if (
      where.expiresAt?.gt &&
      !(r.expiresAt.getTime() > where.expiresAt.gt.getTime())
    )
      return false;
    if (where.attempts?.lt !== undefined && !(r.attempts < where.attempts.lt))
      return false;
    if (
      where.createdAt?.gte &&
      !(r.createdAt.getTime() >= where.createdAt.gte.getTime())
    )
      return false;
    return true;
  };

  const client = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => {
        const u = users.find((x) => x.id === where.id);
        if (!u) return null;
        const { passkeys, ...rest } = u;
        return { ...rest, _count: { passkeys } };
      }),
    },
    passwordResetToken: {
      findFirst: jest.fn(async ({ where }: any) => {
        const hits = resets
          .filter((r) => r.userId === where.userId && r.usedAt)
          .sort((a, b) => b.usedAt!.getTime() - a.usedAt!.getTime());
        return hits[0] ? { usedAt: hits[0].usedAt } : null;
      }),
    },
    mfaEmailCode: {
      findMany: jest.fn(async ({ where }: any) =>
        rows
          .filter((r) => matches(r, where))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((r) => ({ createdAt: r.createdAt })),
      ),
      count: jest.fn(
        async ({ where }: any) => rows.filter((r) => matches(r, where)).length,
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of rows) {
          if (!matches(r, where)) continue;
          count += 1;
          if (data.expiresAt) r.expiresAt = data.expiresAt;
          if (data.usedAt) r.usedAt = data.usedAt;
          if (data.attempts?.increment) r.attempts += data.attempts.increment;
        }
        return { count };
      }),
      create: jest.fn(async ({ data }: any) => {
        const row: Row = {
          id: `code-${++seq}`,
          userId: data.userId,
          challengeHash: data.challengeHash,
          codeHash: data.codeHash,
          rememberMe: !!data.rememberMe,
          attempts: 0,
          ipHash: data.ipHash ?? null,
          expiresAt: data.expiresAt,
          usedAt: null,
          createdAt: new Date(),
        };
        rows.push(row);
        return { id: row.id };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const r = rows.find((x) => x.challengeHash === where.challengeHash);
        return r ? { ...r } : null;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        audits.push({
          action: data.action,
          tenantId: data.tenantId,
          userId: data.userId,
          details: JSON.parse(data.details),
        });
        return {};
      }),
    },
    $transaction: jest.fn(async (ops: Array<Promise<unknown>>) =>
      Promise.all(ops),
    ),
  };
  return { prisma: { client } as any, rows, audits, resets };
}

function build(
  opts: {
    users?: FakeUser[];
    delivery?: 'SENT' | 'SENT_UNVERIFIED' | 'FAILED';
  } = {},
) {
  const users = opts.users ?? [makeUser()];
  const db = makePrisma(users);
  const jwt = new JwtService({
    secret: SECRET,
    signOptions: { expiresIn: '1h' },
  });
  const sentCodes: Array<{ to: string; code: string }> = [];
  const email = {
    sendSignInCode: jest.fn(async (p: { to: string; code: string }) => {
      sentCodes.push(p);
      return opts.delivery ?? 'SENT';
    }),
    sendNewSignInNotice: jest.fn(async () => 'SENT'),
  };
  const auth = {
    login: jest.fn(async (user: any) => ({
      access_token: 'final-jwt',
      user: { id: user.id, email: user.email, role: user.role },
    })),
  };
  const rateLimiter = new MfaRateLimiter();
  const controller = new MfaEmailCodeController(
    db.prisma,
    auth as any,
    jwt,
    rateLimiter,
    email as any,
    undefined,
  );
  let ipSeq = 0;
  const req = (over: { ip?: string; ua?: string } = {}) => ({
    headers: { 'user-agent': over.ua ?? IPHONE_UA },
    ip: over.ip ?? '203.0.113.7',
    socket: { remoteAddress: over.ip ?? '203.0.113.7' },
  });
  const freshIp = () => `198.51.100.${++ipSeq}`;
  /** The partial token /auth/login mints after a CORRECT password. */
  const mfaToken = (userId = users[0].id, rememberMe = false) =>
    issueMfaChallengeToken(jwt, userId, rememberMe);
  return {
    ...db,
    jwt,
    email,
    sentCodes,
    auth,
    controller,
    req,
    freshIp,
    mfaToken,
    users,
  };
}

async function refusal(
  p: Promise<unknown>,
): Promise<{ status: number; code: unknown; body: any }> {
  try {
    await p;
  } catch (err) {
    if (err instanceof HttpException) {
      const body = err.getResponse() as any;
      return { status: err.getStatus(), code: body?.code, body };
    }
    throw err;
  }
  throw new Error('expected the call to be refused');
}

const actions = (audits: Array<{ action: string }>) =>
  audits.map((a) => a.action);

let prevEnv: Record<string, string | undefined>;
beforeEach(() => {
  prevEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };
  process.env.JWT_SECRET = SECRET;
  __resetPasskeyEnrollmentGrantsForTests();
});
afterEach(() => {
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ───────────────────────────────────────────────────────────────────────
describe('send — issue a code, only after the password step', () => {
  it('mints a code, mails it, stores only hashes, audits it, and hands back an opaque handle', async () => {
    const t = build();
    const out = await t.controller.send(
      { mfaToken: t.mfaToken() },
      t.req() as any,
    );

    expect(out.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expiresIn = Date.parse(out.expiresAt) - Date.now();
    expect(expiresIn).toBeGreaterThan(MFA_EMAIL_CODE_TTL_MS - 5_000);
    expect(expiresIn).toBeLessThanOrEqual(MFA_EMAIL_CODE_TTL_MS);

    expect(t.sentCodes).toHaveLength(1);
    expect(t.sentCodes[0].to).toBe('owner@venueos.example');
    expect(t.sentCodes[0].code).toMatch(/^\d{6}$/);

    // Nothing usable at rest: neither the handle nor the code.
    expect(t.rows).toHaveLength(1);
    const row = t.rows[0];
    expect(row.challengeHash).not.toContain(out.challenge);
    expect(row.challengeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeHash).not.toContain(t.sentCodes[0].code);
    expect(row.ipHash).toMatch(/^[0-9a-f]{64}$/);

    expect(actions(t.audits)).toEqual(['MFA_EMAIL_CODE_SENT']);
    const details = JSON.stringify(t.audits[0].details);
    expect(details).not.toContain(t.sentCodes[0].code);
    expect(details).not.toContain(out.challenge);
    expect(t.audits[0].details).toMatchObject({
      codeId: row.id,
      delivery: 'SENT',
      ip: '203.0.113.7',
    });
  });

  it('CANNOT be used without the password step: no token, a garbage token, an expired one, or a normal session token', async () => {
    const t = build();
    expect(
      (
        await refusal(
          t.controller.send({ mfaToken: 'not-a-jwt-at-all' }, t.req() as any),
        )
      ).code,
    ).toBe('MFA_TOKEN_INVALID');

    // A real, valid ACCESS token — but no `purpose: mfa_challenge`.
    const session = t.jwt.sign({
      sub: 'owner-1',
      email: 'owner@venueos.example',
    });
    expect(
      (await refusal(t.controller.send({ mfaToken: session }, t.req() as any)))
        .code,
    ).toBe('MFA_TOKEN_INVALID');

    // The right purpose, signed with ANOTHER key.
    const forged = new JwtService({ secret: 'someone-elses-key' }).sign({
      sub: 'owner-1',
      purpose: 'mfa_challenge',
    });
    expect(
      (await refusal(t.controller.send({ mfaToken: forged }, t.req() as any)))
        .code,
    ).toBe('MFA_TOKEN_INVALID');

    // The right purpose, the right key, but expired.
    const stale = t.jwt.sign(
      { sub: 'owner-1', purpose: 'mfa_challenge' },
      { expiresIn: -10 },
    );
    expect(
      (await refusal(t.controller.send({ mfaToken: stale }, t.req() as any)))
        .code,
    ).toBe('MFA_TOKEN_INVALID');

    expect(t.sentCodes).toHaveLength(0);
    expect(t.rows).toHaveLength(0);
  });

  it('a verify with a handle that /send never issued is refused — a code alone gets nobody in', async () => {
    const t = build();
    await t.controller.send({ mfaToken: t.mfaToken() }, t.req() as any);
    const made_up = 'A'.repeat(43);
    const r = await refusal(
      t.controller.verify(
        { challenge: made_up, code: t.sentCodes[0].code },
        t.req() as any,
      ),
    );
    expect(r.status).toBe(401);
    expect(r.code).toBe('MFA_EMAIL_CODE_EXPIRED');
    expect(t.auth.login).not.toHaveBeenCalled();
  });

  it('is NOT offered without outbound email in production — the page is told to use the device with the passkey', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.RESEND_API_KEY;
    const t = build();
    const r = await refusal(
      t.controller.send({ mfaToken: t.mfaToken() }, t.req() as any),
    );
    expect(r.status).toBe(409);
    expect(r.code).toBe('MFA_EMAIL_CODE_UNAVAILABLE');
    expect(t.sentCodes).toHaveLength(0);
    expect(t.audits[0]).toMatchObject({
      action: 'MFA_EMAIL_CODE_REFUSED',
      details: { reason: 'email-not-configured' },
    });

    // …and with the key set, production sends.
    process.env.RESEND_API_KEY = 're_test_key_not_real';
    await t.controller.send({ mfaToken: t.mfaToken() }, t.req() as any);
    expect(t.sentCodes).toHaveLength(1);
  });

  it('is NEVER a way around enrolling: an account that holds no second factor is refused', async () => {
    const t = build({
      users: [makeUser({ passkeys: 0, mfaTotpVerifiedAt: null })],
    });
    const r = await refusal(
      t.controller.send({ mfaToken: t.mfaToken() }, t.req() as any),
    );
    expect(r.code).toBe('MFA_EMAIL_CODE_UNAVAILABLE');
    expect(t.audits[0].details).toMatchObject({ reason: 'no-factor' });
    expect(t.sentCodes).toHaveLength(0);
  });

  it('an authenticator-app-only account may use it too (any second factor elsewhere)', async () => {
    const t = build({
      users: [
        makeUser({ passkeys: 0, mfaTotpVerifiedAt: new Date('2026-09-01') }),
      ],
    });
    await t.controller.send({ mfaToken: t.mfaToken() }, t.req() as any);
    expect(t.sentCodes).toHaveLength(1);
  });

  it('is refused for 7 days after a completed password RESET — "read the mailbox" must not be the whole account', async () => {
    const t = build();
    t.resets.push({ userId: 'owner-1', usedAt: new Date(Date.now() - 60_000) });
    const r = await refusal(
      t.controller.send({ mfaToken: t.mfaToken() }, t.req() as any),
    );
    expect(r.status).toBe(409);
    expect(r.code).toBe('MFA_EMAIL_CODE_AFTER_RESET');
    expect(t.sentCodes).toHaveLength(0);

    // A reset older than the cooldown no longer blocks it.
    t.resets[0].usedAt = new Date(
      Date.now() - MFA_EMAIL_CODE_RESET_COOLDOWN_MS - 60_000,
    );
    await t.controller.send({ mfaToken: t.mfaToken() }, t.req() as any);
    expect(t.sentCodes).toHaveLength(1);
  });

  it('a disabled account (or archived tenant) between the password and now gets the same answer as an expired token', async () => {
    for (const over of [
      { status: 'DISABLED' },
      { tenant: { archivedAt: new Date() } },
      { deletedAt: new Date() },
    ]) {
      const t = build({ users: [makeUser(over as Partial<FakeUser>)] });
      expect(
        (
          await refusal(
            t.controller.send({ mfaToken: t.mfaToken() }, t.req() as any),
          )
        ).code,
      ).toBe('MFA_TOKEN_INVALID');
      expect(t.sentCodes).toHaveLength(0);
    }
  });

  it('PER-ACCOUNT limit: a 4th code within 15 minutes is refused (429), from any network', async () => {
    const t = build();
    for (let i = 0; i < 3; i++) {
      await t.controller.send(
        { mfaToken: t.mfaToken() },
        t.req({ ip: t.freshIp() }) as any,
      );
    }
    const r = await refusal(
      t.controller.send(
        { mfaToken: t.mfaToken() },
        t.req({ ip: t.freshIp() }) as any,
      ),
    );
    expect(r.status).toBe(429);
    expect(r.code).toBe('MFA_EMAIL_CODE_TOO_MANY');
    expect(r.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(t.sentCodes).toHaveLength(3);
    expect(t.audits[t.audits.length - 1]).toMatchObject({
      action: 'MFA_EMAIL_CODE_RATE_LIMITED',
      details: { scope: 'account' },
    });

    // Once the window has passed, it sends again.
    for (const row of t.rows)
      row.createdAt = new Date(Date.now() - 16 * 60_000);
    await t.controller.send(
      { mfaToken: t.mfaToken() },
      t.req({ ip: t.freshIp() }) as any,
    );
    expect(t.sentCodes).toHaveLength(4);
  });

  it('PER-IP limit: the 11th code from one address within an hour is refused, across accounts', async () => {
    const users = Array.from({ length: 11 }, (_, i) =>
      makeUser({ id: `user-${i}`, email: `user${i}@venueos.example` }),
    );
    const t = build({ users });
    for (let i = 0; i < 10; i++) {
      await t.controller.send(
        { mfaToken: t.mfaToken(`user-${i}`) },
        t.req({ ip: '192.0.2.50' }) as any,
      );
    }
    const r = await refusal(
      t.controller.send(
        { mfaToken: t.mfaToken('user-10') },
        t.req({ ip: '192.0.2.50' }) as any,
      ),
    );
    expect(r.status).toBe(429);
    expect(t.audits[t.audits.length - 1]).toMatchObject({
      action: 'MFA_EMAIL_CODE_RATE_LIMITED',
      details: { scope: 'ip' },
    });
    // A different network is unaffected.
    await t.controller.send(
      { mfaToken: t.mfaToken('user-10') },
      t.req({ ip: '192.0.2.51' }) as any,
    );
    expect(t.sentCodes).toHaveLength(11);
  });

  it('a mail-provider failure says so (503), and the unsent code can never be used', async () => {
    const t = build({ delivery: 'FAILED' });
    const r = await refusal(
      t.controller.send({ mfaToken: t.mfaToken() }, t.req() as any),
    );
    expect(r.status).toBe(503);
    expect(r.code).toBe('MFA_EMAIL_CODE_SEND_FAILED');
    expect(t.rows[0].expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(t.audits[t.audits.length - 1]).toMatchObject({
      action: 'MFA_EMAIL_CODE_SEND_FAILED',
    });
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('verify — trade the code for the session', () => {
  it('the right code signs in: one login() with mfaAlreadySatisfied, the "new sign-in" mail, an audit row, and the add-a-passkey grant', async () => {
    const t = build({ users: [makeUser({ mustSetupCredentials: false })] });
    const { challenge } = await t.controller.send(
      { mfaToken: t.mfaToken('owner-1', true) },
      t.req() as any,
    );
    const code = t.sentCodes[0].code;

    const session: any = await t.controller.verify(
      { challenge, code },
      t.req() as any,
    );
    expect(session.access_token).toBe('final-jwt');

    expect(t.auth.login).toHaveBeenCalledTimes(1);
    const [user, rememberMe, opts] = t.auth.login.mock.calls[0] as unknown as [
      any,
      boolean,
      any,
    ];
    expect(opts).toEqual({ mfaAlreadySatisfied: true });
    // "Keep me signed in" from the password step survives the email detour.
    expect(rememberMe).toBe(true);
    // Forwarded, or the first-login setup gate would be bypassed (Sept. 2026).
    expect(user).toHaveProperty('mustSetupCredentials', false);

    expect(t.email.sendNewSignInNotice).toHaveBeenCalledWith({
      to: 'owner@venueos.example',
      device: 'an iPhone',
    });
    expect(actions(t.audits)).toEqual([
      'MFA_EMAIL_CODE_SENT',
      'MFA_EMAIL_CODE_SUCCESS',
    ]);
    expect(t.audits[1].details).toMatchObject({
      device: 'an iPhone',
      attempt: 1,
    });
    expect(JSON.stringify(t.audits[1].details)).not.toContain(code);

    // This device did not use a passkey → offer one for it (mint site 3).
    expect(session.passkeyEnrollment?.grant).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('forgives "123 456" and "123-456" the way people and mail clients write codes', async () => {
    for (const spaced of [
      (c: string) => `${c.slice(0, 3)} ${c.slice(3)}`,
      (c: string) => `${c.slice(0, 3)}-${c.slice(3)}`,
    ]) {
      const t = build();
      const { challenge } = await t.controller.send(
        { mfaToken: t.mfaToken() },
        t.req() as any,
      );
      const session: any = await t.controller.verify(
        { challenge, code: spaced(t.sentCodes[0].code) },
        t.req() as any,
      );
      expect(session.access_token).toBe('final-jwt');
    }
  });

  it('a non-code ("abc") is a 400 that burns no attempt', async () => {
    const t = build();
    const { challenge } = await t.controller.send(
      { mfaToken: t.mfaToken() },
      t.req() as any,
    );
    const r = await refusal(
      t.controller.verify({ challenge, code: 'abc' }, t.req() as any),
    );
    expect(r.status).toBe(400);
    expect(t.rows[0].attempts).toBe(0);
  });

  it('SINGLE USE — the same code and handle cannot sign in twice', async () => {
    const t = build();
    const { challenge } = await t.controller.send(
      { mfaToken: t.mfaToken() },
      t.req() as any,
    );
    const code = t.sentCodes[0].code;
    await t.controller.verify({ challenge, code }, t.req() as any);
    const r = await refusal(
      t.controller.verify({ challenge, code }, t.req() as any),
    );
    expect(r.code).toBe('MFA_EMAIL_CODE_EXPIRED');
    expect(t.auth.login).toHaveBeenCalledTimes(1);
  });

  it('EXPIRY — after 10 minutes the right code is refused', async () => {
    const t = build();
    const { challenge } = await t.controller.send(
      { mfaToken: t.mfaToken() },
      t.req() as any,
    );
    t.rows[0].expiresAt = new Date(Date.now() - 1);
    const r = await refusal(
      t.controller.verify(
        { challenge, code: t.sentCodes[0].code },
        t.req() as any,
      ),
    );
    expect(r.status).toBe(401);
    expect(r.code).toBe('MFA_EMAIL_CODE_EXPIRED');
    expect(t.auth.login).not.toHaveBeenCalled();
  });

  it('a NEW code retires the older one — only the newest is live', async () => {
    const t = build();
    const first = await t.controller.send(
      { mfaToken: t.mfaToken() },
      t.req() as any,
    );
    const second = await t.controller.send(
      { mfaToken: t.mfaToken() },
      t.req() as any,
    );
    const r = await refusal(
      t.controller.verify(
        { challenge: first.challenge, code: t.sentCodes[0].code },
        t.req() as any,
      ),
    );
    expect(r.code).toBe('MFA_EMAIL_CODE_EXPIRED');
    const session: any = await t.controller.verify(
      { challenge: second.challenge, code: t.sentCodes[1].code },
      t.req() as any,
    );
    expect(session.access_token).toBe('final-jwt');
  });

  it('AT MOST 5 ATTEMPTS — each miss says how many are left, the 5th kills the code, and even the right code is then refused', async () => {
    const t = build();
    const { challenge } = await t.controller.send(
      { mfaToken: t.mfaToken() },
      t.req() as any,
    );
    const right = t.sentCodes[0].code;
    const wrong = right === '000000' ? '111111' : '000000';

    for (let i = 1; i <= MFA_EMAIL_CODE_MAX_ATTEMPTS; i++) {
      // The shared per-user MFA limiter (5 misses / minute) would lock first;
      // reset it so this test measures the PER-CODE cap on its own.
      (t.controller as any).rateLimiter = new MfaRateLimiter();
      const r = await refusal(
        t.controller.verify({ challenge, code: wrong }, t.req() as any),
      );
      expect(r.status).toBe(401);
      if (i < MFA_EMAIL_CODE_MAX_ATTEMPTS) {
        expect(r.code).toBe('MFA_EMAIL_CODE_INVALID');
        expect(r.body.attemptsLeft).toBe(MFA_EMAIL_CODE_MAX_ATTEMPTS - i);
      } else {
        expect(r.code).toBe('MFA_EMAIL_CODE_LOCKED');
      }
    }
    (t.controller as any).rateLimiter = new MfaRateLimiter();
    const after = await refusal(
      t.controller.verify({ challenge, code: right }, t.req() as any),
    );
    expect(after.code).toBe('MFA_EMAIL_CODE_LOCKED');
    expect(t.rows[0].attempts).toBe(MFA_EMAIL_CODE_MAX_ATTEMPTS);
    expect(t.auth.login).not.toHaveBeenCalled();
    // Every failure is in the trail, with its attempt number.
    const failures = t.audits.filter(
      (a) => a.action === 'MFA_EMAIL_CODE_FAILED',
    );
    expect(failures.map((f) => f.details.attempt)).toEqual([1, 2, 3, 4, 5]);
  });

  it('concurrent guesses cannot add up to more than 5 attempts between them', async () => {
    const t = build();
    const { challenge } = await t.controller.send(
      { mfaToken: t.mfaToken() },
      t.req() as any,
    );
    const wrong = t.sentCodes[0].code === '000000' ? '111111' : '000000';
    // A fresh limiter per call so only the per-code cap is in play.
    const calls = Array.from({ length: 12 }, () => {
      (t.controller as any).rateLimiter = new MfaRateLimiter();
      return t.controller
        .verify({ challenge, code: wrong }, t.req() as any)
        .catch((e) => e);
    });
    await Promise.all(calls);
    expect(t.rows[0].attempts).toBe(MFA_EMAIL_CODE_MAX_ATTEMPTS);
  });

  it('shares the per-user MFA budget with the authenticator code and passkey — 5 misses in a minute lock the account for a while', async () => {
    const t = build();
    // Two codes, so the per-code cap is not what stops it.
    const a = await t.controller.send(
      { mfaToken: t.mfaToken() },
      t.req() as any,
    );
    const wrongA = t.sentCodes[0].code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      await refusal(
        t.controller.verify(
          { challenge: a.challenge, code: wrongA },
          t.req() as any,
        ),
      );
    }
    const b = await t.controller.send(
      { mfaToken: t.mfaToken() },
      t.req() as any,
    );
    const wrongB = t.sentCodes[1].code === '000000' ? '111111' : '000000';
    await refusal(
      t.controller.verify(
        { challenge: b.challenge, code: wrongB },
        t.req() as any,
      ),
    );
    const locked = await refusal(
      t.controller.verify(
        { challenge: b.challenge, code: t.sentCodes[1].code },
        t.req() as any,
      ),
    );
    expect(locked.status).toBe(429);
    expect(locked.code).toBe('MFA_LOCKED_OUT');
  });

  it('an account disabled after the code was sent cannot finish with it', async () => {
    const t = build();
    const { challenge } = await t.controller.send(
      { mfaToken: t.mfaToken() },
      t.req() as any,
    );
    t.users[0].status = 'DISABLED';
    const r = await refusal(
      t.controller.verify(
        { challenge, code: t.sentCodes[0].code },
        t.req() as any,
      ),
    );
    expect(r.code).toBe('MFA_EMAIL_CODE_EXPIRED');
    expect(t.auth.login).not.toHaveBeenCalled();
    expect(t.email.sendNewSignInNotice).not.toHaveBeenCalled();
  });

  it('a slow or failing "new sign-in" mail never holds the sign-in up', async () => {
    const t = build();
    t.email.sendNewSignInNotice.mockImplementation(() =>
      Promise.reject(new Error('provider down')),
    );
    const { challenge } = await t.controller.send(
      { mfaToken: t.mfaToken() },
      t.req() as any,
    );
    const session: any = await t.controller.verify(
      { challenge, code: t.sentCodes[0].code },
      t.req() as any,
    );
    expect(session.access_token).toBe('final-jwt');
  });

  it('an account at the passkey cap signs in but is offered nothing', async () => {
    const t = build({ users: [makeUser({ passkeys: 10 })] });
    const { challenge } = await t.controller.send(
      { mfaToken: t.mfaToken() },
      t.req() as any,
    );
    const session: any = await t.controller.verify(
      { challenge, code: t.sentCodes[0].code },
      t.req() as any,
    );
    expect(session.access_token).toBe('final-jwt');
    expect(session.passkeyEnrollment).toBeUndefined();
  });
});
