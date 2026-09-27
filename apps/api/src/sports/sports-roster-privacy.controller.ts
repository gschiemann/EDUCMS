import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { SportsRosterPrivacyService } from './sports-roster-privacy.service';
import { userActor } from './game-command';

/**
 * What a PUBLIC board shows about a game's players (K-12 launch audit F38):
 * names (full / last only / hidden), jersey numbers, photos, positions and
 * stats. Enforced server-side in the public board payload — see
 * ./roster-privacy.ts. Same roles as the roster itself: anyone who may read
 * the roster may read the setting; anyone who may edit the roster may change
 * it.
 */
@Controller('api/v1/sports')
@UseGuards(JwtAuthGuard, RbacGuard)
export class SportsRosterPrivacyController {
  constructor(private readonly privacy: SportsRosterPrivacyService) {}

  @Get('games/:id/roster-privacy')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  get(@Request() req: any, @Param('id') id: string) {
    return this.privacy.get(req.user.tenantId, id);
  }

  @Patch('games/:id/roster-privacy')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  set(@Request() req: any, @Param('id') id: string, @Body() body: unknown) {
    return this.privacy.set(req.user.tenantId, id, userActor(req), body);
  }
}
