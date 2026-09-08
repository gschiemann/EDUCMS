/**
 * SEC-010 follow-on (2026-09-05) — the USER-token algorithm allowlist.
 *
 * HONEST SCOPE, stated up front: none of these cases were exploitable before
 * the change. `jsonwebtoken` 9.x refuses `alg: none` whenever a secret is
 * supplied, and refuses to check an `RS*`/`ES*` signature against a string
 * secret, so the classic algorithm-confusion attacks were already dead.
 *
 * What changed is WHY they are refused: the three user-token verifies
 * (`JwtAuthGuard`, and the two MFA challenge-token verifies) used to depend
 * on that library default and now state `algorithms: ['HS256']` themselves —
 * the same pin `screens/device-auth.ts` has carried since DT-12, and the one
 * SEC-001 added to the realtime admission leg. These tests pin the OUTCOME so
 * a `jsonwebtoken` major bump that relaxes the default, or a refactor that
 * swaps the string secret for a `KeyObject` (which is where the implicit
 * protection actually lives), cannot silently reopen it.
 */
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { USER_JWT_ALGORITHMS } from './jwt-algorithms';

const TEST_SECRET = 'dev_only_jwt_secret_CHANGE_ME';

function ctxFor(token: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: `Bearer ${token}` }, user: undefined as any }),
    }),
  } as any;
}

function makeRedis() {
  return {
    sismember: jest.fn(async () => false),
    getTokenInvalidBefore: jest.fn(async () => null),
  };
}

function b64u(o: unknown) {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}

describe('USER_JWT_ALGORITHMS', () => {
  it('is HS256 and nothing else', () => {
    // A one-line canary: widening this list is a security decision, not a
    // refactor, and it should have to fail a test to happen.
    expect(USER_JWT_ALGORITHMS).toEqual(['HS256']);
  });
});

describe('JwtAuthGuard — the algorithm is pinned, not inferred from the token', () => {
  const jwt = new JwtService({ secret: TEST_SECRET });
  const prevSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = TEST_SECRET;
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
  });

  it('accepts a normal HS256 session token (the pin does not break the happy path)', async () => {
    const token = jwt.sign({ sub: 'user-1', role: 'SCHOOL_ADMIN', tenantId: 't1' });
    const guard = new JwtAuthGuard(jwt, makeRedis() as any);
    await expect(guard.canActivate(ctxFor(token))).resolves.toBe(true);
  });

  it('refuses an `alg: none` token carrying a full, otherwise-valid session claim set', async () => {
    // The payload is exactly what a signed token would carry — only the
    // signature is missing. If the allowlist were absent AND the library
    // default ever relaxed, this is the token that would walk in as an admin.
    const unsigned = `${b64u({ alg: 'none', typ: 'JWT' })}.${b64u({
      sub: 'user-1',
      role: 'SUPER_ADMIN',
      tenantId: 't1',
      canTriggerPanic: true,
      iat: Math.floor(Date.now() / 1000),
    })}.`;
    const guard = new JwtAuthGuard(jwt, makeRedis() as any);
    await expect(guard.canActivate(ctxFor(unsigned))).rejects.toThrow();
  });

  it('refuses an HS512-signed token even though the secret is right', async () => {
    // The attacker-controlled `alg` header naming an algorithm we never issue
    // is the shape the allowlist exists for. `jsonwebtoken` would otherwise
    // happily verify this — same key, different HMAC — which is a real
    // downgrade/upgrade surface, not a theoretical one.
    const other = new JwtService({ secret: TEST_SECRET, signOptions: { algorithm: 'HS512' } });
    const token = other.sign({ sub: 'user-1', role: 'SUPER_ADMIN', tenantId: 't1' });
    const guard = new JwtAuthGuard(jwt, makeRedis() as any);
    await expect(guard.canActivate(ctxFor(token))).rejects.toThrow();
  });

  it('the DEVICE branch of the same guard is pinned too', async () => {
    // The guard picks DEVICE_JWT_SECRET for a `kind: 'device'` token. That
    // leg is also HS256, so one allowlist covers both — this pins that the
    // pin did not accidentally exclude device tokens.
    const prevDev = process.env.DEVICE_JWT_SECRET;
    process.env.DEVICE_JWT_SECRET = 'device-secret-for-this-test-only';
    try {
      const deviceJwt = new JwtService({ secret: process.env.DEVICE_JWT_SECRET });
      const token = deviceJwt.sign({ sub: 'screen-1', kind: 'device', ep: 1 });
      const guard = new JwtAuthGuard(jwt, makeRedis() as any);
      // Not asserting it ACTIVATES (the device path has its own downstream
      // checks) — only that verification itself did not throw a signature /
      // algorithm error. `rejects.toThrow('invalid')` would be the failure.
      await expect(guard.canActivate(ctxFor(token))).resolves.toBe(true);
    } finally {
      if (prevDev === undefined) delete process.env.DEVICE_JWT_SECRET;
      else process.env.DEVICE_JWT_SECRET = prevDev;
    }
  });
});

describe('the MFA challenge-token verifies use the same pin', () => {
  /**
   * `MfaController` is heavy to stand up (Prisma, TOTP, rate limiter,
   * AuthService), and both of its verifies read the same option object, so
   * the property under test is a WIRING one: does the controller hand
   * `algorithms` to `verifyAsync`? That is asserted directly against the
   * source rather than through a mock that would pass either way.
   *
   * The behavioural half — that a real `verifyAsync` with this option refuses
   * a wrong-algorithm token — is proven by the guard cases above, which run
   * the real library through the real code path.
   */
  it('both call sites pass an algorithms allowlist', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, 'mfa.controller.ts'), 'utf8');
    const verifies = src.match(/verifyAsync\([\s\S]*?\n\s*\}\);/g) ?? [];
    expect(verifies.length).toBe(2);
    for (const call of verifies) {
      expect(call).toContain('algorithms: USER_JWT_ALGORITHMS');
    }
  });

  it('no user-token verify in the auth module is left un-pinned', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path') as typeof import('path');
    const offenders: string[] = [];
    for (const file of fs.readdirSync(__dirname)) {
      if (!file.endsWith('.ts') || file.endsWith('.spec.ts')) continue;
      const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
      for (const call of src.match(/verifyAsync\([\s\S]*?\n\s*\}\);/g) ?? []) {
        if (!call.includes('algorithms')) offenders.push(`${file}: ${call.slice(0, 60)}…`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
