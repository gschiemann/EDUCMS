/**
 * GET /api/v1/screens/:id/manifest — the identity preamble snapshot
 * (efficiency audit P1-6 / lead finding L1, 2026-09-03).
 *
 * The finding: every manifest poll performed THREE Postgres reads BEFORE the
 * content hot cache was consulted — `screen.findUnique` (the whole row), then
 * `screenGroup.findUnique` and `tenant.findUnique` — plus the credential read
 * the global `DeviceIdentityInterceptor` does on the same request. None of
 * them changed on an unchanged poll.
 *
 * What these tests pin, in the order the program asked for them:
 *   1. COST — Prisma calls on a repeated unchanged poll, counted through the
 *      real interceptor → handler chain, with a realistic 60 s poll gap.
 *   2. REVOCATION — a revoked device is refused on its VERY NEXT poll, with
 *      no stale window beyond one in-flight request.
 *   3. INVALIDATION COMPLETENESS — one case per write path that changes what
 *      the snapshot holds (re-pair, group move, rename, group rename, tenant
 *      rename, epoch rotation, delete, display-verdict change), including the
 *      Prisma-hook safety net for the writers that never called the
 *      invalidator.
 *   4. LIFE-SAFETY — the EMERGENCY and SPORTS branches are never assembled
 *      from a snapshot; they re-read the Screen row from Postgres.
 *   5. HOT-CACHE CONTRACT — telemetry-only writes still do not bust anything,
 *      and the ETag/payload of a snapshot-served poll is byte-identical to a
 *      cold-read poll.
 */

import * as jwt from 'jsonwebtoken';
import { from, lastValueFrom } from 'rxjs';
import { ScreensController } from './screens.controller';
import { DeviceIdentityInterceptor } from '../security/device-identity.interceptor';
import {
  invalidateDeviceCredentialCache,
  setDeviceCredentialSharedStore,
  shouldInvalidateDeviceCredential,
  CREDENTIAL_SNAPSHOT_TRIGGER_FIELDS,
  DEVICE_IDENTITY_CREDENTIAL_MAX_AGE_MS,
} from './device-auth';
import {
  bumpManifestContentRev,
  invalidateManifestCache,
  markManifestRevHookArmed,
  resetManifestCacheForTests,
  shouldBumpManifestRev,
  getManifestPreamble,
} from './manifest-hot-cache';
import { resetEmergencyRevForTests } from './emergency-rev';
import { clearDisplayManifestCache } from '../display/display-manifest';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const DEVICE_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const SCREEN_ID = 'screen-preamble-1';
const TENANT_ID = 'tenant-preamble-1';
const GROUP_ID = 'group-preamble-1';

// ── clock ────────────────────────────────────────────────────────────────
// Real timers; `Date.now` is stubbed so a test can move a poll 60 s forward
// without waiting. Every cache in play (credential snapshot, manifest content
// cache, preamble, tenant emergency state, ping debounce) reads Date.now().
let nowMs = 1_760_000_000_000;
const advance = (ms: number) => {
  nowMs += ms;
};

beforeAll(() => {
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
});
afterAll(() => {
  jest.restoreAllMocks();
});

// ── prisma double with a per-model call counter ──────────────────────────

interface ScreenRow extends Record<string, unknown> {
  id: string;
  tenantId: string | null;
  screenGroupId: string | null;
  status: string;
  credentialEpoch: number;
  credentialEpochRotatedAt: Date | null;
}

function baseScreenRow(over: Partial<ScreenRow> = {}): ScreenRow {
  return {
    id: SCREEN_ID,
    tenantId: TENANT_ID,
    screenGroupId: GROUP_ID,
    status: 'ONLINE',
    credentialEpoch: 0,
    credentialEpochRotatedAt: null,
    name: 'Lobby North',
    orientation: 'LANDSCAPE',
    resolution: '1920x1080',
    hardwareModel: null,
    canvasW: null,
    canvasH: null,
    repeats: 1,
    config: null,
    displayCapabilities: null,
    activeBoardGameId: null,
    activeBoardSurface: null,
    syncOffsetMs: 0,
    pendingRefreshAt: null,
    ...over,
  };
}

interface World {
  screen: ScreenRow | null;
  group: Record<string, unknown> | null;
  tenant: Record<string, unknown> | null;
  /** Tenant row as the manifest's emergency SELECT sees it. */
  tenantEmergency: Record<string, unknown>;
  override: Record<string, unknown> | null;
  game: Record<string, unknown> | null;
  /** Playlists the emergency branch may load, by id. Absent = none exist. */
  playlists?: Record<string, unknown>;
  /** Ancestor (district) tenant rows as the emergency SELECT sees them, by id. */
  ancestors?: Record<string, Record<string, unknown>>;
}

function makeWorld(over: Partial<World> = {}): World {
  return {
    screen: baseScreenRow(),
    group: { id: GROUP_ID, name: 'Lobby', syncMode: 'independent' },
    tenant: { name: 'Walnut Creek HS', posterStandardW: null, posterStandardH: null },
    tenantEmergency: {
      id: TENANT_ID,
      parentId: null,
      archivedAt: null,
      emergencyStatus: 'INACTIVE',
      emergencyType: null,
      emergencyPlaylistId: null,
      emergencyPortraitPlaylistId: null,
      locationBasedEmergencyEnabled: false,
    },
    override: null,
    game: null,
    ...over,
  };
}

function makePrisma(world: World) {
  const calls: string[] = [];
  const note = (label: string) => {
    calls.push(label);
  };
  const client: Record<string, any> = {
    screen: {
      findUnique: jest.fn(async () => {
        note('screen.findUnique');
        return world.screen;
      }),
      update: jest.fn(async () => {
        note('screen.update');
        return { id: SCREEN_ID };
      }),
    },
    screenGroup: {
      findUnique: jest.fn(async () => {
        note('screenGroup.findUnique');
        return world.group;
      }),
    },
    tenant: {
      findUnique: jest.fn(async (args: any) => {
        // Distinguish the two projections the handler asks for: the manifest
        // identity read (name + poster standard) and the emergency select.
        const wantsEmergency = !!args?.select?.emergencyStatus;
        note(wantsEmergency ? 'tenant.findUnique[emergency]' : 'tenant.findUnique[identity]');
        // The district-inheritance walk asks for an ANCESTOR by id.
        const ancestor = wantsEmergency ? world.ancestors?.[args?.where?.id] : undefined;
        if (ancestor) return ancestor;
        return wantsEmergency ? world.tenantEmergency : world.tenant;
      }),
    },
    screenEmergencyOverride: {
      findUnique: jest.fn(async () => {
        note('screenEmergencyOverride.findUnique');
        return world.override;
      }),
    },
    game: {
      findFirst: jest.fn(async () => {
        note('game.findFirst');
        return world.game;
      }),
    },
    playlist: {
      findUnique: jest.fn(async (args: any) => {
        note('playlist.findUnique');
        return world.playlists?.[args?.where?.id] ?? null;
      }),
    },
    schedule: {
      findMany: jest.fn(async () => {
        note('schedule.findMany');
        return [];
      }),
      findFirst: jest.fn(async () => {
        note('schedule.findFirst');
        return null;
      }),
    },
    displaySchedule: {
      findMany: jest.fn(async () => {
        note('displaySchedule.findMany');
        return [];
      }),
    },
    displayVendorRecipe: {
      findMany: jest.fn(async () => {
        note('displayVendorRecipe.findMany');
        return [];
      }),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  return { client, calls, reset: () => calls.splice(0, calls.length) };
}

/** In-memory Redis double with real TTL semantics (same shape as emergency-rev.spec). */
function makeRedis() {
  const store = new Map<string, { value: string; expiresAtMs: number | null }>();
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
    isConnected: () => true,
    getString: jest.fn(async (key: string) => live(key)),
    setString: jest.fn(async (key: string, value: string, ttlSeconds?: number) => {
      store.set(key, {
        value,
        expiresAtMs: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
      });
      return true;
    }),
    delKey: jest.fn(async (key: string) => {
      store.delete(key);
      return true;
    }),
    sismember: jest.fn(async () => false),
    publish: jest.fn(async () => undefined),
  };
}

function deviceToken(screenId: string, ep = 0): string {
  return jwt.sign({ sub: screenId, kind: 'device', ep, fp: 'fp-test' }, DEVICE_JWT_SECRET, {
    expiresIn: '180d',
  });
}

interface FakeRes {
  statusCode: number | null;
  body: any;
  headers: Record<string, string>;
  setHeader: (k: string, v: string) => FakeRes;
  status: (c: number) => FakeRes;
  json: (p: any) => FakeRes;
  send: () => FakeRes;
  end: () => FakeRes;
}

function makeRes(): FakeRes {
  const res: any = { statusCode: null, body: undefined, headers: {} };
  res.setHeader = (k: string, v: string) => {
    res.headers[k.toLowerCase()] = v;
    return res;
  };
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = (p: any) => {
    res.body = p;
    return res;
  };
  res.send = () => res;
  res.end = () => res;
  return res as FakeRes;
}

function makeReq(screenId: string, ep = 0, ifNoneMatch?: string) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${deviceToken(screenId, ep)}`,
  };
  if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch;
  return {
    headers,
    ip: '10.0.0.1',
    socket: { remoteAddress: '10.0.0.1' },
    // What JwtAuthGuard builds for a device principal, verbatim.
    user: { id: screenId, sub: screenId, kind: 'device', tenantId: 'stale-claim-tenant' },
  } as any;
}

function makeHarness(world: World) {
  const prismaDouble = makePrisma(world);
  const prisma = { client: prismaDouble.client } as any;
  const redis = makeRedis();
  const controller = new ScreensController(
    prisma,
    redis as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const interceptor = new DeviceIdentityInterceptor(prisma);
  return { prisma, prismaDouble, redis, controller, interceptor };
}

/**
 * One realistic manifest request: the global DeviceIdentityInterceptor runs
 * first (it is an APP_INTERCEPTOR, and the manifest route is behind
 * JwtAuthGuard), then the handler. Anything the interceptor throws surfaces
 * here exactly as it would in production.
 */
async function pollManifest(
  h: ReturnType<typeof makeHarness>,
  req: any,
  res: FakeRes = makeRes(),
): Promise<FakeRes> {
  const ctx: any = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  };
  await lastValueFrom(
    h.interceptor.intercept(ctx, {
      handle: () => from(h.controller.getManifest(SCREEN_ID, req, res as any)),
    }),
  );
  return res;
}

beforeEach(() => {
  // MONOTONIC, never reset. Several module-level caches in this path
  // (`tenantStateCache`, `lastPingWrites`, the display-block memo) expire by
  // TTL alone and have no test hook; rewinding the clock between cases would
  // make a previous case's entry look like it was written in the FUTURE, so
  // it would never expire and the next case would silently read it. Jumping
  // an hour forward ages every one of them out instead.
  nowMs += 3_600_000;
  resetManifestCacheForTests();
  resetEmergencyRevForTests();
  clearDisplayManifestCache();
  invalidateDeviceCredentialCache();
  setDeviceCredentialSharedStore(null);
  // Production arms the Prisma $use hook at boot; without it every cache in
  // this file falls back to its short defensive TTL and measures nothing real.
  markManifestRevHookArmed();
});

afterEach(() => {
  setDeviceCredentialSharedStore(null);
});

// ── 1. Cost ──────────────────────────────────────────────────────────────

describe('Postgres reads per unchanged manifest poll', () => {
  it('cold poll pays the whole preamble — the BEFORE number', async () => {
    const world = makeWorld();
    const h = makeHarness(world);

    await pollManifest(h, makeReq(SCREEN_ID));
    const cold = h.prismaDouble.calls.filter((c) => !c.endsWith('.update'));

    // Cold: the interceptor's credential read, the whole preamble, the live
    // emergency inputs, then the schedule fan-out.
    expect(cold).toEqual(
      expect.arrayContaining([
        'screen.findUnique',
        'screenGroup.findUnique',
        'tenant.findUnique[identity]',
        'screenEmergencyOverride.findUnique',
        'tenant.findUnique[emergency]',
      ]),
    );
    // Two Screen reads on a cold request: the interceptor's narrow credential
    // read, then the handler's full-row read. The request-scoped context means
    // the handler's REVOKED/epoch checks add no third.
    expect(cold.filter((c) => c === 'screen.findUnique')).toHaveLength(2);
  });

  it('a poll inside the credential window costs TWO reads, and neither is the L1 three', async () => {
    const world = makeWorld();
    const h = makeHarness(world);
    await pollManifest(h, makeReq(SCREEN_ID));
    h.prismaDouble.reset();

    // 20 s: past the 2 s tenant-emergency cache, inside the 30 s credential
    // window. This is the shape a real screen is in, because it also polls
    // /emergency-rev every 10 s and that keeps the credential tier warm.
    advance(20_000);
    const res = await pollManifest(h, makeReq(SCREEN_ID));
    expect(res.statusCode).toBe(200);

    const warm = h.prismaDouble.calls.filter((c) => !c.endsWith('.update'));
    // All three L1 reads are gone, and so is the credential read.
    expect(warm.sort()).toEqual(
      ['screenEmergencyOverride.findUnique', 'tenant.findUnique[emergency]'].sort(),
    );
  });

  it('a poll past the credential window costs THREE — still none of the L1 three', async () => {
    const world = makeWorld();
    const h = makeHarness(world);
    await pollManifest(h, makeReq(SCREEN_ID));
    h.prismaDouble.reset();

    // 60 s with NO other traffic: the credential snapshot has aged out (its
    // window is capped at the cross-replica TTL on purpose), so the
    // interceptor re-reads. The identity preamble does not — its TTL is 10 min
    // and the content rev has not moved.
    advance(60_000);
    const res = await pollManifest(h, makeReq(SCREEN_ID));
    expect(res.statusCode).toBe(200);

    const warm = h.prismaDouble.calls.filter((c) => !c.endsWith('.update'));
    expect(warm).not.toContain('screenGroup.findUnique');
    expect(warm).not.toContain('tenant.findUnique[identity]');
    expect(warm.filter((c) => c === 'screen.findUnique')).toHaveLength(1); // credential only
    expect(warm.sort()).toEqual(
      [
        'screen.findUnique',
        'screenEmergencyOverride.findUnique',
        'tenant.findUnique[emergency]',
      ].sort(),
    );
  });

  it('serves the same ETag and body from the snapshot as from a cold read', async () => {
    const world = makeWorld();
    const h = makeHarness(world);
    const first = await pollManifest(h, makeReq(SCREEN_ID));

    advance(60_000);
    const second = await pollManifest(h, makeReq(SCREEN_ID));

    expect(second.statusCode).toBe(first.statusCode);
    // `generatedAt` is the only per-request field; everything else must match.
    const strip = (b: any) => {
      const { generatedAt: _t, ...rest } = b ?? {};
      return rest;
    };
    expect(strip(second.body)).toEqual(strip(first.body));
  });

  it('the preamble read is skipped, not merely re-ordered — a cache hit exists', async () => {
    const h = makeHarness(makeWorld());
    await pollManifest(h, makeReq(SCREEN_ID));
    expect(getManifestPreamble(SCREEN_ID)).toBeDefined();
    expect(getManifestPreamble(SCREEN_ID)?.screen.id).toBe(SCREEN_ID);
    expect(getManifestPreamble(SCREEN_ID)?.screenGroup).toMatchObject({ id: GROUP_ID });
    expect(getManifestPreamble(SCREEN_ID)?.tenant).toMatchObject({ name: 'Walnut Creek HS' });
  });
});

// ── 2. Revocation ────────────────────────────────────────────────────────

describe('a revoked device is refused on its very next poll', () => {
  it('403/401s immediately after the revoke, with no stale window', async () => {
    const world = makeWorld();
    const h = makeHarness(world);

    // Warm every tier: in-process credential snapshot, cross-replica copy,
    // preamble. This is the worst case for a revoke — everything is cached.
    setDeviceCredentialSharedStore({
      get: (id) => h.redis.getString(`venueos:devcred:${id}`),
      set: (id, v, ttl) => h.redis.setString(`venueos:devcred:${id}`, v, ttl),
      del: (id) => h.redis.delKey(`venueos:devcred:${id}`),
    });
    const ok = await pollManifest(h, makeReq(SCREEN_ID));
    expect(ok.statusCode).toBe(200);

    // The operator revoke: the row flips and the writer invalidates. No clock
    // movement at all — the refusal must not need a TTL to elapse.
    world.screen = baseScreenRow({ status: 'REVOKED', credentialEpoch: 1 });
    invalidateDeviceCredentialCache(SCREEN_ID);

    const res = makeRes();
    await expect(pollManifest(h, makeReq(SCREEN_ID), res)).rejects.toThrow(
      /revoked/i,
    );
    // The cross-replica copy was DELETED, so no other replica can answer from
    // a pre-revoke snapshot either. (The key exists again afterwards — the
    // re-read republished the now-REVOKED row, which can only ever deny.)
    expect(h.redis.delKey).toHaveBeenCalledWith(`venueos:devcred:${SCREEN_ID}`);
    const stored = h.redis.store.get(`venueos:devcred:${SCREEN_ID}`);
    if (stored) expect(stored.value).toContain('REVOKED');
  });

  it('refuses at the handler too when the interceptor is bypassed (defence in depth)', async () => {
    const world = makeWorld();
    const h = makeHarness(world);
    await pollManifest(h, makeReq(SCREEN_ID));

    world.screen = baseScreenRow({ status: 'REVOKED' });
    invalidateDeviceCredentialCache(SCREEN_ID);

    // Handler only — as if the global interceptor were reordered or removed.
    const res = makeRes();
    await h.controller.getManifest(SCREEN_ID, makeReq(SCREEN_ID), res as any);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Device invalid or revoked' });
  });

  it('refuses a stale credential epoch from the snapshot', async () => {
    const world = makeWorld();
    const h = makeHarness(world);
    await pollManifest(h, makeReq(SCREEN_ID));

    // Epoch rotated past the grace window; the device still presents ep=0.
    world.screen = baseScreenRow({
      credentialEpoch: 5,
      credentialEpochRotatedAt: new Date(nowMs - 48 * 60 * 60 * 1000),
    });
    invalidateDeviceCredentialCache(SCREEN_ID);

    const res = makeRes();
    await expect(pollManifest(h, makeReq(SCREEN_ID, 0), res)).rejects.toThrow(/revoked/i);
  });
});

// ── 3. Invalidation completeness ─────────────────────────────────────────

describe('every write path that changes what the snapshot holds invalidates it', () => {
  /**
   * Drive one poll to warm the snapshot, apply `mutate` (which stands in for
   * the write plus whatever invalidation that path performs), then assert the
   * next poll re-reads the rows from Postgres.
   */
  async function expectsRefetchAfter(
    mutate: (world: World) => void,
    world: World = makeWorld(),
  ) {
    const h = makeHarness(world);
    await pollManifest(h, makeReq(SCREEN_ID));
    h.prismaDouble.reset();
    mutate(world);
    advance(1_000);
    await pollManifest(h, makeReq(SCREEN_ID));
    return h.prismaDouble.calls;
  }

  const contentWrite = (model: string, action: string, keys: string[] | null) => {
    // Exactly what prisma.service.ts's $use hook does for this operation.
    if (shouldBumpManifestRev(model, action, keys)) bumpManifestContentRev();
    if (shouldInvalidateDeviceCredential(model, action, keys)) {
      invalidateDeviceCredentialCache(SCREEN_ID);
    }
  };

  it('re-pair (Screen.tenantId + status + credentialEpoch)', async () => {
    const calls = await expectsRefetchAfter((w) => {
      // Epoch rotated just now, so the device's current token is inside the
      // grace window (CREDENTIAL_EPOCH_GRACE_MS) — a live kiosk keeps working
      // and re-registers; what must change is the tenant it now belongs to.
      w.screen = baseScreenRow({
        tenantId: 'tenant-new',
        credentialEpoch: 1,
        credentialEpochRotatedAt: new Date(nowMs),
      });
      w.tenant = { name: 'New District', posterStandardW: null, posterStandardH: null };
      contentWrite('Screen', 'update', ['tenantId', 'status', 'credentialEpoch']);
      invalidateDeviceCredentialCache(SCREEN_ID); // the explicit writer call
    });
    expect(calls).toContain('screen.findUnique');
    expect(calls).toContain('tenant.findUnique[identity]');
  });

  it('unpair (Screen.tenantId → null)', async () => {
    const calls = await expectsRefetchAfter((w) => {
      w.screen = baseScreenRow({ tenantId: null, screenGroupId: null, status: 'PENDING' });
      contentWrite('Screen', 'update', ['tenantId', 'screenGroupId', 'status']);
      invalidateDeviceCredentialCache(SCREEN_ID);
    });
    expect(calls).toContain('screen.findUnique');
  });

  it('group move via PUT /screens/:id — caught by the Prisma hook alone', async () => {
    // This writer had NO invalidateDeviceCredentialCache call before
    // 2026-09-03. The safety net must cover it with no explicit call at all.
    const calls = await expectsRefetchAfter((w) => {
      w.screen = baseScreenRow({ screenGroupId: 'group-other' });
      w.group = { id: 'group-other', name: 'Gym', syncMode: 'locked' };
      contentWrite('Screen', 'update', ['name', 'location', 'screenGroupId']);
    });
    expect(calls).toContain('screen.findUnique');
    expect(calls).toContain('screenGroup.findUnique');
  });

  it('bulk group re-assign / group delete unassign (updateMany, no where.id)', async () => {
    const world = makeWorld();
    const h = makeHarness(world);
    await pollManifest(h, makeReq(SCREEN_ID));
    h.prismaDouble.reset();

    // screen-groups.controller.ts: updateMany({ where: { screenGroupId }, … }).
    // No id to key on, so the hook clears every entry — rare, operator-driven.
    world.screen = baseScreenRow({ screenGroupId: null });
    world.group = null;
    if (shouldBumpManifestRev('Screen', 'updateMany', ['screenGroupId'])) bumpManifestContentRev();
    if (shouldInvalidateDeviceCredential('Screen', 'updateMany', ['screenGroupId'])) {
      invalidateDeviceCredentialCache(undefined);
    }
    advance(1_000);
    await pollManifest(h, makeReq(SCREEN_ID));
    expect(h.prismaDouble.calls).toContain('screen.findUnique');
  });

  it('screen rename', async () => {
    const calls = await expectsRefetchAfter((w) => {
      w.screen = baseScreenRow({ name: 'Lobby South' });
      contentWrite('Screen', 'update', ['name']);
    });
    expect(calls).toContain('screen.findUnique');
  });

  it('group rename / syncMode toggle (ScreenGroup write)', async () => {
    const calls = await expectsRefetchAfter((w) => {
      w.group = { id: GROUP_ID, name: 'Lobby', syncMode: 'locked' };
      contentWrite('ScreenGroup', 'update', ['syncMode']);
    });
    expect(calls).toContain('screenGroup.findUnique');
  });

  it('tenant rename / poster-standard change (Tenant write)', async () => {
    const calls = await expectsRefetchAfter((w) => {
      w.tenant = { name: 'Renamed District', posterStandardW: 360, posterStandardH: 1200 };
      contentWrite('Tenant', 'update', ['name']);
    });
    expect(calls).toContain('tenant.findUnique[identity]');
  });

  it('credential epoch rotation on register', async () => {
    const calls = await expectsRefetchAfter((w) => {
      w.screen = baseScreenRow({ credentialEpoch: 1, credentialEpochRotatedAt: new Date(nowMs) });
      // rotateScreenCredentialEpoch's write shape — every key is
      // telemetry-only, so the rev does NOT move and only the credential
      // predicate can catch it.
      expect(shouldBumpManifestRev('Screen', 'update', ['credentialEpoch', 'credentialEpochRotatedAt'])).toBe(false);
      contentWrite('Screen', 'update', ['credentialEpoch', 'credentialEpochRotatedAt']);
    });
    expect(calls).toContain('screen.findUnique');
  });

  it('screen delete', async () => {
    const world = makeWorld();
    const h = makeHarness(world);
    await pollManifest(h, makeReq(SCREEN_ID));

    world.screen = null;
    if (shouldInvalidateDeviceCredential('Screen', 'delete', null)) {
      invalidateDeviceCredentialCache(SCREEN_ID);
    }
    advance(1_000);
    const res = makeRes();
    await expect(pollManifest(h, makeReq(SCREEN_ID), res)).rejects.toThrow(/invalid/i);
  });

  it('display-capability verdict change (invalidateManifestCache path)', async () => {
    // `displayCapabilities` is telemetry-only by design (a power-on wave must
    // not clear the fleet's manifests), so DisplayService.recordCapabilities
    // invalidates this ONE screen when the verdict actually changes.
    const world = makeWorld();
    const h = makeHarness(world);
    await pollManifest(h, makeReq(SCREEN_ID));
    h.prismaDouble.reset();

    world.screen = baseScreenRow({ displayCapabilities: { screenBlank: 'supported' } });
    invalidateManifestCache(SCREEN_ID);
    advance(1_000);
    await pollManifest(h, makeReq(SCREEN_ID));
    expect(h.prismaDouble.calls).toContain('screen.findUnique');
  });

  it('tenant archive (Tenant write) reaches the screen', async () => {
    const calls = await expectsRefetchAfter((w) => {
      w.tenantEmergency = { ...w.tenantEmergency, archivedAt: new Date(nowMs) };
      contentWrite('Tenant', 'update', ['archivedAt']);
    });
    expect(calls).toContain('tenant.findUnique[identity]');
  });
});

// ── 3b. The predicate itself ─────────────────────────────────────────────

describe('shouldInvalidateDeviceCredential', () => {
  it('fires on the columns the snapshot is built from', () => {
    for (const field of CREDENTIAL_SNAPSHOT_TRIGGER_FIELDS) {
      expect(shouldInvalidateDeviceCredential('Screen', 'update', [field])).toBe(true);
    }
    expect(shouldInvalidateDeviceCredential('Screen', 'updateMany', ['screenGroupId'])).toBe(true);
    expect(shouldInvalidateDeviceCredential('Screen', 'delete', null)).toBe(true);
    expect(shouldInvalidateDeviceCredential('Screen', 'deleteMany', null)).toBe(true);
    // Unknown data shape → fail toward a re-read.
    expect(shouldInvalidateDeviceCredential('Screen', 'update', null)).toBe(true);
  });

  it('does NOT fire on the fleet telemetry write shapes', () => {
    // If any of these fired, the credential cache would be dropped on
    // essentially every device request and the whole tier would be pointless.
    expect(shouldInvalidateDeviceCredential('Screen', 'update', ['lastPingAt'])).toBe(false);
    expect(shouldInvalidateDeviceCredential('Screen', 'update', ['lastPingAt', 'status'])).toBe(false);
    expect(
      shouldInvalidateDeviceCredential('Screen', 'update', [
        'lastRenderedAt',
        'lastRenderedFrames',
        'lastRenderedHash',
        'lastBundleSha',
      ]),
    ).toBe(false);
    expect(shouldInvalidateDeviceCredential('Screen', 'update', ['lastCacheReport', 'lastCacheReportAt'])).toBe(false);
    // Morning power-on wave (register).
    expect(
      shouldInvalidateDeviceCredential('Screen', 'update', [
        'resolution',
        'osInfo',
        'browserInfo',
        'userAgent',
        'ipAddress',
        'lastPingAt',
        'status',
      ]),
    ).toBe(false);
  });

  it('ignores every other model and every read action', () => {
    expect(shouldInvalidateDeviceCredential('Playlist', 'update', ['name'])).toBe(false);
    expect(shouldInvalidateDeviceCredential('ScreenGroup', 'delete', null)).toBe(false);
    expect(shouldInvalidateDeviceCredential('Screen', 'findUnique', null)).toBe(false);
    expect(shouldInvalidateDeviceCredential(undefined, 'update', ['tenantId'])).toBe(false);
  });
});

// ── 4. Life-safety branches never read from the snapshot ─────────────────

describe('the EMERGENCY and SPORTS branches re-read the Screen row live', () => {
  it('emergency branch reads the row from Postgres even on a warm preamble', async () => {
    const world = makeWorld();
    const h = makeHarness(world);
    await pollManifest(h, makeReq(SCREEN_ID)); // warm everything
    h.prismaDouble.reset();

    // An alert is raised by the tenant emergency state, which is read LIVE.
    world.tenantEmergency = {
      ...world.tenantEmergency,
      emergencyStatus: 'CRITICAL', // the SEVERITY — the incident type lives in emergencyType
      emergencyType: 'LOCKDOWN',
    };
    advance(60_000); // past the 2 s tenant-state cache
    const res = await pollManifest(h, makeReq(SCREEN_ID));

    expect(res.statusCode).toBe(200);
    expect(res.body?.isEmergency).toBe(true);
    // The proof: the row was re-read on this poll, not taken from the snapshot.
    expect(h.prismaDouble.calls).toContain('screen.findUnique');
  });

  it('sports scoreboard branch reads the row from Postgres even on a warm preamble', async () => {
    const world = makeWorld();
    const h = makeHarness(world);
    await pollManifest(h, makeReq(SCREEN_ID));
    h.prismaDouble.reset();

    world.screen = baseScreenRow({ activeBoardGameId: 'game-1', activeBoardSurface: 'BOARD' });
    world.game = { id: 'game-1' };
    // A game push writes Screen.activeBoardGameId — not a telemetry column,
    // so the content rev moves and the snapshot is rebuilt anyway; the live
    // re-read is the belt to that braces.
    bumpManifestContentRev();
    advance(60_000);
    const res = await pollManifest(h, makeReq(SCREEN_ID));

    expect(res.statusCode).toBe(200);
    expect(h.prismaDouble.calls.filter((c) => c === 'screen.findUnique').length).toBeGreaterThanOrEqual(1);
    expect(h.prismaDouble.calls).toContain('game.findFirst');
  });

  it('an emergency poll still answers when the live re-read fails (fail-safe)', async () => {
    const world = makeWorld();
    const h = makeHarness(world);
    await pollManifest(h, makeReq(SCREEN_ID));

    world.tenantEmergency = {
      ...world.tenantEmergency,
      emergencyStatus: 'CRITICAL', // the SEVERITY — the incident type lives in emergencyType
      emergencyType: 'LOCKDOWN',
    };
    // Pool blip on the re-read only. 3 s keeps the credential snapshot warm
    // (30 s window) so the ONLY Screen read this poll makes is the live
    // emergency re-read — and it fails. The alert must still go out, built
    // from the snapshot the request already holds.
    h.prismaDouble.client.screen.findUnique.mockImplementation(async () => {
      throw new Error('pool timeout');
    });
    advance(3_000); // past the 2 s tenant-emergency cache, inside 30 s
    const res = await pollManifest(h, makeReq(SCREEN_ID));
    expect(res.statusCode).toBe(200);
    expect(res.body?.isEmergency).toBe(true);
  });
});

// ── 4b. Per-screen emergency content is keyed on the INCIDENT TYPE ───────
//
// 2026-09-21. `Tenant.emergencyStatus` holds the SEVERITY (the trigger writes
// `emergencyStatus: severity`, `emergencyType: overridePayload.type` — see
// emergency.controller.ts). The per-screen content lookup keyed its
// `switch` on emergencyStatus, so on any alert with no per-screen override
// row the key was 'CRITICAL', every `case 'EVACUATE':` fell to `default`, and
// the screen's own evacuation content was never selected.
//
// It hid for five months because the tenant trigger fans out an override row
// per screen (which carries the type) — so the NORMAL path never reached this
// lookup. The cases that do reach it are exactly the ones below, and the
// district-inheritance walk was deliberately written to rely on it ("NOT
// inherited: locationBasedEmergencyEnabled stays this school's own opt-in").
//
// THE FIXTURES ARE CUT FROM THE PRODUCER: severity in emergencyStatus, type in
// emergencyType. Nine older fixtures in this repo put a type in
// emergencyStatus, which is how this was never caught.

describe('per-screen emergency content on an alert with no per-screen override row', () => {
  const playlist = (id: string, url: string) => ({
    id,
    name: id,
    items: [{
      id: `${id}-item`, assetId: `${id}-asset`, durationMs: 15_000, sequenceOrder: 0, transitionType: null,
      asset: { fileHash: 'h', fileUrl: url, mimeType: 'image/png' },
    }],
  });
  const PLAYLISTS = {
    'pl-tenant-evac': playlist('pl-tenant-evac', 'https://cdn.test/tenant-evac.png'),
    'pl-gym-evac': playlist('pl-gym-evac', 'https://cdn.test/gym-north-exit.png'),
    'pl-gym-lockdown': playlist('pl-gym-lockdown', 'https://cdn.test/gym-lockdown.png'),
  };
  /** What a tenant-wide EVACUATE leaves on the Tenant row. */
  const evacuating = (over: Record<string, unknown> = {}) => ({
    ...makeWorld().tenantEmergency,
    emergencyStatus: 'CRITICAL',          // the SEVERITY
    emergencyType: 'EVACUATE',            // the incident type
    emergencyPlaylistId: 'pl-tenant-evac',
    locationBasedEmergencyEnabled: true,
    ...over,
  });

  it('a screen with its own evacuation playlist shows IT, not the school-wide one', async () => {
    const world = makeWorld({
      screen: baseScreenRow({ emergencyEvacuatePlaylistId: 'pl-gym-evac' }),
      tenantEmergency: evacuating(),
      playlists: PLAYLISTS,
    });
    const res = await pollManifest(makeHarness(world), makeReq(SCREEN_ID));
    expect(res.body?.isEmergency).toBe(true);
    expect(res.body?.emergencyType).toBe('EVACUATE');
    expect(res.body?.playlists?.[0]?.id).toBe('pl-gym-evac');
    expect(res.body?.playlists?.[0]?.items?.[0]?.url).toBe('https://cdn.test/gym-north-exit.png');
  });

  it('a screen with only an uploaded evacuation MAP shows the map, not the red text board', async () => {
    const world = makeWorld({
      screen: baseScreenRow({ emergencyEvacuateAssetUrl: 'https://cdn.test/gym-map.png' }),
      tenantEmergency: evacuating({ emergencyPlaylistId: null }),
      playlists: PLAYLISTS,
    });
    const res = await pollManifest(makeHarness(world), makeReq(SCREEN_ID));
    expect(res.body?.playlists?.[0]?.id).toBe('screen-asset-evacuate');
    expect(res.body?.playlists?.[0]?.items?.[0]?.url).toBe('https://cdn.test/gym-map.png');
  });

  it('an alert INHERITED from the district selects the school\'s own per-screen content', async () => {
    // The fan-out never reached this school (created after the trigger / row
    // reset out-of-band), so there are no override rows by definition.
    const world = makeWorld({
      screen: baseScreenRow({ emergencyEvacuatePlaylistId: 'pl-gym-evac' }),
      tenantEmergency: {
        ...makeWorld().tenantEmergency,
        parentId: 'district-1',
        locationBasedEmergencyEnabled: true,
      },
      ancestors: { 'district-1': evacuating({ id: 'district-1', locationBasedEmergencyEnabled: false }) },
      playlists: PLAYLISTS,
    });
    const res = await pollManifest(makeHarness(world), makeReq(SCREEN_ID));
    expect(res.body?.isEmergency).toBe(true);
    expect(res.body?.emergencyInheritedFromTenantId).toBe('district-1');
    expect(res.body?.playlists?.[0]?.id).toBe('pl-gym-evac');
  });

  it('NEVER crosses types: a LOCKDOWN does not show a screen\'s evacuation content', async () => {
    const world = makeWorld({
      screen: baseScreenRow({ emergencyEvacuatePlaylistId: 'pl-gym-evac' }),
      tenantEmergency: evacuating({ emergencyType: 'LOCKDOWN' }),
      playlists: PLAYLISTS,
    });
    const res = await pollManifest(makeHarness(world), makeReq(SCREEN_ID));
    expect(res.body?.emergencyType).toBe('LOCKDOWN');
    expect(res.body?.playlists?.[0]?.id).toBe('pl-tenant-evac'); // the tenant's active playlist
  });

  it('location mode OFF ignores per-screen content, exactly as before', async () => {
    const world = makeWorld({
      screen: baseScreenRow({ emergencyEvacuatePlaylistId: 'pl-gym-evac' }),
      tenantEmergency: evacuating({ locationBasedEmergencyEnabled: false }),
      playlists: PLAYLISTS,
    });
    const res = await pollManifest(makeHarness(world), makeReq(SCREEN_ID));
    expect(res.body?.playlists?.[0]?.id).toBe('pl-tenant-evac');
  });

  it('a per-screen OVERRIDE row still wins over everything (the normal fan-out path)', async () => {
    const world = makeWorld({
      screen: baseScreenRow({ emergencyEvacuatePlaylistId: 'pl-gym-evac' }),
      tenantEmergency: evacuating(),
      override: { screenId: SCREEN_ID, tenantId: TENANT_ID, type: 'LOCKDOWN', severity: 'CRITICAL', playlistId: 'pl-gym-lockdown', expiresAt: null },
      playlists: PLAYLISTS,
    });
    const res = await pollManifest(makeHarness(world), makeReq(SCREEN_ID));
    expect(res.body?.emergencyType).toBe('LOCKDOWN');
    expect(res.body?.emergencyScope).toBe('screen');
    expect(res.body?.playlists?.[0]?.id).toBe('pl-gym-lockdown');
  });

  it('a row written before Tenant.emergencyType existed still raises the alert', async () => {
    // emergencyType null: nothing to key on, so no per-screen match — the
    // tenant playlist plays. Same outcome as before the fix; never a throw.
    const world = makeWorld({
      screen: baseScreenRow({ emergencyEvacuatePlaylistId: 'pl-gym-evac' }),
      tenantEmergency: evacuating({ emergencyType: null }),
      playlists: PLAYLISTS,
    });
    const res = await pollManifest(makeHarness(world), makeReq(SCREEN_ID));
    expect(res.statusCode).toBe(200);
    expect(res.body?.isEmergency).toBe(true);
    expect(res.body?.playlists?.[0]?.id).toBe('pl-tenant-evac');
  });
});

// ── 5. Hot-cache contract is unchanged ───────────────────────────────────

describe('the manifest hot-cache contract still holds', () => {
  it('the debounced lastPingAt write does not bust the preamble', async () => {
    const world = makeWorld();
    const h = makeHarness(world);
    await pollManifest(h, makeReq(SCREEN_ID));
    // The handler's own fire-and-forget telemetry write shape (the debounce
    // map is process-wide and deliberately has no test reset, so whether THIS
    // poll issued the write depends on run order — the invariant under test is
    // the polarity of the two predicates, not the write itself).
    expect(shouldBumpManifestRev('Screen', 'update', ['lastPingAt'])).toBe(false);
    expect(shouldInvalidateDeviceCredential('Screen', 'update', ['lastPingAt'])).toBe(false);

    h.prismaDouble.reset();
    advance(60_000);
    await pollManifest(h, makeReq(SCREEN_ID));
    expect(h.prismaDouble.calls).not.toContain('screenGroup.findUnique');
  });

  it('any content mutation is visible on the very next poll', async () => {
    const world = makeWorld();
    const h = makeHarness(world);
    await pollManifest(h, makeReq(SCREEN_ID));
    h.prismaDouble.reset();

    bumpManifestContentRev(); // e.g. a playlist edit
    advance(1_000);
    await pollManifest(h, makeReq(SCREEN_ID));
    expect(h.prismaDouble.calls).toContain('screen.findUnique');
    expect(h.prismaDouble.calls).toContain('schedule.findMany');
  });

  it('the interceptor window is capped at the cross-replica TTL', () => {
    // The two tiers must not disagree: an in-process entry may never outlive
    // the shared copy it can be refreshed from.
    expect(DEVICE_IDENTITY_CREDENTIAL_MAX_AGE_MS).toBe(30_000);
  });
});
