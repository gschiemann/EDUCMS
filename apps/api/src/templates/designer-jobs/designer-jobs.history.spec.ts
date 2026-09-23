/**
 * The AI board HISTORY (2026-09-23): `DesignerJobsService.history` (the list), `markKept` (the
 * keep stamp) and the pure contract in designer-job-history.ts.
 *
 * Fixtures come from test/designer-jobs-history-harness.ts and are cut from the PRODUCERS: a
 * stored `result` is `designerJobResult(<a DesignerGenerateOutput>)` (what the worker stores) and a
 * stored `request` is `buildDesignerJobRequest(...)` (what the create endpoint stores). The service
 * runs over the two-tenant Prisma double, which EVALUATES `where`: a list or a stamp that forgot
 * the tenant genuinely reaches tenant B's row here. The harness adds what Postgres does and the
 * double does not (ORDER BY / LIMIT / SELECT, step 2's projection) AFTER the double's evaluation.
 * scripts/verify-designer-jobs-sql.ts asserts the same `expectedMainItem` on a real Postgres.
 */
import { matchWhere, UnsupportedWhereError } from '../../tenant-isolation/two-tenant-prisma';
import { DesignerGenerateSchema } from '../templates.controller';
import { DesignerJobsService } from './designer-jobs.service';
import { designerJobResult } from './designer-job-request';
import {
  DESIGNER_HISTORY_PAGE_DEFAULT,
  DESIGNER_HISTORY_PAGE_MAX,
  DesignerJobHistoryQuerySchema,
  clampDesignerHistoryLimit,
  designerHistoryProjectionSql,
  toDesignerHistoryItem,
} from './designer-job-history';
import {
  GENERATED,
  HISTORY_FOREIGN as FOREIGN,
  HISTORY_HOME as HOME,
  MAIN_BODY,
  PLAIN_BODY,
  REQUEST_MAIN,
  RESULT_MAIN,
  allStrings,
  expectedMainItem,
  historyJobRow as jobRow,
  makeHistoryHarness,
  projectLikePostgres,
} from '../../../test/designer-jobs-history-harness';

const DAY = 24 * 60 * 60_000;
const EXPECTED_ITEM = expectedMainItem({
  id: 'job-a-main',
  createdAt: '2026-09-20T12:00:00.000Z',
  finishedAt: '2026-09-20T12:03:00.000Z',
  keptTemplateId: 'tpl-kept-a',
});
const harness = (rows: any[]) => makeHistoryHarness({ aiDesignerJob: rows });

// ── the pure contract ─────────────────────────────────────────────────────────────────────────

describe('designer-job-history — the list item contract', () => {
  it('the fixtures are what the producers store (the request body round-trips DesignerGenerateSchema unchanged)', () => {
    expect(DesignerGenerateSchema.parse(MAIN_BODY)).toEqual(MAIN_BODY);
    expect(DesignerGenerateSchema.parse(PLAIN_BODY)).toEqual(PLAIN_BODY);
    expect(REQUEST_MAIN).toMatchObject({ ...MAIN_BODY, palette: ['#d83c21', '#f1c93a'], requestVersion: 1 });
    // The producer really did bake the fit engine into every candidate — the list must not carry it.
    expect(RESULT_MAIN.candidates.every((c: any) => /VOS-FIT-ENGINE/.test(c.html))).toBe(true);
    expect(RESULT_MAIN.batchId).toBe(GENERATED.batchId);
  });

  it('maps a producer-cut job to EXACTLY the item the web reads (no HTML, review only when rendered)', () => {
    const row = jobRow('job-a-main', HOME, { request: REQUEST_MAIN, result: RESULT_MAIN, keptTemplateId: 'tpl-kept-a' });
    const item = toDesignerHistoryItem(row, projectLikePostgres(row));
    expect(item).toEqual(EXPECTED_ITEM);
    expect(allStrings(item).some((s) => /<html|<!doctype|VOS-FIT-ENGINE/i.test(s))).toBe(false);
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
    expect(DESIGNER_HISTORY_PAGE_DEFAULT).toBe(20);
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

describe("DesignerJobsService.history — this tenant's DONE jobs, newest first, no HTML", () => {
  const at = (iso: string) => new Date(iso);

  it("lists only THIS tenant's done jobs — newest first — and never reads another tenant's row", async () => {
    const { service, db, findManyCalls, projectionCalls } = harness([
      jobRow('job-a-main', HOME, { request: REQUEST_MAIN, result: RESULT_MAIN, keptTemplateId: 'tpl-kept-a' }),
      jobRow('job-a-newer', HOME, { createdAt: at('2026-09-21T08:00:00.000Z') }),
      jobRow('job-a-older', HOME, { createdAt: at('2026-09-01T08:00:00.000Z') }),
      jobRow('job-a-running', HOME, { status: 'running', result: null, finishedAt: null, createdAt: at('2026-09-22T08:00:00.000Z') }),
      jobRow('job-a-failed', HOME, { status: 'failed', result: null, createdAt: at('2026-09-22T09:00:00.000Z') }),
      jobRow('job-a-cancelled', HOME, { status: 'cancelled', result: null, createdAt: at('2026-09-22T10:00:00.000Z') }),
      jobRow('job-b-newest', FOREIGN, { createdAt: at('2026-09-23T08:00:00.000Z') }),
      jobRow('job-b-kept', FOREIGN, { keptTemplateId: 'tpl-b', createdAt: at('2026-09-20T13:00:00.000Z') }),
    ]);
    const page = await service.history(HOME);
    expect(db.foreignTouches(HOME)).toEqual([]);
    expect(page.items.map((i) => i.id)).toEqual(['job-a-newer', 'job-a-main', 'job-a-older']);
    expect(page.items[1]).toEqual(EXPECTED_ITEM);
    expect(page).not.toHaveProperty('nextBefore');
    expect(allStrings(page).some((s) => /job-b|tpl-b|<html|VOS-FIT-ENGINE/i.test(s))).toBe(false);
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
    const { service, db } = harness([...rows, jobRow('job-b-x', FOREIGN)]);
    const first = await service.history(HOME, { limit: 2 });
    expect(first.items.map((i) => i.id)).toEqual(['job-a-4', 'job-a-3']);
    expect(first.nextBefore).toBe('2026-09-20T00:03:00.000Z');
    const second = await service.history(HOME, { limit: '2', before: new Date(first.nextBefore!) });
    expect(second.items.map((i) => i.id)).toEqual(['job-a-2', 'job-a-1']);
    expect(second.nextBefore).toBe('2026-09-20T00:01:00.000Z');
    const last = await service.history(HOME, { limit: 2, before: new Date(second.nextBefore!) });
    expect(last.items.map((i) => i.id)).toEqual(['job-a-0']);
    expect(last).not.toHaveProperty('nextBefore');
    expect(db.foreignTouches(HOME)).toEqual([]);
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
    project.mockImplementationOnce(async (sql: string, ...params: unknown[]) =>
      (await real(sql, ...params)).filter((m: any) => m.id !== 'job-a-2'),
    );
    const page = await service.history(HOME, { limit: 2 });
    expect(page.items.map((i) => i.id)).toEqual(['job-a-3']);
    expect(page.nextBefore).toBe('2026-09-20T00:02:00.000Z');
  });
});

// ── the keep stamp ────────────────────────────────────────────────────────────────────────────

describe("DesignerJobsService.markKept — the kept template lands on THIS tenant's job for that batch", () => {
  it("stamps this tenant's done job whose result.batchId matches — and nothing else about it changes", async () => {
    const mine = jobRow('job-a-main', HOME, { request: REQUEST_MAIN, result: RESULT_MAIN });
    const { service, db, table, findFirstCalls } = harness([mine, jobRow('job-a-other', HOME)]);
    await expect(service.markKept(HOME, GENERATED.batchId, 'tpl-new')).resolves.toBe(true);
    expect(db.foreignTouches(HOME)).toEqual([]);
    const rows = await table();
    expect(rows.find((r) => r.id === 'job-a-main')).toEqual({ ...mine, keptTemplateId: 'tpl-new' });
    expect(rows.find((r) => r.id === 'job-a-other').keptTemplateId).toBeNull();
    // Newest first, one row, only its id: Postgres answers from the (tenant_id, created_at DESC)
    // index and stops at the first match instead of reading every stored result.
    expect(findFirstCalls[0]).toEqual({
      where: { tenantId: HOME, status: 'done', result: { path: ['batchId'], equals: GENERATED.batchId } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
  });

  it("never another tenant's: a keep naming tenant B's batch reads, stamps and returns nothing of B's", async () => {
    const { service, db, table } = harness([jobRow('job-a-mine', HOME), jobRow('job-b-main', FOREIGN, { result: RESULT_MAIN })]);
    await expect(service.markKept(HOME, GENERATED.batchId, 'tpl-attacker')).resolves.toBe(false);
    expect(db.foreignTouches(HOME)).toEqual([]);
    expect((await table()).find((r) => r.id === 'job-b-main').keptTemplateId).toBeNull();
  });

  it('the same batchId in BOTH tenants (collision or forgery): only mine is stamped', async () => {
    const { service, db, table } = harness([
      jobRow('job-a-main', HOME, { result: RESULT_MAIN }),
      jobRow('job-b-main', FOREIGN, { result: RESULT_MAIN }),
    ]);
    await expect(service.markKept(HOME, GENERATED.batchId, 'tpl-mine')).resolves.toBe(true);
    // Checked BEFORE the test reads the table back (that read touches B's row by design).
    expect(db.foreignTouches(HOME)).toEqual([]);
    const rows = await table();
    expect(rows.find((r) => r.id === 'job-a-main').keptTemplateId).toBe('tpl-mine');
    expect(rows.find((r) => r.id === 'job-b-main').keptTemplateId).toBeNull();
  });

  it('a batchId no job carries (a sync-endpoint batch, a pruned job) stamps nothing and is fine', async () => {
    const { service, table } = harness([jobRow('job-a-main', HOME)]);
    await expect(service.markKept(HOME, 'batch-that-never-was', 'tpl-x')).resolves.toBe(false);
    expect((await table()).every((r) => r.keptTemplateId === null)).toBe(true);
  });

  it('only a DONE job is stamped (a running / failed row carrying the batchId is left alone)', async () => {
    const { service, table } = harness([
      jobRow('job-a-running', HOME, { status: 'running', result: RESULT_MAIN }),
      jobRow('job-a-failed', HOME, { status: 'failed', result: RESULT_MAIN }),
    ]);
    await expect(service.markKept(HOME, GENERATED.batchId, 'tpl-x')).resolves.toBe(false);
    expect((await table()).every((r) => r.keptTemplateId === null)).toBe(true);
  });

  it('keeping a second board of the same batch moves the stamp to the newer template', async () => {
    const { service, table } = harness([jobRow('job-a-main', HOME, { result: RESULT_MAIN })]);
    await service.markKept(HOME, GENERATED.batchId, 'tpl-first');
    await service.markKept(HOME, GENERATED.batchId, 'tpl-second');
    expect((await table())[0].keptTemplateId).toBe('tpl-second');
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
    const { service, table } = harness([
      jobRow('job-a-kept', HOME, { createdAt: old, result: designerJobResult(GENERATED) }),
      jobRow('job-a-unkept', HOME, { createdAt: old }),
    ]);
    await service.markKept(HOME, GENERATED.batchId, 'tpl-kept');
    await expect(service.prune(HOME)).resolves.toBe(1);
    expect((await table()).map((r) => r.id)).toEqual(['job-a-kept']);
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
