/**
 * GET/PUT /api/v1/users/:id/access — Settings → People → "Locations & screens".
 * Driven against the tenant-evaluating Prisma double (two-tenant-prisma.ts), so
 * a write aimed at another organisation genuinely finds its row here.
 */
import 'reflect-metadata';
import { makeTwoTenantPrisma, type Dataset } from '../tenant-isolation/two-tenant-prisma';
import { UserAccessController } from './user-access.controller';
import { runWithSupportAccess } from '../support-access/support-access.context';
import { ROLES_KEY } from '../auth/roles.decorator';

const ORG = 'org';
const A = 'loc-a';
const B = 'loc-b';
const C = 'loc-c';
const ARCH = 'loc-arch';
const FOREIGN = 'foreign-org';
const FOREIGN_LOC = 'foreign-loc';

function dataset(): Dataset {
  const t = (id: string, parentId: string | null, archivedAt: Date | null = null) => ({ id, name: id.toUpperCase(), slug: id, parentId, archivedAt });
  const u = (id: string, role: string, tenantId: string) => ({ id, role, tenantId, email: `${id}@example.test`, status: 'ACTIVE', deletedAt: null });
  return {
    tenant: [t(ORG, null), t(A, ORG), t(B, ORG), t(C, ORG), t(ARCH, ORG, new Date()), t(FOREIGN, null), t(FOREIGN_LOC, FOREIGN)],
    user: [
      u('admin-org', 'DISTRICT_ADMIN', ORG),
      u('admin-peer', 'DISTRICT_ADMIN', ORG),
      u('admin-a', 'SCHOOL_ADMIN', A),
      u('u-x', 'CONTRIBUTOR', A),
      u('u-b', 'CONTRIBUTOR', B),
      u('u-foreign', 'CONTRIBUTOR', FOREIGN_LOC),
    ],
    userLocationAccess: [{ id: 'ula-1', userId: 'u-x', tenantId: C }],
    userScreenScope: [{ id: 'uss-c', userId: 'u-x', tenantId: C, screenId: 'scr-c1', screenGroupId: null }],
    screen: [
      { id: 'scr-a1', tenantId: A, name: 'A1', screenGroupId: 'grp-a', faceOfScreenId: null },
      { id: 'scr-a2', tenantId: A, name: 'A2', screenGroupId: null, faceOfScreenId: null },
      { id: 'scr-b1', tenantId: B, name: 'B1', screenGroupId: null, faceOfScreenId: null },
      { id: 'scr-c1', tenantId: C, name: 'C1', screenGroupId: null, faceOfScreenId: null },
      { id: 'scr-f1', tenantId: FOREIGN_LOC, name: 'F1', screenGroupId: null, faceOfScreenId: null },
    ],
    screenGroup: [
      { id: 'grp-a', tenantId: A, name: 'Lobby' },
      { id: 'grp-b', tenantId: B, name: 'B lobby' },
    ],
    auditLog: [],
  };
}

function setup(ds: Dataset = dataset()) {
  const p = makeTwoTenantPrisma(ds);
  const scope = { invalidateUser: jest.fn() };
  const controller = new UserAccessController({ client: p.client } as any, scope as any);
  const rows = (model: string) => (p.client as any)[model].findMany({});
  return { p, controller, scope, rows };
}

const caller = (id: string, role: string, tenantId: string) => ({ user: { id, userId: id, role, tenantId, email: `${id}@example.test` } });
const ORG_ADMIN = () => caller('admin-org', 'DISTRICT_ADMIN', ORG);
const LOC_ADMIN = () => caller('admin-a', 'SCHOOL_ADMIN', A);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e: any) {
    return `${e.getStatus?.()} ${e.getResponse?.()?.code ?? e.message}`;
  }
};

describe('UserAccessController — route metadata', () => {
  it('admins only (a contributor / viewer cannot read or change anyone\'s access)', () => {
    for (const h of ['getAccess', 'setAccess'] as const) {
      const roles = Reflect.getMetadata(ROLES_KEY, (UserAccessController.prototype as any)[h]);
      expect(roles).toEqual(['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']);
    }
  });
});

describe('GET /users/:id/access', () => {
  it('org admin: every live location of the organisation, home + given marked, options for each reachable one', async () => {
    const { controller } = setup();
    const out: any = await controller.getAccess(ORG_ADMIN(), 'u-x');
    expect(out.scopable).toBe(true);
    expect(out.canEditLocations).toBe(true);
    expect(out.locations.map((l: any) => [l.id, l.isHome, l.granted]).sort()).toEqual([
      [A, true, true],
      [B, false, false],
      [C, false, true],
      [ORG, false, false],
    ]);
    expect(Object.keys(out.options).sort()).toEqual([A, C]);
    expect(out.options[A].screens.map((s: any) => s.id).sort()).toEqual(['scr-a1', 'scr-a2']);
    expect(out.screenScopes).toEqual({ [C]: { screenIds: ['scr-c1'], screenGroupIds: [] } });
  });

  it('location admin: sees only the person\'s own locations, read-only; screen options for their location only', async () => {
    const { controller } = setup();
    const out: any = await controller.getAccess(LOC_ADMIN(), 'u-x');
    expect(out.canEditLocations).toBe(false);
    expect(out.locations.map((l: any) => l.id).sort()).toEqual([A, C]);
    expect(Object.keys(out.options)).toEqual([A]);
  });

  it('another organisation\'s person, or another location\'s person for a location admin → 404', async () => {
    const { controller } = setup();
    expect(await code(controller.getAccess(ORG_ADMIN(), 'u-foreign'))).toBe('404 USER_NOT_FOUND');
    expect(await code(controller.getAccess(LOC_ADMIN(), 'u-b'))).toBe('404 USER_NOT_FOUND');
  });
});

describe('PUT /users/:id/access', () => {
  it('org admin gives a location: row written, audited before → after, cache cleared on this replica', async () => {
    const { controller, rows, scope } = setup();
    const out: any = await controller.setAccess(ORG_ADMIN(), 'u-x', { locationIds: [B, C] });
    expect(out.changed).toBe(true);
    expect((await rows('userLocationAccess')).map((r: any) => r.tenantId).sort()).toEqual([B, C]);
    const audit = await rows('auditLog');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'USER_ACCESS_UPDATED', tenantId: A, targetId: 'u-x', userId: 'admin-org' });
    const details = JSON.parse(audit[0].details);
    expect(details.before.locationIds).toEqual([C]);
    expect(details.after.locationIds).toEqual([B, C]);
    expect(scope.invalidateUser).toHaveBeenCalledWith('u-x');
  });

  it('removing a location also removes the screen limits there', async () => {
    const { controller, rows } = setup();
    await controller.setAccess(ORG_ADMIN(), 'u-x', { locationIds: [] });
    expect(await rows('userLocationAccess')).toEqual([]);
    expect(await rows('userScreenScope')).toEqual([]);
  });

  it('org admin limits screens in the home location (screens + a group) and clears them again', async () => {
    const { controller, rows } = setup();
    await controller.setAccess(ORG_ADMIN(), 'u-x', { screenScopes: { [A]: { screenIds: ['scr-a2'], screenGroupIds: ['grp-a'] } } });
    const inA = (await rows('userScreenScope')).filter((r: any) => r.tenantId === A);
    expect(inA.map((r: any) => r.screenId ?? r.screenGroupId).sort()).toEqual(['grp-a', 'scr-a2']);
    await controller.setAccess(ORG_ADMIN(), 'u-x', { screenScopes: { [A]: null } });
    expect((await rows('userScreenScope')).filter((r: any) => r.tenantId === A)).toEqual([]);
    // C untouched throughout.
    expect((await rows('userScreenScope')).filter((r: any) => r.tenantId === C)).toHaveLength(1);
  });

  it.each<[string, any, string]>([
    ['a location of another organisation', { locationIds: [FOREIGN_LOC] }, '400 USER_ACCESS_LOCATION_INVALID'],
    ['an archived location', { locationIds: [ARCH] }, '400 USER_ACCESS_LOCATION_INVALID'],
    ['a made-up location', { locationIds: ['nope'] }, '400 USER_ACCESS_LOCATION_INVALID'],
    ['a screen from another location', { screenScopes: { [A]: { screenIds: ['scr-b1'] } } }, '400 USER_ACCESS_SCREEN_INVALID'],
    ['a screen from another organisation', { screenScopes: { [A]: { screenIds: ['scr-f1'] } } }, '400 USER_ACCESS_SCREEN_INVALID'],
    ['a group from another location', { screenScopes: { [A]: { screenGroupIds: ['grp-b'] } } }, '400 USER_ACCESS_SCREEN_INVALID'],
    ['limits in a location the person cannot use', { screenScopes: { [B]: { screenIds: ['scr-b1'] } } }, '400 USER_ACCESS_LOCATION_INVALID'],
    ['a malformed list', { locationIds: 'loc-b' }, '400 USER_ACCESS_INVALID'],
  ])('refuses %s, writes nothing', async (_label, body, expected) => {
    const { controller, rows } = setup();
    expect(await code(controller.setAccess(ORG_ADMIN(), 'u-x', body))).toBe(expected);
    expect(await rows('auditLog')).toEqual([]);
    expect((await rows('userLocationAccess')).map((r: any) => r.tenantId)).toEqual([C]);
  });

  it('location admin: may limit screens in their location, may not change locations or limits elsewhere', async () => {
    const { controller, rows } = setup();
    expect(await code(controller.setAccess(LOC_ADMIN(), 'u-x', { screenScopes: { [A]: { screenIds: ['scr-a1'] } } }))).toBe('ok');
    expect(await code(controller.setAccess(LOC_ADMIN(), 'u-x', { locationIds: [B, C] }))).toBe('403 USER_ACCESS_LOCATIONS_ORG_ADMIN_ONLY');
    expect(await code(controller.setAccess(LOC_ADMIN(), 'u-x', { screenScopes: { [C]: null } }))).toBe('403 USER_ACCESS_SCOPE_NOT_YOURS');
    // Sending the locations back unchanged is fine (the editor always sends them).
    expect(await code(controller.setAccess(LOC_ADMIN(), 'u-x', { locationIds: [C] }))).toBe('ok');
    expect((await rows('userLocationAccess')).map((r: any) => r.tenantId)).toEqual([C]);
  });

  it('org admins cannot be scoped; peers / self are refused by the shared People gate', async () => {
    const { controller } = setup();
    const superCaller = caller('root', 'SUPER_ADMIN', ORG);
    expect(await code(controller.setAccess(superCaller, 'admin-peer', { locationIds: [B] }))).toBe('400 USER_ACCESS_ROLE_NOT_SCOPABLE');
    expect(await code(controller.setAccess(superCaller, 'admin-peer', { screenScopes: { [ORG]: { screenIds: ['scr-a1'] } } }))).toBe(
      '400 USER_ACCESS_ROLE_NOT_SCOPABLE',
    );
    expect(await code(controller.setAccess(ORG_ADMIN(), 'admin-peer', { locationIds: [B] }))).toMatch(/^403/);
    expect(await code(controller.setAccess(ORG_ADMIN(), 'admin-org', { locationIds: [B] }))).toBe('400 USER_CANNOT_ACT_ON_SELF');
    expect(await code(controller.setAccess(LOC_ADMIN(), 'u-foreign', { locationIds: [] }))).toBe('404 USER_NOT_FOUND');
  });

  it('a no-op save writes nothing and says so', async () => {
    const { controller, rows, scope } = setup();
    const out: any = await controller.setAccess(ORG_ADMIN(), 'u-x', { locationIds: [C], screenScopes: { [C]: { screenIds: ['scr-c1'], screenGroupIds: [] } } });
    expect(out.changed).toBe(false);
    expect(await rows('auditLog')).toEqual([]);
    expect(scope.invalidateUser).not.toHaveBeenCalled();
  });

  it('support access: a super admin with no grant on the organisation is refused before anything is written', async () => {
    const { controller, rows } = setup();
    const refusing = {
      assertReach: jest.fn(async () => {
        throw Object.assign(new Error('SUPPORT_ACCESS_REQUIRED'), { getStatus: () => 403, getResponse: () => ({ code: 'SUPPORT_ACCESS_REQUIRED' }) });
      }),
    };
    const result = await runWithSupportAccess({ service: refusing as any, workspace: null }, () =>
      code(controller.setAccess(caller('root', 'SUPER_ADMIN', ORG), 'u-x', { locationIds: [B, C] })),
    );
    expect(result).toBe('403 SUPPORT_ACCESS_REQUIRED');
    expect(await rows('auditLog')).toEqual([]);
  });
});
