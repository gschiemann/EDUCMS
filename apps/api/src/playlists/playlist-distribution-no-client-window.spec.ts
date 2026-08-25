/**
 * P5 (2026-08-25 audit) — write-path audit for "a windowed schedule that
 * can never run" (schedules.controller.ts create()/update() are guarded by
 * schedule-window-validation.ts; see schedule-window-validation.spec.ts).
 *
 * This file proves the OTHER content-Schedule write path — the HQ fleet
 * publish door, `POST /playlists/:id/publish-to-fleet` →
 * PlaylistDistributionService.publishToFleet → scheduleLive — needs NO
 * guard, because it is safe BY CONSTRUCTION:
 *
 *   - playlists.controller.ts `publishToFleet()`'s `@Body()` type is
 *     `{ screenIds?: string[] }` — there is no daysOfWeek/timeStart/timeEnd
 *     field in the accepted shape at all.
 *   - `scheduleLive()` (playlist-distribution.service.ts) hardcodes the
 *     created Schedule's `data` object with NO daysOfWeek/timeStart/timeEnd
 *     keys whatsoever — every fleet-published schedule is unconditionally
 *     always-on; Prisma leaves those nullable columns null.
 *
 * So there is no way to reach the "windowed + zero days" state through
 * this door. This spec is the regression lock: it calls the SERVICE layer
 * directly (bypassing the controller's `@Body()` type entirely) with a
 * params object that ALSO carries daysOfWeek/timeStart/timeEnd, proving
 * the service ignores them today. If a future change threads a client day
 * window through `scheduleLive`, the last assertions below start failing
 * and say exactly why — at which point that change needs the SAME
 * assertScheduleWindowIsReachable guard schedules.controller.ts uses.
 */

import 'reflect-metadata';
import { PlaylistDistributionService } from './playlist-distribution.service';

describe('PlaylistDistributionService.publishToFleet — no client day/time window input (P5 write-path audit)', () => {
  it('the created schedule carries no daysOfWeek/timeStart/timeEnd, even when the caller supplies them', async () => {
    const scheduleRows: any[] = [];
    const tx = {
      schedule: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
        create: jest.fn(async ({ data }: any) => {
          const r = { id: 's-new', ...data };
          scheduleRows.push(r);
          return { id: r.id };
        }),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    const client: any = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      playlist: {
        findFirst: jest.fn(async ({ where }: any) =>
          where?.id === 'pl-src' && where?.tenantId === 't-parent'
            ? {
                id: 'pl-src',
                tenantId: 't-parent',
                name: 'Fleet Board',
                templateId: null,
                template: null,
                isProtected: false,
                items: [],
              }
            : null,
        ),
        create: jest.fn(async ({ data }: any) => ({
          id: 'copy-' + data.tenantId,
        })),
      },
      asset: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: 'a1' })),
      },
      tenant: {
        findMany: jest.fn(async () => [{ id: 't-A', name: 'Location A' }]),
        findUnique: jest.fn(async () => ({ name: 'Corporate' })),
      },
      screen: {
        findMany: jest.fn(async () => [
          { id: 'scrA', name: 'Screen A', tenantId: 't-A' },
        ]),
      },
      auditLog: { create: jest.fn(async (a: any) => a.data) },
    };
    const svc = new PlaylistDistributionService({ client } as any);

    // Deliberately probing fields the real controller/DTO never exposes
    // (playlists.controller.ts publishToFleet's @Body() is only
    // `{ screenIds?: string[] }`) — this calls the SERVICE directly with
    // extra keys a hypothetical future caller might add, so the assertion
    // below is proof the service ignores them, not just the controller.
    const params: any = {
      parentTenantId: 't-parent',
      actorUserId: 'u1',
      sourcePlaylistId: 'pl-src',
      screenIds: ['scrA'],
      daysOfWeek: '',
      timeStart: '08:00',
      timeEnd: '15:00',
    };
    const out = await svc.publishToFleet(params);

    expect(out.ok).toBe(true);
    expect(scheduleRows).toHaveLength(1);
    expect(scheduleRows[0].daysOfWeek).toBeUndefined();
    expect(scheduleRows[0].timeStart).toBeUndefined();
    expect(scheduleRows[0].timeEnd).toBeUndefined();
    // Also confirm what IS written: an unconditionally always-on schedule.
    expect(scheduleRows[0]).toMatchObject({
      tenantId: 't-A',
      playlistId: 'copy-t-A',
      screenId: 'scrA',
      isActive: true,
      mode: 'replace',
    });
  });
});
