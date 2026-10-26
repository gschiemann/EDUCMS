import { Controller, Get, HttpException, HttpStatus, Request, UseGuards } from '@nestjs/common';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RbacGuard } from '../../auth/rbac.guard';
import { RequireRoles } from '../../auth/roles.decorator';
import { scopedScreenWhere } from '../../user-scope/user-scope.context';
import { ScreenAttentionService } from './screen-attention.service';

/**
 * `GET /api/v1/screens/attention` (2026-10-24) — the caller's offline screens,
 * sorted into a real outage (`down`), off on purpose (`resting`: on/off
 * schedule, remote power-off, standby, update window, restarting) and old news
 * (`dormant`: not seen in 30+ days, never connected, a phone-browser test
 * screen). The dashboard's red "Screens down" card shows `down` only.
 *
 * Same scope as the screens list (`GET /screens`): the caller's tenant and,
 * for a screen-scoped person, only their screens. Registered in AppModule
 * ahead of ScreensController so this literal path is matched before any
 * `:id` route could claim it (the fleet-pulse lesson).
 */
@Controller('api/v1/screens')
export class ScreenAttentionController {
  constructor(private readonly attention: ScreenAttentionService) {}

  @UseGuards(JwtAuthGuard, RbacGuard)
  @Get('attention')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async attentionList(@Request() req: any) {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) {
      throw new HttpException({ code: 'SCREEN_NO_TENANT_CONTEXT', message: 'No tenant context' }, HttpStatus.BAD_REQUEST);
    }
    return this.attention.forScope({ tenantId, ...scopedScreenWhere(req) });
  }
}
