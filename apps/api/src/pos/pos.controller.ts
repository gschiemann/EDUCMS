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
import { Body, Controller, Delete, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
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
    await this.svc.deleteConnection(req.user.tenantId, id);
    return { success: true };
  }

  @Post('connections/:id/sync')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async sync(@Request() req: any, @Param('id') id: string) {
    return this.svc.triggerSync(req.user.tenantId, id);
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
}
