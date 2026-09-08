/**
 * boot-readiness.spec.ts — P0-7 finding #3.
 *
 * THE GATE'S TWO OBLIGATIONS, and they pull in opposite directions:
 *
 *   1. Hold traffic off a cold process. An API restart under 1,000 screens
 *      failed 31 % of requests for ~20 s because Railway's healthcheck
 *      (`/api/v1/health`, deliberately always-200) went green the moment the
 *      port was bound — before the Prisma pool was warm or Redis connected.
 *
 *   2. NEVER become the thing that kills a deploy. CLAUDE.md's standing rule
 *      is that a DB blip must not be able to cycle a pod; `restartPolicyMaxRetries`
 *      is 10 and `healthcheckTimeout` is 300 s, so a gate that can re-close —
 *      or that never opens — is a far worse outage than a cold start.
 *
 * The latch is what reconciles them: one-way, and bounded by a ceiling.
 */

import { BootReadinessService, BOOT_READY_MAX_MS } from './boot-readiness.service';

function makeService(opts: {
  dbFails?: boolean;
  redisStatus?: string | null;
} = {}) {
  const queries: string[] = [];
  const prisma: any = {
    client: {
      $queryRaw: jest.fn(async () => {
        queries.push('SELECT 1');
        if (opts.dbFails) throw new Error('P1001 unreachable');
        return [{ '?column?': 1 }];
      }),
    },
  };
  const redis: any = {
    publisher: opts.redisStatus === null ? null : { status: opts.redisStatus ?? 'ready' },
  };
  const svc = new BootReadinessService(prisma, redis);
  (svc as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { svc, prisma, redis, queries };
}

describe('the boot latch', () => {
  it('starts CLOSED — a freshly constructed process is not ready', () => {
    const { svc } = makeService();
    expect(svc.isReady()).toBe(false);
    expect(svc.report().reason).toBe('booting');
  });

  it('opens once the DB answers and Redis is connected', async () => {
    const { svc } = makeService({ redisStatus: 'ready' });
    const report = await svc.probeOnce();
    expect(report.ready).toBe(true);
    expect(report.db).toBe('ok');
    expect(report.redis).toBe('ok');
    expect(report.readyAfterMs).not.toBeNull();
  });

  it('treats "no Redis configured" as ready, not as something to wait for', async () => {
    // CLAUDE.md: Redis missing → the API boots anyway, HTTP polling covers
    // realtime. Waiting for a client that does not exist would burn the whole
    // ceiling on every single-service deploy.
    const { svc } = makeService({ redisStatus: null });
    const report = await svc.probeOnce();
    expect(report.ready).toBe(true);
    expect(report.redis).toBe('off');
  });

  it('treats a Redis client that has GIVEN UP as ready too', async () => {
    const { svc } = makeService({ redisStatus: 'end' });
    expect((await svc.probeOnce()).ready).toBe(true);
  });

  it('stays CLOSED while the DB is unreachable', async () => {
    const { svc } = makeService({ dbFails: true });
    const report = await svc.probeOnce();
    expect(report.ready).toBe(false);
    expect(report.db).toBe('waiting');
  });

  it('stays CLOSED while Redis is still connecting', async () => {
    const { svc } = makeService({ redisStatus: 'connecting' });
    const report = await svc.probeOnce();
    expect(report.ready).toBe(false);
    expect(report.redis).toBe('waiting');
  });

  it('opens ANYWAY at the ceiling — a dead database must not freeze deploys', async () => {
    const { svc } = makeService({ dbFails: true });
    expect((await svc.probeOnce()).ready).toBe(false);
    // Pretend the ceiling has passed.
    (svc as any).startedAt = Date.now() - BOOT_READY_MAX_MS - 1;
    const report = await svc.probeOnce();
    expect(report.ready).toBe(true);
    expect(report.db).toBe('timeout');
    expect(report.reason).toContain('ceiling');
    expect((svc as any).logger.warn).toHaveBeenCalled();
  });

  it('is ONE-WAY: a DB that dies after the latch opened cannot re-close it', async () => {
    const { svc, prisma } = makeService();
    expect((await svc.probeOnce()).ready).toBe(true);

    prisma.client.$queryRaw = jest.fn(async () => {
      throw new Error('P1001 unreachable');
    });
    const after = await svc.probeOnce();
    expect(after.ready).toBe(true);
    expect(after.db).toBe('ok'); // the recorded boot verdict, not a live claim
    // …and it does not keep probing once latched.
    expect(prisma.client.$queryRaw).not.toHaveBeenCalled();
  });

  it('WARMS the pool: the probe opens several connections in parallel, not one', async () => {
    const { svc, prisma } = makeService();
    await svc.probeOnce();
    // $connect() opens ONE connection; the gate's whole point is that the
    // first screen after a deploy does not pay for opening the rest.
    expect((prisma.client.$queryRaw as jest.Mock).mock.calls.length).toBeGreaterThan(1);
  });

  it('shuts its retry timer down cleanly', async () => {
    const { svc } = makeService({ dbFails: true });
    svc.onModuleInit();
    svc.onApplicationShutdown();
    expect((svc as any).timer).toBeNull();
    expect((svc as any).stopped).toBe(true);
  });
});
