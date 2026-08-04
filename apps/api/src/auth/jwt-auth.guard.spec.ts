/**
 * JwtAuthGuard — token revocation (P1-1 + P1-4, 2026-05-28).
 *
 * P1-4: the `jwt_revoked_list` revocation check used to be wrapped in
 * `if (process.env.NODE_ENV === 'production')`, so logout + every
 * revocation was a SILENT NO-OP in non-prod / misconfigured deploys
 * while SSE + the WS gateway checked unconditionally. These tests pin
 * that the check now runs regardless of NODE_ENV and still fails CLOSED
 * on a Redis error.
 *
 * P1-1: a demoted user (or one whose canTriggerPanic was just turned
 * off) used to keep the elevated claim in their live JWT for up to 30
 * days. The guard now rejects any user token whose `iat` predates the
 * per-user "invalid-before" epoch the writer stamps on a tightening.
 */
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { issueMfaChallengeToken } from './mfa-challenge-token';

const TEST_SECRET = 'dev_only_jwt_secret_CHANGE_ME';

function ctxFor(token: string | undefined) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: token ? { authorization: `Bearer ${token}` } : {},
        // mutated in place by the guard on success
        user: undefined as any,
      }),
    }),
  } as any;
}

/** Mock RedisService — records calls + lets each test script the answers. */
function makeRedis(opts: {
  revokedTokens?: Set<string>;
  invalidBefore?: number | null;
  sismemberThrows?: boolean;
  invalidBeforeThrows?: boolean;
} = {}) {
  return {
    sismember: jest.fn(async (_key: string, member: string) => {
      if (opts.sismemberThrows) throw new Error('redis down');
      return !!opts.revokedTokens?.has(member);
    }),
    getTokenInvalidBefore: jest.fn(async (_userId: string) => {
      if (opts.invalidBeforeThrows) throw new Error('redis down');
      return opts.invalidBefore ?? null;
    }),
  };
}

describe('JwtAuthGuard — revocation (P1-1 + P1-4)', () => {
  const jwt = new JwtService({ secret: TEST_SECRET });
  const prevSecret = process.env.JWT_SECRET;
  const prevNodeEnv = process.env.NODE_ENV;

  beforeAll(() => {
    // Make requireSecret('JWT_SECRET') resolve to our known signing key.
    process.env.JWT_SECRET = TEST_SECRET;
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  });

  function userToken(extra: Record<string, unknown> = {}) {
    // `iat` auto-added by jsonwebtoken (whole seconds).
    return jwt.sign({ sub: 'user-1', role: 'SCHOOL_ADMIN', tenantId: 't1', ...extra });
  }

  describe('P1-4 — revocation runs regardless of NODE_ENV', () => {
    for (const env of ['development', 'test', 'production', undefined] as const) {
      it(`rejects a token in the jwt_revoked_list when NODE_ENV=${env ?? '(unset)'}`, async () => {
        if (env === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = env;

        const token = userToken();
        const redis = makeRedis({ revokedTokens: new Set([token]) });
        const guard = new JwtAuthGuard(jwt, redis as any);

        await expect(guard.canActivate(ctxFor(token))).rejects.toThrow('Session revoked');
        // The check actually ran — proving it isn't gated behind prod.
        expect(redis.sismember).toHaveBeenCalledWith('jwt_revoked_list', token);
      });
    }

    it('allows a non-revoked token (and the per-user check passes) in dev', async () => {
      process.env.NODE_ENV = 'development';
      const token = userToken();
      const redis = makeRedis({ revokedTokens: new Set(), invalidBefore: null });
      const guard = new JwtAuthGuard(jwt, redis as any);

      await expect(guard.canActivate(ctxFor(token))).resolves.toBe(true);
      expect(redis.getTokenInvalidBefore).toHaveBeenCalledWith('user-1');
    });

    it('fails CLOSED when the Redis revocation check errors (any env)', async () => {
      process.env.NODE_ENV = 'development';
      const token = userToken();
      const redis = makeRedis({ sismemberThrows: true });
      const guard = new JwtAuthGuard(jwt, redis as any);

      await expect(guard.canActivate(ctxFor(token))).rejects.toThrow(
        'Auth check unavailable; please retry',
      );
    });
  });

  describe('P1-1 — per-user mass revocation by iat', () => {
    it('rejects a token issued BEFORE the per-user invalid-before epoch', async () => {
      process.env.NODE_ENV = 'production';
      const token = userToken();
      // Marker set to "now + 1 hour" → the token's iat is strictly before it.
      const future = Math.floor(Date.now() / 1000) + 3600;
      const redis = makeRedis({ invalidBefore: future });
      const guard = new JwtAuthGuard(jwt, redis as any);

      await expect(guard.canActivate(ctxFor(token))).rejects.toThrow('Session revoked');
    });

    it('allows a token issued AT/AFTER the per-user invalid-before epoch', async () => {
      process.env.NODE_ENV = 'production';
      const token = userToken();
      // Marker set well in the past → this token survives (issued after it).
      const past = Math.floor(Date.now() / 1000) - 3600;
      const redis = makeRedis({ invalidBefore: past });
      const guard = new JwtAuthGuard(jwt, redis as any);

      await expect(guard.canActivate(ctxFor(token))).resolves.toBe(true);
    });

    it('allows when no per-user marker exists (null)', async () => {
      process.env.NODE_ENV = 'production';
      const token = userToken();
      const redis = makeRedis({ invalidBefore: null });
      const guard = new JwtAuthGuard(jwt, redis as any);

      await expect(guard.canActivate(ctxFor(token))).resolves.toBe(true);
    });

    it('fails CLOSED if the per-user marker read errors', async () => {
      process.env.NODE_ENV = 'production';
      const token = userToken();
      const redis = makeRedis({ invalidBeforeThrows: true });
      const guard = new JwtAuthGuard(jwt, redis as any);

      await expect(guard.canActivate(ctxFor(token))).rejects.toThrow(
        'Auth check unavailable; please retry',
      );
    });

    it('does NOT apply the per-user check to device tokens', async () => {
      process.env.NODE_ENV = 'production';
      // Sign with DEVICE_JWT_SECRET so the guard verifies it as a device token.
      const prevDev = process.env.DEVICE_JWT_SECRET;
      process.env.DEVICE_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
      try {
        const deviceJwt = new JwtService({ secret: process.env.DEVICE_JWT_SECRET });
        const token = deviceJwt.sign({ sub: 'screen-1', kind: 'device', tenantId: 't1' });
        // Even with a future marker for "screen-1", a device token is exempt.
        const redis = makeRedis({ invalidBefore: Math.floor(Date.now() / 1000) + 3600 });
        const guard = new JwtAuthGuard(deviceJwt, redis as any);

        await expect(guard.canActivate(ctxFor(token))).resolves.toBe(true);
        expect(redis.getTokenInvalidBefore).not.toHaveBeenCalled();
      } finally {
        if (prevDev === undefined) delete process.env.DEVICE_JWT_SECRET;
        else process.env.DEVICE_JWT_SECRET = prevDev;
      }
    });
  });

  /**
   * AUTH-01 (2026-08-04) — a partial-flow token must never authenticate a session.
   *
   * The MFA challenge token is signed with the SAME secret as a real session
   * token and differs only by `purpose: 'mfa_challenge'`. This guard did not
   * look at that claim, so the token handed out after the PASSWORD step (before
   * TOTP) was accepted as a full session: `POST /auth/change-password` with it
   * returned a genuine access_token, and `POST /auth/mfa/disable` stripped the
   * second factor. Password alone defeated 2FA.
   */
  describe('AUTH-01 — partial-flow tokens are not sessions', () => {
    it('rejects a real issueMfaChallengeToken() token', async () => {
      process.env.NODE_ENV = 'production';
      // Minted exactly the way AuthService mints it after the password step.
      const token = issueMfaChallengeToken(jwt, 'user-1', false);
      const redis = makeRedis({ revokedTokens: new Set(), invalidBefore: null });
      const guard = new JwtAuthGuard(jwt, redis as any);

      await expect(guard.canActivate(ctxFor(token))).rejects.toThrow(
        'Invalid or expired authentication token',
      );
    });

    it('rejects ANY token carrying a purpose claim, not just mfa_challenge', async () => {
      process.env.NODE_ENV = 'production';
      // Guards the claim, not a hardcoded value — a future partial token that
      // follows the same convention is refused without touching this guard.
      const token = userToken({ purpose: 'password-reset' });
      const redis = makeRedis({ revokedTokens: new Set(), invalidBefore: null });
      const guard = new JwtAuthGuard(jwt, redis as any);

      await expect(guard.canActivate(ctxFor(token))).rejects.toThrow(
        'Invalid or expired authentication token',
      );
    });

    it('still allows a normal session token (no purpose claim)', async () => {
      process.env.NODE_ENV = 'production';
      const token = userToken();
      const redis = makeRedis({ revokedTokens: new Set(), invalidBefore: null });
      const guard = new JwtAuthGuard(jwt, redis as any);

      await expect(guard.canActivate(ctxFor(token))).resolves.toBe(true);
    });
  });
});
