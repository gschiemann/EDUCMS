/**
 * VideoTranscodePipeline — ONE claimed job, start to finish (2026-09-23).
 *
 *   asset still serving the source? not emergency media? enough temp disk?
 *     → stream the original from storage to a temp file (hashed as it lands)
 *     → ffprobe → plan: skip when the file already IS the signage profile
 *       (screen-safe AND within the bitrate ceiling), else transcode, either
 *       REQUIRED (screenCompatibilityIssues named something) or size-only
 *     → ffmpeg (2 threads, nice 19, SIGKILL budget from the duration, -fs bound)
 *     → size-only: swap only when SMALLER; required: swap at ANY size, but never
 *       an output that reached its -fs bound (a truncated encode exits 0)
 *     → original KEPT (screen-safe, bigger than 1920×1080): make the 1080p copy
 *       from it and report `done / rendition-created` (keepOriginalWithCopy)
 *     → ffprobe the output → verify it is the WHOLE video
 *     → stream it to `<tenant>/optimized/<uuid>.mp4`
 *     → ONE conditional write swaps the asset's fileUrl — only while the asset
 *       still serves exactly the source and is still not in a protected playlist
 *     → re-run the probe + poster (VideoPosterService) on the NEW file, so the
 *       facts on the row describe what screens now download (see step 9)
 *
 * COMPATIBILITY BEFORE SIZE (2026-10-04). Owner's rule: "support as many files
 * as possible but they must work 100% of the time." A source that is not
 * screen-safe (HEVC, VP9, AV1, 10-bit, HDR, interlaced, anamorphic, rotated,
 * > 30 fps, …) is converted whatever the output's size — H.264 is usually
 * LARGER than the codec it replaces. Every exit that LEARNS whether the file
 * this asset serves is playable stamps `processingMeta.screen`:
 *   { version: 1, ready: true,  convertedFrom?: issues[], checkedAt }
 *   { version: 1, ready: false, issues[], error, checkedAt }   (conversion failed / unreadable)
 * so the manifest and the dashboard can say so; see markScreenReadiness. A job
 * that dies BEFORE the probe (size unknown, no temp disk, the download) learns
 * nothing and stamps nothing; emergency media is never stamped at all.
 *
 * THE UPLOAD'S `pending` (2026-10-05). complete-upload already stamps a video
 * that must be converted `{ ready: false, pending: true, issues }` — the
 * manifest leaves it out while it converts. Every verdict above REPLACES that
 * stamp whole; an exit that writes none (the early deaths just listed, an
 * archived asset, an unexpected error) has its still-pending stamp settled as
 * not ready by `settlePendingVerdict` once the job has an outcome, so
 * "converting" never outlives a finished job. A run handed back to the queue
 * (`aborted`) is not finished and stamps nothing; alert media keeps whatever
 * the upload wrote, since the emergency branch never reads the verdict.
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
import type { Prisma } from '@cms/database';
import {
  buildScreenStamp,
  readScreenStamp,
  type ScreenVerdictInput,
} from '@cms/api-types';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseStorageService } from '../supabase-storage.service';
import { VideoPosterService } from '../video-poster.service';
import { VIDEO_WARN_SIZE_BYTES } from '../media-optimization.service';
import { sha256File } from '../storage-stream';
import {
  buildTranscodeArgs,
  plan1080Rendition,
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

interface CompatibilityRendition {
  url: string;
  sha256: string;
  size: number;
  width: number;
  height: number;
  path: string;
}

/** What became of the decoder-sized (1080p) copy a job tried to make. */
type RenditionAttempt =
  | { status: 'created'; rendition: CompatibilityRendition }
  /** The picture already fits 1920×1080 in either orientation: nothing to make. */
  | { status: 'not-needed' }
  /** The copy could not be made or verified; the primary file is untouched. */
  | { status: 'failed'; reason: string };

/** The part of an attempt the job's `details` records (nothing when no copy was needed). */
function renditionDetails(
  attempt: RenditionAttempt,
): Record<string, unknown> | undefined {
  if (attempt.status === 'not-needed') return undefined;
  return attempt.status === 'created'
    ? {
        attempted: true,
        created: true,
        width: attempt.rendition.width,
        height: attempt.rendition.height,
        size: attempt.rendition.size,
      }
    : { attempted: true, created: false, reason: attempt.reason };
}

/**
 * The verdict `processingMeta.screen` records about the file an asset serves.
 * The pipeline never writes `pending` itself — that is the UPLOAD's stamp (a
 * conversion is queued); every verdict written here is a FINISHED one, and it
 * replaces the whole stamp (see `buildScreenStamp`).
 */
type ScreenVerdict = Omit<ScreenVerdictInput, 'pending'>;

/** What `settlePendingVerdict` did, for the worker's log and the specs. */
export type PendingSettle =
  | 'settled'
  /** No row, or the row moved between the read and the write. */
  | 'gone'
  /** The stamp is already a finished verdict (or there is none). */
  | 'not-pending'
  /** Another job for this asset is queued or running: it will stamp the verdict. */
  | 'job-active'
  /** Alert media is never stamped. */
  | 'emergency'
  /** The read or write failed (logged); the stamp is unchanged. */
  | 'failed';

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};

/** Require the MP4 index before media data, not merely an ffmpeg success code. */
async function hasFastStart(file: string): Promise<boolean> {
  const handle = await fs.open(file, 'r');
  try {
    const end = (await handle.stat()).size;
    let pos = 0;
    let sawFtyp = false;
    for (let boxes = 0; boxes < 64 && pos + 8 <= end; boxes++) {
      const header = Buffer.alloc(16);
      const { bytesRead } = await handle.read(header, 0, 16, pos);
      if (bytesRead < 8) return false;
      const type = header.toString('ascii', 4, 8);
      let size = header.readUInt32BE(0);
      if (size === 1) {
        if (bytesRead < 16) return false;
        const wide = header.readBigUInt64BE(8);
        if (wide > BigInt(Number.MAX_SAFE_INTEGER)) return false;
        size = Number(wide);
      }
      if (size < 8 || pos + size > end) return false;
      if (type === 'ftyp') sawFtyp = true;
      if (type === 'moov') return sawFtyp;
      if (type === 'mdat') return false;
      pos += size;
    }
    return false;
  } finally {
    await handle.close();
  }
}

/**
 * The `processingMeta` keys that describe ONE PARTICULAR FILE — the probe facts
 * (`video-probe.ts`) the "Playback on screens" grade reads, plus the duration.
 * A swap changes which file the row serves, so these are dropped in the same
 * write that changes `fileUrl`: a grade that still says "10-bit HEVC" about a
 * row now serving an 8-bit H.264 copy would send the operator re-exporting a
 * file that is already fine, and a stale "4K" against a 1080p copy would fail
 * the resolution rule for nothing. The worker re-probes the new file right
 * after the swap (`refreshServedFileFacts`); until that lands the row honestly
 * has no facts, and a failed re-probe may stamp it (`hasCurrentProbe` is false
 * once these are gone) instead of contradicting facts that are already there.
 */
export const SERVED_FILE_FACT_KEYS = [
  'probe',
  'probedAt',
  'probeFailed',
  'probeFailedVersion',
  'durationMs',
] as const;

/**
 * What the swap writes into `processingMeta`: everything the row already held
 * (an image-optimizer key, a future field) MINUS the per-file facts above, then
 * the transcode's own keys on top. Pure; the spec pins the drop as a negative
 * control. Anything that is not a JSON object is treated as empty.
 */
export function mergeTranscodeMeta(
  existing: unknown,
  transcode: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  for (const key of SERVED_FILE_FACT_KEYS) delete base[key];
  return { ...base, ...transcode };
}

/**
 * Terminal outcomes after which the row still serves the file it served
 * before this job — so the fast-start re-mux VideoPosterService deferred
 * while the job was queued may still apply. The others swapped (`done`),
 * lost the asset, found it changed / archived / external / emergency, or
 * were aborted mid-run (the row is claimed again later). A job that ended
 * `done / rendition-created` kept the original too (it only added the 1080p
 * copy), so it is in the first group — see `remuxAfterTranscode`.
 */
export const NO_REMUX_AFTER_TRANSCODE: ReadonlySet<string> = new Set([
  'swapped',
  'asset-deleted',
  'source-changed',
  'not-video',
  'asset-archived',
  'emergency-content',
  'external-url',
  'aborted',
]);

/** Should the worker run the deferred fast-start pass after this outcome? */
export function remuxAfterTranscode(
  outcome: Pick<TranscodeOutcome, 'status' | 'reason'>,
): boolean {
  // `done` normally means "swapped" (the row serves a NEW file); the one `done`
  // that left the original serving is the 1080p copy made next to it.
  if (outcome.status === 'done') return outcome.reason === 'rendition-created';
  return !NO_REMUX_AFTER_TRANSCODE.has(outcome.reason);
}

/** What `refreshServedFileFacts` records on the job's `details`. */
export interface ServedFileFacts {
  /** The new file's ffprobe facts landed on the row (probe version 2). */
  probed: boolean;
  /** A poster was cut from the new file and hung on `posterUrl`. */
  poster: boolean;
  /** Present when the pass itself threw (it never should — VideoPosterService is never-throws by contract). */
  error?: string;
}

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
    // 2026-09-24 — the same probe + poster pass an upload gets, re-run on the
    // optimized copy after a swap (step 9), so the grade and the poster describe
    // the file screens actually download. Never throws by its own contract.
    private readonly videoPoster: VideoPosterService,
  ) {}

  /** For the worker: can this replica transcode at all? */
  ffmpegAvailable(): Promise<boolean> {
    return this.runner.available();
  }

  /**
   * The job is terminal and KEPT the original (not smaller, already optimal,
   * a failed encode — `remuxAfterTranscode`). While it was queued,
   * VideoPosterService deferred the lossless fast-start re-mux for this
   * asset: a re-mux that moved the row first would have made this job
   * `source-changed`. With the transcode out of the way, run that pass on the
   * file the row still serves — probe, then re-mux if its index sits at the
   * end — with no poster (the upload already cut one). Called by the worker
   * AFTER `finish()`, so the job's row reads terminal to the gate. Never
   * throws; nothing here can undo the job's own outcome.
   */
  async remuxKeptOriginal(job: ClaimedTranscodeJob): Promise<void> {
    if (!job.assetId) return;
    try {
      const asset = await this.prisma.client.asset.findFirst({
        where: { id: job.assetId, tenantId: job.tenantId },
        select: { fileUrl: true, mimeType: true, originalName: true },
      });
      if (!asset || asset.fileUrl !== job.sourceUrl) return;
      const mimeType = String(asset.mimeType || '').toLowerCase();
      if (!mimeType.startsWith('video/')) return;
      const storagePath = this.storage.extractPath(asset.fileUrl);
      if (!storagePath) return;
      const r = await this.videoPoster.processVideo(
        {
          assetId: job.assetId,
          tenantId: job.tenantId,
          mimeType,
          storagePath,
          ext: path.extname(asset.originalName || '') || null,
        },
        { remux: 'async', poster: false },
      );
      this.logger.log(
        `[transcode] asset ${job.assetId}: kept the original — fast-start pass ${r.remux}`,
      );
    } catch (e) {
      this.logger.warn(
        `[transcode] asset ${job.assetId}: fast-start pass after the kept original threw: ${(e as Error)?.message ?? e}`,
      );
    }
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

  /**
   * Run one job. Never throws.
   *
   * 2026-10-05 — `pending` NEVER SURVIVES A FINISHED JOB. The upload stamps a
   * video that must be converted `{ ready: false, pending: true }` (the
   * manifest leaves it out, the library says "converting"). Most exits below
   * replace that with a finished verdict themselves; the rest — a job that
   * ended before it could probe (no size, no temp disk, a failed download), an
   * archived asset, an unexpected error — would have left "converting" on the
   * row forever. So once the job has an outcome, `settlePendingVerdict` turns a
   * stamp that is STILL pending into the finished one. A run handed back to
   * the queue (`aborted`: a deploy, a lost lease) is not finished — its stamp
   * stays "converting" for the run that picks it up.
   */
  async process(
    job: ClaimedTranscodeJob,
    ctx: { signal?: AbortSignal; onProgress?: (pct: number) => void } = {},
  ): Promise<TranscodeOutcome> {
    const learned: { issues: string[] | null } = { issues: null };
    const outcome = await this.runJob(job, ctx, learned);
    if (outcome.reason !== 'aborted' && outcome.status !== 'done') {
      // `done` (a swap, or a 1080p copy beside a screen-safe original) wrote
      // `ready: true` in its own write; nothing can be pending after it.
      await this.settlePendingVerdict(job, outcome, learned.issues);
    }
    return outcome;
  }

  private async runJob(
    job: ClaimedTranscodeJob,
    ctx: { signal?: AbortSignal; onProgress?: (pct: number) => void },
    /** What this run's own probe found (the plan's issues) — for the settle step. */
    learned: { issues: string[] | null },
  ): Promise<TranscodeOutcome> {
    const t0 = this.env.now();
    let dir: string | null = null;
    // Set once the plan says this file MUST be converted: what the catch-all
    // stamps if something unexpected (a storage blip on the upload, a DB error)
    // ends the job after that point.
    let requiredIssues: string[] | null = null;
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
          // Read for the swap's MERGE (step 8): Prisma's Json column has no
          // partial update, and every key the transcode does not own survives.
          processingMeta: true,
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
      const workDir: string = dir;
      const inPath = path.join(workDir, `in${ext}`);
      const outPath = path.join(workDir, 'out.mp4');
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
        // ffprobe cannot read it: no player will either.
        await this.markScreenReadiness(job, { ready: false, issues: ['unreadable'], error: 'probe-failed' });
        return await keepOriginal(
          this.failed('probe-failed', t0, (e as Error)?.message, bytesIn),
        );
      }
      // EVERY `return` of an async helper in this try block is `return await`: a
      // plain `return promise` runs the `finally` (which deletes the temp dir) BEFORE
      // the promise settles, and the keep-original helpers below still read from it.
      const decision = planTranscode(inProbe);
      if (decision.action === 'transcode') learned.issues = decision.issues;
      else if (decision.reason === 'already-optimal') learned.issues = [];
      // The ORIGINAL stays as the served file on every exit below that calls
      // this (a screen-safe source that needed nothing, could not be shrunk, or
      // whose size-only encode failed). If it is bigger than 1920×1080 in either
      // orientation a 1080p screen still needs its decoder-sized copy, and a
      // FINISHED job with no copy leaves publication to 1080p screens waiting
      // forever — so the copy is made from the original before the job reports
      // (see keepOriginalWithCopy).
      const keepWithCopy = (
        outcome: TranscodeOutcome,
        verdict: 'ready' | null,
      ): Promise<TranscodeOutcome> =>
        this.keepOriginalWithCopy({
          job,
          assetId: asset.id,
          inPath,
          outPath,
          inProbe,
          bytesIn,
          sha256In: dl.sha256,
          dir: workDir,
          ctx,
          outcome,
          verdict,
          keepOriginal,
          t0,
        });
      if (decision.action === 'skip') {
        if (decision.reason === 'already-optimal') {
          // `already-optimal` IS the statement that every player decodes it.
          return await keepWithCopy(
            {
              status: 'skipped',
              reason: 'already-optimal',
              details: this.details({ inProbe, bytesIn, t0 }),
            },
            'ready',
          );
        }
        // A file with no video stream or no dimensions is not a playable video.
        await this.markScreenReadiness(job, {
          ready: false,
          issues: ['unreadable'],
          error: decision.reason,
        });
        return await keepOriginal({
          status: 'skipped',
          reason: decision.reason,
          details: this.details({ inProbe, bytesIn, t0 }),
        });
      }
      const plan = decision.plan;
      // COMPATIBILITY BEFORE SIZE (2026-10-04). `required` = the source is not
      // something every signage player decodes (see screenCompatibilityIssues):
      // its output replaces it whatever the size, and a failure must be SAID —
      // the original is kept in storage but stamped not-screen-ready, so no
      // manifest ever hands it to a screen (`markScreenReadiness`).
      const required = decision.required;
      const issues = decision.issues;
      if (required) requiredIssues = issues;
      const notReady = async (outcome: TranscodeOutcome): Promise<TranscodeOutcome> => {
        if (required) {
          // A run handed back to the queue (`aborted`: a deploy, a lost lease)
          // has not failed — the run that picks it up stamps the verdict. A
          // "could not be converted" here would sit on the row for the whole
          // retry, and a lost lease can race the stale sweep's own settle.
          if (outcome.reason !== 'aborted') {
            await this.markScreenReadiness(job, { ready: false, issues, error: outcome.reason });
          }
          return await keepOriginal(outcome);
        }
        // Size-only: the source is screen-safe and stays as it is — the failure
        // says nothing about it (no verdict) — but a 1080p screen still needs its copy.
        return await keepWithCopy(outcome, null);
      };

      // ── 5. Encode (bounded in time, threads, priority and output size). ──
      // A size-only transcode stops at the source's size (a bigger output could
      // never be swapped in). A REQUIRED one may legitimately come out bigger —
      // H.264 needs more bits than HEVC / AV1 / VP9 — so its bound is disk, not
      // the source: four times the source, at least 512 MB, never past 2 GB…
      let sizeLimitBytes = bytesIn;
      if (required) {
        sizeLimitBytes = Math.min(2_000_000_000, Math.max(bytesIn * 4, 512 * MB));
        // …and never past the room that is actually left. The preflight
        // (tempBytesNeeded) budgeted the source plus an output no bigger than
        // the source; this bound is up to four times that, so re-read the free
        // space now that the source has landed, keep 128 MB for the 1080p copy,
        // and never go below the size-only bound the preflight did account for.
        const room = await this.env.freeBytes(dir);
        if (room !== null)
          sizeLimitBytes = Math.max(bytesIn, Math.min(sizeLimitBytes, room - 128 * MB));
      }
      let lastPct = -1;
      const run = await this.runner.transcode(
        buildTranscodeArgs(inPath, outPath, plan, { sizeLimitBytes }),
        {
          // A conversion a screen depends on gets the longer allowance: a phone's
          // 4K60 HDR clip is three times the work of the H.264 this budget was sized on.
          timeoutMs: transcodeTimeoutMs(inProbe.durationS, { required }),
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
        return await notReady(
          this.failed(
            reason,
            t0,
            run.reason,
            bytesIn,
            this.details({ inProbe, bytesIn, t0, plan }),
          ),
        );
      }

      // ── 6. Never worse: the whole video — and, when the source was already
      //      screen-safe, smaller too. A required conversion is kept at any size.
      const bytesOut = (await fs.stat(outPath)).size;
      if (!required && bytesOut >= bytesIn) {
        // Screen-safe already (no compatibility issue), just not shrinkable. The
        // original stays — and a 1080p screen still needs its copy of it.
        return await keepWithCopy(
          {
            status: 'skipped',
            reason: 'not-smaller',
            outputBytes: bytesOut,
            details: this.details({ inProbe, bytesIn, bytesOut, t0, plan }),
          },
          'ready',
        );
      }
      if (required && bytesOut >= sizeLimitBytes) {
        // ffmpeg stops writing at `-fs` and EXITS 0 with a short file. A size-only
        // job never gets here with one (an output that big is "not smaller"), but
        // a required job's bound is bigger than the source: the duration check
        // alone cannot catch a source with no known duration, nor a tail cut
        // inside its 2 % tolerance. An output that reached the bound is cut off.
        return await notReady(
          this.failed(
            'output-truncated',
            t0,
            `the output reached its ${sizeLimitBytes}-byte limit — the encode was cut short`,
            bytesIn,
            this.details({ inProbe, bytesIn, bytesOut, t0, plan }),
          ),
        );
      }
      let outProbe: ProbeResult;
      try {
        outProbe = await this.runner.probe(outPath);
      } catch (e) {
        return await notReady(
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
        return await notReady(
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
      const attempt = await this.create1080Rendition(
        job, outPath, outProbe, bytesOut, workDir, ctx,
      );
      const rendition = attempt.status === 'created' ? attempt.rendition : null;

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
      const copy = renditionDetails(attempt);
      if (copy) details.rendition = copy;
      if (await this.isEmergencyContent(asset.id, job.sourceUrl)) {
        // Became alert media while we encoded: never swap it.
        await this.storage.delete(outputPath).catch(() => undefined);
        if (rendition) await this.storage.delete(rendition.path).catch(() => undefined);
        return await keepOriginal({
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
          // MERGED over what the row holds, minus the facts that described the
          // ORIGINAL file (SERVED_FILE_FACT_KEYS) — step 9 re-probes the copy
          // and writes the served file's dimensions / duration / probe facts
          // through the same `mergeProbeMeta` path an upload uses. Until then
          // `processedDimensions` (the copy's size) is what the library reads.
          processingMeta: mergeTranscodeMeta(asset.processingMeta, {
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
            ...(rendition ? { renditions: { '1080p': this.publicRendition(rendition) } } : {}),
            // The served file is now the profile: every player decodes it.
            screen: this.screenStamp({ ready: true, convertedFrom: issues }),
          }) as Prisma.InputJsonObject,
        },
      });
      if (swapped.count === 0) {
        await this.storage.delete(outputPath).catch(() => undefined);
        if (rendition) await this.storage.delete(rendition.path).catch(() => undefined);
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
          : await keepOriginal({ status: 'skipped', reason, details });
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
          (bytesOut < bytesIn
            ? `(${Math.round((1 - bytesOut / bytesIn) * 100)}% smaller)`
            : `(${Math.round((bytesOut / bytesIn - 1) * 100)}% larger — converted for screens: ${issues.join(', ')})`) +
          ` in ${details.seconds}s — swapped`,
      );
      if (rendition) await this.auditRendition(job, rendition);

      // ── 9. The facts on the row must describe the file screens now download. ──
      // Runs AFTER the swap (the row's fileUrl is the copy) and BEFORE the job
      // is marked done (the library refetches the list once on `done`, and by
      // then the new grade + poster are on the row). Cheap: ffprobe reads the
      // copy's headers over http and the poster grab seeks one keyframe — the
      // copy is `+faststart`, so both are a few hundred KB of egress.
      const servedFile = await this.refreshServedFileFacts(
        asset.id,
        job.tenantId,
        outputPath,
      );
      details.servedFile = servedFile;
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
      // A REQUIRED conversion that died unexpectedly leaves a file that is not
      // screen-safe serving as uploaded: say so, like every other failed
      // conversion. The stamp is written only while the row still serves the
      // source, so a failure AFTER the swap committed writes nothing. An ABORT
      // is not a failure — the job goes back to the queue — so it stamps nothing.
      if (requiredIssues && !aborted) {
        await this.markScreenReadiness(job, {
          ready: false,
          issues: requiredIssues,
          error: 'error',
        });
      }
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

  private publicRendition(r: CompatibilityRendition) {
    return { url: r.url, sha256: r.sha256, size: r.size, width: r.width, height: r.height };
  }

  /** A failed side copy never replaces or invalidates the primary asset. */
  private async create1080Rendition(
    job: ClaimedTranscodeJob,
    inputPath: string,
    source: ProbeResult,
    inputBytes: number,
    dir: string,
    ctx: { signal?: AbortSignal },
  ): Promise<RenditionAttempt> {
    const plan = plan1080Rendition(source);
    if (!plan) return { status: 'not-needed' };
    const free = await this.env.freeBytes(dir);
    if (free !== null && free < inputBytes + 128 * MB) {
      this.logger.warn(`[transcode] asset ${job.assetId}: no temp disk for 1080p rendition`);
      return { status: 'failed', reason: 'no-temp-disk' };
    }
    const output = path.join(dir, 'rendition-1080.mp4');
    let uploadedPath: string | null = null;
    try {
      const run = await this.runner.transcode(
        buildTranscodeArgs(inputPath, output, plan, {
          sizeLimitBytes: Math.min(2_000_000_000, Math.max(Math.ceil(inputBytes * 1.25), 256 * MB)),
          level: '4.1',
        }),
        { timeoutMs: transcodeTimeoutMs(source.durationS), signal: ctx.signal },
      );
      if (!run.ok) throw new Error(`ffmpeg: ${run.reason}`);
      const size = (await fs.stat(output)).size;
      // Decoder compatibility matters even if a low-bitrate 4K source needs
      // more bytes to produce a clean 1080p H.264 file.
      if (size <= 0) throw new Error('empty-rendition');
      const probe = await this.runner.probe(output);
      const verdict = verifyTranscodeOutput(source, probe, plan);
      if (!verdict.ok) throw new Error(verdict.reason);
      if (probe.fps === null || probe.fps > 30.01 ||
          !(probe.formatName ?? '').includes('mp4') ||
          (source.hasAudio && probe.audioCodec !== 'aac')) {
        throw new Error('rendition-decoder-profile-rejected');
      }
      if (!(await hasFastStart(output))) throw new Error('rendition-not-faststart');
      if (ctx.signal?.aborted) throw new Error('aborted');
      if (!job.assetId || await this.isEmergencyContent(job.assetId, job.sourceUrl)) {
        throw new Error('became-emergency-content');
      }
      const sha256 = await sha256File(output);
      uploadedPath = `${job.tenantId}/${OPTIMIZED_PREFIX}/renditions/${randomUUID()}.mp4`;
      const url = await this.storage.uploadFileFromDisk(
        uploadedPath, output, 'video/mp4', { signal: ctx.signal },
      );
      return {
        status: 'created',
        rendition: { url, sha256, size, width: plan.width, height: plan.height, path: uploadedPath },
      };
    } catch (e) {
      if (uploadedPath) await this.storage.delete(uploadedPath).catch(() => undefined);
      const reason = String((e as Error)?.message ?? e).slice(0, 200);
      this.logger.warn(
        `[transcode] asset ${job.assetId}: 1080p rendition unavailable: ${reason}`,
      );
      return { status: 'failed', reason };
    }
  }

  /**
   * The job ends with the ORIGINAL kept as the served file and that original is
   * screen-safe. If it is bigger than 1920×1080 (either orientation) a 1080p
   * screen needs a decoder-sized copy of it, so make one FROM THE ORIGINAL and
   * record it beside it on the same row (the swap path does the same from its
   * output); report `done / rendition-created` when it worked.
   *
   * Why this exists: publication waits for a copy of every >1080p video a 1080p
   * screen will play, and treats a FINISHED job with no copy as "no copy is
   * coming" — it fails the whole schedule. A low-bitrate 4K file whose size-only
   * encode came out no smaller used to end `skipped / not-smaller` here, copy-less,
   * and blocked every 1080p screen's playlist forever.
   *
   * When the copy cannot be made the original keeps serving, the outcome SAYS so
   * (`error` and `details.rendition`) and `processingMeta.renditions` stays
   * absent, so publication can name the file. Never for an aborted run (the worker
   * hands the job back), emergency media (re-checked before the write) or a row
   * that moved on (the write is conditional on the source URL).
   *
   * `verdict: 'ready'` = this path already knows the source is screen-safe, so the
   * row says so whatever becomes of the copy. `null` = this path says nothing about
   * the original (a failed size-only encode); a copy that IS made still ends with
   * the `ready` stamp — the plan only sends screen-safe sources down these paths.
   */
  private async keepOriginalWithCopy(x: {
    job: ClaimedTranscodeJob;
    assetId: string;
    inPath: string;
    /** The size-only encode's leftover: removed first, it holds the room the copy needs. */
    outPath: string;
    inProbe: ProbeResult;
    bytesIn: number;
    sha256In: string;
    dir: string;
    ctx: { signal?: AbortSignal };
    /** What the job would report without a copy. */
    outcome: TranscodeOutcome;
    verdict: 'ready' | null;
    keepOriginal: (outcome: TranscodeOutcome) => Promise<TranscodeOutcome>;
    t0: number;
  }): Promise<TranscodeOutcome> {
    const { job, ctx, outcome } = x;
    const stampReady = async () => {
      if (x.verdict === 'ready') await this.markScreenReadiness(job, { ready: true });
    };
    // The worker hands an aborted run back to the queue: no copy, no verdict.
    if (outcome.reason === 'aborted') return x.keepOriginal(outcome);

    await fs.rm(x.outPath, { force: true }).catch(() => undefined);
    const attempt = await this.create1080Rendition(job, x.inPath, x.inProbe, x.bytesIn, x.dir, ctx);
    if (ctx.signal?.aborted) {
      // Handed back to the queue: nothing is recorded, so nothing may be left behind.
      if (attempt.status === 'created')
        await this.storage.delete(attempt.rendition.path).catch(() => undefined);
      return this.failed('aborted', x.t0, 'aborted while making the 1080p copy', x.bytesIn);
    }
    if (attempt.status === 'failed' && attempt.reason === 'became-emergency-content') {
      // Never touch, never stamp, alert media.
      return x.keepOriginal({ status: 'skipped', reason: 'emergency-content' });
    }
    if (attempt.status === 'not-needed') {
      await stampReady();
      return x.keepOriginal(outcome);
    }
    if (attempt.status === 'failed') {
      await stampReady();
      return x.keepOriginal({
        ...outcome,
        error: outcome.error ?? `the 1080p playback copy could not be made: ${attempt.reason}`,
        details: { ...(outcome.details ?? {}), rendition: renditionDetails(attempt) },
      });
    }

    const rendition = attempt.rendition;
    if (await this.isEmergencyContent(x.assetId, job.sourceUrl)) {
      await this.storage.delete(rendition.path).catch(() => undefined);
      return x.keepOriginal({ status: 'skipped', reason: 'emergency-content' });
    }
    let recorded = false;
    try {
      // Only a screen-safe source is ever sent down these paths (a required
      // conversion that failed is never given a copy), so the verdict is "ready".
      recorded = await this.recordRendition(job, x.assetId, rendition, { ready: true });
    } catch (e) {
      await this.storage.delete(rendition.path).catch(() => undefined);
      throw e;
    }
    if (!recorded) {
      await this.storage.delete(rendition.path).catch(() => undefined);
      return x.keepOriginal({ status: 'skipped', reason: 'source-changed' });
    }
    await this.auditRendition(job, rendition);
    await this.backfillOriginalHash(job, x.sha256In);
    // The original is still what a 4K screen downloads: ops still wants to know.
    this.warnIfLargeOriginalKept(job, x.bytesIn, outcome.reason);
    return {
      status: 'done',
      reason: 'rendition-created',
      outputUrl: rendition.url,
      outputBytes: rendition.size,
      details: {
        ...(outcome.details ?? {}),
        seconds: Math.round((this.env.now() - x.t0) / 100) / 10,
        rendition: renditionDetails(attempt),
        originalKept: outcome.reason,
        ...(outcome.error ? { originalError: outcome.error } : {}),
      },
    };
  }

  /**
   * Hang the 1080p copy — and the screen-ready verdict — on the row beside the
   * ORIGINAL it was made from, in ONE write: merged into what the row holds NOW (a
   * fresh read — the probe facts the upload-time pass wrote while this job ran must
   * survive), conditional on the row still serving the source and not being in a
   * protected (emergency) playlist. False = the row moved on; the caller removes
   * the copy.
   */
  private async recordRendition(
    job: ClaimedTranscodeJob,
    assetId: string,
    rendition: CompatibilityRendition,
    verdict: ScreenVerdict,
  ): Promise<boolean> {
    const row = await this.prisma.client.asset.findFirst({
      where: { id: assetId, tenantId: job.tenantId, fileUrl: job.sourceUrl },
      select: { processingMeta: true },
    });
    if (!row) return false;
    const base = asRecord(row.processingMeta);
    const saved = await this.prisma.client.asset.updateMany({
      where: {
        id: assetId,
        tenantId: job.tenantId,
        fileUrl: job.sourceUrl,
        playlistItems: { none: { playlist: { isProtected: true } } },
      },
      data: {
        processingMeta: {
          ...base,
          renditions: {
            ...asRecord(base.renditions),
            '1080p': this.publicRendition(rendition),
          },
          // The verdict lands WITH the copy: a row never holds a copy of a file
          // nobody has said is playable.
          screen: this.screenStamp(verdict),
        } as Prisma.InputJsonObject,
      },
    });
    return saved.count > 0;
  }

  private async auditRendition(
    job: ClaimedTranscodeJob,
    rendition: CompatibilityRendition,
  ): Promise<void> {
    if (!job.assetId) return;
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: job.tenantId,
        userId: null,
        action: 'ASSET_VIDEO_RENDITION_CREATED',
        targetType: 'Asset',
        targetId: job.assetId,
        details: JSON.stringify({
          sourceUrl: job.sourceUrl,
          renditionUrl: rendition.url,
          size: rendition.size,
          sha256: rendition.sha256,
          width: rendition.width,
          height: rendition.height,
        }),
      },
    }).catch((e: unknown) => this.logger.warn(
      `[transcode] rendition audit failed for ${job.assetId}: ${(e as Error)?.message ?? e}`,
    ));
  }

  /**
   * Re-run the upload-time pass on the OPTIMIZED copy: probe version 2 →
   * `processingMeta` (display dims, duration, codec facts — merged, so the
   * transcode keys written a moment ago survive) and a poster cut from the
   * copy → `posterUrl`. The swap already stands whatever happens here: a pass
   * that cannot read the copy leaves the row with no facts (and, via the
   * poster service's own stamp, a reason), which the hourly auto-heal and the
   * operator's "Check this file" both know how to retry — it never un-swaps
   * and never fails the job. Never throws.
   */
  private async refreshServedFileFacts(
    assetId: string,
    tenantId: string,
    outputPath: string,
  ): Promise<ServedFileFacts> {
    try {
      const r = await this.videoPoster.processVideo({
        assetId,
        tenantId,
        mimeType: 'video/mp4',
        storagePath: outputPath,
        ext: '.mp4',
      });
      const out: ServedFileFacts = { probed: r.probed, poster: !!r.posterUrl };
      if (!r.probed || !r.posterUrl) {
        this.logger.warn(
          `[transcode] asset ${assetId}: served-file refresh incomplete (probed=${r.probed}, poster=${!!r.posterUrl}) — the swap stands; the auto-heal / "Check this file" can retry the facts`,
        );
      }
      return out;
    } catch (e) {
      const error = (e as Error)?.message ?? String(e);
      this.logger.warn(
        `[transcode] asset ${assetId}: served-file refresh threw (the swap stands): ${error}`,
      );
      return { probed: false, poster: false, error: error.slice(0, 300) };
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

  /**
   * The `screen` object itself — the one shape every writer (stamp, swap, copy,
   * settle, and the upload) uses: `buildScreenStamp` from `@cms/api-types`, so
   * the manifest's reader and the dashboard's can never drift from it. A
   * finished verdict carries no `pending`, and replacing the whole key is what
   * guarantees an earlier stage's `pending` / `error` never survive.
   */
  private screenStamp(verdict: ScreenVerdict): Record<string, unknown> {
    return { ...buildScreenStamp(verdict, this.env.now()) };
  }

  /**
   * Turn a stamp that is STILL `pending` into a finished verdict — the rule
   * `process` applies after every outcome that is not a hand-back, and the
   * worker applies to the jobs the stale sweep ends (`stalled`, `expired`),
   * which never reach `process`'s exit at all.
   *
   * The finished verdict is the best knowledge there is: this run's own probe
   * when it got that far (`learnedIssues` — empty means the file proved
   * screen-safe after all → `ready: true`), else the upload's issues; the error
   * is the job's outcome. Read fresh and tenant-scoped; written only while the
   * row still serves the file that was read (`fileUrl` in the WHERE), through
   * `prisma.client` so the manifest cache notices. Left alone:
   *   • alert media — never stamped, the same rule as every other exit; the
   *     emergency branch of the manifest never reads this verdict anyway;
   *   • a row with another job queued or running for it — that job stamps;
   *   • a stamp that is not pending (a finished verdict, or none at all).
   * Never throws.
   */
  async settlePendingVerdict(
    job: Pick<ClaimedTranscodeJob, 'id' | 'tenantId' | 'assetId'>,
    outcome: Pick<TranscodeOutcome, 'reason'>,
    learnedIssues: string[] | null = null,
  ): Promise<PendingSettle> {
    if (!job.assetId) return 'gone';
    if (outcome.reason === 'emergency-content') return 'emergency';
    try {
      const row = await this.prisma.client.asset.findFirst({
        where: { id: job.assetId, tenantId: job.tenantId },
        select: { fileUrl: true, processingMeta: true },
      });
      if (!row) return 'gone';
      const stamp = readScreenStamp(row.processingMeta);
      if (!stamp?.pending) return 'not-pending';
      const other = await this.prisma.client.videoTranscodeJob.findFirst({
        where: {
          assetId: job.assetId,
          tenantId: job.tenantId,
          status: { in: ['queued', 'running'] },
          NOT: { id: job.id },
        },
        select: { id: true },
      });
      if (other) return 'job-active';
      if (await this.isEmergencyContent(job.assetId, row.fileUrl)) return 'emergency';
      const verdict: ScreenVerdict =
        learnedIssues && learnedIssues.length === 0
          ? { ready: true }
          : {
              ready: false,
              issues: learnedIssues ?? stamp.issues,
              error: outcome.reason,
            };
      const saved = await this.prisma.client.asset.updateMany({
        where: { id: job.assetId, tenantId: job.tenantId, fileUrl: row.fileUrl },
        data: {
          processingMeta: {
            ...asRecord(row.processingMeta),
            screen: this.screenStamp(verdict),
          } as Prisma.InputJsonObject,
        },
      });
      if (saved.count === 0) return 'gone';
      this.logger.log(
        `[transcode] asset ${job.assetId}: the "converting for screens" verdict settled as ${verdict.ready ? 'ready' : `not ready (${outcome.reason})`}`,
      );
      return 'settled';
    } catch (e) {
      this.logger.warn(
        `[transcode] asset ${job.assetId}: could not settle its pending screen verdict: ${(e as Error)?.message ?? e}`,
      );
      return 'failed';
    }
  }

  /**
   * Stamp whether the file this asset SERVES is something every signage
   * player decodes (2026-10-04) — `processingMeta.screen`:
   *
   *   { ready: true }                          already screen-safe, or converted
   *   { ready: false, issues, error }          needs conversion and it FAILED
   *
   * Either one REPLACES whatever the row held, including the upload's
   * `{ ready: false, pending: true }` (2026-10-05). The manifest never hands a
   * screen a video stamped `ready: false`, and the dashboard says why. Written
   * only while the row still serves the file this job looked at; a fresh read
   * is merged so the probe's own keys survive. Best-effort: a failed stamp
   * must never fail the job (the settle step after it retries a pending one).
   */
  private async markScreenReadiness(
    job: ClaimedTranscodeJob,
    verdict: ScreenVerdict,
    servedUrl: string = job.sourceUrl,
  ): Promise<void> {
    if (!job.assetId) return;
    try {
      const row = await this.prisma.client.asset.findFirst({
        where: { id: job.assetId, tenantId: job.tenantId, fileUrl: servedUrl },
        select: { processingMeta: true },
      });
      if (!row) return;
      const base =
        row.processingMeta && typeof row.processingMeta === 'object' && !Array.isArray(row.processingMeta)
          ? (row.processingMeta as Record<string, unknown>)
          : {};
      await this.prisma.client.asset.updateMany({
        where: { id: job.assetId, tenantId: job.tenantId, fileUrl: servedUrl },
        data: {
          processingMeta: {
            ...base,
            screen: this.screenStamp(verdict),
          } as Prisma.InputJsonObject,
        },
      });
    } catch (e) {
      this.logger.warn(
        `[transcode] screen-readiness stamp failed for ${job.assetId}: ${(e as Error)?.message ?? e}`,
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
