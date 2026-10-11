/**
 * USER SCOPING MATRIX (2026-10-11) — multi-location people and screen-scoped
 * people, end to end through the REAL gate and the REAL controllers.
 *
 * Same harness idea as two-tenant-role-matrix.spec.ts: the Prisma double
 * EVALUATES every `where` against an organisation with several locations plus
 * a foreign organisation, so a list that forgot the scope genuinely returns
 * the other screens here and the assertion fails.
 *
 *   ORG (root) ─┬─ loc-a   ← home of every person below
 *               ├─ loc-b   ← given to u-multi
 *               ├─ loc-c   ← nobody's
 *               └─ loc-arch (archived) ← given to u-multi, must stay closed
 *   FOREIGN ──── foreign-loc ← a bogus row on u-multi points here; ignored
 *
 * loc-a screens: scr-a1, scr-a2 (+ its back face scr-a2-back) in grp-lobby,
 * scr-a3 in grp-gym, scr-a4 ungrouped. Screen-scoped people are limited to
 * grp-lobby + scr-a4 → effective scr-a1, scr-a2, scr-a2-back, scr-a4.
 */
import 'reflect-metadata';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { makeTwoTenantPrisma, type Dataset } from './two-tenant-prisma';
import { UserScopeService } from '../user-scope/user-scope.service';
import { UserScopeInterceptor } from '../user-scope/user-scope.interceptor';
import { screenScopeOf } from '../user-scope/user-scope.context';
import { ScreensController } from '../screens/screens.controller';
import { SchedulesController } from '../schedules/schedules.controller';
import { ScreenGroupsController } from '../screen-groups/screen-groups.controller';
import { DisplaySchedulesController } from '../display/display-schedules.controller';
import { EmergencyController } from '../emergency/emergency.controller';
import { TenantsController } from '../tenants/tenants.controller';
import { RbacGuard } from '../auth/rbac.guard';

const ORG = 'org';
const A = 'loc-a';
const B = 'loc-b';
const C = 'loc-c';
const ARCH = 'loc-arch';
const FOREIGN = 'foreign-org';
const FOREIGN_LOC = 'foreign-loc';

function dataset(): Dataset {
  const t = (id: string, parentId: string | null, archivedAt: Date | null = null) => ({
    id,
    name: id.toUpperCase(),
    slug: id,
    parentId,
    vertical: 'RETAIL',
    archivedAt,
    mfaEnforced: false,
  });
  const u = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
    id,
    tenantId: A,
    email: `${id}@example.test`,
    role,
    status: 'ACTIVE',
    deletedAt: null,
    canTriggerPanic: false,
    mfaRequired: false,
    mfaTotpVerifiedAt: null,
    ...extra,
  });
  const scr = (id: string, tenantId: string, screenGroupId: string | null, faceOfScreenId: string | null = null) => ({
    id,
    tenantId,
    screenGroupId,
    faceOfScreenId,
    name: id,
    status: 'ONLINE',
    lastPingAt: null,
    deviceFingerprint: `fp-${id}`,
    pairingCode: null,
  });
  const sched = (id: string, playlistId: string, target: { screenId?: string; screenGroupId?: string }) => ({
    id,
    tenantId: A,
    playlistId,
    screenId: target.screenId ?? null,
    screenGroupId: target.screenGroupId ?? null,
    isActive: true,
    pendingMedia: false,
    pendingMediaError: null,
    startTime: new Date('2026-01-01T00:00:00Z'),
    endTime: null,
  });
  return {
    tenant: [t(ORG, null), t(A, ORG), t(B, ORG), t(C, ORG), t(ARCH, ORG, new Date('2026-09-01')), t(FOREIGN, null), t(FOREIGN_LOC, FOREIGN)],
    user: [
      u('u-multi', 'CONTRIBUTOR'),
      u('u-scoped', 'CONTRIBUTOR'),
      u('u-scoped-admin', 'SCHOOL_ADMIN', { canTriggerPanic: true }),
      u('u-scoped-panic', 'CONTRIBUTOR', { canTriggerPanic: true }),
      u('u-plain', 'CONTRIBUTOR'),
      u('u-district', 'DISTRICT_ADMIN', { tenantId: ORG }),
    ],
    userLocationAccess: [
      { id: 'ula-1', userId: 'u-multi', tenantId: B },
      { id: 'ula-2', userId: 'u-multi', tenantId: ARCH },
      { id: 'ula-3', userId: 'u-multi', tenantId: FOREIGN_LOC },
    ],
    userScreenScope: [
      ...['u-scoped', 'u-scoped-admin', 'u-scoped-panic'].flatMap((userId) => [
        { id: `uss-${userId}-g`, userId, tenantId: A, screenId: null, screenGroupId: 'grp-lobby' },
        { id: `uss-${userId}-s`, userId, tenantId: A, screenId: 'scr-a4', screenGroupId: null },
      ]),
      // A stale row on an org admin: org admins are never screen-scoped.
      { id: 'uss-district', userId: 'u-district', tenantId: A, screenId: 'scr-a4', screenGroupId: null },
    ],
    screen: [
      scr('scr-a1', A, 'grp-lobby'),
      scr('scr-a2', A, 'grp-lobby'),
      scr('scr-a2-back', A, null, 'scr-a2'),
      scr('scr-a3', A, 'grp-gym'),
      scr('scr-a4', A, null),
      scr('scr-b1', B, 'grp-b'),
      scr('scr-f1', FOREIGN_LOC, null),
    ],
    screenGroup: [
      { id: 'grp-lobby', tenantId: A, name: 'Lobby' },
      { id: 'grp-gym', tenantId: A, name: 'Gym' },
      { id: 'grp-b', tenantId: B, name: 'B group' },
    ],
    playlist: [
      { id: 'pl-lobby', tenantId: A, name: 'Lobby loop' },
      { id: 'pl-mixed', tenantId: A, name: 'Lobby + gym' },
      { id: 'pl-a1', tenantId: A, name: 'Screen a1' },
      { id: 'pl-unpub', tenantId: A, name: 'Draft' },
      { id: 'pl-b', tenantId: B, name: 'B loop' },
    ],
    schedule: [
      sched('sch-lobby', 'pl-lobby', { screenGroupId: 'grp-lobby' }),
      sched('sch-a3', 'pl-mixed', { screenId: 'scr-a3' }),
      sched('sch-mixed-lobby', 'pl-mixed', { screenGroupId: 'grp-lobby' }),
      sched('sch-a1', 'pl-a1', { screenId: 'scr-a1' }),
    ],
    displaySchedule: [
      { id: 'ds-lobby', tenantId: A, screenId: null, screenGroupId: 'grp-lobby', createdAt: new Date() },
      { id: 'ds-a3', tenantId: A, screenId: 'scr-a3', screenGroupId: null, createdAt: new Date() },
    ],
    auditLog: [],
  };
}

/**
 * The two-tenant double ignores `select`, so it cannot answer the one nested
 * read the scope service makes (`user.findFirst({ select: { locationAccess:
 * { where }, screenScopes: { where } } })`). This wraps exactly that call and
 * answers it from the same tables with the same `where` evaluation.
 */
function harness(ds: Dataset = dataset()) {
  const p = makeTwoTenantPrisma(ds);
  const client = p.client;
  const userApi = client.user;
  const wrappedUser = {
    ...userApi,
    findFirst: async (args: any) => {
      const row = await userApi.findFirst(args);
      if (!row) return null;
      const sel = args?.select ?? {};
      const out: any = { ...row };
      if (sel.locationAccess) {
        out.locationAccess = await client.userLocationAccess.findMany({ where: { userId: row.id, ...(sel.locationAccess.where ?? {}) } });
      }
      if (sel.screenScopes) {
        out.screenScopes = await client.userScreenScope.findMany({ where: { userId: row.id, ...(sel.screenScopes.where ?? {}) } });
      }
      return out;
    },
  };
  // Same for the screen-groups list, whose nested `include: { screens: { where } }`
  // is exactly the per-group narrowing under test.
  const groupApi = client.screenGroup;
  const wrappedGroup = {
    ...groupApi,
    findMany: async (args: any) => {
      const rows = await groupApi.findMany(args);
      const inc = args?.include;
      if (!inc) return rows;
      return Promise.all(
        rows.map(async (g: any) => ({
          ...g,
          screens: inc.screens ? await client.screen.findMany({ where: { screenGroupId: g.id, ...(inc.screens.where ?? {}) } }) : undefined,
          schedules: inc.schedules ? [] : undefined,
        })),
      );
    },
  };
  const wrapped = new Proxy(client, {
    get: (target, prop: string) => (prop === 'user' ? wrappedUser : prop === 'screenGroup' ? wrappedGroup : target[prop]),
  });
  const prisma: any = { client: wrapped, ensurePlaylistMetadataColumns: async () => undefined };
  const service = new UserScopeService(prisma);
  const interceptor = new UserScopeInterceptor(service, prisma);
  /** Touched rows of the FOREIGN organisation — must always be empty. */
  // (The person's OWN membership rows are excluded: reading u-multi's bogus
  // row that points at the foreign organisation is how it gets ignored.)
  const foreignTouched = () =>
    p.touched.filter((t) => (t.tenantId === FOREIGN || t.tenantId === FOREIGN_LOC) && t.model !== 'userLocationAccess');
  return { p, prisma, service, interceptor, foreignTouched };
}

function person(id: string, role: string, tenantId = A, extra: Record<string, unknown> = {}) {
  return { id, userId: id, sub: id, email: `${id}@example.test`, role, tenantId, schoolId: tenantId, ...extra };
}

async function gate(h: ReturnType<typeof harness>, user: any, method: string, url: string, body: unknown = undefined) {
  const req: any = { user, method, originalUrl: url, url, body, headers: {} };
  try {
    await h.interceptor.decide(req, user.id, user.tenantId);
    return { verdict: 'allow' as const, req };
  } catch (e: any) {
    if (!(e instanceof ForbiddenException)) throw e;
    return { verdict: (e.getResponse() as any)?.code ?? 'forbidden', req };
  }
}

const stubRedis = { publish: jest.fn(async () => undefined), sismember: jest.fn(async () => false) } as any;
const stubSigner = { signMessage: jest.fn(() => ({ type: 'SYNC' })) } as any;
const stubNotify = { create: jest.fn(async () => undefined) } as any;
const stubLicense = { assertSeatAvailable: jest.fn(async () => undefined), seatUsage: jest.fn(async () => ({ used: 0, limit: 100 })) } as any;
const stubStripe = { syncSubscriptionQuantity: jest.fn(async () => undefined) } as any;
const stubMenu = { getMenuForScreen: jest.fn(async () => null) } as any;
const stubJwt = { sign: jest.fn(() => 'signed.token'), decode: jest.fn(() => null) } as any;
const ids = (rows: any) => (Array.isArray(rows) ? rows : rows?.screens ?? rows?.tenants ?? []).map((r: any) => r.id).sort();

// ─── 1. MORE THAN ONE LOCATION ────────────────────────────────────────────

describe('user scoping — a person in more than one location', () => {
  it('the switcher lists home + given locations only (not loc-c, not archived, not another organisation)', async () => {
    const h = harness();
    const c = new TenantsController(h.prisma, stubJwt, stubRedis);
    const out: any = await c.listAccessible({ user: person('u-multi', 'CONTRIBUTOR') });
    expect(ids(out)).toEqual([A, B]);
    expect(h.foreignTouched()).toEqual([]);
  });

  it('a person with no extra locations gets exactly the old answer (their own location)', async () => {
    const h = harness();
    const c = new TenantsController(h.prisma, stubJwt, stubRedis);
    const out: any = await c.listAccessible({ user: person('u-plain', 'CONTRIBUTOR') });
    expect(ids(out)).toEqual([A]);
  });

  it.each([
    [B, 'allowed'],
    [A, 'allowed'],
    [C, 'TENANT_SWITCH_NOT_AUTHORIZED'],
    [ARCH, 'TENANT_SWITCH_NOT_AUTHORIZED'],
    [FOREIGN_LOC, 'TENANT_SWITCH_NOT_AUTHORIZED'],
    [ORG, 'TENANT_SWITCH_NOT_AUTHORIZED'],
  ])('switch into %s → %s', async (target, expected) => {
    const h = harness();
    const c = new TenantsController(h.prisma, stubJwt, stubRedis);
    const req: any = { user: { ...person('u-multi', 'CONTRIBUTOR'), tokenExp: Math.floor(Date.now() / 1000) + 600 }, headers: {} };
    let got = 'allowed';
    try {
      const res: any = await c.switchTenant(req, { tenantId: target });
      expect(res.user.role).toBe('CONTRIBUTOR'); // same role in each location
      expect(res.user.tenantId).toBe(target);
    } catch (e: any) {
      got = e.getResponse?.()?.code ?? String(e);
    }
    expect(got).toBe(expected);
  });

  it('a location role with no given locations still cannot switch anywhere else', async () => {
    const h = harness();
    const c = new TenantsController(h.prisma, stubJwt, stubRedis);
    await expect(c.switchTenant({ user: person('u-plain', 'CONTRIBUTOR'), headers: {} }, { tenantId: B })).rejects.toMatchObject({
      response: { code: 'TENANT_SWITCH_NOT_AUTHORIZED' },
    });
  });

  it('working in a given location is allowed; when the access is removed the next request is refused', async () => {
    const h = harness();
    const inB = person('u-multi', 'CONTRIBUTOR', B);
    expect((await gate(h, inB, 'GET', '/api/v1/screens')).verdict).toBe('allow');

    const ds = dataset();
    ds.userLocationAccess = ds.userLocationAccess.filter((r) => r.tenantId !== B);
    const h2 = harness(ds);
    expect((await gate(h2, inB, 'GET', '/api/v1/screens')).verdict).toBe('LOCATION_ACCESS_REVOKED');
    expect((await gate(h2, inB, 'GET', '/api/v1/playlists')).verdict).toBe('LOCATION_ACCESS_REVOKED');
    // …but they can still see who they are, list their locations and go home.
    expect((await gate(h2, inB, 'GET', '/api/v1/users/me')).verdict).toBe('allow');
    expect((await gate(h2, inB, 'GET', '/api/v1/tenants/accessible')).verdict).toBe('allow');
    expect((await gate(h2, inB, 'POST', '/api/v1/tenants/switch')).verdict).toBe('allow');
    expect((await gate(h2, inB, 'POST', '/api/v1/auth/logout')).verdict).toBe('allow');
  });

  it('a session stamped with a location the person was never given is refused', async () => {
    const h = harness();
    expect((await gate(h, person('u-multi', 'CONTRIBUTOR', C), 'GET', '/api/v1/screens')).verdict).toBe('LOCATION_ACCESS_REVOKED');
    expect((await gate(h, person('u-plain', 'SCHOOL_ADMIN', B), 'GET', '/api/v1/users')).verdict).toBe('LOCATION_ACCESS_REVOKED');
  });

  it('in a given location, every location-scoped list shows THAT location only (the session tenant is the scope)', async () => {
    const h = harness();
    const { req } = await gate(h, person('u-multi', 'CONTRIBUTOR', B), 'GET', '/api/v1/screens');
    const screens = await new ScreensController(h.prisma, stubRedis, stubSigner, stubLicense, stubStripe, stubMenu).list(req);
    expect(ids(screens)).toEqual(['scr-b1']);
    expect(h.foreignTouched()).toEqual([]);
  });
});

// ─── 2. LIMITED TO SCREENS / GROUPS ───────────────────────────────────────

describe('user scoping — a person limited to some screens', () => {
  it('effective scope = listed group + listed screen + the other face of a listed display', async () => {
    const h = harness();
    const { req } = await gate(h, person('u-scoped', 'CONTRIBUTOR'), 'GET', '/api/v1/screens');
    expect([...screenScopeOf(req)!.screenIds].sort()).toEqual(['scr-a1', 'scr-a2', 'scr-a2-back', 'scr-a4']);
    expect(screenScopeOf(req)!.groupIds).toEqual(['grp-lobby']);
  });

  const SCHOOL_ADMIN = () => person('u-scoped-admin', 'SCHOOL_ADMIN', A, { canTriggerPanic: true });
  const CONTRIB = () => person('u-scoped', 'CONTRIBUTOR');

  it.each<[string, string, unknown, string]>([
    // their screens: status, power, refresh, rename, remove
    ['PUT', '/api/v1/screens/scr-a1', { name: 'Lobby left' }, 'allow'],
    ['POST', '/api/v1/screens/scr-a1/refresh-web', undefined, 'allow'],
    ['POST', '/api/v1/screens/scr-a4/display-control', { action: 'off' }, 'allow'],
    ['GET', '/api/v1/screens/scr-a2-back/faces', undefined, 'allow'],
    ['DELETE', '/api/v1/screens/scr-a4', undefined, 'allow'],
    // other screens, other locations, moving a screen into a group that is not theirs
    ['PUT', '/api/v1/screens/scr-a3', { name: 'x' }, 'SCREEN_SCOPE_FORBIDDEN'],
    ['POST', '/api/v1/screens/scr-a3/refresh-web', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['POST', '/api/v1/screens/scr-a3/display-control', { action: 'off' }, 'SCREEN_SCOPE_FORBIDDEN'],
    ['POST', '/api/v1/screens/scr-a3/gpio-set', {}, 'SCREEN_SCOPE_FORBIDDEN'],
    ['POST', '/api/v1/screens/scr-b1/refresh-web', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['PUT', '/api/v1/screens/scr-a1', { screenGroupId: 'grp-gym' }, 'SCREEN_SCOPE_FORBIDDEN'],
    ['PUT', '/api/v1/screens/scr-a1/emergency-content', {}, 'SCREEN_SCOPE_FORBIDDEN'],
    // whole-location screen actions
    ['POST', '/api/v1/screens/refresh-web', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['POST', '/api/v1/screens/force-update', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['POST', '/api/v1/screens/pair', { pairingCode: '123456' }, 'SCREEN_SCOPE_FORBIDDEN'],
    ['GET', '/api/v1/screens/fleet', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['GET', '/api/v1/screens/fleet-pulse', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    // groups: read only
    ['GET', '/api/v1/screen-groups', undefined, 'allow'],
    ['POST', '/api/v1/screen-groups', { name: 'mine' }, 'SCREEN_SCOPE_FORBIDDEN'],
    ['PUT', '/api/v1/screen-groups/grp-lobby', { name: 'x' }, 'SCREEN_SCOPE_FORBIDDEN'],
    ['PUT', '/api/v1/screen-groups/grp-lobby/screens', { screenIds: ['scr-a3'] }, 'SCREEN_SCOPE_FORBIDDEN'],
    ['DELETE', '/api/v1/screen-groups/grp-gym', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    // schedules (content assignment)
    ['POST', '/api/v1/schedules', { playlistId: 'pl-lobby', screenGroupId: 'grp-lobby' }, 'allow'],
    ['POST', '/api/v1/schedules', { playlistId: 'pl-lobby', screenId: 'scr-a4' }, 'allow'],
    ['POST', '/api/v1/schedules', { playlistId: 'pl-lobby', screenId: 'scr-a3' }, 'SCREEN_SCOPE_FORBIDDEN'],
    ['POST', '/api/v1/schedules', { playlistId: 'pl-lobby', screenGroupId: 'grp-gym' }, 'SCREEN_SCOPE_FORBIDDEN'],
    ['POST', '/api/v1/schedules', { playlistId: 'pl-lobby' }, 'SCREEN_SCOPE_FORBIDDEN'],
    ['PUT', '/api/v1/schedules/sch-lobby', { timeStart: '08:00' }, 'allow'],
    ['PUT', '/api/v1/schedules/sch-lobby', { screenId: 'scr-a3' }, 'SCREEN_SCOPE_FORBIDDEN'],
    ['PUT', '/api/v1/schedules/sch-a3', { timeStart: '08:00' }, 'SCREEN_SCOPE_FORBIDDEN'],
    ['PUT', '/api/v1/schedules/sch-a3/toggle', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['DELETE', '/api/v1/schedules/sch-a1', undefined, 'allow'],
    ['DELETE', '/api/v1/schedules/does-not-exist', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    // power schedules
    ['POST', '/api/v1/display-schedules', { screenGroupId: 'grp-lobby' }, 'allow'],
    ['POST', '/api/v1/display-schedules', { screenId: 'scr-a3' }, 'SCREEN_SCOPE_FORBIDDEN'],
    ['PUT', '/api/v1/display-schedules/ds-lobby', {}, 'allow'],
    ['DELETE', '/api/v1/display-schedules/ds-a3', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    // playlists: content is theirs; changing one that plays elsewhere is not
    ['POST', '/api/v1/playlists', { name: 'new' }, 'allow'],
    ['GET', '/api/v1/playlists/pl-mixed', undefined, 'allow'],
    ['PUT', '/api/v1/playlists/pl-lobby', { name: 'x' }, 'allow'],
    ['PUT', '/api/v1/playlists/pl-unpub/items', { items: [] }, 'allow'],
    ['PUT', '/api/v1/playlists/pl-mixed', { name: 'x' }, 'SCREEN_SCOPE_FORBIDDEN'],
    ['DELETE', '/api/v1/playlists/pl-mixed', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['PUT', '/api/v1/playlists/pl-mixed/active', { active: false }, 'SCREEN_SCOPE_FORBIDDEN'],
    ['PUT', '/api/v1/playlists/pl-b', { name: 'x' }, 'SCREEN_SCOPE_FORBIDDEN'],
    ['DELETE', '/api/v1/playlists/pl-mixed/screens/scr-a3', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['PUT', '/api/v1/playlists/pl-mixed/screens/scr-a1/active', { active: false }, 'allow'],
    ['POST', '/api/v1/playlists/pl-lobby/publish-to-fleet', {}, 'SCREEN_SCOPE_FORBIDDEN'],
    // content library
    ['GET', '/api/v1/assets', undefined, 'allow'],
    ['POST', '/api/v1/assets/presign', {}, 'allow'],
    ['POST', '/api/v1/templates', {}, 'allow'],
    ['POST', '/api/v1/assets/emergency-upload', {}, 'SCREEN_SCOPE_FORBIDDEN'],
    // people, location settings, billing, emergency SETTINGS
    ['GET', '/api/v1/users', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['PUT', '/api/v1/users/u-plain/role', { role: 'RESTRICTED_VIEWER' }, 'SCREEN_SCOPE_FORBIDDEN'],
    ['GET', '/api/v1/users/u-plain/access', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['GET', '/api/v1/users/setup-links', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['POST', '/api/v1/invites', {}, 'SCREEN_SCOPE_FORBIDDEN'],
    ['GET', '/api/v1/tenants/me/content-approval', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['PUT', '/api/v1/tenants/me/emergency-enabled', {}, 'SCREEN_SCOPE_FORBIDDEN'],
    ['PUT', '/api/v1/tenants/panic-settings', {}, 'SCREEN_SCOPE_FORBIDDEN'],
    ['GET', '/api/v1/panic-content/LOCKDOWN/assets', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['GET', '/api/v1/billing/status', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['GET', '/api/v1/billing/summary', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['GET', '/api/v1/billing/invoices', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['GET', '/api/v1/audit', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['GET', '/api/v1/support-access', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['GET', '/api/v1/floor-plans', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['GET', '/api/v1/analytics/proof-of-play', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    ['GET', '/api/v1/stats/overview', undefined, 'SCREEN_SCOPE_FORBIDDEN'],
    // self
    ['GET', '/api/v1/users/me', undefined, 'allow'],
    ['POST', '/api/v1/auth/change-password', {}, 'allow'],
    ['GET', '/api/v1/notifications', undefined, 'allow'],
  ])('%s %s %j → %s', async (method, url, body, expected) => {
    for (const who of [CONTRIB(), SCHOOL_ADMIN()]) {
      const h = harness();
      expect([who.role, (await gate(h, who, method, url, body)).verdict]).toEqual([who.role, expected]);
      expect(h.foreignTouched()).toEqual([]);
    }
  });

  it('lists show only their screens, groups, schedules and power schedules', async () => {
    const h = harness();
    const user = CONTRIB();
    const g = async (url: string) => (await gate(h, user, 'GET', url)).req;

    const screens = await new ScreensController(h.prisma, stubRedis, stubSigner, stubLicense, stubStripe, stubMenu).list(await g('/api/v1/screens'));
    expect(ids(screens)).toEqual(['scr-a1', 'scr-a2', 'scr-a2-back', 'scr-a4']);

    const groups = await new ScreenGroupsController(h.prisma, stubRedis, stubSigner).list(await g('/api/v1/screen-groups'));
    expect(ids(groups)).toEqual(['grp-lobby']);
    expect(ids((groups as any[])[0].screens)).toEqual(['scr-a1', 'scr-a2']);

    const schedules = await new SchedulesController(h.prisma, stubRedis, stubSigner, stubNotify).list(await g('/api/v1/schedules'));
    expect(ids(schedules)).toEqual(['sch-a1', 'sch-lobby', 'sch-mixed-lobby']);

    const power = await new DisplaySchedulesController(h.prisma, {} as any).list(await g('/api/v1/display-schedules'));
    expect(ids(power)).toEqual(['ds-lobby']);
    // ?screenId= cannot widen it.
    const power2 = await new DisplaySchedulesController(h.prisma, {} as any).list(await g('/api/v1/display-schedules'), 'scr-a3');
    expect(ids(power2)).toEqual([]);
    expect(h.foreignTouched()).toEqual([]);
  });

  it('a group that holds one of their screens is listed (so the screen shows), but is not theirs to target', async () => {
    const ds = dataset();
    ds.userScreenScope = [{ id: 'x', userId: 'u-scoped', tenantId: A, screenId: 'scr-a3', screenGroupId: null }];
    const h = harness(ds);
    const user = CONTRIB();
    const { req } = await gate(h, user, 'GET', '/api/v1/screen-groups');
    const groups = await new ScreenGroupsController(h.prisma, stubRedis, stubSigner).list(req);
    expect(ids(groups)).toEqual(['grp-gym']);
    expect(ids((groups as any[])[0].screens)).toEqual(['scr-a3']);
    expect((await gate(h, user, 'POST', '/api/v1/schedules', { screenGroupId: 'grp-gym', playlistId: 'pl-a1' })).verdict).toBe('SCREEN_SCOPE_FORBIDDEN');
    expect((await gate(h, user, 'POST', '/api/v1/schedules', { screenId: 'scr-a3', playlistId: 'pl-a1' })).verdict).toBe('allow');
  });

  it('a scope whose group was deleted stays a scope (matches nothing) — never widens to the whole location', async () => {
    const ds = dataset();
    ds.screenGroup = ds.screenGroup.filter((g) => g.id !== 'grp-lobby');
    ds.screen = ds.screen.map((s) => (s.screenGroupId === 'grp-lobby' ? { ...s, screenGroupId: null } : s));
    ds.userScreenScope = ds.userScreenScope.filter((r) => r.screenGroupId === 'grp-lobby' && r.userId === 'u-scoped');
    const h = harness(ds);
    const { req, verdict } = await gate(h, CONTRIB(), 'GET', '/api/v1/screens');
    expect(verdict).toBe('allow');
    const screens = await new ScreensController(h.prisma, stubRedis, stubSigner, stubLicense, stubStripe, stubMenu).list(req);
    expect(ids(screens)).toEqual([]);
    expect((await gate(h, CONTRIB(), 'GET', '/api/v1/users')).verdict).toBe('SCREEN_SCOPE_FORBIDDEN');
  });
});

// ─── 3. EMERGENCY — NOT SCOPED (owner decision 2026-10-11) ────────────────

describe('user scoping — emergency reach is never narrowed by screen scope', () => {
  const build = (prisma: any) =>
    new EmergencyController(stubRedis, prisma, stubSigner, { dispatch: jest.fn() } as any, { onTenantEmergency: jest.fn() } as any);

  it('a screen-scoped person with canTriggerPanic passes the role gate on the trigger (delegated capability, unchanged)', () => {
    const guard = new RbacGuard(new Reflector());
    const user = person('u-scoped-panic', 'CONTRIBUTOR', A, { canTriggerPanic: true });
    const ctx = {
      getHandler: () => EmergencyController.prototype.triggerEmergency,
      getClass: () => EmergencyController,
      switchToHttp: () => ({ getRequest: () => ({ user, method: 'POST', params: {}, query: {}, body: {} }) }),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it.each([
    ['POST', '/api/v1/emergency/trigger', { scopeType: 'tenant', scopeId: A }],
    ['POST', '/api/v1/emergency/trigger', { scopeType: 'group', scopeId: 'grp-gym' }],
    ['POST', '/api/v1/emergency/trigger', { scopeType: 'device', scopeId: 'scr-a3' }],
    ['POST', '/api/v1/emergency/screens/scr-a3/trigger', {}],
    ['POST', '/api/v1/emergency/screens/bulk-trigger', { screenIds: ['scr-a3', 'scr-a1'] }],
    ['POST', '/api/v1/emergency/ovr_1/all-clear', { scopeType: 'tenant', scopeId: A }],
    ['GET', '/api/v1/emergency/targets', undefined],
    ['GET', '/api/v1/emergency/active', undefined],
    ['GET', '/api/v1/emergency/status', undefined],
  ])('the scope gate lets %s %s %j through untouched', async (method, url, body) => {
    const h = harness();
    expect((await gate(h, person('u-scoped-panic', 'CONTRIBUTOR', A, { canTriggerPanic: true }), method, url, body)).verdict).toBe('allow');
  });

  it('the target picker shows EVERY screen and group of the location, and "all screens" resolves to the whole location', async () => {
    const h = harness();
    const user = person('u-scoped-panic', 'CONTRIBUTOR', A, { canTriggerPanic: true });
    const { req } = await gate(h, user, 'GET', '/api/v1/emergency/targets');
    expect(screenScopeOf(req)).not.toBeNull(); // they ARE screen-scoped…
    const c = build(h.prisma);
    const targets: any = await c.targets(req);
    // …and still see every screen of their location.
    expect(targets.screens.map((s: any) => s.id).sort()).toEqual(['scr-a1', 'scr-a2', 'scr-a2-back', 'scr-a3', 'scr-a4']);
    expect(targets.groups.map((g: any) => g.id).sort()).toEqual(['grp-gym', 'grp-lobby']);
    expect(targets.allScreensCount).toBe(5);
    // "All screens" is the location itself — the same ownership answer as an unscoped person.
    await expect((c as any).resolveScopeTenant('tenant', A, user)).resolves.toBe(A);
    await expect((c as any).resolveScopeTenant('group', 'grp-gym', user)).resolves.toBe(A);
    await expect((c as any).resolveScopeTenant('device', 'scr-a3', user)).resolves.toBe(A);
    // …and never another location (unchanged rule).
    await expect((c as any).resolveScopeTenant('tenant', B, user)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('multi-location: in a given location the emergency reach is that location (same rule as their role there)', async () => {
    const h = harness();
    const user = person('u-multi', 'SCHOOL_ADMIN', B);
    expect((await gate(h, user, 'POST', '/api/v1/emergency/trigger', { scopeType: 'tenant', scopeId: B })).verdict).toBe('allow');
    const c = build(h.prisma);
    await expect((c as any).resolveScopeTenant('tenant', B, user)).resolves.toBe(B);
    await expect((c as any).resolveScopeTenant('tenant', A, user)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ─── 4. EXISTING ROLES UNCHANGED ──────────────────────────────────────────

describe('user scoping — everyone else is untouched', () => {
  it('org admins, super admins, screens and API keys never reach the scope lookup', async () => {
    const h = harness();
    const spy = jest.spyOn(h.service, 'resolve');
    // The handler's own observable comes straight back: no lookup, no wrapping.
    const HANDLED = Symbol('handled');
    const run = (user: any) => {
      const ctx = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ user, method: 'GET', originalUrl: '/api/v1/users' }) }) } as any;
      return h.interceptor.intercept(ctx, { handle: () => HANDLED as any });
    };
    expect(run(person('u-district', 'DISTRICT_ADMIN', ORG))).toBe(HANDLED);
    expect(run(person('super', 'SUPER_ADMIN', ORG))).toBe(HANDLED);
    expect(run({ id: 'scr-a1', kind: 'device', tenantId: A })).toBe(HANDLED);
    expect(run({ id: 'key', kind: 'api-key', role: 'CONTRIBUTOR', tenantId: A })).toBe(HANDLED);
    expect(run(undefined)).toBe(HANDLED);
    expect(spy).not.toHaveBeenCalled();
  });

  it('an org admin carrying a stale scope row is not screen-scoped (scope is for location roles only)', async () => {
    const h = harness();
    const access = await h.service.resolve('u-district', A);
    expect(access?.screenScope).toBeNull();
  });

  it('an unscoped location role passes every route to RbacGuard exactly as before, with no req.userScope', async () => {
    const h = harness();
    for (const [m, u] of [
      ['GET', '/api/v1/users'],
      ['GET', '/api/v1/billing/status'],
      ['POST', '/api/v1/screens/scr-a3/refresh-web'],
      ['PUT', '/api/v1/playlists/pl-mixed'],
      ['GET', '/api/v1/some/route/added/tomorrow'],
    ]) {
      const { verdict, req } = await gate(h, person('u-plain', 'SCHOOL_ADMIN'), m, u);
      expect([u, verdict]).toEqual([u, 'allow']);
      expect(screenScopeOf(req)).toBeNull();
    }
    const screens = await new ScreensController(h.prisma, stubRedis, stubSigner, stubLicense, stubStripe, stubMenu).list(
      (await gate(h, person('u-plain', 'CONTRIBUTOR'), 'GET', '/api/v1/screens')).req,
    );
    expect(ids(screens)).toEqual(['scr-a1', 'scr-a2', 'scr-a2-back', 'scr-a3', 'scr-a4']);
  });

  it('a deleted person is refused (no home to fall back on)', async () => {
    const ds = dataset();
    ds.user = ds.user.map((u) => (u.id === 'u-plain' ? { ...u, deletedAt: new Date() } : u));
    const h = harness(ds);
    expect((await gate(h, person('u-plain', 'CONTRIBUTOR'), 'GET', '/api/v1/screens')).verdict).toBe('LOCATION_ACCESS_REVOKED');
  });

  it('a failed lookup refuses (503) — except emergency routes, which go through', async () => {
    const h = harness();
    jest.spyOn(h.service, 'resolve').mockRejectedValue(new Error('db down'));
    const user = person('u-scoped', 'CONTRIBUTOR');
    await expect(h.interceptor.decide({ user, method: 'GET', originalUrl: '/api/v1/screens' }, user.id, A)).rejects.toMatchObject({ status: 503 });
    await expect(
      h.interceptor.decide({ user, method: 'POST', originalUrl: '/api/v1/emergency/trigger', body: {} }, user.id, A),
    ).resolves.toBeUndefined();
  });

  it('the cache is per (person, location) and cleared by invalidateUser', async () => {
    const h = harness();
    const findFirst = jest.spyOn(h.prisma.client.user, 'findFirst');
    await h.service.resolve('u-scoped', A);
    await h.service.resolve('u-scoped', A);
    expect(findFirst).toHaveBeenCalledTimes(1);
    h.service.invalidateUser('u-scoped');
    await h.service.resolve('u-scoped', A);
    expect(findFirst).toHaveBeenCalledTimes(2);
  });
});
