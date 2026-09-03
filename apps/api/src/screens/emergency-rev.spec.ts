/**
 * GET /api/v1/screens/:id/emergency-rev — the cheap change detector that
 * replaced the player's full-manifest emergency poll (efficiency P0-2/P0-3,
 * 2026-09-02).
 *
 * These are the acceptance tests the program named, plus the security
 * properties the lead added:
 *   1. an UNCHANGED revision performs ZERO Postgres queries — the Prisma
 *      client is not called on the second request, and that must hold across
 *      a realistic 10 s poll gap, not just back-to-back;
 *   2. a trigger and an all-clear both MOVE the revision, and so does an
 *      ordinary content mutation;
 *   3. Redis down → the in-process epoch answers (no throw, no Postgres);
 *   4. cross-tenant isolation — a record belonging to another tenant is
 *      never served, and the epoch is keyed per tenant;
 *   5. a revoked device gets its 403/401 on the VERY NEXT poll, with no
 *      stale-cache window beyond one in-flight request;
 *   6. the per-screen rate floor.
 */

import * as jwt from 'jsonwebtoken';
import { ScreensController } from './screens.controller';
import {
  bumpTenantEmergencyEpoch,
  computeEmergencyRev,
  emergencySignature,
  noteScreenEmergencyState,
  noteScreenScheduleBoundary,
  parseEpoch,
  pickNewerEpoch,
  readScreenRecord,
  resetEmergencyRevForTests,
  resolveEmergencyRev,
  peekScreenRecord,
  TENANT_EPOCH_REDIS_PREFIX,
  SCREEN_RECORD_MAX_AGE_MS,
  COLD_SIGNATURE,
} from './emergency-rev';
import {
  invalidateDeviceCredentialCache,
  setDeviceCredentialSharedStore,
} from './device-auth';
import { bumpManifestContentRev, resetManifestCacheForTests } from './manifest-hot-cache';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const DEVICE_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const SCREEN_A = 'screen-a';
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function deviceToken(screenId: string, ep = 0): string {
  return jwt.sign({ sub: screenId, kind: 'device', ep, fp: 'fp-test' }, DEVICE_JWT_SECRET, {
    expiresIn: '180d',
  });
}

function makeReq(screenId: string, ifNoneMatch?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${deviceToken(screenId)}` };
  if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch;
  return { headers, ip: '10.0.0.1', socket: { remoteAddress: '10.0.0.1' } } as any;
}

interface FakeRes {
  status: jest.Mock;
  json: jest.Mock;
  end: jest.Mock;
  setHeader: jest.Mock;
  statusCode: number | null;
  body: unknown;
  headers: Record<string, string>;
}

function makeRes(): FakeRes {
  const res: Partial<FakeRes> = {
    statusCode: null,
    body: undefined,
    headers: {},
  };
  res.setHeader = jest.fn((k: string, v: string) => {
    (res.headers as Record<string, string>)[k.toLowerCase()] = v;
    return res;
  }) as unknown as jest.Mock;
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as jest.Mock;
  res.json = jest.fn((payload: unknown) => {
    res.body = payload;
    return res;
  }) as unknown as jest.Mock;
  res.end = jest.fn(() => res) as unknown as jest.Mock;
  return res as FakeRes;
}

/**
 * In-memory Redis double with a switchable "down" mode AND real TTL
 * semantics.
 *
 * The TTL is not decoration. Without it this double models a key that never
 * expires, and the zero-Postgres assertions below would prove something
 * production does not do: the shared credential snapshot carries a 30 s TTL,
 * so a screen polling every 10 s DOES pay one indexed read per 30 s window.
 * `expireAll()` is how a test makes that window elapse deliberately.
 */
function makeRedis() {
  const store = new Map<string, { value: string; expiresAtMs: number | null }>();
  let down = false;
  const live = (key: string): string | null => {
    const row = store.get(key);
    if (!row) return null;
    if (row.expiresAtMs !== null && Date.now() >= row.expiresAtMs) {
      store.delete(key);
      return null;
    }
    return row.value;
  };
  return {
    store,
    setDown: (v: boolean) => {
      down = v;
    },
    /** Force every key past its TTL, as a real Redis would after the window. */
    expireAll: () => store.clear(),
    isConnected: () => !down,
    getString: jest.fn(async (key: string) => (down ? null : live(key))),
    setString: jest.fn(async (key: string, value: string, ttlSeconds?: number) => {
      if (down) return false;
      store.set(key, {
        value,
        expiresAtMs: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
      });
      return true;
    }),
    delKey: jest.fn(async (key: string) => {
      if (down) return false;
      store.delete(key);
      return true;
    }),
    sismember: jest.fn(async () => false),
    publish: jest.fn(async () => undefined),
  };
}

function makeController(screenRow: Record<string, unknown> | null, redis: ReturnType<typeof makeRedis>) {
  const findUnique = jest.fn(async () => screenRow);
  const prisma = { client: { screen: { findUnique } } } as any;
  const controller = new ScreensController(
    prisma,
    redis as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { controller, findUnique };
}

const LIVE_ROW = {
  id: SCREEN_A,
  tenantId: TENANT_A,
  screenGroupId: null,
  status: 'ONLINE',
  credentialEpoch: 0,
  credentialEpochRotatedAt: null,
};

/** Bypass the per-screen 2 s floor between assertions in a single test. */
function clearRateFloor(): void {
  (ScreensController as unknown as { emergencyRevLastServed: Map<string, number> })
    .emergencyRevLastServed.clear();
}

beforeEach(() => {
  jest.useRealTimers();
  resetEmergencyRevForTests();
  resetManifestCacheForTests();
  invalidateDeviceCredentialCache();
  setDeviceCredentialSharedStore(null);
  clearRateFloor();
});

afterEach(() => {
  setDeviceCredentialSharedStore(null);
  jest.useRealTimers();
});

// ── Pure algebra ─────────────────────────────────────────────────────────

describe('computeEmergencyRev', () => {
  const base = {
    originId: 'origin1',
    contentRev: 3,
    tenantStamp: 1_700_000_000_000,
    tenantActive: false,
    screenSig: 'abc123',
    boundarySeq: 0,
  };

  it('is stable for identical inputs and opaque (no readable counter)', () => {
    expect(computeEmergencyRev(base)).toBe(computeEmergencyRev({ ...base }));
    const rev = computeEmergencyRev(base);
    expect(rev).toMatch(/^r1\.[0-9a-f]{20}$/);
    // The fleet-wide mutation counter and the tenant stamp must not be
    // readable out of the token a device holds.
    expect(rev).not.toContain('3');
    expect(rev).not.toContain(String(base.tenantStamp));
    expect(rev).not.toContain(base.screenSig);
  });

  it.each([
    ['originId', { originId: 'origin2' }],
    ['contentRev', { contentRev: 4 }],
    ['tenantStamp', { tenantStamp: base.tenantStamp + 1 }],
    ['tenantActive', { tenantActive: true }],
    ['screenSig', { screenSig: 'def456' }],
    ['boundarySeq', { boundarySeq: 1 }],
  ])('changes when %s changes', (_label, patch) => {
    expect(computeEmergencyRev({ ...base, ...patch })).not.toBe(computeEmergencyRev(base));
  });

  it('an absent per-screen record is a distinct "cold" revision, never equal to a real one', () => {
    const cold = computeEmergencyRev({ ...base, screenSig: null });
    expect(cold).toBe(computeEmergencyRev({ ...base, screenSig: COLD_SIGNATURE }));
    expect(cold).not.toBe(computeEmergencyRev(base));
  });
});

describe('emergencySignature', () => {
  it('is deterministic across processes for the same observed state', () => {
    const input = {
      overrideId: 'ovr_1',
      overrideType: 'LOCKDOWN',
      tenantStatus: 'INACTIVE',
    };
    expect(emergencySignature(input)).toBe(emergencySignature({ ...input }));
  });

  it('moves when the tenant flips into and out of an alert', () => {
    const inactive = emergencySignature({ tenantStatus: 'INACTIVE' });
    const active = emergencySignature({ tenantStatus: 'LOCKDOWN', tenantType: 'LOCKDOWN' });
    const cleared = emergencySignature({ tenantStatus: 'INACTIVE' });
    expect(active).not.toBe(inactive);
    expect(cleared).toBe(inactive);
  });

  it('distinguishes an inherited district alert from a local one', () => {
    const local = emergencySignature({ tenantStatus: 'LOCKDOWN' });
    const inherited = emergencySignature({
      tenantStatus: 'LOCKDOWN',
      inheritedFromTenantId: 'district-1',
    });
    expect(local).not.toBe(inherited);
  });
});

describe('epoch helpers', () => {
  it('parses a well-formed epoch and rejects junk as "no epoch"', () => {
    expect(parseEpoch('123:1')).toEqual({ stamp: 123, active: true });
    expect(parseEpoch('123:0')).toEqual({ stamp: 123, active: false });
    expect(parseEpoch('garbage')).toBeNull();
    expect(parseEpoch(null)).toBeNull();
    expect(parseEpoch('')).toBeNull();
  });

  it('picks the newer epoch and never invents one', () => {
    const older = { stamp: 10, active: true };
    const newer = { stamp: 20, active: false };
    expect(pickNewerEpoch(older, newer)).toBe(newer);
    expect(pickNewerEpoch(newer, older)).toBe(newer);
    expect(pickNewerEpoch(null, null)).toEqual({ stamp: 0, active: false });
  });
});

describe('bumpTenantEmergencyEpoch', () => {
  it('is strictly monotone even for a trigger and all-clear inside one millisecond', () => {
    const redis = makeRedis();
    const a = bumpTenantEmergencyEpoch({ redis }, TENANT_A, { active: true });
    const b = bumpTenantEmergencyEpoch({ redis }, TENANT_A, { active: false });
    expect(b.stamp).toBeGreaterThan(a.stamp);
    expect(a.active).toBe(true);
    expect(b.active).toBe(false);
  });

  it('preserves the last asserted `active` when the caller omits it', () => {
    const redis = makeRedis();
    bumpTenantEmergencyEpoch({ redis }, TENANT_A, { active: true });
    // A pushed broadcast / group-scoped trigger moves the stamp only.
    const after = bumpTenantEmergencyEpoch({ redis }, TENANT_A);
    expect(after.active).toBe(true);
  });

  it('mirrors to Redis under a per-tenant key and never crosses tenants', async () => {
    const redis = makeRedis();
    bumpTenantEmergencyEpoch({ redis }, TENANT_A, { active: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(redis.store.has(`${TENANT_EPOCH_REDIS_PREFIX}${TENANT_A}`)).toBe(true);
    expect(redis.store.has(`${TENANT_EPOCH_REDIS_PREFIX}${TENANT_B}`)).toBe(false);
  });

  it('does not throw when Redis is down (the local epoch is authoritative)', () => {
    const redis = makeRedis();
    redis.setDown(true);
    expect(() => bumpTenantEmergencyEpoch({ redis }, TENANT_A, { active: true })).not.toThrow();
  });
});

describe('readScreenRecord', () => {
  it('refuses a record recorded under a different tenant (cross-tenant isolation)', () => {
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'sig-a', active: true });
    expect(readScreenRecord(SCREEN_A, TENANT_A)).not.toBeNull();
    expect(readScreenRecord(SCREEN_A, TENANT_B)).toBeNull();
  });

  it('treats a stale record as cold rather than as proof nothing changed', () => {
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'sig-a', active: false });
    const future = Date.now() + SCREEN_RECORD_MAX_AGE_MS + 1;
    expect(readScreenRecord(SCREEN_A, TENANT_A, future)).toBeNull();
  });

  it('consumes a fired boundary exactly once (one revision change per boundary)', () => {
    const at = Date.now();
    noteScreenEmergencyState(SCREEN_A, {
      tenantId: TENANT_A,
      sig: 'sig-a',
      active: false,
      boundaryAt: at + 1_000,
    });
    expect(readScreenRecord(SCREEN_A, TENANT_A, at)?.boundarySeq).toBe(0);
    expect(readScreenRecord(SCREEN_A, TENANT_A, at + 2_000)?.boundarySeq).toBe(1);
    // Not again — otherwise the player would refetch on every poll forever.
    expect(readScreenRecord(SCREEN_A, TENANT_A, at + 3_000)?.boundarySeq).toBe(1);
  });

  it('keeps the EARLIEST of the override expiry and the schedule boundary', () => {
    const at = Date.now();
    noteScreenEmergencyState(SCREEN_A, {
      tenantId: TENANT_A,
      sig: 'sig-a',
      active: true,
      boundaryAt: at + 10_000,
    });
    noteScreenScheduleBoundary(SCREEN_A, at + 2_000);
    expect(peekScreenRecord(SCREEN_A)?.boundaryAt).toBe(at + 2_000);
    // The nearer boundary is the one that fires.
    expect(readScreenRecord(SCREEN_A, TENANT_A, at + 3_000)?.boundarySeq).toBe(1);
  });

  it('restarts the boundary counter when a screen is re-homed to another tenant', () => {
    const at = Date.now();
    noteScreenEmergencyState(SCREEN_A, {
      tenantId: TENANT_A,
      sig: 'sig-a',
      active: false,
      boundaryAt: at - 1,
    });
    readScreenRecord(SCREEN_A, TENANT_A, at); // seq -> 1
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_B, sig: 'sig-b', active: false });
    expect(readScreenRecord(SCREEN_A, TENANT_B, at)?.boundarySeq).toBe(0);
  });
});

describe('resolveEmergencyRev', () => {
  it('moves on trigger and again on all-clear, and reports `active` honestly', async () => {
    const redis = makeRedis();
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });
    const before = await resolveEmergencyRev({ redis }, SCREEN_A, TENANT_A);
    expect(before.active).toBe(false);

    bumpTenantEmergencyEpoch({ redis }, TENANT_A, { active: true });
    const during = await resolveEmergencyRev({ redis }, SCREEN_A, TENANT_A);
    expect(during.rev).not.toBe(before.rev);
    expect(during.active).toBe(true);

    bumpTenantEmergencyEpoch({ redis }, TENANT_A, { active: false });
    const after = await resolveEmergencyRev({ redis }, SCREEN_A, TENANT_A);
    expect(after.rev).not.toBe(during.rev);
    expect(after.rev).not.toBe(before.rev);
    expect(after.active).toBe(false);
  });

  it('moves on an ordinary content mutation (the Prisma $use hook path)', async () => {
    const redis = makeRedis();
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });
    const before = await resolveEmergencyRev({ redis }, SCREEN_A, TENANT_A);
    bumpManifestContentRev(); // what a template/playlist/schedule write does
    const after = await resolveEmergencyRev({ redis }, SCREEN_A, TENANT_A);
    expect(after.rev).not.toBe(before.rev);
  });

  it('falls back to the in-process epoch when Redis is down and still sees the trigger', async () => {
    const redis = makeRedis();
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });
    const before = await resolveEmergencyRev({ redis }, SCREEN_A, TENANT_A);

    redis.setDown(true);
    bumpTenantEmergencyEpoch({ redis }, TENANT_A, { active: true });
    const during = await resolveEmergencyRev({ redis }, SCREEN_A, TENANT_A, Date.now() + 5_000);
    expect(during.rev).not.toBe(before.rev);
    expect(during.active).toBe(true);
  });

  it('two tenants never share a revision, even with identical screen state', async () => {
    const redis = makeRedis();
    noteScreenEmergencyState('screen-1', { tenantId: TENANT_A, sig: 'same', active: false });
    noteScreenEmergencyState('screen-2', { tenantId: TENANT_B, sig: 'same', active: false });
    bumpTenantEmergencyEpoch({ redis }, TENANT_A, { active: true });
    const a = await resolveEmergencyRev({ redis }, 'screen-1', TENANT_A);
    const b = await resolveEmergencyRev({ redis }, 'screen-2', TENANT_B);
    expect(a.rev).not.toBe(b.rev);
    expect(a.active).toBe(true);
    // Tenant B learns nothing about tenant A's incident.
    expect(b.active).toBe(false);
  });

  it('reports `cold` (→ the screen fetches) when this process has never seen the screen', async () => {
    const redis = makeRedis();
    const answer = await resolveEmergencyRev({ redis }, 'never-seen', TENANT_A);
    expect(answer.cold).toBe(true);
  });
});

// ── The endpoint ─────────────────────────────────────────────────────────

describe('GET /screens/:id/emergency-rev', () => {
  it('200s with an opaque rev + active flag, then 304s an unchanged poll', async () => {
    const redis = makeRedis();
    const { controller } = makeController(LIVE_ROW, redis);
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });

    const res1 = makeRes();
    await controller.getEmergencyRev(SCREEN_A, makeReq(SCREEN_A), res1 as any);
    expect(res1.statusCode).toBe(200);
    const body = res1.body as { rev: string; active: boolean };
    expect(body.rev).toMatch(/^r1\./);
    expect(body.active).toBe(false);
    expect(res1.headers['etag']).toBe(body.rev);
    expect(res1.headers['cache-control']).toContain('no-store');

    clearRateFloor();
    const res2 = makeRes();
    await controller.getEmergencyRev(SCREEN_A, makeReq(SCREEN_A, body.rev), res2 as any);
    expect(res2.statusCode).toBe(304);
    expect(res2.end).toHaveBeenCalled();
  });

  /**
   * THE ACCEPTANCE TEST. Not just back-to-back: the poll gap is the real
   * 10 s cadence, which is longer than the 5 s default credential-snapshot
   * TTL. Without the opt-in extended window this endpoint would silently be
   * one indexed Postgres read per screen per poll — the same tens of millions
   * of reads/day at 1,000 screens, just moved to a different route.
   *
   * SCOPE OF THE CLAIM, precisely: zero Postgres for as long as the credential
   * snapshot is valid. The snapshot's TTL is 30 s, so the honest steady-state
   * cost is ONE indexed read per screen per 30 s, not zero — pinned by the
   * next test rather than papered over by a TTL-less test double.
   */
  it('performs ZERO Postgres queries on an unchanged poll, across a 10 s gap', async () => {
    const redis = makeRedis();
    const { controller, findUnique } = makeController(LIVE_ROW, redis);
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });

    const res1 = makeRes();
    await controller.getEmergencyRev(SCREEN_A, makeReq(SCREEN_A), res1 as any);
    const rev = (res1.body as { rev: string }).rev;
    expect(findUnique).toHaveBeenCalledTimes(1); // the cold read

    findUnique.mockClear();
    const realNow = Date.now;
    try {
      // Every poll inside the 30 s snapshot window, at the production 10 s
      // cadence. On the OLD full-manifest path each of these cost a screen
      // read plus a screenGroup read plus a tenant read plus an override read.
      for (const gapMs of [10_000, 20_000, 29_000]) {
        clearRateFloor();
        Date.now = () => realNow() + gapMs;
        const res = makeRes();
        await controller.getEmergencyRev(SCREEN_A, makeReq(SCREEN_A, rev), res as any);
        expect(res.statusCode).toBe(304);
      }
    } finally {
      Date.now = realNow;
    }
    expect(findUnique).not.toHaveBeenCalled();
  });

  /**
   * The honest steady-state number, pinned so nobody has to trust a
   * round-number claim in a report: once the 30 s credential snapshot
   * genuinely expires in BOTH tiers, the next unchanged poll pays exactly ONE
   * indexed read — and the polls after it pay none again. At the 10 s cadence
   * that is 1 read per screen per 30 s (2,880/day), against roughly four per
   * poll on the full-manifest path this replaced (~46,000/day).
   *
   * It also pins the shape of the win at multi-replica scale: the refreshed
   * snapshot is written back to the SHARED tier, so a second replica serving
   * the same screen inside the window reads Redis, not Postgres.
   */
  it('costs exactly one indexed read per 30 s snapshot window, then none', async () => {
    const redis = makeRedis();
    const { controller, findUnique } = makeController(LIVE_ROW, redis);
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });

    const first = makeRes();
    await controller.getEmergencyRev(SCREEN_A, makeReq(SCREEN_A), first as any);
    const rev = (first.body as { rev: string }).rev;
    findUnique.mockClear();

    const realNow = Date.now;
    try {
      // Both tiers expire together (same TTL) — the real 30 s boundary.
      invalidateDeviceCredentialCache(SCREEN_A);
      redis.expireAll();
      // Re-seed the per-screen record the DEL above does not touch.
      noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });

      clearRateFloor();
      Date.now = () => realNow() + 30_000;
      const afterExpiry = makeRes();
      await controller.getEmergencyRev(SCREEN_A, makeReq(SCREEN_A, rev), afterExpiry as any);
      expect(findUnique).toHaveBeenCalledTimes(1);

      // …and the polls inside the NEXT window are free again.
      findUnique.mockClear();
      for (let i = 1; i <= 2; i += 1) {
        clearRateFloor();
        Date.now = () => realNow() + 30_000 + i * 10_000;
        const res = makeRes();
        await controller.getEmergencyRev(SCREEN_A, makeReq(SCREEN_A, rev), res as any);
      }
      expect(findUnique).not.toHaveBeenCalled();
    } finally {
      Date.now = realNow;
    }

    // The refreshed snapshot went back to the shared tier for other replicas.
    expect(redis.store.has(`venueos:devcred:${SCREEN_A}`)).toBe(true);
  });

  it('re-verifies the credential against Postgres when the revision CHANGES', async () => {
    const redis = makeRedis();
    const { controller, findUnique } = makeController(LIVE_ROW, redis);
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });

    const res1 = makeRes();
    await controller.getEmergencyRev(SCREEN_A, makeReq(SCREEN_A), res1 as any);
    const rev = (res1.body as { rev: string }).rev;

    bumpTenantEmergencyEpoch({ redis }, TENANT_A, { active: true });
    invalidateDeviceCredentialCache(SCREEN_A); // force the fresh pass to hit Prisma
    findUnique.mockClear();
    clearRateFloor();

    const res2 = makeRes();
    await controller.getEmergencyRev(SCREEN_A, makeReq(SCREEN_A, rev), res2 as any);
    expect(res2.statusCode).toBe(200);
    expect((res2.body as { rev: string }).rev).not.toBe(rev);
    expect((res2.body as { active: boolean }).active).toBe(true);
    expect(findUnique).toHaveBeenCalled();
  });

  /**
   * The lead's requirement: revoke → the NEXT poll is refused, with no stale
   * window beyond one in-flight request. `invalidateDeviceCredentialCache`
   * is what every revocation writer already calls.
   */
  it('refuses a revoked device on its very next poll, with no stale-cache window', async () => {
    const redis = makeRedis();
    const row: Record<string, unknown> = { ...LIVE_ROW };
    const findUnique = jest.fn(async () => row);
    const prisma = { client: { screen: { findUnique } } } as any;
    const controller = new ScreensController(
      prisma,
      redis as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });

    const res1 = makeRes();
    await controller.getEmergencyRev(SCREEN_A, makeReq(SCREEN_A), res1 as any);
    const rev = (res1.body as { rev: string }).rev;
    expect(res1.statusCode).toBe(200);

    // The revoke writer flips the row AND invalidates every cached snapshot.
    row.status = 'REVOKED';
    invalidateDeviceCredentialCache(SCREEN_A);
    clearRateFloor();

    const res2 = makeRes();
    await controller.getEmergencyRev(SCREEN_A, makeReq(SCREEN_A, rev), res2 as any);
    expect(res2.statusCode).toBe(401);
    expect((res2.body as { code: string }).code).toBe('SCREEN_DEVICE_AUTH_REQUIRED');
  });

  /**
   * The lead's L1 rule: negatives never reach the cross-replica tier. A
   * `null` state ("no such screen row") memoised in shared storage would 401
   * a working device on every replica for the length of the TTL — the same
   * shape as the tombstone bug the DEL fix already closed once.
   */
  it('never publishes a negative credential state to the shared tier', async () => {
    const redis = makeRedis();
    const { controller } = makeController(null, redis); // screen row is gone
    const res = makeRes();
    await controller.getEmergencyRev(SCREEN_A, makeReq(SCREEN_A), res as any);
    expect(res.statusCode).toBe(401);
    expect(redis.store.has(`venueos:devcred:${SCREEN_A}`)).toBe(false);
  });

  it('refuses a device token whose subject is a different screen', async () => {
    const redis = makeRedis();
    const { controller } = makeController(LIVE_ROW, redis);
    const req = {
      headers: { authorization: `Bearer ${deviceToken('some-other-screen')}` },
      ip: '10.0.0.1',
      socket: { remoteAddress: '10.0.0.1' },
    } as any;
    const res = makeRes();
    await controller.getEmergencyRev(SCREEN_A, req, res as any);
    expect(res.statusCode).toBe(401);
  });

  it('refuses an unauthenticated caller', async () => {
    const redis = makeRedis();
    const { controller } = makeController(LIVE_ROW, redis);
    const res = makeRes();
    await controller.getEmergencyRev(
      SCREEN_A,
      { headers: {}, ip: '10.0.0.1', socket: { remoteAddress: '10.0.0.1' } } as any,
      res as any,
    );
    expect(res.statusCode).toBe(401);
  });

  it('refuses an unpaired screen rather than inventing a tenant-less revision', async () => {
    const redis = makeRedis();
    const { controller } = makeController({ ...LIVE_ROW, tenantId: null }, redis);
    const res = makeRes();
    await controller.getEmergencyRev(SCREEN_A, makeReq(SCREEN_A), res as any);
    expect(res.statusCode).toBe(401);
  });

  it('enforces the per-screen poll floor before doing any auth work', async () => {
    const redis = makeRedis();
    const { controller, findUnique } = makeController(LIVE_ROW, redis);
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });

    const res1 = makeRes();
    await controller.getEmergencyRev(SCREEN_A, makeReq(SCREEN_A), res1 as any);
    expect(res1.statusCode).toBe(200);

    findUnique.mockClear();
    const res2 = makeRes(); // immediately again — inside the 2 s floor
    await controller.getEmergencyRev(SCREEN_A, makeReq(SCREEN_A), res2 as any);
    expect(res2.statusCode).toBe(429);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('answers from the in-process epoch when Redis is unreachable', async () => {
    const redis = makeRedis();
    redis.setDown(true);
    const { controller } = makeController(LIVE_ROW, redis);
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });

    const res1 = makeRes();
    await controller.getEmergencyRev(SCREEN_A, makeReq(SCREEN_A), res1 as any);
    expect(res1.statusCode).toBe(200);
    const rev = (res1.body as { rev: string }).rev;

    bumpTenantEmergencyEpoch({ redis }, TENANT_A, { active: true });
    clearRateFloor();
    const res2 = makeRes();
    await controller.getEmergencyRev(SCREEN_A, makeReq(SCREEN_A, rev), res2 as any);
    expect(res2.statusCode).toBe(200);
    expect((res2.body as { active: boolean }).active).toBe(true);
  });
});
