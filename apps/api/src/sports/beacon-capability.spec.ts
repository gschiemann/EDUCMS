/**
 * SEC-007 regression suite — proof-of-play beacon authenticity.
 *
 * The finding: `POST /sports/sponsors/:sponsorId/impression` and
 * `POST /sports/board/:id/cts-cue-fired` are unauthenticated by design. They
 * check that the sponsor and game share a tenant, but nothing checks WHO is
 * reporting — and per-replica in-memory rate limits bound volume, not
 * authenticity. Those rows are then presented as proof-of-play in sponsor and
 * contractual reporting.
 *
 * These tests drive the REAL controllers and the REAL capability module.
 */

import * as jwt from 'jsonwebtoken';
import { HttpException, HttpStatus } from '@nestjs/common';
import { invalidateDeviceCredentialCache } from '../screens/device-auth';
import { SponsorsController } from './sponsors.controller';
import { SponsorsService, SPONSOR_IMPRESSION_ATTESTED } from './sponsors.service';
import { SportsBoardController } from './sports-board.controller';
import {
  mintBeaconCapability,
  verifyBeaconCapability,
  resolveBeaconAttestation,
  parseBeaconSequence,
  BEACON_MAX_SEQUENCE,
  _resetBeaconReplayMemoryForTests,
  type BeaconReplayRedis,
} from './beacon-capability';

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-evil';
const GAME = 'game-1';
const SCREEN = 'screen-9';

beforeEach(() => {
  _resetBeaconReplayMemoryForTests();
  // The live screen re-check (SEC-007 re-audit) reads through the 5 s
  // per-process credential cache, so consecutive cases would otherwise see
  // each other's screen rows.
  invalidateDeviceCredentialCache();
  delete process.env.SPORTS_BEACON_REQUIRE_VERIFIED;
  process.env.SPORTS_BEACON_SECRET = 'test_beacon_secret_that_is_long_enough';
});

afterAll(() => {
  delete process.env.SPORTS_BEACON_REQUIRE_VERIFIED;
  delete process.env.SPORTS_BEACON_SECRET;
});

// ── a fake Redis, SHARED between "replicas" ───────────────────────────────
/**
 * `SET key val PX ttl NX` semantics — returns 'OK' the first time and null
 * on every repeat, which is exactly the property the replay guard relies on.
 * One instance stands in for the one Redis every replica talks to.
 */
function makeSharedRedis() {
  const store = new Map<string, number>();
  const client: BeaconReplayRedis & { store: Map<string, number> } = {
    status: 'ready',
    store,
    async set(key, _value, _mode, ttlMs, _condition) {
      const now = Date.now();
      const exp = store.get(key);
      if (exp !== undefined && exp > now) return null; // NX: already claimed
      store.set(key, now + ttlMs);
      return 'OK';
    },
  };
  return client;
}

function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([k, v]) => row[k] === v);
}

function makeTable() {
  const rows: Record<string, unknown>[] = [];
  let seq = 0;
  return {
    rows,
    findUnique: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      rows.find((r) => matches(r, where)) ?? null,
    findFirst: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `id-${++seq}`, ts: new Date(), createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
  };
}

/** The live screen row the beacon-time re-check reads. Paired, not revoked. */
function liveScreenRow(over: Record<string, unknown> = {}) {
  return {
    id: SCREEN,
    tenantId: TENANT,
    screenGroupId: null,
    status: 'ONLINE',
    credentialEpoch: 3,
    credentialEpochRotatedAt: null,
    ...over,
  };
}

function sponsorSetup(redis?: BeaconReplayRedis) {
  const sponsor = makeTable();
  const game = makeTable();
  const sponsorImpression = makeTable();
  const auditLog = makeTable();
  const gameEvent = makeTable();
  // SEC-007 re-audit — the controller now re-reads the live screen row behind
  // a presented capability, so the double needs one.
  const screen = makeTable();
  screen.rows.push(liveScreenRow());
  const prisma = { client: { sponsor, game, sponsorImpression, auditLog, gameEvent, screen } };
  const service = new SponsorsService(prisma as never);
  const controller = new SponsorsController(
    service,
    redis ? ({ publisher: redis } as never) : undefined,
    prisma as never,
  );
  sponsor.rows.push({ id: 'sp1', tenantId: TENANT, name: 'Joe Pizza', weight: 1, active: true });
  game.rows.push({ id: GAME, tenantId: TENANT, status: 'LIVE', startedAt: new Date(), endedAt: null });
  return { controller, service, sponsorImpression, gameEvent, game, sponsor, screen };
}

/** Wait for the controller's fire-and-forget `recordImpression` to settle. */
const flush = () => new Promise((r) => setImmediate(r));

/**
 * A capability as the MINT ENDPOINT issues one today: screen-bound, epoch-
 * bound, and (SEC-007 residual #2) tenant-bound.
 */
function verifiedCapability(scope: 'impression' | 'cue' = 'impression') {
  return mintBeaconCapability({
    gameId: GAME,
    scope,
    screenId: SCREEN,
    credentialEpoch: 3,
    tenantId: TENANT,
  }).capability;
}

/** A capability minted BEFORE the tenant binding existed (no `t` claim). */
function legacyCapability(scope: 'impression' | 'cue' = 'impression') {
  return mintBeaconCapability({
    gameId: GAME,
    scope,
    screenId: SCREEN,
    credentialEpoch: 3,
  }).capability;
}

// ──────────────────────────────────────────────────────────────────────────
describe('beacon capability — signature + binding', () => {
  it('round-trips and reports itself verified when bound to a screen', () => {
    const minted = mintBeaconCapability({ gameId: GAME, scope: 'impression', screenId: SCREEN, credentialEpoch: 3 });
    expect(minted.verified).toBe(true);
    const v = verifyBeaconCapability(minted.capability, { gameId: GAME, scope: 'impression' });
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.verified).toBe(true);
    expect(v.claims.s).toBe(SCREEN);
    expect(v.claims.e).toBe(3);
  });

  it('marks a screenless capability unverified', () => {
    const minted = mintBeaconCapability({ gameId: GAME, scope: 'impression' });
    expect(minted.verified).toBe(false);
    const v = verifyBeaconCapability(minted.capability, { gameId: GAME, scope: 'impression' });
    expect(v.ok && v.verified).toBe(false);
  });

  it('REJECTS a tampered payload (the screen id is inside the MAC)', () => {
    const minted = mintBeaconCapability({ gameId: GAME, scope: 'impression', screenId: SCREEN });
    const [ver, payload, mac] = minted.capability.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    claims.s = 'screen-someone-elses';
    const forged = `${ver}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${mac}`;
    expect(verifyBeaconCapability(forged, { gameId: GAME, scope: 'impression' })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('REJECTS a capability minted for a DIFFERENT game', () => {
    const cap = mintBeaconCapability({ gameId: 'game-other', scope: 'impression', screenId: SCREEN }).capability;
    expect(verifyBeaconCapability(cap, { gameId: GAME, scope: 'impression' })).toMatchObject({
      ok: false,
      reason: 'game_mismatch',
    });
  });

  it('REJECTS an impression capability replayed onto the CUE endpoint', () => {
    const cap = verifiedCapability('impression');
    expect(verifyBeaconCapability(cap, { gameId: GAME, scope: 'cue' })).toMatchObject({
      ok: false,
      reason: 'scope_mismatch',
    });
  });

  it('REJECTS an expired capability', () => {
    const minted = mintBeaconCapability({ gameId: GAME, scope: 'impression', screenId: SCREEN, ttlMs: 1_000 });
    expect(
      verifyBeaconCapability(minted.capability, {
        gameId: GAME,
        scope: 'impression',
        now: Date.now() + 5_000,
      }),
    ).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('REJECTS junk without throwing', () => {
    for (const junk of ['', 'x', 'bc1.aaa', 'bc9.aaa.bbb', 'x'.repeat(600), null, 42, {}]) {
      expect(verifyBeaconCapability(junk, { gameId: GAME, scope: 'impression' }).ok).toBe(false);
    }
  });

  it('bounds the sequence number', () => {
    expect(parseBeaconSequence(1)).toBe(1);
    expect(parseBeaconSequence('7')).toBe(7);
    expect(parseBeaconSequence(0)).toBeNull();
    expect(parseBeaconSequence(-1)).toBeNull();
    expect(parseBeaconSequence(BEACON_MAX_SEQUENCE + 1)).toBeNull();
    expect(parseBeaconSequence('abc')).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('sponsor impression beacon — provenance is recorded, never assumed', () => {
  it('records an ANONYMOUS beacon as unverified and writes NO attestation', async () => {
    const { controller, sponsorImpression, gameEvent } = sponsorSetup();
    const res = await controller.impression('sp1', undefined, undefined, { gameId: GAME });
    expect(res).toEqual({ ok: true, verified: false, provenance: 'anonymous' });
    await flush();
    expect(sponsorImpression.rows).toHaveLength(1);
    expect(gameEvent.rows).toHaveLength(0);
  });

  it('records a DEVICE-BOUND beacon as verified and writes an attestation', async () => {
    const redis = makeSharedRedis();
    const { controller, sponsorImpression, gameEvent } = sponsorSetup(redis);

    const res = await controller.impression('sp1', verifiedCapability(), '1', { gameId: GAME });
    expect(res).toEqual({ ok: true, verified: true, provenance: 'device-verified' });
    await flush();

    expect(sponsorImpression.rows).toHaveLength(1);
    expect(gameEvent.rows).toHaveLength(1);
    expect(gameEvent.rows[0]).toMatchObject({
      gameId: GAME,
      type: SPONSOR_IMPRESSION_ATTESTED,
    });
    expect(gameEvent.rows[0].payload).toMatchObject({ sponsorId: 'sp1', screenId: SCREEN, beaconSeq: 1 });
  });

  it('REJECTS a forged capability outright — never downgrades it to "anonymous"', async () => {
    const { controller, sponsorImpression } = sponsorSetup(makeSharedRedis());
    const [ver, payload] = verifiedCapability().split('.');
    const forged = `${ver}.${payload}.${'a'.repeat(43)}`;

    await expect(
      controller.impression('sp1', forged, '1', { gameId: GAME }),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    await flush();
    expect(sponsorImpression.rows).toHaveLength(0);
  });

  it('REJECTS a capability presented WITHOUT a sequence number', async () => {
    const { controller } = sponsorSetup(makeSharedRedis());
    await expect(
      controller.impression('sp1', verifiedCapability(), undefined, { gameId: GAME }),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('REJECTS a REPLAYED beacon — and does so ACROSS REPLICAS', async () => {
    // One Redis, two controller instances = two pods. Their in-memory rate
    // limiters are independent; the replay claim is not.
    const redis = makeSharedRedis();
    const replicaA = sponsorSetup(redis);
    const replicaB = sponsorSetup(redis);
    const cap = verifiedCapability();

    // First delivery lands on pod A.
    expect(await replicaA.controller.impression('sp1', cap, '1', { gameId: GAME })).toEqual({
      ok: true,
      verified: true,
      provenance: 'device-verified',
    });
    await flush();
    expect(replicaA.sponsorImpression.rows).toHaveLength(1);

    // The captured beacon is re-fired at pod B, which has never seen it.
    await expect(
      replicaB.controller.impression('sp1', cap, '1', { gameId: GAME }),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    await flush();
    expect(replicaB.sponsorImpression.rows).toHaveLength(0);

    // A genuinely NEW look (next sequence) still goes through on either pod.
    expect(await replicaB.controller.impression('sp1', cap, '2', { gameId: GAME })).toEqual({
      ok: true,
      verified: true,
      provenance: 'device-verified',
    });
  });

  it('rejects a replay on the SAME replica even with no Redis at all', async () => {
    const { controller } = sponsorSetup(); // no redis → per-replica fallback
    const cap = verifiedCapability();
    await controller.impression('sp1', cap, '1', { gameId: GAME });
    await expect(
      controller.impression('sp1', cap, '1', { gameId: GAME }),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
  });

  it('SPORTS_BEACON_REQUIRE_VERIFIED=1 refuses an anonymous beacon entirely', async () => {
    process.env.SPORTS_BEACON_REQUIRE_VERIFIED = '1';
    const { controller, sponsorImpression } = sponsorSetup(makeSharedRedis());

    await expect(
      controller.impression('sp1', undefined, undefined, { gameId: GAME }),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });

    // …and an UNVERIFIED capability is not a way around it.
    const anon = mintBeaconCapability({ gameId: GAME, scope: 'impression' }).capability;
    await expect(
      controller.impression('sp1', anon, '1', { gameId: GAME }),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });

    await flush();
    expect(sponsorImpression.rows).toHaveLength(0);

    // A device-bound one still works.
    expect(await controller.impression('sp1', verifiedCapability(), '1', { gameId: GAME })).toEqual({
      ok: true,
      verified: true,
      provenance: 'device-verified',
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('gameReport — verified vs unverified evidence', () => {
  it('splits the counts and never presents anonymous rows as proof', async () => {
    const redis = makeSharedRedis();
    const { controller, service, game } = sponsorSetup(redis);
    // Make the game FINAL so the report has a duration.
    game.rows[0].status = 'FINAL';
    game.rows[0].startedAt = new Date(Date.now() - 3_600_000);
    game.rows[0].endedAt = new Date();
    game.rows[0].updatedAt = new Date();

    const cap = verifiedCapability();
    await controller.impression('sp1', cap, '1', { gameId: GAME });
    await controller.impression('sp1', cap, '2', { gameId: GAME });
    await controller.impression('sp1', undefined, undefined, { gameId: GAME }); // anonymous
    await flush();

    const report = await service.gameReport(TENANT, GAME);
    expect(report).not.toBeNull();
    const row = report!.sponsors.find((s) => s.sponsorId === 'sp1')!;
    expect(row.total).toBe(3);
    expect(row.verified).toBe(2);
    expect(row.unverified).toBe(1);
    expect(report!.evidence).toMatchObject({ verified: 2, unverified: 1, total: 3 });
    expect(report!.evidence.note).toContain('not proof of play');
  });

  it('grades a pre-SEC-007 game as entirely unverified without touching its rows', async () => {
    const { service, game, sponsorImpression } = sponsorSetup();
    game.rows[0].status = 'FINAL';
    game.rows[0].startedAt = new Date(Date.now() - 3_600_000);
    game.rows[0].endedAt = new Date();
    game.rows[0].updatedAt = new Date();
    // Historical rows: no attestation exists for any of them.
    sponsorImpression.rows.push(
      { id: 'i1', sponsorId: 'sp1', gameId: GAME, surfaceKind: 'board' },
      { id: 'i2', sponsorId: 'sp1', gameId: GAME, surfaceKind: 'ribbon' },
    );

    const report = await service.gameReport(TENANT, GAME);
    expect(report!.evidence).toMatchObject({ verified: 0, unverified: 2, total: 2 });
    // The data is intact — we relabel the evidence, we never delete rows.
    expect(sponsorImpression.rows).toHaveLength(2);
  });

  // 2026-09-04 — `SponsorImpression.verified` is a REAL COLUMN now
  // (`20260904130000_sponsor_impression_verified`), so the report counts the
  // impression rows themselves instead of joining the `GameEvent`
  // attestations. Two consequences, both pinned here.
  it('counts the ROW column, so stray attestation rows cannot inflate the evidence', async () => {
    const { service, game, sponsorImpression, gameEvent } = sponsorSetup();
    game.rows[0].status = 'FINAL';
    game.rows[0].startedAt = new Date(Date.now() - 3_600_000);
    game.rows[0].endedAt = new Date();
    game.rows[0].updatedAt = new Date();
    sponsorImpression.rows.push({
      id: 'i1', sponsorId: 'sp1', gameId: GAME, surfaceKind: 'board', verified: false,
    });
    // Two attestations against ONE unverified impression — the exact
    // partial-write skew the old join had to clamp. It cannot reach the
    // number any more.
    gameEvent.rows.push(
      { id: 'e1', gameId: GAME, type: SPONSOR_IMPRESSION_ATTESTED, payload: { sponsorId: 'sp1' } },
      { id: 'e2', gameId: GAME, type: SPONSOR_IMPRESSION_ATTESTED, payload: { sponsorId: 'sp1' } },
    );

    const report = await service.gameReport(TENANT, GAME);
    const row = report!.sponsors.find((s) => s.sponsorId === 'sp1')!;
    expect(row.verified).toBe(0);
    expect(row.unverified).toBe(1);
  });

  it('a verified beacon writes verified=true AND the attributed screen onto the row', async () => {
    const { controller, sponsorImpression } = sponsorSetup(makeSharedRedis());
    await controller.impression('sp1', verifiedCapability(), '1', { gameId: GAME });
    await flush();
    expect(sponsorImpression.rows[0]).toMatchObject({
      sponsorId: 'sp1',
      verified: true,
      screenId: SCREEN,
    });
  });

  it('an anonymous beacon writes verified=false and NO screen attribution', async () => {
    const { controller, sponsorImpression } = sponsorSetup();
    await controller.impression('sp1', undefined, undefined, { gameId: GAME });
    await flush();
    expect(sponsorImpression.rows[0]).toMatchObject({ verified: false, screenId: null });
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('cts-cue-fired beacon', () => {
  function boardSetup(redis: BeaconReplayRedis) {
    const recordCueFired = jest.fn().mockResolvedValue(undefined);
    const game = makeTable();
    game.rows.push({ id: GAME, tenantId: TENANT });
    const screen = makeTable();
    screen.rows.push(liveScreenRow());
    const prisma = { client: { game, screen } };
    const controller = new SportsBoardController(
      { recordCueFired } as never,
      { publisher: redis } as never,
      prisma as never,
    );
    return { controller, recordCueFired, game, screen };
  }

  it('records an anonymous cue as unverified', async () => {
    const { controller, recordCueFired } = boardSetup(makeSharedRedis());
    const res = await controller.ctsCueFired(GAME, undefined, undefined, { cueId: 'CEL_GOAL' });
    expect(res).toEqual({ ok: true, verified: false, provenance: 'anonymous' });
    expect(recordCueFired).toHaveBeenCalledWith(
      GAME,
      expect.objectContaining({ cueId: 'CEL_GOAL' }),
      expect.objectContaining({ verified: false }),
    );
  });

  it('records a device-bound cue as verified and attributes the screen', async () => {
    const { controller, recordCueFired } = boardSetup(makeSharedRedis());
    const res = await controller.ctsCueFired(GAME, verifiedCapability('cue'), '1', { cueId: 'CEL_GOAL' });
    expect(res).toEqual({ ok: true, verified: true, provenance: 'device-verified' });
    expect(recordCueFired).toHaveBeenCalledWith(
      GAME,
      expect.anything(),
      expect.objectContaining({ verified: true, screenId: SCREEN, seq: 1 }),
    );
  });

  it('REJECTS a replayed cue beacon across replicas and writes nothing', async () => {
    const redis = makeSharedRedis();
    const a = boardSetup(redis);
    const b = boardSetup(redis);
    const cap = verifiedCapability('cue');

    await a.controller.ctsCueFired(GAME, cap, '1', { cueId: 'CEL_GOAL' });
    expect(a.recordCueFired).toHaveBeenCalledTimes(1);

    await expect(
      b.controller.ctsCueFired(GAME, cap, '1', { cueId: 'CEL_GOAL' }),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    expect(b.recordCueFired).not.toHaveBeenCalled();
  });

  it('REJECTS a cue capability minted for another game', async () => {
    const { controller, recordCueFired } = boardSetup(makeSharedRedis());
    const cap = mintBeaconCapability({ gameId: 'someone-elses-game', scope: 'cue', screenId: SCREEN }).capability;
    await expect(
      controller.ctsCueFired(GAME, cap, '1', { cueId: 'CEL_GOAL' }),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    expect(recordCueFired).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('beacon-capability mint endpoint', () => {
  function mintSetup(deviceAuth?: { tenantId: string | null; credentialEpoch: number }) {
    const game = makeTable();
    game.rows.push({ id: GAME, tenantId: TENANT });
    const screen = makeTable();
    if (deviceAuth) {
      screen.rows.push({
        id: SCREEN,
        tenantId: deviceAuth.tenantId,
        screenGroupId: null,
        status: 'ONLINE',
        credentialEpoch: deviceAuth.credentialEpoch,
        credentialEpochRotatedAt: null,
      });
    }
    const prisma = { client: { game, screen } };
    const redis = makeSharedRedis();
    const controller = new SportsBoardController(
      { recordCueFired: jest.fn() } as never,
      { publisher: redis } as never,
      prisma as never,
    );
    return { controller };
  }

  it('mints an UNVERIFIED capability for a caller with no credential', async () => {
    const { controller } = mintSetup();
    const res = await controller.beaconCapability(GAME, { headers: {} } as never);
    expect(res.verified).toBe(false);
    expect(verifyBeaconCapability(res.impression, { gameId: GAME, scope: 'impression' }).ok).toBe(true);
    expect(verifyBeaconCapability(res.cue, { gameId: GAME, scope: 'cue' }).ok).toBe(true);
    // The two capabilities are scope-locked to their own endpoint.
    expect(verifyBeaconCapability(res.impression, { gameId: GAME, scope: 'cue' }).ok).toBe(false);
  });

  it('404s for an unknown game rather than minting a capability for it', async () => {
    const { controller } = mintSetup();
    await expect(
      controller.beaconCapability('no-such-game', { headers: {} } as never),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
  });

  it('REFUSES a bearer it cannot verify — never silently downgrades to anonymous', async () => {
    const { controller } = mintSetup({ tenantId: TENANT, credentialEpoch: 0 });
    await expect(
      controller.beaconCapability(GAME, {
        headers: { authorization: 'Bearer not-a-real-jwt' },
      } as never),
    ).rejects.toBeInstanceOf(HttpException);
  });

  /**
   * The VERIFIED path, driven with a real device JWT through the real
   * `verifyDeviceForScreen`. Without this the whole verified lane would be
   * untested code that nothing reaches.
   */
  describe('with a real device credential', () => {
    function deviceToken(claims: { sub?: string; kind?: string; ep?: number } = {}) {
      return jwt.sign(
        { sub: SCREEN, kind: 'device', ep: 4, ...claims },
        process.env.DEVICE_JWT_SECRET as string,
        { algorithm: 'HS256', expiresIn: '1h' },
      );
    }
    const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });

    beforeEach(() => {
      process.env.DEVICE_JWT_SECRET = 'test_device_jwt_secret_that_is_long_enough';
      // The credential snapshot is process-cached for 5s — clear it so each
      // case sees its own seeded screen row.
      invalidateDeviceCredentialCache();
    });

    it('mints a VERIFIED capability bound to the screen', async () => {
      const { controller } = mintSetup({ tenantId: TENANT, credentialEpoch: 4 });
      const res = await controller.beaconCapability(GAME, bearer(deviceToken()) as never);

      expect(res.verified).toBe(true);
      const v = verifyBeaconCapability(res.impression, { gameId: GAME, scope: 'impression' });
      expect(v.ok).toBe(true);
      if (!v.ok) throw new Error('unreachable');
      expect(v.claims.s).toBe(SCREEN);
      expect(v.claims.e).toBe(4);
      // SEC-007 residual #2 — the game's tenant is bound in, so a screen
      // re-paired elsewhere inside the epoch grace stops attesting here. If
      // this claim ever goes missing, the beacon-time tenant check silently
      // becomes a no-op, so it is asserted at the mint, not only at the check.
      expect(v.claims.t).toBe(TENANT);
    });

    it('REFUSES a screen paired into a DIFFERENT tenant than the game', async () => {
      const { controller } = mintSetup({ tenantId: OTHER_TENANT, credentialEpoch: 4 });
      await expect(
        controller.beaconCapability(GAME, bearer(deviceToken()) as never),
      ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    });

    it('REFUSES a token whose credential epoch is stale (revoked credential)', async () => {
      const { controller } = mintSetup({ tenantId: TENANT, credentialEpoch: 9 });
      await expect(
        controller.beaconCapability(GAME, bearer(deviceToken({ ep: 4 })) as never),
      ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    });

    it('REFUSES a screen with no row at all', async () => {
      const { controller } = mintSetup(); // no screen seeded
      await expect(
        controller.beaconCapability(GAME, bearer(deviceToken()) as never),
      ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    });

    it('REFUSES a non-device token (an operator session is not a screen)', async () => {
      const { controller } = mintSetup({ tenantId: TENANT, credentialEpoch: 4 });
      await expect(
        controller.beaconCapability(GAME, bearer(deviceToken({ kind: 'user' })) as never),
      ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────
/**
 * SEC-007 RE-AUDIT (2026-09-04) — the ways a cryptographically valid
 * capability still fails to be evidence.
 *
 * The re-audit's finding was not that the crypto was wrong; it was that
 * `verified: true` was being written in situations where nothing had actually
 * been verified:
 *
 *   • the screen was revoked AFTER the capability was minted — the whole point
 *     of binding a screen is that revoking it kills its beacons, and that was
 *     true at mint time and nowhere else;
 *   • the live screen row could not be read at all, so nothing was checked;
 *   • Redis was unreachable, so "this beacon is single-use" was only ever
 *     established inside one process.
 */
describe('SEC-007 re-audit — a valid capability is not automatically evidence', () => {
  it('REFUSES a beacon whose screen was REVOKED after the capability was minted', async () => {
    const { controller, sponsorImpression, screen } = sponsorSetup(makeSharedRedis());
    const cap = verifiedCapability();

    // Mint-time state was fine; the operator revokes the screen mid-game.
    screen.rows[0].status = 'REVOKED';
    invalidateDeviceCredentialCache();

    await expect(
      controller.impression('sp1', cap, '1', { gameId: GAME }),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    await flush();
    // Not quietly downgraded to an anonymous count either — nothing is written.
    expect(sponsorImpression.rows).toHaveLength(0);
  });

  it('REFUSES a beacon whose screen ROTATED its epoch past the capability', async () => {
    const { controller, sponsorImpression, screen } = sponsorSetup(makeSharedRedis());
    const cap = verifiedCapability(); // minted at epoch 3
    // Two rotations: epoch 5 leaves 3 outside even the one-back grace window.
    screen.rows[0].credentialEpoch = 5;
    screen.rows[0].credentialEpochRotatedAt = new Date();
    invalidateDeviceCredentialCache();

    await expect(
      controller.impression('sp1', cap, '1', { gameId: GAME }),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    await flush();
    expect(sponsorImpression.rows).toHaveLength(0);
  });

  it('ACCEPTS the immediately-previous epoch inside the rotation grace window', async () => {
    // A screen rotating its credential mid-game must not have its beacons
    // refused — that would be a self-inflicted outage on the reporting path.
    const { controller, screen } = sponsorSetup(makeSharedRedis());
    const cap = verifiedCapability(); // epoch 3
    screen.rows[0].credentialEpoch = 4;
    screen.rows[0].credentialEpochRotatedAt = new Date();
    invalidateDeviceCredentialCache();

    expect(await controller.impression('sp1', cap, '1', { gameId: GAME })).toEqual({
      ok: true,
      verified: true,
      provenance: 'device-verified',
    });
  });

  it('REFUSES a beacon from a screen that was UNPAIRED mid-capability', async () => {
    // Unpairing rotates the epoch by exactly one, so the one-back rotation
    // grace would otherwise keep honouring a disowned screen for 24 hours.
    // Mint refuses an unpaired screen (`allowUnpaired: false`); so does this.
    const { controller, screen } = sponsorSetup(makeSharedRedis());
    const cap = verifiedCapability();
    screen.rows[0].tenantId = null;
    screen.rows[0].status = 'PENDING';
    screen.rows[0].credentialEpoch = 4;
    screen.rows[0].credentialEpochRotatedAt = new Date();
    invalidateDeviceCredentialCache();

    await expect(
      controller.impression('sp1', cap, '1', { gameId: GAME }),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
  });

  it('REFUSES a beacon whose screen row was DELETED', async () => {
    const { controller, screen } = sponsorSetup(makeSharedRedis());
    const cap = verifiedCapability();
    screen.rows.length = 0;
    invalidateDeviceCredentialCache();

    await expect(
      controller.impression('sp1', cap, '1', { gameId: GAME }),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
  });

  it('DOWNGRADES when the screen row cannot be READ — not refused, not claimed', async () => {
    const { controller, sponsorImpression, screen } = sponsorSetup(makeSharedRedis());
    const cap = verifiedCapability();
    // Postgres is unreachable. Indeterminate — never "fine", and never a
    // refusal that would zero a venue's reporting during a database blip.
    screen.findUnique = async () => {
      throw new Error('pool timeout');
    };
    invalidateDeviceCredentialCache();

    expect(await controller.impression('sp1', cap, '1', { gameId: GAME })).toEqual({
      ok: true,
      verified: false,
      provenance: 'screen-state-unknown',
    });
    await flush();
    // The count is kept — and recorded honestly as NOT evidence.
    expect(sponsorImpression.rows).toHaveLength(1);
    expect(sponsorImpression.rows[0]).toMatchObject({ verified: false, screenId: null });
  });

  it('DOWNGRADES when replay could only be claimed in process memory', async () => {
    // No Redis at all → the claim lands in the per-replica fallback, which
    // cannot see the same beacon fired at another pod. "Single-use" is exactly
    // the property that makes a count proof, so the row must not claim it.
    const { controller, sponsorImpression } = sponsorSetup();
    expect(await controller.impression('sp1', verifiedCapability(), '1', { gameId: GAME })).toEqual({
      ok: true,
      verified: false,
      provenance: 'replay-memory-only',
    });
    await flush();
    expect(sponsorImpression.rows).toHaveLength(1);
    expect(sponsorImpression.rows[0]).toMatchObject({ verified: false, screenId: null });
  });

  it('the SAME capability grades verified once shared replay state is available', async () => {
    // Proves the downgrade above is about the replay STORE, not the capability.
    const { controller } = sponsorSetup(makeSharedRedis());
    expect(await controller.impression('sp1', verifiedCapability(), '1', { gameId: GAME })).toEqual({
      ok: true,
      verified: true,
      provenance: 'device-verified',
    });
  });

  it('a Redis that ERRORS mid-flight downgrades rather than claiming verified', async () => {
    const broken: BeaconReplayRedis = {
      status: 'ready',
      async set() {
        throw new Error('READONLY You cannot write against a read only replica');
      },
    };
    const { controller } = sponsorSetup(broken);
    expect(await controller.impression('sp1', verifiedCapability(), '1', { gameId: GAME })).toEqual({
      ok: true,
      verified: false,
      provenance: 'replay-memory-only',
    });
  });

  it('strict mode REFUSES both downgrade situations instead of recording them', async () => {
    process.env.SPORTS_BEACON_REQUIRE_VERIFIED = '1';

    // (1) replay state unshared.
    const noRedis = sponsorSetup();
    await expect(
      noRedis.controller.impression('sp1', verifiedCapability(), '1', { gameId: GAME }),
    ).rejects.toMatchObject({ status: HttpStatus.SERVICE_UNAVAILABLE });
    await flush();
    expect(noRedis.sponsorImpression.rows).toHaveLength(0);

    // (2) screen state unreadable.
    const unreadable = sponsorSetup(makeSharedRedis());
    unreadable.screen.findUnique = async () => {
      throw new Error('pool timeout');
    };
    invalidateDeviceCredentialCache();
    await expect(
      unreadable.controller.impression('sp1', verifiedCapability(), '1', { gameId: GAME }),
    ).rejects.toMatchObject({ status: HttpStatus.SERVICE_UNAVAILABLE });
    await flush();
    expect(unreadable.sponsorImpression.rows).toHaveLength(0);
  });

  it('a downgraded beacon never becomes evidence: gameReport counts it unverified', async () => {
    const { controller, service, game } = sponsorSetup(); // no Redis → downgrade
    game.rows[0].status = 'FINAL';
    game.rows[0].startedAt = new Date(Date.now() - 3_600_000);
    game.rows[0].endedAt = new Date();
    game.rows[0].updatedAt = new Date();

    const cap = verifiedCapability();
    await controller.impression('sp1', cap, '1', { gameId: GAME });
    await controller.impression('sp1', cap, '2', { gameId: GAME });
    await flush();

    const report = await service.gameReport(TENANT, GAME);
    expect(report!.evidence).toMatchObject({
      verified: 0,
      unverified: 2,
      total: 2,
      basis: 'verified',
    });
    expect(report!.evidence.note).toContain('not proof of play');
  });

  it('the cue endpoint runs the same live re-check', async () => {
    const recordCueFired = jest.fn().mockResolvedValue(undefined);
    const game = makeTable();
    game.rows.push({ id: GAME, tenantId: TENANT });
    const screen = makeTable();
    screen.rows.push(liveScreenRow({ status: 'REVOKED' }));
    const controller = new SportsBoardController(
      { recordCueFired } as never,
      { publisher: makeSharedRedis() } as never,
      { client: { game, screen } } as never,
    );
    invalidateDeviceCredentialCache();

    await expect(
      controller.ctsCueFired(GAME, verifiedCapability('cue'), '1', { cueId: 'CEL_GOAL' }),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    expect(recordCueFired).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
/**
 * SEC-007 residual #2 (2026-09-05) — CROSS-TENANT RE-PAIR inside the epoch
 * grace.
 *
 * Re-pairing a screen to a DIFFERENT tenant rotates its credential epoch by
 * exactly one, which lands inside the 24-hour one-back rotation grace. Before
 * this, that screen's still-live capability kept grading `device-verified` for
 * the ORIGINAL tenant's game for the rest of its 30-minute life. No count could
 * cross tenants — `recordImpression` enforces sponsor.tenant === game.tenant,
 * and the capability is bound to one game — but the attributed screen id on
 * those rows named a screen that had already moved to someone else, and "which
 * screen proved this" is the entire content of the verified lane.
 *
 * The fix binds the game's tenant into the capability at mint and compares it
 * to `tenantId` on the screen row the live re-check ALREADY reads — so it
 * closes with zero additional round trips on a hot public path.
 */
describe('SEC-007 residual #2 — a screen re-paired to another tenant stops attesting', () => {
  it('REFUSES a beacon whose screen now belongs to a DIFFERENT tenant', async () => {
    const { controller, sponsorImpression, screen } = sponsorSetup(makeSharedRedis());
    const cap = verifiedCapability(); // minted for TENANT at epoch 3

    // The screen is re-paired to somebody else. Unpair+pair rotates the epoch
    // by one each time; even a single rotation lands INSIDE the grace window,
    // which is exactly why the epoch check alone did not catch this.
    screen.rows[0].tenantId = OTHER_TENANT;
    screen.rows[0].credentialEpoch = 4;
    screen.rows[0].credentialEpochRotatedAt = new Date();
    invalidateDeviceCredentialCache();

    await expect(
      controller.impression('sp1', cap, '1', { gameId: GAME }),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    await flush();
    expect(sponsorImpression.rows).toHaveLength(0);
  });

  it('still ACCEPTS the same screen re-pairing INSIDE its own tenant', async () => {
    // The grace window exists so a mid-game re-pair is not a reporting outage.
    // Narrowing to cross-tenant must not take that away.
    const { controller, screen } = sponsorSetup(makeSharedRedis());
    const cap = verifiedCapability();
    screen.rows[0].credentialEpoch = 4;
    screen.rows[0].credentialEpochRotatedAt = new Date();
    invalidateDeviceCredentialCache();

    expect(await controller.impression('sp1', cap, '1', { gameId: GAME })).toEqual({
      ok: true,
      verified: true,
      provenance: 'device-verified',
    });
  });

  it('an anonymous capability carries NO tenant claim (there is nothing to bind)', () => {
    const anon = mintBeaconCapability({
      gameId: GAME,
      scope: 'impression',
      tenantId: TENANT,
    }).capability;
    const verdict = verifyBeaconCapability(anon, { gameId: GAME, scope: 'impression' });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.claims.t).toBeUndefined();
    expect(verdict.verified).toBe(false);
  });

  it('a capability minted BEFORE the binding keeps working — a rolling deploy is not an outage', async () => {
    // In-flight capabilities live 30 minutes. Refusing the ones without a
    // tenant claim would zero a venue's verified lane for half an hour every
    // time we deploy, which is a worse outcome than the narrow window it
    // closes. They are checked exactly as they were before.
    const { controller } = sponsorSetup(makeSharedRedis());
    expect(await controller.impression('sp1', legacyCapability(), '1', { gameId: GAME })).toEqual({
      ok: true,
      verified: true,
      provenance: 'device-verified',
    });
  });

  it('the cue endpoint enforces the same tenant binding', async () => {
    const recordCueFired = jest.fn().mockResolvedValue(undefined);
    const game = makeTable();
    game.rows.push({ id: GAME, tenantId: TENANT });
    const screen = makeTable();
    screen.rows.push(liveScreenRow({ tenantId: OTHER_TENANT, credentialEpoch: 4, credentialEpochRotatedAt: new Date() }));
    const controller = new SportsBoardController(
      { recordCueFired } as never,
      { publisher: makeSharedRedis() } as never,
      { client: { game, screen } } as never,
    );
    invalidateDeviceCredentialCache();

    await expect(
      controller.ctsCueFired(GAME, verifiedCapability('cue'), '1', { cueId: 'CEL_GOAL' }),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    expect(recordCueFired).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('SEC-007 re-audit — resolveBeaconAttestation with no screen checker', () => {
  it('keeps the pre-re-audit behaviour when no checker is injected', async () => {
    // Not an endorsement — a documented, deliberate absence. A caller that
    // supplies no checker gets exactly what it got before this wave and never
    // a stronger claim, so a wiring gap can never UPGRADE a beacon's grade.
    const res = await resolveBeaconAttestation(
      makeSharedRedis(),
      { capability: verifiedCapability(), seq: 1 },
      { gameId: GAME, scope: 'impression' },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.attestation).toMatchObject({ verified: true, provenance: 'device-verified' });
  });

  it('an anonymous capability never reaches the screen checker', async () => {
    const anon = mintBeaconCapability({ gameId: GAME, scope: 'impression' }).capability;
    const screenCheck = jest.fn();
    const res = await resolveBeaconAttestation(
      makeSharedRedis(),
      { capability: anon, seq: 1 },
      { gameId: GAME, scope: 'impression' },
      { screenCheck: screenCheck as never },
    );
    expect(screenCheck).not.toHaveBeenCalled();
    expect(res.ok && res.attestation.provenance).toBe('anonymous');
  });
});
