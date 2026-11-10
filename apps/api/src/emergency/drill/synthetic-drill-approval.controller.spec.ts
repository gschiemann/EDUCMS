/**
 * The owner's permission route (2026-11-10): who may approve, what an approval
 * may cover, and that it can never widen the drill.
 */
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RbacGuard } from '../../auth/rbac.guard';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { ALLOW_PANIC_BYPASS_KEY as PANIC_BYPASS_KEY } from '../../auth/panic-bypass.decorator';
import { SyntheticDrillApprovalController } from './synthetic-drill-approval.controller';
import { DRILL_APPROVAL, DRILL_APPROVAL_REVOKED_ACTION, DRILL_APPROVED_ACTION, type DrillApprovedDetails } from './synthetic-drill.policy';

const NOW = Date.parse('2026-11-10T19:00:00Z');
const MIN = 60_000;
const A = '11111111-0000-4000-8000-000000000001';
const B = '22222222-0000-4000-8000-000000000002';
const C = '33333333-0000-4000-8000-000000000003';

function make(over: { enabled?: boolean; open?: DrillApprovedDetails[] | null; user?: Record<string, unknown> | null } = {}) {
  const audit: Array<Record<string, any>> = [];
  const prisma = {
    client: {
      user: { findFirst: jest.fn(async () => (over.user === undefined ? { role: 'SUPER_ADMIN', status: 'ACTIVE', deletedAt: null } : over.user)) },
      auditLog: { create: jest.fn((args: any) => ({ __row: args.data })) },
      $transaction: jest.fn(async (ops: Array<{ __row: Record<string, any> }>) => {
        for (const o of ops) audit.push(o.__row);
        return ops;
      }),
    },
  };
  const runner = {
    now: () => NOW,
    config: () => ({ enabled: over.enabled ?? true, disabledReason: over.enabled === false ? 'EMERGENCY_DRILL_CRON_DISABLED' : null, mode: 'shadow', screenIds: [A, B, C] }),
    listedScreens: jest.fn(async () => [
      { id: A, name: 'GUQ55', tenantId: 'bench', rootTenantId: 'bench', rootInternal: true },
      { id: B, name: 'M43', tenantId: 'bench-child', rootTenantId: 'bench', rootInternal: true },
      { id: C, name: 'Lobby', tenantId: 'customer', rootTenantId: 'customer', rootInternal: false },
    ]),
    readOpenApprovals: jest.fn(async () => (over.open === undefined ? [] : over.open)),
  };
  const ctl = new SyntheticDrillApprovalController(prisma as never, runner as never);
  const req = { user: { id: 'owner-1', tenantId: 'hq', role: 'SUPER_ADMIN' } };
  return { ctl, req, audit, prisma, runner };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e: any) {
    return `${e.getStatus?.()}:${e.getResponse?.().code}`;
  }
};

describe('who may approve', () => {
  it('SUPER_ADMIN only, behind the JWT and RBAC guards, with NO panic bypass', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SyntheticDrillApprovalController)).toEqual(['SUPER_ADMIN']);
    const guards = Reflect.getMetadata(GUARDS_METADATA, SyntheticDrillApprovalController);
    expect(guards).toEqual([JwtAuthGuard, RbacGuard]);
    for (const m of ['status', 'approve', 'revoke'] as const) {
      expect(Reflect.getMetadata(PANIC_BYPASS_KEY, SyntheticDrillApprovalController.prototype[m])).toBeUndefined();
      expect(Reflect.getMetadata(ROLES_KEY, SyntheticDrillApprovalController.prototype[m])).toBeUndefined();
    }
  });

  it('the account is read fresh: disabled, demoted, deleted or missing → 403, nothing written', async () => {
    for (const user of [null, { role: 'SUPER_ADMIN', status: 'DISABLED', deletedAt: null }, { role: 'DISTRICT_ADMIN', status: 'ACTIVE', deletedAt: null }, { role: 'SUPER_ADMIN', status: 'ACTIVE', deletedAt: new Date() }]) {
      const w = make({ user });
      expect(await code(w.ctl.approve(w.req, {}))).toBe('403:DRILL_APPROVER');
      expect(w.audit).toEqual([]);
    }
  });
});

describe('what an approval covers', () => {
  it('approve now: one audited row per bench organisation, naming the approver, only internal listed screens, a fixed 2 h window', async () => {
    const w = make();
    const r = await w.ctl.approve(w.req, {});
    expect(r).toMatchObject({ approved: true, runAtMs: NOW, expiresAtMs: NOW + DRILL_APPROVAL.WINDOW_MS, screenCount: 2 });
    expect(w.audit).toHaveLength(1);
    expect(w.audit[0]).toMatchObject({ tenantId: 'bench', userId: 'owner-1', action: DRILL_APPROVED_ACTION, targetType: 'Tenant', targetId: 'bench' });
    const d = JSON.parse(w.audit[0].details);
    expect(d).toMatchObject({ v: 1, approvalId: r.approvalId, runAtMs: NOW, approverUserId: 'owner-1', approverTenantId: 'hq' });
    // The customer's screen is listed by mistake — it is never part of a permission.
    expect(d.screenIds).toEqual([A, B]);
  });

  it('approve for tonight: the pass waits for that time', async () => {
    const w = make();
    const at = NOW + 9 * 60 * MIN;
    const r = await w.ctl.approve(w.req, { runAt: new Date(at).toISOString() });
    expect(r.runAtMs).toBe(at);
  });

  it('refuses a past time, a time more than 24 h ahead, a non-time and an unknown field — nothing written', async () => {
    for (const body of [{ runAt: new Date(NOW - 10 * MIN).toISOString() }, { runAt: new Date(NOW + 25 * 60 * MIN).toISOString() }, { runAt: 'tonight' }]) {
      const w = make();
      expect(await code(w.ctl.approve(w.req, body))).toBe('400:DRILL_APPROVAL_TIME');
      expect(w.audit).toEqual([]);
    }
    const w = make();
    expect(await code(w.ctl.approve(w.req, { screenIds: ['anything'] }))).toBe('400:DRILL_APPROVAL_INVALID');
    expect(w.audit).toEqual([]);
  });

  it('cannot arm the drill: off → 409; no internal bench screen → 409; one permission at a time → 409; unreadable → 503', async () => {
    let w = make({ enabled: false });
    expect(await code(w.ctl.approve(w.req, {}))).toBe('409:DRILL_NOT_ARMED');
    w = make();
    w.runner.listedScreens.mockResolvedValueOnce([{ id: C, name: 'Lobby', tenantId: 'customer', rootTenantId: 'customer', rootInternal: false }]);
    expect(await code(w.ctl.approve(w.req, {}))).toBe('409:DRILL_NO_BENCH_SCREENS');
    const open = [{ v: 1 as const, approvalId: 'apr-1', runAtMs: NOW + MIN, expiresAtMs: NOW + MIN + DRILL_APPROVAL.WINDOW_MS, screenIds: [A], approverUserId: 'owner-1', approverTenantId: 'hq' }];
    w = make({ open });
    expect(await code(w.ctl.approve(w.req, {}))).toBe('409:DRILL_ALREADY_APPROVED');
    expect(w.audit).toEqual([]);
    w = make({ open: null });
    expect(await code(w.ctl.approve(w.req, {}))).toBe('503:DRILL_APPROVALS_UNREADABLE');
    expect(w.audit).toEqual([]);
  });
});

describe('taking it back', () => {
  it('revoke writes an audited row for every open approval; with none open it writes nothing', async () => {
    const open = [{ v: 1 as const, approvalId: 'apr-1', runAtMs: NOW - MIN, expiresAtMs: NOW - MIN + DRILL_APPROVAL.WINDOW_MS, screenIds: [A], approverUserId: 'owner-1', approverTenantId: 'hq' }];
    let w = make({ open });
    expect(await w.ctl.revoke(w.req)).toEqual({ revoked: 1 });
    expect(w.audit.map((a) => `${a.tenantId}:${a.action}:${JSON.parse(a.details).approvalId}`).sort()).toEqual([
      `bench:${DRILL_APPROVAL_REVOKED_ACTION}:apr-1`,
      `customer:${DRILL_APPROVAL_REVOKED_ACTION}:apr-1`,
    ]);
    w = make();
    expect(await w.ctl.revoke(w.req)).toEqual({ revoked: 0 });
    expect(w.audit).toEqual([]);
  });

  it('status shows what is listed, what is eligible, and what is approved', async () => {
    const open = [{ v: 1 as const, approvalId: 'apr-1', runAtMs: NOW + MIN, expiresAtMs: NOW + MIN + DRILL_APPROVAL.WINDOW_MS, screenIds: [A, B], approverUserId: 'owner-1', approverTenantId: 'hq' }];
    const w = make({ open });
    const s = await w.ctl.status();
    expect(s.armed).toBe(true);
    expect(s.screens).toEqual([{ id: A, name: 'GUQ55', eligible: true }, { id: B, name: 'M43', eligible: true }, { id: C, name: 'Lobby', eligible: false }]);
    expect(s.approvals).toEqual([{ approvalId: 'apr-1', runAtMs: NOW + MIN, expiresAtMs: NOW + MIN + DRILL_APPROVAL.WINDOW_MS, screenCount: 2, state: 'waiting' }]);
  });
});
