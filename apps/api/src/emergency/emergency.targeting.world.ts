/**
 * The alert-targeting WORLD — one stateful in-memory store driven by the REAL
 * emergency controller and read by the REAL manifest handler.
 *
 * Extracted verbatim from emergency.targeting.spec.ts on 2026-10-10 so the
 * drill suite (emergency.drill.spec.ts) can prove its precedence rules
 * against the same fixture — see that spec's header for the tree. Not a
 * spec itself (no `.spec.` in the name), so Jest never runs it directly.
 *
 * FIXTURE
 *   district ─┬─ school   gym-1, gym-2 (group GYM) · lobby · office
 *             │           front (group FRONT) + back (its second face, NO group)
 *             └─ sibling  sib-1 (group SIB)
 *   district-1 sits on the district itself.
 *   other      other-1 (group OTHER)
 *   stray      a screen of `other` whose screenGroupId still points at GYM.
 *
 * 2026-10-10 additions, all inert for the targeting suite: `playlists` (a
 * map of id → { tenantId, items[] } that `playlist.findUnique/findFirst` and
 * `playlistItem.count` read — empty by default, so the manifest still falls
 * back to the system-default board exactly as before) and `emergencyIsDrill`
 * on `tenant.updateMany`'s where-clause (the drill all-clear's compare-and-set).
 */
import { EmergencyController } from './emergency.controller';
import { ScreensController } from '../screens/screens.controller';
import { resolveEmergencyRev } from '../screens/emergency-rev';

export const DISTRICT = 'district';
export const SCHOOL = 'school';
export const SIBLING = 'sibling';
export const OTHER = 'other';

export const GYM = 'group-gym';
export const FRONT_GROUP = 'group-front';
export const SIB_GROUP = 'group-sib';
export const OTHER_GROUP = 'group-other';

export type Row = Record<string, any>;

export function tenantRow(id: string, parentId: string | null, extra: Row = {}): Row {
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

export function screenRow(id: string, tenantId: string, extra: Row = {}): Row {
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

export const idMatches = (value: any, clause: any): boolean => {
  if (clause === undefined) return true;
  if (clause === null) return value === null || value === undefined;
  if (clause && typeof clause === 'object') {
    if (Array.isArray(clause.in)) return clause.in.includes(value);
    if ('not' in clause) return value !== clause.not;
  }
  return value === clause;
};

export function makeWorld() {
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
  // 2026-10-10 — playlists the manifest can resolve (empty by default).
  const playlists = new Map<string, { id: string; tenantId: string; name: string; items: Row[] }>();
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
          // The drill all-clear's compare-and-set (2026-10-10).
          if (where?.emergencyIsDrill !== undefined && (t.emergencyIsDrill === true) !== where.emergencyIsDrill) continue;
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
      findFirst: jest.fn(async ({ where }: any = {}) => {
        const pl = where?.id ? playlists.get(where.id) : undefined;
        if (!pl) return null;
        if (where?.tenantId !== undefined && !idMatches(pl.tenantId, where.tenantId)) return null;
        return { id: pl.id, tenantId: pl.tenantId, name: pl.name };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const pl = playlists.get(where.id);
        if (!pl) return null;
        return { id: pl.id, tenantId: pl.tenantId, name: pl.name, items: pl.items.map((i) => ({ ...i })) };
      }),
    },
    playlistItem: {
      count: jest.fn(async ({ where }: any = {}) => {
        let n = 0;
        for (const pl of playlists.values()) {
          if (!idMatches(pl.id, where?.playlistId)) continue;
          n += pl.items.length;
        }
        return n;
      }),
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

  /** Register a playlist the manifest can resolve; `itemCount` 0 = an empty (lazily created) bucket. */
  function addPlaylist(id: string, tenantId: string, itemCount: number, name = `${id} name`) {
    const items: Row[] = [];
    for (let i = 0; i < itemCount; i++) {
      items.push({
        id: `${id}-item-${i}`,
        assetId: `${id}-asset-${i}`,
        durationMs: 10_000,
        sequenceOrder: i,
        transitionType: 'FADE',
        asset: { id: `${id}-asset-${i}`, fileUrl: `https://cdn.test/${id}/${i}.jpg`, fileHash: null, mimeType: 'image/jpeg' },
      });
    }
    playlists.set(id, { id, tenantId, name, items });
  }

  return { tenants, groups, screens, overrides, playlists, addPlaylist, auditLogs, published, client, redis, emergency, manifest, isEmergency, rev };
}

export const SCHOOL_IDS = ['gym-1', 'gym-2', 'lobby', 'office', 'front', 'back'];
export const OUTSIDE_SCHOOL = ['sib-1', 'district-1', 'other-1', 'stray'];
export const EVERY_SCREEN = [...SCHOOL_IDS, ...OUTSIDE_SCHOOL];

export const schoolAdmin = { user: { id: 'u-school', role: 'SCHOOL_ADMIN', tenantId: SCHOOL } };
export const districtAdmin = { user: { id: 'u-district', role: 'DISTRICT_ADMIN', tenantId: DISTRICT } };
// A delegated staffer: no admin role, `canTriggerPanic` granted. The RBAC
// guard admits them on @AllowPanicBypass routes; the controller's scope rule
// must then confine them to their OWN tenant like any non-district caller.
export const delegatedStaff = { user: { id: 'u-staff', role: 'CONTRIBUTOR', tenantId: SCHOOL, canTriggerPanic: true } };

export const trigger = (scopeType: 'tenant' | 'group' | 'device', scopeId: string, type = 'lockdown', overrideId?: string) =>
  ({
    scopeType,
    scopeId,
    overridePayload: { type, severity: 'CRITICAL', ...(overrideId ? { overrideId } : {}) },
  }) as any;

export const clear = (scopeType: 'tenant' | 'group' | 'device', scopeId: string) => ({ scopeType, scopeId }) as any;

export async function emergencyMap(w: ReturnType<typeof makeWorld>, ids: string[] = EVERY_SCREEN) {
  const out: Record<string, boolean> = {};
  for (const id of ids) out[id] = await w.isEmergency(id);
  return out;
}

export const only = (lit: string[], ids: string[] = EVERY_SCREEN) =>
  Object.fromEntries(ids.map((id) => [id, lit.includes(id)]));
