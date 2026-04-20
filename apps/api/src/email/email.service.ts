import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * EmailService — stub queue.
 *
 * For now every outbound message is persisted to the `email_logs` table with
 * status = "QUEUED" so we can ship onboarding + password reset + invite flows
 * without a paid email provider. In production we'll swap this for SendGrid,
 * Resend, or AWS SES by implementing `#dispatch()` to call the provider SDK
 * and flipping status -> "SENT" (or "FAILED" with the error).
 *
 * === Production swap point ===
 * Replace the body of `#dispatch()` below. Keep the `email_logs` row as the
 * durable record. Everything that writes an email already goes through the
 * three public helpers (`sendWelcome`, `sendPasswordReset`, `sendUserInvite`),
 * so no call-sites need to change.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  private get appUrl(): string {
    return process.env.APP_PUBLIC_URL || 'http://localhost:3000';
  }

  constructor(private readonly prisma: PrismaService) {}

  async sendWelcome(params: { to: string; districtName: string; tenantSlug: string }): Promise<void> {
    const subject = `Welcome to EduSignage, ${params.districtName}`;
    const loginUrl = `${this.appUrl}/login`;
    const body = [
      `Your EduSignage workspace for ${params.districtName} is ready.`,
      ``,
      `Sign in to get started: ${loginUrl}`,
      ``,
      `Tenant slug: ${params.tenantSlug}`,
      ``,
      `— The EduSignage team`,
    ].join('\n');

    await this.#enqueue({ to: params.to, subject, body, kind: 'WELCOME' });
  }

  async sendPasswordReset(params: { to: string; resetToken: string }): Promise<void> {
    const subject = 'Reset your EduSignage password';
    const resetUrl = `${this.appUrl}/reset-password/${encodeURIComponent(params.resetToken)}`;
    const body = [
      `We received a request to reset your password.`,
      ``,
      `Click the link below within one hour to choose a new password:`,
      resetUrl,
      ``,
      `If you didn't request this, you can safely ignore this email.`,
      ``,
      `— The EduSignage team`,
    ].join('\n');

    await this.#enqueue({ to: params.to, subject, body, kind: 'PASSWORD_RESET' });
  }

  async sendUserInvite(params: {
    to: string;
    inviterEmail: string;
    tenantName: string;
    role: string;
    inviteToken: string;
  }): Promise<void> {
    const subject = `${params.inviterEmail} invited you to ${params.tenantName} on EduSignage`;
    const acceptUrl = `${this.appUrl}/accept-invite/${encodeURIComponent(params.inviteToken)}`;
    const body = [
      `${params.inviterEmail} invited you to join ${params.tenantName} on EduSignage as ${params.role}.`,
      ``,
      `Accept your invitation and choose a password:`,
      acceptUrl,
      ``,
      `This invitation expires in 7 days.`,
      ``,
      `— The EduSignage team`,
    ].join('\n');

    await this.#enqueue({ to: params.to, subject, body, kind: 'INVITE' });
  }

  async #enqueue(params: { to: string; subject: string; body: string; kind: string }): Promise<void> {
    // MED-7 audit fix: previously a failed EmailLog.create would either
    // 500 the calling request silently or be lost in the noise. Wrap each
    // step with explicit logging at appropriate severity so production
    // observability (Sentry / log shipper) sees the full picture:
    //   - persist failure → ERROR (we lost the durable record entirely)
    //   - dispatch failure → WARN with structured fields (will show in
    //     the email_logs FAILED row anyway, but log gives an alertable
    //     signal)
    let row;
    try {
      row = await this.prisma.client.emailLog.create({
        data: {
          toEmail: params.to,
          subject: params.subject,
          body: params.body,
          kind: params.kind,
          status: 'QUEUED',
        },
      });
    } catch (err: any) {
      this.logger.error(
        `EmailLog persist FAILED — durable record lost. kind=${params.kind} to=${params.to} err=${err?.message ?? err}`,
      );
      // Re-throw so the calling flow (onboarding signup / invite) can
      // surface the failure to the operator instead of silently
      // pretending the email was queued.
      throw err;
    }

    try {
      await this.#dispatch(params);
      await this.prisma.client.emailLog.update({
        where: { id: row.id },
        data: { status: 'SENT', sentAt: new Date() },
      });
    } catch (err: any) {
      this.logger.warn(
        `Email dispatch FAILED — log row persisted, marking FAILED. ` +
        `kind=${params.kind} to=${params.to} logId=${row.id} err=${err?.message ?? err}`,
      );
      try {
        await this.prisma.client.emailLog.update({
          where: { id: row.id },
          data: { status: 'FAILED', error: String(err?.message ?? err) },
        });
      } catch (updateErr: any) {
        // Two-strike scenario: dispatch failed AND we couldn't update
        // the row to record the failure. Loud error so this gets noticed.
        this.logger.error(
          `EmailLog FAILED-status update ALSO failed. logId=${row.id} originalErr=${err?.message} updateErr=${updateErr?.message}`,
        );
      }
    }
  }

  /**
   * Review-workflow notifications. Sent alongside the in-app
   * Notification row from AssetsController when CONTRIBUTOR uploads go
   * to PENDING_APPROVAL status. Each admin gets one email.
   */
  async sendAssetPendingReview(params: {
    to: string;
    uploaderEmail: string;
    assetName: string;
    reviewLink: string;
  }): Promise<void> {
    const subject = `Review needed: "${params.assetName}"`;
    const body = [
      `${params.uploaderEmail} uploaded a new asset and it's waiting for your review before it can be scheduled.`,
      ``,
      `Asset: ${params.assetName}`,
      ``,
      `Open the review queue to approve or reject:`,
      params.reviewLink,
      ``,
      `— EduSignage`,
    ].join('\n');
    await this.#enqueue({ to: params.to, subject, body, kind: 'ASSET_PENDING_REVIEW' });
  }

  async sendAssetDecision(params: {
    to: string;
    decision: 'APPROVED' | 'REJECTED';
    assetName: string;
    reviewerEmail: string;
    reason?: string;
    assetsLink: string;
  }): Promise<void> {
    const subject = params.decision === 'APPROVED'
      ? `Approved: "${params.assetName}"`
      : `Rejected: "${params.assetName}"`;
    const body = params.decision === 'APPROVED'
      ? [
          `"${params.assetName}" was approved by ${params.reviewerEmail} and is now published.`,
          ``,
          `You can add it to playlists and schedule it on screens.`,
          ``,
          `Manage your assets:`,
          params.assetsLink,
          ``,
          `— EduSignage`,
        ].join('\n')
      : [
          `"${params.assetName}" was rejected by ${params.reviewerEmail}.`,
          params.reason ? `\nReason: ${params.reason}\n` : ``,
          `You can edit and re-upload, or open the assets page for details:`,
          params.assetsLink,
          ``,
          `— EduSignage`,
        ].join('\n');
    const kind = params.decision === 'APPROVED' ? 'ASSET_APPROVED' : 'ASSET_REJECTED';
    await this.#enqueue({ to: params.to, subject, body, kind });
  }

  /**
   * Dispatch an email via Resend. Swap-in target for the old stub.
   *
   * Config (all optional — unset = dev-mode logging only):
   *   RESEND_API_KEY    your re_... API key from https://resend.com
   *   EMAIL_FROM        "EduSignage <noreply@yourdomain.com>", defaults
   *                     to "EduSignage <onboarding@resend.dev>" which
   *                     works without domain verification but carries
   *                     the Resend branding and goes to spam on many
   *                     providers. Verify a custom sender domain in the
   *                     Resend dashboard for production.
   *   EMAIL_REPLY_TO    optional Reply-To, e.g. district IT help alias
   *
   * When RESEND_API_KEY is unset we log instead of calling the API —
   * preserves the zero-config dev experience while prod just works the
   * moment the env var lands on Railway.
   */
  async #dispatch(params: { to: string; subject: string; body: string; kind: string }): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      // Dev / unconfigured mode — the email_logs row is still the
      // durable record (#enqueue already wrote it), so recovery is just
      // "set the env var + replay QUEUED rows" if we ever need to.
      this.logger.log(`[email stub:${params.kind}] to=${params.to} subject="${params.subject}" — set RESEND_API_KEY to actually send`);
      return;
    }

    const from = process.env.EMAIL_FROM || 'EduSignage <onboarding@resend.dev>';
    const replyTo = process.env.EMAIL_REPLY_TO || undefined;
    // Body is plain text today — Resend accepts `text` without `html`
    // and the few inline links still render as clickable in every major
    // client. When we ship templated transactional email we'll add
    // an HTML variant alongside.
    const payload: Record<string, any> = {
      from,
      to: [params.to],
      subject: params.subject,
      text: params.body,
    };
    if (replyTo) payload.reply_to = replyTo;

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      // Resend returns { name, message, statusCode } on failure. Surface
      // both so the #enqueue failure-branch has useful context for
      // ops / the FAILED email_logs row.
      const text = await resp.text().catch(() => '');
      throw new Error(`Resend ${resp.status}: ${text.slice(0, 500)}`);
    }
  }
}
