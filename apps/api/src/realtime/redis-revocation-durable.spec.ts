/**
 * Durable revocation backstop (2026-07-10 — external-audit fix).
 *
 * Finding: `RedisService.sismember` returned false when Redis was
 * unavailable (fail-OPEN) and the per-user invalid-before epoch (P1-1)
 * was Redis-only — so during a Redis outage a previously-revoked
 * device/user token passed the revocation check until Redis returned.
 *
 * These tests pin the fix's exact fallback semantics:
 *
 *   sismember('jwt_revoked_list', token)
 *     redis up              → Redis answer, NO DB read (byte-identical)
 *     redis down, db up     → Postgres mirror answer (revoked → true)
 *     redis down, db down   → THROWS RevocationIndeterminateError + ONE warn
 *                             (SEC-012, 2026-09-04 - this used to answer
 *                             `false`, i.e. "not revoked", which is a claim a
 *                             process that just failed to read both stores
 *                             cannot make)
 *
 *   getTokenInvalidBefore(userId)
 *     redis up              → Redis answer, NO DB read (byte-identical)
 *     redis errs, db up     → Postgres mirror answer
 *     redis errs, db down   → throws (guard fails CLOSED, exactly as before)
 *     no redis,   db up     → Postgres mirror answer (strictly safer
 *                             than the old unconditional null)
 *     no redis,   db down   → throws too (SEC-012 - was `null`)
 *
 * Plus: dual-writes mirror to Postgres (best-effort, never failing the
 * primary flow), the 30s fallback cache keeps a sustained outage from
 * hammering Postgres, and writes invalidate the local cache.
 */
import { JwtService } from '@nestjs/jwt';
import {
  RedisService,
  hashRevokedToken,
  REVOKED_KIND_JTI,
  REVOKED_KIND_USER_INVALID_BEFORE,
} from './redis.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  isRevocationIndeterminateError,
  revocationPosture,
} from '../security/revocation-posture';

const TEST_SECRET = 'dev_only_jwt_secret_CHANGE_ME';

/** Prisma mock — just the revoked_credentials delegate the service touches. */
function makePrisma(
  opts: {
    rows?: Array<{
      kind: string;
      key: string;
      value?: string | null;
      expiresAt?: Date | null;
    }>;
    findThrows?: boolean;
    upsertThrows?: boolean;
  } = {},
) {
  const rows = opts.rows ?? [];
  const findUnique = jest.fn(async ({ where }: any) => {
    if (opts.findThrows) throw new Error('postgres down');
    const { kind, key } = where.kind_key;
    const row = rows.find((r) => r.kind === kind && r.key === key);
    return row
      ? {
          id: 'row-1',
          kind: row.kind,
          key: row.key,
          value: row.value ?? null,
          createdAt: new Date(),
          expiresAt: row.expiresAt ?? null,
        }
      : null;
  });
  const upsert = jest.fn(async (args: any) => {
    if (opts.upsertThrows) throw new Error('postgres down');
    return { id: 'row-1', ...args.create };
  });
  const deleteMany = jest.fn(async () => ({ count: 0 }));
  return {
    client: { revokedCredential: { findUnique, upsert, deleteMany } },
    findUnique,
    upsert,
    deleteMany,
  };
}

/**
 * Build a RedisService with no real Redis (REDIS_URL unset → publisher
 * stays null) and then script publisher/connected per scenario.
 */
function makeService(prisma?: ReturnType<typeof makePrisma>) {
  const svc = new RedisService(prisma as any);
  return svc;
}

function attachRedis(
  svc: RedisService,
  opts: {
    connected: boolean;
    sismember?: jest.Mock;
    get?: jest.Mock;
    set?: jest.Mock;
  },
) {
  (svc as any).connected = opts.connected;
  (svc as any).publisher = {
    sismember: opts.sismember ?? jest.fn(async () => 0),
    get: opts.get ?? jest.fn(async () => null),
    set: opts.set ?? jest.fn(async () => 'OK'),
  };
}

// The posture window is process-wide by design (see revocation-posture.ts),
// so every test starts from a closed window or the grace state leaks.
beforeEach(() => revocationPosture.reset());
afterEach(() => revocationPosture.reset());

const prevRedisUrl = process.env.REDIS_URL;
const prevRedisDisabled = process.env.REDIS_DISABLED;
beforeAll(() => {
  // Constructor must not create real ioredis clients in tests.
  delete process.env.REDIS_URL;
  delete process.env.REDIS_DISABLED;
});
afterAll(() => {
  if (prevRedisUrl !== undefined) process.env.REDIS_URL = prevRedisUrl;
  if (prevRedisDisabled !== undefined)
    process.env.REDIS_DISABLED = prevRedisDisabled;
});

describe('sismember — durable fallback', () => {
  it('redis up → answers from Redis and NEVER touches Postgres (hot path byte-identical)', async () => {
    const prisma = makePrisma({ rows: [] });
    const svc = makeService(prisma);
    const sis = jest.fn(async () => 1);
    attachRedis(svc, { connected: true, sismember: sis });

    await expect(svc.sismember('jwt_revoked_list', 'tok-a')).resolves.toBe(
      true,
    );
    sis.mockImplementation(async () => 0);
    await expect(svc.sismember('jwt_revoked_list', 'tok-a')).resolves.toBe(
      false,
    );

    expect(sis).toHaveBeenCalledTimes(2);
    expect(prisma.findUnique).not.toHaveBeenCalled();
  });

  it('redis down + token in the DB mirror → REVOKED (true)', async () => {
    const token = 'revoked-token';
    const prisma = makePrisma({
      rows: [
        {
          kind: REVOKED_KIND_JTI,
          key: hashRevokedToken(token),
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
    });
    const svc = makeService(prisma); // publisher null = redis down

    await expect(svc.sismember('jwt_revoked_list', token)).resolves.toBe(true);
    // Looked up by sha256, never the raw token.
    expect(prisma.findUnique).toHaveBeenCalledWith({
      where: {
        kind_key: { kind: REVOKED_KIND_JTI, key: hashRevokedToken(token) },
      },
    });
  });

  it('redis down + clean token → false (accepted)', async () => {
    const prisma = makePrisma({ rows: [] });
    const svc = makeService(prisma);
    await expect(
      svc.sismember('jwt_revoked_list', 'clean-token'),
    ).resolves.toBe(false);
    expect(prisma.findUnique).toHaveBeenCalledTimes(1);
  });

  it('redis down + EXPIRED mirror row → false (inert — the JWT itself has expired)', async () => {
    const token = 'old-token';
    const prisma = makePrisma({
      rows: [
        {
          kind: REVOKED_KIND_JTI,
          key: hashRevokedToken(token),
          expiresAt: new Date(Date.now() - 1_000),
        },
      ],
    });
    const svc = makeService(prisma);
    await expect(svc.sismember('jwt_revoked_list', token)).resolves.toBe(false);
  });

  it('redis CONNECTED but erroring → falls back to the DB mirror', async () => {
    const token = 'revoked-token';
    const prisma = makePrisma({
      rows: [{ kind: REVOKED_KIND_JTI, key: hashRevokedToken(token) }],
    });
    const svc = makeService(prisma);
    attachRedis(svc, {
      connected: true,
      sismember: jest.fn(async () => {
        throw new Error('redis blip');
      }),
    });

    await expect(svc.sismember('jwt_revoked_list', token)).resolves.toBe(true);
  });

  // SEC-012 - the direction that changed. This is the exact state the audit
  // caught: both stores unreachable used to answer "not revoked".
  it('redis down + DB down → THROWS (fail closed), warn ONCE (not per request)', async () => {
    const prisma = makePrisma({ findThrows: true });
    const svc = makeService(prisma);
    const warn = jest
      .spyOn((svc as any).logger, 'warn')
      .mockImplementation(() => undefined);

    await expect(svc.sismember('jwt_revoked_list', 'tok-1')).rejects.toThrow(
      /Revocation state could not be established/,
    );
    const thrown = await svc
      .sismember('jwt_revoked_list', 'tok-2')
      .then(() => null)
      .catch((e: unknown) => e);
    expect(isRevocationIndeterminateError(thrown)).toBe(true);

    const outageWarns = warn.mock.calls.filter((c) =>
      String(c[0]).includes('REVOCATION BACKSTOP UNAVAILABLE'),
    );
    expect(outageWarns).toHaveLength(1);
  });

  it('the tri-state lookup reports `indeterminate` rather than throwing', async () => {
    const prisma = makePrisma({ findThrows: true });
    const svc = makeService(prisma);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(svc.checkTokenRevoked('tok-1')).resolves.toBe('indeterminate');
  });

  it('redis down + NO prisma wired (bare test construction) → THROWS, never a quiet pass', async () => {
    const svc = new RedisService();
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(svc.sismember('jwt_revoked_list', 'tok')).rejects.toThrow(
      /Revocation state could not be established/,
    );
  });

  it('redis down + a NON-revocation set → false without touching Postgres', async () => {
    const prisma = makePrisma({ rows: [] });
    const svc = makeService(prisma);
    await expect(svc.sismember('some_other_set', 'member')).resolves.toBe(
      false,
    );
    expect(prisma.findUnique).not.toHaveBeenCalled();
  });

  it('30s fallback cache: repeat lookups within TTL hit Postgres once (positive AND negative)', async () => {
    const revoked = 'revoked-token';
    const prisma = makePrisma({
      rows: [{ kind: REVOKED_KIND_JTI, key: hashRevokedToken(revoked) }],
    });
    const svc = makeService(prisma);

    await expect(svc.sismember('jwt_revoked_list', revoked)).resolves.toBe(
      true,
    );
    await expect(svc.sismember('jwt_revoked_list', revoked)).resolves.toBe(
      true,
    );
    await expect(svc.sismember('jwt_revoked_list', 'clean')).resolves.toBe(
      false,
    );
    await expect(svc.sismember('jwt_revoked_list', 'clean')).resolves.toBe(
      false,
    );

    // 2 distinct tokens → exactly 2 DB reads despite 4 checks.
    expect(prisma.findUnique).toHaveBeenCalledTimes(2);
  });
});

describe('getTokenInvalidBefore — durable fallback', () => {
  it('redis up → answers from Redis and NEVER touches Postgres', async () => {
    const prisma = makePrisma({ rows: [] });
    const svc = makeService(prisma);
    attachRedis(svc, {
      connected: true,
      get: jest.fn(async () => '1700000000'),
    });

    await expect(svc.getTokenInvalidBefore('user-1')).resolves.toBe(1700000000);
    expect(prisma.findUnique).not.toHaveBeenCalled();
  });

  it('redis errors + DB has the marker → returns the mirrored epoch', async () => {
    const prisma = makePrisma({
      rows: [
        {
          kind: REVOKED_KIND_USER_INVALID_BEFORE,
          key: 'user-1',
          value: '1700000123',
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
    });
    const svc = makeService(prisma);
    attachRedis(svc, {
      connected: true,
      get: jest.fn(async () => {
        throw new Error('redis blip');
      }),
    });

    await expect(svc.getTokenInvalidBefore('user-1')).resolves.toBe(1700000123);
  });

  it('redis errors + DB down → throws (guard keeps failing CLOSED)', async () => {
    const prisma = makePrisma({ findThrows: true });
    const svc = makeService(prisma);
    attachRedis(svc, {
      connected: true,
      get: jest.fn(async () => {
        throw new Error('redis blip');
      }),
    });
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);

    await expect(svc.getTokenInvalidBefore('user-1')).rejects.toThrow(
      /Revocation state could not be established/,
    );
    await expect(svc.checkUserInvalidBefore('user-1')).resolves.toEqual({
      certainty: 'indeterminate',
    });
  });

  it('no redis configured + DB has the marker → returns it (strictly safer than the old null)', async () => {
    const prisma = makePrisma({
      rows: [
        {
          kind: REVOKED_KIND_USER_INVALID_BEFORE,
          key: 'user-1',
          value: '1700000456',
        },
      ],
    });
    const svc = makeService(prisma); // publisher null
    await expect(svc.getTokenInvalidBefore('user-1')).resolves.toBe(1700000456);
  });

  // SEC-012 - was `null` ("no marker exists"), which a process that could not
  // read either store has no way to know.
  it('no redis configured + DB down → THROWS (fail closed) + one-shot warn', async () => {
    const prisma = makePrisma({ findThrows: true });
    const svc = makeService(prisma);
    const warn = jest
      .spyOn((svc as any).logger, 'warn')
      .mockImplementation(() => undefined);

    await expect(svc.getTokenInvalidBefore('user-1')).rejects.toThrow(
      /Revocation state could not be established/,
    );
    await expect(svc.getTokenInvalidBefore('user-2')).rejects.toThrow(
      /Revocation state could not be established/,
    );
    const outageWarns = warn.mock.calls.filter((c) =>
      String(c[0]).includes('REVOCATION BACKSTOP UNAVAILABLE'),
    );
    expect(outageWarns).toHaveLength(1);
  });

  it('expired mirror marker → null (inert)', async () => {
    const prisma = makePrisma({
      rows: [
        {
          kind: REVOKED_KIND_USER_INVALID_BEFORE,
          key: 'user-1',
          value: '1700000456',
          expiresAt: new Date(Date.now() - 1_000),
        },
      ],
    });
    const svc = makeService(prisma);
    await expect(svc.getTokenInvalidBefore('user-1')).resolves.toBeNull();
  });
});

describe('dual-writes — Postgres mirror', () => {
  it('markUserTokensInvalid mirrors the epoch to Postgres AND still writes Redis', async () => {
    const prisma = makePrisma({ rows: [] });
    const svc = makeService(prisma);
    const set = jest.fn(async () => 'OK');
    attachRedis(svc, { connected: true, get: jest.fn(async () => null), set });

    const at = 1700000000;
    await svc.markUserTokensInvalid('user-1', at);

    expect(prisma.upsert).toHaveBeenCalledTimes(1);
    const args = prisma.upsert.mock.calls[0][0];
    expect(args.where).toEqual({
      kind_key: { kind: REVOKED_KIND_USER_INVALID_BEFORE, key: 'user-1' },
    });
    expect(args.create.value).toBe(String(at + 1)); // same +1s same-second guard as Redis
    expect(set).toHaveBeenCalled();
  });

  it('markUserTokensInvalid mirror is MONOTONIC — never moves the DB marker backwards', async () => {
    const prisma = makePrisma({
      rows: [
        {
          kind: REVOKED_KIND_USER_INVALID_BEFORE,
          key: 'user-1',
          value: '1800000000',
        },
      ],
    });
    const svc = makeService(prisma);
    attachRedis(svc, { connected: true });

    await svc.markUserTokensInvalid('user-1', 1700000000); // older than the stored marker
    const args = prisma.upsert.mock.calls[0][0];
    expect(args.update.value).toBe('1800000000');
  });

  it('markUserTokensInvalid: DB mirror failure does NOT fail the revocation (Redis still primary)', async () => {
    const prisma = makePrisma({ upsertThrows: true });
    const svc = makeService(prisma);
    attachRedis(svc, { connected: true });
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);

    await expect(svc.markUserTokensInvalid('user-1')).resolves.toBeUndefined();
  });

  it('markUserTokensInvalid: Redis down → mirror row STILL lands, then throws (contract unchanged)', async () => {
    const prisma = makePrisma({ rows: [] });
    const svc = makeService(prisma); // publisher null

    await expect(svc.markUserTokensInvalid('user-1')).rejects.toThrow(
      'Redis unavailable',
    );
    expect(prisma.upsert).toHaveBeenCalledTimes(1); // durable protection took anyway
  });

  it('markUserTokensInvalid invalidates the local fallback cache so the new marker is enforced immediately', async () => {
    const prisma = makePrisma({ rows: [] });
    const svc = makeService(prisma); // redis down → reads go to DB
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);

    // Prime a cached negative ("no marker") for user-1.
    await expect(svc.getTokenInvalidBefore('user-1')).resolves.toBeNull();
    // Revoke (Redis down → throws, but the mirror + cache invalidation ran).
    const at = Math.floor(Date.now() / 1000);
    await svc.markUserTokensInvalid('user-1', at).catch(() => undefined);
    // Make the subsequent read see the freshly-upserted row.
    (prisma.findUnique as jest.Mock).mockImplementation(async () => ({
      id: 'row-1',
      kind: REVOKED_KIND_USER_INVALID_BEFORE,
      key: 'user-1',
      value: String(at + 1),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }));

    await expect(svc.getTokenInvalidBefore('user-1')).resolves.toBe(at + 1);
  });

  it('mirrorRevokedTokenDurable stores sha256(token) with the JWT exp as expiresAt', async () => {
    const prisma = makePrisma({ rows: [] });
    const svc = makeService(prisma);
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = new JwtService({ secret: TEST_SECRET }).sign({
      sub: 'user-1',
      exp,
    });

    await svc.mirrorRevokedTokenDurable(token);

    expect(prisma.upsert).toHaveBeenCalledTimes(1);
    const args = prisma.upsert.mock.calls[0][0];
    expect(args.create.kind).toBe(REVOKED_KIND_JTI);
    expect(args.create.key).toBe(hashRevokedToken(token));
    expect(args.create.key).not.toContain(token); // never the raw credential
    expect(args.create.expiresAt.getTime()).toBe(exp * 1000);
  });

  it('opportunistic prune runs on mirror writes, gated to once per hour per process', async () => {
    const prisma = makePrisma({ rows: [] });
    const svc = makeService(prisma);
    attachRedis(svc, { connected: true });

    await svc.markUserTokensInvalid('user-1');
    await svc.mirrorRevokedTokenDurable('tok-1');
    await svc.markUserTokensInvalid('user-2');

    // 3 mirror writes → exactly 1 prune sweep inside the hour gate.
    expect(prisma.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
  });

  it('mirrorRevokedTokenDurable never throws (DB down → warn, logout flow unaffected)', async () => {
    const prisma = makePrisma({ upsertThrows: true });
    const svc = makeService(prisma);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(
      svc.mirrorRevokedTokenDurable('some-token'),
    ).resolves.toBeUndefined();

    const bare = new RedisService(); // no prisma wired at all
    await expect(
      bare.mirrorRevokedTokenDurable('some-token'),
    ).resolves.toBeUndefined();
  });
});

describe('end-to-end through JwtAuthGuard (redis fully down)', () => {
  const jwt = new JwtService({ secret: TEST_SECRET });
  const prevSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = TEST_SECRET;
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
  });

  function ctxFor(token: string) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: `Bearer ${token}` },
          user: undefined as any,
        }),
      }),
    } as any;
  }

  it('redis down + token in the DB revocation table → request REJECTED', async () => {
    const token = jwt.sign({
      sub: 'user-1',
      role: 'SCHOOL_ADMIN',
      tenantId: 't1',
    });
    const prisma = makePrisma({
      rows: [{ kind: REVOKED_KIND_JTI, key: hashRevokedToken(token) }],
    });
    const svc = makeService(prisma); // publisher null = redis down
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    const guard = new JwtAuthGuard(jwt, svc as any);

    await expect(guard.canActivate(ctxFor(token))).rejects.toThrow(
      'Session revoked',
    );
  });

  it('redis down + user invalid-before marker in the DB → request REJECTED', async () => {
    const token = jwt.sign({
      sub: 'user-1',
      role: 'SCHOOL_ADMIN',
      tenantId: 't1',
    });
    const future = Math.floor(Date.now() / 1000) + 3600;
    const prisma = makePrisma({
      rows: [
        {
          kind: REVOKED_KIND_USER_INVALID_BEFORE,
          key: 'user-1',
          value: String(future),
        },
      ],
    });
    const svc = makeService(prisma);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    const guard = new JwtAuthGuard(jwt, svc as any);

    await expect(guard.canActivate(ctxFor(token))).rejects.toThrow(
      'Session revoked',
    );
  });

  it('redis down + clean token → request ACCEPTED', async () => {
    const token = jwt.sign({
      sub: 'user-1',
      role: 'SCHOOL_ADMIN',
      tenantId: 't1',
    });
    const prisma = makePrisma({ rows: [] });
    const svc = makeService(prisma);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    const guard = new JwtAuthGuard(jwt, svc as any);

    await expect(guard.canActivate(ctxFor(token))).resolves.toBe(true);
  });

  // SEC-012 - the headline direction change, end to end. A user session on a
  // GET is still `protected`: only a DEVICE credential gets the continuity
  // exception, and that lane is proved in security/revocation-posture.spec.ts.
  it('redis down + DB down → user session REFUSED (fail closed) with the one-shot warn', async () => {
    const token = jwt.sign({
      sub: 'user-1',
      role: 'SCHOOL_ADMIN',
      tenantId: 't1',
    });
    const prisma = makePrisma({ findThrows: true });
    const svc = makeService(prisma);
    const warn = jest
      .spyOn((svc as any).logger, 'warn')
      .mockImplementation(() => undefined);
    const guard = new JwtAuthGuard(jwt, svc as any);

    await expect(guard.canActivate(ctxFor(token))).rejects.toThrow(
      'Auth check unavailable; please retry',
    );
    const outageWarns = warn.mock.calls.filter((c) =>
      String(c[0]).includes('REVOCATION BACKSTOP UNAVAILABLE'),
    );
    expect(outageWarns).toHaveLength(1);
  });
});
