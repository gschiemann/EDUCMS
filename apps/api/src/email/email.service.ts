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
    const row = await this.prisma.client.emailLog.create({
      data: {
        toEmail: params.to,
        subject: params.subject,
        body: params.body,
        kind: params.kind,
        status: 'QUEUED',
      },
    });

    try {
      await this.#dispatch(params);
      await this.prisma.client.emailLog.update({
        where: { id: row.id },
        data: { status: 'SENT', sentAt: new Date() },
      });
    } catch (err: any) {
      this.logger.warn(`Email dispatch failed (${params.kind} -> ${params.to}): ${err?.message}`);
      await this.prisma.client.emailLog.update({
        where: { id: row.id },
        data: { status: 'FAILED', error: String(err?.message ?? err) },
      });
    }
  }

  /**
   * Actually send the email. Stub: logs to console.
   * Swap this for SendGrid/Resend/SES SDK calls in production.
   */
  async #dispatch(params: { to: string; subject: string; body: string; kind: string }): Promise<void> {
    // Stub. In dev we simply log — the durable copy is in `email_logs`.
    this.logger.log(`[email:${params.kind}] to=${params.to} subject="${params.subject}"`);
  }
}
