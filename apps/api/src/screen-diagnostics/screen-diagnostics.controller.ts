/**
 * ScreenDiagnosticsController (2026-11-08) — mounted under /api/v1/screens
 * beside DeviceSettingsController (a new literal segment after `:id`).
 *
 * OPERATOR (JWT + RBAC):
 *   GET  /:id/diagnostics                         latest self-test, recent logs, storage health
 *   POST /:id/diagnostics      {kind, minutes?}   run a self-test (admins) / get recent logs (org admins)
 *   GET  /:id/diagnostics/:rid/logs-url           a 5-minute signed download URL (org admins; audited)
 *
 * DEVICE (the screen's own device credential, `verifyDeviceForScreen`):
 *   POST /:id/diagnostics/:rid/native             the Android half of a self-test (or a LOGS failure)
 *   POST /:id/diagnostics/:rid/page               the WebView half of a self-test
 *   POST /:id/diagnostics/:rid/upload-ticket      a short-lived signed ticket for ONE log upload
 *   POST /:id/diagnostics/:rid/logs               the redacted log bundle (ticket in x-diagnostics-ticket)
 *   POST /:id/storage-health                      the page's storage report (origin quota, emergency tier)
 *
 * Device routes carry `Authorization: Bearer`, which the CSRF middleware
 * already exempts (a browser cannot attach it cross-site).
 */
import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AppRole } from '@cms/database';
import type { Request as ExpressReq } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { ScreenDiagnosticsService } from './screen-diagnostics.service';

const clientIp = (req: any): string | null => {
  const ip = req?.ip ?? req?.socket?.remoteAddress ?? null;
  return typeof ip === 'string' ? ip.slice(0, 64) : null;
};

@Controller('api/v1/screens')
export class ScreenDiagnosticsController {
  constructor(private readonly svc: ScreenDiagnosticsService) {}

  // ─── Operator ─────────────────────────────────────────────────────────

  @Get(':id/diagnostics')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  view(@Param('id') id: string, @Req() req: any) {
    return this.svc.view(req.user, id);
  }

  @Post(':id/diagnostics')
  @UseGuards(JwtAuthGuard, RbacGuard)
  // LOGS is narrowed to SUPER/DISTRICT inside the service (`mayRequest`).
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  request(@Param('id') id: string, @Req() req: any, @Body() body: { kind?: unknown; minutes?: unknown }) {
    return this.svc.request(req.user, id, body ?? {}, clientIp(req));
  }

  @Get(':id/diagnostics/:rid/logs-url')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  logsUrl(@Param('id') id: string, @Param('rid') rid: string, @Req() req: any) {
    return this.svc.logsUrl(req.user, id, rid, clientIp(req));
  }

  // ─── Device ───────────────────────────────────────────────────────────

  @Post(':id/diagnostics/:rid/native')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  native(@Param('id') id: string, @Param('rid') rid: string, @Req() req: ExpressReq, @Body() body: unknown) {
    return this.svc.acceptNative(req, id, rid, body);
  }

  @Post(':id/diagnostics/:rid/page')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  page(@Param('id') id: string, @Param('rid') rid: string, @Req() req: ExpressReq, @Body() body: unknown) {
    return this.svc.acceptPage(req, id, rid, body);
  }

  @Post(':id/diagnostics/:rid/upload-ticket')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  ticket(@Param('id') id: string, @Param('rid') rid: string, @Req() req: ExpressReq) {
    return this.svc.issueTicket(req, id, rid);
  }

  @Post(':id/diagnostics/:rid/logs')
  @Throttle({ default: { limit: 4, ttl: 60_000 } })
  logs(
    @Param('id') id: string,
    @Param('rid') rid: string,
    @Req() req: ExpressReq,
    @Headers('x-diagnostics-ticket') ticket: string | undefined,
    @Body() body: unknown,
  ) {
    return this.svc.acceptLogs(req, id, rid, ticket, body);
  }

  @Post(':id/storage-health')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  storageHealth(@Param('id') id: string, @Req() req: ExpressReq, @Body() body: unknown) {
    return this.svc.acceptPageStorage(req, id, body);
  }
}
