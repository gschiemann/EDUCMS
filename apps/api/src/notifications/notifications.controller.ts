import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { requireTenantIdStrict } from '../auth/require-tenant';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

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

}

// Phase D1 — touch builder "request help" action endpoint.
//
// Sibling controller without the class-level JwtAuthGuard so kiosks
// (which run unauthenticated for touch flows) can post help requests
// without needing a device JWT. We resolve the tenant via screenId
// so an attacker can't notify a tenant they don't have a paired
// screen on. Rate-limited 10/min/IP to stop a mashy visitor (or
// scripted abuse) from spamming the admin pager. 5-min dedupe
// bucket so the same kiosk's mash-the-button visitor only produces
// ONE notification per window.
@Controller('api/v1/notifications')
export class NotificationsPublicController {
  constructor(
    private readonly service: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('help')
  async requestHelp(
    @Body() body: { screenId?: string; tenantId?: string; title?: string; body?: string },
  ) {
    const screenId = (body?.screenId || '').trim();
    if (!screenId) {
      throw new HttpException({ code: 'NOTIFICATIONS_SCREEN_ID_REQUIRED', message: 'screenId required' }, HttpStatus.BAD_REQUEST);
    }
    const screen = await this.prisma.client.screen.findUnique({
      where: { id: screenId },
      select: { id: true, tenantId: true, name: true },
    });
    if (!screen?.tenantId) {
      // Unpaired / unknown screen — silently no-op so a probe gets
      // no useful error signal.
      return { ok: true };
    }
    // Phase D1.6 — coerce-then-slice so a malformed payload with a
    // non-string title/body doesn't 500 on `.slice` (security review
    // 2026-05-12 LOW finding). `String()` handles null/undefined/
    // object/number; the fallback string covers the empty case.
    const title = String(body?.title ?? '').slice(0, 120) || 'Visitor needs assistance';
    const detail = String(body?.body ?? '').slice(0, 500) || 'A kiosk visitor tapped “request help.”';
    const bucket = Math.floor(Date.now() / (5 * 60_000));
    await this.service.notify({
      tenantId: screen.tenantId,
      kind: 'INFO',
      title: `${title} — ${screen.name}`,
      body: detail,
      link: `/screens`,
      dedupeKey: `touch-help:${screenId}:${bucket}`,
    }).catch(() => { /* best-effort — notification table off is OK */ });
    return { ok: true };
  }
}
