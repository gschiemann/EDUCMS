import { Body, Controller, HttpCode, HttpException, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { loginEligibility } from './login-eligibility';
import { hashSetupLinkToken, isSetupLinkTokenShape } from './account-setup-link';
import { clientIpFromRequest } from '../security/client-ip';

const dead = (code: string, message: string, status: HttpStatus) => new HttpException({ code, message }, status);
const INVALID = () =>
  dead('SETUP_LINK_INVALID', 'This setup link is not valid. Ask your administrator for a new one.', HttpStatus.NOT_FOUND);
const EXPIRED = () =>
  dead('SETUP_LINK_EXPIRED', 'This setup link has expired. Ask your administrator for a new one.', HttpStatus.GONE);
const USED = () =>
  dead(
    'SETUP_LINK_USED',
    'This setup link has already been used. Sign in with the email and password you chose, or ask your administrator for a new link.',
    HttpStatus.GONE,
  );
const REPLACED = () =>
  dead('SETUP_LINK_REPLACED', 'A newer setup link was sent for this account. Use the newest one.', HttpStatus.GONE);

/**
 * ONE-TIME ACCOUNT SETUP LINKS — the PUBLIC half (2026-10-10). See
 * account-setup-link.ts for the design; the admin half (generate, regenerate,
 * bulk CSV) lives in users/account-admin.controller.ts.
 *
 * Both routes are reached with no session (the person has never signed in),
 * so they are CSRF-exempt like `/invites/:token/accept`: the 256-bit token in
 * the BODY is the whole authorisation, a browser never attaches it on its
 * own, and only its sha256 is stored. Throttled per IP; a guessed token is a
 * 2^-256 event.
 *
 * `preview` changes nothing — the page shows WHICH account the link is for and
 * waits for the person to press Continue, so a mail scanner that opens the
 * link cannot spend it. `redeem` spends it with ONE conditional write.
 */
@Controller('api/v1/auth/setup-link')
export class AccountSetupLinkController {
  private readonly logger = new Logger('AccountSetupLinkController');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  private async findLink(token: unknown) {
    if (!isSetupLinkTokenShape(token)) throw INVALID();
    // ten-ok: an UNAUTHENTICATED lookup by a 256-bit single-use token's hash — the token IS the claim being tested
    const link = await this.prisma.client.accountSetupLink.findUnique({
      where: { tokenHash: hashSetupLinkToken(token) },
    });
    if (!link) throw INVALID();
    return link;
  }

  private assertUsable(link: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date }): void {
    if (link.usedAt) throw USED();
    if (link.revokedAt) throw REPLACED();
    if (link.expiresAt.getTime() <= Date.now()) throw EXPIRED();
  }

  /** POST /auth/setup-link/preview — which account is this for? Changes nothing. */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async preview(@Body() body: { token?: string }) {
    const link = await this.findLink(body?.token);
    this.assertUsable(link);
    // ten-ok: the link's own account, in the link's own tenant
    const user = await this.prisma.client.user.findFirst({
      where: { id: link.userId, tenantId: link.tenantId, deletedAt: null } as any,
      select: { email: true, firstName: true, mustSetupCredentials: true, tenant: { select: { name: true } } } as any,
    });
    if (!user || !(user as any).mustSetupCredentials) throw USED();
    return {
      email: (user as any).email as string,
      firstName: ((user as any).firstName as string | null) ?? null,
      organization: ((user as any).tenant?.name as string | undefined) ?? null,
      expiresAt: link.expiresAt.toISOString(),
    };
  }

  /**
   * POST /auth/setup-link/redeem — spend the link and sign the person in to
   * first-login setup. The answer is exactly what `/auth/login` returns for
   * the account: a session stamped `msc: true` (which the guard confines to
   * the setup routes), or — only if the account somehow holds a factor — the
   * second-step envelope.
   */
  @Post('redeem')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async redeem(@Body() body: { token?: string }, @Req() req: Request) {
    const link = await this.findLink(body?.token);
    this.assertUsable(link);

    // SINGLE USE — the one conditional write that wins is the only redemption.
    const now = new Date();
    // ten-ok: resolved by the single-use token's hash just above
    const spent = await this.prisma.client.accountSetupLink.updateMany({
      where: { id: link.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (spent.count !== 1) throw USED();

    // ten-ok: the link's own account, in the link's own tenant
    const user = await this.prisma.client.user.findFirst({
      where: { id: link.userId, tenantId: link.tenantId } as any,
      select: {
        id: true,
        email: true,
        role: true,
        tenantId: true,
        canTriggerPanic: true,
        firstName: true,
        lastName: true,
        status: true,
        deletedAt: true,
        mustSetupCredentials: true,
        mfaRequired: true,
        mfaTotpVerifiedAt: true,
        mfaBackupCodes: true,
        tenant: { select: { archivedAt: true } },
        _count: { select: { passkeys: true } },
      } as any,
    });
    const eligibility = loginEligibility(user as any);
    if (eligibility !== 'ok' || !(user as any).mustSetupCredentials) {
      await this.audit(req, link.tenantId, link.userId, 'ACCOUNT_SETUP_LINK_REFUSED', {
        reason: eligibility !== 'ok' ? eligibility : 'already-set-up',
      });
      throw eligibility !== 'ok' ? INVALID() : USED();
    }

    const { tenant: _tenant, status: _status, deletedAt: _deletedAt, ...subject } = user as any;
    const session = await this.auth.login(subject, false);
    await this.audit(req, link.tenantId, link.userId, 'ACCOUNT_SETUP_LINK_USED', {
      linkId: link.id,
      ua: ((req.headers?.['user-agent'] as string | undefined) || '').slice(0, 256),
      outcome: (session as any)?.access_token ? 'setup-session' : 'second-step',
    });
    return session;
  }

  private async audit(req: Request, tenantId: string, userId: string, action: string, extra: Record<string, unknown>) {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId,
          action,
          targetType: 'User',
          targetId: userId,
          details: JSON.stringify({ ...extra, ip: clientIpFromRequest(req) }),
        },
      });
    } catch (e: any) {
      this.logger.warn(`audit(${action}) failed: ${e?.message ?? e}`);
    }
  }
}
