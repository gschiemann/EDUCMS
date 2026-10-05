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

  // 2026-10-05 — the upload stamped the video "converting" because this queue
  // was about to take it. A queue that refuses must not leave that forever.
  describe('a refused enqueue settles the upload’s "converting" stamp', () => {
    const PENDING = {
      version: 1,
      ready: false,
      pending: true,
      issues: ['codec', 'hdr'],
      checkedAt: '2026-10-05T09:00:00.000Z',
    };
    const withAsset = (processingMeta: unknown) => {
      const prisma = makePrisma();
      prisma.client.videoTranscodeJob.createMany.mockRejectedValueOnce(new Error('EMAXCONNSESSION'));
      prisma.client.asset = {
        findFirst: jest.fn(async () => ({ fileUrl: 'https://x/a1.mp4', processingMeta })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      };
      return prisma;
    };
    const input = { tenantId: 't1', assetId: 'a1', sourceUrl: 'https://x/a1.mp4', sourceBytes: 1 };

    it('→ { ready: false, the issues, error: "not-queued" } — no "pending" that nothing would ever finish', async () => {
      const prisma = withAsset({ probe: { codec: 'hevc' }, screen: PENDING });
      expect(await new VideoTranscodeService(prisma).enqueue(input)).toBe(false);
      expect(prisma.client.asset.findFirst.mock.calls[0][0].where).toEqual({ id: 'a1', tenantId: 't1' });
      const write = prisma.client.asset.updateMany.mock.calls[0][0];
      expect(write.where).toEqual({ id: 'a1', tenantId: 't1', fileUrl: 'https://x/a1.mp4' });
      expect(write.data.processingMeta).toEqual({
        probe: { codec: 'hevc' },
        screen: {
          version: 1,
          ready: false,
          issues: ['codec', 'hdr'],
          error: 'not-queued',
          checkedAt: expect.any(String),
        },
      });
    });

    it('a row that is not pending (a screen-safe upload) is left alone', async () => {
      const prisma = withAsset({ screen: { version: 1, ready: true, checkedAt: 'x' } });
      await new VideoTranscodeService(prisma).enqueue(input);
      expect(prisma.client.asset.updateMany).not.toHaveBeenCalled();
    });

    it('a settle that fails too still never throws (the database may be what failed)', async () => {
      const prisma = withAsset({ screen: PENDING });
      prisma.client.asset.updateMany.mockRejectedValueOnce(new Error('db down'));
      await expect(new VideoTranscodeService(prisma).enqueue(input)).resolves.toBe(false);
    });

    it('a successful enqueue never touches the stamp', async () => {
      const prisma = withAsset({ screen: PENDING });
      prisma.client.videoTranscodeJob.createMany.mockReset();
      prisma.client.videoTranscodeJob.createMany.mockResolvedValue({ count: 1 });
      expect(await new VideoTranscodeService(prisma).enqueue(input)).toBe(true);
      expect(prisma.client.asset.findFirst).not.toHaveBeenCalled();
      expect(prisma.client.asset.updateMany).not.toHaveBeenCalled();
    });
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

  it('finishedJobsWithPendingVerdict: FINISHED jobs only, the asset joined by id AND tenant, pending stamps only, never alert media, bounded', async () => {
    const prisma = makePrisma();
    prisma.client.$queryRawUnsafe.mockResolvedValueOnce([
      { id: 'j1', tenantId: 't1', assetId: 'a1', reason: 'stalled' },
      { id: 'j2', tenantId: 't1', assetId: null, reason: 'expired' },
    ]);
    const svc = new VideoTranscodeService(prisma);
    expect(await svc.finishedJobsWithPendingVerdict(10_000)).toEqual([
      { id: 'j1', tenantId: 't1', assetId: 'a1', reason: 'stalled' },
    ]);
    const [sql, limit] = prisma.client.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain(`j."status" IN ('done', 'skipped', 'failed')`);
    expect(sql).toContain(`a."id" = j."asset_id" AND a."tenant_id" = j."tenant_id"`);
    expect(sql).toContain(`(a."processing_meta" -> 'screen' ->> 'pending') = 'true'`);
    expect(sql).toContain(`<> 'emergency-content'`);
    expect(sql).toContain('LIMIT $1');
    expect(limit).toBe(500);
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
