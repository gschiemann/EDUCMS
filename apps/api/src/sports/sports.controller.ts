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

/** Editable fields for one roster player. The service sanitizes every
 *  value — the photo URL is produced by the existing /assets/upload. */
type RosterPlayerBody = {
  team?: string;
  name?: string;
  number?: string;
  position?: string;
  photoUrl?: string;
  stats?: Record<string, string>;
};

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
      // Sprint 13 — operator-picked scoreboard / ribbon / scorebug
      // template IDs. Each is optional; null falls back to the
      // hardcoded legacy layout in apps/web/src/app/board|ribbon|scorebug.
      scoreboardTemplateId?: string | null;
      ribbonTemplateId?: string | null;
      scorebugTemplateId?: string | null;
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
      // Sprint 13 — template re-assignment is editable any time.
      scoreboardTemplateId?: string | null;
      ribbonTemplateId?: string | null;
      scorebugTemplateId?: string | null;
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

  /** Basketball shot clock — configure the length (24/30/35/off) or
   *  start / stop / reset the live countdown. */
  @Patch('games/:id/shot-clock')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  shotClock(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { action?: string; value?: number },
  ) {
    return this.sports.setShotClock(req.user.tenantId, id, body);
  }

  /** Football play clock — start / stop / reset the 40-25 countdown
   *  between snaps. */
  @Patch('games/:id/play-clock')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  playClock(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { action?: string; value?: number },
  ) {
    return this.sports.setPlayClock(req.user.tenantId, id, body);
  }

  /** Penalty box — hockey / lacrosse / field hockey / water polo.
   *  add a timed penalty for a team, remove one early (power-play
   *  goal), or clear the box. Penalties run / freeze with the game
   *  clock. */
  @Patch('games/:id/penalties')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  penalties(
    @Request() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      action?: string;
      team?: string;
      penaltyId?: string;
      lenSec?: number;
      label?: string;
      player?: string;
    },
  ) {
    return this.sports.setPenalties(req.user.tenantId, id, body);
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

  /**
   * External score ingestion — accepts a pushed game state from a
   * console tap-off box or a league-feed adapter. Any subset of fields
   * may be provided; omitted fields are left unchanged. Clock fields
   * are re-anchored automatically. An INGEST GameEvent is appended for
   * the audit trail and broadcast via signed pub/sub to all surfaces.
   */
  @Post('games/:id/ingest')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  ingest(
    @Request() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      homeScore?: number;
      awayScore?: number;
      clockMs?: number;
      clockRunning?: boolean;
      segment?: number;
    },
  ) {
    return this.sports.ingest(req.user.tenantId, id, body || {});
  }

  /** Fire a cue — a sport celebration (`key`) or a custom cue
   *  (`cueId`). Every surface playing this game plays it.
   *  Optional: `audioUrl` plays a sound; `sponsorName` + `sponsorLogoUrl`
   *  overlay a co-branded attribution line ("brought to you by …"). */
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
    @Body()
    body: {
      key?: string;
      cueId?: string;
      target?: string;
      audioUrl?: string;
      sponsorName?: string;
      sponsorLogoUrl?: string;
    },
  ) {
    return this.sports.fireCue(req.user.tenantId, id, body);
  }

  /** Set the stadium ribbon's custom message reel — operator-typed
   *  lines that scroll on the ribbon in place of the default prompts. */
  @Patch('games/:id/ribbon')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  ribbon(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { messages?: string[] },
  ) {
    return this.sports.setRibbon(req.user.tenantId, id, body);
  }

  /** Set which content presets ride the stadium ribbon reel — score,
   *  clock, period, game situation, crowd messages, roster, sponsors. */
  @Patch('games/:id/ribbon-presets')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  ribbonPresets(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { presets?: string[] },
  ) {
    return this.sports.setRibbonPresets(req.user.tenantId, id, body);
  }

  /** Set how fast the stadium ribbon reel scrolls. */
  @Patch('games/:id/ribbon-speed')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  ribbonSpeed(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { speed?: string },
  ) {
    return this.sports.setRibbonSpeed(req.user.tenantId, id, body);
  }

  /** Set the ribbon's full-bleed image slides — operator-uploaded
   *  images (sponsor banners, promos) that fill the whole ribbon. */
  @Patch('games/:id/ribbon-slides')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  ribbonSlides(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { slides?: string[] },
  ) {
    return this.sports.setRibbonSlides(req.user.tenantId, id, body);
  }

  /** Set how many times the score repeats around the stadium ribbon —
   *  one scorebug for a straight ribbon, or a recurring score for a
   *  continuous full-bowl wrap. */
  @Patch('games/:id/ribbon-score')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  ribbonScoreRepeat(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { repeat?: string },
  ) {
    return this.sports.setRibbonScoreRepeat(req.user.tenantId, id, body);
  }

  // ── cue deck (custom triggers) ───────────────────────────────

  /** The tenant's reusable cue deck. */
  @Get('cues')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  listCues(@Request() req: any) {
    return this.sports.listCues(req.user.tenantId);
  }

  /** Create a custom cue (a named trigger + its takeover content). */
  @Post('cues')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  createCue(
    @Request() req: any,
    @Body() body: { name?: string; mediaUrl?: string; color?: string; durationMs?: number ; displayMode?: string },
  ) {
    return this.sports.createCue(req.user.tenantId, body || {});
  }

  /** Edit a custom cue. */
  @Patch('cues/:cueId')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  updateCue(
    @Request() req: any,
    @Param('cueId') cueId: string,
    @Body() body: { name?: string; mediaUrl?: string; color?: string; durationMs?: number ; displayMode?: string },
  ) {
    return this.sports.updateCue(req.user.tenantId, cueId, body || {});
  }

  /** Remove a custom cue from the deck. */
  @Delete('cues/:cueId')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  deleteCue(@Request() req: any, @Param('cueId') cueId: string) {
    return this.sports.deleteCue(req.user.tenantId, cueId);
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
    @Body() body: { screenIds?: string[]; surface?: string; force?: boolean },
  ) {
    return this.sports.showOnScreens(
      req.user.tenantId,
      id,
      body?.screenIds,
      body?.surface,
      body?.force,
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

  // ── roster ───────────────────────────────────────────────────

  /** Every player on a game's roster (home + away). */
  @Get('games/:id/roster')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  listRoster(@Request() req: any, @Param('id') id: string) {
    return this.sports.listRoster(req.user.tenantId, id);
  }

  /** Add a player to a game's roster. */
  @Post('games/:id/roster')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  addPlayer(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: RosterPlayerBody,
  ) {
    return this.sports.addPlayer(req.user.tenantId, id, body || {});
  }

  /** Bulk-import a roster from CSV text (a header row + player rows). */
  @Post('games/:id/roster/import')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  importRoster(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { csv?: string },
  ) {
    return this.sports.importRosterCsv(req.user.tenantId, id, body?.csv || '');
  }

  /** Edit one roster player. */
  @Patch('games/:id/roster/:playerId')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  updatePlayer(
    @Request() req: any,
    @Param('id') id: string,
    @Param('playerId') playerId: string,
    @Body() body: RosterPlayerBody,
  ) {
    return this.sports.updatePlayer(req.user.tenantId, id, playerId, body || {});
  }

  /** Remove a player from the roster. */
  @Delete('games/:id/roster/:playerId')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  deletePlayer(
    @Request() req: any,
    @Param('id') id: string,
    @Param('playerId') playerId: string,
  ) {
    return this.sports.deletePlayer(req.user.tenantId, id, playerId);
  }
}
