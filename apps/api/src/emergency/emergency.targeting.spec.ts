/**
 * ALERT TARGETING — every scope, every delivery path, end to end (2026-10-05).
 *
 * The owner asked for "all screens, a group, or single screens". The API has
 * accepted `scopeType: 'tenant' | 'group' | 'device'` for a long time, but no
 * operator surface ever sent anything except `tenant`. Before any UI offers a
 * group or a single screen, this suite proves — against the REAL emergency
 * controller writing into, and the REAL manifest handler reading from, ONE
 * stateful in-memory store — that each scope reaches exactly the screens it
 * names, through every path a screen can learn about an alert:
 *
 *   1. the signed WS/SSE push            → the Redis channel(s) published to;
 *   2. the manifest's `isEmergency`      → the HTTP backstop the web page polls
 *                                          AND the only field Player 1.1.22's
 *                                          native panel-off watch reads;
 *   3. the `emergency-rev` revision      → must MOVE so a screen on the cheap
 *                                          poll fetches its manifest (a raise
 *                                          descriptor rides it for tenant
 *                                          scope only, by design).
 *
 * and that the all-clear for an alert ends EXACTLY that alert: every screen it
 * lit goes back to what it would otherwise show, and nothing outside it moves.
 *
 * The store deliberately does NOT bump the manifest content revision on
 * override writes (as if the Prisma `$use` hook were not armed). So when this
 * suite says "the revision moved", it moved because the controller bumped the
 * tenant emergency epoch — the path that does not depend on the hook.
 *
 * FIXTURE
 *   district ─┬─ school   gym-1, gym-2 (group GYM) · lobby · office
 *             │           front (group FRONT) + back (its second face, NO group)
 *             └─ sibling  sib-1 (group SIB)
 *   district-1 sits on the district itself.
 *   other      other-1 (group OTHER)
 *   stray      a screen of `other` whose screenGroupId still points at GYM —
 *              legacy data from before ISO-01 (2026-08-04) refused that bind.
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EmergencyController } from './emergency.controller';
import { ScreensController } from '../screens/screens.controller';
import { invalidateTenantState, resetManifestCacheForTests } from '../screens/manifest-hot-cache';
import {
  localTenantEmergencyEpoch,
  resetEmergencyRevForTests,
  resolveEmergencyRev,
} from '../screens/emergency-rev';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const DISTRICT = 'district';
const SCHOOL = 'school';
const SIBLING = 'sibling';
const OTHER = 'other';

const GYM = 'group-gym';
const FRONT_GROUP = 'group-front';
const SIB_GROUP = 'group-sib';
const OTHER_GROUP = 'group-other';

type Row = Record<string, any>;

function tenantRow(id: string, parentId: string | null, extra: Row = {}): Row {
  return {
    id,
    name: `${id} name`,
    parentId,
    archivedAt: null,
    emergencyStatus: 'INACTIVE',
    emergencyType: null,
    emergencyPlaylistId: null,
    emergencyPortraitPlaylistId: null,
    locationBasedEmergencyEnabled: false,
    ...extra,
  };
}

function screenRow(id: string, tenantId: string, extra: Row = {}): Row {
  return {
    id,
    tenantId,
    name: `${id} name`,
    screenGroupId: null,
    status: 'ONLINE',
    resolution: '1920x1080',
    canvasW: null,
    canvasH: null,
    repeats: 1,
    config: null,
    activeBoardGameId: null,
    faceOfScreenId: null,
    faceIndex: null,
    faceContentMode: null,
    ...extra,
  };
}

const idMatches = (value: any, clause: any): boolean => {
  if (clause === undefined) return true;
  if (clause === null) return value === null || value === undefined;
  if (clause && typeof clause === 'object') {
    if (Array.isArray(clause.in)) return clause.in.includes(value);
    if ('not' in clause) return value !== clause.not;
  }
  return value === clause;
};

function makeWorld() {
  const tenants = new Map<string, Row>(
    [
      tenantRow(DISTRICT, null),
      tenantRow(SCHOOL, DISTRICT),
      tenantRow(SIBLING, DISTRICT),
      tenantRow(OTHER, null),
    ].map((t) => [t.id, t]),
  );
  const groups = new Map<string, Row>(
    [
      { id: GYM, tenantId: SCHOOL, name: 'Gym' },
      { id: FRONT_GROUP, tenantId: SCHOOL, name: 'Front entrance' },
      { id: SIB_GROUP, tenantId: SIBLING, name: 'Sibling hall' },
      { id: OTHER_GROUP, tenantId: OTHER, name: 'Other hall' },
    ].map((g) => [g.id, g]),
  );
  const screens = new Map<string, Row>(
    [
      screenRow('gym-1', SCHOOL, { screenGroupId: GYM }),
      screenRow('gym-2', SCHOOL, { screenGroupId: GYM, resolution: '1080x1920' }),
      screenRow('lobby', SCHOOL, { location: 'Main entrance' }),
      screenRow('office', SCHOOL),
      screenRow('front', SCHOOL, { screenGroupId: FRONT_GROUP }),
      // The back side of `front`. Created in the front's group; the front was
      // later moved, the back was not — group membership is per row.
      screenRow('back', SCHOOL, { faceOfScreenId: 'front', faceIndex: 1, faceContentMode: 'MIRROR' }),
      screenRow('sib-1', SIBLING, { screenGroupId: SIB_GROUP }),
      screenRow('district-1', DISTRICT),
      screenRow('other-1', OTHER, { screenGroupId: OTHER_GROUP }),
      screenRow('stray', OTHER, { screenGroupId: GYM }),
    ].map((s) => [s.id, s]),
  );
  const overrides = new Map<string, Row>();
  const auditLogs: Row[] = [];
  const published: string[] = [];
  let overrideSeq = 0;

  const screenMatches = (row: Row, where: any): boolean => {
    if (!where) return true;
    if (where.tenantId !== undefined && !idMatches(row.tenantId, where.tenantId)) return false;
    if (where.id !== undefined && !idMatches(row.id, where.id)) return false;
    if (where.screenGroupId !== undefined && !idMatches(row.screenGroupId, where.screenGroupId)) return false;
    if (where.faceOfScreenId !== undefined && !idMatches(row.faceOfScreenId, where.faceOfScreenId)) return false;
    if (Array.isArray(where.OR) && !where.OR.some((c: any) => screenMatches(row, c))) return false;
    return true;
  };

  const overrideMatches = (row: Row, where: any): boolean => {
    if (!where) return true;
    if (where.tenantId !== undefined && !idMatches(row.tenantId, where.tenantId)) return false;
    if (where.screenId !== undefined && !idMatches(row.screenId, where.screenId)) return false;
    if (where.alertId !== undefined && !idMatches(row.alertId ?? null, where.alertId)) return false;
    if (where.scopeType !== undefined && !idMatches(row.scopeType ?? null, where.scopeType)) return false;
    if (where.triggeredAt !== undefined) {
      const a = row.triggeredAt instanceof Date ? row.triggeredAt.getTime() : NaN;
      const b = where.triggeredAt instanceof Date ? where.triggeredAt.getTime() : NaN;
      if (a !== b) return false;
    }
    if (Array.isArray(where.OR) && !where.OR.some((c: any) => overrideMatches(row, c))) return false;
    return true;
  };

  const client: any = {
    tenant: {
      findUnique: jest.fn(async ({ where }: any) => {
        const t = tenants.get(where.id);
        return t ? { ...t } : null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        [...tenants.values()]
          .filter((t) => (where?.parentId === undefined ? true : idMatches(t.parentId, where.parentId)))
          .filter((t) => (where?.id === undefined ? true : idMatches(t.id, where.id)))
          .filter((t) => (where?.archivedAt === null ? t.archivedAt === null : true))
          .map((t) => ({ ...t })),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const t = tenants.get(where.id);
        if (t) Object.assign(t, data);
        return t;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const t of tenants.values()) {
          if (!idMatches(t.id, where?.id)) continue;
          Object.assign(t, data);
          count++;
        }
        return { count };
      }),
    },
    screenGroup: {
      findUnique: jest.fn(async ({ where }: any) => {
        const g = groups.get(where.id);
        return g ? { ...g } : null;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        const g = groups.get(where.id);
        if (!g) return null;
        if (where.tenantId !== undefined && !idMatches(g.tenantId, where.tenantId)) return null;
        return { ...g };
      }),
      findMany: jest.fn(async ({ where }: any = {}) =>
        [...groups.values()]
          .filter((g) => idMatches(g.tenantId, where?.tenantId))
          .filter((g) => idMatches(g.id, where?.id))
          .map((g) => ({ ...g })),
      ),
    },
    screen: {
      findUnique: jest.fn(async ({ where }: any) => {
        const s = screens.get(where.id);
        if (!s) return null;
        return { ...s, screenGroup: null, tenant: { name: tenants.get(s.tenantId)?.name ?? null } };
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        const s = [...screens.values()].find((r) => screenMatches(r, where));
        return s ? { ...s } : null;
      }),
      findMany: jest.fn(async ({ where }: any = {}) =>
        [...screens.values()].filter((s) => screenMatches(s, where)).map((s) => ({ ...s })),
      ),
      update: jest.fn(async () => ({})),
      count: jest.fn(async ({ where }: any = {}) =>
        [...screens.values()].filter((s) => screenMatches(s, where)).length,
      ),
    },
    screenEmergencyOverride: {
      findUnique: jest.fn(async ({ where }: any) => {
        const o = overrides.get(where.screenId);
        return o ? { ...o } : null;
      }),
      findFirst: jest.fn(async ({ where }: any = {}) => {
        const o = [...overrides.values()].find((r) => overrideMatches(r, where));
        return o ? { ...o } : null;
      }),
      findMany: jest.fn(async ({ where }: any = {}) =>
        [...overrides.values()].filter((r) => overrideMatches(r, where)).map((r) => ({ ...r })),
      ),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = overrides.get(where.screenId);
        const row = existing
          ? { ...existing, ...update }
          : { id: `ovrow-${++overrideSeq}`, triggeredAt: new Date(), ...create, screenId: where.screenId };
        overrides.set(where.screenId, row);
        return { ...row };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = overrides.get(where.screenId);
        if (!existing) throw new Error(`no override row for ${where.screenId}`);
        const row = { ...existing, ...data };
        overrides.set(where.screenId, row);
        return { ...row };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const [screenId, row] of [...overrides.entries()]) {
          if (!overrideMatches(row, where)) continue;
          overrides.set(screenId, { ...row, ...data });
          count++;
        }
        return { count };
      }),
      delete: jest.fn(async ({ where }: any) => {
        const existing = overrides.get(where.screenId);
        overrides.delete(where.screenId);
        return existing;
      }),
      deleteMany: jest.fn(async ({ where }: any = {}) => {
        let count = 0;
        for (const [screenId, row] of [...overrides.entries()]) {
          if (!overrideMatches(row, where)) continue;
          overrides.delete(screenId);
          count++;
        }
        return { count };
      }),
    },
    playlist: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => null),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      }),
    },
    emergencyMessage: {
      create: jest.fn(async ({ data }: any) => data),
      findMany: jest.fn(async () => []),
    },
    schedule: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    game: { findFirst: jest.fn(async () => null) },
    displaySchedule: { findMany: jest.fn(async () => []) },
    displayVendorRecipe: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (ops: any) => {
      if (typeof ops === 'function') return ops(client);
      const out: any[] = [];
      // Prisma runs an array transaction's statements in order.
      for (const op of ops) out.push(await op);
      return out;
    }),
  };
  const prisma: any = { client };

  const redis: any = {
    publish: jest.fn(async (channel: string) => {
      published.push(channel);
      return true;
    }),
    isConnected: () => false,
    getString: jest.fn(async () => null),
    setString: jest.fn(async () => true),
    delKey: jest.fn(async () => true),
  };

  const emergency = new EmergencyController(
    redis,
    prisma,
    { signMessage: jest.fn((type: string, payload: any) => ({ type, payload, signature: 'sig', timestamp: Date.now() })) } as any,
    { dispatch: jest.fn() } as any,
    { driveStatusLampForEmergency: jest.fn(async () => ({ touched: 0 })) } as any,
  );
  const screensController = new ScreensController(prisma, redis, {} as any, {} as any, {} as any, {} as any);

  async function manifest(screenId: string): Promise<any> {
    let body: any = null;
    const res: any = {
      setHeader: jest.fn(),
      status: jest.fn(() => res),
      json: jest.fn((payload: any) => {
        body = payload;
        return res;
      }),
      send: jest.fn(() => res),
      end: jest.fn(() => res),
    };
    await screensController.getManifest(screenId, { headers: {} } as any, res);
    return body;
  }

  async function isEmergency(screenId: string): Promise<boolean> {
    return (await manifest(screenId))?.isEmergency === true;
  }

  async function rev(screenId: string) {
    return resolveEmergencyRev({}, screenId, screens.get(screenId)!.tenantId);
  }

  return { tenants, groups, screens, overrides, auditLogs, published, client, redis, emergency, manifest, isEmergency, rev };
}

const SCHOOL_IDS = ['gym-1', 'gym-2', 'lobby', 'office', 'front', 'back'];
const OUTSIDE_SCHOOL = ['sib-1', 'district-1', 'other-1', 'stray'];
const EVERY_SCREEN = [...SCHOOL_IDS, ...OUTSIDE_SCHOOL];

const schoolAdmin = { user: { id: 'u-school', role: 'SCHOOL_ADMIN', tenantId: SCHOOL } };
const districtAdmin = { user: { id: 'u-district', role: 'DISTRICT_ADMIN', tenantId: DISTRICT } };
// A delegated staffer: no admin role, `canTriggerPanic` granted. The RBAC
// guard admits them on @AllowPanicBypass routes; the controller's scope rule
// must then confine them to their OWN tenant like any non-district caller.
const delegatedStaff = { user: { id: 'u-staff', role: 'CONTRIBUTOR', tenantId: SCHOOL, canTriggerPanic: true } };

const trigger = (scopeType: 'tenant' | 'group' | 'device', scopeId: string, type = 'lockdown', overrideId?: string) =>
  ({
    scopeType,
    scopeId,
    overridePayload: { type, severity: 'CRITICAL', ...(overrideId ? { overrideId } : {}) },
  }) as any;

const clear = (scopeType: 'tenant' | 'group' | 'device', scopeId: string) => ({ scopeType, scopeId }) as any;

async function emergencyMap(w: ReturnType<typeof makeWorld>, ids: string[] = EVERY_SCREEN) {
  const out: Record<string, boolean> = {};
  for (const id of ids) out[id] = await w.isEmergency(id);
  return out;
}

const only = (lit: string[], ids: string[] = EVERY_SCREEN) =>
  Object.fromEntries(ids.map((id) => [id, lit.includes(id)]));

beforeEach(() => {
  resetManifestCacheForTests();
  resetEmergencyRevForTests('origin-targeting');
  for (const id of [DISTRICT, SCHOOL, SIBLING, OTHER]) invalidateTenantState(id);
});

// ═══ 1. THE MATRIX — scope × delivery path × targeted / not × all-clear ═══

describe('tenant scope ("All screens") — today’s flow', () => {
  it('lights every screen of the tenant and nothing outside it, then all-clears', async () => {
    const w = makeWorld();
    expect(await emergencyMap(w)).toEqual(only([]));
    const before: Record<string, string> = {};
    for (const id of EVERY_SCREEN) before[id] = (await w.rev(id)).rev;

    const res: any = await w.emergency.triggerEmergency(trigger('tenant', SCHOOL), schoolAdmin);
    expect(res.success).toBe(true);

    // push: one channel, the school's own
    expect(w.published).toEqual([`tenant:${SCHOOL}`]);
    // manifest: every school screen, nobody else
    expect(await emergencyMap(w)).toEqual(only(SCHOOL_IDS));
    // rev: moved for the school's screens, with the tenant raise descriptor
    for (const id of SCHOOL_IDS) {
      const r = await w.rev(id);
      expect(r.rev).not.toBe(before[id]);
    }
    expect(localTenantEmergencyEpoch(SCHOOL)?.active).toBe(true);
    // rev: untouched for every other tenant's screens
    for (const id of ['sib-1', 'district-1', 'other-1', 'stray']) {
      expect((await w.rev(id)).rev).toBe(before[id]);
    }

    const cleared: any = await w.emergency.clearEmergency(res.overrideId, clear('tenant', SCHOOL), schoolAdmin);
    expect(cleared.success).toBe(true);
    expect(await emergencyMap(w)).toEqual(only([]));
    expect(localTenantEmergencyEpoch(SCHOOL)?.active).toBe(false);
  });

  it('audits the scope it was sent to', async () => {
    const w = makeWorld();
    const res: any = await w.emergency.triggerEmergency(trigger('tenant', SCHOOL), schoolAdmin);
    await w.emergency.clearEmergency(res.overrideId, clear('tenant', SCHOOL), schoolAdmin);
    const t = w.auditLogs.find((a) => a.action === 'TRIGGER_EMERGENCY');
    const c = w.auditLogs.find((a) => a.action === 'CLEAR_EMERGENCY');
    expect(t).toMatchObject({ targetType: 'tenant', targetId: SCHOOL, tenantId: SCHOOL, userId: 'u-school' });
    expect(c).toMatchObject({ targetType: 'tenant', targetId: SCHOOL, tenantId: SCHOOL, userId: 'u-school' });
  });
});

describe('group scope', () => {
  it('lights exactly the group’s screens on every path, then all-clears them', async () => {
    const w = makeWorld();
    for (const id of EVERY_SCREEN) await w.manifest(id); // every screen has polled once
    const before: Record<string, string> = {};
    for (const id of EVERY_SCREEN) before[id] = (await w.rev(id)).rev;

    const res: any = await w.emergency.triggerEmergency(trigger('group', GYM), schoolAdmin);
    expect(res.success).toBe(true);

    // push: the group channel
    expect(w.published).toContain(`group:${GYM}`);
    // manifest: gym-1 and gym-2 — and NOT the stray screen of another tenant
    // that still carries the gym's group id from before ISO-01.
    expect(await emergencyMap(w)).toEqual(only(['gym-1', 'gym-2']));
    const m = await w.manifest('gym-2');
    expect(m.emergencyType).toBe('LOCKDOWN');
    expect(m.emergencyScope).toBe('screen');

    // rev: moved for the targeted screens. No raise descriptor (that fast
    // path is tenant-wide only), so the screen fetches its manifest — which
    // says isEmergency:true (asserted above).
    for (const id of ['gym-1', 'gym-2']) {
      const r = await w.rev(id);
      expect(r.rev).not.toBe(before[id]);
      expect(r.alert).toBeNull();
    }
    // The tenant-wide flag is NOT raised by a group alert.
    expect(localTenantEmergencyEpoch(SCHOOL)?.active ?? false).toBe(false);
    // Another tenant's revision does not move at all.
    expect((await w.rev('other-1')).rev).toBe(before['other-1']);
    expect((await w.rev('stray')).rev).toBe(before['stray']);

    for (const id of EVERY_SCREEN) await w.manifest(id);
    const mid: Record<string, string> = {};
    for (const id of EVERY_SCREEN) mid[id] = (await w.rev(id)).rev;

    const cleared: any = await w.emergency.clearEmergency(res.overrideId, clear('group', GYM), schoolAdmin);
    expect(cleared.success).toBe(true);
    expect(w.published).toContain(`group:${GYM}`);
    // The revision moves on the way OUT too — checked BEFORE any manifest
    // fetch, so it is the all-clear's own epoch bump that moved it, not a
    // fresh manifest build (gap G6).
    for (const id of ['gym-1', 'gym-2']) expect((await w.rev(id)).rev).not.toBe(mid[id]);
    expect(await emergencyMap(w)).toEqual(only([]));
  });

  it('reaches BOTH sides of a display whose back side is not in the group', async () => {
    // A face is created in its front's group, but group membership is per
    // row: move the front and the back stays behind. A group lockdown that
    // lit the front while the back kept showing the lunch menu is the exact
    // failure the device scope already guards against (emergency.faces.spec).
    const w = makeWorld();
    const res: any = await w.emergency.triggerEmergency(trigger('group', FRONT_GROUP), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only(['front', 'back']));
    expect(w.published).toEqual(expect.arrayContaining([`group:${FRONT_GROUP}`, 'device:back']));

    await w.emergency.clearEmergency(res.overrideId, clear('group', FRONT_GROUP), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only([]));
  });

  it('a screen MOVED OUT of the group mid-alert is still released by that alert’s all-clear', async () => {
    // The all-clear used to delete the rows of the group's CURRENT members,
    // so a screen moved out mid-incident kept its lockdown row forever —
    // stuck on lockdown after the operator was told it was over (the
    // emergency-003 class).
    const w = makeWorld();
    const res: any = await w.emergency.triggerEmergency(trigger('group', GYM), schoolAdmin);
    w.screens.get('gym-2')!.screenGroupId = null;

    await w.emergency.clearEmergency(res.overrideId, clear('group', GYM), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only([]));
  });

  it('a screen MOVED INTO the group mid-alert keeps its own alert when the group clears', async () => {
    const w = makeWorld();
    const lobbyAlert: any = await w.emergency.triggerEmergency(trigger('device', 'lobby', 'medical'), schoolAdmin);
    const gymAlert: any = await w.emergency.triggerEmergency(trigger('group', GYM), schoolAdmin);
    w.screens.get('lobby')!.screenGroupId = GYM;

    await w.emergency.clearEmergency(gymAlert.overrideId, clear('group', GYM), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only(['lobby']));
    expect((await w.manifest('lobby')).emergencyType).toBe('MEDICAL');

    await w.emergency.clearEmergency(lobbyAlert.overrideId, clear('device', 'lobby'), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only([]));
  });

  it('audits the group, the screens it reached, and the clear', async () => {
    const w = makeWorld();
    const res: any = await w.emergency.triggerEmergency(trigger('group', GYM), schoolAdmin);
    await w.emergency.clearEmergency(res.overrideId, clear('group', GYM), schoolAdmin);
    const t = w.auditLogs.find((a) => a.action === 'TRIGGER_EMERGENCY')!;
    expect(t).toMatchObject({ targetType: 'group', targetId: GYM, tenantId: SCHOOL, userId: 'u-school' });
    const td = JSON.parse(t.details);
    expect(td).toMatchObject({ overrideId: res.overrideId, scopeType: 'group', scopeId: GYM, affectedScreenCount: 2 });
    expect([...td.affectedScreenIds].sort()).toEqual(['gym-1', 'gym-2']);
    const c = w.auditLogs.find((a) => a.action === 'CLEAR_EMERGENCY')!;
    expect(c).toMatchObject({ targetType: 'group', targetId: GYM, tenantId: SCHOOL });
    const cd = JSON.parse(c.details);
    expect(cd).toMatchObject({ overrideId: res.overrideId, scopeType: 'group', scopeId: GYM });
    expect([...cd.clearedScreenIds].sort()).toEqual(['gym-1', 'gym-2']);
  });
});

describe('device scope (one screen)', () => {
  it('lights exactly that screen on every path, then all-clears it', async () => {
    const w = makeWorld();
    for (const id of EVERY_SCREEN) await w.manifest(id);
    const before: Record<string, string> = {};
    for (const id of EVERY_SCREEN) before[id] = (await w.rev(id)).rev;

    const res: any = await w.emergency.triggerEmergency(trigger('device', 'lobby'), schoolAdmin);
    expect(w.published).toEqual(['device:lobby']);
    expect(await emergencyMap(w)).toEqual(only(['lobby']));
    const r = await w.rev('lobby');
    expect(r.rev).not.toBe(before.lobby);
    expect(r.alert).toBeNull();
    expect((await w.rev('other-1')).rev).toBe(before['other-1']);
    const mid = (await w.rev('lobby')).rev; // record now says "lobby is in alert"

    await w.emergency.clearEmergency(res.overrideId, clear('device', 'lobby'), schoolAdmin);
    expect(w.published).toEqual(['device:lobby', 'device:lobby']);
    // Revision moved by the all-clear itself, before any manifest fetch (G6).
    expect((await w.rev('lobby')).rev).not.toBe(mid);
    expect(await emergencyMap(w)).toEqual(only([]));
  });

  it('naming either side of a double-sided display reaches the whole display', async () => {
    const w = makeWorld();
    const res: any = await w.emergency.triggerEmergency(trigger('device', 'back'), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only(['front', 'back']));
    await w.emergency.clearEmergency(res.overrideId, clear('device', 'back'), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only([]));
  });

  it('audits the screen it was sent to', async () => {
    const w = makeWorld();
    const res: any = await w.emergency.triggerEmergency(trigger('device', 'lobby'), schoolAdmin);
    await w.emergency.clearEmergency(res.overrideId, clear('device', 'lobby'), schoolAdmin);
    const t = w.auditLogs.find((a) => a.action === 'TRIGGER_EMERGENCY')!;
    expect(t).toMatchObject({ targetType: 'device', targetId: 'lobby', tenantId: SCHOOL });
    expect(JSON.parse(t.details)).toMatchObject({ scopeType: 'device', scopeId: 'lobby', affectedScreenIds: ['lobby'] });
    const c = w.auditLogs.find((a) => a.action === 'CLEAR_EMERGENCY')!;
    expect(c).toMatchObject({ targetType: 'device', targetId: 'lobby', tenantId: SCHOOL });
  });
});

// ═══ 2. SEVERAL ACTIVE ALERTS — each all-clear ends exactly its own ═══════

describe('several alerts with different targets', () => {
  it('clearing the whole-organisation alert leaves a one-screen alert running', async () => {
    const w = makeWorld();
    const whole: any = await w.emergency.triggerEmergency(trigger('tenant', SCHOOL, 'weather'), schoolAdmin);
    const nurse: any = await w.emergency.triggerEmergency(trigger('device', 'office', 'medical'), schoolAdmin);
    expect((await w.manifest('office')).emergencyType).toBe('MEDICAL');

    await w.emergency.clearEmergency(whole.overrideId, clear('tenant', SCHOOL), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only(['office']));
    expect((await w.manifest('office')).emergencyType).toBe('MEDICAL');

    await w.emergency.clearEmergency(nurse.overrideId, clear('device', 'office'), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only([]));
  });

  it('clearing a one-screen alert returns that screen to the whole-organisation alert', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(trigger('tenant', SCHOOL, 'weather'), schoolAdmin);
    const nurse: any = await w.emergency.triggerEmergency(trigger('device', 'office', 'medical'), schoolAdmin);
    await w.emergency.clearEmergency(nurse.overrideId, clear('device', 'office'), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only(SCHOOL_IDS));
    expect((await w.manifest('office')).emergencyType).toBe('WEATHER');
  });

  it('a one-screen alert inside a group alert: clearing it returns the screen to the group alert', async () => {
    const w = makeWorld();
    const gym: any = await w.emergency.triggerEmergency(trigger('group', GYM, 'lockdown'), schoolAdmin);
    const one: any = await w.emergency.triggerEmergency(trigger('device', 'gym-1', 'medical'), schoolAdmin);
    expect((await w.manifest('gym-1')).emergencyType).toBe('MEDICAL');

    await w.emergency.clearEmergency(one.overrideId, clear('device', 'gym-1'), schoolAdmin);
    // gym-1 is still inside an active lockdown — it must NOT go back to its
    // normal playlist.
    expect(await emergencyMap(w)).toEqual(only(['gym-1', 'gym-2']));
    expect((await w.manifest('gym-1')).emergencyType).toBe('LOCKDOWN');

    await w.emergency.clearEmergency(gym.overrideId, clear('group', GYM), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only([]));
  });

  it('a group alert over a one-screen alert: clearing the group returns the screen to its own alert', async () => {
    const w = makeWorld();
    const one: any = await w.emergency.triggerEmergency(trigger('device', 'gym-1', 'medical'), schoolAdmin);
    const gym: any = await w.emergency.triggerEmergency(trigger('group', GYM, 'lockdown'), schoolAdmin);
    expect((await w.manifest('gym-1')).emergencyType).toBe('LOCKDOWN'); // newest instruction wins

    await w.emergency.clearEmergency(gym.overrideId, clear('group', GYM), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only(['gym-1']));
    expect((await w.manifest('gym-1')).emergencyType).toBe('MEDICAL');

    await w.emergency.clearEmergency(one.overrideId, clear('device', 'gym-1'), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only([]));
  });

  it('a new alert on the SAME target replaces the old one (escalation), it does not stack', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(trigger('group', GYM, 'hold'), schoolAdmin);
    const lockdown: any = await w.emergency.triggerEmergency(trigger('group', GYM, 'lockdown'), schoolAdmin);
    expect((await w.manifest('gym-1')).emergencyType).toBe('LOCKDOWN');
    await w.emergency.clearEmergency(lockdown.overrideId, clear('group', GYM), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only([]));
  });

  it('a location-based whole-organisation alert stacks over a one-screen alert and gives it back', async () => {
    const w = makeWorld();
    w.tenants.get(SCHOOL)!.locationBasedEmergencyEnabled = true;
    const one: any = await w.emergency.triggerEmergency(trigger('device', 'lobby', 'medical'), schoolAdmin);
    const whole: any = await w.emergency.triggerEmergency(trigger('tenant', SCHOOL, 'evacuate'), schoolAdmin);
    expect((await w.manifest('lobby')).emergencyType).toBe('EVACUATE');

    await w.emergency.clearEmergency(whole.overrideId, clear('tenant', SCHOOL), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only(['lobby']));
    expect((await w.manifest('lobby')).emergencyType).toBe('MEDICAL');

    await w.emergency.clearEmergency(one.overrideId, clear('device', 'lobby'), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only([]));
  });
});

// ═══ 3. TENANT ISOLATION — a scope outside the caller's tree is refused ═══

describe('the server refuses a target outside the caller’s tenant tree', () => {
  const cases: Array<[string, any, 'group' | 'device', string]> = [
    ['school admin → another organisation’s group', schoolAdmin, 'group', OTHER_GROUP],
    ['school admin → another organisation’s screen', schoolAdmin, 'device', 'other-1'],
    ['school admin → a sibling school’s group', schoolAdmin, 'group', SIB_GROUP],
    ['school admin → a sibling school’s screen', schoolAdmin, 'device', 'sib-1'],
    ['school admin → the district’s own screen', schoolAdmin, 'device', 'district-1'],
    ['delegated staff → a sibling school’s screen', delegatedStaff, 'device', 'sib-1'],
    ['district admin → another organisation’s screen', districtAdmin, 'device', 'other-1'],
    ['district admin → another organisation’s group', districtAdmin, 'group', OTHER_GROUP],
  ];

  for (const [name, who, scopeType, scopeId] of cases) {
    it(`trigger: ${name} → 403, nothing written, nothing published`, async () => {
      const w = makeWorld();
      await expect(w.emergency.triggerEmergency(trigger(scopeType, scopeId), who)).rejects.toThrow(ForbiddenException);
      expect(w.overrides.size).toBe(0);
      expect(w.published).toEqual([]);
      expect(w.auditLogs).toEqual([]);
      expect(await emergencyMap(w)).toEqual(only([]));
    });

    it(`all-clear: ${name} → 403, nothing deleted`, async () => {
      const w = makeWorld();
      // The target IS in alert (raised by someone allowed to).
      const owner = scopeId === 'other-1' || scopeId === OTHER_GROUP
        ? { user: { id: 'u-other', role: 'SCHOOL_ADMIN', tenantId: OTHER } }
        : districtAdmin;
      const res: any = await w.emergency.triggerEmergency(trigger(scopeType, scopeId), owner);
      const rows = w.overrides.size;
      await expect(w.emergency.clearEmergency(res.overrideId, clear(scopeType, scopeId), who)).rejects.toThrow(ForbiddenException);
      expect(w.overrides.size).toBe(rows);
    });
  }

  it('a district admin MAY target one screen and one group inside their schools', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(trigger('device', 'sib-1'), districtAdmin);
    expect(await emergencyMap(w)).toEqual(only(['sib-1']));
    const g: any = await w.emergency.triggerEmergency(trigger('group', GYM), districtAdmin);
    expect(await emergencyMap(w)).toEqual(only(['sib-1', 'gym-1', 'gym-2']));
    // The override rows are owned by the SCREEN's tenant, not the caller's.
    expect(w.overrides.get('sib-1')!.tenantId).toBe(SIBLING);
    expect(w.overrides.get('gym-1')!.tenantId).toBe(SCHOOL);
    await w.emergency.clearEmergency(g.overrideId, clear('group', GYM), districtAdmin);
    expect(await emergencyMap(w)).toEqual(only(['sib-1']));
  });

  it('delegated staff MAY target a screen in their own school', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(trigger('device', 'lobby'), delegatedStaff);
    expect(await emergencyMap(w)).toEqual(only(['lobby']));
  });

  it('an unknown group or screen id is a 404, not a silent no-op', async () => {
    const w = makeWorld();
    await expect(w.emergency.triggerEmergency(trigger('group', 'nope'), schoolAdmin)).rejects.toThrow(NotFoundException);
    await expect(w.emergency.triggerEmergency(trigger('device', 'nope'), schoolAdmin)).rejects.toThrow(NotFoundException);
  });
});

// ═══ 4. WHAT THE OPERATOR SURFACES READ ═══════════════════════════════════

describe('GET /emergency/targets — what an alert can be aimed at', () => {
  it('a school admin sees their own groups and screens, with what each reaches', async () => {
    const w = makeWorld();
    w.screens.get('lobby')!.lastPingAt = new Date();
    const t: any = await w.emergency.targets(schoolAdmin);

    expect(t.tenantId).toBe(SCHOOL);
    expect(t.allScreensCount).toBe(SCHOOL_IDS.length);
    expect(t.groups.map((g: any) => [g.id, g.screenCount])).toEqual([
      [FRONT_GROUP, 2], // front + its back side outside the group
      [GYM, 2], // gym-1, gym-2 — never the other organisation's `stray`
    ]);
    expect(t.screens.map((s: any) => s.id).sort()).toEqual([...SCHOOL_IDS].sort());
    const lobby = t.screens.find((s: any) => s.id === 'lobby');
    expect(lobby).toMatchObject({ online: true, location: 'Main entrance', displayScreenCount: 1 });
    expect(t.screens.find((s: any) => s.id === 'office').online).toBe(false);
    expect(t.screens.find((s: any) => s.id === 'back')).toMatchObject({ displayScreenCount: 2 });
    expect(t.screens.find((s: any) => s.id === 'gym-1')).toMatchObject({ groupName: 'Gym' });
  });

  it('a district admin sees every school’s screens, and "All screens" counts the whole district', async () => {
    const w = makeWorld();
    const t: any = await w.emergency.targets(districtAdmin);
    expect(t.tenantId).toBe(DISTRICT);
    expect(t.allScreensCount).toBe(SCHOOL_IDS.length + 2); // + sib-1 + district-1
    expect(t.screens.map((s: any) => s.id)).toEqual(expect.arrayContaining(['sib-1', 'district-1', 'lobby']));
    expect(t.screens.map((s: any) => s.id)).not.toEqual(expect.arrayContaining(['other-1']));
    expect(t.screens.find((s: any) => s.id === 'sib-1').tenantName).toBe('sibling name');
    expect(t.groups.map((g: any) => g.id).sort()).toEqual([FRONT_GROUP, GYM, SIB_GROUP].sort());
  });

  it('delegated staff see only their own school (they may not reach below it)', async () => {
    const w = makeWorld();
    const t: any = await w.emergency.targets(delegatedStaff);
    expect(t.screens.map((s: any) => s.id).sort()).toEqual([...SCHOOL_IDS].sort());
  });
});

describe('GET /emergency/active — every live alert, each with its target', () => {
  it('lists the whole-organisation alert and each targeted alert separately', async () => {
    const w = makeWorld();
    const whole: any = await w.emergency.triggerEmergency(trigger('tenant', SCHOOL, 'weather'), schoolAdmin);
    const gym: any = await w.emergency.triggerEmergency(trigger('group', GYM, 'lockdown'), schoolAdmin);
    const lobby: any = await w.emergency.triggerEmergency(trigger('device', 'lobby', 'medical'), schoolAdmin);

    const { alerts } = (await w.emergency.activeAlerts(schoolAdmin)) as any;
    expect(alerts).toHaveLength(3);
    expect(alerts[0]).toMatchObject({ scopeType: 'tenant', scopeId: SCHOOL, type: 'WEATHER', screenCount: SCHOOL_IDS.length });
    const byId = Object.fromEntries(alerts.filter((a: any) => a.alertId).map((a: any) => [a.alertId, a]));
    expect(byId[gym.overrideId]).toMatchObject({ scopeType: 'group', scopeId: GYM, targetName: 'Gym', type: 'LOCKDOWN', screenCount: 2 });
    expect(byId[lobby.overrideId]).toMatchObject({ scopeType: 'device', scopeId: 'lobby', targetName: 'lobby name', type: 'MEDICAL', screenCount: 1 });

    await w.emergency.clearEmergency(gym.overrideId, clear('group', GYM), schoolAdmin);
    const after = ((await w.emergency.activeAlerts(schoolAdmin)) as any).alerts;
    expect(after.map((a: any) => a.alertId ?? a.scopeType)).toEqual(['tenant', lobby.overrideId]);

    await w.emergency.clearEmergency(whole.overrideId, clear('tenant', SCHOOL), schoolAdmin);
    await w.emergency.clearEmergency(lobby.overrideId, clear('device', 'lobby'), schoolAdmin);
    expect(((await w.emergency.activeAlerts(schoolAdmin)) as any).alerts).toEqual([]);
  });

  it('a covered alert is still live — listed, with how many screens show it now', async () => {
    const w = makeWorld();
    const one: any = await w.emergency.triggerEmergency(trigger('device', 'gym-1', 'medical'), schoolAdmin);
    await w.emergency.triggerEmergency(trigger('group', GYM, 'lockdown'), schoolAdmin);
    const { alerts } = (await w.emergency.activeAlerts(schoolAdmin)) as any;
    const medical = alerts.find((a: any) => a.alertId === one.overrideId);
    expect(medical).toMatchObject({ screenCount: 1, showingCount: 0 });
  });

  it('a group deleted mid-alert: still listed, and its all-clear (via a screen it is on) ends exactly it', async () => {
    const w = makeWorld();
    const gym: any = await w.emergency.triggerEmergency(trigger('group', GYM), schoolAdmin);
    const other: any = await w.emergency.triggerEmergency(trigger('device', 'lobby', 'medical'), schoolAdmin);
    // ScreenGroupsController.remove: the group row goes, members are un-grouped.
    w.groups.delete(GYM);
    for (const id of ['gym-1', 'gym-2']) w.screens.get(id)!.screenGroupId = null;

    const listed = ((await w.emergency.activeAlerts(schoolAdmin)) as any).alerts.find(
      (a: any) => a.alertId === gym.overrideId,
    );
    expect(listed).toMatchObject({ scopeType: 'group', targetName: null, screenCount: 2, clearScopeType: 'device' });
    expect(['gym-1', 'gym-2']).toContain(listed.clearScopeId);
    // A group all-clear on a group that no longer exists is a 404 — which is
    // exactly why the list hands out a scope that still resolves.
    await expect(w.emergency.clearEmergency(gym.overrideId, clear('group', GYM), schoolAdmin)).rejects.toThrow(NotFoundException);

    await w.emergency.clearEmergency(gym.overrideId, clear(listed.clearScopeType, listed.clearScopeId), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only(['lobby']));
    await w.emergency.clearEmergency(other.overrideId, clear('device', 'lobby'), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only([]));
  });

  it('a row left behind by a DELETED screen is not an alert anyone can see or must end', async () => {
    const w = makeWorld();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TenantsController } = require('../tenants/tenants.controller');
    const tenantsController = new TenantsController({ client: w.client }, {} as any, {} as any);
    await w.emergency.triggerEmergency(trigger('device', 'office'), schoolAdmin);
    // ScreensController.remove deletes the Screen row but not its override row.
    w.screens.delete('office');
    expect(w.overrides.has('office')).toBe(true);

    expect(((await w.emergency.activeAlerts(schoolAdmin)) as any).alerts).toEqual([]);
    expect((await tenantsController.getTenantInfo(schoolAdmin)).emergencyScopedAlertActive).toBe(false);
  });

  it('only lists alerts the caller could end — a school admin never sees a sibling school’s', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(trigger('device', 'sib-1'), districtAdmin);
    expect(((await w.emergency.activeAlerts(schoolAdmin)) as any).alerts).toEqual([]);
    expect(((await w.emergency.activeAlerts(districtAdmin)) as any).alerts).toHaveLength(1);
  });
});

describe('GET /tenants — the dashboard learns a targeted alert is live without a new poller', () => {
  it('flags a group / one-screen alert, and stops flagging it after its all-clear', async () => {
    const w = makeWorld();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TenantsController } = require('../tenants/tenants.controller');
    const tenantsController = new TenantsController({ client: w.client }, {} as any, {} as any);
    expect((await tenantsController.getTenantInfo(schoolAdmin)).emergencyScopedAlertActive).toBe(false);

    const res: any = await w.emergency.triggerEmergency(trigger('device', 'lobby'), schoolAdmin);
    expect((await tenantsController.getTenantInfo(schoolAdmin)).emergencyScopedAlertActive).toBe(true);
    // A district admin sees it from the district (they may end it).
    expect((await tenantsController.getTenantInfo(districtAdmin)).emergencyScopedAlertActive).toBe(true);

    await w.emergency.clearEmergency(res.overrideId, clear('device', 'lobby'), schoolAdmin);
    expect((await tenantsController.getTenantInfo(schoolAdmin)).emergencyScopedAlertActive).toBe(false);
  });

  it('a whole-organisation alert alone does not set it (emergencyStatus already says so)', async () => {
    const w = makeWorld();
    w.tenants.get(SCHOOL)!.locationBasedEmergencyEnabled = true;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TenantsController } = require('../tenants/tenants.controller');
    const tenantsController = new TenantsController({ client: w.client }, {} as any, {} as any);
    await w.emergency.triggerEmergency(trigger('tenant', SCHOOL), schoolAdmin);
    const info = await tenantsController.getTenantInfo(schoolAdmin);
    expect(info.emergencyStatus).toBe('CRITICAL');
    expect(info.emergencyScopedAlertActive).toBe(false);
  });
});
