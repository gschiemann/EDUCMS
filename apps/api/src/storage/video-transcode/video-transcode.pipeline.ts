/**
 * VideoTranscodePipeline — ONE claimed job, start to finish (2026-09-23).
 *
 *   asset still serving the source? not emergency media? enough temp disk?
 *     → stream the original from storage to a temp file (hashed as it lands)
 *     → ffprobe → plan (skip if the file already IS the signage profile)
 *     → ffmpeg (2 threads, nice 19, SIGKILL budget from the duration, -fs at
 *       the source size)
 *     → smaller? → ffprobe the output → verify it is the WHOLE video
 *     → stream it to `<tenant>/optimized/<uuid>.mp4`
 *     → ONE conditional write swaps the asset's fileUrl — only while the asset
 *       still serves exactly the source and is still not in a protected playlist
 *
 * THE CONTRACT: `process` never throws and never breaks an asset. Every early
 * exit returns an outcome; the asset keeps serving its original unless the
 * final swap write succeeded, and that write is the only change a screen can
 * ever see. Temp files are removed on every path.
 *
 * WHY EMERGENCY MEDIA IS NEVER SWAPPED. A protected (lockdown / evacuate /
 * weather) playlist — or any playlist a tenant or screen names as its
 * emergency playlist — reaches screens through `item.asset.fileUrl`, and the
 * player PRECACHES that exact URL onto the never-evict tier so an alert plays
 * with the network down. Swapping it would leave every screen without its
 * alert media until the next manifest re-precached the new URL. A few hundred
 * MB of egress is never worth that window; those assets are skipped.
 */
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseStorageService } from '../supabase-storage.service';
import { VIDEO_WARN_SIZE_BYTES } from '../media-optimization.service';
import { sha256File } from '../storage-stream';
import {
  buildTranscodeArgs,
  planTranscode,
  progressPercent,
  tempBytesNeeded,
  transcodeTimeoutMs,
  verifyTranscodeOutput,
  type ProbeResult,
} from './transcode-profile';
import { SpawnFfmpegRunner, type FfmpegRunner } from './transcode-runner';
import {
  ORIGINAL_RETENTION_MS,
  type ClaimedTranscodeJob,
  type TranscodeOutcome,
} from './video-transcode.service';

/** Where optimized copies live: two segments under the tenant, so `complete-upload` can never name one. */
export const OPTIMIZED_PREFIX = 'optimized';

/** Injected for tests; production uses the real disk. */
export interface PipelineEnv {
  tmpRoot(): string;
  freeBytes(dir: string): Promise<number | null>;
  now(): number;
}

export const REAL_PIPELINE_ENV: PipelineEnv = {
  tmpRoot: () => os.tmpdir(),
  freeBytes: async (dir) => {
    try {
      const s = await fs.statfs(dir);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      return null; // unknown → the caller proceeds; -fs still bounds the output
    }
  },
  now: () => Date.now(),
};

/** The screen columns that name emergency media BY URL (mirrors assets.controller.ts). */
const SCREEN_EMERGENCY_ASSET_COLUMNS = [
  'emergency_lockdown_asset_url',
  'emergency_evacuate_asset_url',
  'emergency_weather_asset_url',
  'emergency_hold_asset_url',
  'emergency_secure_asset_url',
  'emergency_medical_asset_url',
  'emergency_lockdown_portrait_asset_url',
  'emergency_evacuate_portrait_asset_url',
  'emergency_weather_portrait_asset_url',
  'emergency_hold_portrait_asset_url',
  'emergency_secure_portrait_asset_url',
  'emergency_medical_portrait_asset_url',
] as const;

/** The screen columns that name an emergency PLAYLIST per incident type. */
const SCREEN_EMERGENCY_PLAYLIST_COLUMNS = [
  'emergency_lockdown_playlist_id',
  'emergency_evacuate_playlist_id',
  'emergency_weather_playlist_id',
  'emergency_hold_playlist_id',
  'emergency_secure_playlist_id',
  'emergency_medical_playlist_id',
  'emergency_lockdown_portrait_playlist_id',
  'emergency_evacuate_portrait_playlist_id',
  'emergency_weather_portrait_playlist_id',
  'emergency_hold_portrait_playlist_id',
  'emergency_secure_portrait_playlist_id',
  'emergency_medical_portrait_playlist_id',
] as const;

/**
 * One statement: is this asset emergency media by ANY route the manifest's
 * emergency branch uses? (a protected playlist, a tenant's / screen's emergency
 * playlist, or a screen's emergency media URL). Deliberately cross-tenant: a
 * district's screen can name a school's playlist, and a false "no" here is the
 * one mistake that matters.
 */
export const EMERGENCY_CONTENT_SQL = `
SELECT (
  EXISTS (
    SELECT 1
      FROM "playlist_items" pi
      JOIN "playlists" p ON p."id" = pi."playlist_id"
     WHERE pi."asset_id" = $1
       AND (
         p."is_protected" = TRUE
         OR p."id" IN (
           SELECT "emergency_playlist_id" FROM "tenants" WHERE "emergency_playlist_id" IS NOT NULL
           UNION SELECT "emergency_portrait_playlist_id" FROM "tenants" WHERE "emergency_portrait_playlist_id" IS NOT NULL
           ${SCREEN_EMERGENCY_PLAYLIST_COLUMNS.map((c) => `UNION SELECT "${c}" FROM "screens" WHERE "${c}" IS NOT NULL`).join('\n           ')}
         )
       )
  )
  OR EXISTS (
    SELECT 1 FROM "screens"
     WHERE ${SCREEN_EMERGENCY_ASSET_COLUMNS.map((c) => `"${c}" = $2`).join(' OR ')}
  )
) AS "emergency"
`;

const MB = 1024 * 1024;

@Injectable()
export class VideoTranscodePipeline {
  private readonly logger = new Logger(VideoTranscodePipeline.name);
  /** The process boundary (ffprobe/ffmpeg). Replaced in specs; production spawns the real binaries. */
  runner: FfmpegRunner = new SpawnFfmpegRunner();
  /** Disk + clock. Replaced in specs. */
  env: PipelineEnv = REAL_PIPELINE_ENV;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
  ) {}

  /** For the worker: can this replica transcode at all? */
  ffmpegAvailable(): Promise<boolean> {
    return this.runner.available();
  }

  /** Is this asset emergency media? true on ANY error (fail closed — never swap alert media on doubt). */
  async isEmergencyContent(assetId: string, fileUrl: string): Promise<boolean> {
    try {
      const rows = await this.prisma.client.$queryRawUnsafe<
        Array<{ emergency: boolean }>
      >(EMERGENCY_CONTENT_SQL, assetId, fileUrl);
      return !!rows?.[0]?.emergency;
    } catch (e) {
      this.logger.warn(
        `[transcode] emergency-content check failed for ${assetId} — treating as emergency: ${(e as Error)?.message ?? e}`,
      );
      return true;
    }
  }

  /** Run one job. Never throws. */
  async process(
    job: ClaimedTranscodeJob,
    ctx: { signal?: AbortSignal; onProgress?: (pct: number) => void } = {},
  ): Promise<TranscodeOutcome> {
    const t0 = this.env.now();
    let dir: string | null = null;
    try {
      // ── 1. Is there still something to do? ──────────────────────────────
      if (!job.assetId) return { status: 'skipped', reason: 'asset-deleted' };
      const asset = await this.prisma.client.asset.findFirst({
        where: { id: job.assetId, tenantId: job.tenantId },
        select: {
          id: true,
          fileUrl: true,
          mimeType: true,
          status: true,
          fileHash: true,
        },
      });
      if (!asset) return { status: 'skipped', reason: 'asset-deleted' };
      if (asset.fileUrl !== job.sourceUrl)
        return { status: 'skipped', reason: 'source-changed' };
      if (!(asset.mimeType || '').toLowerCase().startsWith('video/'))
        return { status: 'skipped', reason: 'not-video' };
      if (asset.status === 'ARCHIVED')
        return { status: 'skipped', reason: 'asset-archived' };
      if (await this.isEmergencyContent(asset.id, asset.fileUrl)) {
        return { status: 'skipped', reason: 'emergency-content' };
      }
      const sourcePath = this.storage.extractPath(job.sourceUrl);
      if (!sourcePath) return { status: 'skipped', reason: 'external-url' };

      // ── 2. Size + temp-disk budget. ─────────────────────────────────────
      let sourceBytes = job.sourceBytes ?? null;
      if (!sourceBytes) {
        const info = await this.storage
          .getObjectInfo(sourcePath)
          .catch(() => null);
        sourceBytes = info?.size ?? null;
      }
      if (!sourceBytes || sourceBytes <= 0)
        return this.failed('source-size-unknown', t0);
      const tmpRoot = this.env.tmpRoot();
      const free = await this.env.freeBytes(tmpRoot);
      const need = tempBytesNeeded(sourceBytes);
      if (free !== null && free < need) {
        return this.failed(
          'insufficient-temp-disk',
          t0,
          `needs ${Math.round(need / MB)} MB of temp disk, ${Math.round(free / MB)} MB free`,
          sourceBytes,
        );
      }

      // ── 3. Original → temp file (hashed as it lands). ───────────────────
      dir = await fs.mkdtemp(path.join(tmpRoot, 'edu-transcode-'));
      const ext =
        (path.extname(sourcePath) || '.mp4')
          .replace(/[^.A-Za-z0-9]/g, '')
          .slice(0, 9) || '.mp4';
      const inPath = path.join(dir, `in${ext}`);
      const outPath = path.join(dir, 'out.mp4');
      const dl = await this.storage.downloadObjectToFile(sourcePath, inPath, {
        // A little slack over the recorded size; anything bigger is not the file we queued.
        maxBytes: Math.floor(sourceBytes * 1.01) + MB,
        signal: ctx.signal,
      });
      const bytesIn = dl.bytes;

      // The original's own hash, for every outcome that does NOT swap: a direct
      // upload lands with fileHash NULL (the API never saw the bytes), and the
      // boot backfill would otherwise pull the whole file again to compute it.
      const keepOriginal = async (
        outcome: TranscodeOutcome,
      ): Promise<TranscodeOutcome> => {
        await this.backfillOriginalHash(job, dl.sha256);
        this.warnIfLargeOriginalKept(job, bytesIn, outcome.reason);
        return outcome;
      };

      // ── 4. Probe + plan. ────────────────────────────────────────────────
      let inProbe: ProbeResult;
      try {
        inProbe = await this.runner.probe(inPath);
      } catch (e) {
        return keepOriginal(
          this.failed('probe-failed', t0, (e as Error)?.message, bytesIn),
        );
      }
      const decision = planTranscode(inProbe);
      if (decision.action === 'skip') {
        return keepOriginal({
          status: 'skipped',
          reason: decision.reason,
          details: this.details({ inProbe, bytesIn, t0 }),
        });
      }
      const plan = decision.plan;

      // ── 5. Encode (bounded in time, threads, priority and output size). ──
      let lastPct = -1;
      const run = await this.runner.transcode(
        buildTranscodeArgs(inPath, outPath, plan, { sizeLimitBytes: bytesIn }),
        {
          timeoutMs: transcodeTimeoutMs(inProbe.durationS),
          signal: ctx.signal,
          onProgressSeconds: (s) => {
            const pct = progressPercent(s, inProbe.durationS);
            if (pct !== null && pct !== lastPct) {
              lastPct = pct;
              ctx.onProgress?.(pct);
            }
          },
        },
      );
      if (!run.ok) {
        const reason =
          run.reason === 'aborted'
            ? 'aborted'
            : run.reason.startsWith('timeout')
              ? 'timeout'
              : 'ffmpeg-failed';
        return keepOriginal(
          this.failed(
            reason,
            t0,
            run.reason,
            bytesIn,
            this.details({ inProbe, bytesIn, t0, plan }),
          ),
        );
      }

      // ── 6. Never worse: smaller AND the whole video. ────────────────────
      const bytesOut = (await fs.stat(outPath)).size;
      if (bytesOut >= bytesIn) {
        return keepOriginal({
          status: 'skipped',
          reason: 'not-smaller',
          outputBytes: bytesOut,
          details: this.details({ inProbe, bytesIn, bytesOut, t0, plan }),
        });
      }
      let outProbe: ProbeResult;
      try {
        outProbe = await this.runner.probe(outPath);
      } catch (e) {
        return keepOriginal(
          this.failed(
            'output-probe-failed',
            t0,
            (e as Error)?.message,
            bytesIn,
          ),
        );
      }
      const verdict = verifyTranscodeOutput(inProbe, outProbe, plan);
      if (!verdict.ok) {
        return keepOriginal(
          this.failed(
            'output-rejected',
            t0,
            verdict.reason,
            bytesIn,
            this.details({ inProbe, outProbe, bytesIn, bytesOut, t0, plan }),
          ),
        );
      }
      const sha256Out = await sha256File(outPath);

      // ── 7. Upload next to the original. ─────────────────────────────────
      const outputPath = `${job.tenantId}/${OPTIMIZED_PREFIX}/${randomUUID()}.mp4`;
      const outputUrl = await this.storage.uploadFileFromDisk(
        outputPath,
        outPath,
        'video/mp4',
        { signal: ctx.signal },
      );

      // ── 8. The swap — the only write a screen can ever see. ─────────────
      const details = this.details({
        inProbe,
        outProbe,
        bytesIn,
        bytesOut,
        t0,
        plan,
        sha256In: dl.sha256,
        sha256Out,
      });
      if (await this.isEmergencyContent(asset.id, job.sourceUrl)) {
        // Became alert media while we encoded: never swap it.
        await this.storage.delete(outputPath).catch(() => undefined);
        return keepOriginal({
          status: 'skipped',
          reason: 'emergency-content',
          details,
        });
      }
      const swapped = await this.prisma.client.asset.updateMany({
        where: {
          id: asset.id,
          tenantId: job.tenantId,
          // Only while it still serves exactly the file we encoded…
          fileUrl: job.sourceUrl,
          // …and is still not in a protected (emergency) playlist. Atomic with
          // the write; the fuller check above covers tenant/screen-named ones.
          playlistItems: { none: { playlist: { isProtected: true } } },
        },
        data: {
          fileUrl: outputUrl,
          mimeType: 'video/mp4',
          fileSize: bytesOut,
          // The hash of the bytes the NEW url serves — a stale hash here would
          // make the player's integrity check reject a perfectly good file.
          fileHash: sha256Out,
          processingMeta: {
            originalSize: bytesIn,
            processedSize: bytesOut,
            originalDimensions:
              inProbe.width && inProbe.height
                ? { w: inProbe.width, h: inProbe.height }
                : null,
            processedDimensions: { w: plan.width, h: plan.height },
            transcodedAt: new Date(this.env.now()).toISOString(),
            transcode: {
              profile: plan.rung.label,
              codecIn: inProbe.videoCodec,
              durationS: inProbe.durationS,
              seconds: details.seconds,
              savedBytes: bytesIn - bytesOut,
            },
          } as any,
        },
      });
      if (swapped.count === 0) {
        await this.storage.delete(outputPath).catch(() => undefined);
        const now = await this.prisma.client.asset
          .findFirst({
            where: { id: asset.id, tenantId: job.tenantId },
            select: { fileUrl: true },
          })
          .catch(() => null);
        const reason = !now
          ? 'asset-deleted'
          : now.fileUrl !== job.sourceUrl
            ? 'source-changed'
            : 'emergency-content';
        return reason === 'asset-deleted'
          ? { status: 'skipped', reason, details }
          : keepOriginal({ status: 'skipped', reason, details });
      }

      await this.prisma.client.auditLog
        .create({
          data: {
            tenantId: job.tenantId,
            userId: null,
            action: 'ASSET_VIDEO_OPTIMIZED',
            targetType: 'Asset',
            targetId: asset.id,
            details: JSON.stringify({
              bytesIn,
              bytesOut,
              savedBytes: bytesIn - bytesOut,
              profile: plan.rung.label,
              seconds: details.seconds,
              originalUrl: job.sourceUrl,
              outputUrl,
            }),
          },
        })
        .catch((e: unknown) =>
          this.logger.warn(
            `[transcode] audit row failed for ${asset.id}: ${(e as Error)?.message ?? e}`,
          ),
        );
      this.logger.log(
        `[transcode] asset ${asset.id} ${plan.rung.label}: ${Math.round(bytesIn / MB)} MB → ${Math.round(bytesOut / MB)} MB ` +
          `(${Math.round((1 - bytesOut / bytesIn) * 100)}% smaller) in ${details.seconds}s — swapped`,
      );
      return {
        status: 'done',
        reason: 'swapped',
        outputUrl,
        outputBytes: bytesOut,
        details,
        originalDeleteAfter: new Date(this.env.now() + ORIGINAL_RETENTION_MS),
      };
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      const aborted = ctx.signal?.aborted;
      this.logger.warn(
        `[transcode] job ${job.id} (asset ${job.assetId}) ${aborted ? 'aborted' : 'failed'}: ${msg}`,
      );
      return this.failed(
        aborted ? 'aborted' : 'error',
        t0,
        msg,
        job.sourceBytes,
      );
    } finally {
      if (dir)
        await fs
          .rm(dir, { recursive: true, force: true })
          .catch(() => undefined);
    }
  }

  private failed(
    reason: string,
    t0: number,
    error?: string,
    bytesIn?: number | null,
    details?: Record<string, unknown>,
  ): TranscodeOutcome {
    return {
      status: 'failed',
      reason,
      error: error ? String(error).slice(0, 1000) : null,
      details: details ?? {
        bytesIn: bytesIn ?? null,
        seconds: Math.round((this.env.now() - t0) / 100) / 10,
      },
    };
  }

  /** The one log line ops watches for large originals that could not be made smaller. */
  private warnIfLargeOriginalKept(
    job: ClaimedTranscodeJob,
    bytesIn: number,
    reason: string,
  ): void {
    if (bytesIn > VIDEO_WARN_SIZE_BYTES) {
      this.logger.warn(
        `[transcode] large video kept at its original size (${Math.round(bytesIn / MB)} MB, asset ${job.assetId}, ` +
          `reason ${reason}) — every screen downloads the original.`,
      );
    }
  }

  /** Record the ORIGINAL's hash when the asset still serves it and has none. */
  private async backfillOriginalHash(
    job: ClaimedTranscodeJob,
    sha256: string,
  ): Promise<void> {
    if (!job.assetId) return;
    try {
      await this.prisma.client.asset.updateMany({
        where: {
          id: job.assetId,
          tenantId: job.tenantId,
          fileUrl: job.sourceUrl,
          fileHash: null,
        },
        data: { fileHash: sha256 },
      });
    } catch {
      /* best-effort — the boot backfill still covers it */
    }
  }

  private details(x: {
    inProbe?: ProbeResult;
    outProbe?: ProbeResult;
    bytesIn: number;
    bytesOut?: number;
    t0: number;
    plan?: {
      rung: { label: string };
      width: number;
      height: number;
      fps: number | null;
    };
    sha256In?: string;
    sha256Out?: string;
  }): Record<string, unknown> & { seconds: number } {
    const seconds = Math.round((this.env.now() - x.t0) / 100) / 10;
    return {
      profile: x.plan?.rung.label ?? null,
      codecIn: x.inProbe?.videoCodec ?? null,
      dimsIn:
        x.inProbe?.width && x.inProbe?.height
          ? { w: x.inProbe.width, h: x.inProbe.height }
          : null,
      dimsOut: x.plan ? { w: x.plan.width, h: x.plan.height } : null,
      fpsIn: x.inProbe?.fps ?? null,
      fpsOut: x.plan?.fps ?? x.inProbe?.fps ?? null,
      durationS: x.inProbe?.durationS ?? null,
      durationOutS: x.outProbe?.durationS ?? null,
      bitrateIn: x.inProbe?.bitRate ?? null,
      bytesIn: x.bytesIn,
      bytesOut: x.bytesOut ?? null,
      savedBytes:
        typeof x.bytesOut === 'number' ? x.bytesIn - x.bytesOut : null,
      sha256In: x.sha256In ?? null,
      sha256Out: x.sha256Out ?? null,
      seconds,
    };
  }
}
