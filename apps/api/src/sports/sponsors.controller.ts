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
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { SponsorsService } from './sponsors.service';

/**
 * VenueOS Sports — Sprint 13 Phase 2. Sponsorship API.
 *
 * Tenant-scoped sponsor CRUD + the proof-of-play report. Selling and
 * managing ad inventory is an admin function, so mutations are gated
 * to the three admin roles; reads (list + report) are open to every
 * role so an operator can glance at who is on the board.
 *
 * Path `api/v1/sports/sponsors` is a distinct literal segment — no
 * collision with the `games` / `board` / `definitions` routes.
 */
@Controller('api/v1/sports/sponsors')
@UseGuards(JwtAuthGuard, RbacGuard)
export class SponsorsController {
  constructor(private readonly sponsors: SponsorsService) {}

  @Get()
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
   * T2-9: Per-impression log endpoint.
   *
   * Called fire-and-forget from the board / ribbon / scorebug pages each
   * time a sponsor look enters view. High write volume during games.
   * Un-authenticated by design — this is the PUBLIC surface controller path;
   * sponsorId scoping is sufficient (a bad actor can only inflate counts,
   * not read private data). Rate-limit is handled at the nginx / infra layer.
   */
  @Post(':sponsorId/impression')
  async impression(
    @Param('sponsorId') sponsorId: string,
    @Body() body: { gameId?: string; surfaceKind?: string },
  ) {
    if (!body || typeof body.gameId !== 'string' || !body.gameId) {
      throw new HttpException('gameId is required', HttpStatus.BAD_REQUEST);
    }
    const surfaceKind = ['board', 'ribbon', 'scorebug'].includes(body.surfaceKind ?? '')
      ? (body.surfaceKind as string)
      : 'board';
    // Fire-and-forget — never await, never fail the response.
    void this.sponsors.recordImpression(sponsorId, body.gameId, surfaceKind);
    return { ok: true };
  }

  @Post()
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
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  remove(@Request() req: any, @Param('id') id: string) {
    return this.sponsors.remove(req.user.tenantId, id, req.user.id);
  }
}
