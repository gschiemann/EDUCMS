/**
 * MenuAdminController — operator-facing price-book console REST API.
 * ──────────────────────────────────────────────────────────────────────
 *
 *   GET    /api/v1/menu/catalog                                  — grid rows
 *   GET    /api/v1/menu/locations                                — grid columns
 *   GET    /api/v1/menu/overrides                                — every cell override
 *   PUT    /api/v1/menu/overrides/:locationTenantId/:menuItemId  — upsert one
 *   DELETE /api/v1/menu/overrides/:locationTenantId/:menuItemId  — revert one
 *   POST   /api/v1/menu/overrides/bulk                           — apply across many
 *   POST   /api/v1/menu/import                                   — operator {menu} import
 *
 * Contract: apps/web/src/lib/menu/menu-console-api.ts (the frontend is
 * already on master — this matches its paths / bodies / response shapes).
 *
 * RBAC: reads are open to any signed-in role in the tenant; mutations are
 * ADMIN+ only (SUPER_ADMIN / DISTRICT_ADMIN / SCHOOL_ADMIN). Tenant is
 * always derived from req.user (JwtStrategy → { userId, tenantId, role }),
 * never from the body. Matches PosController's guard + role pattern.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { MenuAdminService, type OverridePatch } from './menu-admin.service';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/menu')
export class MenuAdminController {
  constructor(private readonly svc: MenuAdminService) {}

  // ─── Reads (any signed-in role in the tenant) ─────────────────────

  @Get('catalog')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  listCatalog(@Request() req: any) {
    return this.svc.listCatalog(req.user.tenantId);
  }

  @Get('locations')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  listLocations(@Request() req: any) {
    return this.svc.listLocations(req.user.tenantId);
  }

  @Get('overrides')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  listOverrides(@Request() req: any) {
    return this.svc.listOverrides(req.user.tenantId);
  }

  // ─── Mutations (ADMIN+ only) ──────────────────────────────────────

  @Put('overrides/:locationTenantId/:menuItemId')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
  )
  setOverride(
    @Request() req: any,
    @Param('locationTenantId') locationTenantId: string,
    @Param('menuItemId') menuItemId: string,
    @Body() patch: OverridePatch,
  ) {
    return this.svc.setOverride(
      req.user.tenantId,
      req.user.userId ?? null,
      locationTenantId,
      menuItemId,
      patch ?? {},
    );
  }

  @Delete('overrides/:locationTenantId/:menuItemId')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
  )
  async revertOverride(
    @Request() req: any,
    @Param('locationTenantId') locationTenantId: string,
    @Param('menuItemId') menuItemId: string,
  ) {
    await this.svc.deleteOverride(
      req.user.tenantId,
      req.user.userId ?? null,
      locationTenantId,
      menuItemId,
    );
    return { success: true };
  }

  @Post('overrides/bulk')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
  )
  bulkSetOverride(
    @Request() req: any,
    @Body()
    body: {
      menuItemId?: string;
      locationTenantIds?: string[];
      patch?: OverridePatch;
    },
  ) {
    return this.svc.bulkSetOverride(
      req.user.tenantId,
      req.user.userId ?? null,
      body ?? {},
    );
  }

  @Post('import')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
  )
  // Self-serve import — bound the abuse surface (parsing + many upserts).
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  importMenu(
    @Request() req: any,
    @Body()
    body: { menu?: unknown; catalogId?: unknown; catalogName?: unknown },
  ) {
    return this.svc.importMenu(
      req.user.tenantId,
      req.user.userId ?? null,
      body ?? {},
    );
  }
}
