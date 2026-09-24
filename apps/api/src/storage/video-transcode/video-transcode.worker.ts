/**
 * VideoTranscodeWorker — runs `video_transcode_jobs` in the API process, on
 * every replica (2026-09-23, 4K uploads).
 *
 * Per replica, per tick:
 *   1. one cheap read (`pendingWork`): anything queued, stale, or an original
 *      due for its retention check? An idle replica does nothing else;
 *   2. stale sweep (running with no heartbeat for 3 min → re-queued once, then
 *      failed; queued for 24 h → expired);
 *   3. claim ONE queued job (`FOR UPDATE SKIP LOCKED`) if this replica is not
 *      already transcoding, and run VideoTranscodePipeline on it;
 *   4. at most every 10 minutes, one retention check: a swapped-out ORIGINAL
 *      past its 7-day hold is deleted only if no row anywhere still names it
 *      (object-references.ts) — otherwise it is kept and looked at again.
 *
 * ONE transcode per replica at a time. ffmpeg is CPU work in the process that
 * delivers lockdown alerts; it runs capped at two threads and reniced to 19
 * (transcode-runner.ts), and a second concurrent encode would only halve both.
 *
 * Cadence: 5 s while there is work, doubling to a 60 s ceiling while idle, and
 * immediately when THIS replica queues a job (`VideoTranscodeService.onQueued`).
 *
 * Shutdown (a deploy): the running job is handed back to the queue FIRST
 * (attempt returned), then ffmpeg is killed — the next container restarts it
 * at once instead of after the stale window, and no "failed" is ever written
 * for a job that is merely moving house.
 *
 * Idle when ffmpeg/ffprobe are missing (a dev box): logged once, nothing is
 * claimed, and the rows wait for a replica that can run them. Disabled under
 * NODE_ENV=test (specs drive `tick()` / `run()` directly) and when
 * VIDEO_TRANSCODE_DISABLED=1.
 */
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseStorageService } from '../supabase-storage.service';
import {
  objectNeedle,
  scanForObjectReference,
  type ReferenceScanResult,
} from './object-references';
import {
  VideoTranscodePipeline,
  remuxAfterTranscode,
} from './video-transcode.pipeline';
import {
  ORIGINAL_RECHECK_MS,
  ORIGINAL_UNKNOWN_RECHECK_MS,
  VideoTranscodeService,
  type ClaimedTranscodeJob,
} from './video-transcode.service';

export const TRANSCODE_POLL_BASE_MS = 5_000;
export const TRANSCODE_POLL_IDLE_CEILING_MS = 60_000;
export const TRANSCODE_HEARTBEAT_MS = 15_000;
/** Minimum gap between two progress writes for the running job. */
export const TRANSCODE_PROGRESS_MIN_GAP_MS = 5_000;
/** Minimum gap between two retention checks on one replica (each is a whole-database scan). */
export const ORIGINAL_SWEEP_MIN_GAP_MS = 10 * 60_000;

/** Next idle delay: base after work, doubling while idle, capped. */
export function nextTranscodePollDelay(
  currentMs: number,
  didWork: boolean,
): number {
  if (didWork) return TRANSCODE_POLL_BASE_MS;
  return Math.min(
    Math.max(currentMs, TRANSCODE_POLL_BASE_MS) * 2,
    TRANSCODE_POLL_IDLE_CEILING_MS,
  );
}

@Injectable()
export class VideoTranscodeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoTranscodeWorker.name);
  /** This instance's lease identity. Every write after a claim is conditional on it. */
  readonly owner = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private running: { id: string; abort: AbortController } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private ticking = false;
  private rerun = false;
  private stopped = true;
  private delayMs = TRANSCODE_POLL_BASE_MS;
  private lastOriginalSweepAt = 0;
  /** null = not checked yet. */
  private ffmpegOk: boolean | null = null;
  private readonly unsubscribe: Array<() => void> = [];
  /** Replaced in specs. */
  scanReferences: (needle: string) => Promise<ReferenceScanResult> = (needle) =>
    scanForObjectReference(this.prisma, needle);

  constructor(
    private readonly jobs: VideoTranscodeService,
    private readonly pipeline: VideoTranscodePipeline,
    private readonly storage: SupabaseStorageService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') {
      this.logger.log('VideoTranscodeWorker disabled (test mode)');
      return;
    }
    if (VideoTranscodeService.disabled()) {
      this.logger.warn(
        'VideoTranscodeWorker disabled (VIDEO_TRANSCODE_DISABLED) — uploads keep their original files',
      );
      return;
    }
    this.start();
  }

  /** Begin polling (public so a spec can drive a started worker). */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.unsubscribe.push(this.jobs.onQueued(() => this.wake()));
    this.heartbeatTimer = setInterval(
      () => void this.beat(),
      TRANSCODE_HEARTBEAT_MS,
    );
    this.heartbeatTimer.unref?.();
    this.logger.log(
      `VideoTranscodeWorker starting as ${this.owner} (poll ${TRANSCODE_POLL_BASE_MS}ms → ${TRANSCODE_POLL_IDLE_CEILING_MS}ms idle, 1 transcode per replica)`,
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
    if (!this.running) return;
    try {
      const n = await this.jobs.release(this.owner);
      if (n)
        this.logger.warn(
          `VideoTranscodeWorker: shutting down — handed ${n} transcode(s) back to the queue`,
        );
    } catch (e) {
      this.logger.warn(
        `VideoTranscodeWorker: release on shutdown failed (the stale sweep will recover it): ${(e as Error)?.message ?? e}`,
      );
    }
    this.running?.abort.abort();
  }

  /** Claim now (a job was queued on this replica, or the slot freed up). */
  wake(): void {
    if (this.stopped) return;
    this.delayMs = TRANSCODE_POLL_BASE_MS;
    if (this.ticking) {
      this.rerun = true;
      return;
    }
    this.schedule(0);
  }

  get busy(): boolean {
    return this.running !== null;
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
      this.delayMs = TRANSCODE_POLL_BASE_MS;
      this.schedule(claimed ? TRANSCODE_POLL_BASE_MS : 0);
      return;
    }
    this.delayMs = nextTranscodePollDelay(this.delayMs, false);
    this.schedule(this.delayMs);
  }

  /**
   * One pass: probe, sweep, maybe one retention check, claim at most ONE job
   * and start it (not awaited).
   *
   * NO LEADER LEASE, DELIBERATELY (2026-09-23): every replica runs this. The
   * claim is a per-row `FOR UPDATE SKIP LOCKED` update, so two replicas
   * provably cannot claim the same transcode, and a CPU-heavy queue spreads
   * across replicas instead of serialising every tenant's videos behind one
   * leader. The stale sweep is a set of guarded state transitions and the
   * retention check claims its row the same SKIP LOCKED way, so both are safe
   * on every replica at once. A cluster lease would only add a failover gap
   * (same reasoning as templates/designer-jobs/designer-jobs.worker.ts).
   */
  async tick(): Promise<{ claimed: boolean }> {
    if (this.ticking) return { claimed: false };
    this.ticking = true;
    try {
      const work = await this.jobs.pendingWork();
      if (work.stale) await this.jobs.sweepStale();
      if (
        work.originalDue &&
        Date.now() - this.lastOriginalSweepAt >= ORIGINAL_SWEEP_MIN_GAP_MS
      ) {
        this.lastOriginalSweepAt = Date.now();
        await this.sweepOneOriginal();
      }
      if (this.running || !work.queued) return { claimed: false };
      if (this.ffmpegOk === null) {
        this.ffmpegOk = await this.pipeline
          .ffmpegAvailable()
          .catch(() => false);
        if (!this.ffmpegOk) {
          this.logger.warn(
            'VideoTranscodeWorker idle: ffmpeg/ffprobe not found on this replica — queued videos wait for one that has them',
          );
        }
      }
      if (!this.ffmpegOk) return { claimed: false };
      const job = await this.jobs.claimNext(this.owner);
      if (!job) return { claimed: false };
      void this.run(job);
      return { claimed: true };
    } catch (e) {
      this.logger.warn(
        `VideoTranscodeWorker tick failed: ${(e as Error)?.message ?? e}`,
      );
      return { claimed: false };
    } finally {
      this.ticking = false;
    }
  }

  /** Run one claimed job to a terminal state. Public for specs; never throws. */
  async run(job: ClaimedTranscodeJob): Promise<void> {
    const abort = new AbortController();
    this.running = { id: job.id, abort };
    let lastWrite = 0;
    let pending: number | null = null;
    let chain: Promise<void> = Promise.resolve();
    const writeProgress = (pct: number) => {
      pending = pct;
      const now = Date.now();
      if (now - lastWrite < TRANSCODE_PROGRESS_MIN_GAP_MS) return;
      lastWrite = now;
      const value = pending;
      pending = null;
      chain = chain
        .then(async () => {
          const stillOurs = await this.jobs.saveProgress(
            job.id,
            this.owner,
            value,
          );
          if (!stillOurs) abort.abort(); // re-queued elsewhere
        })
        .catch(() => undefined); // a missed progress write costs one update, never the job
    };
    try {
      const outcome = await this.pipeline.process(job, {
        signal: abort.signal,
        onProgress: writeProgress,
      });
      await chain;
      if (outcome.reason === 'aborted') {
        // Shutdown or a lost lease: the row was already handed back / claimed elsewhere.
        return;
      }
      const stored = await this.jobs.finish(job.id, this.owner, outcome);
      if (!stored) {
        // Re-queued or claimed elsewhere meanwhile. If THIS run swapped the
        // asset, the swap stands (its output is what the asset now serves) and
        // the other run finds `source-changed` and does nothing.
        this.logger.log(
          `VideoTranscodeWorker: ${job.id} finished after it was re-queued elsewhere — outcome discarded`,
        );
      }
      this.logger.log(
        `[transcode] job ${job.id} asset ${job.assetId}: ${outcome.status} (${outcome.reason})` +
          (outcome.details &&
          typeof (outcome.details as any).bytesIn === 'number'
            ? ` bytes in ${(outcome.details as any).bytesIn}, out ${outcome.outputBytes ?? (outcome.details as any).bytesOut ?? 'n/a'}`
            : ''),
      );
      // The original stays: the fast-start re-mux VideoPosterService deferred
      // while this job was queued may still apply to it (pipeline).
      if (stored && remuxAfterTranscode(outcome)) {
        await this.pipeline.remuxKeptOriginal(job);
      }
    } catch (e) {
      // pipeline.process never throws; this is the belt to its braces.
      this.logger.warn(
        `VideoTranscodeWorker: run ${job.id} threw: ${(e as Error)?.message ?? e}`,
      );
    } finally {
      this.running = null;
      this.wake();
    }
  }

  /** Heartbeat the running job; abort it if the lease is gone. */
  private async beat(): Promise<void> {
    const r = this.running;
    if (!r) return;
    try {
      const held = await this.jobs.heartbeat(this.owner, [r.id]);
      if (!held.includes(r.id)) r.abort.abort();
    } catch (e) {
      this.logger.warn(
        `VideoTranscodeWorker heartbeat failed: ${(e as Error)?.message ?? e}`,
      );
    }
  }

  /** Test hook. */
  async heartbeatNow(): Promise<void> {
    await this.beat();
  }

  /**
   * One retention check. The original goes only when nothing anywhere names it;
   * a reference (a template zone that embedded the URL, a screen's emergency
   * media…) keeps it and it is looked at again in a week; a scan that cannot
   * finish keeps it and tries again tomorrow. Deleting is the ONLY destructive
   * step in this feature, so every doubt resolves to "keep".
   */
  async sweepOneOriginal(): Promise<'deleted' | 'kept' | 'none'> {
    const due = await this.jobs.claimDueOriginal();
    if (!due) return 'none';
    const sourcePath = this.storage.extractPath(due.sourceUrl);
    const needle = sourcePath ? objectNeedle(sourcePath) : null;
    if (!sourcePath || !needle) {
      await this.jobs.deferOriginal(
        due.id,
        ORIGINAL_RECHECK_MS * 52,
        'kept: not a presign-shaped object',
      );
      return 'kept';
    }
    const scan = await this.scanReferences(needle).catch(
      (e): ReferenceScanResult => ({
        status: 'unknown',
        reason: (e as Error)?.message ?? String(e),
      }),
    );
    if (scan.status === 'referenced') {
      await this.jobs.deferOriginal(
        due.id,
        ORIGINAL_RECHECK_MS,
        `kept: referenced by ${scan.table}.${scan.column}`,
      );
      this.logger.log(
        `[transcode] original ${sourcePath} kept — still referenced by ${scan.table}.${scan.column}`,
      );
      return 'kept';
    }
    if (scan.status === 'unknown') {
      await this.jobs.deferOriginal(
        due.id,
        ORIGINAL_UNKNOWN_RECHECK_MS,
        `kept: reference scan incomplete (${scan.reason})`,
      );
      this.logger.warn(
        `[transcode] original ${sourcePath} kept — reference scan incomplete: ${scan.reason}`,
      );
      return 'kept';
    }
    await this.storage.delete(sourcePath);
    // `delete` logs and swallows its own errors — prove the object is gone
    // before the row says so (a GET that no longer finds it).
    const stillThere = await this.storage.assertObjectExists(sourcePath).then(
      () => true,
      () => false,
    );
    if (stillThere) {
      await this.jobs.deferOriginal(
        due.id,
        ORIGINAL_UNKNOWN_RECHECK_MS,
        'kept: storage delete did not take',
      );
      this.logger.warn(
        `[transcode] original ${sourcePath} could not be deleted — retrying tomorrow`,
      );
      return 'kept';
    }
    await this.jobs.markOriginalDeleted(due.id);
    await this.prisma.client.auditLog
      .create({
        data: {
          tenantId: due.tenantId,
          userId: null,
          action: 'ASSET_VIDEO_ORIGINAL_DELETED',
          targetType: 'Asset',
          targetId: due.assetId,
          details: JSON.stringify({
            originalUrl: due.sourceUrl,
            tablesScanned: scan.tablesScanned,
          }),
        },
      })
      .catch(() => undefined);
    this.logger.log(
      `[transcode] original ${sourcePath} deleted — no reference in ${scan.tablesScanned} tables`,
    );
    return 'deleted';
  }
}
