/**
 * Social post-cache refresh cron.
 *
 * Hourly, leader-leased. Copies pos-sync.cron.ts line for line, including the
 * per-process hour-bucket dedupe AND the Redis leader lease — on two replicas
 * an unleased tick would poll every tenant's Meta account twice an hour, which
 * is the fastest way to get a customer's Graph quota throttled (Meta's Page
 * rate limit is calculated per app + per user, and it is not generous).
 *
 * A replica that cannot reach Redis assumes leadership and logs it (the
 * multi-replica rule: degraded == today's single-replica behaviour, never
 * worse).
 */
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import {
  LEASE,
  LeaderLeaseService,
  leadThisTick,
} from '../../realtime/leader-lease.service';
import { SocialService } from './social.service';

@Injectable()
export class SocialSyncCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SocialSyncCron.name);
  private timer?: NodeJS.Timeout;
  private lastRunBucket = -1;
  private running = false;

  constructor(
    private readonly svc: SocialService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  onModuleInit(): void {
    if (
      process.env.NODE_ENV === 'test' ||
      process.env.SOCIAL_CRON_DISABLED === '1'
    )
      return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref?.();
    this.logger.log('Social sync cron scheduled (hourly).');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
    if (bucket === this.lastRunBucket) return;
    const status = await leadThisTick(this.lease, LEASE.SOCIAL_SYNC);
    if (!status.leader) return;
    this.lastRunBucket = bucket;
    this.running = true;
    try {
      await this.runAll();
    } catch (err: any) {
      this.logger.warn(`Social sync tick failed: ${err?.name || 'Error'}`);
    } finally {
      this.running = false;
    }
  }

  /** Public so an admin can invoke it from a script. */
  async runAll(): Promise<void> {
    const conns = await this.svc.listActiveConnections();
    if (!conns || conns.length === 0) return;
    this.logger.log(
      `Social hourly refresh starting for ${conns.length} connection(s).`,
    );
    for (const conn of conns) {
      try {
        // syncConnection never throws — it records the failure on the row —
        // but keep the guard so one unexpected shape cannot stop the loop.
        await this.svc.syncConnection(conn, null);
      } catch (err: any) {
        this.logger.warn(
          `Social sync failed conn=${conn?.id}: ${err?.name || 'Error'}`,
        );
      }
    }
  }
}
