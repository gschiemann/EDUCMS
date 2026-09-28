import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request as ExpressReq } from 'express';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { ScoreboardConsoleService } from './scoreboard-console.service';

/** The JWT principal JwtAuthGuard puts on the request. */
type OperatorRequest = { user: { tenantId: string; id?: string | null } };

/**
 * K12-F32 — scoreboard console setup from the game's console (Setup →
 * Scoreboard console): which box reads the console, which console model it
 * is, a live preview of what it sends, and the operator's confirmation before
 * it drives the game. Tenant-scoped through the game AND the screen; every
 * change is audited.
 */
@Controller('api/v1/sports')
@UseGuards(JwtAuthGuard, RbacGuard)
export class ScoreboardConsoleController {
  constructor(private readonly consoles: ScoreboardConsoleService) {}

  @Get('games/:id/scoreboard-console')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  view(@Request() req: OperatorRequest, @Param('id') id: string) {
    return this.consoles.view(req.user.tenantId, id);
  }

  /**
   * Body: `{ screenId, consoleProfile, takeover? }` — `takeover: true` moves a
   * screen that reads the console for another game (409
   * SCOREBOARD_CONSOLE_SCREEN_TAKEN without it).
   */
  @Post('games/:id/scoreboard-console')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  bind(
    @Request() req: OperatorRequest,
    @Param('id') id: string,
    @Body()
    body: { screenId?: string; consoleProfile?: string; takeover?: boolean },
  ) {
    return this.consoles.bind(
      req.user.tenantId,
      id,
      body ?? {},
      req.user?.id ?? null,
    );
  }

  @Post('games/:id/scoreboard-console/confirm')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  confirm(@Request() req: OperatorRequest, @Param('id') id: string) {
    return this.consoles.confirm(req.user.tenantId, id, req.user?.id ?? null);
  }

  @Delete('games/:id/scoreboard-console')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  unbind(@Request() req: OperatorRequest, @Param('id') id: string) {
    return this.consoles.unbind(req.user.tenantId, id, req.user?.id ?? null);
  }
}

/**
 * The box's side: snapshots + link heartbeats from the player bridge,
 * authenticated by the screen's DEVICE credential inside the service
 * (verifyDeviceForScreen — no session guard, no feed token, nothing in a URL).
 */
@Controller('api/v1/sports/scoreboard-console')
export class ScoreboardConsoleDeviceController {
  constructor(private readonly consoles: ScoreboardConsoleService) {}

  // A box posts at up to 5 Hz plus a heartbeat (~310/min). The service caps
  // each SCREEN at 60 per 10 s; this per-IP ceiling leaves room for a few
  // console boxes behind one venue NAT without removing the IP wall
  // (@SkipThrottle would remove it entirely — see screens.controller register).
  @Throttle({ default: { limit: 1200, ttl: 60_000 } })
  @Post(':screenId/snapshot')
  snapshot(
    @Param('screenId') screenId: string,
    @Req() req: ExpressReq,
    @Body() body: Record<string, unknown>,
  ) {
    return this.consoles.ingest(screenId, body ?? {}, req);
  }
}
