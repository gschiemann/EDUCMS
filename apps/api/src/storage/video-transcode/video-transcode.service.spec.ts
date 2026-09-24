/**
 * VideoTranscodeService — the statement SHAPES and the never-throw enqueue
 * (2026-09-23). Real-Postgres behaviour (SKIP LOCKED under concurrency, the
 * unique asset_id, ON DELETE SET NULL, the naive-UTC clock) is proven by
 * scripts/verify-video-transcode-sql.ts on a scratch database.
 */
import {
  VideoTranscodeService,
  TRANSCODE_STALE_MS,
  TRANSCODE_MAX_ATTEMPTS,
} from './video-transcode.service';

function makePrisma() {
  return {
    client: {
      videoTranscodeJob: {
        createMany: jest.fn(async () => ({ count: 1 })),
        findMany: jest.fn(async () => []),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      $queryRawUnsafe: jest.fn(async () => []),
      $executeRawUnsafe: jest.fn(async () => 0),
    },
  } as any;
}

describe('VideoTranscodeService.enqueue', () => {
  const OLD = process.env.VIDEO_TRANSCODE_DISABLED;
  afterEach(() => {
    if (OLD === undefined) delete process.env.VIDEO_TRANSCODE_DISABLED;
    else process.env.VIDEO_TRANSCODE_DISABLED = OLD;
  });

  it('is idempotent per asset by construction (createMany + skipDuplicates → ON CONFLICT DO NOTHING)', async () => {
    const prisma = makePrisma();
    const svc = new VideoTranscodeService(prisma);
    const woke = jest.fn();
    svc.onQueued(woke);
    expect(
      await svc.enqueue({
        tenantId: 't1',
        assetId: 'a1',
        sourceUrl: 'https://x/a1.mp4',
        sourceBytes: 1234,
      }),
    ).toBe(true);
    expect(prisma.client.videoTranscodeJob.createMany).toHaveBeenCalledWith({
      data: [
        {
          tenantId: 't1',
          assetId: 'a1',
          sourceUrl: 'https://x/a1.mp4',
          sourceBytes: 1234,
          status: 'queued',
        },
      ],
      skipDuplicates: true,
    });
    expect(woke).toHaveBeenCalledTimes(1);
  });

  it('NEVER throws — an upload must not fail because its optimization could not be queued', async () => {
    const prisma = makePrisma();
    prisma.client.videoTranscodeJob.createMany.mockRejectedValueOnce(
      new Error('relation "video_transcode_jobs" does not exist'),
    );
    const svc = new VideoTranscodeService(prisma);
    await expect(
      svc.enqueue({
        tenantId: 't1',
        assetId: 'a1',
        sourceUrl: 'u',
        sourceBytes: 1,
      }),
    ).resolves.toBe(false);
  });

  it('an out-of-range size is stored as unknown, never overflowing the int column', async () => {
    const prisma = makePrisma();
    const svc = new VideoTranscodeService(prisma);
    await svc.enqueue({
      tenantId: 't1',
      assetId: 'a1',
      sourceUrl: 'u',
      sourceBytes: 3 * 1024 ** 3,
    });
    expect(
      prisma.client.videoTranscodeJob.createMany.mock.calls[0][0].data[0]
        .sourceBytes,
    ).toBeNull();
  });

  it('VIDEO_TRANSCODE_DISABLED=1 queues nothing (subtractive kill switch)', async () => {
    process.env.VIDEO_TRANSCODE_DISABLED = '1';
    const prisma = makePrisma();
    const svc = new VideoTranscodeService(prisma);
    expect(
      await svc.enqueue({
        tenantId: 't1',
        assetId: 'a1',
        sourceUrl: 'u',
        sourceBytes: 1,
      }),
    ).toBe(false);
    expect(prisma.client.videoTranscodeJob.createMany).not.toHaveBeenCalled();
    process.env.VIDEO_TRANSCODE_DISABLED = 'nope';
    expect(VideoTranscodeService.disabled()).toBe(false);
  });
});

describe('VideoTranscodeService.statusForAssets', () => {
  it('always carries the caller tenant, and bounds the id list', async () => {
    const prisma = makePrisma();
    const svc = new VideoTranscodeService(prisma);
    const ids = Array.from({ length: 300 }, (_, i) => `a${i}`);
    await svc.statusForAssets('t1', [...ids, '', 'x'.repeat(100)]);
    const where =
      prisma.client.videoTranscodeJob.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('t1');
    expect(where.assetId.in).toHaveLength(200);
    expect(await svc.statusForAssets('', ['a1'])).toEqual([]);
  });
});

describe('VideoTranscodeService worker SQL shapes', () => {
  it('claimNext uses FOR UPDATE SKIP LOCKED on the oldest queued row and stamps the lease', async () => {
    const prisma = makePrisma();
    const svc = new VideoTranscodeService(prisma);
    await svc.claimNext('owner-1');
    const [sql, owner] = prisma.client.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain(`WHERE "status" = 'queued'`);
    expect(sql).toContain('ORDER BY "created_at" ASC');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain(`"lease_owner" = $1`);
    expect(sql).toContain(`(NOW() AT TIME ZONE 'UTC')`);
    expect(owner).toBe('owner-1');
  });

  it('every post-claim write is conditional on the lease', async () => {
    const prisma = makePrisma();
    const svc = new VideoTranscodeService(prisma);
    await svc.saveProgress('j1', 'o1', 150);
    await svc.finish('j1', 'o1', {
      status: 'failed',
      reason: 'ffmpeg-failed',
      error: 'x',
    });
    for (const [args] of prisma.client.videoTranscodeJob.updateMany.mock
      .calls) {
      expect(args.where).toEqual({
        id: 'j1',
        leaseOwner: 'o1',
        status: 'running',
      });
    }
    // progress is clamped below 100 (only completion writes 100)
    expect(
      prisma.client.videoTranscodeJob.updateMany.mock.calls[0][0].data.progress,
    ).toBe(99);
  });

  it('the stale sweep re-queues ONCE, then fails; queued rows expire', async () => {
    const prisma = makePrisma();
    const svc = new VideoTranscodeService(prisma);
    await svc.sweepStale();
    const [failSql, failStale, failMax] =
      prisma.client.$executeRawUnsafe.mock.calls[0];
    expect(failSql).toContain(`"reason" = 'stalled'`);
    expect(failSql).toContain('"attempts" >= $2');
    expect([failStale, failMax]).toEqual([
      TRANSCODE_STALE_MS,
      TRANSCODE_MAX_ATTEMPTS,
    ]);
    expect(prisma.client.$executeRawUnsafe.mock.calls[1][0]).toContain(
      `SET "status" = 'queued'`,
    );
    expect(prisma.client.$executeRawUnsafe.mock.calls[2][0]).toContain(
      `"reason" = 'expired'`,
    );
  });

  it('the retention claim is a SKIP LOCKED lease on a DONE row whose original is not yet deleted', async () => {
    const prisma = makePrisma();
    const svc = new VideoTranscodeService(prisma);
    await svc.claimDueOriginal();
    const [sql] = prisma.client.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain(`"status" = 'done'`);
    expect(sql).toContain('"original_deleted_at" IS NULL');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
  });
});
