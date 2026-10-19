import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { FieldBuildsService } from './field-builds.service';

/**
 * FIELD BUILD WINDOWS (2026-10-18) — /api/v1/super/field-builds/*.
 *
 * SUPER_ADMIN ONLY, at the class: JwtAuthGuard proves who is calling, RbacGuard
 * refuses every other role (a DISTRICT_ADMIN gets 403). Arming and pushing
 * also need support-access reach to each organisation they touch; the service
 * checks it. Every write is audited there.
 *
 *   GET  candidates               the registered field builds + mirror presence
 *   GET  windows                  the open window, recent history, the variables' window
 *   GET  screens?tenantIds=a,b    those organisations' screens (reach-gated)
 *   POST windows                  arm   { candidate, tenantIds, screens: 'all' | ids, durationMinutes, note? }
 *   POST windows/:id/cancel       cancel { reason? }
 *   POST windows/:id/push         push now { screenIds, overrideWindow? }
 */
@Controller('api/v1/super/field-builds')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(AppRole.SUPER_ADMIN)
export class FieldBuildsController {
  constructor(private readonly fieldBuilds: FieldBuildsService) {}

  @Get('candidates')
  candidates() {
    return this.fieldBuilds.listCandidates();
  }

  @Get('windows')
  windows() {
    return this.fieldBuilds.listWindows();
  }

  @Get('screens')
  screens(@Query('tenantIds') tenantIds: unknown, @Req() req: any) {
    return this.fieldBuilds.listScreens(req?.user ?? null, tenantIds);
  }

  @Post('windows')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  arm(@Body() body: unknown, @Req() req: any) {
    return this.fieldBuilds.arm(req?.user ?? null, body);
  }

  @Post('windows/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() req: any) {
    return this.fieldBuilds.cancel(req?.user ?? null, id, body);
  }

  @Post('windows/:id/push')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  push(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() req: any) {
    return this.fieldBuilds.push(req?.user ?? null, id, body);
  }
}
