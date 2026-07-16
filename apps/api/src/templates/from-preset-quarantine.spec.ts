import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TemplatesController } from './templates.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { BrandingScraperService } from '../branding/branding-scraper.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { RedisService } from '../realtime/redis.service';
import { QUARANTINED_PRESET_IDS } from './ensure-system-presets';

/**
 * S16 (audit W0-08) — from-preset clone must NOT revive a quarantined board.
 *
 * Pre-fix: POST /templates/from-preset/:presetId looked the preset up with
 * `findFirst({ id, isSystem: true })` (no status filter) and, failing that,
 * the in-memory preset packs — then created a tenant-owned ACTIVE copy. A
 * quarantined board is seeded/kept ARCHIVED (hidden from the gallery) but the
 * ARCHIVED row still exists and the in-memory definition is still present, so a
 * known/guessable preset id cloned a placeholder / clipping / brand-licensing
 * board straight into a live tenant template.
 *
 * Post-fix: an early guard rejects any `QUARANTINED_PRESET_IDS.has(presetId)`
 * with 400 TEMPLATE_NOT_AVAILABLE, BEFORE either the DB or the in-memory path
 * runs, and the destructive `template.create` never fires. Non-quarantined ids
 * are completely unaffected (the guard is a pass-through for them).
 *
 * (Controller-level deps: the class declares @UseGuards(JwtAuthGuard,
 * RbacGuard), so Nest resolves the guard dependency graph — JwtService,
 * RedisService — at compile() even though we call the method directly. Same
 * pattern as c2-staleness-guard.spec.ts.)
 */
describe('S16 — from-preset quarantine gate', () => {
  let controller: TemplatesController;
  let prismaService: any;

  const req = { user: { id: 'u1', tenantId: 't1' } };

  beforeEach(async () => {
    prismaService = {
      client: {
        template: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'new-tpl', zones: [] }),
        },
        // getBrandDefaults reads these; only reached on the NON-quarantined,
        // preset-found path (not exercised here — we assert rejection first).
        tenant: { findUnique: jest.fn().mockResolvedValue(null) },
        brandKit: { findFirst: jest.fn().mockResolvedValue(null) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
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

  it('the denylist actually resolves to preset ids (guard has teeth)', () => {
    // If this ever hits 0 the reject test below would be a false-positive.
    expect(QUARANTINED_PRESET_IDS.size).toBeGreaterThan(0);
  });

  it('rejects a quarantined preset id with 400 TEMPLATE_NOT_AVAILABLE and NEVER creates a template', async () => {
    const quarantinedId = [...QUARANTINED_PRESET_IDS][0];
    await expect(
      controller.createFromPreset(req, quarantinedId, { name: 'Sneaky clone' } as any),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: { code: 'TEMPLATE_NOT_AVAILABLE' },
    });
    // The destructive clone must never run — for either the DB or in-memory
    // path. The guard fires before the lookup even happens.
    expect(prismaService.client.template.create).not.toHaveBeenCalled();
    expect(prismaService.client.template.findFirst).not.toHaveBeenCalled();
  });

  it('every quarantined preset id is rejected (not just the first)', async () => {
    for (const id of QUARANTINED_PRESET_IDS) {
      await expect(
        controller.createFromPreset(req, id, { name: 'x' } as any),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    }
    expect(prismaService.client.template.create).not.toHaveBeenCalled();
  });

  it('throws an HttpException instance so the global filter serializes {code,...}', async () => {
    const quarantinedId = [...QUARANTINED_PRESET_IDS][0];
    await expect(
      controller.createFromPreset(req, quarantinedId, { name: 'x' } as any),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('does NOT over-block: a non-quarantined unknown id passes the guard and falls through to the normal 404 path', async () => {
    // A non-quarantined id must reach the existing lookup (DB then in-memory)
    // and, when it matches nothing, 404 — proving the new guard is scoped only
    // to quarantined ids and did not change behavior for everything else.
    await expect(
      controller.createFromPreset(req, 'definitely-not-a-real-preset-id-xyz', { name: 'x' } as any),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      response: { code: 'TEMPLATE_PRESET_NOT_FOUND' },
    });
    // It got past the guard and actually queried the DB.
    expect(prismaService.client.template.findFirst).toHaveBeenCalled();
  });
});
