/**
 * SCHEDULE-PUBLISH → MANIFEST success path (controller-level integration).
 *
 * The #1 operator workflow: publish a playlist to a screen, and the screen's
 * device manifest must reflect that playlist's items. tests/e2e/
 * schedule-publish.spec.ts has all three meaningful Playwright tests .skip()-ed
 * ("requires seeded playlist + screen + live schedule API"), so nothing proved
 * publish→manifest works end-to-end. The 2026-06-27 launch-readiness audit
 * (02-DEEPWAVE2 Lane 3) flagged this as a [P1][NEEDS-FOLLOWUP].
 *
 * This is the no-live-server, no-network replacement. It drives the REAL
 * SchedulesController.create() publish path against an in-memory Prisma store
 * (seeded tenant + screen + playlist + items), then resolves the manifest by
 * replaying the EXACT schedule-resolution query the screens-controller manifest
 * runs (screens.controller.ts:2993-3037) and the same item→manifest-item
 * mapping (lines 3140-3156). It asserts:
 *   - the publish persists a single LIVE schedule binding the playlist to the
 *     screen (create() upsert semantics — no stale duplicates),
 *   - the resolver returns that playlist,
 *   - the manifest items match the playlist's items exactly (url, sequence,
 *     duration, mime_type, asset_id).
 *
 * WHY NOT call the manifest method directly? The manifest entrypoint lives in
 * apps/api/src/screens/screens.controller.ts (held in a separate review this
 * lane must not touch) and the schedule-resolution logic is inline in that
 * method — there is no standalone resolver service to call. So we exercise the
 * publish through the live SchedulesController and replay the manifest's exact
 * resolution semantics here. The resolver mirror is annotated with the source
 * line numbers so a future change to the manifest query is caught when this
 * test drifts. If the held controller is ever refactored to expose a real
 * resolver service, swap the mirror for a direct call.
 *
 * Test-only coverage of already-shipped behavior — no production code touched.
 */

import 'reflect-metadata';
import { AppRole } from '@cms/database';
import { SchedulesController } from './schedules.controller';

type ScheduleRow = {
  id: string;
  tenantId: string;
  playlistId: string;
  screenId: string | null;
  screenGroupId: string | null;
  isActive: boolean;
  priority: number;
  startTime: Date;
  endTime: Date | null;
  daysOfWeek: string | null;
  timeStart: string | null;
  timeEnd: string | null;
  mutedOverride: boolean | null;
  mode: string;
};

type AssetRow = { id: string; fileUrl: string; mimeType: string; fileHash: string | null; fileSize: number; status: string };
type ItemRow = { id: string; assetId: string; durationMs: number; sequenceOrder: number; transitionType: string | null; muted: boolean | null };
type PlaylistRow = { id: string; tenantId: string; name: string; items: ItemRow[] };
type ScreenRow = { id: string; tenantId: string; screenGroupId: string | null };

// ── In-memory store ────────────────────────────────────────────────────────
const TENANT = 't1';
const SCREEN: ScreenRow = { id: 'lobby-screen', tenantId: TENANT, screenGroupId: null };
const ASSETS: Record<string, AssetRow> = {
  a1: { id: 'a1', fileUrl: 'https://proj.supabase.co/storage/v1/object/public/media/welcome.jpg', mimeType: 'image/jpeg', fileHash: 'h1', fileSize: 100, status: 'PUBLISHED' },
  a2: { id: 'a2', fileUrl: 'https://proj.supabase.co/storage/v1/object/public/media/clip.mp4', mimeType: 'video/mp4', fileHash: 'h2', fileSize: 200, status: 'PUBLISHED' },
};
const PLAYLIST: PlaylistRow = {
  id: 'fall-promo',
  tenantId: TENANT,
  name: 'Fall Promo',
  items: [
    { id: 'i1', assetId: 'a1', durationMs: 8000, sequenceOrder: 0, transitionType: 'fade', muted: null },
    { id: 'i2', assetId: 'a2', durationMs: 15000, sequenceOrder: 1, transitionType: null, muted: false },
  ],
};

function scheduleWhereMatches(r: ScheduleRow, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (k === 'OR') {
      if (!(v as any[]).some((c) => scheduleWhereMatches(r, c))) return false;
      continue;
    }
    const rv = (r as any)[k];
    if (v && typeof v === 'object' && 'in' in (v as any)) {
      if (!(v as any).in.includes(rv)) return false;
      continue;
    }
    if (v === null) {
      if (rv !== null && rv !== undefined) return false;
      continue;
    }
    if (rv !== v) return false;
  }
  return true;
}

let seq = 0;

function makeController(scheduleRows: ScheduleRow[]) {
  const scheduleClient = {
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const r of scheduleRows) if (scheduleWhereMatches(r, where)) { Object.assign(r, data); count++; }
      return { count };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      let count = 0;
      for (let i = scheduleRows.length - 1; i >= 0; i--) {
        if (scheduleWhereMatches(scheduleRows[i], where)) { scheduleRows.splice(i, 1); count++; }
      }
      return { count };
    }),
    create: jest.fn(async ({ data }: any) => {
      const r: ScheduleRow = {
        id: 'sch-' + ++seq,
        tenantId: data.tenantId,
        playlistId: data.playlistId,
        screenId: data.screenId ?? null,
        screenGroupId: data.screenGroupId ?? null,
        isActive: data.isActive,
        priority: data.priority ?? 0,
        startTime: data.startTime,
        endTime: data.endTime ?? null,
        daysOfWeek: data.daysOfWeek ?? null,
        timeStart: data.timeStart ?? null,
        timeEnd: data.timeEnd ?? null,
        mutedOverride: data.mutedOverride ?? null,
        mode: data.mode ?? 'replace',
      };
      scheduleRows.push(r);
      return { ...r, playlist: { id: r.playlistId, name: PLAYLIST.name }, screenGroup: null, screen: { id: r.screenId, name: 'Lobby' } };
    }),
  };

  const prisma: any = {
    client: {
      schedule: scheduleClient,
      screen: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === SCREEN.id && where.tenantId === SCREEN.tenantId ? { id: SCREEN.id } : null,
        ),
        findMany: jest.fn().mockResolvedValue([]),
      },
      screenGroup: { findFirst: jest.fn().mockResolvedValue(null) },
      playlist: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === PLAYLIST.id && where.tenantId === PLAYLIST.tenantId ? { id: PLAYLIST.id } : null,
        ),
      },
      tenant: { findUnique: jest.fn().mockResolvedValue({ requireContentApproval: false }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      submission: { create: jest.fn().mockResolvedValue({ id: 'sub1' }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    },
  };

  const redis: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const signer: any = { signMessage: jest.fn().mockReturnValue('signed') };
  const notify: any = { notify: jest.fn().mockResolvedValue({}) };

  const controller = new SchedulesController(prisma, redis, signer, notify);
  return { controller, scheduleRows, prisma };
}

/**
 * Replay the screens-controller manifest's schedule-resolution + item mapping
 * against the same in-memory store. Mirrors:
 *   screens.controller.ts:2993-3037 (the active-schedule findMany query)
 *   screens.controller.ts:3140-3156 (item → manifest item)
 * Returns the manifest `playlists` array shape the player consumes.
 */
function resolveManifest(scheduleRows: ScheduleRow[], screen: ScreenRow, now: Date) {
  const targetOr = [{ screenId: screen.id }, ...(screen.screenGroupId ? [{ screenGroupId: screen.screenGroupId }] : [])];
  const matched = scheduleRows.filter(
    (s) =>
      s.tenantId === screen.tenantId &&
      targetOr.some((t) => scheduleWhereMatches(s, t)) &&
      s.startTime <= now &&
      (s.endTime === null || s.endTime >= now) &&
      s.isActive === true,
  );
  return matched.map((s) => {
    const pl = s.playlistId === PLAYLIST.id ? PLAYLIST : null;
    const items = (pl?.items ?? [])
      .filter((pi) => ASSETS[pi.assetId]?.status === 'PUBLISHED') // approval gate (line 3019)
      .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
      .map((pi) => {
        const asset = ASSETS[pi.assetId];
        return {
          item_id: pi.id,
          asset_id: pi.assetId,
          asset_hash: asset.fileHash ?? null,
          url: asset.fileUrl,
          duration_ms: pi.durationMs,
          sequence: pi.sequenceOrder,
          mime_type: asset.mimeType ?? null,
          transition_type: pi.transitionType ?? null,
        };
      });
    return { id: s.playlistId, name: pl?.name ?? '', items };
  });
}

const admin = { user: { id: 'a1', userId: 'a1', role: AppRole.SCHOOL_ADMIN, tenantId: TENANT } };

describe('SCHEDULE-PUBLISH → MANIFEST (publish a playlist to a screen, manifest reflects it)', () => {
  beforeEach(() => { seq = 0; });

  it('publishing a schedule binds the playlist to the screen and the manifest serves its items', async () => {
    const scheduleRows: ScheduleRow[] = [];
    const { controller } = makeController(scheduleRows);

    // Publish: bind playlist → screen, live now.
    const created = await controller.create(admin as any, {
      playlistId: PLAYLIST.id,
      screenId: SCREEN.id,
      startTime: '2026-06-01T00:00:00Z',
      mode: 'replace',
    } as any);

    // One LIVE schedule row persisted, bound to the right playlist + screen.
    expect((created as any).playlistId).toBe(PLAYLIST.id);
    const live = scheduleRows.filter((r) => r.isActive);
    expect(live).toHaveLength(1);
    expect(live[0].screenId).toBe(SCREEN.id);
    expect(live[0].playlistId).toBe(PLAYLIST.id);

    // Resolve the manifest the way the player's device fetch would.
    const playlists = resolveManifest(scheduleRows, SCREEN, new Date('2026-06-15T12:00:00Z'));

    expect(playlists).toHaveLength(1);
    expect(playlists[0].id).toBe(PLAYLIST.id);
    expect(playlists[0].name).toBe('Fall Promo');

    // The manifest items MUST match the playlist items exactly (ordered).
    expect(playlists[0].items).toEqual([
      { item_id: 'i1', asset_id: 'a1', asset_hash: 'h1', url: ASSETS.a1.fileUrl, duration_ms: 8000, sequence: 0, mime_type: 'image/jpeg', transition_type: 'fade' },
      { item_id: 'i2', asset_id: 'a2', asset_hash: 'h2', url: ASSETS.a2.fileUrl, duration_ms: 15000, sequence: 1, mime_type: 'video/mp4', transition_type: null },
    ]);
  });

  it('republishing the SAME playlist to the SAME screen stays a single live row (upsert, no duplicates)', async () => {
    // Regression guard for the 2026-05-05 "i selected 2 displays and it created
    // 4 schedules" bug — create() hard-deletes prior (playlist, target) rows so
    // a republish is a true upsert.
    const scheduleRows: ScheduleRow[] = [];
    const { controller } = makeController(scheduleRows);

    await controller.create(admin as any, {
      playlistId: PLAYLIST.id, screenId: SCREEN.id, startTime: '2026-06-01T00:00:00Z', mode: 'replace',
    } as any);
    await controller.create(admin as any, {
      playlistId: PLAYLIST.id, screenId: SCREEN.id, startTime: '2026-06-02T00:00:00Z', mode: 'replace',
    } as any);

    // Exactly one row for this (playlist, screen) — no stale duplicates.
    const forTarget = scheduleRows.filter((r) => r.playlistId === PLAYLIST.id && r.screenId === SCREEN.id);
    expect(forTarget).toHaveLength(1);
    expect(forTarget[0].isActive).toBe(true);

    // Manifest still resolves the playlist exactly once.
    const playlists = resolveManifest(scheduleRows, SCREEN, new Date('2026-06-15T12:00:00Z'));
    expect(playlists).toHaveLength(1);
    expect(playlists[0].items).toHaveLength(2);
  });

  it('a DRAFT (isActive:false) publish does NOT appear in the manifest', async () => {
    const scheduleRows: ScheduleRow[] = [];
    const { controller } = makeController(scheduleRows);

    await controller.create(admin as any, {
      playlistId: PLAYLIST.id, screenId: SCREEN.id, startTime: '2026-06-01T00:00:00Z', mode: 'replace', isActive: false,
    } as any);

    // Row exists but is a draft → manifest returns nothing for the screen.
    expect(scheduleRows).toHaveLength(1);
    expect(scheduleRows[0].isActive).toBe(false);
    const playlists = resolveManifest(scheduleRows, SCREEN, new Date('2026-06-15T12:00:00Z'));
    expect(playlists).toHaveLength(0);
  });

  it('a future-dated publish is not yet served (startTime > now)', async () => {
    const scheduleRows: ScheduleRow[] = [];
    const { controller } = makeController(scheduleRows);

    await controller.create(admin as any, {
      playlistId: PLAYLIST.id, screenId: SCREEN.id, startTime: '2026-12-25T00:00:00Z', mode: 'replace',
    } as any);

    // Live row, but its window hasn't opened yet for a mid-June poll.
    expect(scheduleRows.filter((r) => r.isActive)).toHaveLength(1);
    const playlists = resolveManifest(scheduleRows, SCREEN, new Date('2026-06-15T12:00:00Z'));
    expect(playlists).toHaveLength(0);
  });

  it('a group-target publish is served to a member screen via the manifest group resolver', async () => {
    const groupScreen: ScreenRow = { id: 'wall-1', tenantId: TENANT, screenGroupId: 'grpA' };
    const scheduleRows: ScheduleRow[] = [];
    const { controller, prisma } = makeController(scheduleRows);
    // group publish needs the ownership lookup + member resolution to succeed.
    prisma.client.screenGroup.findFirst.mockResolvedValue({ id: 'grpA' });
    prisma.client.screen.findMany.mockResolvedValue([{ id: 'wall-1' }]);

    await controller.create(admin as any, {
      playlistId: PLAYLIST.id, screenGroupId: 'grpA', startTime: '2026-06-01T00:00:00Z', mode: 'replace',
    } as any);

    const playlists = resolveManifest(scheduleRows, groupScreen, new Date('2026-06-15T12:00:00Z'));
    expect(playlists).toHaveLength(1);
    expect(playlists[0].id).toBe(PLAYLIST.id);
    expect(playlists[0].items).toHaveLength(2);
  });
});
