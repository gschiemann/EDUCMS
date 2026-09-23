/**
 * Whose logo / photo it is reaches the Designer — from the sync endpoint AND
 * from a background job, and again on a server-side Regenerate (2026-09-23).
 *
 * `logoSource` / `heroImageSource` were accepted by DesignerGenerateSchema but
 * dropped before AiService, so the Designer's Logo: / Photo: lines could not
 * say that a stock photo is not the venue's own. This runs the REAL controller
 * methods over the REAL DesignerJobsService on the two-tenant Prisma double —
 * the same parity oracle as designer-jobs.controller.spec.ts, with bodies that
 * carry provenance (that suite's bodies carry none, and `toEqual` ignores
 * undefined keys, so it could not see a mirror that forgot these two).
 */
import { makeTwoTenantPrisma } from '../tenant-isolation/two-tenant-prisma';
import {
  TemplatesController,
  DesignerGenerateSchema,
  DesignerJobStartSchema,
} from './templates.controller';
import { DesignerJobsService } from './designer-jobs/designer-jobs.service';
import {
  designerOptionsFromJobRequest,
  replayableRequest,
  type DesignerGenerateOutput,
} from './designer-jobs/designer-job-request';

const HOME = 't-alpha';
const req = {
  user: { tenantId: HOME, id: 'user-a', role: 'SCHOOL_ADMIN' },
} as any;

const GENERATED: DesignerGenerateOutput = {
  candidates: [],
  batchId: '5b0a3c2e-0000-4000-8000-000000000002',
  source: 'platform',
  usage: null,
};

function build() {
  const db = makeTwoTenantPrisma({ aiDesignerJob: [], tenantBranding: [] });
  const api = db.client.aiDesignerJob;
  const create = api.create;
  api.create = async (args: any) =>
    create({
      ...args,
      data: {
        createdAt: new Date(),
        attempts: 0,
        progress: null,
        result: null,
        error: null,
        finishedAt: null,
        ...args.data,
      },
    });
  db.client.$executeRaw = jest.fn(async () => 1);
  const syncCalls: any[] = [];
  const controller = Object.create(
    TemplatesController.prototype,
  ) as TemplatesController;
  (controller as any).prisma = { client: db.client };
  (controller as any).ai = {
    generateDesignerBoardCandidates: jest.fn(async (opts: any) => {
      syncCalls.push(opts);
      return GENERATED;
    }),
  };
  (controller as any).designerJobs = new DesignerJobsService({
    client: db.client,
  } as any);
  return { db, controller, syncCalls };
}

const LOGO =
  'https://sb.example/storage/v1/object/public/assets/ai-designer/t-alpha/uploads/0123456789abcdef.png';
const PHOTO =
  'https://sb.example/storage/v1/object/public/assets/ai-stock/t-alpha/fedcba9876543210.jpg';

const BODIES: Array<[string, Record<string, unknown>]> = [
  [
    'an uploaded logo + a stock photo',
    {
      prompt: 'a welcome board',
      logoUrl: LOGO,
      logoSource: 'upload',
      heroImageUrl: PHOTO,
      heroImageSource: 'stock',
    },
  ],
  [
    'a site logo + a POS photo',
    {
      prompt: 'menu',
      logoUrl: LOGO,
      logoSource: 'site',
      heroImageUrl: PHOTO,
      heroImageSource: 'pos',
      purpose: 'menu',
    },
  ],
  [
    'a site photo only',
    { prompt: 'promo', heroImageUrl: PHOTO, heroImageSource: 'site' },
  ],
];

describe('the sync endpoint forwards provenance to AiService', () => {
  it.each(BODIES)('%s', async (_name, raw) => {
    const { controller, syncCalls } = build();
    await controller.generateDesignerCandidates(
      req,
      DesignerGenerateSchema.parse(raw) as any,
    );
    expect(syncCalls).toHaveLength(1);
    expect(syncCalls[0].logoSource).toBe(raw.logoSource);
    expect(syncCalls[0].heroImageSource).toBe(raw.heroImageSource);
  });

  it('negative control: an unknown source is refused at the boundary (never reaches a prompt)', () => {
    expect(
      DesignerGenerateSchema.safeParse({ prompt: 'x', heroImageSource: 'ai' })
        .success,
    ).toBe(false);
    expect(
      DesignerGenerateSchema.safeParse({ prompt: 'x', logoSource: 'pos' })
        .success,
    ).toBe(false);
  });
});

describe('a job runs the same provenance the sync endpoint would (parity oracle)', () => {
  it.each(BODIES)('%s', async (_name, raw) => {
    const { controller, syncCalls, db } = build();
    await controller.generateDesignerCandidates(
      req,
      DesignerGenerateSchema.parse(raw) as any,
    );
    await controller.startDesignerJob(req, DesignerJobStartSchema.parse(raw));
    const [row] = (await db.client.aiDesignerJob.findMany({})) as any[];
    expect(row.request.logoSource).toBe(raw.logoSource);
    expect(row.request.heroImageSource).toBe(raw.heroImageSource);
    const jobOptions = designerOptionsFromJobRequest(row.request, {
      tenantId: row.tenantId,
      userId: row.userId,
    });
    expect(jobOptions).toEqual(syncCalls[0]);
    // …and the fields are really there (toEqual alone would pass two objects that both lack them).
    expect(jobOptions.heroImageSource).toBe(raw.heroImageSource);
    expect(jobOptions.logoSource).toBe(raw.logoSource);
  });

  it('a server-side Regenerate replays the stored provenance', async () => {
    const { controller, db } = build();
    const raw = BODIES[0][1];
    const first = await controller.startDesignerJob(
      req,
      DesignerJobStartSchema.parse(raw),
    );
    await db.client.aiDesignerJob.update({
      where: { id: first.jobId },
      data: { status: 'done' },
    });
    const again = await controller.againDesignerJob(
      req,
      first.jobId,
      undefined,
    );
    const rows = (await db.client.aiDesignerJob.findMany({})) as any[];
    const replayed = rows.find((r) => r.id === again.jobId);
    expect(replayed.request).toMatchObject({
      logoSource: 'upload',
      heroImageSource: 'stock',
      logoUrl: LOGO,
      heroImageUrl: PHOTO,
    });
    const stored = replayableRequest(replayed.request);
    expect(
      stored.ok && DesignerGenerateSchema.parse(stored.body),
    ).toMatchObject({ logoSource: 'upload', heroImageSource: 'stock' });
  });
});
