import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EfficiencyMetricsService } from './efficiency-metrics.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * EfficiencyAlertingService
 *
 * Runs on a 5-minute internal interval to check egress thresholds and anomalies.
 * Sends email alerts via Resend (same pattern as EmailService) and sets an
 * in-app banner flag so the /super/efficiency page can show a top-of-page alert.
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
    private readonly prisma: PrismaService,
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

      await this.sendAlertEmail(subject, body, 'EFFICIENCY_EGRESS_ALERT');
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

      await this.sendAlertEmail(subject, body, 'EFFICIENCY_ANOMALY_ALERT');
      this.setBanner(`Egress anomaly: ${anomaly.ratio}x baseline this hour (${anomaly.currentHourGb} GB)`);
    }
  }

  /**
   * Who receives platform-ops alerts.
   *
   * 2026-07-16 — egress alerts landed in the operator's WORK inbox because his
   * work-email TEST user carries SUPER_ADMIN, and this used to mail every
   * SUPER_ADMIN row. Platform cost telemetry is owner-ops mail, not
   * role-derived mail: set PLATFORM_ALERT_EMAILS (comma-separated) and alerts
   * go ONLY there. When unset, we fall back to the SUPER_ADMIN sweep so a
   * deploy that predates the env var keeps alerting SOMEONE rather than
   * going silent.
   */
  private async resolveAlertRecipients(): Promise<string[]> {
    const configured = (process.env.PLATFORM_ALERT_EMAILS || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.includes('@'));
    if (configured.length > 0) return [...new Set(configured)];

    try {
      const superAdmins = await this.prisma.client.user.findMany({
        where: { role: 'SUPER_ADMIN' as any },
        select: { email: true },
      });
      return superAdmins.map((a: { email: string }) => a.email);
    } catch (err: any) {
      this.logger.warn(`Failed to fetch SUPER_ADMIN list for alert: ${err?.message}`);
      return [];
    }
  }

  private async sendAlertEmail(subject: string, body: string, kind: string) {
    const recipients = await this.resolveAlertRecipients();
    for (const email of recipients) {
      const admin = { email };
      try {
        let row: any;
        try {
          row = await this.prisma.client.emailLog.create({
            data: {
              toEmail: admin.email,
              subject,
              body,
              kind,
              status: 'QUEUED',
            },
          });
        } catch (persistErr: any) {
          this.logger.error(`Failed to persist alert email log: ${persistErr?.message}`);
          continue;
        }

        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
          this.logger.warn(
            `[efficiency-alert] RESEND_API_KEY not set — alert logged but not sent to ${admin.email}`,
          );
          continue;
        }

        const from = process.env.EMAIL_FROM || 'VenueOS <onboarding@resend.dev>';
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ from, to: [admin.email], subject, text: body }),
        });

        if (resp.ok) {
          await this.prisma.client.emailLog.update({
            where: { id: row.id },
            data: { status: 'SENT', sentAt: new Date() },
          });
          this.logger.log(`Efficiency alert sent to ${admin.email} (${kind})`);
        } else {
          const txt = await resp.text().catch(() => '');
          await this.prisma.client.emailLog.update({
            where: { id: row.id },
            data: { status: 'FAILED', error: `Resend ${resp.status}: ${txt.slice(0, 200)}` },
          });
        }
      } catch (err: any) {
        this.logger.warn(`Failed to send efficiency alert to ${admin.email}: ${err?.message}`);
      }
    }
  }

  private setBanner(message: string) {
    this.bannerActive = true;
    this.bannerMessage = message;
    this.logger.warn(`[efficiency-banner] ${message}`);
  }
}
