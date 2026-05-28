import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { SportsService } from './sports.service';
import { SponsorsService } from './sponsors.service';
import { makeFeedToken } from './sports-feed-token';

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
  constructor(
    private readonly sports: SportsService,
    private readonly sponsors: SponsorsService,
  ) {}

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

  /**
   * T2-9: Per-game sponsor delivery report — real impression counts.
   *
   * Returns actual airings per sponsor per surface (board / ribbon /
   * scorebug), aggregated from SponsorImpression rows written during the
   * game. Also reports cap compliance so an operator can catch
   * over-delivery before sending a proof-of-play PDF to the sponsor.
   *
   * Response shape:
   *   { gameId, gameStartedAt, gameDurationMin,
   *     sponsors: [{ sponsorId, name, board, ribbon, scorebug, total,
   *                  capCompliant }] }
   */
  @Get('games/:id/sponsor-report')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  async gameSponsorReport(@Request() req: any, @Param('id') id: string) {
    const result = await this.sponsors.gameReport(req.user.tenantId, id);
    if (!result) {
      throw new NotFoundException('Game not found');
    }
    return result;
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

  /**
   * Clone a game's full presentation setup into a fresh SCHEDULED game
   * — "build one game's content, run a week of games off it." Same
   * roles as create (it creates a game).
   */
  @Post('games/:id/duplicate')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  duplicateGame(@Request() req: any, @Param('id') id: string) {
    return this.sports.duplicateGame(req.user.tenantId, id);
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
      return this.sports.adjustScore(req.user.tenantId, id, body, req?.user?.id);
    }
    return this.sports.setScore(req.user.tenantId, id, body, req?.user?.id);
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

  /**
   * Sprint 13 — CTS console snapshot ingest (operator-auth path).
   *
   * Sibling of the unauthenticated `POST /api/v1/sports/board/:id/
   * cts-snapshot` (which uses the x-feed-token HMAC). This guarded
   * variant accepts the operator's dashboard JWT so a future
   * operator-side test or playback tool can push synthetic snapshots
   * without provisioning a feed token. Both endpoints converge on
   * `SportsService.ingestCtsSnapshot`, which is the single source of
   * truth for the write — no behavior drift between the two paths.
   *
   * Writes ONLY to `Game.stats.cts` — the persistent operator-input
   * columns (`homeScore`, `clockMs`, etc.) stay untouched so the
   * manual chips in the Run console keep working when CTS is stale.
   */
  @Post('games/:id/cts-snapshot')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  ctsSnapshot(
    @Request() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      clockMs?: number;
      clockRunning?: boolean;
      segment?: number;
      homeScore?: number;
      awayScore?: number;
      shotClock?: { ms: number; running: boolean; len?: number; at?: string };
      horn?: boolean;
      raw?: string;
    },
  ) {
    return this.sports.ingestCtsSnapshot(id, (body || {}) as Record<string, unknown>, {
      tenantId: req.user.tenantId,
      actorUserId: req.user.id,
      source: 'cts-operator',
    });
  }

  /**
   * Feed credentials for EXTERNAL score ingestion — the operator copies this
   * URL + token into their feed vendor (Sportzcast/Scorebird console box, a
   * serial-reader bridge, or a custom script) so live score/clock flows in
   * machine-to-machine, no dashboard login. The token is a stateless
   * game-scoped HMAC (see sports-feed-token.ts); ownership is verified here
   * before we hand it out. Posts go to the PUBLIC board controller's
   * /feed route, which re-verifies the token.
   */
  @Get('games/:id/feed-credentials')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async feedCredentials(@Request() req: any, @Param('id') id: string) {
    // Ownership check (throws NotFound if the game isn't this tenant's).
    await this.sports.assertGameOwned(req.user.tenantId, id);
    const token = makeFeedToken(id);
    const host = req.get?.('host') || process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost';
    const proto = (req.headers?.['x-forwarded-proto'] as string) || req.protocol || 'https';
    const ingestUrl = `${proto}://${host}/api/v1/sports/board/${id}/feed`;
    return {
      gameId: id,
      ingestUrl,
      tokenHeader: 'x-feed-token',
      token,
      // Copy-paste example for the vendor / a quick test.
      curlExample:
        `curl -X POST "${ingestUrl}" ` +
        `-H "x-feed-token: ${token}" -H "Content-Type: application/json" ` +
        `-d '{"homeScore":14,"awayScore":7,"clockMs":420000,"clockRunning":true,"segment":2}'`,
      accepts: ['homeScore', 'awayScore', 'clockMs', 'clockRunning', 'segment'],
      note: 'Any subset of fields may be sent; omitted fields are unchanged. Rate limit: 40 requests / 10s per game.',
    };
  }

  /**
   * Call a timeout for a team. Atomically: decrements home/awayTimeouts
   * (refuses with 400 if already 0), pauses the game clock, resets the
   * football play clock to 25s for football games, appends a TIMEOUT
   * GameEvent, fires a 'timeout' CUE overlay, and writes an AuditLog row.
   *
   * Body: `{ team: 'home' | 'away', type?: 'full' | 'short' }`
   */
  @Post('games/:id/timeout')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  callTimeout(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { team?: string; type?: string },
  ) {
    return this.sports.callTimeout(req.user.tenantId, id, body || {}, req?.user?.id);
  }

  /**
   * T2-8: Set possession — 'home' or 'away'.
   *
   * Writes to Game.possession (dedicated column, not a stat field).
   * Atomically: updates the column, writes a POSSESSION GameEvent for
   * the forensic trail, and an AuditLog row. The operator console shows
   * a tap-to-flip POSS chip between the two score tiles; display surfaces
   * (board, ribbon, scorebug) read Game.possession first and fall back to
   * stats.possession for backward compat.
   *
   * Body: `{ team: 'home' | 'away' }`
   */
  @Post('games/:id/possession')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  setPossession(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { team?: string },
  ) {
    return this.sports.setPossession(req.user.tenantId, id, body || {}, req?.user?.id);
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
      // Lane-8 P1: scoring team for branded celebration overlay. Optional;
      // AUTO path already sets this; manual cues now can too.
      team?: 'home' | 'away';
      // 2026-05-27 — player attribution for the celebration; the
      // ribbon's RunInlineCuesBar attaches the currently-spotlit
      // player so cinematics can show "SCORED BY #12 SMITH".
      scorerName?: string;
      scorerNumber?: string;
      scorerPhotoUrl?: string;
      scorerId?: string;
    },
  ) {
    return this.sports.fireCue(req.user.tenantId, id, body, req?.user?.id);
  }

  // ── T2-5: live-game text overlay ─────────────────────────────

  /**
   * Fire a live-game text overlay banner. Four kinds:
   *   • penalty       — "HOLDING #44 — 10 YDS" lower-third
   *   • review        — "OFFICIAL REVIEW" persistent banner
   *   • injury        — "INJURY TIMEOUT" (auto-clears on clock start)
   *   • timeout-banner — "AWAY TIMEOUT — 2 LEFT" fly-in pill
   *
   * Body: `{ kind, payload }` where payload shape depends on kind.
   */
  @Post('games/:id/live-overlay')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  liveOverlay(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { kind?: string; payload?: Record<string, unknown> },
  ) {
    return this.sports.fireLiveOverlay(
      req.user.tenantId,
      id,
      { kind: body?.kind ?? '', payload: body?.payload },
      req?.user?.id,
    );
  }

  /**
   * Clear the currently-visible live overlay. Writes a clearing event;
   * the board resolves the latest LIVE_OVERLAY event so this takes
   * effect on the next 750ms poll.
   */
  @Post('games/:id/live-overlay/clear')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  clearLiveOverlay(@Request() req: any, @Param('id') id: string) {
    return this.sports.clearLiveOverlay(req.user.tenantId, id, req?.user?.id);
  }

  /** Read the AUTO-celebrate toggle — whether a live score feed should
   *  auto-fire the matching celebration on a score jump. */
  @Get('games/:id/auto-celebrate')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  getAutoCelebrate(@Request() req: any, @Param('id') id: string) {
    return this.sports.getAutoCelebrate(req.user.tenantId, id);
  }

  /** Flip the AUTO-celebrate toggle for a game. When on (default), a live
   *  score feed reporting a standout score jump (touchdown, three-pointer,
   *  goal, grand slam) auto-fires that celebration on every surface. */
  @Post('games/:id/auto-celebrate')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  setAutoCelebrate(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { enabled?: boolean },
  ) {
    return this.sports.setAutoCelebrate(req.user.tenantId, id, body?.enabled);
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

  // ── Undo rail ─────────────────────────────────────────────────

  /**
   * Recent events for the undo rail. Returns the last N (default 25)
   * GameEvent rows in reverse-chronological order, annotated with
   * `undoable: boolean` so the UI can render an Undo button per row.
   *
   * RBAC: same as every other game-control endpoint (CONTRIBUTOR and
   * above). Read-only — safe to call frequently.
   */
  @Get('games/:id/events')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  getEvents(
    @Request() req: any,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const lim = limit ? Math.min(50, Math.max(1, parseInt(limit, 10) || 25)) : 25;
    return this.sports.getEvents(req.user.tenantId, id, lim);
  }

  /**
   * T2-4: Fire the pre-game starting-lineup choreography.
   *
   * Fetches the roster for the requested team, writes a CUE GameEvent
   * with key 'pregame-intro' and the full lineup payload, and returns
   * immediately. The board page's existing 750ms cue-pump picks it up
   * and hands it to CelPregameIntroWidget for a 30-second per-player
   * cinematic scoreboard takeover.
   *
   * RBAC: same as fireCue — any operator role can fire the intro.
   */
  @Post('games/:id/pregame-intro')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  pregameIntro(
    @Request() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      team?: 'home' | 'away';
      audioUrl?: string;
      slotMs?: number;
      skippable?: boolean;
    },
  ) {
    return this.sports.firePregameIntro(
      req.user.tenantId,
      id,
      body || {},
      req?.user?.id,
    );
  }

  /**
   * Undo a specific GameEvent by id. Synthesizes the inverse mutation
   * and applies it via the existing PATCH endpoints, then records a
   * `UNDO_<TYPE>` event with `payload.undoOf = <eventId>`.
   *
   * Returns 422 with `{ code: "BUG_NOT_UNDOABLE", reason }` for CUE,
   * system auto-advance, undo-of-undo, or pre-rail events that lack
   * prev-state in their payload.
   */
  @Post('games/:id/events/:eventId/undo')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  undoEvent(
    @Request() req: any,
    @Param('id') id: string,
    @Param('eventId') eventId: string,
  ) {
    return this.sports.undoEvent(req.user.tenantId, id, eventId);
  }
}
