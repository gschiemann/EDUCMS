/**
 * StreamingController — REST endpoints for the streaming framework.
 *
 *   GET    /api/v1/streaming/providers              — catalog (public, anyone)
 *   GET    /api/v1/streaming/providers/:id/channels — preset channels for a provider
 *   GET    /api/v1/streaming/connections            — tenant's connections
 *   POST   /api/v1/streaming/connections            — connect a provider
 *   DELETE /api/v1/streaming/connections/:id        — disconnect
 *   GET    /api/v1/streaming/channels               — tenant's picked channels
 *   POST   /api/v1/streaming/channels               — pick a channel
 *   DELETE /api/v1/streaming/channels/:id           — unpick
 *   GET    /api/v1/streaming/channels/:id/play      — resolve playback url
 *
 * Sprint 8c (2026-05-03). Locked to ADMIN+ for write operations;
 * CONTRIBUTOR can read but not connect new providers (creds are sensitive).
 */
import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { StreamingService } from './streaming.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/streaming')
export class StreamingController {
  constructor(private readonly svc: StreamingService) {}

  @Get('providers')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR, AppRole.RESTRICTED_VIEWER)
  listProviders() {
    return this.svc.listProviders();
  }

  @Get('providers/:id/channels')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  listPresetChannels(@Param('id') id: string) {
    return this.svc.listPresetChannels(id);
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

  @Get('channels')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async listChannels(@Request() req: any) {
    return this.svc.listChannels(req.user.tenantId);
  }

  @Post('channels')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async addChannel(@Request() req: any, @Body() body: any) {
    return this.svc.addChannel({
      tenantId: req.user.tenantId,
      connectionId: body.connectionId,
      externalId: body.externalId,
      title: body.title,
      description: body.description,
      category: body.category,
      thumbnailUrl: body.thumbnailUrl,
      playbackUrl: body.playbackUrl,
      playbackType: body.playbackType,
      kind: body.kind,
      allowAdOverlay: body.allowAdOverlay,
    });
  }

  @Delete('channels/:id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async deleteChannel(@Request() req: any, @Param('id') id: string) {
    await this.svc.deleteChannel(req.user.tenantId, id);
    return { success: true };
  }

  @Get('channels/:id/play')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR, AppRole.RESTRICTED_VIEWER)
  async resolvePlayback(@Request() req: any, @Param('id') id: string) {
    return this.svc.resolvePlayback(req.user.tenantId, id);
  }
}
