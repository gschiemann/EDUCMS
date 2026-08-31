import { HttpException, HttpStatus } from '@nestjs/common';
import { TemplatesController } from './templates.controller';

/**
 * Templates Gallery v1 (2026-08-31) — the batch usage read behind the
 * cards' LIVE/Not-in-use pills, and the enriched in-use delete block.
 * Route-order note: usage-summary is declared ABOVE @Get(':id') — the
 * controller-prefix lesson's sibling (a literal path after a param route
 * would be swallowed as an id).
 */

function makeController(over: Partial<Record<string, any>> = {}) {
  const prisma: any = {
    client: {
      template: { findFirst: jest.fn(async () => over.template ?? null) },
      playlist: {
        findMany: jest.fn(async ({ select }: any) =>
          select?.templateId ? (over.playlists ?? []) : (over.refPlaylists ?? over.playlists ?? []),
        ),
        count: jest.fn(async () => (over.playlists ?? []).length),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      schedule: { findMany: jest.fn(async () => over.schedules ?? []) },
      screen: {
        findMany: jest.fn(async ({ where }: any) => {
          if (where.screenGroupId) return (over.groupScreens ?? []).filter((s: any) => where.screenGroupId.in.includes(s.screenGroupId));
          if (where.id) return (over.pinnedScreens ?? []).filter((s: any) => where.id.in.includes(s.id));
          return [];
        }),
      },
      auditLog: { create: jest.fn(async () => ({})) },
    },
  };
  const controller = Object.create(TemplatesController.prototype) as TemplatesController;
  (controller as any).prisma = prisma;
  return { controller, prisma };
}

const req = { user: { tenantId: 't1', id: 'u1', role: 'SCHOOL_ADMIN' } } as any;

describe('GET /templates/usage-summary', () => {
  it('aggregates playlists and unioned screen reach per template', async () => {
    const { controller } = makeController({
      playlists: [
        { id: 'p1', templateId: 'tmp1' },
        { id: 'p2', templateId: 'tmp1' },
        { id: 'p3', templateId: 'tmp2' },
      ],
      schedules: [
        { playlistId: 'p1', screenId: 's1', screenGroupId: null, daysOfWeek: null },
        // p2 reaches the SAME screen — the template must count it once.
        { playlistId: 'p2', screenId: 's1', screenGroupId: null, daysOfWeek: null },
      ],
      pinnedScreens: [{ id: 's1', tenantId: 't1' }],
    });
    const out: any = await controller.usageSummary(req);
    expect(out.byTemplate.tmp1).toEqual({ playlists: 2, screensReached: 1, activeNow: true });
    expect(out.byTemplate.tmp2).toEqual({ playlists: 1, screensReached: 0, activeNow: false });
  });

  it('a tenant with no template-linked playlists returns an empty map, not an error', async () => {
    const { controller } = makeController({ playlists: [] });
    const out: any = await controller.usageSummary(req);
    expect(out.byTemplate).toEqual({});
  });
});

describe('DELETE /templates/:id — enriched in-use block', () => {
  it('the 409 carries usage reach alongside the playlist names', async () => {
    const { controller } = makeController({
      template: { id: 'tmp1', tenantId: 't1', isSystem: false, name: 'Club Welcome' },
      playlists: [{ id: 'p1', name: 'Lobby Rotation', templateId: 'tmp1' }],
      // The in-use queries select {id,name} / {id} — mirror the shape the
      // real select returns instead of leaking extra columns from the mock.
      refPlaylists: [{ id: 'p1', name: 'Lobby Rotation' }],
      schedules: [{ playlistId: 'p1', screenId: 's1', screenGroupId: null, daysOfWeek: null }],
      pinnedScreens: [{ id: 's1', tenantId: 't1' }],
    });
    let err: any;
    try { await controller.remove(req, 'tmp1', undefined); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
    const body = err.getResponse();
    expect(body.code).toBe('TEMPLATE_IN_USE');
    expect(body.usage).toEqual({
      playlists: [{ id: 'p1', name: 'Lobby Rotation' }],
      screensReached: 1,
      locations: 1,
    });
  });
});
