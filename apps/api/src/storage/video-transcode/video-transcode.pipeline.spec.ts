/**
 * VideoTranscodePipeline — every exit, and the negative controls the swap
 * depends on (2026-09-23). The process boundary (ffprobe/ffmpeg), storage and
 * Prisma are fakes; the probe fixtures are the REAL ffprobe output used in
 * transcode-profile.spec.ts, and the fake "encode" writes a real file of the
 * size a test wants, so the size / verify / upload / swap logic runs for real.
 *
 * Pinned:
 *   • the swap happens ONLY when the output is smaller AND verified complete,
 *     is conditional on the asset still serving the source and not being in a
 *     protected playlist, and writes the NEW file's hash;
 *   • never a swap when the output is larger, truncated, or ffmpeg fails —
 *     the original keeps serving and gets its own hash recorded;
 *   • emergency media is never downloaded, let alone swapped (before AND after
 *     the encode), and a failed emergency check counts as emergency;
 *   • tenant scoping: the asset is only ever read/written with the job's tenant;
 *   • temp files are gone on every path;
 *   • after a swap — and only after a swap — the probe + poster pass is re-run
 *     on the COPY, and the swap's own write drops the original's probe facts
 *     (2026-09-24: the grade and the poster must describe the served file).
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseProbe, type ProbeResult } from './transcode-profile';
import {
  VideoTranscodePipeline,
  EMERGENCY_CONTENT_SQL,
  SERVED_FILE_FACT_KEYS,
  mergeTranscodeMeta,
  type PipelineEnv,
  remuxAfterTranscode,
} from './video-transcode.pipeline';
import {
  ORIGINAL_RETENTION_MS,
  type ClaimedTranscodeJob,
} from './video-transcode.service';

const MB = 1024 * 1024;
const TENANT = 'tenant-1';
const SRC_PATH = `${TENANT}/0f6b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d.mp4`;
const SUPA = 'https://example.supabase.co/storage/v1/object/public/assets/';
const SRC_URL = `${SUPA}${SRC_PATH}`;

// Real ffprobe output (see transcode-profile.spec.ts for provenance).
const CAMERA_4K = parseProbe({
  streams: [
    {
      codec_name: 'h264',
      codec_type: 'video',
      width: 3840,
      height: 2160,
      pix_fmt: 'yuv420p',
      r_frame_rate: '30/1',
      avg_frame_rate: '30/1',
      duration: '30.000000',
      bit_rate: '80557799',
      disposition: { attached_pic: 0 },
    },
    {
      codec_name: 'aac',
      codec_type: 'audio',
      r_frame_rate: '0/0',
      avg_frame_rate: '0/0',
      duration: '30.000000',
      bit_rate: '239964',
      disposition: { attached_pic: 0 },
    },
  ],
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '30.000000',
    size: '303019560',
    bit_rate: '80805216',
  },
});
const OUT_2160 = parseProbe({
  streams: [
    {
      codec_name: 'h264',
      codec_type: 'video',
      width: 3840,
      height: 2160,
      pix_fmt: 'yuv420p',
      r_frame_rate: '30/1',
      avg_frame_rate: '30/1',
      duration: '30.000000',
      bit_rate: '16410642',
      disposition: { attached_pic: 0 },
    },
    {
      codec_name: 'aac',
      codec_type: 'audio',
      r_frame_rate: '0/0',
      avg_frame_rate: '0/0',
      duration: '30.016000',
      bit_rate: '127957',
      disposition: { attached_pic: 0 },
    },
  ],
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '30.016000',
    size: '62053263',
    bit_rate: '16538716',
  },
});

const SOURCE_BYTES = 3 * MB; // the fake original; ratios are what matter
const FIFTH = Math.floor(SOURCE_BYTES / 5);

let tmpRoot: string;
beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-pipeline-spec-'));
});
afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

interface World {
  asset: any | null;
  emergency: boolean | 'throw';
  /** What a second emergency check (just before the swap) answers. */
  emergencyAtSwap?: boolean;
  outBytes: number;
  outProbe: ProbeResult;
  runOk: boolean | 'timeout';
  inProbe?: ProbeResult;
  swapCount?: number;
  free?: number | null;
  /** What the re-run probe + poster pass answers after a swap ('throw' = it rejects). */
  servedFile?: { probed: boolean; posterUrl: string | null } | 'throw';
}

function build(w: World) {
  const calls: string[] = [];
  let emergencyChecks = 0;
  const prisma = {
    client: {
      asset: {
        findFirst: jest.fn(async ({ where }: any) => {
          calls.push(`asset.findFirst(${where.id},${where.tenantId})`);
          if (
            !w.asset ||
            where.id !== w.asset.id ||
            where.tenantId !== w.asset.tenantId
          )
            return null;
          return w.asset;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          calls.push(`asset.updateMany(${Object.keys(data).sort().join(',')})`);
          if (
            !w.asset ||
            where.tenantId !== w.asset.tenantId ||
            where.id !== w.asset.id
          )
            return { count: 0 };
          if ('fileUrl' in data) return { count: w.swapCount ?? 1 };
          return { count: 1 };
        }),
      },
      auditLog: { create: jest.fn(async () => ({ id: 'audit-1' })) },
      $queryRawUnsafe: jest.fn(async (sql: string) => {
        if (sql === EMERGENCY_CONTENT_SQL) {
          emergencyChecks += 1;
          if (w.emergency === 'throw') throw new Error('db down');
          const v =
            emergencyChecks > 1 && w.emergencyAtSwap !== undefined
              ? w.emergencyAtSwap
              : w.emergency;
          return [{ emergency: v }];
        }
        throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
      }),
    },
  } as any;

  const uploaded: string[] = [];
  const deleted: string[] = [];
  const storage = {
    extractPath: (url: string) =>
      url.startsWith(SUPA) ? url.slice(SUPA.length) : null,
    getObjectInfo: jest.fn(async () => ({
      size: SOURCE_BYTES,
      contentType: 'video/mp4',
    })),
    downloadObjectToFile: jest.fn(async (_p: string, dest: string) => {
      await fs.writeFile(dest, Buffer.alloc(SOURCE_BYTES, 7));
      return {
        bytes: SOURCE_BYTES,
        sha256: 'sha-original',
        contentType: 'video/mp4',
      };
    }),
    uploadFileFromDisk: jest.fn(async (p: string) => {
      uploaded.push(p);
      return `${SUPA}${p}`;
    }),
    delete: jest.fn(async (p: string) => {
      deleted.push(p);
    }),
  } as any;

  let transcodeArgs: string[] | null = null;
  const runner = {
    available: async () => true,
    probe: jest.fn(async (file: string) =>
      file.endsWith('out.mp4') ? w.outProbe : (w.inProbe ?? CAMERA_4K),
    ),
    transcode: jest.fn(async (args: string[], opts: any) => {
      transcodeArgs = args;
      opts.onProgressSeconds?.(15);
      if (w.runOk === 'timeout')
        return { ok: false, reason: 'timeout after 600s' };
      if (!w.runOk)
        return { ok: false, reason: 'ffmpeg exited 1: Invalid data found' };
      await fs.writeFile(args[args.length - 1], Buffer.alloc(w.outBytes, 1));
      return { ok: true };
    }),
  };

  let clock = 1_700_000_000_000;
  const env: PipelineEnv = {
    tmpRoot: () => tmpRoot,
    freeBytes: async () => (w.free === undefined ? 50 * 1024 * MB : w.free),
    now: () => (clock += 1000),
  };

  const videoPoster = {
    processVideo: jest.fn(async (args: any) => {
      calls.push(`videoPoster.processVideo(${args.storagePath})`);
      if (w.servedFile === 'throw') throw new Error('poster service exploded');
      return (
        w.servedFile ?? {
          probed: true,
          posterUrl: `${SUPA}${TENANT}/posters/new.jpg`,
        }
      );
    }),
  };

  const pipeline = new VideoTranscodePipeline(
    prisma,
    storage,
    videoPoster as any,
  );
  pipeline.runner = runner as any;
  pipeline.env = env;
  return {
    pipeline,
    prisma,
    storage,
    runner,
    videoPoster,
    uploaded,
    deleted,
    calls,
    get transcodeArgs() {
      return transcodeArgs;
    },
  };
}

const job = (over: Partial<ClaimedTranscodeJob> = {}): ClaimedTranscodeJob => ({
  id: 'job-1',
  tenantId: TENANT,
  assetId: 'asset-1',
  sourceUrl: SRC_URL,
  sourceBytes: SOURCE_BYTES,
  attempts: 1,
  ...over,
});

const videoAsset = (over: Record<string, unknown> = {}) => ({
  id: 'asset-1',
  tenantId: TENANT,
  fileUrl: SRC_URL,
  mimeType: 'video/mp4',
  status: 'PUBLISHED',
  fileHash: null,
  ...over,
});

async function tempLeftovers(): Promise<string[]> {
  return (await fs.readdir(tmpRoot)).filter((n) =>
    n.startsWith('edu-transcode-'),
  );
}

describe('VideoTranscodePipeline — the happy path swaps, with everything a screen needs', () => {
  it('smaller + verified → uploads to <tenant>/optimized/…, swaps url/mime/size/HASH conditionally, audits bytes in/out', async () => {
    const t = build({
      asset: videoAsset(),
      emergency: false,
      outBytes: FIFTH,
      outProbe: OUT_2160,
      runOk: true,
    });
    const progress: number[] = [];
    const out = await t.pipeline.process(job(), {
      onProgress: (p) => progress.push(p),
    });

    expect(out.status).toBe('done');
    expect(out.reason).toBe('swapped');
    expect(out.outputBytes).toBe(FIFTH);
    expect(t.uploaded).toHaveLength(1);
    expect(t.uploaded[0]).toMatch(
      new RegExp(`^${TENANT}/optimized/[0-9a-f-]{36}\\.mp4$`),
    );
    expect(progress).toEqual([50]); // 15 s of a 30 s source

    const swap = t.prisma.client.asset.updateMany.mock.calls.find(
      ([a]: any) => 'fileUrl' in a.data,
    )[0];
    expect(swap.where).toEqual({
      id: 'asset-1',
      tenantId: TENANT,
      fileUrl: SRC_URL,
      playlistItems: { none: { playlist: { isProtected: true } } },
    });
    expect(swap.data.fileUrl).toBe(`${SUPA}${t.uploaded[0]}`);
    expect(swap.data.mimeType).toBe('video/mp4');
    expect(swap.data.fileSize).toBe(FIFTH);
    expect(swap.data.fileHash).toMatch(/^[0-9a-f]{64}$/); // the NEW file's hash, never the original's
    expect(swap.data.fileHash).not.toBe('sha-original');
    expect(swap.data.processingMeta).toMatchObject({
      originalSize: SOURCE_BYTES,
      processedSize: FIFTH,
      processedDimensions: { w: 3840, h: 2160 },
      transcode: { profile: '2160p' },
    });

    const audit = t.prisma.client.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({
      tenantId: TENANT,
      userId: null,
      action: 'ASSET_VIDEO_OPTIMIZED',
      targetId: 'asset-1',
    });
    expect(JSON.parse(audit.details)).toMatchObject({
      bytesIn: SOURCE_BYTES,
      bytesOut: FIFTH,
      originalUrl: SRC_URL,
    });

    // The original is KEPT for the retention window — never deleted here.
    expect(t.deleted).toEqual([]);
    // 7 days from the pipeline's clock (the spec's fake clock starts at 1.7e12 and ticks 1 s a read).
    const hold = out.originalDeleteAfter!.getTime() - 1_700_000_000_000;
    expect(hold).toBeGreaterThanOrEqual(ORIGINAL_RETENTION_MS);
    expect(hold).toBeLessThan(ORIGINAL_RETENTION_MS + 60_000);
    expect(await tempLeftovers()).toEqual([]);
  });
});

describe('VideoTranscodePipeline — never worse', () => {
  it('NEGATIVE CONTROL: an output LARGER than the source is never swapped in or uploaded', async () => {
    const t = build({
      asset: videoAsset(),
      emergency: false,
      outBytes: SOURCE_BYTES + 1,
      outProbe: OUT_2160,
      runOk: true,
    });
    const out = await t.pipeline.process(job());
    expect(out).toMatchObject({
      status: 'skipped',
      reason: 'not-smaller',
      outputBytes: SOURCE_BYTES + 1,
    });
    expect(t.uploaded).toEqual([]);
    const writes = t.prisma.client.asset.updateMany.mock.calls.map(
      ([a]: any) => a.data,
    );
    expect(writes.some((d: any) => 'fileUrl' in d)).toBe(false);
    // …but the original's own hash is recorded while we hold its bytes.
    expect(writes).toEqual([{ fileHash: 'sha-original' }]);
    expect(await tempLeftovers()).toEqual([]);
  });

  it('an output EQUAL in size is not smaller either', async () => {
    const t = build({
      asset: videoAsset(),
      emergency: false,
      outBytes: SOURCE_BYTES,
      outProbe: OUT_2160,
      runOk: true,
    });
    expect((await t.pipeline.process(job())).reason).toBe('not-smaller');
    expect(t.uploaded).toEqual([]);
  });

  it('NEGATIVE CONTROL: a TRUNCATED output (smaller!) is rejected by duration and never uploaded', async () => {
    const truncated = { ...OUT_2160, durationS: 3.157 };
    const t = build({
      asset: videoAsset(),
      emergency: false,
      outBytes: Math.floor(SOURCE_BYTES / 10),
      outProbe: truncated,
      runOk: true,
    });
    const out = await t.pipeline.process(job());
    expect(out.status).toBe('failed');
    expect(out.reason).toBe('output-rejected');
    expect(out.error).toMatch(/^output-duration-3\.16s-vs-source-30\.00s$/);
    expect(t.uploaded).toEqual([]);
  });

  it('NEGATIVE CONTROL: ffmpeg failure leaves the original serving (no upload, no swap, hash recorded)', async () => {
    const t = build({
      asset: videoAsset(),
      emergency: false,
      outBytes: 0,
      outProbe: OUT_2160,
      runOk: false,
    });
    const out = await t.pipeline.process(job());
    expect(out).toMatchObject({ status: 'failed', reason: 'ffmpeg-failed' });
    expect(out.error).toContain('Invalid data found');
    expect(t.uploaded).toEqual([]);
    expect(
      t.prisma.client.asset.updateMany.mock.calls.map(([a]: any) => a.data),
    ).toEqual([{ fileHash: 'sha-original' }]);
    expect(await tempLeftovers()).toEqual([]);
  });

  it('a timeout is recorded as such, original untouched', async () => {
    const t = build({
      asset: videoAsset(),
      emergency: false,
      outBytes: 0,
      outProbe: OUT_2160,
      runOk: 'timeout',
    });
    expect(await t.pipeline.process(job())).toMatchObject({
      status: 'failed',
      reason: 'timeout',
    });
    expect(t.uploaded).toEqual([]);
  });

  it('the hash backfill only fills a NULL hash on the asset still serving the source', async () => {
    const t = build({
      asset: videoAsset(),
      emergency: false,
      outBytes: SOURCE_BYTES + 1,
      outProbe: OUT_2160,
      runOk: true,
    });
    await t.pipeline.process(job());
    const [{ where }] = t.prisma.client.asset.updateMany.mock.calls[0];
    expect(where).toEqual({
      id: 'asset-1',
      tenantId: TENANT,
      fileUrl: SRC_URL,
      fileHash: null,
    });
  });

  it('an already optimized 4K source keeps its primary file while attempting a 1080p copy', async () => {
    const optimal = { ...OUT_2160, bitRate: 12_000_000, fps: 30 };
    const t = build({
      asset: videoAsset(),
      emergency: false,
      outBytes: 1,
      outProbe: OUT_2160,
      runOk: true,
      inProbe: optimal,
    });
    expect(await t.pipeline.process(job())).toMatchObject({
      status: 'skipped',
      reason: 'already-optimal',
    });
    expect(t.runner.transcode).toHaveBeenCalledTimes(1);
    expect(t.prisma.client.asset.updateMany.mock.calls.some(([args]: any) => 'fileUrl' in args.data)).toBe(false);
  });
});

describe('VideoTranscodePipeline — emergency media is never touched', () => {
  it('emergency content is skipped BEFORE anything is downloaded', async () => {
    const t = build({
      asset: videoAsset(),
      emergency: true,
      outBytes: 1,
      outProbe: OUT_2160,
      runOk: true,
    });
    expect(await t.pipeline.process(job())).toEqual({
      status: 'skipped',
      reason: 'emergency-content',
    });
    expect(t.storage.downloadObjectToFile).not.toHaveBeenCalled();
    expect(t.prisma.client.asset.updateMany).not.toHaveBeenCalled();
  });

  it('a FAILED emergency check counts as emergency (fail closed)', async () => {
    const t = build({
      asset: videoAsset(),
      emergency: 'throw',
      outBytes: 1,
      outProbe: OUT_2160,
      runOk: true,
    });
    expect((await t.pipeline.process(job())).reason).toBe('emergency-content');
    expect(t.storage.downloadObjectToFile).not.toHaveBeenCalled();
  });

  it('an asset that BECOMES emergency media mid-encode is not swapped, and the output is removed', async () => {
    const t = build({
      asset: videoAsset(),
      emergency: false,
      emergencyAtSwap: true,
      outBytes: FIFTH,
      outProbe: OUT_2160,
      runOk: true,
    });
    const out = await t.pipeline.process(job());
    expect(out).toMatchObject({
      status: 'skipped',
      reason: 'emergency-content',
    });
    expect(t.deleted).toEqual(t.uploaded);
    expect(
      t.prisma.client.asset.updateMany.mock.calls.some(
        ([a]: any) => 'fileUrl' in a.data,
      ),
    ).toBe(false);
  });

  it('the emergency SQL covers protected playlists, tenant + screen emergency playlists, and screen emergency media', () => {
    expect(EMERGENCY_CONTENT_SQL).toContain('"is_protected" = TRUE');
    expect(EMERGENCY_CONTENT_SQL).toContain(
      '"emergency_playlist_id" FROM "tenants"',
    );
    expect(EMERGENCY_CONTENT_SQL).toContain(
      '"emergency_portrait_playlist_id" FROM "tenants"',
    );
    expect(
      EMERGENCY_CONTENT_SQL.match(/_playlist_id" FROM "screens"/g),
    ).toHaveLength(12);
    expect(EMERGENCY_CONTENT_SQL.match(/_asset_url" = \$2/g)).toHaveLength(12);
  });
});

describe('VideoTranscodePipeline — the asset must still be the one we queued', () => {
  it('a deleted asset (or a job whose asset was deleted) is skipped', async () => {
    const t = build({
      asset: null,
      emergency: false,
      outBytes: 1,
      outProbe: OUT_2160,
      runOk: true,
    });
    expect(await t.pipeline.process(job())).toEqual({
      status: 'skipped',
      reason: 'asset-deleted',
    });
    expect(await t.pipeline.process(job({ assetId: null }))).toEqual({
      status: 'skipped',
      reason: 'asset-deleted',
    });
  });

  it('an asset now serving a different file is skipped (nothing downloaded)', async () => {
    const t = build({
      asset: videoAsset({ fileUrl: `${SUPA}${TENANT}/other.mp4` }),
      emergency: false,
      outBytes: 1,
      outProbe: OUT_2160,
      runOk: true,
    });
    expect(await t.pipeline.process(job())).toEqual({
      status: 'skipped',
      reason: 'source-changed',
    });
    expect(t.storage.downloadObjectToFile).not.toHaveBeenCalled();
  });

  it('if the swap write matches nothing (changed mid-encode), the uploaded output is removed', async () => {
    const t = build({
      asset: videoAsset(),
      emergency: false,
      outBytes: FIFTH,
      outProbe: OUT_2160,
      runOk: true,
      swapCount: 0,
    });
    // The re-read after the failed swap sees a different URL.
    t.prisma.client.asset.findFirst
      .mockImplementationOnce(async () => videoAsset())
      .mockImplementationOnce(async () => ({
        fileUrl: `${SUPA}${TENANT}/replaced.mp4`,
      }));
    const out = await t.pipeline.process(job());
    expect(out).toMatchObject({ status: 'skipped', reason: 'source-changed' });
    expect(t.deleted).toEqual(t.uploaded);
    expect(t.prisma.client.auditLog.create).not.toHaveBeenCalled();
  });

  it('TENANT SCOPING: a job never reads or writes an asset of another tenant, even with the same id', async () => {
    const t = build({
      asset: videoAsset({ tenantId: 'tenant-2' }),
      emergency: false,
      outBytes: FIFTH,
      outProbe: OUT_2160,
      runOk: true,
    });
    expect(await t.pipeline.process(job())).toEqual({
      status: 'skipped',
      reason: 'asset-deleted',
    });
    expect(t.prisma.client.asset.findFirst.mock.calls[0][0].where).toEqual({
      id: 'asset-1',
      tenantId: TENANT,
    });
    expect(t.prisma.client.asset.updateMany).not.toHaveBeenCalled();
  });

  it('archived (rejected) and non-video assets are skipped', async () => {
    const a = build({
      asset: videoAsset({ status: 'ARCHIVED' }),
      emergency: false,
      outBytes: 1,
      outProbe: OUT_2160,
      runOk: true,
    });
    expect((await a.pipeline.process(job())).reason).toBe('asset-archived');
    const b = build({
      asset: videoAsset({ mimeType: 'image/png' }),
      emergency: false,
      outBytes: 1,
      outProbe: OUT_2160,
      runOk: true,
    });
    expect((await b.pipeline.process(job())).reason).toBe('not-video');
  });
});

describe('VideoTranscodePipeline — bounded resources', () => {
  it('refuses to start without ~2× the source in free temp disk (nothing downloaded)', async () => {
    const t = build({
      asset: videoAsset(),
      emergency: false,
      outBytes: 1,
      outProbe: OUT_2160,
      runOk: true,
      free: 4 * MB,
    });
    const out = await t.pipeline.process(job());
    expect(out).toMatchObject({
      status: 'failed',
      reason: 'insufficient-temp-disk',
    });
    expect(t.storage.downloadObjectToFile).not.toHaveBeenCalled();
  });

  it('bounds both the primary output and the decoder-sized copy', async () => {
    const t = build({
      asset: videoAsset(),
      emergency: false,
      outBytes: FIFTH,
      outProbe: OUT_2160,
      runOk: true,
    });
    await t.pipeline.process(job());
    const opts = t.storage.downloadObjectToFile.mock.calls[0][2];
    expect(opts.maxBytes).toBe(Math.floor(SOURCE_BYTES * 1.01) + MB);
    const primaryArgs = t.runner.transcode.mock.calls[0][0];
    const renditionArgs = t.runner.transcode.mock.calls[1][0];
    expect(primaryArgs[primaryArgs.indexOf('-fs') + 1]).toBe(String(SOURCE_BYTES));
    expect(renditionArgs[renditionArgs.indexOf('-fs') + 1]).toBe(String(256 * MB));
    expect(primaryArgs[primaryArgs.indexOf('-threads') + 1]).toBe('2');
  });

  it('a download failure (storage blip) fails soft and cleans up', async () => {
    const t = build({
      asset: videoAsset(),
      emergency: false,
      outBytes: 1,
      outProbe: OUT_2160,
      runOk: true,
    });
    t.storage.downloadObjectToFile.mockImplementationOnce(async () => {
      throw new Error('download returned 503');
    });
    const out = await t.pipeline.process(job());
    expect(out).toMatchObject({ status: 'failed', reason: 'error' });
    expect(out.error).toContain('503');
    expect(await tempLeftovers()).toEqual([]);
  });
});

describe('VideoTranscodePipeline — after a swap the facts describe the SERVED file (2026-09-24)', () => {
  // The facts an upload wrote about the ORIGINAL: a 10-bit HEVC 4K camera file.
  const ORIGINAL_FACTS = {
    originalDimensions: { w: 3840, h: 2160 },
    processedDimensions: null,
    durationMs: 30_000,
    probe: { probeVersion: 2, codec: 'hevc', pixFmt: 'yuv420p10le', fps: 60 },
    probedAt: '2026-09-24T10:00:00.000Z',
    probeFailed: 'stale-stamp',
    probeFailedVersion: 2,
    skippedReason: 'legacy-key-that-must-survive',
  };

  it('re-runs the probe + poster pass on the COPY, after the swap write and before the job is done', async () => {
    const t = build({
      asset: videoAsset({ processingMeta: ORIGINAL_FACTS }),
      emergency: false,
      outBytes: FIFTH,
      outProbe: OUT_2160,
      runOk: true,
    });
    const out = await t.pipeline.process(job());

    expect(out.status).toBe('done');
    expect(t.videoPoster.processVideo).toHaveBeenCalledTimes(1);
    expect(t.videoPoster.processVideo).toHaveBeenCalledWith({
      assetId: 'asset-1',
      tenantId: TENANT,
      mimeType: 'video/mp4',
      storagePath: t.uploaded[0], // the optimized copy — never the original
      ext: '.mp4',
    });
    // ORDER: the swap (the updateMany carrying fileUrl) precedes the re-probe,
    // so the pass reads a row whose fileUrl is already the copy.
    const swapAt = t.calls.findIndex(
      (c) => c.startsWith('asset.updateMany(') && c.includes('fileUrl'),
    );
    const probeAt = t.calls.findIndex((c) =>
      c.startsWith('videoPoster.processVideo('),
    );
    expect(swapAt).toBeGreaterThanOrEqual(0);
    expect(probeAt).toBeGreaterThan(swapAt);
    expect(out.details).toMatchObject({
      servedFile: { probed: true, poster: true },
    });
  });

  it("the swap's own write DROPS the original's probe facts and keeps every other key (negative control: remove the drop → red)", async () => {
    const t = build({
      asset: videoAsset({ processingMeta: ORIGINAL_FACTS }),
      emergency: false,
      outBytes: FIFTH,
      outProbe: OUT_2160,
      runOk: true,
    });
    await t.pipeline.process(job());

    const swap = t.prisma.client.asset.updateMany.mock.calls.find(
      ([a]: any) => 'fileUrl' in a.data,
    )[0];
    const meta = swap.data.processingMeta;
    for (const key of SERVED_FILE_FACT_KEYS)
      expect(meta).not.toHaveProperty(key);
    expect(meta.skippedReason).toBe('legacy-key-that-must-survive');
    expect(meta).toMatchObject({
      originalSize: SOURCE_BYTES,
      processedSize: FIFTH,
      processedDimensions: { w: 3840, h: 2160 },
      transcode: { profile: '2160p', codecIn: 'h264' },
    });
  });

  it('mergeTranscodeMeta is pure: null / garbage / array existing meta all start from empty', () => {
    const t = { originalSize: 1, transcode: { profile: '1080p' } };
    expect(mergeTranscodeMeta(null, t)).toEqual(t);
    expect(mergeTranscodeMeta('garbage', t)).toEqual(t);
    expect(mergeTranscodeMeta([1, 2], t)).toEqual(t);
    expect(
      mergeTranscodeMeta(
        { probe: { codec: 'hevc' }, durationMs: 5, keep: 'me' },
        t,
      ),
    ).toEqual({ keep: 'me', ...t });
  });

  it.each([
    [
      'larger output',
      { outBytes: SOURCE_BYTES + 1, runOk: true as const, emergency: false },
    ],
    [
      'ffmpeg failed',
      { outBytes: FIFTH, runOk: false as const, emergency: false },
    ],
    [
      'emergency content',
      { outBytes: FIFTH, runOk: true as const, emergency: true },
    ],
  ])(
    "NEGATIVE CONTROL: no swap (%s) → the pass never runs, the original's facts stay",
    async (_name, w) => {
      const t = build({
        asset: videoAsset({ processingMeta: ORIGINAL_FACTS }),
        outProbe: OUT_2160,
        ...w,
      });
      const out = await t.pipeline.process(job());
      expect(out.status).not.toBe('done');
      expect(t.videoPoster.processVideo).not.toHaveBeenCalled();
      expect(
        t.prisma.client.asset.updateMany.mock.calls.some(
          ([a]: any) => 'processingMeta' in a.data,
        ),
      ).toBe(false);
    },
  );

  it('a pass that reports nothing landed, or that THROWS, never un-swaps and never fails the job', async () => {
    const incomplete = build({
      asset: videoAsset({ processingMeta: ORIGINAL_FACTS }),
      emergency: false,
      outBytes: FIFTH,
      outProbe: OUT_2160,
      runOk: true,
      servedFile: { probed: false, posterUrl: null },
    });
    const a = await incomplete.pipeline.process(job());
    expect(a.status).toBe('done');
    expect(a.reason).toBe('swapped');
    expect(a.details).toMatchObject({
      servedFile: { probed: false, poster: false },
    });
    expect(incomplete.deleted).toEqual([]); // the copy is what the asset serves now

    const throwing = build({
      asset: videoAsset({ processingMeta: ORIGINAL_FACTS }),
      emergency: false,
      outBytes: FIFTH,
      outProbe: OUT_2160,
      runOk: true,
      servedFile: 'throw',
    });
    const b = await throwing.pipeline.process(job());
    expect(b.status).toBe('done');
    expect(b.reason).toBe('swapped');
    expect(b.details).toMatchObject({
      servedFile: {
        probed: false,
        poster: false,
        error: 'poster service exploded',
      },
    });
    expect(await tempLeftovers()).toEqual([]);
  });
});

describe('VideoTranscodePipeline — the deferred fast-start pass after a kept original (2026-09-24)', () => {
  const world = (asset: unknown, servedFile?: World['servedFile']) =>
    build({
      asset,
      emergency: false,
      outBytes: 1,
      outProbe: OUT_2160,
      runOk: true,
      servedFile,
    });

  it('remuxAfterTranscode: only an outcome that left the served file alone', () => {
    expect(
      remuxAfterTranscode({ status: 'skipped', reason: 'not-smaller' }),
    ).toBe(true);
    expect(
      remuxAfterTranscode({ status: 'skipped', reason: 'already-optimal' }),
    ).toBe(true);
    expect(
      remuxAfterTranscode({ status: 'failed', reason: 'ffmpeg-failed' }),
    ).toBe(true);
    expect(remuxAfterTranscode({ status: 'done', reason: 'swapped' })).toBe(
      false,
    );
    for (const reason of [
      'asset-deleted',
      'source-changed',
      'not-video',
      'asset-archived',
      'emergency-content',
      'external-url',
      'aborted',
    ]) {
      expect(remuxAfterTranscode({ status: 'skipped', reason })).toBe(false);
    }
  });

  it('runs the probe + fast-start pass on the file the row still serves — no poster, async re-mux', async () => {
    const t = world(videoAsset({ originalName: 'Pro Series Video 1.MOV' }));
    await t.pipeline.remuxKeptOriginal(job());
    expect(t.videoPoster.processVideo).toHaveBeenCalledTimes(1);
    expect(t.videoPoster.processVideo).toHaveBeenCalledWith(
      {
        assetId: 'asset-1',
        tenantId: TENANT,
        mimeType: 'video/mp4',
        storagePath: SRC_URL.slice(SUPA.length),
        ext: '.MOV',
      },
      { remux: 'async', poster: false },
    );
  });

  it('touches nothing when the row moved on, the asset is gone, the job has no asset, or the file is not a video', async () => {
    const moved = world(videoAsset({ fileUrl: `${SUPA}${TENANT}/other.mp4` }));
    await moved.pipeline.remuxKeptOriginal(job());
    expect(moved.videoPoster.processVideo).not.toHaveBeenCalled();

    const gone = world(null);
    await gone.pipeline.remuxKeptOriginal(job());
    expect(gone.videoPoster.processVideo).not.toHaveBeenCalled();

    const orphan = world(videoAsset());
    await orphan.pipeline.remuxKeptOriginal(job({ assetId: null }));
    expect(orphan.videoPoster.processVideo).not.toHaveBeenCalled();

    const image = world(videoAsset({ mimeType: 'image/png' }));
    await image.pipeline.remuxKeptOriginal(job());
    expect(image.videoPoster.processVideo).not.toHaveBeenCalled();
  });

  it('never throws — a pass that explodes is logged and the job’s outcome stands', async () => {
    const t = world(videoAsset(), 'throw');
    await expect(t.pipeline.remuxKeptOriginal(job())).resolves.toBeUndefined();
    expect(t.videoPoster.processVideo).toHaveBeenCalledTimes(1);
  });
});
