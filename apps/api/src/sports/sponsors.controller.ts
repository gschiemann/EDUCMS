import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Headers,
  Param,
  Request,
  UseGuards,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { SponsorsService } from './sponsors.service';
import { RedisService } from '../realtime/redis.service';
// SEC-007 (2026-09-04) — proof-of-play beacon authenticity.
import { resolveBeaconAttestation, type BeaconReplayRedis } from './beacon-capability';

/**
 * VenueOS Sports — Sprint 13 Phase 2. Sponsorship API.
 *
 * Tenant-scoped sponsor CRUD + the proof-of-play report. Selling and
 * managing ad inventory is an admin function, so mutations are gated
 * to the three admin roles; reads (list + report) are open to every
 * role so an operator can glance at who is on the board.
 *
 * AUTH MODEL — method-level guards, NOT class-level (P0, 2026-05-28).
 * Every CRUD + report method carries `@UseGuards(JwtAuthGuard, RbacGuard)`
 * individually; the ONLY un-guarded method is `POST :sponsorId/impression`.
 * That single route is the PUBLIC proof-of-play write path — the stadium
 * board / ribbon render with no dashboard session and fire-and-forget an
 * impression each time a sponsor look enters view, so they send no auth
 * header. With the old class-level guard every one of those POSTs 401'd
 * (swallowed by the page's `.catch`), so `SponsorImpression` was NEVER
 * written and the real per-game `gameReport` was permanently all-zeros.
 *
 * This mirrors the documented `PosOAuthController` pattern (a JWT-guarded
 * `authorize` method alongside public OAuth-callback / webhook methods on
 * one controller) so an audit can see at a glance which routes skip auth
 * and exactly why — rather than threading a `@Public()` opt-out through
 * the app-wide auth guard (which also sits on the life-safety emergency
 * path and must not change). The public route is still validated
 * server-side: `recordImpression` only writes when the sponsor and game
 * resolve to the SAME tenant, so an anonymous caller cannot forge rows
 * across tenants — at worst it inflates its own game's counts.
 *
 * Path `api/v1/sports/sponsors` is a distinct literal segment — no
 * collision with the `games` / `board` / `definitions` routes.
 */
@Controller('api/v1/sports/sponsors')
export class SponsorsController {
  constructor(
    private readonly sponsors: SponsorsService,
    /**
     * SEC-007 — the beacon replay claim needs SHARED state. Optional so the
     * controller stays constructible in unit tests and on a Redis-less dev
     * box, where the module falls back to a per-replica claim (documented in
     * `beacon-capability.ts` as strictly weaker, never as equivalent).
     */
    private readonly redis?: RedisService,
  ) {}

  private beaconRedis(): BeaconReplayRedis | null {
    return (this.redis?.publisher as unknown as BeaconReplayRedis) ?? null;
  }

  // Per-game in-memory rate limit for the PUBLIC impression beacon (Audit
  // 37-infra R-1). The old code claimed an "nginx / infra layer" handled
  // this, but railway.json runs no nginx — so the only ceiling was the
  // global 600/min/IP. Anyone holding a board's (game UUID) could inflate
  // proof-of-play counts and amplify DB writes. A real board fires a
  // handful of impressions/sec across all sponsors; 80/10s/game is generous
  // headroom while capping a flood from a single known game id. Sliding
  // 10s window. Memory-only (per-replica) — acceptable: it bounds DB-write
  // amplification per pod, and the value is informational, not life-safety.
  private readonly impressionHits = new Map<string, number[]>();
  private static readonly IMPRESSION_WINDOW_MS = 10_000;
  private static readonly IMPRESSION_MAX_PER_WINDOW = 80;

  @Get()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  list(@Request() req: any) {
    return this.sponsors.list(req.user.tenantId);
  }

  /** Proof-of-play — estimated spots + exposure per sponsor (tenant-wide). */
  @Get('report')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  report(@Request() req: any) {
    return this.sponsors.report(req.user.tenantId);
  }

  /**
   * T2-9: Per-impression log endpoint. PUBLIC — no `@UseGuards` (P0,
   * 2026-05-28).
   *
   * Called fire-and-forget from the board / ribbon / scorebug pages each
   * time a sponsor look enters view. Those surfaces render with no dashboard
   * session, so they send no Bearer token; this is the one sponsor route
   * that must accept an anonymous POST. Before this route was un-guarded it
   * inherited the controller's class-level JwtAuthGuard and every POST 401'd
   * — so `SponsorImpression` was never written and the real per-game report
   * was permanently empty.
   *
   * Validated server-side: `recordImpression` resolves both the sponsor and
   * the game and only writes when they share a tenant, so an anonymous caller
   * cannot write a row that crosses tenants. The worst it can do is inflate
   * the counts of a game it already knows the (unguessable UUID) id of.
   * Per-game in-memory rate limit (80/10s) caps that abuse and the DB-write
   * amplification it would otherwise allow (Audit 37-infra R-1) — there is
   * NO nginx layer on Railway, contrary to the prior comment.
   *
   * SEC-007 (2026-09-04) — "at worst it inflates its own game's counts" is
   * the whole problem, not a consolation: these counts ARE the proof-of-play
   * a sponsor renewal is argued from, and a volume cap is not an authenticity
   * control. A beacon may now present a signed capability
   * (`x-venueos-beacon` + `x-venueos-beacon-seq`) minted at
   * `POST /sports/board/:id/beacon-capability`, which binds the screen, its
   * credential epoch, the game, the scope, an expiry and a one-shot sequence
   * claimed in Redis. Rows written with one are recorded as VERIFIED and are
   * the only ones the report presents as measured evidence. Anonymous posts
   * are still accepted (an OBS overlay has no credential to offer) but are
   * recorded — and reported — as unverified.
   */
  @Post(':sponsorId/impression')
  async impression(
    @Param('sponsorId') sponsorId: string,
    @Headers('x-venueos-beacon') beaconCapability: string | undefined,
    @Headers('x-venueos-beacon-seq') beaconSeq: string | undefined,
    @Body() body: { gameId?: string; surfaceKind?: string },
  ) {
    if (!body || typeof body.gameId !== 'string' || !body.gameId) {
      throw new HttpException({ code: 'SPONSOR_GAME_ID_REQUIRED', message: 'gameId is required' }, HttpStatus.BAD_REQUEST);
    }

    // Per-game sliding-window rate limit. Keyed by game id (the natural
    // proof-of-play unit) so one busy game can't starve another, and a leaked
    // game id can't be used to flood the DB. Prune-then-check-then-record.
    const now = Date.now();
    const recent = (this.impressionHits.get(body.gameId) || []).filter(
      (t) => t > now - SponsorsController.IMPRESSION_WINDOW_MS,
    );
    if (recent.length >= SponsorsController.IMPRESSION_MAX_PER_WINDOW) {
      this.impressionHits.set(body.gameId, recent);
      throw new HttpException({ code: 'SPONSOR_IMPRESSION_RATE_LIMITED', message: 'Impression rate limit exceeded' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.impressionHits.set(body.gameId, recent);

    // 'stream' is the broadcast stream-overlay surface (/overlay + /scorebug
    // sponsor strap) — kept distinct from 'scorebug' so the per-surface
    // proof-of-play report attributes off-site stream impressions correctly
    // instead of clamping them into the in-venue 'board' bucket.
    const surfaceKind = ['board', 'ribbon', 'scorebug', 'stream'].includes(body.surfaceKind ?? '')
      ? (body.surfaceKind as string)
      : 'board';

    // SEC-007 — provenance gate. Awaited (unlike the write below) because a
    // forged or replayed capability must be REFUSED, not fire-and-forgotten:
    // the replay claim is the thing that makes a captured beacon single-use,
    // and it lives in Redis so the guarantee holds across replicas.
    const beacon = await resolveBeaconAttestation(
      this.beaconRedis(),
      { capability: beaconCapability, seq: beaconSeq },
      { gameId: body.gameId, scope: 'impression', now },
    );
    if (!beacon.ok) {
      throw new HttpException({ code: beacon.code, message: 'Beacon rejected' }, beacon.status);
    }

    // Fire-and-forget — never await, never fail the response.
    void this.sponsors.recordImpression(sponsorId, body.gameId, surfaceKind, beacon.attestation);
    return { ok: true, verified: beacon.attestation.verified };
  }

  @Post()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  create(
    @Request() req: any,
    @Body()
    body: {
      name?: string;
      logoUrl?: string | null;
      tagline?: string | null;
      color?: string | null;
      tier?: string | null;
      weight?: number;
      active?: boolean;
      /** ISO-8601 string; null = no start bound. */
      flightStartAt?: string | null;
      flightEndAt?: string | null;
      /** Max airings per hour; omit or null = uncapped. */
      frequencyCapPerHour?: number | null;
    },
  ) {
    // P0-4 — pass the actor so the SPONSOR_CREATED AuditLog row is
    // attributable to a user, not just a tenant.
    return this.sponsors.create(req.user.tenantId, body, req.user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  update(
    @Request() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      logoUrl?: string | null;
      tagline?: string | null;
      color?: string | null;
      tier?: string | null;
      weight?: number;
      active?: boolean;
      flightStartAt?: string | null;
      flightEndAt?: string | null;
      frequencyCapPerHour?: number | null;
    },
  ) {
    return this.sponsors.update(req.user.tenantId, id, body, req.user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  remove(@Request() req: any, @Param('id') id: string) {
    return this.sponsors.remove(req.user.tenantId, id, req.user.id);
  }
}
