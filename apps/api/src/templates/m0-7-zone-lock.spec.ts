import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { TemplatesController, mapTemplate } from './templates.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { BrandingScraperService } from '../branding/branding-scraper.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { RedisService } from '../realtime/redis.service';
import { AppRole } from '@cms/database';
import { TemplateReplaceZonesSchema } from '@cms/api-types';

/**
 * M0-7 (2026-09-12) — TemplateZone.locked round-trip.
 *
 * The builder has had a Lock control on every zone for months, but there was
 * no `locked` column and PUT /templates/:id/zones never wrote one. That
 * endpoint is a DELETE-ALL-AND-RECREATE, so a field it does not write is a
 * field it destroys on every Save — which is why the operator's lock never
 * survived a reload, and why marquee-select-all + Delete still ate the zone.
 *
 * These tests pin the server half: the zod boundary accepts the flag, the
 * replace-all persists it, an older client that omits it writes an explicitly
 * UNLOCKED zone (never a Prisma type error, never `undefined`), and the read
 * path hands the column back so the builder can adopt it on load.
 */
describe('M0-7 — TemplateZone.locked persists through the zones replace-all', () => {
  let controller: TemplatesController;
  let prismaService: any;

  const req = { user: { id: 'u1', tenantId: 't1', role: AppRole.SCHOOL_ADMIN } };
  const NOW = new Date('2026-09-12T12:00:00.000Z');

  function baseTemplate(overrides: Record<string, unknown> = {}) {
    return { id: 'tpl1', tenantId: 't1', isSystem: false, updatedAt: NOW, name: 'Lobby Board', ...overrides };
  }

  /** Every `templateZone.create({data})` call the controller made. */
  function createdZones() {
    return prismaService.client.templateZone.create.mock.calls.map((c: any) => c[0].data);
  }

  beforeEach(async () => {
    prismaService = {
      client: {
        template: {
          findFirst: jest.fn().mockResolvedValue(baseTemplate()),
          findUnique: jest.fn().mockResolvedValue(baseTemplate({ zones: [] })),
          update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(baseTemplate({ ...data, zones: [] }))),
        },
        templateZone: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn().mockResolvedValue({}),
          findMany: jest.fn().mockResolvedValue([]),
        },
        templateScene: { findMany: jest.fn().mockResolvedValue([]) },
        templateVersion: {
          create: jest.fn().mockResolvedValue({ id: 'ver-new' }),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
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

    controller = module.get<TemplatesController>(TemplatesController);
  });

  const zone = (over: Record<string, unknown> = {}) => ({
    name: 'Sponsor strip', widgetType: 'IMAGE', x: 0, y: 80, width: 100, height: 20, ...over,
  });

  describe('write path — PUT /templates/:id/zones', () => {
    it('persists locked:true — the field the save used to drop entirely', async () => {
      await controller.replaceZones(req, 'tpl1', { zones: [zone({ locked: true })] } as any);

      expect(createdZones()).toHaveLength(1);
      expect(createdZones()[0].locked).toBe(true);
    });

    it('persists locked:false when the client says so', async () => {
      await controller.replaceZones(req, 'tpl1', { zones: [zone({ locked: false })] } as any);

      expect(createdZones()[0].locked).toBe(false);
    });

    it('backward compat: a client that omits the field writes an explicit false, never undefined', async () => {
      await controller.replaceZones(req, 'tpl1', { zones: [zone()] } as any);

      const data = createdZones()[0];
      expect(data.locked).toBe(false);
      expect(data.locked).not.toBeUndefined();
    });

    it('a non-boolean that slipped past the schema (passthrough body) coerces to false, not a truthy string', async () => {
      await controller.replaceZones(req, 'tpl1', { zones: [zone({ locked: 'yes' })] } as any);

      expect(createdZones()[0].locked).toBe(false);
    });

    it('carries the flag per zone across a mixed set, in order', async () => {
      await controller.replaceZones(req, 'tpl1', {
        zones: [
          zone({ name: 'A', locked: true }),
          zone({ name: 'B', y: 0, height: 20 }),
          zone({ name: 'C', y: 40, height: 20, locked: true }),
        ],
      } as any);

      expect(createdZones().map((d: any) => [d.name, d.locked])).toEqual([
        ['A', true], ['B', false], ['C', true],
      ]);
    });
  });

  describe('read path', () => {
    it('mapTemplate hands `locked` back untouched, so the builder can adopt it on load', () => {
      const mapped = mapTemplate({
        id: 'tpl1',
        zones: [
          { id: 'z1', name: 'A', locked: true, defaultConfig: '{"content":"hi"}' },
          { id: 'z2', name: 'B', locked: false, defaultConfig: null },
        ],
      });

      expect(mapped.zones.map((z: any) => z.locked)).toEqual([true, false]);
      // and the defaultConfig parse it already did is untouched by this change
      expect(mapped.zones[0].defaultConfig).toEqual({ content: 'hi' });
    });
  });

  describe('zod boundary — TemplateZoneBodySchema', () => {
    const good = { name: 'A', widgetType: 'CLOCK', x: 0, y: 0, width: 50, height: 20 };

    it('accepts locked:true / locked:false / omitted', () => {
      expect(TemplateReplaceZonesSchema.safeParse({ zones: [{ ...good, locked: true }] }).success).toBe(true);
      expect(TemplateReplaceZonesSchema.safeParse({ zones: [{ ...good, locked: false }] }).success).toBe(true);
      expect(TemplateReplaceZonesSchema.safeParse({ zones: [good] }).success).toBe(true);
    });

    it('rejects a non-boolean locked rather than letting a string reach the column', () => {
      expect(TemplateReplaceZonesSchema.safeParse({ zones: [{ ...good, locked: 'yes' }] }).success).toBe(false);
      expect(TemplateReplaceZonesSchema.safeParse({ zones: [{ ...good, locked: 1 }] }).success).toBe(false);
    });
  });
});
