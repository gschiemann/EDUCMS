import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

/**
 * HIGH-9 audit fix: NotificationsService.scanOfflineScreens existed with
 * test coverage but was never invoked, so offline-screen alerts never
 * fired. This wires a process-internal 60-second interval that runs the
 * scan; keeps the dep surface flat (no @nestjs/schedule install). Each
 * call is dedupe-keyed inside scanOfflineScreens so repeated runs don't
 * flood notifications for an already-flagged screen.
 *
 * Configurable via env:
 *   OFFLINE_SCAN_INTERVAL_MS   default 60000   (60s)
 *   OFFLINE_SCAN_THRESHOLD_MIN default 5       (screens silent >5 min)
 *   OFFLINE_SCAN_DISABLED      set to "1" to skip (test env, manual ops)
 */
@Injectable()
export class OfflineScreenScanner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OfflineScreenScanner.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly notifications: NotificationsService) {}

  onModuleInit() {
    if (process.env.OFFLINE_SCAN_DISABLED === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('OfflineScreenScanner disabled (env or test mode)');
      return;
    }
    const intervalMs = Number(process.env.OFFLINE_SCAN_INTERVAL_MS) || 60_000;
    const thresholdMin = Number(process.env.OFFLINE_SCAN_THRESHOLD_MIN) || 5;
    this.logger.log(`OfflineScreenScanner starting (interval=${intervalMs}ms, threshold=${thresholdMin}min)`);
    this.timer = setInterval(() => void this.tick(thresholdMin), intervalMs);
    // Don't keep the Node event loop alive on shutdown.
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(thresholdMin: number) {
    if (this.running) return; // overlap guard
    this.running = true;
    try {
      const result = await this.notifications.scanOfflineScreens(thresholdMin);
      if (result.found > 0) {
        this.logger.log(`Offline scan: found=${result.found} notified=${result.notified}`);
      }
    } catch (e: any) {
      this.logger.warn(`Offline scan failed: ${e?.message ?? e}`);
    } finally {
      this.running = false;
    }
  }
}
