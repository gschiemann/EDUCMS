import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PosService } from './pos.service';
import { getConnector } from './providers/registry';
import { LEASE, LeaderLeaseService, leadThisTick } from '../realtime/leader-lease.service';

/**
 * POS delta-sync cron. Toast checks menu publication metadata every five
 * minutes and downloads its full catalog only after a change. Other active
 * poll-based providers keep their hourly catalog sync.
 * Real-time updates come through the webhook receiver in
 * pos-oauth.controller.ts — this cron is the safety net for tenants
 * whose webhook delivery failed, or for legacy auths that don't push.
 *
 * Same pattern as clever-sync.cron.ts: no @nestjs/schedule dep; a
 * setInterval that checks the wall clock each minute and dedupes by
 * five-minute and hour buckets.
 */
@Injectable()
export class PosSyncCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PosSyncCron.name);
  private timer?: NodeJS.Timeout;
  private lastRunBucket = -1;
  private lastToastBucket = -1;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly svc: PosService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.POS_CRON_DISABLED === '1') return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref?.();
    this.logger.log('POS sync cron scheduled (Toast metadata every 5 min; other providers hourly).');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
    const toastBucket = Math.floor(Date.now() / (5 * 60 * 1000));
    const hourlyDue = bucket !== this.lastRunBucket;
    const toastDue = toastBucket !== this.lastToastBucket;
    if (!hourlyDue && !toastDue) return;
    // Leader-leased (2026-09-02 multi-replica wave): the hour-bucket dedupe
    // above is PER-PROCESS. On two replicas every ACTIVE connection is polled
    // twice an hour against third-party APIs that enforce their own rate
    // limits (Square, Clover, Shopify, Lightspeed) — the fastest way to get a
    // customer's POS integration throttled.
    const status = await leadThisTick(this.lease, LEASE.POS_SYNC);
    if (!status.leader) return;
    if (hourlyDue) this.lastRunBucket = bucket;
    if (toastDue) this.lastToastBucket = toastBucket;
    this.running = true;
    try {
      await this.runDue(hourlyDue, toastDue);
    } catch (err: any) {
      this.logger.warn(`POS sync tick failed: ${err?.message ?? err}`);
    } finally {
      this.running = false;
    }
  }

  private async runDue(hourlyDue: boolean, toastDue: boolean): Promise<void> {
    const all = await (this.prisma.client as any).posProviderConnection.findMany({
      where: { status: 'ACTIVE' },
    });
    const conns = all.filter((c: any) => getConnector(c.providerId));
    for (const conn of conns) {
      try {
        if (conn.providerId === 'toast') {
          if (toastDue) await this.svc.syncToastIfChanged(conn);
        } else if (hourlyDue) {
          await this.svc.syncConnection(conn.tenantId, conn, null);
        }
      } catch (err: any) {
        this.logger.warn(`POS sync failed conn=${conn.id}: ${err?.message ?? err}`);
      }
    }
  }

  /** Public so admins can invoke via scripts. */
  async runAll(): Promise<void> {
    const all = await (this.prisma.client as any).posProviderConnection.findMany({
      where: { status: 'ACTIVE' },
    });
    // Only poll providers with a registered connector (square, clover,
    // shopify, lightspeed). custom-webhook connections push their own
    // catalog and have no poll handler — skip them.
    const conns = all.filter((c: any) => getConnector(c.providerId));
    if (conns.length === 0) return;
    this.logger.log(`POS hourly delta starting for ${conns.length} connection(s).`);
    for (const conn of conns) {
      try {
        await this.svc.syncConnection(conn.tenantId, conn, null);
      } catch (err: any) {
        this.logger.warn(`POS sync failed conn=${conn.id}: ${err?.message ?? err}`);
      }
    }
  }
}
