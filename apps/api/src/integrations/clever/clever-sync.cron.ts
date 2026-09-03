import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { CleverService } from './clever.service';
import { LEASE, LeaderLeaseService, leadThisTick } from '../../realtime/leader-lease.service';

/**
 * Nightly Clever roster sync at 02:00 local server time.
 *
 * Spec requested `@Cron('0 2 * * *')` from `@nestjs/schedule`, but that package
 * is not currently installed in the API. To avoid adding a dependency in this
 * scaffold, we poll every 60s and fire exactly once per day when the wall
 * clock crosses 02:00. When `@nestjs/schedule` is later added, replace the
 * body of `onModuleInit` with a `@Cron('0 2 * * *')` decorated method and
 * delete the interval logic.
 */
@Injectable()
export class CleverSyncCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CleverSyncCron.name);
  private timer?: NodeJS.Timeout;
  private lastRunYmd: string | null = null;

  constructor(
    private readonly clever: CleverService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  onModuleInit(): void {
    // Disable in tests and when explicitly opted out.
    if (process.env.NODE_ENV === 'test' || process.env.CLEVER_CRON_DISABLED === '1') return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 60_000);
    this.logger.log('Clever sync cron scheduled (02:00 daily).');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private ymd(d: Date): string {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  async tick(): Promise<void> {
    const now = new Date();
    if (now.getHours() !== 2) return;
    const ymd = this.ymd(now);
    if (this.lastRunYmd === ymd) return;
    // Leader-leased (2026-09-02 multi-replica wave): the per-day guard above
    // is PER-PROCESS, so on two replicas the nightly roster pull runs twice —
    // double Clever API calls against a rate-limited district integration and
    // a second write pass over every synced user.
    const status = await leadThisTick(this.lease, LEASE.CLEVER_SYNC);
    if (!status.leader) return;
    this.lastRunYmd = ymd;
    await this.runAll();
  }

  /** Public so admins can invoke via scripts or tests. */
  async runAll(): Promise<void> {
    const ids = await this.clever.listConnectedTenantIds();
    this.logger.log(`Clever nightly sync starting for ${ids.length} tenant(s).`);
    for (const id of ids) {
      try {
        await this.clever.syncTenant(id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Clever sync failed for tenant=${id}: ${msg}`);
      }
    }
  }
}
