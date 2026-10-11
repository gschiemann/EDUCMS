import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { SupportAccessService } from './support-access.service';

/**
 * SUPPORT ACCESS — the VenueOS side (2026-10-11), /api/v1/super/customers/:id/support-access.
 *
 * SUPER_ADMIN only at the class. These routes never READ customer content:
 * they show the state of VenueOS's own access to an organisation, ask for it,
 * end it, or open the audited break-glass path. The `:id` is always the
 * organisation ROOT (the console's customer id).
 */
@Controller('api/v1/super/customers/:id/support-access')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(AppRole.SUPER_ADMIN)
export class SuperSupportAccessController {
  constructor(private readonly access: SupportAccessService) {}

  @Get()
  async state(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: any) {
    const list = await this.access.listForOrg(id);
    const reach = await this.access.reach(req.user, id);
    return { ...list, internal: reach.basis === 'internal' || reach.basis === 'home', reach: reach.allowed ? reach.basis : null };
  }

  /** (A) Ask the customer: reason, duration, optional location scope. */
  @Post('request')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  request(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() req: any) {
    return this.access.request(id, req.user, body);
  }

  /** End our own access early (or withdraw an open request). */
  @Post(':grantId/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    return this.access.revoke(grantId, id, req.user, 'venueos', body);
  }

  /** BREAK-GLASS: a genuine incident, mandatory reason, ≤ 1 hour, the customer's admins are emailed at once. */
  @Post('break-glass')
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  breakGlass(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() req: any) {
    return this.access.breakGlass(id, req.user, body);
  }
}
