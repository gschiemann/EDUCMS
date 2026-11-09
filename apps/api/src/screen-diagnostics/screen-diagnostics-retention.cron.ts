/**
 * Screen diagnostics retention (2026-11-08) — the retention limit of
 * "Get recent logs".
 *
 * Hourly, on the leader only:
 *   1. log bundles older than SCREEN_DIAGNOSTICS_LOG_RETENTION_DAYS (default
 *      7) are deleted from the private bucket and the row is stamped
 *      `logPurgedAt` (one audit row per purged bundle — the deletion of a
 *      device's records is itself a record);
 *   2. request rows older than 90 days are deleted (they carry no log text).
 *
 * Bounded: at most 200 bundles and 1,000 rows per tick.
 * Kill switch: SCREEN_DIAGNOSTICS_RETENTION_DISABLED=1 — nothing is deleted
 * (bundles are then KEPT past the window: fails open for availability of the
 * record, closed for nothing). Also off under NODE_ENV=test.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LEASE, LeaderLeaseService, leadThisTick } from '../realtime/leader-lease.service';
import { SupabaseStorageService, DEVICE_LOGS_BUCKET } from '../storage/supabase-storage.service';
import { DIAGNOSTICS_AUDIT, REQUEST_ROW_RETENTION_DAYS, logRetentionDays } from './diagnostics-policy';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

export function retentionDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'yes'].includes(String(env.SCREEN_DIAGNOSTICS_RETENTION_DISABLED ?? '').trim().toLowerCase());
}

@Injectable()
export class ScreenDiagnosticsRetentionCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScreenDiagnosticsRetentionCron.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    if (retentionDisabled()) {
      this.logger.warn('Screen diagnostics retention disabled (SCREEN_DIAGNOSTICS_RETENTION_DISABLED=1)');
      return;
    }
    this.timer = setInterval(() => {
      void this.sweep().catch((e) => this.logger.warn(`sweep failed: ${(e as Error).message}`));
    }, HOUR);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(now: Date = new Date()): Promise<{ purged: number; deleted: number }> {
    const status = await leadThisTick(this.lease, LEASE.SCREEN_DIAGNOSTICS_RETENTION);
    if (!status.leader) return { purged: 0, deleted: 0 };
    const db = this.prisma.client;
    const cutoff = new Date(now.getTime() - logRetentionDays() * DAY);
    // ten-ok: (c) platform sweep — retention applies to every tenant's rows alike; each write below is keyed by the row's own id + tenant.
    const due = await db.screenDiagnosticsRequest.findMany({
      where: { logObjectKey: { not: null }, logPurgedAt: null, createdAt: { lt: cutoff } },
      select: { id: true, tenantId: true, screenId: true, logObjectKey: true },
      take: 200,
    });
    let purged = 0;
    if (due.length) {
      const removed = await this.storage.deleteManyFromBucket(DEVICE_LOGS_BUCKET, due.map((r) => r.logObjectKey as string));
      this.logger.log(`purging ${due.length} device-log bundle(s) past ${logRetentionDays()} days (storage removed ${removed})`);
      for (const r of due) {
        await db.screenDiagnosticsRequest.updateMany({ where: { id: r.id, tenantId: r.tenantId }, data: { logPurgedAt: now } });
        await db.auditLog.create({
          data: {
            tenantId: r.tenantId, userId: null, action: DIAGNOSTICS_AUDIT.LOGS_PURGED, targetType: 'Screen', targetId: r.screenId,
            details: JSON.stringify({ requestId: r.id, retentionDays: logRetentionDays() }),
          },
        }).catch((e: Error) => this.logger.error(`purge audit for ${r.id} FAILED: ${e.message}`));
        purged += 1;
      }
    }
    const rowCutoff = new Date(now.getTime() - REQUEST_ROW_RETENTION_DAYS * DAY);
    // A row may go only once its bundle is gone (purged or never uploaded).
    // ten-ok: (c) platform sweep — see above.
    const old = await db.screenDiagnosticsRequest.findMany({
      where: { createdAt: { lt: rowCutoff }, OR: [{ logObjectKey: null }, { logPurgedAt: { not: null } }] },
      select: { id: true },
      take: 1000,
    });
    let deleted = 0;
    if (old.length) {
      // ten-ok: (c) platform sweep — deleting by primary keys selected above.
      const r = await db.screenDiagnosticsRequest.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
      deleted = r.count;
    }
    return { purged, deleted };
  }
}
