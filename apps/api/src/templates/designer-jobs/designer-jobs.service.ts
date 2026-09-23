/**
 * DesignerJobsService — the `ai_designer_jobs` table (2026-09-23, Codex finding 5 + the async gap).
 *
 * `POST /templates/generate-designer/candidates` is one synchronous request that already runs
 * 1–2 min and grows to 3–4 min with the render → review → revise pipeline. iOS Safari drops a
 * backgrounded fetch, every deploy kills in-flight work, and `apiFetch` re-sends a POST after a
 * network error (an app switch mid-generation started a SECOND paid batch). A generation is now a
 * row: the dashboard creates it (idempotently), `DesignerJobsWorker` claims and runs it, the page
 * polls it, and Regenerate replays the stored request server-side.
 *
 * Two kinds of method live here, and they are scoped differently ON PURPOSE:
 *
 *   OPERATOR methods (`create`, `get`, `requestFor`, `cancel`) are called from the templates
 *   controller with the session's tenant. Every one of them carries `tenantId` in its WHERE — a job
 *   of another tenant is simply not found (404), never readable, never cancellable.
 *
 *   WORKER methods (`claimNext`, `heartbeat`, `saveProgress`, `complete`, `fail`, `markCancelled`,
 *   `release`, `sweepStale`, `pendingWork`) have no caller tenant: the worker only ever touches a row
 *   it CLAIMED under its own lease, and every write after the claim is conditional on
 *   `lease_owner = <this worker> AND status = 'running'`. A row that was cancelled, re-queued by the
 *   stale sweep, or claimed by another replica can therefore never be overwritten by a slow worker.
 *
 * Not a manifest-fed model (manifest-hot-cache.ts MANIFEST_FED_MODELS), so heartbeat and progress
 * writes never invalidate the player manifest cache.
 */
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@cms/database';
import { PrismaService } from '../../prisma/prisma.service';
import type { DesignerProgress } from '../../ai/designer-generation-hooks';
import type { DesignerJobRequest, DesignerJobResult } from './designer-job-request';
import {
  DESIGNER_JOB_EXPIRED_CODE,
  DESIGNER_JOB_STALLED_CODE,
  type DesignerJobError,
} from './designer-job-error';

export type DesignerJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export const ACTIVE_DESIGNER_JOB_STATUSES: DesignerJobStatus[] = ['queued', 'running'];
export const TERMINAL_DESIGNER_JOB_STATUSES: DesignerJobStatus[] = ['done', 'failed', 'cancelled'];

/** Active (queued + running) jobs one tenant may hold at once. */
export const DESIGNER_JOBS_ACTIVE_CAP = 2;
/**
 * Only jobs created inside this window count toward the cap, and a job still QUEUED after it is
 * expired by the sweep. A board takes minutes, never half an hour; without the window, a job no
 * worker ever claimed (every replica down, a broken deploy) would hold its tenant at the cap —
 * a permanent 429 — forever.
 */
export const DESIGNER_JOB_ACTIVE_WINDOW_MS = 30 * 60_000;
/** A running job whose heartbeat is older than this is presumed dead (its replica crashed). */
export const DESIGNER_JOB_STALE_MS = 3 * 60_000;
/** Claims a job may use: the first run plus ONE re-queue after a stall. */
export const DESIGNER_JOB_MAX_ATTEMPTS = 2;
/** Finished jobs older than this are deleted on the tenant's next create (a result is ~120 KB). */
export const DESIGNER_JOB_RETENTION_MS = 7 * 24 * 60 * 60_000;

export const DESIGNER_JOBS_BUSY_CODE = 'AI_DESIGN_JOBS_BUSY';

/** What `progress` holds: DesignerProgress, bounded, plus when it was written. */
export interface StoredDesignerProgress {
  stage: string;
  candidate?: number;
  of?: number;
  message?: string;
  updatedAt: string;
}

/** What `GET …/jobs/:id` returns. `result` only when done, `error` only when failed. */
export interface DesignerJobView {
  id: string;
  status: DesignerJobStatus;
  progress: StoredDesignerProgress | null;
  result?: DesignerJobResult;
  error?: DesignerJobError;
  createdAt: string;
  finishedAt: string | null;
}

export interface ClaimedDesignerJob {
  id: string;
  tenantId: string;
  userId: string | null;
  request: DesignerJobRequest;
  attempts: number;
}

const VIEW_SELECT = {
  id: true,
  status: true,
  progress: true,
  result: true,
  error: true,
  createdAt: true,
  finishedAt: true,
} as const;

interface ViewRow {
  id: string;
  status: string;
  progress: unknown;
  result?: unknown;
  error?: unknown;
  createdAt: Date | string;
  finishedAt: Date | string | null;
}

const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString();

export function toDesignerJobView(row: ViewRow): DesignerJobView {
  const status = row.status as DesignerJobStatus;
  return {
    id: row.id,
    status,
    progress: (row.progress as StoredDesignerProgress | null) ?? null,
    ...(status === 'done' && row.result ? { result: row.result as DesignerJobResult } : {}),
    ...(status === 'failed' && row.error ? { error: row.error as DesignerJobError } : {}),
    createdAt: iso(row.createdAt) as string,
    finishedAt: iso(row.finishedAt),
  };
}

/** Keep only the DesignerProgress fields, bounded — the pipeline's object is never stored raw. */
export function storedProgress(p: DesignerProgress, now: Date = new Date()): StoredDesignerProgress {
  const out: StoredDesignerProgress = { stage: String(p?.stage ?? '').slice(0, 32), updatedAt: now.toISOString() };
  if (typeof p?.candidate === 'number' && Number.isFinite(p.candidate)) out.candidate = Math.trunc(p.candidate);
  if (typeof p?.of === 'number' && Number.isFinite(p.of)) out.of = Math.trunc(p.of);
  if (typeof p?.message === 'string' && p.message.trim()) out.message = p.message.trim().slice(0, 200);
  return out;
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code;
  return code === 'P2002' || code === '23505';
}

@Injectable()
export class DesignerJobsService {
  private readonly logger = new Logger(DesignerJobsService.name);
  private readonly queuedListeners = new Set<() => void>();
  private readonly cancelledListeners = new Set<(jobId: string) => void>();

  constructor(private readonly prisma: PrismaService) {}

  // ── in-process signals (the worker subscribes; nothing here is load-bearing across replicas) ──

  /** Called after a job is queued on THIS replica, so its worker claims it now, not on its next tick. */
  onQueued(fn: () => void): () => void {
    this.queuedListeners.add(fn);
    return () => this.queuedListeners.delete(fn);
  }

  /** Called after a job is cancelled on THIS replica, so a local run aborts at once. */
  onCancelled(fn: (jobId: string) => void): () => void {
    this.cancelledListeners.add(fn);
    return () => this.cancelledListeners.delete(fn);
  }

  private emitQueued(): void {
    for (const fn of this.queuedListeners) {
      try {
        fn();
      } catch {
        /* a listener must never fail a create */
      }
    }
  }

  private emitCancelled(jobId: string): void {
    for (const fn of this.cancelledListeners) {
      try {
        fn(jobId);
      } catch {
        /* a listener must never fail a cancel */
      }
    }
  }

  // ── operator methods (tenant-scoped) ─────────────────────────────────────────────────────────

  /**
   * Queue a job. Same `idempotencyKey` for the same tenant → the job it already created (a
   * retried POST never starts a second paid batch). A tenant holding DESIGNER_JOBS_ACTIVE_CAP
   * active jobs gets a 429. Creates are serialised per tenant with a transaction-scoped advisory
   * lock, so two concurrent POSTs cannot both pass the cap check (`pg_advisory_xact_lock` via
   * `$executeRaw` inside the interactive transaction: released at COMMIT/ROLLBACK on the same
   * connection; a `$queryRaw` of a void function throws after the lock is taken).
   */
  async create(input: {
    tenantId: string;
    userId: string | null;
    request: DesignerJobRequest;
    idempotencyKey?: string | null;
  }): Promise<{ job: DesignerJobView; created: boolean }> {
    const { tenantId } = input;
    const key = input.idempotencyKey || null;
    if (key) {
      const existing = await this.prisma.client.aiDesignerJob.findFirst({
        where: { tenantId, idempotencyKey: key },
        select: VIEW_SELECT,
      });
      if (existing) return { job: toDesignerJobView(existing), created: false };
    }

    let outcome: { row: ViewRow; created: boolean };
    try {
      outcome = await this.prisma.client.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai_designer_jobs:${tenantId}`}, 0))`;
          if (key) {
            const raced = await tx.aiDesignerJob.findFirst({ where: { tenantId, idempotencyKey: key }, select: VIEW_SELECT });
            if (raced) return { row: raced as ViewRow, created: false };
          }
          const active = await tx.aiDesignerJob.count({
            where: {
              tenantId,
              status: { in: ACTIVE_DESIGNER_JOB_STATUSES },
              createdAt: { gte: new Date(Date.now() - DESIGNER_JOB_ACTIVE_WINDOW_MS) },
            },
          });
          if (active >= DESIGNER_JOBS_ACTIVE_CAP) {
            throw new HttpException(
              {
                code: DESIGNER_JOBS_BUSY_CODE,
                message: 'Two boards are already being designed for this account. Wait for one to finish, or cancel it.',
              },
              HttpStatus.TOO_MANY_REQUESTS,
            );
          }
          const row = await tx.aiDesignerJob.create({
            data: {
              tenantId,
              userId: input.userId,
              status: 'queued',
              request: input.request as unknown as Prisma.InputJsonValue,
              idempotencyKey: key,
            },
            select: VIEW_SELECT,
          });
          return { row: row as ViewRow, created: true };
        },
        { maxWait: 5_000, timeout: 10_000 },
      );
    } catch (e) {
      // Belt and braces: the lock makes this unreachable for one tenant, but a unique violation on
      // the key still means "that request already exists", never an error.
      if (key && isUniqueViolation(e)) {
        const existing = await this.prisma.client.aiDesignerJob.findFirst({
          where: { tenantId, idempotencyKey: key },
          select: VIEW_SELECT,
        });
        if (existing) return { job: toDesignerJobView(existing), created: false };
      }
      throw e;
    }

    if (outcome.created) {
      // Retention without a cron: this tenant's finished jobs older than the window go now.
      // Best-effort — a failed prune must never fail the operator's generation.
      void this.prune(tenantId);
      this.emitQueued();
    }
    return { job: toDesignerJobView(outcome.row), created: outcome.created };
  }

  /** This tenant's finished jobs older than DESIGNER_JOB_RETENTION_MS. */
  async prune(tenantId: string, now: Date = new Date()): Promise<number> {
    try {
      const out = await this.prisma.client.aiDesignerJob.deleteMany({
        where: {
          tenantId,
          status: { in: TERMINAL_DESIGNER_JOB_STATUSES },
          createdAt: { lt: new Date(now.getTime() - DESIGNER_JOB_RETENTION_MS) },
        },
      });
      return out?.count ?? 0;
    } catch (e) {
      this.logger.warn(`designer-jobs: retention prune failed for ${tenantId}: ${(e as Error)?.message ?? e}`);
      return 0;
    }
  }

  /** One of this tenant's jobs, or null (another tenant's id is indistinguishable from a missing one). */
  async get(tenantId: string, jobId: string): Promise<DesignerJobView | null> {
    const row = await this.prisma.client.aiDesignerJob.findFirst({
      where: { id: jobId, tenantId },
      select: VIEW_SELECT,
    });
    return row ? toDesignerJobView(row) : null;
  }

  /** The stored request of one of this tenant's jobs (the server-side Regenerate replays it). */
  async requestFor(tenantId: string, jobId: string): Promise<unknown | null> {
    const row = await this.prisma.client.aiDesignerJob.findFirst({
      where: { id: jobId, tenantId },
      select: { request: true },
    });
    return row ? row.request : null;
  }

  /**
   * Cancel one of this tenant's jobs. Only a queued or running job moves; a finished one is
   * returned exactly as it is. A running job's worker learns about it from the in-process signal
   * (same replica) or from its next heartbeat (another replica), and its own writes are
   * conditional on `status = 'running'`, so a result that lands after the cancel is discarded.
   */
  async cancel(tenantId: string, jobId: string): Promise<DesignerJobView | null> {
    const moved = await this.prisma.client.aiDesignerJob.updateMany({
      where: { id: jobId, tenantId, status: { in: ACTIVE_DESIGNER_JOB_STATUSES } },
      data: { status: 'cancelled', finishedAt: new Date() },
    });
    if (moved.count > 0) this.emitCancelled(jobId);
    return this.get(tenantId, jobId);
  }

  // ── worker methods (lease-scoped; see the header) ────────────────────────────────────────────

  /**
   * One cheap read deciding whether a tick has anything to do: a queued job to claim, or a stale
   * one to sweep. Index-backed ((status, created_at)); an idle replica pays this and nothing else.
   */
  async pendingWork(): Promise<{ queued: boolean; stale: boolean }> {
    const rows = await this.prisma.client.$queryRawUnsafe<Array<{ queued: boolean; stale: boolean }>>(
      `
      SELECT
        EXISTS (SELECT 1 FROM "ai_designer_jobs" WHERE "status" = 'queued') AS "queued",
        EXISTS (
          SELECT 1 FROM "ai_designer_jobs"
           WHERE "status" = 'running'
             AND "heartbeat_at" < NOW() - ($1 * INTERVAL '1 millisecond')
        ) AS "stale"
      `,
      DESIGNER_JOB_STALE_MS,
    );
    const r = rows?.[0];
    return { queued: !!r?.queued, stale: !!r?.stale };
  }

  /**
   * Claim ONE queued job, oldest first. `FOR UPDATE SKIP LOCKED` means two replicas polling at the
   * same instant claim two different rows (or one claims and the other gets nothing) — never the
   * same row. The claim stamps the lease (`lease_owner`, `heartbeat_at`) and counts the attempt.
   */
  async claimNext(owner: string): Promise<ClaimedDesignerJob | null> {
    const rows = await this.prisma.client.$queryRawUnsafe<
      Array<{ id: string; tenantId: string; userId: string | null; request: DesignerJobRequest; attempts: number }>
    >(
      `
      UPDATE "ai_designer_jobs" AS j
         SET "status" = 'running',
             "lease_owner" = $1,
             "heartbeat_at" = NOW(),
             "started_at" = NOW(),
             "attempts" = j."attempts" + 1
       WHERE j."id" = (
         SELECT "id" FROM "ai_designer_jobs"
          WHERE "status" = 'queued'
          ORDER BY "created_at" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
      RETURNING j."id", j."tenant_id" AS "tenantId", j."user_id" AS "userId", j."request", j."attempts"
      `,
      owner,
    );
    const r = rows?.[0];
    if (!r) return null;
    return { id: r.id, tenantId: r.tenantId, userId: r.userId ?? null, request: r.request, attempts: Number(r.attempts) || 0 };
  }

  /**
   * Refresh the lease on the jobs this worker is RUNNING right now (`ids` — its live set, not every
   * row that still names it: a run that ended without recording its outcome must stop beating so
   * the stale sweep can recover it). Returns the ids it still holds; a local run whose id is
   * missing was cancelled or re-queued elsewhere, and the worker aborts it. Ids are bound as
   * positional parameters, never interpolated.
   */
  async heartbeat(owner: string, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ');
    const rows = await this.prisma.client.$queryRawUnsafe<Array<{ id: string }>>(
      `
      UPDATE "ai_designer_jobs"
         SET "heartbeat_at" = NOW()
       WHERE "lease_owner" = $1 AND "status" = 'running' AND "id" IN (${placeholders})
      RETURNING "id"
      `,
      owner,
      ...ids,
    );
    return (rows || []).map((r) => r.id);
  }

  /** Persist progress. false = the job is no longer ours to write (cancelled / re-queued). */
  async saveProgress(jobId: string, owner: string, progress: StoredDesignerProgress): Promise<boolean> {
    const out = await this.prisma.client.aiDesignerJob.updateMany({
      where: { id: jobId, leaseOwner: owner, status: 'running' },
      data: { progress: progress as unknown as Prisma.InputJsonValue },
    });
    return out.count > 0;
  }

  /** The job finished: store the result. false = it was cancelled / re-queued meanwhile (discarded). */
  async complete(jobId: string, owner: string, result: DesignerJobResult, of?: number): Promise<boolean> {
    const done: StoredDesignerProgress = { stage: 'done', ...(typeof of === 'number' ? { of } : {}), updatedAt: new Date().toISOString() };
    const out = await this.prisma.client.aiDesignerJob.updateMany({
      where: { id: jobId, leaseOwner: owner, status: 'running' },
      data: {
        status: 'done',
        result: result as unknown as Prisma.InputJsonValue,
        progress: done as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
    return out.count > 0;
  }

  /** The job failed with `error` (the envelope the sync endpoint would have answered). */
  async fail(jobId: string, owner: string, error: DesignerJobError): Promise<boolean> {
    const out = await this.prisma.client.aiDesignerJob.updateMany({
      where: { id: jobId, leaseOwner: owner, status: 'running' },
      data: { status: 'failed', error: error as unknown as Prisma.InputJsonValue, finishedAt: new Date() },
    });
    return out.count > 0;
  }

  /** The pipeline stopped at a cancellation point while the job was still ours. */
  async markCancelled(jobId: string, owner: string): Promise<boolean> {
    const out = await this.prisma.client.aiDesignerJob.updateMany({
      where: { id: jobId, leaseOwner: owner, status: 'running' },
      data: { status: 'cancelled', finishedAt: new Date() },
    });
    return out.count > 0;
  }

  /**
   * Graceful shutdown: hand this worker's running jobs back to the queue so the next container
   * claims them at once instead of after the 3-minute stale window. A graceful hand-back is not the
   * job's fault, so it gives the attempt back.
   */
  async release(owner: string): Promise<number> {
    const n = await this.prisma.client.$executeRawUnsafe(
      `
      UPDATE "ai_designer_jobs"
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
   * Recover jobs whose worker died. A running job with no heartbeat for DESIGNER_JOB_STALE_MS is
   * re-queued ONCE (attempts < DESIGNER_JOB_MAX_ATTEMPTS), then failed with AI_DESIGN_JOB_STALLED;
   * a job still queued after DESIGNER_JOB_ACTIVE_WINDOW_MS (no worker ever took it) is failed with
   * AI_DESIGN_JOB_EXPIRED. Every statement is a guarded state transition, so any number of
   * replicas may run it concurrently.
   */
  async sweepStale(): Promise<{ requeued: number; failed: number; expired: number }> {
    const failed = await this.prisma.client.$executeRawUnsafe(
      `
      UPDATE "ai_designer_jobs"
         SET "status" = 'failed',
             "lease_owner" = NULL,
             "finished_at" = NOW(),
             "error" = jsonb_build_object('code', $2::text, 'message', $3::text, 'status', 503)
       WHERE "status" = 'running'
         AND "heartbeat_at" < NOW() - ($1 * INTERVAL '1 millisecond')
         AND "attempts" >= $4
      `,
      DESIGNER_JOB_STALE_MS,
      DESIGNER_JOB_STALLED_CODE,
      'The board generation stopped unexpectedly twice. Try again.',
      DESIGNER_JOB_MAX_ATTEMPTS,
    );
    const requeued = await this.prisma.client.$executeRawUnsafe(
      `
      UPDATE "ai_designer_jobs"
         SET "status" = 'queued',
             "lease_owner" = NULL,
             "heartbeat_at" = NULL,
             "progress" = NULL
       WHERE "status" = 'running'
         AND "heartbeat_at" < NOW() - ($1 * INTERVAL '1 millisecond')
         AND "attempts" < $2
      `,
      DESIGNER_JOB_STALE_MS,
      DESIGNER_JOB_MAX_ATTEMPTS,
    );
    const expired = await this.prisma.client.$executeRawUnsafe(
      `
      UPDATE "ai_designer_jobs"
         SET "status" = 'failed',
             "finished_at" = NOW(),
             "error" = jsonb_build_object('code', $2::text, 'message', $3::text, 'status', 503)
       WHERE "status" = 'queued'
         AND "created_at" < NOW() - ($1 * INTERVAL '1 millisecond')
      `,
      DESIGNER_JOB_ACTIVE_WINDOW_MS,
      DESIGNER_JOB_EXPIRED_CODE,
      'The board generation never started. Try again.',
    );
    const n = (v: unknown) => (typeof v === 'number' ? v : 0);
    const out = { requeued: n(requeued), failed: n(failed), expired: n(expired) };
    if (out.requeued || out.failed || out.expired) {
      this.logger.warn(
        `designer-jobs: stale sweep re-queued ${out.requeued}, failed ${out.failed} (${DESIGNER_JOB_STALLED_CODE}), ` +
          `expired ${out.expired} (${DESIGNER_JOB_EXPIRED_CODE}) — a replica stopped heartbeating mid-job`,
      );
    }
    return out;
  }
}
