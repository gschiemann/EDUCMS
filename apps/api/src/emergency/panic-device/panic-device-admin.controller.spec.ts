/**
 * Panic phones (2026-11-14) — the admin list / revoke routes, TWO TENANTS ×
 * EVERY ROLE, in the pattern of `tenant-isolation/two-tenant-role-matrix.spec.ts`.
 *
 * Why its own file (like users.controller and account-admin.controller):
 * these routes resolve the person through `users/manageable-target.ts`,
 * where SUPER_ADMIN is cross-organisation BY DESIGN (under a support grant)
 * and a scope miss answers 404 — a generic matrix row would assert the wrong
 * thing for SUPER_ADMIN. Here every non-SUPER role of tenant A is refused for
 * tenant B's person, and touches none of B's phones; SUPER_ADMIN crosses.
 *
 * The Prisma double really evaluates every `where`, so a query that forgot its
 * tenant predicate genuinely reaches the other organisation's row.
 */
import 'reflect-metadata';
import { AppRole } from '@cms/database';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { makeTwoTenantPrisma } from '../../tenant-isolation/two-tenant-prisma';
import { PanicDeviceAdminController } from './panic-device-admin.controller';
import { PanicDeviceService } from './panic-device.service';

const HOME = 't-alpha';
const FOREIGN = 't-beta';
const ALL_ROLES: AppRole[] = [
  AppRole.SUPER_ADMIN,
  AppRole.DISTRICT_ADMIN,
  AppRole.SCHOOL_ADMIN,
  AppRole.CONTRIBUTOR,
  AppRole.RESTRICTED_VIEWER,
];

const phone = (id: string, userId: string, tenantId: string, revokedAt: Date | null = null) => ({
  id,
  userId,
  tenantId,
  secretHash: `hash-${id}`,
  label: 'iPhone · Safari',
  createdAt: new Date('2026-11-01T00:00:00Z'),
  createdIp: '203.0.113.1',
  lastUsedAt: null,
  lastUsedIp: null,
  revokedAt,
  revokedByUserId: null,
  revokedReason: revokedAt ? 'self' : null,
});

function dataset() {
  return {
    tenant: [
      { id: HOME, name: 'Alpha', parentId: null, archivedAt: null },
      { id: FOREIGN, name: 'Beta', parentId: null, archivedAt: null },
    ],
    user: [
      { id: 'user-a', tenantId: HOME, role: AppRole.SCHOOL_ADMIN, email: 'a@x.test', status: 'ACTIVE', deletedAt: null, canTriggerPanic: false },
      { id: 'teacher-a', tenantId: HOME, role: AppRole.CONTRIBUTOR, email: 't-a@x.test', status: 'ACTIVE', deletedAt: null, canTriggerPanic: true },
      { id: 'teacher-b', tenantId: FOREIGN, role: AppRole.CONTRIBUTOR, email: 't-b@x.test', status: 'ACTIVE', deletedAt: null, canTriggerPanic: true },
    ],
    panicDevice: [phone('pd-a', 'teacher-a', HOME), phone('pd-b', 'teacher-b', FOREIGN)],
    auditLog: [],
  };
}

function build() {
  const prisma = makeTwoTenantPrisma(dataset());
  const devices = new PanicDeviceService({ client: prisma.client } as any);
  const controller = new PanicDeviceAdminController(devices, { client: prisma.client } as any);
  return { prisma, controller };
}

const actor = (role: AppRole) => ({
  user: { id: 'user-a', tenantId: HOME, schoolId: HOME, districtId: HOME, role, email: 'a@example.test' },
  headers: {},
  ip: '127.0.0.1',
});

describe('two tenants × every role — another organisation’s person’s phones', () => {
  for (const role of ALL_ROLES) {
    const crosses = role === AppRole.SUPER_ADMIN;

    it(`${role} of tenant A ${crosses ? 'MAY (by design)' : 'cannot'} list tenant B’s person’s phones`, async () => {
      const { prisma, controller } = build();
      let result: any = null;
      let threw = false;
      try {
        result = await controller.list(actor(role), 'teacher-b');
      } catch {
        threw = true;
      }
      const foreignPhones = prisma.foreignTouches(HOME).filter((t) => t.model === 'panicDevice');
      if (crosses) {
        expect(threw).toBe(false);
        expect(result.devices.map((d: any) => d.id)).toEqual(['pd-b']);
      } else {
        expect(threw).toBe(true);
        // The person row may be READ to discover the refusal (the shared
        // resolver); a foreign phone row is never touched.
        expect(foreignPhones).toEqual([]);
      }
    });

    it(`${role} of tenant A ${crosses ? 'MAY (by design)' : 'cannot'} revoke tenant B’s person’s phone`, async () => {
      const { prisma, controller } = build();
      let threw = false;
      try {
        await controller.revoke(actor(role), 'teacher-b', 'pd-b');
      } catch {
        threw = true;
      }
      const writes = prisma.foreignTouches(HOME).filter((t) => t.isWrite);
      const [pdB] = await (prisma.client as any).panicDevice.findMany({ where: { id: 'pd-b' } });
      if (crosses) {
        expect(threw).toBe(false);
        expect(pdB.revokedAt).toBeInstanceOf(Date);
      } else {
        expect(threw).toBe(true);
        expect(writes).toEqual([]);
        expect(pdB.revokedAt).toBeNull();
      }
    });
  }

  it('a foreign phone id under one of MY people’s URLs is 404 — the query carries the person AND the tenant', async () => {
    const { prisma, controller } = build();
    await expect(controller.revoke(actor(AppRole.SCHOOL_ADMIN), 'teacher-a', 'pd-b')).rejects.toMatchObject({ status: 404 });
    const [pdB] = await (prisma.client as any).panicDevice.findMany({ where: { id: 'pd-b' } });
    expect(pdB.revokedAt).toBeNull();
    expect(prisma.foreignTouches(HOME).filter((t) => t.isWrite)).toEqual([]);
  });

  it('route metadata: both routes are admin-only — a CONTRIBUTOR or a viewer never reaches them', () => {
    for (const handler of ['list', 'revoke']) {
      const roles: AppRole[] = Reflect.getMetadata(ROLES_KEY, (PanicDeviceAdminController.prototype as any)[handler]);
      expect(roles).toEqual([AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN]);
    }
  });
});

describe('inside the organisation', () => {
  it('a school admin sees a teacher’s phones (never a secret hash) and whether that person can send now', async () => {
    const { controller } = build();
    const out: any = await controller.list(actor(AppRole.SCHOOL_ADMIN), 'teacher-a');
    expect(out.personCanSend).toBe(true);
    expect(out.devices).toEqual([expect.objectContaining({ id: 'pd-a', label: 'iPhone · Safari', state: 'active' })]);
    expect(JSON.stringify(out)).not.toContain('hash-pd-a');
    expect(JSON.stringify(out)).not.toContain('203.0.113.1');
  });

  it('revoke turns it off at once and writes an immutable row naming the admin; a second revoke changes nothing', async () => {
    const { prisma, controller } = build();
    const first: any = await controller.revoke(actor(AppRole.SCHOOL_ADMIN), 'teacher-a', 'pd-a');
    expect(first).toMatchObject({ revoked: true, device: { id: 'pd-a', state: 'revoked' } });
    const second: any = await controller.revoke(actor(AppRole.SCHOOL_ADMIN), 'teacher-a', 'pd-a');
    expect(second.revoked).toBe(false);
    const rows = (await (prisma.client as any).auditLog.findMany({})).filter((r: any) => r.action === 'PANIC_DEVICE_REVOKED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: HOME, userId: 'user-a', targetId: 'pd-a' });
    expect(JSON.parse(rows[0].details)).toMatchObject({ reason: 'admin', ownerUserId: 'teacher-a' });
  });

  it('a person who can no longer send is shown as such', async () => {
    const { prisma, controller } = build();
    await (prisma.client as any).user.updateMany({ where: { id: 'teacher-a' }, data: { canTriggerPanic: false } });
    const out: any = await controller.list(actor(AppRole.SCHOOL_ADMIN), 'teacher-a');
    expect(out.personCanSend).toBe(false);
  });
});
