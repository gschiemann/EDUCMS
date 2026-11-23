/**
 * A new template from a preset carries the tenant's identity, not just its colours.
 *
 * Owner, before a demo: "make sure that when I rebrand something everything
 * gets updated that's available". A clone now fills the organisation name,
 * tagline, initials and logo (blanks only — a preset's own text wins), and
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

  it("fills the name, tagline, initials and logo on blanks; a preset's own text wins", async () => {
    await controller.createFromPreset(req, 'sys-board', {
      name: 'Mine',
    } as any);
    const data = prisma.client.template.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe('ten1');
    const [board, varsity, logo] = data.zones.create.map((z: any) =>
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
    const [board, varsity, logo] = data.zones.create.map((z: any) =>
      z.defaultConfig ? JSON.parse(z.defaultConfig) : null,
    );
    expect(board).toEqual({
      url: '/templates/x.html',
      textOverrides: { 'brand.tagline': 'A preset line' },
    });
    expect(varsity).toBeNull();
    expect(logo).toBeNull();
    expect(data.brandKit).toBeUndefined();
  });
});
