import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TemplatesController } from './templates.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { BrandingScraperService } from '../branding/branding-scraper.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { RedisService } from '../realtime/redis.service';

// The controller declares @UseGuards(JwtAuthGuard, RbacGuard) at the class
// level. Nest's testing module resolves every controller-level dependency
// graph at compile() time (guards included), even though this spec calls
// controller methods directly and never goes through the HTTP pipeline
// (same pattern as emergency.controller.spec.ts) — so JwtAuthGuard's own
// constructor deps (JwtService, RedisService) still need a provider here.

/**
 * C2 drift-catcher (Wave C — "Crush Canva" safety net, 2026-07-02).
 *
 * Pre-fix: PUT /templates/:id and PUT /templates/:id/zones were blind
 * writes — no staleness check at all. Two tabs (or two operators)
 * editing the same template silently clobbered each other; a stale
 * tab's Ctrl-S erased the fresh tab's saved work with zero warning
 * (docs/research/.../D6_MULTIPLAYER_DEFERRED.md itself names
 * "stale-write detection... as a stopgap" that was never built).
 *
 * Post-fix: an optional `expectedUpdatedAt` in the request body is
 * compared against the row's CURRENT `updatedAt`. If the row moved
 * since the client's `expectedUpdatedAt`, the endpoint 409s with
 * `{code:'TEMPLATE_STALE', serverUpdatedAt}`. The field is entirely
 * optional — an older client (or the deliberate "Overwrite" retry)
 * that omits it gets EXACTLY the pre-fix blind-write behavior.
 */
describe('C2 — Save staleness guard', () => {
  let controller: TemplatesController;
  let prismaService: any;

  const NOW = new Date('2026-07-02T12:00:00.000Z');
  const OLDER = new Date('2026-07-02T11:00:00.000Z'); // what a stale client loaded
  const req = { user: { id: 'u1', tenantId: 't1' } };

  function baseTemplate(overrides: Record<string, unknown> = {}) {
    return {
      id: 'tpl1',
      tenantId: 't1',
      isSystem: false,
      updatedAt: NOW,
      name: 'Lobby Board',
      ...overrides,
    };
  }

  beforeEach(async () => {
    prismaService = {
      client: {
        template: {
          findFirst: jest.fn().mockResolvedValue(baseTemplate()),
          findUnique: jest.fn().mockResolvedValue(baseTemplate({ zones: [] })),
          update: jest.fn().mockImplementation(({ data }: any) =>
            Promise.resolve(baseTemplate({ ...data, zones: [] })),
          ),
        },
        templateZone: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn().mockResolvedValue({}),
        },
        templateVersion: {
          create: jest.fn().mockResolvedValue({ id: 'ver-new' }),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        // snapshotVersion (C3) uses the INTERACTIVE ($transaction(async tx =>
        // ...)) form; replaceZones's own zone replace uses the ARRAY form.
        // Dispatch on argument type so both call sites work against one mock.
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

  describe('PUT /templates/:id (metadata)', () => {
    it('backward compat: omitting expectedUpdatedAt saves exactly as before (no 409, no field required)', async () => {
      const result = await controller.update(req, 'tpl1', { name: 'Renamed' } as any);
      expect(result).toBeTruthy();
      expect(prismaService.client.template.update).toHaveBeenCalledTimes(1);
    });

    it('succeeds when expectedUpdatedAt matches the current row (not stale)', async () => {
      const result = await controller.update(
        req,
        'tpl1',
        { name: 'Renamed', expectedUpdatedAt: NOW.toISOString() } as any,
      );
      expect(result).toBeTruthy();
      expect(prismaService.client.template.update).toHaveBeenCalledTimes(1);
    });

    it('409s with TEMPLATE_STALE + serverUpdatedAt when the row is newer than expectedUpdatedAt', async () => {
      await expect(
        controller.update(req, 'tpl1', { name: 'Renamed', expectedUpdatedAt: OLDER.toISOString() } as any),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: {
          code: 'TEMPLATE_STALE',
          serverUpdatedAt: NOW.toISOString(),
        },
      });
      // The stale write must NEVER reach the database.
      expect(prismaService.client.template.update).not.toHaveBeenCalled();
    });

    it('throws an HttpException instance (so the global filter serializes {code,...} correctly)', async () => {
      await expect(
        controller.update(req, 'tpl1', { expectedUpdatedAt: OLDER.toISOString() } as any),
      ).rejects.toBeInstanceOf(HttpException);
    });

    it('fails OPEN (saves anyway) on a malformed expectedUpdatedAt rather than blocking the operator', async () => {
      const result = await controller.update(
        req,
        'tpl1',
        { name: 'Renamed', expectedUpdatedAt: 'not-a-real-date' } as any,
      );
      expect(result).toBeTruthy();
      expect(prismaService.client.template.update).toHaveBeenCalledTimes(1);
    });

    it('rejects null/empty expectedUpdatedAt as a no-op guard (same as omitted)', async () => {
      const result = await controller.update(req, 'tpl1', { name: 'X', expectedUpdatedAt: null } as any);
      expect(result).toBeTruthy();
    });
  });

  describe('PUT /templates/:id/zones (replace-all — the most destructive path)', () => {
    const zone = { name: 'Header', widgetType: 'CLOCK', x: 0, y: 0, width: 50, height: 20 };

    // NOTE: $transaction now fires TWICE per successful replaceZones — once
    // for the destructive zone-replace itself (ARRAY form) and once inside
    // snapshotVersion's C3 cap-eviction (INTERACTIVE/function form, made
    // atomic 2026-07-03 — see c3-version-history.spec.ts). This C2 suite
    // only cares about the destructive zone-replace call, so assert on the
    // array-form call specifically rather than a raw total call count.
    it('backward compat: omitting expectedUpdatedAt replaces zones exactly as before', async () => {
      const result = await controller.replaceZones(req, 'tpl1', { zones: [zone] } as any);
      expect(result).toBeTruthy();
      const arrayCalls = prismaService.client.$transaction.mock.calls.filter((c: any) => Array.isArray(c[0]));
      expect(arrayCalls).toHaveLength(1);
    });

    it('succeeds when expectedUpdatedAt matches the current row', async () => {
      const result = await controller.replaceZones(
        req,
        'tpl1',
        { zones: [zone], expectedUpdatedAt: NOW.toISOString() } as any,
      );
      expect(result).toBeTruthy();
      const arrayCalls = prismaService.client.$transaction.mock.calls.filter((c: any) => Array.isArray(c[0]));
      expect(arrayCalls).toHaveLength(1);
    });

    it('409s with TEMPLATE_STALE and NEVER runs the delete-all-and-recreate transaction', async () => {
      await expect(
        controller.replaceZones(req, 'tpl1', { zones: [zone], expectedUpdatedAt: OLDER.toISOString() } as any),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: { code: 'TEMPLATE_STALE', serverUpdatedAt: NOW.toISOString() },
      });
      // The whole point: a stale Save must not blow away the fresh
      // tab's zones. The destructive transaction must never fire.
      expect(prismaService.client.$transaction).not.toHaveBeenCalled();
    });

    it('the conflict fires BEFORE zone-bounds validation — a stale save with also-invalid zones still reports staleness, not a bounds error', async () => {
      const invalidZone = { name: 'Bad', widgetType: 'CLOCK', x: -5, y: 0, width: 50, height: 20 };
      await expect(
        controller.replaceZones(req, 'tpl1', { zones: [invalidZone], expectedUpdatedAt: OLDER.toISOString() } as any),
      ).rejects.toMatchObject({ response: { code: 'TEMPLATE_STALE' } });
    });
  });

  describe('cross-tenant / not-found guard is unaffected by the new field', () => {
    it('still 404s when the template does not belong to the caller tenant, regardless of expectedUpdatedAt', async () => {
      prismaService.client.template.findFirst.mockResolvedValueOnce(null);
      await expect(
        controller.update(req, 'not-mine', { expectedUpdatedAt: NOW.toISOString() } as any),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });

    it('still 403s on a system template regardless of expectedUpdatedAt', async () => {
      prismaService.client.template.findFirst.mockResolvedValueOnce(baseTemplate({ isSystem: true }));
      await expect(
        controller.update(req, 'tpl1', { expectedUpdatedAt: NOW.toISOString() } as any),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });
  });

  // Regression for the 2026-07-03 lead-review catch: the client save is TWO
  // PUTs (metadata then zones). The metadata PUT bumps the row's @updatedAt,
  // so if the zones PUT re-sent the SAME pre-save expectedUpdatedAt, the
  // now-newer row would ALWAYS exceed it and every save would self-409 on the
  // destructive zones write. The original spec mocked a STATIC updatedAt and
  // never caught this; here we advance updatedAt after the metadata update.
  describe('two-phase client save (metadata → zones) must not self-409', () => {
    const LATER = new Date('2026-07-02T12:00:05.000Z'); // updatedAt after the metadata PUT bumps it
    const zone = { name: 'Header', widgetType: 'CLOCK', x: 0, y: 0, width: 50, height: 20 };

    beforeEach(() => {
      let bumped = false; // flips true once the metadata update writes
      prismaService.client.template.findFirst = jest.fn().mockImplementation(() =>
        Promise.resolve(baseTemplate({ updatedAt: bumped ? LATER : NOW })),
      );
      prismaService.client.template.findUnique = jest.fn().mockImplementation(() =>
        Promise.resolve(baseTemplate({ zones: [], updatedAt: bumped ? LATER : NOW })),
      );
      prismaService.client.template.update = jest.fn().mockImplementation(({ data }: any) => {
        bumped = true; // the real DB's @updatedAt advances on this write
        return Promise.resolve(baseTemplate({ ...data, zones: [], updatedAt: LATER }));
      });
    });

    it('metadata(expected=NOW) then zones(guard OMITTED, the fixed client) both succeed', async () => {
      await controller.update(req, 'tpl1', { name: 'X', expectedUpdatedAt: NOW.toISOString() } as any);
      const zonesResult = await controller.replaceZones(req, 'tpl1', { zones: [zone] } as any);
      expect(zonesResult).toBeTruthy();
    });

    it('proves the bug the fix prevents: the OLD client re-sending expected=NOW to the zones PUT 409s (row is now LATER)', async () => {
      await controller.update(req, 'tpl1', { name: 'X', expectedUpdatedAt: NOW.toISOString() } as any);
      await expect(
        controller.replaceZones(req, 'tpl1', { zones: [zone], expectedUpdatedAt: NOW.toISOString() } as any),
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT, response: { code: 'TEMPLATE_STALE' } });
    });
  });
});
