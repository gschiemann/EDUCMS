/**
 * PosController — REST endpoints for the POS framework.
 *
 *   GET    /api/v1/pos/providers              — catalog
 *   GET    /api/v1/pos/connections            — tenant's connections
 *   POST   /api/v1/pos/connections            — connect a provider
 *   DELETE /api/v1/pos/connections/:id        — disconnect
 *   POST   /api/v1/pos/connections/:id/sync   — trigger manual sync
 *   GET    /api/v1/pos/items                  — synced menu items
 *
 * Sprint 8d (2026-05-03). Locked to ADMIN+ for write ops.
 */
import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { PosService } from './pos.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/pos')
export class PosController {
  constructor(private readonly svc: PosService) {}

  @Get('providers')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR, AppRole.RESTRICTED_VIEWER)
  listProviders() {
    return this.svc.listProviders();
  }

  @Get('connections')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async listConnections(@Request() req: any) {
    return this.svc.listConnections(req.user.tenantId);
  }

  @Post('connections')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async createConnection(
    @Request() req: any,
    @Body() body: { providerId: string; displayName?: string; credentials?: Record<string, unknown> },
  ) {
    const row = await this.svc.createConnection({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      providerId: body.providerId,
      displayName: body.displayName,
      credentials: body.credentials || {},
    });
    return {
      id: row.id,
      providerId: row.providerId,
      status: row.status,
      createdAt: row.createdAt,
    };
  }

  @Delete('connections/:id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async deleteConnection(@Request() req: any, @Param('id') id: string) {
    await this.svc.deleteConnection(req.user.tenantId, id, req.user.id ?? null);
    return { success: true };
  }

  @Post('connections/:id/sync')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async sync(@Request() req: any, @Param('id') id: string) {
    return this.svc.triggerSync(req.user.tenantId, id, req.user.id ?? null);
  }

  @Get('items')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR, AppRole.RESTRICTED_VIEWER)
  async listItems(
    @Request() req: any,
    @Query('connectionId') connectionId?: string,
    @Query('category') category?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.svc.listMenuItems(req.user.tenantId, { connectionId, category, locationId });
  }

  // Sprint 8d follow-up (2026-05-03) — distinct categories + item counts
  // for the PosCategoryPicker in the template editor.
  @Get('categories')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR, AppRole.RESTRICTED_VIEWER)
  async listCategories(@Request() req: any) {
    return this.svc.listCategories(req.user.tenantId);
  }

  // ─── Multi-location (2026-06-02): map POS stores → our location tenants ─
  //
  // A 50-store chain's POS connection syncs one PosLocation per store. The
  // operator maps each to one of our (child) location tenants — THE wiring
  // that lets the POS drive that store's per-location pricing (the bridge in
  // pos.service writes per-location overrides only for mapped locations).

  @Get('connections/:id/locations')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async listLocations(@Request() req: any, @Param('id') id: string) {
    return this.svc.listConnectionLocations(req.user.tenantId, id);
  }

  @Put('connections/:id/locations/:locationId')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async mapLocation(
    @Request() req: any,
    @Param('id') id: string,
    @Param('locationId') locationId: string,
    @Body() body: { locationTenantId?: string | null },
  ) {
    return this.svc.mapConnectionLocation(
      req.user.tenantId,
      id,
      locationId,
      body?.locationTenantId ?? null,
      req.user.id ?? null,
    );
  }
}
