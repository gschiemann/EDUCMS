/**
 * SEC-009 — TWO-TENANT × EVERY-ROLE ISOLATION MATRIX (2026-09-04).
 *
 * The independent security audit's finding was an ASSURANCE gap, not a proven
 * exploit: the static tenant-isolation ratchet proved no NEW unscoped query,
 * and several sampled call sites did check ownership — but nothing anywhere
 * asserted, end to end, that tenant A's actor cannot reach tenant B's object.
 * "The pre-check looked right when I read it" is not a control.
 *
 * This is that assertion, table-driven, and the table is enforced: the last
 * test in this file AST-scans every controller in the API for tenant-owned
 * model access and FAILS if one is neither covered below nor listed in
 * DOCUMENTED_GAPS with a reason. Adding a CRUD controller without a row here
 * turns this suite red.
 *
 * HOW IT PROVES SOMETHING (see ./two-tenant-prisma.ts). The Prisma double
 * really evaluates the `where` clause against a two-tenant dataset, so a
 * handler that queries `{ where: { id } }` genuinely receives tenant B's row —
 * the assertion is about the QUERY, not about a fixture that was rigged to
 * return null. Every row handed back or mutated is recorded with its tenant,
 * and each case asserts ZERO rows belonging to the foreign tenant were touched.
 *
 * WHAT EACH CASE DOES. Actor = a user of tenant A holding role R. Target = the
 * id of a tenant-B object of the matching type. The handler must refuse (throw)
 * or come back empty, and must not have read or written any tenant-B row on the
 * way. Roles are exercised as identities: RbacGuard is what enforces "may this
 * role call this route at all", and it has its own suite (auth/rbac.guard.spec)
 * — what is unproven without this file is whether the TENANT boundary holds
 * once a role is past the guard. Each case additionally asserts the route's
 * @RequireRoles metadata excludes RESTRICTED_VIEWER for write/delete routes.
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { AppRole } from '@cms/database';
import { ROLES_KEY } from '../auth/roles.decorator';
import { makeTwoTenantPrisma, type Dataset } from './two-tenant-prisma';

import { AssetsController } from '../assets/assets.controller';
import { TemplatesController } from '../templates/templates.controller';
import { PlaylistsController } from '../playlists/playlists.controller';
import { SchedulesController } from '../schedules/schedules.controller';
import { ScreenGroupsController } from '../screen-groups/screen-groups.controller';
import { FloorPlansController } from '../floor-plans/floor-plans.controller';
import { SubmissionsController } from '../submissions/submissions.controller';
import { AuditController } from '../audit/audit.controller';
import { FleetPulseController } from '../screens/fleet-pulse.controller';
import { PanicContentController } from '../panic-content/panic-content.controller';

const HOME = 't-alpha';
const FOREIGN = 't-beta';

const ALL_ROLES: AppRole[] = [
  AppRole.SUPER_ADMIN,
  AppRole.DISTRICT_ADMIN,
  AppRole.SCHOOL_ADMIN,
  AppRole.CONTRIBUTOR,
  AppRole.RESTRICTED_VIEWER,
];

/** One row per model per tenant. Foreign ids are the attack payloads. */
function dataset(): Dataset {
  const pair = (make: (t: string, suffix: string) => any) => [make(HOME, 'a'), make(FOREIGN, 'b')];
  return {
    tenant: [
      { id: HOME, name: 'Alpha District', slug: 'alpha', parentId: null, vertical: 'EDU', archivedAt: null },
      { id: FOREIGN, name: 'Beta District', slug: 'beta', parentId: null, vertical: 'EDU', archivedAt: null },
    ],
    user: pair((tenantId, s) => ({
      id: `user-${s}`,
      tenantId,
      email: `${s}@example.test`,
      role: AppRole.SCHOOL_ADMIN,
      status: 'ACTIVE',
      deletedAt: null,
    })),
    asset: pair((tenantId, s) => ({
      id: `asset-${s}`,
      tenantId,
      uploadedByUserId: `user-${s}`,
      folderId: null,
      fileUrl: `https://cdn.test/${s}.png`,
      mimeType: 'image/png',
      status: 'PENDING_APPROVAL',
      originalName: `${s}.png`,
      fileSize: 10,
      fileHash: null,
      altText: null,
      // Declared so the asset-library's `NOT: { playlistItems: { some: … } }`
      // emergency-content filter is evaluable rather than unmodelled.
      playlistItems: [],
    })),
    assetFolder: pair((tenantId, s) => ({ id: `folder-${s}`, tenantId, parentId: null, name: `folder ${s}` })),
    template: pair((tenantId, s) => ({
      id: `tpl-${s}`,
      tenantId,
      name: `Template ${s}`,
      description: null,
      category: 'CUSTOM',
      isSystem: false,
      screenWidth: 1920,
      screenHeight: 1080,
      orientation: 'LANDSCAPE',
      bgColor: null,
      bgGradient: null,
      bgImage: null,
      brandKit: null,
      isTouchEnabled: false,
      idleResetMs: null,
      vertical: 'EDU',
      schoolLevel: null,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      zones: [],
      scenes: [],
    })),
    playlist: pair((tenantId, s) => ({
      id: `pl-${s}`,
      tenantId,
      name: `Playlist ${s}`,
      templateId: null,
      isProtected: false,
      protectedKind: null,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    })),
    schedule: pair((tenantId, s) => ({
      id: `sch-${s}`,
      tenantId,
      playlistId: `pl-${s}`,
      screenId: `scr-${s}`,
      screenGroupId: null,
      isActive: true,
      priority: 1,
      startTime: new Date('2026-01-01T00:00:00Z'),
      endTime: null,
      daysOfWeek: null,
      timeStart: null,
      timeEnd: null,
    })),
    screen: pair((tenantId, s) => ({
      id: `scr-${s}`,
      tenantId,
      screenGroupId: `grp-${s}`,
      name: `Screen ${s}`,
      status: 'ONLINE',
      floorPlanId: `fp-${s}`,
      floorX: 1,
      floorY: 1,
      deviceFingerprint: `fp-print-${s}`,
    })),
    screenGroup: pair((tenantId, s) => ({
      id: `grp-${s}`,
      tenantId,
      name: `Group ${s}`,
      description: null,
      syncMode: 'independent',
      address: null,
      latitude: null,
      longitude: null,
    })),
    floorPlan: pair((tenantId, s) => ({
      id: `fp-${s}`,
      tenantId,
      name: `Floor ${s}`,
      imageUrl: `https://cdn.test/plan-${s}.png`,
      widthPx: 1000,
      heightPx: 1000,
      buildingLabel: null,
      floorLabel: null,
    })),
    submission: pair((tenantId, s) => ({
      id: `sub-${s}`,
      tenantId,
      status: 'PENDING',
      submittedById: `user-${s}`,
      decidedById: null,
      reviewerNote: null,
      assetIds: [],
      playlistIds: [],
      scheduleIds: [],
      note: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })),
    auditLog: pair((tenantId, s) => ({
      id: `audit-${s}`,
      tenantId,
      userId: `user-${s}`,
      action: `SECRET_ACTION_${s.toUpperCase()}`,
      targetType: 'Asset',
      targetId: `asset-${s}`,
      details: null,
      apiKeyId: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      user: { email: `${s}@example.test`, role: AppRole.SCHOOL_ADMIN },
    })),
    // PlaylistItem carries no tenantId of its own — the parent playlist is
    // embedded so both the handler's ownership check and the leak detector can
    // see which tenant the row really belongs to.
    playlistItem: pair((tenantId, s) => ({
      id: `pi-${s}`,
      playlistId: `panic-${s}`,
      assetId: `asset-${s}`,
      durationMs: 10_000,
      sequenceOrder: 0,
      playlist: { tenantId, isProtected: true, protectedKind: 'LOCKDOWN' },
    })),
    notification: [],
    templateZone: [],
    templateScene: [],
    templateVersion: [],
  };
}

function actor(role: AppRole) {
  return {
    user: {
      id: 'user-a',
      tenantId: HOME,
      schoolId: HOME,
      districtId: HOME,
      role,
      email: 'a@example.test',
    },
  };
}

const noop = () => undefined;
const stubRedis = { publish: jest.fn(async () => undefined), sismember: jest.fn(async () => false) } as any;
const stubSigner = { signMessage: jest.fn(() => ({ type: 'SYNC' })) } as any;
const stubStorage = {
  extractPath: jest.fn(() => null),
  delete: jest.fn(async () => undefined),
  download: jest.fn(async () => null),
  publicUrlForPath: jest.fn((p: string) => `https://cdn.test/${p}`),
  signedUrlForPath: jest.fn(async () => null),
  assertObjectExists: jest.fn(async () => undefined),
} as any;
const stubNotify = {
  create: jest.fn(async () => undefined),
  notifySubmissionCreated: jest.fn(async () => undefined),
  notifySubmissionDecided: jest.fn(async () => undefined),
} as any;

type Op = 'read' | 'list' | 'write' | 'delete' | 'export';

interface Case {
  /** Stable label used in the test name and in the coverage report. */
  name: string;
  controller: Function;
  /** Route handler name — used to read @RequireRoles metadata. */
  handler: string;
  op: Op;
  /** Build the controller with the shared prisma double. */
  build: (prisma: any) => any;
  /** Exercise the handler as `actor`, aimed at the FOREIGN object. */
  invoke: (c: any, req: any) => Promise<unknown>;
  /**
   * Models this route is ALLOWED to READ a foreign row from, because reading it
   * is how the route discovers it must refuse (the `ten-ok` ownership-resolver
   * pattern). A foreign WRITE is never allowed, whatever is listed here.
   */
  resolverReads?: string[];
}

const MATRIX: Case[] = [
  // ── Assets ────────────────────────────────────────────────────────────
  {
    name: 'assets: read another tenant\'s asset for playback',
    controller: AssetsController, handler: 'getForPlayback', op: 'read',
    build: (p) => new AssetsController(p, stubStorage, {} as any, {} as any, {} as any),
    invoke: (c, req) => c.getForPlayback(req, 'asset-b'),
  },
  {
    name: 'assets: list never includes another tenant\'s asset',
    controller: AssetsController, handler: 'list', op: 'list',
    build: (p) => new AssetsController(p, stubStorage, {} as any, {} as any, {} as any),
    invoke: (c, req) => c.list(req),
  },
  {
    name: 'assets: write alt-text onto another tenant\'s asset',
    controller: AssetsController, handler: 'updateAltText', op: 'write',
    build: (p) => new AssetsController(p, stubStorage, {} as any, {} as any, {} as any),
    invoke: (c, req) => c.updateAltText(req, 'asset-b', { altText: 'pwned' }),
  },
  {
    name: 'assets: approve another tenant\'s pending asset',
    controller: AssetsController, handler: 'approve', op: 'write',
    build: (p) => new AssetsController(p, stubStorage, {} as any, {} as any, {} as any),
    invoke: (c, req) => c.approve(req, 'asset-b'),
  },
  {
    name: 'assets: reject another tenant\'s pending asset',
    controller: AssetsController, handler: 'reject', op: 'write',
    build: (p) => new AssetsController(p, stubStorage, {} as any, {} as any, {} as any),
    invoke: (c, req) => c.reject(req, 'asset-b', {}),
  },
  {
    name: 'assets: move another tenant\'s asset',
    controller: AssetsController, handler: 'moveAsset', op: 'write',
    build: (p) => new AssetsController(p, stubStorage, {} as any, {} as any, {} as any),
    invoke: (c, req) => c.moveAsset(req, 'asset-b', { folderId: null }),
  },
  {
    name: 'assets: delete another tenant\'s asset',
    controller: AssetsController, handler: 'remove', op: 'delete',
    build: (p) => new AssetsController(p, stubStorage, {} as any, {} as any, {} as any),
    invoke: (c, req) => c.remove(req, 'asset-b'),
  },
  {
    name: 'assets: rename another tenant\'s folder',
    controller: AssetsController, handler: 'renameFolder', op: 'write',
    build: (p) => new AssetsController(p, stubStorage, {} as any, {} as any, {} as any),
    invoke: (c, req) => c.renameFolder(req, 'folder-b', { name: 'pwned' }),
  },
  {
    name: 'assets: delete another tenant\'s folder',
    controller: AssetsController, handler: 'deleteFolder', op: 'delete',
    build: (p) => new AssetsController(p, stubStorage, {} as any, {} as any, {} as any),
    invoke: (c, req) => c.deleteFolder(req, 'folder-b'),
  },

  // ── Templates ─────────────────────────────────────────────────────────
  {
    name: 'templates: read another tenant\'s template',
    controller: TemplatesController, handler: 'get', op: 'read',
    build: (p) => new TemplatesController(p, {} as any, {} as any, stubStorage),
    invoke: (c, req) => c.get(req, 'tpl-b'),
  },
  {
    name: 'templates: export another tenant\'s template',
    controller: TemplatesController, handler: 'exportTemplate', op: 'export',
    build: (p) => new TemplatesController(p, {} as any, {} as any, stubStorage),
    invoke: (c, req) => c.exportTemplate(req, 'tpl-b'),
  },
  {
    name: 'templates: duplicate another tenant\'s template into mine',
    controller: TemplatesController, handler: 'duplicate', op: 'read',
    build: (p) => new TemplatesController(p, {} as any, {} as any, stubStorage),
    invoke: (c, req) => c.duplicate(req, 'tpl-b', {}),
  },
  {
    name: 'templates: list another tenant\'s scenes',
    controller: TemplatesController, handler: 'listScenes', op: 'list',
    build: (p) => new TemplatesController(p, {} as any, {} as any, stubStorage),
    invoke: (c, req) => c.listScenes(req, 'tpl-b'),
  },
  {
    name: 'templates: update another tenant\'s template',
    controller: TemplatesController, handler: 'update', op: 'write',
    build: (p) => new TemplatesController(p, {} as any, {} as any, stubStorage),
    invoke: (c, req) => c.update(req, 'tpl-b', { name: 'pwned' }),
  },
  {
    name: 'templates: delete another tenant\'s template',
    controller: TemplatesController, handler: 'remove', op: 'delete',
    build: (p) => new TemplatesController(p, {} as any, {} as any, stubStorage),
    invoke: (c, req) => c.remove(req, 'tpl-b'),
  },

  // ── Playlists ─────────────────────────────────────────────────────────
  {
    name: 'playlists: read another tenant\'s playlist',
    controller: PlaylistsController, handler: 'get', op: 'read',
    build: (p) => new PlaylistsController(p, stubRedis, stubSigner, {} as any),
    invoke: (c, req) => c.get(req, 'pl-b'),
  },
  {
    name: 'playlists: list never includes another tenant\'s playlist',
    controller: PlaylistsController, handler: 'list', op: 'list',
    build: (p) => new PlaylistsController(p, stubRedis, stubSigner, {} as any),
    invoke: (c, req) => c.list(req),
  },
  {
    name: 'playlists: rename another tenant\'s playlist',
    controller: PlaylistsController, handler: 'update', op: 'write',
    build: (p) => new PlaylistsController(p, stubRedis, stubSigner, {} as any),
    invoke: (c, req) => c.update(req, 'pl-b', { name: 'pwned' }),
  },
  {
    name: 'playlists: delete another tenant\'s playlist',
    controller: PlaylistsController, handler: 'remove', op: 'delete',
    build: (p) => new PlaylistsController(p, stubRedis, stubSigner, {} as any),
    invoke: (c, req) => c.remove(req, 'pl-b'),
  },

  // ── Schedules ─────────────────────────────────────────────────────────
  {
    name: 'schedules: list never includes another tenant\'s schedule',
    controller: SchedulesController, handler: 'list', op: 'list',
    build: (p) => new SchedulesController(p, stubRedis, stubSigner, stubNotify),
    invoke: (c, req) => c.list(req),
  },
  {
    name: 'schedules: toggle another tenant\'s schedule on/off',
    controller: SchedulesController, handler: 'toggle', op: 'write',
    build: (p) => new SchedulesController(p, stubRedis, stubSigner, stubNotify),
    invoke: (c, req) => c.toggle(req, 'sch-b'),
  },
  {
    name: 'schedules: delete another tenant\'s schedule',
    controller: SchedulesController, handler: 'remove', op: 'delete',
    build: (p) => new SchedulesController(p, stubRedis, stubSigner, stubNotify),
    invoke: (c, req) => c.remove(req, 'sch-b'),
  },

  // ── Screen groups ─────────────────────────────────────────────────────
  {
    name: 'screen-groups: list never includes another tenant\'s group',
    controller: ScreenGroupsController, handler: 'list', op: 'list',
    build: (p) => new ScreenGroupsController(p, stubRedis, stubSigner),
    invoke: (c, req) => c.list(req),
  },
  {
    name: 'screen-groups: rename another tenant\'s group',
    controller: ScreenGroupsController, handler: 'update', op: 'write',
    build: (p) => new ScreenGroupsController(p, stubRedis, stubSigner),
    invoke: (c, req) => c.update(req, 'grp-b', { name: 'pwned' }),
  },
  {
    name: 'screen-groups: assign screens into another tenant\'s group',
    controller: ScreenGroupsController, handler: 'assignScreens', op: 'write',
    build: (p) => new ScreenGroupsController(p, stubRedis, stubSigner),
    invoke: (c, req) => c.assignScreens(req, 'grp-b', { screenIds: ['scr-b'] }),
  },
  {
    name: 'screen-groups: delete another tenant\'s group',
    controller: ScreenGroupsController, handler: 'remove', op: 'delete',
    build: (p) => new ScreenGroupsController(p, stubRedis, stubSigner),
    invoke: (c, req) => c.remove(req, 'grp-b'),
  },

  // ── Floor plans ───────────────────────────────────────────────────────
  {
    name: 'floor-plans: read another tenant\'s building layout',
    controller: FloorPlansController, handler: 'getOne', op: 'read',
    build: (p) => new FloorPlansController(p, stubStorage),
    invoke: (c, req) => c.getOne(req, 'fp-b'),
  },
  {
    name: 'floor-plans: list never includes another tenant\'s plan',
    controller: FloorPlansController, handler: 'list', op: 'list',
    build: (p) => new FloorPlansController(p, stubStorage),
    invoke: (c, req) => c.list(req),
  },
  {
    name: 'floor-plans: pin a screen onto another tenant\'s plan',
    controller: FloorPlansController, handler: 'placeScreen', op: 'write',
    build: (p) => new FloorPlansController(p, stubStorage),
    invoke: (c, req) => c.placeScreen(req, 'fp-b', 'scr-b', { floorX: 5, floorY: 5 }),
  },
  {
    name: 'floor-plans: detach a screen from another tenant\'s plan',
    controller: FloorPlansController, handler: 'detachScreen', op: 'write',
    build: (p) => new FloorPlansController(p, stubStorage),
    invoke: (c, req) => c.detachScreen(req, 'fp-b', 'scr-b'),
  },
  {
    name: 'floor-plans: delete another tenant\'s plan',
    controller: FloorPlansController, handler: 'remove', op: 'delete',
    build: (p) => new FloorPlansController(p, stubStorage),
    invoke: (c, req) => c.remove(req, 'fp-b'),
  },

  // ── Submissions (review queue) ────────────────────────────────────────
  {
    name: 'submissions: read another tenant\'s submission',
    controller: SubmissionsController, handler: 'get', op: 'read',
    build: (p) => new SubmissionsController(p, stubNotify),
    invoke: (c, req) => c.get(req, 'sub-b'),
  },
  {
    name: 'submissions: list never includes another tenant\'s submission',
    controller: SubmissionsController, handler: 'list', op: 'list',
    build: (p) => new SubmissionsController(p, stubNotify),
    invoke: (c, req) => c.list(req),
  },
  {
    name: 'submissions: approve another tenant\'s submission',
    controller: SubmissionsController, handler: 'approve', op: 'write',
    build: (p) => new SubmissionsController(p, stubNotify),
    invoke: (c, req) => c.approve(req, 'sub-b', {}),
  },
  {
    name: 'submissions: reject another tenant\'s submission',
    controller: SubmissionsController, handler: 'reject', op: 'write',
    build: (p) => new SubmissionsController(p, stubNotify),
    invoke: (c, req) => c.reject(req, 'sub-b', {}),
  },

  // ── Audit trail (read + EXPORT) ───────────────────────────────────────
  {
    name: 'audit: list another tenant\'s audit trail',
    controller: AuditController, handler: 'list', op: 'list',
    build: (p) => new AuditController(p),
    invoke: (c, req) => c.list(req),
  },
  {
    name: 'audit: EXPORT another tenant\'s audit trail as CSV',
    controller: AuditController, handler: 'exportCsv', op: 'export',
    build: (p) => new AuditController(p),
    invoke: async (c, req) => {
      let body = '';
      const res: any = {
        setHeader: () => undefined,
        status: () => res,
        send: (b: string) => { body = b; return res; },
        end: (b?: string) => { if (b) body = b; return res; },
      };
      await c.exportCsv(req, res);
      // The CSV is the payload — hand it back so the foreign-id scan sees it.
      return { csv: body, leakedForeignRow: body.includes('SECRET_ACTION_B') ? 'audit-b' : null };
    },
  },

  // ── Fleet pulse (a tenantId QUERY PARAM — the classic IDOR shape) ──────
  {
    name: 'fleet-pulse: re-root the fleet chart at another tenant via ?tenantId=',
    controller: FleetPulseController, handler: 'pulse', op: 'read',
    build: (p) => new FleetPulseController(p),
    invoke: (c, req) => c.pulse(req, '24', FOREIGN),
  },

  // ── Panic content (life-safety: what a screen shows during a lockdown) ─
  {
    name: 'panic-content: pull another tenant\'s asset into my lockdown board',
    controller: PanicContentController, handler: 'addAsset', op: 'write',
    build: (p) => new PanicContentController(p),
    invoke: (c, req) => c.addAsset(req, 'lockdown', { assetId: 'asset-b' }),
  },
  {
    name: 'panic-content: remove an item from another tenant\'s lockdown board',
    controller: PanicContentController, handler: 'removeAsset', op: 'delete',
    build: (p) => new PanicContentController(p),
    invoke: (c, req) => c.removeAsset(req, 'lockdown', 'pi-b'),
    // PlaylistItem has no tenantId column, so the route reads the row and its
    // parent playlist to decide — that read is the refusal mechanism.
    resolverReads: ['playlistItem'],
  },
];

/** Does the returned payload leak any foreign row? */
function containsForeignId(value: unknown, seen = new Set<unknown>()): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    if (/^(asset|tpl|pl|sch|scr|grp|fp|sub|folder|user|audit|pi|panic)-b$/.test(value)) return value;
    if (value.includes('SECRET_ACTION_B')) return 'audit-b';
    return null;
  }
  if (typeof value !== 'object') return null;
  if (seen.has(value)) return null;
  seen.add(value);
  for (const v of Object.values(value as Record<string, unknown>)) {
    const hit = containsForeignId(v, seen);
    if (hit) return hit;
  }
  return null;
}

describe('SEC-009 — two-tenant × every-role isolation matrix', () => {
  for (const c of MATRIX) {
    for (const role of ALL_ROLES) {
      it(`${role} of tenant A cannot ${c.name}`, async () => {
        const prisma = makeTwoTenantPrisma(dataset());
        const service: any = {
          client: prisma.client,
          ensurePlaylistMetadataColumns: async () => undefined,
        };
        const controller = c.build(service);
        const req: any = { ...actor(role), headers: {}, ip: '127.0.0.1' };

        let result: unknown;
        let threw = false;
        try {
          result = await c.invoke(controller, req);
        } catch (err: any) {
          threw = true;
          // A thrown UnsupportedWhereError means the double could not model the
          // query — that is a gap in the harness, never a pass.
          expect(err?.constructor?.name).not.toBe('UnsupportedWhereError');
        }

        const foreign = prisma.foreignTouches(HOME);

        // 1. A WRITE that landed on a foreign row is a breach, always.
        expect(
          foreign.filter((t) => t.isWrite).map((t) => `${t.model}.${t.method}(${t.rowId})`),
        ).toEqual([]);

        // 2. A READ of a foreign row is a leak unless this route declares that
        //    the read IS how it discovers it must refuse.
        const allowed = new Set(c.resolverReads ?? []);
        expect(
          foreign
            .filter((t) => !t.isWrite && !allowed.has(t.model))
            .map((t) => `${t.model}.${t.method}(${t.rowId})`),
        ).toEqual([]);

        // 3. Nothing belonging to tenant B may appear in the response — for a
        //    list route that means the foreign row is absent, not that the list
        //    is empty (the caller's own rows are supposed to be there).
        if (!threw) {
          expect(containsForeignId(result)).toBeNull();
        }
      });
    }

    it(`route metadata for "${c.name}" keeps RESTRICTED_VIEWER out of writes`, () => {
      const handler = (c.controller as any).prototype[c.handler];
      expect(typeof handler).toBe('function');
      const roles: AppRole[] | undefined = Reflect.getMetadata(ROLES_KEY, handler);
      if (c.op === 'write' || c.op === 'delete') {
        // Every mutating route in the matrix must declare its allowed roles and
        // must not hand a read-only viewer a write.
        expect(roles).toBeDefined();
        expect(roles).not.toContain(AppRole.RESTRICTED_VIEWER);
      }
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // COVERAGE GUARD — the table above must keep up with the codebase.
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Controllers that touch a tenant-owned model but are deliberately not in the
   * matrix. Every entry needs a REASON, and "we didn't get to it" is a valid
   * one as long as it is written down and dated — silence is what SEC-009 was
   * about.
   */
  const DOCUMENTED_GAPS: Record<string, string> = {
    // ── Owned by sibling remediation agents during the 2026-09-04 security
    //    wave. Editing them here would have collided with their work; they are
    //    also where every remaining tenant-isolation baseline entry now lives.
    'screens.controller.ts': 'SEC-009 2026-09-04: owned by a sibling agent this pass; 25 baseline entries remain there.',
    'sports.controller.ts': 'SEC-009 2026-09-04: sports/** owned by a sibling agent this pass; 49 baseline entries remain across that module.',
    'sports-board.controller.ts': 'SEC-009 2026-09-04: sports/** owned by a sibling agent this pass.',
    'proxy.controller.ts': 'SEC-009 2026-09-04: renderer/SSRF surface owned by a sibling agent this pass.',
    'mfa.controller.ts': 'SEC-009 2026-09-04: auth/** owned by a sibling agent this pass; MFA acts on the caller\'s OWN user row.',
    'auth.controller.ts': 'SEC-009 2026-09-04: auth/** owned by a sibling agent this pass; covered by auth/*.spec.ts.',
    'session.controller.ts': 'SEC-010 2026-09-05: there is no CALLER tenant to cross. /issue acts on the bearer\'s OWN user row; /refresh and /revoke are authenticated by an opaque refresh token whose row NAMES the user, and every field returned is read from that user\'s live row (the tenant is derived, never supplied). Rotation + reuse detection are covered by session-refresh.service.spec.ts.',
    'telemetry.controller.ts': 'SEC-009 2026-09-04: device telemetry ingest owned by a sibling agent this pass; no caller tenant.',

    // ── No caller tenant to cross: the principal is a device credential, a
    //    pairing code, a webhook secret or an unauthenticated public request,
    //    so the tenant is DERIVED from the row rather than compared against one.
    'gpio.controller.ts': 'Device token proves the screen; admin path 404s on tenant mismatch. See the ten-ok invariants at both call sites.',
    'notifications.controller.ts': 'Unauthenticated kiosk help button — the screen row IS the tenant resolver; silent ok for unknown screens.',
    'player-logs.controller.ts': 'Device-authenticated ingest. Cross-tenant cases live in player-logs.controller.spec.ts.',
    'player-ota.controller.ts': 'Unauthenticated fingerprint-keyed update check; writes only that screen\'s own OTA flag.',
    'devices.controller.ts': 'Pairing-code exchange only — the caller has no tenant yet; covered by devices/*.spec.ts.',
    'sse.controller.ts': 'Device/JWT stream auth; re-verifies the screen->tenant binding on connect (see realtime specs).',
    'display.controller.ts': 'Device-facing display manifest surface; covered by the display + manifest specs.',
    'display-schedules.controller.ts': 'Device-facing schedule surface; covered by the display + schedule-publish specs.',

    // ── Have their own dedicated cross-tenant suites already.
    'emergency.controller.ts': 'Dedicated suites: emergency.controller.spec.ts + emergency.device-scope.spec.ts.',
    'screen-emergency.controller.ts': 'Dedicated suite: emergency.device-scope.spec.ts.',
    'tenants.controller.ts': 'Dedicated suites: tenants.controller.spec.ts + usb-ingest-authz.spec.ts.',
    'users.controller.ts': 'Dedicated suite: users.controller.lifecycle.spec.ts.',
    'usb-export.controller.ts': 'Streams a ZIP to an express Response; asserted by usb-export.behavior.spec.ts (now including the tenant-scoped hash self-heal).',
    'bugs.controller.ts': 'Bug.tenantId is NULLABLE by design (SUPER_ADMIN triage of orphaned reports), so a two-tenant fixture models it wrongly; covered by the bugs specs.',

    // ── Not yet in the table. Dated so this is a queue, not a shrug.
    //    (SEC-009 follow-up, 2026-09-04.)
    'analytics.controller.ts': 'TODO 2026-09-04: reads go through prisma.groupBy, which this double stubs to [] — the assertion would be vacuous. Needs groupBy support in two-tenant-prisma first.',
    'branding.controller.ts': 'TODO 2026-09-04: brand-kit routes converted to compound tenant predicates this pass; matrix rows still owed (scraper + rate-limiter deps to stub).',
    'imports.controller.ts': 'TODO 2026-09-04: multipart design-import upload; needs a file fixture. Rows owed.',
    'sample-data.controller.ts': 'TODO 2026-09-04: seeds demo POS/streaming rows into the caller\'s OWN tenant; deletes converted to compound predicates this pass. Rows owed.',
    'ai-key.controller.ts': 'TODO 2026-09-04: BYOK provider-key surface. Rows owed; key handling itself is covered by the ai specs.',
    'super-license.controller.ts': 'TODO 2026-09-04: SUPER_ADMIN-only cross-tenant licensing surface — cross-tenant BY DESIGN, so the matrix needs an inverted expectation before it can be added.',
    'integrations-health.controller.ts': 'TODO 2026-09-04: aggregate health read across the caller\'s own integrations. Rows owed.',
  };

  it('every controller that touches a tenant-owned model is in the matrix or documented', () => {
    const SRC = path.resolve(__dirname, '..');
    const SCHEMA = path.resolve(__dirname, '../../../../packages/database/prisma/schema.prisma');
    const schema = fs.readFileSync(SCHEMA, 'utf8');
    const tenantModels = new Set<string>();
    const modelRe = /model\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\n\}/g;
    let m: RegExpExecArray | null;
    while ((m = modelRe.exec(schema)) !== null) {
      if (/\btenantId\b/.test(m[2])) tenantModels.add(m[1][0].toLowerCase() + m[1].slice(1));
    }
    expect(tenantModels.size).toBeGreaterThan(10);

    const controllers: string[] = [];
    (function walk(dir: string) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
          walk(abs);
        } else if (e.name.endsWith('.controller.ts')) {
          controllers.push(abs);
        }
      }
    })(SRC);
    expect(controllers.length).toBeGreaterThan(20);

    const covered = new Set(MATRIX.map((c) => (c.controller as any).name));
    const uncovered: string[] = [];
    for (const abs of controllers) {
      const base = path.basename(abs);
      const text = fs.readFileSync(abs, 'utf8');
      // Does it reach for a tenant-owned model at all?
      const touchesTenantModel = [...tenantModels].some((model) =>
        new RegExp(`\\.${model}\\.(findUnique|findFirst|findMany|update|updateMany|delete|deleteMany|upsert|create)\\b`).test(text),
      );
      if (!touchesTenantModel) continue;
      const classNames = [...text.matchAll(/export class ([A-Za-z0-9_]+)/g)].map((x) => x[1]);
      if (classNames.some((n) => covered.has(n))) continue;
      if (base in DOCUMENTED_GAPS) continue;
      uncovered.push(base);
    }

    expect(
      uncovered.sort(),
      // Jest prints the array; the message lives here so the failure explains itself.
    ).toEqual([]);
  });

  it('every documented gap names a real controller file', () => {
    const SRC = path.resolve(__dirname, '..');
    const found = new Set<string>();
    (function walk(dir: string) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
          walk(abs);
        } else if (e.name.endsWith('.controller.ts')) {
          found.add(e.name);
        }
      }
    })(SRC);
    const stale = Object.keys(DOCUMENTED_GAPS).filter((f) => !found.has(f));
    expect(stale).toEqual([]);
  });
});
