/**
 * PlatformAlertMailer — the ONE mailer for platform-ops alert email.
 *
 * Extracted 2026-08-05. StorageWatchdogService and EfficiencyAlertingService
 * each carried a hand-copied recipient-resolution + Resend-POST block with a
 * comment saying "extract a shared mailer if a third copy ever appears." The
 * third caller (PlatformHealthMonitorService) appeared; this is the extraction.
 *
 * Recipient contract (unchanged from both originals, 2026-07-16 incident):
 *   PLATFORM_ALERT_EMAILS (comma-separated) → alerts go ONLY there.
 *   Unset → fall back to the SUPER_ADMIN sweep so a deploy that predates the
 *   env var keeps alerting SOMEONE rather than going silent.
 *
 * Two behaviors are deliberately DIFFERENT from the originals, both because
 * this mailer now carries the "the database is down" alert — the one alert
 * whose delivery must not depend on the database being up:
 *
 *   1. Recipient cache. Every successful resolution is cached in memory; if
 *      PLATFORM_ALERT_EMAILS is unset and the SUPER_ADMIN query fails (DB
 *      down), the last known-good list is used instead of returning [].
 *   2. Persist-then-send, not persist-or-bail. The originals `continue`d to
 *      the next recipient when the emailLog row could not be written — which
 *      means a DB outage would have silently eaten its own alert. Now a
 *      failed persist is logged and the Resend POST still goes out.
 *
 * Honesty gate: FROM + post-2xx status come from ../email/sender-identity —
 * a Resend 2xx on the shared onboarding@resend.dev sender is recorded as
 * SENT_UNVERIFIED, never a confident SENT.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resendAcceptedStatus, resolveEmailFrom, sharedSenderWarning } from './sender-identity';

@Injectable()
export class PlatformAlertMailer {
  private readonly logger = new Logger(PlatformAlertMailer.name);

  /** Last successfully-resolved recipient list — survives a DB outage. */
  private lastGoodRecipients: string[] = [];

  constructor(private readonly prisma: PrismaService) {}

  async resolveAlertRecipients(): Promise<string[]> {
    const configured = (process.env.PLATFORM_ALERT_EMAILS || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.includes('@'));
    if (configured.length > 0) {
      this.lastGoodRecipients = [...new Set(configured)];
      return this.lastGoodRecipients;
    }

    try {
      const superAdmins = await this.prisma.client.user.findMany({
        where: { role: 'SUPER_ADMIN' as any },
        select: { email: true },
      });
      const emails = superAdmins.map((a: { email: string }) => a.email);
      if (emails.length > 0) this.lastGoodRecipients = emails;
      return emails;
    } catch (err: any) {
      this.logger.warn(
        `Failed to fetch SUPER_ADMIN list for alert (${err?.message}) — ` +
          (this.lastGoodRecipients.length > 0
            ? `using ${this.lastGoodRecipients.length} cached recipient(s)`
            : 'no cached recipients; alert will be dropped. Set PLATFORM_ALERT_EMAILS.'),
      );
      return this.lastGoodRecipients;
    }
  }

  /**
   * Send one platform alert to every resolved recipient. Never throws —
   * callers are background watchdogs whose tick must survive any mail
   * failure. `kind` lands in email_logs.kind for forensics.
   */
  async sendAlert(subject: string, body: string, kind: string): Promise<void> {
    const recipients = await this.resolveAlertRecipients();
    for (const email of recipients) {
      try {
        // Best-effort persistence: a DB outage must not eat the alert
        // that reports the DB outage.
        let row: { id: string } | null = null;
        try {
          row = await this.prisma.client.emailLog.create({
            data: { toEmail: email, subject, body, kind, status: 'QUEUED' },
          });
        } catch (persistErr: any) {
          this.logger.error(
            `[platform-alert] failed to persist email log (${persistErr?.message}) — sending anyway`,
          );
        }

        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
          this.logger.warn(`[platform-alert] RESEND_API_KEY not set — alert logged but not sent to ${email}`);
          continue;
        }

        const from = resolveEmailFrom();
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [email], subject, text: body }),
        });

        if (resp.ok) {
          // HONESTY GATE — a Resend 2xx proves ACCEPTED, not DELIVERED.
          // See sender-identity.ts for the full 2026-08-03 rationale.
          const status = resendAcceptedStatus();
          if (row) {
            await this.prisma.client.emailLog
              .update({ where: { id: row.id }, data: { status, sentAt: new Date() } })
              .catch(() => undefined);
          }
          if (status === 'SENT_UNVERIFIED') {
            this.logger.warn(sharedSenderWarning({ kind, to: email, from }));
          } else {
            this.logger.log(`[platform-alert] sent to ${email} (${kind})`);
          }
        } else {
          const txt = await resp.text().catch(() => '');
          if (row) {
            await this.prisma.client.emailLog
              .update({
                where: { id: row.id },
                data: { status: 'FAILED', error: `Resend ${resp.status}: ${txt.slice(0, 200)}` },
              })
              .catch(() => undefined);
          }
          this.logger.warn(`[platform-alert] Resend ${resp.status} sending "${kind}" to ${email}`);
        }
      } catch (err: any) {
        this.logger.warn(`[platform-alert] failed to send "${kind}" to ${email}: ${err?.message}`);
      }
    }
  }
}
