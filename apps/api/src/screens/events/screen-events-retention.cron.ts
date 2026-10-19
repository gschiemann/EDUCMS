import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LEASE, LeaderLeaseService, leadThisTick } from '../../realtime/leader-lease.service';

/**
 * Retention for `screen_events` — the per-screen timeline and the
 * interruption ledger it carries (2026-10-18).
 *
 * Two bounds, hourly, on the leader only (the work is a DELETE — two
 * replicas would race the same rows for nothing):
 *   • age: rows older than 30 days. The wedge detector's sweep has pruned
 *     the timeline at 30 days since 2026-08-31; this keeps the ledger bounded
 *     even with that detector switched off (WEDGE_DETECTOR_DISABLED=1).
 *   • count: beyond the newest 2,000 rows of any one screen — a screen
 *     caught in a loop that its dedup window cannot fold (a new session
 *     every minute, say) can never grow the table without bound.
 * At most 50,000 rows per bound per tick, so a first sweep over a backlog
 * never holds the pool. Disabled in tests and via
 * SCREEN_EVENTS_RETENTION_DISABLED=1.
 */
@Injectable()
export class ScreenEventsRetentionCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScreenEventsRetentionCron.name);
  private timer?: NodeJS.Timeout;
  private firstRun?: NodeJS.Timeout;

  static readonly INTERVAL_MS = 60 * 60_000;
  static readonly FIRST_RUN_DELAY_MS = 5 * 60_000;
  static readonly MAX_AGE_MS = 30 * 24 * 60 * 60_000;
  static readonly MAX_ROWS_PER_SCREEN = 2_000;
  static readonly DELETE_BATCH = 50_000;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.SCREEN_EVENTS_RETENTION_DISABLED === '1') {
      this.logger.warn('ScreenEventsRetention disabled via env (SCREEN_EVENTS_RETENTION_DISABLED=1)');
      return;
    }
    const tick = () => {
      void this.sweep().catch((e) => this.logger.warn(`retention sweep failed: ${(e as Error).message}`));
    };
    this.firstRun = setTimeout(tick, ScreenEventsRetentionCron.FIRST_RUN_DELAY_MS);
    this.timer = setInterval(tick, ScreenEventsRetentionCron.INTERVAL_MS);
    this.logger.log(
      `ScreenEventsRetention active — hourly, ${ScreenEventsRetentionCron.MAX_AGE_MS / 86_400_000} d / ` +
        `${ScreenEventsRetentionCron.MAX_ROWS_PER_SCREEN} rows per screen`,
    );
  }

  onModuleDestroy(): void {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.timer) clearInterval(this.timer);
  }

  /** Public so tests can drive a tick. Null when another replica leads. */
  async sweep(nowMs: number = Date.now()): Promise<{ aged: number; capped: number } | null> {
    const status = await leadThisTick(this.lease, LEASE.SCREEN_EVENTS_RETENTION);
    if (!status.leader) return null;

    let aged = 0;
    try {
      const cutoff = new Date(nowMs - ScreenEventsRetentionCron.MAX_AGE_MS);
      aged = Number(
        await this.prisma.client.$executeRaw`
          DELETE FROM "screen_events"
          WHERE "id" IN (
            SELECT "id" FROM "screen_events"
            WHERE "created_at" < ${cutoff}
            LIMIT ${ScreenEventsRetentionCron.DELETE_BATCH}
          )`,
      ) || 0;
    } catch (e) {
      this.logger.warn(`[screen-events] age sweep failed: ${(e as Error).message}`);
    }

    let capped = 0;
    try {
      const cap = ScreenEventsRetentionCron.MAX_ROWS_PER_SCREEN;
      capped = Number(
        await this.prisma.client.$executeRaw`
          DELETE FROM "screen_events"
          WHERE "id" IN (
            SELECT ranked."id" FROM (
              SELECT "id", row_number() OVER (
                PARTITION BY "screen_id" ORDER BY "created_at" DESC, "id" DESC
              ) AS rn
              FROM "screen_events"
              WHERE "screen_id" IN (
                SELECT "screen_id" FROM "screen_events"
                GROUP BY "screen_id" HAVING count(*) > ${cap}
              )
            ) ranked
            WHERE ranked.rn > ${cap}
            LIMIT ${ScreenEventsRetentionCron.DELETE_BATCH}
          )`,
      ) || 0;
    } catch (e) {
      this.logger.warn(`[screen-events] per-screen cap sweep failed: ${(e as Error).message}`);
    }

    if (aged > 0 || capped > 0) {
      this.logger.log(`[screen-events] retention: ${aged} row(s) past 30 d, ${capped} past the per-screen cap`);
    }
    return { aged, capped };
  }
}
