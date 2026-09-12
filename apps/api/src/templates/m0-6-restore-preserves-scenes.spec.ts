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
 * M0-6 (2026-09-12) — "restoring a version destroys a multi-scene board".
 *
 * Operator symptom: a touch kiosk with several SCENES (Welcome → Directory →
 * Map). Restore ANY saved version and every widget is suddenly on every
 * scene; the navigation graph is gone. Restoring also ate one of the five
 * history slots each time.
 *
 * Four defects in ONE handler, all proven below:
 *   1. `sceneId: null` was hard-coded on every restored zone, behind a
 *      comment claiming scenes "aren't captured in the snapshot". They are —
 *      `snapshotVersion` stores the raw `TemplateZone` rows.
 *   2. `defaultConfig` was re-`JSON.stringify`'d even though the snapshot
 *      already holds the column's JSON string, so every widget's config came
 *      back double-encoded (and `mapTemplate` then parsed it to a *string*).
 *   3. The transaction read-back was destructured at position 2, which is
 *      the first recreated ZONE for any snapshot with zones — so the endpoint
 *      returned a zone row where the client expects the template.
 *   4. The pre-restore safety snapshot ran unconditionally, spending a
 *      history slot (and evicting the oldest real save) on a row that is
 *      normally a byte-for-byte duplicate of the newest version.
 *
 * Mock-Prisma style + the JwtAuthGuard provider list follow
 * c3-version-history.spec.ts, the sibling suite for this endpoint.
 */
describe('M0-6 — version restore keeps every zone on its scene (and stops eating history slots)', () => {
  let controller: TemplatesController;
  let prismaService: any;

  // INJ-003: an explicit admin role — the live-content gate is fail-closed.
  const req = { user: { id: 'u1', tenantId: 't1', role: AppRole.SCHOOL_ADMIN } };

  const SCENE_WELCOME = 'scene-welcome';
  const SCENE_DIRECTORY = 'scene-directory';
  const SCENE_MAP = 'scene-map';

  const liveScenes = [
    { id: SCENE_WELCOME, templateId: 'tpl1', name: 'Welcome', sortOrder: 0, isDefault: true },
    { id: SCENE_DIRECTORY, templateId: 'tpl1', name: 'Directory', sortOrder: 1, isDefault: false },
    { id: SCENE_MAP, templateId: 'tpl1', name: 'Map', sortOrder: 2, isDefault: false },
  ];

  /**
   * A snapshot zone is a RAW TemplateZone row — which is exactly why this
   * fixture carries `defaultConfig` as a STRING and a real `sceneId`.
   * Faking it as a parsed object would hide defect #2 completely.
   */
  function snapZone(over: Record<string, unknown> = {}) {
    return {
      id: 'zone-old',
      templateId: 'tpl1',
      name: 'Zone',
      widgetType: 'TEXT',
      x: 0,
      y: 0,
      width: 25,
      height: 25,
      zIndex: 3,
      sortOrder: 0,
      defaultConfig: '{"content":"Welcome to the lobby"}',
      touchAction: null,
      sceneId: SCENE_WELCOME,
      ...over,
    };
  }

  /** The three-scene kiosk snapshot the operator is restoring. */
  const multiSceneSnapshotZones = [
    snapZone({ id: 'z1', name: 'Welcome hero', sortOrder: 0, sceneId: SCENE_WELCOME }),
    snapZone({ id: 'z2', name: 'Directory list', widgetType: 'TICKER', sortOrder: 1, sceneId: SCENE_DIRECTORY }),
    snapZone({ id: 'z3', name: 'Campus map', widgetType: 'IMAGE', sortOrder: 2, sceneId: SCENE_MAP }),
    // Shared furniture — renders on every scene. `null` is an explicit
    // operator choice and must survive as null, not become a scene.
    snapZone({ id: 'z4', name: 'District logo', widgetType: 'LOGO', sortOrder: 3, sceneId: null }),
  ];

  const snapshotMeta = {
    name: 'Lobby Kiosk',
    description: 'd',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: null,
    bgGradient: null,
    bgImage: null,
    isTouchEnabled: true,
    idleResetMs: 60000,
  };

  function baseTemplate(overrides: Record<string, unknown> = {}) {
    return {
      id: 'tpl1',
      tenantId: 't1',
      isSystem: false,
      updatedAt: new Date('2026-09-12T12:00:00.000Z'),
      name: 'Lobby Kiosk',
      description: 'd',
      screenWidth: 1920,
      screenHeight: 1080,
      bgColor: null,
      bgGradient: null,
      bgImage: null,
      isTouchEnabled: true,
      idleResetMs: 60000,
      zones: [],
      scenes: liveScenes,
      ...overrides,
    };
  }

  /** Every `templateZone.create` payload the restore transaction built. */
  function createdZones() {
    return prismaService.client.templateZone.create.mock.calls.map((c: any[]) => c[0].data);
  }

  beforeEach(async () => {
    prismaService = {
      client: {
        template: {
          findFirst: jest.fn().mockResolvedValue(baseTemplate()),
          findUnique: jest.fn().mockResolvedValue(baseTemplate({ __readBack: true })),
          update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(baseTemplate({ ...data }))),
        },
        templateZone: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          // A distinguishable sentinel: defect #3 returned THIS where the
          // template belongs, so the assertion has something to catch.
          create: jest.fn().mockResolvedValue({ id: 'created-zone-row', name: 'a zone, not a template' }),
        },
        templateVersion: {
          create: jest.fn().mockResolvedValue({ id: 'ver-new' }),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          findFirst: jest.fn().mockResolvedValue(null),
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

  /**
   * `templateVersion.findFirst` is called TWICE by restoreVersion: first for
   * the target version, then for the newest row (the slot-neutrality check).
   * Drive them independently so a test can say "the newest version is/ isn't
   * the current state" without touching the version being restored.
   */
  function arrangeVersions(target: any, newest: any = null) {
    prismaService.client.templateVersion.findFirst
      .mockReset()
      .mockResolvedValueOnce(target)
      .mockResolvedValue(newest);
  }

  describe('the multi-scene collapse (defect 1)', () => {
    beforeEach(() => {
      arrangeVersions({ id: 'ver-old', templateId: 'tpl1', zones: multiSceneSnapshotZones, meta: snapshotMeta });
    });

    it('puts every restored zone back on its ORIGINAL scene', async () => {
      await controller.restoreVersion(req, 'tpl1', 'ver-old');
      const byName = new Map(createdZones().map((z: any) => [z.name, z]));
      expect(byName.get('Welcome hero').sceneId).toBe(SCENE_WELCOME);
      expect(byName.get('Directory list').sceneId).toBe(SCENE_DIRECTORY);
      expect(byName.get('Campus map').sceneId).toBe(SCENE_MAP);
    });

    it('does NOT collapse the board — no two scenes end up holding the same zone', async () => {
      await controller.restoreVersion(req, 'tpl1', 'ver-old');
      const scened = createdZones().filter((z: any) => z.sceneId !== null);
      expect(new Set(scened.map((z: any) => z.sceneId)).size).toBe(3);
      // The pre-fix behaviour: every zone on `sceneId: null` renders on
      // EVERY scene. Exactly one zone here is legitimately shared.
      expect(createdZones().filter((z: any) => z.sceneId === null)).toHaveLength(1);
    });

    it('keeps a deliberately-shared zone shared (null stays null, never promoted to a scene)', async () => {
      await controller.restoreVersion(req, 'tpl1', 'ver-old');
      const logo = createdZones().find((z: any) => z.name === 'District logo');
      expect(logo.sceneId).toBeNull();
    });

    it('a scene deleted since the snapshot degrades to the DEFAULT scene — never a dangling FK, never a silent collapse', async () => {
      // Operator deleted "Map" after this version was saved.
      prismaService.client.template.findFirst.mockResolvedValue(
        baseTemplate({ scenes: liveScenes.filter((s) => s.id !== SCENE_MAP) }),
      );
      await controller.restoreVersion(req, 'tpl1', 'ver-old');
      const map = createdZones().find((z: any) => z.name === 'Campus map');
      expect(map.sceneId).toBe(SCENE_WELCOME); // the isDefault scene
      // and the surviving scenes are still exactly themselves
      expect(createdZones().find((z: any) => z.name === 'Directory list').sceneId).toBe(SCENE_DIRECTORY);
    });

    it('falls back to null (not a crash) when the template has no scenes at all', async () => {
      prismaService.client.template.findFirst.mockResolvedValue(baseTemplate({ scenes: [] }));
      await controller.restoreVersion(req, 'tpl1', 'ver-old');
      expect(createdZones().every((z: any) => z.sceneId === null)).toBe(true);
    });

    it('carries every other per-zone field the snapshot holds (zIndex / sortOrder / touchAction / geometry)', async () => {
      arrangeVersions({
        id: 'ver-old',
        templateId: 'tpl1',
        zones: [
          snapZone({
            name: 'Directory button',
            widgetType: 'TOUCH_POINT',
            x: 10,
            y: 20,
            width: 30,
            height: 40,
            zIndex: 7,
            sortOrder: 4,
            touchAction: { type: 'goto-scene', target: SCENE_DIRECTORY },
            sceneId: SCENE_WELCOME,
          }),
        ],
        meta: snapshotMeta,
      });
      await controller.restoreVersion(req, 'tpl1', 'ver-old');
      expect(createdZones()[0]).toMatchObject({
        name: 'Directory button',
        widgetType: 'TOUCH_POINT',
        x: 10,
        y: 20,
        width: 30,
        height: 40,
        zIndex: 7,
        sortOrder: 4,
        touchAction: { type: 'goto-scene', target: SCENE_DIRECTORY },
        sceneId: SCENE_WELCOME,
      });
    });
  });

  describe('defaultConfig double-encode (defect 2)', () => {
    it('writes the snapshot\'s JSON string back VERBATIM — one round of encoding, not two', async () => {
      arrangeVersions({ id: 'ver-old', templateId: 'tpl1', zones: multiSceneSnapshotZones, meta: snapshotMeta });
      await controller.restoreVersion(req, 'tpl1', 'ver-old');
      const hero = createdZones().find((z: any) => z.name === 'Welcome hero');
      expect(hero.defaultConfig).toBe('{"content":"Welcome to the lobby"}');
      // The real failure mode, stated as the operator sees it: what the
      // client parses back out has to be the CONFIG OBJECT, not a string.
      expect(JSON.parse(hero.defaultConfig)).toEqual({ content: 'Welcome to the lobby' });
    });

    it('still stringifies an OBJECT config (a snapshot written by some future caller that stores parsed configs)', async () => {
      arrangeVersions({
        id: 'ver-obj',
        templateId: 'tpl1',
        zones: [snapZone({ defaultConfig: { content: 'parsed shape' } })],
        meta: snapshotMeta,
      });
      await controller.restoreVersion(req, 'tpl1', 'ver-obj');
      expect(createdZones()[0].defaultConfig).toBe('{"content":"parsed shape"}');
    });

    it('an empty / absent config still lands as null', async () => {
      arrangeVersions({
        id: 'ver-empty',
        templateId: 'tpl1',
        zones: [snapZone({ defaultConfig: null }), snapZone({ defaultConfig: '' })],
        meta: snapshotMeta,
      });
      await controller.restoreVersion(req, 'tpl1', 'ver-empty');
      expect(createdZones().map((z: any) => z.defaultConfig)).toEqual([null, null]);
    });
  });

  describe('the response the builder re-inits from (defect 3)', () => {
    it('returns the re-read TEMPLATE, not the first recreated zone', async () => {
      arrangeVersions({ id: 'ver-old', templateId: 'tpl1', zones: multiSceneSnapshotZones, meta: snapshotMeta });
      const result: any = await controller.restoreVersion(req, 'tpl1', 'ver-old');
      expect(result.id).toBe('tpl1');
      expect(result.__readBack).toBe(true);
      expect(result.name).toBe('Lobby Kiosk');
      // The sentinel the pre-fix index-2 destructure returned.
      expect(result.id).not.toBe('created-zone-row');
    });
  });

  describe('history slots (defect 4)', () => {
    /** A version row whose content IS the live template row. */
    function versionOf(tpl: any) {
      return {
        zones: tpl.zones,
        meta: {
          name: tpl.name,
          description: tpl.description,
          screenWidth: tpl.screenWidth,
          screenHeight: tpl.screenHeight,
          bgColor: tpl.bgColor,
          bgGradient: tpl.bgGradient,
          bgImage: tpl.bgImage,
          isTouchEnabled: tpl.isTouchEnabled,
          idleResetMs: tpl.idleResetMs,
        },
      };
    }

    it('spends NO slot when the newest version already holds the exact current state (the normal save-then-restore)', async () => {
      const live = baseTemplate({ zones: multiSceneSnapshotZones });
      prismaService.client.template.findFirst.mockResolvedValue(live);
      arrangeVersions(
        { id: 'ver-old', templateId: 'tpl1', zones: multiSceneSnapshotZones, meta: snapshotMeta },
        versionOf(live),
      );
      await controller.restoreVersion(req, 'tpl1', 'ver-old');
      expect(prismaService.client.templateVersion.create).not.toHaveBeenCalled();
      // …and the restore itself still happened.
      expect(prismaService.client.templateZone.deleteMany).toHaveBeenCalled();
      expect(createdZones()).toHaveLength(4);
    });

    it('records the decision in the audit row so it is never silent', async () => {
      const live = baseTemplate({ zones: multiSceneSnapshotZones });
      prismaService.client.template.findFirst.mockResolvedValue(live);
      arrangeVersions(
        { id: 'ver-old', templateId: 'tpl1', zones: multiSceneSnapshotZones, meta: snapshotMeta },
        versionOf(live),
      );
      await controller.restoreVersion(req, 'tpl1', 'ver-old');
      const details = prismaService.client.auditLog.create.mock.calls.at(-1)[0].data.details;
      expect(JSON.parse(details)).toMatchObject({ via: 'version-restore', safetySnapshot: false });
    });

    it('DOES spend a slot when the live row has drifted from the newest version (brand-apply / scene-delete write zones without a version)', async () => {
      const live = baseTemplate({ zones: multiSceneSnapshotZones });
      prismaService.client.template.findFirst.mockResolvedValue(live);
      const drifted = versionOf(live);
      drifted.zones = [{ ...multiSceneSnapshotZones[0], defaultConfig: '{"content":"before the brand apply"}' },
        ...multiSceneSnapshotZones.slice(1)];
      arrangeVersions(
        { id: 'ver-old', templateId: 'tpl1', zones: multiSceneSnapshotZones, meta: snapshotMeta },
        drifted,
      );
      await controller.restoreVersion(req, 'tpl1', 'ver-old');
      expect(prismaService.client.templateVersion.create).toHaveBeenCalledTimes(1);
      const details = prismaService.client.auditLog.create.mock.calls.at(-1)[0].data.details;
      expect(JSON.parse(details)).toMatchObject({ safetySnapshot: true });
    });

    it('DOES spend a slot when there is no version history to compare against at all', async () => {
      arrangeVersions({ id: 'ver-old', templateId: 'tpl1', zones: multiSceneSnapshotZones, meta: snapshotMeta }, null);
      await controller.restoreVersion(req, 'tpl1', 'ver-old');
      expect(prismaService.client.templateVersion.create).toHaveBeenCalledTimes(1);
    });

    it('fails SAFE — when the live zones cannot be read at all, it snapshots rather than assuming a match', async () => {
      // A caller (or a test harness) whose template read omits the zones
      // include. "I could not compare" must never grade as "identical".
      const { zones: _drop, ...noZones } = baseTemplate() as any;
      prismaService.client.template.findFirst.mockResolvedValue(noZones);
      arrangeVersions(
        { id: 'ver-old', templateId: 'tpl1', zones: multiSceneSnapshotZones, meta: snapshotMeta },
        { zones: multiSceneSnapshotZones, meta: snapshotMeta },
      );
      await expect(controller.restoreVersion(req, 'tpl1', 'ver-old')).resolves.toBeTruthy();
      expect(prismaService.client.templateVersion.create).toHaveBeenCalledTimes(1);
    });

    it('a meta-only drift (someone renamed the template) still earns a safety snapshot', async () => {
      const live = baseTemplate({ zones: multiSceneSnapshotZones });
      prismaService.client.template.findFirst.mockResolvedValue(live);
      const drifted = versionOf(live);
      drifted.meta = { ...drifted.meta, name: 'Old name before the rename' };
      arrangeVersions(
        { id: 'ver-old', templateId: 'tpl1', zones: multiSceneSnapshotZones, meta: snapshotMeta },
        drifted,
      );
      await controller.restoreVersion(req, 'tpl1', 'ver-old');
      expect(prismaService.client.templateVersion.create).toHaveBeenCalledTimes(1);
    });
  });
});
