/**
 * SEC-012 (2026-09-04) — revocation fails CLOSED when its state cannot be
 * established, with exactly ONE named, bounded, instrumented exception.
 *
 * BOTH DIRECTIONS are pinned here, because a fail-closed change is only half
 * proved by the deny cases:
 *
 *   DENY  — user session (GET and POST), API-key-shaped principal, device
 *           MUTATION, and device READ once the grace window has lapsed.
 *   ALLOW — device GET/HEAD inside the grace window (the manifest backstop,
 *           CLAUDE.md emergency safeguard #4), and nothing else.
 *
 * The end-to-end lane drives the real `JwtAuthGuard` against a real
 * `RedisService` whose Redis is absent and whose Postgres throws — the exact
 * both-stores-down state the audit reproduced.
 */
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import {
  RevocationPosture,
  REVOCATION_CONTINUITY_GRACE_MS,
  classifyRevocationPurpose,
  isRevocationIndeterminateError,
  RevocationIndeterminateError,
  revocationPosture,
} from './revocation-posture';
import { RedisService } from '../realtime/redis.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const USER_SECRET = 'dev_only_jwt_secret_CHANGE_ME';
const DEVICE_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';

const prevRedisUrl = process.env.REDIS_URL;
const prevRedisDisabled = process.env.REDIS_DISABLED;
beforeAll(() => {
  delete process.env.REDIS_URL;
  delete process.env.REDIS_DISABLED;
});
afterAll(() => {
  if (prevRedisUrl !== undefined) process.env.REDIS_URL = prevRedisUrl;
  if (prevRedisDisabled !== undefined) process.env.REDIS_DISABLED = prevRedisDisabled;
});

beforeEach(() => revocationPosture.reset());
afterEach(() => revocationPosture.reset());

// ─────────────────────────────────────────────────────────────────────────
describe('classifyRevocationPurpose — only a device safe-method read qualifies', () => {
  it('device + GET / HEAD → player-continuity-read', () => {
    expect(classifyRevocationPurpose({ principalKind: 'device', method: 'GET' })).toBe(
      'player-continuity-read',
    );
    expect(classifyRevocationPurpose({ principalKind: 'device', method: 'head' })).toBe(
      'player-continuity-read',
    );
  });

  it('device + any mutation → protected (SEC-001 parity: a device may never write)', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'PURGE']) {
      expect(classifyRevocationPurpose({ principalKind: 'device', method })).toBe('protected');
    }
  });

  it('user session and API key are protected even on a GET', () => {
    expect(classifyRevocationPurpose({ principalKind: 'user', method: 'GET' })).toBe('protected');
    expect(classifyRevocationPurpose({ principalKind: 'api-key', method: 'GET' })).toBe(
      'protected',
    );
    expect(classifyRevocationPurpose({ principalKind: null, method: 'GET' })).toBe('protected');
  });

  it('a missing method is protected — never assume a request is a read', () => {
    expect(classifyRevocationPurpose({ principalKind: 'device' })).toBe('protected');
    expect(classifyRevocationPurpose({ principalKind: 'device', method: null })).toBe('protected');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('RevocationPosture — the bounded window', () => {
  it('allows continuity reads inside the grace window and refuses everything else', () => {
    const posture = new RevocationPosture();
    const t0 = 1_000_000;

    expect(posture.decide('player-continuity-read', t0)).toMatchObject({
      allow: true,
      reason: 'continuity-read-within-grace',
    });
    expect(posture.decide('protected', t0 + 5)).toMatchObject({
      allow: false,
      reason: 'protected-request',
    });
  });

  it('expires the exception at the TTL — a long outage converges to fully closed', () => {
    const posture = new RevocationPosture();
    const t0 = 1_000_000;

    posture.decide('player-continuity-read', t0);
    expect(
      posture.decide('player-continuity-read', t0 + REVOCATION_CONTINUITY_GRACE_MS),
    ).toMatchObject({ allow: true });
    expect(
      posture.decide('player-continuity-read', t0 + REVOCATION_CONTINUITY_GRACE_MS + 1),
    ).toMatchObject({ allow: false, reason: 'continuity-grace-expired' });
  });

  it('a confirmed answer closes the window, so the NEXT outage gets a fresh grace', () => {
    const posture = new RevocationPosture();
    const t0 = 1_000_000;

    posture.decide('player-continuity-read', t0);
    expect(
      posture.decide('player-continuity-read', t0 + REVOCATION_CONTINUITY_GRACE_MS + 1),
    ).toMatchObject({ allow: false });

    posture.observeConfirmed(t0 + REVOCATION_CONTINUITY_GRACE_MS + 2);
    expect(posture.snapshot(t0).outageMs).toBeNull();

    // New outage, new window — the clock restarts from here, not from t0.
    const t1 = t0 + 10 * REVOCATION_CONTINUITY_GRACE_MS;
    expect(posture.decide('player-continuity-read', t1)).toMatchObject({ allow: true });
  });

  it('counts what it allowed and what it refused (the telemetry the audit asked for)', () => {
    const posture = new RevocationPosture();
    const t0 = 1_000_000;

    posture.decide('player-continuity-read', t0);
    posture.decide('player-continuity-read', t0 + 1);
    posture.decide('protected', t0 + 2);

    expect(posture.snapshot(t0 + 3)).toEqual({
      outageMs: 3,
      allowed: 2,
      denied: 1,
      graceExpired: false,
    });
  });

  it('opening a window logs the loud warn ONCE, not per request', () => {
    const posture = new RevocationPosture();
    const warn = jest
      .spyOn((posture as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
    const t0 = 1_000_000;

    posture.decide('protected', t0);
    posture.decide('protected', t0 + 1);
    posture.decide('protected', t0 + 2);

    const opened = warn.mock.calls.filter((c) =>
      String(c[0]).includes('REVOCATION BACKSTOP UNAVAILABLE'),
    );
    expect(opened).toHaveLength(1);
    warn.mockRestore();
  });

  it('logs a distinct line when the grace expires', () => {
    const posture = new RevocationPosture();
    const warn = jest
      .spyOn((posture as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
    const t0 = 1_000_000;

    posture.decide('player-continuity-read', t0);
    posture.decide('player-continuity-read', t0 + REVOCATION_CONTINUITY_GRACE_MS + 1);
    posture.decide('player-continuity-read', t0 + REVOCATION_CONTINUITY_GRACE_MS + 2);

    const expired = warn.mock.calls.filter((c) =>
      String(c[0]).includes('REVOCATION CONTINUITY GRACE EXPIRED'),
    );
    expect(expired).toHaveLength(1);
    warn.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('RevocationIndeterminateError', () => {
  it('is identifiable without instanceof (module-copy safe)', () => {
    expect(isRevocationIndeterminateError(new RevocationIndeterminateError('both down'))).toBe(
      true,
    );
    expect(isRevocationIndeterminateError(new Error('redis blip'))).toBe(false);
    expect(isRevocationIndeterminateError(null)).toBe(false);
    expect(isRevocationIndeterminateError('nope')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// End to end: the real guard, the real RedisService, both stores unreachable.
// ─────────────────────────────────────────────────────────────────────────
describe('JwtAuthGuard — both revocation stores unreachable', () => {
  const jwt = new JwtService({ secret: USER_SECRET });

  /** Prisma whose every revocation read throws — the "Postgres down" half. */
  function deadPrisma() {
    return {
      client: {
        revokedCredential: {
          findUnique: jest.fn(async () => {
            throw new Error('postgres down');
          }),
          upsert: jest.fn(async () => {
            throw new Error('postgres down');
          }),
          deleteMany: jest.fn(async () => ({ count: 0 })),
        },
      },
    };
  }

  function deadService() {
    // No REDIS_URL → publisher stays null (the "Redis down" half).
    const svc = new RedisService(deadPrisma() as never);
    jest
      .spyOn((svc as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
    return svc;
  }

  function ctx(token: string, method: string) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          headers: { authorization: `Bearer ${token}` },
          user: undefined,
        }),
      }),
    } as never;
  }

  const deviceToken = () =>
    new JwtService({ secret: DEVICE_SECRET }).sign({ sub: 'screen-1', kind: 'device', tenantId: 't1' });

  const userToken = () => jwt.sign({ sub: 'user-1', role: 'SCHOOL_ADMIN', tenantId: 't1' });

  it('DENY — a user session GET is refused (privileged/export/read alike)', async () => {
    const guard = new JwtAuthGuard(jwt, deadService() as never);
    await expect(guard.canActivate(ctx(userToken(), 'GET'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('DENY — a user session MUTATION is refused', async () => {
    const guard = new JwtAuthGuard(jwt, deadService() as never);
    await expect(guard.canActivate(ctx(userToken(), 'POST'))).rejects.toThrow(
      'Auth check unavailable; please retry',
    );
  });

  it('DENY — a DEVICE mutation is refused (render proof, telemetry, unpair)', async () => {
    const guard = new JwtAuthGuard(jwt, deadService() as never);
    await expect(guard.canActivate(ctx(deviceToken(), 'POST'))).rejects.toThrow(
      'Auth check unavailable; please retry',
    );
  });

  it('ALLOW — a DEVICE GET (the manifest backstop) is served inside the grace window', async () => {
    const guard = new JwtAuthGuard(jwt, deadService() as never);
    await expect(guard.canActivate(ctx(deviceToken(), 'GET'))).resolves.toBe(true);
    expect(revocationPosture.snapshot().allowed).toBe(1);
  });

  it('DENY — the same DEVICE GET once the grace window has lapsed', async () => {
    const guard = new JwtAuthGuard(jwt, deadService() as never);
    const realNow = Date.now;
    const t0 = realNow();
    try {
      await expect(guard.canActivate(ctx(deviceToken(), 'GET'))).resolves.toBe(true);
      Date.now = () => t0 + REVOCATION_CONTINUITY_GRACE_MS + 1_000;
      await expect(guard.canActivate(ctx(deviceToken(), 'GET'))).rejects.toThrow(
        'Auth check unavailable; please retry',
      );
    } finally {
      Date.now = realNow;
    }
    expect(revocationPosture.snapshot().graceExpired).toBe(true);
  });

  it('a REVOKED token is still refused while the stores are reachable (no regression)', async () => {
    const token = userToken();
    const svc = new RedisService({
      client: {
        revokedCredential: {
          findUnique: jest.fn(async () => ({
            id: 'r1',
            kind: 'jti',
            key: 'x',
            value: null,
            createdAt: new Date(),
            expiresAt: null,
          })),
          upsert: jest.fn(async () => ({})),
          deleteMany: jest.fn(async () => ({ count: 0 })),
        },
      },
    } as never);
    jest
      .spyOn((svc as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
    const guard = new JwtAuthGuard(jwt, svc as never);
    await expect(guard.canActivate(ctx(token, 'GET'))).rejects.toThrow('Session revoked');
  });
});
