import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@cms/database';
import { extname } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import {
  LEASE,
  LeaderLeaseService,
  leadThisTick,
} from '../realtime/leader-lease.service';
import { SupabaseStorageService } from './supabase-storage.service';
import { VideoPosterService } from './video-poster.service';
import { needsProbeSql } from './video-probe-backfill';

/**
 * Video probe auto-heal (2026-09-24).
 *
 * Every NEW video is probed at upload (`VideoPosterService.kickOff` →
 * `processingMeta.probe`, the facts the "Playback on screens" grade reads).
 * Everything uploaded before the probe existed — and every row a probe
 * version bump makes stale — has no current facts, and the operator's only
 * ways to get them were a click per file ("Check this file") or the CLI
 * backfill run by hand against production. Greg, after a Canva export
 * stuttered on a kiosk: the two files he needs graded went up before the
 * probe existed, and "make the path so automated that they don't know how
 * they worked without VenueOS" applies to the library too.
 *
 * So the library grades ITSELF: shortly after boot and then hourly, the
 * leader takes a bounded batch of videos that still need a probe — newest
 * first, because the files an operator is about to schedule are the ones
 * that just went up — and runs the same probe + poster pass an upload gets.
 * Everything hard is already solved in VideoPosterService (tenant-scoped
 * merge, the failure stamp that stops a row being retried every hour, the
 * poster guards); this cron only decides WHEN and HOW MANY.
 *
 * Cost per row: ffprobe reads a few hundred KB of the object over HTTP
 * (headers + the moov walk), the poster grab decodes one keyframe. Paced so a
 * 1,000-video library never saturates the pod, Supabase egress or the
 * connection pool (`connection_limit=10`, session mode — CLAUDE.md).
 *
 * Multi-replica: leader-leased — every candidate costs a storage read and a
 * decoder, and two replicas would spend it twice and race the same row's
 * processingMeta merge. Degraded (Redis down) = one replica assumes leadership
 * and the work still happens (binding rule 1). The candidate predicate is the
 * SAME SQL the CLI backfill uses (`needsProbeSql`), so the two agree on which
 * rows still need a probe, and a row the current version already probed — or
 * already failed on — is never picked twice.
 */
@Injectable()
export class VideoProbeAutoHealCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoProbeAutoHealCron.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  static readonly INTERVAL_MS = 60 * 60_000;
  /** Rows per tick. Hourly × 25 = 600 a day — a library of legacy uploads clears in days, quietly. */
  static readonly BATCH_LIMIT = 25;
  /** Pause between rows — the rate limit. */
  static readonly PACE_MS = 2_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
    private readonly videoPoster: VideoPosterService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.VIDEO_PROBE_AUTOHEAL_DISABLED === '1') {
      this.logger.warn(
        'Video probe auto-heal disabled via env (VIDEO_PROBE_AUTOHEAL_DISABLED=1)',
      );
      return;
    }
    // Boot delay with jitter so replicas do not tick in phase, and so the
    // first tick lands after the pool is warm and the health checks are green.
    const bootDelay = 90_000 + Math.floor(Math.random() * 30_000);
    setTimeout(() => {
      void this.tick().catch((e) =>
        this.logger.warn(`first tick failed: ${(e as Error).message}`),
      );
    }, bootDelay);
    this.timer = setInterval(() => {
      void this.tick().catch((e) =>
        this.logger.warn(`tick failed: ${(e as Error).message}`),
      );
    }, VideoProbeAutoHealCron.INTERVAL_MS);
    this.logger.log(
      `Video probe auto-heal active — hourly, batch ≤ ${VideoProbeAutoHealCron.BATCH_LIMIT}`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Public so tests can drive a tick without the timer. Resolves the number
   * of rows the pass ran the probe on (0 when not leader, nothing to do, or
   * a tick is already in flight on this replica).
   */
  async tick(): Promise<number> {
    if (this.running) return 0;
    const status = await leadThisTick(this.lease, LEASE.VIDEO_PROBE_AUTOHEAL);
    if (!status.leader) return 0;
    this.running = true;
    try {
      // Cheap gate before waking the machinery: the overwhelmingly common
      // hourly outcome is "nothing to do" and it must cost one count() only.
      const total = await this.countCandidates();
      if (total === 0) return 0;

      const rows = await this.fetchBatch(VideoProbeAutoHealCron.BATCH_LIMIT);
      let probed = 0;
      let skipped = 0;
      let failed = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const storagePath = this.storage.extractPath(row.fileUrl);
        if (!storagePath) {
          // A pasted external/CDN URL: we do not own the bytes and never point
          // ffprobe at a stored third-party URL. Not a candidate next hour
          // either? It is — and it costs one skipped row per tick, which is
          // fine; the CLI reports these the same way.
          skipped += 1;
          continue;
        }
        const result = await this.videoPoster.processVideo({
          assetId: row.id,
          tenantId: row.tenantId,
          mimeType: row.mimeType,
          storagePath,
          ext: extname(row.originalName || '') || null,
        });
        if (result.probed) probed += 1;
        else failed += 1;
        if (i < rows.length - 1)
          await this.sleep(VideoProbeAutoHealCron.PACE_MS);
      }
      this.logger.log(
        `[video-probe-autoheal] ${total} video(s) needed a probe; this pass probed ${probed}, ` +
          `failed ${failed} (stamped, retried next version), skipped ${skipped} external` +
          (total > rows.length
            ? `; ${total - rows.length} left for the next hour`
            : ''),
      );
      return rows.length - skipped;
    } finally {
      this.running = false;
    }
  }

  private async countCandidates(): Promise<number> {
    const rows = await this.prisma.client.$queryRaw<Array<{ count: number }>>(
      Prisma.sql`SELECT count(*)::int AS count FROM assets
                 WHERE mime_type LIKE 'video/%' AND ${needsProbeSql()}`,
    );
    return rows[0]?.count ?? 0;
  }

  /** Newest first — the file an operator just uploaded is the one they are about to schedule. */
  private fetchBatch(take: number): Promise<AutoHealRow[]> {
    return this.prisma.client.$queryRaw<AutoHealRow[]>(
      Prisma.sql`SELECT id, tenant_id AS "tenantId", file_url AS "fileUrl",
                        mime_type AS "mimeType", original_name AS "originalName"
                 FROM assets
                 WHERE mime_type LIKE 'video/%' AND ${needsProbeSql()}
                 ORDER BY created_at DESC, id DESC
                 LIMIT ${take}`,
    );
  }

  /** Overridable in tests so a paced batch does not wait for real time. */
  protected sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

interface AutoHealRow {
  id: string;
  tenantId: string;
  fileUrl: string;
  mimeType: string;
  originalName: string | null;
}
