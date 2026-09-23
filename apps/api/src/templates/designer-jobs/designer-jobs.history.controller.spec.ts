/**
 * The AI board HISTORY on TemplatesController (2026-09-23):
 *   - GET generate-designer/jobs — the list (route, roles, query validation, over real HTTP);
 *   - POST create-designer — a keep stamps the kept template on THIS tenant's job for the batch;
 *   - POST generate-designer/jobs/:id/again — regenerating from an OLD history item makes a NEW job.
 *
 * The REAL controller over the REAL DesignerJobsService on the two-tenant Prisma double
 * (test/designer-jobs-history-harness.ts — fixtures cut from the producers). The HTTP block boots
 * the controller in Nest with the REAL RbacGuard and supertest, because two things only exist at
 * the routing layer: that `GET …/generate-designer/jobs` reaches the list (the controller also
 * declares `GET :id`, `GET :id/versions` …) and that `?before=` is validated before any read.
 */
import 'reflect-metadata';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { type CanActivate, type ExecutionContext, type INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AppRole } from '@cms/database';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../../ai/ai.service';
import { BrandingScraperService } from '../../branding/branding-scraper.service';
import { SupabaseStorageService } from '../../storage/supabase-storage.service';
import { TemplatesController } from '../templates.controller';
import {
  DESIGNER_JOBS_ACTIVE_CAP,
  DESIGNER_HISTORY_DAYS,
  DesignerJobsService,
} from './designer-jobs.service';
import {
  BOARD_HTML,
  GENERATED,
  HISTORY_FOREIGN as FOREIGN,
  HISTORY_HOME as HOME,
  REQUEST_MAIN,
  RESULT_MAIN,
  expectedMainItem,
  historyJobRow as jobRow,
  makeHistoryHarness,
} from '../../../test/designer-jobs-history-harness';

const DAY = 24 * 60 * 60_000;
const reqAs = (role: AppRole = AppRole.SCHOOL_ADMIN) => ({ user: { tenantId: HOME, id: 'user-a', role } }) as any;

/** The controller exactly as the job endpoints' specs build it: real prototype, the double behind it. */
function build(rows: any[]) {
  const h = makeHistoryHarness({
    aiDesignerJob: rows,
    tenantBranding: [
      { id: 'br-a', tenantId: HOME, palette: { primary: '#D83C21', accent: '#f1c93a' }, displayName: 'Alpha' },
      { id: 'br-b', tenantId: FOREIGN, palette: { primary: '#000000' }, displayName: 'Beta' },
    ],
  });
  const controller = Object.create(TemplatesController.prototype) as TemplatesController;
  (controller as any).prisma = { client: h.db.client };
  (controller as any).designerJobs = h.service;
  return { ...h, controller };
}

// ── GET generate-designer/jobs — metadata ─────────────────────────────────────────────────────

describe('GET generate-designer/jobs — route metadata', () => {
  const proto = TemplatesController.prototype as any;

  it('is a GET on generate-designer/jobs with the SAME roles as every other jobs endpoint', () => {
    const fn = proto.listDesignerJobs;
    expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe('generate-designer/jobs');
    expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(RequestMethod.GET);
    const roles = Reflect.getMetadata(ROLES_KEY, fn);
    expect(roles).toEqual([AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN]);
    for (const other of ['generateDesignerCandidates', 'startDesignerJob', 'getDesignerJob', 'cancelDesignerJob', 'againDesignerJob']) {
      expect({ [other]: Reflect.getMetadata(ROLES_KEY, proto[other]) }).toEqual({ [other]: roles });
    }
  });
});

// ── GET generate-designer/jobs — over real HTTP ───────────────────────────────────────────────

/** Stands in for JwtAuthGuard: the session is whatever role the test names. RbacGuard stays REAL. */
class TestSessionGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const r = ctx.switchToHttp().getRequest();
    r.user = { id: 'user-a', tenantId: HOME, schoolId: HOME, districtId: HOME, role: r.headers['x-test-role'] || AppRole.SCHOOL_ADMIN };
    return true;
  }
}

describe('GET /api/v1/templates/generate-designer/jobs — over real HTTP (routing, RBAC, validation)', () => {
  let app: INestApplication;
  let h: ReturnType<typeof makeHistoryHarness>;

  beforeAll(async () => {
    h = makeHistoryHarness({
      aiDesignerJob: [
        jobRow('job-a-main', HOME, { request: REQUEST_MAIN, result: RESULT_MAIN, keptTemplateId: 'tpl-kept-a' }),
        jobRow('job-a-newer', HOME, { createdAt: new Date('2026-09-21T08:00:00.000Z') }),
        jobRow('job-a-running', HOME, { status: 'running', result: null, finishedAt: null, createdAt: new Date('2026-09-22T08:00:00.000Z') }),
        jobRow('job-b-newest', FOREIGN, { createdAt: new Date('2026-09-23T08:00:00.000Z') }),
      ],
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [TemplatesController],
      providers: [
        { provide: PrismaService, useValue: { client: h.db.client } },
        { provide: AiService, useValue: {} },
        { provide: BrandingScraperService, useValue: {} },
        { provide: SupabaseStorageService, useValue: {} },
        { provide: DesignerJobsService, useValue: h.service },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(new TestSessionGuard())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = (path: string, role?: AppRole) => {
    const r = request(app.getHttpServer()).get(path);
    return role ? r.set('x-test-role', role) : r;
  };

  it("reaches the list (not GET :id): this tenant's done jobs, newest first, no HTML, revalidated", async () => {
    const res = await get('/api/v1/templates/generate-designer/jobs');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(res.body.items.map((i: any) => i.id)).toEqual(['job-a-newer', 'job-a-main']);
    expect(res.body.items[1]).toEqual(
      expectedMainItem({ id: 'job-a-main', createdAt: '2026-09-20T12:00:00.000Z', finishedAt: '2026-09-20T12:03:00.000Z', keptTemplateId: 'tpl-kept-a' }),
    );
    expect(res.body).not.toHaveProperty('nextBefore');
    expect(res.text).not.toMatch(/job-b|<html|VOS-FIT-ENGINE/i);
  });

  it('pages over HTTP: ?limit=1 → nextBefore → ?before=… → the next one', async () => {
    const first = await get('/api/v1/templates/generate-designer/jobs?limit=1');
    expect(first.status).toBe(200);
    expect(first.body.items.map((i: any) => i.id)).toEqual(['job-a-newer']);
    expect(first.body.nextBefore).toBe('2026-09-21T08:00:00.000Z');
    const second = await get(`/api/v1/templates/generate-designer/jobs?limit=1&before=${encodeURIComponent(first.body.nextBefore)}`);
    expect(second.body.items.map((i: any) => i.id)).toEqual(['job-a-main']);
    expect(second.body).not.toHaveProperty('nextBefore');
  });

  it('?limit out of range is clamped, never refused', async () => {
    const res = await get('/api/v1/templates/generate-designer/jobs?limit=5000');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });

  it('a junk ?before= is a 400 before anything is read', async () => {
    const before = h.findManyCalls.length;
    const res = await get('/api/v1/templates/generate-designer/jobs?before=yesterday');
    expect(res.status).toBe(400);
    expect(h.findManyCalls.length).toBe(before);
  });

  it('GET …/jobs/:id still reaches the job itself (the full result, which is how the web reopens a batch)', async () => {
    const res = await get('/api/v1/templates/generate-designer/jobs/job-a-main');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'job-a-main', status: 'done', result: { batchId: GENERATED.batchId } });
    expect(res.body.result.candidates).toHaveLength(3);
    expect((await get('/api/v1/templates/generate-designer/jobs/job-b-newest')).status).toBe(404);
  });

  it.each([AppRole.CONTRIBUTOR, AppRole.RESTRICTED_VIEWER])('%s is refused (403) by the real RbacGuard', async (role) => {
    const res = await get('/api/v1/templates/generate-designer/jobs', role);
    expect(res.status).toBe(403);
  });

  it.each([AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN])('%s may list', async (role) => {
    expect((await get('/api/v1/templates/generate-designer/jobs', role)).status).toBe(200);
  });
});

// ── POST create-designer — the keep stamps the batch ──────────────────────────────────────────

describe('POST create-designer — keeping a board stamps its batch in the history', () => {
  const KEEP = (batchId?: string) => ({
    html: BOARD_HTML('Kept'),
    screenWidth: 3840,
    screenHeight: 2160,
    ...(batchId ? { batchId, candidateIndex: 0, artDirection: 'Rail + cards' } : {}),
  });

  it("stamps the new template on THIS tenant's done job for the batch", async () => {
    const { controller, db, table } = build([jobRow('job-a-main', HOME, { request: REQUEST_MAIN, result: RESULT_MAIN }), jobRow('job-a-other', HOME)]);
    const tpl = await controller.createDesigner(reqAs(AppRole.CONTRIBUTOR), KEEP(GENERATED.batchId) as any);
    expect(tpl.id).toEqual(expect.any(String));
    expect(db.foreignTouches(HOME)).toEqual([]);
    const rows = await table();
    expect(rows.find((r) => r.id === 'job-a-main').keptTemplateId).toBe(tpl.id);
    expect(rows.find((r) => r.id === 'job-a-other').keptTemplateId).toBeNull();
  });

  it("a keep naming ANOTHER tenant's batch saves the board and stamps nothing of theirs", async () => {
    const { controller, db, table } = build([jobRow('job-b-main', FOREIGN, { result: RESULT_MAIN })]);
    const tpl = await controller.createDesigner(reqAs(), KEEP(GENERATED.batchId) as any);
    expect(tpl.tenantId).toBe(HOME);
    expect(db.foreignTouches(HOME)).toEqual([]);
    expect((await table())[0].keptTemplateId).toBeNull();
  });

  it('a batchId with no job (a sync-endpoint batch) and a keep with no batchId both just save the board', async () => {
    const { controller, service, table } = build([jobRow('job-a-main', HOME, { result: RESULT_MAIN })]);
    const markKept = jest.spyOn(service, 'markKept');
    await expect(controller.createDesigner(reqAs(), KEEP('batch-from-the-sync-endpoint') as any)).resolves.toHaveProperty('id');
    await expect(controller.createDesigner(reqAs(), KEEP() as any)).resolves.toHaveProperty('id');
    expect(markKept).toHaveBeenCalledTimes(1); // no batchId → no stamp attempted
    expect((await table())[0].keptTemplateId).toBeNull();
  });

  it('a failure to stamp never fails the keep (logged instead)', async () => {
    const { controller, db, service } = build([jobRow('job-a-main', HOME, { result: RESULT_MAIN })]);
    db.client.aiDesignerJob.findFirst = async () => {
      throw new Error('connection reset');
    };
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(controller.createDesigner(reqAs(), KEEP(GENERATED.batchId) as any)).resolves.toHaveProperty('id');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not mark batch'));
  });

  it('a controller built without the jobs service (hand-built specs, a partial boot) still keeps the board', async () => {
    const { controller } = build([]);
    (controller as any).designerJobs = undefined;
    await expect(controller.createDesigner(reqAs(), KEEP(GENERATED.batchId) as any)).resolves.toHaveProperty('id');
  });
});

// ── POST generate-designer/jobs/:id/again — from an OLD history item ──────────────────────────

describe('POST generate-designer/jobs/:id/again — regenerating from history makes a NEW job', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

  it('a 60-day-old done job (far past the 30-min active window) is replayed as a NEW queued job; the source is untouched', async () => {
    const source = jobRow('job-a-old', HOME, { request: REQUEST_MAIN, result: RESULT_MAIN, createdAt: daysAgo(60), finishedAt: daysAgo(60) });
    const { controller, db, table } = build([source]);
    const res = await controller.againDesignerJob(reqAs(), 'job-a-old', { idempotencyKey: 'again-from-history-0001' });
    expect(res).toEqual({ jobId: expect.any(String), status: 'queued' });
    expect(res.jobId).not.toBe('job-a-old');
    expect(db.foreignTouches(HOME)).toEqual([]);
    await new Promise((r) => setImmediate(r)); // the create's prune is fire-and-forget
    const rows = await table();
    const fresh = rows.find((r) => r.id === res.jobId);
    expect(fresh).toMatchObject({ tenantId: HOME, userId: 'user-a', status: 'queued', idempotencyKey: 'again-from-history-0001' });
    expect(fresh.request).toEqual(REQUEST_MAIN);
    expect(Date.now() - +fresh.createdAt).toBeLessThan(60_000);
    // The history item itself is exactly as it was — still listed, still reopenable.
    expect(rows.find((r) => r.id === 'job-a-old')).toEqual(source);
  });

  it('replays count toward the active cap like any new job (the old source never did)', async () => {
    const { controller } = build([jobRow('job-a-old', HOME, { request: REQUEST_MAIN, result: RESULT_MAIN, createdAt: daysAgo(60) })]);
    for (let i = 0; i < DESIGNER_JOBS_ACTIVE_CAP; i++) {
      await expect(controller.againDesignerJob(reqAs(), 'job-a-old', { idempotencyKey: `again-cap-000${i}` })).resolves.toMatchObject({ status: 'queued' });
    }
    const err = await controller.againDesignerJob(reqAs(), 'job-a-old', { idempotencyKey: 'again-cap-9999' }).catch((e) => e);
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse()).toMatchObject({ code: 'AI_DESIGN_JOBS_BUSY' });
  });

  it('a KEPT source of any age replays, and the prune that the new job triggers never deletes it', async () => {
    const { controller, table } = build([
      jobRow('job-a-kept', HOME, { request: REQUEST_MAIN, result: RESULT_MAIN, createdAt: daysAgo(400), keptTemplateId: 'tpl-kept' }),
    ]);
    const res = await controller.againDesignerJob(reqAs(), 'job-a-kept', {});
    await new Promise((r) => setImmediate(r));
    expect((await table()).map((r) => r.id).sort()).toEqual(['job-a-kept', res.jobId].sort());
  });

  it(`a source past the ${DESIGNER_HISTORY_DAYS}-day window (not yet pruned) still replays: the new job holds a copy of its request`, async () => {
    const { controller, table } = build([jobRow('job-a-expiring', HOME, { request: REQUEST_MAIN, result: RESULT_MAIN, createdAt: daysAgo(95) })]);
    const res = await controller.againDesignerJob(reqAs(), 'job-a-expiring', {});
    await new Promise((r) => setImmediate(r));
    const rows = await table();
    // The create's retention removed the expired source AFTER its request was copied.
    expect(rows.map((r) => r.id)).toEqual([res.jobId]);
    expect(rows[0].request).toEqual(REQUEST_MAIN);
  });
});
