import { HttpException } from '@nestjs/common';

import { ScheduledRebootController, ScheduledRebootPolicySchema } from './scheduled-reboot.controller';
import { SCHEDULED_REBOOT_AUDIT } from './scheduled-reboot.service';

const A = 'tenant-a';
const B = 'tenant-b';

function build() {
  const groups = [
    { id: 'g-a', tenantId: A },
    { id: 'g-b', tenantId: B },
  ];
  const policies: any[] = [];
  const writes: string[] = [];
  const prisma: any = {
    client: {
      screenGroup: {
        findFirst: jest.fn(async ({ where }: any) => {
          const scope = where.AND?.[0]?.id?.in as string[] | undefined;
          return groups.find((g) => g.id === where.id && g.tenantId === where.tenantId && (!scope || scope.includes(g.id))) ?? null;
        }),
      },
      screenRebootPolicy: {
        findFirst: jest.fn(async ({ where }: any) => {
          const p = policies.find((x) => x.tenantId === where.tenantId && (where.id ? x.id === where.id : x.screenGroupId === where.screenGroupId));
          return p ? { ...p } : null;
        }),
        create: jest.fn(async ({ data }: any) => {
          writes.push('create');
          const row = { id: `p${policies.length + 1}`, ...data };
          policies.push(row);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          writes.push('update');
          const hit = policies.filter((p) => p.id === where.id && p.tenantId === where.tenantId);
          hit.forEach((p) => Object.assign(p, data));
          return { count: hit.length };
        }),
        deleteMany: jest.fn(async ({ where }: any) => {
          writes.push('delete');
          const i = policies.findIndex((p) => p.id === where.id && p.tenantId === where.tenantId);
          if (i >= 0) policies.splice(i, 1);
          return { count: i >= 0 ? 1 : 0 };
        }),
      },
      screen: { findMany: jest.fn(async ({ where }: any) => (where.tenantId === A ? [{ id: 's1', name: 'Lobby', displayCapabilities: { verdict: { reboot: 'none' } } }] : [])) },
      screenRebootRun: { findMany: jest.fn(async () => [{ screenId: 's1', status: 'SKIPPED', reason: 'cannot-restart' }]) },
    },
  };
  const display: any = { writeAudit: jest.fn(async () => undefined) };
  return { ctrl: new ScheduledRebootController(prisma, display), prisma, display, policies, writes };
}

const reqA = { user: { id: 'u1', tenantId: A } };
const body = { cadence: 'DAILY' as const, time: '03:00' };

describe('ScheduledRebootController', () => {
  const env = process.env.SCHEDULED_REBOOTS_DISABLED;
  afterEach(() => {
    if (env === undefined) delete process.env.SCHEDULED_REBOOTS_DISABLED;
    else process.env.SCHEDULED_REBOOTS_DISABLED = env;
  });

  it('sets a policy and audits who, before and after', async () => {
    const t = build();
    await t.ctrl.set('g-a', reqA, body);
    expect(t.policies[0]).toMatchObject({ tenantId: A, screenGroupId: 'g-a', cadence: 'DAILY', time: '03:00', dayOfWeek: null, isActive: true, updatedById: 'u1' });
    expect(t.display.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: SCHEDULED_REBOOT_AUDIT.POLICY_SET,
        targetType: 'screen_group',
        targetId: 'g-a',
        tenantId: A,
        userId: 'u1',
        details: expect.objectContaining({ before: null, after: expect.objectContaining({ time: '03:00' }) }),
      }),
    );
    await t.ctrl.set('g-a', reqA, { cadence: 'WEEKLY', dayOfWeek: 0, time: '23:00' });
    expect(t.policies).toHaveLength(1);
    expect(t.display.writeAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({ details: expect.objectContaining({ before: expect.objectContaining({ time: '03:00' }) }) }),
    );
  });

  it('delete removes it and audits; deleting nothing writes nothing', async () => {
    const t = build();
    await t.ctrl.remove('g-a', reqA);
    expect(t.display.writeAudit).not.toHaveBeenCalled();
    await t.ctrl.set('g-a', reqA, body);
    await t.ctrl.remove('g-a', reqA);
    expect(t.policies).toHaveLength(0);
    expect(t.display.writeAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: SCHEDULED_REBOOT_AUDIT.POLICY_DELETED, tenantId: A }));
  });

  it('tenant isolation: another tenant’s group is 404 for read, set and delete, and nothing is written', async () => {
    const t = build();
    for (const call of [() => t.ctrl.get('g-b', reqA), () => t.ctrl.set('g-b', reqA, body), () => t.ctrl.remove('g-b', reqA)]) {
      await expect(call()).rejects.toMatchObject({ status: 404 });
    }
    expect(t.writes).toHaveLength(0);
    expect(t.display.writeAudit).not.toHaveBeenCalled();
  });

  it('a screen-scoped person reaches only their own groups', async () => {
    const t = build();
    // The scope rides the request key the user-scope middleware sets.
    const scoped = { ...reqA, userScope: { screenIds: [], groupIds: ['other'] } } as any;
    await expect(t.ctrl.set('g-a', scoped, body)).rejects.toMatchObject({ status: 404 });
    expect(t.prisma.client.screenGroup.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'g-a', tenantId: A });
    expect(t.writes).toHaveLength(0);
    const inScope = { ...reqA, userScope: { screenIds: [], groupIds: ['g-a'] } } as any;
    await t.ctrl.set('g-a', inScope, body);
    expect(t.policies).toHaveLength(1);
  });

  it('the read says which screens cannot restart and their last result', async () => {
    const t = build();
    const r = await t.ctrl.get('g-a', reqA);
    expect(r).toMatchObject({ disabled: false, policy: null, screens: [{ id: 's1', canRestart: false, lastRun: { reason: 'cannot-restart' } }] });
  });

  it('kill switch: writes are refused with 409, reads say disabled', async () => {
    process.env.SCHEDULED_REBOOTS_DISABLED = '1';
    const t = build();
    await expect(t.ctrl.set('g-a', reqA, body)).rejects.toBeInstanceOf(HttpException);
    await expect(t.ctrl.set('g-a', reqA, body)).rejects.toMatchObject({ status: 409 });
    expect(t.writes).toHaveLength(0);
    expect((await t.ctrl.get('g-a', reqA)).disabled).toBe(true);
  });

  it('no tenant on the session is refused', async () => {
    const t = build();
    await expect(t.ctrl.get('g-a', { user: {} })).rejects.toMatchObject({ status: 403 });
  });

  it('the body schema refuses a daytime time and a weekly policy with no day', () => {
    expect(ScheduledRebootPolicySchema.safeParse({ cadence: 'DAILY', time: '03:00' }).success).toBe(true);
    expect(ScheduledRebootPolicySchema.safeParse({ cadence: 'DAILY', time: '12:00' }).success).toBe(false);
    expect(ScheduledRebootPolicySchema.safeParse({ cadence: 'WEEKLY', time: '03:00' }).success).toBe(false);
    expect(ScheduledRebootPolicySchema.safeParse({ cadence: 'WEEKLY', dayOfWeek: 6, time: '22:30' }).success).toBe(true);
    expect(ScheduledRebootPolicySchema.safeParse({ cadence: 'DAILY', time: '03:00', tenantId: 'x' }).success).toBe(false);
  });
});
