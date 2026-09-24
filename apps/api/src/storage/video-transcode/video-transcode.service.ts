/**
 * VideoTranscodeService — the `video_transcode_jobs` table (2026-09-23, 4K uploads).
 *
 * Two kinds of method, scoped differently ON PURPOSE (same split as
 * templates/designer-jobs/designer-jobs.service.ts):
 *
 *   ENQUEUE + OPERATOR reads (`enqueue`, `statusForAssets`) take the caller's
 *   tenant. `enqueue` is called by the upload handlers right after they create
 *   the Asset; `statusForAssets` answers the media library and carries
 *   `tenantId` in its WHERE — another tenant's job is simply not returned.
 *
 *   WORKER methods (`claimNext`, `heartbeat`, `saveProgress`, `finish`,
 *   `release`, `sweepStale`, `pendingWork`, `claimDueOriginal`,
 *   `settleOriginal`) have no caller tenant: the worker only touches a row it
 *   CLAIMED, and every write after the claim is conditional on
 *   `lease_owner = <this worker> AND status = 'running'`. A row re-queued by
 *   the stale sweep or claimed by another replica can never be overwritten by
 *   a slow worker.
 *
 * Not a manifest-fed model (screens/manifest-hot-cache.ts MANIFEST_FED_MODELS):
 * heartbeats and progress writes never invalidate the player manifest cache.
 * The one write that must — the asset swap — goes to `assets` through
 * `prisma.client`, so it does.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@cms/database';
import { PrismaService } from '../../prisma/prisma.service';

export type TranscodeStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'skipped'
  | 'failed';
export const ACTIVE_TRANSCODE_STATUSES: TranscodeStatus[] = [
  'queued',
  'running',
];

/** A running job whose heartbeat is older than this is presumed dead (its replica crashed). */
export const TRANSCODE_STALE_MS = 3 * 60_000;
/** Claims a job may use: the first run plus ONE re-queue after a stall. */
export const TRANSCODE_MAX_ATTEMPTS = 2;
/** A job no worker has claimed in this long is failed (every replica down, ffmpeg missing everywhere). */
export const TRANSCODE_QUEUED_EXPIRY_MS = 24 * 60 * 60_000;

const DAY_MS = 24 * 60 * 60_000;
/**
 * How long a swapped-out ORIGINAL is kept before it may be deleted: the
 * rollback window if an encode ever looks wrong on glass, plus time for
 * screens mid-download and CDN edges to move to the new URL.
 */
export const ORIGINAL_RETENTION_MS = 7 * DAY_MS;
/** A still-referenced original is re-checked this often. */
export const ORIGINAL_RECHECK_MS = 7 * DAY_MS;
/** A reference scan that could not finish is retried after this. */
export const ORIGINAL_UNKNOWN_RECHECK_MS = DAY_MS;
/** Lease on a due original while one replica scans + deletes it. */
export const ORIGINAL_SWEEP_LEASE_MS = 60 * 60_000;

/**
 * "Now" for raw SQL as a naive UTC timestamp — the columns are `timestamp(3)`
 * WITHOUT time zone written by Prisma in UTC, and a bare NOW() is converted
 * through the SESSION time zone (see DB_NOW_UTC in designer-jobs.service.ts).
 */
const DB_NOW_UTC = `(NOW() AT TIME ZONE 'UTC')`;

export interface ClaimedTranscodeJob {
  id: string;
  tenantId: string;
  assetId: string | null;
  sourceUrl: string;
  sourceBytes: number | null;
  attempts: number;
}

/** What the library shows for one asset's transcode. */
export interface TranscodeStatusView {
  assetId: string;
  status: TranscodeStatus;
  reason: string | null;
  progress: number | null;
  sourceBytes: number | null;
  outputBytes: number | null;
  finishedAt: string | null;
}

/** How a job ended. */
export interface TranscodeOutcome {
  status: Exclude<TranscodeStatus, 'queued' | 'running'>;
  reason: string;
  outputUrl?: string | null;
  outputBytes?: number | null;
  details?: Record<string, unknown> | null;
  error?: string | null;
  /** Set only when the asset was swapped: when the original becomes eligible for deletion. */
  originalDeleteAfter?: Date | null;
}

export interface DueOriginal {
  id: string;
  tenantId: string;
  assetId: string | null;
  sourceUrl: string;
}

const iso = (d: Date | string | null | undefined): string | null =>
  d == null
    ? null
    : d instanceof Date
      ? d.toISOString()
      : new Date(d).toISOString();

@Injectable()
export class VideoTranscodeService {
  private readonly logger = new Logger(VideoTranscodeService.name);
  private readonly queuedListeners = new Set<() => void>();

  constructor(private readonly prisma: PrismaService) {}

  /** Kill switch: `VIDEO_TRANSCODE_DISABLED=1` stops enqueueing AND claiming. Subtractive only. */
  static disabled(): boolean {
    return ['1', 'true', 'on', 'yes'].includes(
      String(process.env.VIDEO_TRANSCODE_DISABLED || '')
        .trim()
        .toLowerCase(),
    );
  }

  /** Called after a job is queued on THIS replica, so its worker claims it now. */
  onQueued(fn: () => void): () => void {
    this.queuedListeners.add(fn);
    return () => this.queuedListeners.delete(fn);
  }

  private emitQueued(): void {
    for (const fn of this.queuedListeners) {
      try {
        fn();
      } catch {
        /* a listener must never fail an upload */
      }
    }
  }

  // ── enqueue + operator reads ───────────────────────────────────────────────

  /**
   * Queue the signage transcode for a just-uploaded video. Idempotent per asset
   * (`ON CONFLICT DO NOTHING` on the unique asset_id). NEVER throws: an upload
   * must not fail because its optimization could not be queued — the original
   * simply keeps serving. Returns whether the asset now has a job waiting.
   */
  async enqueue(input: {
    tenantId: string;
    assetId: string;
    sourceUrl: string;
    sourceBytes: number | null;
  }): Promise<boolean> {
    if (VideoTranscodeService.disabled()) return false;
    if (!input.tenantId || !input.assetId || !input.sourceUrl) return false;
    try {
      const bytes = Number(input.sourceBytes);
      await this.prisma.client.videoTranscodeJob.createMany({
        data: [
          {
            tenantId: input.tenantId,
            assetId: input.assetId,
            sourceUrl: input.sourceUrl,
            sourceBytes:
              Number.isFinite(bytes) && bytes > 0 && bytes <= 2 ** 31 - 1
                ? Math.trunc(bytes)
                : null,
            status: 'queued',
          },
        ],
        skipDuplicates: true,
      });
      this.emitQueued();
      return true;
    } catch (e) {
      this.logger.warn(
        `[transcode] could not queue asset ${input.assetId}: ${(e as Error)?.message ?? e}`,
      );
      return false;
    }
  }

  /** This tenant's transcode state for the given assets (another tenant's rows are never returned). */
  async statusForAssets(
    tenantId: string,
    assetIds: string[],
  ): Promise<TranscodeStatusView[]> {
    const ids = [
      ...new Set(
        assetIds.filter(
          (x) => typeof x === 'string' && x.length > 0 && x.length <= 64,
        ),
      ),
    ].slice(0, 200);
    if (!tenantId || ids.length === 0) return [];
    const rows = await this.prisma.client.videoTranscodeJob.findMany({
      where: { tenantId, assetId: { in: ids } },
      select: {
        assetId: true,
        status: true,
        reason: true,
        progress: true,
        sourceBytes: true,
        outputBytes: true,
        finishedAt: true,
      },
    });
    return rows
      .filter((r) => !!r.assetId)
      .map((r) => ({
        assetId: r.assetId as string,
        status: r.status as TranscodeStatus,
        reason: r.reason ?? null,
        progress: r.progress ?? null,
        sourceBytes: r.sourceBytes ?? null,
        outputBytes: r.outputBytes ?? null,
        finishedAt: iso(r.finishedAt),
      }));
  }

  // ── worker methods (lease-scoped) ──────────────────────────────────────────

  /**
   * One cheap read deciding whether a tick has anything to do. Index-backed;
   * an idle replica pays this and nothing else.
   */
  async pendingWork(): Promise<{
    queued: boolean;
    stale: boolean;
    originalDue: boolean;
  }> {
    const rows = await this.prisma.client.$queryRawUnsafe<
      Array<{ queued: boolean; stale: boolean; original_due: boolean }>
    >(
      `
      SELECT
        EXISTS (SELECT 1 FROM "video_transcode_jobs" WHERE "status" = 'queued') AS "queued",
        EXISTS (
          SELECT 1 FROM "video_transcode_jobs"
           WHERE "status" = 'running'
             AND "heartbeat_at" < ${DB_NOW_UTC} - ($1 * INTERVAL '1 millisecond')
        ) AS "stale",
        EXISTS (
          SELECT 1 FROM "video_transcode_jobs"
           WHERE "original_delete_after" <= ${DB_NOW_UTC}
             AND "original_deleted_at" IS NULL
             AND "status" = 'done'
        ) AS "original_due"
      `,
      TRANSCODE_STALE_MS,
    );
    const r = rows?.[0];
    return {
      queued: !!r?.queued,
      stale: !!r?.stale,
      originalDue: !!r?.original_due,
    };
  }

  /**
   * Claim ONE queued job, oldest first. `FOR UPDATE SKIP LOCKED`: two replicas
   * polling at the same instant claim two different rows, never the same one.
   */
  async claimNext(owner: string): Promise<ClaimedTranscodeJob | null> {
    const rows = await this.prisma.client.$queryRawUnsafe<
      Array<{
        id: string;
        tenantId: string;
        assetId: string | null;
        sourceUrl: string;
        sourceBytes: number | null;
        attempts: number;
      }>
    >(
      `
      UPDATE "video_transcode_jobs" AS j
         SET "status" = 'running',
             "lease_owner" = $1,
             "heartbeat_at" = ${DB_NOW_UTC},
             "started_at" = ${DB_NOW_UTC},
             "progress" = NULL,
             "attempts" = j."attempts" + 1
       WHERE j."id" = (
         SELECT "id" FROM "video_transcode_jobs"
          WHERE "status" = 'queued'
          ORDER BY "created_at" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
      RETURNING j."id", j."tenant_id" AS "tenantId", j."asset_id" AS "assetId",
                j."source_url" AS "sourceUrl", j."source_bytes" AS "sourceBytes", j."attempts"
      `,
      owner,
    );
    const r = rows?.[0];
    if (!r) return null;
    return {
      id: r.id,
      tenantId: r.tenantId,
      assetId: r.assetId ?? null,
      sourceUrl: r.sourceUrl,
      sourceBytes: r.sourceBytes == null ? null : Number(r.sourceBytes),
      attempts: Number(r.attempts) || 0,
    };
  }

  /** Refresh the lease on the jobs this worker is running. Returns the ids it still holds. */
  async heartbeat(owner: string, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ');
    const rows = await this.prisma.client.$queryRawUnsafe<
      Array<{ id: string }>
    >(
      `
      UPDATE "video_transcode_jobs"
         SET "heartbeat_at" = ${DB_NOW_UTC}
       WHERE "lease_owner" = $1 AND "status" = 'running' AND "id" IN (${placeholders})
      RETURNING "id"
      `,
      owner,
      ...ids,
    );
    return (rows || []).map((r) => r.id);
  }

  /** Persist progress (0–99). false = the job is no longer ours. */
  async saveProgress(
    jobId: string,
    owner: string,
    progress: number,
  ): Promise<boolean> {
    const out = await this.prisma.client.videoTranscodeJob.updateMany({
      where: { id: jobId, leaseOwner: owner, status: 'running' },
      data: { progress: Math.max(0, Math.min(99, Math.trunc(progress))) },
    });
    return out.count > 0;
  }

  /** Record how the job ended. false = it was re-queued/claimed elsewhere meanwhile (discarded). */
  async finish(
    jobId: string,
    owner: string,
    outcome: TranscodeOutcome,
  ): Promise<boolean> {
    const out = await this.prisma.client.videoTranscodeJob.updateMany({
      where: { id: jobId, leaseOwner: owner, status: 'running' },
      data: {
        status: outcome.status,
        reason: outcome.reason.slice(0, 200),
        progress: outcome.status === 'done' ? 100 : null,
        outputUrl: outcome.outputUrl ?? null,
        outputBytes: outcome.outputBytes ?? null,
        details: (outcome.details ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        error: outcome.error ? outcome.error.slice(0, 1000) : null,
        finishedAt: new Date(),
        leaseOwner: null,
        originalDeleteAfter: outcome.originalDeleteAfter ?? null,
      },
    });
    return out.count > 0;
  }

  /**
   * Graceful shutdown (a deploy): hand this worker's running jobs back so the
   * next container starts them at once instead of after the stale window. A
   * hand-back is not the job's fault, so it gives the attempt back.
   */
  async release(owner: string): Promise<number> {
    const n = await this.prisma.client.$executeRawUnsafe(
      `
      UPDATE "video_transcode_jobs"
         SET "status" = 'queued',
             "lease_owner" = NULL,
             "heartbeat_at" = NULL,
             "progress" = NULL,
             "attempts" = GREATEST("attempts" - 1, 0)
       WHERE "lease_owner" = $1 AND "status" = 'running'
      `,
      owner,
    );
    return typeof n === 'number' ? n : 0;
  }

  /**
   * Recover jobs whose worker died: a running job with no heartbeat for
   * TRANSCODE_STALE_MS is re-queued ONCE, then failed (`stalled`); a job still
   * queued after TRANSCODE_QUEUED_EXPIRY_MS is failed (`expired`). Every
   * statement is a guarded state transition, safe on any number of replicas.
   * A failed job never touches the asset: the original keeps serving.
   */
  async sweepStale(): Promise<{
    requeued: number;
    failed: number;
    expired: number;
  }> {
    const failed = await this.prisma.client.$executeRawUnsafe(
      `
      UPDATE "video_transcode_jobs"
         SET "status" = 'failed',
             "reason" = 'stalled',
             "error" = 'The optimization stopped unexpectedly twice; the original keeps playing.',
             "lease_owner" = NULL,
             "progress" = NULL,
             "finished_at" = ${DB_NOW_UTC}
       WHERE "status" = 'running'
         AND "heartbeat_at" < ${DB_NOW_UTC} - ($1 * INTERVAL '1 millisecond')
         AND "attempts" >= $2
      `,
      TRANSCODE_STALE_MS,
      TRANSCODE_MAX_ATTEMPTS,
    );
    const requeued = await this.prisma.client.$executeRawUnsafe(
      `
      UPDATE "video_transcode_jobs"
         SET "status" = 'queued',
             "lease_owner" = NULL,
             "heartbeat_at" = NULL,
             "progress" = NULL
       WHERE "status" = 'running'
         AND "heartbeat_at" < ${DB_NOW_UTC} - ($1 * INTERVAL '1 millisecond')
         AND "attempts" < $2
      `,
      TRANSCODE_STALE_MS,
      TRANSCODE_MAX_ATTEMPTS,
    );
    const expired = await this.prisma.client.$executeRawUnsafe(
      `
      UPDATE "video_transcode_jobs"
         SET "status" = 'failed',
             "reason" = 'expired',
             "error" = 'No worker picked this optimization up in time; the original keeps playing.',
             "finished_at" = ${DB_NOW_UTC}
       WHERE "status" = 'queued'
         AND "created_at" < ${DB_NOW_UTC} - ($1 * INTERVAL '1 millisecond')
      `,
      TRANSCODE_QUEUED_EXPIRY_MS,
    );
    const n = (v: unknown) => (typeof v === 'number' ? v : 0);
    const out = {
      requeued: n(requeued),
      failed: n(failed),
      expired: n(expired),
    };
    if (out.requeued || out.failed || out.expired) {
      this.logger.warn(
        `[transcode] stale sweep: re-queued ${out.requeued}, failed ${out.failed} (stalled), expired ${out.expired}`,
      );
    }
    return out;
  }

  /**
   * Claim ONE swapped job whose original is due for its retention check. The
   * claim is a LEASE: it pushes `original_delete_after` an hour out, so a
   * replica that dies mid-scan simply leaves it due again later, and two
   * replicas never scan the same original at once (`SKIP LOCKED`).
   */
  async claimDueOriginal(): Promise<DueOriginal | null> {
    const rows = await this.prisma.client.$queryRawUnsafe<
      Array<{
        id: string;
        tenantId: string;
        assetId: string | null;
        sourceUrl: string;
      }>
    >(
      `
      UPDATE "video_transcode_jobs" AS j
         SET "original_delete_after" = ${DB_NOW_UTC} + ($1 * INTERVAL '1 millisecond')
       WHERE j."id" = (
         SELECT "id" FROM "video_transcode_jobs"
          WHERE "status" = 'done'
            AND "original_deleted_at" IS NULL
            AND "original_delete_after" <= ${DB_NOW_UTC}
          ORDER BY "original_delete_after" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
      RETURNING j."id", j."tenant_id" AS "tenantId", j."asset_id" AS "assetId", j."source_url" AS "sourceUrl"
      `,
      ORIGINAL_SWEEP_LEASE_MS,
    );
    const r = rows?.[0];
    return r
      ? {
          id: r.id,
          tenantId: r.tenantId,
          assetId: r.assetId ?? null,
          sourceUrl: r.sourceUrl,
        }
      : null;
  }

  /** The original was deleted. */
  async markOriginalDeleted(jobId: string): Promise<void> {
    await this.prisma.client.videoTranscodeJob.updateMany({
      where: { id: jobId, status: 'done', originalDeletedAt: null },
      data: { originalDeletedAt: new Date(), originalRetainedReason: null },
    });
  }

  /** The original must stay for now: record why and when to look again. */
  async deferOriginal(
    jobId: string,
    afterMs: number,
    reason: string,
  ): Promise<void> {
    await this.prisma.client.videoTranscodeJob.updateMany({
      where: { id: jobId, status: 'done', originalDeletedAt: null },
      data: {
        originalDeleteAfter: new Date(Date.now() + afterMs),
        originalRetainedReason: reason.slice(0, 300),
      },
    });
  }
}
