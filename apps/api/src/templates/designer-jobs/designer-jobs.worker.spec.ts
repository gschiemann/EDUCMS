/**
 * DesignerJobsWorker (2026-09-23) — claims, runs, heartbeats, cancels, fails, releases.
 *
 * The AI pipeline is a fake that honours the REAL hooks contract (designer-generation-hooks.ts):
 * it reports progress through `onProgress` and checks the signal BETWEEN stages with the real
 * `throwIfCancelled`, so a cancellation here takes the same path it takes in AiService. Its
 * return value is typed against `AiService.generateDesignerBoardCandidates`.
 */
import { BadRequestException, HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { throwIfCancelled, type DesignerGenerationHooks } from '../../ai/designer-generation-hooks';
import {
  DesignerJobsWorker,
  ThrottledProgressWriter,
  nextDesignerJobPollDelay,
  DESIGNER_JOB_POLL_BASE_MS,
  DESIGNER_JOB_POLL_IDLE_CEILING_MS,
  DESIGNER_JOBS_PER_REPLICA,
} from './designer-jobs.worker';
import type { ClaimedDesignerJob } from './designer-jobs.service';
import { designerJobResult, type DesignerGenerateOutput, type DesignerJobRequest } from './designer-job-request';

const REQUEST = {
  prompt: 'Super Taco menu',
  palette: ['#d83c21'],
  purpose: 'menu',
  siteMenuMissing: true,
  posSelection: { connectionId: 'conn-1', sections: ['Tacos'] },
  theme: 'Bold',
  requestVersion: 1,
} as unknown as DesignerJobRequest;

const JOB: ClaimedDesignerJob = { id: 'job-1', tenantId: 't-alpha', userId: 'u-1', request: REQUEST, attempts: 1 };

const OUT: DesignerGenerateOutput = {
  candidates: [
    {
      name: 'Super Taco',
      html: '<!doctype html><html><head></head><body><div class="stage"><h1 data-field="headline">Tacos</h1></div></body></html>',
      screenWidth: 1920,
      screenHeight: 1080,
      taurusWarnings: [],
      artDirection: 'Rail + cards',
      structure: 'rail-cards',
    },
  ],
  batchId: 'batch-1',
  source: 'tenant',
  usage: null,
};

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setImmediate(r));
/** Drain the microtask queue (fake timers also fake setImmediate). */
const ticks = async (n = 12) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

function makeJobs(over: Record<string, jest.Mock> = {}) {
  const listeners: { queued: Array<() => void>; cancelled: Array<(id: string) => void> } = { queued: [], cancelled: [] };
  const jobs = {
    onQueued: jest.fn((fn: () => void) => {
      listeners.queued.push(fn);
      return () => undefined;
    }),
    onCancelled: jest.fn((fn: (id: string) => void) => {
      listeners.cancelled.push(fn);
      return () => undefined;
    }),
    pendingWork: jest.fn(async () => ({ queued: false, stale: false })),
    sweepStale: jest.fn(async () => ({ requeued: 0, failed: 0, expired: 0 })),
    claimNext: jest.fn(async () => null as ClaimedDesignerJob | null),
    heartbeat: jest.fn(async (_owner: string, ids: string[]) => ids),
    saveProgress: jest.fn(async () => true),
    complete: jest.fn(async () => true),
    fail: jest.fn(async () => true),
    markCancelled: jest.fn(async () => true),
    release: jest.fn(async () => 0),
    ...over,
  };
  return { jobs, listeners };
}

/** A fake pipeline: drawing → (gate) → cancellation point → reviewing → done, like AiService. */
function makeAi(gate?: Promise<void>, fail?: unknown) {
  const calls: Array<{ opts: any; hooks: DesignerGenerationHooks }> = [];
  const ai = {
    generateDesignerBoardCandidates: jest.fn(async (opts: any, hooks: DesignerGenerationHooks) => {
      calls.push({ opts, hooks });
      throwIfCancelled(hooks);
      hooks.onProgress?.({ stage: 'drawing', of: 3 });
      if (gate) await gate;
      if (fail) throw fail;
      throwIfCancelled(hooks);
      hooks.onProgress?.({ stage: 'reviewing', candidate: 2, of: 3 });
      hooks.onProgress?.({ stage: 'done', of: 3 });
      return OUT;
    }),
  };
  return { ai, calls };
}

function makeWorker(jobsOver: Record<string, jest.Mock> = {}, gate?: Promise<void>, fail?: unknown) {
  const { jobs, listeners } = makeJobs(jobsOver);
  const { ai, calls } = makeAi(gate, fail);
  const worker = new DesignerJobsWorker(jobs as any, ai as any);
  return { worker, jobs, ai, calls, listeners };
}

describe('nextDesignerJobPollDelay — 2 s while busy, doubling to 30 s while idle', () => {
  it('backs off and snaps back', () => {
    const seen: number[] = [];
    let d = DESIGNER_JOB_POLL_BASE_MS;
    for (let i = 0; i < 6; i++) seen.push((d = nextDesignerJobPollDelay(d, false)));
    expect(seen).toEqual([4000, 8000, 16000, 30000, 30000, 30000]);
    expect(nextDesignerJobPollDelay(30000, true)).toBe(DESIGNER_JOB_POLL_BASE_MS);
    expect(DESIGNER_JOB_POLL_IDLE_CEILING_MS).toBe(30000);
  });
});

describe('ThrottledProgressWriter — at most one write per 500 ms, latest wins, in order', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('writes the first event now, coalesces a burst, and writes the latest when the gap closes', async () => {
    let now = 10_000;
    const writes: Array<{ stage: string; candidate?: number }> = [];
    const w = new ThrottledProgressWriter(async (p) => {
      writes.push({ stage: p.stage, ...(p.candidate ? { candidate: p.candidate } : {}) });
    }, 500, () => now);
    w.push({ stage: 'drawing', of: 3 });
    await ticks();
    expect(writes).toEqual([{ stage: 'drawing' }]);
    now += 100;
    w.push({ stage: 'rendering', candidate: 1 });
    now += 100;
    w.push({ stage: 'reviewing', candidate: 1 });
    now += 100;
    w.push({ stage: 'reviewing', candidate: 2 });
    expect(writes).toHaveLength(1); // held
    jest.advanceTimersByTime(399); // armed for lastWrite + 500 − now(10_100) = 400 ms
    await ticks();
    expect(writes).toHaveLength(1);
    now = 10_500;
    jest.advanceTimersByTime(1);
    await ticks();
    expect(writes).toEqual([{ stage: 'drawing' }, { stage: 'reviewing', candidate: 2 }]);
  });

  it('stop() drops a held event and waits for the in-flight write', async () => {
    let now = 0;
    const gate = deferred();
    const writes: string[] = [];
    const w = new ThrottledProgressWriter(async (p) => {
      await gate.promise;
      writes.push(p.stage);
    }, 500, () => now);
    w.push({ stage: 'drawing' });
    now = 10;
    w.push({ stage: 'binding' }); // held
    let stopped = false;
    const done = w.stop().then(() => (stopped = true));
    await Promise.resolve();
    expect(stopped).toBe(false); // still waiting on the in-flight 'drawing'
    gate.resolve();
    await done;
    jest.advanceTimersByTime(1000);
    expect(writes).toEqual(['drawing']);
  });

  it('a failing write never throws out of push/stop', async () => {
    const w = new ThrottledProgressWriter(async () => {
      throw new Error('db down');
    });
    w.push({ stage: 'drawing' });
    await expect(w.stop()).resolves.toBeUndefined();
  });
});

describe('DesignerJobsWorker.run', () => {
  it('runs the job through AiService with the options the sync endpoint would build + the hooks, then stores the sync-shaped result', async () => {
    const { worker, jobs, calls } = makeWorker();
    await worker.run(JOB);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts).toMatchObject({
      tenantId: 't-alpha',
      userId: 'u-1',
      prompt: 'Super Taco menu',
      palette: ['#d83c21'],
      purpose: 'menu',
      siteMenuMissing: true,
      sampleMenu: false,
      posSelection: { connectionId: 'conn-1', sections: ['Tacos'] },
    });
    expect(calls[0].opts).not.toHaveProperty('theme'); // intake junk never reaches the service
    expect(calls[0].opts).not.toHaveProperty('requestVersion');
    expect(calls[0].hooks.signal).toBeInstanceOf(AbortSignal);
    expect(typeof calls[0].hooks.onProgress).toBe('function');
    expect(jobs.complete).toHaveBeenCalledWith('job-1', worker.owner, designerJobResult(OUT), 3);
    expect(jobs.fail).not.toHaveBeenCalled();
    expect(jobs.saveProgress).toHaveBeenCalledWith('job-1', worker.owner, expect.objectContaining({ stage: 'drawing', of: 3 }));
    expect(worker.runningCount).toBe(0);
  });

  it.each<[string, unknown, { status: number; code: string; message: string }]>([
    [
      'the platform allowance (402 AI_CAP_REACHED)',
      new HttpException({ code: 'AI_CAP_REACHED', message: "This month's included AI is used up." }, HttpStatus.PAYMENT_REQUIRED),
      { status: 402, code: 'AI_CAP_REACHED', message: "This month's included AI is used up." },
    ],
    [
      'a POS menu that cannot bind (422 MENU_BINDING_INCOMPLETE)',
      new HttpException({ code: 'MENU_BINDING_INCOMPLETE', message: "21 items don't fit one screen — choose fewer sections." }, HttpStatus.UNPROCESSABLE_ENTITY),
      { status: 422, code: 'MENU_BINDING_INCOMPLETE', message: "21 items don't fit one screen — choose fewer sections." },
    ],
    [
      'the hourly cap (a string BadRequestException, as AiService throws it)',
      new BadRequestException('Hit the hourly AI cap (30 generations/hour). Try again later or contact sales for a higher tier.'),
      { status: 400, code: 'Bad Request', message: 'Hit the hourly AI cap (30 generations/hour). Try again later or contact sales for a higher tier.' },
    ],
    [
      'the kill switch (503 AI_DESIGNER_DISABLED)',
      new ServiceUnavailableException({ code: 'AI_DESIGNER_DISABLED', message: 'The AI Designer is temporarily disabled by the administrator.' }),
      { status: 503, code: 'AI_DESIGNER_DISABLED', message: 'The AI Designer is temporarily disabled by the administrator.' },
    ],
  ])('a thrown %s is stored as the envelope the sync endpoint would have answered', async (_name, thrown, envelope) => {
    const { worker, jobs } = makeWorker({}, undefined, thrown);
    await worker.run(JOB);
    expect(jobs.fail).toHaveBeenCalledWith('job-1', worker.owner, envelope);
    expect(jobs.complete).not.toHaveBeenCalled();
    expect(jobs.markCancelled).not.toHaveBeenCalled();
  });

  it('a non-HTTP error in production stores the generic 500, never its internals', async () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { worker, jobs } = makeWorker({}, undefined, new Error('connect ECONNREFUSED 10.0.0.7:5432 password=hunter2'));
      await worker.run(JOB);
      expect(jobs.fail).toHaveBeenCalledWith('job-1', worker.owner, { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' });
    } finally {
      process.env.NODE_ENV = env;
    }
  });

  it('cancel on THIS replica aborts the run at the next stage boundary → markCancelled, no result stored', async () => {
    const gate = deferred();
    const { worker, jobs, listeners } = makeWorker({}, gate.promise);
    listeners.cancelled.length = 0;
    // start() subscribes the listeners; drive it without timers by subscribing the same way.
    (worker as any).stopped = false;
    (worker as any).unsubscribe.push(jobs.onCancelled((id: string) => (worker as any).running.get(id)?.abort()));
    const running = worker.run(JOB);
    await flush();
    expect(worker.runningCount).toBe(1);
    listeners.cancelled.forEach((fn) => fn('job-1'));
    gate.resolve();
    await running;
    expect(jobs.markCancelled).toHaveBeenCalledWith('job-1', worker.owner);
    expect(jobs.complete).not.toHaveBeenCalled();
    expect(jobs.fail).not.toHaveBeenCalled();
    (worker as any).stopped = true;
  });

  it('a lost lease (a progress write finds the job no longer ours) aborts the run too', async () => {
    const gate = deferred();
    const { worker, jobs } = makeWorker({ saveProgress: jest.fn(async () => false) }, gate.promise);
    const running = worker.run(JOB);
    await flush();
    gate.resolve();
    await running;
    expect(jobs.markCancelled).toHaveBeenCalledWith('job-1', worker.owner);
    expect(jobs.complete).not.toHaveBeenCalled();
  });

  it('a result that lands after a cancel is discarded quietly (the conditional complete matched nothing)', async () => {
    const { worker, jobs } = makeWorker({ complete: jest.fn(async () => false) });
    await expect(worker.run(JOB)).resolves.toBeUndefined();
    expect(jobs.fail).not.toHaveBeenCalled();
  });

  it('a DB error recording the outcome never escapes run() (the stale sweep recovers the row)', async () => {
    const { worker } = makeWorker({ complete: jest.fn(async () => { throw new Error('db down'); }), fail: jest.fn(async () => { throw new Error('db down'); }) });
    await expect(worker.run(JOB)).resolves.toBeUndefined();
    expect(worker.runningCount).toBe(0);
  });
});

describe('DesignerJobsWorker.tick — probe, sweep, claim ONE', () => {
  it('idle: one probe, no sweep, no claim', async () => {
    const { worker, jobs } = makeWorker();
    await expect(worker.tick()).resolves.toEqual({ claimed: false });
    expect(jobs.pendingWork).toHaveBeenCalledTimes(1);
    expect(jobs.sweepStale).not.toHaveBeenCalled();
    expect(jobs.claimNext).not.toHaveBeenCalled();
  });

  it('stale work is swept before the claim', async () => {
    const { worker, jobs } = makeWorker({ pendingWork: jest.fn(async () => ({ queued: false, stale: true })) });
    await worker.tick();
    expect(jobs.sweepStale).toHaveBeenCalledTimes(1);
    expect(jobs.claimNext).toHaveBeenCalledWith(worker.owner);
    expect(jobs.sweepStale.mock.invocationCallOrder[0]).toBeLessThan(jobs.claimNext.mock.invocationCallOrder[0]);
  });

  it('claims ONE queued job and starts it without waiting for it', async () => {
    const gate = deferred();
    const { worker, jobs, ai } = makeWorker(
      { pendingWork: jest.fn(async () => ({ queued: true, stale: false })), claimNext: jest.fn(async () => JOB) },
      gate.promise,
    );
    await expect(worker.tick()).resolves.toEqual({ claimed: true });
    expect(jobs.claimNext).toHaveBeenCalledTimes(1);
    await flush();
    expect(ai.generateDesignerBoardCandidates).toHaveBeenCalledTimes(1);
    expect(worker.runningCount).toBe(1); // still running — tick did not wait
    gate.resolve();
    await flush();
    await flush();
    expect(worker.runningCount).toBe(0);
  });

  it(`at ${DESIGNER_JOBS_PER_REPLICA} running jobs a replica claims nothing (and pays no probe)`, async () => {
    const gate = deferred();
    let n = 0;
    const { worker, jobs } = makeWorker(
      {
        pendingWork: jest.fn(async () => ({ queued: true, stale: false })),
        claimNext: jest.fn(async () => ({ ...JOB, id: `job-${++n}` })),
      },
      gate.promise,
    );
    for (let i = 0; i < DESIGNER_JOBS_PER_REPLICA; i++) await worker.tick();
    expect(worker.runningCount).toBe(DESIGNER_JOBS_PER_REPLICA);
    jobs.pendingWork.mockClear();
    await expect(worker.tick()).resolves.toEqual({ claimed: false });
    expect(jobs.pendingWork).not.toHaveBeenCalled();
    gate.resolve();
    await flush();
    await flush();
  });

  it('a probe error is logged, never thrown', async () => {
    const { worker } = makeWorker({ pendingWork: jest.fn(async () => { throw new Error('pool timeout'); }) });
    await expect(worker.tick()).resolves.toEqual({ claimed: false });
  });
});

describe('DesignerJobsWorker heartbeat + lifecycle', () => {
  it('heartbeats exactly the jobs it is running and aborts one whose lease is gone', async () => {
    const gates = [deferred(), deferred()];
    let i = 0;
    const { jobs, ai } = makeJobs() as any;
    void ai;
    const heartbeat = jest.fn(async () => ['job-a']); // job-b was cancelled elsewhere / re-queued
    const pipelines: DesignerGenerationHooks[] = [];
    const fakeAi = {
      generateDesignerBoardCandidates: jest.fn(async (_opts: any, hooks: DesignerGenerationHooks) => {
        pipelines.push(hooks);
        await gates[i++].promise;
        throwIfCancelled(hooks);
        return OUT;
      }),
    };
    const worker = new DesignerJobsWorker({ ...jobs, heartbeat } as any, fakeAi as any);
    const a = worker.run({ ...JOB, id: 'job-a' });
    const b = worker.run({ ...JOB, id: 'job-b' });
    await flush();
    await worker.heartbeatNow();
    expect(heartbeat).toHaveBeenCalledWith(worker.owner, ['job-a', 'job-b']);
    expect(pipelines[0].signal?.aborted).toBe(false);
    expect(pipelines[1].signal?.aborted).toBe(true);
    gates.forEach((g) => g.resolve());
    await Promise.all([a, b]);
  });

  it('no running jobs → no heartbeat query', async () => {
    const { worker, jobs } = makeWorker();
    await worker.heartbeatNow();
    expect(jobs.heartbeat).not.toHaveBeenCalled();
  });

  it('is disabled under NODE_ENV=test (no timers, no subscriptions)', () => {
    const { worker, jobs } = makeWorker();
    worker.onModuleInit();
    expect(jobs.onQueued).not.toHaveBeenCalled();
    expect((worker as any).timer).toBeNull();
  });

  it('shutdown hands running jobs back to the queue BEFORE aborting them', async () => {
    const gate = deferred();
    const { worker, jobs } = makeWorker({ release: jest.fn(async () => 1) }, gate.promise);
    const run = worker.run(JOB);
    await flush();
    await worker.onModuleDestroy();
    expect(jobs.release).toHaveBeenCalledWith(worker.owner);
    gate.resolve();
    await run;
    // The abort came after the release, so the cancelled-write targets a row that is no longer ours.
    expect(jobs.release.mock.invocationCallOrder[0]).toBeLessThan(jobs.markCancelled.mock.invocationCallOrder[0]);
  });

  it('a started worker wakes on a local create and claims at once', async () => {
    jest.useFakeTimers();
    try {
      const { worker, jobs, listeners } = makeWorker({ pendingWork: jest.fn(async () => ({ queued: true, stale: false })), claimNext: jest.fn(async () => null) });
      worker.start();
      expect(jobs.onQueued).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(0); // the first tick runs immediately
      const probes = jobs.pendingWork.mock.calls.length;
      await jest.advanceTimersByTimeAsync(1_000);
      expect(jobs.pendingWork.mock.calls.length).toBe(probes); // idle backoff: nothing yet
      listeners.queued.forEach((fn) => fn());
      await jest.advanceTimersByTimeAsync(0);
      expect(jobs.pendingWork.mock.calls.length).toBe(probes + 1);
      await worker.onModuleDestroy();
    } finally {
      jest.useRealTimers();
    }
  });
});
