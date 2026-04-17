import { Controller, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { RedisService } from '../realtime/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppRole } from '@cms/database';
import { RbacGuard } from '../auth/rbac.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AllowPanicBypass } from '../auth/panic-bypass.decorator';
import * as crypto from 'crypto';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { TriggerEmergencyInputSchema, ClearEmergencyInputSchema } from '@cms/api-types';
import type { TriggerEmergencyInput, ClearEmergencyInput } from '@cms/api-types';

@Controller('api/v1/emergency')
@UseGuards(JwtAuthGuard, RbacGuard)
export class EmergencyController {
  constructor(
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
    private readonly signer: WebsocketSignerService
  ) {}

  @Post('trigger')
  @AllowPanicBypass()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async triggerEmergency(
    @Body(new ZodValidationPipe(TriggerEmergencyInputSchema)) body: TriggerEmergencyInput,
    @Req() req: any,
  ) {
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
      let activePlaylistId = overridePayload.playlistId || null;

      // If no playlist was explicitly provided, auto-resolve based on Panic Button settings
      if (!activePlaylistId) {
        const tenantInfo = await this.prisma.client.tenant.findUnique({ where: { id: scopeId } });
        if (tenantInfo) {
          if (overridePayload.type === 'lockdown') activePlaylistId = tenantInfo.panicLockdownPlaylistId;
          else if (overridePayload.type === 'weather') activePlaylistId = tenantInfo.panicWeatherPlaylistId;
          else if (overridePayload.type === 'evacuate') activePlaylistId = tenantInfo.panicEvacuatePlaylistId;
        }
      }

      await this.prisma.client.tenant.update({
        where: { id: scopeId },
        data: { 
          emergencyStatus: severity,
          emergencyPlaylistId: activePlaylistId || null
        }
      });
    }

    // Explicit Immutable Audit Logging
    await this.prisma.client.auditLog.create({
       data: {
         action: 'TRIGGER_EMERGENCY',
         targetType: scopeType,
         targetId: scopeId,
         tenantId: req.user?.schoolId || req.user?.districtId || scopeId, // Resolve contextual tenant
         userId: req.user?.id,
         details: JSON.stringify({ overrideId, severity })
       }
    });

    // Create WSSP envelope before transmission (Mitigates RT-01)
    const signedMessage = this.signer.signMessage('OVERRIDE', message.payload);

    // Publish via Redis for WebSocket fanout (graceful fallback if offline)
    const channel = `${scopeType}:${scopeId}`;
    try {
      await this.redisService.publish(channel, signedMessage);
    } catch (error) {
      console.warn(`[Emergency] Redis publish failed for ${channel}. Realtime bypass disabled. Screens will pull via HTTP polling. Error: ${error}`);
    }

    return {
      success: true,
      overrideId,
      message: `Emergency dispatched to ${channel}`
    };
  }

  @Post(':overrideId/all-clear')
  @AllowPanicBypass()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async clearEmergency(
    @Param('overrideId') overrideId: string,
    @Body(new ZodValidationPipe(ClearEmergencyInputSchema)) body: ClearEmergencyInput,
    @Req() req: any,
  ) {
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
      await this.prisma.client.tenant.update({
        where: { id: scopeId },
        data: { 
          emergencyStatus: 'INACTIVE',
          emergencyPlaylistId: null
        }
      });
    }

    // Explicit Immutable Audit Logging
    await this.prisma.client.auditLog.create({
       data: {
         action: 'CLEAR_EMERGENCY',
         targetType: scopeType,
         targetId: scopeId,
         tenantId: req.user?.schoolId || req.user?.districtId || scopeId,
         userId: req.user?.id,
         details: JSON.stringify({ overrideId })
       }
    });

    // Publish via Redis for fanout
    const channel = `${scopeType}:${scopeId}`;
    try {
      await this.redisService.publish(channel, message);
    } catch (error) {
      console.warn(`[Emergency] Redis publish failed for ${channel}.`);
    }

    return {
      success: true,
      message: `All clear dispatched to ${channel} for ${overrideId}`
    };
  }
}
