/**
 * DISTRICT-WIDE EMERGENCY PROPAGATION — end-to-end through state.
 *
 * THE BUG THIS PINS
 * -----------------
 * A DISTRICT_ADMIN firing a lockdown used to update exactly ONE `Tenant` row
 * and publish to exactly ONE channel. There was no walk to child tenants
 * anywhere in the emergency module, and the player's manifest resolved
 * emergency state solely from its own `screen.tenantId`. Measured against
 * live production on 2026-08-03, 41 paired screens sat under CHILD tenants
 * (Walnut Creek 7 schools / 38 screens, Springfield 1 / 3, Chardon 2 / 0) —
 * a district lockdown reached the district office and NOTHING else. That is
 * the product's headline claim.
 *
 * WHY THIS SUITE DRIVES THE REAL MANIFEST
 * ---------------------------------------
 * The manifest is the SOLE arbiter of the lockdown overlay (the player's
 * `manifest.isEmergency === true` branch; the WS/SSE bus only triggers a
 * re-fetch). A test that asserted "we wrote N tenant rows" would prove the
 * fan-out and still let a manifest-side regression put a screen back on its
 * normal playlist. So this suite backs BOTH `EmergencyController` (writes)
 * and the real `ScreensController.getManifest` (reads) with ONE stateful
 * in-memory store, and asserts on what the screen would actually render.
 *
 * The store's `tenant.update`/`updateMany` call `bumpManifestContentRev()`,
 * exactly as the production Prisma `$use` hook does for every
 * MANIFEST_FED_MODEL — so the manifest content cache behaves here the way it
 * does in prod rather than being quietly disabled for the test.
 *
 * FIXTURE (deliberately deeper + messier than a two-level district)
 * ----------------------------------------------------------------
 *   district ─┬─ school-a ── annex        (3 levels: proves a multi-hop walk)
 *             ├─ school-b
 *             └─ archived-school          (archivedAt set: must be SKIPPED)
 *   other-district ── other-school        (isolation: must never be touched)
 */

import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EmergencyController } from './emergency.controller';
import { ScreensController } from '../screens/screens.controller';
import { RedisService } from '../realtime/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { WebhookDispatchService } from '../webhooks/webhook-dispatch.service';
import { GpioService } from '../screens/gpio.service';
import { JwtService } from '@nestjs/jwt';
import {
  invalidateTenantState,
  resetManifestCacheForTests,
  bumpManifestContentRev,
} from '../screens/manifest-hot-cache';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

// ── fixture ids ────────────────────────────────────────────────────────────
const DISTRICT = 'district';
const SCHOOL_A = 'school-a';
const SCHOOL_B = 'school-b';
const ANNEX = 'annex';
const ARCHIVED = 'archived-school';
const OTHER_DISTRICT = 'other-district';
const OTHER_SCHOOL = 'other-school';

const ALL_TENANTS = [
  DISTRICT, SCHOOL_A, SCHOOL_B, ANNEX, ARCHIVED, OTHER_DISTRICT, OTHER_SCHOOL,
];

interface TenantRow {
  id: string;
  parentId: string | null;
  archivedAt: Date | null;
  emergencyStatus: string;
  emergencyType: string | null;
  emergencyPlaylistId: string | null;
  emergencyPortraitPlaylistId: string | null;
  locationBasedEmergencyEnabled: boolean;
  panicLockdownPlaylistId?: string | null;
  panicLockdownPortraitPlaylistId?: string | null;
  name?: string;
}

interface ScreenRow {
  id: string;
  tenantId: string;
  screenGroupId: string | null;
  status: string;
  resolution: string;
  canvasW: number | null;
  canvasH: number | null;
  repeats: number;
  config: any;
  activeBoardGameId: string | null;
}

describe('District-wide emergency propagation (fan-out + manifest inheritance)', () => {
  let emergency: EmergencyController;
  let screens: ScreensController;
  let redis: jest.Mocked<RedisService>;
  let prisma: any;

  let tenants: Map<string, TenantRow>;
  let screenRows: Map<string, ScreenRow>;
  let overrides: Map<string, any>;
  let auditLogs: any[];
  let emergencyMessages: any[];
  let playlists: Map<string, any>;

  const tenant = (id: string, parentId: string | null, extra: Partial<TenantRow> = {}): TenantRow => ({
    id,
    parentId,
    archivedAt: null,
    emergencyStatus: 'INACTIVE',
    emergencyType: null,
    emergencyPlaylistId: null,
    emergencyPortraitPlaylistId: null,
    locationBasedEmergencyEnabled: false,
    panicLockdownPlaylistId: null,
    panicLockdownPortraitPlaylistId: null,
    name: id,
    ...extra,
  });

  const screenOf = (id: string, tenantId: string, extra: Partial<ScreenRow> = {}): ScreenRow => ({
    id,
    tenantId,
    screenGroupId: null,
    status: 'ONLINE',
    resolution: '1920x1080',
    canvasW: null,
    canvasH: null,
    repeats: 1,
    config: null,
    activeBoardGameId: null,
    ...extra,
  });

  /** Evaluate the small subset of Prisma `where` shapes these paths emit. */
  const idMatches = (value: string, clause: any): boolean => {
    if (clause === undefined) return true;
    if (clause && typeof clause === 'object' && Array.isArray(clause.in)) {
      return clause.in.includes(value);
    }
    return value === clause;
  };

  beforeEach(async () => {
    // Module-level caches in manifest-hot-cache.ts survive between specs.
    resetManifestCacheForTests();
    for (const id of [...ALL_TENANTS, 'school-c']) invalidateTenantState(id);

    tenants = new Map(
      [
        tenant(DISTRICT, null),
        // school-a rehearses its OWN lockdown content — the whole reason
        // fan-out beats inheritance.
        tenant(SCHOOL_A, DISTRICT, { panicLockdownPlaylistId: 'pl-school-a-lockdown' }),
        tenant(SCHOOL_B, DISTRICT),
        tenant(ANNEX, SCHOOL_A),
        tenant(ARCHIVED, DISTRICT, { archivedAt: new Date('2026-01-01') }),
        tenant(OTHER_DISTRICT, null),
        tenant(OTHER_SCHOOL, OTHER_DISTRICT),
      ].map((t) => [t.id, t]),
    );

    screenRows = new Map(
      [
        screenOf('scr-district', DISTRICT),
        screenOf('scr-a1', SCHOOL_A),
        screenOf('scr-a2', SCHOOL_A, { resolution: '1080x1920' }), // portrait
        screenOf('scr-b1', SCHOOL_B),
        screenOf('scr-annex', ANNEX),
        screenOf('scr-archived', ARCHIVED),
        screenOf('scr-other', OTHER_SCHOOL),
      ].map((s) => [s.id, s]),
    );

    overrides = new Map();
    auditLogs = [];
    emergencyMessages = [];
    playlists = new Map([
      [
        'pl-school-a-lockdown',
        {
          id: 'pl-school-a-lockdown',
          name: 'School A Lockdown',
          tenantId: SCHOOL_A,
          items: [
            {
              id: 'it1',
              assetId: 'a1',
              durationMs: 30_000,
              sequenceOrder: 0,
              transitionType: null,
              asset: { fileUrl: 'https://cdn/a.png', fileHash: 'h1', mimeType: 'image/png' },
            },
          ],
        },
      ],
      ['pl-district-explicit', { id: 'pl-district-explicit', name: 'District', tenantId: DISTRICT, items: [] }],
    ]);

    redis = { publish: jest.fn().mockResolvedValue(true), sismember: jest.fn().mockResolvedValue(false) } as any;

    prisma = {
      client: {
        tenant: {
          findUnique: jest.fn(async ({ where }: any) => {
            const row = tenants.get(where.id);
            return row ? { ...row } : null;
          }),
          findMany: jest.fn(async ({ where }: any) => {
            const out: TenantRow[] = [];
            for (const row of tenants.values()) {
              if (where?.parentId !== undefined && !idMatches(row.parentId as any, where.parentId)) continue;
              if (where?.id !== undefined && !idMatches(row.id, where.id)) continue;
              if (where?.archivedAt === null && row.archivedAt !== null) continue;
              out.push({ ...row });
            }
            return out;
          }),
          update: jest.fn(async ({ where, data }: any) => {
            const row = tenants.get(where.id);
            if (row) Object.assign(row, data);
            // Mirrors the production Prisma $use hook: Tenant is a
            // MANIFEST_FED_MODEL, so any write busts the manifest cache.
            bumpManifestContentRev();
            return row;
          }),
          updateMany: jest.fn(async ({ where, data }: any) => {
            let count = 0;
            for (const row of tenants.values()) {
              if (where?.id !== undefined && !idMatches(row.id, where.id)) continue;
              Object.assign(row, data);
              count++;
            }
            bumpManifestContentRev();
            return { count };
          }),
        },
        screen: {
          findUnique: jest.fn(async ({ where }: any) => {
            const row = screenRows.get(where.id);
            if (!row) return null;
            return { ...row, screenGroup: null, tenant: { name: tenants.get(row.tenantId)?.name ?? null } };
          }),
          findMany: jest.fn(async ({ where }: any) => {
            const out: ScreenRow[] = [];
            for (const row of screenRows.values()) {
              if (where?.tenantId !== undefined && !idMatches(row.tenantId, where.tenantId)) continue;
              if (where?.id !== undefined && !idMatches(row.id, where.id)) continue;
              if (where?.screenGroupId !== undefined && !idMatches(row.screenGroupId as any, where.screenGroupId)) continue;
              out.push({ ...row });
            }
            return out;
          }),
          update: jest.fn(async () => ({})),
        },
        screenEmergencyOverride: {
          findUnique: jest.fn(async ({ where }: any) => overrides.get(where.screenId) ?? null),
          upsert: jest.fn(async ({ where, create, update }: any) => {
            const existing = overrides.get(where.screenId);
            const row = existing ? { ...existing, ...update } : { screenId: where.screenId, ...create };
            overrides.set(where.screenId, row);
            return row;
          }),
          deleteMany: jest.fn(async ({ where }: any) => {
            let count = 0;
            for (const [screenId, row] of [...overrides.entries()]) {
              if (where?.tenantId !== undefined && !idMatches(row.tenantId, where.tenantId)) continue;
              if (where?.screenId !== undefined && !idMatches(screenId, where.screenId)) continue;
              overrides.delete(screenId);
              count++;
            }
            return { count };
          }),
        },
        playlist: {
          findFirst: jest.fn(async ({ where }: any) => {
            const pl = playlists.get(where.id);
            if (!pl) return null;
            if (where.tenantId && pl.tenantId !== where.tenantId) return null;
            return { id: pl.id };
          }),
          findUnique: jest.fn(async ({ where }: any) => playlists.get(where.id) ?? null),
        },
        auditLog: { create: jest.fn(async ({ data }: any) => { auditLogs.push(data); return data; }) },
        emergencyMessage: {
          // EM-01: capture the rows so the fan-out can be asserted. The device
          // poll finds a broadcast by `where: { tenantId: screen.tenantId }`,
          // so ONE row per affected tenant is what makes it reachable at all.
          create: jest.fn(async ({ data }: any) => { emergencyMessages.push(data); return data; }),
          findMany: jest.fn(async () => []),
          findUnique: jest.fn(async () => null),
          updateMany: jest.fn(async () => ({ count: 0 })),
        },
        // No schedules anywhere → the non-emergency manifest is the explicit
        // `isEmergency:false` empty body, which is exactly the assertion we
        // want for "this screen must NOT be locked down".
        schedule: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
        game: { findFirst: jest.fn(async () => null) },
        $transaction: jest.fn((opsOrFn: any) =>
          typeof opsOrFn === 'function' ? opsOrFn(prisma.client) : Promise.all(opsOrFn),
        ),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmergencyController],
      providers: [
        { provide: RedisService, useValue: redis },
        { provide: PrismaService, useValue: prisma },
        {
          provide: WebsocketSignerService,
          useValue: {
            signMessage: jest.fn((type, payload) => ({
              type, payload, eventId: `evt-${type}`, timestamp: Date.now(), signature: 'sig',
            })),
          },
        },
        { provide: JwtService, useValue: { sign: jest.fn(), verifyAsync: jest.fn() } },
        { provide: WebhookDispatchService, useValue: { dispatch: jest.fn().mockResolvedValue(undefined) } },
        { provide: GpioService, useValue: { driveStatusLampForEmergency: jest.fn().mockResolvedValue({ touched: 0 }) } },
      ],
    }).compile();

    emergency = module.get(EmergencyController);
    screens = new ScreensController(prisma, redis as any, {} as any, {} as any, {} as any, {} as any);
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Drive the REAL manifest handler and return the JSON body it emitted. */
  async function manifestFor(screenId: string): Promise<any> {
    let body: any = null;
    const res: any = {
      setHeader: jest.fn(),
      status: jest.fn(() => res),
      json: jest.fn((payload: any) => { body = payload; return res; }),
      send: jest.fn(() => res),
    };
    // No `req.user` → the handler's caller-scoping block is skipped entirely,
    // so this reads as the screen's own device would after auth.
    await screens.getManifest(screenId, { headers: {} } as any, res);
    return body;
  }

  const districtAdmin = { user: { id: 'dadmin', role: 'DISTRICT_ADMIN', tenantId: DISTRICT, schoolId: DISTRICT } };
  const schoolAAdmin = { user: { id: 'sadmin', role: 'SCHOOL_ADMIN', tenantId: SCHOOL_A, schoolId: SCHOOL_A } };

  const lockdown = (scopeId: string, overrideId = 'o-district') => ({
    scopeType: 'tenant' as const,
    scopeId,
    overridePayload: { overrideId, type: 'lockdown' as const, severity: 'CRITICAL' as const },
  });

  const triggerRowsFor = (tenantId: string) =>
    auditLogs.filter((r) => r.action === 'TRIGGER_EMERGENCY' && r.tenantId === tenantId);

  const publishedChannels = () => redis.publish.mock.calls.map((c) => c[0]);

  // ── 1. reach ─────────────────────────────────────────────────────────────

  it('a district lockdown reaches EVERY descendant screen’s manifest', async () => {
    // Baseline: nothing is in emergency.
    for (const s of ['scr-district', 'scr-a1', 'scr-b1', 'scr-annex']) {
      expect((await manifestFor(s)).isEmergency).toBe(false);
    }

    const res = await emergency.triggerEmergency(lockdown(DISTRICT) as any, districtAdmin);
    expect(res.success).toBe(true);

    // The district office AND every school below it — including the
    // 3rd-level annex, which a single-hop walk would have missed.
    for (const s of ['scr-district', 'scr-a1', 'scr-a2', 'scr-b1', 'scr-annex']) {
      const m = await manifestFor(s);
      expect(m.isEmergency).toBe(true);
      expect(m.emergencyType).toBe('LOCKDOWN');
      expect(m.emergencySeverity).toBe('CRITICAL');
    }

    // Archived location is NOT resurrected into a live lockdown, and the
    // unrelated district is untouched.
    expect((await manifestFor('scr-archived')).isEmergency).toBe(false);
    expect((await manifestFor('scr-other')).isEmergency).toBe(false);
    expect(tenants.get(OTHER_DISTRICT)!.emergencyStatus).toBe('INACTIVE');
    expect(tenants.get(OTHER_SCHOOL)!.emergencyStatus).toBe('INACTIVE');
  });

  it('each school resolves its OWN drilled panic content, not the district’s', async () => {
    await emergency.triggerEmergency(lockdown(DISTRICT) as any, districtAdmin);

    // school-a rehearsed a lockdown playlist → its screens play it.
    const a = await manifestFor('scr-a1');
    expect(a.playlists[0].id).toBe('pl-school-a-lockdown');

    // school-b configured nothing → the bulletproof DEFAULT_EMERGENCY
    // fallback still locks the wall down. Never a normal playlist.
    const b = await manifestFor('scr-b1');
    expect(b.playlists[0].id).toBe('DEFAULT_EMERGENCY');
    expect(b.isEmergency).toBe(true);
  });

  it('reports its reach in the response and fans the bus out per tenant', async () => {
    const res: any = await emergency.triggerEmergency(lockdown(DISTRICT) as any, districtAdmin);

    expect(res.affectedTenantIds.sort()).toEqual([ANNEX, DISTRICT, SCHOOL_A, SCHOOL_B].sort());
    expect(res.affectedTenantCount).toBe(4);

    // The gateway matches a `tenant:` publish against the DEVICE's own
    // tenantId, so one publish per tenant is what actually reaches a child
    // school's sockets. Archived + unrelated tenants get nothing.
    const channels = publishedChannels();
    expect(channels).toEqual(
      expect.arrayContaining([
        `tenant:${DISTRICT}`, `tenant:${SCHOOL_A}`, `tenant:${SCHOOL_B}`, `tenant:${ANNEX}`,
      ]),
    );
    expect(channels).not.toContain(`tenant:${ARCHIVED}`);
    expect(channels).not.toContain(`tenant:${OTHER_SCHOOL}`);
  });

  it('commits the whole subtree in ONE transaction (never a half-locked district)', async () => {
    await emergency.triggerEmergency(lockdown(DISTRICT) as any, districtAdmin);
    expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);
    // 4 tenants × (1 tenant.update + 1 auditLog.create); no location-based
    // mode is on, so no per-screen override upserts in this fixture.
    expect(prisma.client.$transaction.mock.calls[0][0]).toHaveLength(8);
  });

  // ── 2. no upward / sideways leak ─────────────────────────────────────────

  it('a school-scoped lockdown does NOT leak upward to the district or sideways to a sibling', async () => {
    await emergency.triggerEmergency(lockdown(SCHOOL_A, 'o-school-a') as any, schoolAAdmin);

    // Down from school-a: its own screens and its annex.
    expect((await manifestFor('scr-a1')).isEmergency).toBe(true);
    expect((await manifestFor('scr-annex')).isEmergency).toBe(true);

    // UP: the district office must stay on normal content.
    expect((await manifestFor('scr-district')).isEmergency).toBe(false);
    expect(tenants.get(DISTRICT)!.emergencyStatus).toBe('INACTIVE');

    // SIDEWAYS: the sibling school must stay on normal content.
    expect((await manifestFor('scr-b1')).isEmergency).toBe(false);
    expect(tenants.get(SCHOOL_B)!.emergencyStatus).toBe('INACTIVE');

    expect(publishedChannels()).not.toContain(`tenant:${DISTRICT}`);
    expect(publishedChannels()).not.toContain(`tenant:${SCHOOL_B}`);
  });

  // ── 3. scope authorization ───────────────────────────────────────────────

  it('a SCHOOL_ADMIN cannot trigger at DISTRICT scope', async () => {
    await expect(
      emergency.triggerEmergency(lockdown(DISTRICT) as any, schoolAAdmin),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
    expect(tenants.get(DISTRICT)!.emergencyStatus).toBe('INACTIVE');
  });

  it('a SCHOOL_ADMIN cannot trigger at a SIBLING school’s scope', async () => {
    await expect(
      emergency.triggerEmergency(lockdown(SCHOOL_B) as any, schoolAAdmin),
    ).rejects.toThrow(ForbiddenException);
    expect(tenants.get(SCHOOL_B)!.emergencyStatus).toBe('INACTIVE');
  });

  it('a SCHOOL_ADMIN cannot all-clear at DISTRICT scope either', async () => {
    await emergency.triggerEmergency(lockdown(DISTRICT) as any, districtAdmin);
    await expect(
      emergency.clearEmergency('o-district', { scopeType: 'tenant', scopeId: DISTRICT } as any, schoolAAdmin),
    ).rejects.toThrow(ForbiddenException);
    expect(tenants.get(DISTRICT)!.emergencyStatus).toBe('CRITICAL');
  });

  it('a DISTRICT_ADMIN of ANOTHER district cannot reach into this one', async () => {
    const foreign = { user: { id: 'x', role: 'DISTRICT_ADMIN', tenantId: OTHER_DISTRICT } };
    await expect(
      emergency.triggerEmergency(lockdown(DISTRICT) as any, foreign),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      emergency.triggerEmergency(lockdown(SCHOOL_A) as any, foreign),
    ).rejects.toThrow(ForbiddenException);
  });

  it('a DISTRICT_ADMIN MAY target one school inside their own district', async () => {
    const res: any = await emergency.triggerEmergency(lockdown(SCHOOL_B, 'o-b') as any, districtAdmin);
    expect(res.success).toBe(true);
    expect((await manifestFor('scr-b1')).isEmergency).toBe(true);
    // Scoped to that school only — the rest of the district is unaffected.
    expect((await manifestFor('scr-a1')).isEmergency).toBe(false);
    expect((await manifestFor('scr-district')).isEmergency).toBe(false);
  });

  // ── 4. all-clear symmetry ────────────────────────────────────────────────

  it('a district all-clear clears the WHOLE subtree — tenant rows, override rows and manifests', async () => {
    // Location-based mode on for school-a so the trigger also materializes
    // per-screen override rows: an all-clear that clears the tenant row but
    // leaves those behind puts a rebooted screen straight back into lockdown.
    tenants.get(SCHOOL_A)!.locationBasedEmergencyEnabled = true;

    await emergency.triggerEmergency(lockdown(DISTRICT) as any, districtAdmin);
    expect(overrides.size).toBeGreaterThan(0);
    for (const s of ['scr-district', 'scr-a1', 'scr-b1', 'scr-annex']) {
      expect((await manifestFor(s)).isEmergency).toBe(true);
    }

    const cleared: any = await emergency.clearEmergency(
      'o-district', { scopeType: 'tenant', scopeId: DISTRICT } as any, districtAdmin,
    );
    expect(cleared.success).toBe(true);
    expect(cleared.affectedTenantCount).toBe(4);

    for (const id of [DISTRICT, SCHOOL_A, SCHOOL_B, ANNEX]) {
      const row = tenants.get(id)!;
      expect(row.emergencyStatus).toBe('INACTIVE');
      expect(row.emergencyType).toBeNull();
      expect(row.emergencyPlaylistId).toBeNull();
      expect(row.emergencyPortraitPlaylistId).toBeNull();
    }
    // Every per-screen override under the subtree is gone.
    expect(overrides.size).toBe(0);

    for (const s of ['scr-district', 'scr-a1', 'scr-a2', 'scr-b1', 'scr-annex']) {
      expect((await manifestFor(s)).isEmergency).toBe(false);
    }

    expect(publishedChannels().filter((c) => c === `tenant:${ANNEX}`)).toHaveLength(2); // trigger + clear
  });

  // ── 5. a screen that arrives mid-lockdown ────────────────────────────────

  it('a screen paired DURING an active district lockdown sees it on its first manifest', async () => {
    await emergency.triggerEmergency(lockdown(DISTRICT) as any, districtAdmin);

    // Brand-new kiosk, first poll ever, in an existing school.
    screenRows.set('scr-new', screenOf('scr-new', SCHOOL_B));
    const m = await manifestFor('scr-new');
    expect(m.isEmergency).toBe(true);
    expect(m.emergencyType).toBe('LOCKDOWN');
  });

  it('a school CREATED during an active district lockdown inherits it (manifest safety net)', async () => {
    await emergency.triggerEmergency(lockdown(DISTRICT) as any, districtAdmin);

    // Fan-out cannot have written a row for a tenant that did not exist when
    // it ran. The manifest's ancestor walk is what covers this.
    tenants.set('school-c', tenant('school-c', DISTRICT));
    screenRows.set('scr-c1', screenOf('scr-c1', 'school-c'));

    const m = await manifestFor('scr-c1');
    expect(m.isEmergency).toBe(true);
    expect(m.emergencyType).toBe('LOCKDOWN');
    expect(m.emergencyInheritedFromTenantId).toBe(DISTRICT);
    // The row itself was never written — this is inheritance, not fan-out.
    expect(tenants.get('school-c')!.emergencyStatus).toBe('INACTIVE');
  });

  it('inheritance walks MULTIPLE hops (annex → school-a → district)', async () => {
    await emergency.triggerEmergency(lockdown(DISTRICT) as any, districtAdmin);
    // Simulate an out-of-band reset of the two rows between the annex and
    // the district (Studio edit / partial restore).
    Object.assign(tenants.get(ANNEX)!, { emergencyStatus: 'INACTIVE', emergencyType: null });
    Object.assign(tenants.get(SCHOOL_A)!, { emergencyStatus: 'INACTIVE', emergencyType: null });
    for (const id of ALL_TENANTS) invalidateTenantState(id);

    const m = await manifestFor('scr-annex');
    expect(m.isEmergency).toBe(true);
    expect(m.emergencyInheritedFromTenantId).toBe(DISTRICT);
  });

  it('one school clearing itself does NOT cancel a district-wide lockdown', async () => {
    await emergency.triggerEmergency(lockdown(DISTRICT) as any, districtAdmin);

    // A school admin hits all-clear for their own building.
    await emergency.clearEmergency(
      'o-district', { scopeType: 'tenant', scopeId: SCHOOL_A } as any, schoolAAdmin,
    );
    expect(tenants.get(SCHOOL_A)!.emergencyStatus).toBe('INACTIVE');

    // The district incident is still live, so the school's screens stay
    // locked down via inheritance. One building's admin does not get to
    // cancel a district-wide incident.
    const m = await manifestFor('scr-a1');
    expect(m.isEmergency).toBe(true);
    expect(m.emergencyInheritedFromTenantId).toBe(DISTRICT);
    // ...and the district office was never touched by that school-scoped clear.
    expect(tenants.get(DISTRICT)!.emergencyStatus).toBe('CRITICAL');
  });

  it('an ARCHIVED location neither fans out nor inherits (both mechanisms agree)', async () => {
    await emergency.triggerEmergency(lockdown(DISTRICT) as any, districtAdmin);

    // Fan-out skipped it...
    expect(tenants.get(ARCHIVED)!.emergencyStatus).toBe('INACTIVE');
    expect(triggerRowsFor(ARCHIVED)).toHaveLength(0);
    expect(publishedChannels()).not.toContain(`tenant:${ARCHIVED}`);
    // ...so inheritance must skip it too, or a district lockdown would light
    // up the leftover screens of every retired/test tenant (120 exist in
    // production) with no audit row, webhook or bus message naming them.
    const m = await manifestFor('scr-archived');
    expect(m.isEmergency).toBe(false);
    expect(m.emergencyInheritedFromTenantId).toBeUndefined();
  });

  it('a screen whose tenant has no parent never pays for an ancestor lookup', async () => {
    const before = prisma.client.tenant.findUnique.mock.calls.length;
    const m = await manifestFor('scr-district'); // DISTRICT.parentId === null
    expect(m.isEmergency).toBe(false);
    // The invariant is NO ANCESTOR WALK — every tenant read the manifest
    // makes must target the screen's OWN tenant, never a parent. (Until
    // 2026-08-16 the count-based proxy `=== 1` worked because the second
    // own-tenant read — the "paired with: <name>" manifest field — was
    // hidden inside a Prisma `include` the mock never counted. The include
    // was split into an explicit parallel findUnique for the round-trip
    // win, so assert the actual invariant instead of the call count.)
    const newCalls = prisma.client.tenant.findUnique.mock.calls.slice(before);
    expect(newCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of newCalls) {
      expect(call[0]?.where?.id).toBe(DISTRICT); // own tenant only — no walk
    }
  });

  // ── 6. audit ─────────────────────────────────────────────────────────────

  it('writes an immutable audit row per AFFECTED TENANT, with hierarchy provenance', async () => {
    await emergency.triggerEmergency(lockdown(DISTRICT) as any, districtAdmin);

    for (const id of [DISTRICT, SCHOOL_A, SCHOOL_B, ANNEX]) {
      const rows = triggerRowsFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(
        expect.objectContaining({
          action: 'TRIGGER_EMERGENCY',
          targetType: 'tenant',
          targetId: id,
          tenantId: id,
          userId: 'dadmin',
        }),
      );
      const details = JSON.parse(rows[0].details);
      expect(details.overrideId).toBe('o-district');
      expect(details.type).toBe('LOCKDOWN');
      expect(details.originTenantId).toBe(DISTRICT);
      expect(details.propagatedFromTenantId).toBe(id === DISTRICT ? null : DISTRICT);
      expect(details.subtreeTenantCount).toBe(4);
    }

    // No forensic row for a tenant that was never touched.
    expect(triggerRowsFor(ARCHIVED)).toHaveLength(0);
    expect(triggerRowsFor(OTHER_SCHOOL)).toHaveLength(0);
  });

  it('writes a CLEAR audit row per affected tenant too', async () => {
    await emergency.triggerEmergency(lockdown(DISTRICT) as any, districtAdmin);
    await emergency.clearEmergency(
      'o-district', { scopeType: 'tenant', scopeId: DISTRICT } as any, districtAdmin,
    );

    for (const id of [DISTRICT, SCHOOL_A, SCHOOL_B, ANNEX]) {
      const rows = auditLogs.filter((r) => r.action === 'CLEAR_EMERGENCY' && r.tenantId === id);
      expect(rows).toHaveLength(1);
      const details = JSON.parse(rows[0].details);
      expect(details.originTenantId).toBe(DISTRICT);
      expect(details.propagatedFromTenantId).toBe(id === DISTRICT ? null : DISTRICT);
    }
    expect(auditLogs.filter((r) => r.action === 'CLEAR_EMERGENCY' && r.tenantId === ARCHIVED)).toHaveLength(0);
  });

  // ── 7. degraded paths ────────────────────────────────────────────────────

  it('a Redis failure on ONE school still fans out to the rest (poll tier covers it)', async () => {
    redis.publish.mockImplementation(async (channel: string) => {
      if (channel === `tenant:${SCHOOL_A}`) throw new Error('redis down');
      return true as any;
    });

    const res: any = await emergency.triggerEmergency(lockdown(DISTRICT) as any, districtAdmin);
    expect(res.success).toBe(true);
    expect(publishedChannels()).toEqual(
      expect.arrayContaining([`tenant:${SCHOOL_B}`, `tenant:${ANNEX}`]),
    );
    // The DB fan-out is what the manifest reads, so school-a is still locked.
    expect((await manifestFor('scr-a1')).isEmergency).toBe(true);
  });
  // ── EM-01 (2026-08-04) ────────────────────────────────────────────────────
  // Trigger fanned out to every descendant; BROADCAST and MEDIA-ALERT did not.
  // They published one channel and wrote one row, so on the documented
  // production shape (the district owns no screens directly) a district-wide
  // text broadcast or evacuation-map alert reached NOBODY — while still
  // returning `{ success: true }`, so the operator believed every school had it.
  it('a district TEXT BROADCAST reaches every descendant tenant (bus + poll)', async () => {
    const res: any = await emergency.broadcastText(
      { scopeType: 'tenant', scopeId: DISTRICT, text: 'Shelter in place', severity: 'CRITICAL' } as any,
      districtAdmin,
    );

    expect(res.success).toBe(true);
    // Bus tier: one publish per tenant — the gateway matches a `tenant:` publish
    // against the DEVICE's own tenantId, so this is what reaches a child screen.
    expect(publishedChannels()).toEqual(
      expect.arrayContaining([`tenant:${DISTRICT}`, `tenant:${SCHOOL_A}`, `tenant:${SCHOOL_B}`, `tenant:${ANNEX}`]),
    );
    // Poll tier: one row per tenant, since deviceMessages filters on the
    // screen's OWN tenantId with no ancestor walk.
    const tenantsWithRow = emergencyMessages.filter((m) => m.type === 'TEXT_BROADCAST').map((m) => m.tenantId);
    expect(tenantsWithRow).toEqual(expect.arrayContaining([DISTRICT, SCHOOL_A, SCHOOL_B, ANNEX]));
    // Reach is reported so the UI can say "N locations" instead of guessing.
    expect(res.affectedTenantCount).toBe(tenantsWithRow.length);
    // Isolation still holds.
    expect(publishedChannels()).not.toContain(`tenant:${OTHER_SCHOOL}`);
    expect(tenantsWithRow).not.toContain(OTHER_SCHOOL);
  });

  it('a district MEDIA ALERT fans out the same way', async () => {
    const res: any = await emergency.mediaAlert(
      { scopeType: 'tenant', scopeId: DISTRICT, mediaUrls: [], severity: 'CRITICAL', textBlob: 'Evacuate' } as any,
      districtAdmin,
    );

    expect(res.success).toBe(true);
    expect(publishedChannels()).toEqual(
      expect.arrayContaining([`tenant:${SCHOOL_A}`, `tenant:${SCHOOL_B}`, `tenant:${ANNEX}`]),
    );
    const tenantsWithRow = emergencyMessages.filter((m) => m.type === 'MEDIA_ALERT').map((m) => m.tenantId);
    expect(tenantsWithRow).toEqual(expect.arrayContaining([SCHOOL_A, SCHOOL_B, ANNEX]));
  });

  it('a SCHOOL-scoped broadcast still does NOT leak upward or sideways', async () => {
    await emergency.broadcastText(
      { scopeType: 'tenant', scopeId: SCHOOL_B, text: 'Gym closed', severity: 'INFO' } as any,
      districtAdmin,
    );
    expect(publishedChannels()).not.toContain(`tenant:${DISTRICT}`);
    expect(publishedChannels()).not.toContain(`tenant:${SCHOOL_A}`);
    const tenants = emergencyMessages.map((m) => m.tenantId);
    expect(tenants).not.toContain(DISTRICT);
    expect(tenants).not.toContain(SCHOOL_A);
  });
});
