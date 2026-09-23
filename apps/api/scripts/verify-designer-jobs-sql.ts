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
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { HttpException } from '@nestjs/common';
import { DesignerJobsService, DESIGNER_JOB_STALE_MS, DESIGNER_JOB_ACTIVE_WINDOW_MS } from '../src/templates/designer-jobs/designer-jobs.service';
import { DESIGNER_JOB_REQUEST_VERSION, type DesignerJobRequest } from '../src/templates/designer-jobs/designer-job-request';

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
  const tenants = ['a', 'b', 'c', 'd'].map(T);
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

    // ── retention ────────────────────────────────────────────────────────────────────────
    console.log('retention');
    await client.aiDesignerJob.updateMany({ where: { tenantId: { in: tenants } }, data: { status: 'cancelled' } });
    const oldDone = await client.aiDesignerJob.create({
      data: { tenantId: T('a'), status: 'done', request: REQ('old') as any, createdAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    const recentDone = await client.aiDesignerJob.create({
      data: { tenantId: T('a'), status: 'done', request: REQ('recent') as any, createdAt: new Date(Date.now() - 6 * 86_400_000) },
    });
    const otherOld = await client.aiDesignerJob.create({
      data: { tenantId: T('b'), status: 'done', request: REQ('other') as any, createdAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    await svc.create({ tenantId: T('a'), userId: 'u', request: REQ('triggers prune') });
    await new Promise((r) => setTimeout(r, 300)); // the prune is fire-and-forget
    const left = new Set((await client.aiDesignerJob.findMany({ where: { id: { in: [oldDone.id, recentDone.id, otherOld.id] } } })).map((r) => r.id));
    check("create prunes THIS tenant's finished jobs older than 7 days, nothing else", !left.has(oldDone.id) && left.has(recentDone.id) && left.has(otherOld.id));
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
