import { HttpException, HttpStatus } from '@nestjs/common';
import { PlaylistsController } from './playlists.controller';

/**
 * Playlists Operations v1 (2026-08-31) — the two reads the redesigned
 * library rides:
 *   - /playlists/summary: calendar-honest scheduleState + reach, no item
 *     graphs. 'summary' is declared ABOVE @Get(':id') (param-swallow
 *     lesson).
 *   - /playlists/:id/delivery: acknowledgement truth comes from the
 *     durable 'refresh-acked' ScreenEvent (the clear IS the ack — no
 *     persisted ack column exists), matched by exact valueMs. The word
 *     "confirmed" appears nowhere: no expected-signature comparison
 *     exists yet.
 */

function makeController(over: Partial<Record<string, any>> = {}) {
  const prisma: any = {
    client: {
      playlist: {
        findMany: jest.fn(async () => over.playlists ?? []),
        findFirst: jest.fn(async () => over.playlist ?? null),
      },
      playlistItem: {
        groupBy: jest.fn(async () => over.durations ?? []),
      },
      schedule: { findMany: jest.fn(async () => over.schedules ?? []) },
      screen: {
        findMany: jest.fn(async ({ where }: any) => {
          if (where.screenGroupId) return (over.groupScreens ?? []).filter((s: any) => where.screenGroupId.in.includes(s.screenGroupId));
          if (where.id) return (over.screens ?? []).filter((s: any) => where.id.in.includes(s.id));
          return [];
        }),
      },
      deployment: { findMany: jest.fn(async () => over.deployments ?? []) },
      screenEvent: { findMany: jest.fn(async () => over.ackEvents ?? []) },
      tenant: { findMany: jest.fn(async () => over.tenants ?? []) },
    },
    ensurePlaylistMetadataColumns: jest.fn(async () => {}),
  };
  const controller = Object.create(PlaylistsController.prototype) as PlaylistsController;
  (controller as any).prisma = prisma;
  return { controller, prisma };
}

const req = { user: { tenantId: 't1', id: 'u1', role: 'SCHOOL_ADMIN' } } as any;

const basePlaylist = (over: any = {}) => ({
  id: 'p1', name: 'Member Promotions', templateId: null, sourcePlaylistId: null,
  updatedAt: new Date('2026-08-31T12:00:00Z'),
  template: null, createdBy: { email: 'op@x.com' },
  _count: { items: 6, schedules: 1 },
  items: [{ asset: { fileUrl: 'https://x/a.jpg', mimeType: 'image/jpeg' } }],
  ...over,
});

describe('GET /playlists/summary — scheduleState machine', () => {
  it('an enabled schedule covering now with a pinned target is ACTIVE with reach', async () => {
    const { controller } = makeController({
      playlists: [basePlaylist()],
      schedules: [{
        playlistId: 'p1', isActive: true, screenId: 's1', screenGroupId: null,
        startTime: new Date(Date.now() - 86400_000), endTime: null,
        daysOfWeek: null, timeStart: null, timeEnd: null,
      }],
      screens: [{ id: 's1', tenantId: 't1' }],
    });
    const out: any = await controller.summary(req);
    const row = out.playlists[0];
    expect(row.scheduleState).toBe('ACTIVE');
    expect(row.reach).toEqual({ screens: 1, groups: 0, locations: 1 });
    expect(row.scheduleSummary).toBe('Always');
    expect(row.thumbnailUrl).toBe('https://x/a.jpg');
    expect(row.kind).toBe('media');
  });

  it('targets with every schedule disabled → PAUSED; no targets at all → UNASSIGNED', async () => {
    const { controller } = makeController({
      playlists: [basePlaylist({ id: 'p1' }), basePlaylist({ id: 'p2', items: [] })],
      schedules: [{
        playlistId: 'p1', isActive: false, screenId: 's1', screenGroupId: null,
        startTime: new Date(0), endTime: null, daysOfWeek: null, timeStart: null, timeEnd: null,
      }],
      screens: [{ id: 's1', tenantId: 't1' }],
    });
    const out: any = await controller.summary(req);
    expect(out.playlists.find((p: any) => p.id === 'p1').scheduleState).toBe('PAUSED');
    expect(out.playlists.find((p: any) => p.id === 'p2').scheduleState).toBe('UNASSIGNED');
  });

  it('a future-only window is SCHEDULED, with a Starts summary', async () => {
    const future = new Date(Date.now() + 3 * 86400_000);
    const { controller } = makeController({
      playlists: [basePlaylist()],
      schedules: [{
        playlistId: 'p1', isActive: true, screenId: 's1', screenGroupId: null,
        startTime: future, endTime: null, daysOfWeek: null, timeStart: null, timeEnd: null,
      }],
      screens: [{ id: 's1', tenantId: 't1' }],
    });
    const out: any = await controller.summary(req);
    expect(out.playlists[0].scheduleState).toBe('SCHEDULED');
    expect(out.playlists[0].scheduleSummary).toMatch(/^Starts /);
  });
});

describe('GET /playlists/:id/delivery — event-sourced acknowledgement', () => {
  const VALUE = new Date('2026-08-31T12:00:00Z');
  const dep = {
    id: 'd1', label: 'Publish · Member Promotions', value: VALUE,
    targetIds: ['s1', 's2'], targetCount: 2, createdAt: VALUE,
  };

  it('acknowledged only via the refresh-acked event matching the exact value', async () => {
    const { controller } = makeController({
      playlist: { id: 'p1' },
      deployments: [dep],
      ackEvents: [
        { screenId: 's1', detail: { valueMs: VALUE.getTime() }, createdAt: new Date(VALUE.getTime() + 5000) },
        // Wrong value — a different push's ack must not count.
        { screenId: 's2', detail: { valueMs: 123 }, createdAt: new Date() },
      ],
      screens: [
        { id: 's1', name: 'G41', tenantId: 't1', lastPingAt: new Date(), lastRenderedAt: new Date(), lastPushConnectedAt: new Date(), pendingRefreshAt: null },
        { id: 's2', name: 'G43', tenantId: 't1', lastPingAt: new Date(), lastRenderedAt: new Date(), lastPushConnectedAt: null, pendingRefreshAt: VALUE },
      ],
      tenants: [{ id: 't1', name: 'RIOT Sacramento' }],
    });
    const out: any = await controller.delivery(req, 'p1');
    expect(out.latest.acknowledged).toBe(1);
    const g41 = out.latest.targets.find((t: any) => t.name === 'G41');
    const g43 = out.latest.targets.find((t: any) => t.name === 'G43');
    expect(g41.state).toBe('acknowledged');
    expect(g41.ackAt).toBe(VALUE.getTime() + 5000);
    expect(g43.state).toBe('not-updated');
    expect(out.history[0].acknowledged).toBe(1);
    // The response never claims confirmation.
    expect(JSON.stringify(out)).not.toMatch(/confirm/i);
  });

  it('an offline target is offline, a proof-less online target is unknown', async () => {
    const { controller } = makeController({
      playlist: { id: 'p1' },
      deployments: [dep],
      ackEvents: [],
      screens: [
        { id: 's1', name: 'G41', tenantId: 't1', lastPingAt: new Date(Date.now() - 10 * 60_000), lastRenderedAt: new Date(), lastPushConnectedAt: null, pendingRefreshAt: VALUE },
        { id: 's2', name: 'G43', tenantId: 't1', lastPingAt: new Date(), lastRenderedAt: null, lastPushConnectedAt: null, pendingRefreshAt: VALUE },
      ],
      tenants: [{ id: 't1', name: 'RIOT Sacramento' }],
    });
    const out: any = await controller.delivery(req, 'p1');
    expect(out.latest.targets.find((t: any) => t.name === 'G41').state).toBe('offline');
    expect(out.latest.targets.find((t: any) => t.name === 'G43').state).toBe('unknown');
  });

  it('no deployments for the playlist → an honest empty, not an invented history', async () => {
    const { controller } = makeController({ playlist: { id: 'p1' }, deployments: [] });
    const out: any = await controller.delivery(req, 'p1');
    expect(out).toEqual({ latest: null, history: [] });
  });

  it('a playlist outside the tenant is a 404', async () => {
    const { controller } = makeController({ playlist: null });
    let err: any;
    try { await controller.delivery(req, 'nope'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.NOT_FOUND);
  });
});
