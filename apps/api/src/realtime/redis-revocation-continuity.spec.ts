/**
 * Revocation continuity (F1, security review 2026-11-14).
 *
 * The hole: a Redis MISS was trusted as "not revoked", and the Postgres mirror
 * was read only when Redis ERRORED. Redis can lose keys without erroring
 * (restart without persistence, failover, FLUSHALL, eviction), and then every
 * revocation written before the loss — a role downgrade, a `canTriggerPanic`
 * removal, a logout — stopped being enforced until the token expired.
 *
 * These tests pin the fix: a continuity marker read in the same pipeline as
 * every revocation key; marker absent → the miss is not trusted (Postgres
 * answers) and one restore copies the mirror back; the marker is set again only
 * if Redis was not wiped mid-restore.
 *
 * The fake below emulates the two Lua scripts by identity. The scripts
 * themselves were also run against a real redis-server (see the handoff note
 * docs/handoffs/2026-11-13-emergency-auth-security-review.md).
 */
import {
  RedisService,
  hashRevokedToken,
  REVOKED_KIND_JTI,
  REVOKED_KIND_USER_INVALID_BEFORE,
  REVOCATION_CONTINUITY_KEY,
  REVOCATION_RESTORE_RUN_KEY,
  REVOKED_TOKEN_HASH_SET,
  RESTORE_INVALID_BEFORE_LUA,
  MARK_CONTINUITY_LUA,
} from './redis.service';
import { revocationPosture } from '../security/revocation-posture';

// ── An in-memory Redis with just the commands the service uses ──────────
class FakeRedis {
  strings = new Map<string, { value: string; expiresAt: number | null }>();
  sets = new Map<string, { members: Set<string>; expiresAt: number | null }>();
  /** Every command seen, in order (debugging aid). */
  calls: string[] = [];

  private live<T extends { expiresAt: number | null }>(
    m: Map<string, T>,
    key: string,
  ): T | undefined {
    const e = m.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== null && e.expiresAt <= Date.now()) {
      m.delete(key);
      return undefined;
    }
    return e;
  }

  flushall() {
    this.strings.clear();
    this.sets.clear();
  }

  async get(key: string) {
    this.calls.push(`get ${key}`);
    return this.live(this.strings, key)?.value ?? null;
  }
  async set(key: string, value: string, ex?: string, seconds?: number) {
    this.calls.push(`set ${key}`);
    this.strings.set(key, {
      value,
      expiresAt: ex === 'EX' && seconds ? Date.now() + seconds * 1000 : null,
    });
    return 'OK';
  }
  async del(key: string) {
    return this.strings.delete(key) || this.sets.delete(key) ? 1 : 0;
  }
  async exists(key: string) {
    this.calls.push(`exists ${key}`);
    return this.live(this.strings, key) || this.live(this.sets, key) ? 1 : 0;
  }
  async sismember(key: string, member: string) {
    this.calls.push(`sismember ${key}`);
    return this.live(this.sets, key)?.members.has(member) ? 1 : 0;
  }
  async sadd(key: string, member: string) {
    let s = this.live(this.sets, key);
    if (!s) {
      s = { members: new Set(), expiresAt: null };
      this.sets.set(key, s);
    }
    s.members.add(member);
    return 1;
  }
  async ttl(key: string) {
    const e = this.live(this.strings, key) ?? this.live(this.sets, key);
    if (!e) return -2;
    if (e.expiresAt === null) return -1;
    return Math.ceil((e.expiresAt - Date.now()) / 1000);
  }
  async expire(key: string, seconds: number) {
    const e = this.live(this.strings, key) ?? this.live(this.sets, key);
    if (!e) return 0;
    e.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }
  async config() {
    return ['maxmemory-policy', 'noeviction'];
  }
  /** Emulates the service's two scripts, matched by identity. */
  async eval(script: string, _numKeys: number, ...args: string[]) {
    if (script === RESTORE_INVALID_BEFORE_LUA) {
      const [key, value, ttl] = args;
      const cur = this.live(this.strings, key);
      if (!cur || Number(cur.value) < Number(value)) {
        await this.set(key, value, 'EX', Number(ttl));
        return 1;
      }
      return 0;
    }
    if (script === MARK_CONTINUITY_LUA) {
      const [runKey, markerKey, runId, stamp] = args;
      if (this.live(this.strings, runKey)?.value === runId) {
        await this.set(markerKey, stamp);
        this.strings.delete(runKey);
        return 1;
      }
      return 0;
    }
    throw new Error('unknown script');
  }
  pipeline() {
    const ops: Array<[string, unknown[]]> = [];
    const self = this;
    const chain: any = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'exec') {
            return async () => {
              const out: Array<[Error | null, unknown]> = [];
              for (const [cmd, args] of ops) {
                try {
                  out.push([null, await (self as any)[cmd](...args)]);
                } catch (e) {
                  out.push([e as Error, null]);
                }
              }
              return out;
            };
          }
          return (...args: unknown[]) => {
            ops.push([prop, args]);
            return chain;
          };
        },
      },
    );
    return chain;
  }
}

// ── A Prisma delegate for revoked_credentials (findUnique + findMany) ─────
type Row = {
  id: string;
  kind: string;
  key: string;
  value: string | null;
  expiresAt: Date | null;
};

function makePrisma(
  rows: Row[],
  hooks: { beforePage?: () => void; failFind?: boolean } = {},
) {
  const findUnique = jest.fn(async ({ where }: any) => {
    if (hooks.failFind) throw new Error('postgres down');
    const { kind, key } = where.kind_key;
    return rows.find((r) => r.kind === kind && r.key === key) ?? null;
  });
  const findMany = jest.fn(async (args: any) => {
    if (hooks.failFind) throw new Error('postgres down');
    hooks.beforePage?.();
    const now = (args.where.OR[1].expiresAt.gt as Date).getTime();
    let live = rows
      .filter((r) => r.expiresAt === null || r.expiresAt.getTime() > now)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (args.cursor) live = live.filter((r) => r.id > args.cursor.id);
    return live.slice(0, args.take);
  });
  return {
    client: {
      revokedCredential: {
        findUnique,
        findMany,
        upsert: jest.fn(async () => ({})),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
    },
    findUnique,
    findMany,
  };
}

function inAnHour() {
  return new Date(Date.now() + 60 * 60 * 1000);
}

function makeService(redis: FakeRedis, prisma: ReturnType<typeof makePrisma>) {
  const svc = new RedisService(prisma as any);
  (svc as any).connected = true;
  (svc as any).publisher = redis;
  jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
  jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
  return svc;
}

/** Let a fire-and-forget restore finish. */
async function settle(svc: RedisService) {
  await (svc as any).restoreInFlight;
}

const prevRedisUrl = process.env.REDIS_URL;
beforeAll(() => {
  delete process.env.REDIS_URL; // the constructor must not open a real client
});
afterAll(() => {
  if (prevRedisUrl !== undefined) process.env.REDIS_URL = prevRedisUrl;
});
beforeEach(() => revocationPosture.reset());
afterEach(() => revocationPosture.reset());

describe('revocation continuity — the marker decides whether a miss is trusted', () => {
  it('marker present + miss → clear, with NO database read (the hot path)', async () => {
    const redis = new FakeRedis();
    await redis.set(REVOCATION_CONTINUITY_KEY, 'x');
    const prisma = makePrisma([]);
    const svc = makeService(redis, prisma);

    await expect(svc.checkTokenRevoked('tok')).resolves.toBe('clear');
    await expect(svc.getTokenInvalidBefore('user-1')).resolves.toBeNull();
    expect(prisma.findUnique).not.toHaveBeenCalled();
    expect(prisma.findMany).not.toHaveBeenCalled();
  });

  it('THE BUG: Redis wiped → a demoted user is STILL revoked (Postgres answers, not the miss)', async () => {
    const redis = new FakeRedis(); // empty: no marker, no keys — a restart without persistence
    const prisma = makePrisma([
      {
        id: 'a',
        kind: REVOKED_KIND_USER_INVALID_BEFORE,
        key: 'user-1',
        value: '1700000500',
        expiresAt: inAnHour(),
      },
    ]);
    const svc = makeService(redis, prisma);

    // Before the fix this returned null — every pre-revocation token valid again.
    await expect(svc.getTokenInvalidBefore('user-1')).resolves.toBe(1700000500);
    expect(prisma.findUnique).toHaveBeenCalledTimes(1);
  });

  it('THE BUG: Redis wiped → a logged-out token is STILL revoked', async () => {
    const redis = new FakeRedis();
    const prisma = makePrisma([
      {
        id: 'a',
        kind: REVOKED_KIND_JTI,
        key: hashRevokedToken('tok-out'),
        value: null,
        expiresAt: inAnHour(),
      },
    ]);
    const svc = makeService(redis, prisma);

    await expect(svc.checkTokenRevoked('tok-out')).resolves.toBe('revoked');
    await expect(svc.sismember('jwt_revoked_list', 'tok-out')).resolves.toBe(
      true,
    );
  });

  it('a Redis HIT is enforced even with the marker absent (no database needed)', async () => {
    const redis = new FakeRedis();
    await redis.sadd('jwt_revoked_list', 'tok-hot');
    await redis.set('jwt_invalid_before:user-2', '1700000900');
    const prisma = makePrisma([], { failFind: true }); // Postgres down too
    const svc = makeService(redis, prisma);

    await expect(svc.checkTokenRevoked('tok-hot')).resolves.toBe('revoked');
    await expect(svc.getTokenInvalidBefore('user-2')).resolves.toBe(1700000900);
  });

  it('marker absent AND Postgres down → indeterminate (fails closed), never "clear"', async () => {
    const redis = new FakeRedis();
    const prisma = makePrisma([], { failFind: true });
    const svc = makeService(redis, prisma);

    await expect(svc.checkTokenRevoked('tok')).resolves.toBe('indeterminate');
    await expect(svc.checkUserInvalidBefore('user-1')).resolves.toEqual({
      certainty: 'indeterminate',
    });
  });
});

describe('revocation continuity — the restore', () => {
  it('a miss with the marker absent restores the mirror; afterwards Redis answers alone', async () => {
    const redis = new FakeRedis();
    const prisma = makePrisma([
      {
        id: 'a',
        kind: REVOKED_KIND_USER_INVALID_BEFORE,
        key: 'user-1',
        value: '1700000500',
        expiresAt: inAnHour(),
      },
      {
        id: 'b',
        kind: REVOKED_KIND_JTI,
        key: hashRevokedToken('tok-out'),
        value: null,
        expiresAt: inAnHour(),
      },
    ]);
    const svc = makeService(redis, prisma);

    await svc.checkTokenRevoked('someone-else'); // the miss that notices
    await settle(svc);

    expect(await redis.exists(REVOCATION_CONTINUITY_KEY)).toBe(1);
    expect(await redis.get('jwt_invalid_before:user-1')).toBe('1700000500');
    expect(
      await redis.sismember(
        REVOKED_TOKEN_HASH_SET,
        hashRevokedToken('tok-out'),
      ),
    ).toBe(1);

    prisma.findUnique.mockClear();
    await expect(svc.checkTokenRevoked('tok-out')).resolves.toBe('revoked');
    await expect(svc.getTokenInvalidBefore('user-1')).resolves.toBe(1700000500);
    await expect(svc.checkTokenRevoked('fresh')).resolves.toBe('clear');
    expect(prisma.findUnique).not.toHaveBeenCalled();
  });

  it('never LOWERS a marker written after the data loss (monotonic)', async () => {
    const redis = new FakeRedis();
    await redis.set('jwt_invalid_before:user-1', '1800000000'); // newer, written post-loss
    const prisma = makePrisma([
      {
        id: 'a',
        kind: REVOKED_KIND_USER_INVALID_BEFORE,
        key: 'user-1',
        value: '1700000000',
        expiresAt: inAnHour(),
      },
    ]);
    const svc = makeService(redis, prisma);

    await expect(svc.restoreRevocationsFromDurable()).resolves.toBe(true);
    expect(await redis.get('jwt_invalid_before:user-1')).toBe('1800000000');
  });

  it('Redis wiped WHILE restoring → the marker is NOT set (half a restore is not continuity)', async () => {
    const redis = new FakeRedis();
    let page = 0;
    const prisma = makePrisma(
      [
        {
          id: 'a',
          kind: REVOKED_KIND_USER_INVALID_BEFORE,
          key: 'user-1',
          value: '1700000500',
          expiresAt: inAnHour(),
        },
      ],
      {
        beforePage: () => {
          if (page++ === 0) redis.flushall(); // the wipe lands mid-run
        },
      },
    );
    const svc = makeService(redis, prisma);

    await expect(svc.restoreRevocationsFromDurable()).resolves.toBe(false);
    expect(await redis.exists(REVOCATION_CONTINUITY_KEY)).toBe(0);
    // ...so lookups keep reading Postgres:
    await expect(svc.getTokenInvalidBefore('user-1')).resolves.toBe(1700000500);
  });

  it('skips expired rows and pages through more than one batch', async () => {
    const redis = new FakeRedis();
    const rows: Row[] = [];
    for (let i = 0; i < 1_500; i++) {
      rows.push({
        id: `r${String(i).padStart(5, '0')}`,
        kind: REVOKED_KIND_USER_INVALID_BEFORE,
        key: `user-${i}`,
        value: '1700000000',
        expiresAt: inAnHour(),
      });
    }
    rows.push({
      id: 'zz-expired',
      kind: REVOKED_KIND_USER_INVALID_BEFORE,
      key: 'user-old',
      value: '1',
      expiresAt: new Date(Date.now() - 1000),
    });
    const prisma = makePrisma(rows);
    const svc = makeService(redis, prisma);

    await expect(svc.restoreRevocationsFromDurable()).resolves.toBe(true);
    expect(prisma.findMany).toHaveBeenCalledTimes(2);
    expect(await redis.get('jwt_invalid_before:user-0')).toBe('1700000000');
    expect(await redis.get('jwt_invalid_before:user-1499')).toBe('1700000000');
    expect(await redis.get('jwt_invalid_before:user-old')).toBeNull();
  });

  it('gives the restored-hash set the LONGEST remaining token lifetime', async () => {
    const redis = new FakeRedis();
    const prisma = makePrisma([
      {
        id: 'a',
        kind: REVOKED_KIND_JTI,
        key: 'h1',
        value: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        id: 'b',
        kind: REVOKED_KIND_JTI,
        key: 'h2',
        value: null,
        expiresAt: new Date(Date.now() + 180 * 86_400_000),
      },
    ]);
    const svc = makeService(redis, prisma);

    await svc.restoreRevocationsFromDurable();
    expect(await redis.ttl(REVOKED_TOKEN_HASH_SET)).toBeGreaterThan(
      179 * 86_400,
    );
  });

  it('a failed restore leaves the marker absent and is retried at most once per 30 s', async () => {
    const redis = new FakeRedis();
    const prisma = makePrisma([]);
    prisma.findMany.mockRejectedValueOnce(new Error('postgres blip'));
    const svc = makeService(redis, prisma);

    await svc.checkTokenRevoked('t1');
    await settle(svc);
    expect(await redis.exists(REVOCATION_CONTINUITY_KEY)).toBe(0);
    expect(redis.strings.has(REVOCATION_RESTORE_RUN_KEY)).toBe(true); // expires on its own

    await svc.checkTokenRevoked('t2'); // inside the 30 s window → no second attempt
    await settle(svc);
    expect(prisma.findMany).toHaveBeenCalledTimes(1);

    (svc as any).lastRestoreAttemptAt = Date.now() - 31_000;
    await svc.checkTokenRevoked('t3');
    await settle(svc);
    expect(prisma.findMany).toHaveBeenCalledTimes(2);
    expect(await redis.exists(REVOCATION_CONTINUITY_KEY)).toBe(1);
  });

  it('after a SUCCESSFUL restore, a new wipe restores at once (only failures throttle)', async () => {
    const redis = new FakeRedis();
    const prisma = makePrisma([
      {
        id: 'a',
        kind: REVOKED_KIND_USER_INVALID_BEFORE,
        key: 'user-1',
        value: '1700000500',
        expiresAt: inAnHour(),
      },
    ]);
    const svc = makeService(redis, prisma);

    await svc.checkTokenRevoked('t1');
    await settle(svc);
    expect(await redis.exists(REVOCATION_CONTINUITY_KEY)).toBe(1);

    redis.flushall(); // a second loss, seconds later
    await svc.checkTokenRevoked('t2');
    await settle(svc);
    expect(prisma.findMany).toHaveBeenCalledTimes(2);
    expect(await redis.get('jwt_invalid_before:user-1')).toBe('1700000500');
  });

  it('many concurrent misses start ONE restore', async () => {
    const redis = new FakeRedis();
    const prisma = makePrisma([]);
    const svc = makeService(redis, prisma);

    await Promise.all(
      Array.from({ length: 25 }, (_, i) => svc.checkTokenRevoked(`t${i}`)),
    );
    await settle(svc);
    expect(prisma.findMany).toHaveBeenCalledTimes(1);
  });

  it('boot: restores when the marker is absent, and does nothing when it is present', async () => {
    const redis = new FakeRedis();
    const prisma = makePrisma([]);
    const svc = makeService(redis, prisma);
    await (svc as any).checkRevocationContinuityAtBoot();
    expect(await redis.exists(REVOCATION_CONTINUITY_KEY)).toBe(1);

    const svc2 = makeService(redis, prisma);
    prisma.findMany.mockClear();
    await (svc2 as any).checkRevocationContinuityAtBoot();
    expect(prisma.findMany).not.toHaveBeenCalled();
  });

  it('boot: an eviction policy other than noeviction is reported at ERROR', async () => {
    const redis = new FakeRedis();
    await redis.set(REVOCATION_CONTINUITY_KEY, 'x');
    redis.config = async () => ['maxmemory-policy', 'volatile-lru'];
    const svc = makeService(redis, makePrisma([]));
    const error = (svc as any).logger.error as jest.Mock;

    await (svc as any).checkRevocationContinuityAtBoot();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("'volatile-lru'"),
    );
  });
});
