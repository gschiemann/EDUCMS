import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EfficiencyMetricsService } from './efficiency-metrics.service';
import { PlatformAlertMailer } from '../email/platform-alert-mailer.service';

/**
 * EfficiencyAlertingService
 *
 * Runs on a 5-minute internal interval to check egress thresholds and anomalies.
 * Sends email alerts via PlatformAlertMailer (PLATFORM_ALERT_EMAILS routing)
 * and sets an in-app banner flag so the /super/efficiency page can show a
 * top-of-page alert.
 *
 * Pattern: uses setInterval (not @nestjs/schedule) to keep the dep surface flat,
 * consistent with how CanaryAutoPromoteService, PosSync, and WebhookRetryWorker
 * are implemented in this repo.
 *
 * De-dupe: one alert per threshold per hour (enforced by EfficiencyMetricsService).
 * Anomaly: >3x trailing-7-day hourly baseline triggers a separate alert.
 */
@Injectable()
export class EfficiencyAlertingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EfficiencyAlertingService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  // In-app banner: set to true when an alert fires; cleared when the
  // operator loads the /super/efficiency page.
  public bannerActive = false;
  public bannerMessage = '';

  constructor(
    private readonly metrics: EfficiencyMetricsService,
    private readonly mailer: PlatformAlertMailer,
  ) {}

  onModuleInit() {
    // First check 1 minute after boot (avoids firing on zero data at startup).
    // Subsequent checks every 5 minutes.
    this.timer = setInterval(() => {
      if (this.running) return; // overlap guard
      this.running = true;
      this.runChecks()
        .catch((err) => this.logger.warn(`Efficiency alert check failed: ${err?.message}`))
        .finally(() => { this.running = false; });
    }, 5 * 60 * 1000);

    this.logger.log('Efficiency alerting active — checking every 5 minutes');
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runChecks() {
    const budgetGb = parseFloat(process.env.EGRESS_BUDGET_GB || '250');

    const alert = this.metrics.shouldAlert();
    if (alert) {
      const subject = `[VenueOS] Egress ${alert.label}: ${alert.egressGb} GB / ${budgetGb} GB used (${alert.threshold}% threshold)`;
      const body = [
        `Egress alert for VenueOS platform.`,
        ``,
        `Threshold crossed: ${alert.threshold}% of ${budgetGb} GB budget`,
        `Current usage:    ${alert.egressGb} GB`,
        `Severity:         ${alert.label}`,
        ``,
        `Actions:`,
        `  1. Open /super/efficiency for a breakdown by route`,
        `  2. Check Supabase dashboard for asset egress details`,
        `  3. Run POST /super/storage/backfill-cache-control to force immutable headers`,
        `     on any objects missing Cache-Control (this was the root cause of the`,
        `     98 MB stored → 5.79 GB egress incident on 2026-05-23)`,
        ``,
        `— VenueOS Efficiency Monitor`,
      ].join('\n');

      await this.mailer.sendAlert(subject, body, 'EFFICIENCY_EGRESS_ALERT');
      this.setBanner(`Egress ${alert.label}: ${alert.egressGb} GB used (${alert.threshold}% of ${budgetGb} GB budget)`);
    }

    const anomaly = this.metrics.shouldAlertAnomaly();
    if (anomaly) {
      const subject = `[VenueOS] Egress anomaly: ${anomaly.ratio}x baseline this hour`;
      const body = [
        `Egress anomaly detected — this hour's egress is ${anomaly.ratio}x the trailing baseline.`,
        ``,
        `This hour:     ${anomaly.currentHourGb} GB`,
        `Anomaly ratio: ${anomaly.ratio}x`,
        ``,
        `This is often caused by:`,
        `  - A new large asset (video / PDF) being fetched by many screens simultaneously`,
        `  - A cache miss storm after a Cache-Control header regression`,
        `  - A player polling loop fetching assets more frequently than expected`,
        ``,
        `Open /super/efficiency → Top Routes by Bytes to find the offending path.`,
        ``,
        `— VenueOS Efficiency Monitor`,
      ].join('\n');

      await this.mailer.sendAlert(subject, body, 'EFFICIENCY_ANOMALY_ALERT');
      this.setBanner(`Egress anomaly: ${anomaly.ratio}x baseline this hour (${anomaly.currentHourGb} GB)`);
    }
  }

  private setBanner(message: string) {
    this.bannerActive = true;
    this.bannerMessage = message;
    this.logger.warn(`[efficiency-banner] ${message}`);
  }
}
