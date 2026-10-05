/**
 * VideoTranscodePipeline — every exit, and the negative controls the swap
 * depends on (2026-09-23). The process boundary (ffprobe/ffmpeg), storage and
 * Prisma are fakes; the probe fixtures are the REAL ffprobe output used in
 * transcode-profile.spec.ts, and the fake "encode" writes a real file of the
 * size a test wants, so the size / verify / upload / swap logic runs for real.
 *
 * Pinned:
 *   • COMPATIBILITY BEFORE SIZE (2026-10-04): a source that is not screen-safe
 *     (HEVC, 10-bit, HDR, …) is REQUIRED to convert and its output is swapped in
 *     whatever its size; a screen-safe source is only ever shrunk, and a bigger
 *     output is never swapped in or uploaded;
 *   • either way the swap happens ONLY when the output is verified complete (and
 *     never when it reached its -fs bound), is conditional on the asset still
 *     serving the source and not being in a protected playlist, and writes the
 *     NEW file's hash;
 *   • the verdict is STAMPED on the row (processingMeta.screen): ready when the
 *     file is screen-safe or was converted, NOT ready (with the issues and the
 *     error) when a required conversion failed or the file cannot be read;
 *   • never a swap when the output is truncated, or ffmpeg fails — the original
 *     keeps serving and gets its own hash recorded;
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

// A REQUIRED conversion: the camera clip's numbers, but 10-bit HEVC with an HDR10
// signal — the kind of file that must be converted whatever the copy weighs.
const HEVC_HDR_4K: ProbeResult = {
  ...CAMERA_4K,
  videoCodec: 'hevc',
  pixFmt: 'yuv420p10le',
  colorSpace: 'bt2020nc',
  colorTransfer: 'smpte2084',
  colorPrimaries: 'bt2020',
  bitRate: 20_000_000,
};
const HEVC_ISSUES = ['codec', 'pixel-format', 'hdr'];

// What ffprobe says about a GOOD 1080p playback copy of the 4K camera clip: the
// profile's own output at 1920×1080, 30 fps, H.264 + AAC in an MP4.
const RENDITION_PROBE: ProbeResult = {
  ...OUT_2160,
  width: 1920,
  height: 1080,
  fps: 30,
  bitRate: 6_000_000,
};

/**
 * Bytes of a minimal MP4 whose index (`moov`) sits BEFORE its media (`mdat`):
 * all the pipeline's own fast-start check reads of a playback copy. The fake
 * ffmpeg writes this for a copy it is told to make successfully.
 */
function fastStartMp4(bytes: number): Buffer {
  const ftyp = Buffer.from([
    0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0,
  ]);
  const moov = Buffer.from([0, 0, 0, 8, 0x6d, 0x6f, 0x6f, 0x76]);
  const payload = Math.max(0, bytes - ftyp.length - moov.length - 8);
  const mdatHead = Buffer.alloc(8);
  mdatHead.writeUInt32BE(8 + payload, 0);
  mdatHead.write('mdat', 4, 'ascii');
  return Buffer.concat([ftyp, moov, mdatHead, Buffer.alloc(payload, 1)]);
}

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
  runOk: boolean | 'timeout' | 'aborted';
  inProbe?: ProbeResult;
  /**
   * How the fake answers the 1080p playback copy (the ffmpeg run whose output is
   * `rendition-1080.mp4`), independently of `runOk`:
   *   'ok'           — writes a real fast-start MP4 and probes as a clean 1080p copy;
   *   'ffmpeg-fails' — ffmpeg exits 1 for the copy only;
   *   undefined      — the copy follows `runOk` and is not a valid copy (it is rejected).
   */
  rendition?: 'ok' | 'ffmpeg-fails';
  /** What ffprobe says about a good copy (default: a 1920×1080 file). */
  renditionProbe?: ProbeResult;
  renditionBytes?: number;
  /** Emergency answers true from this check onward (1 = the job's own first check). */
  emergencyFromCheck?: number;
  swapCount?: number;
  /** Free temp bytes; an array answers each read in turn (the last one repeats). null = unknown. */
  free?: number | null | Array<number | null>;
  /** The size the fake download REPORTS for the original (default SOURCE_BYTES). The file itself stays tiny: the pipeline only needs the number. */
  downloadBytes?: number;
  /** The upload of the converted copy throws (a storage blip). */
  uploadThrows?: boolean;
  /** ffprobe of the INPUT or of the OUTPUT cannot read the file. */
  probeFails?: 'in' | 'out';
  /** What the re-run probe + poster pass answers after a swap ('throw' = it rejects). */
  servedFile?: { probed: boolean; posterUrl: string | null } | 'throw';
  /** Another transcode job for the same asset is queued / running (the settle step's check). */
  otherActiveJob?: boolean;
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
          // A lookup that names the file it expects finds nothing once the row serves another.
          if (where.fileUrl !== undefined && where.fileUrl !== w.asset.fileUrl)
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
          if (where.fileUrl !== undefined && where.fileUrl !== w.asset.fileUrl)
            return { count: 0 };
          if ('fileUrl' in data) {
            const count = w.swapCount ?? 1;
            if (count > 0) Object.assign(w.asset, data);
            return { count };
          }
          // The row really changes: a later read (a second stamp) sees the first write.
          if ('processingMeta' in data)
            w.asset.processingMeta = data.processingMeta;
          if ('fileHash' in data) w.asset.fileHash = data.fileHash;
          return { count: 1 };
        }),
      },
      auditLog: { create: jest.fn(async () => ({ id: 'audit-1' })) },
      videoTranscodeJob: {
        findFirst: jest.fn(async () => (w.otherActiveJob ? { id: 'job-2' } : null)),
      },
      $queryRawUnsafe: jest.fn(async (sql: string) => {
        if (sql === EMERGENCY_CONTENT_SQL) {
          emergencyChecks += 1;
          if (w.emergency === 'throw') throw new Error('db down');
          if (
            w.emergencyFromCheck !== undefined &&
            emergencyChecks >= w.emergencyFromCheck
          )
            return [{ emergency: true }];
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
      const bytes = w.downloadBytes ?? SOURCE_BYTES;
      await fs.writeFile(dest, Buffer.alloc(Math.min(bytes, 16 * MB), 7));
      return { bytes, sha256: 'sha-original', contentType: 'video/mp4' };
    }),
    uploadFileFromDisk: jest.fn(async (p: string) => {
      if (w.uploadThrows) throw new Error('storage upload returned 503');
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
    probe: jest.fn(async (file: string) => {
      if (path.basename(file).startsWith('rendition-') && w.rendition === 'ok')
        return w.renditionProbe ?? RENDITION_PROBE;
      const isOut = file.endsWith('out.mp4');
      if (w.probeFails === (isOut ? 'out' : 'in'))
        throw new Error('ffprobe: Invalid data found when processing input');
      return isOut ? w.outProbe : (w.inProbe ?? CAMERA_4K);
    }),
    transcode: jest.fn(async (args: string[], opts: any) => {
      transcodeArgs = args;
      opts.onProgressSeconds?.(15);
      const target = args[args.length - 1];
      if (path.basename(target).startsWith('rendition-') && w.rendition) {
        if (w.rendition === 'ffmpeg-fails')
          return { ok: false, reason: 'ffmpeg exited 1: Invalid data found' };
        await fs.writeFile(target, fastStartMp4(w.renditionBytes ?? MB));
        return { ok: true };
      }
      if (w.runOk === 'timeout')
        return { ok: false, reason: 'timeout after 600s' };
      if (w.runOk === 'aborted') return { ok: false, reason: 'aborted' };
      if (!w.runOk)
        return { ok: false, reason: 'ffmpeg exited 1: Invalid data found' };
      await fs.writeFile(target, Buffer.alloc(w.outBytes, 1));
      return { ok: true };
    }),
  };

  let clock = 1_700_000_000_000;
  const env: PipelineEnv = {
    tmpRoot: () => tmpRoot,
    freeBytes: async () => {
      if (w.free === undefined) return 50 * 1024 * MB;
      if (!Array.isArray(w.free)) return w.free;
      return w.free.length > 1 ? (w.free.shift() as number | null) : w.free[0];
    },
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

/** Every `asset.updateMany` data payload, in order. */
const writesOf = (t: { prisma: any }): any[] =>
  t.prisma.client.asset.updateMany.mock.calls.map(([a]: any) => a.data);
/** Every `processingMeta.screen` stamp written (in a swap or on its own), in order. */
const stampsOf = (t: { prisma: any }): any[] =>
  writesOf(t)
    .map((d) => d.processingMeta?.screen)
    .filter((x) => x !== undefined);
const CHECKED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('VideoTranscodePipeline — a screen-safe source is only ever SHRUNK (never worse)', () => {
  it('NEGATIVE CONTROL: an output LARGER than a screen-safe source is never swapped in or uploaded', async () => {
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
    const writes = writesOf(t);
    expect(writes.some((d: any) => 'fileUrl' in d)).toBe(false);
    // …the original's own hash is recorded while we hold its bytes…
    expect(writes).toContainEqual({ fileHash: 'sha-original' });
    // …and the row says the file it serves IS screen-safe (it needed no conversion).
    expect(stampsOf(t)).toEqual([
      { version: 1, ready: true, checkedAt: expect.stringMatching(CHECKED_AT) },
    ]);
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
    // A screen-safe source that merely failed to SHRINK is still screen-safe: no verdict is written.
    expect(stampsOf(t)).toEqual([]);
  });

  it('NEGATIVE CONTROL: ffmpeg failure leaves the original serving (no upload, no swap, hash recorded, no verdict)', async () => {
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
    expect(writesOf(t)).toEqual([{ fileHash: 'sha-original' }]);
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
    const backfill = t.prisma.client.asset.updateMany.mock.calls.find(
      ([a]: any) => 'fileHash' in a.data,
    )[0];
    expect(backfill.where).toEqual({
      id: 'asset-1',
      tenantId: TENANT,
      fileUrl: SRC_URL,
      fileHash: null,
    });
    expect(backfill.data).toEqual({ fileHash: 'sha-original' });
  });

  it('re-uploading an optimized 1080p MP4 checks compatibility without encoding or swapping it again — and says it is ready', async () => {
    const optimal = {
      ...OUT_2160,
      width: 1920,
      height: 1080,
      bitRate: 8_000_000,
      fps: 30,
    };
    const t = build({
      asset: videoAsset(),
      emergency: false,
      outBytes: 1,
      outProbe: optimal,
      runOk: true,
      inProbe: optimal,
    });
    expect(await t.pipeline.process(job())).toMatchObject({
      status: 'skipped',
      reason: 'already-optimal',
    });
    expect(t.runner.transcode).not.toHaveBeenCalled();
    expect(
      t.prisma.client.asset.updateMany.mock.calls.some(
        ([args]: any) => 'fileUrl' in args.data,
      ),
    ).toBe(false);
    expect(stampsOf(t)).toEqual([
      { version: 1, ready: true, checkedAt: expect.stringMatching(CHECKED_AT) },
    ]);
  });

  it('an already optimized 4K source keeps its primary file while attempting a 1080p copy — the stamp keeps the rendition and the probe facts', async () => {
    const optimal = { ...OUT_2160, bitRate: 12_000_000, fps: 30 };
    const facts = {
      probe: { probeVersion: 2, codec: 'h264' },
      durationMs: 30_000,
    };
    const t = build({
      asset: videoAsset({ processingMeta: facts }),
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
    expect(
      t.prisma.client.asset.updateMany.mock.calls.some(
        ([args]: any) => 'fileUrl' in args.data,
      ),
    ).toBe(false);
    // No copy was produced here (the fake's 1-byte output is rejected) — the verdict still lands, over the existing facts.
    expect(stampsOf(t)).toEqual([
      { version: 1, ready: true, checkedAt: expect.stringMatching(CHECKED_AT) },
    ]);
    const meta = writesOf(t).find((d) => d.processingMeta)!.processingMeta;
    expect(meta).toMatchObject(facts);
  });
});

describe('VideoTranscodePipeline — COMPATIBILITY BEFORE SIZE: a source that is not screen-safe is converted whatever the copy weighs', () => {
  /** A required conversion: 10-bit HEVC HDR → the profile; the copy is `outBytes` big. */
  const required = (over: Partial<World> = {}) =>
    build({
      asset: videoAsset(),
      emergency: false,
      outBytes: FIFTH,
      outProbe: OUT_2160,
      runOk: true,
      inProbe: HEVC_HDR_4K,
      ...over,
    });

  it('a LARGER output of a required conversion IS swapped in, uploaded, hashed — and the row says "ready", converted from what', async () => {
    const t = required({ outBytes: SOURCE_BYTES + 2 * MB }); // 5 MB copy of a 3 MB original
    const out = await t.pipeline.process(job());

    expect(out).toMatchObject({
      status: 'done',
      reason: 'swapped',
      outputBytes: SOURCE_BYTES + 2 * MB,
    });
    expect(t.uploaded).toHaveLength(1);
    expect(t.uploaded[0]).toMatch(
      new RegExp(`^${TENANT}/optimized/[0-9a-f-]{36}\\.mp4$`),
    );

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
    expect(swap.data.fileSize).toBe(SOURCE_BYTES + 2 * MB);
    expect(swap.data.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(swap.data.fileHash).not.toBe('sha-original');
    expect(swap.data.processingMeta).toMatchObject({
      originalSize: SOURCE_BYTES,
      processedSize: SOURCE_BYTES + 2 * MB,
      transcode: { codecIn: 'hevc', profile: '2160p' },
      screen: {
        version: 1,
        ready: true,
        convertedFrom: HEVC_ISSUES,
        checkedAt: expect.stringMatching(CHECKED_AT),
      },
    });
    expect(swap.data.processingMeta.screen).not.toHaveProperty('issues');
    expect(swap.data.processingMeta.screen).not.toHaveProperty('error');

    // The audit row tells the truth about the direction of the size change.
    const audit = JSON.parse(
      t.prisma.client.auditLog.create.mock.calls[0][0].data.details,
    );
    expect(audit).toMatchObject({
      bytesIn: SOURCE_BYTES,
      bytesOut: SOURCE_BYTES + 2 * MB,
    });
    expect(audit.savedBytes).toBe(-2 * MB);
    // The original is kept for the retention window, like any swap; the copy's facts are re-read.
    expect(out.originalDeleteAfter).toBeInstanceOf(Date);
    expect(t.videoPoster.processVideo).toHaveBeenCalledTimes(1);
    expect(await tempLeftovers()).toEqual([]);
  });

  it('a SMALLER output of a required conversion is swapped too (the ordinary case)', async () => {
    const out = await required().pipeline.process(job());
    expect(out).toMatchObject({
      status: 'done',
      reason: 'swapped',
      outputBytes: FIFTH,
    });
  });

  it('the same LARGER output for a screen-safe source is NOT swapped (the contrast that proves the rule)', async () => {
    const t = build({
      asset: videoAsset(),
      emergency: false,
      outBytes: SOURCE_BYTES + 2 * MB,
      outProbe: OUT_2160,
      runOk: true,
    });
    expect(await t.pipeline.process(job())).toMatchObject({
      status: 'skipped',
      reason: 'not-smaller',
    });
    expect(t.uploaded).toEqual([]);
  });

  it('REQUIRED + ffmpeg fails → the job fails, the original is kept, and the row says NOT ready with the issues and the error', async () => {
    const t = required({ runOk: false, outBytes: 0 });
    const out = await t.pipeline.process(job());
    expect(out).toMatchObject({ status: 'failed', reason: 'ffmpeg-failed' });
    expect(t.uploaded).toEqual([]);
    expect(writesOf(t).some((d) => 'fileUrl' in d)).toBe(false);
    expect(stampsOf(t)).toEqual([
      {
        version: 1,
        ready: false,
        issues: HEVC_ISSUES,
        error: 'ffmpeg-failed',
        checkedAt: expect.stringMatching(CHECKED_AT),
      },
    ]);
    // The original's hash is still recorded, and the file is the one the row serves.
    expect(writesOf(t)).toContainEqual({ fileHash: 'sha-original' });
    expect(await tempLeftovers()).toEqual([]);
  });

  it('REQUIRED + a timeout is a not-ready verdict too', async () => {
    const t = required({ runOk: 'timeout', outBytes: 0 });
    expect(await t.pipeline.process(job())).toMatchObject({
      status: 'failed',
      reason: 'timeout',
    });
    expect(stampsOf(t)).toEqual([
      expect.objectContaining({
        ready: false,
        issues: HEVC_ISSUES,
        error: 'timeout',
      }),
    ]);
  });

  it('REQUIRED + an output that is not the whole video (truncated duration) → rejected, not ready, nothing uploaded', async () => {
    const t = required({
      outProbe: { ...OUT_2160, durationS: 3.157 },
      outBytes: Math.floor(SOURCE_BYTES / 10),
    });
    const out = await t.pipeline.process(job());
    expect(out).toMatchObject({ status: 'failed', reason: 'output-rejected' });
    expect(out.error).toMatch(/^output-duration-/);
    expect(t.uploaded).toEqual([]);
    expect(stampsOf(t)).toEqual([
      expect.objectContaining({
        ready: false,
        issues: HEVC_ISSUES,
        error: 'output-rejected',
      }),
    ]);
  });

  it('REQUIRED + an output that is still not screen-safe (a rotation tag, 60 fps, HDR transfer) is rejected like any other', async () => {
    for (const bad of [
      { rotation: 90 },
      { fps: 60 },
      { colorTransfer: 'smpte2084' },
    ]) {
      const t = required({ outProbe: { ...OUT_2160, ...bad } });
      expect(await t.pipeline.process(job())).toMatchObject({
        status: 'failed',
        reason: 'output-rejected',
      });
      expect(t.uploaded).toEqual([]);
      expect(stampsOf(t)).toEqual([expect.objectContaining({ ready: false })]);
    }
  });

  it('REQUIRED + the output cannot be probed → failed, not ready', async () => {
    const t = required({ probeFails: 'out' });
    expect(await t.pipeline.process(job())).toMatchObject({
      status: 'failed',
      reason: 'output-probe-failed',
    });
    expect(t.uploaded).toEqual([]);
    expect(stampsOf(t)).toEqual([
      expect.objectContaining({
        ready: false,
        issues: HEVC_ISSUES,
        error: 'output-probe-failed',
      }),
    ]);
  });

  it('REQUIRED + an output that REACHED its -fs bound is refused as truncated — even when nothing else can tell (no known source duration)', async () => {
    // ffmpeg stops at -fs and exits 0 with a short file; with an unknown source
    // duration the duration check has nothing to compare against, and a tail cut
    // inside its 2 % tolerance passes it. The bound is made small (12 MB) through
    // the disk clamp — 140 MB free once the source has landed, less 128 MB —
    // so the test fills it with real bytes instead of a 512 MB file.
    const FREE = [50 * 1024 * MB, 140 * MB];
    const BOUND = 12 * MB;
    const unknownDuration = { ...HEVC_HDR_4K, durationS: null };

    const t = required({
      inProbe: unknownDuration,
      free: [...FREE],
      outBytes: BOUND,
    });
    const out = await t.pipeline.process(job());
    expect(out).toMatchObject({ status: 'failed', reason: 'output-truncated' });
    expect(out.error).toContain(`${BOUND}-byte limit`);
    expect(t.uploaded).toEqual([]);
    expect(writesOf(t).some((d) => 'fileUrl' in d)).toBe(false);
    // (a source with no known duration is itself a reason to convert — the stamp says so)
    expect(stampsOf(t)).toEqual([
      expect.objectContaining({
        ready: false,
        issues: [...HEVC_ISSUES, 'duration-unknown'],
        error: 'output-truncated',
      }),
    ]);
    expect(await tempLeftovers()).toEqual([]);

    // One byte under the bound is a complete encode and is swapped
    // (the duration check is skipped without a source duration; the output is whole).
    const whole = required({
      inProbe: unknownDuration,
      free: [...FREE],
      outBytes: BOUND - 1,
    });
    expect(await whole.pipeline.process(job())).toMatchObject({
      status: 'done',
      reason: 'swapped',
    });
    expect(whole.uploaded).toHaveLength(1);
  });

  it('the unprobable file: no readable video → verdict NOT ready, "unreadable", the original kept', async () => {
    const t = required({ probeFails: 'in' });
    const out = await t.pipeline.process(job());
    expect(out).toMatchObject({ status: 'failed', reason: 'probe-failed' });
    expect(t.runner.transcode).not.toHaveBeenCalled();
    expect(stampsOf(t)).toEqual([
      {
        version: 1,
        ready: false,
        issues: ['unreadable'],
        error: 'probe-failed',
        checkedAt: expect.stringMatching(CHECKED_AT),
      },
    ]);
    expect(writesOf(t)).toContainEqual({ fileHash: 'sha-original' });
  });

  it.each<[string, Partial<ProbeResult>, string]>([
    ['no video stream', { hasVideo: false }, 'no-video-stream'],
    ['no dimensions', { width: null, height: null }, 'unknown-dimensions'],
  ])(
    'a file with %s is "unreadable" and not ready (skipped, never converted)',
    async (_name, inProbe, reason) => {
      const t = required({ inProbe: { ...CAMERA_4K, ...inProbe } });
      expect(await t.pipeline.process(job())).toMatchObject({
        status: 'skipped',
        reason,
      });
      expect(t.runner.transcode).not.toHaveBeenCalled();
      expect(stampsOf(t)).toEqual([
        expect.objectContaining({
          ready: false,
          issues: ['unreadable'],
          error: reason,
        }),
      ]);
    },
  );

  it('REQUIRED + the upload of the copy throws (a storage blip) → failed, not ready; the SAME blip for a screen-safe source says nothing', async () => {
    const t = required({ uploadThrows: true });
    const out = await t.pipeline.process(job());
    expect(out).toMatchObject({ status: 'failed', reason: 'error' });
    expect(out.error).toContain('503');
    expect(writesOf(t).some((d) => 'fileUrl' in d)).toBe(false);
    expect(stampsOf(t)).toEqual([
      expect.objectContaining({
        ready: false,
        issues: HEVC_ISSUES,
        error: 'error',
      }),
    ]);
    expect(await tempLeftovers()).toEqual([]);

    const optional = build({
      asset: videoAsset(),
      emergency: false,
      outBytes: FIFTH,
      outProbe: OUT_2160,
      runOk: true,
      uploadThrows: true,
    });
    expect(await optional.pipeline.process(job())).toMatchObject({
      status: 'failed',
      reason: 'error',
    });
    expect(stampsOf(optional)).toEqual([]);
  });

  describe('the verdict is written only while the row still serves the file the job looked at, and keeps every other key', () => {
    const FACTS = {
      probe: { probeVersion: 2, codec: 'hevc' },
      probedAt: '2026-10-04T10:00:00.000Z',
      durationMs: 30_000,
      skippedReason: 'legacy-key',
    };

    it('merges over the existing processingMeta (the probe facts survive)', async () => {
      const t = required({
        asset: videoAsset({ processingMeta: FACTS }),
        runOk: false,
        outBytes: 0,
      });
      await t.pipeline.process(job());
      const meta = writesOf(t).find((d) => d.processingMeta)!.processingMeta;
      expect(meta).toMatchObject(FACTS);
      expect(meta.screen).toMatchObject({ ready: false, issues: HEVC_ISSUES });
    });

    it('a verdict never overwrites the verdict before it with less: a later stamp replaces only `screen`', async () => {
      const prior = {
        ...FACTS,
        screen: { version: 1, ready: false, issues: ['codec'], error: 'old' },
      };
      const t = build({
        asset: videoAsset({ processingMeta: prior }),
        emergency: false,
        outBytes: SOURCE_BYTES + 1,
        outProbe: OUT_2160,
        runOk: true,
      });
      await t.pipeline.process(job());
      const meta = writesOf(t).find((d) => d.processingMeta)!.processingMeta;
      expect(meta).toMatchObject(FACTS);
      expect(meta.screen).toMatchObject({ ready: true });
      expect(meta.screen).not.toHaveProperty('error'); // the stale "not ready" is replaced, not merged
      expect(meta.screen).not.toHaveProperty('issues');
    });

    it('NOT written when the row moved to another file while the job ran (nothing to say about a file it no longer serves)', async () => {
      const world: World = {
        asset: videoAsset({ processingMeta: FACTS }),
        emergency: false,
        outBytes: 0,
        outProbe: OUT_2160,
        runOk: true,
        inProbe: HEVC_HDR_4K,
      };
      const t = build(world);
      t.runner.transcode.mockImplementationOnce(async () => {
        world.asset.fileUrl = `${SUPA}${TENANT}/replaced-while-encoding.mp4`; // a new upload took the row
        return { ok: false, reason: 'ffmpeg exited 1: Invalid data found' };
      });
      expect(await t.pipeline.process(job())).toMatchObject({
        status: 'failed',
        reason: 'ffmpeg-failed',
      });
      expect(stampsOf(t)).toEqual([]);
      expect(writesOf(t).some((d) => d.processingMeta)).toBe(false);
    });

    it('the stamp is guarded in the WRITE too (a row that moves between the read and the write is left alone)', async () => {
      const t = required({
        asset: videoAsset({ processingMeta: FACTS }),
        runOk: false,
        outBytes: 0,
      });
      await t.pipeline.process(job());
      const stampWrite = t.prisma.client.asset.updateMany.mock.calls.find(
        ([a]: any) => a.data.processingMeta,
      )[0];
      expect(stampWrite.where).toEqual({
        id: 'asset-1',
        tenantId: TENANT,
        fileUrl: SRC_URL,
      });
    });

    it('a failed stamp (DB hiccup) never fails the job or hides its outcome', async () => {
      const t = required({ runOk: false, outBytes: 0 });
      t.prisma.client.asset.findFirst
        .mockImplementationOnce(async () => videoAsset()) // the job's own read
        .mockImplementationOnce(async () => {
          throw new Error('db down');
        });
      expect(await t.pipeline.process(job())).toMatchObject({
        status: 'failed',
        reason: 'ffmpeg-failed',
      });
    });
  });

  it('the stamp also lands when an already-optimal file gets its 1080p copy (a copy is made, the verdict is kept next to it)', async () => {
    // A real, valid copy: 1080p30 H.264 + AAC, the size the profile writes.
    const copy: ProbeResult = {
      ...OUT_2160,
      width: 1920,
      height: 1080,
      fps: 30,
      bitRate: 6_000_000,
    };
    const optimal4k: ProbeResult = {
      ...OUT_2160,
      bitRate: 12_000_000,
      fps: 30,
    };
    const facts = { probe: { probeVersion: 2, codec: 'h264' } };
    const t = build({
      asset: videoAsset({ processingMeta: facts }),
      emergency: false,
      outBytes: FIFTH, // the copy the fake ffmpeg writes
      outProbe: copy,
      runOk: true,
      inProbe: optimal4k,
    });
    // The copy must be a fast-start MP4 for the rendition to be accepted; the fake file is not one, so the
    // copy is dropped ("rendition-not-faststart") — what we pin here is that the VERDICT is still written.
    expect(await t.pipeline.process(job())).toMatchObject({
      status: 'skipped',
      reason: 'already-optimal',
    });
    expect(stampsOf(t)).toEqual([
      expect.objectContaining({ version: 1, ready: true }),
    ]);
    expect(
      writesOf(t).find((d) => d.processingMeta)!.processingMeta,
    ).toMatchObject(facts);
  });

  describe('the -fs bound: a size-only job stops at the source; a required one may use more — but never more than the room left', () => {
    const fsOf = (t: ReturnType<typeof build>) => {
      const a = t.runner.transcode.mock.calls[0][0];
      return a[a.indexOf('-fs') + 1];
    };

    it('size-only: exactly the source size', async () => {
      const t = build({
        asset: videoAsset(),
        emergency: false,
        outBytes: FIFTH,
        outProbe: OUT_2160,
        runOk: true,
      });
      await t.pipeline.process(job());
      expect(fsOf(t)).toBe(String(SOURCE_BYTES));
    });

    it('required: min(2 GB, max(4 × source, 512 MB)) — 512 MB for a small source, 4× for a big one, 2 GB at most', async () => {
      const small = required();
      await small.pipeline.process(job());
      expect(fsOf(small)).toBe(String(512 * MB));

      const big = required({ downloadBytes: 300 * MB });
      await big.pipeline.process(job({ sourceBytes: 300 * MB }));
      expect(fsOf(big)).toBe(String(300 * MB * 4));

      const huge = required({ downloadBytes: 1_500 * MB });
      await huge.pipeline.process(job({ sourceBytes: 1_500 * MB }));
      expect(fsOf(huge)).toBe('2000000000');
    });

    it('required: clamped to the free temp disk (less 128 MB for the 1080p copy) read AFTER the download', async () => {
      // preflight sees plenty; once the source has landed only 300 MB are left
      const t = required({ free: [50 * 1024 * MB, 300 * MB] });
      await t.pipeline.process(job());
      expect(fsOf(t)).toBe(String(300 * MB - 128 * MB));
    });

    it('required: never below the source size (the preflight did account for that much), whatever is left', async () => {
      const t = required({ free: [50 * 1024 * MB, 20 * MB] });
      await t.pipeline.process(job());
      expect(fsOf(t)).toBe(String(SOURCE_BYTES));
    });

    it('required: an unknown amount of free disk keeps the full bound', async () => {
      const t = required({ free: [50 * 1024 * MB, null] });
      await t.pipeline.process(job());
      expect(fsOf(t)).toBe(String(512 * MB));
    });

    it('size-only never re-reads the disk for its bound (it is the source size, which the preflight covered)', async () => {
      const t = build({
        asset: videoAsset(),
        emergency: false,
        outBytes: FIFTH,
        outProbe: OUT_2160,
        runOk: true,
        free: [50 * 1024 * MB, 20 * MB],
      });
      await t.pipeline.process(job());
      expect(fsOf(t)).toBe(String(SOURCE_BYTES));
    });
  });

  describe('the time allowance: a conversion a screen depends on is given longer than a shrink', () => {
    const timeoutOf = (t: ReturnType<typeof build>) =>
      t.runner.transcode.mock.calls[0][1].timeoutMs;
    // five minutes long, so neither allowance is hidden by the ten-minute floor
    const fiveMinutes = (probe: ProbeResult): ProbeResult => ({ ...probe, durationS: 300 });

    it('size-only: 8 s of wall clock per second of video; required: 20', async () => {
      const shrink = build({
        asset: videoAsset(),
        emergency: false,
        outBytes: FIFTH,
        outProbe: fiveMinutes(OUT_2160),
        runOk: true,
        inProbe: fiveMinutes(CAMERA_4K),
      });
      await shrink.pipeline.process(job());
      expect(timeoutOf(shrink)).toBe(300 * 8 * 1000);

      const convert = required({
        inProbe: fiveMinutes(HEVC_HDR_4K),
        outProbe: fiveMinutes(OUT_2160),
      });
      await convert.pipeline.process(job());
      expect(timeoutOf(convert)).toBe(300 * 20 * 1000);
    });
  });

  describe('EMERGENCY media is never stamped, however incompatible it is (a not-ready verdict must never hide alert media)', () => {
    it('an asset that is emergency media from the start: skipped before anything is downloaded — no verdict', async () => {
      const t = required({ emergency: true });
      expect(await t.pipeline.process(job())).toEqual({
        status: 'skipped',
        reason: 'emergency-content',
      });
      expect(t.storage.downloadObjectToFile).not.toHaveBeenCalled();
      expect(t.prisma.client.asset.updateMany).not.toHaveBeenCalled();
    });

    it('a REQUIRED conversion whose asset BECOMES emergency media mid-encode: the copy is removed, nothing swapped, NO verdict', async () => {
      const t = required({ emergencyAtSwap: true });
      const out = await t.pipeline.process(job());
      expect(out).toMatchObject({
        status: 'skipped',
        reason: 'emergency-content',
      });
      expect(t.deleted).toEqual(t.uploaded);
      expect(writesOf(t).some((d) => 'fileUrl' in d)).toBe(false);
      expect(stampsOf(t)).toEqual([]);
    });

    it('a REQUIRED conversion whose row changed mid-encode (the swap matches nothing): copy removed, NO verdict lands on the row', async () => {
      const asset = videoAsset();
      const t = required({ asset, swapCount: 0 });
      t.prisma.client.asset.findFirst
        .mockImplementationOnce(async () => asset)
        .mockImplementationOnce(async () => ({
          fileUrl: `${SUPA}${TENANT}/replaced.mp4`,
        }));
      const out = await t.pipeline.process(job());
      expect(out).toMatchObject({
        status: 'skipped',
        reason: 'source-changed',
      });
      expect(t.deleted).toEqual(t.uploaded);
      // The swap WAS attempted (its payload carries the "ready" verdict) and matched nothing:
      // the row — which the fake updates only for writes that matched — holds no verdict.
      expect(asset.fileUrl).toBe(SRC_URL);
      expect(asset.processingMeta?.screen).toBeUndefined();
    });
  });
});

describe('VideoTranscodePipeline — a >1080p ORIGINAL kept as the served file still gets its 1080p copy', () => {
  // Why: publication to a 1080p screen waits for a decoder-sized copy of every
  // >1080p video, and treats a FINISHED job with no copy as "none is coming" — it
  // fails the whole schedule. A low-bitrate 4K file whose size-only encode came out
  // no smaller used to end `skipped / not-smaller` here, copy-less, and blocked
  // every 1080p screen's playlist for good.
  const FACTS = {
    probe: { probeVersion: 2, codec: 'h264' },
    durationMs: 30_000,
  };

  /** A screen-safe 4K original whose size-only encode comes out `outBytes`; the copy follows `rendition`. */
  const keep4k = (over: Partial<World> = {}) => {
    const asset = videoAsset({ processingMeta: { ...FACTS } });
    const t = build({
      asset,
      emergency: false,
      outBytes: SOURCE_BYTES + 1, // NOT smaller
      outProbe: OUT_2160,
      runOk: true,
      rendition: 'ok',
      ...over,
    });
    return { asset, t };
  };
  const copyPath = (t: { uploaded: string[] }) =>
    new RegExp(`^${TENANT}/optimized/renditions/[0-9a-f-]{36}\\.mp4$`).test(
      t.uploaded[0] ?? '',
    );

  it('NOT SMALLER → the copy is made FROM THE ORIGINAL and recorded beside it; the original keeps serving, ready', async () => {
    const { asset, t } = keep4k();
    const out = await t.pipeline.process(job());

    expect(out).toMatchObject({
      status: 'done',
      reason: 'rendition-created',
      outputBytes: MB,
    });
    // Exactly one object is uploaded — the copy under renditions/, never a replacement for the original.
    expect(t.uploaded).toHaveLength(1);
    expect(copyPath(t)).toBe(true);
    expect(out.outputUrl).toBe(`${SUPA}${t.uploaded[0]}`);
    expect(out.details).toMatchObject({
      originalKept: 'not-smaller',
      rendition: {
        attempted: true,
        created: true,
        width: 1920,
        height: 1080,
        size: MB,
      },
    });

    // The ROW: still the original, now with the copy AND the verdict — written together, once.
    expect(asset.fileUrl).toBe(SRC_URL);
    expect(asset.processingMeta.renditions['1080p']).toEqual({
      url: `${SUPA}${t.uploaded[0]}`,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      size: MB,
      width: 1920,
      height: 1080,
    });
    expect(asset.processingMeta.screen).toMatchObject({
      version: 1,
      ready: true,
    });
    expect(asset.processingMeta).toMatchObject(FACTS); // the facts already on the row survive
    expect(writesOf(t).some((d) => 'fileUrl' in d)).toBe(false);
    expect(writesOf(t).filter((d) => d.processingMeta)).toHaveLength(1);
    const write = t.prisma.client.asset.updateMany.mock.calls.find(
      ([a]: any) => a.data.processingMeta,
    )[0];
    expect(write.where).toEqual({
      id: 'asset-1',
      tenantId: TENANT,
      fileUrl: SRC_URL,
      playlistItems: { none: { playlist: { isProtected: true } } },
    });
    expect(writesOf(t)).toContainEqual({ fileHash: 'sha-original' });
    expect(
      t.prisma.client.auditLog.create.mock.calls.map(
        ([a]: any) => a.data.action,
      ),
    ).toEqual(['ASSET_VIDEO_RENDITION_CREATED']);

    // The size-only encode ran first; the copy was encoded from the ORIGINAL (in.mp4).
    expect(t.runner.transcode).toHaveBeenCalledTimes(2);
    const copyArgs = t.runner.transcode.mock.calls[1][0];
    expect(path.basename(copyArgs[copyArgs.indexOf('-i') + 1])).toBe('in.mp4');
    expect(path.basename(copyArgs[copyArgs.length - 1])).toBe(
      'rendition-1080.mp4',
    );
    expect(await tempLeftovers()).toEqual([]);
  });

  it('NOT SMALLER + the copy cannot be made → the original keeps serving, the outcome SAYS so, and `renditions` is absent', async () => {
    const { asset, t } = keep4k({ rendition: 'ffmpeg-fails' });
    const out = await t.pipeline.process(job());

    expect(out).toMatchObject({ status: 'skipped', reason: 'not-smaller' });
    expect(out.error).toMatch(
      /^the 1080p playback copy could not be made: ffmpeg: ffmpeg exited 1/,
    );
    expect(out.details).toMatchObject({
      rendition: {
        attempted: true,
        created: false,
        reason: expect.stringContaining('ffmpeg exited 1'),
      },
    });
    expect(t.uploaded).toEqual([]);
    expect(asset.fileUrl).toBe(SRC_URL);
    expect(asset.processingMeta.renditions).toBeUndefined();
    expect(asset.processingMeta.screen).toMatchObject({ ready: true }); // the ORIGINAL is screen-safe
    expect(asset.processingMeta).toMatchObject(FACTS);
    expect(writesOf(t)).toContainEqual({ fileHash: 'sha-original' });
    expect(await tempLeftovers()).toEqual([]);
  });

  it('a copy that fails verification (wrong size) is rejected like any other: nothing uploaded, `renditions` absent', async () => {
    const { asset, t } = keep4k({
      renditionProbe: { ...RENDITION_PROBE, width: 1280, height: 720 },
    });
    const out = await t.pipeline.process(job());
    expect(out).toMatchObject({ status: 'skipped', reason: 'not-smaller' });
    expect(out.error).toContain('output-dims-1280x720-expected-1920x1080');
    expect(t.uploaded).toEqual([]);
    expect(asset.processingMeta.renditions).toBeUndefined();
  });

  it('an ALREADY-OPTIMAL 4K original gets the same single write — copy + verdict — and no size-only encode', async () => {
    const { asset, t } = keep4k({
      inProbe: { ...OUT_2160, bitRate: 12_000_000, fps: 30 },
    });
    const out = await t.pipeline.process(job());
    expect(out).toMatchObject({ status: 'done', reason: 'rendition-created' });
    expect(out.details).toMatchObject({ originalKept: 'already-optimal' });
    expect(t.runner.transcode).toHaveBeenCalledTimes(1); // only the copy
    expect(asset.fileUrl).toBe(SRC_URL);
    expect(asset.processingMeta.renditions['1080p'].width).toBe(1920);
    expect(asset.processingMeta.screen).toMatchObject({ ready: true });
    expect(writesOf(t).filter((d) => d.processingMeta)).toHaveLength(1);
  });

  it('a FAILED size-only encode of a screen-safe 4K original still yields the copy (the failure is kept in the details)', async () => {
    const { asset, t } = keep4k({ runOk: false, outBytes: 0 });
    const out = await t.pipeline.process(job());
    expect(out).toMatchObject({ status: 'done', reason: 'rendition-created' });
    expect(out.details).toMatchObject({
      originalKept: 'ffmpeg-failed',
      originalError: expect.stringContaining('Invalid data found'),
    });
    expect(asset.processingMeta.renditions['1080p']).toBeDefined();
    expect(asset.processingMeta.screen).toMatchObject({ ready: true });
  });

  it('…and when the copy fails too, the job is the failed encode it always was (error kept, copy failure in the details, NO verdict)', async () => {
    const { asset, t } = keep4k({
      runOk: false,
      outBytes: 0,
      rendition: 'ffmpeg-fails',
    });
    const out = await t.pipeline.process(job());
    expect(out).toMatchObject({ status: 'failed', reason: 'ffmpeg-failed' });
    expect(out.error).toContain('Invalid data found');
    expect(out.details).toMatchObject({
      rendition: { attempted: true, created: false },
    });
    expect(asset.processingMeta.renditions).toBeUndefined();
    expect(asset.processingMeta.screen).toBeUndefined(); // a failed size-only encode says nothing about the original
    expect(t.uploaded).toEqual([]);
  });

  it.each<[string, Partial<ProbeResult>]>([
    ['a 1080p original', { width: 1920, height: 1080, bitRate: 20_000_000 }],
    [
      'a portrait 1080×1920 original',
      { width: 1080, height: 1920, bitRate: 20_000_000 },
    ],
  ])(
    '%s needs no copy: nothing is attempted, the outcome is the plain not-smaller',
    async (_name, dims) => {
      const { asset, t } = keep4k({
        inProbe: { ...OUT_2160, fps: 30, ...dims },
      });
      const out = await t.pipeline.process(job());
      expect(out).toMatchObject({ status: 'skipped', reason: 'not-smaller' });
      expect(out).not.toHaveProperty('error');
      expect(out.details).not.toHaveProperty('rendition');
      expect(t.runner.transcode).toHaveBeenCalledTimes(1);
      expect(asset.processingMeta.renditions).toBeUndefined();
      expect(asset.processingMeta.screen).toMatchObject({ ready: true });
    },
  );

  describe('the guards the already-optimal copy always had', () => {
    it('the asset becomes EMERGENCY media while the copy is being made → nothing uploaded or written, no verdict', async () => {
      const { asset, t } = keep4k({ emergencyFromCheck: 2 });
      expect(await t.pipeline.process(job())).toMatchObject({
        status: 'skipped',
        reason: 'emergency-content',
      });
      expect(t.uploaded).toEqual([]);
      expect(asset.processingMeta.renditions).toBeUndefined();
      expect(asset.processingMeta.screen).toBeUndefined();
    });

    it('…or AFTER the copy was uploaded (the last check before the write) → the copy is removed again', async () => {
      const { asset, t } = keep4k({ emergencyFromCheck: 3 });
      expect(await t.pipeline.process(job())).toMatchObject({
        status: 'skipped',
        reason: 'emergency-content',
      });
      expect(t.uploaded).toHaveLength(1);
      expect(t.deleted).toEqual(t.uploaded);
      expect(writesOf(t).some((d) => d.processingMeta)).toBe(false);
      expect(asset.processingMeta.renditions).toBeUndefined();
    });

    it('the row moved to another file while the copy was made → the copy is removed, `source-changed`, no copy on the row', async () => {
      const { asset, t } = keep4k();
      t.storage.uploadFileFromDisk.mockImplementationOnce(async (p: string) => {
        t.uploaded.push(p);
        asset.fileUrl = `${SUPA}${TENANT}/replaced-while-encoding.mp4`; // a new upload took the row
        return `${SUPA}${p}`;
      });
      expect(await t.pipeline.process(job())).toMatchObject({
        status: 'skipped',
        reason: 'source-changed',
      });
      expect(t.deleted).toEqual(t.uploaded);
      expect(asset.processingMeta.renditions).toBeUndefined();
    });

    it('the write is refused when the asset is in a protected playlist (the same atomic guard as the swap)', async () => {
      const { t } = keep4k();
      await t.pipeline.process(job());
      const write = t.prisma.client.asset.updateMany.mock.calls.find(
        ([a]: any) => a.data.processingMeta,
      )[0];
      expect(write.where.playlistItems).toEqual({
        none: { playlist: { isProtected: true } },
      });
    });

    it('an ABORTED size-only encode hands the job back: no copy attempt, no verdict', async () => {
      const { asset, t } = keep4k({ runOk: 'aborted', outBytes: 0 });
      expect(await t.pipeline.process(job())).toMatchObject({
        status: 'failed',
        reason: 'aborted',
      });
      expect(t.runner.transcode).toHaveBeenCalledTimes(1);
      expect(asset.processingMeta.screen).toBeUndefined();
    });

    it('an abort that lands right after the copy was uploaded leaves nothing behind', async () => {
      const ac = new AbortController();
      const { asset, t } = keep4k();
      t.storage.uploadFileFromDisk.mockImplementationOnce(async (p: string) => {
        t.uploaded.push(p);
        ac.abort();
        return `${SUPA}${p}`;
      });
      expect(
        await t.pipeline.process(job(), { signal: ac.signal }),
      ).toMatchObject({ status: 'failed', reason: 'aborted' });
      expect(t.deleted).toEqual(t.uploaded);
      expect(asset.processingMeta.renditions).toBeUndefined();
    });
  });

  describe('a REQUIRED conversion is unchanged: the copy comes from its OUTPUT, and a failed conversion gets none', () => {
    const requiredWorld = (over: Partial<World> = {}) => {
      const asset = videoAsset({ processingMeta: { ...FACTS } });
      const t = build({
        asset,
        emergency: false,
        outBytes: FIFTH,
        outProbe: OUT_2160,
        runOk: true,
        inProbe: HEVC_HDR_4K,
        rendition: 'ok',
        ...over,
      });
      return { asset, t };
    };

    it('swapped → the copy is encoded from out.mp4 and rides in the swap write', async () => {
      const { asset, t } = requiredWorld();
      const out = await t.pipeline.process(job());
      expect(out).toMatchObject({ status: 'done', reason: 'swapped' });
      expect(out.details).toMatchObject({
        rendition: { attempted: true, created: true },
      });
      const copyArgs = t.runner.transcode.mock.calls[1][0];
      expect(path.basename(copyArgs[copyArgs.indexOf('-i') + 1])).toBe(
        'out.mp4',
      );
      expect(asset.processingMeta.renditions['1080p']).toBeDefined();
      expect(asset.processingMeta.screen).toMatchObject({
        ready: true,
        convertedFrom: HEVC_ISSUES,
      });
    });

    it('swapped but the copy failed → still swapped; `renditions` absent; the details say why', async () => {
      const { asset, t } = requiredWorld({ rendition: 'ffmpeg-fails' });
      const out = await t.pipeline.process(job());
      expect(out).toMatchObject({ status: 'done', reason: 'swapped' });
      expect(out.details).toMatchObject({
        rendition: {
          attempted: true,
          created: false,
          reason: expect.stringContaining('ffmpeg exited 1'),
        },
      });
      expect(asset.processingMeta.renditions).toBeUndefined();
    });

    it('a FAILED required conversion is never given a copy (the original is not screen-safe): not ready, no copy', async () => {
      const { asset, t } = requiredWorld({ runOk: false, outBytes: 0 });
      expect(await t.pipeline.process(job())).toMatchObject({
        status: 'failed',
        reason: 'ffmpeg-failed',
      });
      expect(t.runner.transcode).toHaveBeenCalledTimes(1);
      expect(asset.processingMeta.renditions).toBeUndefined();
      expect(asset.processingMeta.screen).toMatchObject({
        ready: false,
        issues: HEVC_ISSUES,
      });
    });
  });

  it('remuxAfterTranscode: a job that kept the original and added only its copy still hands it to the fast-start pass', () => {
    // `done` normally means "swapped" (a NEW file is served — no pass); `rendition-created` kept the original.
    expect(
      remuxAfterTranscode({ status: 'done', reason: 'rendition-created' }),
    ).toBe(true);
    expect(remuxAfterTranscode({ status: 'done', reason: 'swapped' })).toBe(
      false,
    );
    expect(
      remuxAfterTranscode({ status: 'skipped', reason: 'not-smaller' }),
    ).toBe(true);
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
    expect(primaryArgs[primaryArgs.indexOf('-fs') + 1]).toBe(
      String(SOURCE_BYTES),
    );
    expect(renditionArgs[renditionArgs.indexOf('-fs') + 1]).toBe(
      String(256 * MB),
    );
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
      // The file the row serves did not change, so no write may change it or drop
      // a fact about it. (The only processingMeta write there can be is the
      // screen-readiness verdict, merged OVER every existing key.)
      for (const data of writesOf(t)) {
        expect(data).not.toHaveProperty('fileUrl');
        if (data.processingMeta)
          expect(data.processingMeta).toMatchObject(ORIGINAL_FACTS);
      }
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

// ── 2026-10-05 — the upload's `pending` NEVER survives a finished job ──────────
//
// complete-upload stamps a video that must be converted
// `{ ready: false, pending: true, issues }` (the manifest leaves it out, the
// library says "converting"). Every way a job can END must replace that with a
// finished verdict; a run handed back to the queue must leave it alone.
describe('VideoTranscodePipeline — the upload’s "converting" stamp is replaced by a finished verdict', () => {
  const PENDING = {
    version: 1,
    ready: false,
    pending: true,
    issues: HEVC_ISSUES,
    checkedAt: '2026-10-05T09:00:00.000Z',
  };
  const FACTS = { probe: { probeVersion: 2, codec: 'hevc' }, durationMs: 30_000 };
  /** The asset as complete-upload created it: the probe facts + the pending stamp. */
  const uploaded = (over: Record<string, unknown> = {}) =>
    videoAsset({ processingMeta: { ...FACTS, screen: PENDING }, ...over });
  /** A REQUIRED conversion (HEVC HDR) of an upload stamped pending. */
  const pendingJob = (over: Partial<World> = {}) =>
    build({
      asset: uploaded(),
      emergency: false,
      outBytes: FIFTH,
      outProbe: OUT_2160,
      runOk: true,
      inProbe: HEVC_HDR_4K,
      ...over,
    });
  /** The last `processingMeta` written (a stamp, a swap or a settle) — what the row holds when the job is over. */
  const lastMetaWrite = (t: { prisma: any }) => {
    const calls = t.prisma.client.asset.updateMany.mock.calls.filter(
      ([a]: any) => a.data.processingMeta !== undefined,
    );
    return calls[calls.length - 1]?.[0];
  };
  const finalScreen = (t: { prisma: any }) => lastMetaWrite(t)?.data.processingMeta.screen;

  describe('the exits that write a verdict REPLACE the stamp — no `pending` survives', () => {
    it('converted and swapped → ready, converted from what', async () => {
      const t = pendingJob();
      expect(await t.pipeline.process(job())).toMatchObject({ status: 'done', reason: 'swapped' });
      expect(finalScreen(t)).toEqual({
        version: 1,
        ready: true,
        convertedFrom: HEVC_ISSUES,
        checkedAt: expect.stringMatching(CHECKED_AT),
      });
    });

    it.each<[string, Partial<World>, string]>([
      ['ffmpeg fails', { runOk: false, outBytes: 0 }, 'ffmpeg-failed'],
      ['the encode times out', { runOk: 'timeout', outBytes: 0 }, 'timeout'],
      ['the output is rejected', { outProbe: { ...OUT_2160, durationS: 3 } }, 'output-rejected'],
    ])('the conversion fails (%s) → not ready, with why — and NO pending', async (_label, over, error) => {
      const t = pendingJob(over);
      await t.pipeline.process(job());
      expect(finalScreen(t)).toEqual({
        version: 1,
        ready: false,
        issues: HEVC_ISSUES,
        error,
        checkedAt: expect.stringMatching(CHECKED_AT),
      });
      expect(lastMetaWrite(t).data.processingMeta).toMatchObject(FACTS);
    });

    it('the file cannot be read at all → not ready, unreadable', async () => {
      const t = pendingJob({ probeFails: 'in' });
      await t.pipeline.process(job());
      expect(finalScreen(t)).toEqual(
        expect.objectContaining({ ready: false, issues: ['unreadable'], error: 'probe-failed' }),
      );
      expect(finalScreen(t)).not.toHaveProperty('pending');
    });
  });

  describe('the exits that write NO verdict of their own: a still-pending stamp is SETTLED as not ready', () => {
    it.each<[string, (t: ReturnType<typeof pendingJob>) => void, Partial<World>, string]>([
      ['no free temp disk', () => undefined, { free: 4 * MB }, 'insufficient-temp-disk'],
      [
        'the size is unknown',
        (t) => t.storage.getObjectInfo.mockImplementationOnce(async () => null),
        {},
        'source-size-unknown',
      ],
      [
        'the download fails',
        (t) =>
          t.storage.downloadObjectToFile.mockImplementationOnce(async () => {
            throw new Error('download returned 503');
          }),
        {},
        'error',
      ],
    ])('%s → { ready: false, the upload’s issues, error }', async (_label, arrange, over, error) => {
      const t = pendingJob(over);
      arrange(t);
      const out = await t.pipeline.process(job({ sourceBytes: error === 'source-size-unknown' ? null : SOURCE_BYTES }));
      expect(out).toMatchObject({ status: 'failed', reason: error });
      expect(t.uploaded).toEqual([]); // nothing was converted
      expect(finalScreen(t)).toEqual({
        version: 1,
        ready: false,
        issues: HEVC_ISSUES,
        error,
        checkedAt: expect.stringMatching(CHECKED_AT),
      });
      // …written guarded by the file it read, tenant-scoped, the facts kept.
      const write = lastMetaWrite(t);
      expect(write.where).toEqual({ id: 'asset-1', tenantId: TENANT, fileUrl: SRC_URL });
      expect(write.data.processingMeta).toMatchObject(FACTS);
    });

    it('an archived asset is settled too (restoring it later must not resurrect "converting")', async () => {
      const t = pendingJob({ asset: uploaded({ status: 'ARCHIVED' }) });
      expect((await t.pipeline.process(job())).reason).toBe('asset-archived');
      expect(finalScreen(t)).toMatchObject({ ready: false, error: 'asset-archived' });
      expect(finalScreen(t)).not.toHaveProperty('pending');
    });

    it('a verdict write that failed (DB hiccup) is retried by the settle step, so it does not stay "converting"', async () => {
      const t = pendingJob({ runOk: false, outBytes: 0 });
      let first = true;
      const real = t.prisma.client.asset.updateMany.getMockImplementation();
      t.prisma.client.asset.updateMany.mockImplementation(async (args: any) => {
        if (first && args.data.processingMeta && !('fileUrl' in args.data) && !('fileHash' in args.data)) {
          first = false;
          throw new Error('db down');
        }
        return real(args);
      });
      expect(await t.pipeline.process(job())).toMatchObject({ status: 'failed', reason: 'ffmpeg-failed' });
      expect(finalScreen(t)).toEqual(
        expect.objectContaining({ ready: false, issues: HEVC_ISSUES, error: 'ffmpeg-failed' }),
      );
      expect(t.prisma.client.asset.findFirst.mock.calls.length).toBeGreaterThan(2);
    });

    it('the run’s OWN probe wins over the upload’s: a file the job found screen-safe is settled READY', async () => {
      // A size-only encode that fails says nothing itself (the source is
      // screen-safe) — but a pending stamp from the upload must still end.
      const t = pendingJob({ inProbe: CAMERA_4K, runOk: false, outBytes: 0 });
      await t.pipeline.process(job());
      expect(finalScreen(t)).toEqual({ version: 1, ready: true, checkedAt: expect.stringMatching(CHECKED_AT) });
    });
  });

  describe('left alone', () => {
    it('a run handed back to the queue (aborted: a deploy, a lost lease) stamps NOTHING — it is still converting', async () => {
      const t = pendingJob({ runOk: 'aborted', outBytes: 0 });
      expect(await t.pipeline.process(job())).toMatchObject({ status: 'failed', reason: 'aborted' });
      expect(stampsOf(t)).toEqual([]);
      expect(t.prisma.client.asset.findFirst).toHaveBeenCalledTimes(1); // the job's own read; no settle
    });

    it('…also when the abort surfaces as a throw', async () => {
      const ac = new AbortController();
      const t = pendingJob();
      t.storage.downloadObjectToFile.mockImplementationOnce(async () => {
        ac.abort();
        throw new Error('The operation was aborted');
      });
      expect(await t.pipeline.process(job(), { signal: ac.signal })).toMatchObject({ reason: 'aborted' });
      expect(stampsOf(t)).toEqual([]);
    });

    it('…and when it lands AFTER the plan said "required" (mid-upload of the converted copy)', async () => {
      const ac = new AbortController();
      const t = pendingJob();
      t.storage.uploadFileFromDisk.mockImplementationOnce(async () => {
        ac.abort();
        throw new Error('The operation was aborted');
      });
      expect(await t.pipeline.process(job(), { signal: ac.signal })).toMatchObject({ reason: 'aborted' });
      expect(stampsOf(t)).toEqual([]);
      // NEGATIVE CONTROL: the same throw WITHOUT an abort is a real failure, and says so.
      const failed = pendingJob({ uploadThrows: true });
      expect(await failed.pipeline.process(job())).toMatchObject({ status: 'failed', reason: 'error' });
      expect(finalScreen(failed)).toEqual(
        expect.objectContaining({ ready: false, issues: HEVC_ISSUES, error: 'error' }),
      );
    });

    it('EMERGENCY media is never stamped — not even to settle a pending one', async () => {
      const t = pendingJob({ emergency: true });
      expect(await t.pipeline.process(job())).toEqual({ status: 'skipped', reason: 'emergency-content' });
      expect(t.prisma.client.asset.updateMany).not.toHaveBeenCalled();
      // …nor when the row becomes alert media between the job's start and the settle.
      const late = pendingJob({ free: 4 * MB, emergencyFromCheck: 2 });
      await late.pipeline.process(job());
      expect(late.prisma.client.asset.updateMany).not.toHaveBeenCalled();
    });

    it('another job is queued / running for the same asset: it will stamp the verdict', async () => {
      const t = pendingJob({ free: 4 * MB, otherActiveJob: true });
      await t.pipeline.process(job());
      expect(t.prisma.client.asset.updateMany).not.toHaveBeenCalled();
      const where = t.prisma.client.videoTranscodeJob.findFirst.mock.calls[0][0].where;
      expect(where).toEqual({
        assetId: 'asset-1',
        tenantId: TENANT,
        status: { in: ['queued', 'running'] },
        NOT: { id: 'job-1' },
      });
    });

    it('a finished verdict (or none at all) is not touched by the settle step', async () => {
      const finished = pendingJob({
        free: 4 * MB,
        asset: uploaded({ processingMeta: { screen: { version: 1, ready: true, checkedAt: 'x' } } }),
      });
      await finished.pipeline.process(job());
      expect(finished.prisma.client.asset.updateMany).not.toHaveBeenCalled();

      const none = pendingJob({ free: 4 * MB, asset: videoAsset() });
      await none.pipeline.process(job());
      expect(none.prisma.client.asset.updateMany).not.toHaveBeenCalled();
    });
  });

  it('settlePendingVerdict (the stale sweep’s path) settles a pending stamp with the job’s reason', async () => {
    const t = pendingJob();
    expect(
      await t.pipeline.settlePendingVerdict({ id: 'job-1', tenantId: TENANT, assetId: 'asset-1' }, { reason: 'stalled' }),
    ).toBe('settled');
    expect(finalScreen(t)).toEqual({
      version: 1,
      ready: false,
      issues: HEVC_ISSUES,
      error: 'stalled',
      checkedAt: expect.stringMatching(CHECKED_AT),
    });
    // Idempotent: a second pass finds nothing pending.
    expect(
      await t.pipeline.settlePendingVerdict({ id: 'job-1', tenantId: TENANT, assetId: 'asset-1' }, { reason: 'stalled' }),
    ).toBe('not-pending');
    // Tenant-scoped: another tenant's id finds nothing.
    expect(
      await t.pipeline.settlePendingVerdict({ id: 'job-1', tenantId: 'tenant-2', assetId: 'asset-1' }, { reason: 'stalled' }),
    ).toBe('gone');
  });
});
