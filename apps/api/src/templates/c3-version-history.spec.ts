import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TemplatesController } from './templates.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { BrandingScraperService } from '../branding/branding-scraper.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { RedisService } from '../realtime/redis.service';

// See c2-staleness-guard.spec.ts's header comment for why JwtAuthGuard's
// own constructor deps need providers here even though these tests call
// controller methods directly.

/**
 * C3 drift-catcher (Wave C — "Crush Canva" safety net, 2026-07-02).
 *
 * Pre-fix: Save (both the metadata PUT and the zones replace-all PUT)
 * kept ZERO history — "one bad Save is unrecoverable"
 * (06-CRUSH-CANVA-PLAN.md Wave C). This spec covers the fix:
 *   - every successful zones-save writes a compact snapshot
 *     (snapshotVersion, called from replaceZones)
 *   - only the newest 5 snapshots per template are kept
 *   - GET .../versions returns a LIGHT list (id/createdAt/byUser only
 *     — never the zones/meta payload) and is tenant-scoped
 *   - POST .../versions/:versionId/restore snapshots the CURRENT state
 *     FIRST (so a bad restore is itself one more Restore away from
 *     undone), then applies the old zones/meta, and audits the action
 */
describe('C3 — version history (snapshot-on-save, cap-at-5, restore-snapshots-first)', () => {
  let controller: TemplatesController;
  let prismaService: any;

  const req = { user: { id: 'u1', tenantId: 't1' } };

  function baseTemplate(overrides: Record<string, unknown> = {}) {
    return {
      id: 'tpl1',
      tenantId: 't1',
      isSystem: false,
      updatedAt: new Date('2026-07-02T12:00:00.000Z'),
      name: 'Lobby Board',
      description: 'd',
      screenWidth: 1920,
      screenHeight: 1080,
      bgColor: null,
      bgGradient: null,
      bgImage: null,
      isTouchEnabled: false,
      idleResetMs: 60000,
      zones: [],
      ...overrides,
    };
  }

  beforeEach(async () => {
    prismaService = {
      client: {
        template: {
          findFirst: jest.fn().mockResolvedValue(baseTemplate()),
          findUnique: jest.fn().mockResolvedValue(baseTemplate()),
          update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(baseTemplate({ ...data }))),
        },
        templateZone: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn().mockResolvedValue({}),
        },
        templateVersion: {
          create: jest.fn().mockResolvedValue({ id: 'ver-new' }),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        $transaction: jest.fn().mockImplementation((ops: any) => Promise.all(ops)),
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

    controller = module.get<TemplatesController>(TemplatesController);
  });

  describe('snapshot-on-save', () => {
    const zone = { name: 'Header', widgetType: 'CLOCK', x: 0, y: 0, width: 50, height: 20 };

    it('replaceZones writes exactly one version row per successful save', async () => {
      await controller.replaceZones(req, 'tpl1', { zones: [zone] } as any);
      expect(prismaService.client.templateVersion.create).toHaveBeenCalledTimes(1);
      const call = prismaService.client.templateVersion.create.mock.calls[0][0];
      expect(call.data.templateId).toBe('tpl1');
      expect(call.data.tenantId).toBe('t1');
      expect(call.data.byUserId).toBe('u1');
      // meta carries only the builder-editable scalar subset, not the
      // whole Template row.
      expect(call.data.meta).toMatchObject({ name: 'Lobby Board', screenWidth: 1920, screenHeight: 1080 });
    });

    it('a snapshot failure never fails the underlying save (best-effort, like audit())', async () => {
      prismaService.client.templateVersion.create.mockRejectedValueOnce(new Error('db hiccup'));
      const result = await controller.replaceZones(req, 'tpl1', { zones: [zone] } as any);
      expect(result).toBeTruthy(); // save still succeeded
    });

    it('cap-at-5: deletes rows beyond the 5 most recent for this template in the same operation', async () => {
      prismaService.client.templateVersion.findMany.mockResolvedValueOnce([
        { id: 'stale-1' },
        { id: 'stale-2' },
      ]);
      await controller.replaceZones(req, 'tpl1', { zones: [zone] } as any);
      expect(prismaService.client.templateVersion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { templateId: 'tpl1' }, orderBy: { createdAt: 'desc' }, skip: 5 }),
      );
      expect(prismaService.client.templateVersion.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['stale-1', 'stale-2'] } },
      });
    });

    it('no eviction call when there is nothing beyond the top 5', async () => {
      prismaService.client.templateVersion.findMany.mockResolvedValueOnce([]);
      await controller.replaceZones(req, 'tpl1', { zones: [zone] } as any);
      expect(prismaService.client.templateVersion.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('GET :id/versions — light list, tenant-scoped', () => {
    it('returns only id/createdAt/byUser — never zones/meta', async () => {
      prismaService.client.templateVersion.findMany.mockResolvedValueOnce([
        { id: 'v1', createdAt: new Date('2026-07-02T11:00:00Z'), byUser: { id: 'u1', email: 'a@b.com' } },
        { id: 'v2', createdAt: new Date('2026-07-02T10:00:00Z'), byUser: null },
      ]);
      const result = await controller.listVersions(req, 'tpl1');
      expect(result).toEqual([
        { id: 'v1', createdAt: new Date('2026-07-02T11:00:00Z'), byUser: { id: 'u1', email: 'a@b.com' } },
        { id: 'v2', createdAt: new Date('2026-07-02T10:00:00Z'), byUser: null },
      ]);
      // Verify the query itself never selects zones/meta.
      const query = prismaService.client.templateVersion.findMany.mock.calls[0][0];
      expect(query.select).not.toHaveProperty('zones');
      expect(query.select).not.toHaveProperty('meta');
      expect(query.take).toBe(5);
    });

    it('404s when the template does not belong to the caller tenant', async () => {
      prismaService.client.template.findFirst.mockResolvedValueOnce(null);
      await expect(controller.listVersions(req, 'not-mine')).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });
  });

  describe('POST :id/versions/:versionId/restore — snapshots current state FIRST, never destructive', () => {
    const oldZones = [{ name: 'Old', widgetType: 'TEXT', x: 0, y: 0, width: 10, height: 10, zIndex: 0, sortOrder: 0 }];
    const oldMeta = { name: 'Old Name', description: 'old', screenWidth: 1280, screenHeight: 720, bgColor: '#000', bgGradient: null, bgImage: null, isTouchEnabled: false, idleResetMs: 60000 };

    beforeEach(() => {
      prismaService.client.templateVersion.findFirst.mockResolvedValue({
        id: 'ver-old', templateId: 'tpl1', zones: oldZones, meta: oldMeta,
      });
    });

    it('snapshots the CURRENT (pre-restore) state before applying the old version', async () => {
      await controller.restoreVersion(req, 'tpl1', 'ver-old');
      // First call to templateVersion.create is the pre-restore safety
      // snapshot of whatever baseTemplate() (the CURRENT row) looked
      // like — its meta.name is 'Lobby Board', not the restored 'Old Name'.
      const firstSnapshotCall = prismaService.client.templateVersion.create.mock.calls[0][0];
      expect(firstSnapshotCall.data.meta.name).toBe('Lobby Board');
    });

    it('applies the target version zones/meta via the standard transaction path', async () => {
      await controller.restoreVersion(req, 'tpl1', 'ver-old');
      expect(prismaService.client.$transaction).toHaveBeenCalledTimes(1);
      const ops = prismaService.client.$transaction.mock.calls[0][0];
      expect(ops.length).toBeGreaterThanOrEqual(3); // update + deleteMany + N creates + findUnique
    });

    it('404s when the version does not belong to this template', async () => {
      prismaService.client.templateVersion.findFirst.mockResolvedValueOnce(null);
      await expect(controller.restoreVersion(req, 'tpl1', 'nope')).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });

    it('404s when the template does not belong to the caller tenant', async () => {
      prismaService.client.template.findFirst.mockResolvedValueOnce(null);
      await expect(controller.restoreVersion(req, 'not-mine', 'ver-old')).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });

    it('403s on a system template', async () => {
      prismaService.client.template.findFirst.mockResolvedValueOnce(baseTemplate({ isSystem: true }));
      await expect(controller.restoreVersion(req, 'tpl1', 'ver-old')).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });

    it('rejects a snapshot with out-of-bounds zones (same validation as a normal save)', async () => {
      prismaService.client.templateVersion.findFirst.mockResolvedValueOnce({
        id: 'ver-bad',
        templateId: 'tpl1',
        zones: [{ name: 'Bad', widgetType: 'TEXT', x: -5, y: 0, width: 10, height: 10 }],
        meta: oldMeta,
      });
      await expect(controller.restoreVersion(req, 'tpl1', 'ver-bad')).rejects.toBeInstanceOf(HttpException);
    });

    it('writes an audit row tagged via: version-restore with the restored version id', async () => {
      await controller.restoreVersion(req, 'tpl1', 'ver-old');
      expect(prismaService.client.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'TEMPLATE_UPDATED',
            details: expect.stringContaining('version-restore'),
          }),
        }),
      );
    });
  });
});
