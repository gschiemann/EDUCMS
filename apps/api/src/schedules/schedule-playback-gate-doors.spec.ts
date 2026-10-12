/**
 * Video gate (step 5, 2026-10-12) on the three SCHEDULE doors: POST
 * /schedules, PUT /schedules/:id (activating a draft), PUT
 * /schedules/:id/toggle. Each hands MediaPublicationService.prepare a warnings
 * sink and returns what it collected as `playbackWarnings`; with nothing to
 * say the response is exactly as before; an enforce refusal (prepare throws)
 * writes no row. The gate logic itself: playback-gate.service.spec.ts.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { AppRole } from '@cms/database';
import { SchedulesController } from './schedules.controller';

const W = { code: 'VIDEO_MAY_STUTTER', reason: 'capability', assetId: 'clip', file: 'Promo.mp4', screens: [{ id: 'scr1', name: 'Lobby' }], hasLighterCopy: true, message: 'm' };

function make(prepare: jest.Mock) {
  const rows: any[] = [
    { id: 'draft', tenantId: 't1', playlistId: 'pl', screenId: 'scr1', screenGroupId: null, isActive: false, pendingMedia: false, priority: 0, startTime: new Date(), daysOfWeek: null, timeStart: null, timeEnd: null, mode: 'replace' },
  ];
  const schedule = {
    findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null),
    findMany: jest.fn(async () => []),
    updateMany: jest.fn(async () => ({ count: 0 })),
    deleteMany: jest.fn(async () => ({ count: 0 })),
    create: jest.fn(async ({ data }: any) => {
      const r = { id: `new-${rows.length}`, ...data };
      rows.push(r);
      return { ...r, playlist: { id: 'pl', name: 'pl' }, screenGroup: null, screen: null };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const r = rows.find((x) => x.id === where.id)!;
      Object.assign(r, data);
      return { ...r, playlist: { id: 'pl', name: 'pl' }, screenGroup: null, screen: null };
    }),
  };
  const client: any = {
    schedule,
    screen: { findFirst: jest.fn().mockResolvedValue({ id: 'scr1' }), findMany: jest.fn().mockResolvedValue([]) },
    screenGroup: { findFirst: jest.fn().mockResolvedValue({ id: 'grp' }) },
    playlist: { findFirst: jest.fn().mockResolvedValue({ id: 'pl' }) },
    tenant: { findUnique: jest.fn().mockResolvedValue({ requireContentApproval: false }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    submission: { create: jest.fn().mockResolvedValue({ id: 'sub1' }) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  client.$transaction = jest.fn(async (fn: any) => fn(client));
  const controller = new SchedulesController(
    { client } as any,
    { publish: jest.fn().mockResolvedValue(undefined) } as any,
    { signMessage: jest.fn().mockReturnValue('signed') } as any,
    { notify: jest.fn().mockResolvedValue({}) } as any,
    { prepare } as any,
  );
  return { controller, rows, schedule };
}

const admin = { user: { id: 'a1', userId: 'a1', role: AppRole.SCHOOL_ADMIN, tenantId: 't1' } };
const warns = () => jest.fn(async (_t: string, _p: string, _s: any, _g: any, opts?: { warnings?: any[] }) => {
  opts?.warnings?.push(W);
  return false;
});
const silent = () => jest.fn(async () => false);
const refuses = () => jest.fn(async () => { throw new HttpException({ code: 'VIDEO_SCREEN_CANNOT_PLAY' }, 422); });
const body = { playlistId: 'pl', screenId: 'scr1', startTime: new Date('2026-10-12T00:00:00Z').toISOString(), isActive: true };

describe('POST /schedules', () => {
  it('carries the warnings; the schedule is still created live (warn never blocks)', async () => {
    const { controller, schedule } = make(warns());
    const res: any = await controller.create(admin as any, body as any);
    expect(res.playbackWarnings).toEqual([W]);
    expect(schedule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }));
  });
  it('nothing to say → no playbackWarnings field', async () => {
    const res: any = await make(silent()).controller.create(admin as any, body as any);
    expect('playbackWarnings' in res).toBe(false);
  });
  it('enforce refusal → no schedule row, the previous content stays', async () => {
    const { controller, schedule } = make(refuses());
    await expect(controller.create(admin as any, body as any)).rejects.toMatchObject({ status: 422 });
    expect(schedule.create).not.toHaveBeenCalled();
  });
});

describe('PUT /schedules/:id activating a draft', () => {
  it('carries the warnings', async () => {
    const res: any = await make(warns()).controller.update(admin as any, 'draft', { isActive: true } as any);
    expect(res.playbackWarnings).toEqual([W]);
  });
  it('enforce refusal → the draft stays a draft', async () => {
    const { controller, rows } = make(refuses());
    await expect(controller.update(admin as any, 'draft', { isActive: true } as any)).rejects.toMatchObject({ status: 422 });
    expect(rows[0].isActive).toBe(false);
  });
});

describe('PUT /schedules/:id/toggle', () => {
  it('carries the warnings when switching on', async () => {
    const res: any = await make(warns()).controller.toggle(admin as any, 'draft');
    expect(res.playbackWarnings).toEqual([W]);
    expect(res.isActive).toBe(true);
  });
  it('enforce refusal → stays off', async () => {
    const { controller, rows } = make(refuses());
    await expect(controller.toggle(admin as any, 'draft')).rejects.toMatchObject({ status: 422 });
    expect(rows[0].isActive).toBe(false);
  });
});
