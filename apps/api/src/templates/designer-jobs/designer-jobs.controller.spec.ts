/**
 * The four generate-designer/jobs endpoints on TemplatesController (2026-09-23).
 *
 * Runs the REAL controller methods over the REAL DesignerJobsService on the two-tenant Prisma
 * double (which evaluates `where`, so a missing tenant predicate would really hand back tenant B's
 * row). The sync endpoint (generate-designer/candidates) is exercised side by side as the parity
 * oracle: a job must run exactly the options the sync endpoint would, and return exactly the body
 * the sync endpoint would.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AppRole } from '@cms/database';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { makeTwoTenantPrisma } from '../../tenant-isolation/two-tenant-prisma';
import {
  TemplatesController,
  DesignerGenerateSchema,
  DesignerJobStartSchema,
  DesignerJobAgainSchema,
} from '../templates.controller';
import { DesignerJobsService } from './designer-jobs.service';
import {
  DESIGNER_JOB_REQUEST_VERSION,
  designerJobResult,
  designerOptionsFromJobRequest,
  type DesignerGenerateOutput,
} from './designer-job-request';

const HOME = 't-alpha';
const FOREIGN = 't-beta';
const req = { user: { tenantId: HOME, id: 'user-a', role: 'SCHOOL_ADMIN' } } as any;

/** What AiService.generateDesignerBoardCandidates returns — typed against the real signature. */
const GENERATED: DesignerGenerateOutput = {
  candidates: [
    {
      name: 'Super Taco',
      html: '<!doctype html><html><head><style>.stage{width:1920px;height:1080px}</style></head><body><div class="stage"><h1 data-field="headline">Tacos</h1></div></body></html>',
      screenWidth: 1920,
      screenHeight: 1080,
      taurusWarnings: [],
      artDirection: 'Rail + cards',
      structure: 'rail-cards',
    },
  ],
  batchId: '5b0a3c2e-0000-4000-8000-000000000001',
  source: 'platform',
  usage: { used: 12, cap: 500, resetAt: '2026-10-01T00:00:00.000Z' },
  boundTo: { providerId: 'toast', providerName: 'Toast', itemCount: 9 },
};

function jobRow(id: string, tenantId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    tenantId,
    userId: `user-${tenantId}`,
    status: 'done',
    request: { prompt: `menu for ${tenantId}`, palette: ['#111111'], requestVersion: 1 },
    progress: { stage: 'done', of: 3, updatedAt: '2026-09-23T10:00:00.000Z' },
    result: { candidates: [], designer: true, batchId: `batch-${tenantId}`, ai: { source: 'tenant', usage: null } },
    error: null,
    attempts: 1,
    leaseOwner: null,
    heartbeatAt: null,
    idempotencyKey: null,
    createdAt: new Date('2026-09-23T09:58:00.000Z'),
    startedAt: new Date('2026-09-23T09:58:01.000Z'),
    finishedAt: new Date('2026-09-23T10:00:00.000Z'),
    ...over,
  };
}

function build(rows: any[] = []) {
  const db = makeTwoTenantPrisma({
    aiDesignerJob: rows,
    tenantBranding: [
      { id: 'br-a', tenantId: HOME, palette: { primary: '#D83C21', accent: '#f1c93a' }, displayName: 'Alpha' },
      { id: 'br-b', tenantId: FOREIGN, palette: { primary: '#000000' }, displayName: 'Beta' },
    ],
  });
  const api = db.client.aiDesignerJob;
  const create = api.create;
  api.create = async (args: any) =>
    create({ ...args, data: { createdAt: new Date(), attempts: 0, progress: null, result: null, error: null, finishedAt: null, ...args.data } });
  db.client.$executeRaw = jest.fn(async () => 1);
  const syncCalls: any[] = [];
  const controller = Object.create(TemplatesController.prototype) as TemplatesController;
  (controller as any).prisma = { client: db.client };
  (controller as any).ai = {
    generateDesignerBoardCandidates: jest.fn(async (opts: any) => {
      syncCalls.push(opts);
      return GENERATED;
    }),
  };
  const jobs = new DesignerJobsService({ client: db.client } as any);
  (controller as any).designerJobs = jobs;
  const stored = async () => (await db.client.aiDesignerJob.findMany({})) as any[];
  return { db, controller, jobs, syncCalls, stored };
}

describe('generate-designer/jobs — routes, roles, status codes', () => {
  const proto = TemplatesController.prototype as any;
  const syncRoles = Reflect.getMetadata(ROLES_KEY, proto.generateDesignerCandidates);

  it.each([
    ['startDesignerJob', 'generate-designer/jobs', RequestMethod.POST, 202],
    ['getDesignerJob', 'generate-designer/jobs/:id', RequestMethod.GET, undefined],
    ['cancelDesignerJob', 'generate-designer/jobs/:id/cancel', RequestMethod.POST, 200],
    ['againDesignerJob', 'generate-designer/jobs/:id/again', RequestMethod.POST, 202],
  ])('%s → %s, same roles as generate-designer/candidates', (handler, path, method, code) => {
    const fn = proto[handler];
    expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(method);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, fn)).toBe(code);
    expect(syncRoles).toEqual([AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN]);
    expect(Reflect.getMetadata(ROLES_KEY, fn)).toEqual(syncRoles);
  });
});

describe('POST generate-designer/jobs', () => {
  const OLD_KILL = process.env.AI_DESIGNER_DISABLED;
  afterEach(() => {
    if (OLD_KILL === undefined) delete process.env.AI_DESIGNER_DISABLED;
    else process.env.AI_DESIGNER_DISABLED = OLD_KILL;
  });

  it('queues a job for the session tenant and answers { jobId, status }', async () => {
    const { controller, stored } = build();
    const body = DesignerJobStartSchema.parse({ prompt: 'A taco menu', purpose: 'menu', idempotencyKey: 'c0ffee00-1111-4222-8333-444455556666' });
    const res = await controller.startDesignerJob(req, body);
    expect(res).toEqual({ jobId: expect.any(String), status: 'queued' });
    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: res.jobId, tenantId: HOME, userId: 'user-a', idempotencyKey: 'c0ffee00-1111-4222-8333-444455556666' });
    // The key is a column, never part of the replayable request.
    expect(rows[0].request).toEqual({ prompt: 'A taco menu', purpose: 'menu', requestVersion: DESIGNER_JOB_REQUEST_VERSION });
  });

  it("stores the palette RESOLVED the way the sync endpoint resolves it ('brand' → this tenant's colors)", async () => {
    const { controller, stored } = build();
    await controller.startDesignerJob(req, DesignerJobStartSchema.parse({ prompt: 'menu', palette: 'brand' }));
    expect((await stored())[0].request.palette).toEqual(['#d83c21', '#f1c93a']);
  });

  it('the same idempotency key returns the same job (a retried POST starts nothing new)', async () => {
    const { controller, stored } = build();
    const body = DesignerJobStartSchema.parse({ prompt: 'menu', idempotencyKey: 'retry-key-0001' });
    const a = await controller.startDesignerJob(req, body);
    const b = await controller.startDesignerJob(req, body);
    expect(b.jobId).toBe(a.jobId);
    expect(await stored()).toHaveLength(1);
  });

  it('the AI Designer kill switch refuses BEFORE anything is queued (503 AI_DESIGNER_DISABLED)', async () => {
    process.env.AI_DESIGNER_DISABLED = '1';
    const { controller, stored } = build();
    const err = await controller.startDesignerJob(req, DesignerJobStartSchema.parse({ prompt: 'menu' })).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toMatchObject({ code: 'AI_DESIGNER_DISABLED' });
    expect(await stored()).toHaveLength(0);
  });

  it('the body is the generate body (+ an idempotency key); junk keys are refused', () => {
    expect(DesignerJobStartSchema.safeParse({ prompt: 'x', idempotencyKey: crypto.randomUUID() }).success).toBe(true);
    expect(DesignerJobStartSchema.safeParse({ prompt: 'x', idempotencyKey: 'short' }).success).toBe(false);
    expect(DesignerJobStartSchema.safeParse({ prompt: 'x', idempotencyKey: 'has spaces in it' }).success).toBe(false);
    expect(DesignerJobStartSchema.safeParse({ prompt: '' }).success).toBe(false);
    // The Concierge intake rides through (the generate schema is passthrough), exactly as on the sync endpoint.
    expect(DesignerJobStartSchema.parse({ prompt: 'x', theme: 'Bold' } as any)).toMatchObject({ theme: 'Bold' });
  });
});

describe('a job runs EXACTLY what the sync endpoint runs (parity oracle)', () => {
  const BODIES: Array<[string, Record<string, unknown>]> = [
    ['minimal', { prompt: 'A welcome board' }],
    ['brand palette + purpose + sample menu', { prompt: 'menu board', palette: 'brand', purpose: 'menu', sampleMenu: true, count: 3 }],
    ['{ colors } + site menu missing + reference + venue', {
      prompt: 'menu', palette: { colors: ['#123456', ' '] }, siteMenuMissing: true, reference: 'Brand: Super Taco',
      venueName: 'Super Taco', tagline: 'Tacos', logoUrl: 'https://supertaco.example/logo.svg',
      heroImageUrl: 'https://supertaco.example/hero.jpg', content: 'Al Pastor $3.50', menuSource: 'saved',
      screenWidth: 3840, screenHeight: 2160, vertical: 'restaurant', interactive: true,
    }],
    ['POS selection + confirmed brief + intake junk', {
      prompt: 'our Toast menu', posSelection: { connectionId: 'conn-1', sections: ['Tacos'] },
      brief: { occasion: 'lunch', headline: 'Tacos!', items: ['Al Pastor'] }, theme: 'Bold', widgets: ['menu'],
    }],
  ];

  it.each(BODIES)('%s', async (_name, raw) => {
    const { controller, syncCalls, db } = build();
    const syncBody = DesignerGenerateSchema.parse(raw);
    await controller.generateDesignerCandidates(req, syncBody as any);
    const syncOptions = syncCalls[0];

    await controller.startDesignerJob(req, DesignerJobStartSchema.parse(raw));
    const [row] = (await db.client.aiDesignerJob.findMany({})) as any[];
    const jobOptions = designerOptionsFromJobRequest(row.request, { tenantId: row.tenantId, userId: row.userId });
    expect(jobOptions).toEqual(syncOptions);
  });

  it('and returns EXACTLY the body the sync endpoint returns (fit engine baked in, batchId, boundTo)', async () => {
    const { controller } = build();
    const syncResponse = await controller.generateDesignerCandidates(req, DesignerGenerateSchema.parse({ prompt: 'menu' }) as any);
    expect(designerJobResult(GENERATED)).toEqual(syncResponse);
    // Sanity: the parity is about something — the engine really was injected, and the join key rides along.
    expect((syncResponse.candidates[0] as any).html).toContain('VOS-FIT-ENGINE');
    expect(syncResponse.batchId).toBe(GENERATED.batchId);
  });
});

describe('GET generate-designer/jobs/:id', () => {
  it("returns this tenant's job — result only because it is done", async () => {
    const { controller } = build([jobRow('job-a', HOME), jobRow('job-b', FOREIGN)]);
    const view = await controller.getDesignerJob(req, 'job-a');
    expect(view).toEqual({
      id: 'job-a',
      status: 'done',
      progress: { stage: 'done', of: 3, updatedAt: '2026-09-23T10:00:00.000Z' },
      result: { candidates: [], designer: true, batchId: 'batch-t-alpha', ai: { source: 'tenant', usage: null } },
      createdAt: '2026-09-23T09:58:00.000Z',
      finishedAt: '2026-09-23T10:00:00.000Z',
    });
    expect(view).not.toHaveProperty('request');
  });

  it("another tenant's job is a 404, and its row is never read", async () => {
    const { controller, db } = build([jobRow('job-a', HOME), jobRow('job-b', FOREIGN)]);
    const err = await controller.getDesignerJob(req, 'job-b').catch((e) => e);
    expect(err.getStatus()).toBe(404);
    expect(err.getResponse()).toMatchObject({ code: 'AI_DESIGN_JOB_NOT_FOUND' });
    expect(db.foreignTouches(HOME)).toEqual([]);
  });
});

describe('POST generate-designer/jobs/:id/cancel', () => {
  it('cancels a running job of this tenant', async () => {
    const { controller } = build([jobRow('job-a', HOME, { status: 'running', result: null, finishedAt: null })]);
    await expect(controller.cancelDesignerJob(req, 'job-a')).resolves.toMatchObject({ id: 'job-a', status: 'cancelled' });
  });

  it('a finished job comes back unchanged', async () => {
    const { controller } = build([jobRow('job-a', HOME)]);
    await expect(controller.cancelDesignerJob(req, 'job-a')).resolves.toMatchObject({ status: 'done', finishedAt: '2026-09-23T10:00:00.000Z' });
  });

  it("another tenant's job: 404, not cancelled", async () => {
    const { controller, db } = build([jobRow('job-b', FOREIGN, { status: 'running', result: null })]);
    const err = await controller.cancelDesignerJob(req, 'job-b').catch((e) => e);
    expect(err.getStatus()).toBe(404);
    expect(db.foreignTouches(HOME)).toEqual([]);
    expect(((await db.client.aiDesignerJob.findMany({})) as any[])[0].status).toBe('running');
  });
});

describe('POST generate-designer/jobs/:id/again — the server-side Regenerate', () => {
  it('queues a NEW job from the stored request, which round-trips DesignerGenerateSchema unchanged', async () => {
    const original = {
      prompt: 'Super Taco menu', palette: ['#d83c21', '#f1c93a'], purpose: 'menu', content: 'Al Pastor $3.50',
      siteMenuMissing: false, venueName: 'Super Taco', posSelection: { connectionId: 'conn-1', sections: ['Tacos'] },
      brief: { occasion: 'lunch', headline: 'Tacos!', items: ['Al Pastor'], dateTime: '', tone: '', callToAction: '' },
      theme: 'Bold', count: 3, requestVersion: 1,
    };
    const { controller, stored } = build([jobRow('job-a', HOME, { request: original })]);
    const { requestVersion: _v, ...body } = original;
    // The replay property itself: parse(stored body) is the stored body.
    expect(DesignerGenerateSchema.parse(body)).toEqual(body);

    const res = await controller.againDesignerJob(req, 'job-a', { idempotencyKey: 'again-key-0001' });
    expect(res).toEqual({ jobId: expect.any(String), status: 'queued' });
    expect(res.jobId).not.toBe('job-a');
    const fresh = (await stored()).find((r) => r.id === res.jobId);
    expect(fresh.request).toEqual(original);
    expect(fresh).toMatchObject({ tenantId: HOME, userId: 'user-a', idempotencyKey: 'again-key-0001' });
  });

  it('a stored request that no longer validates is refused (422) before anything is queued', async () => {
    const { controller, stored } = build([
      jobRow('job-a', HOME, { request: { prompt: 'x'.repeat(4001), requestVersion: 1 } }),
      jobRow('job-c', HOME, { request: { prompt: 'menu', palette: 5, requestVersion: 1 } }),
    ]);
    for (const id of ['job-a', 'job-c']) {
      const err = await controller.againDesignerJob(req, id, undefined).catch((e) => e);
      expect(err.getStatus()).toBe(422);
      expect(err.getResponse()).toMatchObject({ code: 'AI_DESIGN_JOB_REQUEST_INVALID' });
    }
    expect(await stored()).toHaveLength(2);
  });

  it('an unknown request version is refused (422), never guessed at', async () => {
    const { controller, stored } = build([jobRow('job-a', HOME, { request: { prompt: 'menu', requestVersion: 2 } })]);
    const err = await controller.againDesignerJob(req, 'job-a', {}).catch((e) => e);
    expect(err.getStatus()).toBe(422);
    expect(await stored()).toHaveLength(1);
  });

  it("another tenant's job cannot be replayed (404) — its request is never read", async () => {
    const { controller, db, stored } = build([jobRow('job-b', FOREIGN)]);
    const err = await controller.againDesignerJob(req, 'job-b', {}).catch((e) => e);
    expect(err.getStatus()).toBe(404);
    expect(db.foreignTouches(HOME)).toEqual([]);
    expect(await stored()).toHaveLength(1);
  });

  it('the again body is optional and carries only a well-formed key', () => {
    expect(DesignerJobAgainSchema.safeParse(undefined).success).toBe(true);
    expect(DesignerJobAgainSchema.safeParse({}).success).toBe(true);
    expect(DesignerJobAgainSchema.safeParse({ idempotencyKey: 'bad key' }).success).toBe(false);
  });
});
