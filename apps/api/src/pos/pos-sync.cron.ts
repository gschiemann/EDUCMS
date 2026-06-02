import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PosService } from './pos.service';
import { getConnector } from './providers/registry';

/**
 * POS delta-sync cron. Hourly polls every ACTIVE Square connection
 * (and any other future poll-based provider) for catalog drift.
 * Real-time updates come through the webhook receiver in
 * pos-oauth.controller.ts — this cron is the safety net for tenants
 * whose webhook delivery failed, or for legacy auths that don't push.
 *
 * Same pattern as clever-sync.cron.ts: no @nestjs/schedule dep; a
 * setInterval that fires once per hour on the wall clock and dedupes
 * by hour-bucket so a pod restart doesn't double-fire.
 */
@Injectable()
export class PosSyncCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PosSyncCron.name);
  private timer?: NodeJS.Timeout;
  private lastRunBucket = -1;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly svc: PosService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.POS_CRON_DISABLED === '1') return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref?.();
    this.logger.log('POS sync cron scheduled (hourly delta).');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
    if (bucket === this.lastRunBucket) return;
    this.lastRunBucket = bucket;
    this.running = true;
    try {
      await this.runAll();
    } catch (err: any) {
      this.logger.warn(`POS sync tick failed: ${err?.message ?? err}`);
    } finally {
      this.running = false;
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
