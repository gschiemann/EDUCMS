import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LEASE, LeaderLeaseService, leadThisTick } from '../realtime/leader-lease.service';
import { playLogRetentionCutoff } from './play-log.policy';

/** Rows one DELETE statement removes; small enough to hold no long lock. */
export const PLAY_LOG_PURGE_CHUNK = 20_000;
/** Statements one hourly pass may run (≤ 400k rows/hour, ~9.6M/day). */
export const PLAY_LOG_PURGE_MAX_CHUNKS = 20;

export interface PlayLogPurgeClient {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

/**
 * Retention for `play_log_entries` (2026-11-09). Same posture as the
 * proof-of-play purge (`proof-of-play.sampler.ts`): leader-leased, best-effort
 * (a missing table or pool blip logs and returns), never on the boot path.
 * Different in one way: the play log can be millions of rows a day, so it
 * deletes in bounded chunks every hour instead of one statement a day.
 *
 * Window: `PLAY_LOG_RETENTION_DAYS`, default 30; ≤ 0 disables the purge
 * (the table then grows — that is the operator's call). Fails toward KEEPING
 * rows: a pass that cannot run deletes nothing.
 */
@Injectable()
export class PlayLogRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlayLogRetentionService.name);
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.purgeTick(), 3_600_000);
    this.first = setTimeout(() => void this.purgeTick(), 150_000);
    this.timer.unref?.();
    this.first.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.first) clearTimeout(this.first);
    this.timer = null;
    this.first = null;
  }

  /** One pass. Public for tests and ops. Returns rows deleted. */
  async purgeTick(nowMs = Date.now()): Promise<number> {
    if (this.running) return 0;
    const cutoff = playLogRetentionCutoff(process.env, nowMs);
    if (!cutoff) return 0;
    const status = await leadThisTick(this.lease, LEASE.PLAY_LOG_RETENTION);
    if (!status.leader) return 0;
    this.running = true;
    let total = 0;
    try {
      const client = this.prisma.client as unknown as PlayLogPurgeClient;
      for (let i = 0; i < PLAY_LOG_PURGE_MAX_CHUNKS; i++) {
        const n = await client.$executeRawUnsafe(
          `DELETE FROM "play_log_entries" WHERE ctid IN (
             SELECT ctid FROM "play_log_entries" WHERE "started_at" < $1 LIMIT ${PLAY_LOG_PURGE_CHUNK}
           )`,
          cutoff,
        );
        total += n;
        if (n < PLAY_LOG_PURGE_CHUNK) break;
      }
      if (total > 0) {
        this.logger.log(`play-log retention: purged ${total} row(s) older than ${cutoff.toISOString()}`);
      }
      return total;
    } catch (e) {
      this.logger.warn(`play-log retention failed: ${e instanceof Error ? e.message : String(e)}`);
      return total;
    } finally {
      this.running = false;
    }
  }
}
