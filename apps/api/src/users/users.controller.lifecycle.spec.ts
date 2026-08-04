/**
 * User lifecycle — demote / disable / delete (2026-08-03).
 *
 * THE GAP THESE CLOSE. Demote, delete and disable were `@RequireRoles(
 * SUPER_ADMIN)` — so a customer's own DISTRICT_ADMIN could not cut off a
 * departing employee without phoning the vendor. Disable did not exist at
 * all: `User.status` gates login but nothing outside the invite flow wrote it.
 *
 * The revocation machinery was already built and correct; it was unreachable.
 * These tests pin the gate that makes it reachable WITHOUT opening a
 * cross-tenant or privilege-escalation hole:
 *
 *   - a caller reaches their own tenant, and (DISTRICT_ADMIN only) any tenant
 *     whose parentId is theirs — the same reach `createInvite` grants for
 *     ADDING users, so firing mirrors hiring;
 *   - a caller may only act on someone STRICTLY BELOW their own rank; peers
 *     and superiors are refused, including one SUPER_ADMIN against another;
 *   - self is refused everywhere EXCEPT role change, where self-demote is a
 *     legitimate consented action;
 *   - every tightening (demote-downgrade, disable, delete) burns the target's
 *     live sessions, and every action writes an immutable audit row.
 */
import { ForbiddenException, BadRequestException, HttpException } from '@nestjs/common';
import { AppRole } from '@cms/database';
import { UsersController } from './users.controller';

type Row = {
  id: string;
  email: string;
  role: string;
  tenantId: string;
  status?: string;
  deletedAt?: Date | null;
};

/** Tenants: `district` (root), `school` (child of district), `other` (unrelated root). */
const TENANTS: Record<string, { id: string; parentId: string | null }> = {
  district: { id: 'district', parentId: null },
  school: { id: 'school', parentId: 'district' },
  other: { id: 'other', parentId: null },
};

function makeDeps(rows: Row[]) {
  const audits: any[] = [];
  const updates: any[] = [];
  const tx = {
    user: {
      update: jest.fn(async ({ where, data }: any) => {
        updates.push({ where, data });
        const r = rows.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return { ...r };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id && x.tenantId === where.tenantId);
        if (!r) return { count: 0 };
        updates.push({ where, data });
        Object.assign(r, data);
        return { count: 1 };
      }),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => { audits.push(data); return data; }) },
  };
  const prisma: any = {
    client: {
      user: {
        // Return a COPY, like real Prisma — a live reference would let the
        // in-transaction write mutate the caller's "before" snapshot, which is
        // exactly the class of bug that hides a missing revoke-on-tightening.
        findFirst: jest.fn(async ({ where }: any) => {
          const r = rows.find(
            (x) => x.id === where.id && (where.deletedAt !== null || !x.deletedAt),
          );
          return r ? { ...r } : null;
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          const r = rows.find((x) => x.id === where.id);
          return r ? { ...r } : null;
        }),
      },
      tenant: {
        findUnique: jest.fn(async ({ where }: any) => TENANTS[where.id] ?? null),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    },
  };
  const redis: any = { markUserTokensInvalid: jest.fn(async () => undefined) };
  return { prisma, redis, audits, updates, tx, rows };
}

const caller = (role: string, tenantId: string, id = `caller-${role}`) => ({
  user: { id, role, tenantId },
});

function target(over: Partial<Row> = {}): Row {
  return {
    id: 'u-target',
    email: 'staffer@school.test',
    role: AppRole.CONTRIBUTOR,
    tenantId: 'district',
    status: 'ACTIVE',
    deletedAt: null,
    ...over,
  };
}

// ───────────────────────── demote (PUT :id/role) ─────────────────────────

describe('PUT /users/:id/role — customers can demote their own staff', () => {
  it('DISTRICT_ADMIN demotes a SCHOOL_ADMIN in their own tenant, and the downgrade revokes sessions', async () => {
    const d = makeDeps([target({ role: AppRole.SCHOOL_ADMIN })]);
    const c = new UsersController(d.prisma, d.redis);

    const res = await c.updateRole(caller(AppRole.DISTRICT_ADMIN, 'district'), 'u-target', {
      role: AppRole.CONTRIBUTOR,
    });

    expect(res).toMatchObject({ id: 'u-target', role: AppRole.CONTRIBUTOR });
    expect(d.redis.markUserTokensInvalid).toHaveBeenCalledWith('u-target');
    expect(d.audits[0]).toMatchObject({ action: 'USER_ROLE_CHANGED', tenantId: 'district' });
  });

  it('SCHOOL_ADMIN demotes a CONTRIBUTOR in their own tenant', async () => {
    const d = makeDeps([target({ tenantId: 'school' })]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.updateRole(caller(AppRole.SCHOOL_ADMIN, 'school'), 'u-target', {
        role: AppRole.RESTRICTED_VIEWER,
      }),
    ).resolves.toMatchObject({ role: AppRole.RESTRICTED_VIEWER });
  });

  it('REFUSES a PEER (SCHOOL_ADMIN → SCHOOL_ADMIN)', async () => {
    const d = makeDeps([target({ role: AppRole.SCHOOL_ADMIN, tenantId: 'school' })]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.updateRole(caller(AppRole.SCHOOL_ADMIN, 'school'), 'u-target', {
        role: AppRole.CONTRIBUTOR,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(d.prisma.client.$transaction).not.toHaveBeenCalled();
  });

  it('REFUSES a SUPERIOR (SCHOOL_ADMIN → DISTRICT_ADMIN)', async () => {
    const d = makeDeps([target({ role: AppRole.DISTRICT_ADMIN, tenantId: 'school' })]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.updateRole(caller(AppRole.SCHOOL_ADMIN, 'school'), 'u-target', {
        role: AppRole.CONTRIBUTOR,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('REFUSES an escalation attempt even on a valid target (DISTRICT_ADMIN → SUPER_ADMIN)', async () => {
    const d = makeDeps([target()]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.updateRole(caller(AppRole.DISTRICT_ADMIN, 'district'), 'u-target', {
        role: AppRole.SUPER_ADMIN,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(d.prisma.client.user.findFirst).not.toHaveBeenCalled();
  });

  it('SUPER_ADMIN cannot demote another SUPER_ADMIN (auth-BUG-011, now enforced by the shared rank gate)', async () => {
    const d = makeDeps([target({ role: AppRole.SUPER_ADMIN })]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.updateRole(caller(AppRole.SUPER_ADMIN, 'district'), 'u-target', {
        role: AppRole.CONTRIBUTOR,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('SUPER_ADMIN may still SELF-demote', async () => {
    const me: Row = {
      id: 'me', email: 'me@x.test', role: AppRole.SUPER_ADMIN, tenantId: 'district', status: 'ACTIVE',
    };
    const d = makeDeps([me]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.updateRole(
        { user: { id: 'me', role: AppRole.SUPER_ADMIN, tenantId: 'district' } },
        'me',
        { role: AppRole.DISTRICT_ADMIN },
      ),
    ).resolves.toMatchObject({ role: AppRole.DISTRICT_ADMIN });
  });
});

// ───────────────────────── tenant subtree ─────────────────────────

describe('tenant subtree — a customer admin cannot reach outside their own org', () => {
  it('DISTRICT_ADMIN CAN act on a user in a CHILD school', async () => {
    const d = makeDeps([target({ tenantId: 'school' })]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.updateRole(caller(AppRole.DISTRICT_ADMIN, 'district'), 'u-target', {
        role: AppRole.RESTRICTED_VIEWER,
      }),
    ).resolves.toBeDefined();
    // The write + audit row are owned by the CHILD tenant, not the caller's.
    expect(d.updates[0].where).toMatchObject({ id: 'u-target', tenantId: 'school' });
    expect(d.audits[0].tenantId).toBe('school');
  });

  it('DISTRICT_ADMIN CANNOT act on a user in an unrelated tenant', async () => {
    const d = makeDeps([target({ tenantId: 'other' })]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.updateRole(caller(AppRole.DISTRICT_ADMIN, 'district'), 'u-target', {
        role: AppRole.RESTRICTED_VIEWER,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('SCHOOL_ADMIN CANNOT act on a user in a sibling/child tenant (no subtree reach)', async () => {
    const d = makeDeps([target({ tenantId: 'district' })]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.setDisabled(caller(AppRole.SCHOOL_ADMIN, 'school'), 'u-target', { disabled: true }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('SUPER_ADMIN is cross-tenant by design', async () => {
    const d = makeDeps([target({ tenantId: 'other' })]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.setDisabled(caller(AppRole.SUPER_ADMIN, 'district'), 'u-target', { disabled: true }),
    ).resolves.toMatchObject({ status: 'DISABLED' });
  });
});

// ───────────────────────── disable (PUT :id/disabled) ─────────────────────────

describe('PUT /users/:id/disabled — the reversible "cut this person off" control', () => {
  it('disabling sets status DISABLED, audits it, and BURNS the live sessions', async () => {
    const d = makeDeps([target()]);
    const c = new UsersController(d.prisma, d.redis);

    const res = await c.setDisabled(caller(AppRole.DISTRICT_ADMIN, 'district'), 'u-target', {
      disabled: true,
    });

    expect(res).toMatchObject({ id: 'u-target', status: 'DISABLED' });
    expect(d.updates[0].data).toEqual({ status: 'DISABLED' });
    expect(d.redis.markUserTokensInvalid).toHaveBeenCalledWith('u-target');
    expect(d.audits[0]).toMatchObject({
      action: 'USER_DISABLED',
      tenantId: 'district',
      userId: 'caller-DISTRICT_ADMIN',
      targetId: 'u-target',
    });
    expect(JSON.parse(d.audits[0].details)).toMatchObject({
      fromStatus: 'ACTIVE',
      toStatus: 'DISABLED',
    });
  });

  it('re-enabling sets status ACTIVE and does NOT revoke (a widening)', async () => {
    const d = makeDeps([target({ status: 'DISABLED' })]);
    const c = new UsersController(d.prisma, d.redis);

    const res = await c.setDisabled(caller(AppRole.DISTRICT_ADMIN, 'district'), 'u-target', {
      disabled: false,
    });

    expect(res).toMatchObject({ status: 'ACTIVE' });
    expect(d.redis.markUserTokensInvalid).not.toHaveBeenCalled();
    expect(d.audits[0].action).toBe('USER_ENABLED');
  });

  it('a session-revocation failure never rolls back the disable (the DB row is authoritative)', async () => {
    const d = makeDeps([target()]);
    d.redis.markUserTokensInvalid.mockRejectedValueOnce(new Error('redis down'));
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.setDisabled(caller(AppRole.DISTRICT_ADMIN, 'district'), 'u-target', { disabled: true }),
    ).resolves.toMatchObject({ status: 'DISABLED' });
  });

  it('REFUSES an INVITED row in both directions (it still holds a placeholder password)', async () => {
    const d = makeDeps([target({ status: 'INVITED' })]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.setDisabled(caller(AppRole.DISTRICT_ADMIN, 'district'), 'u-target', { disabled: false }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      c.setDisabled(caller(AppRole.DISTRICT_ADMIN, 'district'), 'u-target', { disabled: true }),
    ).rejects.toThrow(BadRequestException);
    expect(d.prisma.client.$transaction).not.toHaveBeenCalled();
  });

  it('REFUSES self (an admin must not strand their own tenant)', async () => {
    const me: Row = {
      id: 'me', email: 'me@x.test', role: AppRole.CONTRIBUTOR, tenantId: 'district', status: 'ACTIVE',
    };
    const d = makeDeps([me]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.setDisabled(
        { user: { id: 'me', role: AppRole.DISTRICT_ADMIN, tenantId: 'district' } },
        'me',
        { disabled: true },
      ),
    ).rejects.toThrow(HttpException);
  });

  it('REFUSES a peer', async () => {
    const d = makeDeps([target({ role: AppRole.DISTRICT_ADMIN })]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.setDisabled(caller(AppRole.DISTRICT_ADMIN, 'district'), 'u-target', { disabled: true }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('REFUSES a non-boolean body', async () => {
    const d = makeDeps([target()]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.setDisabled(caller(AppRole.DISTRICT_ADMIN, 'district'), 'u-target', { disabled: 'yes' } as any),
    ).rejects.toThrow(BadRequestException);
  });
});

// ───────────────────────── delete (DELETE :id) ─────────────────────────

describe('DELETE /users/:id — customers can remove their own staff', () => {
  it('DISTRICT_ADMIN soft-deletes a CONTRIBUTOR in their own tenant, audits it, and revokes sessions', async () => {
    const d = makeDeps([target()]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.remove(caller(AppRole.DISTRICT_ADMIN, 'district'), 'u-target'),
    ).resolves.toEqual({ deleted: true });

    expect(d.audits[0]).toMatchObject({ action: 'USER_DELETED', tenantId: 'district' });
    const write = d.updates.at(-1)!;
    expect(write.where).toMatchObject({ id: 'u-target', tenantId: 'district' });
    expect(write.data.deletedAt).toBeInstanceOf(Date);
    expect(write.data.email).toBe('deleted+u-target@deleted.local');
    expect(d.redis.markUserTokensInvalid).toHaveBeenCalledWith('u-target');
  });

  it('SCHOOL_ADMIN can remove a CONTRIBUTOR in their own tenant', async () => {
    const d = makeDeps([target({ tenantId: 'school' })]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.remove(caller(AppRole.SCHOOL_ADMIN, 'school'), 'u-target'),
    ).resolves.toEqual({ deleted: true });
  });

  it('REFUSES a peer', async () => {
    const d = makeDeps([target({ role: AppRole.SCHOOL_ADMIN, tenantId: 'school' })]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.remove(caller(AppRole.SCHOOL_ADMIN, 'school'), 'u-target'),
    ).rejects.toThrow(ForbiddenException);
    expect(d.prisma.client.$transaction).not.toHaveBeenCalled();
  });

  it('REFUSES a user outside the caller subtree', async () => {
    const d = makeDeps([target({ tenantId: 'other' })]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.remove(caller(AppRole.DISTRICT_ADMIN, 'district'), 'u-target'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('still REFUSES self-deletion with the original code', async () => {
    const d = makeDeps([target({ id: 'me' })]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.remove({ user: { id: 'me', role: AppRole.DISTRICT_ADMIN, tenantId: 'district' } }, 'me'),
    ).rejects.toMatchObject({ response: { code: 'USER_CANNOT_DELETE_SELF' } });
  });

  it('404s on an already soft-deleted row', async () => {
    const d = makeDeps([target({ deletedAt: new Date() })]);
    const c = new UsersController(d.prisma, d.redis);

    await expect(
      c.remove(caller(AppRole.DISTRICT_ADMIN, 'district'), 'u-target'),
    ).rejects.toMatchObject({ response: { code: 'USER_NOT_FOUND' } });
  });
});
