import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import {
  StudentPrivacyService,
  type PrivacyCaller,
} from './student-privacy.service';

/**
 * Student information on public screens (K-12 sports launch, lane B3,
 * 2026-09-27). The enforcement lives in ./student-privacy.ts (every public
 * output); these routes record the school's decision. The route guard is the
 * coarse gate; StudentPrivacyService applies the fine one (a confirmation is a
 * school administrator's, a stricter change is open to more roles) — see its
 * header.
 *
 * Tenant scope: every route acts on `req.user.tenantId` — the caller's own
 * location — and the per-student route re-proves the game and the player
 * belong to it (StudentPrivacyService.setStudentFlags).
 */
/** What the guards leave on the request. */
interface AuthedRequest {
  user: { tenantId: string } & Record<string, unknown>;
}

function callerOf(req: AuthedRequest): PrivacyCaller {
  const u = req.user;
  return {
    userId: typeof u.id === 'string' ? u.id : null,
    role: typeof u.role === 'string' ? u.role : '',
    apiKeyId: typeof u.apiKeyId === 'string' ? u.apiKeyId : null,
  };
}

@Controller('api/v1/sports')
@UseGuards(JwtAuthGuard, RbacGuard)
export class StudentPrivacyController {
  constructor(private readonly privacy: StudentPrivacyService) {}

  /** The location's settings, where they come from, and the wording to confirm. */
  @Get('student-privacy')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  get(@Request() req: AuthedRequest) {
    return this.privacy.getSettings(req.user.tenantId, callerOf(req));
  }

  /** A non-K-12 location says whether its athletes include minors. Declared
   *  before `:category` so Express never reads "serves-minors" as a category. */
  @Put('student-privacy/serves-minors')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
  )
  setServesMinors(
    @Request() req: AuthedRequest,
    @Body() body: { servesMinors?: unknown },
  ) {
    return this.privacy.setServesMinors(
      req.user.tenantId,
      callerOf(req),
      body?.servesMinors,
    );
  }

  /** Confirm / revoke / hide / un-hide names or photos at this location. */
  @Put('student-privacy/:category')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
  )
  setCategory(
    @Request() req: AuthedRequest,
    @Param('category') category: string,
    @Body() body: { action?: unknown; version?: unknown },
  ) {
    return this.privacy.setCategory(
      req.user.tenantId,
      callerOf(req),
      category,
      body?.action,
      body?.version,
    );
  }

  /** "Directory opt-out — never display" / "Photo release on file" for one roster student. */
  @Patch('games/:id/roster/:playerId/privacy')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  setStudentFlags(
    @Request() req: AuthedRequest,
    @Param('id') gameId: string,
    @Param('playerId') playerId: string,
    @Body() body: unknown,
  ) {
    return this.privacy.setStudentFlags(
      req.user.tenantId,
      gameId,
      playerId,
      callerOf(req),
      body,
    );
  }
}
