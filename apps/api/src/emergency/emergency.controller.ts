import { Controller, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { RedisService } from '../realtime/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppRole } from '@cms/database';
import { RbacGuard } from '../auth/rbac.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireRoles } from '../auth/roles.decorator';
import * as crypto from 'crypto';

@Controller('api/v1/emergency')
@UseGuards(JwtAuthGuard, RbacGuard)
export class EmergencyController {
  constructor(
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService
  ) {}

  @Post('trigger')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async triggerEmergency(@Body() body: { scopeType: 'tenant' | 'group' | 'device', scopeId: string, overridePayload: any }, @Req() req: any) {
    const { scopeType, scopeId, overridePayload } = body;
    
    const overrideId = overridePayload.overrideId || `ovr_${crypto.randomUUID()}`;
    const severity = overridePayload.severity || 'CRITICAL';
    const message = {
      type: 'OVERRIDE',
      payload: {
        overrideId,
        severity,
        mediaUrl: overridePayload.mediaUrl,
        textBlob: overridePayload.textBlob,
        expiresAt: overridePayload.expiresAt || (Math.floor(Date.now() / 1000) + 3600) // 1 hr default
      }
    };

    // If targeting a tenant (e.g., a school), update its emergencyStatus persistently
    if (scopeType === 'tenant') {
      await this.prisma.tenant.update({
        where: { id: scopeId },
        data: { emergencyStatus: severity }
      });
    }

    // Explicit Immutable Audit Logging
    await this.prisma.auditLog.create({
       data: {
         action: 'TRIGGER_EMERGENCY',
         targetType: scopeType,
         targetId: scopeId,
         tenantId: req.user?.schoolId || req.user?.districtId || scopeId, // Resolve contextual tenant
         userId: req.user?.id,
         details: { overrideId, severity }
       }
    });

    // Publish via Redis for WebSocket fanout
    const channel = `${scopeType}:${scopeId}`;
    await this.redisService.publish(channel, message);

    return {
      success: true,
      overrideId,
      message: `Emergency dispatched to ${channel}`
    };
  }

  @Post(':overrideId/all-clear')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async clearEmergency(@Param('overrideId') overrideId: string, @Body() body: { scopeType: 'tenant' | 'group' | 'device', scopeId: string }, @Req() req: any) {
    const { scopeType, scopeId } = body;
    const clearedBy = req.user?.id || 'admin_system';

    const message = {
      type: 'ALL_CLEAR',
      payload: {
        overrideId,
        clearedBy
      }
    };

    // If targeting a tenant, clear its emergencyStatus
    if (scopeType === 'tenant') {
      await this.prisma.tenant.update({
        where: { id: scopeId },
        data: { emergencyStatus: 'INACTIVE' }
      });
    }

    // Explicit Immutable Audit Logging
    await this.prisma.auditLog.create({
       data: {
         action: 'CLEAR_EMERGENCY',
         targetType: scopeType,
         targetId: scopeId,
         tenantId: req.user?.schoolId || req.user?.districtId || scopeId,
         userId: req.user?.id,
         details: { overrideId }
       }
    });

    // Publish via Redis for fanout
    const channel = `${scopeType}:${scopeId}`;
    await this.redisService.publish(channel, message);

    return {
      success: true,
      message: `All clear dispatched to ${channel} for ${overrideId}`
    };
  }
}
