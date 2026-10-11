import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { requireTenantIdStrict } from '../auth/require-tenant';
import { SupportAccessService } from './support-access.service';

/**
 * SUPPORT ACCESS — the customer side (2026-10-11), /api/v1/support-access.
 *
 * Everything is scoped to the CALLER'S organisation (the root of the tenant
 * their session is stamped with); nothing in a body or param can name another
 * organisation. The deciding roles are the organisation's admins:
 * DISTRICT_ADMIN anywhere in it, or a SCHOOL_ADMIN on the root itself (the
 * owner of a single-location customer). Everyone else may READ the state —
 * the banner is for the whole dashboard — but not decide.
 *
 * A SUPER_ADMIN is deliberately NOT a deciding role here: VenueOS cannot
 * approve its own request. RbacGuard's "SUPER_ADMIN passes every
 * @RequireRoles" is overridden by the explicit role check in `decider()`.
 */
@Controller('api/v1/support-access')
@UseGuards(JwtAuthGuard, RbacGuard)
export class SupportAccessController {
  constructor(private readonly access: SupportAccessService) {}

  /** The state the banner and the Settings page show. Any signed-in person of the organisation. */
  @Get()
  @RequireRoles(AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR, AppRole.RESTRICTED_VIEWER)
  async state(@Req() req: any) {
    const rootId = await this.rootFor(req);
    const list = await this.access.listForOrg(rootId);
    const canDecide = req.user?.role === AppRole.SUPER_ADMIN ? false : await this.access.isOrgAdmin(req.user, rootId);
    return { ...list, canDecide };
  }

  /** (B) Give VenueOS access now: duration, optional note, optional location scope. */
  @Post('invite')
  @RequireRoles(AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async invite(@Body() body: unknown, @Req() req: any) {
    const rootId = await this.decider(req);
    return this.access.invite(rootId, req.user, body);
  }

  @Post(':grantId/approve')
  @RequireRoles(AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.OK)
  async approve(@Param('grantId', new ParseUUIDPipe()) grantId: string, @Body() body: unknown, @Req() req: any) {
    const rootId = await this.decider(req);
    return this.access.decide(grantId, rootId, req.user, true, body);
  }

  @Post(':grantId/deny')
  @RequireRoles(AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.OK)
  async deny(@Param('grantId', new ParseUUIDPipe()) grantId: string, @Body() body: unknown, @Req() req: any) {
    const rootId = await this.decider(req);
    return this.access.decide(grantId, rootId, req.user, false, body);
  }

  /** "End now" on the banner / list. */
  @Post(':grantId/revoke')
  @RequireRoles(AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.OK)
  async revoke(@Param('grantId', new ParseUUIDPipe()) grantId: string, @Body() body: unknown, @Req() req: any) {
    const rootId = await this.decider(req);
    return this.access.revoke(grantId, rootId, req.user, 'customer', body);
  }

  private async rootFor(req: any): Promise<string> {
    const tenantId = requireTenantIdStrict(req);
    const rootId = await this.access.rootOf(tenantId);
    if (!rootId) throw new ForbiddenException({ code: 'SUPPORT_ACCESS_ORG_NOT_FOUND', message: 'Organization not found.' });
    return rootId;
  }

  private async decider(req: any): Promise<string> {
    const rootId = await this.rootFor(req);
    if (req.user?.role === AppRole.SUPER_ADMIN || !(await this.access.isOrgAdmin(req.user, rootId))) {
      throw new ForbiddenException({
        code: 'SUPPORT_ACCESS_NOT_ORG_ADMIN',
        message: "Only this organization's administrators can decide on VenueOS support access.",
      });
    }
    return rootId;
  }
}
