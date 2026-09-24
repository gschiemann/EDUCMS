/**
 * VideoTranscodeWorker — claim discipline, lease loss, shutdown hand-back and
 * the ONLY destructive step in the feature: deleting a swapped-out original
 * (2026-09-23). The service and pipeline are fakes; the SQL itself is proven on
 * a real Postgres by scripts/verify-video-transcode-sql.ts.
 */
import {
  VideoTranscodeWorker,
  nextTranscodePollDelay,
  TRANSCODE_POLL_BASE_MS,
  TRANSCODE_POLL_IDLE_CEILING_MS,
} from './video-transcode.worker';
import {
  ORIGINAL_RECHECK_MS,
  ORIGINAL_UNKNOWN_RECHECK_MS,
  type ClaimedTranscodeJob,
  type TranscodeOutcome,
} from './video-transcode.service';

const JOB: ClaimedTranscodeJob = {
  id: 'job-1',
  tenantId: 'tenant-1',
  assetId: 'asset-1',
  sourceUrl:
    'https://example.supabase.co/storage/v1/object/public/assets/tenant-1/0f6b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d.mp4',
  sourceBytes: 1000,
  attempts: 1,
};

function makeJobs(over: Partial<Record<string, any>> = {}) {
  return {
    pendingWork: jest.fn(async () => ({
      queued: true,
      stale: false,
      originalDue: false,
    })),
    sweepStale: jest.fn(async () => ({ requeued: 0, failed: 0, expired: 0 })),
    claimNext: jest.fn(async () => JOB),
    heartbeat: jest.fn(async (_o: string, ids: string[]) => ids),
    saveProgress: jest.fn(async () => true),
    finish: jest.fn(async () => true),
    release: jest.fn(async () => 1),
    claimDueOriginal: jest.fn(async () => null),
    markOriginalDeleted: jest.fn(async () => undefined),
    deferOriginal: jest.fn(async () => undefined),
    onQueued: jest.fn(() => () => undefined),
    ...over,
  } as any;
}

function makeWorker(
  opts: {
    jobs?: any;
    process?: (job: ClaimedTranscodeJob, ctx: any) => Promise<TranscodeOutcome>;
    ffmpeg?: boolean;
    storage?: any;
  } = {},
) {
  const jobs = opts.jobs ?? makeJobs();
  const pipeline = {
    ffmpegAvailable: jest.fn(async () => opts.ffmpeg ?? true),
    process: jest.fn(
      opts.process ??
        (async () =>
          ({
            status: 'done',
            reason: 'swapped',
            outputUrl: 'u',
            outputBytes: 10,
          }) as TranscodeOutcome),
    ),
  } as any;
  const storage =
    opts.storage ??
    ({
      extractPath: (u: string) => u.split('/public/assets/')[1] ?? null,
      delete: jest.fn(async () => undefined),
      assertObjectExists: jest.fn(async () => {
        throw new Error('gone');
      }),
    } as any);
  const prisma = {
    client: { auditLog: { create: jest.fn(async () => ({})) } },
  } as any;
  const worker = new VideoTranscodeWorker(jobs, pipeline, storage, prisma);
  return { worker, jobs, pipeline, storage, prisma };
}

describe('nextTranscodePollDelay', () => {
  it('base after work, doubling while idle, capped', () => {
    expect(nextTranscodePollDelay(40_000, true)).toBe(TRANSCODE_POLL_BASE_MS);
    expect(nextTranscodePollDelay(TRANSCODE_POLL_BASE_MS, false)).toBe(
      TRANSCODE_POLL_BASE_MS * 2,
    );
    expect(nextTranscodePollDelay(50_000, false)).toBe(
      TRANSCODE_POLL_IDLE_CEILING_MS,
    );
  });
});

describe('VideoTranscodeWorker.tick — one transcode per replica', () => {
  it('claims one job and runs it; a second tick while busy claims nothing', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { worker, jobs, pipeline } = makeWorker({
      process: async () => {
        await gate;
        return { status: 'done', reason: 'swapped' };
      },
    });
    expect(await worker.tick()).toEqual({ claimed: true });
    expect(worker.busy).toBe(true);
    expect(await worker.tick()).toEqual({ claimed: false });
    expect(jobs.claimNext).toHaveBeenCalledTimes(1);
    release();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(pipeline.process).toHaveBeenCalledTimes(1);
    expect(jobs.finish).toHaveBeenCalledWith('job-1', worker.owner, {
      status: 'done',
      reason: 'swapped',
    });
    expect(worker.busy).toBe(false);
  });

  it('claims NOTHING on a replica without ffmpeg (the rows wait for one that has it)', async () => {
    const { worker, jobs } = makeWorker({ ffmpeg: false });
    expect(await worker.tick()).toEqual({ claimed: false });
    expect(await worker.tick()).toEqual({ claimed: false });
    expect(jobs.claimNext).not.toHaveBeenCalled();
  });

  it('an idle replica pays one cheap read and nothing else', async () => {
    const jobs = makeJobs({
      pendingWork: jest.fn(async () => ({
        queued: false,
        stale: false,
        originalDue: false,
      })),
    });
    const { worker, pipeline } = makeWorker({ jobs });
    expect(await worker.tick()).toEqual({ claimed: false });
    expect(jobs.claimNext).not.toHaveBeenCalled();
    expect(jobs.sweepStale).not.toHaveBeenCalled();
    expect(pipeline.ffmpegAvailable).not.toHaveBeenCalled();
  });

  it('sweeps stale jobs when the probe says so', async () => {
    const jobs = makeJobs({
      pendingWork: jest.fn(async () => ({
        queued: false,
        stale: true,
        originalDue: false,
      })),
    });
    const { worker } = makeWorker({ jobs });
    await worker.tick();
    expect(jobs.sweepStale).toHaveBeenCalledTimes(1);
  });

  it('a tick that throws never throws out of the loop', async () => {
    const jobs = makeJobs({
      pendingWork: jest.fn(async () => {
        throw new Error('db down');
      }),
    });
    const { worker } = makeWorker({ jobs });
    await expect(worker.tick()).resolves.toEqual({ claimed: false });
  });
});

describe('VideoTranscodeWorker.run — lease discipline', () => {
  it('an aborted run (shutdown / lease lost) writes NO outcome — the row was already handed back', async () => {
    const { worker, jobs } = makeWorker({
      process: async () => ({ status: 'failed', reason: 'aborted' }),
    });
    await worker.run(JOB);
    expect(jobs.finish).not.toHaveBeenCalled();
  });

  it('a lost heartbeat aborts the running transcode', async () => {
    let seenSignal: AbortSignal | null = null;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const jobs = makeJobs({ heartbeat: jest.fn(async () => []) });
    const { worker } = makeWorker({
      jobs,
      process: async (_j, ctx) => {
        seenSignal = ctx.signal;
        await gate;
        return { status: 'failed', reason: 'aborted' };
      },
    });
    const running = worker.run(JOB);
    await worker.heartbeatNow();
    expect(seenSignal!.aborted).toBe(true);
    release();
    await running;
  });

  it('progress writes are throttled and a "not ours" answer aborts the run', async () => {
    let seenSignal: AbortSignal | null = null;
    const jobs = makeJobs({ saveProgress: jest.fn(async () => false) });
    const { worker } = makeWorker({
      jobs,
      process: async (_j, ctx) => {
        seenSignal = ctx.signal;
        ctx.onProgress(10);
        ctx.onProgress(11); // inside the 5 s gap — not written
        ctx.onProgress(12);
        await new Promise((r) => setImmediate(r));
        return { status: 'failed', reason: 'aborted' };
      },
    });
    await worker.run(JOB);
    expect(jobs.saveProgress).toHaveBeenCalledTimes(1);
    expect(jobs.saveProgress).toHaveBeenCalledWith('job-1', worker.owner, 10);
    expect(seenSignal!.aborted).toBe(true);
  });

  it('shutdown hands the running job back FIRST, then aborts ffmpeg', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const jobs = makeJobs({
      release: jest.fn(async () => {
        order.push('release');
        return 1;
      }),
    });
    const { worker } = makeWorker({
      jobs,
      process: async (_j, ctx) => {
        ctx.signal.addEventListener('abort', () => order.push('abort'));
        await gate;
        return { status: 'failed', reason: 'aborted' };
      },
    });
    const running = worker.run(JOB);
    await worker.onModuleDestroy();
    expect(order).toEqual(['release', 'abort']);
    release();
    await running;
    expect(jobs.finish).not.toHaveBeenCalled();
  });
});

describe('VideoTranscodeWorker.sweepOneOriginal — the only destructive step', () => {
  const due = {
    id: 'job-9',
    tenantId: 'tenant-1',
    assetId: 'asset-1',
    sourceUrl: JOB.sourceUrl,
  };

  it('an unreferenced original is deleted, PROVEN gone, stamped and audited', async () => {
    const jobs = makeJobs({ claimDueOriginal: jest.fn(async () => due) });
    const { worker, storage, prisma } = makeWorker({ jobs });
    worker.scanReferences = jest.fn(
      async () => ({ status: 'unreferenced', tablesScanned: 54 }) as const,
    );
    expect(await worker.sweepOneOriginal()).toBe('deleted');
    expect(worker.scanReferences).toHaveBeenCalledWith(
      '0f6b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d.mp4',
    );
    expect(storage.delete).toHaveBeenCalledWith(
      'tenant-1/0f6b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d.mp4',
    );
    expect(jobs.markOriginalDeleted).toHaveBeenCalledWith('job-9');
    expect(prisma.client.auditLog.create.mock.calls[0][0].data.action).toBe(
      'ASSET_VIDEO_ORIGINAL_DELETED',
    );
  });

  it('NEGATIVE CONTROL: a referenced original (a template embedded its URL) is KEPT and re-checked in a week', async () => {
    const jobs = makeJobs({ claimDueOriginal: jest.fn(async () => due) });
    const { worker, storage } = makeWorker({ jobs });
    worker.scanReferences = jest.fn(
      async () =>
        ({
          status: 'referenced',
          table: 'template_zones',
          column: 'default_config',
        }) as const,
    );
    expect(await worker.sweepOneOriginal()).toBe('kept');
    expect(storage.delete).not.toHaveBeenCalled();
    expect(jobs.deferOriginal).toHaveBeenCalledWith(
      'job-9',
      ORIGINAL_RECHECK_MS,
      'kept: referenced by template_zones.default_config',
    );
  });

  it('a scan that cannot finish keeps the original (fail closed) and retries tomorrow', async () => {
    const jobs = makeJobs({ claimDueOriginal: jest.fn(async () => due) });
    const { worker, storage } = makeWorker({ jobs });
    worker.scanReferences = jest.fn(async () => {
      throw new Error('statement timeout');
    });
    expect(await worker.sweepOneOriginal()).toBe('kept');
    expect(storage.delete).not.toHaveBeenCalled();
    expect(jobs.deferOriginal.mock.calls[0][1]).toBe(
      ORIGINAL_UNKNOWN_RECHECK_MS,
    );
  });

  it('a delete that did not take is never recorded as deleted', async () => {
    const jobs = makeJobs({ claimDueOriginal: jest.fn(async () => due) });
    const storage = {
      extractPath: (u: string) => u.split('/public/assets/')[1] ?? null,
      delete: jest.fn(async () => undefined),
      assertObjectExists: jest.fn(async () => undefined), // still there
    };
    const { worker } = makeWorker({ jobs, storage });
    worker.scanReferences = jest.fn(
      async () => ({ status: 'unreferenced', tablesScanned: 54 }) as const,
    );
    expect(await worker.sweepOneOriginal()).toBe('kept');
    expect(jobs.markOriginalDeleted).not.toHaveBeenCalled();
    expect(jobs.deferOriginal.mock.calls[0][2]).toBe(
      'kept: storage delete did not take',
    );
  });

  it('nothing due → nothing scanned', async () => {
    const { worker } = makeWorker();
    worker.scanReferences = jest.fn();
    expect(await worker.sweepOneOriginal()).toBe('none');
    expect(worker.scanReferences).not.toHaveBeenCalled();
  });
});
