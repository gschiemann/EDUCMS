import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { SportsService } from './sports.service';

/**
 * VenueOS Sports — Sprint 13. The operator + admin API surface.
 *
 * Every endpoint is tenant-scoped via `req.user.tenantId`. Game-day
 * operators (CONTRIBUTOR = "Game-Day Operator" in the SPORTS vertical's
 * role labels) can run a live game; admins can do everything.
 *
 * The PUBLIC board read endpoint lives in SportsBoardController — no
 * auth, by-id-only — so a scoreboard display can render without a
 * login. Scoreboard data is inherently public.
 */
@Controller('api/v1/sports')
@UseGuards(JwtAuthGuard, RbacGuard)
export class SportsController {
  constructor(private readonly sports: SportsService) {}

  /** The sport catalog (football, basketball, …) — drives the pickers. */
  @Get('definitions')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  listDefinitions() {
    return this.sports.listSports();
  }

  /** All games for the caller's tenant. */
  @Get('games')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  listGames(@Request() req: any) {
    return this.sports.listGames(req.user.tenantId);
  }

  /** One game — the operator control surface loads this. */
  @Get('games/:id')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  getGame(@Request() req: any, @Param('id') id: string) {
    return this.sports.getGame(req.user.tenantId, id);
  }

  /** Create a game for a sport. */
  @Post('games')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  createGame(
    @Request() req: any,
    @Body()
    body: {
      sport?: string;
      homeTeam?: string;
      awayTeam?: string;
      homeColor?: string;
      awayColor?: string;
      homeLogoUrl?: string;
      awayLogoUrl?: string;
      screenGroupId?: string;
      status?: string;
    },
  ) {
    return this.sports.createGame(req.user.tenantId, body);
  }

  /** Edit a game's identity — team names, colors, brand logos. */
  @Patch('games/:id')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  updateGameDetails(
    @Request() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      homeTeam?: string;
      awayTeam?: string;
      homeColor?: string;
      awayColor?: string;
      homeLogoUrl?: string | null;
      awayLogoUrl?: string | null;
    },
  ) {
    return this.sports.updateGameDetails(req.user.tenantId, id, body);
  }

  @Delete('games/:id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  deleteGame(@Request() req: any, @Param('id') id: string) {
    return this.sports.deleteGame(req.user.tenantId, id);
  }

  // ── live game control (operators + admins) ────────────────────

  @Patch('games/:id/score')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  adjustScore(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { team?: string; delta?: number; homeScore?: number; awayScore?: number },
  ) {
    // delta present → quick-button increment; otherwise → absolute set.
    if (typeof body.delta === 'number') {
      return this.sports.adjustScore(req.user.tenantId, id, body);
    }
    return this.sports.setScore(req.user.tenantId, id, body);
  }

  @Patch('games/:id/clock')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  clock(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { action?: string; ms?: number },
  ) {
    return this.sports.clockAction(req.user.tenantId, id, body);
  }

  @Patch('games/:id/segment')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  segment(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { segment?: number; delta?: number },
  ) {
    return this.sports.setSegment(req.user.tenantId, id, body);
  }

  @Patch('games/:id/stats')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  stats(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { stats?: Record<string, unknown> },
  ) {
    return this.sports.updateStats(req.user.tenantId, id, body);
  }

  /** Set or clear the broadcast spotlight (featured player / promo). */
  @Patch('games/:id/spotlight')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  spotlight(
    @Request() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      clear?: boolean;
      visible?: boolean;
      title?: string;
      photoUrl?: string;
      subtitle?: string;
      lines?: Array<{ label?: string; value?: string }>;
    },
  ) {
    return this.sports.setSpotlight(req.user.tenantId, id, body);
  }

  @Patch('games/:id/status')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  status(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { status?: string },
  ) {
    return this.sports.setStatus(req.user.tenantId, id, body);
  }

  /** Fire a celebration cue — every surface playing this game animates. */
  @Post('games/:id/cue')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  cue(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { key?: string },
  ) {
    return this.sports.fireCue(req.user.tenantId, id, body);
  }

  // ── scoreboard-to-screen push ────────────────────────────────

  /** Tenant's screens + whether each is currently showing this game. */
  @Get('games/:id/screens')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  gameScreens(@Request() req: any, @Param('id') id: string) {
    return this.sports.listGameScreens(req.user.tenantId, id);
  }

  /** Push this game to the selected screens on a chosen surface
   *  (BOARD scoreboard | RIBBON LED strip | SCOREBUG overlay). */
  @Post('games/:id/show')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  showOnScreens(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { screenIds?: string[]; surface?: string },
  ) {
    return this.sports.showOnScreens(
      req.user.tenantId,
      id,
      body?.screenIds,
      body?.surface,
    );
  }

  /** Stop showing this game — on the given screens, or all of them. */
  @Post('games/:id/hide')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  hideFromScreens(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { screenIds?: string[] },
  ) {
    return this.sports.hideFromScreens(req.user.tenantId, id, body?.screenIds);
  }
}
