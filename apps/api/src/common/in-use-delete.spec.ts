/**
 * The in-use delete confirmation OVER REAL HTTP (2026-09-26).
 *
 * The controller specs (assets.usage.spec.ts, playlist-delete-go-dark.spec.ts)
 * call `remove()` directly, which skips the two things that only exist at the
 * HTTP layer and that the old-dashboard fix depends on:
 *
 *   1. `?confirm=in-use` reaches the handler through Nest's @Query binding.
 *   2. What the BROWSER receives. The production global AllExceptionsFilter
 *      reduces every error to `{ error, code, message }`, so without the
 *      method-scoped InUseDeleteConflictFilter the usage summary an older
 *      dashboard needs never leaves the server. And the scoping must be
 *      exact: the emergency refusals from the same handlers keep the normal
 *      envelope (their extra fields — screen names, playlist ids — stay
 *      server-side, as before).
 *
 * The REAL AssetsController and PlaylistsController are booted with the REAL
 * RbacGuard, the production global filter and a stand-in for JwtAuthGuard,
 * over an in-memory double of the rows they read.
 */
import 'reflect-metadata';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { EXCEPTION_FILTERS_METADATA } from '@nestjs/common/constants';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { EmailService } from '../email/email.service';
import { MediaOptimizationService } from '../storage/media-optimization.service';
import { AiAltTextService } from '../ai/ai-alt-text.service';
import { VideoPosterService } from '../storage/video-poster.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { PlaylistDistributionService } from '../playlists/playlist-distribution.service';
import { AssetsController } from '../assets/assets.controller';
import { PlaylistsController } from '../playlists/playlists.controller';
import { AllExceptionsFilter } from './all-exceptions.filter';
import {
  IN_USE_DELETE_CONFIRMATION,
  InUseDeleteConflictFilter,
  isInUseDeleteConfirmed,
} from './in-use-delete';

describe('isInUseDeleteConfirmed', () => {
  it('accepts exactly "in-use"', () => {
    expect(IN_USE_DELETE_CONFIRMATION).toBe('in-use');
    expect(isInUseDeleteConfirmed('in-use')).toBe(true);
  });

  it.each([undefined, null, '', 'true', '1', 'yes', 'IN-USE', 'in_use', ' in-use', ['in-use'], { confirm: 'in-use' }])(
    'refuses %p',
    (value) => {
      expect(isInUseDeleteConfirmed(value)).toBe(false);
    },
  );
});

describe('the two delete handlers carry the conflict filter', () => {
  it.each([
    ['AssetsController.remove', AssetsController.prototype.remove],
    ['PlaylistsController.remove', PlaylistsController.prototype.remove],
  ])('%s', (_name, handler) => {
    expect(Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, handler)).toEqual([InUseDeleteConflictFilter]);
  });
});

// ── the HTTP harness ─────────────────────────────────────────────────────────

const TENANT = 't1';

interface World {
  asset: { id: string; tenantId: string; fileUrl: string; mimeType: string } | null;
  items: Array<{ playlistId: string }>;
  playlists: Array<{ id: string; tenantId: string; name: string; templateId: string | null; isProtected: boolean; protectedKind?: string | null; sourcePlaylistId?: string | null }>;
  schedules: Array<{ id: string; tenantId: string; playlistId: string; screenId: string | null; screenGroupId: string | null; isActive: boolean }>;
  screens: Array<{ id: string; tenantId: string; screenGroupId: string | null }>;
  /** A tenant whose panic default is one of the playlists (emergency wiring). */
  panicTenant: { id: string } | null;
  audit: any[];
  deletedPlaylists: string[];
  deletedAssets: string[];
}

function world(over: Partial<World> = {}): World {
  return {
    asset: { id: 'a1', tenantId: TENANT, fileUrl: 'https://cdn.example.com/t1/a1.jpg', mimeType: 'image/jpeg' },
    items: [],
    playlists: [],
    schedules: [],
    screens: [],
    panicTenant: null,
    audit: [],
    deletedPlaylists: [],
    deletedAssets: [],
    ...over,
  };
}

const inIds = (clause: any, value: string | null) =>
  clause === undefined || (typeof clause === 'string' ? clause === value : !!value && clause.in.includes(value));

function scheduleMatches(s: World['schedules'][number], where: any = {}) {
  return (
    (where.tenantId === undefined || s.tenantId === where.tenantId) &&
    inIds(where.playlistId, s.playlistId) &&
    (where.isActive === undefined || s.isActive === where.isActive)
  );
}

/** The slice of Prisma the two handlers (and the usage summary) read and write. */
function prismaDouble(w: World) {
  const client: any = {
    asset: {
      findFirst: jest.fn(async ({ where }: any) => (w.asset && where.id === w.asset.id ? w.asset : null)),
      delete: jest.fn(async ({ where }: any) => { w.deletedAssets.push(where.id); return {}; }),
      count: jest.fn(async () => 0),
    },
    playlistItem: {
      findMany: jest.fn(async () => w.items),
      deleteMany: jest.fn(async () => { const count = w.items.length; w.items = []; return { count }; }),
      count: jest.fn(async () => 0),
    },
    playlist: {
      findFirst: jest.fn(async ({ where }: any) =>
        w.playlists.find((p) =>
          inIds(where.id, p.id) &&
          (where.tenantId === undefined || p.tenantId === where.tenantId) &&
          (where.isProtected === undefined || p.isProtected === where.isProtected),
        ) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        where.sourcePlaylistId
          ? w.playlists.filter((p) => p.sourcePlaylistId === where.sourcePlaylistId)
          : w.playlists.filter((p) => inIds(where.id, p.id)),
      ),
      delete: jest.fn(async ({ where }: any) => { w.deletedPlaylists.push(where.id); return {}; }),
    },
    schedule: {
      findMany: jest.fn(async ({ where }: any) => w.schedules.filter((s) => scheduleMatches(s, where))),
      findFirst: jest.fn(async ({ where }: any) => w.schedules.find((s) => scheduleMatches(s, where) && (!where.id || where.id.not !== s.id)) ?? null),
      deleteMany: jest.fn(async ({ where }: any) => {
        const before = w.schedules.length;
        w.schedules = w.schedules.filter((s) => !scheduleMatches(s, where));
        return { count: before - w.schedules.length };
      }),
      update: jest.fn(async () => ({})),
    },
    screen: {
      // Emergency probes (per-screen media URLs / per-screen emergency playlists): wired nowhere.
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async ({ where }: any) =>
        w.screens.filter((s) =>
          (where.OR ?? [where]).some((c: any) =>
            (c.id && inIds(c.id, s.id)) || (c.screenGroupId && inIds(c.screenGroupId, s.screenGroupId)),
          ),
        ),
      ),
    },
    tenant: { findFirst: jest.fn(async () => w.panicTenant) },
    screenEmergencyOverride: { findFirst: jest.fn(async () => null) },
    emergencyMessage: { findFirst: jest.fn(async () => null) },
    auditLog: { create: jest.fn(async ({ data }: any) => { w.audit.push(data); return data; }) },
    $transaction: jest.fn(async (fn: any) => fn(client)),
  };
  return { client, ensurePlaylistMetadataColumns: jest.fn(async () => undefined) };
}

/** Stands in for JwtAuthGuard: a school admin of TENANT. RbacGuard stays REAL. */
class TestSessionGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    ctx.switchToHttp().getRequest().user = { id: 'u1', tenantId: TENANT, schoolId: TENANT, role: AppRole.SCHOOL_ADMIN };
    return true;
  }
}

async function boot(w: World): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [AssetsController, PlaylistsController],
    providers: [
      { provide: PrismaService, useValue: prismaDouble(w) },
      { provide: SupabaseStorageService, useValue: { extractPath: () => null, delete: jest.fn(), publicUrlForPath: (p: string) => p } },
      { provide: EmailService, useValue: {} },
      { provide: MediaOptimizationService, useValue: {} },
      { provide: AiAltTextService, useValue: {} },
      { provide: VideoPosterService, useValue: {} },
      { provide: RedisService, useValue: { publish: jest.fn(async () => undefined) } },
      { provide: WebsocketSignerService, useValue: { signMessage: (type: string) => ({ type }) } },
      { provide: PlaylistDistributionService, useValue: {} },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(new TestSessionGuard())
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  // Exactly as main.ts registers it.
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

describe('DELETE /api/v1/assets/:id — over real HTTP', () => {
  let app: INestApplication | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  const inUse = () =>
    world({
      items: [{ playlistId: 'p1' }],
      playlists: [{ id: 'p1', tenantId: TENANT, name: 'Summer Strength', templateId: null, isProtected: false }],
      schedules: [{ id: 's1', tenantId: TENANT, playlistId: 'p1', screenId: 'scr1', screenGroupId: null, isActive: true }],
      screens: [{ id: 'scr1', tenantId: TENANT, screenGroupId: null }],
    });

  it('an old dashboard (no flag): 409 ASSET_IN_USE with the usage summary ON THE WIRE, and the asset stays', async () => {
    const w = inUse();
    app = await boot(w);
    const res = await request(app.getHttpServer()).delete('/api/v1/assets/a1');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: true,
      code: 'ASSET_IN_USE',
      message:
        'This asset is in 1 playlist reaching 1 screen, so it was not deleted. ' +
        'Refresh the page and delete it again to confirm, or remove it from those playlists first.',
      confirmQuery: 'confirm=in-use',
      usage: {
        playlists: [expect.objectContaining({ id: 'p1', name: 'Summer Strength', itemCount: 1, scheduled: true, screensReached: 1 })],
        totals: { playlists: 1, screensReached: 1, locations: 1 },
        protectedEmergency: false,
      },
    });
    expect(w.deletedAssets).toEqual([]);
    expect(w.items).toHaveLength(1);
    expect(w.audit).toEqual([]);
  });

  it('the dashboard after its in-use warning (?confirm=in-use): deleted, and audited as a confirmed in-use delete', async () => {
    const w = inUse();
    app = await boot(w);
    const res = await request(app.getHttpServer()).delete('/api/v1/assets/a1?confirm=in-use');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    expect(w.deletedAssets).toEqual(['a1']);
    const row = w.audit.find((a) => a.action === 'ASSET_DELETED');
    expect(JSON.parse(row.details)).toMatchObject({ confirmedInUse: true, removedPlaylistItems: 1 });
  });

  it('an unused asset deletes with no flag at all', async () => {
    const w = world();
    app = await boot(w);
    const res = await request(app.getHttpServer()).delete('/api/v1/assets/a1');
    expect(res.status).toBe(200);
    expect(w.deletedAssets).toEqual(['a1']);
  });

  it('emergency content is refused WITH the flag, in the normal envelope (no extra fields leave the server)', async () => {
    const w = inUse();
    w.panicTenant = { id: TENANT };
    app = await boot(w);
    const res = await request(app.getHttpServer()).delete('/api/v1/assets/a1?confirm=in-use');
    expect(res.status).toBe(409);
    expect(Object.keys(res.body).sort()).toEqual(['code', 'error', 'message']);
    expect(res.body.code).toBe('ASSET_IN_EMERGENCY_CONTENT');
    expect(w.deletedAssets).toEqual([]);
  });

  it('a protected emergency playlist is refused WITH the flag, in the normal envelope', async () => {
    const w = world({
      items: [{ playlistId: 'p9' }],
      playlists: [{ id: 'p9', tenantId: TENANT, name: 'Lockdown', templateId: null, isProtected: true, protectedKind: 'lockdown' }],
    });
    app = await boot(w);
    const res = await request(app.getHttpServer()).delete('/api/v1/assets/a1?confirm=in-use');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: true, code: 'ASSET_IN_PROTECTED_PLAYLIST', message: expect.any(String) });
    expect(w.deletedAssets).toEqual([]);
  });
});

describe('DELETE /api/v1/playlists/:id — over real HTTP', () => {
  let app: INestApplication | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  const published = () =>
    world({
      playlists: [
        { id: 'pl1', tenantId: TENANT, name: 'Member Promotions', templateId: null, isProtected: false },
        { id: 'pl1-copy', tenantId: 't2', name: 'Member Promotions', templateId: null, isProtected: false, sourcePlaylistId: 'pl1' },
      ],
      schedules: [
        { id: 's1', tenantId: TENANT, playlistId: 'pl1', screenId: null, screenGroupId: 'g1', isActive: true },
        { id: 's2', tenantId: 't2', playlistId: 'pl1-copy', screenId: 'scr9', screenGroupId: null, isActive: true },
      ],
      screens: [
        { id: 'scr1', tenantId: TENANT, screenGroupId: 'g1' },
        { id: 'scr2', tenantId: TENANT, screenGroupId: 'g1' },
        { id: 'scr9', tenantId: 't2', screenGroupId: null },
      ],
    });

  it('an old dashboard (no flag): 409 PLAYLIST_PUBLISHED with its reach ON THE WIRE, and nothing is deleted', async () => {
    const w = published();
    app = await boot(w);
    const res = await request(app.getHttpServer()).delete('/api/v1/playlists/pl1');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: true,
      code: 'PLAYLIST_PUBLISHED',
      message:
        '“Member Promotions” is still published (2 publishing rules · 3 screens · copies at 1 other location), ' +
        'so it was not deleted. Refresh the page and remove it again to confirm.',
      confirmQuery: 'confirm=in-use',
      reach: { rules: 2, screens: 3, locations: 2, copies: 1 },
    });
    expect(w.deletedPlaylists).toEqual([]);
    expect(w.schedules).toHaveLength(2);
    expect(w.audit).toEqual([]);
  });

  it('the dashboard after its published warning (?confirm=in-use): the playlist and its copy go, audited as confirmed', async () => {
    const w = published();
    app = await boot(w);
    const res = await request(app.getHttpServer()).delete('/api/v1/playlists/pl1?confirm=in-use');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    expect(w.deletedPlaylists.sort()).toEqual(['pl1', 'pl1-copy']);
    const rows = w.audit.filter((a) => a.action === 'PLAYLIST_DELETED');
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(JSON.parse(r.details).confirmedInUse).toBe(true);
  });

  it('an unpublished playlist deletes with no flag at all', async () => {
    const w = world({ playlists: [{ id: 'pl1', tenantId: TENANT, name: 'Draft', templateId: null, isProtected: false }] });
    app = await boot(w);
    const res = await request(app.getHttpServer()).delete('/api/v1/playlists/pl1');
    expect(res.status).toBe(200);
    expect(w.deletedPlaylists).toEqual(['pl1']);
  });

  it("emergency wiring is refused WITH the flag, in the normal envelope", async () => {
    const w = published();
    w.panicTenant = { id: TENANT };
    app = await boot(w);
    const res = await request(app.getHttpServer()).delete('/api/v1/playlists/pl1?confirm=in-use');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: true, code: 'PLAYLIST_IN_EMERGENCY_USE', message: expect.any(String) });
    expect(w.deletedPlaylists).toEqual([]);
  });

  it('a protected playlist is refused WITH the flag (403), in the normal envelope', async () => {
    const w = world({
      playlists: [{ id: 'pl1', tenantId: TENANT, name: 'Lockdown', templateId: null, isProtected: true, protectedKind: 'lockdown' }],
    });
    app = await boot(w);
    const res = await request(app.getHttpServer()).delete('/api/v1/playlists/pl1?confirm=in-use');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: true, code: 'PLAYLIST_PROTECTED', message: expect.any(String) });
    expect(w.deletedPlaylists).toEqual([]);
  });
});
