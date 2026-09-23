/**
 * Shared fixtures + harness for the AI board HISTORY specs (2026-09-23) and for the real-Postgres
 * proof (scripts/verify-designer-jobs-sql.ts), so both assert the SAME contract from the SAME rows.
 *
 * FIXTURES ARE CUT FROM THE PRODUCERS, never hand-written from what the list expects:
 *   - a stored `result` is `designerJobResult(<a DesignerGenerateOutput>)` — the exact function the
 *     worker's `complete()` stores (the generation is typed against AiService's real signature);
 *   - a stored `request` is `buildDesignerJobRequest(body, palette)` — the exact function the create
 *     endpoint stores. `MAIN_BODY` is a body `DesignerGenerateSchema.parse` returns unchanged (the
 *     history spec asserts that), so this is what the endpoint would really have stored.
 *
 * THE DOUBLE'S GAPS, FILLED LIKE POSTGRES. The two-tenant Prisma double evaluates `where` (so a
 * query that forgot the tenant really reaches tenant B's row) but neither orders, limits nor
 * projects. `makeHistoryHarness` adds ORDER BY / LIMIT / SELECT on findMany + findFirst AFTER the
 * double's own evaluation, and answers step 2's SQL projection with `projectLikePostgres` — bound
 * to `$1` (tenant) and `$2…` (ids) through the double's where, exactly like the SQL. The proof
 * script compares `projectLikePostgres` with what Postgres returns for the same rows.
 */
import { makeTwoTenantPrisma } from '../src/tenant-isolation/two-tenant-prisma';
import {
  buildDesignerJobRequest,
  designerJobResult,
  type DesignerGenerateBody,
  type DesignerGenerateOutput,
} from '../src/templates/designer-jobs/designer-job-request';
import { DesignerJobsService } from '../src/templates/designer-jobs/designer-jobs.service';

export const HISTORY_HOME = 't-alpha';
export const HISTORY_FOREIGN = 't-beta';

export const BOARD_HTML = (label: string) =>
  `<!doctype html><html><head><style>.stage{width:3840px;height:2160px;background:#111;color:#fff}` +
  `h1{font-size:180px}</style></head><body><div class="stage"><h1 data-field="headline">${label}</h1>` +
  `<p data-field="sub">Fresh every day</p></div></body></html>`;

/** What AiService.generateDesignerBoardCandidates returns — typed against its real signature. */
export const GENERATED: DesignerGenerateOutput = {
  candidates: [
    {
      name: 'Super Taco',
      html: BOARD_HTML('Rail'),
      screenWidth: 3840,
      screenHeight: 2160,
      taurusWarnings: [],
      artDirection: 'Rail + cards',
      structure: 'rail-cards',
      review: { reviewed: true, revised: true, score: 91 },
    },
    {
      name: 'Super Taco',
      html: BOARD_HTML('Poster'),
      screenWidth: 3840,
      screenHeight: 2160,
      taurusWarnings: ['backdrop-filter'],
      artDirection: 'Poster',
      structure: 'poster',
      // Rendered and measured, but no number came back.
      review: { reviewed: true, revised: false },
    },
    {
      name: 'Super Taco',
      html: BOARD_HTML('Split'),
      screenWidth: 3840,
      screenHeight: 2160,
      taurusWarnings: [],
      artDirection: 'Split',
      structure: 'split',
      // The renderer could not render this one: no verdict to show.
      review: { reviewed: false, revised: false },
    },
  ],
  batchId: '5b0a3c2e-0000-4000-8000-00000000000a',
  source: 'platform',
  usage: { used: 12, cap: 500, resetAt: '2026-10-01T00:00:00.000Z' },
  boundTo: { providerId: 'toast', providerName: 'Toast', itemCount: 9 },
};

/** A batch with the renderer off and no POS: no review, no boundTo. */
export const GENERATED_PLAIN: DesignerGenerateOutput = {
  candidates: [
    {
      name: 'Welcome',
      html: BOARD_HTML('Welcome'),
      screenWidth: 1920,
      screenHeight: 1080,
      taurusWarnings: [],
      artDirection: 'Hero',
      structure: 'hero',
    },
  ],
  batchId: '5b0a3c2e-0000-4000-8000-00000000000b',
  source: 'tenant',
  usage: null,
};

export const LONG_PROMPT =
  'A lunch menu board for Super Taco with our twelve tacos, three burritos and the Tuesday special, ' +
  'big prices, our red and gold, and a QR code to order ahead from the counter';

export const MAIN_BODY = { prompt: LONG_PROMPT, venueName: 'Super Taco', screenWidth: 3840, screenHeight: 2160, purpose: 'menu' };
export const PLAIN_BODY = { prompt: 'Welcome board' };
export const REQUEST_MAIN = buildDesignerJobRequest(MAIN_BODY as DesignerGenerateBody, ['#d83c21', '#f1c93a']);
export const REQUEST_PLAIN = buildDesignerJobRequest(PLAIN_BODY as DesignerGenerateBody, undefined);
export const RESULT_MAIN = designerJobResult(GENERATED);
export const resultPlain = (batchId: string) => designerJobResult({ ...GENERATED_PLAIN, batchId });

/** THE CONTRACT: the list item for a done job holding REQUEST_MAIN + RESULT_MAIN. */
export function expectedMainItem(at: { id: string; createdAt: string; finishedAt: string | null; keptTemplateId?: string }) {
  return {
    id: at.id,
    createdAt: at.createdAt,
    finishedAt: at.finishedAt,
    prompt: LONG_PROMPT.slice(0, 140),
    venueName: 'Super Taco',
    canvas: { w: 3840, h: 2160 },
    candidateCount: 3,
    candidates: [
      { index: 0, name: 'Super Taco', structure: 'rail-cards', artDirection: 'Rail + cards', review: { score: 91, revised: true } },
      { index: 1, name: 'Super Taco', structure: 'poster', artDirection: 'Poster', review: { score: null, revised: false } },
      { index: 2, name: 'Super Taco', structure: 'split', artDirection: 'Split' },
    ],
    boundTo: { providerId: 'toast', providerName: 'Toast', itemCount: 9 },
    ...(at.keptTemplateId ? { keptTemplateId: at.keptTemplateId } : {}),
    source: 'platform',
  };
}

/** A stored `ai_designer_jobs` row in the shape DesignerJobsService + the worker leave behind. */
export function historyJobRow(id: string, tenantId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    tenantId,
    userId: `user-${tenantId}`,
    status: 'done',
    request: REQUEST_PLAIN,
    progress: { stage: 'done', of: 1, updatedAt: '2026-09-20T12:03:00.000Z' },
    result: resultPlain(`batch-${id}`),
    error: null,
    attempts: 1,
    leaseOwner: 'worker-1',
    heartbeatAt: new Date('2026-09-20T12:02:50.000Z'),
    idempotencyKey: null,
    createdAt: new Date('2026-09-20T12:00:00.000Z'),
    startedAt: new Date('2026-09-20T12:00:01.000Z'),
    finishedAt: new Date('2026-09-20T12:03:00.000Z'),
    keptTemplateId: null,
    ...over,
  };
}

/**
 * What Postgres returns for designerHistoryProjectionSql over one stored row, in JS: `LEFT(request
 * ->>'prompt', 140)`, `->` of the named keys (absent → null), candidates in stored order projected
 * to six keys, a non-array `candidates` → [].
 */
export function projectLikePostgres(row: any) {
  const req = row.request && typeof row.request === 'object' ? row.request : {};
  const res = row.result && typeof row.result === 'object' ? row.result : {};
  const key = (o: any, k: string) => (o && typeof o === 'object' && !Array.isArray(o) && k in o ? o[k] : null);
  const cands = Array.isArray(res.candidates) ? res.candidates : [];
  return {
    id: row.id,
    prompt: typeof req.prompt === 'string' ? Array.from(req.prompt as string).slice(0, 140).join('') : null,
    venueName: key(req, 'venueName'),
    requestWidth: key(req, 'screenWidth'),
    requestHeight: key(req, 'screenHeight'),
    boundTo: key(res, 'boundTo'),
    source: key(key(res, 'ai'), 'source'),
    candidates: cands.map((c: any) => ({
      name: key(c, 'name'),
      structure: key(c, 'structure'),
      artDirection: key(c, 'artDirection'),
      review: key(c, 'review'),
      screenWidth: key(c, 'screenWidth'),
      screenHeight: key(c, 'screenHeight'),
    })),
  };
}

function orderComparator(orderBy: any) {
  const pairs = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o: any) => Object.entries(o)) as Array<[string, string]>;
  return (a: any, b: any) => {
    for (const [k, dir] of pairs) {
      const av = a[k] instanceof Date ? +a[k] : a[k];
      const bv = b[k] instanceof Date ? +b[k] : b[k];
      if (av === bv) continue;
      const c = av < bv ? -1 : 1;
      return dir === 'desc' ? -c : c;
    }
    return 0;
  };
}

const pick = (row: any, select: Record<string, boolean>) =>
  Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));

/**
 * The two-tenant double seeded with `datasets`, with Postgres's ORDER BY / LIMIT / SELECT on
 * aiDesignerJob.findMany + findFirst and step 2's projection. `rawFindMany` reads WITHOUT those
 * (and IS recorded by the double's touch log — read the table back only after asserting
 * `foreignTouches`).
 */
export function makeHistoryHarness(datasets: Record<string, any[]>) {
  const db = makeTwoTenantPrisma(datasets);
  const api = db.client.aiDesignerJob;
  const rawFindMany = api.findMany;
  const findManyCalls: any[] = [];
  const findFirstCalls: any[] = [];
  api.findMany = async (args: any = {}) => {
    findManyCalls.push(args);
    const { take, orderBy, select, ...rest } = args;
    let out: any[] = await rawFindMany(rest);
    if (orderBy) out = [...out].sort(orderComparator(orderBy));
    if (typeof take === 'number') out = out.slice(0, take);
    return select ? out.map((r) => pick(r, select)) : out;
  };
  api.findFirst = async (args: any = {}) => {
    findFirstCalls.push(args);
    const { orderBy, select, ...rest } = args;
    let out: any[] = await rawFindMany(rest);
    if (orderBy) out = [...out].sort(orderComparator(orderBy));
    const hit = out[0] ?? null;
    return hit && select ? pick(hit, select) : hit;
  };
  // Prisma's column defaults on create (the double applies none).
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
        keptTemplateId: null,
        ...args.data,
      },
    });
  // The create path's per-tenant advisory lock.
  db.client.$executeRaw = async () => 1;
  const projectionCalls: Array<{ sql: string; params: unknown[] }> = [];
  db.client.$queryRawUnsafe = jestLikeFn(async (sql: string, ...params: unknown[]) => {
    projectionCalls.push({ sql, params });
    const [tenantId, ...ids] = params as string[];
    const hits: any[] = await rawFindMany({ where: { tenantId, id: { in: ids } } });
    return hits.map(projectLikePostgres);
  });
  const service = new DesignerJobsService({ client: db.client } as any);
  const table = async () => (await rawFindMany({})) as any[];
  return { db, service, findManyCalls, findFirstCalls, projectionCalls, table };
}

/** A jest.fn under jest (so a spec can re-mock one call), the plain function anywhere else. */
function jestLikeFn<T extends (...a: any[]) => any>(impl: T): T {
  return typeof jest !== 'undefined' ? (jest.fn(impl) as unknown as T) : impl;
}

/** Every string anywhere in a value — for "no HTML crossed" and "no foreign id crossed" scans. */
export function allStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) allStrings(x, out);
  return out;
}
