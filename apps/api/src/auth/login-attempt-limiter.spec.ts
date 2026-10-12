/**
 * V-5 (launch security re-audit, 2026-10-11) — per-account password
 * sign-in throttle. Distributed guessing from many IPs against ONE address
 * is backed off and then soft-locked; a correct password during the lock is
 * refused; known and unknown addresses get the same answer; Redis down falls
 * back to the per-IP limit (allows).
 */
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import {
  AUTH_TEMP_LOCKED,
  LOGIN_LOCK_AFTER,
  LoginAttemptLimiter,
  backoffMsFor,
  type LimiterRedis,
} from './login-attempt-limiter';

/** A fake Redis with a controllable clock and real PX expiry semantics. */
function fakeRedis(clock: { now: number }) {
  const store = new Map<string, { v: string; exp: number | null }>();
  const live = (k: string) => {
    const e = store.get(k);
    if (!e) return null;
    if (e.exp !== null && e.exp <= clock.now) {
      store.delete(k);
      return null;
    }
    return e;
  };
  const r: LimiterRedis = {
    async incr(k) {
      const e = live(k);
      const n = (e ? Number(e.v) : 0) + 1;
      store.set(k, { v: String(n), exp: e?.exp ?? null });
      return n;
    },
    async pexpire(k, ms) {
      const e = live(k);
      if (!e) return 0;
      e.exp = clock.now + ms;
      return 1;
    },
    async set(k, v, _mode, ms) {
      store.set(k, { v, exp: clock.now + ms });
      return 'OK';
    },
    async pttl(k) {
      const e = live(k);
      if (!e) return -2;
      return e.exp === null ? -1 : e.exp - clock.now;
    },
    async del(...keys) {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    },
  };
  return r;
}

function controllerWith(redis: LimiterRedis | null, validUserFor: (email: string, pw: string) => any) {
  const authService = {
    validateUser: jest.fn(async (e: string, p: string) => validUserFor(e, p)),
    tenantIdForEmail: jest.fn().mockResolvedValue(null),
    login: jest.fn().mockResolvedValue({ access_token: 't', user: {} }),
    mfaPolicyForUser: jest.fn().mockResolvedValue({ required: false, reasons: [], enrolled: false, blocking: false, enforceAfter: null, tenantEnforced: false, inGrace: false }),
  };
  const prisma = { client: { auditLog: { create: jest.fn().mockResolvedValue({}) }, tenant: { upsert: jest.fn().mockResolvedValue({}) } } };
  const controller = new AuthController(authService as any, { publisher: redis } as any, prisma as any);
  return { controller, authService, prisma };
}

const req = (ip: string): any => ({ ip, headers: { 'x-forwarded-for': ip, 'user-agent': 'jest' } });

async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof UnauthorizedException) return '401';
    if (e instanceof HttpException && e.getStatus() === 429) return `429:${(e.getResponse() as any).code}`;
    throw e;
  }
}

describe('V-5 per-account login throttle', () => {
  it('backoff grows exponentially from the 5th failure and caps at 60 s', () => {
    expect(backoffMsFor(4)).toBe(0);
    expect(backoffMsFor(5)).toBe(1000);
    expect(backoffMsFor(8)).toBe(8000);
    expect(backoffMsFor(19)).toBe(60_000);
  });

  it('twenty failures from twenty different IPs lock the account; a correct password during the lock is refused', async () => {
    const clock = { now: 1_000_000 };
    const realNow = Date.now;
    Date.now = () => clock.now;
    try {
      const redis = fakeRedis(clock);
      const { controller, prisma } = controllerWith(redis, (_e, pw) => (pw === 'right' ? { id: 'u1', email: 'admin@acme.edu', tenantId: 't1' } : null));
      const results: string[] = [];
      for (let i = 0; i < LOGIN_LOCK_AFTER; i++) {
        results.push(await outcome(controller.login({ email: 'Admin@Acme.edu', password: `guess-${i}` } as any, req(`198.51.100.${i}`))));
        clock.now += backoffMsFor(i + 1) + 1; // wait out exactly each backoff: only the LOCK may refuse
      }
      expect(results.every((r) => r === '401')).toBe(true);
      // Locked now — even the right password.
      expect(await outcome(controller.login({ email: 'admin@acme.edu', password: 'right' } as any, req('203.0.113.50')))).toBe(`429:${AUTH_TEMP_LOCKED}`);
      expect(prisma.client.auditLog.create.mock.calls.some((c: any[]) => c[0].data.action === 'AUTH_LOGIN_LOCKED')).toBe(true);
      // After the lock lapses, the right password works.
      clock.now += 15 * 60_000 + 1;
      expect(await outcome(controller.login({ email: 'admin@acme.edu', password: 'right' } as any, req('203.0.113.50')))).toBe('ok');
    } finally {
      Date.now = realNow;
    }
  });

  it('rapid guesses past the 5th are refused with 429 before the password is checked', async () => {
    const clock = { now: 5_000_000 };
    const redis = fakeRedis(clock);
    const { controller, authService } = controllerWith(redis, () => null);
    for (let i = 0; i < 5; i++) {
      expect(await outcome(controller.login({ email: 'x@acme.edu', password: 'no' } as any, req(`10.0.0.${i}`)))).toBe('401');
    }
    const checksBefore = authService.validateUser.mock.calls.length;
    expect(await outcome(controller.login({ email: 'x@acme.edu', password: 'no' } as any, req('10.0.0.99')))).toBe(`429:${AUTH_TEMP_LOCKED}`);
    expect(authService.validateUser.mock.calls.length).toBe(checksBefore);
  });

  it('known and unknown addresses get identical answers (not an existence oracle)', async () => {
    const run = async (email: string) => {
      const clock = { now: 9_000_000 };
      const { controller } = controllerWith(fakeRedis(clock), () => null);
      const seq: string[] = [];
      for (let i = 0; i < 7; i++) seq.push(await outcome(controller.login({ email, password: 'no' } as any, req(`10.1.0.${i}`))));
      return seq;
    };
    expect(await run('real.admin@acme.edu')).toEqual(await run('nobody-000@acme.edu'));
  });

  it('Redis unavailable: fails open to the per-IP limit (no 429 from this layer)', async () => {
    const broken: LimiterRedis = {
      incr: async () => { throw new Error('down'); },
      pexpire: async () => { throw new Error('down'); },
      set: async () => { throw new Error('down'); },
      pttl: async () => { throw new Error('down'); },
      del: async () => { throw new Error('down'); },
    };
    const limiter = new LoginAttemptLimiter(() => broken);
    await expect(limiter.check('a@b.c')).resolves.toBeUndefined();
    await expect(limiter.recordFailure('a@b.c')).resolves.toBeNull();
    const { controller } = controllerWith(null, (_e, pw) => (pw === 'right' ? { id: 'u1', email: 'a@b.c', tenantId: 't1' } : null));
    for (let i = 0; i < 25; i++) await outcome(controller.login({ email: 'a@b.c', password: 'no' } as any, req('10.2.0.1')));
    expect(await outcome(controller.login({ email: 'a@b.c', password: 'right' } as any, req('10.2.0.1')))).toBe('ok');
  });
});
