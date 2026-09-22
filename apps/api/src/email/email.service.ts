import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
// The sender-identity honesty gate now lives in ONE place (2026-08-03) so the
// two background alerting services that POST to Resend directly —
// StorageWatchdogService + EfficiencyAlertingService — apply the exact same
// SENT / SENT_UNVERIFIED rule this service does. See sender-identity.ts.
import {
  isDeliverableToArbitraryRecipients as senderIsDeliverable,
  resendAcceptedStatus,
  resolveEmailFrom,
  sharedSenderWarning,
} from './sender-identity';

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
    const subject = `Welcome to VenueOS, ${params.districtName}`;
    const loginUrl = `${this.appUrl}/login`;
    const body = [
      `Your VenueOS workspace for ${params.districtName} is ready.`,
      ``,
      `Sign in to get started: ${loginUrl}`,
      ``,
      `Tenant slug: ${params.tenantSlug}`,
      ``,
      `— The VenueOS team`,
    ].join('\n');

    await this.#enqueue({ to: params.to, subject, body, kind: 'WELCOME' });
  }

  async sendPasswordReset(params: { to: string; resetToken: string }): Promise<void> {
    const subject = 'Reset your VenueOS password';
    const resetUrl = `${this.appUrl}/reset-password/${encodeURIComponent(params.resetToken)}`;
    const body = [
      `We received a request to reset your password.`,
      ``,
      `Click the link below within one hour to choose a new password:`,
      resetUrl,
      ``,
      `If you didn't request this, you can safely ignore this email.`,
      ``,
      `— The VenueOS team`,
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
    const subject = `${params.inviterEmail} invited you to ${params.tenantName} on VenueOS`;
    const acceptUrl = `${this.appUrl}/accept-invite/${encodeURIComponent(params.inviteToken)}`;
    const body = [
      `${params.inviterEmail} invited you to join ${params.tenantName} on VenueOS as ${params.role}.`,
      ``,
      `Accept your invitation and choose a password:`,
      acceptUrl,
      ``,
      `This invitation expires in 7 days.`,
      ``,
      `— The VenueOS team`,
    ].join('\n');

    await this.#enqueue({ to: params.to, subject, body, kind: 'INVITE' });
  }

  /**
   * An administrator reset this account's two-factor sign-in
   * (`POST /users/:id/mfa/reset`, 2026-09-21).
   *
   * This mail is a SECURITY CONTROL, not a courtesy: the reset endpoint is the
   * one place a privileged insider can strip someone else's second factor, so
   * the account owner has to hear about it from a channel the actor does not
   * control. That is why it names WHO did it and WHEN, and why it ends with a
   * "if you did not expect this" line — an unexpected notice is the signal.
   *
   * Plain text, like every other message here. It deliberately carries NO
   * link: a mail that says "your second factor was removed" and then offers a
   * button is the exact shape of the phishing message this event would be
   * imitated by. The user signs in the way they already know how.
   */
  async sendMfaReset(params: {
    to: string;
    actorName: string;
    hadTotp: boolean;
    passkeysRemoved: number;
  }): Promise<void> {
    const subject = 'Your VenueOS two-factor sign-in was reset';
    const when = new Date().toISOString().slice(0, 10);
    const removed: string[] = [];
    if (params.hadTotp) removed.push('your authenticator app');
    if (params.passkeysRemoved === 1) removed.push('your passkey');
    else if (params.passkeysRemoved > 1) removed.push(`your ${params.passkeysRemoved} passkeys`);

    const body = [
      `Your two-factor sign-in was reset by ${params.actorName} on ${when}.`,
      ``,
      removed.length
        ? `This removed ${removed.join(' and ')} from your account.`
        : `Your account had no two-factor method set up.`,
      ``,
      `Sign in with your password and set it up again. Your password has not changed.`,
      ``,
      `If you did not expect this, contact your administrator.`,
      ``,
      `— The VenueOS team`,
    ].join('\n');

    await this.#enqueue({ to: params.to, subject, body, kind: 'MFA_RESET' });
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
      // #dispatch returns 'SENT' for a genuinely-deliverable send, or
      // 'SENT_UNVERIFIED' when we handed the message to Resend but we're on
      // the shared onboarding@resend.dev sender (only the Resend account
      // owner will actually receive it — see #dispatch). Recording the
      // distinction on the durable row keeps us from over-claiming a
      // confident "SENT" for arbitrary recipients.
      const sendStatus = await this.#dispatch(params);
      await this.prisma.client.emailLog.update({
        where: { id: row.id },
        data: { status: sendStatus, sentAt: new Date() },
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
      `— VenueOS`,
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
          `— VenueOS`,
        ].join('\n')
      : [
          `"${params.assetName}" was rejected by ${params.reviewerEmail}.`,
          params.reason ? `\nReason: ${params.reason}\n` : ``,
          `You can edit and re-upload, or open the assets page for details:`,
          params.assetsLink,
          ``,
          `— VenueOS`,
        ].join('\n');
    const kind = params.decision === 'APPROVED' ? 'ASSET_APPROVED' : 'ASSET_REJECTED';
    await this.#enqueue({ to: params.to, subject, body, kind });
  }

  // ─── Bug Reporter notifications ─────────────────────────────────
  //
  // 2026-05-27 — Operator: "you should send me an email with the bug
  // number and then send an email once we fix it". Three notification
  // points cover the lifecycle:
  //
  //   sendBugFiled       — "we got your report, here's the number"
  //   sendBugFixProposed — "Claude found the cause + has a proposed fix"
  //   sendBugFixShipped  — "the fix is approved + shipping"
  //
  // All three are best-effort: the caller MUST swallow errors so an
  // email outage never blocks the bug pipeline. Calls into the same
  // #enqueue that writes to email_logs + dispatches via Resend when
  // configured, otherwise logs.
  //
  // Subject convention: "[VenueOS bug #abc12def] <action>" — the
  // short ID is the first 8 chars of the bug UUID (unique enough at
  // human scale, fits Mail.app subject preview).

  async sendBugFiled(params: {
    to: string;
    bugId: string;
    description: string | null;
    pathname: string | null;
    tenantSlug: string | null;
  }): Promise<void> {
    const shortId = params.bugId.slice(0, 8);
    const subject = `[VenueOS bug #${shortId}] We got your report`;
    const reviewUrl = `${this.appUrl}/super/bugs/${params.bugId}`;
    const body = [
      `Thanks for reporting that. Your bug is in the queue.`,
      ``,
      `Bug ID:   ${params.bugId}`,
      params.tenantSlug ? `Tenant:   ${params.tenantSlug}` : '',
      params.pathname ? `Page:     ${params.pathname}` : '',
      ``,
      params.description ? `What you wrote:` : '',
      params.description ? `> ${params.description}` : '',
      ``,
      `We captured a screenshot, your recent actions, any console errors,`,
      `and the relevant audit-log entries automatically. Review the full`,
      `bundle here:`,
      reviewUrl,
      ``,
      `You'll get another email when the fix is proposed, and a final one`,
      `when it ships. No action required from you right now.`,
      ``,
      `— VenueOS`,
    ]
      .filter((l) => l !== '')
      .join('\n');
    await this.#enqueue({ to: params.to, subject, body, kind: 'BUG_FILED' });
  }

  async sendBugFiledOwnerAlert(params: {
    to: string;
    bugId: string;
    reporterEmail: string;
    reporterRole: string | null;
    description: string | null;
    pathname: string | null;
    tenantSlug: string | null;
    tenantVertical: string | null;
  }): Promise<void> {
    const shortId = params.bugId.slice(0, 8);
    const descPreview = params.description
      ? params.description.length > 80
        ? params.description.slice(0, 77) + '…'
        : params.description
      : '(no description)';
    const subject = `[New bug #${shortId}] ${params.tenantSlug ?? 'unknown'} — "${descPreview}"`;
    const reviewUrl = `${this.appUrl}/super/bugs/${params.bugId}`;
    const body = [
      `New bug just filed.`,
      ``,
      `Bug ID:   ${params.bugId}`,
      `Reporter: ${params.reporterEmail} (${params.reporterRole ?? '?'})`,
      params.tenantSlug
        ? `Tenant:   ${params.tenantSlug}${params.tenantVertical ? ` [${params.tenantVertical}]` : ''}`
        : '',
      params.pathname ? `Page:     ${params.pathname}` : '',
      ``,
      params.description ? `What they wrote:` : '',
      params.description ? `> ${params.description}` : '',
      ``,
      `Review the full capture bundle (screenshot, breadcrumbs, console`,
      `errors, audit log, infra state) and approve or reject the fix:`,
      reviewUrl,
      ``,
      `— VenueOS Bug Reporter`,
    ]
      .filter((l) => l !== '')
      .join('\n');
    await this.#enqueue({ to: params.to, subject, body, kind: 'BUG_FILED_OWNER' });
  }

  async sendBugFixProposed(params: {
    to: string;
    bugId: string;
    rootCause: string;
    confidence: number;
    filesAffectedCount: number;
  }): Promise<void> {
    const shortId = params.bugId.slice(0, 8);
    const subject = `[VenueOS bug #${shortId}] Fix proposed — please review`;
    const reviewUrl = `${this.appUrl}/super/bugs/${params.bugId}`;
    const trimmedCause =
      params.rootCause.length > 600 ? params.rootCause.slice(0, 597) + '…' : params.rootCause;
    const body = [
      `We have a proposed fix for your bug.`,
      ``,
      `Root cause (${params.confidence}% confidence):`,
      trimmedCause,
      ``,
      `Files affected: ${params.filesAffectedCount}`,
      ``,
      `Review the proposed diff and approve here:`,
      reviewUrl,
      ``,
      `— VenueOS`,
    ].join('\n');
    await this.#enqueue({ to: params.to, subject, body, kind: 'BUG_FIX_PROPOSED' });
  }

  async sendBugFixShipped(params: {
    to: string;
    bugId: string;
    description: string | null;
    prUrl: string | null;
  }): Promise<void> {
    const shortId = params.bugId.slice(0, 8);
    const subject = `[VenueOS bug #${shortId}] Fix is shipping`;
    const reviewUrl = `${this.appUrl}/super/bugs/${params.bugId}`;
    const body = [
      `Your bug is fixed.`,
      ``,
      params.description ? `What you reported:` : '',
      params.description ? `> ${params.description}` : '',
      ``,
      params.prUrl ? `Pull request:` : '',
      params.prUrl ? params.prUrl : '',
      ``,
      `The fix is going through CI now. It will be live within a few`,
      `minutes of the next deploy. Refresh the page once you see the new`,
      `commit on /super and re-test.`,
      ``,
      `Full audit trail (capture bundle + AI analysis + your approval):`,
      reviewUrl,
      ``,
      `— VenueOS`,
    ]
      .filter((l) => l !== '')
      .join('\n');
    await this.#enqueue({ to: params.to, subject, body, kind: 'BUG_FIX_SHIPPED' });
  }

  /**
   * Dispatch an email via Resend. Swap-in target for the old stub.
   *
   * Config (all optional — unset = dev-mode logging only):
   *   RESEND_API_KEY    your re_... API key from https://resend.com
   *   EMAIL_FROM        "VenueOS <noreply@yourdomain.com>", defaults
   *                     to "VenueOS <onboarding@resend.dev>" which
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
  /** True when RESEND_API_KEY is set (i.e. the dispatcher will actually
   *  POST to Resend, not just log). Used by callers that need to surface
   *  "email isn't configured" to the operator instead of silently
   *  pretending the message was queued — biggest example is the
   *  /password-reset/request flow which previously showed "check your
   *  inbox" even when no email was ever sent. */
  isConfigured(): boolean {
    return !!process.env.RESEND_API_KEY;
  }

  /**
   * True only when EMAIL_FROM is a real, domain-verified sender — i.e. Resend
   * will actually deliver to ARBITRARY recipients, not just the Resend account
   * owner.
   *
   * Even with RESEND_API_KEY set and a 200 back from the Resend API, mail sent
   * from the shared `onboarding@resend.dev` sender (our default when
   * EMAIL_FROM is unset) is delivered ONLY to the address that owns the Resend
   * account; every other recipient (other admins, operators, parents) is
   * silently dropped / spam-filtered. Callers and the integrations-health
   * probe use this to avoid claiming a confident "sent / check your inbox"
   * when we're on the default sender.
   *
   * This checks the sender IDENTITY only (independent of RESEND_API_KEY) so
   * "can this FROM reach anyone?" stays orthogonal to isConfigured() ("is a
   * key present?"). The health probe combines both.
   *   - unset            → false (falls back to the shared sender)
   *   - shared sender     → false (bare or "Name <onboarding@resend.dev>")
   *   - custom domain     → true
   */
  isDeliverableToArbitraryRecipients(): boolean {
    return senderIsDeliverable();
  }

  async #dispatch(
    params: { to: string; subject: string; body: string; kind: string },
  ): Promise<'SENT' | 'SENT_UNVERIFIED'> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      // Production fail-closed (2026-05-23 launch audit P0): in prod a
      // missing RESEND_API_KEY means the user's password-reset / invite /
      // welcome email NEVER lands. Previously this path silently logged
      // and returned, and every UI surface above it told the user "check
      // your inbox." That's worse than a real error — the user thinks
      // their request worked and waits for an email that never comes.
      // We throw so the caller (#enqueue + onboarding.service) marks the
      // email_log row FAILED and surfaces a real error to the UI.
      //
      // Dev keeps the zero-config behavior: log + return success so local
      // development doesn't require a Resend key.
      const isProd = process.env.NODE_ENV === 'production';
      if (isProd) {
        const msg =
          'Outbound email is not configured (RESEND_API_KEY not set). ' +
          'Set the env var on Railway and redeploy to enable password resets / invites / welcome mail.';
        this.logger.error(`[email] ${msg}`);
        throw new Error(msg);
      }
      // Dev / unconfigured mode — the email_logs row is still the
      // durable record (#enqueue already wrote it), so recovery is just
      // "set the env var + replay QUEUED rows" if we ever need to.
      this.logger.log(`[email stub:${params.kind}] to=${params.to} subject="${params.subject}" — set RESEND_API_KEY to actually send`);
      return 'SENT';
    }

    const from = resolveEmailFrom();
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

    // Resend accepted the message — but if we're on the shared
    // onboarding@resend.dev sender it will ONLY be delivered to the Resend
    // account owner; every other recipient is silently dropped. Don't let a
    // 200 masquerade as a confident "sent to anyone": warn loudly and report
    // SENT_UNVERIFIED so the durable row + logs tell the truth.
    const status = resendAcceptedStatus();
    if (status === 'SENT_UNVERIFIED') {
      this.logger.warn(sharedSenderWarning({ kind: params.kind, to: params.to, from }));
    }
    return status;
  }
}
