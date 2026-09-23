/**
 * DesignerJobsService (2026-09-23) — the `ai_designer_jobs` table's operator + worker methods.
 *
 * Operator methods run against the two-tenant Prisma double (tenant-isolation/two-tenant-prisma.ts),
 * which EVALUATES the where clause: a query that forgot `tenantId` genuinely receives the other
 * tenant's row here, so "tenant B's job is 404" is a statement about the query, not a fixture.
 * Worker methods are raw SQL; their specs pin the statement shape (the claim's SKIP LOCKED, the
 * lease conditions) and the parameters. The same SQL is proven against a real Postgres 16 by
 * apps/api/scripts/verify-designer-jobs-sql.ts (see the wave report).
 */
import * as fs from 'fs';
import * as path from 'path';
import { HttpException } from '@nestjs/common';
import { makeTwoTenantPrisma } from '../../tenant-isolation/two-tenant-prisma';
import {
  DesignerJobsService,
  DESIGNER_JOBS_ACTIVE_CAP,
  DESIGNER_JOB_ACTIVE_WINDOW_MS,
  DESIGNER_JOB_MAX_ATTEMPTS,
  DESIGNER_JOB_RETENTION_MS,
  DESIGNER_JOB_STALE_MS,
  storedProgress,
  toDesignerJobView,
} from './designer-jobs.service';
import { DESIGNER_JOB_REQUEST_VERSION, type DesignerJobRequest } from './designer-job-request';

const REQUEST: DesignerJobRequest = { prompt: 'A taco menu', requestVersion: DESIGNER_JOB_REQUEST_VERSION } as DesignerJobRequest;
const DAY = 24 * 60 * 60_000;

function job(id: string, tenantId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    tenantId,
    userId: `user-${tenantId}`,
    status: 'queued',
    request: { prompt: `secret brief of ${tenantId}`, requestVersion: 1 },
    progress: null,
    result: null,
    error: null,
    attempts: 0,
    leaseOwner: null,
    heartbeatAt: null,
    idempotencyKey: null,
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
    ...over,
  };
}

/** The two-tenant double, with Prisma's column defaults applied on create (the double has none). */
function harness(rows: any[] = []) {
  const db = makeTwoTenantPrisma({ aiDesignerJob: rows });
  const api = db.client.aiDesignerJob;
  const create = api.create;
  api.create = async (args: any) =>
    create({ ...args, data: { createdAt: new Date(), attempts: 0, progress: null, result: null, error: null, finishedAt: null, ...args.data } });
  const executeRaw = jest.fn(async () => 1);
  db.client.$executeRaw = executeRaw;
  const service = new DesignerJobsService({ client: db.client } as any);
  return { db, service, executeRaw, rows: () => (db.client as any).aiDesignerJob.findMany({}) };
}

describe('DesignerJobsService — create', () => {
  it('queues a job for the session tenant, with the request persisted and the worker woken', async () => {
    const { service, executeRaw, rows } = harness();
    const woke = jest.fn();
    service.onQueued(woke);
    const out = await service.create({ tenantId: 't-alpha', userId: 'u1', request: REQUEST, idempotencyKey: 'key-00000001' });
    expect(out.created).toBe(true);
    expect(out.job.status).toBe('queued');
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ tenantId: 't-alpha', userId: 'u1', status: 'queued', request: REQUEST, idempotencyKey: 'key-00000001' });
    // The per-tenant advisory lock was taken inside the transaction, keyed on the tenant.
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [strings, lockKey] = executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, string];
    expect(strings.join('?')).toContain('pg_advisory_xact_lock(hashtextextended(');
    expect(lockKey).toBe('ai_designer_jobs:t-alpha');
    expect(woke).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: the same key for the same tenant returns the job it already created', async () => {
    const { service, rows } = harness();
    const first = await service.create({ tenantId: 't-alpha', userId: 'u1', request: REQUEST, idempotencyKey: 'key-00000001' });
    const again = await service.create({ tenantId: 't-alpha', userId: 'u1', request: REQUEST, idempotencyKey: 'key-00000001' });
    expect(again.created).toBe(false);
    expect(again.job.id).toBe(first.job.id);
    expect(await rows()).toHaveLength(1);
  });

  it('the same key in ANOTHER tenant is another job (keys are per tenant)', async () => {
    const { service, rows } = harness([job('job-b', 't-beta', { idempotencyKey: 'key-00000001' })]);
    const out = await service.create({ tenantId: 't-alpha', userId: 'u1', request: REQUEST, idempotencyKey: 'key-00000001' });
    expect(out.created).toBe(true);
    expect(out.job.id).not.toBe('job-b');
    expect(await rows()).toHaveLength(2);
  });

  it(`caps a tenant at ${DESIGNER_JOBS_ACTIVE_CAP} active jobs — 429 AI_DESIGN_JOBS_BUSY, nothing inserted`, async () => {
    const { service, rows } = harness([job('a1', 't-alpha'), job('a2', 't-alpha', { status: 'running' })]);
    const err = await service.create({ tenantId: 't-alpha', userId: 'u1', request: REQUEST }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse()).toMatchObject({ code: 'AI_DESIGN_JOBS_BUSY' });
    expect(await rows()).toHaveLength(2);
  });

  it("another tenant's active jobs, finished jobs, and abandoned ones older than the window do not count", async () => {
    const old = new Date(Date.now() - DESIGNER_JOB_ACTIVE_WINDOW_MS - 60_000);
    const { service } = harness([
      job('b1', 't-beta'),
      job('b2', 't-beta', { status: 'running' }),
      job('a-done', 't-alpha', { status: 'done' }),
      job('a-failed', 't-alpha', { status: 'failed' }),
      job('a-ancient', 't-alpha', { status: 'queued', createdAt: old }),
      job('a-live', 't-alpha', { status: 'running' }),
    ]);
    const out = await service.create({ tenantId: 't-alpha', userId: 'u1', request: REQUEST });
    expect(out.created).toBe(true);
  });

  it('retention: every create deletes THIS tenant\'s finished jobs older than 7 days — nothing else', async () => {
    const now = Date.now();
    const { service, rows } = harness([
      job('a-old-done', 't-alpha', { status: 'done', createdAt: new Date(now - 8 * DAY) }),
      job('a-old-failed', 't-alpha', { status: 'failed', createdAt: new Date(now - 8 * DAY) }),
      job('a-old-cancelled', 't-alpha', { status: 'cancelled', createdAt: new Date(now - 8 * DAY) }),
      job('a-recent-done', 't-alpha', { status: 'done', createdAt: new Date(now - 6 * DAY) }),
      job('b-old-done', 't-beta', { status: 'done', createdAt: new Date(now - 8 * DAY) }),
    ]);
    await service.create({ tenantId: 't-alpha', userId: 'u1', request: REQUEST });
    await new Promise((r) => setImmediate(r)); // the prune is fire-and-forget
    const ids = (await rows()).map((r: any) => r.id).sort();
    expect(ids).toEqual(expect.arrayContaining(['a-recent-done', 'b-old-done']));
    expect(ids).not.toEqual(expect.arrayContaining(['a-old-done']));
    expect(ids.filter((id: string) => id.startsWith('a-old'))).toEqual([]);
    expect(ids).toHaveLength(3); // + the new job
    expect(DESIGNER_JOB_RETENTION_MS).toBe(7 * DAY);
  });

  it('an idempotent re-post does not prune or wake (nothing new was queued)', async () => {
    const { service } = harness();
    await service.create({ tenantId: 't-alpha', userId: 'u1', request: REQUEST, idempotencyKey: 'key-00000002' });
    const prune = jest.spyOn(service, 'prune');
    const woke = jest.fn();
    service.onQueued(woke);
    await service.create({ tenantId: 't-alpha', userId: 'u1', request: REQUEST, idempotencyKey: 'key-00000002' });
    expect(prune).not.toHaveBeenCalled();
    expect(woke).not.toHaveBeenCalled();
  });

  it('a unique-key race (P2002) resolves to the existing job, never an error', async () => {
    const existing = job('a-existing', 't-alpha', { idempotencyKey: 'key-00000003' });
    const findFirst = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
    const client: any = {
      aiDesignerJob: { findFirst },
      $transaction: jest.fn(async () => {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }),
    };
    const service = new DesignerJobsService({ client } as any);
    const out = await service.create({ tenantId: 't-alpha', userId: 'u1', request: REQUEST, idempotencyKey: 'key-00000003' });
    expect(out).toMatchObject({ created: false, job: { id: 'a-existing' } });
    expect(findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { tenantId: 't-alpha', idempotencyKey: 'key-00000003' } }));
  });
});

describe('DesignerJobsService — tenant scoping on every operator read and write', () => {
  const seed = () => [
    job('job-a', 't-alpha', { status: 'running' }),
    job('job-b', 't-beta', { status: 'running', result: { candidates: [{ html: '<p>b</p>' }] } }),
  ];

  it("get: another tenant's job is null (a 404), and its row is never touched", async () => {
    const { service, db } = harness(seed());
    await expect(service.get('t-alpha', 'job-b')).resolves.toBeNull();
    expect(db.foreignTouches('t-alpha')).toEqual([]);
    await expect(service.get('t-alpha', 'job-a')).resolves.toMatchObject({ id: 'job-a', status: 'running' });
  });

  it("requestFor: another tenant's stored request is never read", async () => {
    const { service, db } = harness(seed());
    await expect(service.requestFor('t-alpha', 'job-b')).resolves.toBeNull();
    expect(db.foreignTouches('t-alpha')).toEqual([]);
    await expect(service.requestFor('t-alpha', 'job-a')).resolves.toEqual({ prompt: 'secret brief of t-alpha', requestVersion: 1 });
  });

  it("cancel: another tenant's job is not cancelled and not returned", async () => {
    const { service, db } = harness(seed());
    const heard = jest.fn();
    service.onCancelled(heard);
    await expect(service.cancel('t-alpha', 'job-b')).resolves.toBeNull();
    expect(db.foreignTouches('t-alpha')).toEqual([]);
    expect(heard).not.toHaveBeenCalled();
    const rowB = (await db.client.aiDesignerJob.findMany({})).find((r: any) => r.id === 'job-b');
    expect(rowB.status).toBe('running');
  });
});

describe('DesignerJobsService — cancel', () => {
  it('a running job moves to cancelled and the local worker is told (so its run aborts now)', async () => {
    const { service } = harness([job('job-a', 't-alpha', { status: 'running', leaseOwner: 'w1' })]);
    const heard = jest.fn();
    service.onCancelled(heard);
    const out = await service.cancel('t-alpha', 'job-a');
    expect(out).toMatchObject({ id: 'job-a', status: 'cancelled' });
    expect(out?.finishedAt).toEqual(expect.any(String));
    expect(heard).toHaveBeenCalledWith('job-a');
  });

  it('a queued job moves to cancelled (the worker will never claim it)', async () => {
    const { service } = harness([job('job-a', 't-alpha')]);
    await expect(service.cancel('t-alpha', 'job-a')).resolves.toMatchObject({ status: 'cancelled' });
  });

  it.each(['done', 'failed', 'cancelled'])('a %s job returns its final state unchanged', async (status) => {
    const finishedAt = new Date('2026-09-23T10:00:00.000Z');
    const { service } = harness([
      job('job-a', 't-alpha', {
        status,
        finishedAt,
        result: status === 'done' ? { candidates: [], designer: true } : null,
        error: status === 'failed' ? { code: 'AI_CAP_REACHED', message: 'used up', status: 402 } : null,
      }),
    ]);
    const heard = jest.fn();
    service.onCancelled(heard);
    const out = await service.cancel('t-alpha', 'job-a');
    expect(out).toMatchObject({ status, finishedAt: finishedAt.toISOString() });
    if (status === 'done') expect(out?.result).toEqual({ candidates: [], designer: true });
    if (status === 'failed') expect(out?.error).toEqual({ code: 'AI_CAP_REACHED', message: 'used up', status: 402 });
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('toDesignerJobView / storedProgress', () => {
  it('result only when done, error only when failed', () => {
    const base = { id: 'j', progress: null, createdAt: new Date(0), finishedAt: null, result: { x: 1 }, error: { code: 'E' } };
    expect(toDesignerJobView({ ...base, status: 'running' })).not.toHaveProperty('result');
    expect(toDesignerJobView({ ...base, status: 'running' })).not.toHaveProperty('error');
    expect(toDesignerJobView({ ...base, status: 'done' })).toHaveProperty('result', { x: 1 });
    expect(toDesignerJobView({ ...base, status: 'failed' })).toHaveProperty('error', { code: 'E' });
    expect(toDesignerJobView({ ...base, status: 'done' }).createdAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('keeps only the DesignerProgress fields, bounded', () => {
    const at = new Date('2026-09-23T12:00:00.000Z');
    expect(storedProgress({ stage: 'reviewing', candidate: 2, of: 3, message: '  looking  ', junk: 'x' } as any, at)).toEqual({
      stage: 'reviewing',
      candidate: 2,
      of: 3,
      message: 'looking',
      updatedAt: '2026-09-23T12:00:00.000Z',
    });
    expect(storedProgress({ stage: 'drawing', message: 'y'.repeat(900) } as any, at).message).toHaveLength(200);
  });
});

describe('DesignerJobsService — worker SQL', () => {
  function rawHarness() {
    const client: any = {
      $queryRawUnsafe: jest.fn(async () => []),
      $executeRawUnsafe: jest.fn(async () => 0),
      aiDesignerJob: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    return { client, service: new DesignerJobsService({ client } as any) };
  }
  const sqlOf = (mock: jest.Mock, call = 0) => String(mock.mock.calls[call][0]).replace(/\s+/g, ' ').trim();

  it('claimNext: ONE queued row, oldest first, FOR UPDATE SKIP LOCKED, lease + attempt stamped in the same statement', async () => {
    const { client, service } = rawHarness();
    client.$queryRawUnsafe.mockResolvedValueOnce([
      { id: 'j1', tenantId: 't-alpha', userId: 'u1', request: REQUEST, attempts: 1 },
    ]);
    const claimed = await service.claimNext('worker-1');
    expect(claimed).toEqual({ id: 'j1', tenantId: 't-alpha', userId: 'u1', request: REQUEST, attempts: 1 });
    const sql = sqlOf(client.$queryRawUnsafe);
    expect(sql).toMatch(/^UPDATE "ai_designer_jobs" AS j SET "status" = 'running'/);
    expect(sql).toContain(`WHERE j."id" = ( SELECT "id" FROM "ai_designer_jobs" WHERE "status" = 'queued' ORDER BY "created_at" ASC LIMIT 1 FOR UPDATE SKIP LOCKED )`);
    expect(sql).toContain('"lease_owner" = $1');
    // "Now" is a naive UTC timestamp, like every Prisma-written column (never the session zone).
    expect(sql).toContain(`"heartbeat_at" = (NOW() AT TIME ZONE 'UTC')`);
    expect(sql).not.toMatch(/NOW\(\)(?! AT TIME ZONE 'UTC')/);
    expect(sql).toContain('"attempts" = j."attempts" + 1');
    expect(client.$queryRawUnsafe.mock.calls[0][1]).toBe('worker-1');
  });

  it('claimNext: nothing queued → null', async () => {
    const { service } = rawHarness();
    await expect(service.claimNext('worker-1')).resolves.toBeNull();
  });

  it('pendingWork: one read answering "anything queued?" and "anything stale?"', async () => {
    const { client, service } = rawHarness();
    client.$queryRawUnsafe.mockResolvedValueOnce([{ queued: true, stale: false }]);
    await expect(service.pendingWork()).resolves.toEqual({ queued: true, stale: false });
    expect(client.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    const sql = sqlOf(client.$queryRawUnsafe);
    expect(sql).toMatch(/^SELECT EXISTS/);
    expect(sql).not.toMatch(/UPDATE|DELETE|INSERT/);
    expect(client.$queryRawUnsafe.mock.calls[0][1]).toBe(DESIGNER_JOB_STALE_MS);
  });

  it('heartbeat: refreshes only the ids this worker is running, under its lease; returns the ids still held', async () => {
    const { client, service } = rawHarness();
    client.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'j1' }]);
    await expect(service.heartbeat('worker-1', ['j1', 'j2'])).resolves.toEqual(['j1']);
    const sql = sqlOf(client.$queryRawUnsafe);
    expect(sql).toContain(`WHERE "lease_owner" = $1 AND "status" = 'running' AND "id" IN ($2, $3)`);
    expect(client.$queryRawUnsafe.mock.calls[0].slice(1)).toEqual(['worker-1', 'j1', 'j2']);
  });

  it('heartbeat with nothing running costs no query', async () => {
    const { client, service } = rawHarness();
    await expect(service.heartbeat('worker-1', [])).resolves.toEqual([]);
    expect(client.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it.each([
    ['saveProgress', (s: DesignerJobsService) => s.saveProgress('j1', 'worker-1', { stage: 'drawing', updatedAt: 'x' })],
    ['complete', (s: DesignerJobsService) => s.complete('j1', 'worker-1', { candidates: [], designer: true } as any, 3)],
    ['fail', (s: DesignerJobsService) => s.fail('j1', 'worker-1', { code: 'X', message: 'm', status: 500 })],
    ['markCancelled', (s: DesignerJobsService) => s.markCancelled('j1', 'worker-1')],
  ])('%s is conditional on the lease AND status running (a cancelled / re-queued row is never overwritten)', async (_name, call) => {
    const { client, service } = rawHarness();
    await expect(call(service)).resolves.toBe(true);
    expect(client.aiDesignerJob.updateMany.mock.calls[0][0].where).toEqual({ id: 'j1', leaseOwner: 'worker-1', status: 'running' });
    client.aiDesignerJob.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(call(service)).resolves.toBe(false);
  });

  it('complete stores the result, a terminal status and the final "done" progress', async () => {
    const { client, service } = rawHarness();
    await service.complete('j1', 'worker-1', { candidates: [], designer: true } as any, 3);
    const data = client.aiDesignerJob.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'done', result: { candidates: [], designer: true }, progress: { stage: 'done', of: 3 } });
    expect(data.finishedAt).toBeInstanceOf(Date);
  });

  it('sweepStale: re-queue ONCE (attempts < 2), then fail AI_DESIGN_JOB_STALLED; expire never-claimed jobs', async () => {
    const { client, service } = rawHarness();
    client.$executeRawUnsafe.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    await expect(service.sweepStale()).resolves.toEqual({ failed: 1, requeued: 2, expired: 0 });
    const [failSql, requeueSql, expireSql] = [0, 1, 2].map((i) => sqlOf(client.$executeRawUnsafe, i));
    // Stalled with its one re-queue spent → failed.
    expect(failSql).toContain(`SET "status" = 'failed'`);
    expect(failSql).toContain(`WHERE "status" = 'running' AND "heartbeat_at" < (NOW() AT TIME ZONE 'UTC') - ($1 * INTERVAL '1 millisecond') AND "attempts" >= $4`);
    expect(client.$executeRawUnsafe.mock.calls[0].slice(1)).toEqual([
      DESIGNER_JOB_STALE_MS,
      'AI_DESIGN_JOB_STALLED',
      expect.any(String),
      DESIGNER_JOB_MAX_ATTEMPTS,
    ]);
    // Stalled with a re-queue left → queued again, lease cleared.
    expect(requeueSql).toContain(`SET "status" = 'queued', "lease_owner" = NULL, "heartbeat_at" = NULL`);
    expect(requeueSql).toContain(`AND "attempts" < $2`);
    expect(client.$executeRawUnsafe.mock.calls[1].slice(1)).toEqual([DESIGNER_JOB_STALE_MS, DESIGNER_JOB_MAX_ATTEMPTS]);
    // Queued past the window → failed AI_DESIGN_JOB_EXPIRED.
    expect(expireSql).toContain(`WHERE "status" = 'queued' AND "created_at" < (NOW() AT TIME ZONE 'UTC') - ($1 * INTERVAL '1 millisecond')`);
    for (const sql of [failSql, requeueSql, expireSql]) expect(sql).not.toMatch(/NOW\(\)(?! AT TIME ZONE 'UTC')/);
    expect(client.$executeRawUnsafe.mock.calls[2].slice(1)).toEqual([DESIGNER_JOB_ACTIVE_WINDOW_MS, 'AI_DESIGN_JOB_EXPIRED', expect.any(String)]);
    expect(DESIGNER_JOB_STALE_MS).toBe(3 * 60_000);
    expect(DESIGNER_JOB_MAX_ATTEMPTS).toBe(2);
  });

  it('no statement uses a bare NOW(): the columns are naive UTC, so "now" must be too (session-zone independent)', () => {
    // Found by scripts/verify-designer-jobs-sql.ts on a Postgres whose session zone was not UTC:
    // bare NOW() put heartbeat_at seven hours away from Prisma's created_at and the sweep broke.
    const src = fs
      .readFileSync(path.join(__dirname, 'designer-jobs.service.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(src.match(/NOW\(\)(?! AT TIME ZONE 'UTC')/g) ?? []).toEqual([]);
    expect(src).toContain("const DB_NOW_UTC = `(NOW() AT TIME ZONE 'UTC')`;");
  });

  it('release (graceful shutdown): this worker\'s running jobs go back to the queue with their attempt given back', async () => {
    const { client, service } = rawHarness();
    client.$executeRawUnsafe.mockResolvedValueOnce(2);
    await expect(service.release('worker-1')).resolves.toBe(2);
    const sql = sqlOf(client.$executeRawUnsafe);
    expect(sql).toContain(`SET "status" = 'queued'`);
    expect(sql).toContain(`"attempts" = GREATEST("attempts" - 1, 0)`);
    expect(sql).toContain(`WHERE "lease_owner" = $1 AND "status" = 'running'`);
    expect(client.$executeRawUnsafe.mock.calls[0][1]).toBe('worker-1');
  });
});
