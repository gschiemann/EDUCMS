/**
 * The AI board HISTORY (2026-09-23): `DesignerJobsService.history` (the list), `markKept` (the
 * keep stamp) and the pure contract in designer-job-history.ts.
 *
 * Fixtures are cut from the PRODUCERS, never hand-written from what the list expects: a stored
 * `result` is `designerJobResult(<a DesignerGenerateOutput>)` — the exact function the worker's
 * `complete()` stores — and a stored `request` is `buildDesignerJobRequest(DesignerGenerateSchema
 * .parse(body))`, the exact function the create endpoint stores.
 *
 * The service runs over the two-tenant Prisma double (tenant-isolation/two-tenant-prisma.ts),
 * which EVALUATES `where`: a list or a stamp that forgot the tenant genuinely reaches tenant B's
 * row here. Two things Postgres does that the double does not are added by the harness, AFTER the
 * double's own where evaluation: ORDER BY / LIMIT / SELECT on findMany + findFirst, and step 2's
 * SQL projection (`projectLikePostgres` — the same projection in JS, bound to the tenant and the
 * ids exactly like its SQL). The projection's fidelity to the real SQL is proven by
 * apps/api/scripts/verify-designer-jobs-sql.ts, which asserts the SAME item JSON (EXPECTED_ITEM
 * below) on Postgres 16 from the same producer-cut row.
 */
import { makeTwoTenantPrisma, matchWhere, UnsupportedWhereError } from '../../tenant-isolation/two-tenant-prisma';
import { DesignerGenerateSchema } from '../templates.controller';
import { DesignerJobsService } from './designer-jobs.service';
import {
  buildDesignerJobRequest,
  designerJobResult,
  type DesignerGenerateOutput,
} from './designer-job-request';
import {
  DESIGNER_HISTORY_PAGE_DEFAULT,
  DESIGNER_HISTORY_PAGE_MAX,
  DesignerJobHistoryQuerySchema,
  clampDesignerHistoryLimit,
  designerHistoryProjectionSql,
  toDesignerHistoryItem,
} from './designer-job-history';

const HOME = 't-alpha';
const FOREIGN = 't-beta';
const DAY = 24 * 60 * 60_000;

// ── producer-cut fixtures ─────────────────────────────────────────────────────────────────────

const BOARD = (label: string) =>
  `<!doctype html><html><head><style>.stage{width:3840px;height:2160px}</style></head><body><div class="stage"><h1 data-field="headline">${label}</h1></div></body></html>`;

/** What AiService.generateDesignerBoardCandidates returns — typed against its real signature. */
const GENERATED: DesignerGenerateOutput = {
  candidates: [
    {
      name: 'Super Taco',
      html: BOARD('Rail'),
      screenWidth: 3840,
      screenHeight: 2160,
      taurusWarnings: [],
      artDirection: 'Rail + cards',
      structure: 'rail-cards',
      review: { reviewed: true, revised: true, score: 91 },
    },
    {
      name: 'Super Taco',
      html: BOARD('Poster'),
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
      html: BOARD('Split'),
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

/** A batch from before the look-and-fix loop / with the renderer off: no review, no POS. */
const GENERATED_PLAIN: DesignerGenerateOutput = {
  candidates: [
    {
      name: 'Welcome',
      html: BOARD('Welcome'),
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

const LONG_PROMPT =
  'A lunch menu board for Super Taco with our twelve tacos, three burritos and the Tuesday special, ' +
  'big prices, our red and gold, and a QR code to order ahead from the counter';

const REQUEST_MAIN = buildDesignerJobRequest(
  DesignerGenerateSchema.parse({ prompt: LONG_PROMPT, venueName: 'Super Taco', screenWidth: 3840, screenHeight: 2160, purpose: 'menu' }),
  ['#d83c21', '#f1c93a'],
);
const REQUEST_PLAIN = buildDesignerJobRequest(DesignerGenerateSchema.parse({ prompt: 'Welcome board' }), undefined);

/** The list item the web receives for a job holding REQUEST_MAIN + designerJobResult(GENERATED). THE CONTRACT. */
const EXPECTED_ITEM = {
  id: 'job-a-main',
  createdAt: '2026-09-20T12:00:00.000Z',
  finishedAt: '2026-09-20T12:03:00.000Z',
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
  keptTemplateId: 'tpl-kept-a',
  source: 'platform',
};

function jobRow(id: string, tenantId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    tenantId,
    userId: `user-${tenantId}`,
    status: 'done',
    request: REQUEST_PLAIN,
    progress: { stage: 'done', of: 1, updatedAt: '2026-09-20T12:03:00.000Z' },
    result: designerJobResult({ ...GENERATED_PLAIN, batchId: `batch-${id}` }),
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

// ── harness ───────────────────────────────────────────────────────────────────────────────────

/**
 * What Postgres returns for designerHistoryProjectionSql over one stored row, in JS. Mirrors the
 * SQL field for field: `LEFT(request->>'prompt', 140)`, `->` of the named keys (absent → null),
 * candidates in stored order projected to six keys, a non-array `candidates` → []. Proven
 * equivalent on real Postgres by scripts/verify-designer-jobs-sql.ts (same EXPECTED_ITEM).
 */
function projectLikePostgres(row: any) {
  const req = row.request && typeof row.request === 'object' ? row.request : {};
  const res = row.result && typeof row.result === 'object' ? row.result : {};
  const key = (o: any, k: string) => (o && typeof o === 'object' && !Array.isArray(o) && k in o ? o[k] : null);
  const cands = Array.isArray(res.candidates) ? res.candidates : [];
  return {
    id: row.id,
    prompt: typeof req.prompt === 'string' ? Array.from(req.prompt).slice(0, 140).join('') : null,
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

function harness(rows: any[]) {
  const db = makeTwoTenantPrisma({ aiDesignerJob: rows });
  const api = db.client.aiDesignerJob;
  const rawFindMany = api.findMany;
  const findManyCalls: any[] = [];
  const findFirstCalls: any[] = [];
  // Postgres orders, limits and projects columns; the double evaluates `where` only. These run
  // AFTER the double's evaluation, so what reached a foreign row is still recorded by the double.
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
  // Step 2: evaluated like its SQL — `tenant_id = $1 AND id IN ($2…)` — through the double's own
  // where (a foreign read would be recorded), then projected like Postgres.
  const projectionCalls: Array<{ sql: string; params: unknown[] }> = [];
  db.client.$queryRawUnsafe = jest.fn(async (sql: string, ...params: unknown[]) => {
    projectionCalls.push({ sql, params });
    const [tenantId, ...ids] = params as string[];
    const hits: any[] = await rawFindMany({ where: { tenantId, id: { in: ids } } });
    return hits.map(projectLikePostgres);
  });
  const service = new DesignerJobsService({ client: db.client } as any);
  const all = async () => (await rawFindMany({})) as any[];
  return { db, service, findManyCalls, findFirstCalls, projectionCalls, all };
}

/** Every string anywhere in a value — for "no HTML crossed" and "no foreign id crossed" scans. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

// ── the pure contract ─────────────────────────────────────────────────────────────────────────

describe('designer-job-history — the list item contract', () => {
  it('maps a producer-cut job to EXACTLY the item the web reads (no HTML, review only when rendered)', () => {
    const row = jobRow('job-a-main', HOME, {
      request: REQUEST_MAIN,
      result: designerJobResult(GENERATED),
      keptTemplateId: 'tpl-kept-a',
    });
    // The producer really did bake the fit engine into every candidate — the list must not carry it.
    expect((row.result as any).candidates[0].html).toContain('VOS-FIT-ENGINE');
    const item = toDesignerHistoryItem(row, projectLikePostgres(row));
    expect(item).toEqual(EXPECTED_ITEM);
    expect(strings(item).some((s) => /<html|<!doctype|VOS-FIT-ENGINE/i.test(s))).toBe(false);
  });

  it('a plain batch (renderer off, no POS, no venue): no review, no boundTo, canvas from the boards', () => {
    const row = jobRow('job-a-plain', HOME);
    expect(toDesignerHistoryItem(row, projectLikePostgres(row))).toEqual({
      id: 'job-a-plain',
      createdAt: '2026-09-20T12:00:00.000Z',
      finishedAt: '2026-09-20T12:03:00.000Z',
      prompt: 'Welcome board',
      venueName: null,
      canvas: { w: 1920, h: 1080 },
      candidateCount: 1,
      candidates: [{ index: 0, name: 'Welcome', structure: 'hero', artDirection: 'Hero' }],
      source: 'tenant',
    });
  });

  it('tolerates any stored shape: no candidates, junk fields, the request canvas, then the default', () => {
    const base = jobRow('job-odd', HOME);
    const fromRequest = toDesignerHistoryItem(base, {
      id: 'job-odd', prompt: null, venueName: 42, requestWidth: 1080, requestHeight: 1920,
      boundTo: { providerId: 'toast' }, source: 'someone', candidates: 'nope',
    });
    expect(fromRequest).toMatchObject({ prompt: '', venueName: null, canvas: { w: 1080, h: 1920 }, candidateCount: 0, candidates: [], source: null });
    expect(fromRequest).not.toHaveProperty('boundTo');
    const fallback = toDesignerHistoryItem(base, {
      id: 'job-odd', prompt: 'x', venueName: null, requestWidth: null, requestHeight: -5,
      boundTo: null, source: null, candidates: [null, { name: 7, review: { reviewed: true, score: 'high' } }],
    });
    expect(fallback.canvas).toEqual({ w: 1920, h: 1080 });
    expect(fallback.candidates).toEqual([
      { index: 0, name: '', structure: null, artDirection: null },
      { index: 1, name: '', structure: null, artDirection: null, review: { score: null, revised: false } },
    ]);
  });

  it('limit: default 20, clamped to 1…50, never refused', () => {
    expect(clampDesignerHistoryLimit(undefined)).toBe(DESIGNER_HISTORY_PAGE_DEFAULT);
    expect(clampDesignerHistoryLimit('abc')).toBe(20);
    expect(clampDesignerHistoryLimit('')).toBe(20);
    expect(clampDesignerHistoryLimit('7')).toBe(7);
    expect(clampDesignerHistoryLimit(7.9)).toBe(7);
    expect(clampDesignerHistoryLimit('0')).toBe(1);
    expect(clampDesignerHistoryLimit(-3)).toBe(1);
    expect(clampDesignerHistoryLimit('500')).toBe(DESIGNER_HISTORY_PAGE_MAX);
    expect(DESIGNER_HISTORY_PAGE_MAX).toBe(50);
  });

  it('query: before must be an ISO timestamp (the cursor the list hands out); junk is refused', () => {
    expect(DesignerJobHistoryQuerySchema.safeParse({}).success).toBe(true);
    expect(DesignerJobHistoryQuerySchema.safeParse({ limit: '20', before: '2026-09-20T12:00:00.000Z' }).success).toBe(true);
    expect(DesignerJobHistoryQuerySchema.safeParse({ before: '2026-09-20T12:00:00+02:00' }).success).toBe(true);
    expect(DesignerJobHistoryQuerySchema.safeParse({ before: 'yesterday' }).success).toBe(false);
    expect(DesignerJobHistoryQuerySchema.safeParse({ before: '1695470400000' }).success).toBe(false);
    expect(DesignerJobHistoryQuerySchema.safeParse({ limit: 'x'.repeat(40) }).success).toBe(false);
  });

  it("step 2's SQL is bound to the tenant AND the ids, with placeholders generated from the id COUNT", () => {
    const sql = designerHistoryProjectionSql(3).replace(/\s+/g, ' ');
    expect(sql).toContain(`WHERE j."tenant_id" = $1 AND j."id" IN ($2, $3, $4)`);
    expect(sql).toContain(`LEFT(j."request"->>'prompt', 140)`);
    expect(sql).toContain('WITH ORDINALITY');
    // It never selects the stored HTML, the whole result, or the whole request.
    expect(sql).not.toMatch(/'html'/);
    expect(sql).not.toMatch(/j\."result"\s*(AS|,)/);
    expect(sql).not.toMatch(/j\."request"\s*(AS|,)/);
  });
});

// ── the list ──────────────────────────────────────────────────────────────────────────────────

describe('DesignerJobsService.history — this tenant\'s DONE jobs, newest first, no HTML', () => {
  const at = (iso: string) => new Date(iso);

  it("lists only THIS tenant's done jobs — newest first — and never reads another tenant's row", async () => {
    const { service, db, findManyCalls, projectionCalls } = harness([
      jobRow('job-a-main', HOME, { request: REQUEST_MAIN, result: designerJobResult(GENERATED), keptTemplateId: 'tpl-kept-a' }),
      jobRow('job-a-newer', HOME, { createdAt: at('2026-09-21T08:00:00.000Z') }),
      jobRow('job-a-older', HOME, { createdAt: at('2026-09-01T08:00:00.000Z') }),
      jobRow('job-a-running', HOME, { status: 'running', result: null, finishedAt: null, createdAt: at('2026-09-22T08:00:00.000Z') }),
      jobRow('job-a-failed', HOME, { status: 'failed', result: null, createdAt: at('2026-09-22T09:00:00.000Z') }),
      jobRow('job-a-cancelled', HOME, { status: 'cancelled', result: null, createdAt: at('2026-09-22T10:00:00.000Z') }),
      jobRow('job-b-newest', FOREIGN, { createdAt: at('2026-09-23T08:00:00.000Z') }),
      jobRow('job-b-kept', FOREIGN, { keptTemplateId: 'tpl-b', createdAt: at('2026-09-20T13:00:00.000Z') }),
    ]);
    const page = await service.history(HOME);
    expect(page.items.map((i) => i.id)).toEqual(['job-a-newer', 'job-a-main', 'job-a-older']);
    expect(page.items[1]).toEqual(EXPECTED_ITEM);
    expect(page).not.toHaveProperty('nextBefore');
    expect(db.foreignTouches(HOME)).toEqual([]);
    expect(strings(page).some((s) => /job-b|tpl-b|<html|VOS-FIT-ENGINE/i.test(s))).toBe(false);
    // Step 1: the tenant + status in the WHERE, newest first with a stable tiebreak, one extra
    // row to know whether there is a next page, scalar columns only.
    expect(findManyCalls[0]).toEqual({
      where: { tenantId: HOME, status: 'done' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 21,
      select: { id: true, createdAt: true, finishedAt: true, keptTemplateId: true },
    });
    // Step 2: one statement, the session tenant first, exactly the page's ids.
    expect(projectionCalls).toHaveLength(1);
    expect(projectionCalls[0].params).toEqual([HOME, 'job-a-newer', 'job-a-main', 'job-a-older']);
  });

  it('pages by createdAt: limit + nextBefore, then before → the next older page, then no nextBefore', async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      jobRow(`job-a-${i}`, HOME, { createdAt: new Date(Date.parse('2026-09-20T00:00:00.000Z') + i * 60_000) }),
    );
    const { service } = harness([...rows, jobRow('job-b-x', FOREIGN)]);
    const first = await service.history(HOME, { limit: 2 });
    expect(first.items.map((i) => i.id)).toEqual(['job-a-4', 'job-a-3']);
    expect(first.nextBefore).toBe('2026-09-20T00:03:00.000Z');
    const second = await service.history(HOME, { limit: '2', before: new Date(first.nextBefore!) });
    expect(second.items.map((i) => i.id)).toEqual(['job-a-2', 'job-a-1']);
    expect(second.nextBefore).toBe('2026-09-20T00:01:00.000Z');
    const last = await service.history(HOME, { limit: 2, before: new Date(second.nextBefore!) });
    expect(last.items.map((i) => i.id)).toEqual(['job-a-0']);
    expect(last).not.toHaveProperty('nextBefore');
  });

  it('an empty history costs ONE read (no projection statement)', async () => {
    const { service, projectionCalls } = harness([jobRow('job-b-only', FOREIGN)]);
    await expect(service.history(HOME)).resolves.toEqual({ items: [] });
    expect(projectionCalls).toHaveLength(0);
  });

  it('a job deleted between the two reads is left out, and the cursor still follows the page', async () => {
    const { service, db } = harness([
      jobRow('job-a-1', HOME, { createdAt: new Date('2026-09-20T00:01:00.000Z') }),
      jobRow('job-a-2', HOME, { createdAt: new Date('2026-09-20T00:02:00.000Z') }),
      jobRow('job-a-3', HOME, { createdAt: new Date('2026-09-20T00:03:00.000Z') }),
    ]);
    const project = db.client.$queryRawUnsafe as jest.Mock;
    const real = project.getMockImplementation()!;
    project.mockImplementationOnce(async (sql: string, tenantId: string, ...ids: string[]) =>
      (await real(sql, tenantId, ...ids)).filter((m: any) => m.id !== 'job-a-2'),
    );
    const page = await service.history(HOME, { limit: 2 });
    expect(page.items.map((i) => i.id)).toEqual(['job-a-3']);
    expect(page.nextBefore).toBe('2026-09-20T00:02:00.000Z');
  });
});

// ── the keep stamp ────────────────────────────────────────────────────────────────────────────

describe('DesignerJobsService.markKept — the kept template lands on THIS tenant\'s job for that batch', () => {
  const batchOf = (row: any) => row.result.batchId as string;

  it("stamps this tenant's done job whose result.batchId matches — and nothing else about it changes", async () => {
    const mine = jobRow('job-a-main', HOME, { request: REQUEST_MAIN, result: designerJobResult(GENERATED) });
    const { service, db, all, findFirstCalls } = harness([mine, jobRow('job-a-other', HOME)]);
    await expect(service.markKept(HOME, GENERATED.batchId, 'tpl-new')).resolves.toBe(true);
    const rows = await all();
    const stamped = rows.find((r) => r.id === 'job-a-main');
    expect(stamped.keptTemplateId).toBe('tpl-new');
    expect(stamped).toEqual({ ...mine, keptTemplateId: 'tpl-new' });
    expect(rows.find((r) => r.id === 'job-a-other').keptTemplateId).toBeNull();
    expect(db.foreignTouches(HOME)).toEqual([]);
    // Newest first, one row, only its id: Postgres answers from the (tenant_id, created_at DESC)
    // index and stops at the first match instead of reading every stored result.
    expect(findFirstCalls[0]).toEqual({
      where: { tenantId: HOME, status: 'done', result: { path: ['batchId'], equals: GENERATED.batchId } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
  });

  it("never another tenant's: a keep naming tenant B's batch reads, stamps and returns nothing of B's", async () => {
    const theirs = jobRow('job-b-main', FOREIGN, { result: designerJobResult(GENERATED) });
    const { service, db, all } = harness([jobRow('job-a-mine', HOME), theirs]);
    await expect(service.markKept(HOME, GENERATED.batchId, 'tpl-attacker')).resolves.toBe(false);
    expect(db.foreignTouches(HOME)).toEqual([]);
    expect((await all()).find((r) => r.id === 'job-b-main').keptTemplateId).toBeNull();
  });

  it('the same batchId in BOTH tenants (collision or forgery): only mine is stamped', async () => {
    const shared = designerJobResult(GENERATED);
    const { service, db, all } = harness([jobRow('job-a-main', HOME, { result: shared }), jobRow('job-b-main', FOREIGN, { result: shared })]);
    await expect(service.markKept(HOME, GENERATED.batchId, 'tpl-mine')).resolves.toBe(true);
    // Checked BEFORE the test reads the table back (that read touches B's row by design).
    expect(db.foreignTouches(HOME)).toEqual([]);
    const rows = await all();
    expect(rows.find((r) => r.id === 'job-a-main').keptTemplateId).toBe('tpl-mine');
    expect(rows.find((r) => r.id === 'job-b-main').keptTemplateId).toBeNull();
  });

  it('a batchId no job carries (a sync-endpoint batch, a pruned job) stamps nothing and is fine', async () => {
    const { service, all } = harness([jobRow('job-a-main', HOME)]);
    await expect(service.markKept(HOME, 'batch-that-never-was', 'tpl-x')).resolves.toBe(false);
    expect((await all()).every((r) => r.keptTemplateId === null)).toBe(true);
  });

  it('only a DONE job is stamped (a running / failed row carrying the batchId is left alone)', async () => {
    const result = designerJobResult(GENERATED);
    const { service, all } = harness([
      jobRow('job-a-running', HOME, { status: 'running', result }),
      jobRow('job-a-failed', HOME, { status: 'failed', result }),
    ]);
    await expect(service.markKept(HOME, GENERATED.batchId, 'tpl-x')).resolves.toBe(false);
    expect((await all()).every((r) => r.keptTemplateId === null)).toBe(true);
  });

  it('keeping a second board of the same batch moves the stamp to the newer template', async () => {
    const row = jobRow('job-a-main', HOME, { result: designerJobResult(GENERATED) });
    const { service, all } = harness([row]);
    await service.markKept(HOME, batchOf(row), 'tpl-first');
    await service.markKept(HOME, batchOf(row), 'tpl-second');
    expect((await all())[0].keptTemplateId).toBe('tpl-second');
  });

  it('best-effort: a database error is logged and reported as "not stamped" — it never throws', async () => {
    const client: any = {
      aiDesignerJob: {
        findFirst: jest.fn(async () => {
          throw new Error('pool timeout');
        }),
        updateMany: jest.fn(),
      },
    };
    const service = new DesignerJobsService({ client } as any);
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(service.markKept(HOME, 'batch-1', 'tpl-1')).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not mark batch batch-1 kept'));
    expect(client.aiDesignerJob.updateMany).not.toHaveBeenCalled();
  });

  it('nothing to stamp without a tenant, a batch and a template — and no query is spent', async () => {
    const client: any = { aiDesignerJob: { findFirst: jest.fn(), updateMany: jest.fn() } };
    const service = new DesignerJobsService({ client } as any);
    for (const [t, b, id] of [['', 'b', 'x'], [HOME, '', 'x'], [HOME, 'b', '']]) {
      await expect(service.markKept(t, b, id)).resolves.toBe(false);
    }
    expect(client.aiDesignerJob.findFirst).not.toHaveBeenCalled();
  });

  it('a stamped job survives retention that deletes its unstamped neighbour', async () => {
    const old = new Date(Date.now() - 120 * DAY);
    const { service, all } = harness([
      jobRow('job-a-kept', HOME, { createdAt: old, result: designerJobResult(GENERATED) }),
      jobRow('job-a-unkept', HOME, { createdAt: old }),
    ]);
    await service.markKept(HOME, GENERATED.batchId, 'tpl-kept');
    await expect(service.prune(HOME)).resolves.toBe(1);
    expect((await all()).map((r) => r.id)).toEqual(['job-a-kept']);
  });
});

// ── the double itself ─────────────────────────────────────────────────────────────────────────

describe('two-tenant double — Json path filters (what markKept uses) are evaluated, never approximated', () => {
  const row = { id: 'j', result: { batchId: 'b-1', ai: { source: 'tenant' }, n: 3 } };

  it('path + equals on a scalar leaf', () => {
    expect(matchWhere(row, { result: { path: ['batchId'], equals: 'b-1' } })).toBe(true);
    expect(matchWhere(row, { result: { path: ['batchId'], equals: 'b-2' } })).toBe(false);
    expect(matchWhere(row, { result: { path: ['ai', 'source'], equals: 'tenant' } })).toBe(true);
    expect(matchWhere(row, { result: { path: ['n'], equals: 3 } })).toBe(true);
    expect(matchWhere(row, { result: { path: ['missing'], equals: 'b-1' } })).toBe(false);
    expect(matchWhere({ id: 'k', result: null }, { result: { path: ['batchId'], equals: 'b-1' } })).toBe(false);
  });

  it('any other Json operator or comparison value is refused', () => {
    for (const cond of [
      { path: ['batchId'], string_contains: 'b' },
      { path: ['batchId'], equals: 'b-1', not: 'x' },
      { path: ['batchId'], equals: null },
      { path: ['batchId'], equals: { a: 1 } },
      { path: [], equals: 'b-1' },
      { path: [0], equals: 'b-1' },
    ]) {
      expect(() => matchWhere(row, { result: cond })).toThrow(UnsupportedWhereError);
    }
  });
});
