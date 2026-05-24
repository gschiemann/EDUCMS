/**
 * AdsController — REST endpoints for the ad-network framework.
 *
 *   GET    /api/v1/ads/networks                 — catalog
 *   GET    /api/v1/ads/connections              — tenant's connections
 *   POST   /api/v1/ads/connections              — connect a network
 *   PATCH  /api/v1/ads/connections/:id/status   — pause / resume
 *   PATCH  /api/v1/ads/connections/:id/controls — update content controls
 *   DELETE /api/v1/ads/connections/:id          — disconnect
 *   GET    /api/v1/ads/earnings                 — dashboard summary
 *
 * Sprint 8d (2026-05-03). Connect/disconnect = ADMIN+; pause/controls
 * also ADMIN+. Earnings read by ADMIN+ + CONTRIBUTOR.
 */
import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { AdsService } from './ads.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/ads')
export class AdsController {
  constructor(private readonly svc: AdsService, private readonly prisma: PrismaService) {}

  @Get('networks')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR, AppRole.RESTRICTED_VIEWER)
  listNetworks() {
    return this.svc.listNetworks();
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
    @Body() body: {
      networkId: string;
      credentials?: Record<string, unknown>;
      contentControls?: any;
    },
  ) {
    // Resolve tenant vertical for the K-12 forbidden-network check.
    const tenant = await (this.prisma.client as any).tenant.findUnique({
      where: { id: req.user.tenantId },
      select: { vertical: true },
    });
    return this.svc.createConnection({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      tenantVertical: tenant?.vertical || 'K12',
      networkId: body.networkId,
      credentials: body.credentials || {},
      contentControls: body.contentControls,
    });
  }

  @Patch('connections/:id/status')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setStatus(@Request() req: any, @Param('id') id: string, @Body() body: { status: 'ACTIVE' | 'PAUSED' }) {
    return this.svc.setStatus(req.user.tenantId, id, body.status);
  }

  @Patch('connections/:id/controls')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async updateControls(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.svc.updateContentControls(req.user.tenantId, id, body);
  }

  @Delete('connections/:id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async deleteConnection(@Request() req: any, @Param('id') id: string) {
    await this.svc.deleteConnection(req.user.tenantId, id, req.user.id ?? null);
    return { success: true };
  }

  @Get('earnings')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async earnings(@Request() req: any) {
    return this.svc.earningsSummary(req.user.tenantId);
  }
}
