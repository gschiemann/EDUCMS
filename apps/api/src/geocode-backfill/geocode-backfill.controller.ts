import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { GeocodeBackfillService } from './geocode-backfill.service';

interface GeocodeBackfillRequestBody {
  /** Default true (safe). Only `false` writes lat/lng. */
  dryRun?: boolean;
  /** Cap on tenants processed this call. Service defaults to 50, hard
   *  ceiling 500 — see GeocodeBackfillService.sanitizeLimit. */
  limit?: number;
  /** Optional — restrict to one tenant. */
  tenantId?: string;
}

/**
 * Task #60 — SUPER_ADMIN-only trigger for the legacy Tenant lat/lng
 * back-fill (Tenant.address set, Tenant.latitude/longitude both null —
 * rows that predate the 2026-05-25 fleet-map address fields).
 *
 * `POST /api/v1/admin/geocode-backfill` — NOT wired to any cron/scheduler
 * and NOT called anywhere else in the app. This is a manually-triggered,
 * owner-only maintenance action. See
 * docs/research/2026-07-03-overnight-fixes/08-geocode-backfill.md for the
 * dry-run-first runbook.
 *
 * Guard pattern matches SuperLicenseController (@RequireRoles(SUPER_ADMIN),
 * JwtAuthGuard + RbacGuard) — RbacGuard's SUPER_ADMIN passthrough means no
 * tenancy-scope check is needed here (this endpoint is intentionally
 * cross-tenant).
 */
@Controller('api/v1/admin/geocode-backfill')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(AppRole.SUPER_ADMIN)
export class GeocodeBackfillController {
  constructor(private readonly backfill: GeocodeBackfillService) {}

  @Post()
  async run(@Body() body: GeocodeBackfillRequestBody, @Req() req: any) {
    try {
      const actorUserId: string | undefined = req?.user?.id;
      const summary = await this.backfill.run({
        dryRun: body?.dryRun,
        limit: body?.limit,
        tenantId: body?.tenantId,
        actorUserId,
      });
      return { success: true, ...summary };
    } catch (e: any) {
      throw new HttpException(
        {
          code: 'GEOCODE_BACKFILL_RUN_FAILED',
          message: e?.message || 'Geocode backfill run failed.',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
