/**
 * INJ-003 — the live-bound content gate.
 *
 * THE BUG: `schedules.controller.create()` guarantees "CONTRIBUTOR (Editor)
 * schedules are ALWAYS staged as drafts — they cannot push content live
 * directly", but that only ever covered creating a NEW schedule. Editing
 * content a live schedule ALREADY points at was wide open:
 *   • PUT /templates/:id/zones  — CONTRIBUTOR-allowed, checked only
 *     {id, tenantId} + isSystem
 *   • PUT /templates/:id        — same (writes bgColor/bgImage/bgGradient,
 *     which render on the wall exactly like a zone)
 *   • POST /templates/:id/versions/:vid/restore — same delete-all-and-
 *     recreate, so leaving it open made the other two bypassable in one call
 *   • PUT /playlists/:id/items  — CONTRIBUTOR-allowed, checked only tenancy
 * so an Editor could rewrite a board that was already on a wall and it
 * shipped to every screen at the next manifest poll with zero review.
 *
 * THE FIX (submissions/live-content-gate.ts): a non-approver actor is
 * refused with 403 `REQUIRES_APPROVAL` when the target is bound to a
 * schedule that can still reach a screen. Admins — the approvers — are
 * untouched, and content that is NOT live-bound stays freely editable so
 * ordinary authoring is unaffected.
 *
 * These tests drive the REAL controller methods against a Prisma mock whose
 * `schedule.findFirst` re-implements Prisma's filter semantics over a small
 * in-memory table — so they assert the WHERE the controller actually builds,
 * not a hand-waved boolean.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppRole } from '@cms/database';
import { TemplatesController } from './templates.controller';
import { PlaylistsController } from '../playlists/playlists.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { BrandingScraperService } from '../branding/branding-scraper.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { RedisService } from '../realtime/redis.service';
import { ROLES_KEY } from '../auth/roles.decorator';

const NOW = new Date('2026-08-02T12:00:00.000Z');
const YESTERDAY = new Date('2026-08-01T12:00:00.000Z');
const TOMORROW = new Date('2026-08-03T12:00:00.000Z');

interface FakeSchedule {
  id: string;
  tenantId: string;
  playlistId: string;
  /** The template the row's playlist points at (the join the gate walks). */
  templateId: string | null;
  isActive: boolean;
  startTime: Date;
  endTime: Date | null;
  screenName?: string | null;
}

/**
 * Re-implements the subset of Prisma `findFirst` semantics the gate relies
 * on, so the assertions exercise the real WHERE clause.
 */
function scheduleFindFirst(rows: FakeSchedule[]) {
  return jest.fn(async ({ where }: any) => {
    const hit = rows.find((r) => {
      if (where.tenantId !== undefined && where.tenantId !== r.tenantId) return false;
      if (where.isActive !== undefined && where.isActive !== r.isActive) return false;
      if (where.playlistId !== undefined && where.playlistId !== r.playlistId) return false;
      const wantTemplate = where.playlist?.is?.templateId;
      if (wantTemplate !== undefined && wantTemplate !== r.templateId) return false;
      if (Array.isArray(where.OR)) {
        // OR: [{endTime: null}, {endTime: {gte: now}}]
        const gte = where.OR.map((o: any) => o?.endTime?.gte).find(Boolean);
        const openEnded = where.OR.some((o: any) => o?.endTime === null);
        const ok = (openEnded && r.endTime === null) || (gte && r.endTime !== null && r.endTime >= gte);
        if (!ok) return false;
      }
      return true;
    });
    if (!hit) return null;
    return {
      id: hit.id,
      screen: hit.screenName ? { name: hit.screenName } : null,
      screenGroup: null,
    };
  });
}

// ── Templates harness ────────────────────────────────────────────────
async function makeTemplatesController(rows: FakeSchedule[]) {
  const template = () => ({ id: 'tpl1', tenantId: 't1', isSystem: false, updatedAt: NOW, name: 'Lobby Board' });
  const scheduleFindFirstMock = scheduleFindFirst(rows);
  const prismaService: any = {
    client: {
      template: {
        findFirst: jest.fn().mockResolvedValue(template()),
        findUnique: jest.fn().mockResolvedValue({ ...template(), zones: [] }),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...template(), ...data, zones: [] })),
      },
      templateZone: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
      templateVersion: {
        create: jest.fn().mockResolvedValue({ id: 'ver-new' }),
        findFirst: jest.fn().mockResolvedValue({
          id: 'ver-old',
          templateId: 'tpl1',
          tenantId: 't1',
          zones: [{ name: 'Old', widgetType: 'TEXT', x: 0, y: 0, width: 10, height: 10 }],
          meta: {},
        }),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      schedule: { findFirst: scheduleFindFirstMock },
      // The emergency-binding lookup: "is any PROTECTED playlist in this
      // tenant rendering this template?" Default: no.
      playlist: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation((opsOrFn: any) =>
        typeof opsOrFn === 'function' ? opsOrFn(prismaService.client) : Promise.all(opsOrFn),
      ),
    },
  };

  const module: TestingModule = await Test.createTestingModule({
    controllers: [TemplatesController],
    providers: [
      { provide: PrismaService, useValue: prismaService },
      { provide: AiService, useValue: {} },
      { provide: BrandingScraperService, useValue: {} },
      { provide: SupabaseStorageService, useValue: {} },
      { provide: JwtService, useValue: { sign: jest.fn(), verifyAsync: jest.fn() } },
      { provide: RedisService, useValue: { sismember: jest.fn().mockResolvedValue(false) } },
    ],
  }).compile();

  return {
    controller: module.get<TemplatesController>(TemplatesController),
    prisma: prismaService,
    scheduleFindFirst: scheduleFindFirstMock,
  };
}

// ── Playlists harness ────────────────────────────────────────────────
function makePlaylistsController(rows: FakeSchedule[]) {
  const scheduleFindFirstMock = scheduleFindFirst(rows);
  const prismaService: any = {
    ensurePlaylistMetadataColumns: jest.fn().mockResolvedValue(undefined),
    client: {
      playlist: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pl1', tenantId: 't1', name: 'Lobby Loop' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'pl1', items: [] }),
        update: jest.fn().mockResolvedValue({}),
      },
      playlistItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
      asset: { count: jest.fn().mockResolvedValue(1) },
      schedule: { findFirst: scheduleFindFirstMock },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation((ops: any) => Promise.all(ops)),
    },
  };
  const controller = new PlaylistsController(
    prismaService,
    { publish: jest.fn().mockResolvedValue(undefined) } as any,
    { signMessage: jest.fn().mockReturnValue('signed') } as any,
    {} as any,
  );
  return { controller, prisma: prismaService, scheduleFindFirst: scheduleFindFirstMock };
}

const editor = { user: { id: 'c1', userId: 'c1', role: AppRole.CONTRIBUTOR, tenantId: 't1' } };
const admin = { user: { id: 'a1', userId: 'a1', role: AppRole.SCHOOL_ADMIN, tenantId: 't1' } };
const zone = { name: 'Header', widgetType: 'CLOCK', x: 0, y: 0, width: 50, height: 20 };

const liveRow: FakeSchedule = {
  id: 'sched-live', tenantId: 't1', playlistId: 'pl1', templateId: 'tpl1',
  isActive: true, startTime: YESTERDAY, endTime: null, screenName: 'Main Lobby',
};

describe('INJ-003 — CONTRIBUTOR editing a LIVE-BOUND template', () => {
  it('PUT /templates/:id/zones is refused with 403 REQUIRES_APPROVAL and never touches the zones', async () => {
    const { controller, prisma } = await makeTemplatesController([liveRow]);

    await expect(controller.replaceZones(editor, 'tpl1', { zones: [zone] } as any)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
      response: { code: 'REQUIRES_APPROVAL', kind: 'template', scheduleId: 'sched-live' },
    });

    // The destructive delete-all-and-recreate must never fire.
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
    expect(prisma.client.templateZone.deleteMany).not.toHaveBeenCalled();
  });

  it('names the blocking screen so the operator knows WHAT is blocking them', async () => {
    const { controller } = await makeTemplatesController([liveRow]);
    await expect(controller.replaceZones(editor, 'tpl1', { zones: [zone] } as any)).rejects.toMatchObject({
      response: { message: expect.stringContaining('Main Lobby'), target: 'Main Lobby' },
    });
  });

  it('PUT /templates/:id (metadata — bgColor/bgImage render on the wall too) is refused, no row written', async () => {
    const { controller, prisma } = await makeTemplatesController([liveRow]);
    await expect(controller.update(editor, 'tpl1', { bgImage: 'https://evil.example/x.png' } as any)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
      response: { code: 'REQUIRES_APPROVAL' },
    });
    expect(prisma.client.template.update).not.toHaveBeenCalled();
  });

  it('POST /templates/:id/versions/:vid/restore is refused too (else the other two gates are one call from bypassed)', async () => {
    const { controller, prisma } = await makeTemplatesController([liveRow]);
    await expect(controller.restoreVersion(editor, 'tpl1', 'ver-old')).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
      response: { code: 'REQUIRES_APPROVAL' },
    });
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
  });

  it('writes a forensic AuditLog row for the blocked attempt', async () => {
    const { controller, prisma } = await makeTemplatesController([liveRow]);
    await expect(controller.replaceZones(editor, 'tpl1', { zones: [zone] } as any)).rejects.toBeInstanceOf(HttpException);

    expect(prisma.client.auditLog.create).toHaveBeenCalledTimes(1);
    const row = prisma.client.auditLog.create.mock.calls[0][0].data;
    expect(row.action).toBe('CONTENT_EDIT_BLOCKED_REQUIRES_APPROVAL');
    expect(row.targetType).toBe('Template');
    expect(row.targetId).toBe('tpl1');
    expect(row.tenantId).toBe('t1');
    expect(row.userId).toBe('c1');
    expect(JSON.parse(row.details)).toMatchObject({ role: AppRole.CONTRIBUTOR, scheduleId: 'sched-live' });
  });

  it('an AuditLog failure still yields the clean 403 (never a 500)', async () => {
    const { controller, prisma } = await makeTemplatesController([liveRow]);
    prisma.client.auditLog.create.mockRejectedValueOnce(new Error('db down'));
    await expect(controller.replaceZones(editor, 'tpl1', { zones: [zone] } as any)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
      response: { code: 'REQUIRES_APPROVAL' },
    });
  });
});

describe('INJ-003 — the gate does NOT break normal authoring', () => {
  it('CONTRIBUTOR editing an UNBOUND template still saves', async () => {
    const { controller, prisma } = await makeTemplatesController([]); // no schedules at all
    const res = await controller.replaceZones(editor, 'tpl1', { zones: [zone] } as any);
    expect(res).toBeTruthy();
    const arrayCalls = prisma.client.$transaction.mock.calls.filter((c: any) => Array.isArray(c[0]));
    expect(arrayCalls).toHaveLength(1);
  });

  it('CONTRIBUTOR editing a template bound only to a DRAFT (isActive=false) schedule still saves', async () => {
    const { controller, prisma } = await makeTemplatesController([{ ...liveRow, isActive: false }]);
    await expect(controller.replaceZones(editor, 'tpl1', { zones: [zone] } as any)).resolves.toBeTruthy();
    expect(prisma.client.templateZone.deleteMany).toHaveBeenCalled();
  });

  it('CONTRIBUTOR editing a template whose only schedule window has ENDED still saves (no permanent freeze on last season boards)', async () => {
    const { controller } = await makeTemplatesController([{ ...liveRow, endTime: YESTERDAY }]);
    await expect(controller.replaceZones(editor, 'tpl1', { zones: [zone] } as any)).resolves.toBeTruthy();
  });

  it('but a schedule that has not STARTED yet still blocks — it will publish this content with no further review', async () => {
    const { controller } = await makeTemplatesController([
      { ...liveRow, startTime: TOMORROW, endTime: null },
    ]);
    await expect(controller.replaceZones(editor, 'tpl1', { zones: [zone] } as any)).rejects.toMatchObject({
      response: { code: 'REQUIRES_APPROVAL' },
    });
  });

  it('a live schedule in ANOTHER tenant never blocks (the gate is tenant-scoped)', async () => {
    const { controller } = await makeTemplatesController([{ ...liveRow, tenantId: 't2' }]);
    await expect(controller.replaceZones(editor, 'tpl1', { zones: [zone] } as any)).resolves.toBeTruthy();
  });

  it('a live schedule bound to a DIFFERENT template never blocks', async () => {
    const { controller } = await makeTemplatesController([{ ...liveRow, templateId: 'other-tpl' }]);
    await expect(controller.replaceZones(editor, 'tpl1', { zones: [zone] } as any)).resolves.toBeTruthy();
  });
});

describe('INJ-003 — approvers are unaffected', () => {
  it('SCHOOL_ADMIN editing a LIVE-BOUND template still saves, and never even runs the lookup', async () => {
    const { controller, prisma, scheduleFindFirst: lookup } = await makeTemplatesController([liveRow]);
    await expect(controller.replaceZones(admin, 'tpl1', { zones: [zone] } as any)).resolves.toBeTruthy();
    expect(lookup).not.toHaveBeenCalled();
    expect(prisma.client.templateZone.deleteMany).toHaveBeenCalled();
  });

  it('SCHOOL_ADMIN metadata + restore on a LIVE-BOUND template still work', async () => {
    const { controller } = await makeTemplatesController([liveRow]);
    await expect(controller.update(admin, 'tpl1', { name: 'Renamed' } as any)).resolves.toBeTruthy();
    await expect(controller.restoreVersion(admin, 'tpl1', 'ver-old')).resolves.toBeTruthy();
  });

  it.each([AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN])(
    '%s bypasses the gate',
    async (role) => {
      const { controller } = await makeTemplatesController([liveRow]);
      await expect(
        controller.replaceZones({ user: { id: 'x', role, tenantId: 't1' } }, 'tpl1', { zones: [zone] } as any),
      ).resolves.toBeTruthy();
    },
  );

  it('fails CLOSED for an actor with no/unknown role (a future non-admin role inherits the restriction, not the hole)', async () => {
    const { controller } = await makeTemplatesController([liveRow]);
    await expect(
      controller.replaceZones({ user: { id: 'x', role: 'SOME_FUTURE_ROLE', tenantId: 't1' } }, 'tpl1', { zones: [zone] } as any),
    ).rejects.toMatchObject({ response: { code: 'REQUIRES_APPROVAL' } });
  });
});

describe('INJ-003 — PUT /playlists/:id/items (the same hole, other model)', () => {
  const items = [{ assetId: 'a1', durationMs: 5000, sequenceOrder: 0 }];

  it('CONTRIBUTOR replacing the items of a LIVE playlist is refused, items untouched', async () => {
    const { controller, prisma } = makePlaylistsController([liveRow]);
    await expect(controller.reorderItems(editor, 'pl1', { items } as any)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
      response: { code: 'REQUIRES_APPROVAL', kind: 'playlist' },
    });
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
    expect(prisma.client.playlistItem.deleteMany).not.toHaveBeenCalled();
  });

  it('CONTRIBUTOR replacing the items of an UNSCHEDULED playlist still works', async () => {
    const { controller, prisma } = makePlaylistsController([]);
    await expect(controller.reorderItems(editor, 'pl1', { items } as any)).resolves.toBeTruthy();
    expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);
  });

  it('SCHOOL_ADMIN replacing the items of a LIVE playlist still works', async () => {
    const { controller, scheduleFindFirst: lookup } = makePlaylistsController([liveRow]);
    await expect(controller.reorderItems(admin, 'pl1', { items } as any)).resolves.toBeTruthy();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('audits the blocked playlist attempt', async () => {
    const { controller, prisma } = makePlaylistsController([liveRow]);
    await expect(controller.reorderItems(editor, 'pl1', { items } as any)).rejects.toBeInstanceOf(HttpException);
    const row = prisma.client.auditLog.create.mock.calls[0][0].data;
    expect(row.action).toBe('CONTENT_EDIT_BLOCKED_REQUIRES_APPROVAL');
    expect(row.targetType).toBe('Playlist');
  });
});

/**
 * The second binding class, and the one a schedule-only gate can never see.
 *
 * Panic content is bound BY ID on the tenant row
 * (`Tenant.panicLockdownPlaylistId` & friends) — no Schedule row is ever
 * created for it. `PUT /playlists/:id/items` is CONTRIBUTOR-reachable and,
 * unlike `update` / `setActive` / `remove`, carried NO `isProtected` check —
 * so an Editor could rewrite what every screen displays during a real
 * lockdown. That is a subverted emergency alert, the highest-severity
 * outcome in this product.
 */
describe('INJ-003 — emergency (protected) content is live even with no schedule', () => {
  const items = [{ assetId: 'a1', durationMs: 5000, sequenceOrder: 0 }];

  it('CONTRIBUTOR cannot rewrite the items of a PROTECTED (lockdown) playlist, even with zero schedules', async () => {
    const { controller, prisma } = makePlaylistsController([]); // no schedule rows at all
    prisma.client.playlist.findFirst.mockResolvedValue({
      id: 'pl-lockdown', tenantId: 't1', name: 'Lockdown', isProtected: true, protectedKind: 'lockdown',
    });

    await expect(controller.reorderItems(editor, 'pl-lockdown', { items } as any)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
      response: { code: 'REQUIRES_APPROVAL', reason: 'emergency' },
    });
    expect(prisma.client.playlistItem.deleteMany).not.toHaveBeenCalled();
    // Points the operator at the surface that DOES own this content.
    const res: any = await controller.reorderItems(editor, 'pl-lockdown', { items } as any).catch((e) => e.getResponse());
    expect(res.message).toMatch(/Panic Button Integrations/);
  });

  it('an admin can still manage protected content (this adds NO admin-facing restriction)', async () => {
    const { controller, prisma } = makePlaylistsController([]);
    prisma.client.playlist.findFirst.mockResolvedValue({ id: 'pl-lockdown', tenantId: 't1', isProtected: true });
    await expect(controller.reorderItems(admin, 'pl-lockdown', { items } as any)).resolves.toBeTruthy();
  });

  it('CONTRIBUTOR cannot edit a TEMPLATE that renders emergency content, schedule or no schedule', async () => {
    const { controller, prisma } = await makeTemplatesController([]); // no schedules
    prisma.client.playlist = { findFirst: jest.fn().mockResolvedValue({ id: 'pl-lockdown' }) };

    await expect(controller.replaceZones(editor, 'tpl1', { zones: [zone] } as any)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
      response: { code: 'REQUIRES_APPROVAL', reason: 'emergency' },
    });
    // …and it looked for exactly the protected-playlist binding.
    expect(prisma.client.playlist.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 't1', templateId: 'tpl1', isProtected: true }) }),
    );
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
  });

  it('a template with NO protected playlist and no live schedule is still freely editable', async () => {
    const { controller, prisma } = await makeTemplatesController([]);
    prisma.client.playlist = { findFirst: jest.fn().mockResolvedValue(null) };
    await expect(controller.replaceZones(editor, 'tpl1', { zones: [zone] } as any)).resolves.toBeTruthy();
  });
});

describe('INJ-003 — the routes really are CONTRIBUTOR-reachable (so the gate is load-bearing, not theatre)', () => {
  it('PUT /templates/:id/zones and PUT /playlists/:id/items both grant CONTRIBUTOR', () => {
    const zoneRoles = Reflect.getMetadata(ROLES_KEY, TemplatesController.prototype.replaceZones) as AppRole[];
    const itemRoles = Reflect.getMetadata(ROLES_KEY, PlaylistsController.prototype.reorderItems) as AppRole[];
    expect(zoneRoles).toContain(AppRole.CONTRIBUTOR);
    expect(itemRoles).toContain(AppRole.CONTRIBUTOR);
  });
});
