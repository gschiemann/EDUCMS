/**
 * Storage upload watchdog (2026-07-31 incident follow-through).
 *
 * Operator requirement, verbatim: "we need to know when this shit breaks …
 * we can't have uploading of assets ever fail." The transport fallback in
 * storage-transport.ts keeps customer uploads WORKING when undici→Supabase
 * dies; THIS service makes that degradation loud instead of silent — the
 * 07-23→07-31 week of invisible upload failures is the exact rot this
 * exists to kill.
 *
 * Every 5 minutes it runs the same tiny real-upload probe as
 * GET /api/v1/health/storage and classifies:
 *   ok        — primary fetch transport healthy
 *   degraded  — uploads work but ONLY via the node:https fallback
 *               (primary transport broken → investigate before it worsens)
 *   down      — uploads failing entirely (customer impact NOW)
 *
 * On any transition into degraded/down: email PLATFORM_ALERT_EMAILS (same
 * routing contract as EfficiencyAlertingService — owner-ops mail, NOT the
 * SUPER_ADMIN sweep unless the env var is unset) + Sentry capture. While
 * unhealthy it re-alerts at most every 6h; on recovery it sends the
 * all-clear so nobody keeps debugging a fixed problem.
 *
 * Kill switch: STORAGE_WATCHDOG_DISABLED=1. Off in NODE_ENV=test.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PlatformAlertMailer } from '../email/platform-alert-mailer.service';
import { SupabaseStorageService } from './supabase-storage.service';
import { storageTransportState } from './storage-transport';

type WatchdogStatus = 'ok' | 'degraded' | 'down';

const TICK_MS = 5 * 60_000;
const FIRST_TICK_DELAY_MS = 60_000; // let boot (bucket ensure, pool warm) settle
const REALERT_MS = 6 * 3600_000;

@Injectable()
export class StorageWatchdogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageWatchdogService.name);
  private timer: NodeJS.Timeout | null = null;
  private firstTimer: NodeJS.Timeout | null = null;
  private lastStatus: WatchdogStatus = 'ok';
  private lastAlertAt = 0;
  private ticking = false;

  constructor(
    private readonly storage: SupabaseStorageService,
    private readonly mailer: PlatformAlertMailer,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.STORAGE_WATCHDOG_DISABLED === '1') return;
    this.firstTimer = setTimeout(() => void this.tick(), FIRST_TICK_DELAY_MS);
    this.firstTimer.unref?.();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    this.logger.log(`Storage watchdog armed (probe every ${TICK_MS / 60000} min)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.firstTimer) clearTimeout(this.firstTimer);
  }

  private async tick(): Promise<void> {
    if (this.ticking) return; // never overlap probes
    this.ticking = true;
    try {
      const probe = await this.storage.storageHealthProbe();
      const status: WatchdogStatus = !probe.ok ? 'down' : probe.transport === 'fallback' ? 'degraded' : 'ok';
      const now = Date.now();

      const enteredUnhealthy = status !== 'ok' && this.lastStatus === 'ok';
      const stillUnhealthy = status !== 'ok' && this.lastStatus !== 'ok' && now - this.lastAlertAt > REALERT_MS;
      const recovered = status === 'ok' && this.lastStatus !== 'ok';

      if (enteredUnhealthy || stillUnhealthy) {
        this.lastAlertAt = now;
        const cause = storageTransportState.lastFallbackCause || 'unknown (see Railway logs for cause chain)';
        const subject =
          status === 'down'
            ? '[VenueOS] STORAGE UPLOADS FAILING — customer impact'
            : '[VenueOS] Storage uploads DEGRADED — riding node:https fallback';
        const body = [
          status === 'down'
            ? 'File uploads (assets, branding logos, emergency content, bug screenshots) are FAILING in production.'
            : 'File uploads still WORK, but only via the node:https fallback — the primary fetch transport to Supabase Storage is broken. Customers are unaffected right now; investigate before the fallback is all that stands.',
          '',
          `Probe: upload=${probe.upload} read=${probe.read} transport=${probe.transport} (${probe.ms}ms)`,
          `Primary failures since boot: ${storageTransportState.totalPrimaryFailures}`,
          `Fallback successes/failures: ${storageTransportState.totalFallbackSuccesses}/${storageTransportState.totalFallbackFailures}`,
          `Last primary failure: ${storageTransportState.lastPrimaryFailureAt ?? 'n/a'}`,
          `Underlying cause: ${cause}`,
          '',
          'Live check: GET /api/v1/health/storage',
          'History: Railway → api → Deploy Logs, search "storage fetch" / "https-fallback".',
          '',
          '— VenueOS Storage Watchdog',
        ].join('\n');
        await this.mailer.sendAlert(subject, body, 'STORAGE_TRANSPORT_ALERT');
        try {
          Sentry.captureMessage(`${subject} — ${cause}`, 'error');
        } catch {
          /* sentry optional */
        }
        this.logger.warn(`[storage-watchdog] ${status.toUpperCase()} — alert dispatched (${probe.upload} / ${probe.read})`);
      } else if (recovered) {
        await this.mailer.sendAlert(
          '[VenueOS] Storage uploads recovered — primary transport healthy',
          `Storage probe is back on the primary transport (${probe.ms}ms round-trip). No action needed.\n\n— VenueOS Storage Watchdog`,
          'STORAGE_TRANSPORT_RECOVERED',
        );
        this.logger.log('[storage-watchdog] recovered — primary transport healthy again');
      }

      this.lastStatus = status;
    } catch (e: any) {
      this.logger.warn(`[storage-watchdog] tick failed: ${e?.message ?? e}`);
    } finally {
      this.ticking = false;
    }
  }
}
