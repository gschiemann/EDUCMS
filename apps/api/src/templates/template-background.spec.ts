import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { TemplatesController } from './templates.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { BrandingScraperService } from '../branding/branding-scraper.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { RedisService } from '../realtime/redis.service';
import { AppRole } from '@cms/database';

/**
 * A template states its own background, so the surfaces that draw it never
 * have to guess — the editor draws an unset one WHITE, the gallery card
 * matches it, and the player draws it BLACK, each correct for its own
 * surface. A row that answered none of them was a board that read correctly
 * while you built it and could go dark on the glass.
 *
 * The mechanism, measured on the real code before this was written: the
 * builder's metadata save sends `bgColor: meta.bgColor || null`, so a
 * template created with a brand surface and saved once by someone who never
 * opened the Background panel came back with a null background. 3 of 588
 * production templates were in that state (all operator-made test rows, no
 * text zones; 0 of the 459 system presets), which is why this is a
 * write-time rule rather than a migration.
 *
 * Every case here carries its control: a stated background — colour,
 * gradient or image — must come through untouched.
 */
describe('a template states its own background', () => {
  let controller: TemplatesController;
  let prisma: any;
  let brandSurface: string | null;

  const req = {
    user: { id: 'u1', tenantId: 't1', role: AppRole.SCHOOL_ADMIN },
  };
  const NOW = new Date('2026-09-15T12:00:00.000Z');

  const existing = (over: Record<string, unknown> = {}) => ({
    id: 'tpl1',
    tenantId: 't1',
    isSystem: false,
    updatedAt: NOW,
    name: 'Lobby Board',
    bgColor: null,
    bgImage: null,
    bgGradient: null,
    ...over,
  });

  beforeEach(async () => {
    brandSurface = null;
    prisma = {
      client: {
        template: {
          create: jest
            .fn()
            .mockImplementation(({ data }: any) =>
              Promise.resolve({ ...existing(), ...data, zones: [] }),
            ),
          findFirst: jest.fn().mockResolvedValue(existing()),
          findUnique: jest.fn().mockResolvedValue(existing({ zones: [] })),
          update: jest
            .fn()
            .mockImplementation(({ data }: any) =>
              Promise.resolve({ ...existing(), ...data, zones: [] }),
            ),
        },
        templateZone: { deleteMany: jest.fn(), create: jest.fn() },
        templateVersion: {
          create: jest.fn().mockResolvedValue({ id: 'v1' }),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        tenant: { findUnique: jest.fn().mockResolvedValue(null) },
        branding: { findUnique: jest.fn().mockResolvedValue(null) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        $transaction: jest
          .fn()
          .mockImplementation((x: any) =>
            typeof x === 'function' ? x(prisma.client) : Promise.all(x),
          ),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TemplatesController],
      providers: [
        { provide: PrismaService, useValue: prisma },
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
    // The brand lookup is private and hits several models; stub the one
    // thing these cases care about and leave the rest of it alone.
    jest
      .spyOn(controller as any, 'getBrandDefaults')
      .mockImplementation(async () => ({
        surface: brandSurface,
        brandKit: undefined,
      }));
  });

  const createdWith = () => prisma.client.template.create.mock.calls[0][0].data;
  const updatedWith = () => prisma.client.template.update.mock.calls[0][0].data;

  describe('POST /templates', () => {
    it('a blank template is created white, not background-less', async () => {
      await controller.create(req, { name: 'Blank' } as any);
      expect(createdWith().bgColor).toBe('#ffffff');
    });

    it('a tenant brand surface still wins over the default', async () => {
      brandSurface = '#0b2545';
      await controller.create(req, { name: 'Blank' } as any);
      expect(createdWith().bgColor).toBe('#0b2545');
    });

    it('CONTROL: an explicit colour is never overwritten', async () => {
      brandSurface = '#0b2545';
      await controller.create(req, { name: 'Dark', bgColor: '#111827' } as any);
      expect(createdWith().bgColor).toBe('#111827');
    });

    it('CONTROL: a photo board keeps its null bgColor', async () => {
      // Writing white under a full-bleed image would be harmless where the
      // image covers and wrong everywhere it does not.
      await controller.create(req, {
        name: 'Photo',
        bgImage: 'https://cdn.example/hero.jpg',
      } as any);
      expect(createdWith().bgColor).toBeNull();
      expect(createdWith().bgImage).toBe('https://cdn.example/hero.jpg');
    });

    it('CONTROL: a gradient board keeps its null bgColor', async () => {
      await controller.create(req, {
        name: 'Gradient',
        bgGradient: 'linear-gradient(#000,#fff)',
      } as any);
      expect(createdWith().bgColor).toBeNull();
    });
  });

  describe('PUT /templates/:id', () => {
    it('the builder save that used to clear the background now states one', async () => {
      // This is literally what BuilderShell sends: `bgColor: meta.bgColor || null`.
      await controller.update(req, 'tpl1', {
        name: 'Lobby Board',
        bgColor: null,
        bgImage: null,
        bgGradient: null,
      } as any);
      expect(updatedWith().bgColor).toBe('#ffffff');
    });

    it('a save that mentions no background at all leaves a stated one alone', async () => {
      prisma.client.template.findFirst.mockResolvedValue(
        existing({ bgColor: '#111827' }),
      );
      await controller.update(req, 'tpl1', { name: 'Renamed' } as any);
      expect(updatedWith().bgColor).toBeUndefined();
    });

    it('CONTROL: clearing the colour under an existing IMAGE does not repaint it', async () => {
      prisma.client.template.findFirst.mockResolvedValue(
        existing({ bgImage: 'https://cdn.example/hero.jpg' }),
      );
      await controller.update(req, 'tpl1', { bgColor: null } as any);
      expect(updatedWith().bgColor).toBeNull();
    });

    it('CONTROL: an explicit new colour is written verbatim', async () => {
      await controller.update(req, 'tpl1', { bgColor: '#0b2545' } as any);
      expect(updatedWith().bgColor).toBe('#0b2545');
    });

    it('removing the last background of any kind re-states one', async () => {
      // An operator deletes the background image and picks no colour: the
      // row would end up saying nothing, so it says white instead.
      prisma.client.template.findFirst.mockResolvedValue(
        existing({ bgImage: 'https://cdn.example/hero.jpg' }),
      );
      await controller.update(req, 'tpl1', { bgImage: null } as any);
      expect(updatedWith().bgColor).toBe('#ffffff');
    });
  });
});
