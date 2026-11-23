/**
 * A new template from a preset carries the tenant's identity, not just its colours.
 *
 * Owner, before a demo: "make sure that when I rebrand something everything
 * gets updated that's available". A clone now fills the organisation name,
 * tagline, initials and logo (blanks, and a widget's own sample text nobody
 * typed — a preset's or a duplicated template's other text wins), and
 * its Template.brandKit snapshot carries the tagline, so a later rebrand
 * (POST /branding/apply-to-templates) can recognise what this clone stamped.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { TemplatesController } from './templates.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { BrandingScraperService } from '../branding/branding-scraper.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { RedisService } from '../realtime/redis.service';

const BRANDING = {
  palette: {
    primary: '#aa0000',
    accent: '#00aa00',
    ink: '#222222',
    surface: '#ffffee',
  },
  fontHeading: 'Montserrat',
  fontBody: 'Lato',
  logoUrl: 'https://cdn.example/new-logo.png',
  logoSvgInline: null,
  faviconUrl: null,
  displayName: 'Buena Park Academy',
  tagline: 'Learning without limits',
  sourceUrl: null,
  scrapedAt: null,
  fontHeadingUrl: null,
  fontBodyUrl: null,
};

const SOURCE = {
  id: 'sys-board',
  name: 'Welcome Board',
  description: null,
  category: 'WELCOME',
  orientation: 'LANDSCAPE',
  screenWidth: 3840,
  screenHeight: 2160,
  bgColor: null,
  bgImage: null,
  bgGradient: null,
  isSystem: true,
  tenantId: null,
  zones: [
    {
      name: 'Board',
      widgetType: 'EXTERNAL_HTML',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      zIndex: 0,
      sortOrder: 0,
      defaultConfig: JSON.stringify({
        url: '/templates/x.html',
        textOverrides: { 'brand.tagline': 'A preset line' },
      }),
    },
    {
      name: 'Varsity',
      widgetType: 'HS_VARSITY',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      zIndex: 1,
      sortOrder: 1,
      defaultConfig: null,
    },
    {
      name: 'Logo',
      widgetType: 'LOGO',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      zIndex: 2,
      sortOrder: 2,
      defaultConfig: null,
    },
    {
      name: 'Arcade',
      widgetType: 'MS_ARCADE',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      zIndex: 3,
      sortOrder: 3,
      defaultConfig: null,
    },
  ],
};

describe('clone from a preset — identity + snapshot', () => {
  let controller: TemplatesController;
  let prisma: any;
  const req = { user: { id: 'u1', tenantId: 'ten1' } };

  beforeEach(async () => {
    prisma = {
      client: {
        template: {
          findFirst: jest.fn().mockResolvedValue(SOURCE),
          create: jest.fn().mockImplementation(async ({ data }: any) => ({
            id: 'new',
            ...data,
            zones: data.zones.create,
          })),
        },
        tenantBranding: { findUnique: jest.fn().mockResolvedValue(BRANDING) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
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
  });

  it("fills the name, tagline, initials and logo on blanks; a preset's own text that is not a registered placeholder wins", async () => {
    await controller.createFromPreset(req, 'sys-board', {
      name: 'Mine',
    } as any);
    const data = prisma.client.template.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe('ten1');
    const [board, varsity, logo, arcade] = data.zones.create.map((z: any) =>
      JSON.parse(z.defaultConfig),
    );

    expect(board.textOverrides).toMatchObject({
      'brand.name': 'Buena Park Academy',
      'school.name': 'Buena Park Academy',
      'brand.tagline': 'A preset line',
      'school.motto': 'Learning without limits',
      'school.initials': 'BPA',
      'brand.monogram': 'B',
    });
    expect(board.imageOverrides).toEqual({
      'brand.logo': 'https://cdn.example/new-logo.png',
      'school.logo': 'https://cdn.example/new-logo.png',
    });
    expect(board.url).toBe('/templates/x.html');

    expect(varsity).toMatchObject({
      schoolName: 'BUENA PARK ACADEMY',
      schoolInitials: 'BPA',
      brandPrimary: '#aa0000',
    });
    expect(logo).toMatchObject({
      logoUrl: 'https://cdn.example/new-logo.png',
      assetUrl: 'https://cdn.example/new-logo.png',
      schoolName: 'Buena Park Academy',
      tagline: 'Learning without limits',
    });
    // An MS scene gets the FLAT keys its pick() reads (registry), nothing else of identity.
    expect(arcade).toMatchObject({
      'school.name': 'BUENA PARK ACADEMY',
      'school.logoUrl': 'https://cdn.example/new-logo.png',
    });
    expect(arcade).not.toHaveProperty('schoolName');
  });

  it('the brandKit snapshot carries the tagline (and the name and logo) for the next rebrand', async () => {
    await controller.createFromPreset(req, 'sys-board', {
      name: 'Mine',
    } as any);
    const data = prisma.client.template.create.mock.calls[0][0].data;
    expect(data.brandKit).toMatchObject({
      displayName: 'Buena Park Academy',
      tagline: 'Learning without limits',
      logoUrl: 'https://cdn.example/new-logo.png',
      fontHeading: 'Montserrat',
      inheritedFrom: 'tenant-branding',
    });
  });

  it('a tenant with no brand clones the preset untouched', async () => {
    prisma.client.tenantBranding.findUnique.mockResolvedValue(null);
    await controller.createFromPreset(req, 'sys-board', {
      name: 'Mine',
    } as any);
    const data = prisma.client.template.create.mock.calls[0][0].data;
    const [board, varsity, logo, arcade] = data.zones.create.map((z: any) =>
      z.defaultConfig ? JSON.parse(z.defaultConfig) : null,
    );
    expect(board).toEqual({
      url: '/templates/x.html',
      textOverrides: { 'brand.tagline': 'A preset line' },
    });
    expect(varsity).toBeNull();
    expect(logo).toBeNull();
    expect(arcade).toBeNull();
    expect(data.brandKit).toBeUndefined();
  });

  it('a duplicate replaces a sample name nobody typed; a typed name survives', async () => {
    const zone = (
      name: string,
      widgetType: string,
      cfg: unknown,
      i: number,
    ) => ({
      name,
      widgetType,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      zIndex: i,
      sortOrder: i,
      defaultConfig: JSON.stringify(cfg),
    });
    prisma.client.template.findFirst.mockResolvedValue({
      ...SOURCE,
      id: 'mine-old',
      isSystem: false,
      tenantId: 'ten1',
      brandKit: null,
      zones: [
        zone('Sample', 'HS_VARSITY', { schoolName: 'WESTRIDGE WILDCATS' }, 0),
        zone('Typed', 'HS_VARSITY', { schoolName: 'LINCOLN EAGLES' }, 1),
        zone('Studio', 'MS_STUDIO', { 'school.name': 'Westridge' }, 2),
      ],
    });
    await controller.duplicate(req, 'mine-old', {} as any);
    const data = prisma.client.template.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe('ten1');
    const [sample, typed, studio] = data.zones.create.map((z: any) =>
      JSON.parse(z.defaultConfig),
    );
    expect(sample.schoolName).toBe('BUENA PARK ACADEMY');
    expect(typed.schoolName).toBe('LINCOLN EAGLES');
    expect(studio['school.name']).toBe('BUENA PARK ACADEMY');
    expect(studio['school.logoUrl']).toBe('https://cdn.example/new-logo.png');
  });
});
