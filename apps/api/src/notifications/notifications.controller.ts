import { Body, Controller, Get, HttpException, HttpStatus, Optional, Param, Post, Put, Query, Req, Request, UseGuards } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { verifyDeviceForScreen } from '../screens/device-auth';
import { RedisService } from '../realtime/redis.service';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { requireTenantIdStrict } from '../auth/require-tenant';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const ALERT_EMAIL_ROLES: ReadonlySet<string> = new Set(['DISTRICT_ADMIN', 'SCHOOL_ADMIN']);
const ALERT_EMAIL_LOCALES: ReadonlySet<string> = new Set(['en', 'es', 'zh']);

@Controller('api/v1/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly service: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(@Request() req: any, @Query('limit') limit?: string) {
    const userId = req.user.id;
    // 2026-07-25 — a tenant-less token (device JWT) used to reach Prisma as
    // `tenantId: undefined`, which DROPS the filter and returns EVERY tenant's
    // notifications. Reject it before any DB call.
    const tenantId = requireTenantIdStrict(req);
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    const [items, unreadCount] = await Promise.all([
      this.service.listForUser({ tenantId, userId, limit: parsedLimit }),
      this.service.unreadCount(tenantId, userId),
    ]);
    return { items, unreadCount };
  }

  @Post(':id/read')
  async markRead(@Request() req: any, @Param('id') id: string) {
    return this.service.markRead(id, requireTenantIdStrict(req), req.user.id);
  }

  @Post('read-all')
  async markAll(@Request() req: any) {
    return this.service.markAllRead(requireTenantIdStrict(req), req.user.id);
  }

  // ── Alert emails (2026-10-23) — the person's own switch + language ───────
  // Customer alert emails (screen offline / not showing content / emergency
  // record copies) go to admins; ON by default. These two routes read and set
  // the signed-in person's own preference — nobody else's.

  @Get('alert-emails')
  async getAlertEmails(@Request() req: any) {
    requireTenantIdStrict(req);
    const user = await this.prisma.client.user.findFirst({
      where: { id: String(req.user?.id ?? ''), deletedAt: null },
      select: { role: true, alertEmailsEnabled: true, alertEmailLocale: true },
    });
    if (!user) throw new HttpException({ code: 'ALERT_EMAILS_USER_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    return {
      enabled: user.alertEmailsEnabled,
      locale: user.alertEmailLocale ?? null,
      // Only admins receive alert emails; the dashboard shows the switch to them.
      eligible: ALERT_EMAIL_ROLES.has(user.role),
    };
  }

  @Put('alert-emails')
  async setAlertEmails(@Request() req: any, @Body() body: { enabled?: unknown; locale?: unknown }) {
    requireTenantIdStrict(req);
    const data: { alertEmailsEnabled?: boolean; alertEmailLocale?: string | null } = {};
    if (body?.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        throw new HttpException({ code: 'ALERT_EMAILS_INVALID', message: 'enabled must be true or false' }, HttpStatus.BAD_REQUEST);
      }
      data.alertEmailsEnabled = body.enabled;
    }
    if (body?.locale !== undefined) {
      if (body.locale !== null && !ALERT_EMAIL_LOCALES.has(String(body.locale))) {
        throw new HttpException({ code: 'ALERT_EMAILS_INVALID', message: 'locale must be en, es or zh' }, HttpStatus.BAD_REQUEST);
      }
      data.alertEmailLocale = body.locale === null ? null : String(body.locale);
    }
    if (Object.keys(data).length === 0) {
      throw new HttpException({ code: 'ALERT_EMAILS_INVALID', message: 'Nothing to change' }, HttpStatus.BAD_REQUEST);
    }
    const res = await this.prisma.client.user.updateMany({
      where: { id: String(req.user?.id ?? ''), deletedAt: null },
      data,
    });
    if (res.count !== 1) throw new HttpException({ code: 'ALERT_EMAILS_USER_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    return this.getAlertEmails(req);
  }

}

// Phase D1 — touch builder "request help" action endpoint.
//
// Sibling controller without the class-level JwtAuthGuard: the kiosk proves
// itself with its DEVICE credential instead of a person's session.
//
// 2026-10-11 (launch security re-audit V-6): this used to take NO credential
// at all — anyone who knew a screen id (it is visible on screens and in player
// URLs) could drop an attacker-written title + body into that tenant's admin
// inbox ("IT: re-enter your password at ..."). Now:
//   - the caller must present the device credential OF THAT SCREEN
//     (`verifyDeviceForScreen`, strict: paired + proven); anything else is 401;
//   - the wording is constrained: the operator-authored title/body from the
//     board config is kept only as plain text with links, addresses and
//     control characters removed, length-capped, and always carries the
//     screen's real name. A device can no longer ship a clickable lure.
// Rate-limited 10/min/IP plus a 5-min dedupe bucket per screen, as before.
const HELP_DEFAULT_TITLE = 'Visitor needs assistance';
const HELP_DEFAULT_BODY = 'A kiosk visitor tapped “request help.”';

/** Plain words only: no URLs, bare domains, email addresses or control characters. */
export function constrainHelpText(raw: unknown, max: number, fallback: string): string {
  let s = String(raw ?? '');
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ');
  s = s.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, ' ');
  s = s.replace(/\bwww\.\S*/gi, ' ');
  s = s.replace(/\S+@\S+\.\S+/g, ' ');
  s = s.replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?/gi, ' ');
  s = s.replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return s || fallback;
}

@Controller('api/v1/notifications')
export class NotificationsPublicController {
  constructor(
    private readonly service: NotificationsService,
    private readonly prisma: PrismaService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('help')
  async requestHelp(
    @Req() req: ExpressRequest,
    @Body() body: { screenId?: string; tenantId?: string; title?: string; body?: string },
  ) {
    const screenId = String(body?.screenId ?? '').trim();
    if (!screenId) {
      throw new HttpException({ code: 'NOTIFICATIONS_SCREEN_ID_REQUIRED', message: 'screenId required' }, HttpStatus.BAD_REQUEST);
    }
    // V-6: the screen must prove it is that screen. The verifier also resolves
    // the tenant from the live screen row; the body's tenantId is ignored.
    const auth = await verifyDeviceForScreen({ prisma: this.prisma as any, redis: (this.redis ?? null) as any }, req as any, screenId, {
      // Paired screens only: an unpaired screen has no tenant to notify.
      allowUnpaired: false,
    });
    if (!auth.ok || !auth.tenantId) {
      throw new HttpException({ code: 'NOTIFICATIONS_DEVICE_AUTH_REQUIRED', message: 'This screen is not signed in.' }, HttpStatus.UNAUTHORIZED);
    }
    const screen = await this.prisma.client.screen.findFirst({
      where: { id: screenId, tenantId: auth.tenantId },
      select: { id: true, tenantId: true, name: true },
    });
    if (!screen?.tenantId) return { ok: true };
    const title = constrainHelpText(body?.title, 80, HELP_DEFAULT_TITLE);
    const detail = constrainHelpText(body?.body, 300, HELP_DEFAULT_BODY);
    const bucket = Math.floor(Date.now() / (5 * 60_000));
    await this.service.notify({
      tenantId: screen.tenantId,
      kind: 'INFO',
      title: `${title} — ${screen.name}`,
      body: detail,
      link: `/screens`,
      dedupeKey: `touch-help:${screenId}:${bucket}`,
    }).catch(() => { /* best-effort: notification table off is OK */ });
    return { ok: true };
  }
}
