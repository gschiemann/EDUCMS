import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

/**
 * HIGH-9 audit fix: NotificationsService.scanOfflineScreens existed with
 * test coverage but was never invoked, so offline-screen alerts never
 * fired. This wires a process-internal 60-second interval that runs the
 * scan; keeps the dep surface flat (no @nestjs/schedule install).
 *
 * 2026-09-02 (efficiency audit P0-4): the scan itself is now
 * TRANSITION-based — it notifies only screens that crossed healthy →
 * offline since the previous tick, so a steady fleet costs one indexed
 * SELECT per tick and zero writes. The 60 s cadence is unchanged: it sets
 * detection latency, and detection latency is now the ONLY thing it costs.
 * See the comment block above `scanOfflineScreens`.
 *
 * Configurable via env:
 *   OFFLINE_SCAN_INTERVAL_MS      default 60000  (60s)
 *   OFFLINE_SCAN_THRESHOLD_MIN    default 5      (screens silent >5 min)
 *   OFFLINE_SCAN_MAX_CANDIDATES   default 5000   (bound on the candidate read)
 *   OFFLINE_SCAN_DISABLED         set to "1" to skip (test env, manual ops)
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
      // Log only when something actually happened. A steady fleet with 197
      // long-offline screens used to log every single minute; now silence
      // means "nothing changed", which is the useful signal.
      if (result.seeded) {
        this.logger.log(
          `Offline scan seeded baseline from ${result.found} already-offline ` +
          `screen(s) — no notifications fired (cold start)`,
        );
      } else if (result.crossings > 0 || result.recovered > 0 || result.infraEvents > 0) {
        this.logger.log(
          `Offline scan: found=${result.found} crossings=${result.crossings} ` +
          `recovered=${result.recovered} notified=${result.notified} ` +
          `infraEvents=${result.infraEvents}`,
        );
      }
    } catch (e: any) {
      this.logger.warn(`Offline scan failed: ${e?.message ?? e}`);
    } finally {
      this.running = false;
    }
  }
}
