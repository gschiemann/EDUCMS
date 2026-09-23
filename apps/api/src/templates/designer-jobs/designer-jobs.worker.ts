/**
 * DesignerJobsWorker — runs `ai_designer_jobs` rows in the API process, on every replica
 * (2026-09-23, Codex finding 5 + the async gap).
 *
 * The loop, per replica:
 *   1. tick: one cheap read (`pendingWork`) decides whether there is a queued job to claim or a
 *      stale one to sweep; an idle replica does nothing else;
 *   2. sweep: running jobs with no heartbeat for 3 min are re-queued once, then failed
 *      (AI_DESIGN_JOB_STALLED); never-claimed jobs expire after 30 min (AI_DESIGN_JOB_EXPIRED);
 *   3. claim ONE queued job (`FOR UPDATE SKIP LOCKED`) if this replica has a free slot, and run the
 *      SAME `AiService.generateDesignerBoardCandidates` the sync endpoint calls, with the options
 *      the sync endpoint would have built (designer-job-request.ts), passing `onProgress` + an
 *      AbortSignal (designer-generation-hooks.ts);
 *   4. progress is persisted at most every 500 ms (latest wins); the lease is heartbeated every
 *      15 s; the result / error / cancellation is written conditionally on the lease.
 *
 * Cadence: 2 s while there is work, doubling to a 30 s ceiling while idle, and back to "now" the
 * instant this replica queues a job (`DesignerJobsService.onQueued`) or frees a slot. A job created
 * on this replica is therefore claimed immediately; the ceiling only bounds how fast an IDLE
 * replica notices another replica's re-queued work. (The 2026-09-02 efficiency audit is why: the
 * webhook worker's flat 5 s poll was 17,280 probes/day/replica against an empty queue.)
 *
 * Cancellation: the cancel endpoint moves the row to `cancelled`; a run on THIS replica aborts at
 * once (in-process signal), a run on another replica aborts at its next heartbeat or progress
 * write (both are conditional on `status = 'running'` and report the lease lost). The pipeline
 * checks the signal BETWEEN stages — an in-flight model call finishes on its own budget and its
 * result is discarded.
 *
 * Disabled under NODE_ENV=test (specs drive `tick()` / `run()` directly).
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { AiService } from '../../ai/ai.service';
import { DesignerGenerationCancelled, type DesignerProgress } from '../../ai/designer-generation-hooks';
import {
  DesignerJobsService,
  storedProgress,
  type ClaimedDesignerJob,
  type StoredDesignerProgress,
} from './designer-jobs.service';
import { designerJobResult, designerOptionsFromJobRequest } from './designer-job-request';
import { designerJobErrorFor } from './designer-job-error';

/** Tick cadence while there is (or just was) work. */
export const DESIGNER_JOB_POLL_BASE_MS = 2_000;
/** Idle backoff ceiling. */
export const DESIGNER_JOB_POLL_IDLE_CEILING_MS = 30_000;
/** Lease refresh cadence for this replica's running jobs (stale threshold is 3 min = 12 beats). */
export const DESIGNER_JOB_HEARTBEAT_MS = 15_000;
/** Minimum gap between two progress writes for one job. */
export const DESIGNER_JOB_PROGRESS_MIN_GAP_MS = 500;
/**
 * Jobs one replica runs at once. A job is three to six long outbound model calls and a little
 * sanitising — I/O, not CPU — but each holds up to ~400 KB of board HTML and the pool is 10
 * connections, so this stays small. More queued work waits for a free slot on any replica.
 */
export const DESIGNER_JOBS_PER_REPLICA = 3;

/** Next idle delay: base after work, doubling while idle, capped. Pure, so the curve is testable. */
export function nextDesignerJobPollDelay(currentMs: number, didWork: boolean): number {
  if (didWork) return DESIGNER_JOB_POLL_BASE_MS;
  return Math.min(Math.max(currentMs, DESIGNER_JOB_POLL_BASE_MS) * 2, DESIGNER_JOB_POLL_IDLE_CEILING_MS);
}

/**
 * Coalesces a job's progress events into DB writes at most every `minGapMs`: the first event is
 * written at once, later ones inside the gap are held and the LATEST is written when the gap
 * closes. Writes are chained, so they land in order even if one is slow.
 */
export class ThrottledProgressWriter {
  private lastWriteAt = Number.NEGATIVE_INFINITY;
  private pending: DesignerProgress | null = null;
  private timer: NodeJS.Timeout | null = null;
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly write: (p: StoredDesignerProgress) => Promise<void>,
    private readonly minGapMs = DESIGNER_JOB_PROGRESS_MIN_GAP_MS,
    private readonly now: () => number = Date.now,
  ) {}

  push(p: DesignerProgress): void {
    if (this.stopped || !p) return;
    this.pending = p;
    if (this.timer) return; // a trailing write is already scheduled — it will take the latest
    const wait = this.lastWriteAt + this.minGapMs - this.now();
    if (wait <= 0) {
      this.flush();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, wait);
    this.timer.unref?.();
  }

  private flush(): void {
    if (this.stopped || !this.pending) return;
    const p = this.pending;
    this.pending = null;
    this.lastWriteAt = this.now();
    const stored = storedProgress(p, new Date(this.lastWriteAt));
    this.chain = this.chain.then(() => this.write(stored)).catch(() => undefined);
  }

  /** No more writes (the job's final state is written by complete/fail); resolves once the in-flight one settles. */
  stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    return this.chain;
  }
}

@Injectable()
export class DesignerJobsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DesignerJobsWorker.name);
  /** This worker instance's lease identity. Every write after a claim is conditional on it. */
  readonly owner = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  /** Jobs this replica is running now → the controller that aborts each. */
  private readonly running = new Map<string, AbortController>();
  private timer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private ticking = false;
  private rerun = false;
  private stopped = true;
  private delayMs = DESIGNER_JOB_POLL_BASE_MS;
  private readonly unsubscribe: Array<() => void> = [];

  constructor(
    private readonly jobs: DesignerJobsService,
    private readonly ai: AiService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') {
      this.logger.log('DesignerJobsWorker disabled (test mode)');
      return;
    }
    this.start();
  }

  /** Begin polling (public so a spec can drive a started worker). */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.unsubscribe.push(this.jobs.onQueued(() => this.wake()));
    this.unsubscribe.push(this.jobs.onCancelled((id) => this.running.get(id)?.abort()));
    this.heartbeatTimer = setInterval(() => void this.beat(), DESIGNER_JOB_HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
    this.logger.log(
      `DesignerJobsWorker starting as ${this.owner} (poll ${DESIGNER_JOB_POLL_BASE_MS}ms → ${DESIGNER_JOB_POLL_IDLE_CEILING_MS}ms idle, ` +
        `${DESIGNER_JOBS_PER_REPLICA} jobs per replica)`,
    );
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.timer = null;
    this.heartbeatTimer = null;
    while (this.unsubscribe.length) this.unsubscribe.pop()?.();
    if (this.running.size === 0) return;
    // A redeploy: hand the running jobs back so the next container claims them now, not after the
    // 3-minute stale window. Release FIRST — the abort that follows then finds the rows no longer
    // ours, so no "cancelled" is ever written for a job that is merely moving house.
    try {
      const n = await this.jobs.release(this.owner);
      if (n) this.logger.warn(`DesignerJobsWorker: shutting down — handed ${n} running job(s) back to the queue`);
    } catch (e) {
      this.logger.warn(`DesignerJobsWorker: release on shutdown failed (the stale sweep will recover them): ${(e as Error)?.message ?? e}`);
    }
    for (const abort of this.running.values()) abort.abort();
  }

  /** Claim now (a job was queued here, or a slot freed up). */
  wake(): void {
    if (this.stopped) return;
    this.delayMs = DESIGNER_JOB_POLL_BASE_MS;
    if (this.ticking) {
      this.rerun = true;
      return;
    }
    this.schedule(0);
  }

  get runningCount(): number {
    return this.running.size;
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.loop(), ms);
    this.timer.unref?.();
  }

  private async loop(): Promise<void> {
    this.timer = null;
    const { claimed } = await this.tick();
    if (this.stopped || this.timer) return;
    if (claimed || this.rerun) {
      this.rerun = false;
      this.delayMs = DESIGNER_JOB_POLL_BASE_MS;
      // After a claim, wait one base interval before the next: one claim per tick per replica
      // spreads a burst across replicas. A wake that arrived mid-tick goes now.
      this.schedule(claimed ? DESIGNER_JOB_POLL_BASE_MS : 0);
      return;
    }
    this.delayMs = nextDesignerJobPollDelay(this.delayMs, false);
    this.schedule(this.delayMs);
  }

  /**
   * One pass: probe, sweep, claim at most ONE job and start it (not awaited).
   *
   * NO LEADER LEASE, DELIBERATELY (2026-09-23): every replica runs this. The claim is a per-row
   * `FOR UPDATE SKIP LOCKED` update, so two replicas provably cannot claim the same job, and
   * replicas draw in parallel instead of queueing every tenant's boards behind one leader. The
   * stale sweep is a set of guarded state transitions (`WHERE status = 'running' AND heartbeat_at <
   * …`), safe to run on every replica at once. A cluster lease would only serialise the work and
   * add a failover gap (same reasoning as webhooks/webhook-retry.worker.ts).
   */
  async tick(): Promise<{ claimed: boolean }> {
    if (this.ticking) return { claimed: false };
    this.ticking = true;
    try {
      if (this.running.size >= DESIGNER_JOBS_PER_REPLICA) return { claimed: false };
      const work = await this.jobs.pendingWork();
      if (work.stale) await this.jobs.sweepStale();
      if (!work.queued && !work.stale) return { claimed: false };
      const job = await this.jobs.claimNext(this.owner);
      if (!job) return { claimed: false };
      void this.run(job);
      return { claimed: true };
    } catch (e) {
      this.logger.warn(`DesignerJobsWorker tick failed: ${(e as Error)?.message ?? e}`);
      return { claimed: false };
    } finally {
      this.ticking = false;
    }
  }

  /** Run one claimed job to a terminal state. Public for specs; never throws. */
  async run(job: ClaimedDesignerJob): Promise<void> {
    const abort = new AbortController();
    this.running.set(job.id, abort);
    const writer = new ThrottledProgressWriter(async (p) => {
      try {
        const stillOurs = await this.jobs.saveProgress(job.id, this.owner, p);
        if (!stillOurs) abort.abort(); // cancelled, or re-queued to another replica
      } catch (e) {
        // A transient DB error costs one progress update, never the job.
        this.logger.warn(`DesignerJobsWorker: progress write for ${job.id} failed: ${(e as Error)?.message ?? e}`);
      }
    });
    let of: number | undefined;
    try {
      const out = await this.ai.generateDesignerBoardCandidates(
        designerOptionsFromJobRequest(job.request, { tenantId: job.tenantId, userId: job.userId }),
        {
          signal: abort.signal,
          onProgress: (p) => {
            if (typeof p?.of === 'number') of = p.of;
            writer.push(p);
          },
        },
      );
      await writer.stop();
      const stored = await this.jobs.complete(job.id, this.owner, designerJobResult(out), of);
      if (!stored) {
        this.logger.log(`DesignerJobsWorker: ${job.id} finished after it was cancelled or re-queued — result discarded`);
      }
    } catch (e) {
      await writer.stop();
      try {
        if (e instanceof DesignerGenerationCancelled || abort.signal.aborted) {
          await this.jobs.markCancelled(job.id, this.owner);
        } else {
          await this.jobs.fail(job.id, this.owner, designerJobErrorFor(e, { userId: job.userId }));
        }
      } catch (writeErr) {
        // The row keeps its lease without a heartbeat from here on, so the stale sweep recovers it.
        this.logger.warn(
          `DesignerJobsWorker: could not record the outcome of ${job.id}: ${(writeErr as Error)?.message ?? writeErr}`,
        );
      }
    } finally {
      this.running.delete(job.id);
      this.wake(); // a slot freed up
    }
  }

  /** Heartbeat this replica's running jobs; abort any whose lease is gone. */
  private async beat(): Promise<void> {
    const ids = Array.from(this.running.keys());
    if (ids.length === 0) return;
    try {
      const held = new Set(await this.jobs.heartbeat(this.owner, ids));
      for (const id of ids) {
        if (!held.has(id)) this.running.get(id)?.abort();
      }
    } catch (e) {
      // A missed beat is fine — the stale window is twelve of them.
      this.logger.warn(`DesignerJobsWorker heartbeat failed: ${(e as Error)?.message ?? e}`);
    }
  }

  /** Test hook: run one heartbeat now. */
  async heartbeatNow(): Promise<void> {
    await this.beat();
  }
}
