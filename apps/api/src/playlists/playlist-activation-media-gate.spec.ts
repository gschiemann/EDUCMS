/**
 * THE INVARIANT (2026-09-26): every path that makes a Schedule row active goes
 * through MediaPublicationService.prepare first.
 *
 * POST /schedules and the approval path already did. The three doors here did
 * not — "Play everywhere" (PUT /playlists/:id/active), the per-screen switch
 * (PUT /playlists/:id/screens/:screenId/active) and the fleet publish
 * (PlaylistDistributionService) switched rules straight on, so a paused 1080p
 * screen was handed the 4K original again. The product rule behind all of it
 * (Greg, 2026-09-26): renditions exist only so a 1080p SCREEN gets its
 * right-sized file; a bigger screen never plays a lower-resolution stand-in.
 *
 * These drive the REAL controller / service AND the REAL MediaPublicationService
 * (its sweep included) over one in-memory database with real filter semantics,
 * so each door is proven three ways: the rule is HELD (pending, not active, a
 * copy queued), the SWEEP activates it once the copy exists, and the refusals
 * that already existed still hold. Asserting mock call shapes would not have
 * caught a door that skipped the gate — this asserts what the screens get.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { PlaylistsController } from './playlists.controller';
import { PlaylistDistributionService } from './playlist-distribution.service';
import { MediaPublicationService } from '../schedules/media-publication.service';
import { MediaOptimizationService } from '../storage/media-optimization.service';

type Row = Record<string, any>;

const PUBLIC = 'https://example.com/storage/v1/object/public/assets/';
const T1 = 't1';
const CHILD = 'c1';
const req = { user: { id: 'u1', tenantId: T1 } };

/** Prisma-shaped filter: equality, {not}, {in}, {notIn}, {contains}, OR, AND, and the one relation filter used here. */
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
    if (k === 'AND') return (v as Row[]).every((w) => matches(row, w));
    if (k === 'tenant') return row.tenantParentId === (v as Row).parentId;
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('not' in v) return row[k] !== v.not;
      if ('in' in v) return (v.in as any[]).includes(row[k]);
      if ('notIn' in v) return !(v.notIn as any[]).includes(row[k]);
      if ('contains' in v) return String(row[k] ?? '').includes(v.contains);
    }
    return (row[k] ?? null) === (v ?? null);
  });
}

let seq = 0;
const rule = (over: Row): Row => ({
  id: `r${++seq}`,
  tenantId: T1,
  playlistId: 'P',
  screenId: null,
  screenGroupId: null,
  startTime: new Date('2026-09-01T00:00:00Z'),
  endTime: null,
  daysOfWeek: null,
  timeStart: null,
  timeEnd: null,
  priority: 0,
  mode: 'replace',
  mutedOverride: null,
  isActive: false,
  pendingMedia: false,
  pendingMediaError: null,
  ...over,
});

const V4K = {
  id: 'v4k', tenantId: T1, mimeType: 'video/mp4', fileUrl: `${PUBLIC}${T1}/4k.mp4`, fileSize: 141_000_000,
  fileHash: 'c'.repeat(64), processingMeta: { processedDimensions: { w: 3840, h: 2160 } } as Row | null,
};
const RENDITION = { url: `${PUBLIC}${T1}/optimized/renditions/1080.mp4`, sha256: 'a'.repeat(64), size: 40_000_000 };

interface World {
  schedules: Row[];
  screens: Row[];
  groups: Row[];
  playlists: Row[];
  items: Row[];
  assets: Row[];
  jobs: Row[];
  audit: Row[];
  submissions: Row[];
  tenants: Row[];
}

function makeWorld(opts: { schedules?: Row[]; assets?: Row[]; playlists?: Row[]; items?: Row[]; screens?: Row[] } = {}): World {
  return {
    schedules: (opts.schedules ?? []).map((s) => ({ ...s })),
    screens: opts.screens ?? [
      { id: 'lcd', tenantId: T1, name: 'Lobby LCD', resolution: '1920x1080', screenGroupId: null },
      { id: 'wall', tenantId: T1, name: '4K wall', resolution: '3840x2160', screenGroupId: null },
      { id: 'g1', tenantId: T1, name: 'Hall 1', resolution: '1920 x 1080', screenGroupId: 'G' },
      { id: 'g2', tenantId: T1, name: 'Hall 2', resolution: '3840x2160', screenGroupId: 'G' },
      { id: 'c-lcd', tenantId: CHILD, name: 'Store LCD', resolution: '1920x1080', screenGroupId: null },
      { id: 'c-wall', tenantId: CHILD, name: 'Store wall', resolution: '3840x2160', screenGroupId: null },
    ],
    groups: [{ id: 'G', tenantId: T1, name: 'Hallway' }],
    playlists: opts.playlists ?? [
      { id: 'P', tenantId: T1, name: 'Promo 4K', isProtected: false, protectedKind: null, sourcePlaylistId: null, templateId: null, template: null },
    ],
    items: opts.items ?? [{ id: 'i1', playlistId: 'P', assetId: 'v4k', sequenceOrder: 0, durationMs: 10_000 }],
    assets: (opts.assets ?? [V4K]).map((a) => ({ ...a, processingMeta: a.processingMeta ? { ...a.processingMeta } : a.processingMeta })),
    jobs: [],
    audit: [],
    submissions: [],
    tenants: [{ id: CHILD, name: 'Store 1', parentId: T1, archivedAt: null }, { id: T1, name: 'HQ', parentId: null, archivedAt: null }],
  };
}

function makeClient(w: World) {
  const withRelations = (s: Row, include?: Row) => {
    if (!include) return { ...s };
    const out: Row = { ...s };
    if (include.playlist) {
      const p = w.playlists.find((x) => x.id === s.playlistId);
      out.playlist = p ? { ...p, items: w.items.filter((i) => i.playlistId === p.id).map((i) => ({ ...i, asset: w.assets.find((a) => a.id === i.assetId) })) } : null;
    }
    if (include.screen) out.screen = w.screens.find((x) => x.id === s.screenId) ?? null;
    if (include.screenGroup) {
      const g = w.groups.find((x) => x.id === s.screenGroupId);
      out.screenGroup = g ? { ...g, screens: w.screens.filter((x) => x.screenGroupId === g.id) } : null;
    }
    return out;
  };
  const client: any = {
    playlist: {
      findFirst: jest.fn(async ({ where, include }: any) => {
        const p = w.playlists.find((x) => matches(x, where));
        if (!p) return null;
        return include?.items
          ? { ...p, items: w.items.filter((i) => i.playlistId === p.id).map((i) => ({ ...i, asset: w.assets.find((a) => a.id === i.assetId) })) }
          : { ...p };
      }),
      findMany: jest.fn(async ({ where }: any) => w.playlists.filter((x) => matches(x, where)).map((x) => ({ ...x }))),
      create: jest.fn(async ({ data }: any) => {
        const items = data.items?.create ?? [];
        const created = { id: `pl${++seq}`, ...data, items: undefined };
        delete created.items;
        w.playlists.push(created);
        for (const it of items) w.items.push({ id: `i${++seq}`, playlistId: created.id, ...it });
        return { id: created.id };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const p = w.playlists.find((x) => matches(x, where));
        if (!p) throw new Error('playlist not found');
        const items = data.items?.create ?? [];
        for (const it of items) w.items.push({ id: `i${++seq}`, playlistId: p.id, ...it });
        return { ...p };
      }),
    },
    playlistItem: {
      deleteMany: jest.fn(async ({ where }: any) => {
        const before = w.items.length;
        for (let i = w.items.length - 1; i >= 0; i--) if (matches(w.items[i], where)) w.items.splice(i, 1);
        return { count: before - w.items.length };
      }),
    },
    tenant: {
      findMany: jest.fn(async ({ where }: any) => w.tenants.filter((x) => matches(x, where)).map((x) => ({ id: x.id, name: x.name }))),
      findUnique: jest.fn(async ({ where }: any) => w.tenants.find((x) => x.id === where.id) ?? null),
    },
    screen: {
      findFirst: jest.fn(async ({ where }: any) => w.screens.find((s) => matches(s, where)) ?? null),
      findMany: jest.fn(async ({ where }: any) => w.screens.filter((s) => matches(s, where)).map((s) => ({ ...s }))),
    },
    screenGroup: { findFirst: jest.fn(async ({ where }: any) => w.groups.find((g) => matches(g, where)) ?? null) },
    submission: { findFirst: jest.fn(async ({ where }: any) => w.submissions.find((s) => matches(s, where)) ?? null) },
    asset: {
      findFirst: jest.fn(async ({ where }: any) => w.assets.find((a) => matches(a, where)) ?? null),
      findMany: jest.fn(async ({ where }: any) => w.assets.filter((a) => matches(a, where)).map((a) => ({ ...a }))),
      create: jest.fn(async ({ data }: any) => { const a = { id: `a${++seq}`, ...data }; w.assets.push(a); return { id: a.id }; }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hits = w.assets.filter((a) => matches(a, where));
        for (const a of hits) Object.assign(a, data);
        return { count: hits.length };
      }),
    },
    schedule: {
      findMany: jest.fn(async ({ where, include, orderBy }: any) => {
        const hits = w.schedules.filter((r) => matches(r, where)).map((r) => withRelations(r, include));
        if (orderBy?.startTime) hits.sort((a, b) => (+new Date(a.startTime) - +new Date(b.startTime)) * (orderBy.startTime === 'asc' ? 1 : -1));
        return hits;
      }),
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        const hits = w.schedules.filter((r) => matches(r, where));
        if (orderBy) hits.sort((a, b) => b.priority - a.priority || +new Date(b.startTime) - +new Date(a.startTime));
        return hits[0] ? { ...hits[0] } : null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const r = w.schedules.find((x) => matches(x, where));
        if (!r) throw new Error(`update: row not found for ${JSON.stringify(where)}`);
        Object.assign(r, data);
        return { ...r };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hits = w.schedules.filter((x) => matches(x, where));
        for (const r of hits) Object.assign(r, data);
        return { count: hits.length };
      }),
      create: jest.fn(async ({ data }: any) => {
        const r = rule({ ...data });
        w.schedules.push(r);
        return { ...r };
      }),
      createMany: jest.fn(async ({ data }: any) => {
        for (const d of data) w.schedules.push(rule({ ...d }));
        return { count: data.length };
      }),
      delete: jest.fn(async ({ where }: any) => {
        const i = w.schedules.findIndex((x) => matches(x, where));
        if (i < 0) throw new Error(`delete: row not found for ${JSON.stringify(where)}`);
        return w.schedules.splice(i, 1)[0];
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const before = w.schedules.length;
        for (let i = w.schedules.length - 1; i >= 0; i--) if (matches(w.schedules[i], where)) w.schedules.splice(i, 1);
        return { count: before - w.schedules.length };
      }),
    },
    videoTranscodeJob: {
      findMany: jest.fn(async ({ where }: any) => w.jobs.filter((j) => matches(j, where)).map((j) => ({ ...j }))),
      findFirst: jest.fn(async ({ where }: any) => w.jobs.find((j) => matches(j, where)) ?? null),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => { w.audit.push(data); return data; }) },
  };
  client.$transaction = jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg)));
  return client;
}

function harness(w: World, opts: { queueFails?: boolean } = {}) {
  const client = makeClient(w);
  const prisma = { client, ensurePlaylistMetadataColumns: jest.fn(async () => undefined) } as any;
  // The transcode queue, as the real one behaves: one job per (tenant, asset),
  // a finished job is re-queued on demand.
  const jobs = {
    enqueueForRendition: jest.fn(async ({ tenantId, assetId, sourceUrl }: any) => {
      if (opts.queueFails) return false;
      const existing = w.jobs.find((j) => j.tenantId === tenantId && j.assetId === assetId);
      if (!existing) w.jobs.push({ id: `job${++seq}`, tenantId, assetId, sourceUrl, status: 'queued', reason: null });
      else if (['done', 'skipped', 'failed'].includes(existing.status)) { existing.status = 'queued'; existing.reason = null; }
      return true;
    }),
  };
  const storage = {
    extractPath: (url: string) => (url.startsWith(PUBLIC) ? url.slice(PUBLIC.length) : null),
    publicUrlForPath: (p: string) => `${PUBLIC}${p}`,
    download: jest.fn(), upload: jest.fn().mockResolvedValue('url'), delete: jest.fn(),
  };
  const signer = { signMessage: jest.fn((type: string) => `signed-${type}`) };
  const redis = { publish: jest.fn().mockResolvedValue(undefined) };
  const service = new MediaPublicationService(prisma, jobs as any, redis as any, signer as any, storage as any, new MediaOptimizationService());
  (service as any).lastLegacyBackfillAt = Date.now(); // pending publications only; not the 15-minute legacy scan
  const distribution = new PlaylistDistributionService(prisma, service);
  const controller = new PlaylistsController(prisma, redis as any, signer as any, distribution, service);
  const notifySync = jest.fn();
  (controller as any).notifySync = notifySync;
  return { client, service, distribution, controller, jobs, redis, signer, notifySync, w };
}

/** Simulate the encoder finishing: the copy exists on the asset row and the job is terminal. */
function renditionLands(w: World, assetId: string, tenantId = T1) {
  const asset = w.assets.find((a) => a.id === assetId)!;
  asset.processingMeta = { ...(asset.processingMeta ?? {}), renditions: { '1080p': RENDITION } };
  const job = w.jobs.find((j) => j.assetId === assetId && j.tenantId === tenantId);
  if (job) { job.status = 'done'; job.reason = 'rendition-created'; }
}

const byId = (w: World, id: string) => w.schedules.find((r) => r.id === id)!;
const code = async (p: Promise<unknown>) => {
  try { await p; return 'NO THROW'; } catch (e) { return ((e as HttpException).getResponse() as any).code; }
};

beforeEach(() => { seq = 0; });

// ─────────────────────────────────────────────────────────────────────
describe('PUT /playlists/:id/active — "Play everywhere"', () => {
  const parkedFleet = () => [
    rule({ id: 'r-lcd', screenId: 'lcd' }),
    rule({ id: 'r-wall', screenId: 'wall' }),
    rule({ id: 'r-group', screenGroupId: 'G' }),
  ];

  it('holds the rules whose screens need a 1080p copy and switches the rest on', async () => {
    const h = harness(makeWorld({ schedules: parkedFleet() }));
    const res = await h.controller.setActive(req as any, 'P', { active: true } as any);

    // The 4K wall plays its native file NOW; nothing is queued for it.
    expect(byId(h.w, 'r-wall')).toMatchObject({ isActive: true, pendingMedia: false });
    // The 1080p LCD, and the group that CONTAINS a 1080p screen, wait for the copy.
    expect(byId(h.w, 'r-lcd')).toMatchObject({ isActive: false, pendingMedia: true, pendingMediaError: null });
    expect(byId(h.w, 'r-group')).toMatchObject({ isActive: false, pendingMedia: true, pendingMediaError: null });
    // One copy for the one asset, however many rules wait on it.
    expect(h.w.jobs).toEqual([expect.objectContaining({ tenantId: T1, assetId: 'v4k', status: 'queued' })]);
    expect(res).toMatchObject({ count: 1, active: true, heldForPlaybackCopy: 2 });
    const audit = h.w.audit.find((a) => a.action === 'PLAYLIST_SCHEDULES_TOGGLED')!;
    expect(JSON.parse(audit.details)).toMatchObject({ active: true, scheduleCount: 1, heldForPlaybackCopy: 2 });
    expect(h.notifySync).toHaveBeenCalledWith(T1);
  });

  it('the sweep publishes a held rule once its copy exists — displacing what that screen was showing', async () => {
    const h = harness(makeWorld({ schedules: [
      ...parkedFleet(),
      // What the LCD shows meanwhile: another playlist, live. Held rules keep it
      // on glass until the copy is ready, then take over like a fresh publish.
      rule({ id: 'q-lcd', playlistId: 'Q', screenId: 'lcd', isActive: true }),
    ] }));
    await h.controller.setActive(req as any, 'P', { active: true } as any);
    expect(byId(h.w, 'q-lcd').isActive).toBe(true);

    await h.service.sweep();                       // copy not there yet: nothing moves
    expect(byId(h.w, 'r-lcd')).toMatchObject({ isActive: false, pendingMedia: true });
    expect(h.redis.publish).not.toHaveBeenCalled();

    renditionLands(h.w, 'v4k');
    await h.service.sweep();
    expect(byId(h.w, 'r-lcd')).toMatchObject({ isActive: true, pendingMedia: false, pendingMediaError: null });
    expect(byId(h.w, 'r-group')).toMatchObject({ isActive: true, pendingMedia: false });
    expect(byId(h.w, 'q-lcd').isActive).toBe(false);
    expect(h.w.audit.filter((a) => a.action === 'SCHEDULE_MEDIA_READY_PUBLISHED')).toHaveLength(2);
    expect(h.redis.publish).toHaveBeenCalledWith(`tenant:${T1}`, 'signed-SYNC');
  });

  it('a screen that already has the copy is not held at all', async () => {
    const w = makeWorld({ schedules: parkedFleet(), assets: [{ ...V4K, processingMeta: { ...V4K.processingMeta, renditions: { '1080p': RENDITION } } }] });
    const h = harness(w);
    const res = await h.controller.setActive(req as any, 'P', { active: true } as any);
    expect(h.w.schedules.every((r) => r.isActive && !r.pendingMedia)).toBe(true);
    expect(h.w.jobs).toEqual([]);
    expect(res).toMatchObject({ count: 3, heldForPlaybackCopy: 0 });
  });

  it('a 1080p video needs no copy: nothing is held, nothing is queued', async () => {
    const w = makeWorld({ schedules: parkedFleet(), assets: [{ ...V4K, processingMeta: { processedDimensions: { w: 1920, h: 1080 } } }] });
    const h = harness(w);
    await h.controller.setActive(req as any, 'P', { active: true } as any);
    expect(h.w.schedules.every((r) => r.isActive && !r.pendingMedia)).toBe(true);
    expect(h.w.jobs).toEqual([]);
  });

  it('REFUSALS KEPT: no active-true while a copy is pending; a failed copy says so; nothing is written', async () => {
    const h = harness(makeWorld({ schedules: parkedFleet() }));
    await h.controller.setActive(req as any, 'P', { active: true } as any);
    const snapshot = JSON.stringify(h.w.schedules);
    expect(await code(h.controller.setActive(req as any, 'P', { active: true } as any))).toBe('PLAYBACK_COPY_PENDING');
    expect(JSON.stringify(h.w.schedules)).toBe(snapshot);

    byId(h.w, 'r-lcd').pendingMediaError = 'A playback copy could not be prepared. Retry publishing this playlist.';
    expect(await code(h.controller.setActive(req as any, 'P', { active: true } as any))).toBe('PLAYBACK_COPY_FAILED');
  });

  it('turning the playlist off cancels the pending publish — the sweep never revives it', async () => {
    const h = harness(makeWorld({ schedules: parkedFleet() }));
    await h.controller.setActive(req as any, 'P', { active: true } as any);
    await h.controller.setActive(req as any, 'P', { active: false } as any);
    expect(h.w.schedules.every((r) => !r.isActive && !r.pendingMedia && r.pendingMediaError === null)).toBe(true);
    renditionLands(h.w, 'v4k');
    await h.service.sweep();
    expect(h.w.schedules.every((r) => !r.isActive)).toBe(true);
    expect(h.redis.publish).not.toHaveBeenCalled();
  });

  it('a copy that cannot be queued refuses the whole request and changes nothing', async () => {
    const h = harness(makeWorld({ schedules: parkedFleet() }), { queueFails: true });
    const snapshot = JSON.stringify(h.w.schedules);
    expect(await code(h.controller.setActive(req as any, 'P', { active: true } as any))).toBe('VIDEO_PLAYBACK_COPY_QUEUE_FAILED');
    expect(JSON.stringify(h.w.schedules)).toBe(snapshot);
    expect(h.w.audit).toHaveLength(0);
  });

  describe('the cascade to fleet copies asks the same question in each location', () => {
    const childWorld = (ownerMeta: Row | null = V4K.processingMeta) => makeWorld({
      schedules: [
        rule({ id: 'r-wall', screenId: 'wall' }),
        rule({ id: 'cr-lcd', tenantId: CHILD, playlistId: 'CP', screenId: 'c-lcd' }),
        rule({ id: 'cr-wall', tenantId: CHILD, playlistId: 'CP', screenId: 'c-wall' }),
      ],
      playlists: [
        { id: 'P', tenantId: T1, name: 'Promo 4K', isProtected: false, sourcePlaylistId: null },
        { id: 'CP', tenantId: CHILD, tenantParentId: T1, name: 'Promo 4K', isProtected: false, sourcePlaylistId: 'P' },
      ],
      items: [
        { id: 'i1', playlistId: 'P', assetId: 'v4k' },
        { id: 'i2', playlistId: 'CP', assetId: 'cv' },
      ],
      assets: [
        { ...V4K, processingMeta: ownerMeta },
        // The child's copy: the same file, no facts of its own (ensureChildAsset never copied any).
        { ...V4K, id: 'cv', tenantId: CHILD, processingMeta: null },
      ],
    });

    it('holds the child\'s 1080p screen with a copy queued IN THE CHILD, and starts its 4K screen', async () => {
      const h = harness(childWorld());
      const res = await h.controller.setActive(req as any, 'P', { active: true } as any);
      expect(byId(h.w, 'cr-wall')).toMatchObject({ isActive: true, pendingMedia: false });
      expect(byId(h.w, 'cr-lcd')).toMatchObject({ isActive: false, pendingMedia: true });
      expect(h.w.jobs).toEqual([expect.objectContaining({ tenantId: CHILD, assetId: 'cv', status: 'queued' })]);
      expect(res).toMatchObject({ cascadedLocations: 1, cascadedSchedules: 1, cascadedHeldForPlaybackCopy: 1 });
      expect(h.notifySync).toHaveBeenCalledWith(CHILD);

      renditionLands(h.w, 'cv', CHILD);
      await h.service.sweep();
      expect(byId(h.w, 'cr-lcd')).toMatchObject({ isActive: true, pendingMedia: false });
      expect(h.redis.publish).toHaveBeenCalledWith(`tenant:${CHILD}`, 'signed-SYNC');
    });

    it('adopts the owner\'s copy when HQ already has one — the child needs no job and starts now', async () => {
      const h = harness(childWorld({ ...V4K.processingMeta, renditions: { '1080p': RENDITION } }));
      await h.controller.setActive(req as any, 'P', { active: true } as any);
      expect(byId(h.w, 'cr-lcd')).toMatchObject({ isActive: true, pendingMedia: false });
      expect(h.w.jobs).toEqual([]);
      expect(h.w.assets.find((a) => a.id === 'cv')!.processingMeta.renditions['1080p']).toEqual(RENDITION);
    });

    it('turning off cancels the child\'s pending publish too', async () => {
      const h = harness(childWorld());
      await h.controller.setActive(req as any, 'P', { active: true } as any);
      await h.controller.setActive(req as any, 'P', { active: false } as any);
      expect(byId(h.w, 'cr-lcd')).toMatchObject({ isActive: false, pendingMedia: false });
    });
  });
});
