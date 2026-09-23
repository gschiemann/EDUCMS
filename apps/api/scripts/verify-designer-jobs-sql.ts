/**
 * verify-designer-jobs-sql.ts — prove DesignerJobsService's raw SQL on a REAL Postgres (2026-09-23).
 *
 * The jest specs pin the statement SHAPES with a mocked client; they cannot prove Postgres agrees
 * (SKIP LOCKED under real concurrency, the advisory lock serialising the per-tenant cap, parameter
 * type inference in `$1 * INTERVAL`, jsonb_build_object, RETURNING column aliases). This does, on a
 * throwaway database that already has the schema (e.g. `prisma db push` of master + the
 * 20260923120000_ai_designer_jobs migration applied):
 *
 *   DESIGNER_JOBS_SQL_URL='postgresql://me@localhost/agentb_designer_jobs_scratch?host=/tmp' \
 *     npx ts-node --transpile-only scripts/verify-designer-jobs-sql.ts
 *
 * REFUSES to run unless the database name contains "scratch" or "sandbox" AND the host is local
 * (localhost / 127.0.0.1 / a unix socket). It creates and deletes its own tenants; it never reads
 * DATABASE_URL, so a developer's .env pointed at production cannot be picked up by accident.
 * Exit 0 = every check passed.
 *
 * 2026-09-23 — the AI board HISTORY (needs 20260923190000_ai_designer_jobs_kept_template too): the
 * list's two reads and its SQL projection (the exact item JSON the jest specs assert, from the same
 * producer-cut rows — test/designer-jobs-history-harness.ts — and the harness's JS projection
 * compared with Postgres's for every row), paging, the keep stamp through Prisma's Json path filter
 * (never another tenant's), and the new retention (done 90 days, failed/cancelled 7, kept never).
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { HttpException } from '@nestjs/common';
import { DesignerJobsService, DESIGNER_JOB_STALE_MS, DESIGNER_JOB_ACTIVE_WINDOW_MS } from '../src/templates/designer-jobs/designer-jobs.service';
import { DESIGNER_JOB_REQUEST_VERSION, type DesignerJobRequest } from '../src/templates/designer-jobs/designer-job-request';
import { designerHistoryProjectionSql } from '../src/templates/designer-jobs/designer-job-history';
import {
  GENERATED,
  REQUEST_MAIN,
  REQUEST_PLAIN,
  RESULT_MAIN,
  expectedMainItem,
  projectLikePostgres,
  resultPlain,
} from '../test/designer-jobs-history-harness';

const url = process.env.DESIGNER_JOBS_SQL_URL || '';

function refuse(why: string): never {
  console.error(`REFUSING: ${why}`);
  process.exit(2);
}

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}

async function main() {
  if (!url) refuse('set DESIGNER_JOBS_SQL_URL to a scratch database');
  const parsed = new URL(url);
  const db = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const socket = parsed.searchParams.get('host') || '';
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname) || socket.startsWith('/');
  if (!/scratch|sandbox/i.test(db)) refuse(`database "${db}" is not a scratch/sandbox database`);
  if (!local) refuse(`host "${parsed.hostname}" is not local`);

  const client = new PrismaClient({ datasources: { db: { url } } });
  const [{ current_database: current }] = await client.$queryRawUnsafe<Array<{ current_database: string }>>('SELECT current_database()');
  if (current !== db) refuse(`connected to "${current}", expected "${db}"`);
  const [{ version }] = await client.$queryRawUnsafe<Array<{ version: string }>>('SELECT version()');
  console.log(`database ${current} — ${version.split(',')[0]}`);

  const svc = new DesignerJobsService({ client } as any);
  const run = randomUUID().slice(0, 8);
  const T = (n: string) => `verify-${run}-${n}`;
  const tenants = ['a', 'b', 'c', 'd', 'e', 'f'].map(T);
  for (const id of tenants) {
    await client.tenant.create({ data: { id, name: id, slug: id } });
  }
  const REQ = (p: string): DesignerJobRequest => ({ prompt: p, requestVersion: DESIGNER_JOB_REQUEST_VERSION }) as DesignerJobRequest;

  try {
    // ── create: idempotency, cap, advisory lock under concurrency ─────────────────────────
    console.log('create');
    const a1 = await svc.create({ tenantId: T('a'), userId: 'u', request: REQ('one'), idempotencyKey: `k-${run}-1` });
    const a1b = await svc.create({ tenantId: T('a'), userId: 'u', request: REQ('one'), idempotencyKey: `k-${run}-1` });
    check('same key → same job', a1.created && !a1b.created && a1.job.id === a1b.job.id);
    await svc.create({ tenantId: T('a'), userId: 'u', request: REQ('two') });
    const third = await svc.create({ tenantId: T('a'), userId: 'u', request: REQ('three') }).catch((e) => e);
    check('third active job → 429 AI_DESIGN_JOBS_BUSY', third instanceof HttpException && third.getStatus() === 429);

    const burst = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => svc.create({ tenantId: T('b'), userId: 'u', request: REQ(`burst ${i}`) })),
    );
    const made = burst.filter((r) => r.status === 'fulfilled').length;
    const busy = burst.filter((r) => r.status === 'rejected' && (r.reason as HttpException)?.getStatus?.() === 429).length;
    const inDb = await client.aiDesignerJob.count({ where: { tenantId: T('b') } });
    check('8 concurrent creates → exactly 2 created, 6 × 429 (the advisory lock holds the cap)', made === 2 && busy === 6 && inDb === 2, { made, busy, inDb });

    const same = await Promise.all(
      Array.from({ length: 6 }, () => svc.create({ tenantId: T('c'), userId: 'u', request: REQ('same'), idempotencyKey: `k-${run}-same` })),
    );
    const ids = new Set(same.map((r) => r.job.id));
    const cRows = await client.aiDesignerJob.count({ where: { tenantId: T('c') } });
    check('6 concurrent creates with one key → one job', ids.size === 1 && cRows === 1, { ids: ids.size, cRows });

    // ── claim: SKIP LOCKED under concurrency, oldest first, lease stamped ─────────────────
    console.log('claim');
    await client.aiDesignerJob.updateMany({ where: { tenantId: { in: tenants } }, data: { status: 'cancelled' } });
    const queued: string[] = [];
    for (let i = 0; i < 6; i++) {
      const row = await client.aiDesignerJob.create({
        data: { tenantId: T('d'), status: 'queued', request: REQ(`q${i}`) as any, createdAt: new Date(Date.now() - (60 - i) * 1000) },
      });
      queued.push(row.id);
    }
    const work = await svc.pendingWork();
    check('pendingWork sees the queue', work.queued === true, work);
    const claims = await Promise.all(
      Array.from({ length: 10 }, (_, i) => svc.claimNext(`worker-${i % 3}`)),
    );
    const got = claims.filter(Boolean).map((c) => c!.id);
    check('10 concurrent claims → the 6 queued jobs, each exactly once', got.length === 6 && new Set(got).size === 6 && got.every((id) => queued.includes(id)), got);
    const first = await svc.claimNext('worker-x');
    check('nothing left to claim → null', first === null);
    const claimedRows = await client.aiDesignerJob.findMany({ where: { id: { in: queued } } });
    check(
      'every claimed row: running, leased, heartbeat stamped, attempts 1',
      claimedRows.every((r) => r.status === 'running' && !!r.leaseOwner && !!r.heartbeatAt && r.attempts === 1 && !!r.startedAt),
    );
    const one = claims.find(Boolean)!;
    check('the claim returns tenantId/userId/request/attempts by alias', one.tenantId === T('d') && typeof one.request === 'object' && one.attempts === 1);

    // Oldest first, sequentially.
    await client.aiDesignerJob.updateMany({ where: { id: { in: queued } }, data: { status: 'queued', leaseOwner: null, attempts: 0 } });
    const order: string[] = [];
    for (let i = 0; i < 6; i++) order.push((await svc.claimNext('worker-seq'))!.id);
    check('sequential claims come oldest first', JSON.stringify(order) === JSON.stringify(queued), { order, queued });

    // ── lease-conditional writes ─────────────────────────────────────────────────────────
    console.log('lease');
    const [j1, j2, j3] = queued;
    const hb = await svc.heartbeat('worker-seq', [j1, j2, 'no-such-id']);
    check('heartbeat returns the live ids it holds', hb.sort().join() === [j1, j2].sort().join(), hb);
    check('heartbeat by another owner holds nothing', (await svc.heartbeat('intruder', [j1])).length === 0);
    check('progress by another owner is refused', (await svc.saveProgress(j1, 'intruder', { stage: 'drawing', updatedAt: new Date().toISOString() })) === false);
    check('progress by the owner lands', (await svc.saveProgress(j1, 'worker-seq', { stage: 'drawing', of: 3, updatedAt: new Date().toISOString() })) === true);
    check('complete by the owner lands', (await svc.complete(j1, 'worker-seq', { candidates: [], designer: true } as any, 3)) === true);
    check('a second complete is refused (no longer running)', (await svc.complete(j1, 'worker-seq', { candidates: [] } as any)) === false);
    const done = await svc.get(T('d'), j1);
    check('get: done with result + final progress', done?.status === 'done' && !!done?.result && done?.progress?.stage === 'done' && !!done?.finishedAt, done);
    check("get: another tenant's job is null", (await svc.get(T('a'), j1)) === null);

    const cancelled = await svc.cancel(T('d'), j2);
    check('cancel a running job', cancelled?.status === 'cancelled');
    check('the worker cannot complete a cancelled job', (await svc.complete(j2, 'worker-seq', { candidates: [] } as any)) === false);
    check('a cancelled job drops out of the heartbeat', (await svc.heartbeat('worker-seq', [j2])).length === 0);
    const again = await svc.cancel(T('d'), j1);
    check('cancel a done job → returned unchanged', again?.status === 'done');
    check('fail by the owner lands', (await svc.fail(j3, 'worker-seq', { code: 'AI_CAP_REACHED', message: 'used up', status: 402 })) === true);
    const failed = await svc.get(T('d'), j3);
    check('get: failed with its error envelope', failed?.status === 'failed' && (failed?.error as any)?.code === 'AI_CAP_REACHED', failed);

    // ── stale sweep: re-queue once, then AI_DESIGN_JOB_STALLED; expire never-claimed ─────
    console.log('sweep');
    const [s1, s2, s3] = queued.slice(3);
    const old = new Date(Date.now() - DESIGNER_JOB_STALE_MS - 60_000);
    await client.aiDesignerJob.update({ where: { id: s1 }, data: { heartbeatAt: old, attempts: 1 } });
    await client.aiDesignerJob.update({ where: { id: s2 }, data: { heartbeatAt: old, attempts: 2 } });
    const expiredRow = await client.aiDesignerJob.create({
      data: { tenantId: T('d'), status: 'queued', request: REQ('never claimed') as any, createdAt: new Date(Date.now() - DESIGNER_JOB_ACTIVE_WINDOW_MS - 60_000) },
    });
    check('pendingWork sees the stale job', (await svc.pendingWork()).stale === true);
    const swept = await svc.sweepStale();
    check('sweep: 1 re-queued, 1 failed, 1 expired', swept.requeued === 1 && swept.failed === 1 && swept.expired === 1, swept);
    const r1 = await client.aiDesignerJob.findUnique({ where: { id: s1 } });
    const r2 = await client.aiDesignerJob.findUnique({ where: { id: s2 } });
    const r3 = await client.aiDesignerJob.findUnique({ where: { id: s3 } });
    const rx = await client.aiDesignerJob.findUnique({ where: { id: expiredRow.id } });
    check('attempts 1 → queued again, lease cleared', r1?.status === 'queued' && r1.leaseOwner === null && r1.heartbeatAt === null);
    check('attempts 2 → failed AI_DESIGN_JOB_STALLED (status 503)', r2?.status === 'failed' && (r2.error as any)?.code === 'AI_DESIGN_JOB_STALLED' && (r2.error as any)?.status === 503, r2?.error);
    check('a fresh heartbeat is untouched', r3?.status === 'running');
    check('never claimed for 30 min → failed AI_DESIGN_JOB_EXPIRED', rx?.status === 'failed' && (rx.error as any)?.code === 'AI_DESIGN_JOB_EXPIRED', rx?.error);
    const reclaimed = await svc.claimNext('worker-2nd');
    check('the re-queued job is claimed again with attempts 2', reclaimed?.id === s1 && reclaimed?.attempts === 2, reclaimed);

    // ── graceful release ─────────────────────────────────────────────────────────────────
    console.log('release');
    const released = await svc.release('worker-2nd');
    const rr = await client.aiDesignerJob.findUnique({ where: { id: s1 } });
    check('release hands the job back with its attempt returned', released === 1 && rr?.status === 'queued' && rr.attempts === 1 && rr.leaseOwner === null, rr);

    // ── history: the list's two reads, its projection, paging, the keep stamp ──────────────
    console.log('history');
    const E = T('e');
    const F = T('f');
    const at = (isoText: string) => new Date(isoText);
    const job = (data: Record<string, unknown>) => client.aiDesignerJob.create({ data: data as any });
    const main = await job({
      tenantId: E, status: 'done', request: REQUEST_MAIN, result: RESULT_MAIN,
      createdAt: at('2026-09-20T12:00:00.000Z'), finishedAt: at('2026-09-20T12:03:00.000Z'),
    });
    const plains: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await job({
        tenantId: E, status: 'done', request: REQUEST_PLAIN, result: resultPlain(`batch-plain-${run}-${i}`),
        createdAt: at(`2026-09-2${1 + i}T08:00:00.000Z`), finishedAt: at(`2026-09-2${1 + i}T08:02:00.000Z`),
      });
      plains.push(r.id);
    }
    // Not history: running / failed / cancelled — each newer than every done job.
    await job({ tenantId: E, status: 'running', request: REQUEST_PLAIN, result: resultPlain(`batch-running-${run}`), createdAt: at('2026-09-26T08:00:00.000Z') });
    await job({ tenantId: E, status: 'failed', request: REQUEST_PLAIN, createdAt: at('2026-09-26T09:00:00.000Z') });
    await job({ tenantId: E, status: 'cancelled', request: REQUEST_PLAIN, createdAt: at('2026-09-26T10:00:00.000Z') });
    // Another tenant: its own done jobs — one FORGING tenant E's batchId — newer than all of E's.
    const forged = await job({ tenantId: F, status: 'done', request: REQUEST_MAIN, result: RESULT_MAIN, createdAt: at('2026-09-25T08:00:00.000Z') });
    const fOther = await job({ tenantId: F, status: 'done', request: REQUEST_PLAIN, result: resultPlain(`batch-f-${run}`), createdAt: at('2026-09-27T08:00:00.000Z') });

    const expectedOrder = [...plains].reverse().concat(main.id);
    const page = await svc.history(E);
    check("history lists only this tenant's DONE jobs, newest first", isDeepStrictEqual(page.items.map((i) => i.id), expectedOrder), page.items.map((i) => i.id));
    check('a page that fits has no nextBefore', page.nextBefore === undefined);
    const mainItem = page.items.find((i) => i.id === main.id);
    const contract = expectedMainItem({ id: main.id, createdAt: '2026-09-20T12:00:00.000Z', finishedAt: '2026-09-20T12:03:00.000Z' });
    check('the producer-cut job maps to EXACTLY the contract item (same expectedMainItem the jest specs assert)', isDeepStrictEqual(mainItem, contract), { got: mainItem, want: contract });
    const pageJson = JSON.stringify(page);
    check('no board HTML (or the fit engine) crosses in a page', !/<html|<!doctype|VOS-FIT-ENGINE/i.test(pageJson));

    // The jest harness answers step 2 with a JS mirror of the SQL — prove it IS the SQL, row by row.
    const rowsE = await client.aiDesignerJob.findMany({ where: { tenantId: E } });
    const pgRows = await client.$queryRawUnsafe<any[]>(designerHistoryProjectionSql(rowsE.length), E, ...rowsE.map((r) => r.id));
    const pgById = new Map(pgRows.map((m) => [m.id, m]));
    const mirrorMismatch = rowsE.filter((r) => !isDeepStrictEqual(pgById.get(r.id), projectLikePostgres(r))).map((r) => ({ id: r.id, pg: pgById.get(r.id), js: projectLikePostgres(r) }));
    check(`the specs' projection mirror equals Postgres's for all ${rowsE.length} rows (done, running, failed, cancelled)`, pgRows.length === rowsE.length && mirrorMismatch.length === 0, mirrorMismatch);
    const crossTenant = await client.$queryRawUnsafe<any[]>(designerHistoryProjectionSql(2), E, forged.id, fOther.id);
    check("the projection bound to tenant E returns nothing for tenant F's ids", crossTenant.length === 0, crossTenant);

    // Egress: what a page moves vs what selecting request + result for the same jobs would.
    const doneIds = expectedOrder;
    const [{ bytes: fullBytes }] = await client.$queryRawUnsafe<Array<{ bytes: number }>>(
      `SELECT COALESCE(SUM(octet_length("request"::text) + octet_length("result"::text)), 0)::int AS "bytes" FROM "ai_designer_jobs" WHERE "tenant_id" = $1 AND "id" = ANY($2::text[])`,
      E,
      doneIds,
    );
    const projectedBytes = Buffer.byteLength(JSON.stringify(pgRows.filter((m) => doneIds.includes(m.id))));
    console.log(`  info  projection ${projectedBytes} B vs request+result ${fullBytes} B for the same ${doneIds.length} jobs (fixture boards are tiny; a real result is ~120 KB)`);
    check('a page projects a small fraction of what selecting request + result would move', projectedBytes * 5 < fullBytes, { projectedBytes, fullBytes });

    // Paging by createdAt.
    const seen: string[] = [];
    let before: Date | null = null;
    let pages = 0;
    do {
      const p = await svc.history(E, { limit: 2, before });
      seen.push(...p.items.map((i) => i.id));
      before = p.nextBefore ? new Date(p.nextBefore) : null;
      pages += 1;
    } while (before && pages < 10);
    check('paging (limit 2, before = nextBefore) visits every done job exactly once, newest first, in 3 pages', isDeepStrictEqual(seen, expectedOrder) && pages === 3, { seen, pages });
    const fPage = await svc.history(F);
    check("tenant F's history is F's own jobs — never E's", isDeepStrictEqual(fPage.items.map((i) => i.id), [fOther.id, forged.id]), fPage.items.map((i) => i.id));

    // The keep stamp — Prisma's Json path filter, on Postgres.
    check("markKept stamps THIS tenant's done job for the batch", (await svc.markKept(E, GENERATED.batchId, 'tpl-e-1')) === true);
    const stampedE = await client.aiDesignerJob.findUnique({ where: { id: main.id } });
    const untouchedF = await client.aiDesignerJob.findUnique({ where: { id: forged.id } });
    check("…never another tenant's job carrying the same batchId", stampedE?.keptTemplateId === 'tpl-e-1' && untouchedF?.keptTemplateId === null, { e: stampedE?.keptTemplateId, f: untouchedF?.keptTemplateId });
    check('a batchId no job carries stamps nothing', (await svc.markKept(E, `never-${run}`, 'tpl-x')) === false);
    check('a RUNNING job carrying the batchId is not stamped', (await svc.markKept(E, `batch-running-${run}`, 'tpl-x')) === false);
    await svc.markKept(E, GENERATED.batchId, 'tpl-e-2');
    const relisted = (await svc.history(E)).items.find((i) => i.id === main.id);
    check('a second keep of the same batch moves the stamp, and the list shows it', isDeepStrictEqual(relisted, { ...contract, keptTemplateId: 'tpl-e-2' }), relisted);

    // ── retention: done = history (90 days), failed/cancelled 7 days, kept never ─────────
    console.log('retention');
    await client.aiDesignerJob.updateMany({ where: { tenantId: { in: tenants } }, data: { status: 'cancelled' } });
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
    const seed = async (tenantId: string, status: string, days: number, keptTemplateId: string | null = null) =>
      (await job({ tenantId, status, request: REQ(`${status} ${days}d`), createdAt: ago(days), keptTemplateId })).id;
    const gone = [await seed(T('a'), 'failed', 8), await seed(T('a'), 'cancelled', 8), await seed(T('a'), 'done', 91)];
    const stay = [
      await seed(T('a'), 'done', 8), // pruned under the old 7-day rule; history now
      await seed(T('a'), 'done', 89),
      await seed(T('a'), 'failed', 6),
      await seed(T('a'), 'done', 400, 'tpl-kept-forever'),
      await seed(T('a'), 'cancelled', 400, 'tpl-kept-anything'),
      await seed(T('b'), 'done', 400),
      await seed(T('b'), 'failed', 30),
    ];
    await svc.create({ tenantId: T('a'), userId: 'u', request: REQ('triggers prune') });
    await new Promise((r) => setTimeout(r, 300)); // the prune is fire-and-forget
    const left = new Set((await client.aiDesignerJob.findMany({ where: { id: { in: [...gone, ...stay] } }, select: { id: true } })).map((r) => r.id));
    check("create prunes THIS tenant's failed/cancelled jobs > 7 days and done jobs > 90 days", gone.every((id) => !left.has(id)), [...left]);
    check("…and keeps done ≤ 90 d, failed ≤ 7 d, a KEPT job of any age or status, and every other tenant's", stay.every((id) => left.has(id)), stay.filter((id) => !left.has(id)));
  } finally {
    await client.aiDesignerJob.deleteMany({ where: { tenantId: { in: tenants } } });
    await client.tenant.deleteMany({ where: { id: { in: tenants } } });
    await client.$disconnect();
  }

  if (failures) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nall designer-jobs SQL checks passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
