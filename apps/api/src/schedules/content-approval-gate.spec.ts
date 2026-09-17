/**
 * Org-wide "Require approval before any content goes live" gate
 * (Appspace-parity enterprise control, 2026-06-26).
 *
 * Proves the three behaviors the feature promises:
 *
 *   (a) The toggle endpoint requires an admin role — only DISTRICT_ADMIN /
 *       SUPER_ADMIN may flip it (SCHOOL_ADMIN may read but not set;
 *       CONTRIBUTOR / VIEWER are excluded). Verified via the @RequireRoles
 *       metadata that RbacGuard actually reads at request time.
 *
 *   (b) When the tenant flag is ON, a CONTRIBUTOR publish is routed through
 *       the existing submit-for-review module: the schedule is staged as a
 *       DRAFT (isActive=false) AND a Submission review record is created —
 *       NOT an active schedule.
 *
 *   (c) When the flag is OFF, publishing is unchanged from today: an admin
 *       goes live directly (isActive=true) and NO submission is created;
 *       a contributor still stages a draft but is NOT force-submitted.
 *
 * Unit-level: controllers are constructed directly with mocked Prisma +
 * collaborators (no Nest DI / guards), mirroring tenants.controller.spec.ts.
 */

import 'reflect-metadata';
import { AppRole } from '@cms/database';
import { ROLES_KEY } from '../auth/roles.decorator';
import { SchedulesController } from './schedules.controller';
import { TenantsController } from '../tenants/tenants.controller';

// ── Schedules controller harness ──────────────────────────────────────
function makeScheduleController(opts: { requireContentApproval: boolean }) {
  const schedule = {
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    create: jest.fn().mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'sched1', ...data }),
    ),
  };
  const playlist = { findFirst: jest.fn().mockResolvedValue({ id: 'pl1' }) };
  const screen = { findFirst: jest.fn().mockResolvedValue({ id: 'scr1' }), findMany: jest.fn().mockResolvedValue([]) };
  const screenGroup = { findFirst: jest.fn().mockResolvedValue({ id: 'grp1' }) };
  const tenant = {
    findUnique: jest.fn().mockResolvedValue({ requireContentApproval: opts.requireContentApproval }),
  };
  const user = { findMany: jest.fn().mockResolvedValue([{ id: 'admin1' }, { id: 'admin2' }]) };
  const submission = { create: jest.fn().mockResolvedValue({ id: 'sub1' }) };
  const auditLog = { create: jest.fn().mockResolvedValue({}) };

  const prisma: any = {
    client: { schedule, playlist, screen, screenGroup, tenant, user, submission, auditLog },
  };
  const redis: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const signer: any = { signMessage: jest.fn().mockReturnValue('signed') };
  const notify: any = { notify: jest.fn().mockResolvedValue({}) };

  const controller = new SchedulesController(prisma, redis, signer, notify);
  return { controller, schedule, tenant, submission, auditLog, notify };
}

const baseBody = {
  playlistId: 'pl1',
  screenId: 'scr1',
  startTime: '2026-06-26T12:00:00.000Z',
};

describe('Content-approval gate — (b) flag ON routes a CONTRIBUTOR publish to review', () => {
  it('stages the schedule as a DRAFT and creates a Submission (not an active schedule)', async () => {
    const { controller, schedule, submission, notify } = makeScheduleController({ requireContentApproval: true });
    const req = { user: { id: 'c1', userId: 'c1', role: AppRole.CONTRIBUTOR, tenantId: 't1' } };

    const res: any = await controller.create(req as any, { ...baseBody } as any);

    // Schedule was created INACTIVE (draft) — it must not go live.
    expect(schedule.create).toHaveBeenCalledTimes(1);
    expect(schedule.create.mock.calls[0][0].data.isActive).toBe(false);

    // A review record was created bundling this schedule.
    expect(submission.create).toHaveBeenCalledTimes(1);
    const subData = submission.create.mock.calls[0][0].data;
    expect(subData.status).toBe('PENDING');
    expect(subData.scheduleIds).toBe('sched1');
    expect(subData.playlistIds).toBe('pl1');
    expect(subData.submittedById).toBe('c1');

    // Reviewers were notified.
    expect(notify.notify).toHaveBeenCalled();

    // The response signals the UI to say "sent for review."
    expect(res.pendingReview).toBe(true);
    expect(res.isActive).toBe(false);
  });
});

describe('Content-approval gate — (c) flag OFF leaves publishing unchanged', () => {
  it('an ADMIN publish goes live directly and creates NO submission', async () => {
    const { controller, schedule, submission, tenant } = makeScheduleController({ requireContentApproval: false });
    const req = { user: { id: 'a1', userId: 'a1', role: AppRole.SCHOOL_ADMIN, tenantId: 't1' } };

    const res: any = await controller.create(req as any, { ...baseBody } as any);

    // Admin schedule goes live.
    expect(schedule.create).toHaveBeenCalledTimes(1);
    expect(schedule.create.mock.calls[0][0].data.isActive).toBe(true);

    // No review queue involved at all.
    expect(submission.create).not.toHaveBeenCalled();
    expect(res.pendingReview).toBeUndefined();
    // Admins never even look up the flag (they bypass).
    expect(tenant.findUnique).not.toHaveBeenCalled();
  });

  it('a CONTRIBUTOR still stages a draft but is NOT force-submitted when the flag is OFF', async () => {
    const { controller, schedule, submission } = makeScheduleController({ requireContentApproval: false });
    const req = { user: { id: 'c1', userId: 'c1', role: AppRole.CONTRIBUTOR, tenantId: 't1' } };

    const res: any = await controller.create(req as any, { ...baseBody } as any);

    // Contributor schedule is still staged inactive (existing behavior)...
    expect(schedule.create.mock.calls[0][0].data.isActive).toBe(false);
    // ...but NOT auto-routed to the review queue (single-operator simplicity).
    expect(submission.create).not.toHaveBeenCalled();
    expect(res.pendingReview).toBeUndefined();
  });
});

// ── Content-integrity: a draft must never delete an admin's LIVE schedule ──
//
// 2026-06-26 P1 data-loss fix. The "collapse prior (playlist, target) rows to
// one" upsert step used to delete EVERY matching row regardless of isActive or
// who owned it. A CONTRIBUTOR drafting a competing schedule for the same
// (playlistId, screenId) therefore silently HARD-DELETED an admin's published
// (isActive=true) schedule. The guard: when the new row is staged as a draft
// (willBeActive=false), the cleanup is scoped to isActive:false — the live row
// survives. When an admin publishes live, the cleanup stays unrestricted.
describe('Content-integrity — a DRAFT never hard-deletes a different actor LIVE schedule', () => {
  it('a CONTRIBUTOR draft for (P,S) scopes the upsert-cleanup to isActive:false (admin LIVE row survives)', async () => {
    const { controller, schedule } = makeScheduleController({ requireContentApproval: false });

    // Simulate the DB holding an admin's LIVE schedule for the same
    // (playlist, screen). deleteMany only removes rows that match its WHERE —
    // so we assert the WHERE the controller builds can NEVER match a live row.
    const adminLive = {
      id: 'admin-live',
      tenantId: 't1',
      playlistId: 'pl1',
      screenId: 'scr1',
      screenGroupId: null,
      isActive: true,
    };
    // 2026-09-16 — the upsert-cleanup became WINDOW-AWARE, so it now READS the
    // candidate rows and then deletes by id. The draft-only scoping did not
    // change; it moved from the deleteMany's WHERE onto the findMany's, which
    // is where this guard is asserted below. Reproducing Prisma's filter
    // semantics on the READ is what makes the guard falsifiable: drop the
    // `isActive:false` scoping and this fake hands back the admin's live row,
    // which the assertions below then catch.
    schedule.findMany.mockImplementation(async ({ where }: any) => {
      const matches =
        where.tenantId === adminLive.tenantId &&
        where.playlistId === adminLive.playlistId &&
        (where.screenId === undefined || where.screenId === adminLive.screenId) &&
        (where.screenGroupId === undefined || where.screenGroupId === adminLive.screenGroupId) &&
        (where.isActive === undefined || where.isActive === adminLive.isActive);
      return matches ? [{ ...adminLive, daysOfWeek: null, timeStart: null, timeEnd: null, priority: 0 }] : [];
    });

    const req = { user: { id: 'c1', userId: 'c1', role: AppRole.CONTRIBUTOR, tenantId: 't1' } };
    await controller.create(req as any, { ...baseBody } as any);

    // The cleanup READ ran, and its WHERE was scoped to drafts only.
    expect(schedule.findMany).toHaveBeenCalled();
    const where = cleanupRead(schedule);
    expect(where.isActive).toBe(false); // <-- the guard

    // The admin's LIVE row was therefore never even a candidate, so nothing
    // was deleted. This is the same guarantee as before, one step earlier.
    const ids = schedule.deleteMany.mock.calls.flatMap(
      (c: any) => c?.[0]?.where?.id?.in ?? [],
    );
    expect(ids).not.toContain(adminLive.id);
  });

  it('an ADMIN live publish for (P,S) leaves the cleanup UNRESTRICTED (no isActive filter — true upsert)', async () => {
    const { controller, schedule } = makeScheduleController({ requireContentApproval: false });
    const req = { user: { id: 'a1', userId: 'a1', role: AppRole.SCHOOL_ADMIN, tenantId: 't1' } };

    await controller.create(req as any, { ...baseBody } as any);

    // 2026-09-16 — assert on the cleanup READ, which is where the (playlist,
    // target) scoping now lives; the delete that follows is by id.
    expect(schedule.findMany).toHaveBeenCalled();
    const where = cleanupRead(schedule);
    // Admin publish collapses every prior (playlist, target) row — the
    // legitimate publish-replace path is intentionally NOT scoped by isActive.
    expect(where.isActive).toBeUndefined();
    expect(where.playlistId).toBe(baseBody.playlistId);
  });
});


/**
 * The cleanup READ, selected by SHAPE not position (2026-09-16).
 *
 * `create()` now issues TWO schedule.findMany calls on an admin publish: the
 * window-aware displacement read (where carries `isActive: true` and a target
 * OR-set, never a playlistId) and the (playlist, target) upsert-cleanup read.
 * Indexing by [0] silently picks whichever ran first, which differs by actor —
 * a CONTRIBUTOR skips displacement entirely. Pick by the field only the
 * cleanup has.
 */
function cleanupRead(scheduleMock: any): any {
  const call = scheduleMock.findMany.mock.calls.find(
    (c: any) => c?.[0]?.where?.playlistId !== undefined,
  );
  if (!call) throw new Error('no (playlist, target) cleanup read was issued');
  return call[0].where;
}

// ── Tenants controller harness — toggle endpoint ─────────────────────
function makeTenantController() {
  const tenant = { findUnique: jest.fn(), update: jest.fn() };
  const user = { findUnique: jest.fn() };
  const auditLog = { create: jest.fn().mockResolvedValue({}) };
  const prisma: any = {
    client: {
      tenant, user, auditLog,
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb({ tenant, auditLog })),
    },
  };
  const jwt: any = { sign: jest.fn() };
  const controller = new TenantsController(prisma, jwt);
  return { controller, tenant, auditLog };
}

describe('Content-approval gate — (a) toggle requires an admin role', () => {
  it('PUT /tenants/me/content-approval is restricted to DISTRICT_ADMIN + SUPER_ADMIN only', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      TenantsController.prototype.setContentApprovalEnabled,
    ) as AppRole[];

    expect(roles).toEqual(
      expect.arrayContaining([AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN]),
    );
    // The gate is org-wide policy — a SCHOOL_ADMIN / CONTRIBUTOR / VIEWER
    // must NOT be able to flip it.
    expect(roles).not.toContain(AppRole.SCHOOL_ADMIN);
    expect(roles).not.toContain(AppRole.CONTRIBUTOR);
    expect(roles).not.toContain(AppRole.RESTRICTED_VIEWER);
  });

  it('flipping the flag writes the tenant row + an immutable AuditLog entry', async () => {
    const { controller, tenant, auditLog } = makeTenantController();
    tenant.update.mockResolvedValue({ requireContentApproval: true });

    const req = { user: { userId: 'a1', role: AppRole.DISTRICT_ADMIN, tenantId: 't1' } };
    const res: any = await controller.setContentApprovalEnabled(req as any, { enabled: true });

    expect(res).toEqual({ ok: true, enabled: true });
    expect(tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { requireContentApproval: true } }),
    );
    const audit = auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe('tenant.content_approval.toggled');
    expect(JSON.parse(audit.details)).toEqual({ enabled: true });
  });
});
