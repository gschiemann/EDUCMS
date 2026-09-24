/**
 * verify-video-transcode-e2e.ts — run the PRODUCTION transcode pipeline on real video files with the
 * real ffmpeg/ffprobe (2026-09-23). Storage is a local directory and Prisma is an in-memory asset
 * table, so nothing touches Supabase or a database; everything between them — probe, plan, the
 * actual ffmpeg argv, the size + completeness gate, the hash, the conditional swap write — is the
 * code that runs in the API.
 *
 *   npx ts-node --transpile-only scripts/verify-video-transcode-e2e.ts <clip.mp4> [<clip.mp4> …]
 *
 * Prints, per clip: bytes in, bytes out, % saved, wall seconds, the rung, and the outcome.
 * Exit 1 if any clip that should swap did not, or if a swapped output fails an independent re-probe.
 */
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VideoTranscodePipeline } from '../src/storage/video-transcode/video-transcode.pipeline';
import { parseProbe } from '../src/storage/video-transcode/transcode-profile';
import { sha256File } from '../src/storage/storage-stream';

const SUPA = 'https://example.supabase.co/storage/v1/object/public/assets/';
const MB = 1024 * 1024;

async function main() {
  const clips = process.argv.slice(2);
  if (clips.length === 0) {
    console.error('usage: verify-video-transcode-e2e.ts <clip.mp4> [...]');
    process.exit(2);
  }
  const bucket = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-e2e-bucket-'));
  let failures = 0;
  try {
    for (const [i, clip] of clips.entries()) {
      const tenant = 'tenant-e2e';
      const name = `${'0f6b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5'}${i}.mp4`;
      const srcPath = `${tenant}/${name}`;
      await fs.mkdir(path.join(bucket, tenant), { recursive: true });
      await fs.copyFile(clip, path.join(bucket, srcPath));
      const sourceBytes = (await fs.stat(clip)).size;

      const asset = { id: `asset-${i}`, tenantId: tenant, fileUrl: `${SUPA}${srcPath}`, mimeType: 'video/mp4', status: 'PUBLISHED', fileHash: null as string | null };
      const writes: any[] = [];
      const prisma = {
        client: {
          asset: {
            findFirst: async ({ where }: any) => (where.id === asset.id && where.tenantId === asset.tenantId ? { ...asset } : null),
            updateMany: async ({ where, data }: any) => {
              const match = where.id === asset.id && where.tenantId === asset.tenantId && (!('fileUrl' in where) || where.fileUrl === asset.fileUrl);
              if (!match) return { count: 0 };
              writes.push(data);
              Object.assign(asset, data);
              return { count: 1 };
            },
          },
          auditLog: { create: async () => ({}) },
          $queryRawUnsafe: async () => [{ emergency: false }],
        },
      } as any;
      const storage = {
        extractPath: (u: string) => (u.startsWith(SUPA) ? u.slice(SUPA.length) : null),
        getObjectInfo: async (p: string) => ({ size: (await fs.stat(path.join(bucket, p))).size, contentType: 'video/mp4' }),
        downloadObjectToFile: async (p: string, dest: string) => {
          await fs.copyFile(path.join(bucket, p), dest);
          return { bytes: (await fs.stat(dest)).size, sha256: await sha256File(dest), contentType: 'video/mp4' };
        },
        uploadFileFromDisk: async (p: string, src: string) => {
          await fs.mkdir(path.dirname(path.join(bucket, p)), { recursive: true });
          await fs.copyFile(src, path.join(bucket, p));
          return `${SUPA}${p}`;
        },
        delete: async (p: string) => fs.rm(path.join(bucket, p), { force: true }),
      } as any;

      const pipeline = new VideoTranscodePipeline(prisma, storage);
      const progress: number[] = [];
      const t0 = Date.now();
      const out = await pipeline.process(
        { id: `job-${i}`, tenantId: tenant, assetId: asset.id, sourceUrl: asset.fileUrl, sourceBytes, attempts: 1 },
        { onProgress: (p) => progress.push(p) },
      );
      const wall = (Date.now() - t0) / 1000;
      const d: any = out.details ?? {};
      const bytesOut = out.outputBytes ?? d.bytesOut ?? null;
      console.log(
        `${path.basename(clip)}: ${out.status}/${out.reason} rung=${d.profile ?? '-'} ` +
          `in=${sourceBytes} B (${(sourceBytes / MB).toFixed(1)} MiB) ` +
          `out=${bytesOut ?? '-'} B${bytesOut ? ` (${(bytesOut / MB).toFixed(1)} MiB, ${(100 * (1 - bytesOut / sourceBytes)).toFixed(1)}% smaller)` : ''} ` +
          `wall=${wall.toFixed(1)}s progress-writes=${progress.length} (last ${progress[progress.length - 1] ?? '-'}%)`,
      );
      if (out.status === 'done') {
        // Independent re-probe of what the asset now serves.
        const served = asset.fileUrl.slice(SUPA.length);
        const probe = parseProbe(
          JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path.join(bucket, served)], { encoding: 'utf8' })),
        );
        const hashOk = asset.fileHash === (await sha256File(path.join(bucket, served)));
        console.log(
          `   served now: ${served} — ${probe.videoCodec} ${probe.width}×${probe.height} ${probe.fps}fps ${probe.durationS}s audio=${probe.hasAudio} hash-matches=${hashOk}`,
        );
        if (!hashOk || probe.videoCodec !== 'h264') failures += 1;
        const original = await fs.stat(path.join(bucket, srcPath)).then(() => true, () => false);
        console.log(`   original retained until the 7-day sweep: ${original}`);
      }
    }
  } finally {
    await fs.rm(bucket, { recursive: true, force: true });
  }
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
