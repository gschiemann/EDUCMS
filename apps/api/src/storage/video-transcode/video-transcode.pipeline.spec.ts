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
 *   • temp files are gone on every path.
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseProbe, type ProbeResult } from './transcode-profile';
import {
  VideoTranscodePipeline,
  EMERGENCY_CONTENT_SQL,
  type PipelineEnv,
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

  const pipeline = new VideoTranscodePipeline(prisma, storage);
  pipeline.runner = runner as any;
  pipeline.env = env;
  return {
    pipeline,
    prisma,
    storage,
    runner,
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

  it('a source that already IS the profile is skipped without running ffmpeg', async () => {
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
    expect(t.runner.transcode).not.toHaveBeenCalled();
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

  it('the download is capped just above the recorded size, and -fs bounds the output at the source size', async () => {
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
    const args = t.transcodeArgs!;
    expect(args[args.indexOf('-fs') + 1]).toBe(String(SOURCE_BYTES));
    expect(args[args.indexOf('-threads') + 1]).toBe('2');
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
