import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { LEASE, LeaderLeaseService, leadThisTick } from '../realtime/leader-lease.service';
import { cardBillingReady, dueTrialNotice, ENDED_NOTICE_MAX_AGE_MS, TRIAL_NOTICE } from './trial-policy';
import { trialEmail } from './trial-emails';
import { DUNNING_NOTICE, dueDunningNotice } from './dunning-policy';
import { dunningEmail } from './dunning-emails';

/** Placeholder starter-account emails (customer console) — never mailed. */
const PLACEHOLDER_EMAIL_SUFFIX = '.invalid';
const MAX_RECIPIENTS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * TrialReminderCron (2026-10-11) — the trial reminder emails: 7 days left,
 * 1 day left, and "your trial ended" (trial-emails.ts, en / es / zh).
 *
 * Follows the repo's background-job rules (license-reconcile.cron.ts is the
 * model): a plain unref'd setInterval (no @nestjs/schedule), off under
 * NODE_ENV=test and with TRIAL_REMINDERS_DISABLED=1, LEADER-LEASED so one
 * replica scans, and a no-op unless card billing is live (a reminder to "add
 * a payment method" on a deploy where nobody can pay would be a lie).
 *
 * AT MOST ONCE, EVEN WITHOUT THE LEASE: before sending, the stage is CLAIMED
 * with a conditional update (`trialNoticeStage < stage` → stage). Only the
 * claimer sends. A send that then fails is not retried — its email_logs
 * FAILED row is the record — because a reminder sent twice is worse than one
 * that a broken mail setup never delivered, and the dashboard banner says the
 * same thing every time they sign in.
 *
 * Recipients: the organisation's active admins (DISTRICT_ADMIN, SCHOOL_ADMIN)
 * on the licensed tenant, up to five, never a placeholder address.
 *
 * 2026-10-11 — the same tick also sends the CARD-FAILURE emails (runDunning,
 * dunning-policy.ts): card declined · reminder before view-only · now
 * view-only, each at most once per failing invoice. Those need only
 * STRIPE_SECRET_KEY (a card subscription exists), not the trial prices.
 */
@Injectable()
export class TrialReminderCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrialReminderCron.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.TRIAL_REMINDERS_DISABLED === '1') return;
    const wakeMs = Number(process.env.TRIAL_REMINDERS_INTERVAL_MS) || 60 * 60 * 1000;
    this.timer = setInterval(() => void this.tick(), wakeMs);
    this.timer.unref?.();
    this.logger.log('Trial reminder emails scheduled (hourly, leader-leased).');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running || !process.env.STRIPE_SECRET_KEY) return;
    const status = await leadThisTick(this.lease, LEASE.TRIAL_REMINDERS);
    if (!status.leader) return;
    this.running = true;
    try {
      await this.runAll();
    } catch (err: any) {
      this.logger.warn(`trial reminder tick failed: ${err?.message ?? err}`);
    }
    try {
      await this.runDunning();
    } catch (err: any) {
      this.logger.warn(`card-failure notice tick failed: ${err?.message ?? err}`);
    } finally {
      this.running = false;
    }
  }

  /** Active admins of the licensed tenant, never a placeholder address, at most five. */
  private async adminRecipients(tenantId: string): Promise<string[]> {
    const recipients = await this.prisma.client.user.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        role: { in: ['DISTRICT_ADMIN', 'SCHOOL_ADMIN'] as any },
      },
      select: { email: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_RECIPIENTS * 2,
    });
    return recipients
      .map((r) => r.email)
      .filter((e): e is string => !!e && !e.endsWith(PLACEHOLDER_EMAIL_SUFFIX))
      .slice(0, MAX_RECIPIENTS);
  }

  /**
   * CARD FAILURE → VIEW-ONLY, WITH HELP (2026-10-11, dunning-policy.ts) — one
   * pass of the three card-failure emails: declined · reminder before view-only
   * · now view-only. Same rules as the trial reminders: leader-leased (the
   * same tick), each stage CLAIMED with a conditional update before sending,
   * so it goes out at most once — and, because a new failing invoice resets
   * the stage (the webhook), at most once PER INVOICE. Public so a test can
   * drive it with a fixed clock.
   */
  async runDunning(now = new Date()): Promise<{ scanned: number; sent: number; skipped: number }> {
    if (!process.env.STRIPE_SECRET_KEY) return { scanned: 0, sent: 0, skipped: 0 };
    const candidates = await this.prisma.client.license.findMany({
      where: {
        billingMode: 'CARD',
        status: { in: ['PAST_DUE', 'CANCELLED'] },
        stripeSubscriptionId: { not: null },
        dunningInvoiceId: { not: null },
        dunningNoticeStage: { lt: DUNNING_NOTICE.VIEW_ONLY },
      },
      select: {
        id: true,
        tenantId: true,
        status: true,
        billingMode: true,
        stripeSubscriptionId: true,
        dunningInvoiceId: true,
        dunningNoticeStage: true,
        dunningFailedAt: true,
        dunningNextAttemptAt: true,
        noticeLocale: true,
        tenant: { select: { name: true, slug: true } },
      },
      take: 500,
    });
    let sent = 0;
    let skipped = 0;
    for (const lic of candidates) {
      const stage = dueDunningNotice(lic as any, now);
      if (!stage) {
        skipped++;
        continue;
      }
      // Claim first — keyed on the SAME invoice, so a failure on a newer
      // invoice that landed mid-pass is never marked as already told.
      const claim = await this.prisma.client.license.updateMany({
        where: {
          id: lic.id,
          tenantId: lic.tenantId,
          dunningInvoiceId: lic.dunningInvoiceId,
          dunningNoticeStage: { lt: stage },
        },
        data: { dunningNoticeStage: stage },
      });
      if (claim.count !== 1) {
        skipped++;
        continue;
      }
      const to = await this.adminRecipients(lic.tenantId);
      const appUrl = process.env.APP_PUBLIC_URL || 'http://localhost:3000';
      const mail = dunningEmail({
        stage,
        locale: lic.noticeLocale,
        orgName: lic.tenant?.name || 'your organization',
        nextAttemptAt: lic.dunningNextAttemptAt ?? null,
        billingUrl: `${appUrl}/${lic.tenant?.slug ?? lic.tenantId}/settings/billing`,
      });
      for (const addr of to) {
        try {
          await this.email.sendBillingNotice({ to: addr, ...mail });
        } catch (e: any) {
          this.logger.warn(`card-failure notice ${mail.kind} to tenant ${lic.tenantId} could not be logged: ${e?.message ?? e}`);
        }
      }
      try {
        await this.prisma.client.auditLog.create({
          data: {
            tenantId: lic.tenantId,
            userId: null,
            action: 'BILLING_CARD_NOTICE_SENT',
            targetType: 'License',
            targetId: lic.id,
            details: JSON.stringify({ kind: mail.kind, stage, recipients: to.length, invoiceId: lic.dunningInvoiceId }),
          },
        });
      } catch {
        /* forensics only — never undo a sent notice */
      }
      sent++;
    }
    if (sent > 0) this.logger.log(`[card-failure-notices] sent ${sent} notice(s), ${skipped} skipped, ${candidates.length} scanned`);
    return { scanned: candidates.length, sent, skipped };
  }

  /** One pass. Public so a test (or an operator script) can drive it with a fixed clock. */
  async runAll(now = new Date()): Promise<{ scanned: number; sent: number; skipped: number }> {
    if (!cardBillingReady()) return { scanned: 0, sent: 0, skipped: 0 };
    const candidates = await this.prisma.client.license.findMany({
      where: {
        tier: 'FREE_TRIAL',
        billingMode: 'CARD',
        status: 'ACTIVE',
        stripeSubscriptionId: null,
        trialEndsAt: { not: null, lte: new Date(now.getTime() + 7 * DAY_MS) },
        trialNoticeStage: { lt: TRIAL_NOTICE.ENDED },
      },
      select: {
        id: true,
        tenantId: true,
        tier: true,
        status: true,
        billingMode: true,
        stripeSubscriptionId: true,
        trialEndsAt: true,
        trialNoticeStage: true,
        noticeLocale: true,
        tenant: { select: { name: true, slug: true } },
      },
      take: 500,
    });
    let sent = 0;
    let skipped = 0;
    for (const lic of candidates) {
      const stage = dueTrialNotice(lic as any, now);
      if (!stage || !lic.trialEndsAt) {
        skipped++;
        continue;
      }
      // Claim first — at most one replica / one pass ever sends this stage.
      const claim = await this.prisma.client.license.updateMany({
        where: { id: lic.id, tenantId: lic.tenantId, trialNoticeStage: { lt: stage } },
        data: { trialNoticeStage: stage },
      });
      if (claim.count !== 1) {
        skipped++;
        continue;
      }
      // An "ended" notice for a trial that ended days ago (e.g. the first pass
      // after a deploy) is claimed but not sent — it would read as news it isn't.
      if (stage === TRIAL_NOTICE.ENDED && now.getTime() - lic.trialEndsAt.getTime() > ENDED_NOTICE_MAX_AGE_MS) {
        skipped++;
        continue;
      }
      const to = await this.adminRecipients(lic.tenantId);
      const appUrl = process.env.APP_PUBLIC_URL || 'http://localhost:3000';
      const mail = trialEmail({
        stage,
        locale: lic.noticeLocale,
        orgName: lic.tenant?.name || 'your organization',
        trialEndsAt: lic.trialEndsAt,
        billingUrl: `${appUrl}/${lic.tenant?.slug ?? lic.tenantId}/settings/billing`,
      });
      for (const addr of to) {
        try {
          await this.email.sendBillingNotice({ to: addr, ...mail });
        } catch (e: any) {
          this.logger.warn(`trial notice ${mail.kind} to tenant ${lic.tenantId} could not be logged: ${e?.message ?? e}`);
        }
      }
      try {
        await this.prisma.client.auditLog.create({
          data: {
            tenantId: lic.tenantId,
            userId: null,
            action: 'BILLING_TRIAL_NOTICE_SENT',
            targetType: 'License',
            targetId: lic.id,
            details: JSON.stringify({ kind: mail.kind, stage, recipients: to.length, trialEndsAt: lic.trialEndsAt.toISOString() }),
          },
        });
      } catch {
        /* forensics only — never undo a sent notice */
      }
      sent++;
    }
    if (sent > 0) this.logger.log(`[trial-reminders] sent ${sent} notice(s), ${skipped} skipped, ${candidates.length} scanned`);
    return { scanned: candidates.length, sent, skipped };
  }
}
