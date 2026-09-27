import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { HttpException } from '@nestjs/common';
import { TemplatesController } from './templates.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { BrandingScraperService } from '../branding/branding-scraper.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { RedisService } from '../realtime/redis.service';
import { AppRole } from '@cms/database';
import { FAN_CAM_TITLE_NOT_SCHOOL_SAFE } from '@cms/api-types';

/**
 * K-12 sports launch, lane B3, leftover (b) — the three writers of template
 * zone rows (create — which import reuses —, replace zones, restore a
 * version) refuse a Fan Cam that asks for a kiss at a school BEFORE anything
 * is written, and leave a pro venue's Kiss Cam alone. The rule and its
 * audience are unit-tested in fan-cam-guard.spec.ts; this pins the wiring.
 */
describe('Fan Cam words — every template zone writer', () => {
  let controller: TemplatesController;
  let prismaService: any;
  let vertical: string;

  const req = {
    user: { id: 'u1', tenantId: 't1', role: AppRole.SCHOOL_ADMIN },
  };
  const NOW = new Date('2026-09-27T12:00:00.000Z');
  const template = (over: Record<string, unknown> = {}) => ({
    id: 'tpl1',
    tenantId: 't1',
    isSystem: false,
    updatedAt: NOW,
    name: 'Gym Board',
    ...over,
  });
  const fanCam = (kind: string) => ({
    name: 'Fan Cam',
    widgetType: 'SCOREBOARD',
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    defaultConfig: { variant: 'kiss-cam', kind, shape: 'frame' },
  });

  beforeEach(async () => {
    vertical = 'K12';
    prismaService = {
      client: {
        tenant: {
          findUnique: jest
            .fn()
            .mockImplementation(() =>
              Promise.resolve({
                id: 't1',
                name: 'Eastview High',
                vertical,
                parentId: null,
              }),
            ),
        },
        studentPrivacyPolicy: { findMany: jest.fn().mockResolvedValue([]) },
        template: {
          findFirst: jest.fn().mockResolvedValue(template()),
          findUnique: jest.fn().mockResolvedValue(template({ zones: [] })),
          create: jest
            .fn()
            .mockImplementation(({ data }: any) =>
              Promise.resolve(template({ ...data, zones: [] })),
            ),
          update: jest
            .fn()
            .mockImplementation(({ data }: any) =>
              Promise.resolve(template({ ...data, zones: [] })),
            ),
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
          findFirst: jest.fn().mockResolvedValue({
            id: 'ver-old',
            templateId: 'tpl1',
            // A snapshot stores each zone's config as JSON text.
            zones: [
              {
                ...fanCam('KISS CAM'),
                defaultConfig: JSON.stringify(fanCam('KISS CAM').defaultConfig),
              },
            ],
            meta: { name: 'Gym Board' },
          }),
        },
        tenantBranding: { findUnique: jest.fn().mockResolvedValue(null) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        $transaction: jest
          .fn()
          .mockImplementation((opsOrFn: any) =>
            typeof opsOrFn === 'function'
              ? opsOrFn(prismaService.client)
              : Promise.all(opsOrFn),
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
        {
          provide: JwtService,
          useValue: { sign: jest.fn(), verifyAsync: jest.fn() },
        },
        {
          provide: RedisService,
          useValue: { sismember: jest.fn().mockResolvedValue(false) },
        },
      ],
    }).compile();
    controller = module.get<TemplatesController>(TemplatesController);
  });

  async function codeOf(p: Promise<unknown>): Promise<string | null> {
    try {
      await p;
      return null;
    } catch (e) {
      if (!(e instanceof HttpException)) throw e;
      return String((e.getResponse() as { code?: string }).code);
    }
  }

  it('replace zones: a school is refused before any zone is deleted', async () => {
    expect(
      await codeOf(
        controller.replaceZones(req, 'tpl1', {
          zones: [fanCam('Kiss Cam')],
        } as any),
      ),
    ).toBe(FAN_CAM_TITLE_NOT_SCHOOL_SAFE);
    expect(prismaService.client.templateZone.deleteMany).not.toHaveBeenCalled();
    expect(prismaService.client.templateZone.create).not.toHaveBeenCalled();
  });

  it('replace zones: a school-safe title saves', async () => {
    await controller.replaceZones(req, 'tpl1', {
      zones: [fanCam('SPIRIT CAM')],
    } as any);
    expect(prismaService.client.templateZone.create).toHaveBeenCalledTimes(1);
  });

  it('replace zones: a pro venue keeps its Kiss Cam', async () => {
    vertical = 'SPORTS';
    await controller.replaceZones(req, 'tpl1', {
      zones: [fanCam('KISS CAM')],
    } as any);
    expect(prismaService.client.templateZone.create).toHaveBeenCalledTimes(1);
  });

  it('create (and import, which reuses it): a school is refused before the template exists', async () => {
    const body = {
      name: 'Gym Board',
      screenWidth: 1920,
      screenHeight: 1080,
      zones: [fanCam('KISS CAM')],
    };
    expect(await codeOf(controller.create(req, body as any))).toBe(
      FAN_CAM_TITLE_NOT_SCHOOL_SAFE,
    );
    expect(prismaService.client.template.create).not.toHaveBeenCalled();
  });

  it('restore a version: an old snapshot cannot bring a Kiss Cam back at a school', async () => {
    expect(
      await codeOf(controller.restoreVersion(req, 'tpl1', 'ver-old')),
    ).toBe(FAN_CAM_TITLE_NOT_SCHOOL_SAFE);
    expect(prismaService.client.templateZone.deleteMany).not.toHaveBeenCalled();
  });
});
